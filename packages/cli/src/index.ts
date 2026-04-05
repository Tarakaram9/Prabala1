#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Prabala CLI – Entry Point
// Usage:
//   prabala run "tests/**/*.yaml" [options]
//   prabala list-keywords
//   prabala init
//   prabala generate-pipelines
// ─────────────────────────────────────────────────────────────────────────────

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { glob } from 'glob';
import { Orchestrator, KeywordRegistry, PrabalaConfig, TestParser, SuiteResult } from '@prabala/core';
import { registerWebKeywords } from '@prabala/driver-web';
import { registerApiKeywords } from '@prabala/driver-api';
import { HtmlReporter, JUnitReporter } from '@prabala/reporting';

// Register all built-in keyword libraries
registerWebKeywords();
registerApiKeywords();

// SAP GUI keywords — only register on Windows, skip gracefully elsewhere
if (process.platform === 'win32') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerSapKeywords } = require('@prabala/driver-sap');
    registerSapKeywords();
  } catch {
    // driver-sap not built yet or winax missing — no-op
  }
}

// Desktop keywords — register with graceful fallback if native deps unavailable
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { registerDesktopKeywords } = require('@prabala/driver-desktop');
  registerDesktopKeywords();
} catch {
  // driver-desktop not available in this environment — no-op
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Load prabala.config.json or prabala.config.yaml, whichever exists. */
function loadProjectConfig(configPath?: string): PrabalaConfig {
  const candidates = configPath
    ? [configPath]
    : ['prabala.config.json', 'prabala.config.yaml', 'prabala.config.yml'];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf-8');
      const parsed = p.endsWith('.json') ? JSON.parse(raw) : yaml.load(raw);
      console.log(chalk.gray(`  Config   : ${p}`));
      return parsed as PrabalaConfig;
    }
  }
  console.log(chalk.gray(`  Config   : (none – using defaults)`));
  return {};
}

/** Load env/<name>.yaml and merge its vars into config.env */
function loadEnvFile(envName: string, config: PrabalaConfig): PrabalaConfig {
  const envFile = path.join('env', `${envName}.yaml`);
  const altFile = path.join('env', `${envName}.yml`);
  const file = fs.existsSync(envFile) ? envFile : fs.existsSync(altFile) ? altFile : null;

  if (!file) {
    console.warn(chalk.yellow(`  [env] Warning: env/${envName}.yaml not found — skipping`));
    return config;
  }

  const raw = fs.readFileSync(file, 'utf-8');
  const envVars = yaml.load(raw) as Record<string, any>;
  console.log(chalk.gray(`  Env      : ${file}`));

  // baseUrl in env file overrides config
  if (envVars.baseUrl) config.baseUrl = envVars.baseUrl;
  config.env = { ...(config.env ?? {}), ...(envVars.vars ?? envVars) };
  return config;
}

/** Filter test files by tags — returns subset whose test tags intersect with required tags */
async function filterByTags(files: string[], tags: string[]): Promise<string[]> {
  const required = new Set(tags.map((t) => t.trim().toLowerCase()));
  const filtered: string[] = [];
  for (const file of files) {
    try {
      const tc = TestParser.parseTestCase(file);
      const fileTags = (tc.tags ?? []).map((t: string) => t.toLowerCase());
      if (fileTags.some((t: string) => required.has(t))) filtered.push(file);
    } catch { /* skip unreadable */ }
  }
  return filtered;
}

/** Write reporters based on selected format */
function writeReports(suite: SuiteResult, outputDir: string, reporter: string): void {
  if (reporter === 'html' || reporter === 'both') {
    const r = new HtmlReporter(outputDir);
    console.log(chalk.cyan(`  HTML Report : ${r.generate(suite)}`));
  }
  if (reporter === 'junit' || reporter === 'both') {
    const r = new JUnitReporter(outputDir);
    console.log(chalk.cyan(`  JUnit XML   : ${r.generate(suite)}`));
  }
}

const program = new Command();

program
  .name('prabala')
  .description(chalk.magenta('🔮 Prabala – Open Source Test Automation Framework'))
  .version('0.1.0');

