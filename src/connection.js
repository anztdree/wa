import { 
  makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import readline from 'readline';
import pino from 'pino';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { saveMessage } from './db.js';

// ==================== LOGGER STYLISH ====================
const log = {
  info:  (msg, ...args) => console.log(`\x1b[36m[ℹ️]\x1b[0m  ${msg}`, ...args),
  ok:    (msg, ...args) => console.log(`\x1b[32m[✅]\x1b[0m  ${msg}`, ...args),
  warn:  (msg, ...args) => console.log(`\x1b[33m[⚠️]\x1b[0m  ${msg}`, ...args),
  fail:  (msg, ...args) => console.log(`\x1b[31m[❌]\x1b[0m  ${msg}`, ...args),
  pp:    (msg, ...args) => console.log(`\x1b[35m[🖼️ PP]\x1b[0m  ${msg}`, ...args),
  name:  (msg, ...args) => console.log(`\x1b[34m[📛 NAMA]\x1b[0m  ${msg}`, ...args),
  hist:  (msg, ...args) => console.log(`\x1b[90m[📜 HIST]\x1b[0m  ${msg}`, ...args),
  cache: (msg, ...args) => console.log(`\x1b[90m[💾 CACHE]\x1b[0m  ${msg}`, ...args),
  conn:  (msg, ...args) => console.log(`\x1b[36m[🔗 CONN]\x1b[0m  ${msg}`, ...args),
  msg:   (msg, ...args) => console.log(`\x1b[90m[💬 MSG]\x1b[0m  ${msg}`, ...args),
  sep:   ()           => console.log('\x1b[90m' + '─'.repeat(50) + '\x1b[0m'),
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = pino({ level: 'silent' });

let sock = null;
export let currentWaStatus = 'close';
const groupMetadataCache = new Map();
const ppCache = new Map();
const nameCache = new Map();
const noPPSet = new Set(); // JIDs yang sudah diketahui tidak punya PP

// Helper: cek apakah JID adalah personal (bukan grup/status)
const isPersonalJid = (jid) => jid && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid'));

const CACHE_DIR = path.join(__dirname, '..');
const PP_CACHE_FILE = path.join(CACHE_DIR, 'pp_cache.json');
const NAME_CACHE_FILE = path.join(CACHE_DIR, 'name_cache.json');
const NO_PP_FILE = path.join(CACHE_DIR, 'no_pp_set.json');

// ==================== PERSISTENCE ====================
function loadJSONCache(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return new Map(Object.entries(data));
    }
  } catch (e) {
    console.log(`[CACHE] Gagal load ${path.basename(filePath)}: ${e.message}`);
  }
  return new Map();
}

function saveJSONCache(filePath, cache) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(Object.fromEntries(cache), null, 2));
  } catch (e) {}
}

function savePPToFile(jid, url) {
  ppCache.set(jid, url);
  saveJSONCache(PP_CACHE_FILE, ppCache);
}

function saveNameToFile(jid, name) {
  nameCache.set(jid, name);
  saveJSONCache(NAME_CACHE_FILE, nameCache);
}

// Load cache dari file saat startup
const loadedPP = loadJSONCache(PP_CACHE_FILE);
loadedPP.forEach((v, k) => ppCache.set(k, v));
if (ppCache.size > 0) log.cache(`PP cache loaded → ${ppCache.size} entries`);

const loadedNames = loadJSONCache(NAME_CACHE_FILE);
loadedNames.forEach((v, k) => nameCache.set(k, v));
if (nameCache.size > 0) log.cache(`Name cache loaded → ${nameCache.size} entries`);

// Load no-PP set
try {
  if (fs.existsSync(NO_PP_FILE)) {
    const arr = JSON.parse(fs.readFileSync(NO_PP_FILE, 'utf-8'));
    if (Array.isArray(arr)) arr.forEach(j => noPPSet.add(j));
    if (noPPSet.size > 0) log.cache(`No-PP set loaded → ${noPPSet.size} entries`);
  }
} catch (e) {}

