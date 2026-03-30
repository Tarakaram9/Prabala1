import { useState, useRef } from 'react'
import {
  ClipboardList, Plus, Trash2, RefreshCw, Wand2, Loader2,
  Link2, X, ChevronDown, ChevronRight, FileUp, ExternalLink,
  Zap, FlaskConical, FileText, AlertCircle, CheckCircle2, Settings2
} from 'lucide-react'
import api from '../lib/api'
import { useAppStore, Requirement, JiraConfig, TestCase, TestStep } from '../store/appStore'

// ── Types ─────────────────────────────────────────────────────────────────────
type GenTarget = 'builder' | 'bdd'

interface GenState {
  reqKey: string
  target: GenTarget
  streaming: boolean
  done: boolean
  error: string | null
  output: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9) }

function reqTypeBadge(type: string) {
  const map: Record<string, string> = {
    Story: 'bg-blue-900/40 text-blue-300',
    Bug: 'bg-red-900/40 text-red-300',
    Epic: 'bg-purple-900/40 text-purple-300',
    Task: 'bg-slate-700 text-slate-300',
    Manual: 'bg-green-900/40 text-green-300',
    Import: 'bg-yellow-900/40 text-yellow-300',
  }
  return map[type] ?? 'bg-slate-700 text-slate-300'
}

function statusDot(status: string) {
  if (/done|closed|resolved/i.test(status)) return 'bg-green-400'
  if (/progress|active/i.test(status)) return 'bg-blue-400'
  if (/blocked/i.test(status)) return 'bg-red-400'
  return 'bg-slate-500'
}

// ── System prompts ────────────────────────────────────────────────────────────
function buildTestSystemPrompt(req: Requirement): string {
  return `You are a Prabala test automation expert. Generate a YAML test case from the requirement below.

REQUIREMENT:
Title: ${req.title}
Description: ${req.description || '(none)'}
Type: ${req.type}

OUTPUT FORMAT — return ONLY valid YAML, no markdown fences:
testCase: "<test name>"
tags: [automated, generated]
description: "<what this tests>"
steps:
  - keyword: NavigateTo
    params:
      url: "https://app.example.com"
  - keyword: Click
    params:
      locator: "#login-btn"

AVAILABLE KEYWORDS (use only these):
Web.Launch, Web.Close, NavigateTo, GoBack, Reload,
Click, DoubleClick, RightClick, EnterText, SelectOption, PressKey, Hover, ScrollTo, Check, Uncheck,
WaitForVisible, WaitForHidden, Wait,
AssertText, AssertVisible, AssertNotVisible, AssertTitle, AssertUrl, AssertEnabled,
TakeScreenshot,
SAP.Connect, SAP.Login, SAP.RunTCode, SAP.SetText, SAP.Disconnect

RULES:
1. Use placeholder locators like "#element-id" or ".class-name".
2. Cover the happy path and at least one assertion.
3. Return ONLY the YAML — no explanation, no code blocks.`
}

function buildBddSystemPrompt(req: Requirement): string {
  return `You are a Gherkin scenario writer for the Prabala test automation framework.

REQUIREMENT:
Title: ${req.title}
Description: ${req.description || '(none)'}
Type: ${req.type}

Generate Gherkin scenarios for this requirement.

OUTPUT FORMAT — return ONLY raw Gherkin, no markdown fences:
Scenario: <title>
  Given <step>
  When <step>
  Then <step>

USE ONLY these step templates:
- "I launch the browser"
- "I navigate to \\"https://example.com\\""
- "I click \\"#button\\""
- "I enter \\"value\\" in \\"#input\\""
- "I should see \\"Welcome\\""
- "I see \\"#element\\""
- "I don't see \\"#element\\""
- "the text of \\"#el\\" is \\"expected\\""
- "I take a screenshot"
- "I wait for \\"#element\\""
- "I press \\"Enter\\""
- "I select \\"option\\" from \\"#dropdown\\""

RULES:
1. Generate 1-3 scenarios (happy path + edge cases if applicable).
2. Use 2-space indentation.
3. Return ONLY the Gherkin text — no explanation, no code blocks.`
}

