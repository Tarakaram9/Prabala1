import { useState, useRef } from 'react'
import { FileText, Plus, Save, Trash2, ChevronDown, ChevronRight, Copy } from 'lucide-react'
import api from '../lib/api'
import { useAppStore } from '../store/appStore'

interface GherkinScenario {
  id: string
  type: 'Scenario' | 'Scenario Outline'
  name: string
  steps: GherkinStep[]
  examples?: string
}
interface GherkinStep {
  id: string
  keyword: 'Given' | 'When' | 'Then' | 'And' | 'But'
  text: string
  prabalaKeyword?: string
  prabalaParams?: Record<string, string>
}
interface GherkinFeature {
  id: string
  filePath: string
  feature: string
  description: string
  scenarios: GherkinScenario[]
  isDirty: boolean
}

const STEP_COLORS: Record<string, string> = {
  Given: 'text-blue-400',
  When: 'text-yellow-400',
  Then: 'text-green-400',
  And: 'text-slate-400',
  But: 'text-orange-400',
}

const KW_KEYWORDS = ['Given', 'When', 'Then', 'And', 'But']

// Map Gherkin patterns to Prabala keywords
const STEP_MAPPINGS: { pattern: RegExp; keyword: string; extract: (m: RegExpMatchArray) => Record<string, string> }[] = [
  { pattern: /I navigate to "(.+)"/, keyword: 'NavigateTo', extract: (m) => ({ url: m[1] }) },
  { pattern: /I click(?: on)? "(.+)"/, keyword: 'Click', extract: (m) => ({ locator: m[1] }) },
  { pattern: /I enter "(.+)" in(?: the)? "(.+)"/, keyword: 'EnterText', extract: (m) => ({ locator: m[2], text: m[1] }) },
  { pattern: /I see "(.+)"/, keyword: 'AssertVisible', extract: (m) => ({ locator: m[1] }) },
  { pattern: /I should see "(.+)"/, keyword: 'AssertText', extract: (m) => ({ locator: 'body', text: m[1] }) },
  { pattern: /the page title is "(.+)"/, keyword: 'AssertTitle', extract: (m) => ({ title: m[1] }) },
  { pattern: /the URL contains "(.+)"/, keyword: 'AssertUrl', extract: (m) => ({ url: m[1] }) },
  { pattern: /I wait for "(.+)"/, keyword: 'WaitForVisible', extract: (m) => ({ locator: m[1] }) },
  { pattern: /I take a screenshot/, keyword: 'TakeScreenshot', extract: () => ({}) },
  { pattern: /I launch the browser/, keyword: 'Web.Launch', extract: () => ({}) },
  { pattern: /I close the browser/, keyword: 'Web.Close', extract: () => ({}) },
]

function mapStep(text: string): { keyword: string; params: Record<string, string> } | undefined {
  for (const { pattern, keyword, extract } of STEP_MAPPINGS) {
    const m = text.match(pattern)
    if (m) return { keyword, params: extract(m) }
  }
  return undefined
}

function featureToGherkin(f: GherkinFeature): string {
  const lines: string[] = [`Feature: ${f.feature}`]
  if (f.description) lines.push(`  ${f.description}`)
  lines.push('')
  for (const s of f.scenarios) {
    lines.push(`  ${s.type}: ${s.name}`)
    for (const step of s.steps) {
      lines.push(`    ${step.keyword} ${step.text}`)
    }
    if (s.examples) {
      lines.push('')
      lines.push('    Examples:')
      s.examples.split('\n').forEach((l) => lines.push(`      ${l}`))
    }
    lines.push('')
  }
  return lines.join('\n')
}

function uid() { return Math.random().toString(36).slice(2, 9) }

