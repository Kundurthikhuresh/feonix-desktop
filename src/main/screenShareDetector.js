const { exec } = require('child_process');
const { getOverlayWindow, bringToFront } = require('./window');

/**
 * Screen Share Stealth & Detection Engine for FeonixAI.
 * Monitors and enforces anti-capture stealth protection across 11 major platforms:
 * 1. WhatsApp — screen sharing
 * 2. Discord — screen/application sharing
 * 3. Cisco Webex — screen/application sharing
 * 4. Jitsi Meet — screen/window/tab sharing
 * 5. Slack Huddles — screen/window sharing
 * 6. Loom — screen/window/tab sharing
 * 7. GoTo Meeting — screen/application sharing
 * 8. Whereby — screen/window/tab sharing
 * 9. Google Meet — screen/window/tab sharing
 * 10. Zoom — screen/application sharing
 * 11. Microsoft Teams — screen/application sharing
 */

const SUPPORTED_PLATFORMS = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    processNames: ['whatsapp.exe'],
    browserKeywords: ['web.whatsapp.com', 'whatsapp'],
    type: 'screen',
    label: 'WhatsApp — screen sharing',
  },
  {
    id: 'discord',
    name: 'Discord',
    processNames: ['discord.exe', 'discordcanary.exe', 'discordptb.exe', 'discorddevelopment.exe'],
    browserKeywords: ['discord.com/channels', 'discord.com'],
    type: 'screen/application',
    label: 'Discord — screen/application sharing',
  },
  {
    id: 'webex',
    name: 'Cisco Webex',
    processNames: ['ciscocollabhost.exe', 'webex.exe', 'webexhost.exe', 'atmgr.exe', 'ptoneclk.exe'],
    browserKeywords: ['webex.com', 'ciscowebex.com'],
    type: 'screen/application',
    label: 'Cisco Webex — screen/application sharing',
  },
  {
    id: 'jitsi',
    name: 'Jitsi Meet',
    processNames: ['jitsi-meet.exe'],
    browserKeywords: ['meet.jit.si', '8x8.vc', 'jitsi'],
    type: 'screen/window/tab',
    label: 'Jitsi Meet — screen/window/tab sharing',
  },
  {
    id: 'slackhuddles',
    name: 'Slack Huddles',
    processNames: ['slack.exe'],
    browserKeywords: ['app.slack.com', 'slack.com'],
    type: 'screen/window',
    label: 'Slack Huddles — screen/window sharing',
  },
  {
    id: 'loom',
    name: 'Loom',
    processNames: ['loom.exe'],
    browserKeywords: ['loom.com/share', 'loom.com'],
    type: 'screen/window/tab',
    label: 'Loom — screen/window/tab sharing',
  },
  {
    id: 'gotomeeting',
    name: 'GoTo Meeting',
    processNames: ['g2mcomm.exe', 'gotomeeting.exe', 'g2mlauncher.exe'],
    browserKeywords: ['gotomeeting.com', 'goto.com'],
    type: 'screen/application',
    label: 'GoTo Meeting — screen/application sharing',
  },
  {
    id: 'whereby',
    name: 'Whereby',
    processNames: ['whereby.exe'],
    browserKeywords: ['whereby.com'],
    type: 'screen/window/tab',
    label: 'Whereby — screen/window/tab sharing',
  },
  {
    id: 'meet',
    name: 'Google Meet',
    processNames: [],
    browserKeywords: ['meet.google.com'],
    type: 'screen/window/tab',
    label: 'Google Meet — screen/window/tab sharing',
  },
  {
    id: 'zoom',
    name: 'Zoom',
    processNames: ['zoom.exe', 'cpthost.exe', 'airhost.exe'],
    browserKeywords: ['zoom.us/j', 'zoom.us'],
    type: 'screen/application',
    label: 'Zoom — screen/application sharing',
  },
  {
    id: 'teams',
    name: 'Microsoft Teams',
    processNames: ['teams.exe', 'ms-teams.exe'],
    browserKeywords: ['teams.microsoft.com', 'teams.live.com'],
    type: 'screen/application',
    label: 'Microsoft Teams — screen/application sharing',
  },
];

class ScreenShareDetector {
  constructor(settingsStore, logger) {
    this.settingsStore = settingsStore;
    this.logger = logger;
    this.checkInterval = null;
    this.activeDetections = new Map();
    this.wasHiddenByAutoStealth = false;
    this.previousVisibility = 'open';
  }

  getSupportedPlatforms() {
    return SUPPORTED_PLATFORMS;
  }

  startMonitoring(intervalMs = 3500) {
    if (this.checkInterval) return;
    this.checkInterval = setInterval(() => this.scanActiveProcesses(), intervalMs);
    // Initial scan after short boot delay
    setTimeout(() => this.scanActiveProcesses(), 1500);
  }

  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  scanActiveProcesses() {
    if (process.platform !== 'win32') return;

    // Fast Windows tasklist query for target executables
    exec('tasklist /FO CSV /NH', { windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return;

      const runningProcesses = stdout.toLowerCase();
      const detectedPlatforms = [];

      for (const platform of SUPPORTED_PLATFORMS) {
        const isRunning = platform.processNames.some((proc) => runningProcesses.includes(proc.toLowerCase()));
        if (isRunning) {
          detectedPlatforms.push(platform);
        }
      }

      this.handleDetectionResults(detectedPlatforms);
    });
  }

  handleDetectionResults(detectedPlatforms) {
    const isCurrentlyActive = detectedPlatforms.length > 0;
    const previousActive = this.activeDetections.size > 0;

    const overlay = getOverlayWindow();
    if (!overlay || overlay.isDestroyed()) return;

    // Enforce anti-capture content protection strictly whenever stealth mode is on
    const stealthEnabled = this.settingsStore ? (this.settingsStore.get('stealthMode') !== false) : true;
    if (stealthEnabled) {
      try {
        overlay.setContentProtection(true);
      } catch (err) {
        // Non-fatal
      }
    }

    if (isCurrentlyActive && !previousActive) {
      // Screen-share platform became active
      detectedPlatforms.forEach((p) => this.activeDetections.set(p.id, p));
      const platformNames = detectedPlatforms.map((p) => p.name).join(', ');
      if (this.logger) {
        this.logger.info(`🛡️ Screen-sharing platform detected active: ${platformNames}`);
      }

      const autoHide = this.settingsStore ? Boolean(this.settingsStore.get('autoHideOnShare')) : false;

      overlay.webContents.send('feonix:screen-share-detected', {
        active: true,
        platforms: detectedPlatforms,
        autoHide,
      });

      try {
        overlay.setContentProtection(true);
      } catch {
        // Non-fatal
      }
    } else if (!isCurrentlyActive && previousActive) {
      // All detected screen-sharing platforms closed / ended
      this.activeDetections.clear();
      if (this.logger) {
        this.logger.info('🛡️ Screen-sharing session ended / inactive.');
      }

      overlay.webContents.send('feonix:screen-share-detected', {
        active: false,
        platforms: [],
      });
    }
  }

  getActivePlatforms() {
    return Array.from(this.activeDetections.values());
  }
}

let instance = null;

function initScreenShareDetector(settingsStore, logger) {
  if (!instance) {
    instance = new ScreenShareDetector(settingsStore, logger);
    instance.startMonitoring();
  }
  return instance;
}

function getScreenShareDetector() {
  return instance;
}

module.exports = {
  SUPPORTED_PLATFORMS,
  initScreenShareDetector,
  getScreenShareDetector,
};
