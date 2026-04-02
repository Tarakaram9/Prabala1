// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio — Web API client
// Drop-in replacement for window.prabala (Electron IPC bridge)
// All calls go to the studio-server REST API + WebSocket
// ─────────────────────────────────────────────────────────────────────────────

const BASE = '/api'
type SpyMode = 'web' | 'sap' | 'desktop' | 'mobile'

// ── WebSocket singleton ───────────────────────────────────────────────────────
type WsCallback = (payload: unknown) => void
const wsListeners = new Map<string, Set<WsCallback>>()

let ws: WebSocket | null = null
let wsReady = false
const wsQueue: string[] = []

function getWs(): WebSocket {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return ws
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
  if (!r.ok) {
    let message = `HTTP ${r.status}`
    try {
      const data = await r.json() as { error?: string; message?: string }
      message = data.error || data.message || message
    } catch {
      // ignore JSON parse errors and keep fallback message
    }
    throw new Error(message)
  }
  return r.json() as Promise<T>
}

async function del<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`, location.origin)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const r = await fetch(url.toString(), { method: 'DELETE' })
  return r.json() as Promise<T>
}

// ── dialog.openFolder() — replaced by FolderBrowserModal in React components ─
// Returns undefined; actual folder browsing done via FolderBrowserModal component
function openFolderDialog(): Promise<string | undefined> {
  return Promise.resolve(undefined)
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
      const result = await get<unknown>('/fs/dir', { path: dirPath })
      if (!Array.isArray(result)) {
        const err = (result as { error?: string })?.error ?? `Cannot read directory: ${dirPath}`
        throw new Error(err)
      }
      return result as { name: string; isDir: boolean; path: string }[]
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
    async start(startUrl: string, _projectDir: string): Promise<void> {
      const ipc = (window as any).prabala?.recorder
      if (ipc) return ipc.start(startUrl, _projectDir)
      // Web mode: open the target URL directly. The recording script is injected
      // by the user via copy-paste (console) or bookmarklet — see recording banner.
      getWs()
      window.open(startUrl || 'about:blank', '_blank')
    },
    async stop(): Promise<void> {
      const ipc = (window as any).prabala?.recorder
      if (ipc) { await ipc.stop(); return }
      await post('/recorder/stop', {})
    },
    onStep(cb: (step: { keyword: string; params: Record<string, string> }) => void): void {
      const ipc = (window as any).prabala?.recorder
      if (ipc) { ipc.onStep(cb); return }
      wsOn('recorder:step', (p) => cb(p as { keyword: string; params: Record<string, string> }))
    },
    onDone(cb: () => void): void {
      const ipc = (window as any).prabala?.recorder
      if (ipc) { ipc.onDone(cb); return }
      wsOn('recorder:done', () => cb())
    },
    onError(cb: (msg: string) => void): void {
      const ipc = (window as any).prabala?.recorder
      if (ipc?.onError) { ipc.onError(cb); return }
      wsOn('recorder:error', (p) => cb((p as { message: string }).message ?? String(p)))
    },
    removeAllListeners(): void {
      const ipc = (window as any).prabala?.recorder
      if (ipc) { ipc.removeAllListeners(); return }
      wsOffAll(['recorder:step', 'recorder:done', 'recorder:error'])
    },
  },

  spy: {
    async start(url: string, mode: SpyMode = 'web'): Promise<void> {
      const ipc = (window as any).prabala?.spy
      if (ipc) return ipc.start(url, mode)
      getWs()
      await post('/spy/start', { url, mode })
    },
    async stop(): Promise<void> {
      const ipc = (window as any).prabala?.spy
      if (ipc) { await ipc.stop(); return }
      await post('/spy/stop', {})
    },
    onLocator(cb: (result: { locator: string; tag: string; text: string }) => void): void {
      const ipc = (window as any).prabala?.spy
      if (ipc) { ipc.onLocator(cb); return }
      wsOn('spy:locator', (p) => cb(p as { locator: string; tag: string; text: string }))
    },
    onDone(cb: () => void): void {
      const ipc = (window as any).prabala?.spy
      if (ipc) { ipc.onDone(cb); return }
      wsOn('spy:done', () => cb())
    },
    onError(cb: (message: string) => void): void {
      const ipc = (window as any).prabala?.spy
      if (ipc) { ipc.onError(cb); return }
      wsOn('spy:error', (p) => cb(String(p)))
    },
    removeAllListeners(): void {
      const ipc = (window as any).prabala?.spy
      if (ipc) { ipc.removeAllListeners(); return }
      wsOffAll(['spy:locator', 'spy:done', 'spy:error'])
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
        return await post<{ ok: boolean; message: string }>('/ai/test', {})
      } catch (err: any) {
        return { ok: false, message: err?.message || 'Connection test failed.' }
      }
    },
    async chat(
      messages: { role: 'user' | 'assistant'; content: string }[],
      systemPrompt: string
    ): Promise<{ ok: boolean }> {
      return post('/ai/chat', { messages, systemPrompt, provider: 'azure' })
    },
    async abort(): Promise<void> { /* no-op — cancel via removeListeners */ },
    onChunk(cb: (token: string) => void): void { wsOn('ai:chunk', (p) => cb(p as string)) },
    onDone(cb: () => void): void { wsOn('ai:done', () => cb()) },
    removeListeners(): void { wsOffAll(['ai:chunk', 'ai:done']) },
  },

  // Internal helper — wsOff exposed for custom usage
  _wsOff: wsOff,

  results: {
    async get(projectDir?: string): Promise<any> {
      const params = projectDir ? { projectDir } : undefined
      return get('/results/latest', params)
    },
  },

  schedules: {
    async list(): Promise<any[]> {
      return get('/schedules')
    },
    async upsert(run: any): Promise<any> {
      return post('/schedules', run)
    },
    async remove(id: string): Promise<void> {
      await fetch(`${BASE}/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
  },

  aiImpact: {
    async analyze(changedFiles: string[], allTests: string[]): Promise<{ tests: string[]; reasoning: string }> {
      return post('/ai/impact', { changedFiles, allTests })
    },
  },
}

const electronBridge = typeof window !== 'undefined' ? (window as Window & { prabala?: PrabalaApi }).prabala : undefined

// In Electron, window.prabala provides IPC-backed methods but is missing REST-only
// sections (results, schedules, aiImpact, _wsOff). Merge so IPC wins where it
// exists and the REST fallback fills in any gaps.
export default electronBridge ? { ...api, ...electronBridge } : api
export type PrabalaApi = typeof api