function saveNoPPSet() {
  try { fs.writeFileSync(NO_PP_FILE, JSON.stringify([...noPPSet])); } catch (e) {}
}

// ==================== PROFILE PICTURE ====================
async function fetchPP(jid, emitEvent) {
  if (!sock || ppCache.has(jid) || noPPSet.has(jid)) return;
  try {
    log.pp(`Fetching → ${jid}`);
    const url = await sock.profilePictureUrl(jid, 'image');
    log.ok(`Got PP → ${jid}`);
    savePPToFile(jid, url);
    if (emitEvent) emitEvent('profile_picture', { jid, url });
  } catch (e) {
    noPPSet.add(jid);
    saveNoPPSet();
    log.warn(`No PP → ${jid} (cached, won't retry)`);
  }
}

async function batchFetchPP(jids, emitEvent) {
  const toFetch = jids.filter(jid => !ppCache.has(jid) && !noPPSet.has(jid));
  const skipped = jids.length - toFetch.length;
  if (toFetch.length === 0) {
    log.pp(`✅ Semua PP sudah cached / no-PP (${skipped} skipped)`);
    return;
  }
  log.pp(`Batch fetching ${toFetch.length} PP... (${skipped} already known)`);
  let success = 0, noPP = 0;
  for (const jid of toFetch) {
    if (!sock) break;
    await fetchPP(jid, emitEvent);
    if (ppCache.has(jid)) success++; else noPP++;
    await new Promise(r => setTimeout(r, 300));
  }
  log.ok(`Batch PP done → ✨ ${success} baru, 🚫 ${noPP} no-PP, ⏭️ ${skipped} skip, 📦 ${ppCache.size} total`);
}

// ==================== PHONE NUMBER ====================
const askPhoneNumber = () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('\n\ud83d\udcf1 Masukkan nomor WhatsApp (contoh: 628123456789): ', (answer) => {
      rl.close();
      resolve(answer);
    });
  });
};

// ==================== CONTACT NAME ====================
export async function getChatName(jid, pushName = '') {
  if (!jid) return 'Tanpa Nama';
  
  // 1. Dari cache (file + memory)
  if (nameCache.has(jid)) return nameCache.get(jid);

  // 2. Grup
  if (jid.endsWith('@g.us')) {
    if (groupMetadataCache.has(jid)) {
      return groupMetadataCache.get(jid);
    }
    try {
      if (sock) {
        const metadata = await sock.groupMetadata(jid);
        if (metadata && metadata.subject) {
          groupMetadataCache.set(jid, metadata.subject);
          saveNameToFile(jid, metadata.subject);
          return metadata.subject;
        }
      }
    } catch (e) {
      log.warn(`Gagal fetch grup metadata → ${jid}`);
    }
    return 'Grup WhatsApp';
  }

  // 3. Personal (@s.whatsapp.net atau @lid) — pakai pushName dari pesan
  if (isPersonalJid(jid)) {
    if (pushName && pushName.trim() !== '' && pushName.trim() !== 'undefined' && !/^\d+$/.test(pushName.trim())) {
      saveNameToFile(jid, pushName.trim());
      log.name(`Resolved (pushName) → ${jid} = "${pushName.trim()}"`);
      return pushName.trim();
    }
  }

  // 4. Fallback: nomor mentah
  const cleanNum = jid.replace(/@s\.whatsapp\.net|@lid|@g\.us/g, '');
  return cleanNum.startsWith('62') ? `+${cleanNum}` : cleanNum;
}

// ==================== EXPORT CACHE GETTERS ====================
export function getPPCache() {
  return Object.fromEntries(ppCache);
}

export function getNameCache() {
  return Object.fromEntries(nameCache);
}

