// Main-process logging with redaction baked in — not toggled by Privacy
// Mode, because a log line already written to disk can't be un-leaked.
// Every entry is redacted before it ever touches the filesystem.
const fs = require('fs');
const path = require('path');

// Patterns for the credential shapes actually in play in this app's stack:
// OpenAI keys, JWT-style tokens, generic bearer tokens, and connection
// strings with embedded user:pass (MongoDB URIs).
const REDACT_PATTERNS = [
  [/sk-[A-Za-z0-9_-]{10,}/g, (m) => maskTail(m)],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, () => '[redacted-jwt]'],
  [/\bBearer\s+[A-Za-z0-9._-]{10,}/gi, () => 'Bearer [redacted]'],
  [/(mongodb(?:\+srv)?:\/\/)([^:]+):([^@]+)@/gi, (_m, scheme) => `${scheme}[redacted]:[redacted]@`],
  [/("?(?:password|passwd|token|secret|api[_-]?key|client[_-]?secret)"?\s*[:=]\s*)"?[^",\s}]{4,}"?/gi, (_m, label) => `${label}"[redacted]"`],
];

function maskTail(value) {
  const tail = value.slice(-4);
  return `${value.slice(0, 3)}${'*'.repeat(Math.max(0, value.length - 7))}${tail}`;
}

function redact(text) {
  let out = String(text);
  for (const [pattern, replacer] of REDACT_PATTERNS) {
    out = out.replace(pattern, replacer);
  }
  return out;
}

function stringifyArgs(args) {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

class Logger {
  constructor(logDir) {
    this.logDir = logDir;
    this.logFile = path.join(logDir, 'app.log');
    try {
      fs.mkdirSync(logDir, { recursive: true });
    } catch { /* best-effort */ }
  }

  write(level, ...args) {
    const line = `[${new Date().toISOString()}] [${level}] ${redact(stringifyArgs(args))}\n`;
    try {
      fs.appendFileSync(this.logFile, line);
    } catch { /* disk full / permissions — logging must never crash the app */ }
    if (level === 'ERROR') process.stderr.write(line);
  }

  info(...args) { this.write('INFO', ...args); }
  warn(...args) { this.write('WARN', ...args); }
  error(...args) { this.write('ERROR', ...args); }

  clear() {
    try {
      fs.writeFileSync(this.logFile, '');
      return true;
    } catch {
      return false;
    }
  }

  size() {
    try {
      return fs.statSync(this.logFile).size;
    } catch {
      return 0;
    }
  }
}

module.exports = { Logger, redact };