// ── prabala run ──────────────────────────────────────────────────────────────
program
  .command('run')
  .argument('[pattern]', 'Glob pattern for test files', 'tests/**/*.yaml')
  .description('Run test cases matching a glob pattern')
  .option('-c, --config <path>', 'Path to prabala.config.json/yaml')
  .option('--env <name>', 'Environment to use: dev | staging | prod', '')
  .option('--tags <tags>', 'Run only tests with these tags (comma-separated)', '')
  .option('--headless', 'Run browsers in headless mode', false)
  .option('--browser <browser>', 'Browser: chromium | firefox | webkit', 'chromium')
  .option('--output <dir>', 'Output directory for artifacts and reports', '')
  .option('--base-url <url>', 'Base URL override')
  .option('--screenshot <mode>', 'Screenshot: always | onFailure | never', 'never')
  .option('--reporter <format>', 'Output format: html | junit | both', 'both')
  .option('--keywords <dir>', 'Directory containing custom keyword .js files')
  .action(async (pattern: string, opts: {
    config?: string;
    env: string;
    tags: string;
    headless: boolean;
    browser: string;
    output: string;
    baseUrl?: string;
    screenshot: string;
    reporter: string;
    keywords?: string;
  }) => {
    console.log(chalk.bold.magenta('\n🔮 Prabala v0.1.0\n'));

    // 1. Load base config
    let config: PrabalaConfig = loadProjectConfig(opts.config);

    // 2. Overlay env-specific config
    if (opts.env) config = loadEnvFile(opts.env, config);

    // 3. CLI flags override everything
    if (opts.headless)  config.headless = true;
    if (opts.browser)   config.browser = opts.browser as PrabalaConfig['browser'];
    if (opts.output)    config.outputDir = opts.output;
    if (opts.baseUrl)   config.baseUrl = opts.baseUrl;
    if (opts.screenshot && opts.screenshot !== 'never') {
      config.screenshotOnStep = opts.screenshot as PrabalaConfig['screenshotOnStep'];
    }
    if (opts.keywords) config.keywordsDir = opts.keywords;

    config.objectRepositoryDir = config.objectRepositoryDir ?? 'object-repository';
    config.testDataDir = config.testDataDir ?? 'test-data';
    const outputDir = config.outputDir ?? 'artifacts';

    console.log(chalk.gray(`  Pattern  : ${pattern}`));
    if (opts.env)    console.log(chalk.gray(`  Env      : ${opts.env}`));
    if (opts.tags)   console.log(chalk.gray(`  Tags     : ${opts.tags}`));
    console.log(chalk.gray(`  Reporter : ${opts.reporter}`));
    console.log(chalk.gray(`  Output   : ${outputDir}\n`));

    // 4. Resolve files + optional tag filter
    let files = await glob(pattern, { absolute: true });
    if (files.length === 0) {
      console.error(chalk.red(`  Error: No test files found matching: ${pattern}`));
      process.exit(2);
    }
    if (opts.tags) {
      const tags = opts.tags.split(',').filter(Boolean);
      files = await filterByTags(files, tags);
      if (files.length === 0) {
        console.warn(chalk.yellow(`  No tests matched tags: ${opts.tags}`));
        process.exit(0);
      }
      console.log(chalk.gray(`  Filtered : ${files.length} test(s) match tags\n`));
    }

    const orchestrator = new Orchestrator(config);

    try {
      // Run with filtered files by building a temp pattern from absolute paths
      const suite = await ((orchestrator as any).runFiles
        ? (orchestrator as any).runFiles(files)
        : orchestrator.runPattern(pattern));

      writeReports(suite, outputDir, opts.reporter);
      process.exit(suite.failed > 0 ? 1 : 0);
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
    const dirs = ['tests', 'object-repository', 'test-data', 'keywords', 'artifacts', 'components', 'env'];
    for (const dir of dirs) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(chalk.green(`  Created: ${dir}/`));
    }

    const configContent = `{
  "baseUrl": "https://example.com",
  "browser": "chromium",
  "headless": true,
  "timeout": 30000,
  "objectRepositoryDir": "object-repository",
  "testDataDir": "test-data",
  "outputDir": "artifacts"
}`;
    const configPath = 'prabala.config.json';
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, configContent);
      console.log(chalk.green(`  Created: ${configPath}`));
    }

    // Scaffold env files
    const envFiles: Record<string, string> = {
      'env/dev.yaml': `# Development environment\nbaseUrl: "https://dev.example.com"\nvars:\n  API_KEY: "dev-api-key"\n  DB_HOST: "localhost"\n`,
      'env/staging.yaml': `# Staging environment\nbaseUrl: "https://staging.example.com"\nvars:\n  API_KEY: "staging-api-key"\n  DB_HOST: "staging-db.example.com"\n`,
      'env/prod.yaml': `# Production environment (read-only tests only)\nbaseUrl: "https://www.example.com"\nvars:\n  API_KEY: "prod-api-key"\n  DB_HOST: "prod-db.example.com"\n`,
    };
    for (const [envPath, content] of Object.entries(envFiles)) {
      if (!fs.existsSync(envPath)) {
        fs.writeFileSync(envPath, content);
        console.log(chalk.green(`  Created: ${envPath}`));
      }
    }

    console.log(chalk.bold.magenta('\n  ✔ Prabala project initialised!\n'));
    console.log(chalk.gray('  Next steps:'));
    console.log(chalk.gray('    1. Add test cases in tests/'));
    console.log(chalk.gray('    2. Edit env/dev.yaml with your environment URLs'));
    console.log(chalk.gray('    3. Run: prabala run --env dev --reporter both\n'));
  });

