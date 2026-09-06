const { BrowserWindow, app, shell } = require('electron');
const path = require('path');

// Point this at your deployed web app before building a real release —
// defaults to the local dev server for testing against `npm run dev`.
const WEB_URL = (process.env.FEONIX_WEB_URL || 'http://localhost:3000').replace(/\/+$/, '');

// DevTools are a debugging feature, not something a shipped build should
// expose — they're a direct window into whatever the renderer is holding in
// memory. Available in dev (`npm start`) and disabled in every packaged build.
const DEV_TOOLS_ALLOWED = !app.isPackaged;

let mainWindow = null;
let overlayWindow = null;

// Same origin check the web app itself would enforce, applied at the shell
// level: a compromised or misbehaving page inside one of our windows should
// not be able to navigate itself (or spawn a new window) to an arbitrary
// origin. Deep-link handoffs and 'go to dashboard' already go through
// loadURL() from the main process, not renderer-initiated navigation, so
// this doesn't restrict anything the app actually does.
function isTrustedUrl(url) {
  try {
    return new URL(url).origin === new URL(WEB_URL).origin;
  } catch {
    return false;
  }
}

// Windows' foreground-lock: a window created/focused in response to a
// background event (a deep link, a second-instance IPC) usually doesn't
// actually get raised above whatever the user was just clicked into —
// win.focus() returns normally but the browser tab stays on top, which is
// exactly what made the desktop handoff look like it silently did nothing.
// Toggling always-on-top forces the OS to place it above everything else
// regardless of the foreground-lock, which is the standard workaround for
// this on Windows; turning it back off immediately afterward leaves the
// window in a normal (non-pinned) state once it's actually in front.
function bringToFront(win, keepAlwaysOnTop = false) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.setAlwaysOnTop(true);
  win.focus();
  if (!keepAlwaysOnTop) {
    win.setAlwaysOnTop(false);
  }
}

function hardenWindow(win) {
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedUrl(url)) return { action: 'allow' };
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  if (!DEV_TOOLS_ALLOWED) {
    win.webContents.on('devtools-opened', () => win.webContents.closeDevTools());
  }
}

function createMainWindow(routePath) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(`${WEB_URL}${routePath}`);
    bringToFront(mainWindow);
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 760,
    height: 600,
    minWidth: 640,
    minHeight: 480,
    frame: false,
    backgroundColor: '#0b0f14',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: DEV_TOOLS_ALLOWED,
    },
  });

  hardenWindow(mainWindow);
  mainWindow.loadURL(`${WEB_URL}${routePath}`);
  bringToFront(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function createOverlayWindow(routePath, settingsStore) {
  const alwaysOnTop = settingsStore ? Boolean(settingsStore.get('alwaysOnTop')) : true;

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.loadURL(`${WEB_URL}${routePath}`);
    bringToFront(overlayWindow, alwaysOnTop);
    return overlayWindow;
  }

  overlayWindow = new BrowserWindow({
    // 640 was narrower than the topbar's button row actually needs (Start
    // Recording + Answer + Screenshot + Chat on the left, drag/expand/
    // minimize/Hide/settings/End on the right) — it fit only by clipping
    // whichever button ran past the edge, End Interview most often, since
    // .pk-shell clips overflow rather than shrinking it.
    width: 960,
    height: 380,
    minWidth: 360,
    minHeight: 200,
    frame: false,
    transparent: true,
    alwaysOnTop,
    resizable: true,
    skipTaskbar: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: DEV_TOOLS_ALLOWED,
    },
  });

  hardenWindow(overlayWindow);
  if (alwaysOnTop) {
    if (process.platform === 'darwin') {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    } else {
      overlayWindow.setAlwaysOnTop(true);
    }
  }

  overlayWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error('overlay failed to load:', errorCode, errorDescription, validatedURL);
  });
  // bringToFront's win.focus() below fires immediately after loadURL(), i.e.
  // before the page (and its Ctrl+V paste listener) actually exists yet.
  // That's enough to visually raise the window, but keyboard focus doesn't
  // reliably stick to a still-loading page — most noticeable right after
  // using an external screenshot tool, whose own window can still hold OS
  // input focus until something explicitly re-claims it. Re-asserting focus
  // once the page has actually finished loading closes that gap; this
  // listener stays registered for the window's life, so it also re-fires on
  // every reused-window navigation below, not just this first creation.
  overlayWindow.webContents.on('did-finish-load', () => {
    // Re-read rather than close over `alwaysOnTop` — this listener stays
    // attached across reused-window navigations, where the setting may have
    // changed since this window was first created.
    const currentAlwaysOnTop = settingsStore ? Boolean(settingsStore.get('alwaysOnTop')) : alwaysOnTop;
    bringToFront(overlayWindow, currentAlwaysOnTop);
    overlayWindow.webContents.focus();
  });
  overlayWindow.loadURL(`${WEB_URL}${routePath}`);
  bringToFront(overlayWindow, alwaysOnTop);

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  return overlayWindow;
}

module.exports = {
  WEB_URL,
  DEV_TOOLS_ALLOWED,
  hardenWindow,
  isTrustedUrl,
  bringToFront,
  createMainWindow,
  createOverlayWindow,
  getMainWindow: () => mainWindow,
  getOverlayWindow: () => overlayWindow,
};
