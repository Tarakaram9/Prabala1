// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio Server
// Replaces Electron main process — serves React SPA + REST API + WebSocket
// ─────────────────────────────────────────────────────────────────────────────
import express, { Request, Response } from 'express'
import { createServer } from 'http'
import * as https from 'https'
import * as http from 'http'
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
const STUDIO_DIST = path.resolve(__dirname, '../../../studio/dist')

// Trust the first reverse proxy so req.protocol reflects https:// when running
// behind Azure Container Apps / Nginx TLS termination.
app.set('trust proxy', 1)
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
// Seed lastKnownProjectDir from first schedule that has a projectDir
let lastKnownProjectDir: string = (() => {
  const schedules = (() => {
    try {
      const f = path.join(os.homedir(), '.prabala', 'schedules.json')
      if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8')) as any[]
    } catch { /* ignore */ }
    return []
  })()
  return schedules.find((s: any) => s.projectDir)?.projectDir ?? process.cwd()
})()
let recorderProcess: ChildProcess | null = null
let spyProcess: ChildProcess | null = null

// ── Pending recording (consumed by the browser extension content script) ──────
// When /api/recorder/start is called, we register the target URL here.
// The extension's content.js polls /api/recorder/pending on every page load
// and injects the recording script if there's a match.
interface PendingRecording { url: string; scriptSrc: string; expiresAt: number }
let pendingRecording: PendingRecording | null = null

const isWin = os.platform() === 'win32'

/** Cross-platform graceful kill: IPC message on Windows, SIGTERM on Unix */
function killChild(child: ChildProcess | null): void {
  if (!child) return
  if (isWin) {
    // Try IPC first (for our own recorder/spy scripts that listen for messages)
    if (child.connected) {
      try { child.send({ type: 'stop' }) } catch { /* ignore */ }
    }
    // Fallback: taskkill /T for the process tree
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* ignore */ }
  } else {
    try { child.kill('SIGTERM') } catch { /* ignore */ }
  }
}

// ── WebSocket channel registry ────────────────────────────────────────────────
const wsClients = new Set<WebSocket>()
// Track which WS connections are from the browser extension
const extensionClients = new Set<WebSocket>()

wss.on('connection', (ws) => {
  wsClients.add(ws)
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as { type: string; payload?: unknown }
      if (msg.type === 'extension:hello') {
        // Browser extension connected — tag this socket
        extensionClients.add(ws)
      } else if (msg.type === 'recorder:interact') {
        // Forward pointer/keyboard command to the recorder process stdin
        if (recorderProcess?.stdin) {
          recorderProcess.stdin.write(JSON.stringify(msg.payload) + '\n')
        }
      }
    } catch { /* ignore */ }
  })
  ws.on('close', () => {
    wsClients.delete(ws)
    extensionClients.delete(ws)
  })
})

function broadcast(type: string, payload: unknown) {
  const msg = JSON.stringify({ type, payload })
  wsClients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg)
  })
}

// ── /api/extension/status ─────────────────────────────────────────────────────
// The Studio React app polls this to show "Extension connected" badge.
app.get('/api/extension/status', (_req: Request, res: Response) => {
  const connected = [...extensionClients].some(ws => ws.readyState === WebSocket.OPEN)
  res.json({ connected })
})

// ── /api/recorder/pending ─────────────────────────────────────────────────────
// Polled by the browser extension content script on every page load.
// Returns { inject: true, scriptSrc } if the current URL matches a pending
// recording session, then clears the pending record so it only fires once.
// CORS headers are set explicitly so cross-origin content scripts can reach it.
app.get('/api/recorder/pending', (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const url = (req.query.url as string) || ''
  if (!pendingRecording || Date.now() > pendingRecording.expiresAt) {
    pendingRecording = null
    res.json({ inject: false })
    return
  }
  // Match on path prefix so redirects & query strings don't break matching
  const pendingBase = pendingRecording.url.split('?')[0].split('#')[0]
  const currentBase = url.split('?')[0].split('#')[0]
  if (currentBase.startsWith(pendingBase) || pendingBase.startsWith(currentBase)) {
    const { scriptSrc } = pendingRecording
    pendingRecording = null   // consume — inject only once
    res.json({ inject: true, scriptSrc })
  } else {
    res.json({ inject: false })
  }
})

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
    // Ensure the target directory exists before writing
    const dir = path.dirname(filePath)
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch (mkdirErr: any) {
      // Provide a clear error when the directory can't be created (e.g. EACCES in container)
      if (mkdirErr.code === 'EACCES' || mkdirErr.code === 'EPERM') {
        res.status(403).json({
          error: `Cannot write to "${filePath}". In the cloud Studio, workspaces must be under /workspaces. ` +
                 `Please create or open a workspace folder under /workspaces and save again.`
        })
        return
      }
      throw mkdirErr
    }
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
    try {
      fs.mkdirSync(dirPath, { recursive: true })
    } catch (mkdirErr: any) {
      if (mkdirErr.code === 'EACCES' || mkdirErr.code === 'EPERM') {
        res.status(403).json({
          error: `Cannot create directory "${dirPath}". In the cloud Studio, workspaces must be under /workspaces.`
        })
        return
      }
      throw mkdirErr
    }
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
    if (projectDir) lastKnownProjectDir = projectDir
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
// Client-side recording: accept events POSTed from the user's own browser via
// the injected recording script.
app.options('/api/recorder/event', (_req: Request, res: Response) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  res.sendStatus(204)
})
app.post('/api/recorder/event', (req: Request, res: Response) => {
  res.header('Access-Control-Allow-Origin', '*')
  const step = req.body as { keyword?: string; params?: Record<string, unknown> }
  if (step?.keyword === '__stop') {
    broadcast('recorder:done', null)
  } else if (step?.keyword) {
    broadcast('recorder:step', step)
  }
  res.json({ ok: true })
})

