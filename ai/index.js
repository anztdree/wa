const config = require('../config');
const db = require('../database');
const nemotron = require('../nemotron');
const log = require('../logger');

// ============================================================
// 🧠 AI LOKAL — Build from zero, belajar dari percakapan Andri
// ============================================================

var patterns = [];
var styleProfile = null;

function init() {
  patterns = db.getPatterns();
  styleProfile = db.getStyleProfile();
  log.ai('📦 Pattern ter-load: ' + patterns.length);
  if (styleProfile && styleProfile.sample_count > 0) {
    log.info('   └ 📊 Style: ' + styleProfile.sample_count + ' samples │ formality: ' + styleProfile.formality_score + ' │ avg: ' + styleProfile.avg_sentence_length + ' kata');
  }
  log.ok('AI Lokal siap 🧠');
}

// --- Main Entry Point ---
async function processMessage(message, context) {
  var body = message.body;
  var from = message.from;
  var chatId = message.chatId;
  var senderName = message.sender_name;

  // 1. Cari pattern yang cocok
  log.pipeStep('MATCH', 'Scanning ' + patterns.length + ' patterns...');
  var match = findPatternMatch(body);

  if (match) {
    var response = fillTemplate(match.response_template, { sender_name: senderName, body: body });
    match.usage_count++;
    updatePatternUsage(match.id, match.usage_count, match.success_count + 1);
    log.pipeStep('MATCH', '✅ Pattern cocok → [' + match.intent + '] conf:' + match.confidence + '% │ uses:' + match.usage_count);
    return { text: response, confidence: match.confidence, source: 'ai', intent: match.intent };
  }

  // 2. Tidak ada pattern — detect intent & extract keywords
  var intent = detectIntent(body);
  var keywords = extractKeywords(body);
  log.pipeStep('EXTRACT', 'Intent: ' + intent + ' │ keywords: [' + keywords.join(', ') + ']');

  // 3. Confidence rendah — minta bantuan Nemotron
  log.pipeStep('NEMOTRON', 'Confidence rendah, meminta bantuan guru...');
  var nemotronResponse = await askNemotron(body, context);
  if (nemotronResponse) {
    db.insertPattern({
      keywords: keywords,
      intent: intent,
      response_template: nemotronResponse,
      confidence: 55,
      source: 'nemotron',
    });
    patterns = db.getPatterns();
    log.pipeStep('LEARN', 'Pattern baru disimpan [' + intent + '] │ total: ' + patterns.length);
    return { text: nemotronResponse, confidence: 55, source: 'ai', intent: intent };
  }

  log.pipeStep('NEMOTRON', 'Gagal mendapat respons ❌');
  return null;
}

// --- Pattern Matching ---
function findPatternMatch(text) {
  var lower = text.toLowerCase().normalize('NFC');
  var bestMatch = null;
  var bestScore = 0;

  for (var i = 0; i < patterns.length; i++) {
    var pattern = patterns[i];
    var score = calcMatchScore(lower, pattern);
    if (score > bestScore && pattern.confidence >= config.ai.confidenceThreshold) {
      bestScore = score;
      bestMatch = pattern;
    }
  }
  return bestMatch;
}

function calcMatchScore(text, pattern) {
  var score = 0;
  for (var i = 0; i < pattern.keywords.length; i++) {
    var kw = pattern.keywords[i];
    if (text.indexOf(kw.toLowerCase()) !== -1) {
      score += 25;
      var regex = new RegExp('\\b' + kw.toLowerCase() + '\\b');
      if (regex.test(text)) score += 15;
    }
  }
  return score;
}

// --- Intent Detection (rule-based) ---
function detectIntent(text) {
  var lower = text.toLowerCase();
  var rules = [
    { intent: 'greeting', keywords: ['halo', 'hai', 'hi', 'hey', 'hello', 'pagi', 'siang', 'sore', 'malam', 'assalamualaikum', 'met pagi', 'met siang', 'met sore', 'met malam'] },
    { intent: 'farewell', keywords: ['bye', 'dadah', 'sampai jumpa', 'selamat malam', 'pamit'] },
    { intent: 'thanks', keywords: ['makasih', 'thanks', 'thank', 'terima kasih', 'thx', 'tq'] },
    { intent: 'question', keywords: ['?', 'apa', 'kapan', 'dimana', 'bagaimana', 'berapa', 'kenapa', 'siapa', 'gimana', 'brp'] },
    { intent: 'confirmation', keywords: ['ok', 'oke', 'sip', 'ya', 'yoi', 'iyaa', 'iye', 'setuju', 'bisa', 'boleh', 'gas', 'gass', 'lanjut'] },
    { intent: 'rejection', keywords: ['tidak', 'gak', 'nggak', 'ga', 'enggak', 'jangan', 'tdk'] },
    { intent: 'greeting_self', keywords: ['kabar', 'apa kabar', 'sehat', 'lagi apa', 'ngapain'] },
  ];
  for (var r = 0; r < rules.length; r++) {
    for (var k = 0; k < rules[r].keywords.length; k++) {
      if (lower.indexOf(rules[r].keywords[k]) !== -1) return rules[r].intent;
    }
  }
  return 'general';
}

