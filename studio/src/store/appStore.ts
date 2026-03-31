// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio – Global State Store (Zustand)
// ─────────────────────────────────────────────────────────────────────────────

import { create } from 'zustand'

export type Page = 'builder' | 'keywords' | 'objects' | 'data' | 'monitor' | 'report' | 'ai' | 'components' | 'pipeline' | 'dashboard' | 'gherkin' | 'custom-keywords' | 'scheduler' | 'requirements'

// ── Jira ─────────────────────────────────────────────────────────────────────
export interface JiraConfig {
  baseUrl: string    // e.g. mycompany.atlassian.net
  email: string
  apiToken: string
  projectKey: string
  jql: string        // custom JQL filter
}

export interface Requirement {
  id: string
  key: string        // e.g. PROJ-123 or 'manual-<uuid>'
  title: string
  description: string
  type: string       // Story | Bug | Epic | Task | Manual
  status: string
  source: 'jira' | 'manual' | 'import'
  url?: string
}

// ── Auth ─────────────────────────────────────────────────────────────────────
export interface AuthUser {
  username: string
}

// Hardcoded users (extend later with a proper backend)
const USERS: Record<string, string> = {
  admin: 'admin123',
}

// ── Workspace ────────────────────────────────────────────────────────────────
export interface Workspace {
  name: string
  path: string
}

export interface TestStep {
  id: string
  keyword: string
  params: Record<string, string>
  description?: string
  continueOnFailure?: boolean
  /** Skip this step without failing */
  disabled?: boolean
  /** Step-level retry count */
  retries?: number
}

export interface TestCase {
  id: string
  filePath: string
  testCase: string
  tags: string[]
  description?: string
  steps: TestStep[]
  isDirty: boolean
  /** Path to CSV/JSON data file for data-driven iteration */
  dataSource?: string
  /** Test-level retry count */
  retries?: number
}

export interface LocatorFallback {
  strategy: string
  locator: string
}

export interface ObjectEntry {
  key: string
  strategy: string
  locator: string
  description?: string
  page?: string
  /** Ordered fallback locators used by self-healing engine */
  fallbacks?: LocatorFallback[]
}

// Page definition metadata (URL, description per page)
export interface PageDef {
  name: string
  url?: string
  description?: string
}

// Reusable component (named step sequence with parameters)
export interface ComponentStep {
  keyword: string
  params: Record<string, string>
  description?: string
}

export interface ComponentDef {
  id: string
  name: string
  description?: string
  params: string[]            // parameter names, e.g. ['username','password']
  steps: ComponentStep[]
}

// CI/CD Pipeline settings
export interface PipelineSettings {
  platform: 'github' | 'azure' | 'jenkins' | 'gitlab'
  env: string           // dev | staging | prod
  tags: string          // comma-separated
  reporter: string      // html | junit | both
  nodeVersion: string
  runCmd: string        // custom run command override
}

export const DEFAULT_PIPELINE_SETTINGS: PipelineSettings = {
  platform: 'github',
  env: 'staging',
  tags: '',
  reporter: 'both',
  nodeVersion: '20',
  runCmd: '',
}

// Environment profiles
export interface EnvProfile {
  baseUrl?: string
  env?: Record<string, string>
  browser?: string
  headless?: boolean
  timeout?: number
}

// Scheduled run
export interface ScheduledRun {
  id: string
  name: string
  pattern: string
  cron: string
  enabled: boolean
  profile?: string
  lastRun?: string
  lastStatus?: 'passed' | 'failed'
}

export interface RunLog {
  ts: number
  type: 'stdout' | 'stderr' | 'system'
  text: string
}

export interface RunResult {
  status: 'idle' | 'running' | 'passed' | 'failed'
  logs: RunLog[]
  exitCode: number | null
  startedAt: number | null
  finishedAt: number | null
}

interface AppState {
  // Auth
  currentUser: AuthUser | null
  loginError: string | null
  login: (username: string, password: string) => boolean
  logout: () => void

  // Workspace
  workspace: Workspace | null
  recentWorkspaces: Workspace[]
  setWorkspace: (ws: Workspace) => void
  clearWorkspace: () => void

  // Project
  projectDir: string | null
  setProjectDir: (dir: string) => void

  // Navigation
  activePage: Page
  setActivePage: (page: Page) => void

  // Test cases
  testCases: TestCase[]
  setTestCases: (cases: TestCase[]) => void
  testFolders: string[]
  setTestFolders: (folders: string[]) => void
  activeTestCase: TestCase | null
  setActiveTestCase: (tc: TestCase | null) => void
  updateTestCase: (id: string, updates: Partial<TestCase>) => void

