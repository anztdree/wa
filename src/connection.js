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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = pino({ level: 'silent' });

let sock = null;
export let currentWaStatus = 'close';
const groupMetadataCache = new Map();
const ppCache = new Map();
const nameCache = new Map();

const CACHE_DIR = path.join(__dirname, '..');
const PP_CACHE_FILE = path.join(CACHE_DIR, 'pp_cache.json');
const NAME_CACHE_FILE = path.join(CACHE_DIR, 'name_cache.json');

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
console.log(`[CACHE] PP cache loaded: ${ppCache.size} entries`);

const loadedNames = loadJSONCache(NAME_CACHE_FILE);
loadedNames.forEach((v, k) => nameCache.set(k, v));
console.log(`[CACHE] Name cache loaded: ${nameCache.size} entries`);

// ==================== PROFILE PICTURE ====================
async function fetchPP(jid, emitEvent) {
  if (!sock || ppCache.has(jid)) return;
  try {
    console.log(`[PP] Fetching: ${jid}`);
    const url = await sock.profilePictureUrl(jid, 'image');
    console.log(`[PP] Got: ${jid} -> ${url ? url.substring(0, 60) + '...' : 'null'}`);
    savePPToFile(jid, url);
    if (emitEvent) emitEvent('profile_picture', { jid, url });
  } catch (e) {
    console.log(`[PP] No PP for: ${jid}`);
  }
}

async function batchFetchPP(jids, emitEvent) {
  console.log(`[PP] Batch fetching ${jids.length} profile pictures...`);
  let success = 0;
  for (const jid of jids) {
    if (!sock) break;
    if (!ppCache.has(jid)) {
      await fetchPP(jid, emitEvent);
      if (ppCache.has(jid)) success++;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`[PP] Batch done: ${success} new, ${ppCache.size} total cached`);
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
      console.log(`[NAME] Gagal fetch grup metadata: ${jid}`);
    }
    return 'Grup WhatsApp';
  }

  // 3. Personal — pakai pushName dari pesan
  if (pushName && pushName.trim() !== '' && pushName.trim() !== 'undefined') {
    saveNameToFile(jid, pushName.trim());
    return pushName.trim();
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
        connectWhatsApp(emitEvent);
      } else {
        currentWaStatus = 'close';
        if (emitEvent) emitEvent('status', 'close');
      }
    } else if (connection === 'open') {
      console.log('WA Connected!');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ==================== HISTORY SYNC ====================
  sock.ev.on('messaging-history.set', async ({ messages, chats: chatMap, isLatest }) => {
    console.log(`[HISTORY] Sync: ${messages?.length || 0} pesan, ${chatMap ? Object.keys(chatMap).length : 0} chats, isLatest=${isLatest}`);

    // 1. Proses chats metadata untuk ambil NAMA
    let nameCount = 0;
    if (chatMap) {
      for (const [jid, chatData] of Object.entries(chatMap)) {
        if (!jid || !chatData) continue;
        
        // Log struktur chatData untuk debug
        if (nameCount < 5) {
          console.log(`[HISTORY] Chat ${jid}: name="${chatData.name || '(empty)'}" notify="${chatData.notify || '(empty)'}"`);
        }

        // Grup
        if (jid.endsWith('@g.us') && chatData.name) {
          groupMetadataCache.set(jid, chatData.name);
          saveNameToFile(jid, chatData.name);
          nameCount++;
        }
        // Personal chat
        if (jid.endsWith('@s.whatsapp.net')) {
          if (chatData.name && chatData.name.trim() && !/^\d+$/.test(chatData.name.trim())) {
            saveNameToFile(jid, chatData.name.trim());
            nameCount++;
          }
          if (chatData.notify && chatData.notify.trim() && !/^\d+$/.test(chatData.notify.trim())) {
            if (!nameCache.has(jid)) {
              saveNameToFile(jid, chatData.notify.trim());
              nameCount++;
            }
          }
        }
      }
    }
    console.log(`[HISTORY] ${nameCount} nama kontak ditemukan dari chat metadata`);

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
    console.log(`[HISTORY] ${savedCount} pesan diproses, ${allJids.size} unique JID`);

    // 3. Kirim cache ke UI
    if (emitEvent) {
      if (nameCache.size > 0) {
        emitEvent('name_cache', Object.fromEntries(nameCache));
        console.log(`[HISTORY] name_cache dikirim ke UI: ${nameCache.size} entries`);
      }
      if (ppCache.size > 0) {
        emitEvent('pp_cache', Object.fromEntries(ppCache));
        console.log(`[HISTORY] pp_cache dikirim ke UI: ${ppCache.size} entries`);
      }
    }

    // 4. Batch fetch PP di background
    if (emitEvent && allJids.size > 0 && isLatest) {
      const toFetch = [...allJids].filter(jid => !ppCache.has(jid));
      if (toFetch.length > 0) {
        console.log(`[HISTORY] Akan fetch PP untuk ${toFetch.length} kontak baru...`);
        setTimeout(() => batchFetchPP(toFetch, emitEvent), 3000);
      } else {
        console.log(`[HISTORY] Semua PP sudah di-cache`);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      await processIncomingMessage(msg, emitEvent);
    }
  });

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
