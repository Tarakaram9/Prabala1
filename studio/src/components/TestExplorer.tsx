// ─────────────────────────────────────────────────────────────────────────────
// TestExplorer – professional folder‑tree component
// Used in both TestBuilderPage (builder mode) and ExecutionMonitorPage (monitor mode)
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from 'react'
import { TestCase } from '../store/appStore'
import {
  Folder, FolderOpen, FileText, Plus, Trash2, Edit2, FolderPlus,
  RefreshCw, Loader2, ChevronRight, ChevronDown,
  CheckSquare, Square as SquareIcon, Minus, GripVertical, MoveRight,
} from 'lucide-react'

// ── Folder tree data structure ────────────────────────────────────────────────
export interface FolderNode {
  name: string
  path: string          // absolute directory path
  children: FolderNode[]
  tests: TestCase[]
}

/** Build a tree from a flat testCases array, rooted at testsRoot */
export function buildTree(testCases: TestCase[], testsRoot: string): FolderNode {
  const root: FolderNode = { name: 'tests', path: testsRoot, children: [], tests: [] }
  const map = new Map<string, FolderNode>([[testsRoot, root]])

  function getNode(dirPath: string): FolderNode {
    if (map.has(dirPath)) return map.get(dirPath)!
    // Clamp: parent must be inside testsRoot
    const parentPath = dirPath.substring(0, dirPath.lastIndexOf('/'))
    const parent = getNode(parentPath >= testsRoot ? parentPath : testsRoot)
    const node: FolderNode = { name: dirPath.split('/').pop()!, path: dirPath, children: [], tests: [] }
    map.set(dirPath, node)
    parent.children.push(node)
    return node
  }

  for (const tc of testCases) {
    const dir = tc.filePath.substring(0, tc.filePath.lastIndexOf('/'))
    getNode(dir).tests.push(tc)
  }

  // Sort children and tests alphabetically
  function sort(n: FolderNode): FolderNode {
    return {
      ...n,
      children: n.children.map(sort).sort((a, b) => a.name.localeCompare(b.name)),
      tests: [...n.tests].sort((a, b) => a.testCase.localeCompare(b.testCase)),
    }
  }
  return sort(root)
}

/** Return all folder paths in a tree (flat list, for "move to" menus) */
export function allFolderPaths(node: FolderNode): string[] {
  return [node.path, ...node.children.flatMap(allFolderPaths)]
}

// ── Context menu ──────────────────────────────────────────────────────────────
type MenuTarget =
  | { type: 'folder'; node: FolderNode }
  | { type: 'test'; tc: TestCase }

interface CtxMenu { x: number; y: number; target: MenuTarget }

// ── Component props ───────────────────────────────────────────────────────────
export type ExplorerMode = 'builder' | 'monitor'

interface BaseProps {
  mode: ExplorerMode
  projectDir: string
  testCases: TestCase[]
  onRescan: () => Promise<void>
  rescanning?: boolean
}

interface BuilderProps extends BaseProps {
  mode: 'builder'
  activeId?: string
  onSelectTest: (tc: TestCase) => void
  onCreateTest: (folderPath: string) => void
  onTestDeleted: (id: string) => void
}

interface MonitorProps extends BaseProps {
  mode: 'monitor'
  selected: Set<string>
  onToggleTest: (filePath: string) => void
  allSelected: boolean
  someSelected: boolean
  onToggleAll: () => void
}

type TestExplorerProps = BuilderProps | MonitorProps

