// Beacon Hub desktop shell. Starts the hub engine as a child process, opens its local UI
// in a window, and keeps running in the tray so the agents keep watching when the window closes.
const { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, shell, dialog, Notification } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HUB_DIR = path.join(__dirname, '..');
const ICON = app.isPackaged ? path.join(process.resourcesPath, 'dist', 'ui', 'logo.png') : path.join(HUB_DIR, 'ui', 'logo.png');
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

/**
 * The data folder (keys, settings, members, health data). ONE folder for `npm run desktop` and the installed app:
 *   Windows: %APPDATA%\Beacon Hub\hub-data   (macOS/Linux: the equivalent under the app-data folder)
 * It is never inside the install folder, so updates and reinstalls leave it alone.
 */
function sharedDataDir() {
  return path.join(app.getPath('appData'), 'Beacon Hub', 'hub-data');
}

/**
 * One-time migration. Before this build, `npm run desktop` kept its data in ~/.beacon-hub (the engine default).
 * If the shared folder has no secrets.json yet, the saved keys and settings are copied from there (or from the other
 * old dev folder). A marker file makes this run only once, so a key removed later is not brought back.
 */
function migrateLegacyData(target) {
  fs.mkdirSync(target, { recursive: true });
  const marker = path.join(target, 'legacy-migrated.json');
  if (fs.existsSync(marker) || fs.existsSync(path.join(target, 'secrets.json'))) return;
  const sources = [path.join(os.homedir(), '.beacon-hub'), path.join(app.getPath('appData'), 'beacon-hub', 'hub-data')];
  let from = null;
  for (const dir of sources) {
    const file = path.join(dir, 'secrets.json');
    if (!fs.existsSync(file)) continue;
    try {
      fs.copyFileSync(file, path.join(target, 'secrets.json'), fs.constants.COPYFILE_EXCL);
      from = dir;
      break;
    } catch (e) {
      logUpdate(`migration copy failed from ${dir}: ${e.message}`);
    }
  }
  fs.writeFileSync(marker, JSON.stringify({ from, at: new Date().toISOString() }, null, 2), { mode: 0o600 });
  if (from) logUpdate(`settings migrated from ${from}`);
}

function startEngine() {
  return new Promise((resolve, reject) => {
    // ELECTRON_RUN_AS_NODE makes the Electron binary behave as plain Node, so no system Node is needed.
    // Packaged: run the esbuild bundle from resources (no TypeScript). Development: tsx on the sources.
    let args;
    let cwd;
    const env = { ...process.env, PORT: '0', ELECTRON_RUN_AS_NODE: '1' };
    env.BEACON_HUB_DIR = sharedDataDir();
    try {
      migrateLegacyData(env.BEACON_HUB_DIR);
    } catch (e) {
      logUpdate(`migration skipped: ${e.message}`);
    }
    if (app.isPackaged) {
      args = [path.join(process.resourcesPath, 'dist', 'engine.mjs')];
      cwd = path.join(process.resourcesPath, 'dist');
      env.BEACON_HUB_UI_DIR = path.join(process.resourcesPath, 'dist', 'ui');
    } else {
      args = ['--import', 'tsx', 'engine/main.ts'];
      cwd = HUB_DIR;
    }
    engine = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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

// ---- Auto update (packaged builds only). Feed: GitHub release asset "hub-latest" (see docs/releasing.md). ----
let updateReady = null; // version string once downloaded
let autoUpdater = null;

function logUpdate(msg) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'updater.log'), `${new Date().toISOString()} ${msg}
`);
  } catch {}
}

function setupUpdater() {
  if (!app.isPackaged) return;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    logUpdate(`electron-updater unavailable: ${e.message}`);
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: logUpdate, warn: logUpdate, error: logUpdate, debug: () => {} };
  autoUpdater.on('checking-for-update', () => logUpdate('checking for update'));
  autoUpdater.on('update-available', (i) => logUpdate(`update available ${i.version}`));
  autoUpdater.on('update-not-available', () => logUpdate('no update available'));
  autoUpdater.on('error', (e) => logUpdate(`update error: ${e && e.message}`));
  autoUpdater.on('update-downloaded', (i) => {
    updateReady = i.version;
    logUpdate(`update downloaded ${i.version}`);
    rebuildTrayMenu();
    try {
      const n = new Notification({ title: 'Beacon Hub update ready', body: `Beacon Hub ${i.version} will be installed when you quit.`, actions: [{ type: 'button', text: 'Restart now' }] });
      n.on('action', () => installNow());
      n.on('click', () => installNow());
      n.show();
    } catch (e) {
      logUpdate(`notification failed: ${e.message}`);
    }
  });
  setTimeout(() => checkForUpdates(false), 15_000);
  setInterval(() => checkForUpdates(false), 6 * 60 * 60 * 1000);
}

function checkForUpdates(manual) {
  if (!autoUpdater) {
    if (manual) dialog.showMessageBox({ message: 'Updates are only checked in the installed app.' });
    return;
  }
  // checkForUpdates rejects when offline or the feed is unreachable; that must never crash the app.
  autoUpdater
    .checkForUpdates()
    .then((r) => {
      if (manual && r && !r.isUpdateAvailable) dialog.showMessageBox({ message: `Beacon Hub ${app.getVersion()} is up to date.` });
    })
    .catch((e) => {
      logUpdate(`update check failed: ${e && e.message}`);
      if (manual) dialog.showMessageBox({ message: 'Could not check for updates. Are you online?' });
    });
}

function installNow() {
  quitting = true;
  try {
    autoUpdater.quitAndInstall(false, true);
  } catch (e) {
    logUpdate(`quitAndInstall failed: ${e.message}`);
    app.quit();
  }
}

function rebuildTrayMenu() {
  if (!tray) return;
  const items = [{ label: 'Open Beacon Hub', click: () => showWindow() }, { type: 'separator' }];
  if (updateReady) items.push({ label: `Restart now to install ${updateReady}`, click: () => installNow() });
  items.push({ label: 'Check for updates', click: () => checkForUpdates(true) });
  items.push({ label: `Version ${app.getVersion()}`, enabled: false });
  items.push({ type: 'separator' }, { label: 'Quit', click: () => app.quit() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('Beacon Hub');
  rebuildTrayMenu();
  tray.on('click', () => showWindow());
}

app.whenReady().then(async () => {
  app.setAppUserModelId?.(app.isPackaged ? 'app.beacon.hub' : 'org.beacon.hub');
  try {
    await startEngine();
  } catch (e) {
    dialog.showErrorBox('Beacon Hub could not start', String(e.message ?? e));
    app.quit();
    return;
  }
  createTray();
  createWindow();
  setupUpdater();
});

// Keep running in the tray when the last window is closed.
app.on('window-all-closed', () => {});
app.on('before-quit', () => (quitting = true));
app.on('will-quit', () => {
  if (engine) engine.kill();
});
