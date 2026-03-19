// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio – Electron Preload (IPC Bridge)
// Exposes a safe, typed API to the renderer process
// ─────────────────────────────────────────────────────────────────────────────

import { contextBridge, ipcRenderer } from 'electron';

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
      ipcRenderer.on('recorder:step', (_e, step) => cb(step));
    },
    onDone: (cb: () => void) => {
      ipcRenderer.once('recorder:done', () => cb());
    },
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('recorder:step');
      ipcRenderer.removeAllListeners('recorder:done');
    },
  },

  // ── App ──────────────────────────────────────────────────────────────────────
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
  },
});

// Type declaration for TypeScript in renderer
declare global {
  interface Window {
    prabala: {
      fs: { readFile(p: string): Promise<string>; writeFile(p: string, c: string): Promise<void>; readDir(p: string): Promise<{name:string;isDir:boolean;path:string}[]>; exists(p: string): Promise<boolean>; deleteFile(p: string): Promise<void>; mkdir(p: string): Promise<void>; deleteDir(p: string): Promise<void>; rename(o: string, n: string): Promise<void>; moveFile(s: string, d: string): Promise<void> };
      dialog: { openFolder(): Promise<string|undefined>; saveFile(f: {name:string;extensions:string[]}[]): Promise<string|undefined> };
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
      recorder: {
        start(url: string, projectDir: string): Promise<void>;
        stop(): Promise<void>;
        onStep(cb: (step: { keyword: string; params: Record<string, string> }) => void): void;
        onDone(cb: () => void): void;
        removeAllListeners(): void;
      };
    };
  }
}