  // Object repository
  objects: ObjectEntry[]
  setObjects: (objs: ObjectEntry[]) => void

  // Page definitions (POM metadata)
  pageDefs: PageDef[]
  setPageDefs: (defs: PageDef[]) => void

  // Reusable components
  componentDefs: ComponentDef[]
  setComponentDefs: (defs: ComponentDef[]) => void

  // Keywords
  keywords: string[]
  setKeywords: (kws: string[]) => void

  // Runner
  run: RunResult
  setRunStatus: (status: RunResult['status']) => void
  appendLog: (log: RunLog) => void
  clearLogs: () => void
  setExitCode: (code: number) => void

  // Recording — appends a step to the active test case using fresh store state
  // (avoids stale-closure overwrite when steps arrive rapidly)
  appendStepToActive: (step: TestStep) => void

  // Mark a test case as cleanly saved (sets isDirty: false without the
  // isDirty:true override that updateTestCase applies)
  markSaved: (id: string) => void

  // Delete a test case from the store (does NOT delete from disk)
  deleteTestCase: (id: string) => void

  // Pipeline settings
  pipelineSettings: PipelineSettings
  setPipelineSettings: (s: Partial<PipelineSettings>) => void

  // Environment profiles
  envProfiles: Record<string, EnvProfile>
  activeProfile: string
  setEnvProfiles: (profiles: Record<string, EnvProfile>) => void
  setActiveProfile: (name: string) => void

  // Scheduled runs
  scheduledRuns: ScheduledRun[]
  setScheduledRuns: (runs: ScheduledRun[]) => void
  upsertScheduledRun: (run: ScheduledRun) => void
  deleteScheduledRun: (id: string) => void

  // Global search query
  globalSearch: string
  setGlobalSearch: (q: string) => void

  // Jira & Requirements
  jiraConfig: JiraConfig
  setJiraConfig: (cfg: Partial<JiraConfig>) => void
  requirements: Requirement[]
  setRequirements: (reqs: Requirement[]) => void
  upsertRequirements: (reqs: Requirement[]) => void
}

