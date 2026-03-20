// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio – Reusable Components (POM Step Library)
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef } from 'react'
import { useAppStore, ComponentDef, ComponentStep } from '../store/appStore'
import {
  Plus, Trash2, Save, Edit3, Puzzle, ChevronDown, ChevronUp,
  GripVertical, X, Tag, ArrowUp, ArrowDown
} from 'lucide-react'
import yaml from 'js-yaml'
import api from '../lib/api'

// ── Keyword → params map (mirrors TestBuilderPage) ───────────────────────────
const KEYWORD_PARAMS: Record<string, string[]> = {
  'NavigateTo': ['url'], 'Click': ['locator'], 'DoubleClick': ['locator'],
  'RightClick': ['locator'], 'EnterText': ['locator', 'value'],
  'PressKey': ['key'], 'SelectOption': ['locator', 'option'],
  'Hover': ['locator'], 'ScrollTo': ['locator'], 'Check': ['locator'],
  'Uncheck': ['locator'], 'WaitForVisible': ['locator'], 'WaitForHidden': ['locator'],
  'Wait': ['ms'], 'AssertVisible': ['locator'], 'AssertNotVisible': ['locator'],
  'AssertText': ['locator', 'expected'], 'AssertTitle': ['expected'],
  'AssertUrl': ['expected'], 'AssertEnabled': ['locator'], 'AssertValue': ['locator', 'expected'],
  'GetText': ['locator', 'variable'], 'GetValue': ['locator', 'variable'],
  'TakeScreenshot': ['name'], 'SwitchToFrame': ['name'], 'UploadFile': ['locator', 'filePath'],
  'AcceptAlert': [], 'DismissAlert': [], 'Web.Launch': [], 'Web.Close': [],
  'GoBack': [], 'Reload': [], 'WaitForNavigation': [],
  'API.GET': ['url', 'responseAs'], 'API.POST': ['url', 'body', 'responseAs'],
  'API.AssertStatus': ['expected'], 'API.AssertBody': ['path', 'expected'],
  'UseComponent': ['component'],
}

const ALL_KEYWORDS = Object.keys(KEYWORD_PARAMS).sort()

function emptyComponent(): Omit<ComponentDef, 'id'> {
  return { name: '', description: '', params: [], steps: [] }
}

function newStep(keyword: string): ComponentStep {
  const paramKeys = KEYWORD_PARAMS[keyword] ?? []
  const params: Record<string, string> = {}
  paramKeys.forEach(k => { params[k] = '' })
  return { keyword, params, description: '' }
}

