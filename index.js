const express = require('express');
const config = require('./config');
const db = require('./database');
const openwa = require('./openwa-client');
const listener = require('./listener');
const ai = require('./ai');
const nemotron = require('./nemotron');
const path = require('path');
const log = require('./logger');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- API Routes ---
app.get('/api/status', (req, res) => {
  const msgStats = db.getMessageStats();
  const aiStats = ai.getStats();
  res.json({
    connected: openwa.isConnected(),
    session: openwa.getSessionId() ? openwa.getSessionId().slice(0, 8) + '...' : null,
    owner: openwa.getOwnerPhone() || null,
    autoReply: config.ai.autoReplyEnabled,
    messages: msgStats,
    ai: aiStats,
    nemotron: nemotron.getCallCount(),
  });
});

app.get('/api/messages/recent', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  res.json(db.getRecentMessages(limit));
});

app.get('/api/patterns', (req, res) => {
  res.json(db.getPatterns());
});

app.get('/api/style', (req, res) => {
  res.json(db.getStyleProfile());
});

app.get('/api/nemotron-logs', (req, res) => {
  const dbHandle = db.getDb();
  const results = dbHandle ? dbHandle.exec('SELECT id, request_type, input_summary, response_summary, timestamp FROM nemotron_logs ORDER BY id DESC LIMIT 20') : [];
  if (!results || !results.length) return res.json([]);
  const [ids, types, inputs, outputs, times] = results;
  res.json(ids[0].map((_, i) => ({
    id: ids[0][i], request_type: types[0][i],
    input_summary: inputs[0][i], response_summary: outputs[0][i],
    timestamp: times[0][i],
  })));
});

// Settings
app.get('/api/settings', (req, res) => {
  res.json({
    openwaUrl: config.openwa.url,
    openwaApiKey: config.openwa.apiKey ? '***' : '',
    nemotronApiKey: config.nemotron.apiKey ? '***' : '',
    confidenceThreshold: config.ai.confidenceThreshold,
    autoReplyEnabled: config.ai.autoReplyEnabled,
  });
});

app.post('/api/settings', (req, res) => {
  const { confidenceThreshold, autoReplyEnabled } = req.body;
  if (typeof confidenceThreshold === 'number') config.ai.confidenceThreshold = confidenceThreshold;
  if (typeof autoReplyEnabled === 'boolean') config.ai.autoReplyEnabled = autoReplyEnabled;
  log.sys('⚙️  Settings diubah → threshold: ' + config.ai.confidenceThreshold + '% │ auto-reply: ' + (config.ai.autoReplyEnabled ? 'ON ✅' : 'OFF ❌'));
  res.json({ ok: true });
});

// SPA fallback
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ═══════════════════════════════════════════════════════
// 🔁 AUTO-RECONNECT — cek OpenWA tiap 3 detik
// ═══════════════════════════════════════════════════════
var reconnectTimer = null;
var reconnectAttempts = 0;
var reconnectStart = null;
var errorCount = 0;

function setupCallbacks() {
  openwa.onMessage(function(data) {
    if (config.ai.autoReplyEnabled) {
      listener.handleMessage(data);
    }
  });
  openwa.onStatus(function(status) {
    if (status.statusEvent) {
      var s = status.statusEvent.status || 'unknown';
      var sid = (status.sessionId || '').slice(0, 8) + '...';
      var icons = {
        initializing: '⏳', authenticating: '🔐', syncing: '📸',
        ready: '✅', connected: '✅', disconnected: '⚠️ ',
      };
      var extra = '';
      if ((s === 'ready' || s === 'connected') && openwa.getOwnerPhone()) {
        extra = ' │ 📞 ' + openwa.getOwnerPhone();
      }
      log.openwa((icons[s] || '❓') + ' ' + s + ' │ ' + sid + extra);
    }
  });
}

function startAutoReconnect() {
  if (reconnectTimer) return;
  reconnectStart = Date.now();
  log.info('🔁 Auto-reconnect aktif → cek tiap 3 detik');

  reconnectTimer = setInterval(async function() {
    // Sudah connected? Berhenti
    if (openwa.isConnected() && openwa.getSessionId()) {
      var sec = Math.round((Date.now() - reconnectStart) / 1000);
      log.ok('📱 TERHUBUNG setelah ' + sec + 's │ ' + reconnectAttempts + ' coba');
      clearInterval(reconnectTimer);
      reconnectTimer = null;
      reconnectAttempts = 0;
      return;
    }

    // Silent — cek koneksi tanpa print. Activity feed yang menampilkan status.
    reconnectAttempts++;

    var ok = await openwa.initSession(true);
    if (ok) {
      openwa.connectSocket();
      setupCallbacks();
      var sec2 = Math.round((Date.now() - reconnectStart) / 1000);
      log.ok('📱 TERHUBUNG setelah ' + sec2 + 's │ ' + reconnectAttempts + ' coba');
      clearInterval(reconnectTimer);
      reconnectTimer = null;
      reconnectAttempts = 0;
    }
  }, 3000);
}

