import { useState, useEffect, useRef } from 'react'
import { useAppStore, TestCase, TestStep, ComponentDef } from '../store/appStore'
import {
  Plus, Trash2, Save, GripVertical, ChevronDown,
  ChevronRight, FilePlus, Tag, Copy, Circle, Square, Wifi,
  CheckCircle2, AlertCircle, Loader2, Brain, Send, Sparkles,
  X, ChevronLeft, Zap, ClipboardList, Wand2, Database, AtSign, Puzzle, Crosshair,
  Eye, EyeOff, RefreshCw, RotateCcw
} from 'lucide-react'
import yaml from 'js-yaml'
import TestExplorer from '../components/TestExplorer'
import { loadProjectData } from '../utils/projectLoader'
import api from '../lib/api'

// ── AI helpers ────────────────────────────────────────────────────────────────

interface AIChatMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  /** true = AI-generated automatically (not from user prompt) */
  auto?: boolean
  /** short label of what triggered this auto-analysis */
  trigger?: string
  /** true = AI steps were auto-applied into the test builder */
  autoApplied?: boolean
  /** number of steps auto-applied */
  autoAppliedCount?: number
}

type ParsedAIStep = Omit<TestStep, 'id'> & { step_number?: number }

function parseYamlToSteps(yamlText: string): ParsedAIStep[] | null {
  try {
    const doc = yaml.load(yamlText) as any
    const rawSteps: any[] = Array.isArray(doc) ? doc : (doc?.steps ?? null)
    if (!Array.isArray(rawSteps)) return null
    return rawSteps.map(s => ({
      keyword: String(s.keyword ?? ''),
      params: s.params && typeof s.params === 'object' ? s.params : {},
      description: s.description ?? '',
      continueOnFailure: s.continueOnFailure ?? false,
      step_number: typeof s.step_number === 'number' ? s.step_number : undefined,
    })).filter(s => s.keyword)
  } catch { return null }
}

/** Splits assistant text into plain-text and yaml code-block segments */
function splitContent(text: string) {
  const parts: { type: 'text' | 'yaml'; content: string }[] = []
  const re = /```(?:yaml|yml)\n([\s\S]*?)```/g
  let last = 0, m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'text', content: text.slice(last, m.index) })
    parts.push({ type: 'yaml', content: m[1] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ type: 'text', content: text.slice(last) })
  return parts
}

const KEYWORD_CATEGORIES: Record<string, string[]> = {
  'Components': ['UseComponent'],
  'Browser': ['Web.Launch', 'Web.Close', 'NavigateTo', 'GoBack', 'Reload'],
  'Interaction': ['Click', 'DoubleClick', 'RightClick', 'EnterText', 'PressKey', 'SelectOption', 'Hover', 'ScrollTo', 'Check', 'Uncheck', 'UploadFile'],
  'Wait': ['WaitForVisible', 'WaitForHidden', 'WaitForNavigation', 'Wait'],
  'Assert': ['AssertVisible', 'AssertNotVisible', 'AssertText', 'AssertTitle', 'AssertUrl', 'AssertEnabled', 'AssertValue'],
  'Capture': ['GetText', 'GetValue', 'TakeScreenshot'],
  'Dialog': ['AcceptAlert', 'DismissAlert', 'SwitchToFrame'],
  'API': ['API.GET', 'API.POST', 'API.AssertStatus', 'API.AssertBody'],
  'Desktop': [
    'Desktop.LaunchApp', 'Desktop.CloseApp',
    'Desktop.Click', 'Desktop.DoubleClick', 'Desktop.RightClick', 'Desktop.Hover',
    'Desktop.EnterText', 'Desktop.ClearText', 'Desktop.PressKey',
    'Desktop.WaitForVisible', 'Desktop.WaitForHidden', 'Desktop.WaitForEnabled',
    'Desktop.AssertVisible', 'Desktop.AssertNotVisible', 'Desktop.AssertText',
    'Desktop.AssertContainsText', 'Desktop.AssertEnabled', 'Desktop.AssertDisabled',
    'Desktop.GetText', 'Desktop.GetAttribute',
    'Desktop.Scroll', 'Desktop.Maximize', 'Desktop.Minimize', 'Desktop.SetWindowSize',
    'Desktop.TakeScreenshot',
  ],
  'SAP GUI': [
    'SAP.Connect', 'SAP.Disconnect',
    'SAP.Login', 'SAP.Logout',
    'SAP.RunTCode',
    'SAP.SetText', 'SAP.GetText',
    'SAP.PressButton', 'SAP.PressKey',
    'SAP.SelectMenu',
    'SAP.SelectComboBox', 'SAP.SetCheckbox', 'SAP.SelectTab',
    'SAP.GetTableCell', 'SAP.DoubleClickTableRow',
    'SAP.AssertText', 'SAP.AssertContainsText', 'SAP.AssertExists',
    'SAP.AssertStatusBar', 'SAP.GetStatusBar',
    'SAP.TakeScreenshot',
  ],
}

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
  'API.GET': ['url', 'responseAs'], 'API.POST': ['url', 'body', 'responseAs'],
  'API.AssertStatus': ['expected'], 'API.AssertBody': ['path', 'expected'],
  'Desktop.LaunchApp': ['appPath', 'platform', 'appiumUrl'],
  'Desktop.Click': ['locator'], 'Desktop.DoubleClick': ['locator'],
  'Desktop.RightClick': ['locator'], 'Desktop.Hover': ['locator'],
  'Desktop.EnterText': ['locator', 'value'], 'Desktop.ClearText': ['locator'],
  'Desktop.PressKey': ['key'],
  'Desktop.WaitForVisible': ['locator', 'timeout'], 'Desktop.WaitForHidden': ['locator', 'timeout'],
  'Desktop.WaitForEnabled': ['locator', 'timeout'],
  'Desktop.AssertVisible': ['locator'], 'Desktop.AssertNotVisible': ['locator'],
  'Desktop.AssertText': ['locator', 'expected'], 'Desktop.AssertContainsText': ['locator', 'expected'],
  'Desktop.AssertEnabled': ['locator'], 'Desktop.AssertDisabled': ['locator'],
  'Desktop.GetText': ['locator', 'variable'], 'Desktop.GetAttribute': ['locator', 'attribute', 'variable'],
  'Desktop.Scroll': ['locator', 'direction', 'amount'],
  'Desktop.SetWindowSize': ['width', 'height'], 'Desktop.TakeScreenshot': ['name'],
  // Reusable Components
  'UseComponent': ['component'],
  // SAP GUI
  'SAP.Connect':            ['system', 'sessionIndex'],
  'SAP.Disconnect':         [],
  'SAP.Login':              ['client', 'username', 'password', 'language'],
  'SAP.Logout':             [],
  'SAP.RunTCode':           ['tcode'],
  'SAP.SetText':            ['fieldId', 'value'],
  'SAP.GetText':            ['fieldId', 'variable'],
  'SAP.PressButton':        ['buttonId'],
  'SAP.PressKey':           ['key', 'window'],
  'SAP.SelectMenu':         ['menuId'],
  'SAP.SelectComboBox':     ['fieldId', 'key'],
  'SAP.SetCheckbox':        ['fieldId', 'checked'],
  'SAP.SelectTab':          ['tabId'],
  'SAP.GetTableCell':       ['tableId', 'row', 'column', 'variable'],
  'SAP.DoubleClickTableRow':['tableId', 'row', 'column'],
  'SAP.AssertText':         ['fieldId', 'expected'],
  'SAP.AssertContainsText': ['fieldId', 'expected'],
  'SAP.AssertExists':       ['fieldId'],
  'SAP.AssertStatusBar':    ['expected', 'type'],
  'SAP.GetStatusBar':       ['variable'],
  'SAP.TakeScreenshot':     ['name'],
}

function newStep(keyword: string): TestStep {
  const paramKeys = KEYWORD_PARAMS[keyword] ?? []
  const params: Record<string, string> = {}
  paramKeys.forEach(k => { params[k] = '' })
  return { id: crypto.randomUUID(), keyword, params, description: '' }
}

function newTestCase(): TestCase {
  return {
    id: crypto.randomUUID(), filePath: '', testCase: 'New Test Case',
    tags: [], description: '', steps: [], isDirty: true,
  }
}

