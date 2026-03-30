import { useState, useEffect, useRef } from 'react'
import { FileText, Plus, Save, Trash2, ChevronDown, ChevronRight, Copy, Zap, Loader2, HelpCircle, Wand2, X } from 'lucide-react'
import api from '../lib/api'
import { useAppStore, TestCase, TestStep } from '../store/appStore'

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
// Each entry also has a `template` (shown in the suggestion dropdown) and a `hint`
const STEP_MAPPINGS: {
  pattern: RegExp
  template: string
  keyword: string
  hint: string
  extract: (m: RegExpMatchArray) => Record<string, string>
}[] = [
  // Browser
  { pattern: /I launch the browser/,         template: 'I launch the browser',                         keyword: 'Web.Launch',        hint: 'Open browser',              extract: () => ({}) },
  { pattern: /I close the browser/,          template: 'I close the browser',                          keyword: 'Web.Close',         hint: 'Close browser',             extract: () => ({}) },
  { pattern: /I navigate to "(.+)"/,         template: 'I navigate to "https://example.com"',          keyword: 'NavigateTo',        hint: 'Navigate to URL',           extract: (m) => ({ url: m[1] }) },
  { pattern: /I go back/,                    template: 'I go back',                                    keyword: 'GoBack',            hint: 'Browser back',              extract: () => ({}) },
  { pattern: /I reload the page/,            template: 'I reload the page',                            keyword: 'Reload',            hint: 'Refresh page',              extract: () => ({}) },
  // Interaction
  { pattern: /I click(?: on)? "(.+)"/,       template: 'I click "#button"',                            keyword: 'Click',             hint: 'Click element',             extract: (m) => ({ locator: m[1] }) },
  { pattern: /I double.?click "(.+)"/,       template: 'I double-click "#element"',                    keyword: 'DoubleClick',       hint: 'Double-click element',      extract: (m) => ({ locator: m[1] }) },
  { pattern: /I right.?click "(.+)"/,        template: 'I right-click "#element"',                     keyword: 'RightClick',        hint: 'Right-click element',       extract: (m) => ({ locator: m[1] }) },
  { pattern: /I enter "(.+)" in(?: the)? "(.+)"/, template: 'I enter "value" in "#input"',             keyword: 'EnterText',         hint: 'Type text into field',      extract: (m) => ({ locator: m[2], value: m[1] }) },
  { pattern: /I type "(.+)" into "(.+)"/,    template: 'I type "value" into "#input"',                 keyword: 'EnterText',         hint: 'Type text into field',      extract: (m) => ({ locator: m[2], value: m[1] }) },
  { pattern: /I select "(.+)" from "(.+)"/, template: 'I select "option" from "#dropdown"',           keyword: 'SelectOption',      hint: 'Select dropdown option',    extract: (m) => ({ locator: m[2], option: m[1] }) },
  { pattern: /I press "(.+)"/,               template: 'I press "Enter"',                              keyword: 'PressKey',          hint: 'Press keyboard key',        extract: (m) => ({ key: m[1] }) },
  { pattern: /I hover over "(.+)"/,          template: 'I hover over "#element"',                      keyword: 'Hover',             hint: 'Hover mouse over element',  extract: (m) => ({ locator: m[1] }) },
  { pattern: /I scroll to "(.+)"/,           template: 'I scroll to "#element"',                       keyword: 'ScrollTo',          hint: 'Scroll element into view',  extract: (m) => ({ locator: m[1] }) },
  { pattern: /I check "(.+)"/,               template: 'I check "#checkbox"',                          keyword: 'Check',             hint: 'Check a checkbox',          extract: (m) => ({ locator: m[1] }) },
  { pattern: /I uncheck "(.+)"/,             template: 'I uncheck "#checkbox"',                        keyword: 'Uncheck',           hint: 'Uncheck a checkbox',        extract: (m) => ({ locator: m[1] }) },
  // Wait
  { pattern: /I wait for "(.+)"/,            template: 'I wait for "#element"',                        keyword: 'WaitForVisible',    hint: 'Wait until element visible', extract: (m) => ({ locator: m[1] }) },
  { pattern: /I wait for "(.+)" to be hidden/, template: 'I wait for "#element" to be hidden',         keyword: 'WaitForHidden',     hint: 'Wait until element hidden', extract: (m) => ({ locator: m[1] }) },
  { pattern: /I wait (\d+) (?:ms|milliseconds)/, template: 'I wait 2000 ms',                           keyword: 'Wait',              hint: 'Fixed wait (ms)',           extract: (m) => ({ ms: m[1] }) },
  // Assert
  { pattern: /I should see "(.+)"/,          template: 'I should see "Welcome"',                       keyword: 'AssertText',        hint: 'Assert text on page',       extract: (m) => ({ locator: 'body', expected: m[1] }) },
  { pattern: /I see "(.+)"/,                 template: 'I see "#success-msg"',                         keyword: 'AssertVisible',     hint: 'Assert element visible',    extract: (m) => ({ locator: m[1] }) },
  { pattern: /I don't see "(.+)"/,           template: 'I don\'t see "#error"',                        keyword: 'AssertNotVisible',  hint: 'Assert element not visible', extract: (m) => ({ locator: m[1] }) },
  { pattern: /the text of "(.+)" (?:is|equals) "(.+)"/, template: 'the text of "#h1" is "Dashboard"', keyword: 'AssertText',        hint: 'Assert element text',       extract: (m) => ({ locator: m[1], expected: m[2] }) },
  { pattern: /the page title is "(.+)"/,     template: 'the page title is "My App"',                   keyword: 'AssertTitle',       hint: 'Assert page title',         extract: (m) => ({ expected: m[1] }) },
  { pattern: /the URL contains "(.+)"/,      template: 'the URL contains "/dashboard"',                keyword: 'AssertUrl',         hint: 'Assert URL',                extract: (m) => ({ expected: m[1] }) },
  { pattern: /"(.+)" is enabled/,            template: '"#submit" is enabled',                         keyword: 'AssertEnabled',     hint: 'Assert element enabled',    extract: (m) => ({ locator: m[1] }) },
  // Capture
  { pattern: /I take a screenshot/,          template: 'I take a screenshot',                          keyword: 'TakeScreenshot',    hint: 'Capture screenshot',        extract: () => ({}) },
  { pattern: /I take a screenshot "(.+)"/,   template: 'I take a screenshot "login-page"',             keyword: 'TakeScreenshot',    hint: 'Named screenshot',          extract: (m) => ({ name: m[1] }) },
  // SAP
  { pattern: /I connect to SAP "(.+)"/,      template: 'I connect to SAP "ECC Dev"',                   keyword: 'SAP.Connect',       hint: 'Connect to SAP system',     extract: (m) => ({ system: m[1] }) },
  { pattern: /I login to SAP with "(.+)" and "(.+)"/, template: 'I login to SAP with "{{TEST_DATA.user}}" and "{{TEST_DATA.pass}}"', keyword: 'SAP.Login', hint: 'SAP login', extract: (m) => ({ username: m[1], password: m[2] }) },
  { pattern: /I run transaction "(.+)"/,     template: 'I run transaction "VA01"',                     keyword: 'SAP.RunTCode',      hint: 'Run SAP transaction',       extract: (m) => ({ tcode: m[1] }) },
  { pattern: /I set SAP field "(.+)" to "(.+)"/, template: 'I set SAP field "wnd[0]/usr/txtFIELD" to "value"', keyword: 'SAP.SetText', hint: 'Set SAP field value', extract: (m) => ({ fieldId: m[1], value: m[2] }) },
  { pattern: /I disconnect from SAP/,        template: 'I disconnect from SAP',                        keyword: 'SAP.Disconnect',    hint: 'Disconnect SAP session',    extract: () => ({}) },
]

