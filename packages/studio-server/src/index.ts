// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio Server
// Replaces Electron main process — serves React SPA + REST API + WebSocket
// ─────────────────────────────────────────────────────────────────────────────
import express, { Request, Response } from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import { spawn, ChildProcess } from 'child_process'
import os from 'os'

const app = express()
const httpServer = createServer(app)
const wss = new WebSocketServer({ noServer: true })

const PORT = parseInt(process.env.PORT ?? '3000', 10)
const STUDIO_DIST = path.resolve(__dirname, '../../studio/dist')

app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use(express.text({ limit: '50mb' }))

// ── WebSocket upgrade — path: /prabala-ws ─────────────────────────────────────
httpServer.on('upgrade', (request, socket, head) => {
  if (request.url === '/prabala-ws') {
    wss.handleUpgrade(request, socket as any, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  } else {
    socket.destroy()
  }
})

// ── Active processes ──────────────────────────────────────────────────────────
let runnerProcess: ChildProcess | null = null
let recorderProcess: ChildProcess | null = null
let spyProcess: ChildProcess | null = null

// ── WebSocket channel registry ────────────────────────────────────────────────
const wsClients = new Set<WebSocket>()

wss.on('connection', (ws) => {
  wsClients.add(ws)
  ws.on('close', () => wsClients.delete(ws))
})

function broadcast(type: string, payload: unknown) {
  const msg = JSON.stringify({ type, payload })
  wsClients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg)
  })
}

// ── /api/fs ───────────────────────────────────────────────────────────────────

app.get('/api/fs/read', async (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string
    if (!filePath) { res.status(400).json({ error: 'path required' }); return }
    const content = fs.readFileSync(filePath, 'utf-8')
    res.type('text/plain').send(content)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/fs/write', async (req: Request, res: Response) => {
  try {
    const { path: filePath, content } = req.body as { path: string; content: string }
    if (!filePath) { res.status(400).json({ error: 'path required' }); return }
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content, 'utf-8')
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/fs/dir', async (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string
    if (!dirPath) { res.status(400).json({ error: 'path required' }); return }
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    res.json(entries.map(e => ({
      name: e.name,
      isDir: e.isDirectory(),
      path: path.join(dirPath, e.name)
    })))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/fs/exists', (req: Request, res: Response) => {
  const filePath = req.query.path as string
  res.json({ exists: filePath ? fs.existsSync(filePath) : false })
})