export const useAppStore = create<AppState>((set) => ({
  // Auth — always start logged out so Login page is shown on every launch
  currentUser: null,
  loginError: null,
  login: (username, password) => {
    if (USERS[username] && USERS[username] === password) {
      const user: AuthUser = { username }
      localStorage.setItem('prabala_user', JSON.stringify(user))
      localStorage.removeItem('prabala_workspace')
      set({ currentUser: user, loginError: null, workspace: null, projectDir: null })
      return true
    }
    set({ loginError: 'Invalid username or password' })
    return false
  },
  logout: () => {
    localStorage.removeItem('prabala_user')
    localStorage.removeItem('prabala_workspace')
    set({ currentUser: null, loginError: null, workspace: null, projectDir: null })
  },

  // Workspace — always start with no workspace so the picker is shown after login
  workspace: null,
  recentWorkspaces: (() => {
    try { const r = localStorage.getItem('prabala_recent_ws'); const p = r ? JSON.parse(r) : []; return Array.isArray(p) ? p : [] } catch { return [] }
  })(),
  setWorkspace: (ws) => {
    localStorage.setItem('prabala_workspace', JSON.stringify(ws))
    set((s) => {
      const recent = [ws, ...(Array.isArray(s.recentWorkspaces) ? s.recentWorkspaces : []).filter(r => r.path !== ws.path)].slice(0, 8)
      localStorage.setItem('prabala_recent_ws', JSON.stringify(recent))
      return { workspace: ws, recentWorkspaces: recent, projectDir: ws.path }
    })
  },
  clearWorkspace: () => {
    localStorage.removeItem('prabala_workspace')
    set({ workspace: null, projectDir: null })
  },

  projectDir: '/Users/ram/prabala',
  setProjectDir: (dir) => set({ projectDir: dir }),

  activePage: 'builder',
  setActivePage: (page) => set({ activePage: page }),

  testCases: [],
  setTestCases: (testCases) => set({ testCases }),
  testFolders: [],
  setTestFolders: (testFolders) => set({ testFolders }),
  activeTestCase: null,
  setActiveTestCase: (tc) => set({ activeTestCase: tc }),
  updateTestCase: (id, updates) =>
    set((s) => ({
      testCases: s.testCases.map((tc) =>
        tc.id === id ? { ...tc, ...updates, isDirty: true } : tc
      ),
      activeTestCase:
        s.activeTestCase?.id === id
          ? { ...s.activeTestCase, ...updates, isDirty: true }
          : s.activeTestCase,
    })),

  objects: [],
  setObjects: (objects) => set({ objects }),

  pageDefs: [],
  setPageDefs: (pageDefs) => set({ pageDefs }),

  componentDefs: [],
  setComponentDefs: (componentDefs) => set({ componentDefs }),

  keywords: [],
  setKeywords: (keywords) => set({ keywords }),

  run: { status: 'idle', logs: [], exitCode: null, startedAt: null, finishedAt: null },
  setRunStatus: (status) =>
    set((s) => ({
      run: {
        ...s.run,
        status,
        startedAt: status === 'running' ? Date.now() : s.run.startedAt,
        finishedAt: status !== 'running' && status !== 'idle' ? Date.now() : s.run.finishedAt,
      },
    })),
  appendLog: (log) =>
    set((s) => ({ run: { ...s.run, logs: [...s.run.logs, log] } })),
  clearLogs: () =>
    set((s) => ({ run: { ...s.run, logs: [], exitCode: null, startedAt: null, finishedAt: null } })),
  setExitCode: (code) =>
    set((s) => ({ run: { ...s.run, exitCode: code } })),

  appendStepToActive: (step) =>
    set((s) => {
      if (!s.activeTestCase) return s
      const updated = {
        ...s.activeTestCase,
        steps: [...s.activeTestCase.steps, step],
        isDirty: true,
      }
      return {
        activeTestCase: updated,
        testCases: s.testCases.map((tc) =>
          tc.id === updated.id ? updated : tc
        ),
      }
    }),

  markSaved: (id) =>
    set((s) => {
      const updated = s.testCases.map((tc) =>
        tc.id === id ? { ...tc, isDirty: false } : tc
      )
      return {
        testCases: updated,
        activeTestCase:
          s.activeTestCase?.id === id
            ? { ...s.activeTestCase, isDirty: false }
            : s.activeTestCase,
      }
    }),

  deleteTestCase: (id) =>
    set((s) => {
      const remaining = s.testCases.filter((tc) => tc.id !== id)
      return {
        testCases: remaining,
        activeTestCase:
          s.activeTestCase?.id === id
            ? (remaining[0] ?? null)
            : s.activeTestCase,
      }
    }),

  pipelineSettings: { ...DEFAULT_PIPELINE_SETTINGS },
  setPipelineSettings: (updates) =>
    set((s) => ({ pipelineSettings: { ...s.pipelineSettings, ...updates } })),

  envProfiles: { dev: {}, staging: {}, prod: {} },
  activeProfile: 'dev',
  setEnvProfiles: (envProfiles) => set({ envProfiles }),
  setActiveProfile: (activeProfile) => set({ activeProfile }),

  scheduledRuns: [],
  setScheduledRuns: (scheduledRuns) => set({ scheduledRuns }),
  upsertScheduledRun: (run) =>
    set((s) => ({
      scheduledRuns: s.scheduledRuns.some((r) => r.id === run.id)
        ? s.scheduledRuns.map((r) => (r.id === run.id ? run : r))
        : [...s.scheduledRuns, run],
    })),
  deleteScheduledRun: (id) =>
    set((s) => ({ scheduledRuns: s.scheduledRuns.filter((r) => r.id !== id) })),

  globalSearch: '',
  setGlobalSearch: (globalSearch) => set({ globalSearch }),

  jiraConfig: (() => {
    try { const s = localStorage.getItem('prabala_jira'); return s ? JSON.parse(s) : { baseUrl: '', email: '', apiToken: '', projectKey: '', jql: '' } } catch { return { baseUrl: '', email: '', apiToken: '', projectKey: '', jql: '' } }
  })(),
  setJiraConfig: (updates) =>
    set((s) => {
      const next = { ...s.jiraConfig, ...updates }
      localStorage.setItem('prabala_jira', JSON.stringify({ ...next, apiToken: '' })) // don't persist token
      return { jiraConfig: next }
    }),
  requirements: (() => {
    try { const s = localStorage.getItem('prabala_requirements'); const p = s ? JSON.parse(s) : []; return Array.isArray(p) ? p : [] } catch { return [] }
  })(),
  setRequirements: (requirements) => {
    localStorage.setItem('prabala_requirements', JSON.stringify(requirements))
    set({ requirements })
  },
  upsertRequirements: (incoming) =>
    set((s) => {
      const map = new Map(s.requirements.map(r => [r.key, r]))
      incoming.forEach(r => map.set(r.key, r))
      const next = Array.from(map.values())
      localStorage.setItem('prabala_requirements', JSON.stringify(next))
      return { requirements: next }
    }),
}))
