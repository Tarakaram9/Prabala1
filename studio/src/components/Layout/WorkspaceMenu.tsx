import { useState, useRef, useEffect } from 'react'
import { useAppStore, Workspace } from '../../store/appStore'
import {
  FolderOpen, FolderPlus, ChevronDown, Check, Settings,
  Clock, ArrowLeftRight
} from 'lucide-react'
import api from '../../lib/api'

export default function WorkspaceMenu() {
  const { workspace, recentWorkspaces, setWorkspace, clearWorkspace } = useAppStore()
  const setProjectDir = useAppStore(s => s.setProjectDir)
  const [open, setOpen] = useState(false)
  const [creatingProject, setCreatingProject] = useState(false)
  const [projectName, setProjectName] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const ipc = api

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false); setCreatingProject(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  async function handleNewProject() {
    if (!workspace || !projectName.trim() || !ipc) return
    const safe = projectName.trim().replace(/\s+/g, '-').toLowerCase()
    const projectPath = `${workspace.path}/${safe}`
    await ipc.fs.mkdir(projectPath)
    await ipc.fs.writeFile(`${projectPath}/prabala.config.json`, JSON.stringify({
      name: projectName.trim(), version: '0.1', browser: 'chromium',
      outputDir: `${projectPath}/artifacts`,
    }, null, 2))
    await ipc.fs.mkdir(`${projectPath}/tests`)
    await ipc.fs.mkdir(`${projectPath}/test-data`)
    await ipc.fs.mkdir(`${projectPath}/objects`)
    setProjectDir(projectPath)
    setProjectName('')
    setCreatingProject(false)
    setOpen(false)
  }

  async function handleOpenProject() {
    if (!ipc) return
    const dir = await ipc.dialog.openFolder()
    if (dir) { setProjectDir(dir); setOpen(false) }
  }

  async function handleSwitchWorkspace() {
    clearWorkspace()
    setOpen(false)
  }

  function switchRecent(ws: Workspace) {
    setWorkspace(ws)
    setOpen(false)
  }

  const wsName = workspace?.name ?? 'No Workspace'
  const otherRecent = recentWorkspaces.filter(r => r.path !== workspace?.path)

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-slate-400 hover:text-slate-200 hover:bg-surface-700 transition-colors"
      >
        <FolderOpen size={13} className="text-brand-400 flex-shrink-0" />
        <span className="truncate flex-1 font-mono text-left">{wsName}</span>
        <ChevronDown size={11} className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-64 bg-surface-800 border border-surface-500/60 rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Current workspace heading */}
          <div className="px-3 py-2 border-b border-surface-600/50">
            <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Current Workspace</p>
            <p className="text-xs text-brand-300 font-mono truncate mt-0.5">{wsName}</p>
          </div>

          <div className="py-1">
            {/* New Project inside workspace */}
            <button
              onClick={() => setCreatingProject(c => !c)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-300 hover:text-slate-100 hover:bg-surface-700/60 transition-colors text-left"
            >
              <FolderPlus size={14} className="text-brand-400 flex-shrink-0" />
              New Project
            </button>

            {creatingProject && (
              <div className="mx-2 mb-2 p-2 rounded-lg bg-surface-700/50 border border-brand-700/30 space-y-2">
                <input
                  autoFocus
                  type="text"
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleNewProject()}
                  className="input text-xs w-full"
                  placeholder="Project name"
                />
                <button
                  onClick={handleNewProject}
                  disabled={!projectName.trim()}
                  className="btn-primary w-full text-xs py-1.5 flex items-center justify-center gap-1 disabled:opacity-40"
                >
                  <Check size={11} /> Create
                </button>
              </div>
            )}

            {/* Open existing project */}
            <button
              onClick={handleOpenProject}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-300 hover:text-slate-100 hover:bg-surface-700/60 transition-colors text-left"
            >
              <FolderOpen size={14} className="text-slate-400 flex-shrink-0" />
              Open Project…
            </button>

            {/* Workspace settings — future */}
            <button
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-500 hover:text-slate-300 hover:bg-surface-700/60 transition-colors text-left"
              title="Coming soon"
            >
              <Settings size={14} className="text-slate-600 flex-shrink-0" />
              Workspace Settings
              <span className="ml-auto text-[9px] text-slate-700 bg-surface-600 px-1.5 rounded">soon</span>
            </button>

            {/* Divider + Switch */}
            <div className="border-t border-surface-600/50 mt-1 pt-1">
              <button
                onClick={handleSwitchWorkspace}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-400 hover:text-amber-300 hover:bg-surface-700/60 transition-colors text-left"
              >
                <ArrowLeftRight size={14} className="flex-shrink-0" />
                Switch Workspace…
              </button>
            </div>

            {/* Recent other workspaces */}
            {otherRecent.length > 0 && (
              <>
                <div className="border-t border-surface-600/50 mt-1 pt-1 px-3 pb-0.5">
                  <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                    <Clock size={9} /> Recent Workspaces
                  </p>
                </div>
                {otherRecent.slice(0, 4).map(ws => (
                  <button
                    key={ws.path}
                    onClick={() => switchRecent(ws)}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-slate-500 hover:text-slate-200 hover:bg-surface-700/60 transition-colors text-left"
                  >
                    <FolderOpen size={12} className="flex-shrink-0 text-slate-600" />
                    <span className="truncate">{ws.name}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
