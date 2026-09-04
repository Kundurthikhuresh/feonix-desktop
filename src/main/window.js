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
function bringToFront(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.setAlwaysOnTop(true);
  win.focus();
  win.setAlwaysOnTop(false);
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
    width: 1000,
    height: 720,
    minWidth: 760,
    minHeight: 560,
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
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.loadURL(`${WEB_URL}${routePath}`);
    bringToFront(overlayWindow);
    return overlayWindow;
  }

  const alwaysOnTop = settingsStore ? Boolean(settingsStore.get('alwaysOnTop')) : true;

  overlayWindow = new BrowserWindow({
    width: 640,
    height: 360,
    minWidth: 360,
    minHeight: 200,
    frame: false,
    transparent: true,
    alwaysOnTop,
    resizable: true,
    skipTaskbar: true,
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
  if (alwaysOnTop) overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  // No setContentProtection here, deliberately: this overlay must be visible
  // to whatever the user shares — see the removed 'feonix:set-private'
  // handler (and the Privacy & Security status in ipc.js) for why hiding it
  // from screen capture was taken out, and stays out.
  overlayWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error('overlay failed to load:', errorCode, errorDescription, validatedURL);
  });
  overlayWindow.loadURL(`${WEB_URL}${routePath}`);
  bringToFront(overlayWindow);

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
