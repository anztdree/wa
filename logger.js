// ============================================================
// LOGGER 2.0 — Hyper Active, Emoji-Stylish, Pipeline Tree
// ============================================================

const TTY = process.stdout.isTTY;
const C = {
  reset:   TTY ? '\x1b[0m'  : '',
  dim:     TTY ? '\x1b[2m'  : '',
  bright:  TTY ? '\x1b[1m'  : '',
  black:   TTY ? '\x1b[30m' : '',
  red:     TTY ? '\x1b[31m' : '',
  green:   TTY ? '\x1b[32m' : '',
  yellow:  TTY ? '\x1b[33m' : '',
  blue:    TTY ? '\x1b[34m' : '',
  magenta: TTY ? '\x1b[35m' : '',
  cyan:    TTY ? '\x1b[36m' : '',
  white:   TTY ? '\x1b[37m' : '',
  gray:    TTY ? '\x1b[90m' : '',
};

// ── Emoji Tags ──────────────────────────────────────────
// Each module gets a unique emoji + color combo
const TAGS = {
  SYS:      { emoji: '📡', color: C.blue    },
  DB:       { emoji: '🗄️ ', color: C.magenta },
  AI:       { emoji: '🧠', color: C.cyan    },
  OPENWA:   { emoji: '📱', color: C.green   },
  NET:      { emoji: '🌐', color: C.blue    },
  NEMOTRON: { emoji: '⚡', color: C.yellow  },
  MSG:      { emoji: '💬', color: C.cyan    },
  REPLY:    { emoji: '📤', color: C.green   },
  ERR:      { emoji: '❌', color: C.red     },
  WARN:     { emoji: '⚠️ ', color: C.yellow },
  OK:       { emoji: '✅', color: C.green   },
  INFO:     { emoji: 'ℹ️ ', color: C.blue    },
  SAVE:     { emoji: '💾', color: C.magenta },
  PARSE:    { emoji: '🔍', color: C.blue    },
  MATCH:    { emoji: '🎯', color: C.cyan    },
  BUILD:    { emoji: '🛠️ ', color: C.yellow },
  TYPING:   { emoji: '⌨️ ', color: C.blue   },
  SEND:     { emoji: '🚀', color: C.green  },
  DONE:     { emoji: '🏁', color: C.green  },
  LEARN:    { emoji: '📚', color: C.magenta },
  STYLE:    { emoji: '🎨', color: C.magenta },
  CONTEXT:  { emoji: '🧩', color: C.blue    },
  EXTRACT:  { emoji: '🔎', color: C.cyan    },
  TIMER:    { emoji: '⏱️ ', color: C.gray   },
  PULSE:    { emoji: '💓', color: C.red     },
  BOOT:     { emoji: '🚀', color: C.green  },
  SHUTDOWN: { emoji: '🛑', color: C.red    },
};

const timers = new Map();
let heartbeatInterval = null;

