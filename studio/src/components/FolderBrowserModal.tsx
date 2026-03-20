// ─────────────────────────────────────────────────────────────────────────────
// FolderBrowserModal — navigable filesystem folder picker
// Calls /api/fs/dir to list directories; pure React, no native dialog needed
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react'
import {
  Folder, FolderOpen, ChevronRight, ChevronLeft,
  Home, Check, X, Loader2, HardDrive, RefreshCw
} from 'lucide-react'
import api from '../lib/api'

interface DirEntry {
  name: string
  isDir: boolean
  path: string
}

interface Props {
  title?: string
  initialPath?: string
  onSelect: (path: string) => void
  onCancel: () => void
}

// Platform-aware home/root defaults
const DEFAULT_ROOTS: DirEntry[] = [
  { name: 'Home', isDir: true, path: '/Users/' + (typeof navigator !== 'undefined' ? '' : '') },
  { name: '/', isDir: true, path: '/' },
]

export default function FolderBrowserModal({ title = 'Select Folder', initialPath, onSelect, onCancel }: Props) {
  const [currentPath, setCurrentPath] = useState(initialPath ?? '')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inputPath, setInputPath] = useState(initialPath ?? '')
  const [editingPath, setEditingPath] = useState(false)

  const loadDir = useCallback(async (path: string) => {
    if (!path.trim()) return
    setLoading(true)
    setError(null)
    try {
      const all = await api.fs.readDir(path)
      // Show only directories, sorted alphabetically, hidden dirs last
      const dirs = all
        .filter(e => e.isDir)
        .sort((a, b) => {
          const aHidden = a.name.startsWith('.')
          const bHidden = b.name.startsWith('.')
          if (aHidden !== bHidden) return aHidden ? 1 : -1
          return a.name.localeCompare(b.name)
        })
      setEntries(dirs)
      setCurrentPath(path)
      setInputPath(path)
    } catch (err: any) {
      setError(err?.message ?? `Cannot read: ${path}`)
    } finally {
      setLoading(false)
    }
  }, [])

  // Bootstrap: detect home dir from server
  useEffect(() => {
    if (initialPath) {
      loadDir(initialPath)
    } else {
      // Ask server for the home/default path
      api.app.getPlatform().then(platform => {
        const home = platform === 'win32'
          ? 'C:\\Users'
          : '/Users'
        loadDir(home)
      }).catch(() => loadDir('/'))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Breadcrumb segments
  const segments = currentPath
    ? currentPath.replace(/\\/g, '/').split('/').filter(Boolean)
    : []

  function pathUpTo(idx: number) {
    const segs = segments.slice(0, idx + 1)
    return currentPath.startsWith('/') ? '/' + segs.join('/') : segs.join('/')
  }

  function goUp() {
    if (!currentPath) return
    const normalized = currentPath.replace(/\/+$/, '')
    const parent = normalized.substring(0, normalized.lastIndexOf('/')) || '/'
    loadDir(parent)
  }

  function handleInputSubmit() {
    setEditingPath(false)
    if (inputPath.trim()) loadDir(inputPath.trim())
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-surface-800 border border-surface-500/60 rounded-2xl shadow-2xl w-full max-w-xl flex flex-col"
           style={{ maxHeight: '80vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-600">
          <div className="flex items-center gap-2">
            <FolderOpen size={16} className="text-brand-400" />
            <span className="text-sm font-semibold text-slate-200">{title}</span>
          </div>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Path bar */}
        <div className="px-4 py-2.5 border-b border-surface-700 flex items-center gap-2">
          {/* Up button */}
          <button
            onClick={goUp}
            disabled={!currentPath || currentPath === '/'}
            className="p-1 rounded hover:bg-surface-600 disabled:opacity-30 text-slate-400 hover:text-slate-200 transition-colors flex-shrink-0"
            title="Go up"
          >
            <ChevronLeft size={14} />
          </button>

          {/* Breadcrumb / editable path */}
          {editingPath ? (
            <input
              autoFocus
              type="text"
              value={inputPath}
              onChange={e => setInputPath(e.target.value)}
              onBlur={handleInputSubmit}
              onKeyDown={e => {
                if (e.key === 'Enter') handleInputSubmit()
                if (e.key === 'Escape') { setEditingPath(false); setInputPath(currentPath) }
              }}
              className="flex-1 bg-surface-900 border border-brand-500/60 rounded px-2 py-0.5 text-xs font-mono text-slate-200 focus:outline-none"
            />
          ) : (
            <div
              className="flex-1 flex items-center gap-0.5 overflow-x-auto scrollbar-none cursor-text"
              onClick={() => setEditingPath(true)}
              title="Click to edit path"
            >
              <button
                onClick={e => { e.stopPropagation(); loadDir('/') }}
                className="flex-shrink-0 p-0.5 rounded hover:bg-surface-600 text-slate-400 hover:text-slate-200 transition-colors"
              >
                <Home size={12} />
              </button>
              {segments.map((seg, i) => (
                <div key={i} className="flex items-center gap-0.5 flex-shrink-0">
                  <ChevronRight size={10} className="text-slate-600" />
                  <button
                    onClick={e => { e.stopPropagation(); loadDir(pathUpTo(i)) }}
                    className="px-1 py-0.5 rounded text-xs text-slate-400 hover:text-slate-200 hover:bg-surface-600 transition-colors font-mono truncate max-w-[120px]"
                    title={seg}
                  >
                    {seg}
                  </button>
                </div>
              ))}
              {!currentPath && (
                <span className="text-xs text-slate-600 font-mono">Click to type a path</span>
              )}
            </div>
          )}

          <button
            onClick={() => loadDir(currentPath)}
            className="p-1 rounded hover:bg-surface-600 text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0"
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
        </div>

        {/* Directory listing */}
        <div className="flex-1 overflow-y-auto min-h-0 py-1">
          {loading && (
            <div className="flex items-center justify-center py-10 gap-2 text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-xs">Loading…</span>
            </div>
          )}
          {error && !loading && (
            <div className="px-5 py-4 text-xs text-red-400">{error}</div>
          )}
          {!loading && !error && entries.length === 0 && (
            <div className="px-5 py-8 text-xs text-slate-600 text-center">Empty folder</div>
          )}
          {!loading && !error && entries.map(entry => (
            <button
              key={entry.path}
              onDoubleClick={() => loadDir(entry.path)}
              onClick={() => { setCurrentPath(entry.path); setInputPath(entry.path) }}
              className={`w-full flex items-center gap-3 px-4 py-2 hover:bg-surface-700/60 transition-colors text-left group ${
                currentPath === entry.path ? 'bg-brand-900/30 border-l-2 border-brand-500' : ''
              }`}
            >
              <Folder size={14} className={currentPath === entry.path ? 'text-brand-400' : 'text-amber-500/70 group-hover:text-amber-400'} />
              <span className={`text-sm truncate ${
                entry.name.startsWith('.') ? 'text-slate-600' : 'text-slate-300'
              }`}>{entry.name}</span>
              <ChevronRight size={11} className="ml-auto text-slate-700 group-hover:text-slate-500 flex-shrink-0" />
            </button>
          ))}
        </div>

        {/* Selected path + actions */}
        <div className="px-4 py-3 border-t border-surface-600 space-y-2.5">
          <div className="flex items-center gap-2">
            <HardDrive size={12} className="text-slate-500 flex-shrink-0" />
            <span className="text-xs font-mono text-slate-400 truncate flex-1">{currentPath || '—'}</span>
          </div>
          <p className="text-[11px] text-slate-600">Double-click a folder to navigate into it. Single-click to select it.</p>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 py-2 text-xs font-medium text-slate-400 bg-surface-700 hover:bg-surface-600 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => currentPath && onSelect(currentPath)}
              disabled={!currentPath}
              className="flex-1 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center justify-center gap-1.5"
            >
              <Check size={13} /> Select Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
