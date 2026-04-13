import { useState, useEffect } from 'react'
import { CalendarClock, Plus, Trash2, Play, Pause, CheckCircle2, XCircle, Clock, RefreshCw } from 'lucide-react'
import api from '../lib/api'
import { useAppStore, ScheduledRun } from '../store/appStore'

function uid() { return Math.random().toString(36).slice(2, 9) }

const CRON_PRESETS = [
  { label: 'Every minute',    cron: '* * * * *' },
  { label: 'Every 5 min',     cron: '*/5 * * * *' },
  { label: 'Every 15 min',    cron: '*/15 * * * *' },
  { label: 'Every hour',      cron: '0 * * * *' },
  { label: 'Every 6 hours',   cron: '0 */6 * * *' },
  { label: 'Daily 9 AM',      cron: '0 9 * * *' },
  { label: 'Daily midnight',  cron: '0 0 * * *' },
  { label: 'Mon–Fri 8 AM',    cron: '0 8 * * 1-5' },
  { label: 'Weekly Monday',   cron: '0 9 * * 1' },
]

function describeCron(cron: string): string {
  const preset = CRON_PRESETS.find((p) => p.cron === cron)
  if (preset) return preset.label
  return cron
}

function statusBadge(status?: string) {
  if (status === 'passed') return <span className="flex items-center gap-1 text-green-400 text-[10px]"><CheckCircle2 size={11} /> Passed</span>
  if (status === 'failed') return <span className="flex items-center gap-1 text-red-400 text-[10px]"><XCircle size={11} /> Failed</span>
  return <span className="text-slate-600 text-[10px]">Never run</span>
}

