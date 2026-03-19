// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio – Global State Store (Zustand)
// ─────────────────────────────────────────────────────────────────────────────

import { create } from 'zustand'

export type Page = 'builder' | 'keywords' | 'objects' | 'data' | 'monitor' | 'report' | 'ai'

export interface TestStep {
  id: string
  keyword: string
  params: Record<string, string>
  description?: string
  continueOnFailure?: boolean
}

export interface TestCase {
  id: string
  filePath: string
  testCase: string
  tags: string[]
  description?: string
  steps: TestStep[]
  isDirty: boolean
}

export interface ObjectEntry {
  key: string
  strategy: string
  locator: string
  description?: string
  page?: string
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
  // Project
  projectDir: string | null
  setProjectDir: (dir: string) => void

  // Navigation
  activePage: Page
  setActivePage: (page: Page) => void

  // Test cases
  testCases: TestCase[]
  setTestCases: (cases: TestCase[]) => void
  activeTestCase: TestCase | null
  setActiveTestCase: (tc: TestCase | null) => void
  updateTestCase: (id: string, updates: Partial<TestCase>) => void

  // Object repository
  objects: ObjectEntry[]
  setObjects: (objs: ObjectEntry[]) => void

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
}

export const useAppStore = create<AppState>((set) => ({
  projectDir: '/Users/ram/prabala',
  setProjectDir: (dir) => set({ projectDir: dir }),

  activePage: 'builder',
  setActivePage: (page) => set({ activePage: page }),

  testCases: [],
  setTestCases: (testCases) => set({ testCases }),
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
}))
