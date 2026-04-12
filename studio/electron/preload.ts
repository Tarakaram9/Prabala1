// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio – Electron Preload (IPC Bridge)
// Exposes a safe, typed API to the renderer process
// ─────────────────────────────────────────────────────────────────────────────

import { contextBridge, ipcRenderer } from 'electron';

type SpyMode = 'web' | 'sap' | 'desktop' | 'mobile';

contextBridge.exposeInMainWorld('prabala', {
  // ── File system ─────────────────────────────────────────────────────────────
  fs: {
    readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
    readDir: (dirPath: string) => ipcRenderer.invoke('fs:readDir', dirPath),
    exists: (filePath: string) => ipcRenderer.invoke('fs:exists', filePath),
    deleteFile: (filePath: string) => ipcRenderer.invoke('fs:deleteFile', filePath),
    mkdir: (dirPath: string) => ipcRenderer.invoke('fs:mkdir', dirPath),
    deleteDir: (dirPath: string) => ipcRenderer.invoke('fs:deleteDir', dirPath),
    rename: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
    moveFile: (srcPath: string, destPath: string) => ipcRenderer.invoke('fs:moveFile', srcPath, destPath),
  },

  // ── Dialogs ──────────────────────────────────────────────────────────────────
  dialog: {
    openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
    saveFile: (filters: { name: string; extensions: string[] }[]) =>
      ipcRenderer.invoke('dialog:saveFile', filters),
    openFile: (filters?: { name: string; extensions: string[] }[]) =>
      ipcRenderer.invoke('dialog:openFile', filters),
  },

  // ── Test Runner ──────────────────────────────────────────────────────────────
  runner: {
    run: (pattern: string, projectDir: string, extraArgs?: string[]) =>
      ipcRenderer.invoke('runner:run', pattern, projectDir, extraArgs ?? []),
    stop: () => ipcRenderer.invoke('runner:stop'),
    onStdout: (cb: (line: string) => void) => {
      ipcRenderer.on('runner:stdout', (_e, line) => cb(line));
    },
    onStderr: (cb: (line: string) => void) => {
      ipcRenderer.on('runner:stderr', (_e, line) => cb(line));
    },
    onDone: (cb: (code: number) => void) => {
      ipcRenderer.once('runner:done', (_e, code) => cb(code));
    },
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('runner:stdout');
      ipcRenderer.removeAllListeners('runner:stderr');
      ipcRenderer.removeAllListeners('runner:done');
    },
  },

  // ── Shell ────────────────────────────────────────────────────────────────────
  shell: {
    openPath: (filePath: string) => ipcRenderer.invoke('shell:openPath', filePath),
  },

  // ── Recorder ─────────────────────────────────────────────────────────────────
  recorder: {
    start: (startUrl: string, projectDir: string) =>
      ipcRenderer.invoke('recorder:start', startUrl, projectDir),
    stop: () => ipcRenderer.invoke('recorder:stop'),
    onStep: (cb: (step: { keyword: string; params: Record<string, string> }) => void) => {
      // Remove any previous listener before adding a new one to prevent accumulation
      ipcRenderer.removeAllListeners('recorder:step');
      ipcRenderer.on('recorder:step', (_e, step) => cb(step));
    },
    onDone: (cb: () => void) => {
      // Use 'on' not 'once' — removeAllListeners() handles cleanup between sessions
      ipcRenderer.removeAllListeners('recorder:done');
      ipcRenderer.on('recorder:done', () => cb());
    },
    onError: (cb: (msg: string) => void) => {
      ipcRenderer.removeAllListeners('recorder:error');
      ipcRenderer.on('recorder:error', (_e, msg) => cb(String(msg)));
    },
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('recorder:step');
      ipcRenderer.removeAllListeners('recorder:done');
      ipcRenderer.removeAllListeners('recorder:error');
    },
  },
  // ── Element Spy ──────────────────────────────────────────────────────────────
  spy: {
    start: (url: string, mode?: SpyMode) => ipcRenderer.invoke('spy:start', url, mode ?? 'web'),
    stop: () => ipcRenderer.invoke('spy:stop'),
    onLocator: (cb: (result: { locator: string; tag: string; text: string }) => void) => {
      ipcRenderer.on('spy:locator', (_e, result) => cb(result));
    },
    onHover: (cb: (result: { locator: string; tag: string; text: string }) => void) => {
      ipcRenderer.on('spy:hover', (_e, result) => cb(result));
    },
    onError: (cb: (message: string) => void) => {
      ipcRenderer.on('spy:error', (_e, message) => cb(String(message)));
    },
    onDone: (cb: () => void) => {
      ipcRenderer.once('spy:done', () => cb());
    },
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('spy:locator');
      ipcRenderer.removeAllListeners('spy:hover');
      ipcRenderer.removeAllListeners('spy:done');
      ipcRenderer.removeAllListeners('spy:error');
    },
  },
  // ── App ──────────────────────────────────────────────────────────────────────
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
  },
  // ── Agentic AI ───────────────────────────────────────────────────────────────
  ai: {
    getKey: () => ipcRenderer.invoke('ai:getKey'),
    setKey: (key: string) => ipcRenderer.invoke('ai:setKey', key),
    getConfig: () => ipcRenderer.invoke('ai:getConfig'),
    setConfig: (cfg: Record<string, string>) => ipcRenderer.invoke('ai:setConfig', cfg),
    testConnection: () => ipcRenderer.invoke('ai:testConnection'),
    chat: (
      messages: { role: 'user' | 'assistant'; content: string }[],
      systemPrompt: string
    ) => ipcRenderer.invoke('ai:chat', messages, systemPrompt),
    abort: () => ipcRenderer.invoke('ai:abort'),
    onChunk: (cb: (token: string) => void) => {
      ipcRenderer.on('ai:chunk', (_e, token) => cb(token));
    },
    onDone: (cb: () => void) => {
      ipcRenderer.once('ai:done', () => cb());
    },
    removeListeners: () => {
      ipcRenderer.removeAllListeners('ai:chunk');
      ipcRenderer.removeAllListeners('ai:done');
    },
  },
  // ── Desktop Recorder ─────────────────────────────────────────────────────────
  desktopRecorder: {
    checkPermission: () => ipcRenderer.invoke('desktopRecorder:checkPermission'),
    requestPermission: () => ipcRenderer.invoke('desktopRecorder:requestPermission'),
    start: (appPath: string, appiumUrl?: string) => ipcRenderer.invoke('desktopRecorder:start', appPath, appiumUrl),
    stop: () => ipcRenderer.invoke('desktopRecorder:stop'),
    onStep: (cb: (step: { keyword: string; params: Record<string, string> }) => void) => {
      ipcRenderer.removeAllListeners('desktopRecorder:step');
      ipcRenderer.on('desktopRecorder:step', (_e, step) => cb(step));
    },
    onDone: (cb: () => void) => {
      ipcRenderer.removeAllListeners('desktopRecorder:done');
      ipcRenderer.on('desktopRecorder:done', () => cb());
    },
    onError: (cb: (msg: string) => void) => {
      ipcRenderer.removeAllListeners('desktopRecorder:error');
      ipcRenderer.on('desktopRecorder:error', (_e, msg) => cb(String(msg)));
    },
    onScreenshot: (cb: (frame: { __screenshot: string; __screenshotType: string; width: number; height: number }) => void) => {
      ipcRenderer.removeAllListeners('desktopRecorder:screenshot');
      ipcRenderer.on('desktopRecorder:screenshot', (_e, frame) => cb(frame));
    },
    onAxFallback: (cb: (message: string) => void) => {
      ipcRenderer.removeAllListeners('desktopRecorder:axFallback');
      ipcRenderer.on('desktopRecorder:axFallback', (_e, msg) => cb(String(msg)));
    },
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('desktopRecorder:step');
      ipcRenderer.removeAllListeners('desktopRecorder:done');
      ipcRenderer.removeAllListeners('desktopRecorder:error');
      ipcRenderer.removeAllListeners('desktopRecorder:screenshot');
      ipcRenderer.removeAllListeners('desktopRecorder:axFallback');
    },
  },
});

