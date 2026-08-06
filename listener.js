const config = require('./config');
const db = require('./database');
const ai = require('./ai');
const log = require('./logger');

const CONTEXT_LIMIT = config.ai.contextMessages;
let replyCount = 0;

function init() {
  log.sys('👂 Listener siap │ threshold: ' + config.ai.confidenceThreshold + '% │ context: ' + CONTEXT_LIMIT + ' msgs │ auto-reply: ' + (config.ai.autoReplyEnabled ? 'ON ✅' : 'OFF ❌'));
}

// --- Handle incoming message from OpenWA ---
async function handleMessage(data) {
  // Skip pesan dari owner sendiri
  if (data.fromMe) return;

  // Skip non-text messages
  if (data.type && data.type !== 'text') return;

  // Skip status broadcast
  if (data.isStatusBroadcast) return;

  const body = (data.body || '').trim();
  if (!body) return;

  const chatId = data.chatId || data.from;
  const senderId = data.from;
  const senderName = data.contact?.name || data.contact?.pushName || data.pushName || senderId;
  const isGroup = data.isGroup || false;
  const author = data.author || '';

  // ══════════════════════════════════════════════
  // 📥 PIPELINE: Pesan Masuk
  // ══════════════════════════════════════════════
  log.msgIn(senderName, body, isGroup);

  // ── PARSE ──
  log.pipeStep('PARSE', 'body ✓ │ from: ' + (senderId || '?').slice(-6) + (isGroup ? ' │ 📢 group' : ''));

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
    is_group,
    author,
    quoted_body: data.quotedMessage?.body || '',
    source: '',
  });
  log.pipeStep('SAVE', 'Tersimpan ke database ✓');

  // Cek auto-reply enabled
  if (!config.ai.autoReplyEnabled) {
    log.pipeDone('Auto-reply NONAKTIF — pesan disimpan saja');
    return;
  }

  // ── CONTEXT ──
  const context = db.getChatMessages(chatId, CONTEXT_LIMIT);
  if (context.length > 0) {
    log.pipeStep('CONTEXT', context.length + ' pesan terakhir dimuat');
  } else {
    log.pipeStep('CONTEXT', 'Kosong — percakapan baru');
  }

  // ── AI PROCESS ──
  log.pipeStep('AI', 'Mulai analisis...');
  log.startTimer('ai-process');
  const result = await ai.processMessage(
    { body, from: senderId, chatId, sender_name: senderName },
    context
  );
  const aiTime = log.elapsed('ai-process');

  if (result && result.text) {
    // ── TYPING ──
    await sendReply(chatId, result, aiTime);
  } else {
    log.pipeDone('Tidak ada respons generated ' + aiTime);
  }
}

async function sendReply(chatId, result, aiTime) {
  const openwa = require('./openwa-client');

  // Kirim typing indicator dulu
  log.pipeStep('TYPING', 'Mengirim indicator → ' + chatId.slice(-8));
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

    // Simpan pesan keluar ke database
    db.insertMessage({
      chat_id: chatId,
      sender_id: openwa.getOwnerPhone() || 'bot',
      sender_name: '',
      body: result.text,
      message_type: 'text',
      timestamp: Math.floor(Date.now() / 1000),
      direction: 'outbound',
      source: 'ai',
      confidence: result.confidence || 0,
    });

    const meta = '[#' + replyCount + '] intent:' + (result.intent || '?') + ' │ conf:' + result.confidence + '%' + (aiTime ? ' │ AI ' + aiTime : '') + (sendTime ? ' │ send ' + sendTime : '');
    log.pipeDone('Reply terkirim ✓ ' + meta);
    log.msgOut(result.text, meta);
    log.ok('📤 Reply #' + replyCount + ' berhasil dikirim');
  } else {
    log.pipeDone('Gagal mengirim reply ❌');
    log.err('🚫 Gagal mengirim reply ke ' + chatId.slice(-8));
  }
}

module.exports = { init, handleMessage };
