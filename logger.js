// ============================================================
// LOGGER 3.0 — Clean Flat, Activity Feed (Stacked), Pipeline
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

// ── Monkey-patch console.log to auto-flush activity line ──
var _origLog = console.log;
var _origErr = console.error;
var _origWarn = console.warn;
var _actIdle = 0;

function _flushAct() {
  if (_actIdle > 0) {
    process.stdout.write('\n');
    _actIdle = 0;
  }
}

console.log = function() {
  _flushAct();
  return _origLog.apply(console, arguments);
};
console.error = function() {
  _flushAct();
  return _origErr.apply(console, arguments);
};
console.warn = function() {
  _flushAct();
  return _origWarn.apply(console, arguments);
};

// ── Emoji Tags ──────────────────────────────────────────
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
  TYPING:   { emoji: '⌨️ ', color: C.blue   },
  DONE:     { emoji: '🏁', color: C.green  },
  LEARN:    { emoji: '📚', color: C.magenta },
  CONTEXT:  { emoji: '🧩', color: C.blue    },
};

const timers = new Map();

// ── Time ────────────────────────────────────────────────
function ts() {
  return new Date().toLocaleTimeString('id-ID', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

// ── Format Tag Line ─────────────────────────────────────
function fmtTag(type, label) {
  var tag = TAGS[type] || TAGS.SYS;
  return C.dim + tag.emoji + C.reset + ' ' + tag.color + C.bright + (label || type).padEnd(8, ' ') + C.reset;
}

function tagLine(type, message, label) {
  _origLog.call(console, C.dim + ts() + ' ' + fmtTag(type, label) + ' ' + message + C.reset);
}

// ── Core Log ────────────────────────────────────────────
function log(type, message) { tagLine(type, message); }
function sys(msg)      { log('SYS', msg); }
function db(msg)       { log('DB', msg); }
function ai(msg)       { log('AI', msg); }
function openwa(msg)   { log('OPENWA', msg); }
function nemotron(msg) { log('NEMOTRON', msg); }

// ── Message Flow ───────────────────────────────────────
function msgIn(sender, text, isGroup) {
  var preview = text.length > 55 ? text.slice(0, 55) + '...' : text;
  var icon = isGroup ? '👥' : '❤️';
  _origLog.call(console, C.dim + ts() + ' 💬 📥 ' + C.reset +
    C.yellow + icon + ' ' + C.reset + C.bright + sender + C.reset +
    C.dim + ': ' + C.reset + C.white + preview + C.reset);
}

function msgOut(text, meta) {
  var preview = text.length > 55 ? text.slice(0, 55) + '...' : text;
  var metaStr = meta ? C.dim + '  ' + meta + C.reset : '';
  _origLog.call(console, C.dim + ts() + C.reset +
    ' 📤 ' + C.green + C.bright + preview + C.reset + metaStr);
}

// ── Status ──────────────────────────────────────────────
function ok(msg)   { log('OK', C.green + msg + C.reset); }
function warn(msg) { log('WARN', msg); }
function err(msg)  { log('ERR', C.red + msg + C.reset); }
function info(msg) { log('INFO', msg); }

// ── Pipeline Tree ────────────────────────────────────────
var pipelineDepth = 0;

function pipeStep(type, message) {
  var indent = '  '.repeat(pipelineDepth);
  var tag = TAGS[type] || TAGS.INFO;
  _origLog.call(console, indent + C.dim + ts() + ' │' + C.reset +
    ' ├── ' + tag.emoji + ' ' + tag.color + message + C.reset);
}

function pipeDone(message) {
  var indent = '  '.repeat(pipelineDepth);
  _origLog.call(console, indent + C.dim + ts() + ' │' + C.reset +
    ' └── 🏁 ' + C.green + C.bright + message + C.reset);
  pipelineDepth = 0;
}

// ── Flow Indicators ────────────────────────────────────
function arrow(msg) {
  _origLog.call(console, '       ' + C.dim + '──►' + C.reset + ' ' + msg);
}

function divider() {
  _origLog.call(console, C.dim + '  ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈' + C.reset);
}

function dividerThick() {
  _origLog.call(console, C.dim + '  ═══════════════════════════════════════════════════════' + C.reset);
}

function blank() { _origLog.call(console, ''); }

// ── Timer ────────────────────────────────────────────────
function startTimer(label) { timers.set(label, Date.now()); }

function endTimer(label) {
  var start = timers.get(label);
  if (!start) return '';
  var elapsed = Date.now() - start;
  timers.delete(label);
  var ms = elapsed < 1000 ? elapsed + 'ms' : (elapsed / 1000).toFixed(1) + 's';
  return C.dim + ' ⏱' + ms + C.reset;
}

function elapsed(label) { return endTimer(label); }

// ── Config Table ────────────────────────────────────────
function configTable(rows) {
  _origLog.call(console, C.dim + '  ┌────────────────────────────────────────────┐' + C.reset);
  for (var i = 0; i < rows.length; i++) {
    _origLog.call(console, C.dim + '  │ ' + C.reset + C.yellow + rows[i][0].padEnd(16) + C.reset + C.bright + rows[i][1] + C.reset);
  }
  _origLog.call(console, C.dim + '  └────────────────────────────────────────────┘' + C.reset);
}

// ── Banner (Clean Flat) ─────────────────────────────────
function banner() {
  blank();
  _origLog.call(console, C.bright + C.cyan + '  ═══ ANDRI BOT ════════════════════════════════' + C.reset);
  _origLog.call(console, C.bright + C.cyan + '  🤖 WhatsApp Auto-Reply │ Nemotron AI' + C.reset);
  _origLog.call(console, C.bright + C.cyan + '  ══════════════════════════════════════════════' + C.reset);
  blank();
}

// ── Ready ──────────────────────────────────────────────
function ready(port) {
  blank();
  _origLog.call(console, '  🌐 ' + C.cyan + 'http://localhost:' + port + C.reset +
    C.dim + ' │ ' + C.reset + '📡 ' + C.cyan + 'http://localhost:' + port + '/api' + C.reset);
}

// ── Activity Feed (Stacked) ──────────────────────────────
// Idle: overwrite same line with counter (5s(10x))
// Active: flush idle line, print delta
function activity(data) {
  var sep = C.dim + ' │ ' + C.reset;

  if (data.idle) {
    _actIdle++;
    var recon = data.reconnectCount > 0 ? sep + C.yellow + 'reconnect #' + data.reconnectCount + C.reset : '';
    var status = data.openwaStatus === 'disconnected' ? sep + C.red + '📡 ❌' + C.reset : '';
    var line = C.dim + ts() + ' ' + C.reset + '🔍 ' + C.bright + 'ACTIVITY ' + C.reset +
      C.dim + '5s(' + _actIdle + 'x)' + C.reset +
      sep + C.dim + 'idle' + C.reset + recon + status;
    process.stdout.write('\r\x1b[K' + line);
  } else {
    _flushAct();
    var items = [];
    if (data.deltaIn > 0) items.push(C.cyan + '+' + data.deltaIn + ' masuk' + C.reset);
    if (data.deltaOut > 0) items.push(C.green + '+' + data.deltaOut + ' reply' + C.reset);
    if (data.deltaNemotron > 0) items.push(C.yellow + data.deltaNemotron + ' nemotron' + C.reset);
    if (data.deltaErrors > 0) items.push(C.red + data.deltaErrors + ' error' + C.reset);

    var skipTotal = (data.deltaGroup || 0) + (data.deltaNonText || 0) + (data.deltaFromMe || 0);
    if (skipTotal > 0 && data.deltaIn === 0 && data.deltaOut === 0) {
      var sp = [];
      if (data.deltaGroup > 0) sp.push('grp:' + data.deltaGroup);
      if (data.deltaNonText > 0) sp.push('media:' + data.deltaNonText);
      if (data.deltaFromMe > 0) sp.push('me:' + data.deltaFromMe);
      items.push(C.dim + 'skip ' + skipTotal + ' (' + sp.join(', ') + ')' + C.reset);
    }

    var recon2 = data.reconnectCount > 0 ? sep + C.yellow + 'reconnect #' + data.reconnectCount + C.reset : '';
    var status2 = data.openwaStatus === 'disconnected' ? sep + C.red + '📡 ❌' + C.reset : '';

    var line2 = C.dim + ts() + ' ' + C.reset + '🔍 ' + C.bright + 'ACTIVITY ' + C.reset +
      C.dim + '5s' + C.reset + sep + items.join(sep) + recon2 + status2;
    _origLog.call(console, line2);
  }
}

// ── Shutdown ────────────────────────────────────────────
function shutdown() {
  _flushAct();
  blank();
  _origLog.call(console, C.dim + '  ═════════════════════════════════════════════════' + C.reset);
  _origLog.call(console, '  🛑  ' + C.bright + C.yellow + 'Bot dimatikan' + C.reset);
  _origLog.call(console, C.dim + '  ═════════════════════════════════════════════════' + C.reset);
  blank();
}

module.exports = {
  C: C,
  log: log, sys: sys, db: db, ai: ai, openwa: openwa, nemotron: nemotron,
  msgIn: msgIn, msgOut: msgOut,
  ok: ok, warn: warn, err: err, info: info,
  arrow: arrow, divider: divider, dividerThick: dividerThick, blank: blank,
  startTimer: startTimer, endTimer: endTimer, elapsed: elapsed,
  configTable: configTable, banner: banner, ready: ready,
  activity: activity, shutdown: shutdown,
  pipeStep: pipeStep, pipeDone: pipeDone,
  ts: ts,
};
