const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const { DEV_TOOLS_ALLOWED, WEB_URL, getMainWindow, getOverlayWindow, createOverlayWindow, createMainWindow } = require('./window');
const { createTray, destroyTray, setListeningState } = require('./tray');
const { registerShortcuts } = require('./shortcuts');

/** Applies (or re-applies) launch-at-startup to the OS. Exported so main.js
 * can call it once at boot with whatever was persisted from a previous run,
 * not just when the setting is actively changed from the panel. */
function applyLaunchAtStartup(enabled) {
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
  } catch { /* not supported on this platform/build — non-fatal */ }
}

// Deliberately generous but still bounded — this stops a compromised
// renderer from e.g. resizing the window to 1x1 (hiding a real dialog) or to
// something absurd, without constraining any size the app actually uses.
const MIN_WINDOW_DIM = 100;
const MAX_WINDOW_DIM = 4000;

const KNOWN_PLANS = new Set(['full', 'free']);

/**
 * All ipcMain handlers, in one place so the renderer-facing surface (see
 * preload.js for what's actually exposed to the page) is easy to audit as a
 * whole rather than scattered across window/lifecycle code.
 */
function registerIpcHandlers({ logger, settingsStore, getPendingHandoff, clearPendingHandoff }) {
  ipcMain.on('feonix:back', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const overlayWindow = getOverlayWindow();
    const mainWindow = getMainWindow();
    if (win === overlayWindow) {
      overlayWindow.close();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    } else if (win) {
      win.close();
    }
  });

  ipcMain.on('feonix:quit', () => {
    const overlayWindow = getOverlayWindow();
    const mainWindow = getMainWindow();
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    app.quit();
  });

  ipcMain.on('feonix:dashboard', () => {
    try {
      shell.openExternal(`${WEB_URL}/?view=dash`);
    } catch (e) { /* best-effort */ }

    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(`${WEB_URL}/?view=dash`);
      mainWindow.show();
      mainWindow.focus();
    } else {
      createMainWindow('/?view=dash');
    }

    const overlayWindow = getOverlayWindow();
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
  });

  ipcMain.on('feonix:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.minimize();
  });

  ipcMain.on('feonix:resize', (event, width, height) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !Number.isFinite(width) || !Number.isFinite(height)) return;
    const w = Math.round(Math.max(MIN_WINDOW_DIM, Math.min(MAX_WINDOW_DIM, width)));
    const h = Math.round(Math.max(MIN_WINDOW_DIM, Math.min(MAX_WINDOW_DIM, height)));
    win.setSize(w, h);
  });

  // The renderer's drag-to-move gesture (mousedown on the drag rail, track
  // mousemove, mouseup to release) only ever updated a CSS position on the
  // HUD's own content — that moves things around fine inside a browser tab,
  // but a frameless, tightly-content-sized BrowserWindow has essentially no
  // extra viewport to shift content *within*, so "drag it anywhere on the
  // screen" looked like it wasn't moving at all. The gesture tracking stays
  // in the renderer (it already knows down/move/up and click-vs-drag); this
  // just forwards the per-frame delta to actually relocate the OS window.
  ipcMain.on('feonix:move-by', (event, dx, dy) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const [x, y] = win.getPosition();
    win.setPosition(Math.round(x + dx), Math.round(y + dy));
  });

  ipcMain.handle('feonix:start-session', (_event, opts) => {
    try {
      const plan = KNOWN_PLANS.has(opts && opts.plan) ? opts.plan : 'full';
      // Session ids are numeric on the wire; a non-numeric value here would
      // only ever be an accident or an attempt to inject something into the
      // query string that gets forwarded, so it's dropped rather than passed
      // through.
      const sessionIdRaw = opts && opts.sessionId;
      const sessionId = sessionIdRaw != null && /^\d+$/.test(String(sessionIdRaw)) ? String(sessionIdRaw) : '';
      const auto = Boolean(opts && opts.auto);

      // When starting a session, always open the full HUD so the window is immediately visible!
      const startParam = (opts && opts.start) || 'open';
      const query = new URLSearchParams({
        plan, session: sessionId, auto: auto ? '1' : '0', start: startParam,
      }).toString();

      logger.info('feonix:start-session', { plan, sessionId, auto, start: startParam });
      const win = createOverlayWindow(`/overlay?${query}`, settingsStore);
      logger.info('overlay window created/reused', { id: win && win.id, destroyed: win && win.isDestroyed() });
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
      return true;
    } catch (err) {
      logger.error('feonix:start-session failed:', err.stack || err.message);
      throw err;
    }
  });

  // --- Assistant settings, listening state, tray -------------------------

  ipcMain.handle('feonix:get-settings', () => settingsStore.getAll());

  ipcMain.handle('feonix:set-setting', (_event, key, value) => {
    const updated = settingsStore.set(key, value);

    // Side effects that only the main process can carry out, applied right
    // when the setting actually changes rather than only at next launch.
    if (key === 'shortcutToggle' || key === 'shortcutHide') {
      registerShortcuts(settingsStore);
    } else if (key === 'launchAtStartup') {
      applyLaunchAtStartup(updated.launchAtStartup);
    } else if (key === 'showTrayIcon') {
      if (updated.showTrayIcon) createTray({ onOpenSettings: () => {} });
      else destroyTray();
    } else if (key === 'alwaysOnTop') {
      const win = getOverlayWindow();
      if (win && !win.isDestroyed()) {
        win.setAlwaysOnTop(Boolean(updated.alwaysOnTop), updated.alwaysOnTop ? 'screen-saver' : 'normal');
      }
    }

    return updated;
  });

  // Pushed from the renderer whenever speech.listening changes, regardless
  // of whether it was toggled from the panel or from the tray itself — the
  // tray's own "Start/Stop Listening" label needs to reflect reality no
  // matter where recording was actually turned on.
  ipcMain.on('feonix:set-listening-state', (_event, value) => {
    setListeningState(value);
  });

  ipcMain.handle('feonix:pending-handoff', () => {
    const handoff = getPendingHandoff();
    clearPendingHandoff();
    return handoff;
  });

  // --- Privacy & Security panel -------------------------------------------
  // Backs the Privacy & Security settings page in the web app. Nothing here
  // hides the app's content from anything — see hardenWindow() in window.js
  // and the removed 'feonix:set-private' handler (content protection) for
  // what that would have meant and why it isn't here.

  ipcMain.handle('feonix:get-security-status', () => ({
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    devToolsEnabled: DEV_TOOLS_ALLOWED,
    contentProtection: false,
    packaged: app.isPackaged,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    logFileBytes: logger.size(),
  }));

  ipcMain.handle('feonix:clear-logs', () => {
    const ok = logger.clear();
    logger.info('Application logs cleared by user.');
    return ok;
  });

  // Clears cookies/localStorage/cache Electron holds for the app's own
  // origin — the renderer clears its own localStorage/sessionStorage itself
  // (it has direct access to those); this covers what only the main process
  // can reach.
  ipcMain.handle('feonix:clear-session-data', async () => {
    try {
      await session.defaultSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'cachestorage', 'serviceworkers', 'indexdb'],
      });
      await session.defaultSession.clearCache();
      logger.info('Session data cleared by user.');
      return true;
    } catch (err) {
      logger.error('Failed to clear session data:', err.message);
      return false;
    }
  });
}

module.exports = { registerIpcHandlers, applyLaunchAtStartup };
