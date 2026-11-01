'use strict';
const {
  app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage, screen, globalShortcut,
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif']);
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const AUTOSTART_FLAG = '--corkly-autostart';
const SHORTCUT = 'CommandOrControl+Shift+Space';
const asset = (f) => path.join(__dirname, 'assets', f);

// Tip jar link and nudge timing live in src/config.json so they're easy to change.
let config = { tipUrl: '', tipButtonLabel: 'Buy me a coffee', nudge: { afterLaunches: 5, afterDays: 3, remindEveryDays: 30 } };
try { config = { ...config, ...JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')) }; } catch {}
// ---------- updates ----------
// Windows installs updates itself. On a Mac, an app can only update itself once it's signed with an
// Apple Developer ID, so until "macSigned" is true in config.json we just point people at the download.
let updater = null;
let updateState = { state: 'idle' };
const canSelfUpdate = () => !isMac || !!config.macSigned;
function sendUpdate(state) {
  updateState = state;
  if (win && !win.isDestroyed()) win.webContents.send('update:status', state);
}
function setupUpdates() {
  if (!app.isPackaged) return;
  try { ({ autoUpdater: updater } = require('electron-updater')); } catch { return; }
  updater.autoDownload = canSelfUpdate();
  updater.autoInstallOnAppQuit = canSelfUpdate();
  updater.on('update-available', (i) => sendUpdate({ state: canSelfUpdate() ? 'downloading' : 'available', version: i.version, canInstall: canSelfUpdate() }));
  updater.on('update-not-available', () => sendUpdate({ state: 'none' }));
  updater.on('update-downloaded', (i) => sendUpdate({ state: 'ready', version: i.version, canInstall: true }));
  updater.on('error', (e) => sendUpdate({ state: 'error', message: String(e && e.message || e) }));
  const check = () => updater.checkForUpdates().catch(() => {});
  setTimeout(check, 15000);
  setInterval(check, 6 * 60 * 60 * 1000);
}

// ---------- shared boards (Firebase) ----------
// Web config for your Firebase project lives in src/firebase-config.json (see CLOUD.md).
let firebaseConfig = null;
try {
  firebaseConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'firebase-config.json'), 'utf8'));
  if (!firebaseConfig.apiKey) firebaseConfig = null;
} catch { firebaseConfig = null; }
if (process.env.CORKLY_EMULATOR) {
  firebaseConfig = { apiKey: 'demo-key', authDomain: 'demo-corkly.firebaseapp.com', projectId: 'demo-corkly', storageBucket: 'demo-corkly.appspot.com', appId: 'demo', emulator: { host: '127.0.0.1' } };
}

// corkly://join/CODE links
let pendingJoin = null;
const joinFrom = (s) => {
  const m = /corkly:\/\/join\/([A-Za-z0-9-]+)/i.exec(String(s || ''));
  return m ? m[1] : null;
};
function deliverJoin(code) {
  if (!code) return;
  pendingJoin = code;
  if (!app.isReady()) return; // picked up by the window once it loads
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
    win.webContents.send('cloud:join', code);
    pendingJoin = null;
  }
  showWin();
}
app.on('open-url', (e, url) => { e.preventDefault(); deliverJoin(joinFrom(url)); });

