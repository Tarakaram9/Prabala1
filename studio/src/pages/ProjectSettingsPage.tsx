// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio – Project Settings Page
// Covers: general project config + AI Self-Healing (aiRepair)
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import {
  Settings, Check, Save, Loader2, ChevronDown, ChevronUp, Wand2,
  FlaskConical, Key, Globe, RefreshCw, Info,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import api from '../lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AiRepairConfig {
  provider: 'ollama' | 'openai' | 'anthropic'
  model?: string
  apiKey?: string
  baseUrl?: string
  autoUpdateRepo?: boolean
}

interface ProjectConfig {
  name?: string
  browser?: string
  headless?: boolean
  timeout?: number
  outputDir?: string
  objectRepositoryDir?: string
  aiRepair?: AiRepairConfig
  [key: string]: unknown
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const PROVIDER_DEFAULTS: Record<string, { model: string; baseUrl: string; placeholder: string }> = {
  ollama:    { model: 'llama3',             baseUrl: 'http://localhost:11434', placeholder: 'http://localhost:11434' },
  openai:    { model: 'gpt-4o-mini',        baseUrl: 'https://api.openai.com/v1', placeholder: 'https://api.openai.com/v1' },
  anthropic: { model: 'claude-haiku-20240307', baseUrl: 'https://api.anthropic.com/v1', placeholder: 'https://api.anthropic.com/v1' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function SectionCard({ title, icon: Icon, children }: {
  title: string
  icon: React.ElementType
  children: React.ReactNode
}) {
  return (
    <div className="bg-surface-800 border border-surface-700 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-700 bg-surface-750">
        <Icon size={15} className="text-brand-400" />
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-slate-300">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

function Input({ value, onChange, placeholder, type = 'text', disabled }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  disabled?: boolean
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    />
  )
}

function Select({ value, onChange, options }: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/60 transition-colors"
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <div
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-surface-600'}`}
      >
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </div>
      <span className="text-sm text-slate-300">{label}</span>
    </label>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ProjectSettingsPage() {
  const { workspace } = useAppStore()
  const ipc = api

  const [cfg, setCfg] = useState<ProjectConfig>({})
  const [healingEnabled, setHealingEnabled] = useState(false)
  const [aiCfg, setAiCfg] = useState<AiRepairConfig>({
    provider: 'ollama',
    model: PROVIDER_DEFAULTS.ollama.model,
    baseUrl: PROVIDER_DEFAULTS.ollama.baseUrl,
    autoUpdateRepo: true,
  })
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [advanced, setAdvanced] = useState(false)

  const configPath = workspace?.path ? `${workspace.path}/prabala.config.json` : null

  // ── Load config ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!configPath) return
    setLoading(true)
    ipc.fs.readFile(configPath)
      .then(raw => {
        const parsed: ProjectConfig = JSON.parse(raw)
        setCfg(parsed)
        if (parsed.aiRepair) {
          setHealingEnabled(true)
          setAiCfg({
            provider:      parsed.aiRepair.provider ?? 'ollama',
            model:         parsed.aiRepair.model ?? PROVIDER_DEFAULTS[parsed.aiRepair.provider ?? 'ollama'].model,
            apiKey:        parsed.aiRepair.apiKey ?? '',
            baseUrl:       parsed.aiRepair.baseUrl ?? PROVIDER_DEFAULTS[parsed.aiRepair.provider ?? 'ollama'].baseUrl,
            autoUpdateRepo: parsed.aiRepair.autoUpdateRepo ?? true,
          })
        }
      })
      .catch(() => { /* no config file yet */ })
      .finally(() => setLoading(false))
  }, [configPath])

  // ── When provider changes, reset model/baseUrl to defaults ───────────────
  function handleProviderChange(provider: string) {
    const p = provider as AiRepairConfig['provider']
    const d = PROVIDER_DEFAULTS[p]
    setAiCfg(prev => ({ ...prev, provider: p, model: d.model, baseUrl: d.baseUrl }))
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!configPath) return
    const next: ProjectConfig = { ...cfg }
    if (healingEnabled) {
      const repair: AiRepairConfig = { provider: aiCfg.provider }
      if (aiCfg.model?.trim())   repair.model   = aiCfg.model.trim()
      if (aiCfg.apiKey?.trim())  repair.apiKey  = aiCfg.apiKey.trim()
      if (aiCfg.baseUrl?.trim()) repair.baseUrl = aiCfg.baseUrl.trim()
      repair.autoUpdateRepo = aiCfg.autoUpdateRepo ?? true
      next.aiRepair = repair
    } else {
      delete next.aiRepair
    }
    await ipc.fs.writeFile(configPath, JSON.stringify(next, null, 2))
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }, [configPath, cfg, healingEnabled, aiCfg, ipc])

  if (!workspace) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        Open a workspace first.
      </div>
    )
  }

  const needsKey = aiCfg.provider === 'openai' || aiCfg.provider === 'anthropic'
  const defaults = PROVIDER_DEFAULTS[aiCfg.provider]

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-900">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-surface-700 bg-surface-850 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
            <Settings size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-white">Project Settings</h1>
            <p className="text-xs text-slate-500 truncate max-w-xs">{workspace.path}</p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-medium"
        >
          {saved
            ? <><Check size={14} className="text-green-300" /><span className="text-green-300">Saved!</span></>
            : <><Save size={14} /><span>Save Settings</span></>
          }
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-brand-400" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* ── Self-Healing Section ───────────────────────────────────────── */}
          <SectionCard title="Self-Healing" icon={Wand2}>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-brand-900/20 border border-brand-700/30">
              <Info size={14} className="text-brand-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-slate-400 leading-relaxed">
                When elements change, self-healing automatically tries fallback locators then uses an AI provider
                to find the updated selector. Healed locators are written back to the object repository.
              </p>
            </div>

            <Toggle
              checked={healingEnabled}
              onChange={setHealingEnabled}
              label="Enable self-healing"
            />

            {healingEnabled && (
              <div className="space-y-4 pt-2 border-t border-surface-700">

                <Field label="AI Provider">
                  <Select
                    value={aiCfg.provider}
                    onChange={handleProviderChange}
                    options={[
                      { value: 'ollama',    label: 'Ollama (local — free, no API key needed)' },
                      { value: 'openai',    label: 'OpenAI (GPT-4o-mini recommended)' },
                      { value: 'anthropic', label: 'Anthropic (Claude Haiku)' },
                    ]}
                  />
                </Field>

                <Field
                  label="Model"
                  hint={`Default: ${defaults.model}`}
                >
                  <Input
                    value={aiCfg.model ?? ''}
                    onChange={v => setAiCfg(p => ({ ...p, model: v }))}
                    placeholder={defaults.model}
                  />
                </Field>

                {needsKey && (
                  <Field label="API Key">
                    <Input
                      type="password"
                      value={aiCfg.apiKey ?? ''}
                      onChange={v => setAiCfg(p => ({ ...p, apiKey: v }))}
                      placeholder="sk-..."
                    />
                  </Field>
                )}

                {/* Advanced toggle */}
                <button
                  onClick={() => setAdvanced(a => !a)}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                >
                  {advanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  Advanced options
                </button>

                {advanced && (
                  <div className="space-y-4 pl-4 border-l-2 border-surface-700">
                    <Field
                      label="Base URL"
                      hint={aiCfg.provider === 'ollama' ? 'Change if Ollama runs on a different host/port.' : 'Use for OpenAI-compatible proxies or custom endpoints.'}
                    >
                      <Input
                        value={aiCfg.baseUrl ?? ''}
                        onChange={v => setAiCfg(p => ({ ...p, baseUrl: v }))}
                        placeholder={defaults.baseUrl}
                      />
                    </Field>

                    <Toggle
                      checked={aiCfg.autoUpdateRepo ?? true}
                      onChange={v => setAiCfg(p => ({ ...p, autoUpdateRepo: v }))}
                      label="Auto-update object repository with healed locators"
                    />
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          {/* ── General Section ────────────────────────────────────────────── */}
          <SectionCard title="General" icon={FlaskConical}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Browser" hint="Used for web test runs">
                <Select
                  value={String(cfg.browser ?? 'chromium')}
                  onChange={v => setCfg(p => ({ ...p, browser: v }))}
                  options={[
                    { value: 'chromium', label: 'Chromium (default)' },
                    { value: 'firefox',  label: 'Firefox' },
                    { value: 'webkit',   label: 'WebKit / Safari' },
                  ]}
                />
              </Field>
              <Field label="Step Timeout (ms)" hint="Default timeout per keyword step">
                <Input
                  value={String(cfg.timeout ?? 30000)}
                  onChange={v => setCfg(p => ({ ...p, timeout: Number(v) || 30000 }))}
                  placeholder="30000"
                />
              </Field>
            </div>
            <Toggle
              checked={Boolean(cfg.headless)}
              onChange={v => setCfg(p => ({ ...p, headless: v }))}
              label="Headless mode (no browser window)"
            />
          </SectionCard>

          {/* ── Paths Section ──────────────────────────────────────────────── */}
          <SectionCard title="Paths" icon={Globe}>
            <Field label="Artifacts Output Directory" hint="Screenshots, reports, traces are stored here">
              <Input
                value={String(cfg.outputDir ?? '')}
                onChange={v => setCfg(p => ({ ...p, outputDir: v }))}
                placeholder={`${workspace.path}/artifacts`}
              />
            </Field>
            <Field label="Object Repository Directory" hint="Where element locator YAML files live">
              <Input
                value={String(cfg.objectRepositoryDir ?? '')}
                onChange={v => setCfg(p => ({ ...p, objectRepositoryDir: v }))}
                placeholder={`${workspace.path}/object-repository`}
              />
            </Field>
          </SectionCard>

          {/* ── Object Repo Fallbacks Tip ──────────────────────────────────── */}
          <SectionCard title="Using Fallback Locators" icon={RefreshCw}>
            <p className="text-xs text-slate-400 leading-relaxed">
              Add <code className="text-brand-300 bg-surface-700 px-1 rounded">fallbacks</code> entries
              in your object repository YAML to give the self-healing engine alternative locators to try
              before invoking AI. Example:
            </p>
            <pre className="text-xs bg-surface-700 rounded-lg p-3 text-slate-300 overflow-x-auto leading-relaxed">{`objects:
  loginButton:
    strategy: id
    locator: login-btn
    description: "The main login button"
    fallbacks:
      - strategy: name
        locator: "Login"
      - strategy: css
        locator: "button.login-action"`}</pre>
            <p className="text-xs text-slate-500">
              Fallbacks are tried in order. The first matching locator wins and is written back to the YAML
              (as <code className="text-brand-300">_healedLocator</code>) so future runs skip the fallback scan.
            </p>
          </SectionCard>

        </div>
      )}
    </div>
  )
}
