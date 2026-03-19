import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import {
  Database, Plus, Trash2, Save, Edit2, X, FileJson, FileText
} from 'lucide-react'

interface DataFile {
  name: string
  path: string
  content: Record<string, unknown>
}

export default function TestDataPage() {
  const { projectDir } = useAppStore()
  const [files, setFiles] = useState<DataFile[]>([])
  const [activeFile, setActiveFile] = useState<DataFile | null>(null)
  const [editedContent, setEditedContent] = useState<Record<string, unknown>>({})
  const [dirty, setDirty] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')
  const [newVal, setNewVal] = useState('')
  const [addingNew, setAddingNew] = useState(false)
  const ipc = (window as any).prabala

  useEffect(() => {
    loadDataFiles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectDir])

  async function loadDataFiles() {
    if (!ipc || !projectDir) {
      setFiles([{
        name: 'demo-data.json',
        path: `${projectDir ?? '/Users/ram/prabala'}/test-data/demo-data.json`,
        content: {
          todoItem1: 'Buy groceries',
          todoItem2: 'Write Prabala tests',
          todoItem3: 'Review pull requests',
          baseUrl: 'https://demo.playwright.dev/todomvc',
          browser: 'chromium',
        }
      }])
      setActiveFile({
        name: 'demo-data.json',
        path: `${projectDir ?? '/Users/ram/prabala'}/test-data/demo-data.json`,
        content: {
          todoItem1: 'Buy groceries',
          todoItem2: 'Write Prabala tests',
          todoItem3: 'Review pull requests',
          baseUrl: 'https://demo.playwright.dev/todomvc',
          browser: 'chromium',
        }
      })
      return
    }
    try {
      const dirPath = `${projectDir}/test-data`
      const exists = await ipc.fs.exists(dirPath)
      if (!exists) { setFiles([]); return }
      const entries: { name: string; isFile: boolean }[] = await ipc.fs.readDir(dirPath)
      const loaded: DataFile[] = []
      for (const e of entries) {
        if (!e.isFile) continue
        const isJson = e.name.endsWith('.json')
        const isYaml = e.name.endsWith('.yaml') || e.name.endsWith('.yml')
        if (!isJson && !isYaml) continue
        const filePath = `${dirPath}/${e.name}`
        const raw = await ipc.fs.readFile(filePath)
        try {
          let content: Record<string, unknown>
          if (isJson) content = JSON.parse(raw)
          else {
            const yaml = await import('js-yaml')
            content = (yaml.load(raw) as Record<string, unknown>) ?? {}
          }
          loaded.push({ name: e.name, path: filePath, content })
        } catch { /* skip malformed */ }
      }
      setFiles(loaded)
      if (loaded.length > 0 && !activeFile) {
        setActiveFile(loaded[0])
        setEditedContent({ ...loaded[0].content })
      }
    } catch (err) {
      console.error(err)
    }
  }

  function selectFile(f: DataFile) {
    setActiveFile(f)
    setEditedContent({ ...f.content })
    setDirty(false)
    setEditingKey(null)
    setAddingNew(false)
  }

  function deleteKey(key: string) {
    const next = { ...editedContent }
    delete next[key]
    setEditedContent(next)
    setDirty(true)
  }

  function updateValue(key: string, value: string) {
    setEditedContent(prev => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  function addPair() {
    if (!newKey.trim()) return
    setEditedContent(prev => ({ ...prev, [newKey.trim()]: newVal }))
    setDirty(true)
    setNewKey('')
    setNewVal('')
    setAddingNew(false)
  }

  async function saveFile() {
    if (!activeFile) return
    const isJson = activeFile.name.endsWith('.json')
    let text: string
    if (isJson) {
      text = JSON.stringify(editedContent, null, 2)
    } else {
      const yaml = await import('js-yaml')
      text = yaml.dump(editedContent)
    }
    if (ipc) await ipc.fs.writeFile(activeFile.path, text)
    const updated = { ...activeFile, content: { ...editedContent } }
    setFiles(prev => prev.map(f => f.path === activeFile.path ? updated : f))
    setActiveFile(updated)
    setDirty(false)
  }

  const ext = activeFile?.name.endsWith('.json') ? 'json' : 'yaml'

  return (
    <div className="flex h-full">
      {/* Left — file list */}
      <div className="w-56 flex-shrink-0 flex flex-col border-r border-surface-500 bg-surface-800">
        <div className="px-4 py-3 border-b border-surface-500 flex items-center gap-2">
          <Database size={14} className="text-brand-400" />
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-widest">Data Files</span>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {files.map(f => (
            <button
              key={f.path}
              onClick={() => selectFile(f)}
              className={`w-full text-left px-4 py-2.5 flex items-center gap-2 text-sm transition-colors ${
                activeFile?.path === f.path
                  ? 'bg-brand-600/20 text-brand-300'
                  : 'text-slate-400 hover:bg-surface-700 hover:text-slate-200'
              }`}
            >
              {f.name.endsWith('.json')
                ? <FileJson size={14} className="flex-shrink-0 text-yellow-400" />
                : <FileText size={14} className="flex-shrink-0 text-blue-400" />}
              <span className="truncate">{f.name}</span>
            </button>
          ))}
          {files.length === 0 && (
            <p className="text-xs text-slate-600 px-4 py-3">No data files found in test-data/</p>
          )}
        </div>
      </div>

      {/* Right — editor */}
      {activeFile ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex-shrink-0 px-6 py-4 border-b border-surface-500 flex items-center gap-3">
            <div className="flex-1">
              <h2 className="text-base font-semibold text-slate-100">{activeFile.name}</h2>
              <p className="text-xs text-slate-500 mt-0.5 font-mono">{activeFile.path}</p>
            </div>
            <div className="text-xs text-slate-500 bg-surface-700 px-2 py-1 rounded font-mono">{ext}</div>
            <button
              onClick={saveFile}
              disabled={!dirty}
              className={`btn-primary flex items-center gap-2 py-2 text-xs ${!dirty ? 'opacity-40 cursor-default' : ''}`}
            >
              <Save size={13} /> Save
            </button>
          </div>

          {/* Reference hint */}
          <div className="flex-shrink-0 px-6 py-2 bg-brand-900/20 border-b border-brand-800/30 text-xs text-brand-300">
            Use in test steps as <span className="font-mono bg-brand-900/40 px-1 rounded">{'{{TEST_DATA.keyName}}'}</span>
          </div>

          {/* Key-value table */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-surface-600">
                  <th className="pb-2 pr-4 font-normal w-48">Key</th>
                  <th className="pb-2 pr-4 font-normal">Value</th>
                  <th className="pb-2 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(editedContent).map(([key, val]) => (
                  <tr key={key} className="border-b border-surface-700/50 hover:bg-surface-700/30 transition-colors">
                    <td className="py-2.5 pr-4">
                      <span className="font-mono text-xs text-brand-300 bg-brand-900/30 px-2 py-0.5 rounded">{key}</span>
                    </td>
                    <td className="py-2 pr-4">
                      {editingKey === key ? (
                        <input
                          autoFocus
                          className="input text-xs w-full font-mono"
                          value={String(val)}
                          onChange={e => updateValue(key, e.target.value)}
                          onBlur={() => setEditingKey(null)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingKey(null) }}
                        />
                      ) : (
                        <span className="text-slate-300 font-mono text-xs">{String(val)}</span>
                      )}
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setEditingKey(key)} className="p-1 text-slate-600 hover:text-slate-300 transition-colors">
                          <Edit2 size={12} />
                        </button>
                        <button onClick={() => deleteKey(key)} className="p-1 text-slate-600 hover:text-red-400 transition-colors">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {/* Add new row */}
                {addingNew && (
                  <tr className="border-b border-surface-700/50 bg-surface-700/30">
                    <td className="py-2 pr-4">
                      <input autoFocus className="input text-xs w-full font-mono" placeholder="key" value={newKey} onChange={e => setNewKey(e.target.value)} />
                    </td>
                    <td className="py-2 pr-4">
                      <input className="input text-xs w-full font-mono" placeholder="value" value={newVal} onChange={e => setNewVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addPair() }} />
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-1">
                        <button onClick={addPair} className="p-1 text-green-400 hover:text-green-300"><Save size={12} /></button>
                        <button onClick={() => { setAddingNew(false); setNewKey(''); setNewVal('') }} className="p-1 text-slate-500 hover:text-slate-300"><X size={12} /></button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <button
              onClick={() => setAddingNew(true)}
              className="mt-4 flex items-center gap-2 text-xs text-slate-500 hover:text-brand-400 transition-colors"
            >
              <Plus size={13} /> Add key-value pair
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-600">
          <div className="text-center">
            <Database size={40} className="mx-auto mb-3 opacity-30" />
            <p>No data file selected</p>
          </div>
        </div>
      )}
    </div>
  )
}
