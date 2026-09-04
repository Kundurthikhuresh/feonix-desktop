// Persistent assistant settings — a plain JSON file under userData, same
// synchronous-fs pattern as ../logger.js. Small enough that pulling in a
// dependency (electron-store) for it isn't worth the added surface.
const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  shortcutToggle: 'CommandOrControl+Shift+Space',
  shortcutHide: 'CommandOrControl+Shift+H',
  startMinimized: false,
  alwaysOnTop: true,
  launchAtStartup: false,
  showTrayIcon: true,
  opacity: 92,
  assistantSize: 'normal',
  rememberPosition: true,
  voiceEnabled: true,
};

const ASSISTANT_SIZES = ['compact', 'normal', 'large'];

// A handful of safe presets rather than free-form key capture — the
// renderer only ever offers these, and the main process re-validates
// against the same list before ever calling globalShortcut.register, so a
// compromised renderer can't smuggle in an accelerator string that isn't
// actually one of these.
const SHORTCUT_PRESETS = [
  'CommandOrControl+Shift+Space',
  'CommandOrControl+Shift+A',
  'CommandOrControl+Shift+F',
  'CommandOrControl+Alt+Space',
];
const HIDE_SHORTCUT_PRESETS = [
  'CommandOrControl+Shift+H',
  'CommandOrControl+Shift+X',
  'CommandOrControl+Alt+H',
];

// Keys a renderer is allowed to touch at all. Settings feed OS-level APIs
// (globalShortcut accelerators, login items) — accepting arbitrary keys or
// values from feonix:set-setting would let a compromised page smuggle
// something into that path, so every value is re-derived here rather than
// trusted as given.
const ALLOWED_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));

function clampOpacity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.opacity;
  return Math.max(30, Math.min(100, Math.round(n)));
}

function sanitize(key, value) {
  switch (key) {
    case 'shortcutToggle':
      return SHORTCUT_PRESETS.includes(value) ? value : DEFAULT_SETTINGS.shortcutToggle;
    case 'shortcutHide':
      return HIDE_SHORTCUT_PRESETS.includes(value) ? value : DEFAULT_SETTINGS.shortcutHide;
    case 'opacity':
      return clampOpacity(value);
    case 'assistantSize':
      return ASSISTANT_SIZES.includes(value) ? value : DEFAULT_SETTINGS.assistantSize;
    case 'startMinimized':
    case 'alwaysOnTop':
    case 'launchAtStartup':
    case 'showTrayIcon':
    case 'rememberPosition':
    case 'voiceEnabled':
      return Boolean(value);
    default:
      return value;
  }
}

class SettingsStore {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'settings.json');
    this.data = { ...DEFAULT_SETTINGS, ...this._readFromDisk() };
  }

  _readFromDisk() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const clean = {};
      for (const key of ALLOWED_KEYS) {
        if (key in parsed) clean[key] = sanitize(key, parsed[key]);
      }
      return clean;
    } catch {
      return {};
    }
  }

  _writeToDisk() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch { /* disk full / permissions — settings just won't persist this run */ }
  }

  getAll() {
    return { ...this.data };
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    if (!ALLOWED_KEYS.has(key)) return this.getAll();
    this.data[key] = sanitize(key, value);
    this._writeToDisk();
    return this.getAll();
  }
}

module.exports = { SettingsStore, DEFAULT_SETTINGS, SHORTCUT_PRESETS, HIDE_SHORTCUT_PRESETS };