// Parse raw YAML text into a TestCase object (best-effort)
function parseYamlToTestCase(yaml: string, reqTitle: string): TestCase | null {
  try {
    const lines = yaml.split('\n')
    let testCaseName = reqTitle
    const steps: TestStep[] = []
    let inSteps = false
    let currentStep: Partial<TestStep> & { params: Record<string, string> } = { params: {} }

    for (const raw of lines) {
      const line = raw.trimEnd()
      const tcMatch = line.match(/^testCase:\s*['"]?(.+?)['"]?\s*$/)
      if (tcMatch) { testCaseName = tcMatch[1]; continue }
      if (/^steps:/.test(line)) { inSteps = true; continue }
      if (!inSteps) continue

      const stepStart = line.match(/^  - keyword:\s*(\S+)/)
      if (stepStart) {
        if (currentStep.keyword) {
          steps.push({ id: crypto.randomUUID(), keyword: currentStep.keyword, params: currentStep.params } as TestStep)
        }
        currentStep = { keyword: stepStart[1], params: {} }
        continue
      }
      const paramMatch = line.match(/^      (\w+):\s*['"]?(.+?)['"]?\s*$/)
      if (paramMatch && currentStep.keyword) {
        currentStep.params[paramMatch[1]] = paramMatch[2]
      }
    }
    if (currentStep.keyword) {
      steps.push({ id: crypto.randomUUID(), keyword: currentStep.keyword, params: currentStep.params } as TestStep)
    }
    if (steps.length === 0) return null
    return {
      id: crypto.randomUUID(),
      filePath: '',
      testCase: testCaseName,
      tags: ['automated', 'generated'],
      description: `Generated from requirement: ${reqTitle}`,
      steps,
      isDirty: true,
    }
  } catch { return null }
}

// ── Jira Panel ────────────────────────────────────────────────────────────────
function JiraPanel({ onClose, onFetched }: { onClose: () => void; onFetched: (reqs: Requirement[]) => void }) {
  const { jiraConfig, setJiraConfig } = useAppStore((s) => ({ jiraConfig: s.jiraConfig, setJiraConfig: s.setJiraConfig }))
  const [cfg, setCfg] = useState<JiraConfig>({ ...jiraConfig })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchIssues() {
    const { baseUrl, email, apiToken, jql } = cfg
    if (!baseUrl || !email || !apiToken) { setError('Fill in Base URL, Email and API Token'); return }
    setLoading(true); setError(null)
    try {
      const effectiveJql = jql.trim() || `project = "${cfg.projectKey}" ORDER BY created DESC`
      const res = await fetch('/api/jira/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, email, apiToken, jql: effectiveJql, maxResults: 100 }),
      })
      const data = await res.json() as { issues?: any[]; error?: string }
      if (!res.ok || data.error) { setError(data.error ?? `HTTP ${res.status}`); return }
      const reqs: Requirement[] = (data.issues ?? []).map((issue: any) => ({
        id: uid(),
        key: issue.key,
        title: issue.fields?.summary ?? issue.key,
        description: issue.fields?.description?.content?.[0]?.content?.[0]?.text ?? '',
        type: issue.fields?.issuetype?.name ?? 'Story',
        status: issue.fields?.status?.name ?? 'Open',
        source: 'jira' as const,
        url: `https://${cfg.baseUrl.replace(/^https?:\/\//, '').split('/')[0]}/browse/${issue.key}`,
      }))
      setJiraConfig(cfg)
      onFetched(reqs)
      onClose()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="border border-surface-500 rounded-xl bg-surface-800 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link2 size={14} className="text-blue-400" />
          <span className="text-sm font-semibold text-slate-200">Jira Connection</span>
        </div>
        <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300 rounded"><X size={14}/></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Base URL <span className="text-slate-600">(e.g. mycompany.atlassian.net)</span></label>
          <input value={cfg.baseUrl} onChange={e => setCfg(p => ({ ...p, baseUrl: e.target.value }))}
            placeholder="mycompany.atlassian.net" className="input w-full text-xs" />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Project Key</label>
          <input value={cfg.projectKey} onChange={e => setCfg(p => ({ ...p, projectKey: e.target.value }))}
            placeholder="MYAPP" className="input w-full text-xs" />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Email</label>
          <input value={cfg.email} onChange={e => setCfg(p => ({ ...p, email: e.target.value }))}
            placeholder="you@company.com" className="input w-full text-xs" type="email" />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">API Token <span className="text-slate-600">(Atlassian account token)</span></label>
          <input value={cfg.apiToken} onChange={e => setCfg(p => ({ ...p, apiToken: e.target.value }))}
            placeholder="API token" className="input w-full text-xs" type="password" autoComplete="off" />
        </div>
      </div>
      <div>
        <label className="text-xs text-slate-500 mb-1 block">JQL Filter <span className="text-slate-600">(optional — leave blank to use project key)</span></label>
        <input value={cfg.jql} onChange={e => setCfg(p => ({ ...p, jql: e.target.value }))}
          placeholder={`project = "${cfg.projectKey || 'MYAPP'}" AND issuetype = Story ORDER BY updated DESC`}
          className="input w-full text-xs" />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button onClick={fetchIssues} disabled={loading}
          className="btn-primary text-xs flex items-center gap-1.5 flex-shrink-0">
          {loading ? <><Loader2 size={12} className="animate-spin"/> Fetching…</> : <><RefreshCw size={12}/> Fetch Issues</>}
        </button>
        <button onClick={onClose} className="btn-secondary text-xs">Cancel</button>
      </div>
    </div>
  )
}

// ── Requirement Card ─────────────────────────────────────────────────────────
function RequirementCard({
  req, onDelete, onGenerate
}: {
  req: Requirement
  onDelete: () => void
  onGenerate: (target: GenTarget) => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-surface-600 rounded-xl bg-surface-800 overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3">
        <button onClick={() => setExpanded(e => !e)} className="mt-0.5 text-slate-500 hover:text-slate-300 flex-shrink-0">
          {expanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-slate-500">{req.key}</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${reqTypeBadge(req.type)}`}>{req.type}</span>
            <span className="flex items-center gap-1 text-[10px] text-slate-500">
              <span className={`w-1.5 h-1.5 rounded-full ${statusDot(req.status)}`}/>
              {req.status}
            </span>
            {req.source === 'jira' && req.url && (
              <a href={req.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5">
                <ExternalLink size={9}/> Jira
              </a>
            )}
          </div>
          <p className="text-sm text-slate-200 font-medium mt-0.5 leading-snug">{req.title}</p>
          {expanded && req.description && (
            <p className="text-xs text-slate-400 mt-1.5 whitespace-pre-wrap leading-relaxed">{req.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={() => onGenerate('builder')} title="Generate YAML test in Test Builder"
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-600/20 hover:bg-brand-600/40 border border-brand-600/30 text-brand-300 text-[10px] font-semibold transition-colors">
            <FlaskConical size={10}/> Test
          </button>
          <button onClick={() => onGenerate('bdd')} title="Generate Gherkin scenario in BDD page"
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-600/20 hover:bg-purple-600/40 border border-purple-600/30 text-purple-300 text-[10px] font-semibold transition-colors">
            <FileText size={10}/> BDD
          </button>
          <button onClick={onDelete} className="p-1 text-slate-600 hover:text-red-400 rounded"><Trash2 size={12}/></button>
        </div>
      </div>
    </div>
  )
}

// ── AI Generation Panel ───────────────────────────────────────────────────────
function GenPanel({ gen, req, onClose, onApply }: {
  gen: GenState
  req: Requirement
  onClose: () => void
  onApply: (yaml: string, target: GenTarget) => void
}) {
  return (
    <div className="border border-surface-500 rounded-xl bg-surface-900/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {gen.streaming ? <Loader2 size={14} className="text-purple-400 animate-spin"/> :
           gen.error ? <AlertCircle size={14} className="text-red-400"/> :
           gen.done ? <CheckCircle2 size={14} className="text-green-400"/> :
           <Wand2 size={14} className="text-purple-400"/>}
          <span className="text-xs font-semibold text-slate-200">
            {gen.streaming ? 'Generating…' :
             gen.error ? 'Generation failed' :
             gen.done ? 'Ready to apply' : 'AI Generator'}
          </span>
          <span className="text-[10px] text-slate-500">
            → {gen.target === 'builder' ? 'Test Builder (YAML)' : 'BDD / Gherkin'}
          </span>
        </div>
        <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300 rounded"><X size={13}/></button>
      </div>

      <pre className="text-xs text-green-300 font-mono bg-surface-900 border border-surface-600 rounded-lg p-3 max-h-64 overflow-y-auto whitespace-pre-wrap">
        {gen.output || (gen.streaming ? '…' : '')}
      </pre>

      {gen.error && <p className="text-xs text-red-400">{gen.error}</p>}

      {gen.done && !gen.error && (
        <button onClick={() => onApply(gen.output, gen.target)}
          className="btn-primary text-xs flex items-center gap-1.5">
          <Zap size={12}/>
          {gen.target === 'builder' ? 'Open in Test Builder' : 'Open in BDD Page'}
        </button>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function RequirementsPage() {
  const {
    requirements, setRequirements, upsertRequirements,
    testCases, setTestCases, setActiveTestCase, setActivePage,
  } = useAppStore((s) => ({
    requirements: s.requirements,
    setRequirements: s.setRequirements,
    upsertRequirements: s.upsertRequirements,
    testCases: s.testCases,
    setTestCases: s.setTestCases,
    setActiveTestCase: s.setActiveTestCase,
    setActivePage: s.setActivePage,
  }))

  const [showJira, setShowJira] = useState(false)
  const [genState, setGenState] = useState<GenState | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newType, setNewType] = useState('Story')
  const [filter, setFilter] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const ipc = api
  const filtered = requirements.filter(r =>
    !filter || r.title.toLowerCase().includes(filter.toLowerCase()) ||
    r.key.toLowerCase().includes(filter.toLowerCase()) ||
    r.description.toLowerCase().includes(filter.toLowerCase())
  )

  // ── Add manual requirement ────────────────────────────────────────────────
  function addManual() {
    if (!newTitle.trim()) return
    const req: Requirement = {
      id: uid(), key: `REQ-${Date.now()}`,
      title: newTitle.trim(), description: newDesc.trim(),
      type: newType, status: 'Open', source: 'manual',
    }
    upsertRequirements([req])
    setNewTitle(''); setNewDesc(''); setAddOpen(false)
  }

  // ── Import from txt/csv ───────────────────────────────────────────────────
  function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
      const reqs: Requirement[] = lines.map((line, i) => ({
        id: uid(), key: `IMP-${Date.now()}-${i}`,
        title: line, description: '', type: 'Import', status: 'Open', source: 'import' as const,
      }))
      upsertRequirements(reqs)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // ── AI generation ─────────────────────────────────────────────────────────
  async function generateForReq(req: Requirement, target: GenTarget) {
    if (!ipc?.ai) {
      setGenState({ reqKey: req.key, target, streaming: false, done: false, error: 'AI not configured. Set your Azure OpenAI key in AI Co-Pilot settings.', output: '' })
      return
    }
    setGenState({ reqKey: req.key, target, streaming: true, done: false, error: null, output: '' })
    let buffer = ''
    ipc.ai.removeListeners?.()
    ipc.ai.onChunk((token: string) => {
      buffer += token
      setGenState(s => s ? { ...s, output: buffer } : s)
    })
    ipc.ai.onDone(() => {
      setGenState(s => s ? { ...s, streaming: false, done: true } : s)
      ipc.ai.removeListeners?.()
    })
    const systemPrompt = target === 'builder' ? buildTestSystemPrompt(req) : buildBddSystemPrompt(req)
    try {
      await ipc.ai.chat([{ role: 'user', content: `Generate tests for: ${req.title}` }], systemPrompt)
    } catch (err: any) {
      setGenState(s => s ? { ...s, streaming: false, done: false, error: err.message } : s)
      ipc.ai.removeListeners?.()
    }
  }

  // ── Apply AI output ───────────────────────────────────────────────────────
  function applyGenOutput(yamlText: string, target: GenTarget) {
    const activeReq = requirements.find(r => r.key === genState?.reqKey)
    if (!activeReq) return

    if (target === 'builder') {
      const tc = parseYamlToTestCase(yamlText, activeReq.title)
      if (!tc) { alert('Could not parse the generated YAML. Please try again.'); return }
      const newCases = [...testCases, tc]
      setTestCases(newCases)
      setActiveTestCase(tc)
      setActivePage('builder')
    } else {
      // Store generated Gherkin in session storage for BDD page to pick up
      const existing = sessionStorage.getItem('prabala_pending_gherkin') ?? ''
      sessionStorage.setItem('prabala_pending_gherkin', existing ? `${existing}\n\n${yamlText}` : yamlText)
      sessionStorage.setItem('prabala_pending_gherkin_feature', activeReq.title)
      setActivePage('gherkin')
    }
    setGenState(null)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-surface-500 bg-surface-800 flex items-center gap-4">
        <div className="flex-1">
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <ClipboardList size={18} className="text-brand-400"/> Requirements
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">{requirements.length} requirement{requirements.length !== 1 ? 's' : ''} · AI generates test cases from each one</p>
        </div>
        <div className="flex items-center gap-2">
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="Search…" className="input text-xs w-40 py-1.5" />
          <button onClick={() => fileInputRef.current?.click()}
            className="btn-secondary text-xs flex items-center gap-1.5 py-2">
            <FileUp size={13}/> Import
          </button>
          <input ref={fileInputRef} type="file" accept=".txt,.csv" className="hidden" onChange={handleFileImport} />
          <button onClick={() => setShowJira(s => !s)}
            className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition-colors ${
              showJira ? 'bg-blue-600/20 border-blue-500/40 text-blue-300' : 'btn-secondary'
            }`}>
            <Link2 size={13}/> Jira
          </button>
          <button onClick={() => setAddOpen(s => !s)}
            className="btn-primary text-xs flex items-center gap-1.5 py-2">
            <Plus size={13}/> Add
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {/* Jira panel */}
        {showJira && (
          <JiraPanel onClose={() => setShowJira(false)} onFetched={(reqs) => upsertRequirements(reqs)} />
        )}

        {/* Add manual panel */}
        {addOpen && (
          <div className="border border-surface-500 rounded-xl bg-surface-800 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-200">Add Requirement</span>
              <button onClick={() => setAddOpen(false)} className="p-1 text-slate-500 hover:text-slate-300 rounded"><X size={13}/></button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-slate-500 mb-1 block">Title *</label>
                <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
                  placeholder="User can log in with valid credentials"
                  className="input w-full text-xs" onKeyDown={e => e.key === 'Enter' && addManual()} />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Type</label>
                <select value={newType} onChange={e => setNewType(e.target.value)} className="input w-full text-xs">
                  {['Story', 'Epic', 'Task', 'Bug', 'Manual'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Description</label>
              <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} rows={2}
                placeholder="Acceptance criteria or more detail…"
                className="input w-full text-xs resize-none" />
            </div>
            <div className="flex gap-2">
              <button onClick={addManual} className="btn-primary text-xs flex items-center gap-1.5">
                <Plus size={12}/> Add Requirement
              </button>
              <button onClick={() => setAddOpen(false)} className="btn-secondary text-xs">Cancel</button>
            </div>
          </div>
        )}

        {/* AI gen panel */}
        {genState && (() => {
          const req = requirements.find(r => r.key === genState.reqKey)
          if (!req) return null
          return (
            <GenPanel
              gen={genState} req={req}
              onClose={() => setGenState(null)}
              onApply={applyGenOutput}
            />
          )
        })()}

        {/* AI instructions banner */}
        {requirements.length === 0 && !showJira && !addOpen && (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-slate-500">
            <ClipboardList size={40} className="opacity-30"/>
            <p className="text-sm">No requirements yet.</p>
            <p className="text-xs text-center max-w-xs">
              Import from a text file, connect Jira to pull stories, or add manually.<br/>
              Then click <strong className="text-brand-300">Test</strong> or <strong className="text-purple-300">BDD</strong> on any requirement to have AI generate test cases.
            </p>
            <div className="flex gap-3 mt-2">
              <button onClick={() => setShowJira(true)} className="btn-secondary text-xs flex items-center gap-1.5">
                <Link2 size={12}/> Connect Jira
              </button>
              <button onClick={() => setAddOpen(true)} className="btn-primary text-xs flex items-center gap-1.5">
                <Plus size={12}/> Add Manually
              </button>
            </div>
          </div>
        )}

        {/* Requirement cards */}
        {filtered.map(req => (
          <RequirementCard
            key={req.key}
            req={req}
            onDelete={() => setRequirements(requirements.filter(r => r.key !== req.key))}
            onGenerate={(target) => generateForReq(req, target)}
          />
        ))}

        {requirements.length > 0 && filtered.length === 0 && (
          <p className="text-xs text-slate-500 text-center py-8">No requirements match "{filter}"</p>
        )}

        {/* AI batch generate all */}
        {requirements.length > 0 && !genState && (
          <div className="flex items-center justify-center pt-2 gap-3">
            <button
              onClick={() => {
                const pending = requirements.filter(r => !genState)
                if (pending.length > 0) generateForReq(pending[0], 'builder')
              }}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-brand-600/30 bg-brand-600/10 text-brand-300 hover:bg-brand-600/20 transition-colors">
              <Wand2 size={12}/> Generate All as Tests
            </button>
            <span className="text-slate-600 text-xs">or select individual requirements above</span>
          </div>
        )}
      </div>

      {/* Settings hint */}
      <div className="flex-shrink-0 px-6 py-2 border-t border-surface-600 flex items-center gap-2">
        <Settings2 size={11} className="text-slate-600"/>
        <p className="text-[10px] text-slate-600">
          AI generation requires Azure OpenAI configured in <button onClick={() => setActivePage('ai')} className="text-brand-400 hover:underline">AI Co-Pilot → Settings</button>.
          Jira credentials are not persisted to disk.
        </p>
      </div>
    </div>
  )
}
