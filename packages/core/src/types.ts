// ─────────────────────────────────────────────────────────────────────────────
// Prabala Core – Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

export interface TestStep {
  keyword: string;
  params?: Record<string, string | number | boolean>;
  description?: string;
  continueOnFailure?: boolean;
  /** Skip this step without failing the test */
  disabled?: boolean;
  /** Number of times to retry this step on failure (0 = no retry) */
  retries?: number;
}

export interface TestCase {
  testCase: string;
  tags?: string[];
  description?: string;
  steps: TestStep[];
  /** Path to a JSON/YAML file with an array of row objects — runs the test once per row */
  dataSource?: string;
  /** Per-test retry count (overrides config.retries) */
  retries?: number;
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
  /** How many retries were attempted before passing/failing */
  retryCount?: number;
}

export interface TestResult {
  testCase: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  steps: StepResult[];
  /** Data-driven: which row iteration this result belongs to (1-based) */
  iteration?: number;
  /** Total retries used at the test level */
  retryCount?: number;
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

/** Named environment profile — overrides root-level config fields when active */
export interface EnvProfile {
  baseUrl?: string;
  env?: Record<string, string>;
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  timeout?: number;
}

export interface ScheduledRun {
  id: string;
  pattern: string;
  cron: string;
  enabled: boolean;
  lastRun?: string;
  lastStatus?: 'passed' | 'failed';
}

export interface PrabalaConfig {
  baseUrl?: string;
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  timeout?: number;
  objectRepositoryDir?: string;
  testDataDir?: string;
  outputDir?: string;
  /** Run N tests in parallel (default 1 = serial) */
  parallel?: number;
  /** Number of times to retry a failed test (default 0) */
  retries?: number;
  screenshotOnStep?: 'always' | 'onFailure' | 'never';
  keywordsDir?: string;
  env?: Record<string, string>;
  /** Named environment profiles */
  profiles?: Record<string, EnvProfile>;
  /** Active profile name */
  activeProfile?: string;
  /** Directory to store visual regression baselines */
  visualBaselineDir?: string;
  /** AI-powered locator self-healing — set to enable */
  aiRepair?: AiRepairConfig;
}
