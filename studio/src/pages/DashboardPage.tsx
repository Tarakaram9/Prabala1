import { useEffect, useState, useMemo } from 'react'
import { BarChart3, TrendingUp, CheckCircle2, XCircle, SkipForward, Clock, RefreshCw, FolderOpen } from 'lucide-react'
import api from '../lib/api'

interface StepResult { keyword: string; status: string; durationMs: number; error?: string }
interface TestResult { testCase: string; status: string; durationMs: number; steps: StepResult[]; iteration?: number }
interface SuiteResult {
  suite: string; startTime: string; endTime: string; totalDurationMs: number
  passed: number; failed: number; skipped: number; tests: TestResult[]
}

export default function DashboardPage() {
  const [results, setResults] = useState<SuiteResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadResults() {
    setLoading(true); setError(null)
    try {
      const data = await api.results.get()
      setResults(data)
    } catch (e: any) {
      setError(e.message ?? 'Failed to load results')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadResults() }, [])

  const stats = useMemo(() => {
    if (!results) return null
    const total = results.tests.length
    const passRate = total > 0 ? Math.round((results.passed / total) * 100) : 0
    const avgDuration = total > 0 ? Math.round(results.tests.reduce((a, t) => a + t.durationMs, 0) / total) : 0
    const slowest = [...results.tests].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5)
    const fastest = [...results.tests].sort((a, b) => a.durationMs - b.durationMs).slice(0, 5)
    const failed = results.tests.filter((t) => t.status === 'failed')

    // Step distribution
    const keywordCounts: Record<string, number> = {}
    for (const t of results.tests) {
      for (const s of t.steps) {
        keywordCounts[s.keyword] = (keywordCounts[s.keyword] ?? 0) + 1
      }
    }
    const topKeywords = Object.entries(keywordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([kw, count]) => ({ kw, count }))

    return { total, passRate, avgDuration, slowest, fastest, failed, topKeywords }
  }, [results])

  const barMax = stats?.topKeywords[0]?.count ?? 1

  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface-800">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-surface-600 flex-shrink-0">
        <div className="flex items-center gap-3">
          <BarChart3 size={20} className="text-brand-400" />
          <div>
            <h1 className="text-white font-semibold text-base">Dashboard</h1>
            {results && (
              <p className="text-xs text-slate-500">
                {results.suite} · {new Date(results.startTime).toLocaleString()}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={loadResults}
          disabled={loading}
          className="btn-secondary text-xs flex items-center gap-1.5"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {error && (
          <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-4 text-sm text-red-300 flex items-center gap-2">
            <XCircle size={16} /> {error}
            <button onClick={loadResults} className="ml-auto underline text-red-400 text-xs">Retry</button>
          </div>
        )}

        {!results && !loading && !error && (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <FolderOpen size={40} className="mb-3 opacity-30" />
            <p className="text-sm">No test results found. Run some tests first.</p>
          </div>
        )}

        {stats && results && (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard label="Pass Rate" value={`${stats.passRate}%`} color={stats.passRate >= 80 ? 'green' : stats.passRate >= 50 ? 'yellow' : 'red'} icon={<TrendingUp size={18}/>} />
              <KpiCard label="Tests Run" value={String(stats.total)} color="blue" icon={<BarChart3 size={18}/>} />
              <KpiCard label="Avg Duration" value={`${stats.avgDuration}ms`} color="purple" icon={<Clock size={18}/>} />
              <KpiCard label="Failed" value={String(results.failed)} color={results.failed === 0 ? 'green' : 'red'} icon={<XCircle size={18}/>} />
            </div>

            {/* Pass/Fail bar */}
            <div className="bg-surface-700 border border-surface-600 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-slate-300 mb-3">Test Results Breakdown</h2>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs w-16 text-green-400 text-right">{results.passed} passed</span>
                <div className="flex-1 h-5 rounded-full bg-surface-600 overflow-hidden flex">
                  {results.passed > 0 && (
                    <div className="bg-green-500 h-full transition-all" style={{ width: `${(results.passed / stats.total) * 100}%` }} />
                  )}
                  {results.failed > 0 && (
                    <div className="bg-red-500 h-full transition-all" style={{ width: `${(results.failed / stats.total) * 100}%` }} />
                  )}
                  {results.skipped > 0 && (
                    <div className="bg-yellow-500 h-full transition-all" style={{ width: `${(results.skipped / stats.total) * 100}%` }} />
                  )}
                </div>
                <span className="text-xs w-16 text-red-400">{results.failed} failed</span>
              </div>
              <div className="flex gap-4 text-xs text-slate-500 mt-1 justify-center">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block"/>Passed</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block"/>Failed</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block"/>Skipped</span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Top keywords */}
              <div className="bg-surface-700 border border-surface-600 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-slate-300 mb-3">Most Used Keywords</h2>
                <div className="space-y-2">
                  {stats.topKeywords.map(({ kw, count }) => (
                    <div key={kw} className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 w-40 truncate">{kw}</span>
                      <div className="flex-1 h-2 rounded-full bg-surface-600 overflow-hidden">
                        <div className="bg-brand-500 h-full" style={{ width: `${(count / barMax) * 100}%` }} />
                      </div>
                      <span className="text-xs text-slate-500 w-8 text-right">{count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Slowest tests */}
              <div className="bg-surface-700 border border-surface-600 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                  <Clock size={14} className="text-yellow-400" /> Slowest Tests
                </h2>
                <div className="space-y-2">
                  {stats.slowest.map((t) => (
                    <div key={t.testCase} className="flex items-center justify-between">
                      <span className="text-xs text-slate-400 truncate flex-1 mr-2">{t.testCase}</span>
                      <span className={`text-xs font-mono ${t.durationMs > 5000 ? 'text-red-400' : 'text-slate-400'}`}>{t.durationMs}ms</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Failed test details */}
            {stats.failed.length > 0 && (
              <div className="bg-surface-700 border border-red-700/30 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-red-300 mb-3 flex items-center gap-2">
                  <XCircle size={14} /> Failed Tests
                </h2>
                <div className="space-y-3">
                  {stats.failed.map((t) => {
                    const failedStep = t.steps.find((s) => s.status === 'failed')
                    return (
                      <div key={t.testCase} className="bg-surface-800 rounded-lg p-3 border border-red-800/30">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-white">{t.testCase}</span>
                          <span className="text-xs text-slate-500">{t.durationMs}ms</span>
                        </div>
                        {failedStep && (
                          <p className="text-xs text-red-400 font-mono mt-1">
                            ✘ {failedStep.keyword}: {failedStep.error}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* All tests table */}
            <div className="bg-surface-700 border border-surface-600 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-slate-300 mb-3">All Tests</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-surface-600">
                      <th className="pb-2 text-left font-medium">Test Case</th>
                      <th className="pb-2 text-center font-medium w-20">Status</th>
                      <th className="pb-2 text-right font-medium w-20">Duration</th>
                      <th className="pb-2 text-right font-medium w-16">Steps</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-600">
                    {results.tests.map((t, i) => (
                      <tr key={i} className="hover:bg-surface-600/40">
                        <td className="py-2 text-slate-300 truncate max-w-xs">{t.testCase}{t.iteration ? ` [row ${t.iteration}]` : ''}</td>
                        <td className="py-2 text-center">
                          {t.status === 'passed' ? (
                            <span className="text-green-400 flex items-center justify-center gap-1"><CheckCircle2 size={11}/> passed</span>
                          ) : t.status === 'failed' ? (
                            <span className="text-red-400 flex items-center justify-center gap-1"><XCircle size={11}/> failed</span>
                          ) : (
                            <span className="text-yellow-400 flex items-center justify-center gap-1"><SkipForward size={11}/> skipped</span>
                          )}
                        </td>
                        <td className="py-2 text-right text-slate-400 font-mono">{t.durationMs}ms</td>
                        <td className="py-2 text-right text-slate-500">{t.steps.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function KpiCard({ label, value, color, icon }: { label: string; value: string; color: string; icon: React.ReactNode }) {
  const colorMap: Record<string, string> = {
    green: 'text-green-400 bg-green-500/10 border-green-700/30',
    red: 'text-red-400 bg-red-500/10 border-red-700/30',
    yellow: 'text-yellow-400 bg-yellow-500/10 border-yellow-700/30',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-700/30',
    purple: 'text-purple-400 bg-purple-500/10 border-purple-700/30',
  }
  return (
    <div className={`rounded-xl border p-4 ${colorMap[color] ?? colorMap.blue}`}>
      <div className="flex items-center justify-between mb-2 opacity-70">{icon}<span className="text-xs font-medium">{label}</span></div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  )
}