// ═══════════════════════════════════════════════════════
// 🔍 ACTIVITY FEED — tiap 5 detik
// ═══════════════════════════════════════════════════════
var actLast = { in: 0, out: 0, nemo: 0, pattern: 0, grp: 0, vid: 0, me: 0, err: 0 };

function startActivityFeed(ms) {
  setInterval(function() {
    var stats = db.getMessageStats();
    var aiStats = ai.getStats();
    var skips = listener.getSkipCounters();
    var nemoCount = nemotron.getCallCount();

    var dIn = stats.inbound - actLast.in;
    var dOut = stats.outbound - actLast.out;
    var dNemo = nemoCount - actLast.nemo;
    var dPattern = aiStats.patternCount - actLast.pattern;
    var dGrp = skips.group - actLast.grp;
    var dVid = skips.nonText - actLast.vid;
    var dMe = skips.fromMe - actLast.me;
    var dErr = errorCount - actLast.err;

    var idle = (dIn === 0 && dOut === 0 && dGrp === 0 && dVid === 0 && dMe === 0);

    log.activity({
      idle: idle,
      deltaIn: dIn, deltaOut: dOut,
      deltaNemotron: dNemo, deltaPattern: dPattern,
      deltaErrors: dErr,
      deltaGroup: dGrp, deltaNonText: dVid, deltaFromMe: dMe,
      reconnectCount: reconnectAttempts,
      openwaStatus: openwa.isConnected() ? 'connected' : 'disconnected',
    });

    // Simpan state terakhir
    actLast = {
      in: stats.inbound, out: stats.outbound, nemo: nemoCount,
      pattern: aiStats.patternCount, grp: skips.group,
      vid: skips.nonText, me: skips.fromMe, err: errorCount,
    };

    // Auto-reconnect kalau terputus dan belum ada timer
    if (!openwa.isConnected() && !reconnectTimer) {
      log.warn('📡 OpenWA terputus! Memulai reconnect...');
      startAutoReconnect();
    }
  }, ms || 5000);
}

// --- Main Bootstrap ---
async function boot() {
  log.banner();

  // 1. Config
  log.sys('📦 Config     OpenWA: ' + config.openwa.url + ' │ ' +
    (config.openwa.apiKey ? '***' + config.openwa.apiKey.slice(-4) : '❌ kosong') +
    ' │ threshold: ' + config.ai.confidenceThreshold + '% │ ' +
    (config.ai.autoReplyEnabled ? 'ON ✅' : 'OFF ❌'));

  if (!config.openwa.apiKey) log.warn('⚠️  OPENWA_API_KEY belum di-set');
  if (!config.nemotron.apiKey) log.warn('⚠️  NVIDIA_API_KEY belum di-set — Nemotron tidak tersedia');

  // 2. Database
  log.startTimer('db');
  await db.init();
  var dbTime = log.elapsed('db');
  log.sys('🗄️ Database   loaded ✓ │ ' + db.getMessageStats().total + ' messages │ ⏱' + dbTime);

  // 3. AI Lokal
  ai.init();

  // 4. Listener
  listener.init();

  // 5. OpenWA
  log.startTimer('openwa');
  var sessionOk = await openwa.initSession();
  var waTime = log.elapsed('openwa');

  if (sessionOk) {
    openwa.connectSocket();
    setupCallbacks();
    log.openwa('✅ connected │ ' + openwa.getSessionId().slice(0, 8) + '...' + waTime);
  } else {
    log.warn('📭 Tidak ditemukan session aktif');
    log.info('🔁 Auto-reconnect aktif → cek tiap 3 detik');
  }

  // 6. Server
  app.listen(config.port, function() {
    log.ready(config.port);
    log.blank();
    log.sys('✅ Bot siap │ auto-reply: ' + (config.ai.autoReplyEnabled ? 'ON' : 'OFF') +
      (!sessionOk ? ' │ reconnect: AKTIF' : ' │ connected'));
    log.blank();

    // Background services
    if (!sessionOk) startAutoReconnect();
    startActivityFeed(5000);
  });
}

// Graceful shutdown
process.on('SIGINT', function() {
  if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = null; }
  log.info('🛑 Background services dihentikan');
  log.shutdown();
  db.close();
  process.exit(0);
});

process.on('uncaughtException', function(err) {
  errorCount++;
  log.err('💥 Uncaught: ' + err.message);
  log.info('📍 ' + (err.stack ? err.stack.split('\n').slice(0, 3).join(' │ ') : 'no stack'));
});

process.on('unhandledRejection', function(reason) {
  errorCount++;
  log.err('💥 Unhandled rejection: ' + reason);
});

boot().catch(function(err) {
  log.err('💀 Fatal: ' + err.message);
  process.exit(1);
});