// ---------- anonymous usage stats (Aptabase) ----------
// Only counts like "opened today" — never anything on your boards. Key lives in config.json; empty = off.
let aptabase = null;
if (/^A-(EU|US|SH)-/.test(config.aptabaseKey || '')) {
  try {
    aptabase = require('@aptabase/electron/main');
    aptabase.initialize(config.aptabaseKey, config.aptabaseHost ? { host: config.aptabaseHost } : undefined);
  } catch (e) { aptabase = null; }
}
const TRACKABLE = new Set(['board_shared', 'board_joined', 'invite_created', 'tip_clicked', 'mode_switched', 'board_created']);
function track(name, props) {
  if (!aptabase || settings.analytics === false) return;
  try { aptabase.trackEvent(name, props).catch(() => {}); } catch {}
}
const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y) / 864e5 + 1) / 7)).padStart(2, '0')}`;
}
// One event per install per day/week/month, so the counts in Aptabase *are* your active users.
function pingActive() {
  const props = { mode: currentMode };
  const marks = settings.activeMarks || {};
  const now = new Date();
  const checks = [['daily_active', dayKey(now)], ['weekly_active', weekKey(now)], ['monthly_active', dayKey(now).slice(0, 7)]];
  let changed = false;
  for (const [ev, key] of checks) {
    if (marks[ev] !== key) { marks[ev] = key; changed = true; track(ev, props); }
  }
  if (changed) { settings.activeMarks = marks; saveSettings(); }
}

const openTip = () => { if (/^https:\/\//i.test(config.tipUrl)) shell.openExternal(config.tipUrl); };

// ---------- paths ----------
const dataDir = () => app.getPath('userData');
const dataFile = () => path.join(dataDir(), 'corkly-boards.json');
const settingsFile = () => path.join(dataDir(), 'corkly-settings.json');
const imagesDir = () => {
  const dir = path.join(dataDir(), 'images');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

function writeAtomic(file, contents) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, file);
}

// ---------- settings ----------
const DEFAULT_SETTINGS = {
  openAtLogin: true,        // start Corkly when the computer starts
  loginAsWidget: true,      // ...and open it as a desktop widget
  mode: 'widget',           // last used mode: 'window' | 'widget' — first launch starts small
  widgetOnTop: false,       // keep the widget floating above other windows
  analytics: true,          // anonymous usage counts (Settings → Send anonymous usage stats)
  widgetBounds: null,
  windowBounds: null,
  closeToTray: true,        // closing hides Corkly to the tray / menu bar instead of quitting
  shortcut: true,           // global show/hide shortcut
};
let settings = { ...DEFAULT_SETTINGS };
let firstLaunch = false;

function loadSettings() {
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}
function saveSettings() {
  try { writeAtomic(settingsFile(), JSON.stringify(settings, null, 2)); } catch {}
}

// ---------- launch at login ----------
function applyLoginItem() {
  // In development the login item would point at the bare Electron binary, so only register packaged builds.
  if (!app.isPackaged) return;
  try {
    if (isMac) {
      app.setLoginItemSettings({ openAtLogin: settings.openAtLogin });
    } else {
      app.setLoginItemSettings({
        openAtLogin: settings.openAtLogin,
        path: process.execPath,
        args: [AUTOSTART_FLAG],
      });
    }
  } catch (e) {
    console.error('login item', e);
  }
}
function launchedAtLogin() {
  if (process.argv.includes(AUTOSTART_FLAG)) return true;
  if (isMac) {
    try { return !!app.getLoginItemSettings().wasOpenedAtLogin; } catch { return false; }
  }
  return false;
}

// ---------- images ----------
function imageInfo(file) {
  const img = nativeImage.createFromPath(path.join(imagesDir(), file));
  const { width, height } = img.isEmpty() ? { width: 1, height: 1 } : img.getSize();
  return { file, ratio: height / width || 1 };
}
function importImageFile(src) {
  const ext = path.extname(src).toLowerCase();
  if (!IMAGE_EXT.has(ext) || !fs.existsSync(src)) return null;
  const file = crypto.randomUUID() + ext;
  fs.copyFileSync(src, path.join(imagesDir(), file));
  return imageInfo(file);
}

// ---------- windows ----------
let win = null;
let tray = null;
let currentMode = 'window';
let quitting = false;

function boundsVisible(b) {
  if (!b) return false;
  return screen.getAllDisplays().some(({ workArea: w }) =>
    b.x < w.x + w.width - 60 && b.x + b.width > w.x + 60 && b.y >= w.y - 10 && b.y < w.y + w.height - 60);
}

function defaultWidgetBounds() {
  const { workArea: w } = screen.getPrimaryDisplay();
  const width = 480, height = 600;
  return { x: w.x + w.width - width - 28, y: w.y + 28, width, height };
}

function rememberBounds() {
  if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
  const key = currentMode === 'widget' ? 'widgetBounds' : 'windowBounds';
  if (currentMode === 'window' && win.isMaximized()) return;
  settings[key] = win.getBounds();
  saveSettings();
}

function createWindow(mode, { show = true } = {}) {
  currentMode = mode;
  const widget = mode === 'widget';
  const saved = widget ? settings.widgetBounds : settings.windowBounds;
  const bounds = boundsVisible(saved) ? saved : widget ? defaultWidgetBounds() : { width: 1320, height: 860 };

  const opts = {
    ...bounds,
    minWidth: widget ? 340 : 780,
    minHeight: widget ? 380 : 540,
    show: false,
    title: 'Corkly',
    icon: isMac ? undefined : asset('icon.png'),
    backgroundColor: '#5b3a22',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      additionalArguments: [`--corkly-mode=${mode}`],
    },
  };

  if (widget) {
    Object.assign(opts, {
      frame: false,
      skipTaskbar: true,         // no taskbar button on Windows — lives in the tray instead
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: settings.widgetOnTop,
      roundedCorners: true,
      hasShadow: true,
    });
  } else {
    Object.assign(opts, {
      titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
      trafficLightPosition: { x: 18, y: 20 },
      titleBarOverlay: isMac ? undefined : { color: '#5b3a22', symbolColor: '#fff3dc', height: 56 },
    });
  }

  win = new BrowserWindow(opts);
  if (widget && isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  if (!widget && !saved) win.center();

  updateDock();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (show) {
      win.show();
      if (widget) win.focus();
    }
  });

  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  let t;
  const remember = () => { clearTimeout(t); t = setTimeout(rememberBounds, 300); };
  win.on('move', remember);
  win.on('resize', remember);

  win.on('close', (e) => {
    rememberBounds();
    if (!quitting && settings.closeToTray && tray) {
      e.preventDefault();
      win.hide();
      updateDock();
    }
  });
  const self = win;
  win.on('closed', () => { if (win === self) win = null; });
  win.on('show', () => { updateDock(); refreshTray(); });
  win.on('hide', () => { updateDock(); refreshTray(); });
}

function switchMode(mode) {
  if (mode === currentMode && win) return showWin();
  settings.mode = mode;
  saveSettings();
  const old = win;
  if (old && !old.isDestroyed()) {
    rememberBounds();
    old.removeAllListeners('close');
    // close() (not destroy) so the page gets its unload event and saves any pending edits
    old.once('closed', () => { createWindow(mode); refreshTray(); });
    old.close();
  } else {
    createWindow(mode);
    refreshTray();
  }
}

function showWin() {
  if (!win) createWindow(settings.mode);
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

function toggleWin() {
  if (win && win.isVisible() && win.isFocused()) win.hide();
  else showWin();
}

function updateDock() {
  if (!isMac || !app.dock) return;
  // A widget feels like part of the desktop, so it stays out of the Dock.
  const visibleWindow = win && !win.isDestroyed() && win.isVisible() && currentMode === 'window';
  if (visibleWindow) app.dock.show();
  else app.dock.hide();
}

// ---------- tray / menu bar ----------
function trayImage() {
  if (isMac) {
    const img = nativeImage.createFromPath(asset('trayTemplate.png'));
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(asset('tray.png'));
}

function createTray() {
  if (tray) return;
  tray = new Tray(trayImage());
  tray.setToolTip('Corkly');
  tray.on('click', () => { if (!isMac) toggleWin(); });
  refreshTray();
}

function refreshTray() {
  if (!tray) return;
  const shown = win && !win.isDestroyed() && win.isVisible();
  const accel = settings.shortcut ? SHORTCUT : undefined;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: shown ? 'Hide Corkly' : 'Show Corkly', accelerator: accel, registerAccelerator: false, click: toggleWin },
    { type: 'separator' },
    { label: 'Desktop widget', type: 'radio', checked: currentMode === 'widget', click: () => switchMode('widget') },
    { label: 'Full window', type: 'radio', checked: currentMode === 'window', click: () => switchMode('window') },
    { label: 'Keep widget on top', type: 'checkbox', checked: settings.widgetOnTop, enabled: currentMode === 'widget',
      click: (m) => setSettings({ widgetOnTop: m.checked }) },
    { type: 'separator' },
    { label: 'Open when my computer starts', type: 'checkbox', checked: settings.openAtLogin,
      click: (m) => setSettings({ openAtLogin: m.checked }) },
    { label: `${config.tipButtonLabel || 'Buy me a coffee'} ☕`, click: openTip },
    { label: 'Settings…', click: () => { showWin(); win.webContents.send('ui:open-settings'); } },
    { type: 'separator' },
    { label: 'Quit Corkly', click: () => { quitting = true; app.quit(); } },
  ]));
}

function applyShortcut() {
  globalShortcut.unregisterAll();
  if (settings.shortcut) {
    try { globalShortcut.register(SHORTCUT, toggleWin); } catch {}
  }
}

function publicSettings() {
  return {
    openAtLogin: settings.openAtLogin,
    loginAsWidget: settings.loginAsWidget,
    mode: currentMode,
    widgetOnTop: settings.widgetOnTop,
    closeToTray: settings.closeToTray,
    shortcut: settings.shortcut,
    analytics: settings.analytics !== false,
    analyticsAvailable: !!aptabase,
    shortcutLabel: isMac ? '⌘ ⇧ Space' : 'Ctrl + Shift + Space',
    platform: process.platform,
    packaged: app.isPackaged,
  };
}

function setSettings(patch) {
  const prev = { ...settings };
  for (const k of ['openAtLogin', 'loginAsWidget', 'widgetOnTop', 'closeToTray', 'shortcut', 'analytics']) {
    if (k in patch) settings[k] = !!patch[k];
  }
  saveSettings();
  if (prev.openAtLogin !== settings.openAtLogin) applyLoginItem();
  if (prev.shortcut !== settings.shortcut) applyShortcut();
  if (prev.widgetOnTop !== settings.widgetOnTop && win && currentMode === 'widget') win.setAlwaysOnTop(settings.widgetOnTop);
  refreshTray();
  if (win && !win.isDestroyed()) win.webContents.send('settings:changed', publicSettings());
  if (patch.mode && patch.mode !== currentMode) setImmediate(() => switchMode(patch.mode));
  return publicSettings();
}

function buildMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        { label: 'Desktop Widget', click: () => switchMode('widget') },
        { label: 'Full Window', click: () => switchMode('window') },
      ],
    },
    { role: 'windowMenu' },
  ]));
}

// ---------- IPC ----------
ipcMain.handle('app:info', () => ({
  imagesBase: pathToFileURL(imagesDir()).href + '/',
  version: app.getVersion(),
  firstLaunch,
  firebase: firebaseConfig,
  tip: { label: config.tipButtonLabel, nudge: config.nudge, enabled: /^https:\/\//i.test(config.tipUrl) },
  mode: currentMode,
}));
ipcMain.handle('data:load', () => {
  try { return fs.readFileSync(dataFile(), 'utf8'); } catch { return null; }
});
ipcMain.handle('data:save', (_e, json) => { writeAtomic(dataFile(), json); return true; });
ipcMain.on('data:save-sync', (e, json) => {
  try { writeAtomic(dataFile(), json); } catch {}
  e.returnValue = true;
});
ipcMain.handle('image:pick', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Pin a photo',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: [...IMAGE_EXT].map((e) => e.slice(1)) }],
  });
  if (res.canceled) return [];
  return res.filePaths.map(importImageFile).filter(Boolean);
});
ipcMain.handle('image:import', (_e, filePath) => (filePath ? importImageFile(filePath) : null));
ipcMain.handle('image:buffer', (_e, buf, ext) => {
  const safeExt = IMAGE_EXT.has('.' + ext) ? '.' + ext : '.png';
  const file = crypto.randomUUID() + safeExt;
  fs.writeFileSync(path.join(imagesDir(), file), Buffer.from(buf));
  return imageInfo(file);
});
ipcMain.handle('tip:open', () => openTip());
ipcMain.on('analytics:track', (_e, name, props) => {
  if (!TRACKABLE.has(name)) return;
  const clean = {};
  for (const [k, v] of Object.entries(props || {})) if (typeof v === 'number' || (typeof v === 'string' && v.length < 40)) clean[k] = v;
  track(name, clean);
});
ipcMain.handle('image:read', (_e, file) => {
  if (!/^[\w-]+\.[a-z0-9]+$/i.test(String(file))) return null;
  try {
    const p = path.join(imagesDir(), file);
    const ext = path.extname(p).slice(1).toLowerCase().replace('jpg', 'jpeg');
    return { bytes: fs.readFileSync(p), type: 'image/' + ext };
  } catch { return null; }
});
ipcMain.handle('window:show', () => showWin());
ipcMain.handle('cloud:pending-join', () => { const c = pendingJoin; pendingJoin = null; return c; });
ipcMain.handle('update:check', async () => {
  if (!updater) return { state: 'dev', version: app.getVersion() };
  sendUpdate({ state: 'checking' });
  try { await updater.checkForUpdates(); } catch (e) { sendUpdate({ state: 'error', message: String(e.message || e) }); }
  return updateState;
});
ipcMain.handle('update:install', () => {
  if (updateState.state === 'ready' && canSelfUpdate()) {
    quitting = true;
    setImmediate(() => updater.quitAndInstall());
  } else if (/^https:\/\//i.test(config.releasesUrl || '')) {
    shell.openExternal(config.releasesUrl);
  }
});
ipcMain.handle('link:open', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
});
ipcMain.handle('board:export', async (_e, name) => {
  const image = await win.webContents.capturePage();
  const safe = String(name || 'board').replace(/[^\w\- ]+/g, '').trim() || 'board';
  const res = await dialog.showSaveDialog(win, {
    title: 'Save board as image',
    defaultPath: path.join(app.getPath('pictures'), `${safe}.png`),
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  });
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, image.toPNG());
  return res.filePath;
});
ipcMain.handle('settings:get', () => publicSettings());
ipcMain.handle('settings:set', (_e, patch) => setSettings(patch || {}));
ipcMain.handle('window:mode', (_e, mode) => { if (mode === 'widget' || mode === 'window') switchMode(mode); });
ipcMain.handle('window:clean', (_e, clean) => {
  if (!win || win.isDestroyed() || currentMode !== 'window') return;
  // In "just the board" mode, tuck away the native window buttons too.
  try {
    if (isMac) win.setWindowButtonVisibility(!clean);
    else win.setTitleBarOverlay(clean
      ? { color: '#00000000', symbolColor: '#3b2a1d', height: 30 }
      : { color: '#5b3a22', symbolColor: '#fff3dc', height: 56 });
  } catch {}
});
ipcMain.handle('window:hide', () => { if (tray) win?.hide(); else win?.minimize(); });

// ---------- lifecycle ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const code = joinFrom((argv || []).join(' '));
    if (code) deliverJoin(code); else showWin();
  });
  if (process.defaultApp) {
    if (process.argv.length >= 2) app.setAsDefaultProtocolClient('corkly', process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('corkly');
  }
  pendingJoin = joinFrom(process.argv.join(' '));

  app.whenReady().then(() => {
    loadSettings();
    if (!settings.launchedBefore) {
      // Very first open: start as the small widget with all the controls showing.
      firstLaunch = true;
      settings.launchedBefore = true;
      settings.mode = 'widget';
      saveSettings();
    }
    applyLoginItem();
    buildMenu();
    createTray();
    applyShortcut();

    const atLogin = launchedAtLogin();
    const mode = atLogin && settings.loginAsWidget ? 'widget' : settings.mode;
    createWindow(mode);
    refreshTray();
    setupUpdates();
    if (firstLaunch) track('install', { mode });
    track('app_started', { mode, atLogin: atLogin ? 1 : 0 });
    pingActive();
    setInterval(pingActive, 60 * 60 * 1000); // Corkly often stays open for days

    app.on('activate', showWin);
  });

  app.on('before-quit', () => { quitting = true; rememberBounds(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => {
    // Mode switches close one window before opening the next, so only quit when nothing is reopening.
    setTimeout(() => {
      if (!BrowserWindow.getAllWindows().length && (!tray || !settings.closeToTray)) app.quit();
    }, 300);
  });
}
