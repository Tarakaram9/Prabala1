#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Prabala CLI – Entry Point
// Usage:
//   prabala run "tests/**/*.yaml" [--config prabala.config.yaml]
//   prabala list-keywords
//   prabala report
// ─────────────────────────────────────────────────────────────────────────────

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs';
import { Orchestrator, KeywordRegistry, PrabalaConfig, TestParser } from '@prabala/core';
import { registerWebKeywords } from '@prabala/driver-web';
import { HtmlReporter } from '@prabala/reporting';

// Register all built-in keyword libraries
registerWebKeywords();

const program = new Command();

program
  .name('prabala')
  .description(
    chalk.magenta('🔮 Prabala – Open Source Test Automation Framework for Web & Desktop')
  )
  .version('0.1.0');

// ── prabala run ──────────────────────────────────────────────────────────────
program
  .command('run <pattern>')
  .description('Run test cases matching a glob pattern')
  .option('-c, --config <path>', 'Path to prabala.config.yaml', 'prabala.config.yaml')
  .option('--headless', 'Run browsers in headless mode', false)
  .option('--browser <browser>', 'Browser to use: chromium | firefox | webkit', 'chromium')
  .option('--output <dir>', 'Output directory for artifacts and reports', 'artifacts')
  .option('--base-url <url>', 'Base URL override')
  .option('--screenshot <mode>', 'Screenshot per step: always | onFailure | never', 'never')
  .action(async (pattern: string, opts: {
    config: string;
    headless: boolean;
    browser: string;
    output: string;
    baseUrl?: string;
    screenshot: string;
  }) => {
    console.log(chalk.bold.magenta('\n🔮 Prabala v0.1.0\n'));

    let config: PrabalaConfig = {};

    // Load config file if it exists
    if (fs.existsSync(opts.config)) {
      config = TestParser.parseConfig(opts.config);
      console.log(chalk.gray(`  Config   : ${opts.config}`));
    } else {
      console.log(chalk.gray(`  Config   : (none – using defaults)`));
    }

    // CLI flags override config file
    if (opts.headless) config.headless = true;
    if (opts.browser) config.browser = opts.browser as PrabalaConfig['browser'];
    if (opts.output) config.outputDir = opts.output;
    if (opts.baseUrl) config.baseUrl = opts.baseUrl;
    if (opts.screenshot && opts.screenshot !== 'never') {
      config.screenshotOnStep = opts.screenshot as PrabalaConfig['screenshotOnStep'];
    }

    // Ensure object-repo and test-data defaults
    config.objectRepositoryDir = config.objectRepositoryDir ?? 'object-repository';
    config.testDataDir = config.testDataDir ?? 'test-data';

    const orchestrator = new Orchestrator(config);

    try {
      const results = await orchestrator.runPattern(pattern);

      // Generate HTML report
      const reporter = new HtmlReporter(config.outputDir ?? 'artifacts');
      const reportPath = reporter.generate(results);
      console.log(chalk.cyan(`  HTML Report: ${reportPath}`));

      process.exit(results.failed > 0 ? 1 : 0);
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${(err as Error).message}`));
      process.exit(2);
    }
  });

// ── prabala list-keywords ────────────────────────────────────────────────────
program
  .command('list-keywords')
  .description('List all registered keywords')
  .action(() => {
    const keywords = KeywordRegistry.listAll().sort();
    console.log(chalk.bold.magenta('\n🔮 Registered Prabala Keywords\n'));
    for (const kw of keywords) {
      console.log(`  ${chalk.cyan('•')} ${kw}`);
    }
    console.log(chalk.gray(`\n  Total: ${keywords.length} keyword(s)\n`));
  });

// ── prabala init ─────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Scaffold a new Prabala project in the current directory')
  .action(() => {
    const dirs = ['tests', 'object-repository', 'test-data', 'keywords', 'artifacts'];
    for (const dir of dirs) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(chalk.green(`  Created: ${dir}/`));
    }

    const configContent = `# Prabala Configuration
baseUrl: "https://example.com"
browser: chromium
headless: true
timeout: 30000
objectRepositoryDir: object-repository
testDataDir: test-data
outputDir: artifacts
`;
    const configPath = 'prabala.config.yaml';
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, configContent);
      console.log(chalk.green(`  Created: ${configPath}`));
    }

    console.log(chalk.bold.magenta('\n  ✔ Prabala project initialised!\n'));
    console.log(chalk.gray('  Next steps:'));
    console.log(chalk.gray('    1. Add test cases in tests/'));
    console.log(chalk.gray('    2. Add object locators in object-repository/'));
    console.log(chalk.gray('    3. Run: prabala run "tests/**/*.yaml"\n'));
  });

program.parse(process.argv);
