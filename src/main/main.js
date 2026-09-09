const { app, BrowserWindow } = require('electron');
const path = require('path');
const { Logger } = require('../logger');
const { SettingsStore } = require('./settingsStore');
const { createMainWindow, getMainWindow, bringToFront, getOverlayWindow, WEB_URL } = require('./window');
const { registerIpcHandlers, applyLaunchAtStartup } = require('./ipc');
const { createTray, destroyTray } = require('./tray');
const { registerShortcuts, unregisterShortcuts } = require('./shortcuts');
const { initScreenShareDetector } = require('./screenShareDetector');

const SCHEME = process.env.DESKTOP_SCHEME || 'feonixai';

// app.getName() defaults to package.json's "name" field ("feonixai-desktop",
// needed for npm/electron-builder identity), not the "FeonixAI" the build
// config's productName brands the installer/shortcuts with. Left unset, a
// packaged install and a plain `electron .` dev run both resolved
// app.getPath('userData') to the SAME %APPDATA%\feonixai-desktop — sharing
// settings, cookies, and localStorage between two supposedly separate app
// instances, including every drag position and visibility state a dev-mode
// test run ever set. The dev suffix keeps that separation going forward,
// not just the name correction: it needs to be set before anything below
// reads getPath('userData').
app.setName(app.isPackaged ? 'FeonixAI' : 'FeonixAI-dev');

const logger = new Logger(path.join(app.getPath('userData'), 'logs'));
const settingsStore = new SettingsStore(app.getPath('userData'));

// A crash in the main process otherwise dies silently on Windows — no dialog,
// no console (there isn't one, in a packaged app). Routing it through the
// redacting logger at least leaves a record in the log file this app's own
// "Clear Logs" button can show/clear.
process.on('uncaughtException', (err) => logger.error('Uncaught exception:', err.stack || err.message));
process.on('unhandledRejection', (err) => logger.error('Unhandled rejection:', (err && err.stack) || err));

let pendingHandoff = null;

function parseDeepLink(url) {
  try {
    const cleanUrl = String(url).trim().replace(/^["']|["']$/g, '');
    const parsed = new URL(cleanUrl);
    if (parsed.protocol.toLowerCase() !== `${SCHEME.toLowerCase()}:`) return null;
    const token = parsed.searchParams.get('token');
    const sessionParam = parsed.searchParams.get('session');
    if (!token) return null;
    return { token, session: sessionParam };
  } catch {
    return null;
  }
}

function deliverHandoff(handoff) {
  if (!handoff) return;
  pendingHandoff = handoff;

  const sessionQuery = handoff.session ? `&session=${encodeURIComponent(handoff.session)}` : '';
  const tokenQuery = handoff.token ? `token=${encodeURIComponent(handoff.token)}` : '';
  const query = tokenQuery ? `?${tokenQuery}${sessionQuery}` : (sessionQuery ? `?${sessionQuery.slice(1)}` : '');
  const routePath = `/session-type${query}`;

  logger.info('deliverHandoff routing to:', routePath);

  const overlayWindow = getOverlayWindow();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  }

  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(`${WEB_URL}${routePath}`);
    bringToFront(mainWindow);
    mainWindow.webContents.send('feonix:handoff', handoff);
  } else {
    createMainWindow(routePath);
  }
}

// --- Deep link registration ---------------------------------------------

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(SCHEME);
}

// macOS: fired when a feonixai:// link is opened, including cold start. This
// is registered unconditionally, outside the single-instance-lock branch
// below — on macOS the OS delivers this Apple Event to whichever process is
// already running rather than spawning a new one, so it isn't gated on
// holding the lock the way second-instance below is.
app.on('open-url', (event, url) => {
  event.preventDefault();
  const handoff = parseDeepLink(url);
  if (handoff) deliverHandoff(handoff);
});

// Windows/Linux: a second launch (from clicking the link again) is forwarded
// here instead of starting a new process, since we hold the single-instance lock.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const prefix = `${SCHEME.toLowerCase()}:`;
    const link = argv.find((arg) => typeof arg === 'string' && arg.toLowerCase().startsWith(prefix));
    const handoff = link ? parseDeepLink(link) : null;
    if (handoff) {
      deliverHandoff(handoff);
    } else {
      bringToFront(getMainWindow());
    }
  });

  app.whenReady().then(() => {
    registerIpcHandlers({
      logger,
      settingsStore,
      getPendingHandoff: () => pendingHandoff,
      clearPendingHandoff: () => { pendingHandoff = null; },
    });
    logger.info('IPC handlers registered.');

    applyLaunchAtStartup(settingsStore.get('launchAtStartup'));
    if (settingsStore.get('showTrayIcon')) createTray({ onOpenSettings: () => {} });
    registerShortcuts(settingsStore);
    initScreenShareDetector(settingsStore, logger);

    // Windows/Linux cold start via protocol link: the URL arrives as an argv entry.
    const prefix = `${SCHEME.toLowerCase()}:`;
    const coldLink = process.argv.find((arg) => typeof arg === 'string' && arg.toLowerCase().startsWith(prefix));
    const coldHandoff = coldLink ? parseDeepLink(coldLink) : null;

    if (coldHandoff) {
      deliverHandoff(coldHandoff);
    } else {
      createMainWindow('/session-type');
    }
  });
}

// With the tray enabled, the app is meant to keep running in the background
// (the whole point of item 3 — "continue running... when minimized") rather
// than exiting just because every window happened to close. Without a tray
// there's no way left to get a window back, so the old quit-on-Windows
// behavior stands.
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  if (!settingsStore.get('showTrayIcon')) app.quit();
});

app.on('will-quit', () => {
  unregisterShortcuts();
  destroyTray();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow('/session-type');
});
