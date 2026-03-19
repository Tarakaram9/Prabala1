// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio – Electron Main Process
// ─────────────────────────────────────────────────────────────────────────────

import { app, BrowserWindow, ipcMain, dialog, shell, session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile, spawn } from 'child_process';
import { AzureOpenAI } from 'openai';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const RENDERER_URL = 'http://localhost:5173';

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

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Set Content-Security-Policy on all responses to suppress the Electron security warning
  session.defaultSession.webRequest.onHeadersReceived((details: Electron.OnHeadersReceivedListenerDetails, callback: (response: Electron.HeadersReceivedResponse) => void) => {
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
    fs.unlinkSync(filePath);
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
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.renameSync(srcPath, destPath);
    return true;
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

  // ── Test Execution ───────────────────────────────────────────────────────────
  let runningProcess: ReturnType<typeof spawn> | null = null;

  ipcMain.handle('runner:run', (_e, pattern: string, projectDir: string, extraArgs: string[] = []) => {
    const cliPath = path.join(__dirname, '../../packages/cli/dist/index.js');
    const configPath = path.join(projectDir, 'prabala.config.yaml');

    const configArgs = fs.existsSync(configPath) ? ['--config', configPath] : [];

    runningProcess = spawn(
      'node',
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
    runningProcess?.kill();
    runningProcess = null;
    return true;
  });

  // ── Browser Recorder ─────────────────────────────────────────────────────────
  let recorderProcess: ReturnType<typeof spawn> | null = null;

  ipcMain.handle('recorder:start', (_e, startUrl: string, projectDir: string) => {
    if (recorderProcess) {
      recorderProcess.kill('SIGTERM');
      recorderProcess = null;
    }

    // In dev: __dirname = dist-electron/, script is at ../electron/recorder.cjs
    // In prod: __dirname = dist-electron/, script is copied alongside as recorder.cjs
    const recorderScript = isDev
      ? path.join(__dirname, '..', 'electron', 'recorder.cjs')
      : path.join(__dirname, 'recorder.cjs');

    // Must use system 'node', NOT process.execPath (which is the Electron binary)
    // NODE_PATH ensures playwright resolves from the monorepo node_modules
    recorderProcess = spawn('node', [recorderScript, startUrl || ''], {
      cwd: projectDir,
      env: {
        ...process.env,
        NODE_PATH: path.join(projectDir, 'node_modules'),
      },
    });

    recorderProcess.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.__done) {
            mainWindow?.webContents.send('recorder:done');
          } else {
            mainWindow?.webContents.send('recorder:step', obj);
          }
        } catch { /* ignore malformed lines */ }
      }
    });

    recorderProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[Recorder stderr]', data.toString().trim());
    });

    recorderProcess.on('close', () => {
      mainWindow?.webContents.send('recorder:done');
      recorderProcess = null;
    });

    return true;
  });

  ipcMain.handle('recorder:stop', () => {
    recorderProcess?.kill('SIGTERM');
    recorderProcess = null;
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
    if (!cfg.apiKey)    return { ok: false, message: 'API Key is missing.' };
    if (!cfg.endpoint)  return { ok: false, message: 'Endpoint URL is missing.' };
    if (!cfg.deployment) return { ok: false, message: 'Deployment Name is missing.' };

    try {
      const client = new AzureOpenAI({
        endpoint:   cfg.endpoint.trim(),
        apiKey:     cfg.apiKey.trim(),
        deployment: cfg.deployment.trim(),
        apiVersion: (cfg.apiVersion || '2024-08-01-preview').trim(),
      });
      // Minimal non-streaming call to validate
      await client.chat.completions.create({
        model: cfg.deployment.trim(),
        max_tokens: 5,
        stream: false,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return { ok: true, message: 'Connection successful!' };
    } catch (err: any) {
      const status = err?.status ?? err?.code;
      const body = err?.message ?? String(err);
      if (status === 404) {
        return { ok: false, message: `404 Not Found — check your Endpoint URL and Deployment Name.\nEndpoint: ${cfg.endpoint}\nDeployment: ${cfg.deployment}\n\nMake sure the deployment name exactly matches what is shown in Azure AI Foundry.` };
      }
      if (status === 401) {
        return { ok: false, message: '401 Unauthorized — the API Key is incorrect or expired.' };
      }
      if (status === 403) {
        return { ok: false, message: '403 Forbidden — this key does not have access to the resource.' };
      }
      return { ok: false, message: `Error ${status ?? ''}: ${body}` };
    }
  });

  // Active stream reference — allows abort
  let activeStream: { controller: AbortController } | null = null;

  ipcMain.handle('ai:chat',
    async (_e, messages: { role: 'user' | 'assistant'; content: string }[], systemPrompt: string) => {
      const cfg = readAiConfig();
      if (!cfg.apiKey)    throw new Error('No API key configured. Go to AI Settings to add your Azure OpenAI key.');
      if (!cfg.endpoint)  throw new Error('No Azure endpoint configured. Go to AI Settings.');
      if (!cfg.deployment) throw new Error('No deployment name configured. Go to AI Settings.');

      const client = new AzureOpenAI({
        endpoint:   cfg.endpoint.trim(),
        apiKey:     cfg.apiKey.trim(),
        deployment: cfg.deployment.trim(),
        apiVersion: (cfg.apiVersion || '2024-08-01-preview').trim(),
      });

      const controller = new AbortController();
      activeStream = { controller };
      let fullText = '';

      try {
        const stream = await client.chat.completions.create({
          model: cfg.deployment.trim(),
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
            throw new Error(`404 Not Found — Endpoint or Deployment name is wrong.\nEndpoint: ${cfg.endpoint}\nDeployment: ${cfg.deployment}\n\nGo to Azure AI Foundry → Deployments and copy the exact deployment name.`);
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