export default function GherkinPage() {
  const projectDir = useAppStore((s) => s.projectDir) ?? ''
  const [features, setFeatures] = useState<GherkinFeature[]>([{
    id: uid(), filePath: '', feature: 'My Feature', description: '', scenarios: [], isDirty: true
  }])
  const [activeId, setActiveId] = useState(features[0].id)
  const [expandedScenarios, setExpandedScenarios] = useState<Set<string>>(new Set())
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const active = features.find((f) => f.id === activeId) ?? features[0]

  function updateFeature(id: string, updates: Partial<GherkinFeature>) {
    setFeatures((fs) => fs.map((f) => f.id === id ? { ...f, ...updates, isDirty: true } : f))
  }

  function addScenario() {
    const scenario: GherkinScenario = { id: uid(), type: 'Scenario', name: 'New Scenario', steps: [] }
    updateFeature(active.id, { scenarios: [...active.scenarios, scenario] })
    setExpandedScenarios((s) => { const n = new Set(s); n.add(scenario.id); return n })
  }

  function deleteScenario(sId: string) {
    updateFeature(active.id, { scenarios: active.scenarios.filter((s) => s.id !== sId) })
  }

  function updateScenario(sId: string, updates: Partial<GherkinScenario>) {
    updateFeature(active.id, {
      scenarios: active.scenarios.map((s) => s.id === sId ? { ...s, ...updates } : s)
    })
  }

  function addStep(sId: string) {
    const step: GherkinStep = { id: uid(), keyword: 'When', text: 'I ' }
    const scenario = active.scenarios.find((s) => s.id === sId)
    if (!scenario) return
    const mapped = mapStep(step.text)
    updateScenario(sId, { steps: [...scenario.steps, step] })
  }

  function updateStep(sId: string, stepId: string, updates: Partial<GherkinStep>) {
    const scenario = active.scenarios.find((s) => s.id === sId)
    if (!scenario) return
    const steps = scenario.steps.map((st) => {
      if (st.id !== stepId) return st
      const merged = { ...st, ...updates }
      const mapped = mapStep(merged.text)
      return { ...merged, prabalaKeyword: mapped?.keyword, prabalaParams: mapped?.params }
    })
    updateScenario(sId, { steps })
  }

  function deleteStep(sId: string, stepId: string) {
    const scenario = active.scenarios.find((s) => s.id === sId)
    if (!scenario) return
    updateScenario(sId, { steps: scenario.steps.filter((s) => s.id !== stepId) })
  }

  async function saveFeature() {
    if (!active.filePath && !projectDir) return
    const content = featureToGherkin(active)
    const filePath = active.filePath || `${projectDir}/tests/${active.feature.replace(/\s+/g, '-').toLowerCase()}.feature`
    try {
      await api.fs.writeFile(filePath, content)
      updateFeature(active.id, { filePath, isDirty: false })
      setSaveMsg('Saved ✔')
      setTimeout(() => setSaveMsg(null), 2000)
    } catch (e: any) {
      setSaveMsg(`Error: ${e.message}`)
    }
  }

  const gherkinPreview = featureToGherkin(active)

  return (
    <div className="h-full flex overflow-hidden bg-surface-800">
      {/* Left: feature list */}
      <div className="w-48 flex-shrink-0 border-r border-surface-600 flex flex-col">
        <div className="flex items-center justify-between px-3 py-3 border-b border-surface-600">
          <span className="text-xs font-semibold text-slate-300">Features</span>
          <button onClick={() => {
            const f: GherkinFeature = { id: uid(), filePath: '', feature: 'New Feature', description: '', scenarios: [], isDirty: true }
            setFeatures((fs) => [...fs, f]); setActiveId(f.id)
          }} className="p-1 text-slate-500 hover:text-brand-400 rounded">
            <Plus size={13} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {features.map((f) => (
            <button key={f.id} onClick={() => setActiveId(f.id)}
              className={`w-full text-left px-3 py-2 text-xs flex items-center gap-1.5 ${f.id === activeId ? 'bg-brand-600/20 text-brand-300' : 'text-slate-400 hover:text-slate-200 hover:bg-surface-700'}`}>
              <FileText size={12} />
              <span className="truncate flex-1">{f.feature}</span>
              {f.isDirty && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 flex-shrink-0" />}
            </button>
          ))}
        </div>
      </div>

      {/* Center: editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-600 flex-shrink-0">
          <div className="flex items-center gap-3">
            <FileText size={16} className="text-brand-400" />
            <input value={active.feature} onChange={(e) => updateFeature(active.id, { feature: e.target.value })}
              className="bg-transparent text-white font-semibold text-sm border-none outline-none w-64" />
          </div>
          <div className="flex items-center gap-2">
            {saveMsg && <span className="text-xs text-green-400">{saveMsg}</span>}
            <button onClick={saveFeature} className="btn-primary text-xs flex items-center gap-1.5"><Save size={12}/> Save</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <input value={active.description} onChange={(e) => updateFeature(active.id, { description: e.target.value })}
            placeholder="Feature description (optional)…"
            className="input w-full text-xs" />

          {active.scenarios.map((scenario) => {
            const isExpanded = expandedScenarios.has(scenario.id)
            return (
              <div key={scenario.id} className="bg-surface-700 border border-surface-600 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-600">
                  <button onClick={() => setExpandedScenarios((s) => { const n = new Set(s); isExpanded ? n.delete(scenario.id) : n.add(scenario.id); return n })}
                    className="text-slate-500 hover:text-slate-300">
                    {isExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                  </button>
                  <select value={scenario.type} onChange={(e) => updateScenario(scenario.id, { type: e.target.value as any })}
                    className="bg-transparent text-xs text-purple-300 font-semibold border-none outline-none cursor-pointer">
                    <option value="Scenario">Scenario</option>
                    <option value="Scenario Outline">Scenario Outline</option>
                  </select>
                  <input value={scenario.name} onChange={(e) => updateScenario(scenario.id, { name: e.target.value })}
                    className="flex-1 bg-transparent text-sm text-white border-none outline-none" />
                  <button onClick={() => deleteScenario(scenario.id)} className="p-1 text-slate-600 hover:text-red-400 rounded"><Trash2 size={12}/></button>
                </div>

                {isExpanded && (
                  <div className="p-3 space-y-1.5">
                    {scenario.steps.map((step) => (
                      <div key={step.id} className="flex items-center gap-2">
                        <select value={step.keyword} onChange={(e) => updateStep(scenario.id, step.id, { keyword: e.target.value as any })}
                          className={`bg-surface-800 border border-surface-500 rounded px-1.5 py-1 text-xs font-bold w-16 ${STEP_COLORS[step.keyword]}`}>
                          {KW_KEYWORDS.map((k) => <option key={k} value={k}>{k}</option>)}
                        </select>
                        <input value={step.text} onChange={(e) => updateStep(scenario.id, step.id, { text: e.target.value })}
                          className="flex-1 input text-xs font-mono" placeholder="step text…" />
                        {step.prabalaKeyword && (
                          <span className="text-[10px] text-brand-400 bg-brand-900/30 px-1.5 py-0.5 rounded font-mono flex-shrink-0">→ {step.prabalaKeyword}</span>
                        )}
                        <button onClick={() => deleteStep(scenario.id, step.id)} className="p-1 text-slate-600 hover:text-red-400 rounded"><Trash2 size={11}/></button>
                      </div>
                    ))}
                    <button onClick={() => addStep(scenario.id)} className="mt-1 text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
                      <Plus size={11}/> Add Step
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          <button onClick={addScenario} className="w-full py-2 text-xs text-brand-400 hover:text-brand-300 border border-dashed border-brand-700/50 rounded-lg hover:bg-brand-900/20 flex items-center justify-center gap-1.5">
            <Plus size={13}/> Add Scenario
          </button>
        </div>
      </div>

      {/* Right: Gherkin preview */}
      <div className="w-72 flex-shrink-0 border-l border-surface-600 flex flex-col">
        <div className="flex items-center justify-between px-3 py-3 border-b border-surface-600">
          <span className="text-xs font-semibold text-slate-400">Gherkin Preview</span>
          <button onClick={() => navigator.clipboard.writeText(gherkinPreview)} className="p-1 text-slate-500 hover:text-slate-300 rounded" title="Copy">
            <Copy size={12}/>
          </button>
        </div>
        <pre className="flex-1 overflow-auto p-3 text-xs text-green-300 font-mono leading-relaxed whitespace-pre-wrap">
          {gherkinPreview}
        </pre>
      </div>
    </div>
  )
}