// --- Keyword Extraction ---
function extractKeywords(text) {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(function(w) { return w.length > 2 && !isStopWord(w); })
    .filter(function(v, i, a) { return a.indexOf(v) === i; })
    .slice(0, 5);
}

function isStopWord(word) {
  var stops = ['yang', 'dan', 'dengan', 'itu', 'ini', 'di', 'ke', 'dari', 'untuk', 'ada', 'tidak', 'bisa', 'akan', 'sudah', 'belum', 'lagi', 'juga', 'saya', 'kamu', 'dia', 'kita', 'mereka', 'nya', 'sih', 'kok', 'ya', 'banget', 'sangat', 'paling', 'tau', 'tahu'];
  return stops.indexOf(word) !== -1;
}

// --- Template ---
function fillTemplate(template, vars) {
  var result = template;
  if (vars.sender_name && vars.sender_name.trim()) {
    result = result.replace(/\{nama\}/g, vars.sender_name);
  }
  return result;
}

// --- Nemotron ---
async function askNemotron(message, context) {
  db.insertNemotronLog({ request_type: 'help_generate', input_summary: message.slice(0, 80) });
  var response = await nemotron.helpGenerate(message, context, styleProfile);
  db.insertNemotronLog({ request_type: 'help_response', response_summary: response ? response.slice(0, 80) : 'FAILED' });
  return response;
}

// --- Learning ---
function learnFromConversation(messages) {
  var outbound = messages.filter(function(m) { return m.direction === 'outbound' && m.source === 'manual'; });
  var inbound = messages.filter(function(m) { return m.direction === 'inbound'; });
  if (!outbound.length || !inbound.length) return;

  updateStyleFromMessages(outbound);

  for (var i = 0; i < inbound.length; i++) {
    var inMsg = inbound[i];
    var reply = outbound.find(function(o) { return o.timestamp > inMsg.timestamp; });
    if (reply) {
      var keywords = extractKeywords(inMsg.body);
      var intent = detectIntent(inMsg.body);
      var existing = patterns.find(function(p) { return p.intent === intent && hasOverlap(p.keywords, keywords); });
      if (!existing) {
        db.insertPattern({ keywords: keywords, intent: intent, response_template: reply.body, confidence: 60, source: 'learned' });
      }
    }
  }
  patterns = db.getPatterns();
}

function updateStyleFromMessages(messages) {
  var allText = messages.map(function(m) { return m.body; }).join(' ');
  var sentences = allText.split(/[.!?]+/).filter(function(s) { return s.trim().length > 0; });
  if (!sentences.length) return;

  var avgLen = sentences.reduce(function(s, t) { return s + t.trim().split(/\s+/).length; }, 0) / sentences.length;
  var abbreviations = {};
  var abbrevList = ['yg', 'gw', 'lu', 'dr', 'dlm', 'tp', 'krn', 'utk', 'jg', 'udh', 'sdh', 'blm', 'aja', 'klo', 'kalo', 'gmn', 'bgt', 'dah', 'nih', 'deh', 'dong', 'lah'];
  for (var i = 0; i < abbrevList.length; i++) {
    var ab = abbrevList[i];
    var m = allText.match(new RegExp('\\b' + ab + '\\b', 'gi'));
    if (m) abbreviations[ab] = m.length;
  }

  var emojis = {};
  var emojiMatches = allText.match(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu);
  if (emojiMatches) for (var e = 0; e < emojiMatches.length; e++) emojis[emojiMatches[e]] = (emojis[emojiMatches[e]] || 0) + 1;

  var cur = styleProfile || { sample_count: 0 };
  var total = cur.sample_count + messages.length;
  var w = cur.sample_count / total;

  styleProfile = {
    avg_sentence_length: Math.round((cur.avg_sentence_length * w + avgLen * (1 - w)) * 10) / 10,
    common_abbreviations: abbreviations,
    emoji_patterns: emojis,
    slang_words: cur.slang_words || {},
    formality_score: avgLen < 6 ? Math.max(0, cur.formality_score - 0.05) : Math.min(1, cur.formality_score + 0.05),
    sample_count: total,
    last_updated: Math.floor(Date.now() / 1000),
  };
  db.updateStyleProfile(styleProfile);
}

function hasOverlap(a, b) { return a.some(function(k) { return b.indexOf(k) !== -1; }); }
function updatePatternUsage(id, usage, success) {
  var p = patterns.find(function(p) { return p.id === id; });
  if (p) { p.usage_count = usage; p.success_count = success; p.last_used_at = Math.floor(Date.now() / 1000); }
}

function getStats() {
  return { patternCount: patterns.length, styleSamples: styleProfile ? styleProfile.sample_count : 0, nemotronCalls: nemotron.getCallCount() };
}

module.exports = { init: init, processMessage: processMessage, learnFromConversation: learnFromConversation, getStats: getStats };