// ── Inline step row editor inside the component form ─────────────────────────
function StepRow({
  step, index, total, compParams,
  onChange, onDelete, onMoveUp, onMoveDown,
}: {
  step: ComponentStep
  index: number
  total: number
  compParams: string[]
  onChange: (s: ComponentStep) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const [expanded, setExpanded] = useState(true)
  const paramKeys = KEYWORD_PARAMS[step.keyword] ?? Object.keys(step.params)

  return (
    <div className="border border-surface-500 rounded-lg bg-surface-800/60 overflow-hidden mb-2">
      {/* Row header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <GripVertical size={12} className="text-slate-600 flex-shrink-0" />
        <span className="text-[10px] text-slate-600 font-mono w-5 text-right flex-shrink-0">{index + 1}</span>

        <select
          className="flex-1 bg-transparent border border-surface-500 rounded text-xs font-mono text-slate-300 px-2 py-1 focus:outline-none focus:border-brand-600"
          value={step.keyword}
          onChange={e => {
            const kw = e.target.value
            const newParams: Record<string, string> = {}
            ;(KEYWORD_PARAMS[kw] ?? []).forEach(k => { newParams[k] = step.params[k] ?? '' })
            onChange({ ...step, keyword: kw, params: newParams })
          }}
        >
          {ALL_KEYWORDS.map(kw => <option key={kw} value={kw}>{kw}</option>)}
        </select>

        <button onClick={() => setExpanded(v => !v)} className="p-1 text-slate-600 hover:text-slate-300">
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        <button onClick={onMoveUp} disabled={index === 0} className="p-1 text-slate-600 hover:text-slate-300 disabled:opacity-30">
          <ArrowUp size={12} />
        </button>
        <button onClick={onMoveDown} disabled={index === total - 1} className="p-1 text-slate-600 hover:text-slate-300 disabled:opacity-30">
          <ArrowDown size={12} />
        </button>
        <button onClick={onDelete} className="p-1 text-slate-600 hover:text-red-400">
          <X size={12} />
        </button>
      </div>

      {/* Params */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-surface-700">
          <input
            className="input text-xs mt-2"
            placeholder="Step description (optional)..."
            value={step.description ?? ''}
            onChange={e => onChange({ ...step, description: e.target.value })}
          />
          {paramKeys.map(key => (
            <div key={key} className="flex items-center gap-2">
              <label className="text-xs text-slate-500 font-mono w-24 flex-shrink-0">{key}</label>
              <div className="relative flex-1">
                <input
                  className="input text-xs font-mono w-full"
                  value={step.params[key] ?? ''}
                  onChange={e => onChange({ ...step, params: { ...step.params, [key]: e.target.value } })}
                  placeholder={`{{${key.toUpperCase()}}} or @object`}
                />
                {/* Component param reference hint */}
                {compParams.length > 0 && (
                  <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex gap-0.5">
                    {compParams.map(p => (
                      <button
                        key={p}
                        type="button"
                        title={`Insert {{${p}}}`}
                        onClick={() => onChange({ ...step, params: { ...step.params, [key]: `{{${p}}}` } })}
                        className="text-[9px] px-1 py-0.5 rounded bg-surface-600 text-brand-400 hover:bg-brand-800/40 font-mono leading-none"
                      >
                        {`{{${p}}}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ComponentsPage() {
  const { componentDefs, setComponentDefs, projectDir } = useAppStore()
  const [selected, setSelected] = useState<string | null>(null)   // component id
  const [isEditing, setIsEditing] = useState(false)
  const [editComp, setEditComp] = useState<Omit<ComponentDef, 'id'>>(emptyComponent())
  const [editId, setEditId] = useState<string | null>(null)
  const [newParamText, setNewParamText] = useState('')
  const [search, setSearch] = useState('')
  const newKwRef = useRef<HTMLSelectElement>(null)

  const selectedComp = componentDefs.find(c => c.id === selected) ?? null

  const filtered = componentDefs.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.description ?? '').toLowerCase().includes(search.toLowerCase())
  )

  // ── CRUD helpers ────────────────────────────────────────────────────────────
  function startAdd() {
    setEditComp(emptyComponent())
    setEditId(null)
    setIsEditing(true)
    setSelected(null)
    setNewParamText('')
  }

  function startEdit(comp: ComponentDef) {
    setEditComp({ name: comp.name, description: comp.description ?? '', params: [...comp.params], steps: comp.steps.map(s => ({ ...s, params: { ...s.params } })) })
    setEditId(comp.id)
    setIsEditing(true)
    setSelected(comp.id)
    setNewParamText('')
  }

  function saveEdit() {
    if (!editComp.name.trim()) return
    let updated: ComponentDef[]
    if (editId) {
      updated = componentDefs.map(c => c.id === editId ? { id: editId, ...editComp } : c)
    } else {
      const newComp: ComponentDef = { id: crypto.randomUUID(), ...editComp }
      updated = [...componentDefs, newComp]
      setSelected(newComp.id)
    }
    setComponentDefs(updated)
    setIsEditing(false)
    saveToFile(updated)
  }

  function deleteComp(id: string) {
    const updated = componentDefs.filter(c => c.id !== id)
    setComponentDefs(updated)
    if (selected === id) { setSelected(null); setIsEditing(false) }
    saveToFile(updated)
  }

  // ── Param helpers ────────────────────────────────────────────────────────────
  function addParam() {
    const t = newParamText.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '')
    if (!t || editComp.params.includes(t)) return
    setEditComp(p => ({ ...p, params: [...p.params, t] }))
    setNewParamText('')
  }

  function removeParam(name: string) {
    setEditComp(p => ({ ...p, params: p.params.filter(x => x !== name) }))
  }

  // ── Step helpers ─────────────────────────────────────────────────────────────
  function addStep() {
    const kw = newKwRef.current?.value ?? 'Click'
    setEditComp(p => ({ ...p, steps: [...p.steps, newStep(kw)] }))
  }

  function updateStepAt(idx: number, s: ComponentStep) {
    setEditComp(p => { const steps = [...p.steps]; steps[idx] = s; return { ...p, steps } })
  }

  function deleteStepAt(idx: number) {
    setEditComp(p => ({ ...p, steps: p.steps.filter((_, i) => i !== idx) }))
  }

  function moveStep(idx: number, dir: -1 | 1) {
    setEditComp(p => {
      const steps = [...p.steps]
      const target = idx + dir
      if (target < 0 || target >= steps.length) return p
      ;[steps[idx], steps[target]] = [steps[target], steps[idx]]
      return { ...p, steps }
    })
  }

  // ── Persist ──────────────────────────────────────────────────────────────────
  async function saveToFile(defs: ComponentDef[]) {
    if (!projectDir) return
    const ipc = api
    if (!ipc) return
    for (const comp of defs) {
      const payload = {
        name: comp.name,
        description: comp.description,
        params: comp.params,
        steps: comp.steps.map(s => ({ keyword: s.keyword, params: s.params, ...(s.description ? { description: s.description } : {}) })),
      }
      const content = yaml.dump(payload, { lineWidth: 120 })
      const safeName = comp.name.replace(/[^a-zA-Z0-9_-]/g, '_')
      await ipc.fs.writeFile(`${projectDir}/components/${safeName}.yaml`, content)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full">
      {/* ── Left: Component list ─────────────────────────────────────────────── */}
      <div className="w-72 flex-shrink-0 border-r border-surface-500 flex flex-col bg-surface-900">
        <div className="p-3 border-b border-surface-500 space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                className="input text-xs pl-3"
                placeholder="Search components..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <button onClick={startAdd} className="btn-primary py-2 px-3 flex-shrink-0">
              <Plus size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.map(comp => (
            <button
              key={comp.id}
              onClick={() => { setSelected(comp.id); setIsEditing(false) }}
              className={`w-full text-left px-4 py-3 border-b border-surface-700/50 transition-colors ${
                selected === comp.id && !isEditing
                  ? 'bg-brand-600/10 border-l-2 border-l-brand-500'
                  : 'hover:bg-surface-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <Puzzle size={13} className="text-brand-400 flex-shrink-0" />
                <span className="text-xs font-semibold text-slate-300 truncate">{comp.name}</span>
              </div>
              {comp.description && (
                <p className="text-[10px] text-slate-600 truncate mt-0.5 pl-5">{comp.description}</p>
              )}
              <div className="flex items-center gap-2 mt-1.5 pl-5">
                <span className="text-[10px] text-slate-600">{comp.steps.length} steps</span>
                {comp.params.length > 0 && (
                  <span className="text-[10px] text-brand-500 font-mono">{comp.params.map(p => `{{${p}}}`).join(', ')}</span>
                )}
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-10 text-xs text-slate-600">
              No components yet.<br />Click + to create one.
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-surface-500">
          <p className="text-xs text-slate-600">{componentDefs.length} component{componentDefs.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* ── Right: Detail / Editor ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6">
        {isEditing ? (
          <div className="max-w-2xl">
            <h2 className="text-lg font-bold text-slate-100 mb-6">{editId ? 'Edit Component' : 'New Component'}</h2>

            {/* ── Meta ── */}
            <div className="card p-5 space-y-4 mb-4">
              <div>
                <label className="text-xs text-slate-400 font-semibold mb-1.5 block">Component Name</label>
                <input
                  className="input font-mono"
                  value={editComp.name}
                  onChange={e => setEditComp(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Login, SearchProduct, Checkout"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-semibold mb-1.5 block">Description</label>
                <input
                  className="input"
                  value={editComp.description ?? ''}
                  onChange={e => setEditComp(p => ({ ...p, description: e.target.value }))}
                  placeholder="What does this component do?"
                />
              </div>
            </div>

            {/* ── Params ── */}
            <div className="card p-5 mb-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Tag size={11} /> Parameters
              </h3>
              <div className="flex flex-wrap gap-1.5 mb-3 min-h-[28px]">
                {editComp.params.map(p => (
                  <span key={p} className="flex items-center gap-1 px-2 py-1 rounded-full bg-brand-900/40 border border-brand-700/50 text-brand-300 text-xs font-mono">
                    {`{{${p}}}`}
                    <button onClick={() => removeParam(p)} className="text-brand-600 hover:text-red-400 ml-0.5">
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {editComp.params.length === 0 && (
                  <span className="text-xs text-slate-600 italic">No parameters — this component uses fixed values</span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  className="input text-xs flex-1 font-mono"
                  placeholder="param name (e.g. username)"
                  value={newParamText}
                  onChange={e => setNewParamText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addParam() } }}
                />
                <button onClick={addParam} className="btn-secondary text-xs px-3">Add</button>
              </div>
            </div>

            {/* ── Steps ── */}
            <div className="card p-5 mb-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Steps</h3>

              {editComp.steps.length === 0 && (
                <p className="text-xs text-slate-600 mb-3 italic">No steps yet — add steps below.</p>
              )}

              {editComp.steps.map((step, idx) => (
                <StepRow
                  key={idx}
                  step={step}
                  index={idx}
                  total={editComp.steps.length}
                  compParams={editComp.params}
                  onChange={s => updateStepAt(idx, s)}
                  onDelete={() => deleteStepAt(idx)}
                  onMoveUp={() => moveStep(idx, -1)}
                  onMoveDown={() => moveStep(idx, 1)}
                />
              ))}

              <div className="flex gap-2 mt-3 pt-3 border-t border-surface-600">
                <select
                  ref={newKwRef}
                  className="input text-xs flex-1 font-mono"
                  defaultValue="Click"
                >
                  {ALL_KEYWORDS.map(kw => <option key={kw} value={kw}>{kw}</option>)}
                </select>
                <button onClick={addStep} className="btn-secondary text-xs flex items-center gap-1.5">
                  <Plus size={12} /> Add Step
                </button>
              </div>
            </div>

            {/* ── Actions ── */}
            <div className="flex gap-2">
              <button onClick={saveEdit} className="btn-primary flex items-center gap-1.5">
                <Save size={13} /> Save Component
              </button>
              <button onClick={() => setIsEditing(false)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        ) : selectedComp ? (
          <div className="max-w-2xl">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-surface-700 border border-surface-500 flex items-center justify-center">
                  <Puzzle size={18} className="text-brand-400" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-slate-100">{selectedComp.name}</h1>
                  {selectedComp.description && <p className="text-xs text-slate-500 mt-0.5">{selectedComp.description}</p>}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => startEdit(selectedComp)} className="btn-secondary flex items-center gap-1.5"><Edit3 size={13} /> Edit</button>
                <button onClick={() => deleteComp(selectedComp.id)} className="btn-danger flex items-center gap-1.5"><Trash2 size={13} /> Delete</button>
              </div>
            </div>

            {/* Params */}
            {selectedComp.params.length > 0 && (
              <div className="card p-5 mb-4">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Parameters</h3>
                <div className="flex flex-wrap gap-1.5">
                  {selectedComp.params.map(p => (
                    <span key={p} className="px-2 py-1 rounded-full bg-brand-900/40 border border-brand-700/50 text-brand-300 text-xs font-mono">{`{{${p}}}`}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Steps */}
            <div className="card p-5 mb-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{selectedComp.steps.length} Steps</h3>
              <div className="space-y-1">
                {selectedComp.steps.map((step, idx) => (
                  <div key={idx} className="flex gap-3 py-2 border-b border-surface-600/50 last:border-0">
                    <span className="text-[10px] text-slate-600 font-mono w-5 text-right flex-shrink-0 pt-0.5">{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-mono text-brand-300">{step.keyword}</span>
                      {Object.entries(step.params).filter(([, v]) => v).map(([k, v]) => (
                        <span key={k} className="ml-2 text-[10px] font-mono text-slate-500">{k}: <span className="text-slate-400">{v}</span></span>
                      ))}
                      {step.description && <p className="text-[10px] text-slate-600 mt-0.5 italic">{step.description}</p>}
                    </div>
                  </div>
                ))}
                {selectedComp.steps.length === 0 && <p className="text-xs text-slate-600 italic">No steps defined.</p>}
              </div>
            </div>

            {/* Usage snippet */}
            <div className="card p-5">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Use in Test Case</h3>
              <pre className="text-xs font-mono text-green-300 bg-surface-900 rounded-lg p-4 overflow-x-auto">{[
                `- keyword: UseComponent`,
                `  params:`,
                `    component: "${selectedComp.name}"`,
                ...selectedComp.params.map(p => `    ${p}: "{{TEST_DATA.${p}}}"`),
              ].join('\n')}</pre>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center flex-col gap-3">
            <Puzzle size={40} className="text-slate-600" />
            <p className="text-slate-500 font-medium">Reusable Components</p>
            <p className="text-slate-600 text-sm text-center max-w-xs">
              Create named, parameterised step sequences.<br />
              Use them anywhere with a single <span className="font-mono text-brand-400">UseComponent</span> step.
            </p>
            <button onClick={startAdd} className="btn-primary mt-2 flex items-center gap-1.5">
              <Plus size={14} /> New Component
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
