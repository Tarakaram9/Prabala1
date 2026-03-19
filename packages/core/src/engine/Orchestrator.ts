// ─────────────────────────────────────────────────────────────────────────────
// Prabala Core – Execution Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { glob } from 'glob';
import {
  PrabalaConfig,
  SuiteResult,
  TestResult,
  ExecutionContext,
  ArtifactStore,
} from '../types';
import { TestParser } from '../parser/TestParser';
import { TestEngine } from './TestEngine';

export class Orchestrator {
  private config: PrabalaConfig;

  constructor(config: PrabalaConfig) {
    this.config = config;
  }

  private buildContext(): ExecutionContext {
    const outputDir = this.config.outputDir ?? 'artifacts';
    fs.mkdirSync(outputDir, { recursive: true });

    const artifacts: ArtifactStore = {
      outputDir,
      screenshots: [],
      videos: [],
      traces: [],
    };

    // Load all object repositories
    const objectRepository: Record<string, import('../types').ObjectEntry> = {};
    const objDir = this.config.objectRepositoryDir;
    if (objDir && fs.existsSync(objDir)) {
      const repoFiles = fs.readdirSync(objDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
      for (const file of repoFiles) {
        const repo = TestParser.parseObjectRepository(path.join(objDir, file));
        Object.assign(objectRepository, repo.objects);
      }
    }

    // Load test data
    const testData: Record<string, unknown> = {};
    const dataDir = this.config.testDataDir;
    if (dataDir && fs.existsSync(dataDir)) {
      const dataFiles = fs.readdirSync(dataDir).filter((f) => f.match(/\.(json|ya?ml)$/));
      for (const file of dataFiles) {
        const data = TestParser.loadTestData(path.join(dataDir, file));
        Object.assign(testData, data);
      }
    }

    return {
      variables: { BASE_URL: this.config.baseUrl ?? '' },
      objectRepository,
      testData,
      artifacts,
      driverInstances: {},
    };
  }

  async runPattern(pattern: string): Promise<SuiteResult> {
    const files = await glob(pattern, { absolute: true });
    if (files.length === 0) {
      throw new Error(`No test files found matching pattern: ${pattern}`);
    }

    console.log(chalk.bold.magenta('\n🔮 Prabala Test Runner\n'));
    console.log(chalk.gray(`  Pattern : ${pattern}`));
    console.log(chalk.gray(`  Files   : ${files.length} test case(s) found\n`));

    const suiteName = pattern;
    const startTime = new Date();
    const results: TestResult[] = [];

    const context = this.buildContext();
    const engine = new TestEngine(this.config, context);

    for (const file of files) {
      const testCase = TestParser.parseTestCase(file);
      const result = await engine.runTestCase(testCase);
      results.push(result);
    }

    const endTime = new Date();
    const passed = results.filter((r) => r.status === 'passed').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const totalDurationMs = endTime.getTime() - startTime.getTime();

    const suiteResult: SuiteResult = {
      suite: suiteName,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      totalDurationMs,
      passed,
      failed,
      skipped,
      tests: results,
    };

    this.printSummary(suiteResult);

    // Save JSON results
    const reportPath = path.join(context.artifacts.outputDir, 'prabala-results.json');
    fs.writeFileSync(reportPath, JSON.stringify(suiteResult, null, 2));
    console.log(chalk.gray(`\n  Results saved to: ${reportPath}\n`));

    return suiteResult;
  }

  private printSummary(result: SuiteResult): void {
    console.log(chalk.bold('\n──────────────────────────────────────────'));
    console.log(chalk.bold('  Test Execution Summary'));
    console.log(chalk.bold('──────────────────────────────────────────'));
    console.log(`  ${chalk.green('Passed ')} : ${result.passed}`);
    console.log(`  ${chalk.red('Failed ')} : ${result.failed}`);
    console.log(`  ${chalk.yellow('Skipped')} : ${result.skipped}`);
    console.log(`  Duration : ${result.totalDurationMs}ms`);
    const overall = result.failed === 0 ? chalk.green('PASS') : chalk.red('FAIL');
    console.log(`  Status   : ${overall}`);
    console.log(chalk.bold('──────────────────────────────────────────\n'));
  }
}