// ==================== MAIN CONNECTION ====================
export async function connectWhatsApp(emitEvent) {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    printQRInTerminal: false,
    syncFullHistory: true
  });

  if (!sock.authState.creds.registered) {
    const rawNumber = await askPhoneNumber();
    const cleanNumber = rawNumber.replace(/[^0-9]/g, '');

    if (!cleanNumber) {
      console.log('Nomor tidak valid!');
      process.exit(1);
    }

    console.log('Meminta kode pairing...');
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(cleanNumber);
        const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
        console.log(`\nKODE PAIRING: ${formattedCode}\n`);
        if (emitEvent) emitEvent('pairing_code', formattedCode);
      } catch (err) {
        console.error('Gagal pairing:', err.message);
      }
    }, 3000);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection) {
      currentWaStatus = connection;
      if (emitEvent) emitEvent('status', currentWaStatus);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      currentWaStatus = 'connecting';
      if (emitEvent) emitEvent('status', 'connecting');

      if (shouldReconnect) {
        log.warn(`Koneksi terputus (code: ${statusCode}), reconnecting...`);
        connectWhatsApp(emitEvent);
      } else {
        log.fail(`Logged out. Tidak reconnect.`);
        currentWaStatus = 'close';
        if (emitEvent) emitEvent('status', 'close');
      }
    } else if (connection === 'open') {
      log.ok('🟢 WhatsApp CONNECTED!');
      log.sep();

      // Kirim cache ke UI saat koneksi baru
      if (emitEvent) {
        if (nameCache.size > 0) {
          emitEvent('name_cache', Object.fromEntries(nameCache));
          log.info(`📡 name_cache dikirim ke UI → ${nameCache.size} entries`);
        }
        if (ppCache.size > 0) {
          emitEvent('pp_cache', Object.fromEntries(ppCache));
          log.info(`📡 pp_cache dikirim ke UI → ${ppCache.size} entries`);
        }
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ==================== CONTACTS SYNC (NAMA KONTAK HP) ====================
  sock.ev.on('contacts.set', ({ contacts }) => {
    if (!contacts || contacts.length === 0) return;
    let count = 0;
    for (const c of contacts) {
      if (!c.id || !c.name || c.name.trim() === '') continue;
      const name = c.name.trim();
      // Skip kalau cuma angka
      if (/^\d+$/.test(name)) continue;
      // Cek apakah JID ini ada di nameCache dengan nama mentah
      const existing = nameCache.get(c.id);
      if (!existing || /^\+?\d+$/.test(existing) || existing.includes('@')) {
        nameCache.set(c.id, name);
        count++;
      }
    }
    saveJSONCache(NAME_CACHE_FILE, nameCache);
    log.name(`📱 contacts.set → ${count}/${contacts.length} nama kontak diproses`);
    // Kirim update ke UI
    if (emitEvent && count > 0) {
      emitEvent('name_cache', Object.fromEntries(nameCache));
      log.info(`📡 name_cache dikirim ke UI (${nameCache.size} entries)`);
    }
  });

  // ==================== GROUPS SYNC ====================
  sock.ev.on('groups.set', ({ groups }) => {
    if (!groups || groups.length === 0) return;
    let count = 0;
    for (const g of groups) {
      if (g.id && g.subject) {
        groupMetadataCache.set(g.id, g.subject);
        saveNameToFile(g.id, g.subject);
        count++;
      }
    }
    if (count > 0) log.name(`👥 groups.set → ${count} grup diperbarui`);
    if (emitEvent && count > 0) {
      emitEvent('name_cache', Object.fromEntries(nameCache));
    }
  });

  // ==================== HISTORY SYNC ====================
  sock.ev.on('messaging-history.set', async ({ messages, chats: chatMap, isLatest }) => {
    const msgCount = messages?.length || 0;
    const chatCount = chatMap ? Object.keys(chatMap).length : 0;
    log.hist(`📥 Sync incoming → ${msgCount} pesan, ${chatCount} chats, isLatest=${isLatest}`);

    // 1. Proses chats metadata untuk ambil NAMA
    let nameCount = 0;
    let debugLogged = 0;
    if (chatMap) {
      for (const [jid, chatData] of Object.entries(chatMap)) {
        if (!jid || !chatData) continue;
        
        // Debug: log 5 pertama untuk lihat struktur
        if (debugLogged < 5) {
          log.hist(`📋 Chat[${debugLogged}] → jid=${jid}, name="${chatData.name || '(empty)'}", notify="${chatData.notify || '(empty)'}"`);
          debugLogged++;
        }

        // Grup — ambil nama dari chatData.name
        if (jid.endsWith('@g.us') && chatData.name) {
          groupMetadataCache.set(jid, chatData.name);
          saveNameToFile(jid, chatData.name);
          nameCount++;
        }
        // Personal chat — handle @s.whatsapp.net DAN @lid
        if (isPersonalJid(jid)) {
          const name = chatData.name?.trim();
          const notify = chatData.notify?.trim();
          
          if (name && !/^\d+$/.test(name)) {
            saveNameToFile(jid, name);
            nameCount++;
          } else if (notify && !/^\d+$/.test(notify)) {
            if (!nameCache.has(jid)) {
              saveNameToFile(jid, notify);
              nameCount++;
            }
          }
        }
      }
    }
    log.name(`Ditemukan ${nameCount} nama dari chat metadata`);

    // 2. Proses pesan
    const allJids = new Set();
    let savedCount = 0;
    if (messages && messages.length > 0) {
      for (const msg of messages) {
        await processIncomingMessage(msg, emitEvent);
        const jid = msg.key?.remoteJid;
        if (jid && jid !== 'status@broadcast') allJids.add(jid);
        savedCount++;
      }
    }
    log.hist(`💾 ${savedCount} pesan diproses, ${allJids.size} unique JID`);

    // 3. Kirim cache ke UI
    if (emitEvent) {
      if (nameCache.size > 0) {
        emitEvent('name_cache', Object.fromEntries(nameCache));
        log.info(`📡 name_cache → UI (${nameCache.size} entries)`);
      }
      if (ppCache.size > 0) {
        emitEvent('pp_cache', Object.fromEntries(ppCache));
        log.info(`📡 pp_cache → UI (${ppCache.size} entries)`);
      }
    }

    // 4. Batch fetch PP di background (hanya jika isLatest)
    if (emitEvent && allJids.size > 0 && isLatest) {
      const toFetch = [...allJids].filter(jid => !ppCache.has(jid));
      if (toFetch.length > 0) {
        log.pp(`⏳ Akan fetch PP untuk ${toFetch.length} kontak baru dalam 3s...`);
        setTimeout(() => batchFetchPP(toFetch, emitEvent), 3000);
      } else {
        log.pp(`✅ Semua PP sudah cached`);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      await processIncomingMessage(msg, emitEvent);
    }
  });

  log.info(`Socket created → browser: Ubuntu/Chrome/20.0.04`);
  return sock;
}

// ==================== PROCESS MESSAGE ====================
async function processIncomingMessage(msg, emitEvent) {
  if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

  const from = msg.key.remoteJid;
  const isMe = msg.key.fromMe;
  const rawPushName = msg.pushName || '';
  const displayName = await getChatName(from, rawPushName);
  
  const text = msg.message.conversation || 
               msg.message.extendedTextMessage?.text || 
               msg.message.imageMessage?.caption || '';

  if (text) {
    const rawTimestamp = (msg.messageTimestamp?.low || msg.messageTimestamp || Date.now() / 1000) * 1000;
    
    saveMessage(from, displayName, text, isMe, rawTimestamp);

    if (emitEvent) {
      emitEvent('new_message', { 
        from, 
        pushName: displayName, 
        text, 
        isMe, 
        timestamp: rawTimestamp,
        profilePictureUrl: ppCache.get(from) || ''
      });
      fetchPP(from, emitEvent);
    }
  }
}

// ==================== SEND MESSAGE ====================
export async function sendMessage(to, text) {
  if (!sock || currentWaStatus !== 'open') throw new Error('WhatsApp belum terhubung!');
  const formattedJid = to.includes('@') ? to : `${to.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
  
  const result = await sock.sendMessage(formattedJid, { text });
  const rawTimestamp = Date.now();
  const displayName = await getChatName(formattedJid);

  saveMessage(formattedJid, displayName, text, true, rawTimestamp);

  return { result, timestamp: rawTimestamp, displayName };
}