// ── prabala generate-pipelines ───────────────────────────────────────────────
program
  .command('generate-pipelines')
  .description('Generate CI/CD pipeline files for all supported platforms')
  .option('--env <name>', 'Default environment for pipelines', 'staging')
  .option('--tags <tags>', 'Default tag filter', '')
  .option('--node <version>', 'Node.js version to use', '20')
  .action((opts: { env: string; tags: string; node: string }) => {
    const tagFlag  = opts.tags ? ` --tags "${opts.tags}"` : '';
    const runCmd   = `npx prabala run tests/**/*.yaml --env ${opts.env} --reporter both${tagFlag}`;

    const pipelines: Record<string, { file: string; content: string }> = {
      github: {
        file: '.github/workflows/prabala.yml',
        content: generateGitHubActions(runCmd, opts.node),
      },
      azure: {
        file: 'azure-pipelines.yml',
        content: generateAzureDevOps(runCmd, opts.node),
      },
      jenkins: {
        file: 'Jenkinsfile',
        content: generateJenkinsfile(runCmd, opts.node),
      },
      gitlab: {
        file: '.gitlab-ci.yml',
        content: generateGitLabCI(runCmd, opts.node),
      },
      docker: {
        file: 'Dockerfile',
        content: generateDockerfile(opts.node),
      },
    };

    for (const [name, { file, content }] of Object.entries(pipelines)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, 'utf-8');
      console.log(chalk.green(`  Created: ${file}`) + chalk.gray(` (${name})`));
    }

    console.log(chalk.bold.magenta('\n  ✔ Pipeline files generated!\n'));
    console.log(chalk.gray('  Commit these files to your repository to activate CI/CD.\n'));
  });

program.parse(process.argv);

// ── Pipeline template generators ─────────────────────────────────────────────

function generateGitHubActions(runCmd: string, node: string): string {
  return `# Prabala – GitHub Actions CI
name: Prabala Tests

on:
  push:
    branches: [main, master, develop]
  pull_request:
    branches: [main, master]
  workflow_dispatch:
    inputs:
      env:
        description: 'Environment (dev/staging/prod)'
        required: false
        default: 'staging'
      tags:
        description: 'Tag filter (comma-separated)'
        required: false

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 60

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '${node}'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Run Prabala tests
        run: ${runCmd}
        env:
          CI: 'true'

      - name: Publish JUnit Test Results
        uses: mikepenz/action-junit-report@v4
        if: always()
        with:
          report_paths: 'artifacts/junit-results.xml'
          check_name: 'Prabala Test Results'

      - name: Upload HTML Report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: prabala-report-\${{ github.run_number }}
          path: artifacts/
          retention-days: 30
`;
}

