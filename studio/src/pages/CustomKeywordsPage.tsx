import { useState } from 'react'
import { Plus, Trash2, Save, Wrench, Code2, ChevronDown, ChevronRight, Copy, Play } from 'lucide-react'
import api from '../lib/api'
import { useAppStore } from '../store/appStore'

interface ParamDef {
  name: string
  type: 'string' | 'locator' | 'number' | 'boolean'
  description?: string
  required?: boolean
}

interface CustomKeyword {
  id: string
  name: string
  category: string
  description: string
  params: ParamDef[]
  implementation: string
  isDirty: boolean
}

function uid() { return Math.random().toString(36).slice(2, 9) }

const STARTER_CODE = `/**
 * @param {import('@prabala/driver-api').KeywordContext} ctx
 * @param {Record<string, string>} params
 */
async function execute(ctx, params) {
  // ctx.page    → Playwright Page
  // ctx.logger  → { info, warn, error }
  // ctx.config  → prabala.config.yaml values
  // params      → keyword parameters

  const { locator, expectedText } = params

  // Example: assert custom text
  const el = ctx.page.locator(locator)
  const text = await el.textContent()

  if (!text?.includes(expectedText)) {
    throw new Error(\`Expected "\${expectedText}" but found: "\${text}"\`)
  }

  ctx.logger.info(\`✓ \${params.locator} contains "\${expectedText}"\`)
}
`

function keywordToJs(kw: CustomKeyword): string {
  const paramJSDoc = kw.params.map(p => ` * @param {${p.type === 'number' ? 'number' : 'string'}} params.${p.name}${p.description ? ' - ' + p.description : ''}`).join('\n')
  return `// Auto-generated keyword: ${kw.name}
// Category: ${kw.category}
// Description: ${kw.description}
const { registerKeyword } = require('@prabala/core')

registerKeyword({
  name: '${kw.name}',
  category: '${kw.category || 'Custom'}',
  description: '${kw.description}',
  params: ${JSON.stringify(kw.params, null, 2)},

  /**
${paramJSDoc || ' * (no params)'}
   * @param {import(\'@prabala/driver-api\').KeywordContext} ctx
   * @param {Record<string, string>} params
   */
  async execute(ctx, params) {
${kw.implementation.split('\n').map(l => '    ' + l).join('\n')}
  },
})
`
}

const PARAM_TYPES = ['string', 'locator', 'number', 'boolean']

