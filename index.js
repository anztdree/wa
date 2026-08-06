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
  const results = db.db ? db.db.exec('SELECT id, request_type, input_summary, response_summary, timestamp FROM nemotron_logs ORDER BY id DESC LIMIT 20') : [];
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
  log.sys('⚙️  Settings updated → threshold: ' + config.ai.confidenceThreshold + '% | auto-reply: ' + (config.ai.autoReplyEnabled ? 'ON' : 'OFF'));
  res.json({ ok: true });
});

// SPA fallback
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// --- Main Bootstrap ---
async function boot() {
  log.banner();

  // 1. Config check
  log.step(1, 6, 'Validasi konfigurasi');
  var configRows = [
    ['OpenWA URL', config.openwa.url],
    ['OpenWA Key', config.openwa.apiKey ? '***' + config.openwa.apiKey.slice(-4) : '❌ kosong'],
    ['Nemotron Key', config.nemotron.apiKey ? '***' + config.nemotron.apiKey.slice(-4) : '❌ kosong'],
    ['Nemotron Model', config.nemotron.model],
    ['Threshold', config.ai.confidenceThreshold + '%'],
    ['Auto-Reply', config.ai.autoReplyEnabled ? '✅ AKTIF' : '❌ NONAKTIF'],
    ['Context', config.ai.contextMessages + ' msgs'],
    ['DB Path', config.dbPath],
  ];
  log.configTable(configRows);

  var warnings = [];
  if (!config.openwa.apiKey) warnings.push('OPENWA_API_KEY belum di-set');
  if (!config.nemotron.apiKey) warnings.push('NVIDIA_API_KEY belum di-set — Nemotron tidak tersedia');
  if (warnings.length) {
    for (var w of warnings) log.warn('⚠️  ' + w);
  } else {
    log.ok('Config lengkap, siap jalan!');
  }

  // 2. Database
  log.step(2, 6, 'Inisialisasi database');
  log.startTimer('db');
  await db.init();
  var dbTime = log.elapsed('db');
  log.ok('Database siap ' + dbTime + ' → ' + config.dbPath);

  // 3. AI Lokal
  log.step(3, 6, 'Inisialisasi AI Lokal');
  ai.init();

  // 4. Listener
  log.step(4, 6, 'Inisialisasi listener');
  listener.init();

  // 5. OpenWA
  log.step(5, 6, 'Menghubungkan ke OpenWA');
  log.info('🌐 Target: ' + config.openwa.url);
  log.startTimer('openwa');
  var sessionOk = await openwa.initSession();
  var waTime = log.elapsed('openwa');

  if (sessionOk) {
    log.arrow('🔌 Menghubungkan Socket.IO...');
    openwa.connectSocket();
    log.ok('OpenWA connected ' + waTime);

    openwa.onMessage(function(data) {
      if (config.ai.autoReplyEnabled) {
        listener.handleMessage(data);
      }
    });
    openwa.onStatus(function(status) {
      log.openwa('🔄 Session update: ' + JSON.stringify(status).slice(0, 80));
    });
  } else {
    log.warn('Tidak ada session aktif di OpenWA');
    log.info('💡 Bot tetap berjalan, otomatis connect saat OpenWA tersedia');
  }

  // 6. Server
  log.step(6, 6, 'Menyalakan server');
  app.listen(config.port, function() {
    log.ready(config.port);

    // Summary line
    log.divider();
    log.sys('📊 Auto-reply: ' + (config.ai.autoReplyEnabled ? '✅ AKTIF' : '❌ OFF') +
      ' │ Threshold: ' + config.ai.confidenceThreshold + '%' +
      ' │ Context: ' + config.ai.contextMessages + ' msgs');
    log.divider();

    // Start heartbeat
    log.startHeartbeat(60000);
    log.blank();
  });
}

// Graceful shutdown
process.on('SIGINT', function() {
  log.stopHeartbeat();
  log.shutdown();
  db.close();
  process.exit(0);
});

process.on('uncaughtException', function(err) {
  log.err('💥 Uncaught: ' + err.message);
  log.info('📍 ' + (err.stack ? err.stack.split('\n').slice(0, 3).join(' │ ') : 'no stack'));
});

process.on('unhandledRejection', function(reason) {
  log.err('💥 Unhandled rejection: ' + reason);
});

boot().catch(function(err) {
  log.err('💀 Fatal: ' + err.message);
  process.exit(1);
});