// ── recording script helper ───────────────────────────────────────────────────
function buildRecordingScript(eventEndpoint: string): string {
  return `(function(){
  if(window.__prabalaActive) return;
  window.__prabalaActive = true;
  var S = ${JSON.stringify(eventEndpoint)};
  function send(kw, p) {
    fetch(S, { method:'POST', headers:{'Content-Type':'application/json'}, mode:'cors',
      body: JSON.stringify({ keyword: kw, params: p }) }).catch(function(){});
  }
  function getL(el) {
    if (!el) return 'unknown';
    if (el.id && !/^\\d/.test(el.id)) return '#' + el.id;
    var t = el.getAttribute('data-testid') || el.getAttribute('data-cy');
    if (t) return '[data-testid="' + t + '"]';
    var a = el.getAttribute('aria-label');
    if (a) return '[aria-label="' + a + '"]';
    var ph = el.getAttribute('placeholder');
    if (ph) return '[placeholder="' + ph + '"]';
    var tag = el.tagName.toLowerCase();
    if (!['input','textarea','select'].includes(tag)) {
      var tx = (el.innerText || el.textContent || '').trim().replace(/\\s+/g,' ').slice(0,50);
      if (tx) return 'text=' + tx;
    }
    var c = Array.from(el.classList).filter(function(x){ return !/\\d{3,}/.test(x); }).slice(0,2).join('.');
    return tag + (c ? '.' + c : '');
  }
  var li = null, lv = '', timer = null;
  document.addEventListener('click', function(e) {
    var el = e.target;
    if (['INPUT','TEXTAREA','SELECT','OPTION'].includes(el.tagName)) return;
    send('Click', { locator: getL(el) });
  }, true);
  document.addEventListener('input', function(e) {
    var el = e.target;
    if (!['INPUT','TEXTAREA'].includes(el.tagName)) return;
    li = el; lv = el.value;
    clearTimeout(timer);
    timer = setTimeout(function(){ if (li) send('EnterText', { locator: getL(li), value: lv }); }, 600);
  }, true);
  document.addEventListener('change', function(e) {
    if (e.target.tagName === 'SELECT') send('SelectOption', { locator: getL(e.target), option: e.target.value });
  }, true);
  var lu = location.href;
  setInterval(function(){
    if (location.href !== lu) { lu = location.href; send('NavigateTo', { url: lu }); }
  }, 500);
  send('NavigateTo', { url: location.href });
  var d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;background:#7c3aed;color:#fff;padding:8px 16px;border-radius:10px;font:bold 13px/1.6 sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.5);cursor:pointer;user-select:none';
  d.innerHTML = '&#9679; Prabala Recording<br><span style="font-weight:400;font-size:11px">Click to stop recording</span>';
  d.onclick = function(){ window.__prabalaActive = false; d.remove(); send('__stop', {}); };
  document.body.appendChild(d);
})();`
}

// ── /recorder-proxy ────────────────────────────────────────────────────────────
// Transparent HTTP proxy that fetches the target URL server-side, injects the
// recording script, and returns the patched HTML to the user's browser.
// This gives the same seamless recording experience as Electron — no bookmarklet.

