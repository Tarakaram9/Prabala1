// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio – Electron Main Process
// ─────────────────────────────────────────────────────────────────────────────

import { app, BrowserWindow, ipcMain, dialog, shell, session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile, spawn } from 'child_process';
import { AzureOpenAI } from 'openai';

// Auto-updater — only active in packaged builds
let autoUpdater: any = null;
if (app.isPackaged) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
  } catch {
    // electron-updater not installed — skip silently (dev builds)
  }
}

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const RENDERER_URL = 'http://localhost:5173';
const isWin = os.platform() === 'win32';

/**
 * Resolve the absolute path to the system `node` binary.
 * On macOS, Electron's spawned subprocesses may not inherit the full shell PATH
 * (especially when launched via Finder or Spotlight), so we probe common locations.
 */
function findNodeBinary(): string {
  if (isWin) {
    // On Windows, rely on PATH — node is usually in %AppData%\npm or C:\Program Files\nodejs
    return 'node';
  }
  const candidates = [
    process.env.NODE_BINARY,       // explicit override via env
    '/usr/local/bin/node',          // Homebrew on Intel macOS
    '/opt/homebrew/bin/node',       // Homebrew on Apple Silicon macOS
    '/usr/bin/node',                // system node (Linux / some macOS)
    '/usr/local/nvm/versions/node/current/bin/node',
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return 'node'; // last resort: rely on PATH
}
const NODE_BIN = findNodeBinary();

/** Cross-platform graceful kill: IPC message on Windows, SIGTERM on Unix */
function killChild(child: ReturnType<typeof spawn> | null): void {
  if (!child) return;
  if (isWin) {
    if (child.connected) {
      try { child.send({ type: 'stop' }); } catch { /* ignore */ }
    }
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
  } else {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
  }
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0f15',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../src/assets/icon.png'),
    show: false,
  });

  if (isDev) {
    mainWindow.loadURL(RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist-renderer/index.html'));
  }

  // Clear stored auth on every launch so the Login page is always shown.
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow?.webContents.executeJavaScript(
      `localStorage.removeItem('prabala_user'); localStorage.removeItem('prabala_workspace');`
    ).catch(() => {});
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Set Content-Security-Policy ONLY on localhost responses (Vite dev server + studio server).
  // External websites loaded in the recording window must NOT have their CSP overridden —
  // doing so blocks their own scripts and makes the page non-functional during recording.
  session.defaultSession.webRequest.onHeadersReceived((details: Electron.OnHeadersReceivedListenerDetails, callback: (response: Electron.HeadersReceivedResponse) => void) => {
    const isLocalhost = /^https?:\/\/localhost(:\d+)?/.test(details.url)
      || /^wss?:\/\/localhost(:\d+)?/.test(details.url);
    if (!isLocalhost) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' ws://localhost:* http://localhost:* https://api.anthropic.com; img-src 'self' data: blob:; media-src 'self'"
        ],
      },
    });
  });

  createWindow();
  registerIpcHandlers();

  // Check for updates silently after startup (packaged builds only)
  if (autoUpdater) {
    setTimeout(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 5000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─────────────────────────────────────────────────────────────────────────────
// IPC Handlers
// ─────────────────────────────────────────────────────────────────────────────

function registerIpcHandlers(): void {
  // ── File system ─────────────────────────────────────────────────────────────
  ipcMain.handle('fs:readFile', (_e, filePath: string) => {
    return fs.readFileSync(filePath, 'utf-8');
  });

  ipcMain.handle('fs:writeFile', (_e, filePath: string, content: string) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  });

  ipcMain.handle('fs:readDir', (_e, dirPath: string) => {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath).map((name) => ({
      name,
      isDir: fs.statSync(path.join(dirPath, name)).isDirectory(),
      path: path.join(dirPath, name),
    }));
  });

  ipcMain.handle('fs:exists', (_e, filePath: string) => {
    return fs.existsSync(filePath);
  });

  ipcMain.handle('fs:deleteFile', (_e, filePath: string) => {
    try {
      fs.unlinkSync(filePath);
    } catch (err: any) {
      // ENOENT means the file is already gone — treat as success (idempotent delete)
      if (err.code !== 'ENOENT') throw err;
    }
    return true;
  });

  ipcMain.handle('fs:mkdir', (_e, dirPath: string) => {
    fs.mkdirSync(dirPath, { recursive: true });
    return true;
  });

  ipcMain.handle('fs:deleteDir', (_e, dirPath: string) => {
    fs.rmSync(dirPath, { recursive: true, force: true });
    return true;
  });

  ipcMain.handle('fs:rename', (_e, oldPath: string, newPath: string) => {
    fs.renameSync(oldPath, newPath);
    return true;
  });

  ipcMain.handle('fs:moveFile', (_e, srcPath: string, destPath: string) => {
    if (!srcPath) throw new Error('moveFile: srcPath is empty');
    if (!destPath) throw new Error('moveFile: destPath is empty');
    if (!fs.existsSync(srcPath)) throw new Error(`moveFile: source does not exist: ${srcPath}`);
    try {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      try {
        fs.renameSync(srcPath, destPath);
      } catch (err: any) {
        if (err.code === 'EXDEV') {
          // Cross-device move: fall back to copy + delete
          fs.copyFileSync(srcPath, destPath);
          fs.unlinkSync(srcPath);
        } else {
          throw err;
        }
      }
      return true;
    } catch (err: any) {
      throw new Error(`moveFile failed (${srcPath} → ${destPath}): ${err.message ?? String(err)}`);
    }
  });

  // ── Dialogs ──────────────────────────────────────────────────────────────────
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Open Prabala Project',
    });
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle('dialog:saveFile', async (_e, filters: Electron.FileFilter[]) => {
    const result = await dialog.showSaveDialog(mainWindow!, { filters });
    return result.filePath ?? null;
  });

  ipcMain.handle('dialog:openFile', async (_e, filters?: Electron.FileFilter[]) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      // 'openDirectory' is required on macOS to select .app bundles.
      // Without it the user navigates INTO the bundle instead of selecting it.
      properties: ['openFile', 'openDirectory'],
      title: 'Select Application to Record',
      filters: filters ?? [
        { name: 'Applications', extensions: ['app', 'exe', 'dmg'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return result.filePaths[0] ?? null;
  });

  // ── Test Execution ───────────────────────────────────────────────────────────
  let runningProcess: ReturnType<typeof spawn> | null = null;

  ipcMain.handle('runner:run', (_e, pattern: string, projectDir: string, extraArgs: string[] = []) => {
    const cliPath = path.join(__dirname, '../../packages/cli/dist/index.js');
    const configPath = path.join(projectDir, 'prabala.config.yaml');

    const configArgs = fs.existsSync(configPath) ? ['--config', configPath] : [];

    runningProcess = spawn(
      NODE_BIN,
      [cliPath, 'run', pattern, ...configArgs, ...extraArgs],
      { cwd: projectDir, env: { ...process.env } }
    );

    runningProcess.stdout?.on('data', (data: Buffer) => {
      mainWindow?.webContents.send('runner:stdout', data.toString());
    });

    runningProcess.stderr?.on('data', (data: Buffer) => {
      mainWindow?.webContents.send('runner:stderr', data.toString());
    });

    runningProcess.on('close', (code: number) => {
      mainWindow?.webContents.send('runner:done', code);
      runningProcess = null;
    });

    return true;
  });

  ipcMain.handle('runner:stop', () => {
    killChild(runningProcess);
    runningProcess = null;
    return true;
  });

  // ── Browser Recorder ─────────────────────────────────────────────────────────
  // Uses a native Electron BrowserWindow so the recording browser is always
  // visible and focused — no separate Playwright subprocess needed.

  let recorderWindow: BrowserWindow | null = null;

  // LOCATOR + INTERCEPT scripts (inlined from recorder.cjs) injected into every page
  const RECORDER_LOCATOR_SCRIPT = `
window.__prabalaGetLocator = function(el) {
  if (!el) return 'unknown';
  if (el.id && !el.id.match(/^\\d/)) return '#' + el.id;
  const testid = el.getAttribute('data-testid') || el.getAttribute('data-cy');
  if (testid) return '[data-testid="' + testid + '"]';
  const aria = el.getAttribute('aria-label');
  if (aria) return '[aria-label="' + aria + '"]';
  const ph = el.getAttribute('placeholder');
  if (ph) return '[placeholder="' + ph + '"]';
  const tag = el.tagName.toLowerCase();
  if (!['input','textarea','select'].includes(tag)) {
    const txt = (el.innerText || el.textContent || '').trim().replace(/\\s+/g,' ').slice(0, 50);
    if (txt) return 'text=' + txt;
  }
  const cls = [...el.classList].filter(c => !/\\d{3,}/.test(c)).slice(0, 2).join('.');
  return tag + (cls ? '.' + cls : '');
};`;

  const RECORDER_INTERCEPT_SCRIPT = `
(function() {
  if (window.__prabalaRecorderActive) return;
  window.__prabalaRecorderActive = true;
  let inputTimer = null;
  let lastInputEl = null;
  let lastInputVal = '';
  document.addEventListener('click', function(e) {
    const el = e.target;
    if (['INPUT','TEXTAREA','SELECT'].includes(el.tagName)) return;
    if (el.tagName === 'OPTION') return;
    const loc = window.__prabalaGetLocator(el);
    window.__prabalaSendStep('click', loc, '');
  }, true);
  document.addEventListener('input', function(e) {
    const el = e.target;
    if (!['INPUT','TEXTAREA'].includes(el.tagName)) return;
    lastInputEl = el;
    lastInputVal = el.value;
    clearTimeout(inputTimer);
    inputTimer = setTimeout(function() {
      if (!lastInputEl) return;
      const loc = window.__prabalaGetLocator(lastInputEl);
      window.__prabalaSendStep('input', loc, lastInputVal);
    }, 600);
  }, true);
  document.addEventListener('change', function(e) {
    const el = e.target;
    if (el.tagName !== 'SELECT') return;
    const loc = window.__prabalaGetLocator(el);
    window.__prabalaSendStep('select', loc, el.value);
  }, true);
  document.addEventListener('keydown', function(e) {
    if (['Enter','Escape','Tab'].includes(e.key)) {
      if (lastInputEl && inputTimer) {
        clearTimeout(inputTimer);
        const loc = window.__prabalaGetLocator(lastInputEl);
        window.__prabalaSendStep('input', loc, lastInputVal);
        lastInputEl = null;
      }
      if (e.key === 'Enter') window.__prabalaSendStep('key', 'Enter', '');
    }
  }, true);
})();`;

  // Forward raw steps from the recording window → recorder:step on mainWindow
  ipcMain.on('recorder:raw-step', (_e, { type, locator, value }: { type: string; locator: string; value: string }) => {
    let step: { keyword: string; params: Record<string, string> } | null = null;
    switch (type) {
      case 'click':   step = { keyword: 'Click',        params: { locator } }; break;
      case 'input':   if (value) step = { keyword: 'EnterText', params: { locator, value } }; break;
      case 'select':  step = { keyword: 'SelectOption', params: { locator, option: value } }; break;
      case 'key':     step = { keyword: 'PressKey',     params: { key: locator } }; break;
    }
    if (step) mainWindow?.webContents.send('recorder:step', step);
  });

  const recorderPreload = isDev
    ? path.join(__dirname, '..', 'electron', 'recorder-window-preload.cjs')
    : path.join(__dirname, 'recorder-window-preload.cjs');

  ipcMain.handle('recorder:start', async (_e, startUrl: string) => {
    console.log('[Recorder] recorder:start IPC called, url:', startUrl)
    // Close any existing recording window
    if (recorderWindow && !recorderWindow.isDestroyed()) {
      recorderWindow.close();
      recorderWindow = null;
    }

    recorderWindow = new BrowserWindow({
      width: 1280,
      height: 820,
      title: '● Recording — Prabala',
      webPreferences: {
        preload: recorderPreload,
        contextIsolation: true,
        nodeIntegration: false,
        // Allow mixed content and insecure pages to support any target site
        webSecurity: false,
      },
    });

    // Inject locator + intercept scripts into every page/frame load
    recorderWindow.webContents.on('did-finish-load', () => {
      recorderWindow?.webContents.executeJavaScript(
        RECORDER_LOCATOR_SCRIPT + '\n' + RECORDER_INTERCEPT_SCRIPT
      ).catch(() => {});
    });

    // Emit NavigateTo when the URL changes
    let lastNavUrl = '';
    recorderWindow.webContents.on('did-navigate', (_e, url) => {
      if (url.startsWith('http') && url !== lastNavUrl) {
        lastNavUrl = url;
        mainWindow?.webContents.send('recorder:step', { keyword: 'NavigateTo', params: { url } });
      }
    });
    recorderWindow.webContents.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame && url.startsWith('http') && url !== lastNavUrl) {
        lastNavUrl = url;
        mainWindow?.webContents.send('recorder:step', { keyword: 'NavigateTo', params: { url } });
      }
    });

    // Signal done when the recording window is closed
    recorderWindow.on('closed', () => {
      recorderWindow = null;
      ipcMain.removeAllListeners('recorder:raw-step');
      mainWindow?.webContents.send('recorder:done');
    });

    // Load the target URL (or a blank page if none given)
    const target = startUrl && startUrl !== 'about:blank' ? startUrl : 'about:blank';
    try {
      await recorderWindow.loadURL(target);
    } catch (err: any) {
      // Non-fatal — navigation errors appear in the window itself
      console.warn('[Recorder] loadURL warning:', err.message);
    }

    return true;
  });

  ipcMain.handle('recorder:stop', () => {
    if (recorderWindow && !recorderWindow.isDestroyed()) {
      recorderWindow.close();
    }
    recorderWindow = null;
    return true;
  });

  // ── Element Spy ───────────────────────────────────────────────────────────────
  let spyProcess: ReturnType<typeof spawn> | null = null;

  ipcMain.handle('spy:start', (_e, url: string, mode: 'web' | 'sap' | 'desktop' | 'mobile' = 'web') => {
    if (spyProcess) { killChild(spyProcess); spyProcess = null; }

    const electronDir = isDev
      ? path.join(__dirname, '..', 'electron')
      : __dirname;
    const nodeModules = path.join(__dirname, '..', '..', 'node_modules');

    let spyScript: string;
    let spyArgs: string[];

    if (mode === 'sap') {
      spyScript = path.join(electronDir, 'sap-spy.cjs');
      spyArgs   = [];
    } else if (mode === 'desktop' || mode === 'mobile') {
      spyScript = path.join(electronDir, 'desktop-spy.cjs');
      spyArgs   = [url || 'http://localhost:4723', mode];
    } else {
      spyScript = path.join(electronDir, 'spy.cjs');
      spyArgs   = [url || 'about:blank'];
    }

    spyProcess = spawn(NODE_BIN, [spyScript, ...spyArgs], {
      cwd: path.dirname(spyScript),
      env: {
        ...process.env,
        NODE_PATH: nodeModules,
      },
    });

    spyProcess.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.__done) {
            mainWindow?.webContents.send('spy:done');
          } else if (obj.__error) {
            mainWindow?.webContents.send('spy:error', obj.__error);
          } else {
            mainWindow?.webContents.send('spy:locator', obj); // { locator, tag, text }
            setTimeout(() => {
              if (spyProcess) { killChild(spyProcess); spyProcess = null; }
            }, 300);
          }
        } catch { /* ignore malformed */ }
      }
    });

    spyProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      console.error('[Spy stderr]', msg);
      if (msg) mainWindow?.webContents.send('spy:error', msg);
    });

    spyProcess.on('close', () => {
      mainWindow?.webContents.send('spy:done');
      spyProcess = null;
    });

    return true;
  });

  ipcMain.handle('spy:stop', () => {
    killChild(spyProcess);
    spyProcess = null;
    return true;
  });

  // ── Desktop Recorder ─────────────────────────────────────────────────────────
  let desktopRecorderProcess: ReturnType<typeof spawn> | null = null;

  ipcMain.handle('desktopRecorder:start', (_e, appPath: string, appiumUrl?: string) => {
    try {
      if (desktopRecorderProcess) { killChild(desktopRecorderProcess); desktopRecorderProcess = null; }

      const electronDir = isDev
        ? path.join(__dirname, '..', 'electron')
        : __dirname;
      const nodeModules = path.join(__dirname, '..', '..', 'node_modules');
      const script = path.join(electronDir, 'desktop-recorder.cjs');

      desktopRecorderProcess = spawn(NODE_BIN, [script, appPath || '', appiumUrl || 'http://localhost:4723'], {
        cwd: path.dirname(script),
        env: { ...process.env, NODE_PATH: nodeModules },
      });

      // Handle ENOENT / EACCES — e.g. node not found or script missing
      desktopRecorderProcess.on('error', (err: NodeJS.ErrnoException) => {
        console.error('[Desktop Recorder] spawn error:', err.message);
        mainWindow?.webContents.send('desktopRecorder:error', `Failed to start recorder: ${err.message}`);
        mainWindow?.webContents.send('desktopRecorder:done');
        desktopRecorderProcess = null;
      });

      desktopRecorderProcess.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.__done) {
              mainWindow?.webContents.send('desktopRecorder:done');
            } else if (obj.__error) {
              mainWindow?.webContents.send('desktopRecorder:error', obj.__error);
            } else if (obj.__screenshot) {
              mainWindow?.webContents.send('desktopRecorder:screenshot', obj);
            } else {
              mainWindow?.webContents.send('desktopRecorder:step', obj);
            }
          } catch { /* ignore malformed */ }
        }
      });

      desktopRecorderProcess.stderr?.on('data', (data: Buffer) => {
        console.log('[Desktop Recorder]', data.toString().trim());
      });

      desktopRecorderProcess.on('close', (code) => {
        mainWindow?.webContents.send('desktopRecorder:done');
        desktopRecorderProcess = null;
      });

      return true;
    } catch (err: any) {
      console.error('[Desktop Recorder] IPC handler error:', err);
      mainWindow?.webContents.send('desktopRecorder:error', err?.message || 'Failed to start desktop recorder');
      return false;
    }
  });

  ipcMain.handle('desktopRecorder:stop', () => {
    killChild(desktopRecorderProcess);
    desktopRecorderProcess = null;
    return true;
  });

  // ── Shell ────────────────────────────────────────────────────────────────────
  ipcMain.handle('shell:openPath', (_e, filePath: string) => {
    shell.openPath(filePath);
    return true;
  });

  // ── App info ─────────────────────────────────────────────────────────────────
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:getPlatform', () => process.platform);

  // ── Agentic AI ───────────────────────────────────────────────────────────────
  const AI_CONFIG_PATH = path.join(os.homedir(), '.prabala', 'ai.json');

  function sanitizeAzureEndpoint(input: string): string {
    return input
      .trim()
      .replace(/\/+$/, '')
      .replace(/\/openai$/i, '');
  }

  function readAiConfig(): Record<string, string> {
    try {
      if (fs.existsSync(AI_CONFIG_PATH)) {
        return JSON.parse(fs.readFileSync(AI_CONFIG_PATH, 'utf-8'));
      }
    } catch { /* ignore */ }
    return {};
  }

  function writeAiConfig(data: Record<string, string>): void {
    fs.mkdirSync(path.dirname(AI_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(AI_CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
  }

  ipcMain.handle('ai:getKey', () => {
    return readAiConfig().apiKey ?? '';
  });

  ipcMain.handle('ai:setKey', (_e, key: string) => {
    const cfg = readAiConfig();
    writeAiConfig({ ...cfg, apiKey: key });
    return true;
  });

  ipcMain.handle('ai:getConfig', () => {
    const cfg = readAiConfig();
    return {
      endpoint:   cfg.endpoint   ?? '',
      apiKey:     cfg.apiKey     ?? '',
      deployment: cfg.deployment ?? 'gpt-4o',
      apiVersion: cfg.apiVersion ?? '2024-08-01-preview',
    };
  });

  ipcMain.handle('ai:setConfig', (_e, cfg: Record<string, string>) => {
    const existing = readAiConfig();
    writeAiConfig({ ...existing, ...cfg });
    return true;
  });

  ipcMain.handle('ai:testConnection', async () => {
    const cfg = readAiConfig();
    const endpoint = sanitizeAzureEndpoint(cfg.endpoint || '');
    const deployment = (cfg.deployment || '').trim();
    if (!cfg.apiKey)     return { ok: false, message: 'API Key is missing.' };
    if (!endpoint)       return { ok: false, message: 'Endpoint URL is missing.' };
    if (!deployment)     return { ok: false, message: 'Deployment Name is missing.' };

    try {
      const client = new AzureOpenAI({
        endpoint,
        apiKey:     cfg.apiKey.trim(),
        deployment,
        apiVersion: (cfg.apiVersion || '2024-08-01-preview').trim(),
        timeout: 15000,
      });
      // Minimal non-streaming call to validate
      await client.chat.completions.create({
        model: deployment,
        max_tokens: 5,
        stream: false,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return { ok: true, message: 'Connection successful!' };
    } catch (err: any) {
      const status = err?.status ?? err?.code;
      const body = err?.message ?? String(err);
      if (status === 404) {
        return { ok: false, message: `404 Not Found — check your Endpoint URL and Deployment Name.\nEndpoint: ${endpoint}\nDeployment: ${deployment}\n\nEndpoint format should be: https://YOUR-RESOURCE.openai.azure.com\nDo not include /openai/deployments in endpoint.\nDeployment must exactly match Azure AI Foundry.` };
      }
      if (status === 401) {
        return { ok: false, message: '401 Unauthorized — the API Key is incorrect or expired.' };
      }
      if (status === 403) {
        return { ok: false, message: '403 Forbidden — this key does not have access to the resource.' };
      }
      if (err?.name === 'AbortError' || String(body).toLowerCase().includes('timeout')) {
        return { ok: false, message: 'Connection timed out after 15 seconds. Check endpoint URL, VPN/proxy/firewall, and network access to Azure OpenAI.' };
      }
      return { ok: false, message: `Error ${status ?? ''}: ${body}` };
    }
  });

  // Active stream reference — allows abort
  let activeStream: { controller: AbortController } | null = null;

  ipcMain.handle('ai:chat',
    async (_e, messages: { role: 'user' | 'assistant'; content: string }[], systemPrompt: string) => {
      const cfg = readAiConfig();
      const endpoint = sanitizeAzureEndpoint(cfg.endpoint || '');
      const deployment = (cfg.deployment || '').trim();
      if (!cfg.apiKey)    throw new Error('No API key configured. Go to AI Settings to add your Azure OpenAI key.');
      if (!endpoint)      throw new Error('No Azure endpoint configured. Go to AI Settings.');
      if (!deployment)    throw new Error('No deployment name configured. Go to AI Settings.');

      const client = new AzureOpenAI({
        endpoint,
        apiKey:     cfg.apiKey.trim(),
        deployment,
        apiVersion: (cfg.apiVersion || '2024-08-01-preview').trim(),
        timeout: 30000,
      });

      const controller = new AbortController();
      activeStream = { controller };
      let fullText = '';

      try {
        const stream = await client.chat.completions.create({
          model: deployment,
          max_tokens: 4096,
          stream: true,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages,
          ],
        }, { signal: controller.signal });

        for await (const chunk of stream) {
          const token = chunk.choices[0]?.delta?.content ?? '';
          if (token) {
            fullText += token;
            mainWindow?.webContents.send('ai:chunk', token);
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError' && err.name !== 'APIUserAbortError') {
          const status = err?.status ?? err?.code;
          if (status === 404) {
            throw new Error(`404 Not Found — Endpoint or Deployment name is wrong.\nEndpoint: ${endpoint}\nDeployment: ${deployment}\n\nEndpoint must be only the resource URL (no /openai path).\nGo to Azure AI Foundry → Deployments and copy the exact deployment name.`);
          }
          if (status === 401) throw new Error('401 Unauthorized — check your API Key in AI Settings.');
          throw err;
        }
      } finally {
        activeStream = null;
        mainWindow?.webContents.send('ai:done');
      }

      return { text: fullText };
    }
  );

  ipcMain.handle('ai:abort', () => {
    activeStream?.controller.abort();
    activeStream = null;
    return true;
  });
}
