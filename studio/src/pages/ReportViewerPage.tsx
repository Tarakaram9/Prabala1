import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import {
  BarChart3, CheckCircle2, XCircle, Clock, ExternalLink,
  ChevronDown, ChevronRight, RefreshCw, AlertCircle
} from 'lucide-react'

interface StepResult {
  step: number
  keyword: string
  params?: Record<string, string>
  status: 'PASS' | 'FAIL' | 'SKIP'
  durationMs: number
  error?: string
}

interface TestResult {
  name: string
  file: string
  status: 'PASS' | 'FAIL' | 'SKIP'
  durationMs: number
  steps: StepResult[]
}

interface SuiteResult {
  suiteName: string
  startedAt: string
  finishedAt: string
  durationMs: number
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
  const durationSec = (suite.durationMs / 1000).toFixed(1)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-surface-500 bg-surface-800 flex items-center gap-4">
        <div className="flex-1">
          <h2 className="text-base font-semibold text-slate-100">Test Results</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {suite.suiteName} · Ran at {new Date(suite.startedAt).toLocaleString()}
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
          <div key={test.name} className="card overflow-hidden p-0">
            {/* Row */}
            <button
              onClick={() => toggleExpand(test.name)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-700/50 transition-colors text-left"
            >
              {expanded.has(test.name) ? <ChevronDown size={14} className="text-slate-500 flex-shrink-0" /> : <ChevronRight size={14} className="text-slate-500 flex-shrink-0" />}
              {test.status === 'PASS'
                ? <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />
                : test.status === 'FAIL'
                ? <XCircle size={16} className="text-red-400 flex-shrink-0" />
                : <Clock size={16} className="text-slate-500 flex-shrink-0" />
              }
              <span className="flex-1 text-sm text-slate-200 font-medium">{test.name}</span>
              <span className="text-xs text-slate-500 font-mono">{(test.durationMs / 1000).toFixed(2)}s</span>
              <span className={`text-xs font-semibold ml-4 ${test.status === 'PASS' ? 'text-green-400' : 'text-red-400'}`}>{test.status}</span>
            </button>

            {/* Steps expansion */}
            {expanded.has(test.name) && (
              <div className="border-t border-surface-600 bg-surface-900/40">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-600 border-b border-surface-700">
                      <th className="text-left pb-1.5 pt-2 pl-10 pr-4 font-normal">#</th>
                      <th className="text-left pb-1.5 pt-2 pr-4 font-normal">Keyword</th>
                      <th className="text-left pb-1.5 pt-2 pr-4 font-normal">Duration</th>
                      <th className="text-left pb-1.5 pt-2 pr-4 font-normal">Status</th>
                      <th className="text-left pb-1.5 pt-2 pr-4 font-normal">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {test.steps.map(step => (
                      <tr key={step.step} className={`border-b border-surface-700/30 ${step.status === 'FAIL' ? 'bg-red-900/10' : ''}`}>
                        <td className="py-1.5 pl-10 pr-4 text-slate-600">{step.step}</td>
                        <td className="py-1.5 pr-4 font-mono text-brand-300">{step.keyword}</td>
                        <td className="py-1.5 pr-4 text-slate-500">{step.durationMs}ms</td>
                        <td className="py-1.5 pr-4">
                          <span className={step.status === 'PASS' ? 'badge-passed' : step.status === 'FAIL' ? 'badge-failed' : 'text-slate-500'}>
                            {step.status}
                          </span>
                        </td>
                        <td className="py-1.5 pr-4 text-red-400 font-mono">{step.error ?? ''}</td>
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
    suiteName: 'Prabala Suite',
    startedAt: new Date(Date.now() - 4210).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 4210,
    passed: 2,
    failed: 0,
    total: 2,
    tests: [
      {
        name: 'Add a new todo item',
        file: 'tests/todo/add-todo.yaml',
        status: 'PASS',
        durationMs: 2154,
        steps: [
          { step: 1, keyword: 'Web.Launch', status: 'PASS', durationMs: 1203 },
          { step: 2, keyword: 'NavigateTo', status: 'PASS', durationMs: 451 },
          { step: 3, keyword: 'WaitForVisible', status: 'PASS', durationMs: 38 },
          { step: 4, keyword: 'EnterText', status: 'PASS', durationMs: 88 },
          { step: 5, keyword: 'PressKey', status: 'PASS', durationMs: 21 },
          { step: 6, keyword: 'AssertVisible', status: 'PASS', durationMs: 12 },
          { step: 7, keyword: 'AssertText', status: 'PASS', durationMs: 14 },
          { step: 8, keyword: 'TakeScreenshot', status: 'PASS', durationMs: 67 },
          { step: 9, keyword: 'Web.Close', status: 'PASS', durationMs: 260 },
        ]
      },
      {
        name: 'Complete a todo and verify filter',
        file: 'tests/todo/complete-todo.yaml',
        status: 'PASS',
        durationMs: 2056,
        steps: [
          { step: 1, keyword: 'Web.Launch', status: 'PASS', durationMs: 1100 },
          { step: 2, keyword: 'NavigateTo', status: 'PASS', durationMs: 430 },
          { step: 3, keyword: 'EnterText', status: 'PASS', durationMs: 80 },
          { step: 4, keyword: 'PressKey', status: 'PASS', durationMs: 20 },
          { step: 5, keyword: 'EnterText', status: 'PASS', durationMs: 70 },
          { step: 6, keyword: 'PressKey', status: 'PASS', durationMs: 19 },
          { step: 7, keyword: 'Click', status: 'PASS', durationMs: 55 },
          { step: 8, keyword: 'Click', status: 'PASS', durationMs: 42 },
          { step: 9, keyword: 'AssertVisible', status: 'PASS', durationMs: 15 },
          { step: 10, keyword: 'TakeScreenshot', status: 'PASS', durationMs: 65 },
          { step: 11, keyword: 'Web.Close', status: 'PASS', durationMs: 160 },
        ]
      }
    ]
  }
}