/** Fetch a URL server-side, following redirects, returning body + metadata. */
function proxyFetch(
  targetUrl: string,
  reqHeaders: Record<string, string> = {},
  redirects = 0,
  method = 'GET',
  body?: Buffer
): Promise<{ status: number; headers: Record<string, string | string[]>; body: Buffer; finalUrl: string }> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error('Too many redirects')); return }
    let parsed: URL
    try { parsed = new URL(targetUrl) } catch (e) { reject(e); return }

    const lib: typeof https | typeof http = parsed.protocol === 'https:' ? https : http
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PrabalaRecorder/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(body ? { 'Content-Length': String(body.length) } : {}),
        ...reqHeaders,
      },
    }

    const req = (lib as typeof https).request(options, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location as string, targetUrl).href
        res.resume()
        // Follow redirects as GET (standard browser behaviour after POST)
        proxyFetch(redirectUrl, reqHeaders, redirects + 1, 'GET').then(resolve).catch(reject)
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({
        status: res.statusCode ?? 200,
        headers: res.headers as Record<string, string | string[]>,
        body: Buffer.concat(chunks),
        finalUrl: targetUrl,
      }))
      res.on('error', reject)
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

/** Script injected BEFORE app code: routes fetch()/XHR relative calls through our proxy. */
function buildProxyPatch(targetOrigin: string, proxyBase: string): string {
  return `(function(){
  var TO=${JSON.stringify(targetOrigin)},PB=${JSON.stringify(proxyBase)};
  function px(u){
    if(!u||typeof u!=='string') return u;
    if(/^(data:|blob:|javascript:|mailto:|tel:)/.test(u)) return u;
    try {
      var a=new URL(u, location.href);
      if(a.origin===TO) return PB+encodeURIComponent(a.href);
    } catch(e){}
    return u;
  }
  var oF=window.fetch.bind(window);
  window.fetch=function(u,o){return oF(typeof u==='string'?px(u):u,o);};
  var oO=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){return oO.call(this,m,px(String(u)));};
})();`
}

app.all('/recorder-proxy', async (req: Request, res: Response) => {
  const targetUrl = req.query.url as string
  if (!targetUrl) { res.status(400).send('<p>url query param required</p>'); return }

  try {
    // Forward cookies + content-type from user's browser to the target
    const fwdHeaders: Record<string, string> = {}
    if (req.headers['cookie']) fwdHeaders['cookie'] = req.headers['cookie'] as string
    if (req.headers['content-type']) fwdHeaders['content-type'] = req.headers['content-type'] as string
    if (req.headers['authorization']) fwdHeaders['authorization'] = req.headers['authorization'] as string

    // Collect request body for non-GET methods
    const reqBody: Buffer | undefined = (req.method !== 'GET' && req.method !== 'HEAD')
      ? await new Promise<Buffer>((resolve) => {
          const chunks: Buffer[] = []
          req.on('data', (c: Buffer) => chunks.push(c))
          req.on('end', () => resolve(Buffer.concat(chunks)))
        })
      : undefined

    const { status, headers, body, finalUrl } = await proxyFetch(targetUrl, fwdHeaders, 0, req.method, reqBody)
    const contentType = (headers['content-type'] as string) || ''

    // Strip headers that would block script injection or cause security issues
    const skipHeaders = new Set([
      'content-security-policy', 'x-frame-options', 'content-length',
      'transfer-encoding', 'connection', 'strict-transport-security',
      'x-content-type-options',
    ])
    Object.entries(headers).forEach(([k, v]) => {
      if (!skipHeaders.has(k.toLowerCase()) && v) {
        try { res.setHeader(k, v as string) } catch { /* ignore invalid header values */ }
      }
    })

    // Pass-through non-HTML (CSS, JS, images, JSON, etc.)
    if (!contentType.includes('text/html')) {
      res.status(status).send(body)
      return
    }

    const proto = (req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim()
    const studioOrigin = `${proto}://${req.get('host')}`
    const proxyBase = `${studioOrigin}/recorder-proxy?url=`
    const targetOrigin = (() => { try { return new URL(finalUrl).origin } catch { return '' } })()

    const recordingScript = buildRecordingScript(`${studioOrigin}/api/recorder/event`)
    const proxyPatch = buildProxyPatch(targetOrigin, proxyBase)

    let html = body.toString('utf-8')

    // Inject <base> (relative asset URLs resolve to target) + proxy patch before any app JS
    const headInject = `<base href="${targetOrigin}/"><script>${proxyPatch}</script>`
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, (_m, attrs) => `<head${attrs}>${headInject}`)
    } else {
      html = headInject + html
    }

    // Rewrite anchor hrefs so navigation stays within the proxy chain
    html = html.replace(/\bhref="([^"#][^"]*)"/gi, (_m, href) => {
      if (/^(javascript:|data:|mailto:|tel:|#)/.test(href)) return _m
      try {
        const abs = new URL(href, finalUrl).href
        if (targetOrigin && abs.startsWith(targetOrigin)) {
          return `href="${proxyBase}${encodeURIComponent(abs)}"`
        }
      } catch { /* keep original */ }
      return _m
    })

    // Inject recording script just before </body>
    const scriptTag = `<script>${recordingScript}</script>`
    if (html.includes('</body>')) {
      html = html.replace('</body>', `${scriptTag}</body>`)
    } else {
      html += scriptTag
    }

    res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8').send(html)
  } catch (err: any) {
    res.status(502).send(`<!DOCTYPE html><html><body style="font:14px sans-serif;padding:2rem;background:#0f0f15;color:#e2e8f0">
      <h3 style="color:#f87171">&#9888; Could not load page</h3>
      <p>URL: <code style="color:#a78bfa">${targetUrl}</code></p>
      <pre style="color:#94a3b8;white-space:pre-wrap">${err.message}</pre>
      <p style="color:#64748b;font-size:12px">Make sure the URL is accessible from the server and is not blocked by a firewall.</p>
    </body></html>`)
  }
})

