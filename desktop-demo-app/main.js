// ─────────────────────────────────────────────────────────────────────────────
// Prabala Task Manager Demo — Electron Main Process
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Enable CDP remote debugging so Prabala desktop driver can interact with
// elements via Chrome DevTools Protocol instead of System Events JXA.
app.commandLine.appendSwitch('remote-debugging-port', '9222');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    title: 'Prabala Task Manager',
    backgroundColor: '#f0f2f5',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Required for macOS System Events / JXA to see the BrowserWindow's
  // web content in the accessibility tree (aria-labels, roles, etc.)
  app.setAccessibilitySupportEnabled(true);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