/** Return all templates whose text partially matches the user's input */
function getSuggestions(text: string): typeof STEP_MAPPINGS {
  if (!text.trim()) return STEP_MAPPINGS.slice(0, 8) // show first 8 as default hints
  const lower = text.toLowerCase()
  const matched = STEP_MAPPINGS.filter(m => {
    if (m.pattern.test(text)) return true  // already a full match
    return m.template.toLowerCase().includes(lower) ||
           m.keyword.toLowerCase().includes(lower) ||
           m.hint.toLowerCase().includes(lower)
  })
  return matched.length > 0 ? matched : STEP_MAPPINGS.slice(0, 5)
}

function mapStep(text: string): { keyword: string; params: Record<string, string> } | undefined {
  for (const { pattern, keyword, extract } of STEP_MAPPINGS) {
    const m = text.match(pattern)
    if (m) return { keyword, params: extract(m) }
  }
  return undefined
}

/** Inline step input with live keyword suggestion dropdown */
function StepInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const suggestions = getSuggestions(value)
  const isOpen = (focused || open) && suggestions.length > 0

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false); setFocused(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={containerRef} className="relative flex-1">
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        className="w-full input text-xs font-mono"
        placeholder='e.g. I click "#submit" or I navigate to "https://…"'
      />
      {isOpen && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-surface-800 border border-surface-500 rounded-lg shadow-xl overflow-hidden max-h-52 overflow-y-auto">
          <div className="px-2 py-1 border-b border-surface-600 flex items-center gap-1">
            <HelpCircle size={10} className="text-slate-500" />
            <span className="text-[10px] text-slate-500">Step templates — click to use</span>
          </div>
          {suggestions.map((s, i) => (
            <button
              key={i}
              onMouseDown={e => { e.preventDefault(); onChange(s.template); setOpen(false); setFocused(false) }}
              className="w-full text-left px-3 py-1.5 hover:bg-surface-700 flex items-center gap-2 group"
            >
              <span className="text-[10px] font-mono text-brand-400 w-28 flex-shrink-0 truncate">{s.keyword}</span>
              <span className="text-[11px] text-slate-300 font-mono flex-1 truncate">{s.template}</span>
              <span className="text-[10px] text-slate-600 group-hover:text-slate-400 flex-shrink-0">{s.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
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

/** Parse a .feature file back into a GherkinFeature object */
function parseFeatureFile(content: string, filePath: string): GherkinFeature | null {
  try {
    const lines = content.split('\n')
    let featureName = 'Feature'
    let description = ''
    const scenarios: GherkinScenario[] = []
    let current: GherkinScenario | null = null
    let inExamples = false
    const exampleLines: string[] = []

    for (const raw of lines) {
      const line = raw.trim()
      if (line.startsWith('Feature:')) {
        featureName = line.replace('Feature:', '').trim()
      } else if (line.startsWith('Scenario Outline:') || line.startsWith('Scenario:')) {
        if (current) {
          if (inExamples) { current.examples = exampleLines.join('\n'); exampleLines.length = 0; inExamples = false }
          scenarios.push(current)
        }
        const isOutline = line.startsWith('Scenario Outline:')
        current = { id: uid(), type: isOutline ? 'Scenario Outline' : 'Scenario', name: line.replace(/Scenario(?: Outline)?:/, '').trim(), steps: [] }
      } else if (line.startsWith('Examples:')) {
        inExamples = true
      } else if (inExamples && line) {
        exampleLines.push(line)
      } else if (current && /^(Given|When|Then|And|But) /.test(line)) {
        const kw = line.split(' ')[0] as GherkinStep['keyword']
        const text = line.slice(kw.length + 1)
        const mapped = mapStep(text)
        current.steps.push({ id: uid(), keyword: kw, text, prabalaKeyword: mapped?.keyword, prabalaParams: mapped?.params })
      } else if (!current && line && !line.startsWith('#')) {
        description = line
      }
    }
    if (current) {
      if (inExamples) current.examples = exampleLines.join('\n')
      scenarios.push(current)
    }
    return { id: uid(), filePath, feature: featureName, description, scenarios, isDirty: false }
  } catch { return null }
}

/** Convert one Gherkin scenario into a Prabala YAML TestCase */
function scenarioToTestCase(scenario: GherkinScenario, feature: GherkinFeature): TestCase {
  const steps: TestStep[] = scenario.steps
    .filter(s => s.prabalaKeyword)
    .map(s => ({
      id: crypto.randomUUID(),
      keyword: s.prabalaKeyword!,
      params: (s.prabalaParams ?? {}) as Record<string, string>,
      description: `${s.keyword} ${s.text}`,
      continueOnFailure: false,
    }))
  return {
    id: crypto.randomUUID(),
    filePath: '',
    testCase: `${feature.feature} – ${scenario.name}`,
    tags: ['bdd', 'gherkin'],
    description: `Generated from Gherkin: ${scenario.name}`,
    steps,
    isDirty: true,
  }
}

/** Groups for the keyword reference panel */
const KEYWORD_GROUPS: { label: string; color: string; items: typeof STEP_MAPPINGS }[] = [
  { label: 'Browser', color: 'text-blue-400', items: STEP_MAPPINGS.filter(m => ['Web.Launch','Web.Close','NavigateTo','GoBack','Reload'].includes(m.keyword)) },
  { label: 'Interaction', color: 'text-yellow-400', items: STEP_MAPPINGS.filter(m => ['Click','DoubleClick','RightClick','EnterText','SelectOption','PressKey','Hover','ScrollTo','Check','Uncheck'].includes(m.keyword)) },
  { label: 'Wait', color: 'text-purple-400', items: STEP_MAPPINGS.filter(m => ['WaitForVisible','WaitForHidden','Wait'].includes(m.keyword)) },
  { label: 'Assert', color: 'text-green-400', items: STEP_MAPPINGS.filter(m => ['AssertText','AssertVisible','AssertNotVisible','AssertTitle','AssertUrl','AssertEnabled'].includes(m.keyword)) },
  { label: 'Capture', color: 'text-orange-400', items: STEP_MAPPINGS.filter(m => ['TakeScreenshot'].includes(m.keyword)) },
  { label: 'SAP', color: 'text-rose-400', items: STEP_MAPPINGS.filter(m => ['SAP.Connect','SAP.Login','SAP.RunTCode','SAP.SetText','SAP.Disconnect'].includes(m.keyword)) },
]

function RightPanel({ gherkinPreview, onInsert }: { gherkinPreview: string; onInsert: (template: string) => void }) {
  const [tab, setTab] = useState<'keywords' | 'preview'>('keywords')
  const [copied, setCopied] = useState<string | null>(null)
  const copyTemplate = (tpl: string) => {
    navigator.clipboard.writeText(tpl)
    setCopied(tpl)
    setTimeout(() => setCopied(null), 1200)
  }
  return (
    <div className="w-72 flex-shrink-0 border-l border-surface-600 flex flex-col">
      {/* Tab bar */}
      <div className="flex border-b border-surface-600">
        <button onClick={() => setTab('keywords')} className={`flex-1 py-2 text-xs font-semibold ${tab === 'keywords' ? 'text-brand-400 border-b-2 border-brand-400' : 'text-slate-400 hover:text-slate-300'}`}>
          Keywords
        </button>
        <button onClick={() => setTab('preview')} className={`flex-1 py-2 text-xs font-semibold ${tab === 'preview' ? 'text-brand-400 border-b-2 border-brand-400' : 'text-slate-400 hover:text-slate-300'}`}>
          Preview
        </button>
      </div>

      {tab === 'keywords' ? (
        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          <p className="text-xs text-slate-500 px-1">Click a keyword to add it to the last open scenario, or click the copy icon to paste it yourself.</p>
          {KEYWORD_GROUPS.map(group => (
            <div key={group.label}>
              <div className={`text-xs font-bold px-1 mb-1 ${group.color}`}>{group.label}</div>
              {group.items.map(item => (
                <div key={item.template} className="flex items-start gap-1 group/row px-1 py-0.5 rounded hover:bg-surface-600">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-slate-200 font-mono truncate">{item.template}</div>
                    <div className="text-[10px] text-slate-500">{item.hint} → <span className="text-brand-300">{item.keyword}</span></div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity">
                    <button onClick={() => onInsert(item.template)} title="Add to scenario" className="p-0.5 text-slate-400 hover:text-green-400 rounded">
                      <Plus size={11}/>
                    </button>
                    <button onClick={() => copyTemplate(item.template)} title="Copy template" className="p-0.5 text-slate-400 hover:text-blue-400 rounded">
                      {copied === item.template ? <span className="text-green-400 text-[10px]">✓</span> : <Copy size={11}/>}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-end px-3 py-2 border-b border-surface-600">
            <button onClick={() => navigator.clipboard.writeText(gherkinPreview)} className="p-1 text-slate-500 hover:text-slate-300 rounded" title="Copy">
              <Copy size={12}/>
            </button>
          </div>
          <pre className="flex-1 overflow-auto p-3 text-xs text-green-300 font-mono leading-relaxed whitespace-pre-wrap">
            {gherkinPreview}
          </pre>
        </>
      )}
    </div>
  )
}

export default function GherkinPage() {
  const { projectDir, testCases, setTestCases, setActiveTestCase, setActivePage } = useAppStore((s) => ({
    projectDir: s.projectDir ?? '',
    testCases: s.testCases,
    setTestCases: s.setTestCases,
    setActiveTestCase: s.setActiveTestCase,
    setActivePage: s.setActivePage,
  }))
  const [features, setFeatures] = useState<GherkinFeature[]>([{
    id: uid(), filePath: '', feature: 'My Feature', description: '', scenarios: [], isDirty: true
  }])
  const [activeId, setActiveId] = useState(features[0].id)
  const [expandedScenarios, setExpandedScenarios] = useState<Set<string>>(new Set())
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // AI generation
  const [aiOpen, setAiOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiStreaming, setAiStreaming] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const aiInputRef = useRef<HTMLTextAreaElement>(null)

  // Load existing .feature files from disk whenever projectDir changes
  useEffect(() => {
    if (!projectDir) return
    let cancelled = false
    async function loadFeatures() {
      setLoading(true)
      try {
        const testsDir = `${projectDir}/tests`
        const exists: boolean = await api.fs.exists(testsDir)
        if (!exists) return
        const entries: { name: string; isDir: boolean; path: string }[] = await api.fs.readDir(testsDir)
        const featureFiles = entries.filter(e => !e.isDir && e.name.endsWith('.feature'))
        if (featureFiles.length === 0) return
        const loaded: GherkinFeature[] = []
        for (const file of featureFiles) {
          try {
            const content: string = await api.fs.readFile(file.path)
            const parsed = parseFeatureFile(content, file.path)
            if (parsed) loaded.push(parsed)
          } catch {}
        }
        if (!cancelled && loaded.length > 0) {
          setFeatures(loaded)
          setActiveId(loaded[0].id)
        }
      } catch {} finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadFeatures()
    return () => { cancelled = true }
  }, [projectDir])

  // Pick up Gherkin generated from RequirementsPage and add it as a new feature
  useEffect(() => {
    const pending = sessionStorage.getItem('prabala_pending_gherkin')
    const featureName = sessionStorage.getItem('prabala_pending_gherkin_feature') ?? 'Requirements'
    if (!pending) return
    sessionStorage.removeItem('prabala_pending_gherkin')
    sessionStorage.removeItem('prabala_pending_gherkin_feature')
    const parsed = parseFeatureFile(pending, '')
    if (!parsed) return
    const feature: GherkinFeature = { ...parsed, feature: featureName, isDirty: true }
    setFeatures(fs => {
      const exists = fs.some(f => f.feature === featureName && f.filePath === '')
      return exists ? fs : [...fs, feature]
    })
    setActiveId(feature.id)
    setExpandedScenarios(s => { const n = new Set(s); feature.scenarios.forEach(sc => n.add(sc.id)); return n })
  }, [])

  const ipc = api

  function buildGherkinSystemPrompt(): string {
    const templates = STEP_MAPPINGS.map(m => `  - "${m.template}"  → ${m.keyword}`).join('\n')
    return `You are a Gherkin scenario writer for the Prabala test automation framework.
Generate a Gherkin scenario based on the user's description.

OUTPUT FORMAT — return ONLY raw Gherkin, no markdown fences, no explanations:
Scenario: <title>
  Given <step>
  When <step>
  Then <step>
  And <step>

RULES:
1. Use ONLY these exact step templates (fill in the quoted placeholders with real values):
${templates}
2. Start each line with Given / When / Then / And / But followed by a space and the step text.
3. Use 2-space indentation for steps.
4. Do NOT add any text before or after the scenario block.
5. Do NOT use markdown code blocks.
6. Keep it concise — 3 to 8 steps.`
  }

  function parseGherkinFromAI(text: string): GherkinScenario | null {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    const titleLine = lines.find(l => /^Scenario(?: Outline)?:/i.test(l))
    const name = titleLine ? titleLine.replace(/^Scenario(?: Outline)?:\s*/i, '') : 'AI Generated Scenario'
    const isOutline = /Scenario Outline:/i.test(titleLine ?? '')
    const steps: GherkinStep[] = []
    for (const line of lines) {
      const m = line.match(/^(Given|When|Then|And|But)\s+(.+)/i)
      if (m) {
        const keyword = (m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()) as GherkinStep['keyword']
        const stepText = m[2].trim()
        const mapped = mapStep(stepText)
        steps.push({ id: uid(), keyword, text: stepText, prabalaKeyword: mapped?.keyword, prabalaParams: mapped?.params })
      }
    }
    if (steps.length === 0) return null
    return { id: uid(), type: isOutline ? 'Scenario Outline' : 'Scenario', name, steps }
  }

  async function generateWithAI() {
    const prompt = aiPrompt.trim()
    if (!prompt || aiStreaming) return
    if (!ipc?.ai) { setAiError('AI is not configured. Set your API key in Settings.'); return }
    setAiError(null)
    setAiStreaming(true)
    let buffer = ''
    ipc.ai.removeListeners?.()
    ipc.ai.onChunk((token: string) => { buffer += token })
    ipc.ai.onDone(() => {
      setAiStreaming(false)
      ipc.ai.removeListeners?.()
      const scenario = parseGherkinFromAI(buffer)
      if (!scenario) { setAiError('AI did not return a valid Gherkin scenario. Try rephrasing.'); return }
      updateFeature(active.id, { scenarios: [...active.scenarios, scenario] })
      setExpandedScenarios(s => { const n = new Set(s); n.add(scenario.id); return n })
      setAiPrompt('')
      setAiOpen(false)
    })
    try {
      await ipc.ai.chat([{ role: 'user', content: prompt }], buildGherkinSystemPrompt())
    } catch (err: any) {
      setAiError(err?.message ?? 'AI request failed')
      setAiStreaming(false)
      ipc.ai.removeListeners?.()
    }
  }

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
    if (!projectDir) { setSaveMsg('No project open'); setTimeout(() => setSaveMsg(null), 2500); return }
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

  function sendScenarioToBuilder(scenario: GherkinScenario) {
    const tc = scenarioToTestCase(scenario, active)
    setTestCases([...testCases, tc])
    setActiveTestCase(tc)
    setActivePage('builder')
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
            <button onClick={() => { setAiOpen(o => !o); setAiError(null); setTimeout(() => aiInputRef.current?.focus(), 50) }}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                aiOpen ? 'bg-purple-600/30 border-purple-500/50 text-purple-300' : 'border-surface-500 text-slate-400 hover:text-purple-300 hover:border-purple-500/50'
              }`}>
              <Wand2 size={12}/> Generate with AI
            </button>
            <button onClick={saveFeature} className="btn-primary text-xs flex items-center gap-1.5"><Save size={12}/> Save</button>
          </div>
        </div>

        {/* AI generation panel */}
        {aiOpen && (
          <div className="flex-shrink-0 border-b border-surface-600 bg-purple-900/10 px-4 py-3">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <p className="text-xs text-slate-400 mb-1.5">Describe the scenario you want to test in plain English:</p>
                <textarea
                  ref={aiInputRef}
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generateWithAI() }}
                  rows={2}
                  placeholder='e.g. "Login with valid credentials and verify the dashboard is shown"'
                  className="w-full bg-surface-800 border border-surface-500 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-purple-500/60 resize-none"
                />
                {aiError && <p className="text-xs text-red-400 mt-1">{aiError}</p>}
              </div>
              <div className="flex flex-col gap-1.5 flex-shrink-0 pt-5">
                <button onClick={generateWithAI} disabled={aiStreaming || !aiPrompt.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-semibold transition-colors">
                  {aiStreaming ? <><Loader2 size={12} className="animate-spin"/> Generating…</> : <><Wand2 size={12}/> Generate</>}
                </button>
                <button onClick={() => { setAiOpen(false); setAiError(null) }} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-surface-500 text-slate-400 hover:text-slate-300 text-xs">
                  <X size={11}/> Cancel
                </button>
              </div>
            </div>
            <p className="text-[10px] text-slate-600 mt-1.5">Tip: ⌘+Enter to generate · AI will use only the available Prabala keyword templates</p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-slate-500 text-xs">
              <Loader2 size={13} className="animate-spin" />
              Loading feature files…
            </div>
          )}
          <input value={active.description} onChange={(e) => updateFeature(active.id, { description: e.target.value })}
            placeholder="Feature description (optional)…"
            className="input w-full text-xs" />

          {active.scenarios.map((scenario) => {
            const isExpanded = expandedScenarios.has(scenario.id)
            return (
              <div key={scenario.id} className="bg-surface-700 border border-surface-600 rounded-xl overflow-visible">
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
                  <button
                    onClick={() => sendScenarioToBuilder(scenario)}
                    title="Send to Test Builder as YAML test case"
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-brand-600/30 hover:bg-brand-600/60 border border-brand-500/40 text-brand-300 text-[10px] font-semibold transition-colors flex-shrink-0"
                  >
                    <Zap size={10} /> Send to Builder
                  </button>
                  <button onClick={() => deleteScenario(scenario.id)} className="p-1 text-slate-600 hover:text-red-400 rounded"><Trash2 size={12}/></button>
                </div>

                {isExpanded && (
                  <div className="p-3 space-y-1.5">
                    {scenario.steps.map((step) => (
                      <div key={step.id} className="flex items-center gap-2">
                        <select value={step.keyword} onChange={(e) => updateStep(scenario.id, step.id, { keyword: e.target.value as any })}
                          className={`bg-surface-800 border border-surface-500 rounded px-1.5 py-1 text-xs font-bold w-16 flex-shrink-0 ${STEP_COLORS[step.keyword]}`}>
                          {KW_KEYWORDS.map((k) => <option key={k} value={k}>{k}</option>)}
                        </select>
                        <StepInput
                          value={step.text}
                          onChange={v => updateStep(scenario.id, step.id, { text: v })}
                        />
                        {step.prabalaKeyword && (
                          <span className="text-[10px] text-brand-400 bg-brand-900/30 px-1.5 py-0.5 rounded font-mono flex-shrink-0">→ {step.prabalaKeyword}</span>
                        )}
                        <button onClick={() => deleteStep(scenario.id, step.id)} className="p-1 text-slate-600 hover:text-red-400 rounded flex-shrink-0"><Trash2 size={11}/></button>
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

      {/* Right: keyword reference + preview */}
      <RightPanel gherkinPreview={gherkinPreview} onInsert={(template) => {
        // find the active scenario to insert into — use first expanded one
        const target = active.scenarios.find(s => expandedScenarios.has(s.id)) ?? active.scenarios[active.scenarios.length - 1]
        if (!target) return
        const step = { id: uid(), keyword: 'When' as const, text: template, prabalaKeyword: undefined, prabalaParams: undefined }
        const mapped = mapStep(template)
        updateScenario(target.id, { steps: [...target.steps, { ...step, prabalaKeyword: mapped?.keyword, prabalaParams: mapped?.params }] })
      }} />
    </div>
  )
}