export default function TestBuilderPage() {
  const { testCases, activeTestCase, setActiveTestCase, setTestCases, updateTestCase, appendStepToActive, markSaved, projectDir, deleteTestCase, setActivePage, objects, componentDefs } = useAppStore()
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())
  const [dragOver, setDragOver] = useState<number | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [kwPanelOpen, setKwPanelOpen] = useState(true)

  // ─ AI Co-Pilot state ──────────────────────────────────────────────────────
  const [aiOpen, setAiOpen] = useState(false)
  const [aiMessages, setAiMessages] = useState<AIChatMsg[]>([])
  const [aiInput, setAiInput] = useState('')
  const [aiStreaming, setAiStreaming] = useState(false)
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null)
  const aiMessagesEndRef = useRef<HTMLDivElement>(null)
  const aiInputRef = useRef<HTMLTextAreaElement>(null)

  // ─ AI Auto-Assist state ───────────────────────────────────────────────────
  const [aiAutoMode, setAiAutoMode] = useState(false)
  // Refs that stay current inside debounce closures without re-renders
  const aiAutoModeRef   = useRef(false)
  const aiOpenRef       = useRef(false)
  const aiStreamingRef  = useRef(false)
  const aiConfigRef     = useRef<boolean | null>(null)
  const autoTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Per-step AI issue annotations: stepId → warning text
  const [stepWarnings, setStepWarnings] = useState<Record<string, string>>({})

  // Keep refs in sync with state
  useEffect(() => { aiAutoModeRef.current  = aiAutoMode  }, [aiAutoMode])
  useEffect(() => { aiOpenRef.current      = aiOpen      }, [aiOpen])
  useEffect(() => { aiStreamingRef.current = aiStreaming  }, [aiStreaming])
  useEffect(() => { aiConfigRef.current    = aiConfigured }, [aiConfigured])

  const [rescanning, setRescanning] = useState(false)

  // ─ Test Data variables (for param picker) ────────────────────────────────
  const [testDataVars, setTestDataVars] = useState<string[]>([])
  const [paramPicker, setParamPicker] = useState<{ stepId: string; key: string } | null>(null)
  const paramPickerRef = useRef<HTMLDivElement>(null)

  // ─ Object picker (@object reference) ─────────────────────────────────────
  const [objectPicker, setObjectPicker] = useState<{ stepId: string; key: string } | null>(null)
  const objectPickerRef = useRef<HTMLDivElement>(null)

  // Load test data variable names from test-data/ files whenever projectDir changes
  useEffect(() => {
    async function loadTestDataVars() {
      const ipc = api
      if (!ipc || !projectDir) return
      try {
        const dirPath = `${projectDir}/test-data`
        const exists = await ipc.fs.exists(dirPath)
        if (!exists) return
        const entries: { name: string; isDir: boolean; path: string }[] = await ipc.fs.readDir(dirPath)
        const keys: string[] = []
        for (const e of entries) {
          if (e.isDir) continue
          const isJson = e.name.endsWith('.json')
          const isYaml = e.name.endsWith('.yaml') || e.name.endsWith('.yml')
          if (!isJson && !isYaml) continue
          try {
            const raw = await ipc.fs.readFile(e.path)
            const parsed = isJson
              ? JSON.parse(raw)
              : (await import('js-yaml')).load(raw)
            if (parsed && typeof parsed === 'object') {
              Object.keys(parsed).forEach(k => { if (!keys.includes(k)) keys.push(k) })
            }
          } catch { /* skip malformed */ }
        }
        setTestDataVars(keys)
      } catch { /* ignore */ }
    }
    loadTestDataVars()
  }, [projectDir])

  // Close param picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (paramPickerRef.current && !paramPickerRef.current.contains(e.target as Node)) {
        setParamPicker(null)
      }
    }
    if (paramPicker) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [paramPicker])

  // Close object picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (objectPickerRef.current && !objectPickerRef.current.contains(e.target as Node)) {
        setObjectPicker(null)
      }
    }
    if (objectPicker) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [objectPicker])

  // Clean up recorder and spy on unmount
  useEffect(() => {
    return () => {
      api.recorder.stop().catch(() => {})
      api.recorder.removeAllListeners()
      api.spy.removeAllListeners()
    }
  }, [])

  const tc = activeTestCase

  // ─ Recording state ───────────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false)
  const [recorderBarOpen, setRecorderBarOpen] = useState(false)
  const [recordUrl, setRecordUrl] = useState('')
  const isElectron = typeof window !== 'undefined' && !!(window as any).prabala
  const [recordedCount, setRecordedCount] = useState(0)
  const [recorderError, setRecorderError] = useState<string | null>(null)
  const [scriptCopied, setScriptCopied] = useState(false)
  const [extensionConnected, setExtensionConnected] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  // Check extension status on mount and whenever recorder bar opens
  useEffect(() => {
    if (isElectron) return
    api.extension.isConnected().then(setExtensionConnected)
  }, [isElectron, recorderBarOpen, isRecording])

  // ─ Spy state ────────────────────────────────────────────────────────────
  const [spyTarget, setSpyTarget] = useState<{ stepId: string; key: string } | null>(null)
  const [spyAnchor, setSpyAnchor] = useState<{ stepId: string; key: string } | null>(null)
  const [spyMode, setSpyMode] = useState<'web' | 'sap' | 'desktop' | 'mobile'>('web')
  const [spyUrl, setSpyUrl] = useState('')
  const [isSpying, setIsSpying] = useState(false)
  const [spyError, setSpyError] = useState<string | null>(null)

  // Cmd+S / Ctrl+S shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        saveTestCase()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tc, projectDir, saveStatus])

  function addStep(keyword: string) {
    if (!tc) return
    const step = newStep(keyword)
    updateTestCase(tc.id, { steps: [...tc.steps, step] })
    scheduleAutoAnalysis(`Step added: ${keyword}`, 2000)
  }

  // ─ Recording ──────────────────────────────────────────────────────────────
  async function startRecording() {
    if (!tc) return
    setRecordedCount(0)
    setRecorderError(null)
    setIsRecording(true)

    // Prepend Web.Launch if the test doesn't already start with one
    if (tc.steps.length === 0 || tc.steps[0].keyword !== 'Web.Launch') {
      const launchStep = newStep('Web.Launch')
      updateTestCase(tc.id, { steps: [launchStep, ...tc.steps] })
    }

    api.recorder.removeAllListeners()
    api.recorder.onStep((step: { keyword: string; params: Record<string, string> }) => {
      ingestStep(step)
    })
    api.recorder.onDone(() => {
      setIsRecording(false)
      api.recorder.removeAllListeners()
    })
    api.recorder.onError((msg: string) => {
      setRecorderError(msg)
    })

    // Launch Playwright browser via the recorder backend
    try {
      await api.recorder.start(recordUrl, projectDir ?? '')
    } catch (err: any) {
      setRecorderError(err?.message || 'Failed to start recorder')
      setIsRecording(false)
    }
  }

  function stopRecording() {
    api.recorder.stop().catch(() => {})
    api.recorder.removeAllListeners()
    setIsRecording(false)
    setRecorderError(null)

    // Append Web.Close if the test doesn't already end with one
    const current = useAppStore.getState().activeTestCase
    if (current && (current.steps.length === 0 || current.steps[current.steps.length - 1].keyword !== 'Web.Close')) {
      appendStepToActive(newStep('Web.Close'))
    }

    // Immediately trigger AI analysis when recording is done (no debounce)
    scheduleAutoAnalysis('Recording completed', 500)
  }

  // Copy the tiny loader snippet — fallback if extension is not installed
  function copyRecordingScript() {
    const origin = window.location.origin
    const snippet = `(function(){var s=document.createElement('script');s.src='${origin}/api/recorder/script?t='+Date.now();document.head.appendChild(s)})();`
    navigator.clipboard.writeText(snippet).then(() => {
      setScriptCopied(true)
      setTimeout(() => setScriptCopied(false), 3000)
    })
  }

  // ─ Spy ────────────────────────────────────────────────────────────────────
  function startSpy(stepId: string, key: string) {
    if (spyMode === 'web' && !spyUrl.trim()) return
    setSpyAnchor(null)
    setSpyError(null)
    setSpyTarget({ stepId, key })
    setIsSpying(true)
    api.spy.removeAllListeners()
    api.spy.onLocator(({ locator }) => {
      // Read fresh state to avoid stale-closure issue (spy callback fires
      // seconds later, after user interacts with the spy browser)
      const { activeTestCase: atc, updateTestCase: utc } = useAppStore.getState()
      if (atc) {
        const step = atc.steps.find(s => s.id === stepId)
        if (step) {
          utc(atc.id, {
            steps: atc.steps.map(s =>
              s.id === stepId ? { ...s, params: { ...s.params, [key]: locator } } : s
            ),
          })
        }
      }
      setSpyTarget(null)
      setIsSpying(false)
      api.spy.removeAllListeners()
    })
    api.spy.onDone(() => {
      setSpyTarget(null)
      setIsSpying(false)
      api.spy.removeAllListeners()
    })
    api.spy.onError((message: string) => {
      setSpyError(message)
    })
    api.spy.start(spyUrl, spyMode)
  }

  function stopSpy() {
    api.spy.stop()
    api.spy.removeAllListeners()
    setSpyTarget(null)
    setIsSpying(false)
    setSpyError(null)
  }

  // Append a recorded step into the active test case via atomic store update
  // (avoids stale-closure overwrite when steps arrive rapidly)
  function ingestStep(raw: { keyword: string; params: Record<string, string> }) {
    const step = newStep(raw.keyword)
    step.params = { ...step.params, ...raw.params }
    appendStepToActive(step)
    setRecordedCount(n => n + 1)
    // Debounce more aggressively during burst recording (3s)
    scheduleAutoAnalysis(`Recorded: ${raw.keyword}`, 3000)
  }

  function removeStep(stepId: string) {
    if (!tc) return
    updateTestCase(tc.id, { steps: tc.steps.filter(s => s.id !== stepId) })
  }

  function updateStep(stepId: string, updates: Partial<TestStep>) {
    if (!tc) return
    updateTestCase(tc.id, {
      steps: tc.steps.map(s => s.id === stepId ? { ...s, ...updates } : s)
    })
  }

  function updateParam(stepId: string, key: string, value: string) {
    if (!tc) return
    const step = tc.steps.find(s => s.id === stepId)
    if (!step) return
    updateStep(stepId, { params: { ...step.params, [key]: value } })
  }

  function toggleStep(stepId: string) {
    setExpandedSteps(prev => {
      const next = new Set(prev)
      next.has(stepId) ? next.delete(stepId) : next.add(stepId)
      return next
    })
  }

  async function rescan() {
    if (!projectDir) return
    setRescanning(true)
    try { await loadProjectData(projectDir) } finally { setRescanning(false) }
  }

  function addNewTestCaseInFolder(folderPath: string) {
    const base = newTestCase()
    const tc2 = { ...base, filePath: `${folderPath}/new-test-${Date.now()}.yaml` }
    setTestCases([...testCases, tc2])
    setActiveTestCase(tc2)
  }

  function duplicateStep(stepId: string) {
    if (!tc) return
    const step = tc.steps.find(s => s.id === stepId)
    if (!step) return
    const newS = { ...step, id: crypto.randomUUID() }
    const idx = tc.steps.findIndex(s => s.id === stepId)
    const steps = [...tc.steps]
    steps.splice(idx + 1, 0, newS)
    updateTestCase(tc.id, { steps })
  }

  async function saveTestCase() {
    if (!tc) return
    if (!projectDir) {
      setSaveError('No workspace selected. Open a workspace folder first.')
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 4000)
      return
    }

    // Strip params where every value is empty — prevents runner failures
    // from unset locators while still writing params that have real values
    const cleanParams = (raw: Record<string, string>) => {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(raw)) {
        if (v !== '') out[k] = v
      }
      return Object.keys(out).length > 0 ? out : undefined
    }

    const yamlContent = yaml.dump({
      testCase: tc.testCase,
      tags: tc.tags.length > 0 ? tc.tags : undefined,
      description: tc.description || undefined,
      dataSource: tc.dataSource || undefined,
      retries: tc.retries || undefined,
      steps: tc.steps.map(s => ({
        keyword: s.keyword,
        params: cleanParams(s.params),
        description: s.description || undefined,
        continueOnFailure: s.continueOnFailure || undefined,
        disabled: s.disabled || undefined,
        retries: s.retries || undefined,
      })),
    }, { lineWidth: 120, noRefs: true })

    setSaveStatus('saving')
    setSaveError(null)
    try {
      // Tests created from BDD/Gherkin or other sources may have no filePath yet —
      // auto-assign one under projectDir/tests/ before writing
      let savePath = tc.filePath
      if (!savePath) {
        const slug = tc.testCase.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        savePath = `${projectDir}/tests/${slug}-${Date.now()}.yaml`
        updateTestCase(tc.id, { filePath: savePath })
      }
      await api.fs.writeFile(savePath, yamlContent)
      markSaved(tc.id)
      setSaveStatus('ok')
      setSaveError(null)
    } catch (err: any) {
      console.error('[Save] failed:', err)
      const msg = err?.message ?? String(err)
      setSaveError(msg)
      setSaveStatus('error')
    } finally {
      setTimeout(() => setSaveStatus('idle'), 4000)
    }
  }

  // Drag reorder
  function onDragStart(idx: number) { setDragIdx(idx) }

  // ─ AI Co-Pilot ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const ipc = api
    if (!ipc?.ai) { setAiConfigured(false); return }
    ipc.ai.getConfig().then((cfg: any) => {
      setAiConfigured(!!(cfg?.apiKey && cfg?.endpoint && cfg?.deployment))
    }).catch(() => setAiConfigured(false))
  }, [aiOpen])

  useEffect(() => {
    aiMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [aiMessages])

  function buildBuilderSystemPrompt() {
    const allKws = Object.values(KEYWORD_CATEGORIES).flat()
    return `You are an expert Prabala test-automation AI assistant embedded directly inside the Test Builder.
The user is building a test case step-by-step. Your job is to help them add, fix, and improve test steps.

## Available Keywords by category
${Object.entries(KEYWORD_CATEGORIES).map(([cat, kws]) => `### ${cat}\n${kws.join(', ')}`).join('\n\n')}

## SAP.* Keyword Notes
- Field IDs follow the SAP GUI component path format: wnd[0]/usr/txtFIELD-NAME
- SAP.PressKey values: Enter | F1..F24 | Back | Save | Cancel | PageUp | PageDown
- SAP.AssertStatusBar type: S=Success E=Error W=Warning I=Info A=Abort
- Use SAP.Connect first, then SAP.Login, then SAP.RunTCode to navigate
- Use {{TEST_DATA.sapPass}} for passwords — never hardcode credentials

## Prabala YAML Step Format
When you output steps, wrap them in a YAML code block like this:
\`\`\`yaml
steps:
  - keyword: SAP.Connect
    params:
      system: "ECC Dev"
  - keyword: SAP.Login
    params:
      client: "100"
      username: "{{TEST_DATA.sapUser}}"
      password: "{{TEST_DATA.sapPass}}"
  - keyword: SAP.RunTCode
    params:
      tcode: "VA01"
\`\`\`

The user can click "Insert into Test" to inject those steps directly into their test.

## Rules
- Output ONLY the steps array inside the yaml block (not the full test file) unless the user asks for a full file
- Use correct keyword names from the list above — SAP.* keywords are cyan in the step editor
- Use 2-space YAML indentation
- For web locators use CSS selectors (#id, .class) or XPath (//tag[@attr='val'])
- Be concise — show the YAML then a brief 1-2 sentence explanation
- If the user pastes a failure log, analyse it and suggest the fixed YAML steps
- ALWAYS include \`step_number: N\` on every suggested step, where N is the 1-based position from the current context. When replacing an existing step use its step_number; when adding new steps after the last one, continue numbering from step count + 1.
`
  }

  function buildContextMessage() {
    if (!tc) return ''
    const stepsYaml = tc.steps.length
      ? yaml.dump({ steps: tc.steps.map((s, i) => ({ step_number: i + 1, keyword: s.keyword, params: s.params, description: s.description || undefined })) }, { lineWidth: 120 })
      : '(no steps yet)'
    return `## Current Test: "${tc.testCase}"
Tags: ${tc.tags.join(', ') || '(none)'}
Step count: ${tc.steps.length}

\`\`\`yaml
${stepsYaml}\`\`\``
  }

  async function sendAIMessage() {
    const text = aiInput.trim()
    if (!text || aiStreaming) return
    const ipc = api
    if (!ipc?.ai) return

    const userMsg: AIChatMsg = { id: crypto.randomUUID(), role: 'user', content: text }
    const assistantId = crypto.randomUUID()
    const assistantMsg: AIChatMsg = { id: assistantId, role: 'assistant', content: '', streaming: true }
    setAiMessages(prev => [...prev, userMsg, assistantMsg])
    setAiInput('')
    setAiStreaming(true)

    // Prepend context about current test state as a system-level user message
    const contextBlock = buildContextMessage()
    const allMessages = [
      ...aiMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: contextBlock ? `${contextBlock}\n\n---\n\n${text}` : text },
    ]

    let buffer = ''
    ipc.ai.removeListeners?.()
    ipc.ai.onChunk((token: string) => {
      buffer += token
      setAiMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: buffer } : m))
    })
    ipc.ai.onDone(() => {
      setAiMessages(prev => prev.map(m => m.id === assistantId ? { ...m, streaming: false } : m))
      setAiStreaming(false)
      ipc.ai.removeListeners?.()
    })

    try {
      await ipc.ai.chat(allMessages, buildBuilderSystemPrompt())
    } catch (err: any) {
      const errText = err?.message ?? String(err)
      setAiMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, content: `⚠️ ${errText}`, streaming: false } : m
      ))
      setAiStreaming(false)
      ipc.ai.removeListeners?.()
    }
  }

  function insertStepsFromYaml(yamlText: string) {
    if (!tc) return
    const parsed = parseYamlToSteps(yamlText)
    if (!parsed || parsed.length === 0) return
    const newSteps: TestStep[] = parsed.map(s => ({
      ...s,
      id: crypto.randomUUID(),
      params: s.params as Record<string, string>,
    }))
    updateTestCase(tc.id, { steps: [...tc.steps, ...newSteps] })
    // expand the newly added steps
    setExpandedSteps(prev => {
      const next = new Set(prev)
      newSteps.forEach(s => next.add(s.id))
      return next
    })
  }

  /**
   * Patch specific steps using step_number (1-based) from AI YAML.
   * fallback='replace' → replaces all steps if no step_number present (Apply Fix)
   * fallback='append'  → appends steps if no step_number present (Insert into Test)
   */
  function patchStepsFromYaml(yamlText: string, fallback: 'replace' | 'append' = 'replace'): number {
    if (!tc) return 0
    const parsed = parseYamlToSteps(yamlText)
    if (!parsed || parsed.length === 0) return 0

    const hasStepNumbers = parsed.some(s => s.step_number != null)

    if (!hasStepNumbers) {
      if (fallback === 'replace') return replaceStepsFromYaml(yamlText)
      insertStepsFromYaml(yamlText)
      return parsed.length
    }

    // Patch only the steps whose step_number was specified
    const updatedSteps = [...tc.steps]
    const expandIds: string[] = []
    let patchedCount = 0

    for (const aiStep of parsed) {
      const { step_number, ...stepData } = aiStep
      const idx = (step_number ?? 0) - 1 // 1-based → 0-based
      const existingId = idx >= 0 && idx < updatedSteps.length ? updatedSteps[idx].id : crypto.randomUUID()
      const newStep: TestStep = {
        ...stepData,
        id: existingId,
        params: stepData.params as Record<string, string>,
      }
      if (idx >= 0 && idx < updatedSteps.length) {
        updatedSteps[idx] = newStep
      } else {
        updatedSteps.push({ ...newStep, id: crypto.randomUUID() })
      }
      expandIds.push(newStep.id)
      patchedCount++
    }

    if (patchedCount > 0) {
      updateTestCase(tc.id, { steps: updatedSteps })
      setExpandedSteps(prev => {
        const next = new Set(prev)
        expandIds.forEach(id => next.add(id))
        return next
      })
      setStepWarnings({})
    }
    return patchedCount
  }

  /** Replace (not append) the current test steps — called when user clicks Apply Fix */
  function replaceStepsFromYaml(yamlText: string): number {
    if (!tc) return 0
    const parsed = parseYamlToSteps(yamlText)
    if (!parsed || parsed.length === 0) return 0
    const newSteps: TestStep[] = parsed.map(s => ({
      ...s,
      id: crypto.randomUUID(),
      params: s.params as Record<string, string>,
    }))
    updateTestCase(tc.id, { steps: newSteps })
    // expand all replaced steps
    setExpandedSteps(new Set(newSteps.map(s => s.id)))
    setStepWarnings({}) // clear warnings — steps are now clean
    return newSteps.length
  }

  /** Called when user clicks 'Apply Fix' on an Auto-Assist YAML block */
  function applyAIFix(msgId: string, yamlText: string) {
    const applied = patchStepsFromYaml(yamlText, 'replace')
    if (applied > 0) {
      setAiMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, autoApplied: true, autoAppliedCount: applied } : m
      ))
    }
  }

  function clearAiChat() {
    setAiMessages([])
    setStepWarnings({})
    ipc_ai_abort()
  }

  function ipc_ai_abort() {
    const ipc = api
    ipc?.ai?.abort().catch(() => {})
    ipc?.ai?.removeListeners?.()
    setAiStreaming(false)
  }

  // ─ Auto-Assist engine ─────────────────────────────────────────────────────

  /** Debounce wrapper — clears previous pending trigger before setting a new one */
  function scheduleAutoAnalysis(reason: string, delayMs = 2000) {
    if (!aiAutoModeRef.current || !aiOpenRef.current) return
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current)
    autoTimerRef.current = setTimeout(() => {
      autoTimerRef.current = null
      triggerAutoAnalysis(reason)
    }, delayMs)
  }

  /** Immediately fire an AI auto-analysis (called after debounce resolves) */
  function triggerAutoAnalysis(reason: string) {
    if (!aiAutoModeRef.current || !aiOpenRef.current) return
    if (aiStreamingRef.current) return  // don't interrupt an ongoing stream
    if (aiConfigRef.current === false) return
    sendAIAutoAnalysis(reason)
  }

  /** Build a concise auto-analysis system prompt focused on instant corrections */
  function buildAutoSystemPrompt(): string {
    return `You are an AI co-pilot in AUTO-ASSIST mode inside Prabala Studio Test Builder.
Your job is to silently watch test steps and give INSTANT, CONCISE feedback.

## Response policy
- If everything looks good → respond with exactly: ✓ Looks good.
- If issues found → one short sentence identifying the problem, then the fix as a \`\`\`yaml steps:\`\`\` block
- MAXIMUM 3 sentences of prose. No lengthy explanations.
- ONLY output a YAML block if you have concrete corrected/missing steps to add.
- Do NOT re-output steps that are already correct.

## What to check
- Empty or placeholder params that should have real values
- Missing assertions after interactions (e.g. click without verify)
- Missing waits before interactions on slow pages
- Missing Web.Close / SAP.Disconnect / Desktop.CloseApp at end
- Credentials hardcoded in YAML (should use {{TEST_DATA.xxx}})
- Logical gaps: login without navigating, form submit without checking result
- Wrong keyword for the action (e.g. EnterText used for a dropdown)

## Available Keywords
${Object.entries(KEYWORD_CATEGORIES).map(([cat, kws]) => `${cat}: ${kws.join(', ')}`).join('\n')}

## Format for corrected steps
\`\`\`yaml
steps:
  - step_number: 4          # 1-based index of the step being replaced/added
    keyword: AssertVisible
    params:
      locator: "#dashboard"
\`\`\`

- ALWAYS include \`step_number: N\` on every step (1-based from the context). This ensures only that specific step is updated in the builder — not the whole test.
`
  }

  async function sendAIAutoAnalysis(trigger: string) {
    const ipc = api
    if (!ipc?.ai) return

    // Get fresh steps from store (avoids stale closure)
    const currentTc = useAppStore.getState().activeTestCase
    if (!currentTc) return

    const stepsYaml = currentTc.steps.length
      ? yaml.dump({ steps: currentTc.steps.map((s, i) => ({ step_number: i + 1, keyword: s.keyword, params: s.params })) }, { lineWidth: 120 })
      : '(no steps yet)'

    const assistantId = crypto.randomUUID()
    const autoMsg: AIChatMsg = { id: assistantId, role: 'assistant', content: '', streaming: true, auto: true, trigger }
    setAiMessages(prev => [...prev, autoMsg])
    setAiStreaming(true)
    aiStreamingRef.current = true

    const analysisRequest = [
      {
        role: 'user' as const,
        content: `## Test: "${currentTc.testCase}"\nTrigger: ${trigger}\n\nCurrent steps:\n\`\`\`yaml\n${stepsYaml}\`\`\`\n\nReview these steps and respond per your instructions.`
      }
    ]

    let buffer = ''
    ipc.ai.removeListeners?.()
    ipc.ai.onChunk((token: string) => {
      buffer += token
      setAiMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: buffer } : m))
    })
    ipc.ai.onDone(() => {
      aiStreamingRef.current = false
      setAiStreaming(false)
      ipc.ai.removeListeners?.()
      // Parse warnings from the response and annotate steps
      const freshTc = useAppStore.getState().activeTestCase
      if (freshTc) parseAndAnnotateWarnings(buffer, freshTc.steps)
      // Mark message as done — user will Apply Fix manually if needed
      setAiMessages(prev => prev.map(m => m.id === assistantId ? { ...m, streaming: false } : m))
    })

    try {
      await ipc.ai.chat(analysisRequest, buildAutoSystemPrompt())
    } catch (err: any) {
      const msg = String(err?.message ?? err)
      setAiMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, content: `⚠️ ${msg}`, streaming: false, } : m
      ))
      aiStreamingRef.current = false
      setAiStreaming(false)
      ipc.ai.removeListeners?.()
    }
  }

  /**
   * Parse AI auto-analysis text and add warning badges on specific steps.
   * Heuristic: if the AI mentions a keyword name, mark every step using that keyword.
   */
  function parseAndAnnotateWarnings(aiText: string, steps: TestStep[]) {
    if (aiText.trim().startsWith('✓')) {
      // All good — clear any existing warnings
      setStepWarnings({})
      return
    }
    const warnings: Record<string, string> = {}
    // Extract the prose part (before the yaml block) as the warning hint
    const prose = aiText.replace(/```[\s\S]*?```/g, '').trim()
    const shortHint = prose.split('\n')[0].slice(0, 120)
    // Match mentioned keyword fragments against actual steps
    steps.forEach(step => {
      const kwLower = step.keyword.toLowerCase()
      if (prose.toLowerCase().includes(kwLower) || prose.toLowerCase().includes(step.keyword.split('.').pop()?.toLowerCase() ?? '')) {
        warnings[step.id] = shortHint
      }
      // Also flag steps with completely empty required params
      const requiredParams = KEYWORD_PARAMS[step.keyword] ?? []
      const allEmpty = requiredParams.length > 0 && requiredParams.every(k => !step.params[k])
      if (allEmpty) warnings[step.id] = warnings[step.id] ?? 'Required parameters are empty'
    })
    setStepWarnings(warnings)
  }

  function onDragOver(e: React.DragEvent, idx: number) { e.preventDefault(); setDragOver(idx) }
  function onDrop(toIdx: number) {
    if (dragIdx === null || !tc) return
    const steps = [...tc.steps]
    const [moved] = steps.splice(dragIdx, 1)
    steps.splice(toIdx, 0, moved)
    updateTestCase(tc.id, { steps })
    setDragIdx(null); setDragOver(null)
  }

  const statusColor = (kw: string) => {
    if (kw.startsWith('Assert')) return 'border-l-yellow-500'
    if (kw.startsWith('Web.') || kw === 'NavigateTo' || kw === 'GoBack' || kw === 'Reload') return 'border-l-blue-500'
    if (kw.startsWith('Desktop.')) return 'border-l-orange-500'
    if (kw.startsWith('API.')) return 'border-l-green-500'
    if (kw.startsWith('Wait')) return 'border-l-purple-500'
    if (kw.startsWith('SAP.')) return 'border-l-cyan-500'
    return 'border-l-brand-500'
  }

  return (
    <div className="flex h-full">
      {/* ── Left: Test Explorer ─────────────────────────────────────── */}
      <div className="w-64 flex-shrink-0 bg-surface-900 border-r border-surface-500 flex flex-col">
        <TestExplorer
          mode="builder"
          projectDir={projectDir ?? ''}
          testCases={testCases}
          onRescan={rescan}
          rescanning={rescanning}
          activeId={tc?.id}
          onSelectTest={setActiveTestCase}
          onCreateTest={addNewTestCaseInFolder}
          onTestDeleted={deleteTestCase}
        />
      </div>

      {/* ── Center: Step Editor ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {tc ? (
          <>
            {/* Header */}
            <div className="flex items-start justify-between px-6 py-4 border-b border-surface-500 bg-surface-800 gap-4">
              <div className="flex-1 min-w-0">
                <input
                  className="input text-base font-semibold bg-transparent border-none px-0 focus:ring-0 text-slate-100"
                  value={tc.testCase}
                  onChange={e => updateTestCase(tc.id, { testCase: e.target.value })}
                  placeholder="Test Case Name"
                />
                <div className="flex items-center gap-2 mt-1">
                  <Tag size={12} className="text-slate-500" />
                  <input
                    className="text-xs text-slate-500 bg-transparent outline-none flex-1"
                    value={tc.tags.join(', ')}
                    onChange={e => updateTestCase(tc.id, { tags: e.target.value.split(',').map((t: string) => t.trim()).filter(Boolean) })}
                    placeholder="Tags: smoke, regression..."
                  />
                </div>
                <div className="flex items-center gap-3 mt-1.5">
                  <div className="flex items-center gap-1.5">
                    <Database size={11} className="text-slate-600" />
                    <input
                      className="text-xs text-slate-500 bg-transparent outline-none w-40 border-b border-transparent hover:border-surface-500 focus:border-brand-500 transition-colors"
                      value={tc.dataSource ?? ''}
                      onChange={e => updateTestCase(tc.id, { dataSource: e.target.value })}
                      placeholder="Data source: test-data/users.json"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <RotateCcw size={11} className="text-slate-600" />
                    <input
                      type="number" min={0} max={5}
                      className="text-xs text-slate-500 bg-transparent outline-none w-8 border-b border-transparent hover:border-surface-500 focus:border-brand-500 transition-colors text-center"
                      value={tc.retries ?? ''}
                      onChange={e => updateTestCase(tc.id, { retries: e.target.value ? parseInt(e.target.value) : undefined })}
                      placeholder="0"
                      title="Test-level retry count"
                    />
                    <span className="text-xs text-slate-600">retries</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0 items-center">
                <span className="text-xs text-slate-600">{tc.steps.length} step{tc.steps.length !== 1 ? 's' : ''}</span>

                {/* ● Record button */}
                {!isRecording ? (
                  <button
                    onClick={() => setRecorderBarOpen(o => !o)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      recorderBarOpen
                        ? 'bg-red-800/40 text-red-300 border border-red-700/40'
                        : 'bg-surface-600 hover:bg-red-900/40 text-slate-300 hover:text-red-300 border border-surface-400'
                    }`}
                    title="Record browser actions"
                  >
                    <Circle size={11} className={recorderBarOpen ? 'fill-red-400 text-red-400' : 'text-slate-400'} />
                    Record
                  </button>
                ) : (
                  <button
                    onClick={stopRecording}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-700/50 hover:bg-red-700/70 text-red-200 border border-red-600/50 transition-colors"
                  >
                    <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                    Stop ({recordedCount})
                  </button>
                )}

                <button
                  onClick={saveTestCase}
                  disabled={saveStatus === 'saving'}
                  className={`flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-colors ${
                    saveStatus === 'ok'    ? 'bg-green-700/50 text-green-200 border border-green-600/50' :
                    saveStatus === 'error' ? 'bg-red-700/50 text-red-200 border border-red-600/50' :
                    saveStatus === 'saving'? 'bg-surface-600 text-slate-400 border border-surface-400 cursor-not-allowed' :
                    'btn-primary'
                  }`}
                >
                  {saveStatus === 'saving' ? <Loader2 size={13} className="animate-spin" /> :
                   saveStatus === 'ok'     ? <CheckCircle2 size={13} /> :
                   saveStatus === 'error'  ? <AlertCircle size={13} /> :
                                            <Save size={13} />}
                  {saveStatus === 'saving' ? 'Saving…' :
                   saveStatus === 'ok'     ? 'Saved!' :
                   saveStatus === 'error'  ? 'Failed!' :
                                            'Save'}
                </button>

                {/* ✦ AI Co-Pilot toggle */}
                <button
                  onClick={() => setAiOpen(o => !o)}
                  title="AI Co-Pilot"
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    aiOpen
                      ? 'bg-brand-600/40 text-brand-200 border border-brand-500/50'
                      : 'bg-surface-600 hover:bg-brand-900/40 text-slate-300 hover:text-brand-300 border border-surface-400'
                  }`}
                >
                  <Brain size={13} />
                  AI
                </button>
              </div>
            </div>

            {/* Recorder bar — slides in below header */}
            {recorderBarOpen && !isRecording && (
              <div className="flex-shrink-0 flex flex-col gap-2 px-6 py-3 bg-red-950/30 border-b border-red-800/40">
                <div className="flex items-center gap-3">
                  <Circle size={13} className="text-red-400 flex-shrink-0" />
                  <span className="text-xs text-red-300 font-semibold flex-shrink-0">Record from URL</span>
                  <input
                    className="input text-xs font-mono flex-1"
                    value={recordUrl}
                    onChange={e => setRecordUrl(e.target.value)}
                    placeholder="https://example.com"
                    onKeyDown={e => { if (e.key === 'Enter') { startRecording(); setRecorderBarOpen(false) } }}
                  />
                  <button
                    onClick={() => { startRecording(); setRecorderBarOpen(false) }}
                    disabled={!tc}
                    className="btn-primary flex items-center gap-1.5 py-1.5 text-xs flex-shrink-0 disabled:opacity-40"
                  >
                    <Wifi size={12} /> Start Recording
                  </button>
                  <button onClick={() => setRecorderBarOpen(false)} className="text-slate-500 hover:text-slate-300 text-xs">×</button>
                </div>
                {!isElectron && (
                  <div className="flex items-center gap-2">
                    {extensionConnected
                      ? <span className="flex items-center gap-1.5 text-xs text-green-400"><CheckCircle2 size={11} /> Prabala Recorder extension connected — recording will start automatically</span>
                      : <span className="text-xs text-amber-400">
                          ⚠ Extension not installed.{' '}
                          <a
                            href={`${window.location.origin}/extension`}
                            target="_blank"
                            rel="noreferrer"
                            className="underline text-purple-400 hover:text-purple-300"
                          >How to install</a>
                          {' '}· or paste a script in the console after clicking Start.
                        </span>
                    }
                  </div>
                )}
              </div>
            )}

            {/* Save error banner */}
            {saveStatus === 'error' && saveError && (
              <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 bg-red-950/50 border-b border-red-700/50">
                <AlertCircle size={13} className="text-red-400 flex-shrink-0" />
                <span className="text-xs text-red-300 flex-1 min-w-0">
                  <span className="font-semibold">Save failed: </span>{saveError}
                </span>
                <button onClick={() => setSaveError(null)} className="text-red-700 hover:text-red-400 flex-shrink-0 text-xs">×</button>
              </div>
            )}

            {/* Recording live banner */}
            {isRecording && (
              <div className="flex-shrink-0 flex flex-col gap-2 px-4 py-3 bg-red-950/50 border-b border-red-700/50">
                <div className="flex items-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                  <span className="text-xs text-red-300 font-semibold">Recording…</span>
                  <span className="text-xs text-slate-400">{recordedCount} step{recordedCount !== 1 ? 's' : ''} captured</span>
                  <span className="text-xs text-slate-500 font-mono ml-1 truncate max-w-xs">{recordUrl || 'any URL'}</span>
                  <div className="ml-auto flex items-center gap-2">
                    {(isElectron || extensionConnected) && (
                      <span className="text-xs text-slate-500">Interact in the recording tab, then click the purple badge to stop</span>
                    )}
                    <button onClick={stopRecording} className="flex items-center gap-1 px-2 py-1 rounded bg-red-800/50 hover:bg-red-800/80 text-red-300 text-xs transition-colors">
                      <Square size={11} /> Stop
                    </button>
                  </div>
                </div>
                {/* Web mode without extension: show manual console fallback */}
                {!isElectron && !extensionConnected && (
                  <div className="flex flex-col gap-2 bg-slate-900/60 rounded-lg px-3 py-2.5 border border-slate-700/40">
                    <p className="text-xs text-amber-300 font-semibold">⚡ Extension not detected — activate recording manually:</p>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xs text-slate-400">1. Open the new tab (F12 → Console)</span>
                      <button
                        onClick={copyRecordingScript}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-purple-800/60 hover:bg-purple-700/60 text-purple-200 text-xs font-semibold transition-colors border border-purple-600/30"
                      >
                        {scriptCopied
                          ? <><CheckCircle2 size={11} className="text-green-400" /> Copied!</>
                          : <><Copy size={11} /> 2. Copy Script</>}
                      </button>
                      <span className="text-xs text-slate-400">3. Paste &amp; Enter → interact with your app</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Install the <span className="text-purple-400 font-semibold">Prabala Recorder extension</span> to skip this step — recording will work exactly like Electron.
                    </p>
                  </div>
                )}
                {recorderError && (
                  <div className="text-xs text-red-300 bg-red-900/40 rounded px-3 py-1.5 border border-red-700/40">{recorderError}</div>
                )}
              </div>
            )}

            {/* Steps */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
              {tc.steps.map((step, idx) => {
                const isExpanded = expandedSteps.has(step.id)
                const paramKeys = KEYWORD_PARAMS[step.keyword] ?? Object.keys(step.params)
                const isDragTarget = dragOver === idx

                return (
                  <div
                    key={step.id}
                    draggable
                    onDragStart={() => onDragStart(idx)}
                    onDragOver={e => onDragOver(e, idx)}
                    onDrop={() => onDrop(idx)}
                    onDragLeave={() => setDragOver(null)}
                    className={`card border-l-4 ${statusColor(step.keyword)} transition-all ${isDragTarget ? 'ring-2 ring-brand-500/50 scale-[1.01]' : ''} ${stepWarnings[step.id] ? 'ring-1 ring-amber-500/40' : ''} ${step.disabled ? 'opacity-50' : ''}`}
                  >
                    {/* Step header */}
                    <div
                      className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-surface-600/30 rounded-t-xl"
                      onClick={() => toggleStep(step.id)}
                    >
                      <GripVertical size={13} className="text-slate-600 cursor-grab flex-shrink-0" />
                      <span className="text-xs text-slate-500 font-mono w-5 text-right flex-shrink-0">{idx + 1}</span>
                      <span className="text-sm font-semibold text-brand-300 flex-1 min-w-0 truncate">{step.keyword}</span>
                      {stepWarnings[step.id] && (
                        <span title={stepWarnings[step.id]} className="flex-shrink-0 w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                      )}
                      {paramKeys.length > 0 && (
                        <span className="text-xs text-slate-500 truncate max-w-[200px] hidden sm:block">
                          {Object.entries(step.params).filter(([,v]) => v).map(([k,v]) => `${k}=${v}`).join(' · ')}
                        </span>
                      )}
                      <div className="flex gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                          title={step.disabled ? 'Enable step' : 'Disable step (skip without failing)'}
                          onClick={() => updateStep(step.id, { disabled: !step.disabled })}
                          className={`p-1 rounded transition-colors ${step.disabled ? 'text-yellow-500 hover:text-yellow-300' : 'text-slate-600 hover:text-yellow-400 hover:bg-surface-500'}`}>
                          {step.disabled ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                        <button onClick={() => duplicateStep(step.id)} className="p-1 hover:bg-surface-500 rounded text-slate-500 hover:text-slate-300">
                          <Copy size={12} />
                        </button>
                        <button onClick={() => removeStep(step.id)} className="p-1 hover:bg-red-900/40 rounded text-slate-500 hover:text-red-400">
                          <Trash2 size={12} />
                        </button>
                        {isExpanded ? <ChevronDown size={13} className="text-slate-500 mt-0.5" /> : <ChevronRight size={13} className="text-slate-500 mt-0.5" />}
                      </div>
                    </div>

                    {/* Expanded params */}
                    {isExpanded && (
                      <div className="px-4 pb-3 pt-1 border-t border-surface-500/50 space-y-2">
                        {/* AI warning inline banner */}
                        {stepWarnings[step.id] && (
                          <div className="flex items-start gap-2 px-2 py-1.5 rounded-md bg-amber-950/40 border border-amber-700/40">
                            <Wand2 size={11} className="text-amber-400 flex-shrink-0 mt-0.5" />
                            <span className="text-[11px] text-amber-300 leading-snug flex-1">{stepWarnings[step.id]}</span>
                            <button
                              onClick={e => { e.stopPropagation(); setStepWarnings(prev => { const n = {...prev}; delete n[step.id]; return n }) }}
                              className="ml-auto text-amber-700 hover:text-amber-400 flex-shrink-0 p-0.5"
                            ><X size={10} /></button>
                          </div>
                        )}
                        <input
                          className="input text-xs text-slate-400 italic"
                          value={step.description}
                          onChange={e => updateStep(step.id, { description: e.target.value })}
                          placeholder="Step description (optional)..."
                        />
                        {/* ── UseComponent special rendering ── */}
                        {step.keyword === 'UseComponent' ? (() => {
                          const selectedComp: ComponentDef | undefined = componentDefs.find(c => c.name === step.params['component'])
                          // Dynamic param keys: component name + selected component's params
                          const compParamKeys = selectedComp ? selectedComp.params : []
                          return (
                            <>
                              {/* Component picker */}
                              <div className="flex items-center gap-2">
                                <label className="text-xs text-slate-500 font-mono w-24 flex-shrink-0">component</label>
                                <div className="relative flex-1">
                                  <Puzzle size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-brand-500 pointer-events-none" />
                                  <select
                                    className="input text-xs font-mono w-full pl-7 text-brand-300"
                                    value={step.params['component'] ?? ''}
                                    onChange={e => {
                                      // When component changes, reset all its params
                                      const comp = componentDefs.find(c => c.name === e.target.value)
                                      const newParams: Record<string, string> = { component: e.target.value }
                                      if (comp) comp.params.forEach(p => { newParams[p] = step.params[p] ?? '' })
                                      updateStep(step.id, { params: newParams })
                                    }}
                                  >
                                    <option value="">— select component —</option>
                                    {componentDefs.map(c => (
                                      <option key={c.id} value={c.name}>{c.name}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              {/* Dynamic params from selected component */}
                              {compParamKeys.map(pKey => (
                                <div key={pKey} className="flex items-center gap-2">
                                  <label className="text-xs text-slate-500 font-mono w-24 flex-shrink-0">{pKey}</label>
                                  <div className="relative flex-1">
                                    <input
                                      className="input text-xs font-mono w-full pr-14"
                                      value={step.params[pKey] ?? ''}
                                      onChange={e => updateParam(step.id, pKey, e.target.value)}
                                      placeholder={`{{TEST_DATA.${pKey}}}`}
                                    />
                                    {/* Object picker */}
                                    {objects.length > 0 && (
                                      <button
                                        type="button"
                                        title="Insert @object reference"
                                        onClick={e => {
                                          e.stopPropagation()
                                          setObjectPicker(prev =>
                                            prev?.stepId === step.id && prev?.key === pKey ? null : { stepId: step.id, key: pKey }
                                          )
                                          setParamPicker(null)
                                        }}
                                        className="absolute right-7 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-600 hover:text-green-400 hover:bg-surface-600 transition-colors"
                                      >
                                        <AtSign size={11} />
                                      </button>
                                    )}
                                    {/* Test data picker */}
                                    {testDataVars.length > 0 && (
                                      <button
                                        type="button"
                                        title="Insert test data variable"
                                        onClick={e => {
                                          e.stopPropagation()
                                          setParamPicker(prev =>
                                            prev?.stepId === step.id && prev?.key === pKey ? null : { stepId: step.id, key: pKey }
                                          )
                                          setObjectPicker(null)
                                        }}
                                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-600 hover:text-brand-400 hover:bg-surface-600 transition-colors"
                                      >
                                        <Database size={11} />
                                      </button>
                                    )}
                                    {/* Object dropdown */}
                                    {objectPicker?.stepId === step.id && objectPicker?.key === pKey && (
                                      <div ref={objectPickerRef} className="absolute z-50 top-full mt-1 left-0 right-0 bg-surface-800 border border-green-700/50 rounded-lg shadow-xl overflow-hidden">
                                        <div className="px-2 py-1.5 border-b border-surface-600 flex items-center gap-1.5">
                                          <AtSign size={10} className="text-green-400" />
                                          <span className="text-[10px] text-green-300 font-semibold">Objects</span>
                                          <span className="text-[10px] text-slate-600 ml-1">grouped by page</span>
                                        </div>
                                        <div className="max-h-52 overflow-y-auto py-1">
                                          {Array.from(new Set(objects.map(o => o.page || 'default'))).sort().map(page => (
                                            <div key={page}>
                                              <div className="px-3 py-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider bg-surface-900/60">{page}</div>
                                              {objects.filter(o => (o.page || 'default') === page).map(obj => (
                                                <button key={obj.key} type="button"
                                                  onClick={() => { updateParam(step.id, pKey, `@${obj.key}`); setObjectPicker(null) }}
                                                  className="w-full text-left px-3 py-1.5 text-xs font-mono text-green-300 hover:bg-green-900/30 hover:text-green-200 transition-colors flex items-center justify-between gap-2"
                                                >
                                                  <span>@{obj.key}</span>
                                                  {obj.description && <span className="text-[10px] text-slate-600 truncate max-w-24">{obj.description}</span>}
                                                </button>
                                              ))}
                                            </div>
                                          ))}
                                          {objects.length === 0 && <p className="text-xs text-slate-600 px-3 py-2 italic">No objects defined yet.</p>}
                                        </div>
                                      </div>
                                    )}
                                    {/* Test data dropdown */}
                                    {paramPicker?.stepId === step.id && paramPicker?.key === pKey && (
                                      <div ref={paramPickerRef} className="absolute z-50 top-full mt-1 left-0 right-0 bg-surface-800 border border-brand-700/50 rounded-lg shadow-xl overflow-hidden">
                                        <div className="px-2 py-1.5 border-b border-surface-600 flex items-center gap-1.5">
                                          <Database size={10} className="text-brand-400" />
                                          <span className="text-[10px] text-brand-300 font-semibold">Test Data</span>
                                        </div>
                                        <div className="max-h-40 overflow-y-auto py-1">
                                          {testDataVars.map(varKey => (
                                            <button key={varKey} type="button"
                                              onClick={() => { updateParam(step.id, pKey, `{{TEST_DATA.${varKey}}}`); setParamPicker(null) }}
                                              className="w-full text-left px-3 py-1.5 text-xs font-mono text-brand-300 hover:bg-brand-800/40 hover:text-brand-200 transition-colors"
                                            >{`{{TEST_DATA.${varKey}}}`}</button>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                              {selectedComp && (
                                <p className="text-[10px] text-slate-600 italic ml-1">
                                  {selectedComp.steps.length} steps · {selectedComp.description || 'No description'}
                                </p>
                              )}
                            </>
                          )
                        })() : (
                        /* ── Generic param rendering ── */
                        paramKeys.map(key => {
                          const isLocator = key === 'locator' || key.toLowerCase().includes('locator')
                          const hasObjects = isLocator && objects.length > 0
                          const hasTestData = testDataVars.length > 0
                          // Button layout (right-to-left): [testdata] [object] [spy]
                          const btnCount = (isLocator ? 1 : 0) + (hasObjects ? 1 : 0) + (hasTestData ? 1 : 0)
                          const inputPr = btnCount >= 3 ? 'pr-[76px]' : btnCount === 2 ? 'pr-14' : btnCount === 1 ? 'pr-7' : ''
                          const objectRight = hasTestData ? 'right-7' : 'right-1.5'
                          const spyRight = hasObjects && hasTestData ? 'right-[52px]' : (hasObjects || hasTestData) ? 'right-7' : 'right-1.5'
                          const isSpyingThisField = spyTarget?.stepId === step.id && spyTarget?.key === key
                          const showSpyPopover = spyAnchor?.stepId === step.id && spyAnchor?.key === key
                          return (
                          <div key={key} className="flex items-center gap-2">
                            <label className="text-xs text-slate-500 font-mono w-24 flex-shrink-0">{key}</label>
                            <div className="relative flex-1">
                              <input
                                className={`input text-xs font-mono w-full ${inputPr} ${isSpyingThisField ? 'border-violet-500/70 ring-1 ring-violet-500/30' : ''}`}
                                value={step.params[key] ?? ''}
                                onChange={e => updateParam(step.id, key, e.target.value)}
                                placeholder={isLocator ? (isSpyingThisField ? '⟳ Waiting for spy pick…' : '@object · spy · css/xpath/text=...') : `{${key.toUpperCase()}} or {{TEST_DATA.x}}`}
                              />
                              {/* ── Spy (crosshair) button — locator fields only ── */}
                              {isLocator && (
                                <button
                                  type="button"
                                  title={isSpyingThisField ? 'Spy active — click element in browser' : 'Spy: open browser to pick an element'}
                                  onClick={e => {
                                    e.stopPropagation()
                                    if (isSpyingThisField) return
                                    setSpyAnchor(prev => prev?.stepId === step.id && prev?.key === key ? null : { stepId: step.id, key })
                                    setSpyUrl(prev => prev || recordUrl)
                                    setSpyError(null)
                                    setObjectPicker(null)
                                    setParamPicker(null)
                                  }}
                                  className={`absolute top-1/2 -translate-y-1/2 p-0.5 rounded transition-colors ${spyRight} ${
                                    isSpyingThisField
                                      ? 'text-violet-400 animate-pulse cursor-default'
                                      : 'text-slate-600 hover:text-violet-400 hover:bg-surface-600'
                                  }`}
                                >
                                  <Crosshair size={11} />
                                </button>
                              )}
                              {/* @Object picker button — only for locator params */}
                              {hasObjects && (
                                <button
                                  type="button"
                                  title="Insert @object reference"
                                  onClick={e => {
                                    e.stopPropagation()
                                    setObjectPicker(prev =>
                                      prev?.stepId === step.id && prev?.key === key ? null : { stepId: step.id, key }
                                    )
                                    setParamPicker(null)
                                    setSpyAnchor(null)
                                  }}
                                  className={`absolute top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-600 hover:text-green-400 hover:bg-surface-600 transition-colors ${objectRight}`}
                                >
                                  <AtSign size={11} />
                                </button>
                              )}
                              {/* Test Data picker button */}
                              {hasTestData && (
                                <button
                                  type="button"
                                  title="Insert test data variable"
                                  onClick={e => {
                                    e.stopPropagation()
                                    setParamPicker(prev =>
                                      prev?.stepId === step.id && prev?.key === key ? null : { stepId: step.id, key }
                                    )
                                    setObjectPicker(null)
                                    setSpyAnchor(null)
                                  }}
                                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-600 hover:text-brand-400 hover:bg-surface-600 transition-colors"
                                >
                                  <Database size={11} />
                                </button>
                              )}
                              {/* ── Spy URL popover ── */}
                              {showSpyPopover && (
                                <div className="absolute z-50 top-full mt-1 left-0 w-80 bg-surface-800 border border-violet-700/50 rounded-lg shadow-xl">
                                  <div className="px-3 py-2 border-b border-surface-600 flex items-center gap-2">
                                    <Crosshair size={11} className="text-violet-400" />
                                    <span className="text-[11px] text-violet-300 font-semibold">Element Spy</span>
                                    <span className="text-[10px] text-slate-500 ml-1">hover &amp; click to capture locator</span>
                                    {isSpying && <span className="ml-auto text-[10px] text-violet-400 animate-pulse">Active…</span>}
                                  </div>
                                  <div className="p-3 space-y-2">
                                    <div className="grid grid-cols-2 gap-2">
                                      <select
                                        className="input text-xs"
                                        value={spyMode}
                                        onChange={e => {
                                          setSpyMode(e.target.value as 'web' | 'sap' | 'desktop' | 'mobile')
                                          setSpyError(null)
                                        }}
                                      >
                                        <option value="web">Web</option>
                                        <option value="sap">SAP</option>
                                        <option value="desktop">Desktop</option>
                                        <option value="mobile">Mobile</option>
                                      </select>
                                      {spyMode !== 'sap' && (
                                        <input
                                          autoFocus
                                          className="input text-xs font-mono w-full"
                                          placeholder={
                                            spyMode === 'web' ? 'https://example.com' :
                                            'http://localhost:4723 (Appium URL)'
                                          }
                                          value={spyUrl}
                                          onChange={e => setSpyUrl(e.target.value)}
                                          onKeyDown={e => {
                                            if (e.key === 'Enter') startSpy(step.id, key)
                                            if (e.key === 'Escape') setSpyAnchor(null)
                                          }}
                                        />
                                      )}
                                      {spyMode === 'sap' && (
                                        <span className="input text-xs font-mono w-full opacity-40 cursor-not-allowed flex items-center">
                                          Connects to running SAP GUI
                                        </span>
                                      )}
                                    </div>
                                    {spyMode === 'desktop' && (
                                      <p className="text-[10px] text-slate-400 leading-relaxed bg-surface-700/40 border border-surface-600 rounded px-2 py-1.5">
                                        Connects to Appium and shows the live accessibility tree of your desktop app. Start Appium and launch your app first.
                                      </p>
                                    )}
                                    {spyMode === 'mobile' && (
                                      <p className="text-[10px] text-slate-400 leading-relaxed bg-surface-700/40 border border-surface-600 rounded px-2 py-1.5">
                                        Connects to Appium and shows the live UI tree of your Android or iOS app. Start Appium and launch your app first.
                                      </p>
                                    )}
                                    {spyMode === 'sap' && (
                                      <p className="text-[10px] text-slate-400 leading-relaxed bg-surface-700/40 border border-surface-600 rounded px-2 py-1.5">
                                        Connects to the running SAP GUI session via COM Scripting. Open SAP GUI and navigate to a screen first. Windows only.
                                      </p>
                                    )}
                                    {spyError && (
                                      <p className="text-[10px] text-red-300 leading-relaxed bg-red-900/20 border border-red-700/40 rounded px-2 py-1.5">
                                        {spyError}
                                      </p>
                                    )}
                                    <div className="flex gap-2">
                                      <button
                                        type="button"
                                        onClick={() => startSpy(step.id, key)}
                                        disabled={spyMode === 'web' && !spyUrl.trim()}
                                        className="btn-primary flex-1 text-xs py-1.5 flex items-center justify-center gap-1.5 disabled:opacity-40"
                                      >
                                        <Crosshair size={11} />
                                        {spyMode === 'sap' ? 'Connect to SAP GUI' : 'Open Spy Browser'}
                                      </button>
                                      <button type="button" onClick={() => setSpyAnchor(null)} className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300 border border-surface-500 rounded-lg">Cancel</button>
                                    </div>
                                  </div>
                                </div>
                              )}
                              {/* Object picker dropdown */}
                              {objectPicker?.stepId === step.id && objectPicker?.key === key && (
                                <div
                                  ref={objectPickerRef}
                                  className="absolute z-50 top-full mt-1 left-0 right-0 bg-surface-800 border border-green-700/50 rounded-lg shadow-xl overflow-hidden"
                                >
                                  <div className="px-2 py-1.5 border-b border-surface-600 flex items-center gap-1.5">
                                    <AtSign size={10} className="text-green-400" />
                                    <span className="text-[10px] text-green-300 font-semibold">Objects</span>
                                    <span className="text-[10px] text-slate-600 ml-1">grouped by page</span>
                                  </div>
                                  <div className="max-h-52 overflow-y-auto py-1">
                                    {Array.from(new Set(objects.map(o => o.page || 'default'))).sort().map(page => (
                                      <div key={page}>
                                        <div className="px-3 py-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider bg-surface-900/60">{page}</div>
                                        {objects.filter(o => (o.page || 'default') === page).map(obj => (
                                          <button key={obj.key} type="button"
                                            onClick={() => { updateParam(step.id, key, `@${obj.key}`); setObjectPicker(null) }}
                                            className="w-full text-left px-3 py-1.5 text-xs font-mono text-green-300 hover:bg-green-900/30 hover:text-green-200 transition-colors flex items-center justify-between gap-2"
                                          >
                                            <span>@{obj.key}</span>
                                            {obj.description && <span className="text-[10px] text-slate-600 truncate max-w-24">{obj.description}</span>}
                                          </button>
                                        ))}
                                      </div>
                                    ))}
                                    {objects.length === 0 && (
                                      <p className="text-xs text-slate-600 px-3 py-2 italic">No objects defined yet.</p>
                                    )}
                                  </div>
                                </div>
                              )}
                              {/* Test data picker dropdown */}
                              {paramPicker?.stepId === step.id && paramPicker?.key === key && (
                                <div
                                  ref={paramPickerRef}
                                  className="absolute z-50 top-full mt-1 left-0 right-0 bg-surface-800 border border-brand-700/50 rounded-lg shadow-xl overflow-hidden"
                                >
                                  <div className="px-2 py-1.5 border-b border-surface-600 flex items-center gap-1.5">
                                    <Database size={10} className="text-brand-400" />
                                    <span className="text-[10px] text-brand-300 font-semibold">Test Data</span>
                                    <span className="text-[10px] text-slate-600 ml-1">click to insert</span>
                                  </div>
                                  <div className="max-h-40 overflow-y-auto py-1">
                                    {testDataVars.map(varKey => (
                                      <button
                                        key={varKey}
                                        type="button"
                                        onClick={() => {
                                          updateParam(step.id, key, `{{TEST_DATA.${varKey}}}`)
                                          setParamPicker(null)
                                        }}
                                        className="w-full text-left px-3 py-1.5 text-xs font-mono text-brand-300 hover:bg-brand-800/40 hover:text-brand-200 transition-colors"
                                      >
                                        {`{{TEST_DATA.${varKey}}}`}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                          )
                        })
                        )}
                        <div className="flex items-center gap-4 mt-1">
                          <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={step.continueOnFailure ?? false}
                              onChange={e => updateStep(step.id, { continueOnFailure: e.target.checked })}
                              className="accent-brand-500"
                            />
                            Continue on failure
                          </label>
                          <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={step.disabled ?? false}
                              onChange={e => updateStep(step.id, { disabled: e.target.checked })}
                              className="accent-yellow-500"
                            />
                            Skip (disabled)
                          </label>
                          <div className="flex items-center gap-1.5">
                            <RotateCcw size={10} className="text-slate-600" />
                            <input
                              type="number" min={0} max={5}
                              className="text-xs text-slate-500 bg-transparent outline-none w-6 border-b border-surface-500 focus:border-brand-500 text-center"
                              value={step.retries ?? ''}
                              onChange={e => updateStep(step.id, { retries: e.target.value ? parseInt(e.target.value) : undefined })}
                              placeholder="0"
                              title="Step-level retry count"
                            />
                            <span className="text-xs text-slate-600">retries</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              {tc.steps.length === 0 && (
                <div className="flex flex-col items-center justify-center h-48 text-center">
                  <div className="w-12 h-12 rounded-xl bg-surface-700 flex items-center justify-center mb-3">
                    <Plus size={20} className="text-slate-500" />
                  </div>
                  <p className="text-sm text-slate-500">No steps yet</p>
                  <p className="text-xs text-slate-600 mt-1">Click a keyword on the right to add it</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-slate-500">Select or create a test case</p>
              <button onClick={() => addNewTestCaseInFolder(`${projectDir ?? ''}/tests`)} className="btn-primary mt-3">
                <Plus size={14} className="inline mr-1" />New Test Case
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Right: Keyword Panel ────────────────────────────────────── */}
      <div className={`flex-shrink-0 bg-surface-900 border-l border-surface-500 flex flex-col transition-all ${kwPanelOpen ? 'w-52' : 'w-10'}`}>
        <button
          onClick={() => setKwPanelOpen(p => !p)}
          className="flex items-center justify-between px-3 py-3 border-b border-surface-500 hover:bg-surface-700 transition-colors"
        >
          {kwPanelOpen && <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Keywords</span>}
          <ChevronRight size={14} className={`text-slate-500 transition-transform ${kwPanelOpen ? 'rotate-180' : ''}`} />
        </button>

        {kwPanelOpen && (
          <div className="flex-1 overflow-y-auto py-2">
            {Object.entries(KEYWORD_CATEGORIES).map(([cat, kws]) => (
              <div key={cat} className="mb-2">
                <p className="px-3 py-1 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">{cat}</p>
                {kws.map(kw => (
                  <button
                    key={kw}
                    onClick={() => addStep(kw)}
                    disabled={!tc}
                    className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:text-brand-300 hover:bg-surface-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed font-mono truncate"
                  >
                    + {kw}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── AI Co-Pilot Panel ───────────────────────────────────────── */}
      {aiOpen && (
        <div className="w-96 flex-shrink-0 bg-surface-900 border-l border-brand-700/40 flex flex-col">
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-surface-500 bg-surface-800/60">
            <div className="flex items-center gap-2">
              <Brain size={15} className="text-brand-400" />
              <span className="text-sm font-semibold text-brand-300">AI Co-Pilot</span>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-brand-600/40 text-brand-300">BETA</span>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Auto-Assist toggle */}
              <button
                onClick={() => {
                  const next = !aiAutoMode
                  setAiAutoMode(next)
                  aiAutoModeRef.current = next // update ref immediately (useEffect is async)
                  if (next) sendAIAutoAnalysis('Auto-Assist enabled')
                  if (!next) setStepWarnings({}) // clear badges when disabling
                }}
                disabled={aiConfigured === false}
                title={aiAutoMode ? 'Auto-Assist ON — click to disable' : 'Enable Auto-Assist: AI watches every step change'}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-all border ${
                  aiAutoMode
                    ? 'bg-brand-600/50 border-brand-500/70 text-brand-200 shadow-[0_0_8px_rgba(99,102,241,0.4)]'
                    : 'bg-surface-700/60 border-surface-500/40 text-slate-500 hover:text-slate-300 hover:border-brand-700/50'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <Wand2 size={11} className={aiAutoMode ? 'animate-pulse' : ''} />
                {aiAutoMode ? 'AUTO ON' : 'AUTO'}
              </button>
              {aiMessages.length > 0 && (
                <button onClick={clearAiChat} title="Clear chat" className="p-1.5 rounded hover:bg-surface-600 text-slate-500 hover:text-slate-300 transition-colors">
                  <Trash2 size={13} />
                </button>
              )}
              {aiStreaming && (
                <button onClick={ipc_ai_abort} title="Stop generating" className="p-1.5 rounded hover:bg-red-900/40 text-slate-500 hover:text-red-400 transition-colors">
                  <X size={13} />
                </button>
              )}
              <button onClick={() => setAiOpen(false)} className="p-1.5 rounded hover:bg-surface-600 text-slate-500 hover:text-slate-300 transition-colors">
                <ChevronLeft size={14} />
              </button>
            </div>
          </div>

          {/* Auto-Assist active banner */}
          {aiAutoMode && (
            <div className="mx-3 mt-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-brand-950/50 border border-brand-700/40">
              <Wand2 size={11} className="text-brand-400 animate-pulse flex-shrink-0" />
              <span className="text-[10px] text-brand-300">
                <span className="font-semibold">Auto-Assist active</span> — AI reviews every step automatically
              </span>
              <button onClick={() => setAiAutoMode(false)} className="ml-auto text-brand-500 hover:text-brand-300 text-[10px]">
                disable
              </button>
            </div>
          )}

          {/* Not configured warning */}
          {aiConfigured === false && (
            <div className="mx-3 mt-3 p-3 rounded-lg bg-amber-950/40 border border-amber-700/40 text-xs text-amber-300">
              <div className="flex items-start gap-2">
                <Brain size={14} className="flex-shrink-0 mt-0.5 text-amber-400" />
                <div>
                  Azure AI not configured.{' '}
                  <button
                    onClick={() => setActivePage('ai')}
                    className="underline hover:text-amber-200 transition-colors"
                  >
                    Open AI Co-Pilot settings
                  </button>
                  {' '}to add your credentials, then come back here.
                </div>
              </div>
            </div>
          )}

          {/* Context pill */}
          {tc && (
            <div className="mx-3 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-700/50 border border-surface-500/50">
              <ClipboardList size={12} className="text-brand-400 flex-shrink-0" />
              <span className="text-xs text-slate-400 truncate">
                <span className="text-brand-300 font-medium">{tc.testCase}</span>
                <span className="text-slate-600"> · {tc.steps.length} step{tc.steps.length !== 1 ? 's' : ''}</span>
              </span>
              <span className="ml-auto text-[10px] text-slate-600 flex-shrink-0">in context</span>
            </div>
          )}

          {/* Quick-action chips */}
          {aiMessages.length === 0 && (
            <div className="px-3 mt-3 space-y-1.5">
              <p className="text-[10px] text-slate-600 font-semibold uppercase tracking-wider mb-2">Quick actions</p>
              {[
                { icon: <Sparkles size={11} />, label: 'Generate login test steps', prompt: 'Generate login test steps with username, password fields and submit button' },
                { icon: <Zap size={11} />, label: 'Add assertions for current steps', prompt: 'Review my current steps and add appropriate assertion steps to verify the expected outcomes' },
                { icon: <Brain size={11} />, label: 'Explain what this test does', prompt: 'Explain what my current test case does in plain English' },
                { icon: <ClipboardList size={11} />, label: 'Suggest improvements', prompt: 'Review my test steps and suggest improvements for reliability, completeness, and best practices' },
              ].map(q => (
                <button
                  key={q.label}
                  disabled={aiConfigured === false}
                  onClick={() => { setAiInput(q.prompt); setTimeout(() => aiInputRef.current?.focus(), 50) }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-700/60 hover:bg-surface-600/60 border border-surface-500/40 hover:border-brand-700/50 text-xs text-slate-400 hover:text-slate-200 transition-all text-left disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="text-brand-400 flex-shrink-0">{q.icon}</span>
                  {q.label}
                </button>
              ))}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {aiMessages.map(msg => (
              <div key={msg.id} className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                {msg.role === 'user' ? (
                  <div className="max-w-[85%] px-3 py-2 rounded-xl bg-brand-700/40 border border-brand-600/40 text-xs text-slate-200">
                    {msg.content}
                  </div>
                ) : (
                  <div className="w-full space-y-2">
                    {/* Auto-Assist header badge */}
                    {msg.auto && (
                      <div className="flex items-center gap-1.5 mb-1">
                        <Wand2 size={10} className="text-brand-400" />
                        <span className="text-[10px] text-brand-400 font-semibold">Auto-Assist</span>
                        {msg.trigger && <span className="text-[10px] text-slate-600">· {msg.trigger}</span>}
                      </div>
                    )}
                    {msg.content === '' && msg.streaming ? (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-700/40 border border-surface-500/40">
                        <Loader2 size={12} className="animate-spin text-brand-400" />
                        <span className="text-xs text-slate-500">Thinking…</span>
                      </div>
                    ) : (
                      splitContent(msg.content).map((part, pi) =>
                        part.type === 'text' ? (
                          <div key={pi} className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed px-1">
                            {part.content.trim()}
                          </div>
                        ) : (
                          <div key={pi} className="rounded-lg border border-surface-500/60 overflow-hidden">
                            <div className="flex items-center justify-between px-3 py-1.5 bg-surface-700/60 border-b border-surface-500/40">
                              <span className="text-[10px] font-mono text-slate-500">yaml</span>
                              {msg.auto ? (
                                // Auto-Assist message — Apply Fix replaces steps (user-controlled)
                                msg.autoApplied ? (
                                  <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-900/40 border border-emerald-700/50 text-emerald-400 text-[10px] font-semibold">
                                    <CheckCircle2 size={10} />
                                    Applied · {msg.autoAppliedCount} step{(msg.autoAppliedCount ?? 0) !== 1 ? 's' : ''}
                                  </span>
                                ) : (
                                  <button
                                    disabled={!tc}
                                    onClick={() => applyAIFix(msg.id, part.content)}
                                    title="Replace current test steps with AI-corrected steps"
                                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-700/40 hover:bg-amber-600/60 border border-amber-600/50 text-amber-300 text-[10px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    <Wand2 size={10} />
                                    Apply Fix
                                  </button>
                                )
                              ) : (
                                // Manual message — Insert patches by step_number or appends
                                <button
                                  disabled={!tc}
                                  onClick={() => patchStepsFromYaml(part.content, 'append')}
                                  title="Insert steps into test (replaces step at step_number if present, otherwise appends)"
                                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-brand-600/40 hover:bg-brand-600/70 border border-brand-500/50 text-brand-300 text-[10px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <Zap size={10} />
                                  Insert into Test
                                </button>
                              )}
                            </div>
                            <pre className="text-[11px] text-slate-300 font-mono px-3 py-2 overflow-x-auto bg-surface-800/60">
                              {part.content.trimEnd()}
                            </pre>
                          </div>
                        )
                      )
                    )}
                    {msg.streaming && msg.content !== '' && (
                      <span className="inline-block w-1.5 h-3 bg-brand-400 animate-pulse ml-1 rounded-sm" />
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={aiMessagesEndRef} />
          </div>

          {/* Input area */}
          <div className="px-3 pb-3 pt-2 border-t border-surface-500/50">
            <div className="flex gap-2 items-end">
              <textarea
                ref={aiInputRef}
                value={aiInput}
                onChange={e => setAiInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAIMessage() }
                }}
                disabled={aiConfigured === false || aiStreaming}
                rows={2}
                className="flex-1 input text-xs resize-none font-normal disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder={aiConfigured === false ? 'Configure Azure AI first…' : 'Ask AI to add steps, fix issues… (Enter to send)'}
              />
              <button
                onClick={sendAIMessage}
                disabled={!aiInput.trim() || aiStreaming || aiConfigured === false}
                className="flex-shrink-0 p-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
              >
                {aiStreaming ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>
            <p className="text-[10px] text-slate-600 mt-1.5 text-center">Current test steps sent as context · Shift+Enter for newline</p>
          </div>
        </div>
      )}
    </div>
  )
}