export default function SchedulerPage() {
  const { scheduledRuns, upsertScheduledRun, deleteScheduledRun, envProfiles, activeProfile } = useAppStore()
  const projectDir = useAppStore((s) => s.projectDir) ?? ''

  const [editing, setEditing] = useState<ScheduledRun | null>(null)
  const [fetching, setFetching] = useState(false)

  // Load from studio-server on mount
  useEffect(() => {
    async function load() {
      setFetching(true)
      try {
        const list = await api.schedules.list()
        if (Array.isArray(list)) list.forEach((r: ScheduledRun) => upsertScheduledRun(r))
      } catch { /* ignore — server may not be running yet */ }
      finally { setFetching(false) }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live-update lastRun/lastStatus when a scheduled job completes
  useEffect(() => {
    function onScheduleUpdated(payload: unknown) {
      const p = payload as { id: string; lastRun: string; lastStatus: string }
      if (p?.id) upsertScheduledRun({ id: p.id, lastRun: p.lastRun, lastStatus: p.lastStatus } as ScheduledRun)
    }
    api._wsOn?.('schedule:updated', onScheduleUpdated)
    return () => api._wsOff?.('schedule:updated', onScheduleUpdated)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openNew() {
    setEditing({ id: uid(), name: 'New Schedule', pattern: 'tests/**/*.yaml', cron: '0 9 * * *', enabled: true, profile: activeProfile })
  }

  function openEdit(run: ScheduledRun) {
    setEditing({ ...run })
  }

  async function saveEdit() {
    if (!editing) return
    const toSave = { ...editing, projectDir: editing.projectDir || projectDir }
    upsertScheduledRun(toSave)
    try { await api.schedules.upsert(toSave) } catch { /* ignore */ }
    setEditing(null)
  }

  async function toggleEnabled(run: ScheduledRun) {
    const updated = { ...run, enabled: !run.enabled, projectDir: run.projectDir || projectDir }
    upsertScheduledRun(updated)
    try { await api.schedules.upsert(updated) } catch { /* ignore */ }
  }

  async function remove(id: string) {
    deleteScheduledRun(id)
    try { await api.schedules.remove(id) } catch { /* ignore */ }
  }

  async function runNow(run: ScheduledRun) {
    try {
      await api.runner.run(run.pattern, projectDir)
    } catch { /* ignore */ }
  }

  return (
    <div className="h-full flex flex-col bg-surface-800 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-surface-600 flex-shrink-0">
        <div className="flex items-center gap-3">
          <CalendarClock size={18} className="text-brand-400" />
          <div>
            <h1 className="text-white font-bold text-base">Test Scheduler</h1>
            <p className="text-xs text-slate-500">Run tests automatically on a cron schedule</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {fetching && <RefreshCw size={13} className="text-slate-500 animate-spin" />}
          <button onClick={openNew} className="btn-primary text-xs flex items-center gap-1.5">
            <Plus size={13} /> Add Schedule
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 p-6">
        {scheduledRuns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <CalendarClock size={40} className="text-slate-700 mb-3" />
            <p className="text-slate-500 text-sm">No scheduled runs yet</p>
            <p className="text-xs text-slate-600 mt-1 mb-4">Automate your tests with cron expressions</p>
            <button onClick={openNew} className="btn-primary text-sm flex items-center gap-2">
              <Plus size={14} /> Add Schedule
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {scheduledRuns.map((run) => (
              <div key={run.id} className="bg-surface-700 border border-surface-600 rounded-xl px-4 py-3 flex items-center gap-4">
                {/* Enable toggle */}
                <button
                  onClick={() => toggleEnabled(run)}
                  title={run.enabled ? 'Disable' : 'Enable'}
                  className={`flex-shrink-0 p-1.5 rounded-lg border transition-colors ${run.enabled ? 'bg-green-900/30 border-green-700/50 text-green-400' : 'bg-surface-600 border-surface-500 text-slate-600'}`}>
                  {run.enabled ? <Play size={13} /> : <Pause size={13} />}
                </button>

                {/* Schedule info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white truncate">{run.name}</span>
                    {run.profile && (
                      <span className="text-[10px] bg-brand-900/40 text-brand-300 px-1.5 py-0.5 rounded font-mono">{run.profile}</span>
                    )}
                    {!run.projectDir && (
                      <span className="text-[10px] bg-yellow-900/30 text-yellow-400 border border-yellow-700/40 px-1.5 py-0.5 rounded" title="No project directory set — will use last opened project">⚠ No project dir</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-slate-500 font-mono">{run.pattern}</span>
                    <span className="text-xs text-slate-600">·</span>
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <Clock size={11} />
                      {describeCron(run.cron)}
                      <span className="font-mono text-slate-600 ml-1">({run.cron})</span>
                    </span>
                  </div>
                </div>

                {/* Last run */}
                <div className="flex-shrink-0 text-right">
                  {statusBadge(run.lastStatus)}
                  {run.lastRun && (
                    <div className="text-[10px] text-slate-600 mt-0.5">{new Date(run.lastRun).toLocaleString()}</div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => runNow(run)} title="Run now"
                    className="p-1.5 text-slate-500 hover:text-green-400 hover:bg-green-900/20 rounded transition-colors">
                    <Play size={13} />
                  </button>
                  <button onClick={() => openEdit(run)} title="Edit"
                    className="p-1.5 text-slate-500 hover:text-brand-400 hover:bg-brand-900/20 rounded transition-colors">
                    <CalendarClock size={13} />
                  </button>
                  <button onClick={() => remove(run.id)} title="Delete"
                    className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface-800 border border-surface-600 rounded-2xl shadow-2xl w-[480px] p-6 space-y-4">
            <h2 className="text-white font-bold text-base flex items-center gap-2">
              <CalendarClock size={16} className="text-brand-400" />
              {editing.id && scheduledRuns.find((r) => r.id === editing.id) ? 'Edit Schedule' : 'New Schedule'}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="label">Name</label>
                <input className="input w-full" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Nightly Smoke" />
              </div>
              <div>
                <label className="label">Test Pattern (glob)</label>
                <input className="input w-full font-mono text-sm" value={editing.pattern} onChange={(e) => setEditing({ ...editing, pattern: e.target.value })} placeholder="tests/**/*.yaml" />
              </div>
              <div>
                <label className="label mb-1">Cron Expression</label>
                <input className="input w-full font-mono text-sm" value={editing.cron} onChange={(e) => setEditing({ ...editing, cron: e.target.value })} placeholder="0 9 * * *" />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {CRON_PRESETS.map((p) => (
                    <button key={p.cron} onClick={() => setEditing({ ...editing, cron: p.cron })}
                      className={`text-[10px] px-2 py-1 rounded border transition-colors ${editing.cron === p.cron ? 'bg-brand-600/30 border-brand-500/50 text-brand-300' : 'border-surface-500 text-slate-500 hover:text-slate-300 hover:border-surface-400'}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">Environment Profile</label>
                <select className="input w-full" value={editing.profile ?? ''} onChange={(e) => setEditing({ ...editing, profile: e.target.value || undefined })}>
                  <option value="">Default</option>
                  {Object.keys(envProfiles).map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} className="accent-brand-500" />
                Enabled
              </label>
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={saveEdit} className="btn-primary flex-1">Save Schedule</button>
              <button onClick={() => setEditing(null)} className="flex-1 py-2 px-4 rounded-lg border border-surface-500 text-slate-400 hover:text-slate-200 hover:border-surface-400 text-sm transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
