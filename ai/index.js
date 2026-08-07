const config = require('../config');
const db = require('../database');
const nemotron = require('../nemotron');
const log = require('../logger');

// ============================================================
// 🧠 AI Engine — Nemotron Guru + Memory Belajar
// AI Lokal (pattern matching) DIHAPUS — langsung ke Nemotron
// ============================================================

var styleProfile = null;

function init() {
  styleProfile = db.getStyleProfile();
  if (styleProfile && styleProfile.sample_count > 0) {
    log.info('   └ 📊 Style: ' + styleProfile.sample_count + ' samples │ formality: ' + styleProfile.formality_score + ' │ avg: ' + styleProfile.avg_sentence_length + ' kata');
  }
  log.ok('AI siap 🧠 │ mode: Nemotron guru');
}

// --- Main Entry Point ---
async function processMessage(message, context) {
  var body = message.body;

  log.pipeStep('NEMOTRON', 'Generate reply...');
  log.startTimer('ai-process');
  var response = await askNemotron(body, context);
  var aiTime = log.elapsed('ai-process');

  if (response) {
    saveToMemory(body, response);
    return { text: response, confidence: 80, source: 'nemotron', intent: 'auto', aiTime: aiTime };
  }

  log.pipeDone('Gagal generate reply ' + aiTime);
  return null;
}

// --- Nemotron ---
async function askNemotron(message, context) {
  db.insertNemotronLog({ request_type: 'reply_generate', input_summary: message.slice(0, 80) });
  // Style profile TIDAK dikirim ke prompt — cukup history chat yang berbicara
  var response = await nemotron.generateReply(message, context);
  db.insertNemotronLog({ request_type: 'reply_response', response_summary: response ? response.slice(0, 80) : 'FAILED' });
  return response;
}

// --- Memory (simpan hasil Nemotron untuk belajar) ---
function saveToMemory(input, output) {
  var keywords = extractKeywords(input);
  var intent = detectIntentSimple(input);

  db.insertPattern({
    keywords: keywords,
    intent: intent,
    response_template: output,
    confidence: 60,
    source: 'nemotron',
  });

  // Update style dari response
  updateStyleFromResponse(output);
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
  return ['yang','dan','dengan','itu','ini','di','ke','dari','untuk','ada','tidak','bisa','akan','sudah','belum','lagi','juga','saya','kamu','dia','kita','mereka','nya','sih','kok','ya','banget','sangat','paling','tau','tahu'].indexOf(word) !== -1;
}

// --- Intent Detection (sederhana, untuk labeling memory) ---
function detectIntentSimple(text) {
  var lower = text.toLowerCase();
  if (/^(halo|hai|hi|hey|hello|pagi|siang|sore|malam|assalam)/.test(lower)) return 'greeting';
  if (/^(bye|dadah|sampai|pamit)/.test(lower)) return 'farewell';
  if (/(makasih|thanks|thank|terima kasih)/.test(lower)) return 'thanks';
  if (/[?]/.test(lower) || /^(apa|kapan|dimana|bagaimana|berapa|kenapa|siapa)/.test(lower)) return 'question';
  if (/^(ok|oke|sip|ya|yoi|iyaa|iye|setuju|bisa|boleh|gas)/.test(lower)) return 'confirmation';
  return 'general';
}

// --- Style Learning dari response Nemotron ---
function updateStyleFromResponse(text) {
  var sentences = text.split(/[.!?]+/).filter(function(s) { return s.trim().length > 0; });
  if (!sentences.length) return;

  var avgLen = sentences.reduce(function(s, t) { return s + t.trim().split(/\s+/).length; }, 0) / sentences.length;

  var cur = styleProfile || { sample_count: 0, avg_sentence_length: 0, formality_score: 0.5, common_abbreviations: {}, emoji_patterns: {}, slang_words: {} };
  var total = cur.sample_count + 1;
  var w = cur.sample_count / total;

  styleProfile = {
    avg_sentence_length: Math.round((cur.avg_sentence_length * w + avgLen * (1 - w)) * 10) / 10,
    common_abbreviations: cur.common_abbreviations || {},
    emoji_patterns: cur.emoji_patterns || {},
    slang_words: cur.slang_words || {},
    formality_score: avgLen < 6 ? Math.max(0, (cur.formality_score || 0.5) - 0.05) : Math.min(1, (cur.formality_score || 0.5) + 0.05),
    sample_count: total,
    last_updated: Math.floor(Date.now() / 1000),
  };

  // Track emojis
  var emojiMatches = text.match(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu);
  if (emojiMatches) {
    for (var e = 0; e < emojiMatches.length; e++) {
      styleProfile.emoji_patterns[emojiMatches[e]] = (styleProfile.emoji_patterns[emojiMatches[e]] || 0) + 1;
    }
  }

  db.updateStyleProfile(styleProfile);
}

// --- Learning dari manual replies (owner reply) ---
function learnFromConversation(messages) {
  var outbound = messages.filter(function(m) { return m.direction === 'outbound' && m.source === 'manual'; });
  var inbound = messages.filter(function(m) { return m.direction === 'inbound'; });
  if (!outbound.length || !inbound.length) return;

  for (var i = 0; i < inbound.length; i++) {
    var inMsg = inbound[i];
    var reply = outbound.find(function(o) { return o.timestamp > inMsg.timestamp; });
    if (reply) {
      var keywords = extractKeywords(inMsg.body);
      var intent = detectIntentSimple(inMsg.body);
      db.insertPattern({ keywords: keywords, intent: intent, response_template: reply.body, confidence: 65, source: 'learned' });
    }
  }

  // Update style dari manual reply
  var allText = outbound.map(function(m) { return m.body; }).join(' ');
  updateStyleFromResponse(allText);
}

// --- Stats ---
function getStats() {
  return {
    patternCount: db.getPatternCount() || 0,
    styleSamples: styleProfile ? styleProfile.sample_count : 0,
    nemotronCalls: nemotron.getCallCount(),
  };
}

module.exports = { init: init, processMessage: processMessage, learnFromConversation: learnFromConversation, getStats: getStats };
