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

  async runTestCase(testCase: TestCase): Promise<TestResult> {
    const startTime = Date.now();
    const stepResults: StepResult[] = [];

    console.log(chalk.cyan(`\n  ▶ ${testCase.testCase}`));

    let overallStatus: 'passed' | 'failed' | 'skipped' = 'passed';

    for (const step of testCase.steps) {
      const stepStart = Date.now();

      // Resolve variable placeholders in all param values
      const resolvedParams: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(step.params ?? {})) {
        resolvedParams[key] =
          typeof val === 'string'
            ? TestParser.resolveVariables(
                val,
                this.context.variables,
                this.context.testData,
                this.config.env ?? {}
              )
            : val;
      }

      // Resolve @object-repo references
      for (const [key, val] of Object.entries(resolvedParams)) {
        if (typeof val === 'string' && val.startsWith('@')) {
          const objKey = val.slice(1);
          const obj = this.context.objectRepository[objKey];
          if (!obj) {
            throw new Error(`Object not found in repository: "${objKey}"`);
          }
          resolvedParams[key] = obj;
        }
      }

      if (overallStatus === 'failed' && !step.continueOnFailure) {
        stepResults.push({ keyword: step.keyword, status: 'skipped', durationMs: 0 });
        continue;
      }

      const stepResult: StepResult = { keyword: step.keyword, status: 'passed', durationMs: 0 };

      try {
        console.log(chalk.gray(`    ⬥ ${step.keyword} ${JSON.stringify(resolvedParams)}`));
        await KeywordRegistry.execute(step.keyword, resolvedParams, this.context);
        stepResult.status = 'passed';
        stepResult.durationMs = Date.now() - stepStart;
        console.log(chalk.green(`    ✔ ${step.keyword} (${stepResult.durationMs}ms)`));
      } catch (err) {
        stepResult.status = 'failed';
        stepResult.durationMs = Date.now() - stepStart;
        stepResult.error = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`    ✘ ${step.keyword} — ${stepResult.error}`));
        if (!step.continueOnFailure) overallStatus = 'failed';
      }

      // Auto-screenshot after step
      const ss = await this.maybeScreenshot(stepResults.length, step.keyword, stepResult.status);
      if (ss) stepResult.screenshot = ss;

      stepResults.push(stepResult);
    }

    const durationMs = Date.now() - startTime;
    const status: 'passed' | 'failed' =
      stepResults.some((s) => s.status === 'failed') ? 'failed' : 'passed';

    const icon = status === 'passed' ? chalk.green('✔') : chalk.red('✘');
    console.log(`  ${icon} ${testCase.testCase} [${durationMs}ms]`);

    return { testCase: testCase.testCase, status, durationMs, steps: stepResults };
  }

  /** Capture a screenshot from the active web or desktop session if configured to do so. */
  private async maybeScreenshot(
    idx: number,
    keyword: string,
    status: 'passed' | 'failed' | 'skipped'
  ): Promise<string | undefined> {
    const mode = this.config.screenshotOnStep;
    if (!mode || mode === 'never') return undefined;
    if (mode === 'onFailure' && status !== 'failed') return undefined;

    const outDir = path.join(this.context.artifacts.outputDir, 'screenshots');
    fs.mkdirSync(outDir, { recursive: true });
    const safeName = keyword.replace(/[^a-zA-Z0-9.]/g, '-');
    const filename = `step-${String(idx + 1).padStart(3, '0')}-${safeName}-${status}.png`;
    const absPath = path.join(outDir, filename);
    // Store as forward-slash relative path (works as URL in HTML report)
    const relPath = `screenshots/${filename}`;

    try {
      // Web – Playwright page.screenshot()
      const webSession = this.context.driverInstances['web'] as any;
      if (webSession?.page) {
        const buf: Buffer = await webSession.page.screenshot({ fullPage: false }) as Buffer;
        fs.writeFileSync(absPath, buf);
        this.context.artifacts.screenshots.push(absPath);
        return relPath;
      }
      // Desktop – WebdriverIO driver.takeScreenshot()
      const desktopSession = this.context.driverInstances['desktop'] as any;
      if (desktopSession?.driver) {
        const base64: string = await desktopSession.driver.takeScreenshot();
        fs.writeFileSync(absPath, Buffer.from(base64, 'base64'));
        this.context.artifacts.screenshots.push(absPath);
        return relPath;
      }
    } catch (e) {
      console.warn(chalk.yellow(`    [Screenshot] Capture failed: ${(e as Error).message}`));
    }
    return undefined;
  }
}
