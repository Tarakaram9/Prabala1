import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { loadProjectData } from '../utils/projectLoader'
import {
  Play, Square, RefreshCw, CheckCircle2, XCircle, Clock,
  Terminal, FileText, AlertCircle, Loader2,
  CheckSquare, Square as SquareIcon, Minus, Copy, ClipboardCheck
} from 'lucide-react'
import TestExplorer from '../components/TestExplorer'
import api from '../lib/api'

export default function ExecutionMonitorPage() {
  const { run, setRunStatus, appendLog, clearLogs, setExitCode, projectDir, testCases } = useAppStore()
  const logRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [headless, setHeadless] = useState(true)
  const [browser, setBrowser] = useState('chromium')
  const [screenshot, setScreenshot] = useState('onFailure')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rescanning, setRescanning] = useState(false)
  const [copied, setCopied] = useState<'all' | 'errors' | null>(null)

  function copyLogs(filter: 'all' | 'errors') {
    const lines = filter === 'errors'
      ? run.logs.filter(l => l.type === 'stderr' || l.text.includes('✘') || /\bFAIL\b/.test(l.text) || /Error/i.test(l.text))
      : run.logs
    navigator.clipboard.writeText(lines.map(l => l.text).join(''))
    setCopied(filter)
    setTimeout(() => setCopied(null), 2000)
  }

  // Auto-select all when test cases load/change
  useEffect(() => {
    setSelected(new Set(testCases.map(tc => tc.filePath)))
  }, [testCases])

  // Auto-scroll log
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [run.logs, autoScroll])

  // ── Selection helpers ──────────────────────────────────────────────────────
  const allSelected = testCases.length > 0 && selected.size === testCases.length
  const someSelected = selected.size > 0 && selected.size < testCases.length

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(testCases.map(tc => tc.filePath)))
  }

  function toggleOne(filePath: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(filePath) ? next.delete(filePath) : next.add(filePath)
      return next
    })
  }

  // ── Rescan project for test files ──────────────────────────────────────────
  async function rescan() {
    if (!projectDir) return
    setRescanning(true)
    try {
      await loadProjectData(projectDir)
    } finally {
      setRescanning(false)
    }
  }

  // ── Build the CLI pattern from the selected files ─────────────────────────
  function buildPattern(): string {
    const base = projectDir ?? ''
    const toRelative = (p: string) =>
      p.startsWith(base + '/') ? p.slice(base.length + 1) : p

    const files = testCases
      .filter(tc => selected.has(tc.filePath))
      .map(tc => toRelative(tc.filePath))

    if (files.length === 0) return 'tests/**/*.yaml'
    if (files.length === 1) return files[0]
    return `{${files.join(',')}}`
  }

  // ── Start run ──────────────────────────────────────────────────────────────
  async function startRun() {
    const ipc = api
    clearLogs()
    setRunStatus('running')

    const pattern = buildPattern()
    const extraArgs: string[] = [
      '--browser', browser,
      '--screenshot', screenshot,
      ...(headless ? ['--headless'] : []),
    ]

    if (!ipc) {
      // Demo mode
      const runCases = testCases.filter(tc => selected.has(tc.filePath))
      appendLog({ ts: Date.now(), type: 'system', text: `🔮 Prabala v0.1.0 — Demo Mode\n▶ Pattern : ${pattern}\n▶ Browser : ${browser}${headless ? ' (headless)' : ''}\n\n` })
      for (const tc of runCases) {
        appendLog({ ts: Date.now(), type: 'stdout', text: `  ▶ ${tc.testCase}\n` })
        await new Promise(r => setTimeout(r, 300))
        for (const step of tc.steps.slice(0, 3)) {
          appendLog({ ts: Date.now(), type: 'stdout', text: `    ✔ ${step.keyword} (${Math.floor(Math.random() * 800 + 50)}ms)\n` })
          await new Promise(r => setTimeout(r, 150))
        }
        appendLog({ ts: Date.now(), type: 'stdout', text: `  ✔ ${tc.testCase}\n\n` })
      }
      appendLog({ ts: Date.now(), type: 'stdout', text: `──────────────────────────────────────────\n  Passed  : ${runCases.length}\n  Failed  : 0\n  Status   : PASS\n──────────────────────────────────────────\n` })
      setRunStatus('passed')
      setExitCode(0)
      return
    }

    appendLog({ ts: Date.now(), type: 'system', text: `▶ Pattern : ${pattern}\n▶ Browser : ${browser}${headless ? ' (headless)' : ''}\n\n` })

    ipc.runner.removeAllListeners()
    ipc.runner.onStdout((line: string) => appendLog({ ts: Date.now(), type: 'stdout', text: line }))
    ipc.runner.onStderr((line: string) => appendLog({ ts: Date.now(), type: 'stderr', text: line }))
    ipc.runner.onDone((code: number) => {
      setExitCode(code)
      setRunStatus(code === 0 ? 'passed' : 'failed')
      appendLog({ ts: Date.now(), type: 'system', text: `\n⬥ Process exited with code ${code}\n` })
    })

    await ipc.runner.run(pattern, projectDir ?? '', extraArgs)
  }

  function stopRun() {
    const ipc = api
    ipc?.runner.stop()
    ipc?.runner.removeAllListeners()
    setRunStatus('idle')
    appendLog({ ts: Date.now(), type: 'system', text: '\n⏹ Run stopped by user\n' })
  }

  // ── Derived display ────────────────────────────────────────────────────────
  const duration = run.startedAt && run.finishedAt
    ? ((run.finishedAt - run.startedAt) / 1000).toFixed(1) + 's'
    : run.startedAt ? 'running…' : '—'

  const statusIcon = {
    idle:    <Clock size={16} className="text-slate-500" />,
    running: <RefreshCw size={16} className="text-blue-400 animate-spin" />,
    passed:  <CheckCircle2 size={16} className="text-green-400" />,
    failed:  <XCircle size={16} className="text-red-400" />,
  }[run.status]

  const statusBg = {
    idle: 'bg-surface-800', running: 'bg-blue-900/20',
    passed: 'bg-green-900/20', failed: 'bg-red-900/20',
  }[run.status]

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: Test Case Selector ────────────────────────────────── */}
      <div className="w-72 flex-shrink-0 flex flex-col border-r border-surface-500 bg-surface-800">

        <TestExplorer
          mode="monitor"
          projectDir={projectDir ?? ''}
          testCases={testCases}
          onRescan={rescan}
          rescanning={rescanning}
          selected={selected}
          onToggleTest={toggleOne}
          allSelected={allSelected}
          someSelected={someSelected}
          onToggleAll={toggleAll}
        />

        {/* Options */}
        <div className="flex-shrink-0 border-t border-surface-500 px-4 py-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-xs text-slate-400">Browser</label>
            <select
              className="input text-xs w-28 py-1"
              value={browser}
              onChange={e => setBrowser(e.target.value)}
            >
              <option value="chromium">Chromium</option>
              <option value="firefox">Firefox</option>
              <option value="webkit">WebKit</option>
            </select>
          </div>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs text-slate-400">Headless mode</span>
            <input
              type="checkbox"
              checked={headless}
              onChange={e => setHeadless(e.target.checked)}
              className="accent-brand-500 w-3.5 h-3.5"
            />
          </label>
          <div className="flex items-center justify-between">
            <label className="text-xs text-slate-400">Screenshots</label>
            <select
              className="input text-xs w-28 py-1"
              value={screenshot}
              onChange={e => setScreenshot(e.target.value)}
            >
              <option value="onFailure">On Failure</option>
              <option value="always">Every Step</option>
              <option value="never">Disabled</option>
            </select>
          </div>
        </div>

        {/* Run / Stop */}
        <div className="flex-shrink-0 px-4 py-3 border-t border-surface-500">
          {run.status !== 'running' ? (
            <button
              onClick={startRun}
              disabled={selected.size === 0}
              className="w-full btn-primary flex items-center justify-center gap-2 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Play size={13} />
              {selected.size === 0
                ? 'Select tests to run'
                : selected.size === testCases.length
                ? `Run All (${testCases.length})`
                : `Run Selected (${selected.size})`}
            </button>
          ) : (
            <button onClick={stopRun} className="w-full btn-danger flex items-center justify-center gap-2 py-2">
              <Square size={13} /> Stop Execution
            </button>
          )}
        </div>
      </div>

      {/* ── Right: Log output ───────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Status bar */}
        <div className={`flex-shrink-0 flex items-center gap-4 px-5 py-2.5 border-b border-surface-500 ${statusBg}`}>
          <div className="flex items-center gap-2">
            {statusIcon}
            <span className="text-sm font-semibold text-slate-200">
              {{ idle: 'Ready', running: 'Running…', passed: 'All Passed', failed: 'Tests Failed' }[run.status]}
            </span>
          </div>
          {run.status !== 'idle' && (
            <>
              <span className="text-xs text-slate-500">Duration: {duration}</span>
              {run.exitCode !== null && (
                <span className={`text-xs font-mono ${run.exitCode === 0 ? 'text-green-400' : 'text-red-400'}`}>
                  exit {run.exitCode}
                </span>
              )}
            </>
          )}
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={e => setAutoScroll(e.target.checked)}
                className="accent-brand-500"
              />
              Auto-scroll
            </label>
            <button
              onClick={clearLogs}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Clear
            </button>
            {run.logs.length > 0 && (
              <>
                <button
                  onClick={() => copyLogs('errors')}
                  className="text-xs text-slate-500 hover:text-red-400 transition-colors flex items-center gap-1"
                >
                  {copied === 'errors' ? <ClipboardCheck size={11} /> : <Copy size={11} />}
                  {copied === 'errors' ? 'Copied!' : 'Copy Errors'}
                </button>
                <button
                  onClick={() => copyLogs('all')}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
                >
                  {copied === 'all' ? <ClipboardCheck size={11} /> : <Copy size={11} />}
                  {copied === 'all' ? 'Copied!' : 'Copy All'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Terminal */}
        <div
          ref={logRef}
          className="flex-1 overflow-y-auto bg-surface-900 px-5 py-4 font-mono text-xs leading-relaxed select-text"
        >
          {run.logs.length === 0 && run.status === 'idle' ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3">
              <Terminal size={36} className="text-slate-700" />
              <div>
                <p className="text-slate-500 text-sm">Select tests and click Run</p>
                <p className="text-slate-600 text-xs mt-1">
                  {testCases.length > 0
                    ? `${testCases.length} test case${testCases.length !== 1 ? 's' : ''} available`
                    : 'No test cases loaded — save a test in Test Builder first'}
                </p>
              </div>
              {testCases.some(tc => tc.isDirty) && (
                <div className="flex items-center gap-1.5 text-xs text-yellow-500/70 bg-yellow-900/20 px-3 py-1.5 rounded-lg border border-yellow-700/30">
                  <AlertCircle size={12} />
                  Some tests have unsaved changes — save them before running
                </div>
              )}
            </div>
          ) : (
            <>
              {run.logs.map((log, i) => (
                <span
                  key={i}
                  className={
                    log.type === 'stderr'       ? 'text-red-400' :
                    log.type === 'system'       ? 'text-brand-400' :
                    log.text.includes('✔')     ? 'text-green-400' :
                    log.text.includes('✘')     ? 'text-red-400' :
                    log.text.includes('▶')     ? 'text-blue-300 font-semibold' :
                    /\bPASS\b/.test(log.text)  ? 'text-green-300 font-bold' :
                    /\bFAIL\b/.test(log.text)  ? 'text-red-300 font-bold' :
                    log.text.includes('──')    ? 'text-slate-600' :
                    'text-slate-400'
                  }
                >
                  {log.text}
                </span>
              ))}
              {run.status === 'running' && (
                <span className="inline-flex items-center gap-1 text-blue-400">
                  <span className="animate-pulse">▌</span>
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
