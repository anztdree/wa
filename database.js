const config = require('./config');
const initSQL = require('sql.js');
const fs = require('fs');
const path = require('path');
const log = require('./logger');

var DB_PATH = config.dbPath;
var db = null;

function ensureDir() {
  var dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function init() {
  ensureDir();
  log.arrow('📦 Loading sql.js WASM...');
  var SQL = await initSQL();
  var exists = fs.existsSync(DB_PATH);
  if (exists) {
    var buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  if (!exists) {
    log.arrow('🔨 Membuat schema tabel...');
    createSchema();
  }
  log.ok('Database ' + (exists ? 'loaded' : 'created') + ' → ' + DB_PATH);

  var stats = getMessageStats();
  log.info('   └ 📊 Messages: ' + stats.total + ' (📥 in: ' + stats.inbound + ', 📤 out: ' + stats.outbound + ', 🧠 ai: ' + stats.aiReplies + ')');
}

function createSchema() {
  db.run('CREATE TABLE IF NOT EXISTS messages (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    'session_id TEXT NOT NULL,' +
    'chat_id TEXT NOT NULL,' +
    'sender_id TEXT NOT NULL,' +
    'sender_name TEXT DEFAULT \'\',' +
    'body TEXT NOT NULL DEFAULT \'\',' +
    'message_type TEXT DEFAULT \'text\',' +
    'timestamp INTEGER NOT NULL,' +
    'direction TEXT NOT NULL DEFAULT \'inbound\',' +
    'is_group INTEGER DEFAULT 0,' +
    'author TEXT DEFAULT \'\',' +
    'quoted_body TEXT DEFAULT \'\',' +
    'source TEXT DEFAULT \'\',' +
    'confidence INTEGER DEFAULT 0' +
  ')');

  db.run('CREATE TABLE IF NOT EXISTS patterns (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    'trigger_keywords TEXT NOT NULL DEFAULT \'[]\',' +
    'intent TEXT DEFAULT \'\',' +
    'response_template TEXT NOT NULL DEFAULT \'\',' +
    'confidence INTEGER NOT NULL DEFAULT 50,' +
    'usage_count INTEGER DEFAULT 0,' +
    'success_count INTEGER DEFAULT 0,' +
    'created_at INTEGER DEFAULT (unixepoch()),' +
    'last_used_at INTEGER DEFAULT 0,' +
    'source TEXT DEFAULT \'learned\'' +
  ')');

  db.run('CREATE TABLE IF NOT EXISTS style_profile (' +
    'id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),' +
    'avg_sentence_length REAL DEFAULT 0,' +
    'common_abbreviations TEXT DEFAULT \'{}\',' +
    'emoji_patterns TEXT DEFAULT \'{}\',' +
    'slang_words TEXT DEFAULT \'{}\',' +
    'formality_score REAL DEFAULT 0.5,' +
    'sample_count INTEGER DEFAULT 0,' +
    'last_updated INTEGER DEFAULT 0' +
  ')');

  db.run('CREATE TABLE IF NOT EXISTS chat_context (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    'chat_id TEXT NOT NULL UNIQUE,' +
    'current_topic TEXT DEFAULT \'\',' +
    'last_activity INTEGER DEFAULT 0,' +
    'message_count INTEGER DEFAULT 0,' +
    'notes TEXT DEFAULT \'\'' +
  ')');

  db.run('CREATE TABLE IF NOT EXISTS nemotron_logs (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    'request_type TEXT NOT NULL DEFAULT \'\',' +
    'input_summary TEXT DEFAULT \'\',' +
    'response_summary TEXT DEFAULT \'\',' +
    'timestamp INTEGER DEFAULT (unixepoch())' +
  ')');

  db.run('CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, timestamp)');
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_patterns_keywords ON patterns(trigger_keywords)');

  save();

  var tables = ['messages', 'patterns', 'style_profile', 'chat_context', 'nemotron_logs'];
  for (var i = 0; i < tables.length; i++) {
    log.info('   └ ✅ ' + tables[i]);
  }
  log.ok('5 tabel + 3 index dibuat 🗄️');
}

function save() {
  if (!db) return;
  var data = db.export();
  var buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function close() {
  if (db) {
    log.db('💾 Menyimpan database sebelum tutup...');
    save();
    db.close();
    db = null;
    log.ok('Database ditutup 🗄️');
  }
}

// --- Helper: sql.js exec wrapper ---
// sql.js returns: [{ columns: [...], values: [[row1], [row2], ...] }]
// values[rowIndex][colIndex] = cell value
function query(sql, params) {
  if (!db) return [];
  var results = db.exec(sql, params);
  if (!results.length || !results[0] || !results[0].values || !results[0].values.length) return [];
  return results[0].values;
}

function getScalar(sql, params) {
  var rows = query(sql, params);
  if (!rows.length) return null;
  return rows[0][0];
}

// --- Messages ---
function insertMessage(msg) {
  db.run(
    'INSERT INTO messages (session_id, chat_id, sender_id, sender_name, body, message_type, timestamp, direction, is_group, author, quoted_body, source, confidence) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [
      msg.session_id || '',
      msg.chat_id || '',
      msg.sender_id || '',
      msg.sender_name || '',
      msg.body || '',
      msg.message_type || 'text',
      msg.timestamp || Math.floor(Date.now() / 1000),
      msg.direction || 'inbound',
      msg.is_group ? 1 : 0,
      msg.author || '',
      msg.quoted_body || '',
      msg.source || '',
      msg.confidence || 0,
    ]
  );
  upsertChatContext(msg.chat_id, msg.body, msg.timestamp);
}

function getChatMessages(chatId, limit) {
  var sql, params;
  if (limit && limit > 0) {
    sql = 'SELECT sender_id, sender_name, body, direction, timestamp, is_group, author FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?';
    params = [chatId, limit];
  } else {
    // Unlimited — ambil semua pesan untuk chatId ini (AI belajar dari full history)
    sql = 'SELECT sender_id, sender_name, body, direction, timestamp, is_group, author FROM messages WHERE chat_id = ? ORDER BY timestamp ASC';
    params = [chatId];
  }
  var rows = query(sql, params);
  var arr = [];
  for (var i = 0; i < rows.length; i++) {
    arr.push({
      sender_id: rows[i][0],
      sender_name: rows[i][1],
      body: rows[i][2],
      direction: rows[i][3],
      timestamp: rows[i][4],
      is_group: rows[i][5] === 1,
      author: rows[i][6],
    });
  }
  // Kalau pakai limit (DESC), reverse ke ASC. Kalau unlimited (sudah ASC), tidak perlu.
  if (limit && limit > 0) arr.reverse();
  return arr;
}

function getRecentMessages(limit) {
  var rows = query(
    'SELECT session_id, chat_id, sender_id, sender_name, body, direction, timestamp, source, is_group FROM messages ORDER BY timestamp DESC LIMIT ?',
    [limit || 20]
  );
  var arr = [];
  for (var i = 0; i < rows.length; i++) {
    arr.push({
      session_id: rows[i][0], chat_id: rows[i][1], sender_id: rows[i][2],
      sender_name: rows[i][3], body: rows[i][4], direction: rows[i][5],
      timestamp: rows[i][6], source: rows[i][7], is_group: rows[i][8] === 1,
    });
  }
  return arr.reverse();
}

function getMessageStats() {
  var total = getScalar('SELECT COUNT(*) FROM messages', []);
  var inbound = getScalar('SELECT COUNT(*) FROM messages WHERE direction = ?', ['inbound']);
  var outbound = getScalar('SELECT COUNT(*) FROM messages WHERE direction = ?', ['outbound']);
  var aiReplies = getScalar("SELECT COUNT(*) FROM messages WHERE source = 'ai'", []);
  var manual = getScalar("SELECT COUNT(*) FROM messages WHERE source = 'manual'", []);
  return { total: total || 0, inbound: inbound || 0, outbound: outbound || 0, aiReplies: aiReplies || 0, manual: manual || 0 };
}

// --- Chat Context ---
function upsertChatContext(chatId, body, timestamp) {
  var existing = getScalar('SELECT id FROM chat_context WHERE chat_id = ?', [chatId]);
  if (existing) {
    db.run('UPDATE chat_context SET last_activity = ?, message_count = message_count + 1 WHERE chat_id = ?',
      [timestamp || Math.floor(Date.now() / 1000), chatId]);
  } else {
    db.run('INSERT INTO chat_context (chat_id, last_activity, message_count) VALUES (?,?,1)',
      [chatId, timestamp || Math.floor(Date.now() / 1000)]);
  }
}

// --- Patterns ---
function insertPattern(pattern) {
  db.run(
    'INSERT INTO patterns (trigger_keywords, intent, response_template, confidence, source) VALUES (?,?,?,?,?)',
    [
      JSON.stringify(pattern.keywords || []),
      pattern.intent || '',
      pattern.response_template || '',
      pattern.confidence || 50,
      pattern.source || 'learned',
    ]
  );
  save();
}

function getPatterns() {
  var rows = query('SELECT id, trigger_keywords, intent, response_template, confidence, usage_count, success_count, source, created_at FROM patterns ORDER BY usage_count DESC');
  var arr = [];
  for (var i = 0; i < rows.length; i++) {
    arr.push({
      id: rows[i][0],
      keywords: JSON.parse(rows[i][1]),
      intent: rows[i][2],
      response_template: rows[i][3],
      confidence: rows[i][4],
      usage_count: rows[i][5],
      success_count: rows[i][6],
      source: rows[i][7],
      created_at: rows[i][8],
    });
  }
  return arr;
}

function getPatternCount() {
  return getScalar('SELECT COUNT(*) FROM patterns', []) || 0;
}

// --- Style Profile ---
function getStyleProfile() {
  var rows = query('SELECT avg_sentence_length, common_abbreviations, emoji_patterns, slang_words, formality_score, sample_count, last_updated FROM style_profile WHERE id = 1');
  if (!rows.length) return null;
  return {
    avg_sentence_length: rows[0][0],
    common_abbreviations: JSON.parse(rows[0][1] || '{}'),
    emoji_patterns: JSON.parse(rows[0][2] || '{}'),
    slang_words: JSON.parse(rows[0][3] || '{}'),
    formality_score: rows[0][4],
    sample_count: rows[0][5],
    last_updated: rows[0][6],
  };
}

function updateStyleProfile(data) {
  var existing = getScalar('SELECT id FROM style_profile WHERE id = 1', []);
  if (!existing) {
    db.run('INSERT INTO style_profile (avg_sentence_length, common_abbreviations, emoji_patterns, slang_words, formality_score, sample_count, last_updated) VALUES (?,?,?,?,?,?,?)',
      [data.avg_sentence_length || 0, JSON.stringify(data.common_abbreviations || {}), JSON.stringify(data.emoji_patterns || {}),
       JSON.stringify(data.slang_words || {}), data.formality_score || 0.5, data.sample_count || 0, data.last_updated || Math.floor(Date.now() / 1000)]);
  } else {
    db.run('UPDATE style_profile SET avg_sentence_length=?, common_abbreviations=?, emoji_patterns=?, slang_words=?, formality_score=?, sample_count=?, last_updated=? WHERE id=1',
      [data.avg_sentence_length || 0, JSON.stringify(data.common_abbreviations || {}), JSON.stringify(data.emoji_patterns || {}),
       JSON.stringify(data.slang_words || {}), data.formality_score || 0.5, data.sample_count || 0, data.last_updated || Math.floor(Date.now() / 1000)]);
  }
  save();
}

// --- Nemotron Logs ---
function insertNemotronLog(entry) {
  db.run('INSERT INTO nemotron_logs (request_type, input_summary, response_summary) VALUES (?,?,?)',
    [entry.request_type || '', entry.input_summary || '', entry.response_summary || '']);
  save();
}

// --- Public ---
function getDb() { return db; }

module.exports = {
  getDb: getDb,
  init: init,
  close: close,
  save: save,
  insertMessage: insertMessage,
  getChatMessages: getChatMessages,
  getRecentMessages: getRecentMessages,
  getMessageStats: getMessageStats,
  insertPattern: insertPattern,
  getPatterns: getPatterns,
  getPatternCount: getPatternCount,
  getStyleProfile: getStyleProfile,
  updateStyleProfile: updateStyleProfile,
  insertNemotronLog: insertNemotronLog,
};