// ── Time ────────────────────────────────────────────────
function ts() {
  return new Date().toLocaleTimeString('id-ID', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

// ── Format Tag Line ─────────────────────────────────────
function fmtTag(type, label) {
  var tag = TAGS[type] || TAGS.SYS;
  var emoji = tag.emoji;
  var color = tag.color;
  var name = (label || type).padEnd(8, ' ');
  return C.dim + emoji + C.reset + ' ' + color + C.bright + name + C.reset;
}

function tagLine(type, message, label) {
  console.log(C.dim + ts() + ' ' + fmtTag(type, label) + ' ' + message + C.reset);
}

// ── Core Log ────────────────────────────────────────────
function log(type, message) {
  tagLine(type, message);
}

// ── Module Shortcuts ────────────────────────────────────
function sys(msg)      { log('SYS', msg); }
function db(msg)       { log('DB', msg); }
function ai(msg)       { log('AI', msg); }
function openwa(msg)   { log('OPENWA', msg); }
function net(msg)      { log('NET', msg); }
function nemotron(msg) { log('NEMOTRON', msg); }

// ── Message Flow ───────────────────────────────────────
function msgIn(sender, text, isGroup) {
  var preview = text.length > 55 ? text.slice(0, 55) + '...' : text;
  var prefix = isGroup ? C.yellow + '👥' + ' ' + C.reset : '';
  var line = C.dim + ts() + ' 💬 📥 ' + C.reset +
    prefix + C.bright + sender + C.reset +
    C.dim + ': ' + C.reset + C.white + preview + C.reset;
  console.log(line);
}

function msgOut(text, meta) {
  var preview = text.length > 55 ? text.slice(0, 55) + '...' : text;
  var metaStr = meta ? C.dim + '  ' + meta + C.reset : '';
  var line = C.dim + ts() + C.reset +
    ' 📤 ' + C.green + C.bright + preview + C.reset + metaStr;
  console.log(line);
}

// ── Status ──────────────────────────────────────────────
function ok(msg)   { log('OK', C.green + msg + C.reset); }
function warn(msg) { log('WARN', msg); }
function err(msg)  { log('ERR', C.red + msg + C.reset); }
function info(msg) { log('INFO', msg); }

// ── Pipeline Tree ────────────────────────────────────────
// For message processing flow visualization
var pipelineDepth = 0;

function pipeStart(message) {
  var indent = '  '.repeat(pipelineDepth);
  console.log(indent + C.dim + ts() + ' │' + C.reset);
  var line = indent + C.dim + ts() + C.reset + ' ├── 🔍 ' + C.bright + message + C.reset;
  console.log(line);
  pipelineDepth++;
}

function pipeStep(type, message) {
  var indent = '  '.repeat(pipelineDepth);
  var tag = TAGS[type] || TAGS.INFO;
  var line = indent + C.dim + ts() + ' │' + C.reset +
    ' ├── ' + tag.emoji + ' ' + tag.color + message + C.reset;
  console.log(line);
}

function pipeEnd(type, message) {
  var indent = '  '.repeat(pipelineDepth);
  var tag = TAGS[type] || TAGS.DONE;
  var line = indent + C.dim + ts() + ' │' + C.reset +
    ' └── ' + tag.emoji + ' ' + tag.color + C.bright + message + C.reset;
  console.log(line);
  if (pipelineDepth > 0) pipelineDepth--;
}

function pipeDone(message) {
  var indent = '  '.repeat(pipelineDepth);
  var line = indent + C.dim + ts() + ' │' + C.reset +
    ' └── 🏁 ' + C.green + C.bright + message + C.reset;
  console.log(line);
  pipelineDepth = 0;
}

// ── Flow Indicators (simple) ────────────────────────────
function arrow(msg) {
  console.log('       ' + C.dim + '──►' + C.reset + ' ' + msg);
}

function step(num, total, msg) {
  var filled = '●';
  var empty = '○';
  var bar = '';
  for (var i = 1; i <= total; i++) {
    bar += i <= num
      ? C.green + filled + C.reset
      : C.dim + empty + C.reset;
    if (i < total) bar += C.dim + '─' + C.reset;
  }
  console.log('');
  console.log('     ' + bar + C.dim + '  ' + num + '/' + total + C.reset);
  console.log('       ' + C.bright + msg + C.reset);
}

function divider() {
  console.log(C.dim + '  ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈' + C.reset);
}

function dividerThick() {
  console.log(C.dim + '  ═══════════════════════════════════════════════════════' + C.reset);
}

function blank() { console.log(''); }

// ── Timer ────────────────────────────────────────────────
function startTimer(label) {
  timers.set(label, Date.now());
}

function endTimer(label) {
  var start = timers.get(label);
  if (!start) return '';
  var elapsed = Date.now() - start;
  timers.delete(label);
  var ms = elapsed < 1000 ? elapsed + 'ms' : (elapsed / 1000).toFixed(1) + 's';
  return C.dim + ' ⏱️  ' + ms + C.reset;
}

function elapsed(label) {
  return endTimer(label);
}

// ── Config Table (bootstrap) ────────────────────────────
function configTable(rows) {
  console.log(C.dim + '  ┌────────────────────────────────────────────┐' + C.reset);
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var key = C.dim + '  │ ' + C.reset + C.yellow + row[0].padEnd(16) + C.reset;
    var val = C.bright + row[1] + C.reset;
    console.log(key + val);
  }
  console.log(C.dim + '  └────────────────────────────────────────────┘' + C.reset);
}

// ── Banner ──────────────────────────────────────────────
function banner() {
  blank();
  console.log(C.bright + C.cyan + '  ╔═══════════════════════════════════════════════╗' + C.reset);
  console.log(C.bright + C.cyan + '  ║                                               ║' + C.reset);
  console.log(C.bright + C.cyan + '  ║' + C.reset + '  🤖  ' + C.bright + C.white + 'ANDRI BOT' + C.reset + C.bright + C.cyan + '                              ║' + C.reset);
  console.log(C.bright + C.cyan + '  ║' + C.reset + '  📱  ' + C.dim + 'WhatsApp Auto-Reply Engine' + C.reset + C.bright + C.cyan + '             ║' + C.reset);
  console.log(C.bright + C.cyan + '  ║' + C.reset + '  🧠  ' + C.dim + 'AI Lokal (from zero) + Nemotron Guru' + C.reset + C.bright + C.cyan + '    ║' + C.reset);
  console.log(C.bright + C.cyan + '  ║                                               ║' + C.reset);
  console.log(C.bright + C.cyan + '  ╚═══════════════════════════════════════════════╝' + C.reset);
  blank();
}

// ── Startup Success ─────────────────────────────────────
function ready(port) {
  blank();
  console.log(C.green + C.bright + '  ┌──────────────────────────────────────────┐' + C.reset);
  console.log(C.green + C.bright + '  │' + C.reset + '  ✅  ' + C.bright + 'Bot siap!' + C.reset + C.green + C.bright + '                           │' + C.reset);
  console.log(C.green + C.bright + '  │' + C.reset + '  🌐  ' + C.white + 'Dashboard: ' + C.cyan + 'http://localhost:' + port + C.reset + C.green + C.bright + '        │' + C.reset);
  console.log(C.green + C.bright + '  │' + C.reset + '  📡  ' + C.white + 'API:      ' + C.cyan + 'http://localhost:' + port + '/api' + C.reset + C.green + C.bright + '   │' + C.reset);
  console.log(C.green + C.bright + '  └──────────────────────────────────────────┘' + C.reset);
  blank();
}

// ── Heartbeat ───────────────────────────────────────────
function startHeartbeat(intervalMs) {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  var startTime = Date.now();
  heartbeatInterval = setInterval(function() {
    var uptime = Date.now() - startTime;
    var hrs = Math.floor(uptime / 3600000);
    var mins = Math.floor((uptime % 3600000) / 60000);
    var mem = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    var uptimeStr = hrs > 0 ? hrs + 'h ' + mins + 'm' : mins + 'm';
    console.log(C.dim + '  💓' + C.reset + ' ' + C.gray + 'PULSE' + C.reset + '  ' +
      C.dim + 'uptime:' + C.reset + ' ' + C.bright + uptimeStr + C.reset +
      C.dim + ' │ mem:' + C.reset + ' ' + C.yellow + mem + 'MB' + C.reset);
  }, intervalMs || 60000);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// ── Shutdown ────────────────────────────────────────────
function shutdown() {
  blank();
  console.log(C.dim + '  ═════════════════════════════════════════════════' + C.reset);
  console.log('  🛑  ' + C.bright + C.yellow + 'Bot dimatikan' + C.reset);
  console.log(C.dim + '  ═════════════════════════════════════════════════' + C.reset);
  blank();
}

module.exports = {
  log: log,
  sys: sys,
  db: db,
  ai: ai,
  openwa: openwa,
  nemotron: nemotron,
  msgIn: msgIn,
  msgOut: msgOut,
  ok: ok,
  warn: warn,
  err: err,
  info: info,
  arrow: arrow,
  step: step,
  divider: divider,
  dividerThick: dividerThick,
  blank: blank,
  startTimer: startTimer,
  endTimer: endTimer,
  elapsed: elapsed,
  configTable: configTable,
  banner: banner,
  ready: ready,
  startHeartbeat: startHeartbeat,
  stopHeartbeat: stopHeartbeat,
  shutdown: shutdown,
  pipeStart: pipeStart,
  pipeStep: pipeStep,
  pipeEnd: pipeEnd,
  pipeDone: pipeDone,
};
