import { useState, useEffect, useRef } from 'react'
import { useAppStore, TestCase, TestStep } from '../store/appStore'
import {
  Plus, Trash2, Save, GripVertical, ChevronDown,
  ChevronRight, FilePlus, Tag, Copy, Circle, Square, Wifi,
  CheckCircle2, AlertCircle, Loader2, Brain, Send, Sparkles,
  X, ChevronLeft, Zap, ClipboardList
} from 'lucide-react'
import yaml from 'js-yaml'
import TestExplorer from '../components/TestExplorer'
import { loadProjectData } from '../utils/projectLoader'

// ── AI helpers ────────────────────────────────────────────────────────────────

interface AIChatMsg { id: string; role: 'user' | 'assistant'; content: string; streaming?: boolean }

function parseYamlToSteps(yamlText: string): Omit<TestStep, 'id'>[] | null {
  try {
    const doc = yaml.load(yamlText) as any
    const rawSteps: any[] = Array.isArray(doc) ? doc : (doc?.steps ?? null)
    if (!Array.isArray(rawSteps)) return null
    return rawSteps.map(s => ({
      keyword: String(s.keyword ?? ''),
      params: s.params && typeof s.params === 'object' ? s.params : {},
      description: s.description ?? '',
      continueOnFailure: s.continueOnFailure ?? false,
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
  const { testCases, activeTestCase, setActiveTestCase, setTestCases, updateTestCase, appendStepToActive, markSaved, projectDir, deleteTestCase, setActivePage } = useAppStore()
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
  const [rescanning, setRescanning] = useState(false)

  const tc = activeTestCase

  // ─ Recording state ───────────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false)
  const [recorderBarOpen, setRecorderBarOpen] = useState(false)
  const [recordUrl, setRecordUrl] = useState('')
  const [recordedCount, setRecordedCount] = useState(0)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')

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
  }

  // ─ Recording ──────────────────────────────────────────────────────────────
  function startRecording() {
    const ipc = (window as any).prabala
    if (!tc) return
    setRecordedCount(0)
    setIsRecording(true)

    // Prepend Web.Launch if the test doesn't already start with one
    if (tc.steps.length === 0 || tc.steps[0].keyword !== 'Web.Launch') {
      const launchStep = newStep('Web.Launch')
      updateTestCase(tc.id, { steps: [launchStep, ...tc.steps] })
    }

    if (!ipc) {
      // Browser/demo mode — simulate a few steps after a delay
      let count = 0
      const demoSteps: { keyword: string; params: Record<string, string> }[] = [
        { keyword: 'NavigateTo', params: { url: recordUrl || 'https://example.com' } },
        { keyword: 'Click', params: { locator: 'text=Get started' } },
        { keyword: 'EnterText', params: { locator: '[placeholder="Search"]', value: '' } },
      ]
      const timer = setInterval(() => {
        if (count >= demoSteps.length) { clearInterval(timer); setIsRecording(false); return }
        ingestStep(demoSteps[count])
        count++
      }, 1200)
      return
    }

    ipc.recorder.removeAllListeners()
    ipc.recorder.onStep((step: { keyword: string; params: Record<string, string> }) => {
      ingestStep(step)
    })
    ipc.recorder.onDone(() => {
      setIsRecording(false)
      ipc.recorder.removeAllListeners()
    })
    ipc.recorder.start(recordUrl || '', projectDir ?? '')
  }

  function stopRecording() {
    const ipc = (window as any).prabala
    ipc?.recorder.stop()
    ipc?.recorder.removeAllListeners()
    setIsRecording(false)

    // Append Web.Close if the test doesn't already end with one
    const current = useAppStore.getState().activeTestCase
    if (current && (current.steps.length === 0 || current.steps[current.steps.length - 1].keyword !== 'Web.Close')) {
      appendStepToActive(newStep('Web.Close'))
    }
  }

  // Append a recorded step into the active test case via atomic store update
  // (avoids stale-closure overwrite when steps arrive rapidly)
  function ingestStep(raw: { keyword: string; params: Record<string, string> }) {
    const step = newStep(raw.keyword)
    step.params = { ...step.params, ...raw.params }
    appendStepToActive(step)
    setRecordedCount(n => n + 1)
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
    if (!tc || !projectDir) return

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
      steps: tc.steps.map(s => ({
        keyword: s.keyword,
        params: cleanParams(s.params),
        description: s.description || undefined,
        continueOnFailure: s.continueOnFailure || undefined,
      })),
    }, { lineWidth: 120, noRefs: true })

    const ipc = (window as any).prabala

    if (!ipc) {
      // Demo / browser mode — no write but simulate success
      setSaveStatus('ok')
      markSaved(tc.id)
      setTimeout(() => setSaveStatus('idle'), 2000)
      return
    }

    setSaveStatus('saving')
    try {
      await ipc.fs.writeFile(tc.filePath, yamlContent)
      markSaved(tc.id)
      setSaveStatus('ok')
    } catch (err: any) {
      console.error('[Save] failed:', err)
      setSaveStatus('error')
    } finally {
      setTimeout(() => setSaveStatus('idle'), 2500)
    }
  }

  // Drag reorder
  function onDragStart(idx: number) { setDragIdx(idx) }

  // ─ AI Co-Pilot ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const ipc = (window as any).prabala
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
`
  }

  function buildContextMessage() {
    if (!tc) return ''
    const stepsYaml = tc.steps.length
      ? yaml.dump({ steps: tc.steps.map(s => ({ keyword: s.keyword, params: s.params, description: s.description || undefined })) }, { lineWidth: 120 })
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
    const ipc = (window as any).prabala
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

  function clearAiChat() {
    setAiMessages([])
    ipc_ai_abort()
  }

  function ipc_ai_abort() {
    const ipc = (window as any).prabala
    ipc?.ai?.abort().catch(() => {})
    ipc?.ai?.removeListeners?.()
    setAiStreaming(false)
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
              <div className="flex-shrink-0 flex items-center gap-3 px-6 py-3 bg-red-950/30 border-b border-red-800/40">
                <Circle size={13} className="text-red-400 flex-shrink-0" />
                <span className="text-xs text-red-300 font-semibold flex-shrink-0">Record from URL</span>
                <input
                  className="input text-xs font-mono flex-1"
                  value={recordUrl}
                  onChange={e => setRecordUrl(e.target.value)}
                  placeholder="https://example.com  (leave blank to record from any URL)"
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
            )}

            {/* Recording live banner */}
            {isRecording && (
              <div className="flex-shrink-0 flex items-center gap-3 px-6 py-2.5 bg-red-950/50 border-b border-red-700/50">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                <span className="text-xs text-red-300 font-semibold">Recording…</span>
                <span className="text-xs text-slate-400">{recordedCount} step{recordedCount !== 1 ? 's' : ''} captured</span>
                <span className="text-xs text-slate-500 ml-1 font-mono">{recordUrl || 'any URL'}</span>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-slate-500">Perform actions in the browser window that opened</span>
                  <button onClick={stopRecording} className="flex items-center gap-1 px-2 py-1 rounded bg-red-800/50 hover:bg-red-800/80 text-red-300 text-xs transition-colors">
                    <Square size={11} /> Stop
                  </button>
                </div>
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
                    className={`card border-l-4 ${statusColor(step.keyword)} transition-all ${isDragTarget ? 'ring-2 ring-brand-500/50 scale-[1.01]' : ''}`}
                  >
                    {/* Step header */}
                    <div
                      className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-surface-600/30 rounded-t-xl"
                      onClick={() => toggleStep(step.id)}
                    >
                      <GripVertical size={13} className="text-slate-600 cursor-grab flex-shrink-0" />
                      <span className="text-xs text-slate-500 font-mono w-5 text-right flex-shrink-0">{idx + 1}</span>
                      <span className="text-sm font-semibold text-brand-300 flex-1 min-w-0 truncate">{step.keyword}</span>
                      {paramKeys.length > 0 && (
                        <span className="text-xs text-slate-500 truncate max-w-[200px] hidden sm:block">
                          {Object.entries(step.params).filter(([,v]) => v).map(([k,v]) => `${k}=${v}`).join(' · ')}
                        </span>
                      )}
                      <div className="flex gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
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
                        <input
                          className="input text-xs text-slate-400 italic"
                          value={step.description}
                          onChange={e => updateStep(step.id, { description: e.target.value })}
                          placeholder="Step description (optional)..."
                        />
                        {paramKeys.map(key => (
                          <div key={key} className="flex items-center gap-2">
                            <label className="text-xs text-slate-500 font-mono w-24 flex-shrink-0">{key}</label>
                            <input
                              className="input text-xs font-mono"
                              value={step.params[key] ?? ''}
                              onChange={e => updateParam(step.id, key, e.target.value)}
                              placeholder={`{${key.toUpperCase()}} or @object-key`}
                            />
                          </div>
                        ))}
                        <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer mt-1">
                          <input
                            type="checkbox"
                            checked={step.continueOnFailure ?? false}
                            onChange={e => updateStep(step.id, { continueOnFailure: e.target.checked })}
                            className="accent-brand-500"
                          />
                          Continue on failure
                        </label>
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
            <div className="flex items-center gap-1">
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
                              <button
                                disabled={!tc}
                                onClick={() => insertStepsFromYaml(part.content)}
                                className="flex items-center gap-1 px-2 py-0.5 rounded bg-brand-600/40 hover:bg-brand-600/70 border border-brand-500/50 text-brand-300 text-[10px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <Zap size={10} />
                                Insert into Test
                              </button>
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
