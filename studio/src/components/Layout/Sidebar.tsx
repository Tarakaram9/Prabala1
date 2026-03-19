import { useAppStore, Page } from '../../store/appStore'
import {
  FlaskConical, Library, Database, Table2,
  PlayCircle, BarChart3, FolderOpen, Sparkles
} from 'lucide-react'

import { LucideIcon } from 'lucide-react'

interface NavItem {
  id: Page
  label: string
  icon: LucideIcon
  badge?: string
}

const navItems: NavItem[] = [
  { id: 'builder',  label: 'Test Builder',    icon: FlaskConical },
  { id: 'keywords', label: 'Keywords',         icon: Library },
  { id: 'objects',  label: 'Object Repository',icon: Database },
  { id: 'data',     label: 'Test Data',        icon: Table2 },
  { id: 'monitor',  label: 'Run Tests',        icon: PlayCircle },
  { id: 'report',   label: 'Reports',          icon: BarChart3 },
]

export default function Sidebar() {
  const activePage = useAppStore((s) => s.activePage)
  const setActivePage = useAppStore((s) => s.setActivePage)
  const projectDir = useAppStore((s) => s.projectDir)
  const setProjectDir = useAppStore((s) => s.setProjectDir)
  const runStatus = useAppStore((s) => s.run.status)

  async function handleOpenProject() {
    const ipc = (window as any).prabala
    if (!ipc) return
    const dir = await ipc.dialog.openFolder()
    if (dir) setProjectDir(dir)
  }

  const projectName = projectDir ? projectDir.split('/').pop() : 'No Project'

  return (
    <aside className="w-56 flex flex-col bg-surface-900 border-r border-surface-500 flex-shrink-0">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-surface-500">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0">
            <Sparkles size={16} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-white font-bold text-sm leading-tight">Prabala</p>
            <p className="text-slate-500 text-xs">Studio v0.1</p>
          </div>
        </div>
      </div>

      {/* Project selector */}
      <div className="px-3 py-2 border-b border-surface-500">
        <button
          onClick={handleOpenProject}
          className="w-full flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-surface-700 px-2 py-1.5 rounded-md transition-colors"
        >
          <FolderOpen size={13} />
          <span className="truncate font-mono">{projectName}</span>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = activePage === item.id
          const isRunning = item.id === 'monitor' && runStatus === 'running'

          return (
            <button
              key={item.id}
              onClick={() => setActivePage(item.id)}
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 text-left
                ${isActive
                  ? 'bg-brand-600/20 text-brand-300 border border-brand-600/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-surface-700'
                }
              `}
            >
              <Icon size={16} className={isActive ? 'text-brand-400' : ''} />
              <span className="flex-1">{item.label}</span>
              {isRunning && (
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              )}
            </button>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-surface-500">
        <p className="text-xs text-slate-600 leading-relaxed">
          Apache 2.0 &nbsp;·&nbsp; Open Source
        </p>
      </div>
    </aside>
  )
}
