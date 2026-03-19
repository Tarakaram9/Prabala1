import { useState } from 'react'
import { useAppStore, Workspace } from '../store/appStore'
import {
  Sparkles, FolderOpen, FolderPlus, Clock, ChevronRight,
  ArrowRight, LogOut
} from 'lucide-react'

export default function WorkspacePage() {
  const { setWorkspace, recentWorkspaces, currentUser, logout } = useAppStore()
  const [creating, setCreating] = useState(false)
  const [wsName, setWsName] = useState('')
  const ipc = (window as any).prabala

  async function handleOpenFolder() {
    if (!ipc) return
    const dir = await ipc.dialog.openFolder()
    if (!dir) return
    const name = dir.split('/').pop() ?? dir
    const ws: Workspace = { name, path: dir }
    setWorkspace(ws)
  }

  async function handleCreateWorkspace() {
    if (!ipc || !wsName.trim()) return
    const dir = await ipc.dialog.openFolder()
    if (!dir) return
    const name = wsName.trim()
    const path = `${dir}/${name.replace(/\s+/g, '-').toLowerCase()}`
    // Create the workspace directory
    await ipc.fs.mkdir(path)
    // Create a default prabala.config.json
    await ipc.fs.writeFile(`${path}/prabala.config.json`, JSON.stringify({
      name,
      version: '0.1',
      browser: 'chromium',
      outputDir: `${path}/artifacts`,
    }, null, 2))
    // Create default sub-folders
    await ipc.fs.mkdir(`${path}/tests`)
    await ipc.fs.mkdir(`${path}/test-data`)
    await ipc.fs.mkdir(`${path}/objects`)
    await ipc.fs.mkdir(`${path}/object-repository`)
    await ipc.fs.mkdir(`${path}/components`)
    setWorkspace({ name, path })
  }

  function openRecent(ws: Workspace) {
    setWorkspace(ws)
  }

  return (
    <div className="min-h-screen bg-surface-900 flex items-center justify-center relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-brand-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/3 w-80 h-80 bg-brand-500/8 rounded-full blur-3xl" />
        <svg className="absolute inset-0 w-full h-full opacity-[0.03]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="1"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      <div className="relative z-10 w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shadow-brand-900/50">
              <Sparkles size={18} className="text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-base leading-tight">Prabala Studio</p>
              <p className="text-slate-500 text-xs">Welcome, {currentUser?.username}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 transition-colors"
          >
            <LogOut size={13} />
            Sign out
          </button>
        </div>

        <div className="bg-surface-800/80 border border-surface-500/60 rounded-2xl p-8 shadow-2xl backdrop-blur-sm">
          <h2 className="text-xl font-bold text-white mb-1">Select a Workspace</h2>
          <p className="text-sm text-slate-500 mb-6">A workspace is a root folder containing your test projects</p>

          {/* Two primary actions */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            {/* Open existing */}
            <button
              onClick={handleOpenFolder}
              className="flex flex-col items-center gap-3 p-5 rounded-xl border border-surface-500/60 bg-surface-700/40 hover:bg-surface-700/80 hover:border-brand-600/50 transition-all text-center group"
            >
              <div className="w-10 h-10 rounded-lg bg-brand-600/20 flex items-center justify-center group-hover:bg-brand-600/40 transition-colors">
                <FolderOpen size={20} className="text-brand-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-200">Open Folder</p>
                <p className="text-xs text-slate-600 mt-0.5">Browse to an existing workspace</p>
              </div>
            </button>

            {/* Create new */}
            <button
              onClick={() => setCreating(c => !c)}
              className={`flex flex-col items-center gap-3 p-5 rounded-xl border transition-all text-center group ${
                creating
                  ? 'border-brand-500/60 bg-brand-900/30'
                  : 'border-surface-500/60 bg-surface-700/40 hover:bg-surface-700/80 hover:border-brand-600/50'
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                creating ? 'bg-brand-600/40' : 'bg-brand-600/20 group-hover:bg-brand-600/40'
              }`}>
                <FolderPlus size={20} className="text-brand-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-200">New Workspace</p>
                <p className="text-xs text-slate-600 mt-0.5">Create a fresh project folder</p>
              </div>
            </button>
          </div>

          {/* Create new form */}
          {creating && (
            <div className="mb-5 p-4 rounded-xl bg-surface-700/50 border border-brand-700/40 space-y-3">
              <p className="text-xs font-semibold text-brand-300 uppercase tracking-wider">New Workspace</p>
              <input
                autoFocus
                type="text"
                value={wsName}
                onChange={e => setWsName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateWorkspace()}
                className="input w-full text-sm"
                placeholder="Workspace name (e.g. my-project)"
              />
              <p className="text-xs text-slate-600">You'll then choose a parent directory — the workspace folder will be created inside it.</p>
              <button
                onClick={handleCreateWorkspace}
                disabled={!wsName.trim()}
                className="btn-primary w-full flex items-center justify-center gap-2 text-sm py-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ArrowRight size={14} /> Create &amp; Open
              </button>
            </div>
          )}

          {/* Recent workspaces */}
          {recentWorkspaces.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Clock size={11} /> Recent
              </p>
              <div className="space-y-1">
                {recentWorkspaces.map(ws => (
                  <button
                    key={ws.path}
                    onClick={() => openRecent(ws)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-700/60 border border-transparent hover:border-surface-500/40 transition-all text-left group"
                  >
                    <FolderOpen size={14} className="text-brand-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-300 font-medium truncate">{ws.name}</p>
                      <p className="text-xs text-slate-600 font-mono truncate">{ws.path}</p>
                    </div>
                    <ChevronRight size={13} className="text-slate-700 group-hover:text-slate-400 flex-shrink-0 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-700 mt-5">
          Prabala Studio v0.1 · Apache 2.0 · Open Source
        </p>
      </div>
    </div>
  )
}
