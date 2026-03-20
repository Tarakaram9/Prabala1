// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio — Web API client
// Drop-in replacement for window.prabala (Electron IPC bridge)
// All calls go to the studio-server REST API + WebSocket
// ─────────────────────────────────────────────────────────────────────────────

const BASE = '/api'

// ── WebSocket singleton ───────────────────────────────────────────────────────
type WsCallback = (payload: unknown) => void
const wsListeners = new Map<string, Set<WsCallback>>()

let ws: WebSocket | null = null
let wsReady = false
const wsQueue: string[] = []

function getWs(): WebSocket {
  if (ws && ws.readyState === WebSocket.OPEN) return ws
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const url = `${proto}://${location.host}/prabala-ws`
  ws = new WebSocket(url)
  wsReady = false
  ws.onopen = () => {
    wsReady = true
    wsQueue.splice(0).forEach(m => ws!.send(m))
  }
  ws.onmessage = (ev) => {
    try {
      const { type, payload } = JSON.parse(ev.data as string) as { type: string; payload: unknown }
      wsListeners.get(type)?.forEach(cb => cb(payload))
    } catch { /* ignore */ }
  }
  ws.onclose = () => { wsReady = false; ws = null }
  return ws
}

function wsOn(type: string, cb: WsCallback): void {
  getWs()
  if (!wsListeners.has(type)) wsListeners.set(type, new Set())
  wsListeners.get(type)!.add(cb)
}

function wsOff(type: string, cb?: WsCallback): void {
  if (cb) {
    wsListeners.get(type)?.delete(cb)
  } else {
    wsListeners.delete(type)
  }
}

function wsOffAll(types: string[]): void {
  types.forEach(t => wsListeners.delete(t))
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`, location.origin)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const r = await fetch(url.toString())
  if (r.headers.get('content-type')?.includes('text/plain')) return r.text() as unknown as T
  return r.json() as Promise<T>
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json() as Promise<T>
}

async function del<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`, location.origin)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const r = await fetch(url.toString(), { method: 'DELETE' })
  return r.json() as Promise<T>
}

// ── dialog.openFolder() — web path input ──────────────────────────────────────
// Shows a lightweight modal asking the user to type/paste a folder path.
function openFolderDialog(): Promise<string | undefined> {
  return new Promise((resolve) => {
    // Inject a minimal modal — no React dep so it works anywhere
    const overlay = document.createElement('div')
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:99999;display:flex;align-items:center;justify-content:center'
    overlay.innerHTML = `
      <div style="background:#1e2433;border:1px solid #334155;border-radius:12px;padding:24px 28px;width:480px;font-family:sans-serif">
        <p style="color:#e2e8f0;font-size:14px;font-weight:600;margin:0 0 12px">Open Workspace Folder</p>
        <p style="color:#94a3b8;font-size:12px;margin:0 0 12px">Enter the absolute path to your project folder:</p>
        <input id="__prabala_path__" type="text" placeholder="/Users/you/my-project"
          style="width:100%;box-sizing:border-box;background:#0f172a;border:1px solid #475569;border-radius:8px;padding:10px 12px;color:#e2e8f0;font-size:13px;font-family:monospace;outline:none"/>
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
          <button id="__prabala_cancel__" style="padding:8px 16px;background:#334155;border:none;border-radius:6px;color:#e2e8f0;font-size:13px;cursor:pointer">Cancel</button>
          <button id="__prabala_ok__" style="padding:8px 16px;background:#6366f1;border:none;border-radius:6px;color:#fff;font-size:13px;cursor:pointer;font-weight:600">Open</button>
        </div>
      </div>`
    document.body.appendChild(overlay)
    const input = overlay.querySelector<HTMLInputElement>('#__prabala_path__')!
    const ok = overlay.querySelector<HTMLButtonElement>('#__prabala_ok__')!
    const cancel = overlay.querySelector<HTMLButtonElement>('#__prabala_cancel__')!
    input.focus()
    const finish = (val: string | undefined) => { document.body.removeChild(overlay); resolve(val) }
    ok.onclick = () => { const v = input.value.trim(); finish(v || undefined) }
    cancel.onclick = () => finish(undefined)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') ok.click()
      if (e.key === 'Escape') cancel.click()
    })
  })
}

