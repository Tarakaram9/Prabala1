// ─────────────────────────────────────────────────────────────────────────────
// Prabala Core – Test Execution Engine
// ─────────────────────────────────────────────────────────────────────────────

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

      try {
        if (overallStatus === 'failed' && !step.continueOnFailure) {
          stepResults.push({
            keyword: step.keyword,
            status: 'skipped',
            durationMs: 0,
          });
          continue;
        }

        console.log(chalk.gray(`    ⬥ ${step.keyword} ${JSON.stringify(resolvedParams)}`));
        await KeywordRegistry.execute(step.keyword, resolvedParams, this.context);

        const dur = Date.now() - stepStart;
        stepResults.push({ keyword: step.keyword, status: 'passed', durationMs: dur });
        console.log(chalk.green(`    ✔ ${step.keyword} (${dur}ms)`));
      } catch (err) {
        const dur = Date.now() - stepStart;
        const message = err instanceof Error ? err.message : String(err);
        stepResults.push({
          keyword: step.keyword,
          status: 'failed',
          durationMs: dur,
          error: message,
        });
        console.log(chalk.red(`    ✘ ${step.keyword} — ${message}`));
        if (!step.continueOnFailure) {
          overallStatus = 'failed';
        }
      }
    }

    const durationMs = Date.now() - startTime;
    const status: 'passed' | 'failed' =
      stepResults.some((s) => s.status === 'failed') ? 'failed' : 'passed';

    const icon = status === 'passed' ? chalk.green('✔') : chalk.red('✘');
    console.log(`  ${icon} ${testCase.testCase} [${durationMs}ms]`);

    return { testCase: testCase.testCase, status, durationMs, steps: stepResults };
  }
}