// ── /api/recorder/script ──────────────────────────────────────────────────────
// Serves the recording script as JS — called by the bookmarklet so no
// copy-paste is needed for cross-origin targets.
app.get('/api/recorder/script', (req: Request, res: Response) => {
  // Use X-Forwarded-Proto so the script gets the correct https:// origin when
  // running behind a TLS-terminating proxy (e.g. Azure Container Apps ingress).
  const proto = (req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim()
  const studioOrigin = `${proto}://${req.get('host')}`
  const script = buildRecordingScript(`${studioOrigin}/api/recorder/event`)
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Content-Type', 'application/javascript')
  res.send(script)
})

// ── /extension ────────────────────────────────────────────────────────────────
// Simple HTML page explaining how to install the browser extension.
app.get('/extension', (req: Request, res: Response) => {
  const proto = (req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim()
  const studioOrigin = `${proto}://${req.get('host')}`
  res.setHeader('Content-Type', 'text/html; charset=utf-8').send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Install Prabala Recorder Extension</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f15;color:#e2e8f0;padding:40px 24px;max-width:640px;margin:auto}
  h1{font-size:22px;color:#c084fc;margin-bottom:6px}
  p{color:#94a3b8;font-size:14px;line-height:1.7;margin:10px 0}
  ol{padding-left:22px;color:#94a3b8;font-size:14px;line-height:2}
  li{margin:4px 0}
  code{background:#1e1e2e;color:#a78bfa;padding:2px 7px;border-radius:5px;font-size:13px}
  .note{background:#1a1a2e;border:1px solid #2a2a4a;border-radius:12px;padding:16px 20px;margin:20px 0}
  a{color:#7c3aed}
</style>
</head>
<body>
<h1>🔌 Prabala Recorder Extension</h1>
<p>Install this extension once and recording will work automatically — exactly like the Electron app. No copy-paste needed.</p>
<div class="note">
  <p><strong style="color:#e2e8f0">Chrome / Edge (Chromium)</strong></p>
  <ol>
    <li>Open <code>chrome://extensions</code> (or <code>edge://extensions</code>)</li>
    <li>Enable <strong>Developer mode</strong> (toggle in top-right)</li>
    <li>Click <strong>Load unpacked</strong></li>
    <li>Select the <code>extension</code> folder at this URL:<br>
      <code>${studioOrigin}/extension-download</code> — or find it in your Prabala Studio installation at <code>studio/public/extension/</code></li>
    <li>The extension icon appears in the toolbar — it auto-connects to Prabala Studio</li>
  </ol>
</div>
<p>After installation, come back to the Test Builder and open the Record bar — you'll see <strong style="color:#4ade80">Extension connected ✓</strong>.</p>
<p style="margin-top:24px"><a href="javascript:window.close()">← Back to Studio</a></p>
</body>
</html>`)
})

// ── /recorder-relay ────────────────────────────────────────────────────────────
// Opens the target app in a new tab and tries to inject the recording script
// automatically (works for same-origin apps). For cross-origin apps the page
// shows a one-time bookmarklet that loads the script from /api/recorder/script.
app.get('/recorder-relay', (req: Request, res: Response) => {
  const targetUrl = (req.query.url as string) || ''
  const proto = (req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim()
  const studioOrigin = `${proto}://${req.get('host')}`
  const recordingScript = buildRecordingScript(`${studioOrigin}/api/recorder/event`)

  // Bookmarklet: tiny JS URI that fetches & injects the recording script
  const bookmarkletCode = `(function(){var s=document.createElement('script');s.src='${studioOrigin}/api/recorder/script?t='+Date.now();document.head.appendChild(s);})();`

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Prabala Recorder</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f15;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
    .card{background:#14141f;border:1px solid #2a2a4a;border-radius:16px;padding:32px 36px;max-width:560px;width:100%}
    h2{font-size:18px;margin:8px 0 4px;color:#c084fc;text-align:center}
    .badge{display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:16px;font-size:12px;color:#7c3aed;font-weight:600;letter-spacing:.05em}
    .dot{width:10px;height:10px;background:#7c3aed;border-radius:50%;animation:pulse 1s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
    .url{font-family:monospace;font-size:11px;color:#a78bfa;background:#1a1a2e;padding:5px 10px;border-radius:6px;word-break:break-all;display:block;text-align:center;margin-bottom:20px}
    .section{background:#1a1a2e;border:1px solid #2a2a4a;border-radius:12px;padding:18px 20px;margin-bottom:14px}
    .section-title{font-size:11px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px}
    p{color:#94a3b8;font-size:13px;line-height:1.6;margin:0}
    .btn{display:block;width:100%;background:#7c3aed;color:#fff;border:none;padding:11px 24px;border-radius:9px;font-size:14px;font-weight:700;cursor:pointer;transition:background .15s;text-align:center;margin-top:10px}
    .btn:hover{background:#6d28d9}
    .btn:disabled{opacity:.5;cursor:default}
    .bm-link{display:inline-flex;align-items:center;gap:6px;background:#4f46e5;color:#fff;padding:7px 14px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;cursor:grab;border:2px dashed #818cf8;margin:8px 0}
    .bm-link:active{cursor:grabbing}
    .hint{font-size:11px;color:#475569;margin-top:6px}
    #activeSection{display:none}
    #bookmarkletSection{display:none}
    #status{min-height:18px;font-size:12px;margin-top:10px;text-align:center;color:#94a3b8}
    .success{color:#10b981!important}
    .step-row{display:flex;align-items:flex-start;gap:10px;margin:6px 0}
    .step-num{width:20px;height:20px;background:#7c3aed;border-radius:50%;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
  </style>
</head>
<body>
<div class="card">
  <div class="badge"><span class="dot"></span>PRABALA STUDIO</div>
  <h2>Web Recorder</h2>
  <span class="url">${targetUrl || '(no URL entered)'}</span>

  <!-- Initial: open app button -->
  <div id="openSection">
    <div class="section">
      <div class="section-title">Auto-launch</div>
      <p>Opens your app in a new tab and activates recording automatically.</p>
      <button class="btn" id="openBtn">&#9654;&ensp;Open App &amp; Start Recording</button>
    </div>
  </div>

  <!-- Active: same-origin injection succeeded -->
  <div id="activeSection">
    <div class="section">
      <div class="section-title">&#9679; Recording Active</div>
      <div class="step-row"><span class="step-num">1</span><p>Your app is open in a new tab with a purple badge</p></div>
      <div class="step-row"><span class="step-num">2</span><p>Interact normally — each action streams to Studio</p></div>
      <div class="step-row"><span class="step-num">3</span><p>Click the purple badge in your app to stop recording</p></div>
    </div>
  </div>

  <!-- Bookmarklet fallback: cross-origin -->
  <div id="bookmarkletSection">
    <div class="section">
      <div class="section-title">Step 1 &mdash; One-time setup</div>
      <p>Drag this button to your browser's bookmarks bar:</p><br>
      <a id="bmLink" href="#" class="bm-link" title="Drag me to your bookmarks bar">&#9679;&ensp;Prabala Record</a>
      <p class="hint">&#8593; Drag to bookmarks bar (do this once per browser)</p>
    </div>
    <div class="section">
      <div class="section-title">Step 2 &mdash; Start recording</div>
      <div class="step-row"><span class="step-num">1</span><p>Your app is already open in a new tab</p></div>
      <div class="step-row"><span class="step-num">2</span><p>Switch to that tab and click <strong style="color:#c084fc">&#9679; Prabala Record</strong> in your bookmarks bar</p></div>
      <div class="step-row"><span class="step-num">3</span><p>A purple badge appears — interact with your app</p></div>
      <div class="step-row"><span class="step-num">4</span><p>Steps stream to Studio automatically</p></div>
    </div>
  </div>

  <div id="status"></div>
</div>
<script>
var TARGET = ${JSON.stringify(targetUrl)};
var SCRIPT = ${JSON.stringify(recordingScript)};
var BM_CODE = ${JSON.stringify(bookmarkletCode)};

// Set bookmarklet href
document.getElementById('bmLink').setAttribute('href', 'javascript:' + BM_CODE);

document.getElementById('openBtn').onclick = function() {
  this.disabled = true;
  setStatus('Opening your app…');

  if (!TARGET) {
    // No URL: run recording on current page
    try { eval(SCRIPT); showActive(); } catch(e) { setStatus('Error: ' + e.message); }
    return;
  }

  var recWin = window.open(TARGET, '_blank');
  if (!recWin) {
    setStatus('Popup blocked — please allow popups for this site and try again.');
    this.disabled = false;
    return;
  }

  // Poll until the target page is loaded, then try to inject (same-origin) or
  // show bookmarklet (cross-origin — SecurityError thrown on DOM access).
  var attempts = 0;
  var poller = setInterval(function() {
    if (!recWin || recWin.closed) { clearInterval(poller); setStatus('App window was closed.'); return; }
    if (++attempts > 40) { clearInterval(poller); showBookmarklet('App opened in new tab.'); return; }
    try {
      // This line throws SecurityError immediately if cross-origin
      var href = recWin.location.href;
      var ready = recWin.document.readyState;
      if (href && href !== 'about:blank' && ready === 'complete') {
        clearInterval(poller);
        try { recWin.eval(SCRIPT); showActive(); }
        catch(e2) { showBookmarklet('Script blocked by app CSP — use the bookmarklet instead.'); }
      }
    } catch(e) {
      // SecurityError = cross-origin app
      clearInterval(poller);
      showBookmarklet(null);
    }
  }, 500);
};

function showActive() {
  document.getElementById('openSection').style.display = 'none';
  document.getElementById('activeSection').style.display = 'block';
  setStatus('');
}
function showBookmarklet(msg) {
  document.getElementById('openSection').style.display = 'none';
  document.getElementById('bookmarkletSection').style.display = 'block';
  if (msg) setStatus(msg);
}
function setStatus(msg) { document.getElementById('status').textContent = msg; }
</script>
</body>
</html>`

  res.setHeader('Content-Type', 'text/html')
  res.send(html)
})

app.post('/api/recorder/start', (req: Request, res: Response) => {
  try {
    const { startUrl, projectDir, mode } = req.body as { startUrl: string; projectDir: string; mode?: string }

    const proto = (req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim()
    const studioOrigin = `${proto}://${req.get('host')}`

    // ── Always register a pending recording so the content script can pick it up
    // This works regardless of whether the extension is connected via WS.
    // The content script polls /api/recorder/pending on every new page load.
    pendingRecording = {
      url: startUrl || '',
      scriptSrc: `${studioOrigin}/api/recorder/script`,
      expiresAt: Date.now() + 60000,   // 60 s window for the tab to load
    }

    // ── Also broadcast via WS for the (legacy) extension WS path ─────────
    broadcast('recorder:inject', {
      url: startUrl || '',
      scriptSrc: `${studioOrigin}/api/recorder/script`,
    })

    if (recorderProcess) { killChild(recorderProcess); recorderProcess = null }

    // Resolve recorder.cjs relative to this file:
    // dist/index.js → ../../../studio/electron/recorder.cjs
    const recorderScript = path.resolve(__dirname, '../../../studio/electron/recorder.cjs')
    const monoRepoNodeModules = path.resolve(__dirname, '../../../node_modules')

    recorderProcess = spawn('node', [recorderScript, startUrl || ''], {
      cwd: projectDir || process.cwd(),
      stdio: isWin ? ['pipe', 'pipe', 'pipe', 'ipc'] : ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_PATH: monoRepoNodeModules,
        // In Docker/container environments force headless so the Studio UI can
        // stream a live screenshot preview rather than relying on Xvfb.
        PRABALA_HEADLESS: process.env.NODE_ENV === 'production' ? '1' : (process.env.PRABALA_HEADLESS ?? ''),
      },
    })

    recorderProcess.stdout?.on('data', (d: Buffer) => {
      const lines = d.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const obj = JSON.parse(line)
          if (obj.__screenshot) {
            // Live browser preview frame — broadcast separately (not a test step)
            broadcast('recorder:screenshot', { data: obj.__screenshot, width: obj.width, height: obj.height })
          } else if (obj.__done) {
            broadcast('recorder:done', null)
          } else {
            broadcast('recorder:step', obj)
          }
        } catch { /* ignore malformed lines */ }
      }
    })

    recorderProcess.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim()
      console.error('[Recorder stderr]', msg)
      // Surface critical errors to the UI via WebSocket
      if (msg.includes('Executable') || msg.includes('launch') || msg.includes('DISPLAY') || msg.includes('error')) {
        broadcast('recorder:error', { message: msg })
      }
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
  if (recorderProcess) { killChild(recorderProcess); recorderProcess = null }
  broadcast('recorder:done', null)
  res.json({ ok: true })
})

// ── /api/spy ──────────────────────────────────────────────────────────────────
// Opens a browser with element highlight overlay; user clicks element to capture locator.
// Emits { locator, tag, text } via spy:locator WS event, then { spy:done } on close.

app.post('/api/spy/start', (req: Request, res: Response) => {
  try {
    const { url, mode = 'web' } = req.body as { url: string; mode?: 'web' | 'sap' | 'desktop' | 'mobile' }
    if (spyProcess) { killChild(spyProcess); spyProcess = null }

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
      env: { ...process.env, NODE_PATH: monoRepoNodeModules, PRABALA_HEADLESS: process.env.NODE_ENV === 'production' ? '1' : (process.env.PRABALA_HEADLESS ?? '') },
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
              if (spyProcess) { killChild(spyProcess); spyProcess = null }
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
  if (spyProcess) { killChild(spyProcess); spyProcess = null }
  broadcast('spy:done', null)
  res.json({ ok: true })
})

// ── /api/desktopRecorder ──────────────────────────────────────────────────────
let desktopRecorderProcess: ChildProcess | null = null

app.post('/api/desktopRecorder/start', (req: Request, res: Response) => {
  try {
    const { appPath, appiumUrl } = req.body as { appPath?: string; appiumUrl?: string }
    if (desktopRecorderProcess) { killChild(desktopRecorderProcess); desktopRecorderProcess = null }

    const recorderScript = path.resolve(__dirname, '../../../studio/electron/desktop-recorder.cjs')
    const monoRepoNodeModules = path.resolve(__dirname, '../../../node_modules')

    desktopRecorderProcess = spawn('node', [recorderScript, appPath || '', appiumUrl || 'http://localhost:4723'], {
      cwd: path.dirname(recorderScript),
      env: { ...process.env, NODE_PATH: monoRepoNodeModules },
    })

    desktopRecorderProcess.on('error', (err: NodeJS.ErrnoException) => {
      broadcast('desktopRecorder:error', `Failed to start recorder: ${err.message}`)
      broadcast('desktopRecorder:done', null)
      desktopRecorderProcess = null
    })

    desktopRecorderProcess.stdout?.on('data', (d: Buffer) => {
      const lines = d.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const obj = JSON.parse(line)
          if (obj.__done) {
            broadcast('desktopRecorder:done', null)
          } else if (obj.__error) {
            broadcast('desktopRecorder:error', obj.__error)
          } else if (obj.__screenshot) {
            broadcast('desktopRecorder:screenshot', obj)
          } else {
            broadcast('desktopRecorder:step', obj)
          }
        } catch { /* ignore malformed */ }
      }
    })

    desktopRecorderProcess.stderr?.on('data', (d: Buffer) => {
      console.log('[Desktop Recorder]', d.toString().trim())
    })

    desktopRecorderProcess.on('close', () => {
      broadcast('desktopRecorder:done', null)
      desktopRecorderProcess = null
    })

    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/desktopRecorder/stop', (_req: Request, res: Response) => {
  if (desktopRecorderProcess) { killChild(desktopRecorderProcess); desktopRecorderProcess = null }
  broadcast('desktopRecorder:done', null)
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

// ── Cron scheduler engine ─────────────────────────────────────────────────────
// Polls every minute, matches cron expressions, and fires test runs.

function parseCronField(field: string, min: number, max: number): number[] {
  const values: number[] = []
  if (field === '*') {
    for (let i = min; i <= max; i++) values.push(i)
    return values
  }
  for (const part of field.split(',')) {
    if (part.includes('/')) {
      const [range, step] = part.split('/')
      const s = parseInt(step, 10)
      const start = range === '*' ? min : parseInt(range.split('-')[0], 10)
      const end   = range.includes('-') ? parseInt(range.split('-')[1], 10) : max
      for (let i = start; i <= end; i += s) values.push(i)
    } else if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number)
      for (let i = a; i <= b; i++) values.push(i)
    } else {
      values.push(parseInt(part, 10))
    }
  }
  return values
}

function matchesCron(expr: string, d: Date): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const [m, h, dom, mon, dow] = parts
  const matches = (field: string, val: number, lo: number, hi: number) =>
    parseCronField(field, lo, hi).includes(val)
  return (
    matches(m,   d.getMinutes(),    0, 59) &&
    matches(h,   d.getHours(),      0, 23) &&
    matches(dom, d.getDate(),       1, 31) &&
    matches(mon, d.getMonth() + 1,  1, 12) &&
    matches(dow, d.getDay(),        0,  6)
  )
}

function startCronScheduler(): void {
  // Align to the next full minute boundary then tick every 60 s
  const msToNextMinute = (60 - new Date().getSeconds()) * 1000 - new Date().getMilliseconds()
  setTimeout(() => {
    tick()
    setInterval(tick, 60_000)
  }, msToNextMinute)

  console.log('  ⏱  Cron scheduler active (next tick in ~' + Math.round(msToNextMinute / 1000) + 's)')
}

async function tick(): Promise<void> {
  const now = new Date()
  const schedules = readSchedules()
  let dirty = false

  for (const run of schedules) {
    if (!run.enabled || !run.cron || !run.pattern) continue
    if (!matchesCron(run.cron, now)) continue

    const projectDir: string = run.projectDir || lastKnownProjectDir
    console.log(`[Cron] Firing schedule "${run.name || run.id}" (${run.cron}) — pattern: ${run.pattern}`)
    const started = now.toISOString()
    dirty = true

    const cliPath = path.resolve(__dirname, '../../cli/dist/index.js')
    const extraArgs: string[] = []
    if (run.profile) extraArgs.push('--profile', run.profile)

    const child = spawn('node', [cliPath, 'run', run.pattern, ...extraArgs], {
      cwd: projectDir,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    broadcast('runner:stdout', `\n[Scheduler] Running "${run.name || run.id}" at ${started}\n`)

    child.stdout?.on('data', (d: Buffer) => broadcast('runner:stdout', d.toString()))
    child.stderr?.on('data', (d: Buffer) => broadcast('runner:stderr', d.toString()))

    child.on('close', (code: number | null) => {
      const status = code === 0 ? 'passed' : 'failed'
      const idx = schedules.findIndex((s) => s.id === run.id)
      if (idx >= 0) {
        schedules[idx].lastRun    = started
        schedules[idx].lastStatus = status
        writeSchedules(schedules)
      }
      broadcast('runner:stdout', `[Scheduler] "${run.name || run.id}" finished — ${status}\n`)
      broadcast('schedule:updated', { id: run.id, lastRun: started, lastStatus: status })
    })
  }

  if (dirty) writeSchedules(schedules)
}

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

// ── /download — Desktop installer download page ───────────────────────────────
const BLOB_BASE = 'https://stiototportaldev.blob.core.windows.net/releases'
app.get('/download', async (_req: Request, res: Response) => {
  // List blobs in the releases container to find the latest installers
  let winUrl = `${BLOB_BASE}/Prabala-Studio-Setup.exe`
  let macUrl = `${BLOB_BASE}/Prabala-Studio.dmg`
  let linuxUrl = `${BLOB_BASE}/Prabala-Studio.AppImage`
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Download Prabala Studio</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#0f0f15;color:#e2e8f0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;gap:2rem}
    h1{font-size:2rem;font-weight:700;color:#a78bfa;margin:0}
    p{color:#94a3b8;margin:0;text-align:center}
    .cards{display:flex;gap:1.5rem;flex-wrap:wrap;justify-content:center}
    .card{background:#1e1b2e;border:1px solid #312d4b;border-radius:1rem;padding:2rem 2.5rem;display:flex;flex-direction:column;align-items:center;gap:1rem;min-width:200px}
    .card h2{margin:0;font-size:1.1rem;color:#c4b5fd}
    a.btn{background:#7c3aed;color:#fff;padding:.75rem 1.75rem;border-radius:.5rem;text-decoration:none;font-weight:600;font-size:.95rem;transition:background .2s}
    a.btn:hover{background:#6d28d9}
    .sub{font-size:.8rem;color:#64748b}
  </style>
</head>
<body>
  <h1>Prabala Studio</h1>
  <p>Download the desktop app for your platform</p>
  <div class="cards">
    <div class="card">
      <h2>🪟 Windows</h2>
      <a class="btn" href="${winUrl}">Download .exe</a>
      <span class="sub">Windows 10 / 11 (x64)</span>
    </div>
    <div class="card">
      <h2>🍎 macOS</h2>
      <a class="btn" href="${macUrl}">Download .dmg</a>
      <span class="sub">macOS 12+ (Intel &amp; Apple Silicon)</span>
    </div>
    <div class="card">
      <h2>🐧 Linux</h2>
      <a class="btn" href="${linuxUrl}">Download .AppImage</a>
      <span class="sub">Ubuntu 20.04+ / any distro</span>
    </div>
  </div>
  <p class="sub">Already installed? The app will auto-update when a new version is available.</p>
</body>
</html>`
  res.setHeader('Content-Type', 'text/html')
  res.send(html)
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
httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ❌  Port ${PORT} is already in use.`)
    console.error(`  ➜  Another instance of Prabala Studio Server is already running.`)
    console.error(`  ➜  Run: lsof -ti :${PORT} | xargs kill -9\n`)
    process.exit(1)
  } else {
    throw err
  }
})

httpServer.listen(PORT, () => {
  console.log(`\n  🔮 Prabala Studio Server`)
  console.log(`  ➜  http://localhost:${PORT}\n`)
  startCronScheduler()
})