// Type declaration for TypeScript in renderer
declare global {
  interface Window {
    prabala: {
      fs: { readFile(p: string): Promise<string>; writeFile(p: string, c: string): Promise<void>; readDir(p: string): Promise<{name:string;isDir:boolean;path:string}[]>; exists(p: string): Promise<boolean>; deleteFile(p: string): Promise<void>; mkdir(p: string): Promise<void>; deleteDir(p: string): Promise<void>; rename(o: string, n: string): Promise<void>; moveFile(s: string, d: string): Promise<void> };
      dialog: { openFolder(): Promise<string|undefined>; saveFile(f: {name:string;extensions:string[]}[]): Promise<string|undefined>; openFile(f?: {name:string;extensions:string[]}[]): Promise<string|undefined> };
      runner: {
        run(pattern: string, projectDir: string, extraArgs?: string[]): Promise<void>;
        stop(): Promise<void>;
        onStdout(cb:(l:string)=>void):void;
        onStderr(cb:(l:string)=>void):void;
        onDone(cb:(code:number)=>void):void;
        removeAllListeners():void
      };
      shell: { openPath(p: string): Promise<void> };
      app: { getVersion(): Promise<string>; getPlatform(): Promise<string> };
      ai: {
        getKey(): Promise<string>;
        setKey(key: string): Promise<void>;
        getConfig(): Promise<{ endpoint: string; apiKey: string; deployment: string; apiVersion: string }>;
        setConfig(cfg: Record<string, string>): Promise<void>;
        testConnection(): Promise<{ ok: boolean; message: string }>;
        chat(
          messages: { role: 'user' | 'assistant'; content: string }[],
          systemPrompt: string
        ): Promise<{ text: string }>;
        abort(): Promise<void>;
        onChunk(cb: (token: string) => void): void;
        onDone(cb: () => void): void;
        removeListeners(): void;
      };
      recorder: {
        start(url: string, projectDir: string): Promise<void>;
        stop(): Promise<void>;
        onStep(cb: (step: { keyword: string; params: Record<string, string> }) => void): void;
        onDone(cb: () => void): void;
        removeAllListeners(): void;
      };
      spy: {
        start(url: string, mode?: SpyMode): Promise<void>;
        stop(): Promise<void>;
        onLocator(cb: (result: { locator: string; tag: string; text: string }) => void): void;
        onError(cb: (message: string) => void): void;
        onDone(cb: () => void): void;
        removeAllListeners(): void;
      };
      desktopRecorder: {
        checkPermission(): Promise<boolean>;
        requestPermission(): Promise<boolean>;
        start(appPath: string, appiumUrl?: string): Promise<void>;
        stop(): Promise<void>;
        onStep(cb: (step: { keyword: string; params: Record<string, string> }) => void): void;
        onDone(cb: () => void): void;
        onError(cb: (msg: string) => void): void;
        onScreenshot(cb: (frame: { __screenshot: string; __screenshotType: string; width: number; height: number }) => void): void;
        onAxFallback(cb: (message: string) => void): void;
        removeAllListeners(): void;
      };
    };
  }
}
