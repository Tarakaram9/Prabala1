// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio – Object Repository (Objects + Page Definitions)
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react'
import { useAppStore, ObjectEntry, LocatorFallback, PageDef } from '../store/appStore'
import { Search, Plus, Trash2, Save, Database, Edit3, Globe, Layout, Zap, X, ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react'
import yaml from 'js-yaml'
import api from '../lib/api'

const STRATEGIES = ['css', 'xpath', 'text', 'aria', 'id', 'label', 'placeholder', 'testId', 'automationId', 'name', 'role']

const ALL_STRATEGIES = STRATEGIES

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
  name: 'text-teal-400 bg-teal-900/30', role: 'text-cyan-400 bg-cyan-900/30',
  label: 'text-lime-400 bg-lime-900/30', placeholder: 'text-rose-400 bg-rose-900/30',
  testId: 'text-violet-400 bg-violet-900/30',
}

// ── Objects Tab ───────────────────────────────────────────────────────────────
function ObjectsTab() {
  const { objects, setObjects, pageDefs, projectDir } = useAppStore()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ObjectEntry | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editObj, setEditObj] = useState<ObjectEntry>(emptyObject())
  const [pageFilter, setPageFilter] = useState<string | null>(null)
  // AI Suggest state
  const [showAiPanel, setShowAiPanel] = useState(false)
  const [aiHtml, setAiHtml] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([])
  const [aiError, setAiError] = useState<string | null>(null)

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
    const ipc = api
    if (!ipc) return
    const byPage: Record<string, Record<string, any>> = {}
    for (const obj of objs) {
      const page = obj.page || 'default'
      if (!byPage[page]) byPage[page] = {}
      const entry: Record<string, any> = {
        strategy: obj.strategy,
        locator: obj.locator,
        description: obj.description,
      }
      if (obj.fallbacks?.length) {
        entry.fallbacks = obj.fallbacks
      }
      byPage[page][obj.key] = entry
    }
    for (const [page, pageObjs] of Object.entries(byPage)) {
      const content = yaml.dump({ objects: pageObjs }, { lineWidth: 120 })
      await ipc.fs.writeFile(`${projectDir}/object-repository/${page}.yaml`, content)
    }
  }

  // AI Suggest: call local Ollama (free) to generate CSS selector
  const runAiSuggest = useCallback(async () => {
    if (!aiHtml.trim() || !editObj.description) return
    setAiLoading(true)
    setAiError(null)
    setAiSuggestions([])
    try {
      const prompt = `You are an HTML expert. Given this HTML, suggest 3 CSS selectors that uniquely identify the element described as: "${editObj.description}".\nReturn ONLY 3 CSS selectors, one per line, no explanation.\n\nHTML:\n${aiHtml.slice(0, 4000)}`
      const res = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama3', prompt, stream: false }),
      })
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
      const data = await res.json() as { response: string }
      const lines = data.response.split('\n')
        .map(l => l.replace(/^[0-9]+[.)\s]+/, '').trim())
        .filter(l => l && !l.startsWith('#') && !l.startsWith('`') && l.length < 120)
        .slice(0, 3)
      setAiSuggestions(lines)
    } catch (e) {
      setAiError(`Ollama not reachable: ${(e as Error).message}. Start Ollama with: ollama run llama3`)
    } finally {
      setAiLoading(false)
    }
  }, [aiHtml, editObj.description])

  function addFallback() {
    setEditObj(p => ({ ...p, fallbacks: [...(p.fallbacks ?? []), { strategy: 'css', locator: '' }] }))
  }
  function removeFallback(i: number) {
    setEditObj(p => ({ ...p, fallbacks: p.fallbacks?.filter((_, idx) => idx !== i) }))
  }
  function updateFallback(i: number, field: keyof LocatorFallback, val: string) {
    setEditObj(p => ({
      ...p,
      fallbacks: p.fallbacks?.map((fb, idx) => idx === i ? { ...fb, [field]: val } : fb),
    }))
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

              {/* Fallback Locators */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-slate-400 font-semibold flex items-center gap-1.5">
                    <ShieldCheck size={12} className="text-green-400" />
                    Fallback Locators
                    <span className="text-slate-600 font-normal">(tried in order when primary fails)</span>
                  </label>
                  <button onClick={addFallback} className="text-[10px] px-2 py-0.5 bg-surface-700 hover:bg-surface-600 text-slate-300 rounded flex items-center gap-1">
                    <Plus size={10} /> Add fallback
                  </button>
                </div>
                {(editObj.fallbacks ?? []).length === 0 && (
                  <p className="text-xs text-slate-600 italic">No fallbacks — add one for resilient self-healing.</p>
                )}
                {(editObj.fallbacks ?? []).map((fb, i) => (
                  <div key={i} className="flex gap-2 mb-2 items-center">
                    <span className="text-xs text-slate-600 w-4 flex-shrink-0">{i + 1}.</span>
                    <select className="input flex-shrink-0 w-32 text-xs" value={fb.strategy}
                      onChange={e => updateFallback(i, 'strategy', e.target.value)}>
                      {ALL_STRATEGIES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <input className="input font-mono text-xs flex-1" value={fb.locator}
                      placeholder="locator value"
                      onChange={e => updateFallback(i, 'locator', e.target.value)} />
                    <button onClick={() => removeFallback(i)} className="text-slate-600 hover:text-red-400"><X size={13} /></button>
                  </div>
                ))}
              </div>

              {/* AI Suggest Panel */}
              <div className="border border-dashed border-surface-500 rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowAiPanel(p => !p)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-slate-400 hover:bg-surface-700 transition-colors"
                >
                  <Zap size={12} className="text-amber-400" />
                  <span className="font-semibold">AI Suggest Locators</span>
                  <span className="text-slate-600">(uses local Ollama — free)</span>
                  {showAiPanel ? <ChevronDown size={12} className="ml-auto" /> : <ChevronRight size={12} className="ml-auto" />}
                </button>
                {showAiPanel && (
                  <div className="p-4 border-t border-surface-600 space-y-3">
                    <p className="text-xs text-slate-500">Paste the relevant HTML section from DevTools, then click Suggest.</p>
                    <textarea
                      rows={5}
                      className="w-full bg-surface-900 border border-surface-600 rounded-lg p-3 text-xs font-mono text-slate-300 placeholder-slate-600 focus:outline-none focus:border-brand-500 resize-y"
                      placeholder={'<div class="login-form">...paste HTML here...</div>'}
                      value={aiHtml}
                      onChange={e => setAiHtml(e.target.value)}
                    />
                    <button
                      onClick={runAiSuggest}
                      disabled={aiLoading || !aiHtml.trim() || !editObj.description}
                      className="flex items-center gap-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      <Zap size={12} />
                      {aiLoading ? 'Asking Ollama…' : 'Suggest CSS selectors'}
                    </button>
                    {aiError && <p className="text-xs text-red-400">{aiError}</p>}
                    {aiSuggestions.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs text-slate-400 font-semibold">Suggestions — click to add as fallback or set as primary:</p>
                        {aiSuggestions.map((s, i) => (
                          <div key={i} className="flex items-center gap-2 bg-surface-900 rounded-lg px-3 py-2 border border-surface-600">
                            <code className="text-xs font-mono text-green-400 flex-1 break-all">{s}</code>
                            <button
                              onClick={() => setEditObj(p => ({ ...p, locator: s, strategy: 'css' }))}
                              className="text-[10px] px-2 py-0.5 bg-brand-700 hover:bg-brand-600 text-white rounded flex-shrink-0"
                            >Set primary</button>
                            <button
                              onClick={() => setEditObj(p => ({ ...p, fallbacks: [...(p.fallbacks ?? []), { strategy: 'css', locator: s }] }))}
                              className="text-[10px] px-2 py-0.5 bg-surface-600 hover:bg-surface-500 text-slate-300 rounded flex-shrink-0"
                            >+ Fallback</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
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
              {selected.fallbacks && selected.fallbacks.length > 0 && (
                <div className="pt-2">
                  <p className="text-xs text-slate-500 mb-2 flex items-center gap-1"><ShieldCheck size={11} className="text-green-400" /> Fallback chain ({selected.fallbacks.length})</p>
                  {selected.fallbacks.map((fb, i) => (
                    <div key={i} className="flex gap-2 items-center mb-1.5">
                      <span className="text-[10px] text-slate-600 w-4">{i + 1}.</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${strategyColor[fb.strategy] ?? 'text-slate-400 bg-surface-700'}`}>{fb.strategy}</span>
                      <code className="text-xs font-mono text-slate-300 truncate">{fb.locator}</code>
                    </div>
                  ))}
                </div>
              )}
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
    const ipc = api
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