function generateAzureDevOps(runCmd: string, node: string): string {
  return `# Prabala – Azure DevOps Pipeline
trigger:
  branches:
    include:
      - main
      - master
      - develop

pr:
  branches:
    include:
      - main
      - master

pool:
  vmImage: ubuntu-latest

variables:
  NODE_VERSION: '${node}'

stages:
  - stage: Test
    displayName: 'Run Prabala Tests'
    jobs:
      - job: PrabalaTest
        displayName: 'Prabala Test Execution'
        timeoutInMinutes: 60
        steps:
          - task: NodeTool@0
            displayName: 'Install Node.js'
            inputs:
              versionSpec: '\$(NODE_VERSION)'

          - script: npm ci
            displayName: 'Install dependencies'

          - script: npx playwright install --with-deps chromium
            displayName: 'Install Playwright browsers'

          - script: ${runCmd}
            displayName: 'Run Prabala tests'
            env:
              CI: 'true'

          - task: PublishTestResults@2
            displayName: 'Publish JUnit Results'
            condition: always()
            inputs:
              testResultsFormat: JUnit
              testResultsFiles: 'artifacts/junit-results.xml'
              testRunTitle: 'Prabala Tests - \$(Build.BuildNumber)'
              failTaskOnFailedTests: true

          - task: PublishBuildArtifacts@1
            displayName: 'Upload HTML Report'
            condition: always()
            inputs:
              PathtoPublish: 'artifacts'
              ArtifactName: 'prabala-report'
`;
}

function generateJenkinsfile(runCmd: string, node: string): string {
  return `// Prabala – Jenkins Pipeline (Declarative)
pipeline {
    agent {
        docker {
            image 'mcr.microsoft.com/playwright:v1.44.0-jammy'
            args '--ipc=host'
        }
    }

    options {
        timeout(time: 60, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '30'))
    }

    environment {
        NODE_VERSION = '${node}'
        CI = 'true'
    }

    parameters {
        choice(name: 'ENV', choices: ['staging', 'dev', 'prod'], description: 'Target environment')
        string(name: 'TAGS', defaultValue: '', description: 'Tag filter (comma-separated)')
    }

    stages {
        stage('Install') {
            steps {
                sh 'node --version && npm --version'
                sh 'npm ci'
            }
        }

        stage('Test') {
            steps {
                sh '${runCmd}'
            }
            post {
                always {
                    junit 'artifacts/junit-results.xml'
                    publishHTML(target: [
                        allowMissing: true,
                        alwaysLinkToLastBuild: true,
                        keepAll: true,
                        reportDir: 'artifacts',
                        reportFiles: 'prabala-report.html',
                        reportName: 'Prabala HTML Report'
                    ])
                }
            }
        }
    }

    post {
        failure {
            echo 'Tests FAILED — check the report above'
        }
        success {
            echo 'All Prabala tests passed!'
        }
    }
}
`;
}

function generateGitLabCI(runCmd: string, node: string): string {
  return `# Prabala – GitLab CI/CD Pipeline
image: mcr.microsoft.com/playwright:v1.44.0-jammy

variables:
  NODE_VERSION: "${node}"
  CI: "true"

stages:
  - install
  - test
  - report

cache:
  key: \${CI_COMMIT_REF_SLUG}
  paths:
    - node_modules/

install:
  stage: install
  script:
    - npm ci
  artifacts:
    paths:
      - node_modules/
    expire_in: 1 hour

test:
  stage: test
  script:
    - ${runCmd}
  artifacts:
    when: always
    paths:
      - artifacts/
    expire_in: 30 days
    reports:
      junit: artifacts/junit-results.xml

pages:
  stage: report
  script:
    - mkdir -p public
    - cp artifacts/prabala-report.html public/index.html
  artifacts:
    paths:
      - public
  only:
    - main
    - master
`;
}

function generateDockerfile(node: string): string {
  return `# Prabala – Docker image for CI test execution
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /workspace

# Install Node.js ${node}
RUN curl -fsSL https://deb.nodesource.com/setup_${node}.x | bash - && \\
    apt-get install -y nodejs

# Copy package files and install deps
COPY package*.json ./
RUN npm ci

# Copy project files
COPY . .

# Default: run all tests in staging env with both reporters
CMD ["npx", "prabala", "run", "tests/**/*.yaml", "--env", "staging", "--reporter", "both", "--headless"]
`;
}

