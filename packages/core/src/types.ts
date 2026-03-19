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

export type LocatorStrategy = 'css' | 'xpath' | 'aria' | 'text' | 'id' | 'role' | 'label' | 'placeholder' | 'testId' | 'automationId' | 'name';

export interface LocatorFallback {
  strategy: LocatorStrategy;
  locator: string;
}

export interface ObjectEntry {
  strategy: LocatorStrategy;
  locator: string;
  description?: string;
  page?: string;
  /** Ordered list of fallback locators tried when primary fails */
  fallbacks?: LocatorFallback[];
  /** Set by the self-healing engine when a fallback wins — written back to repo */
  _healedStrategy?: LocatorStrategy;
  _healedLocator?: string;
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

export interface AiRepairConfig {
  /** Provider to use for LLM-based locator repair */
  provider: 'ollama' | 'openai' | 'anthropic';
  /** Model name — defaults: ollama=llama3, openai=gpt-4o-mini, anthropic=claude-haiku-3 */
  model?: string;
  /** API key (not needed for ollama) */
  apiKey?: string;
  /** Base URL — override for ollama (default: http://localhost:11434) or custom OpenAI proxy */
  baseUrl?: string;
  /** If true, write the healed locator back to the object repository YAML */
  autoUpdateRepo?: boolean;
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
  /** AI-powered locator self-healing — set to enable */
  aiRepair?: AiRepairConfig;
}