// ── Public API — same shape as window.prabala ─────────────────────────────────
const api = {
  fs: {
    async readFile(filePath: string): Promise<string> {
      return get<string>('/fs/read', { path: filePath })
    },
    async writeFile(filePath: string, content: string): Promise<void> {
      await post('/fs/write', { path: filePath, content })
    },
    async readDir(dirPath: string): Promise<{ name: string; isDir: boolean; path: string }[]> {
      return get('/fs/dir', { path: dirPath })
    },
    async exists(filePath: string): Promise<boolean> {
      const r = await get<{ exists: boolean }>('/fs/exists', { path: filePath })
      return r.exists
    },
    async deleteFile(filePath: string): Promise<void> {
      await del('/fs/file', { path: filePath })
    },
    async mkdir(dirPath: string): Promise<void> {
      await post('/fs/mkdir', { path: dirPath })
    },
    async deleteDir(dirPath: string): Promise<void> {
      await del('/fs/dir', { path: dirPath })
    },
    async rename(oldPath: string, newPath: string): Promise<void> {
      await post('/fs/rename', { oldPath, newPath })
    },
    async moveFile(srcPath: string, destPath: string): Promise<void> {
      await post('/fs/move', { srcPath, destPath })
    },
  },

  dialog: {
    async openFolder(): Promise<string | undefined> {
      return openFolderDialog()
    },
    async saveFile(_filters: { name: string; extensions: string[] }[]): Promise<string | undefined> {
      // For web: ask user to type the save path
      return openFolderDialog()
    },
  },

  runner: {
    _stdoutCbs: new Set<(l: string) => void>(),
    _stderrCbs: new Set<(l: string) => void>(),
    _doneCbs: new Set<(code: number) => void>(),

    async run(pattern: string, projectDir: string, extraArgs: string[] = []): Promise<void> {
      getWs() // ensure connected
      await post('/runner/run', { pattern, projectDir, extraArgs })
    },
    async stop(): Promise<void> {
      await post('/runner/stop', {})
    },
    onStdout(cb: (l: string) => void): void {
      wsOn('runner:stdout', (p) => cb(p as string))
    },
    onStderr(cb: (l: string) => void): void {
      wsOn('runner:stderr', (p) => cb(p as string))
    },
    onDone(cb: (code: number) => void): void {
      wsOn('runner:done', (p) => cb(p as number))
    },
    removeAllListeners(): void {
      wsOffAll(['runner:stdout', 'runner:stderr', 'runner:done'])
    },
  },

  recorder: {
    async start(startUrl: string, projectDir: string): Promise<void> {
      getWs()
      await post('/recorder/start', { startUrl, projectDir })
    },
    async stop(): Promise<void> {
      await post('/recorder/stop', {})
    },
    onStep(cb: (step: { keyword: string; params: Record<string, string> }) => void): void {
      wsOn('recorder:step', (p) => cb(p as { keyword: string; params: Record<string, string> }))
    },
    onDone(cb: () => void): void {
      wsOn('recorder:done', () => cb())
    },
    removeAllListeners(): void {
      wsOffAll(['recorder:step', 'recorder:done'])
    },
  },

  shell: {
    async openPath(filePath: string): Promise<void> {
      await post('/shell/open', { path: filePath })
    },
  },

  app: {
    async getVersion(): Promise<string> {
      const r = await get<{ version: string }>('/app/version')
      return r.version
    },
    async getPlatform(): Promise<string> {
      const r = await get<{ platform: string }>('/app/platform')
      return r.platform
    },
  },

  ai: {
    async getKey(): Promise<string> {
      const r = await get<{ apiKey: string }>('/ai/config')
      return r.apiKey
    },
    async setKey(key: string): Promise<void> {
      await post('/ai/config', { apiKey: key })
    },
    async getConfig(): Promise<{ endpoint: string; apiKey: string; deployment: string; apiVersion: string }> {
      return get('/ai/config')
    },
    async setConfig(cfg: Record<string, string>): Promise<void> {
      await post('/ai/config', cfg)
    },
    async testConnection(): Promise<{ ok: boolean; message: string }> {
      try {
        const r = await post<{ text: string }>('/ai/chat', {
          messages: [{ role: 'user', content: 'ping' }],
          systemPrompt: 'Reply "pong"',
        })
        return { ok: true, message: r.text }
      } catch (err: any) {
        return { ok: false, message: err.message }
      }
    },
    async chat(
      messages: { role: 'user' | 'assistant'; content: string }[],
      systemPrompt: string
    ): Promise<{ text: string }> {
      return post('/ai/chat', { messages, systemPrompt })
    },
    async abort(): Promise<void> { /* no-op for non-streaming */ },
    onChunk(_cb: (token: string) => void): void { /* streaming not yet impl */ },
    onDone(_cb: () => void): void { /* streaming not yet impl */ },
    removeListeners(): void { wsOffAll(['ai:chunk', 'ai:done']) },
  },

  // Internal helper — wsOff exposed for custom usage
  _wsOff: wsOff,
}

export default api
export type PrabalaApi = typeof api