export default function CustomKeywordsPage() {
  const projectDir = useAppStore((s) => s.projectDir) ?? ''
  const [keywords, setKeywords] = useState<CustomKeyword[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [expandedParams, setExpandedParams] = useState(true)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [testOutput, setTestOutput] = useState<string | null>(null)

  const active = keywords.find((k) => k.id === activeId) ?? null

  function addKeyword() {
    const kw: CustomKeyword = {
      id: uid(), name: 'My.CustomKeyword', category: 'Custom', description: '',
      params: [{ name: 'locator', type: 'locator', description: 'Element locator', required: true }],
      implementation: STARTER_CODE, isDirty: true,
    }
    setKeywords((ks) => [...ks, kw])
    setActiveId(kw.id)
  }

  function updateKw(id: string, updates: Partial<CustomKeyword>) {
    setKeywords((ks) => ks.map((k) => k.id === id ? { ...k, ...updates, isDirty: true } : k))
  }

  function deleteKw(id: string) {
    setKeywords((ks) => ks.filter((k) => k.id !== id))
    if (activeId === id) setActiveId(null)
  }

  function addParam() {
    if (!active) return
    const p: ParamDef = { name: 'param' + (active.params.length + 1), type: 'string', description: '', required: false }
    updateKw(active.id, { params: [...active.params, p] })
  }

  function updateParam(idx: number, updates: Partial<ParamDef>) {
    if (!active) return
    const params = active.params.map((p, i) => i === idx ? { ...p, ...updates } : p)
    updateKw(active.id, { params })
  }

  function removeParam(idx: number) {
    if (!active) return
    updateKw(active.id, { params: active.params.filter((_, i) => i !== idx) })
  }

  async function saveKeyword() {
    if (!active || !projectDir) return
    const dir = `${projectDir}/keywords/custom`
    const fileName = active.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() + '.js'
    const filePath = `${dir}/${fileName}`
    const content = keywordToJs(active)
    try {
      await api.fs.mkdir(dir)
      await api.fs.writeFile(filePath, content)
      setKeywords((ks) => ks.map((k) => k.id === active.id ? { ...k, isDirty: false } : k))
      setSaveMsg(`Saved → keywords/custom/${fileName}`)
      setTimeout(() => setSaveMsg(null), 2500)
    } catch (e: any) {
      setSaveMsg(`Error: ${e.message}`)
    }
  }

  async function testKeyword() {
    setTestOutput('Running quick syntax check…')
    try {
      // Use eval as dry-run — only check for syntax errors, don't execute
      // eslint-disable-next-line no-new-func
      new Function('ctx', 'params', active?.implementation ?? '')
      setTestOutput('✓ Syntax looks valid! No errors found.\n\nNote: Full execution requires a running test session.')
    } catch (e: any) {
      setTestOutput(`✗ Syntax error:\n${e.message}`)
    }
  }

  return (
    <div className="h-full flex overflow-hidden bg-surface-800">
      {/* Left: keyword list */}
      <div className="w-52 flex-shrink-0 border-r border-surface-600 flex flex-col">
        <div className="flex items-center justify-between px-3 py-3 border-b border-surface-600">
          <span className="text-xs font-semibold text-slate-300">Custom Keywords</span>
          <button onClick={addKeyword} className="p-1 text-slate-500 hover:text-brand-400 rounded" title="New keyword">
            <Plus size={13} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {keywords.length === 0 && (
            <div className="p-4 text-center">
              <Wrench size={24} className="mx-auto text-slate-700 mb-2" />
              <p className="text-xs text-slate-600">No custom keywords yet.</p>
              <button onClick={addKeyword} className="mt-2 text-xs text-brand-400 hover:text-brand-300">+ Create one</button>
            </div>
          )}
          {keywords.map((kw) => (
            <div key={kw.id} className="group relative">
              <button onClick={() => setActiveId(kw.id)}
                className={`w-full text-left px-3 py-2.5 text-xs border-b border-surface-700 transition-colors ${kw.id === activeId ? 'bg-brand-600/20 text-brand-300' : 'text-slate-400 hover:text-slate-200 hover:bg-surface-700'}`}>
                <div className="flex items-center gap-1.5">
                  <Code2 size={11} className="flex-shrink-0" />
                  <span className="truncate font-mono flex-1">{kw.name}</span>
                  {kw.isDirty && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 flex-shrink-0" />}
                </div>
                <div className="text-[10px] text-slate-600 mt-0.5 truncate">{kw.category}</div>
              </button>
              <button onClick={(e) => { e.stopPropagation(); deleteKw(kw.id) }}
                className="absolute right-2 top-2.5 opacity-0 group-hover:opacity-100 p-0.5 text-slate-600 hover:text-red-400 rounded transition-all">
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Center: editor */}
      {active ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-surface-600 flex-shrink-0 bg-surface-800">
            <div className="flex items-center gap-3">
              <Wrench size={15} className="text-brand-400" />
              <input value={active.name} onChange={(e) => updateKw(active.id, { name: e.target.value })}
                className="bg-transparent text-white font-semibold text-sm border-none outline-none font-mono w-56"
                placeholder="Keyword.Name" />
              <input value={active.category} onChange={(e) => updateKw(active.id, { category: e.target.value })}
                className="bg-transparent text-slate-500 text-xs border-none outline-none"
                placeholder="Category" />
            </div>
            <div className="flex items-center gap-2">
              {saveMsg && <span className="text-xs text-green-400">{saveMsg}</span>}
              <button onClick={testKeyword} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-surface-600 hover:bg-surface-500 text-slate-300 rounded-lg border border-surface-400">
                <Play size={11} /> Test
              </button>
              <button onClick={saveKeyword} className="btn-primary text-xs flex items-center gap-1.5">
                <Save size={12} /> Save
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Description */}
            <input value={active.description} onChange={(e) => updateKw(active.id, { description: e.target.value })}
              placeholder="Description — shown in keyword library and test builder…"
              className="input w-full text-sm" />

            {/* Parameters section */}
            <div className="bg-surface-700 border border-surface-600 rounded-xl overflow-hidden">
              <button onClick={() => setExpandedParams((p) => !p)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-surface-600">
                <span>Parameters ({active.params.length})</span>
                {expandedParams ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
              {expandedParams && (
                <div className="border-t border-surface-600 p-3 space-y-2">
                  {active.params.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={p.name} onChange={(e) => updateParam(i, { name: e.target.value })}
                        className="input text-xs font-mono w-28" placeholder="name" />
                      <select value={p.type} onChange={(e) => updateParam(i, { type: e.target.value as any })}
                        className="input text-xs w-24">
                        {PARAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <input value={p.description ?? ''} onChange={(e) => updateParam(i, { description: e.target.value })}
                        className="input text-xs flex-1" placeholder="description" />
                      <label className="flex items-center gap-1 text-xs text-slate-500">
                        <input type="checkbox" checked={p.required ?? false}
                          onChange={(e) => updateParam(i, { required: e.target.checked })}
                          className="accent-brand-500" />
                        req
                      </label>
                      <button onClick={() => removeParam(i)} className="p-1 text-slate-600 hover:text-red-400 rounded">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                  <button onClick={addParam} className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
                    <Plus size={11} /> Add Parameter
                  </button>
                </div>
              )}
            </div>

            {/* Implementation */}
            <div className="bg-surface-700 border border-surface-600 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-600">
                <span className="text-xs font-semibold text-slate-300">Implementation (JavaScript)</span>
                <button onClick={() => updateKw(active.id, { implementation: STARTER_CODE })}
                  className="text-xs text-slate-600 hover:text-slate-400 flex items-center gap-1">
                  <Copy size={10} /> Reset
                </button>
              </div>
              <textarea
                className="w-full bg-surface-900 text-green-300 font-mono text-xs p-4 resize-none outline-none min-h-[280px] leading-relaxed"
                value={active.implementation}
                onChange={(e) => updateKw(active.id, { implementation: e.target.value })}
                spellCheck={false}
              />
            </div>

            {/* Test output */}
            {testOutput && (
              <div className={`rounded-xl border p-3 font-mono text-xs whitespace-pre-wrap ${testOutput.startsWith('✓') ? 'bg-green-950/30 border-green-700/50 text-green-300' : 'bg-red-950/30 border-red-700/50 text-red-300'}`}>
                {testOutput}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Wrench size={36} className="mx-auto text-slate-700 mb-3" />
            <p className="text-slate-500 text-sm">Build reusable keywords in JavaScript</p>
            <p className="text-xs text-slate-600 mt-1 mb-4">Define params, write implementation, use in any test</p>
            <button onClick={addKeyword} className="btn-primary text-sm flex items-center gap-2 mx-auto">
              <Plus size={14} /> Create Keyword
            </button>
          </div>
        </div>
      )}

      {/* Right: Generated JS preview */}
      {active && (
        <div className="w-64 flex-shrink-0 border-l border-surface-600 flex flex-col">
          <div className="px-3 py-3 border-b border-surface-600">
            <span className="text-xs font-semibold text-slate-400">Generated JS</span>
          </div>
          <pre className="flex-1 overflow-auto p-3 text-[10px] text-slate-400 font-mono leading-relaxed whitespace-pre-wrap">
            {keywordToJs(active)}
          </pre>
        </div>
      )}
    </div>
  )
}
