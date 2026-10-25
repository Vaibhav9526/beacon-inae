// Beacon Hub desktop shell. Starts the hub engine as a child process, opens its local UI
// in a window, and keeps running in the tray so the agents keep watching when the window closes.
const { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, shell, dialog } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');

const HUB_DIR = path.join(__dirname, '..');
const ICON = path.join(HUB_DIR, 'ui', 'logo.png');
const OPEN_RE = /Open: (http:\/\/127\.0\.0\.1:\d+\/\?t=\w+)/;

let win = null;
let tray = null;
let engine = null;
let hubUrl = null;
let quitting = false;

// One hub per user session: a second launch just brings the existing window forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => showWindow());

function startEngine() {
  return new Promise((resolve, reject) => {
    // ELECTRON_RUN_AS_NODE makes the bundled Electron binary behave as plain Node, so no system Node is needed.
    engine = spawn(process.execPath, ['--import', 'tsx', 'engine/main.ts'], {
      cwd: HUB_DIR,
      env: { ...process.env, PORT: '0', ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    const timer = setTimeout(() => reject(new Error('The hub engine did not start within 30 seconds.')), 30_000);
    engine.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      if (hubUrl) return;
      buf += text;
      const m = buf.match(OPEN_RE);
      if (m) {
        hubUrl = m[1];
        clearTimeout(timer);
        resolve(hubUrl);
      }
    });
    engine.stderr.on('data', (chunk) => process.stderr.write(chunk));
    engine.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    engine.on('exit', (code) => {
      clearTimeout(timer);
      engine = null;
      if (!hubUrl) return reject(new Error(`The hub engine exited with code ${code} before it started.`));
      if (!quitting) {
        dialog.showErrorBox('Beacon Hub stopped', `The hub engine exited (code ${code}). The app will close.`);
        app.quit();
      }
    });
  });
}

function isHubUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && u.hostname === '127.0.0.1' && hubUrl && url.startsWith(hubUrl.split('/?')[0]);
  } catch {
    return false;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    title: 'Beacon Hub',
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#121212' : '#FAF8F5',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  // Only the local hub UI lives in this window. Other http(s) links open in the user's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (isHubUrl(url)) return;
    e.preventDefault();
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  win.once('ready-to-show', () => win.show());
  // Closing the window hides it to the tray; the engine keeps running.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => (win = null));
  win.loadURL(hubUrl);
}

function showWindow() {
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('Beacon Hub');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Beacon Hub', click: () => showWindow() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  tray.on('click', () => showWindow());
}

app.whenReady().then(async () => {
  if (!app.isPackaged) app.setAppUserModelId?.('org.beacon.hub');
  try {
    await startEngine();
  } catch (e) {
    dialog.showErrorBox('Beacon Hub could not start', String(e.message ?? e));
    app.quit();
    return;
  }
  createTray();
  createWindow();
});

// Keep running in the tray when the last window is closed.
app.on('window-all-closed', () => {});
app.on('before-quit', () => (quitting = true));
app.on('will-quit', () => {
  if (engine) engine.kill();
});
