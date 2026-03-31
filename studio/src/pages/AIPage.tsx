// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio – AI Co-Pilot Page
// Agentic AI powered by Claude (Anthropic) for test generation, failure
// analysis, and app exploration
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Brain, Send, Settings, Key, Copy, Check, Save,
  Trash2, RotateCcw, ChevronDown, ChevronUp, Loader2,
  AlertTriangle, Search, FlaskConical, X,
  Terminal, FileCode2,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import api from '../lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

type Mode = 'generate' | 'analyze' | 'explore'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

// ── System Prompts ────────────────────────────────────────────────────────────

function buildSystemPrompt(mode: Mode, keywords: string[], projectDir: string | null): string {
  const kwSection = keywords.length
    ? `## Available Keywords\n${keywords.map(k => `- ${k}`).join('\n')}`
    : '## Available Keywords\n(No project loaded — using common web keywords as examples)'

  const baseFmt = `
## Prabala YAML Test Format
\`\`\`yaml
testCase: "Descriptive Test Name"
description: "Optional description"
tags: [smoke, regression]
dataFile: "test-data/demo-data.json"   # optional, for parameterized tests
steps:
  - keyword: Open Browser
    params:
      url: "https://example.com"
  - keyword: Click Element
    params:
      locator: "//button[text()='Login']"
  - keyword: Type Text
    params:
      locator: "#username"
      text: "{{TEST_DATA.username}}"   # reference test data with double-braces
  - keyword: Assert Element Text
    params:
      locator: ".dashboard-title"
      expected: "Welcome"
  - keyword: Close Browser
    params: {}
\`\`\`

## Key Rules
- Always use valid YAML (no tabs — use 2-space indentation)
- Locators can be XPath (//...) or CSS selectors (#id, .class, [attr])
- Use \`{{TEST_DATA.key}}\` to reference test data variables
- Tags help organise tests: smoke, regression, login, signup, checkout, etc.
- Each step needs both \`keyword\` and \`params\` (params can be empty: {})
- When generating tests, output ONLY the YAML block with no extra prose unless asked

${kwSection}`

  if (mode === 'generate') {
    return `You are an expert test automation AI co-pilot for the Prabala framework.
Your job is to generate valid, comprehensive Prabala YAML test files from natural language descriptions.

${baseFmt}

## Your behaviour
- Ask ONE clarifying question at a time if information is missing (URL, credentials, selectors)
- Generate well-structured tests that cover happy path AND key edge cases
- Use descriptive test case names and meaningful tags
- When you produce a test, wrap it in a single \`\`\`yaml ... \`\`\` block
- After generating, briefly explain what the test covers (2-3 sentences max)
- Suggest improvements if the user's description is vague
- Project directory: ${projectDir ?? '(none loaded)'}
`
  }

  if (mode === 'analyze') {
    return `You are an expert test failure analyst for the Prabala automation framework.
Given test execution logs, step details, and failure messages, you identify root causes and suggest actionable fixes.

${baseFmt}

## Your behaviour
- Identify the EXACT failing step and reason
- Distinguish between: locator issues, timing issues, environment issues, data issues, keyword misuse
- Provide a specific fix — always show the corrected YAML snippet wrapped in \`\`\`yaml ... \`\`\`
- Rate severity (Critical / Warning / Info) for each finding
- Be concise — bullet points preferred over long paragraphs
- If the log is incomplete, ask for the missing information
`
  }

  // explore
  return `You are an expert test automation AI co-pilot for the Prabala framework.
Your job is to help explore web applications and generate comprehensive test suites.

${baseFmt}

## Your behaviour
- Ask for the URL and a brief description of the app's purpose and main user flows
- Generate a suite of test cases covering: authentication, main user journeys, error states, and edge cases
- Structure tests logically (smoke tests first, then regression)
- Each test case in its own \`\`\`yaml ... \`\`\` block, clearly labelled
- After generating the suite, provide a summary table of what was covered
- Suggest what data should go in test-data files
`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function nanoid(): string {
  return Math.random().toString(36).slice(2, 10)
}

// Split message content into text and code segments
function parseContent(content: string): Array<{ type: 'text' | 'code'; text: string; lang?: string }> {
  const parts: Array<{ type: 'text' | 'code'; text: string; lang?: string }> = []
  const re = /```(\w*)\n([\s\S]*?)```/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    if (match.index > last) {
      parts.push({ type: 'text', text: content.slice(last, match.index) })
    }
    parts.push({ type: 'code', lang: match[1] || 'text', text: match[2] })
    last = match.index + match[0].length
  }
  if (last < content.length) {
    parts.push({ type: 'text', text: content.slice(last) })
  }
  return parts
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const ipc = api
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const isYaml = lang === 'yaml' || lang === 'yml'

  async function handleCopy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleSave() {
    if (!ipc) return
    const savePath = await ipc.dialog.saveFile([
      { name: 'Prabala Test', extensions: ['yaml', 'yml'] },
    ])
    if (savePath) {
      await ipc.fs.writeFile(savePath, text)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }
  }

  return (
    <div className="my-2 rounded-lg border border-surface-600 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-700/60 border-b border-surface-600">
        <div className="flex items-center gap-2">
          <FileCode2 size={13} className="text-slate-400" />
          <span className="text-xs font-mono text-slate-400">{lang || 'code'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors px-2 py-0.5 rounded hover:bg-surface-600"
          >
            {copied ? <><Check size={11} className="text-green-400" /><span className="text-green-400">Copied</span></> : <><Copy size={11} />Copy</>}
          </button>
          {isYaml && ipc && (
            <button
              onClick={handleSave}
              className="flex items-center gap-1 text-xs text-brand-300 hover:text-brand-200 transition-colors px-2 py-0.5 rounded hover:bg-brand-900/40 border border-brand-600/30"
            >
              {saved ? <><Check size={11} className="text-green-400" /><span className="text-green-400">Saved!</span></> : <><Save size={11} />Save as Test</>}
            </button>
          )}
        </div>
      </div>
      {/* Code */}
      <pre className="p-4 text-xs font-mono text-slate-200 bg-surface-800/80 overflow-x-auto leading-relaxed whitespace-pre">{text}</pre>
    </div>
  )
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  const parts = parseContent(msg.content)

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
        isUser ? 'bg-brand-600' : 'bg-gradient-to-br from-purple-600 to-brand-600'
      }`}>
        {isUser
          ? <span className="text-xs font-bold text-white">U</span>
          : <Brain size={13} className="text-white" />
        }
      </div>

      {/* Content */}
      <div className={`flex-1 max-w-[85%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        {isUser ? (
          <div className="bg-brand-600/20 border border-brand-600/30 text-slate-200 text-sm rounded-2xl rounded-tr-sm px-4 py-2.5 leading-relaxed whitespace-pre-wrap">
            {msg.content}
          </div>
        ) : (
          <div className="text-slate-200 text-sm leading-relaxed w-full">
            {parts.map((part, i) =>
              part.type === 'code'
                ? <CodeBlock key={i} lang={part.lang!} text={part.text} />
                : <span key={i} className="whitespace-pre-wrap">{part.text}</span>
            )}
            {msg.streaming && (
              <span className="inline-flex gap-0.5 ml-1 items-center">
                <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Mode config ───────────────────────────────────────────────────────────────

const MODES: { id: Mode; label: string; icon: React.ElementType; placeholder: string; welcome: string }[] = [
  {
    id: 'generate',
    label: 'Generate Tests',
    icon: FlaskConical,
    placeholder: 'Describe what you want to test… e.g. "test the login flow with valid and invalid credentials"',
    welcome: 'Describe a feature, user flow, or scenario and I\'ll generate a complete Prabala YAML test file for you.',
  },
  {
    id: 'analyze',
    label: 'Analyze Failures',
    icon: AlertTriangle,
    placeholder: 'Paste your test failure logs here…',
    welcome: 'Paste your test run output or describe the failure and I\'ll identify the root cause and suggest fixes.',
  },
  {
    id: 'explore',
    label: 'Explore & Generate',
    icon: Search,
    placeholder: 'Provide a URL or describe the app to generate a full test suite…',
    welcome: 'Give me a URL and a description of your web app. I\'ll generate a comprehensive test suite covering the main user journeys.',
  },
]

// ── Reusable field component (defined outside SettingsPanel to avoid remounts) ─

function ConfigField({ label, value, onChange, onClearResult, placeholder, secret, hint, loading }: {
  label: string; value: string; onChange: (v: string) => void; onClearResult: () => void
  placeholder: string; secret?: boolean; hint?: string; loading: boolean
}) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
      <div className="relative">
        <input
          type={secret ? 'password' : 'text'}
          value={loading ? '' : value}
          onChange={e => { onChange(e.target.value); onClearResult() }}
          placeholder={placeholder}
          className="input w-full font-mono text-sm"
          disabled={loading}
        />
        {loading && (
          <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />
        )}
      </div>
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  )
}

// ── Settings Panel ────────────────────────────────────────────────────────────

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const ipc = api
  const [cfg, setCfg] = useState({ endpoint: '', apiKey: '', deployment: 'gpt-4o', apiVersion: '2024-12-01-preview' })
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    if (ipc?.ai) {
      ipc.ai.getConfig()
        .then((c: any) => {
          setCfg(prev => ({
            endpoint:   String(c?.endpoint   ?? prev.endpoint   ?? ''),
            apiKey:     String(c?.apiKey     ?? prev.apiKey     ?? ''),
            deployment: String(c?.deployment ?? prev.deployment ?? 'gpt-4o'),
            apiVersion: String(c?.apiVersion ?? prev.apiVersion ?? '2024-08-01-preview'),
          }))
          setLoading(false)
        })
        .catch(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  function normalizeEndpoint(raw: string): string {
    let endpoint = raw.trim()
    endpoint = endpoint.replace(/\/$/, '')
    endpoint = endpoint.replace(/\/openai$/i, '')
    return endpoint
  }

  function validateConfig(): string | null {
    const endpoint = normalizeEndpoint(cfg.endpoint ?? '')
    const apiKey = (cfg.apiKey ?? '').trim()
    const deployment = (cfg.deployment ?? '').trim()
    const apiVersion = (cfg.apiVersion ?? '').trim()

    if (!endpoint) return 'Endpoint URL is required.'
    if (!apiKey) return 'API Key is required.'
    if (!deployment) return 'Deployment Name is required.'
    if (!apiVersion) return 'API Version is required.'

    let parsed: URL
    try {
      parsed = new URL(endpoint)
    } catch {
      return 'Endpoint must be a valid URL, e.g. https://my-resource.openai.azure.com'
    }

    if (parsed.protocol !== 'https:') {
      return 'Endpoint must start with https://'
    }

    if (!parsed.hostname.endsWith('.openai.azure.com')) {
      return 'Endpoint host must end with .openai.azure.com'
    }

    if (parsed.pathname && parsed.pathname !== '/' && parsed.pathname !== '') {
      return 'Endpoint must be the base resource URL only (no path). Example: https://my-resource.openai.azure.com'
    }

    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(deployment)) {
      return 'Deployment Name contains invalid characters. Use letters, numbers, dot, underscore, or hyphen.'
    }

    if (!/^\d{4}-\d{2}-\d{2}(-preview)?$/.test(apiVersion)) {
      return 'API Version must look like YYYY-MM-DD or YYYY-MM-DD-preview (example: 2024-08-01-preview).'
    }

    return null
  }

  async function handleSave() {
    if (!ipc?.ai) return
    const validationError = validateConfig()
    if (validationError) {
      setTestResult({ ok: false, message: validationError })
      return
    }
    await ipc.ai.setConfig({
      endpoint:   normalizeEndpoint(cfg.endpoint ?? ''),
      apiKey:     (cfg.apiKey ?? '').trim(),
      deployment: (cfg.deployment ?? '').trim(),
      apiVersion: (cfg.apiVersion ?? '').trim(),
    })
    setSaved(true)
    setTimeout(() => { setSaved(false); onClose() }, 1200)
  }

  async function handleTest() {
    if (!ipc?.ai) return
    const validationError = validateConfig()
    if (validationError) {
      setTestResult({ ok: false, message: validationError })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      // Save first so the handler reads the latest values
      await ipc.ai.setConfig({
        endpoint:   normalizeEndpoint(cfg.endpoint ?? ''),
        apiKey:     (cfg.apiKey ?? '').trim(),
        deployment: (cfg.deployment ?? '').trim(),
        apiVersion: (cfg.apiVersion ?? '').trim(),
      })
      const result = await ipc.ai.testConnection()
      setTestResult(result)
    } catch (err: any) {
      setTestResult({ ok: false, message: err?.message || 'Connection test failed.' })
    } finally {
      setTesting(false)
    }
  }

  const canSave = !loading && !!(cfg.endpoint ?? '').trim() && !!(cfg.apiKey ?? '').trim() && !!(cfg.deployment ?? '').trim()

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999] overflow-y-auto py-8">
      <div className="bg-surface-800 border border-surface-600 rounded-xl shadow-2xl w-[540px] p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Key size={18} className="text-brand-400" />
            <h2 className="text-white font-semibold">Azure OpenAI Settings</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="bg-surface-700/40 border border-surface-600 rounded-lg p-3 mb-4 text-xs text-slate-400 space-y-1">
          <p>Find all values in <strong className="text-slate-300">Azure Portal → Your OpenAI Resource → Keys and Endpoint</strong></p>
          <p>Deployment name must exactly match what you see in <strong className="text-slate-300">Azure AI Foundry → Deployments</strong></p>
        </div>

        <ConfigField label="Endpoint URL" value={cfg.endpoint}
          onChange={v => setCfg(p => ({ ...p, endpoint: v }))}
          onClearResult={() => setTestResult(null)}
          placeholder="https://YOUR-RESOURCE-NAME.openai.azure.com/"
          hint="Use only the base resource URL (no /openai path). Example: https://my-openai.openai.azure.com"
          loading={loading}
        />
        <ConfigField label="API Key" value={cfg.apiKey}
          onChange={v => setCfg(p => ({ ...p, apiKey: v }))}
          onClearResult={() => setTestResult(null)}
          placeholder="Paste key from Azure Portal → Keys and Endpoint" secret
          loading={loading}
        />
        <ConfigField label="Deployment Name" value={cfg.deployment}
          onChange={v => setCfg(p => ({ ...p, deployment: v }))}
          onClearResult={() => setTestResult(null)}
          placeholder="e.g. gpt-4o"
          hint="Exact name from Azure AI Foundry → Deployments (case-sensitive)"
          loading={loading}
        />
        <ConfigField label="API Version" value={cfg.apiVersion}
          onChange={v => setCfg(p => ({ ...p, apiVersion: v }))}
          onClearResult={() => setTestResult(null)}
          placeholder="2024-12-01-preview"
          hint="Recommended: 2025-01-01-preview (for gpt-4.1) or 2024-12-01-preview (for gpt-4o). Older versions cause HTTP 500."
          loading={loading}
        />

        {/* Test result banner */}
        {testResult && (
          <div className={`selectable rounded-lg border px-4 py-3 mb-4 text-sm ${
            testResult.ok
              ? 'bg-green-900/20 border-green-700/40 text-green-300'
              : 'bg-red-900/20 border-red-700/40 text-red-300'
          }`}>
            <div className="flex items-start gap-2">
              {testResult.ok
                ? <Check size={14} className="text-green-400 flex-shrink-0 mt-0.5" />
                : <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />}
              <pre className="whitespace-pre-wrap text-xs leading-relaxed font-mono flex-1">{testResult.message}</pre>
              <button
                onClick={() => navigator.clipboard.writeText(testResult.message)}
                title="Copy error message"
                className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity mt-0.5"
              >
                <Copy size={12} />
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={handleTest}
            disabled={!canSave || testing}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-brand-600/40 bg-brand-900/30 text-brand-300 hover:bg-brand-900/50 transition-colors disabled:opacity-40 disabled:cursor-default"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="btn-primary flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-default"
          >
            {saved ? <><Check size={14} /><span>Saved!</span></> : <><Key size={14} /><span>Save Config</span></>}
          </button>
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-200 px-3 py-2 rounded-lg hover:bg-surface-700 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Welcome Screen ─────────────────────────────────────────────────────────────

function WelcomeScreen({ onSetKey }: { onSetKey: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-12 text-center">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-600 to-brand-600 flex items-center justify-center shadow-2xl">
        <Brain size={40} className="text-white" />
      </div>
      <div>
        <h1 className="text-2xl font-bold text-white mb-2">AI Co-Pilot</h1>
        <p className="text-slate-400 max-w-sm leading-relaxed">
          Powered by Azure OpenAI (GPT-4o). Generate tests from natural language, analyze failures, and explore your app automatically.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3 max-w-lg w-full">
        {[
          { icon: FlaskConical, title: 'Generate Tests', desc: 'Describe a flow → get YAML' },
          { icon: AlertTriangle, title: 'Analyze Failures', desc: 'Paste logs → get root cause' },
          { icon: Search, title: 'Explore & Generate', desc: 'URL → full test suite' },
        ].map(({ icon: Icon, title, desc }) => (
          <div key={title} className="bg-surface-700/60 border border-surface-600 rounded-xl p-4 text-left">
            <Icon size={18} className="text-brand-400 mb-2" />
            <p className="text-white text-sm font-medium mb-1">{title}</p>
            <p className="text-slate-400 text-xs">{desc}</p>
          </div>
        ))}
      </div>
      <button
        onClick={onSetKey}
        className="btn-primary flex items-center gap-2 px-6 py-3"
      >
        <Key size={16} />
        Configure Azure OpenAI to Get Started
      </button>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AIPage() {
  const ipc = api
  const projectDir = useAppStore(s => s.projectDir)
  const keywords = useAppStore(s => s.keywords)

  const [mode, setMode] = useState<Mode>('generate')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showContext, setShowContext] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const activeMode = MODES.find(m => m.id === mode)!

  // Check for Azure config on mount
  useEffect(() => {
    if (ipc?.ai) {
      ipc.ai.getConfig()
        .then((c: any) =>
          setHasKey(!!(String(c?.endpoint ?? '').trim() && String(c?.apiKey ?? '').trim() && String(c?.deployment ?? '').trim()))
        )
        .catch(() => setHasKey(false))
    } else {
      setHasKey(false)
    }
  }, [])

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Register chunk listener — refreshed on mode change
  useEffect(() => {
    if (!ipc?.ai) return
    ipc.ai.removeListeners()
    ipc.ai.onChunk((token: string) => {
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (!last || last.role !== 'assistant') return prev
        return prev.map((m, i) =>
          i === prev.length - 1 ? { ...m, content: m.content + token, streaming: true } : m
        )
      })
    })
    return () => ipc.ai.removeListeners()
  }, [mode])

  // Clear conversation when mode changes
  useEffect(() => {
    setMessages([])
    setError(null)
  }, [mode])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming || !ipc?.ai) return

    setError(null)
    setInput('')

    const userMsg: ChatMessage = { id: nanoid(), role: 'user', content: text }
    const assistantMsg: ChatMessage = { id: nanoid(), role: 'assistant', content: '', streaming: true }

    const updatedMessages = [...messages, userMsg]
    setMessages([...updatedMessages, assistantMsg])
    setIsStreaming(true)

    const apiMessages = updatedMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    const systemPrompt = buildSystemPrompt(mode, keywords, projectDir)

    // Fresh listeners for this turn
    ipc.ai.removeListeners()
    ipc.ai.onChunk((token: string) => {
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (!last || last.role !== 'assistant') return prev
        return prev.map((m, i) =>
          i === prev.length - 1 ? { ...m, content: m.content + token, streaming: true } : m
        )
      })
    })
    ipc.ai.onDone(() => {
      setMessages(prev =>
        prev.map((m, i) => i === prev.length - 1 ? { ...m, streaming: false } : m)
      )
      setIsStreaming(false)
      ipc.ai.removeListeners()
    })

    try {
      await ipc.ai.chat(apiMessages, systemPrompt)
      // chat() returns quickly with {ok:true}; tokens stream in via onChunk/onDone
    } catch (err: any) {
      setError(err.message ?? 'Unknown error')
      setMessages(prev => prev.slice(0, -1)) // remove empty assistant msg
      setIsStreaming(false)
      ipc.ai.removeListeners()
    }
  }, [input, isStreaming, messages, mode, keywords, projectDir, ipc])

  async function handleAbort() {
    if (ipc?.ai) await ipc.ai.abort()
    setMessages(prev =>
      prev.map((m, i) => i === prev.length - 1 ? { ...m, streaming: false } : m)
    )
    setIsStreaming(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function closeSettings() {
    setShowSettings(false)
    if (ipc?.ai) ipc.ai.getConfig()
      .then((c: any) =>
        setHasKey(!!(String(c?.endpoint ?? '').trim() && String(c?.apiKey ?? '').trim() && String(c?.deployment ?? '').trim()))
      ).catch(() => {})
  }

  return (
    <div className="h-full flex flex-col bg-surface-800 relative">
      {/* Settings Modal */}
      {showSettings && <SettingsPanel onClose={closeSettings} />}

      {/* Loading state */}
      {hasKey === null && !showSettings && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <Loader2 size={24} className="animate-spin text-brand-400" />
        </div>
      )}

      {/* Top bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-600 flex-shrink-0">
        <Brain size={18} className="text-brand-400" />
        <span className="text-white font-semibold text-sm">AI Co-Pilot</span>
        <span className="text-xs text-brand-300 bg-brand-900/40 px-2 py-0.5 rounded-full border border-brand-600/30 ml-1">Azure GPT-4o</span>

        <div className="flex-1" />

        {/* Mode tabs */}
        <div className="flex items-center gap-1 bg-surface-700/60 rounded-lg p-1">
          {MODES.map(m => {
            const Icon = m.icon
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  mode === m.id
                    ? 'bg-brand-600/30 text-brand-300 border border-brand-600/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface-600'
                }`}
              >
                <Icon size={13} />
                {m.label}
              </button>
            )
          })}
        </div>

        {/* Context toggle */}
        <button
          onClick={() => setShowContext(v => !v)}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 px-2 py-1.5 rounded-lg hover:bg-surface-700 transition-colors"
        >
          <Terminal size={13} />
          Context
          {showContext ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>

        {/* Clear */}
        {messages.length > 0 && (
          <button
            onClick={() => { setMessages([]); setError(null) }}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-red-400 px-2 py-1.5 rounded-lg hover:bg-surface-700 transition-colors"
          >
            <Trash2 size={13} />
            Clear
          </button>
        )}

        {/* Settings */}
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 px-2 py-1.5 rounded-lg hover:bg-surface-700 transition-colors"
        >
          <Settings size={13} />
        </button>
      </div>

      {/* Context panel (collapsible) */}
      {showContext && (
        <div className="px-4 py-2.5 bg-surface-700/30 border-b border-surface-600 flex-shrink-0">
          <p className="text-xs text-slate-400 mb-1.5 font-medium">Injected context for this conversation:</p>
          <div className="flex flex-wrap gap-2">
            <span className="text-xs bg-surface-700 border border-surface-600 px-2.5 py-1 rounded-full text-slate-300 font-mono">
              {keywords.length} keywords available
            </span>
            <span className="text-xs bg-surface-700 border border-surface-600 px-2.5 py-1 rounded-full text-slate-300 font-mono">
              Project: {projectDir ? projectDir.split('/').pop() : 'none'}
            </span>
            <span className="text-xs bg-surface-700 border border-surface-600 px-2.5 py-1 rounded-full text-slate-300 font-mono">
              Mode: {mode}
            </span>
            <span className="text-xs bg-surface-700 border border-surface-600 px-2.5 py-1 rounded-full text-slate-300 font-mono">
              Model: Azure GPT-4o
            </span>
          </div>
        </div>
      )}

      {/* Body */}
      {hasKey === false ? (
        <WelcomeScreen onSetKey={() => setShowSettings(true)} />
      ) : (
        <>
          {/* Chat area */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-600/40 to-brand-600/40 border border-brand-600/30 flex items-center justify-center">
                  <activeMode.icon size={24} className="text-brand-300" />
                </div>
                <div>
                  <p className="text-white font-medium mb-1">{activeMode.label}</p>
                  <p className="text-slate-400 text-sm max-w-sm">{activeMode.welcome}</p>
                </div>
                {/* Quick start chips */}
                {mode === 'generate' && (
                  <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                    {[
                      'Login with valid credentials',
                      'Add item to cart and checkout',
                      'Search and filter products',
                      'User registration flow',
                    ].map(s => (
                      <button
                        key={s}
                        onClick={() => setInput(s)}
                        className="text-xs px-3 py-1.5 rounded-full border border-surface-600 bg-surface-700/60 text-slate-300 hover:text-white hover:border-brand-500 hover:bg-brand-900/30 transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                {mode === 'analyze' && (
                  <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                    {[
                      'Element not found error',
                      'Timeout waiting for element',
                      'Unexpected URL after navigation',
                    ].map(s => (
                      <button key={s} onClick={() => setInput(s)}
                        className="text-xs px-3 py-1.5 rounded-full border border-surface-600 bg-surface-700/60 text-slate-300 hover:text-white hover:border-brand-500 hover:bg-brand-900/30 transition-colors">
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {messages.map(msg => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}

            {/* Error banner */}
            {error && (
              <div className="selectable flex items-start gap-2 bg-red-900/20 border border-red-700/40 rounded-lg px-4 py-3">
                <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-300 flex-1">{error}</p>
                <button onClick={() => navigator.clipboard.writeText(error)} title="Copy error" className="text-red-400 hover:text-red-200 opacity-50 hover:opacity-100 transition-opacity">
                  <Copy size={12} />
                </button>
                <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200">
                  <X size={13} />
                </button>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input area */}
          <div className="flex-shrink-0 px-4 py-3 border-t border-surface-600 bg-surface-800/80">
            <div className="flex gap-2 items-end">
              <div className="flex-1 relative">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={activeMode.placeholder}
                  rows={3}
                  disabled={isStreaming}
                  className="input w-full text-sm resize-none leading-relaxed py-2.5 pr-2 disabled:opacity-50"
                  style={{ minHeight: '72px', maxHeight: '200px' }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                {isStreaming ? (
                  <button
                    onClick={handleAbort}
                    className="w-10 h-10 flex items-center justify-center rounded-lg bg-red-600/20 border border-red-600/40 text-red-400 hover:bg-red-600/30 transition-colors"
                    title="Stop generation"
                  >
                    <X size={16} />
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!input.trim()}
                    className="w-10 h-10 flex items-center justify-center rounded-lg bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-40 disabled:cursor-default"
                    title="Send (Enter)"
                  >
                    <Send size={16} />
                  </button>
                )}
                <button
                  onClick={() => { setMessages([]); setError(null) }}
                  title="New conversation"
                  className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-300 hover:bg-surface-700 transition-colors"
                >
                  <RotateCcw size={14} />
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-600 mt-1.5">
              Enter to send · Shift+Enter for new line · YAML blocks can be saved as tests directly
            </p>
          </div>
        </>
      )}
    </div>
  )
}
