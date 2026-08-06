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

// --- Messages ---
function insertMessage(msg) {
  db.run(
    'INSERT INTO messages (session_id, chat_id, sender_id, sender_name, body, message_type, timestamp, direction, is_group, author, quoted_body, source, confidence) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
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
  var results = db.exec(
    'SELECT sender_id, sender_name, body, direction, timestamp, is_group, author FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?',
    [chatId, limit || 10]
  );
  if (!results.length) return [];
  var ids = results[0][0], names = results[1][0], bodies = results[2][0], dirs = results[3][0], times = results[4][0], groups = results[5][0], authors = results[6][0];
  var arr = [];
  for (var i = 0; i < ids.length; i++) {
    arr.push({
      sender_id: ids[i],
      sender_name: names[i],
      body: bodies[i],
      direction: dirs[i],
      timestamp: times[i],
      is_group: groups[i] === 1,
      author: authors[i],
    });
  }
  return arr.reverse();
}

function getRecentMessages(limit) {
  var results = db.exec(
    'SELECT m.session_id, m.chat_id, m.sender_id, m.sender_name, m.body, m.direction, m.timestamp, m.source, m.is_group FROM messages m ORDER BY m.timestamp DESC LIMIT ?',
    [limit || 20]
  );
  if (!results.length) return [];
  var sid = results[0][0], cid = results[1][0], snd = results[2][0], nm = results[3][0], bd = results[4][0], dr = results[5][0], ts = results[6][0], src = results[7][0], grp = results[8][0];
  var arr = [];
  for (var i = 0; i < sid.length; i++) {
    arr.push({
      session_id: sid[i], chat_id: cid[i], sender_id: snd[i],
      sender_name: nm[i], body: bd[i], direction: dr[i],
      timestamp: ts[i], source: src[i], is_group: grp[i] === 1,
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
  var results = db.exec('SELECT id, trigger_keywords, intent, response_template, confidence, usage_count, success_count, source, created_at FROM patterns ORDER BY usage_count DESC');
  if (!results.length) return [];
  var ids = results[0][0], kw = results[1][0], intent = results[2][0], tmpl = results[3][0], conf = results[4][0], usage = results[5][0], succ = results[6][0], src = results[7][0], created = results[8][0];
  var arr = [];
  for (var i = 0; i < ids.length; i++) {
    arr.push({
      id: ids[i],
      keywords: JSON.parse(kw[i]),
      intent: intent[i],
      response_template: tmpl[i],
      confidence: conf[i],
      usage_count: usage[i],
      success_count: succ[i],
      source: src[i],
      created_at: created[i],
    });
  }
  return arr;
}

function getPatternCount() {
  return getScalar('SELECT COUNT(*) FROM patterns', []) || 0;
}

// --- Style Profile ---
function getStyleProfile() {
  var results = db.exec('SELECT avg_sentence_length, common_abbreviations, emoji_patterns, slang_words, formality_score, sample_count, last_updated FROM style_profile WHERE id = 1');
  if (!results.length) return null;
  return {
    avg_sentence_length: results[0][0][0],
    common_abbreviations: JSON.parse(results[1][0][0] || '{}'),
    emoji_patterns: JSON.parse(results[2][0][0] || '{}'),
    slang_words: JSON.parse(results[3][0][0] || '{}'),
    formality_score: results[4][0][0],
    sample_count: results[5][0][0],
    last_updated: results[6][0][0],
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

// --- Helpers ---
function getScalar(sql, params) {
  var results = db.exec(sql, params);
  return results.length && results[0].length ? results[0][0][0] : null;
}

module.exports = {
  db: db,
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