// ── Main component ────────────────────────────────────────────────────────────
export default function TestExplorer(props: TestExplorerProps) {
  const { projectDir, testCases, onRescan, rescanning } = props
  const ipc = (window as any).prabala

  const testsRoot = `${projectDir}/tests`
  const tree = buildTree(testCases, testsRoot)
  const allPaths = allFolderPaths(tree)

  // State
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const [renaming, setRenaming] = useState<{ path: string; type: 'folder' | 'test'; current: string } | null>(null)
  const [creating, setCreating] = useState<{ parentPath: string} | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [dragTc, setDragTc] = useState<TestCase | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showMoveMenu, setShowMoveMenu] = useState(false)

  const ctxRef = useRef<HTMLDivElement>(null)
  const renameRef = useRef<HTMLInputElement>(null)
  const createRef = useRef<HTMLInputElement>(null)

  // Close context menu on outside click
  useEffect(() => {
    if (!ctx) return
    const handler = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) {
        setCtx(null)
        setShowMoveMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ctx])

  // Focus rename input when it appears
  useEffect(() => { if (renaming) setTimeout(() => renameRef.current?.select(), 50) }, [renaming])

  // ── Tree helpers ─────────────────────────────────────────────────────────────
  const toggleCollapse = (path: string) =>
    setCollapsed(s => { const n = new Set(s); n.has(path) ? n.delete(path) : n.add(path); return n })

  const openCtx = (e: React.MouseEvent, target: MenuTarget) => {
    e.preventDefault(); e.stopPropagation()
    setCtx({ x: e.clientX, y: e.clientY, target })
    setShowMoveMenu(false)
  }

  // ── Operations ───────────────────────────────────────────────────────────────
  const doCreateFolder = useCallback(async (parentPath: string, name: string) => {
    if (!name.trim() || !ipc) return
    const newPath = `${parentPath}/${name.trim()}`
    setBusy(true)
    try {
      await ipc.fs.mkdir(newPath)
    } finally {
      setBusy(false)
      setCreating(null)
      setNewFolderName('')
      await onRescan()
    }
  }, [ipc, onRescan])

  const doDeleteFolder = useCallback(async (folderPath: string) => {
    if (!ipc) return
    const rel = folderPath.replace(testsRoot + '/', '')
    if (!window.confirm(`Delete folder "${rel}" and all its test cases? This cannot be undone.`)) return
    setBusy(true)
    try { await ipc.fs.deleteDir(folderPath) } finally {
      setBusy(false)
      await onRescan()
    }
  }, [ipc, testsRoot, onRescan])

  const doRenameFolder = useCallback(async (oldPath: string, newName: string) => {
    if (!newName.trim() || !ipc) return
    const parentPath = oldPath.substring(0, oldPath.lastIndexOf('/'))
    const newPath = `${parentPath}/${newName.trim()}`
    if (newPath === oldPath) { setRenaming(null); return }
    setBusy(true)
    try { await ipc.fs.rename(oldPath, newPath) } finally {
      setBusy(false)
      setRenaming(null)
      await onRescan()
    }
  }, [ipc, onRescan])

  const doDeleteTest = useCallback(async (tc: TestCase) => {
    if (!ipc) return
    if (!window.confirm(`Delete test case "${tc.testCase}"? This will permanently delete the file.`)) return
    setBusy(true)
    try {
      await ipc.fs.deleteFile(tc.filePath)
      if (props.mode === 'builder') (props as BuilderProps).onTestDeleted(tc.id)
    } finally {
      setBusy(false)
      await onRescan()
    }
  }, [ipc, props, onRescan])

  const doRenameTest = useCallback(async (tc: TestCase, newName: string) => {
    if (!newName.trim() || !ipc) return
    // Rename in-file (testCase: field) + rename the file to match
    const dir = tc.filePath.substring(0, tc.filePath.lastIndexOf('/'))
    const safeName = newName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-')
    const newPath = `${dir}/${safeName}.yaml`
    setBusy(true)
    try {
      const content: string = await ipc.fs.readFile(tc.filePath)
      const updated = content.replace(/^testCase:.*$/m, `testCase: ${newName.trim()}`)
      await ipc.fs.writeFile(newPath, updated)
      if (newPath !== tc.filePath) await ipc.fs.deleteFile(tc.filePath)
    } finally {
      setBusy(false)
      setRenaming(null)
      await onRescan()
    }
  }, [ipc, onRescan])

  const doMoveTest = useCallback(async (tc: TestCase, destFolderPath: string) => {
    if (!ipc) return
    const filename = tc.filePath.split('/').pop()!
    const newPath = `${destFolderPath}/${filename}`
    if (newPath === tc.filePath) return
    setBusy(true)
    try { await ipc.fs.moveFile(tc.filePath, newPath) } finally {
      setBusy(false)
      await onRescan()
    }
  }, [ipc, onRescan])

  // ── Render a folder node recursively ─────────────────────────────────────
  const renderFolder = (node: FolderNode, depth: number = 0): React.ReactNode => {
    const isRoot = node.path === testsRoot
    const isCollapsed = collapsed.has(node.path)
    const isDragTarget = dragOver === node.path
    const indentPx = depth * 12

    return (
      <div key={node.path}>
        {/* Folder header */}
        {!isRoot && (
          <div
            className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-lg mx-1 cursor-pointer select-none transition-colors hover:bg-surface-700 ${isDragTarget ? 'bg-brand-900/30 ring-1 ring-brand-500/40' : ''}`}
            style={{ paddingLeft: `${8 + indentPx}px` }}
            onClick={() => toggleCollapse(node.path)}
            onContextMenu={e => openCtx(e, { type: 'folder', node })}
            onDragOver={e => { e.preventDefault(); setDragOver(node.path) }}
            onDragLeave={() => setDragOver(null)}
            onDrop={async e => {
              e.preventDefault(); setDragOver(null)
              if (dragTc) { await doMoveTest(dragTc, node.path); setDragTc(null) }
            }}
          >
            {renaming?.type === 'folder' && renaming.path === node.path ? (
              <>
                {isCollapsed ? <Folder size={13} className="text-brand-400 flex-shrink-0" /> : <FolderOpen size={13} className="text-brand-400 flex-shrink-0" />}
                <input
                  ref={renameRef}
                  className="flex-1 bg-surface-600 text-xs text-slate-200 rounded px-1.5 py-0.5 outline-none border border-brand-500/50"
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') doRenameFolder(node.path, renameValue)
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  onClick={e => e.stopPropagation()}
                />
              </>
            ) : (
              <>
                {isCollapsed
                  ? <ChevronRight size={11} className="text-slate-600 flex-shrink-0" />
                  : <ChevronDown size={11} className="text-slate-600 flex-shrink-0" />}
                {isCollapsed
                  ? <Folder size={13} className="text-amber-400/70 flex-shrink-0" />
                  : <FolderOpen size={13} className="text-amber-400 flex-shrink-0" />}
                <span className="text-xs text-slate-300 font-medium flex-1 truncate">{node.name}</span>
                <span className="text-[10px] text-slate-600 flex-shrink-0 group-hover:hidden">
                  {node.tests.length + node.children.reduce((a, c) => a + c.tests.length, 0)}
                </span>
                <div className="hidden group-hover:flex gap-0.5 flex-shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); setCreating({ parentPath: node.path }); setNewFolderName('') }}
                    className="p-0.5 rounded hover:bg-surface-500 text-slate-500 hover:text-brand-300"
                    title="New subfolder"
                  ><FolderPlus size={11} /></button>
                  <button
                    onClick={e => { e.stopPropagation(); setRenaming({ type: 'folder', path: node.path, current: node.name }); setRenameValue(node.name) }}
                    className="p-0.5 rounded hover:bg-surface-500 text-slate-500 hover:text-slate-300"
                    title="Rename folder"
                  ><Edit2 size={11} /></button>
                  <button
                    onClick={e => { e.stopPropagation(); doDeleteFolder(node.path) }}
                    className="p-0.5 rounded hover:bg-red-900/40 text-slate-500 hover:text-red-400"
                    title="Delete folder"
                  ><Trash2 size={11} /></button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Folder contents */}
        {(isRoot || !isCollapsed) && (
          <div>
            {/* Inline new-folder input – rendered as plain JSX (NOT a sub-component) so it
                never remounts on keystroke, keeping focus and value intact */}
            {creating?.parentPath === node.path && (
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-700/50 mx-2 rounded-lg"
                onClick={e => e.stopPropagation()}
              >
                <FolderPlus size={12} className="text-brand-400 flex-shrink-0" />
                <input
                  ref={createRef}
                  className="flex-1 bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-600"
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  placeholder="folder-name"
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === 'Enter') doCreateFolder(node.path, newFolderName)
                    if (e.key === 'Escape') { setCreating(null); setNewFolderName('') }
                  }}
                  autoFocus
                />
                <button
                  className="text-[10px] text-brand-400 hover:text-brand-300 font-medium"
                  onMouseDown={e => { e.preventDefault(); doCreateFolder(node.path, newFolderName) }}
                >Create</button>
                <button
                  className="text-[10px] text-slate-500 hover:text-slate-300"
                  onMouseDown={e => { e.preventDefault(); setCreating(null); setNewFolderName('') }}
                >✕</button>
              </div>
            )}

            {/* Child folders */}
            {node.children.map(child => renderFolder(child, depth + 1))}

            {/* Test cases */}
            {node.tests.map(tc => renderTest(tc, depth + 1))}

            {/* Empty state for root */}
            {isRoot && node.tests.length === 0 && node.children.length === 0 && !creating && (
              <div className="px-4 py-5 text-center">
                <FileText size={20} className="mx-auto text-slate-700 mb-2" />
                <p className="text-xs text-slate-600">No test cases yet</p>
                <p className="text-xs text-slate-700 mt-0.5">Click + to create one</p>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Render a test case row ────────────────────────────────────────────────
  const renderTest = (tc: TestCase, depth: number): React.ReactNode => {
    const indentPx = depth * 12
    const isBuilder = props.mode === 'builder'
    const isActive = isBuilder && (props as BuilderProps).activeId === tc.id
    const isChecked = !isBuilder && (props as MonitorProps).selected.has(tc.filePath)
    const relPath = tc.filePath.startsWith(testsRoot + '/')
      ? tc.filePath.slice(testsRoot.length + 1)
      : tc.filePath.split('/').pop()!

    return (
      <div
        key={tc.id}
        draggable
        onDragStart={() => setDragTc(tc)}
        onDragEnd={() => setDragTc(null)}
        onContextMenu={e => openCtx(e, { type: 'test', tc })}
        className={`group flex items-start gap-2 px-2 py-2 mx-1 rounded-lg cursor-pointer select-none transition-colors hover:bg-surface-700 ${
          isActive ? 'bg-brand-900/20 ring-1 ring-brand-500/30' : ''
        }`}
        style={{ paddingLeft: `${8 + indentPx}px` }}
        onClick={() => {
          if (isBuilder) (props as BuilderProps).onSelectTest(tc)
          else (props as MonitorProps).onToggleTest(tc.filePath)
        }}
      >
        {/* Left: drag handle + icon/checkbox */}
        <GripVertical size={11} className="text-slate-700 mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 cursor-grab" />
        {isBuilder ? (
          <FileText size={12} className={`flex-shrink-0 mt-0.5 ${isActive ? 'text-brand-400' : 'text-slate-600'}`} />
        ) : (
          <div className="flex-shrink-0 mt-0.5 text-slate-500">
            {isChecked
              ? <CheckSquare size={12} className="text-brand-400" />
              : <SquareIcon size={12} />}
          </div>
        )}

        {/* Content */}
        {renaming?.type === 'test' && renaming.path === tc.filePath ? (
          <input
            ref={renameRef}
            className="flex-1 bg-surface-600 text-xs text-slate-200 rounded px-1.5 py-0.5 outline-none border border-brand-500/50"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') doRenameTest(tc, renameValue)
              if (e.key === 'Escape') setRenaming(null)
            }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              {tc.isDirty && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 flex-shrink-0" title="Unsaved changes" />}
              <span className={`text-xs font-medium truncate ${isActive ? 'text-slate-100' : isChecked ? 'text-slate-200' : 'text-slate-400'}`}>
                {tc.testCase}
              </span>
            </div>
            {tc.tags.length > 0 && (
              <div className="flex gap-1 mt-0.5 flex-wrap">
                {tc.tags.slice(0, 2).map(t => (
                  <span key={t} className="text-[9px] bg-surface-600 text-slate-600 px-1 py-0 rounded">{t}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Hover actions */}
        {renaming?.path !== tc.filePath && (
          <div className="hidden group-hover:flex gap-0.5 flex-shrink-0 mt-0.5">
            <button
              onClick={e => { e.stopPropagation(); setRenaming({ type: 'test', path: tc.filePath, current: tc.testCase }); setRenameValue(tc.testCase) }}
              className="p-0.5 rounded hover:bg-surface-500 text-slate-600 hover:text-slate-300"
              title="Rename test"
            ><Edit2 size={10} /></button>
            <button
              onClick={e => { e.stopPropagation(); doDeleteTest(tc) }}
              className="p-0.5 rounded hover:bg-red-900/40 text-slate-600 hover:text-red-400"
              title="Delete test"
            ><Trash2 size={10} /></button>
          </div>
        )}
      </div>
    )
  }

  // ── Context menu render ───────────────────────────────────────────────────
  const renderCtx = () => {
    if (!ctx) return null
    const { x, y, target } = ctx
    const isFolder = target.type === 'folder'

    return (
      <div
        ref={ctxRef}
        className="fixed z-50 bg-surface-800 border border-surface-500 rounded-xl shadow-2xl py-1.5 min-w-[180px]"
        style={{ left: x, top: y }}
      >
        {isFolder ? (
          <>
            <MenuItem icon={<Plus size={12} />} label="New Test Case Here" onClick={() => {
              if (props.mode === 'builder') (props as BuilderProps).onCreateTest((target as { type: 'folder'; node: FolderNode }).node.path)
              setCtx(null)
            }} />
            <MenuItem icon={<FolderPlus size={12} />} label="New Subfolder" onClick={() => {
              setCreating({ parentPath: (target as { type: 'folder'; node: FolderNode }).node.path })
              setNewFolderName('')
              setCtx(null)
            }} />
            <div className="border-t border-surface-500 my-1" />
            <MenuItem icon={<Edit2 size={12} />} label="Rename Folder" onClick={() => {
              const node = (target as { type: 'folder'; node: FolderNode }).node
              setRenaming({ type: 'folder', path: node.path, current: node.name })
              setRenameValue(node.name)
              setCtx(null)
            }} />
            <MenuItem icon={<Trash2 size={12} />} label="Delete Folder" danger onClick={() => {
              doDeleteFolder((target as { type: 'folder'; node: FolderNode }).node.path)
              setCtx(null)
            }} />
          </>
        ) : (
          <>
            {props.mode === 'builder' && (
              <MenuItem icon={<FileText size={12} />} label="Open" onClick={() => {
                (props as BuilderProps).onSelectTest((target as { type: 'test'; tc: TestCase }).tc)
                setCtx(null)
              }} />
            )}
            <MenuItem icon={<Edit2 size={12} />} label="Rename Test" onClick={() => {
              const tc = (target as { type: 'test'; tc: TestCase }).tc
              setRenaming({ type: 'test', path: tc.filePath, current: tc.testCase })
              setRenameValue(tc.testCase)
              setCtx(null)
            }} />
            <div className="relative">
              <MenuItem
                icon={<MoveRight size={12} />}
                label="Move to Folder ›"
                onClick={() => setShowMoveMenu(m => !m)}
              />
              {showMoveMenu && (
                <div className="absolute left-full top-0 bg-surface-800 border border-surface-500 rounded-xl shadow-2xl py-1.5 min-w-[200px] max-h-60 overflow-y-auto">
                  {allPaths.map(fp => {
                    const rel = fp === testsRoot ? 'tests (root)' : fp.replace(testsRoot + '/', '')
                    return (
                      <MenuItem key={fp} icon={<Folder size={12} />} label={rel} onClick={async () => {
                        await doMoveTest((target as { type: 'test'; tc: TestCase }).tc, fp)
                        setCtx(null)
                        setShowMoveMenu(false)
                      }} />
                    )
                  })}
                </div>
              )}
            </div>
            <div className="border-t border-surface-500 my-1" />
            <MenuItem icon={<Trash2 size={12} />} label="Delete Test" danger onClick={() => {
              doDeleteTest((target as { type: 'test'; tc: TestCase }).tc)
              setCtx(null)
            }} />
          </>
        )}
      </div>
    )
  }

  // ── Top toolbar ───────────────────────────────────────────────────────────
  const toolbar = (
    <div className="flex-shrink-0 flex items-center gap-1 px-3 py-2.5 border-b border-surface-500">
      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest flex-1">
        {props.mode === 'builder' ? 'Test Cases' : 'Tests'}
      </span>

      {props.mode === 'monitor' && testCases.length > 0 && (
        <button onClick={(props as MonitorProps).onToggleAll} className="p-1 rounded hover:bg-surface-600 text-slate-500 hover:text-slate-300 transition-colors" title="Toggle all">
          {(props as MonitorProps).allSelected
            ? <CheckSquare size={13} className="text-brand-400" />
            : (props as MonitorProps).someSelected
            ? <Minus size={13} />
            : <SquareIcon size={13} />}
        </button>
      )}

      {props.mode === 'builder' && (
        <>
          <button
            onClick={() => { setCreating({ parentPath: testsRoot }); setNewFolderName('') }}
            className="p-1 rounded hover:bg-surface-600 text-slate-500 hover:text-brand-300 transition-colors"
            title="New folder"
          ><FolderPlus size={13} /></button>
          <button
            onClick={() => (props as BuilderProps).onCreateTest(testsRoot)}
            className="p-1 rounded hover:bg-surface-600 text-slate-500 hover:text-brand-300 transition-colors"
            title="New test case"
          ><Plus size={13} /></button>
        </>
      )}

      <button
        onClick={onRescan}
        disabled={rescanning}
        className="p-1 rounded hover:bg-surface-600 text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40"
        title="Rescan project"
      >
        {rescanning || busy
          ? <Loader2 size={13} className="animate-spin" />
          : <RefreshCw size={13} />}
      </button>
    </div>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {toolbar}
      <div className="flex-1 overflow-y-auto py-1">
        {renderFolder(tree, 0)}
      </div>
      {renderCtx()}
    </div>
  )
}

// ── Small helper for context menu items ───────────────────────────────────────
function MenuItem({ icon, label, onClick, danger = false }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors hover:bg-surface-700 ${
        danger ? 'text-red-400 hover:text-red-300' : 'text-slate-300 hover:text-slate-100'
      }`}
    >
      <span className="flex-shrink-0">{icon}</span>
      {label}
    </button>
  )
}
