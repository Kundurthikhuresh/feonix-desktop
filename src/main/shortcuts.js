const { globalShortcut } = require('electron');
const { getOverlayWindow, getMainWindow, bringToFront } = require('./window');

// Tracks what's actually registered (not just what settings say) so
// unregisterAll only ever touches accelerators this module itself owns, and
// so re-registering after a settings change cleanly replaces the old ones
// instead of ever double-registering the same combo.
const registered = {
  toggle: null,
  hide: null,
  screenshot: null,
  listenToggle: null,
  answer: null,
};

function sendToOverlay(channel) {
  const win = getOverlayWindow();
  if (win && !win.isDestroyed()) win.webContents.send(channel);
}

function handleShortcutHide(settingsStore) {
  const win = getOverlayWindow();
  if (win && !win.isDestroyed()) {
    if (win.isVisible() && !win.isMinimized()) {
      win.hide();
      win.webContents.send('feonix:shortcut-hide', { visible: false });
    } else {
      const alwaysOnTop = settingsStore ? Boolean(settingsStore.get('alwaysOnTop')) : true;
      if (win.isMinimized()) win.restore();
      win.show();
      bringToFront(win, alwaysOnTop);
      try {
        win.setContentProtection(true);
      } catch { /* best effort */ }
      win.webContents.send('feonix:shortcut-hide', { visible: true });
    }
  }
}

function handleShortcutToggle(settingsStore) {
  const win = getOverlayWindow();
  if (win && !win.isDestroyed()) {
    const alwaysOnTop = settingsStore ? Boolean(settingsStore.get('alwaysOnTop')) : true;
    if (win.isMinimized()) win.restore();
    win.show();
    bringToFront(win, alwaysOnTop);
    try {
      win.setContentProtection(true);
    } catch { /* best effort */ }
    win.webContents.send('feonix:shortcut-toggle');
    return;
  }
}

function unregisterShortcuts() {
  for (const key of Object.keys(registered)) {
    if (registered[key]) {
      globalShortcut.unregister(registered[key]);
      registered[key] = null;
    }
  }
}

/**
 * (Re)registers every global accelerator from the settings store. Global
 * because minimized/hidden explicitly mean the overlay window may not have
 * OS focus — a renderer-level keydown listener (used for the rest of the
 * HUD's shortcuts, which only make sense while it's focused) can't catch a
 * key press while some other app is focused, which is the whole point of
 * "restore the assistant from anywhere," and equally the point of being
 * able to snap a screenshot, toggle the mic, or ask for an answer while
 * some other window (the meeting call, the IDE) has focus instead.
 */
function registerShortcuts(settingsStore) {
  unregisterShortcuts();

  const bindings = [
    ['toggle', settingsStore.get('shortcutToggle'), 'feonix:shortcut-toggle'],
    ['hide', settingsStore.get('shortcutHide'), 'feonix:shortcut-hide'],
    ['screenshot', settingsStore.get('shortcutScreenshot'), 'feonix:shortcut-screenshot'],
    ['listenToggle', settingsStore.get('shortcutListenToggle'), 'feonix:shortcut-listen-toggle'],
    ['answer', settingsStore.get('shortcutAnswer'), 'feonix:shortcut-answer'],
  ];

  for (const [key, accelerator, channel] of bindings) {
    if (!accelerator) continue;
    try {
      const handler = (key === 'hide')
        ? () => handleShortcutHide(settingsStore)
        : (key === 'toggle')
          ? () => handleShortcutToggle(settingsStore)
          : () => sendToOverlay(channel);

      if (globalShortcut.register(accelerator, handler)) {
        registered[key] = accelerator;
      }
    } catch { /* malformed accelerator or already claimed by the OS — leave unregistered */ }
  }
}

module.exports = { registerShortcuts, unregisterShortcuts };
