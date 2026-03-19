import { useAppStore, Page } from '../../store/appStore'
import {
  FlaskConical, Library, Database, Table2,
  PlayCircle, BarChart3, Sparkles, Brain, LogOut, User, Puzzle, GitBranch
} from 'lucide-react'
import { LucideIcon } from 'lucide-react'
import WorkspaceMenu from './WorkspaceMenu'

interface NavItem {
  id: Page
  label: string
  icon: LucideIcon
  badge?: string
}

const navItems: NavItem[] = [
  { id: 'builder',    label: 'Test Builder',    icon: FlaskConical },
  { id: 'keywords',   label: 'Keywords',         icon: Library },
  { id: 'objects',    label: 'Object Repository',icon: Database },
  { id: 'components', label: 'Components',       icon: Puzzle,   badge: 'POM' },
  { id: 'data',       label: 'Test Data',        icon: Table2 },
  { id: 'monitor',    label: 'Run Tests',        icon: PlayCircle },
  { id: 'report',     label: 'Reports',          icon: BarChart3 },
  { id: 'ai',         label: 'AI Co-Pilot',      icon: Brain,    badge: 'NEW' },
  { id: 'pipeline',   label: 'CI/CD Pipeline',   icon: GitBranch, badge: 'CI' },
]

export default function Sidebar() {
  const activePage = useAppStore((s) => s.activePage)
  const setActivePage = useAppStore((s) => s.setActivePage)
  const runStatus = useAppStore((s) => s.run.status)
  const currentUser = useAppStore((s) => s.currentUser)
  const logout = useAppStore((s) => s.logout)

  return (
    <aside className="w-56 flex flex-col bg-surface-900 border-r border-surface-500 flex-shrink-0">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-surface-500">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0">
            <Sparkles size={16} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-white font-bold text-sm leading-tight">Prabala Studio</p>
            <p className="text-slate-500 text-xs">v0.1</p>
          </div>
        </div>
      </div>

      {/* Workspace selector */}
      <div className="px-3 py-2 border-b border-surface-500">
        <WorkspaceMenu />
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
              {item.badge && !isRunning && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-brand-600/40 text-brand-300 leading-none">{item.badge}</span>
              )}
            </button>
          )
        })}
      </nav>

      {/* Footer — user info + logout */}
      <div className="px-3 py-3 border-t border-surface-500">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface-800/60">
          <div className="w-6 h-6 rounded-full bg-brand-600/40 flex items-center justify-center flex-shrink-0">
            <User size={12} className="text-brand-300" />
          </div>
          <span className="text-xs text-slate-400 flex-1 truncate font-medium">{currentUser?.username ?? 'guest'}</span>
          <button
            onClick={logout}
            title="Sign out"
            className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-surface-600 transition-colors flex-shrink-0"
          >
            <LogOut size={12} />
          </button>
        </div>
        <p className="text-xs text-slate-700 mt-2 px-1">Apache 2.0 · Open Source</p>
      </div>
    </aside>
  )
}
