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
    const args = ['prabala', 'run', pattern, ...extraArgs]
    runnerProcess = spawn('npx', args, { cwd: projectDir, shell: true })

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
  if (recorderProcess) { recorderProcess.kill(); recorderProcess = null }
  broadcast('recorder:done', null)
  res.json({ ok: true })
})

// ── /api/ai ───────────────────────────────────────────────────────────────────

// AI config stored in memory (in prod, use a DB or env vars)
let aiConfig: Record<string, string> = {
  endpoint: process.env.AZURE_OPENAI_ENDPOINT ?? '',
  apiKey: process.env.AZURE_OPENAI_KEY ?? '',
  deployment: process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o',
  apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-02-01',
}

app.get('/api/ai/config', (_req: Request, res: Response) => {
  res.json({ ...aiConfig, apiKey: aiConfig.apiKey ? '***' : '' })
})

app.post('/api/ai/config', (req: Request, res: Response) => {
  aiConfig = { ...aiConfig, ...req.body }
  res.json({ ok: true })
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
      res.json({ text: data.message?.content ?? '' })
      return
    }

    // Azure OpenAI / OpenAI
    if (!aiConfig.endpoint || !aiConfig.apiKey) {
      res.status(400).json({ error: 'AI not configured. Set endpoint + apiKey.' })
      return
    }
    const url = `${aiConfig.endpoint}/openai/deployments/${aiConfig.deployment}/chat/completions?api-version=${aiConfig.apiVersion}`
    const payload = {
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    }
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': aiConfig.apiKey },
      body: JSON.stringify(payload),
    })
    const data = await r.json() as { choices?: { message?: { content?: string } }[] }
    res.json({ text: data.choices?.[0]?.message?.content ?? '' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
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

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n  🔮 Prabala Studio Server`)
  console.log(`  ➜  http://localhost:${PORT}\n`)
})
