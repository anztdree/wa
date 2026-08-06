const config = require('./config');
const log = require('./logger');

const API = config.openwa.url + '/api';
const WS = config.openwa.url;
const HEADERS = { 'Content-Type': 'application/json', 'x-api-key': config.openwa.apiKey };

let sessionId = null;
let ownerPhone = null;
let socket = null;
let onMessageCallback = null;
let onStatusCallback = null;
let connected = false;

// --- REST API ---
async function api(method, pathStr, body) {
  var url = API + pathStr;
  var opts = { method: method, headers: HEADERS };
  if (body) opts.body = JSON.stringify(body);
  try {
    var res = await fetch(url, opts);
    var data = await res.json();
    if (!res.ok) throw new Error(res.status + ': ' + JSON.stringify(data).slice(0, 100));
    return data;
  } catch (err) {
    log.openwa('❌ API ' + method + ' ' + pathStr + ' → gagal: ' + err.message.split('\n')[0]);
    return null;
  }
}

// --- Session ---
async function getSession() {
  log.arrow('🔍 Mencari session aktif...');
  var sessions = await api('GET', '/sessions?limit=10');
  if (!sessions || !sessions.length) {
    log.openwa('📭 Tidak ditemukan session aktif');
    return null;
  }
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    var mark = (s.status === 'connected' || s.status === 'ready') ? ' ✅' : ' ⬜';
    log.info('   └ ' + s.name + ' (' + s.status + ')' + mark);
  }
  var ready = sessions.find(function(s) { return s.status === 'connected' || s.status === 'ready'; });
  return ready || sessions[0];
}

async function initSession() {
  var session = await getSession();
  if (!session) return false;
  sessionId = session.id;
  ownerPhone = session.phone || null;
  log.ok('Session terpilih: ' + session.name + ' (' + session.status + ')');
  if (ownerPhone) log.info('📱 Owner: ' + ownerPhone);
  if (onStatusCallback) onStatusCallback({ connected: true, session: session, ownerPhone: ownerPhone });
  return true;
}

// --- Messaging ---
async function sendText(chatId, text, options) {
  if (!sessionId) return null;
  return api('POST', '/sessions/' + sessionId + '/messages/send-text', {
    chatId: chatId,
    text: text,
    mentions: (options && options.mentions) ? options.mentions : undefined,
    quotedMsgId: (options && options.quotedMsgId) ? options.quotedMsgId : undefined,
  });
}

async function replyText(chatId, quotedMsgId, text) {
  if (!sessionId) return null;
  return api('POST', '/sessions/' + sessionId + '/messages/reply', {
    chatId: chatId,
    quotedMsgId: quotedMsgId,
    text: text,
  });
}

async function sendTyping(chatId) {
  if (!sessionId) return;
  api('POST', '/sessions/' + sessionId + '/chats/typing', { chatId: chatId, state: 'typing' }).catch(function() {});
}

// --- Chat & Contact Data ---
async function getChats(limit) {
  if (!sessionId) return [];
  var chats = await api('GET', '/sessions/' + sessionId + '/chats?limit=' + (limit || 50));
  return chats || [];
}

async function getChatMessages(chatId, limit) {
  if (!sessionId) return [];
  var msgs = await api('GET', '/sessions/' + sessionId + '/messages?chatId=' + encodeURIComponent(chatId) + '&limit=' + (limit || 10));
  return msgs || [];
}

// --- Socket.IO Connection ---
function connectSocket() {
  var io = require('socket.io-client');
  if (socket) socket.disconnect();

  log.arrow('🔌 Menghubungkan Socket.IO → ' + WS + '/events');

  socket = io(WS + '/events', {
    auth: { apiKey: config.openwa.apiKey },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 3000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', function() {
    connected = true;
    log.ok('Socket.IO terhubung ✅');
  });

  socket.on('disconnect', function(reason) {
    connected = false;
    log.warn('Socket.IO terputus: ' + reason);
    if (onStatusCallback) onStatusCallback({ connected: false, reason: reason });
  });

  socket.on('connect_error', function(err) {
    log.err('Socket.IO error: ' + err.message);
  });

  socket.on('message', function(msg) {
    if (msg.type === 'event') {
      var event = msg.payload.event;
      var sId = msg.payload.sessionId;
      var data = msg.payload.data;
      switch (event) {
        case 'message.received':
          if (onMessageCallback && sId === sessionId) onMessageCallback(data);
          break;
        case 'session.status':
          if (onStatusCallback) onStatusCallback({ statusEvent: data, sessionId: sId });
          break;
        case 'session.authenticated':
          if (data.phone) {
            ownerPhone = data.phone;
            log.ok('Owner teridentifikasi: ' + ownerPhone);
          }
          break;
      }
    }
  });

  // Subscribe ke events
  setTimeout(function() {
    if (socket.connected && sessionId) {
      socket.emit('message', {
        type: 'subscribe',
        sessionId: sessionId,
        events: ['message.received', 'message.sent', 'session.status', 'session.authenticated'],
      });
      log.ok('Subscribe events aktif (session: ' + sessionId.slice(0, 8) + '...)');
    } else {
      log.warn('Socket belum terhubung, subscribe ditunda');
    }
  }, 500);
}

function onMessage(cb) { onMessageCallback = cb; }
function onStatus(cb) { onStatusCallback = cb; }
function getSessionId() { return sessionId; }
function getOwnerPhone() { return ownerPhone; }
function isConnected() { return connected; }

module.exports = {
  initSession: initSession,
  connectSocket: connectSocket,
  sendText: sendText,
  replyText: replyText,
  sendTyping: sendTyping,
  getChats: getChats,
  getChatMessages: getChatMessages,
  onMessage: onMessage,
  onStatus: onStatus,
  getSessionId: getSessionId,
  getOwnerPhone: getOwnerPhone,
  isConnected: isConnected,
  api: api,
};