app.delete('/api/fs/file', (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string
    if (!filePath) { res.status(400).json({ error: 'path required' }); return }
    fs.unlinkSync(filePath)
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/fs/mkdir', (req: Request, res: Response) => {
  try {
    const { path: dirPath } = req.body as { path: string }
    if (!dirPath) { res.status(400).json({ error: 'path required' }); return }
    fs.mkdirSync(dirPath, { recursive: true })
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/fs/dir', (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string
    if (!dirPath) { res.status(400).json({ error: 'path required' }); return }
    fs.rmSync(dirPath, { recursive: true, force: true })
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/fs/rename', (req: Request, res: Response) => {
  try {
    const { oldPath, newPath } = req.body as { oldPath: string; newPath: string }
    if (!oldPath || !newPath) { res.status(400).json({ error: 'oldPath and newPath required' }); return }
    fs.renameSync(oldPath, newPath)
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/fs/move', (req: Request, res: Response) => {
  try {
    const { srcPath, destPath } = req.body as { srcPath: string; destPath: string }
    if (!srcPath || !destPath) { res.status(400).json({ error: 'srcPath and destPath required' }); return }
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    fs.renameSync(srcPath, destPath)
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── /api/dialog ───────────────────────────────────────────────────────────────
// In the web version the client sends the path typed in a UI text input.
// openFolder() is a no-op here — the React layer handles it with a path dialog.
app.get('/api/dialog/open-folder', (_req: Request, res: Response) => {
  // Returns the home directory as a suggestion; the real picker is in the React UI
  res.json({ path: os.homedir() })
})

// ── /api/runner ───────────────────────────────────────────────────────────────

app.post('/api/runner/run', (req: Request, res: Response) => {
  try {
    const { pattern, projectDir, extraArgs = [] } = req.body as {
      pattern: string; projectDir: string; extraArgs?: string[]
    }
    if (runnerProcess) {
      runnerProcess.kill()
      runnerProcess = null
    }
    const cliPath = path.resolve(__dirname, '../../cli/dist/index.js')
    runnerProcess = spawn('node', [cliPath, 'run', pattern, ...extraArgs], {
      cwd: projectDir,
      env: { ...process.env },
    })

    runnerProcess.stdout?.on('data', (d: Buffer) => {
      broadcast('runner:stdout', d.toString())
    })
    runnerProcess.stderr?.on('data', (d: Buffer) => {
      broadcast('runner:stderr', d.toString())
    })
    runnerProcess.on('close', (code: number | null) => {
      broadcast('runner:done', code ?? 0)
      runnerProcess = null
    })
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/runner/stop', (_req: Request, res: Response) => {
  if (runnerProcess) {
    runnerProcess.kill()
    runnerProcess = null
    broadcast('runner:done', -1)
  }
  res.json({ ok: true })
})

// ── /api/recorder ─────────────────────────────────────────────────────────────
// Uses the same recorder.cjs script as Electron — emits JSON lines:
//   { "keyword": "Click", "params": { "locator": "..." } }
//   { "__done": true }

app.post('/api/recorder/start', (req: Request, res: Response) => {
  try {
    const { startUrl, projectDir } = req.body as { startUrl: string; projectDir: string }
    if (recorderProcess) { recorderProcess.kill('SIGTERM'); recorderProcess = null }

    // Resolve recorder.cjs relative to this file:
    // dist/index.js → ../../../studio/electron/recorder.cjs
    const recorderScript = path.resolve(__dirname, '../../../studio/electron/recorder.cjs')
    const monoRepoNodeModules = path.resolve(__dirname, '../../../node_modules')

    recorderProcess = spawn('node', [recorderScript, startUrl || ''], {
      cwd: projectDir || process.cwd(),
      env: {
        ...process.env,
        NODE_PATH: monoRepoNodeModules,
      },
    })

    recorderProcess.stdout?.on('data', (d: Buffer) => {
      const lines = d.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const obj = JSON.parse(line)
          if (obj.__done) {
            broadcast('recorder:done', null)
          } else {
            broadcast('recorder:step', obj)
          }
        } catch { /* ignore malformed lines */ }
      }
    })

    recorderProcess.stderr?.on('data', (d: Buffer) => {
      console.error('[Recorder stderr]', d.toString().trim())
    })

    recorderProcess.on('close', () => {
      broadcast('recorder:done', null)
      recorderProcess = null
    })

    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/recorder/stop', (_req: Request, res: Response) => {
  if (recorderProcess) { recorderProcess.kill('SIGTERM'); recorderProcess = null }
  broadcast('recorder:done', null)
  res.json({ ok: true })
})

// ── /api/spy ──────────────────────────────────────────────────────────────────
// Opens a browser with element highlight overlay; user clicks element to capture locator.
// Emits { locator, tag, text } via spy:locator WS event, then { spy:done } on close.

app.post('/api/spy/start', (req: Request, res: Response) => {
  try {
    const { url, mode = 'web' } = req.body as { url: string; mode?: 'web' | 'sap' | 'desktop' | 'mobile' }
    if (spyProcess) { spyProcess.kill('SIGTERM'); spyProcess = null }

    const electronDir = path.resolve(__dirname, '../../../studio/electron')
    const monoRepoNodeModules = path.resolve(__dirname, '../../../node_modules')

    let spyScript: string
    let spyArgs: string[]

    if (mode === 'sap') {
      spyScript = path.join(electronDir, 'sap-spy.cjs')
      spyArgs   = []
    } else if (mode === 'desktop' || mode === 'mobile') {
      spyScript = path.join(electronDir, 'desktop-spy.cjs')
      spyArgs   = [url || 'http://localhost:4723', mode]
    } else {
      spyScript = path.join(electronDir, 'spy.cjs')
      spyArgs   = [url || 'about:blank']
    }

    spyProcess = spawn('node', [spyScript, ...spyArgs], {
      cwd: electronDir,
      env: { ...process.env, NODE_PATH: monoRepoNodeModules },
    })

    spyProcess.stdout?.on('data', (d: Buffer) => {
      const lines = d.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const obj = JSON.parse(line)
          if (obj.__done) {
            broadcast('spy:done', null)
          } else if (obj.__error) {
            broadcast('spy:error', obj.__error)
          } else {
            console.log('[Spy] broadcasting locator to', wsClients.size, 'clients:', JSON.stringify(obj))
            broadcast('spy:locator', obj)  // { locator, tag, text }
            setTimeout(() => {
              if (spyProcess) { spyProcess.kill('SIGTERM'); spyProcess = null }
            }, 300)
          }
        } catch { /* ignore malformed */ }
      }
    })

    spyProcess.stderr?.on('data', (d: Buffer) => {
      console.error('[Spy stderr]', d.toString().trim())
    })

    spyProcess.on('close', () => {
      broadcast('spy:done', null)
      spyProcess = null
    })

    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/spy/stop', (_req: Request, res: Response) => {
  if (spyProcess) { spyProcess.kill('SIGTERM'); spyProcess = null }
  broadcast('spy:done', null)
  res.json({ ok: true })
})

// ── /api/ai ───────────────────────────────────────────────────────────────────

const AI_CONFIG_FILE = path.join(os.homedir(), '.prabala', 'ai.json')

function loadAiConfig(): Record<string, string> {
  const defaults = {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT ?? '',
    apiKey: process.env.AZURE_OPENAI_KEY ?? '',
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o',
    apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-12-01-preview',
  }
  try {
    fs.mkdirSync(path.dirname(AI_CONFIG_FILE), { recursive: true })
    if (fs.existsSync(AI_CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(AI_CONFIG_FILE, 'utf-8')) as Record<string, string>
      return { ...defaults, ...saved }
    }
  } catch { /* ignore */ }
  return defaults
}

function saveAiConfig(cfg: Record<string, string>): void {
  try {
    fs.mkdirSync(path.dirname(AI_CONFIG_FILE), { recursive: true })
    fs.writeFileSync(AI_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8')
  } catch { /* ignore */ }
}

let aiConfig: Record<string, string> = loadAiConfig()

function sanitizeAzureEndpoint(input: string): string {
  return input
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/openai$/i, '')
}

function normalizeAiConfig(raw: Record<string, unknown>): Record<string, string> {
  const next = { ...aiConfig }
  const endpoint = String(raw.endpoint ?? '').trim()
  const deployment = String(raw.deployment ?? '').trim()
  const apiVersion = String(raw.apiVersion ?? '').trim()
  const apiKeyInput = String(raw.apiKey ?? '').trim()

  if (endpoint) next.endpoint = endpoint
  if (deployment) next.deployment = deployment
  if (apiVersion) next.apiVersion = apiVersion

  // Ignore masked placeholders sent back from UI while editing other fields.
  if (apiKeyInput && apiKeyInput !== '***') next.apiKey = apiKeyInput

  return next
}

app.get('/api/ai/config', (_req: Request, res: Response) => {
  res.json({ ...aiConfig })
})

app.post('/api/ai/config', (req: Request, res: Response) => {
  aiConfig = normalizeAiConfig(req.body as Record<string, unknown>)
  saveAiConfig(aiConfig)
  res.json({ ok: true })
})

app.post('/api/ai/test', async (_req: Request, res: Response) => {
  try {
    const endpoint = sanitizeAzureEndpoint(aiConfig.endpoint)
    const deployment = aiConfig.deployment.trim()
    const apiVersion = (aiConfig.apiVersion || '2024-12-01-preview').trim()

    if (!aiConfig.apiKey) {
      res.status(400).json({ ok: false, message: 'API Key is missing.' })
      return
    }
    if (!endpoint) {
      res.status(400).json({ ok: false, message: 'Endpoint URL is missing.' })
      return
    }
    if (!deployment) {
      res.status(400).json({ ok: false, message: 'Deployment Name is missing.' })
      return
    }

    const url = `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`
    const payload = {
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
    }
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': aiConfig.apiKey },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!r.ok) {
      const body = await r.text()
      let guidance = ''
      if (r.status === 404) {
        guidance = `\n\nCheck these values:\n- Endpoint should look like https://YOUR-RESOURCE.openai.azure.com\n- Deployment must exactly match Azure AI Foundry deployment name\n- Do not include /openai/deployments in endpoint`
      } else if (r.status === 500) {
        guidance = `\n\nHTTP 500 from Azure usually means:\n- API Version is incompatible with your model (try 2024-12-01-preview)\n- Deployment name doesn't match any deployed model\n- Temporary Azure service issue`
      } else if (r.status === 401) {
        guidance = `\n\nHTTP 401: API Key is invalid or expired. Check Keys and Endpoint in Azure Portal.`
      } else if (r.status === 429) {
        guidance = `\n\nHTTP 429: Rate limit or quota exceeded on this deployment.`
      }
      res.status(r.status).json({
        ok: false,
        message: `Azure OpenAI test failed (${r.status}): ${body}${guidance}`,
      })
      return
    }

    res.json({ ok: true, message: '✓ Connection successful! Azure OpenAI is properly configured.' })
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      res.status(408).json({ ok: false, message: 'Connection timed out after 15 seconds. Check endpoint URL, VPN/proxy/firewall, and network access to Azure OpenAI.' })
      return
    }
    res.status(500).json({ ok: false, message: err.message })
  }
})

app.post('/api/ai/chat', async (req: Request, res: Response) => {
  try {
    const { messages, systemPrompt, provider = 'ollama', model = 'llama3' } = req.body as {
      messages: { role: string; content: string }[]
      systemPrompt: string
      provider?: string
      model?: string
    }

    if (provider === 'ollama') {
      const endpoint = aiConfig.endpoint || 'http://localhost:11434'
      const body = {
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        stream: false,
      }
      const r = await fetch(`${endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json() as { message?: { content?: string } }
      const text = data.message?.content ?? ''
      broadcast('ai:chunk', text)
      broadcast('ai:done', null)
      res.json({ ok: true })
      return
    }

    // Azure OpenAI — streaming via WebSocket
    if (!aiConfig.endpoint || !aiConfig.apiKey) {
      res.status(400).json({ error: 'AI not configured. Set endpoint + apiKey.' })
      return
    }
    const endpoint = sanitizeAzureEndpoint(aiConfig.endpoint)
    const deployment = aiConfig.deployment.trim()
    const apiVersion = (aiConfig.apiVersion || '2024-08-01-preview').trim()
    const url = `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`
    const payload = {
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      stream: true,
      max_tokens: 2048,
    }
    const controller = new AbortController()
    // 2-minute timeout for streaming long responses
    const timeoutId = setTimeout(() => controller.abort(), 120000)
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': aiConfig.apiKey },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!r.ok) {
      clearTimeout(timeoutId)
      const body = await r.text()
      const guidance = r.status === 404
        ? `\n\nCheck endpoint/deployment. Endpoint should be only the resource URL (no /openai path).` : ''
      res.status(r.status).json({ error: `Azure OpenAI request failed (${r.status}): ${body}${guidance}` })
      return
    }

    // Acknowledge immediately — tokens arrive via WebSocket ai:chunk events
    res.json({ ok: true })

    // Stream SSE chunks in the background
    ;(async () => {
      const reader = r.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (data === '[DONE]') { broadcast('ai:done', null); return }
            try {
              const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
              const token = chunk.choices?.[0]?.delta?.content
              if (token) broadcast('ai:chunk', token)
            } catch { /* skip malformed SSE lines */ }
          }
        }
      } finally {
        clearTimeout(timeoutId)
        broadcast('ai:done', null)
      }
    })()
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      broadcast('ai:done', null)
      if (!res.headersSent) res.status(408).json({ error: 'AI request timed out.' })
      return
    }
    broadcast('ai:done', null)
    if (!res.headersSent) res.status(500).json({ error: err.message })
  }
})

// ── /api/app ──────────────────────────────────────────────────────────────────

app.get('/api/app/version', (_req: Request, res: Response) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8')) as { version?: string }
    res.json({ version: pkg.version ?? '1.0.0' })
  } catch {
    res.json({ version: '1.0.0' })
  }
})

app.get('/api/app/platform', (_req: Request, res: Response) => {
  res.json({ platform: os.platform() })
})

// ── /api/shell ────────────────────────────────────────────────────────────────

app.post('/api/shell/open', (req: Request, res: Response) => {
  try {
    const { path: targetPath } = req.body as { path: string }
    const cmd = os.platform() === 'darwin' ? 'open' : os.platform() === 'win32' ? 'explorer' : 'xdg-open'
    spawn(cmd, [targetPath], { detached: true, stdio: 'ignore' }).unref()
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── /api/results ──────────────────────────────────────────────────────────────
// Returns latest test results from the most recently written prabala-results.json
// Searches: {projectDir}/artifacts/, then current working directory artifacts/.

app.get('/api/results/latest', (req: Request, res: Response) => {
  const projectDir = (req.query.projectDir as string) || process.cwd()
  const candidates = [
    path.join(projectDir, 'artifacts', 'prabala-results.json'),
    path.join(process.cwd(), 'artifacts', 'prabala-results.json'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const raw = JSON.parse(fs.readFileSync(candidate, 'utf-8'))
        res.json(raw)
        return
      } catch { /* try next */ }
    }
  }
  res.json({ suites: [], totalPassed: 0, totalFailed: 0, totalSkipped: 0, duration: 0 })
})

// ── /api/schedules ───────────────────────────────────────────────────────────
// Persists scheduled runs in ~/.prabala/schedules.json

const SCHEDULES_FILE = path.join(os.homedir(), '.prabala', 'schedules.json')

function readSchedules(): any[] {
  try {
    fs.mkdirSync(path.dirname(SCHEDULES_FILE), { recursive: true })
    if (fs.existsSync(SCHEDULES_FILE)) {
      return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf-8'))
    }
  } catch { /* ignore */ }
  return []
}

function writeSchedules(schedules: any[]) {
  try {
    fs.mkdirSync(path.dirname(SCHEDULES_FILE), { recursive: true })
    fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2), 'utf-8')
  } catch { /* ignore */ }
}

app.get('/api/schedules', (_req: Request, res: Response) => {
  res.json(readSchedules())
})

app.post('/api/schedules', (req: Request, res: Response) => {
  try {
    const run = req.body as { id: string; [key: string]: any }
    if (!run?.id) { res.status(400).json({ error: 'id required' }); return }
    const schedules = readSchedules()
    const idx = schedules.findIndex((s) => s.id === run.id)
    if (idx >= 0) schedules[idx] = run
    else schedules.push(run)
    writeSchedules(schedules)
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/schedules/:id', (req: Request, res: Response) => {
  try {
    const id = req.params.id
    const schedules = readSchedules().filter((s) => s.id !== id)
    writeSchedules(schedules)
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── /api/ai/impact ────────────────────────────────────────────────────────────
// Lightweight test-impact analysis: given changed file paths, returns subset of
// test files that likely reference those files (keyword match on file names).

app.post('/api/ai/impact', (req: Request, res: Response) => {
  try {
    const { changedFiles = [], allTests = [] } = req.body as {
      changedFiles: string[]
      allTests: string[]
    }
    if (!changedFiles.length || !allTests.length) {
      res.json({ impacted: allTests, reason: 'No changed files specified — returning all tests.' })
      return
    }
    // Simple heuristic: a test is impacted if any changed file's basename appears
    // in the test file content (or path)
    const changedBaseNames = changedFiles.map((f) => path.basename(f, path.extname(f)).toLowerCase())
    const impacted: string[] = []
    for (const testFile of allTests) {
      const testBasename = path.basename(testFile).toLowerCase()
      if (changedBaseNames.some((cb) => testBasename.includes(cb))) {
        impacted.push(testFile)
        continue
      }
      if (fs.existsSync(testFile)) {
        try {
          const content = fs.readFileSync(testFile, 'utf-8').toLowerCase()
          if (changedBaseNames.some((cb) => content.includes(cb))) {
            impacted.push(testFile)
          }
        } catch { /* skip */ }
      }
    }
    // If AI is configured, enhance with LLM analysis
    const hasAI = !!(aiConfig.endpoint && aiConfig.apiKey)
    if (!hasAI || impacted.length === 0) {
      res.json({
        impacted: impacted.length > 0 ? impacted : allTests,
        reason: impacted.length > 0
          ? `Found ${impacted.length} test(s) referencing changed files.`
          : 'No keyword matches found — run all tests to be safe.',
      })
      return
    }
    // Return immediately with heuristic results; AI enrichment can be added via webhooks later
    res.json({ impacted, reason: `${impacted.length} test(s) likely impacted by changed files.` })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── Static React build ────────────────────────────────────────────────────────
if (fs.existsSync(STUDIO_DIST)) {
  app.use(express.static(STUDIO_DIST))
  app.get(/^\/(?!api).*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(STUDIO_DIST, 'index.html'))
  })
} else {
  app.get('/', (_req: Request, res: Response) => {
    res.send('<h2>Prabala Studio Server running.<br>Build studio first: <code>cd studio && npm run build:web</code></h2>')
  })
}

// ── /api/jira ─────────────────────────────────────────────────────────────────
// Proxy to Jira REST API — keeps credentials server-side, avoids CORS issues.
// Body: { baseUrl, email, apiToken, jql, maxResults? }

app.post('/api/jira/issues', async (req: Request, res: Response) => {
  try {
    const { baseUrl, email, apiToken, jql, maxResults = 50 } = req.body as {
      baseUrl: string; email: string; apiToken: string; jql: string; maxResults?: number
    }
    if (!baseUrl || !email || !apiToken || !jql) {
      res.status(400).json({ error: 'baseUrl, email, apiToken and jql are required' }); return
    }
    // Validate baseUrl is an Atlassian domain to prevent SSRF
    const host = baseUrl.replace(/^https?:\/\//, '').split('/')[0]
    if (!host.endsWith('.atlassian.net')) {
      res.status(400).json({ error: 'baseUrl must be an *.atlassian.net domain' }); return
    }
    const url = `https://${host}/rest/api/3/search`
    const auth = Buffer.from(`${email}:${apiToken}`).toString('base64')
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        jql,
        maxResults,
        fields: ['summary', 'description', 'issuetype', 'status', 'assignee', 'priority'],
      }),
    })
    if (!response.ok) {
      const text = await response.text()
      res.status(response.status).json({ error: `Jira returned ${response.status}`, detail: text }); return
    }
    const data = await response.json() as { issues: any[] }
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n  🔮 Prabala Studio Server`)
  console.log(`  ➜  http://localhost:${PORT}\n`)
})
