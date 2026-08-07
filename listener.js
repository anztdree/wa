const config = require('./config');
const db = require('./database');
const ai = require('./ai');
const log = require('./logger');

const CONTEXT_LIMIT = config.ai.contextMessages;
let replyCount = 0;
var skipCounters = { fromMe: 0, nonText: 0, status: 0, empty: 0, group: 0 };

function init() {
  log.sys('👂 Listener   context: ' + CONTEXT_LIMIT + ' msgs │ ' + (config.ai.autoReplyEnabled ? 'ON ✅' : 'OFF ❌'));
}

// --- Handle incoming message from OpenWA ---
async function handleMessage(data) {
  // Skip pesan dari owner sendiri (SILENT)
  if (data.fromMe) {
    skipCounters.fromMe++;
    return;
  }

  // Skip pesan grup (SILENT — tidak ada log)
  if (data.isGroup || (data.chatId && data.chatId.endsWith('@g.us'))) {
    skipCounters.group++;
    return;
  }

  // Skip non-text messages (SILENT)
  if (data.type && data.type !== 'text') {
    skipCounters.nonText++;
    return;
  }

  // Skip status broadcast (SILENT)
  if (data.isStatusBroadcast) {
    skipCounters.status++;
    return;
  }

  const body = (data.body || '').trim();
  if (!body) {
    skipCounters.empty++;
    return;
  }

  const chatId = data.chatId || data.from;
  const senderId = data.from;
  const senderName = data.contact?.name || data.contact?.pushName || data.pushName || senderId;
  const isGroup = data.isGroup || false;
  const author = data.author || '';

  // ══════════════════════════════════════════════
  // 📥 PIPELINE
  // ══════════════════════════════════════════════
  log.msgIn(senderName, body, isGroup);

  // ── PARSE ──
  log.pipeStep('PARSE', 'body ✓ │ from: ' + (senderId || '?').slice(-8) + (isGroup ? ' │ 📢 group' : ' │ DM'));

  // ── SAVE ──
  db.insertMessage({
    session_id: data.sessionId || '',
    chat_id: chatId,
    sender_id: senderId,
    sender_name: senderName,
    body,
    message_type: data.type || 'text',
    timestamp: Math.floor((data.timestamp || Date.now()) / 1000),
    direction: 'inbound',
    is_group: isGroup,
    author,
    quoted_body: data.quotedMessage?.body || '',
    source: '',
  });
  log.pipeStep('SAVE', 'Tersimpan ke database ✓');

  // Cek auto-reply enabled
  if (!config.ai.autoReplyEnabled) {
    log.pipeDone('Auto-reply NONAKTIF — disimpan saja');
    return;
  }

  // ── CONTEXT (unlimited — semua pesan dari chatId untuk AI belajar gaya) ──
  const context = db.getChatMessages(chatId);
  if (context.length > 0) {
    log.pipeStep('CONTEXT', context.length + ' pesan dimuat (full history)');
  } else {
    log.pipeStep('CONTEXT', 'Kosong — percakapan baru');
  }

  // ── NEMOTRON ──
  const result = await ai.processMessage(
    { body, from: senderId, chatId, sender_name: senderName },
    context
  );

  if (result && result.text) {
    await sendReply(chatId, result, result.aiTime || '');
  } else {
    log.warn('🤷 Tidak bisa reply: "' + body.slice(0, 30) + (body.length > 30 ? '...' : '') + '"');
  }
}

async function sendReply(chatId, result, aiTime) {
  const openwa = require('./openwa-client');

  // Kirim typing indicator
  log.pipeStep('TYPING', 'indicator → ' + chatId.slice(-8));
  await openwa.sendTyping(chatId);

  // Delay natural (1-2 detik)
  const delay = 1000 + Math.random() * 1000;
  await new Promise(r => setTimeout(r, delay));

  // Kirim pesan
  log.startTimer('send');
  const sent = await openwa.sendText(chatId, result.text);
  const sendTime = log.elapsed('send');

  if (sent) {
    replyCount++;

    db.insertMessage({
      chat_id: chatId,
      sender_id: openwa.getOwnerPhone() || 'bot',
      sender_name: '',
      body: result.text,
      message_type: 'text',
      timestamp: Math.floor(Date.now() / 1000),
      direction: 'outbound',
      source: 'nemotron',
      confidence: result.confidence || 0,
    });

    const meta = '[#' + replyCount + '] ' + (aiTime || '') + ' │ ' + (sendTime || '');
    log.pipeDone('Reply terkirim ✓ ' + meta);
    log.msgOut(result.text, meta);
    log.ok('📤 Reply #' + replyCount + ' berhasil │ total: ' + replyCount);
  } else {
    log.pipeDone('Gagal mengirim ❌');
    log.err('🚫 Gagal kirim ke ' + chatId.slice(-8));
  }
}

function getSkipCounters() {
  return skipCounters;
}

module.exports = { init: init, handleMessage: handleMessage, getSkipCounters: getSkipCounters };
