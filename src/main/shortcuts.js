const { globalShortcut } = require('electron');
const { getOverlayWindow } = require('./window');

// Tracks what's actually registered (not just what settings say) so
// unregisterAll only ever touches accelerators this module itself owns, and
// so re-registering after a settings change cleanly replaces the old ones
// instead of ever double-registering the same combo.
let registeredToggle = null;
let registeredHide = null;

function sendToOverlay(channel) {
  const win = getOverlayWindow();
  if (win && !win.isDestroyed()) win.webContents.send(channel);
}

function unregisterShortcuts() {
  if (registeredToggle) { globalShortcut.unregister(registeredToggle); registeredToggle = null; }
  if (registeredHide) { globalShortcut.unregister(registeredHide); registeredHide = null; }
}

/**
 * (Re)registers the two global accelerators from the settings store. Global
 * because minimized/hidden explicitly mean the overlay window may not have
 * OS focus — a renderer-level keydown listener (used for the rest of the
 * HUD's shortcuts, which only make sense while it's focused) can't catch a
 * key press while some other app is focused, which is the whole point of
 * "restore the assistant from anywhere."
 */
function registerShortcuts(settingsStore) {
  unregisterShortcuts();

  const toggle = settingsStore.get('shortcutToggle');
  const hide = settingsStore.get('shortcutHide');

  try {
    if (globalShortcut.register(toggle, () => sendToOverlay('feonix:shortcut-toggle'))) {
      registeredToggle = toggle;
    }
  } catch { /* malformed accelerator or already claimed by the OS — leave unregistered */ }

  try {
    if (globalShortcut.register(hide, () => sendToOverlay('feonix:shortcut-hide'))) {
      registeredHide = hide;
    }
  } catch { /* same */ }
}

module.exports = { registerShortcuts, unregisterShortcuts };
