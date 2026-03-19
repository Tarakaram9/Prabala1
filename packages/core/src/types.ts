// ─────────────────────────────────────────────────────────────────────────────
// Prabala Core – Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

export interface TestStep {
  keyword: string;
  params?: Record<string, string | number | boolean>;
  description?: string;
  continueOnFailure?: boolean;
}

export interface TestCase {
  testCase: string;
  tags?: string[];
  description?: string;
  steps: TestStep[];
}

export interface TestSuite {
  suite: string;
  description?: string;
  testCases: TestCase[];
}

export interface KeywordDefinition {
  name: string;
  description?: string;
  params: string[];
  execute: (params: Record<string, unknown>, context: ExecutionContext) => Promise<void>;
}

export interface ExecutionContext {
  variables: Record<string, unknown>;
  objectRepository: Record<string, ObjectEntry>;
  testData: Record<string, unknown>;
  artifacts: ArtifactStore;
  currentDriver?: string;
  driverInstances: Record<string, unknown>;
}

export interface ObjectEntry {
  strategy: 'css' | 'xpath' | 'aria' | 'text' | 'id' | 'automationId' | 'name';
  locator: string;
  description?: string;
  fallback?: Array<{ strategy: string; locator: string }>;
}

export interface ObjectRepository {
  objects: Record<string, ObjectEntry>;
}

export interface StepResult {
  keyword: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  error?: string;
  screenshot?: string;
}

export interface TestResult {
  testCase: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  steps: StepResult[];
}

export interface SuiteResult {
  suite: string;
  startTime: string;
  endTime: string;
  totalDurationMs: number;
  passed: number;
  failed: number;
  skipped: number;
  tests: TestResult[];
}

export interface ArtifactStore {
  outputDir: string;
  screenshots: string[];
  videos: string[];
  traces: string[];
}

export interface PrabalaConfig {
  baseUrl?: string;
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  timeout?: number;
  objectRepositoryDir?: string;
  testDataDir?: string;
  outputDir?: string;
  parallel?: number;
  retries?: number;
  screenshotOnStep?: 'always' | 'onFailure' | 'never';
  keywordsDir?: string;
  env?: Record<string, string>;
}
