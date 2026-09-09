const { Tray, Menu, nativeImage, app } = require('electron');
const { getOverlayWindow } = require('./window');

let trayInstance = null;
let listening = false;

/**
 * A small filled circle in the brand's accent color, built as a raw RGBA
 * bitmap rather than shipped as a file — there is no icon asset anywhere in
 * this repo yet, and nativeImage.createFromBuffer() accepts a raw bitmap
 * directly (no PNG encoding needed) when width/height are given.
 */
function buildTrayIcon(size = 32) {
  const buffer = Buffer.alloc(size * size * 4); // RGBA
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 1;
  const [cr, cg, cb] = [0, 217, 255]; // brand cyan accent

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const inside = dx * dx + dy * dy <= r * r;
      const idx = (y * size + x) * 4;
      buffer[idx] = inside ? cr : 0;
      buffer[idx + 1] = inside ? cg : 0;
      buffer[idx + 2] = inside ? cb : 0;
      buffer[idx + 3] = inside ? 255 : 0;
    }
  }
  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

function sendToOverlay(channel) {
  const win = getOverlayWindow();
  if (win && !win.isDestroyed()) win.webContents.send(channel);
}

function buildMenu({ onOpenSettings }) {
  const win = getOverlayWindow();
  const hasWindow = Boolean(win && !win.isDestroyed());

  return Menu.buildFromTemplate([
    {
      label: 'Show Assistant',
      enabled: hasWindow,
      click: () => {
        if (win && !win.isDestroyed()) {
          if (win.isMinimized()) win.restore();
          win.show();
          try {
            const { bringToFront } = require('./window');
            bringToFront(win);
          } catch {}
        }
        sendToOverlay('feonix:tray-show');
      },
    },
    {
      label: 'Minimize Assistant',
      enabled: hasWindow,
      click: () => sendToOverlay('feonix:tray-minimize'),
    },
    { type: 'separator' },
    {
      label: listening ? 'Stop Listening' : 'Start Listening',
      enabled: hasWindow,
      click: () => sendToOverlay('feonix:tray-toggle-listening'),
    },
    { type: 'separator' },
    {
      label: 'Settings',
      enabled: hasWindow,
      click: () => {
        sendToOverlay('feonix:tray-open-settings');
        if (onOpenSettings) onOpenSettings();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Feonix AI',
      click: () => app.quit(),
    },
  ]);
}

/**
 * The context menu is rebuilt right before it's actually shown (on
 * right-click, and once up front for the left-click default), rather than
 * kept in sync via cross-module events — this way "Show Assistant" being
 * greyed out when no session is running, or the Listening label, are always
 * correct at the moment the user actually looks at them, with no risk of a
 * stale menu from a missed update somewhere else.
 */
function createTray(opts = {}) {
  if (trayInstance) return trayInstance;

  trayInstance = new Tray(buildTrayIcon());
  trayInstance.setToolTip('Feonix AI');
  trayInstance.setContextMenu(buildMenu(opts));

  trayInstance.on('click', () => {
    trayInstance.setContextMenu(buildMenu(opts));
    sendToOverlay('feonix:tray-show');
  });
  trayInstance.on('right-click', () => {
    trayInstance.setContextMenu(buildMenu(opts));
    trayInstance.popUpContextMenu();
  });

  return trayInstance;
}

function setListeningState(value) {
  listening = Boolean(value);
}

function destroyTray() {
  if (trayInstance) {
    trayInstance.destroy();
    trayInstance = null;
  }
}

module.exports = { createTray, destroyTray, setListeningState };
