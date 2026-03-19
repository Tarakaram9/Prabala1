import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import {
  BarChart3, CheckCircle2, XCircle, Clock, ExternalLink,
  ChevronDown, ChevronRight, RefreshCw, AlertCircle, Camera
} from 'lucide-react'

interface StepResult {
  keyword: string
  params?: Record<string, string>
  status: 'passed' | 'failed' | 'skipped'
  durationMs: number
  error?: string
  screenshot?: string
}

interface TestResult {
  testCase: string
  file: string
  status: 'passed' | 'failed' | 'skipped'
  durationMs: number
  steps: StepResult[]
}

interface SuiteResult {
  suite: string
  startTime: string
  finishedAt: string
  totalDurationMs: number
  passed: number
  failed: number
  total: number
  tests: TestResult[]
}

export default function ReportViewerPage() {
  const { projectDir } = useAppStore()
  const [suite, setSuite] = useState<SuiteResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const ipc = (window as any).prabala

  useEffect(() => { loadResults() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectDir])

  async function loadResults() {
    setLoading(true)
    setError(null)
    try {
      if (!ipc || !projectDir) {
        setSuite(getMockSuite())
        return
      }
      const resultsPath = `${projectDir}/artifacts/prabala-results.json`
      const exists = await ipc.fs.exists(resultsPath)
      if (!exists) { setSuite(null); setError('No results found. Run your tests first.'); return }
      const raw = await ipc.fs.readFile(resultsPath)
      setSuite(JSON.parse(raw) as SuiteResult)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load results')
    } finally {
      setLoading(false)
    }
  }

  function toggleExpand(name: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  async function openHtmlReport() {
    if (!ipc || !projectDir) { window.open('http://localhost:8787/prabala-report.html'); return }
    const htmlPath = `${projectDir}/artifacts/prabala-report.html`
    await ipc.shell.openPath(htmlPath)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full gap-3 text-slate-500">
      <RefreshCw size={18} className="animate-spin" /> Loading results…
    </div>
  )

  if (error && !suite) return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
      <AlertCircle size={36} className="opacity-40" />
      <p>{error}</p>
      <button onClick={loadResults} className="btn-secondary text-sm">Retry</button>
    </div>
  )

  if (!suite) return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
      <BarChart3 size={36} className="opacity-30" />
      <p>No results available.</p>
      <p className="text-xs">Run your tests from the Execution Monitor.</p>
    </div>
  )

  const passRate = suite.total > 0 ? Math.round((suite.passed / suite.total) * 100) : 0
  const durationSec = (suite.totalDurationMs / 1000).toFixed(1)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-surface-500 bg-surface-800 flex items-center gap-4">
        <div className="flex-1">
          <h2 className="text-base font-semibold text-slate-100">Test Results</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {suite.suite} · Ran at {new Date(suite.startTime).toLocaleString()}
          </p>
        </div>
        <button onClick={loadResults} className="btn-secondary flex items-center gap-2 text-xs py-2">
          <RefreshCw size={13} /> Reload
        </button>
        <button onClick={openHtmlReport} className="btn-primary flex items-center gap-2 text-xs py-2">
          <ExternalLink size={13} /> Full HTML Report
        </button>
      </div>

      {/* Summary cards */}
      <div className="flex-shrink-0 px-6 py-4 grid grid-cols-4 gap-4 border-b border-surface-500">
        <div className="card text-center">
          <p className="text-3xl font-bold text-slate-100">{suite.total}</p>
          <p className="text-xs text-slate-500 mt-1">Total Tests</p>
        </div>
        <div className={`card text-center ${suite.passed === suite.total ? 'border-green-700/40' : ''}`}>
          <p className="text-3xl font-bold text-green-400">{suite.passed}</p>
          <p className="text-xs text-slate-500 mt-1">Passed</p>
        </div>
        <div className={`card text-center ${suite.failed > 0 ? 'border-red-700/40' : ''}`}>
          <p className="text-3xl font-bold text-red-400">{suite.failed}</p>
          <p className="text-xs text-slate-500 mt-1">Failed</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-blue-300">{durationSec}s</p>
          <p className="text-xs text-slate-500 mt-1">Duration</p>
        </div>
      </div>

      {/* Pass rate bar */}
      <div className="flex-shrink-0 px-6 py-3 border-b border-surface-500">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-slate-500">Pass Rate</span>
          <span className={`text-xs font-bold ${passRate === 100 ? 'text-green-400' : passRate >= 75 ? 'text-yellow-400' : 'text-red-400'}`}>
            {passRate}%
          </span>
        </div>
        <div className="h-2 bg-surface-600 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${passRate === 100 ? 'bg-green-500' : passRate >= 75 ? 'bg-yellow-500' : 'bg-red-500'}`}
            style={{ width: `${passRate}%` }}
          />
        </div>
      </div>

      {/* Test list */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
        {suite.tests.map(test => (
          <div key={test.testCase} className="card overflow-hidden p-0">
            {/* Row */}
            <button
              onClick={() => toggleExpand(test.testCase)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-700/50 transition-colors text-left"
            >
              {expanded.has(test.testCase) ? <ChevronDown size={14} className="text-slate-500 flex-shrink-0" /> : <ChevronRight size={14} className="text-slate-500 flex-shrink-0" />}
              {test.status === 'passed'
                ? <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />
                : test.status === 'failed'
                ? <XCircle size={16} className="text-red-400 flex-shrink-0" />
                : <Clock size={16} className="text-slate-500 flex-shrink-0" />
              }
              <span className="flex-1 text-sm text-slate-200 font-medium">{test.testCase}</span>
              <span className="text-xs text-slate-500 font-mono">{(test.durationMs / 1000).toFixed(2)}s</span>
              <span className={`text-xs font-semibold ml-4 ${test.status === 'passed' ? 'text-green-400' : 'text-red-400'}`}>{test.status}</span>
            </button>

            {/* Steps expansion */}
            {expanded.has(test.testCase) && (
              <div className="border-t border-surface-600 bg-surface-900/40">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-600 border-b border-surface-700">
                      <th className="text-left pb-1.5 pt-2 pl-10 pr-4 font-normal">#</th>
                      <th className="text-left pb-1.5 pt-2 pr-4 font-normal">Keyword</th>
                      <th className="text-left pb-1.5 pt-2 pr-4 font-normal">Duration</th>
                      <th className="text-left pb-1.5 pt-2 pr-4 font-normal">Status</th>
                      <th className="text-left pb-1.5 pt-2 pr-4 font-normal">Error</th>
                      <th className="pb-1.5 pt-2 pr-4 font-normal"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {test.steps.map((step, idx) => (
                      <tr key={idx} className={`border-b border-surface-700/30 ${step.status === 'failed' ? 'bg-red-900/10' : ''}`}>
                        <td className="py-1.5 pl-10 pr-4 text-slate-600">{idx + 1}</td>
                        <td className="py-1.5 pr-4 font-mono text-brand-300">{step.keyword}</td>
                        <td className="py-1.5 pr-4 text-slate-500">{step.durationMs}ms</td>
                        <td className="py-1.5 pr-4">
                          <span className={step.status === 'passed' ? 'badge-passed' : step.status === 'failed' ? 'badge-failed' : 'text-slate-500'}>
                            {step.status}
                          </span>
                        </td>
                        <td className="py-1.5 pr-4 text-red-400 font-mono">{step.error ?? ''}</td>
                        <td className="py-1.5 pr-4">
                          {step.screenshot && (
                            <button
                              onClick={() => ipc?.shell.openPath(`${projectDir}/artifacts/${step.screenshot}`)}
                              title="Open screenshot"
                              className="p-1 rounded hover:bg-surface-600 text-slate-500 hover:text-brand-300"
                            >
                              <Camera size={11} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function getMockSuite(): SuiteResult {
  return {
    suite: 'Prabala Suite',
    startTime: new Date(Date.now() - 4210).toISOString(),
    finishedAt: new Date().toISOString(),
    totalDurationMs: 4210,
    passed: 2,
    failed: 0,
    total: 2,
    tests: [
      {
        testCase: 'Add a new todo item',
        file: 'tests/todo/add-todo.yaml',
        status: 'passed',
        durationMs: 2154,
        steps: [
          { keyword: 'Web.Launch', status: 'passed', durationMs: 1203 },
          { keyword: 'NavigateTo', status: 'passed', durationMs: 451 },
          { keyword: 'WaitForVisible', status: 'passed', durationMs: 38 },
          { keyword: 'EnterText', status: 'passed', durationMs: 88 },
          { keyword: 'PressKey', status: 'passed', durationMs: 21 },
          { keyword: 'AssertVisible', status: 'passed', durationMs: 12 },
          { keyword: 'AssertText', status: 'passed', durationMs: 14 },
          { keyword: 'TakeScreenshot', status: 'passed', durationMs: 67 },
          { keyword: 'Web.Close', status: 'passed', durationMs: 260 },
        ]
      },
      {
        testCase: 'Complete a todo and verify filter',
        file: 'tests/todo/complete-todo.yaml',
        status: 'passed',
        durationMs: 2056,
        steps: [
          { keyword: 'Web.Launch', status: 'passed', durationMs: 1100 },
          { keyword: 'NavigateTo', status: 'passed', durationMs: 430 },
          { keyword: 'EnterText', status: 'passed', durationMs: 80 },
          { keyword: 'PressKey', status: 'passed', durationMs: 20 },
          { keyword: 'EnterText', status: 'passed', durationMs: 70 },
          { keyword: 'PressKey', status: 'passed', durationMs: 19 },
          { keyword: 'Click', status: 'passed', durationMs: 55 },
          { keyword: 'Click', status: 'passed', durationMs: 42 },
          { keyword: 'AssertVisible', status: 'passed', durationMs: 15 },
          { keyword: 'TakeScreenshot', status: 'passed', durationMs: 65 },
          { keyword: 'Web.Close', status: 'passed', durationMs: 160 },
        ]
      }
    ]
  }
}
