// ─────────────────────────────────────────────────────────────────────────────
// Prabala Core – Test Execution Engine
// ─────────────────────────────────────────────────────────────────────────────

import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { TestCase, TestResult, StepResult, ExecutionContext, PrabalaConfig } from '../types';
import { KeywordRegistry } from '../keywords/KeywordRegistry';
import { TestParser } from '../parser/TestParser';

export class TestEngine {
  private config: PrabalaConfig;
  private context: ExecutionContext;

  constructor(config: PrabalaConfig, context: ExecutionContext) {
    this.config = config;
    this.context = context;
  }

  /** Run a test case — handles DDT iterations and test-level retries. */
  async runTestCase(testCase: TestCase): Promise<TestResult[]> {
    // ── Data-driven expansion ────────────────────────────────────────────────
    let rows: Record<string, unknown>[] = [{}];
    if (testCase.dataSource) {
      const absPath = path.isAbsolute(testCase.dataSource)
        ? testCase.dataSource
        : path.resolve(this.config.testDataDir ?? '.', testCase.dataSource);
      try {
        rows = TestParser.loadTestData(absPath) as unknown as Record<string, unknown>[];
        if (!Array.isArray(rows)) rows = [rows];
      } catch (e) {
        console.warn(chalk.yellow(`  [DDT] Could not load dataSource "${testCase.dataSource}": ${(e as Error).message}`));
        rows = [{}];
      }
    }

    // ── Run once per row ─────────────────────────────────────────────────────
    const allResults: TestResult[] = [];
    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const rowData = rows[rowIdx];
      const rowLabel = rows.length > 1 ? ` [row ${rowIdx + 1}/${rows.length}]` : '';

      // Merge row data into test data for variable resolution
      const rowContext: ExecutionContext = {
        ...this.context,
        testData: { ...this.context.testData, ...rowData },
      };

      // ── Test-level retries ─────────────────────────────────────────────────
      const maxRetries = testCase.retries ?? this.config.retries ?? 0;
      let lastResult!: TestResult;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          console.log(chalk.yellow(`  ↻ Retrying ${testCase.testCase}${rowLabel} (attempt ${attempt + 1}/${maxRetries + 1})`));
        }
        lastResult = await this._runOnce(testCase, rowContext, rowIdx + 1);
        if (lastResult.status === 'passed') break;
      }
      if (lastResult.retryCount === undefined && maxRetries > 0 && lastResult.status === 'passed') {
        // no-op — already set
      }
      allResults.push(lastResult);
    }
    return allResults;
  }

  /** Execute all steps of a test case exactly once. */
  private async _runOnce(
    testCase: TestCase,
    rowContext: ExecutionContext,
    iteration: number,
  ): Promise<TestResult> {
    const startTime = Date.now();
    const stepResults: StepResult[] = [];
    const iterLabel = iteration > 1 ? ` [row ${iteration}]` : '';

    console.log(chalk.cyan(`\n  ▶ ${testCase.testCase}${iterLabel}`));

    let overallStatus: 'passed' | 'failed' | 'skipped' = 'passed';
    /** Stack for control-flow: tracks If blocks */
    const cfStack: { active: boolean }[] = [];

    for (const step of testCase.steps) {

      // ── Control-flow: If.Condition ────────────────────────────────────────
      if (step.keyword === 'If.Condition') {
        const expr = String(step.params?.expression ?? step.params?.value ?? '');
        const resolved = TestParser.resolveVariables(expr, rowContext.variables, rowContext.testData, this.config.env ?? {});
        const active = resolved.trim().toLowerCase() !== 'false' && resolved.trim() !== '0' && resolved.trim() !== '';
        cfStack.push({ active });
        stepResults.push({ keyword: step.keyword, status: 'passed', durationMs: 0 });
        continue;
      }
      if (step.keyword === 'If.Else') {
        if (cfStack.length > 0) cfStack[cfStack.length - 1].active = !cfStack[cfStack.length - 1].active;
        stepResults.push({ keyword: step.keyword, status: 'passed', durationMs: 0 });
        continue;
      }
      if (step.keyword === 'If.End' || step.keyword === 'Loop.End') {
        cfStack.pop();
        stepResults.push({ keyword: step.keyword, status: 'passed', durationMs: 0 });
        continue;
      }

      // ── Skip if inside an inactive If block ──────────────────────────────
      const inInactiveBlock = cfStack.some((f) => !f.active);

      // ── Step disabled ────────────────────────────────────────────────────
      if (step.disabled || inInactiveBlock) {
        stepResults.push({ keyword: step.keyword, status: 'skipped', durationMs: 0 });
        continue;
      }

      // ── Skip remaining steps after failure ───────────────────────────────
      if (overallStatus === 'failed' && !step.continueOnFailure) {
        stepResults.push({ keyword: step.keyword, status: 'skipped', durationMs: 0 });
        continue;
      }

      // ── Resolve params ───────────────────────────────────────────────────
      const resolvedParams: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(step.params ?? {})) {
        resolvedParams[key] =
          typeof val === 'string'
            ? TestParser.resolveVariables(val, rowContext.variables, rowContext.testData, this.config.env ?? {})
            : val;
      }
      for (const [key, val] of Object.entries(resolvedParams)) {
        if (typeof val === 'string' && val.startsWith('@')) {
          const objKey = val.slice(1);
          const obj = rowContext.objectRepository[objKey];
          if (!obj) throw new Error(`Object not found in repository: "${objKey}"`);
          resolvedParams[key] = obj;
        }
      }

      // ── Step-level retries ───────────────────────────────────────────────
      const stepMaxRetries = step.retries ?? 0;
      let stepResult: StepResult = { keyword: step.keyword, status: 'passed', durationMs: 0 };
      const stepStart = Date.now();

      for (let attempt = 0; attempt <= stepMaxRetries; attempt++) {
        try {
          console.log(chalk.gray(`    ⬥ ${step.keyword} ${JSON.stringify(resolvedParams)}`));
          await KeywordRegistry.execute(step.keyword, resolvedParams, rowContext);
          stepResult.status = 'passed';
          stepResult.durationMs = Date.now() - stepStart;
          if (attempt > 0) stepResult.retryCount = attempt;
          console.log(chalk.green(`    ✔ ${step.keyword} (${stepResult.durationMs}ms)`));
          break;
        } catch (err) {
          stepResult.status = 'failed';
          stepResult.durationMs = Date.now() - stepStart;
          stepResult.error = err instanceof Error ? err.message : String(err);
          if (attempt < stepMaxRetries) {
            console.log(chalk.yellow(`    ↻ ${step.keyword} failed, retrying (${attempt + 1}/${stepMaxRetries})…`));
          } else {
            console.log(chalk.red(`    ✘ ${step.keyword} — ${stepResult.error}`));
            if (!step.continueOnFailure) overallStatus = 'failed';
          }
        }
      }

      // ── Screenshot ────────────────────────────────────────────────────────
      const ss = await this.maybeScreenshot(stepResults.length, step.keyword, stepResult.status, rowContext);
      if (ss) stepResult.screenshot = ss;

      stepResults.push(stepResult);
    }

    const durationMs = Date.now() - startTime;
    const status: 'passed' | 'failed' =
      stepResults.some((s) => s.status === 'failed') ? 'failed' : 'passed';

    const icon = status === 'passed' ? chalk.green('✔') : chalk.red('✘');
    console.log(`  ${icon} ${testCase.testCase} [${durationMs}ms]`);

    return {
      testCase: testCase.testCase,
      status,
      durationMs,
      steps: stepResults,
      iteration: iteration > 1 ? iteration : undefined,
    };
  }

  /** Capture a screenshot from the active web or desktop session if configured to do so. */
  private async maybeScreenshot(
    idx: number,
    keyword: string,
    status: 'passed' | 'failed' | 'skipped',
    context: ExecutionContext,
  ): Promise<string | undefined> {
    const mode = this.config.screenshotOnStep;
    if (!mode || mode === 'never') return undefined;
    if (mode === 'onFailure' && status !== 'failed') return undefined;

    const outDir = path.join(context.artifacts.outputDir, 'screenshots');
    fs.mkdirSync(outDir, { recursive: true });
    const safeName = keyword.replace(/[^a-zA-Z0-9.]/g, '-');
    const filename = `step-${String(idx + 1).padStart(3, '0')}-${safeName}-${status}.png`;
    const absPath = path.join(outDir, filename);
    const relPath = `screenshots/${filename}`;

    try {
      const webSession = context.driverInstances['web'] as any;
      if (webSession?.page) {
        const buf: Buffer = await webSession.page.screenshot({ fullPage: false }) as Buffer;
        fs.writeFileSync(absPath, buf);
        context.artifacts.screenshots.push(absPath);
        return relPath;
      }
      const desktopSession = context.driverInstances['desktop'] as any;
      if (desktopSession?.driver) {
        const base64: string = await desktopSession.driver.takeScreenshot();
        fs.writeFileSync(absPath, Buffer.from(base64, 'base64'));
        context.artifacts.screenshots.push(absPath);
        return relPath;
      }
    } catch (e) {
      console.warn(chalk.yellow(`    [Screenshot] Capture failed: ${(e as Error).message}`));
    }
    return undefined;
  }
}
