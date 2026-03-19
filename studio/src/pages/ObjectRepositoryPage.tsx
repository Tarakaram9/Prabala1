// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio – Object Repository (Objects + Page Definitions)
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { useAppStore, ObjectEntry, PageDef } from '../store/appStore'
import { Search, Plus, Trash2, Save, Database, Edit3, Globe, Layout } from 'lucide-react'
import yaml from 'js-yaml'

const STRATEGIES = ['css', 'xpath', 'text', 'aria', 'id', 'automationId', 'name']

function emptyObject(): ObjectEntry {
  return { key: '', strategy: 'css', locator: '', description: '', page: '' }
}

function emptyPageDef(): PageDef {
  return { name: '', url: '', description: '' }
}

const strategyColor: Record<string, string> = {
  css: 'text-blue-400 bg-blue-900/30', xpath: 'text-orange-400 bg-orange-900/30',
  text: 'text-green-400 bg-green-900/30', aria: 'text-purple-400 bg-purple-900/30',
  id: 'text-yellow-400 bg-yellow-900/30', automationId: 'text-pink-400 bg-pink-900/30',
  name: 'text-teal-400 bg-teal-900/30',
}

// ── Objects Tab ───────────────────────────────────────────────────────────────
function ObjectsTab() {
  const { objects, setObjects, pageDefs, projectDir } = useAppStore()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ObjectEntry | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editObj, setEditObj] = useState<ObjectEntry>(emptyObject())
  const [pageFilter, setPageFilter] = useState<string | null>(null)

  const pages = Array.from(new Set(objects.map(o => o.page ?? 'default'))).sort()

  const filtered = objects.filter(o => {
    const matchSearch = o.key.toLowerCase().includes(search.toLowerCase()) ||
      o.locator.toLowerCase().includes(search.toLowerCase()) ||
      (o.description ?? '').toLowerCase().includes(search.toLowerCase())
    const matchPage = !pageFilter || o.page === pageFilter
    return matchSearch && matchPage
  })

  function startAdd() {
    setEditObj({ ...emptyObject(), page: pageFilter ?? '' })
    setIsEditing(true)
    setSelected(null)
  }

  function startEdit(obj: ObjectEntry) {
    setEditObj({ ...obj })
    setIsEditing(true)
    setSelected(obj)
  }

  async function saveEdit() {
    if (!editObj.key || !editObj.locator) return
    const updated = selected
      ? objects.map(o => o.key === selected.key ? editObj : o)
      : [...objects, editObj]
    setObjects(updated)
    setIsEditing(false)
    setSelected(editObj)
    await saveToFile(updated)
  }

  async function deleteObject(key: string) {
    const updated = objects.filter(o => o.key !== key)
    setObjects(updated)
    if (selected?.key === key) setSelected(null)
    await saveToFile(updated)
  }

  async function saveToFile(objs: ObjectEntry[]) {
    if (!projectDir) return
    const ipc = (window as any).prabala
    if (!ipc) return
    const byPage: Record<string, Record<string, any>> = {}
    for (const obj of objs) {
      const page = obj.page || 'default'
      if (!byPage[page]) byPage[page] = {}
      byPage[page][obj.key] = { strategy: obj.strategy, locator: obj.locator, description: obj.description }
    }
    for (const [page, pageObjs] of Object.entries(byPage)) {
      const content = yaml.dump({ objects: pageObjs }, { lineWidth: 120 })
      await ipc.fs.writeFile(`${projectDir}/object-repository/${page}.yaml`, content)
    }
  }

  // Page suggestions: from PageDefs + from existing object pages
  const pageNameSuggestions = Array.from(new Set([
    ...pageDefs.map(p => p.name),
    ...pages,
  ])).sort()

  return (
    <div className="flex h-full">
      {/* List */}
      <div className="w-80 flex-shrink-0 border-r border-surface-500 flex flex-col bg-surface-900">
        <div className="p-3 border-b border-surface-500 space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input className="input pl-8 text-xs" placeholder="Search objects..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button onClick={startAdd} className="btn-primary py-2 px-3 flex-shrink-0"><Plus size={14} /></button>
          </div>
          <div className="flex flex-wrap gap-1">
            <button onClick={() => setPageFilter(null)} className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${!pageFilter ? 'bg-brand-600/30 text-brand-300 border-brand-600/50' : 'text-slate-500 border-surface-500'}`}>All</button>
            {pages.map(p => (
              <button key={p} onClick={() => setPageFilter(pageFilter === p ? null : p)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${pageFilter === p ? 'bg-brand-600/30 text-brand-300 border-brand-600/50' : 'text-slate-500 border-surface-500 hover:border-slate-400'}`}>{p}</button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map(obj => (
            <button key={obj.key} onClick={() => { setSelected(obj); setIsEditing(false) }}
              className={`w-full text-left px-4 py-3 border-b border-surface-700/50 transition-colors ${selected?.key === obj.key && !isEditing ? 'bg-brand-600/10 border-l-2 border-l-brand-500' : 'hover:bg-surface-700'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono font-semibold text-slate-300 truncate">@{obj.key}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono flex-shrink-0 ${strategyColor[obj.strategy] ?? ''}`}>{obj.strategy}</span>
              </div>
              <p className="text-xs text-slate-500 truncate mt-0.5 font-mono">{obj.locator}</p>
              {obj.page && <p className="text-[10px] text-slate-600 truncate mt-0.5">{obj.page}</p>}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-10 text-xs text-slate-600">No objects found.<br />Click + to add one.</div>
          )}
        </div>
        <div className="px-4 py-2 border-t border-surface-500">
          <p className="text-xs text-slate-600">{filtered.length} of {objects.length} objects</p>
        </div>
      </div>

      {/* Detail / Edit */}
      <div className="flex-1 overflow-y-auto p-8">
        {isEditing ? (
          <div className="max-w-xl">
            <h2 className="text-lg font-bold text-slate-100 mb-6">{selected ? 'Edit Object' : 'Add New Object'}</h2>
            <div className="card p-6 space-y-4">
              <div>
                <label className="text-xs text-slate-400 font-semibold mb-1.5 block">Key (reference as @key)</label>
                <input className="input font-mono" value={editObj.key} onChange={e => setEditObj(p => ({ ...p, key: e.target.value }))} placeholder="e.g. login-button" />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-semibold mb-1.5 block">Page / Module</label>
                <input className="input" list="obj-page-names-list"
                  value={editObj.page ?? ''}
                  onChange={e => setEditObj(p => ({ ...p, page: e.target.value }))}
                  placeholder="e.g. LoginPage" />
                <datalist id="obj-page-names-list">
                  {pageNameSuggestions.map(n => <option key={n} value={n} />)}
                </datalist>
              </div>
              <div>
                <label className="text-xs text-slate-400 font-semibold mb-1.5 block">Strategy</label>
                <select className="input" value={editObj.strategy} onChange={e => setEditObj(p => ({ ...p, strategy: e.target.value }))}>
                  {STRATEGIES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 font-semibold mb-1.5 block">Locator</label>
                <input className="input font-mono" value={editObj.locator} onChange={e => setEditObj(p => ({ ...p, locator: e.target.value }))} placeholder='e.g. #login-btn or "Log In"' />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-semibold mb-1.5 block">Description</label>
                <input className="input" value={editObj.description ?? ''} onChange={e => setEditObj(p => ({ ...p, description: e.target.value }))} placeholder="What is this element?" />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={saveEdit} className="btn-primary flex items-center gap-1.5"><Save size={13} /> Save Object</button>
                <button onClick={() => setIsEditing(false)} className="btn-secondary">Cancel</button>
              </div>
            </div>
          </div>
        ) : selected ? (
          <div className="max-w-xl">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-surface-700 border border-surface-500 flex items-center justify-center">
                  <Database size={18} className="text-brand-400" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-slate-100 font-mono">@{selected.key}</h1>
                  <p className="text-xs text-slate-500">{selected.page}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => startEdit(selected)} className="btn-secondary flex items-center gap-1.5"><Edit3 size={13} /> Edit</button>
                <button onClick={() => deleteObject(selected.key)} className="btn-danger flex items-center gap-1.5"><Trash2 size={13} /> Delete</button>
              </div>
            </div>
            <div className="card p-5 space-y-4">
              {[
                { label: 'Strategy', value: selected.strategy, mono: true },
                { label: 'Locator', value: selected.locator, mono: true },
                { label: 'Description', value: selected.description || '—', mono: false },
                { label: 'Page', value: selected.page || '—', mono: false },
              ].map(row => (
                <div key={row.label} className="flex gap-4 py-2 border-b border-surface-500/50 last:border-0">
                  <span className="text-xs text-slate-500 w-24 flex-shrink-0 pt-0.5">{row.label}</span>
                  <span className={`text-sm text-slate-200 ${row.mono ? 'font-mono' : ''}`}>{row.value}</span>
                </div>
              ))}
            </div>
            <div className="card p-5 mt-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Use in test case</h3>
              <pre className="text-xs font-mono text-green-300 bg-surface-900 rounded-lg p-4">{`- keyword: Click\n  params:\n    locator: "@${selected.key}"`}</pre>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center flex-col gap-3">
            <Database size={32} className="text-slate-600" />
            <p className="text-slate-600">Select an object or click + to add</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Pages Tab ─────────────────────────────────────────────────────────────────
function PagesTab() {
  const { pageDefs, setPageDefs, projectDir } = useAppStore()
  const [selected, setSelected] = useState<PageDef | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editPage, setEditPage] = useState<PageDef>(emptyPageDef())
  const [editOrigName, setEditOrigName] = useState<string | null>(null)

  function startAdd() {
    setEditPage(emptyPageDef())
    setEditOrigName(null)
    setIsEditing(true)
    setSelected(null)
  }

  function startEdit(pd: PageDef) {
    setEditPage({ ...pd })
    setEditOrigName(pd.name)
    setIsEditing(true)
    setSelected(pd)
  }

  async function saveEdit() {
    if (!editPage.name.trim()) return
    const updated = editOrigName !== null
      ? pageDefs.map(p => p.name === editOrigName ? editPage : p)
      : [...pageDefs, editPage]
    setPageDefs(updated)
    setIsEditing(false)
    setSelected(editPage)
    await saveToFile(updated)
  }

  async function deletePage(name: string) {
    const updated = pageDefs.filter(p => p.name !== name)
    setPageDefs(updated)
    if (selected?.name === name) setSelected(null)
    await saveToFile(updated)
  }

  async function saveToFile(defs: PageDef[]) {
    if (!projectDir) return
    const ipc = (window as any).prabala
    if (!ipc) return
    const content = yaml.dump({ pages: defs }, { lineWidth: 120 })
    await ipc.fs.writeFile(`${projectDir}/object-repository/pages.yaml`, content)
  }

  return (
    <div className="flex h-full">
      {/* List */}
      <div className="w-72 flex-shrink-0 border-r border-surface-500 flex flex-col bg-surface-900">
        <div className="p-3 border-b border-surface-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Page Definitions</span>
            <button onClick={startAdd} className="btn-primary py-1.5 px-2"><Plus size={13} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {pageDefs.map(pd => (
            <button key={pd.name} onClick={() => { setSelected(pd); setIsEditing(false) }}
              className={`w-full text-left px-4 py-3 border-b border-surface-700/50 transition-colors ${selected?.name === pd.name && !isEditing ? 'bg-brand-600/10 border-l-2 border-l-brand-500' : 'hover:bg-surface-700'}`}>
              <div className="flex items-center gap-2">
                <Layout size={12} className="text-brand-400 flex-shrink-0" />
                <span className="text-xs font-semibold text-slate-300 truncate">{pd.name}</span>
              </div>
              {pd.url && <p className="text-[10px] text-slate-500 truncate mt-0.5 font-mono pl-5">{pd.url}</p>}
              {pd.description && <p className="text-[10px] text-slate-600 truncate mt-0.5 pl-5">{pd.description}</p>}
            </button>
          ))}
          {pageDefs.length === 0 && (
            <div className="text-center py-10 text-xs text-slate-600">No page definitions.<br />Click + to define a page.</div>
          )}
        </div>
        <div className="px-4 py-2 border-t border-surface-500">
          <p className="text-xs text-slate-600">{pageDefs.length} page{pageDefs.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Detail / Edit */}
      <div className="flex-1 overflow-y-auto p-8">
        {isEditing ? (
          <div className="max-w-lg">
            <h2 className="text-lg font-bold text-slate-100 mb-6">{editOrigName ? 'Edit Page' : 'Add Page Definition'}</h2>
            <div className="card p-6 space-y-4">
              <div>
                <label className="text-xs text-slate-400 font-semibold mb-1.5 block">Page Name</label>
                <input className="input" value={editPage.name} onChange={e => setEditPage(p => ({ ...p, name: e.target.value }))} placeholder="e.g. LoginPage, HomePage" />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-semibold mb-1.5 block">URL Pattern</label>
                <input className="input font-mono" value={editPage.url ?? ''} onChange={e => setEditPage(p => ({ ...p, url: e.target.value }))} placeholder="e.g. /login or {BASE_URL}/checkout" />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-semibold mb-1.5 block">Description</label>
                <input className="input" value={editPage.description ?? ''} onChange={e => setEditPage(p => ({ ...p, description: e.target.value }))} placeholder="What is this page?" />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={saveEdit} className="btn-primary flex items-center gap-1.5"><Save size={13} /> Save Page</button>
                <button onClick={() => setIsEditing(false)} className="btn-secondary">Cancel</button>
              </div>
            </div>
          </div>
        ) : selected ? (
          <div className="max-w-lg">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-surface-700 border border-surface-500 flex items-center justify-center">
                  <Globe size={18} className="text-brand-400" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-slate-100">{selected.name}</h1>
                  {selected.url && <p className="text-xs text-slate-500 font-mono mt-0.5">{selected.url}</p>}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => startEdit(selected)} className="btn-secondary flex items-center gap-1.5"><Edit3 size={13} /> Edit</button>
                <button onClick={() => deletePage(selected.name)} className="btn-danger flex items-center gap-1.5"><Trash2 size={13} /> Delete</button>
              </div>
            </div>
            <div className="card p-5 space-y-4">
              {[
                { label: 'URL', value: selected.url || '—', mono: true },
                { label: 'Description', value: selected.description || '—', mono: false },
              ].map(row => (
                <div key={row.label} className="flex gap-4 py-2 border-b border-surface-500/50 last:border-0">
                  <span className="text-xs text-slate-500 w-24 flex-shrink-0 pt-0.5">{row.label}</span>
                  <span className={`text-sm text-slate-200 ${row.mono ? 'font-mono' : ''}`}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center flex-col gap-3">
            <Globe size={32} className="text-slate-600" />
            <p className="text-slate-600">Select a page or click + to define one</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Root component ────────────────────────────────────────────────────────────
export default function ObjectRepositoryPage() {
  const [tab, setTab] = useState<'objects' | 'pages'>('objects')

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center border-b border-surface-500 bg-surface-900 px-4 flex-shrink-0">
        <button
          onClick={() => setTab('objects')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${tab === 'objects' ? 'border-brand-500 text-brand-300' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
        >
          <Database size={13} /> Objects
        </button>
        <button
          onClick={() => setTab('pages')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${tab === 'pages' ? 'border-brand-500 text-brand-300' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
        >
          <Layout size={13} /> Pages
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === 'objects' ? <ObjectsTab /> : <PagesTab />}
      </div>
    </div>
  )
}
