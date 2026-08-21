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

// ==================== PATH STRUCTURE ====================
// Semua file auto-generate disimpan di data/ — root folder tetap bersih.
const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_DIR = path.join(DATA_DIR, 'config');
const CACHE_FILES_DIR = path.join(DATA_DIR, 'cache');
const DB_DIR = path.join(DATA_DIR, 'db');
const AUTH_DIR = path.join(DATA_DIR, 'auth_info');

// Auto-create subfolders on first run
for (const d of [DATA_DIR, CONFIG_DIR, CACHE_FILES_DIR, DB_DIR, AUTH_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ==================== STYLISH LOGGER ====================
// Format: HH:mm:ss.SSS  EMOJI  Label  →  Value  ·  Value  ·  ...
//           ↳  sub-detail (untuk informasi tambahan)

const COLORS = {
  reset:   '\x1b[0m',
  dim:     '\x1b[2m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  gray:    '\x1b[90m',
  redBg:   '\x1b[41;30m',
  yelBg:   '\x1b[43;30m',
  grnBg:   '\x1b[42;30m',
  bold:    '\x1b[1m',
};

function ts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtLine(emoji, label, value, color) {
  const t = `${COLORS.cyan}${ts()}${COLORS.reset}`;
  const e = `${color}${emoji}${COLORS.reset}`;
  const l = label ? `${COLORS.bold}${color}${label}${COLORS.reset}` : '';
  const arrow = label && value ? `${COLORS.dim}→${COLORS.reset}` : '';
  const v = value || '';
  if (label && value) {
    return console.log(`${t}  ${e}  ${l}  ${arrow}  ${v}`);
  } else if (label) {
    return console.log(`${t}  ${e}  ${l}`);
  } else if (value) {
    return console.log(`${t}  ${e}  ${v}`);
  }
  return console.log(`${t}  ${e}`);
}

function fmtSub(label, value, valueColor) {
  const t = `${COLORS.cyan}${ts()}${COLORS.reset}`;
  const l = label ? `${COLORS.blue}${label.padEnd(14, ' ')}${COLORS.reset}` : '';
  const vc = valueColor || COLORS.cyan;
  const v = value ? `${vc}${value}${COLORS.reset}` : '';
  return console.log(`${t}                 ${COLORS.dim}↳${COLORS.reset}  ${l} ${COLORS.dim}:${COLORS.reset}  ${v}`);
}

// Helper: warnai value biar log lebih hidup
const C = {
  num:  (v) => `${COLORS.yellow}${v}${COLORS.reset}`,
  ms:   (v) => `${COLORS.yellow}${v}${COLORS.dim}ms${COLORS.reset}`,
  sec:  (v) => `${COLORS.yellow}${v}${COLORS.dim}s${COLORS.reset}`,
  str:  (v) => `${COLORS.cyan}${v}${COLORS.reset}`,
  ok:   (v) => `${COLORS.green}${v}${COLORS.reset}`,
  err:  (v) => `${COLORS.red}${v}${COLORS.reset}`,
  dim:  (v) => `${COLORS.dim}${v}${COLORS.reset}`,
  tok:  (v) => `${COLORS.magenta}${v}${COLORS.reset}`,
  prov: (v) => `${COLORS.blue}${v}${COLORS.reset}`,
  dot:  () => `${COLORS.dim}·${COLORS.reset}`,
  arrow:() => `${COLORS.dim}→${COLORS.reset}`,
  k:    (v) => `${COLORS.dim}${v}${COLORS.reset}`,  // key/unit text
  b:    (v) => `${COLORS.bold}${v}${COLORS.reset}`, // bold
};

const SEP_THIN  = () => console.log(`${COLORS.dim}${'━'.repeat(69)}${COLORS.reset}`);
const SEP_BOLD_TOP    = () => console.log(`${COLORS.cyan}${'═'.repeat(69)}${COLORS.reset}`);
const SEP_BOLD_BOT    = () => console.log(`${COLORS.cyan}${'═'.repeat(69)}${COLORS.reset}`);
const SEP_SUB         = () => console.log(`${COLORS.dim}   ${'─'.repeat(37)}${COLORS.reset}`);

const log = {
  // Boot / connection
  boot:  (v) => fmtLine('🌐', 'Memuat', v, COLORS.cyan),
  conn:  (v) => fmtLine('🔗', null, v, COLORS.cyan),
  pair:  (v) => fmtLine('📱', 'Kode pairing dibuat', v, COLORS.cyan),
  ok:    (v) => fmtLine('🟢', null, v, COLORS.green),
  ready: (v) => fmtLine('✅', 'Bot siap menerima pesan', v, COLORS.green),

  // Cache
  cache: (l, v) => fmtLine('💾', `Cache ${l} dimuat`, v, COLORS.gray),

  // Sync
  sync:  (l, v) => fmtLine('📥', l, v, COLORS.blue),
  hist:  (v) => fmtLine('💬', 'Konteks percakapan', v, COLORS.gray),
  name:  (v) => fmtLine('👤', 'Nama kontak dipetakan', v, COLORS.gray),
  pp:    (v) => fmtLine('🖼️', 'Foto profil diambil', v, COLORS.gray),

  // Messages & AI
  in:    (v) => fmtLine('📩', 'Pesan masuk dari', v, COLORS.blue),
  ai:    (v) => fmtLine('🤖', 'Memanggil AI', v, COLORS.magenta),
  aiOk:  (v) => fmtLine('✨', 'AI menjawab', v, COLORS.green),
  typOn: () => fmtLine('⌨️', 'Mengetik...', 'pengirim melihat "sedang mengetik..."', COLORS.yellow),
  typOff:() => fmtLine('⏹️', 'Mengetik selesai', null, COLORS.yellow),
  wait:  (v) => fmtLine('⏳', 'Jeda alami', v, COLORS.gray),
  send:  (v) => fmtLine('📤', 'Balasan dikirim', v, COLORS.magenta),
  done:  (v) => fmtLine('✅', 'Selesai', v, COLORS.green),

  // Errors / warnings
  err:   (v) => fmtLine('❌', 'ERROR', v, COLORS.red),
  warn:  (v) => fmtLine('⚠️', 'PERINGATAN', v, COLORS.yellow),
  crit:  (v) => fmtLine('🚨', 'KRITIKAL', v, COLORS.redBg + COLORS.bold),
  retry: (v) => fmtLine('🔁', 'Mengulang percobaan', v, COLORS.yellow),
  recover: (v) => fmtLine('✅', 'Berhasil pulih', v, COLORS.green),
  stat:  (l, v) => fmtLine('📊', l, v, COLORS.green),
  info:  (l, v) => fmtLine('ℹ️', l, v, COLORS.blue),
  sep:   SEP_THIN,

  // Sub-detail (one-line continuation with ↳)
  sub:   (l, v, vc) => fmtSub(l, v, vc),
};

// ==================== AUTO-MIGRATE OLD FILES ====================
// Pindahkan file/folder lama dari root ke data/ (backward compat)
function migrateOldFiles() {
  const ROOT = path.join(__dirname, '..');
  const moves = [
    ['pp_cache.json',    path.join(CACHE_FILES_DIR, 'pp_cache.json')],
    ['name_cache.json',  path.join(CACHE_FILES_DIR, 'name_cache.json')],
    ['no_pp_set.json',   path.join(CACHE_FILES_DIR, 'no_pp_set.json')],
    ['ai_config.json',   path.join(CONFIG_DIR, 'ai_config.json')],
    ['messages.db',      path.join(DB_DIR, 'messages.db')],
  ];
  let migrated = 0;
  for (const [src, dst] of moves) {
    const srcPath = path.join(ROOT, src);
    if (fs.existsSync(srcPath) && !fs.existsSync(dst)) {
      try {
        fs.renameSync(srcPath, dst);
        log.cache('migrasi', `${src} → data/${path.relative(DATA_DIR, dst).replace(/\\/g, '/')}`);
        migrated++;
      } catch (e) { /* ignore */ }
    }
  }
  // Migrasi folder auth_info lama (kalau ada dan auth_info baru kosong)
  const oldAuth = path.join(ROOT, 'auth_info');
  if (fs.existsSync(oldAuth)) {
    const oldFiles = fs.readdirSync(oldAuth).filter(f => !f.startsWith('.'));
    const newFiles = fs.readdirSync(AUTH_DIR).filter(f => !f.startsWith('.'));
    if (oldFiles.length > 0 && newFiles.length === 0) {
      try {
        for (const f of oldFiles) {
          fs.renameSync(path.join(oldAuth, f), path.join(AUTH_DIR, f));
        }
        fs.rmdirSync(oldAuth);
        log.cache('migrasi', `auth_info/ → data/auth_info/ (${oldFiles.length} file)`);
        migrated += oldFiles.length;
      } catch (e) { /* ignore */ }
    }
  }
  if (migrated > 0) log.ok(`${migrated} file lama dipindahkan ke data/`);
}
migrateOldFiles();

let sock = null;
export let currentWaStatus = 'close';
const groupMetadataCache = new Map();
const ppCache = new Map();
const nameCache = new Map();
const noPPSet = new Set();
const repliedMsgIds = new Set(); // dedup auto-reply
const processedMsgIds = new Set(); // dedup ALL message processing

// Helper: cek apakah JID adalah personal (bukan grup/status)
const isPersonalJid = (jid) => jid && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid'));

const PP_CACHE_FILE = path.join(CACHE_FILES_DIR, 'pp_cache.json');
const NAME_CACHE_FILE = path.join(CACHE_FILES_DIR, 'name_cache.json');
const NO_PP_FILE = path.join(CACHE_FILES_DIR, 'no_pp_set.json');

// ==================== AI PROVIDER REGISTRY ====================
const AI_PROVIDERS = {
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    icon: '⚡',
    color: '#76B900',
    description: '100+ model gratis, termasuk Llama, Gemma, Qwen, Mistral, DeepSeek, GLM',
    freeLimit: '1.000 kredit/bulan (cukup ~5K chat)',
    apiBaseUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
    apiKeyUrl: 'https://build.nvidia.com/',
    models: [
      { id: 'google/gemma-4-31b-it',       name: 'Gemma 4 31B',        tag: 'best',    desc: 'Kualitas terbaik, bahasa alami' },
      { id: 'meta/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B', tag: 'fast', desc: 'Cepat & cerdas' },
      { id: 'meta/llama-3.3-70b-instruct',  name: 'Llama 3.3 70B',     tag: 'popular', desc: 'Paling populer' },
      { id: 'qwen/qwen3-32b',               name: 'Qwen 3 32B',        tag: '',        desc: 'Bagus multibahasa' },
      { id: 'deepseek-ai/deepseek-r1',      name: 'DeepSeek R1',       tag: 'reason',  desc: 'Reasoning kuat' },
      { id: 'mistralai/mistral-large-3',    name: 'Mistral Large 3',   tag: '',        desc: 'Model terbaru Mistral' },
      { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B', tag: '', desc: 'Optimasi NVIDIA' },
    ],
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    icon: '✨',
    color: '#4285F4',
    description: 'Model Google, free tier sangat generous (15 RPM, 1M TPM)',
    freeLimit: '15 RPM · 1 juta token/menit · 1.500 RPD',
    apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    models: [
      { id: 'gemini-2.5-flash',              name: 'Gemini 2.5 Flash',     tag: 'best',    desc: 'Hybrid reasoning, cepat' },
      { id: 'gemini-2.5-flash-lite',         name: 'Gemini 2.5 Flash Lite', tag: 'fast',  desc: 'Paling cepat & murah' },
      { id: 'gemini-2.0-flash',              name: 'Gemini 2.0 Flash',     tag: 'popular', desc: 'Stabil & reliable' },
      { id: 'gemini-2.0-flash-lite',         name: 'Gemini 2.0 Flash Lite', tag: 'fast',  desc: 'Ultra ringan' },
    ],
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    icon: '🚀',
    color: '#F55036',
    description: 'Inference tercepat (LPU chip), 14.400 request/hari gratis',
    freeLimit: '30 RPM · 30K TPM · 14.400 RPD',
    apiBaseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    apiKeyUrl: 'https://console.groq.com/keys',
    models: [
      { id: 'llama-3.3-70b-versatile',      name: 'Llama 3.3 70B',     tag: 'best',    desc: 'Paling cerdas di Groq' },
      { id: 'llama-3.1-8b-instant',          name: 'Llama 3.1 8B',     tag: 'fast',    desc: 'Super cepat' },
      { id: 'llama4-scout-17b-16e-instruct', name: 'Llama 4 Scout',    tag: 'popular', desc: 'MoE, cerdas & cepat' },
      { id: 'qwen3-32b',                     name: 'Qwen 3 32B',       tag: '',        desc: 'Multibahasa bagus' },
      { id: 'mistral-saba-24b',              name: 'Mistral Saba 24B', tag: '',        desc: 'Baru dari Mistral' },
      { id: 'gemma2-9b-it',                  name: 'Gemma 2 9B',       tag: '',        desc: 'Google Gemma' },
    ],
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral AI',
    icon: '🇫🇷',
    color: '#FF7000',
    description: 'Free "Experiment" plan, ~1 miliar token/bulan, no credit card',
    freeLimit: '~1 RPS · 500K TPM · ~1B token/bulan',
    apiBaseUrl: 'https://api.mistral.ai/v1/chat/completions',
    apiKeyUrl: 'https://console.mistral.ai/api-keys',
    models: [
      { id: 'mistral-large-latest',           name: 'Mistral Large 3',   tag: 'best',    desc: 'Paling cerdas dari Mistral' },
      { id: 'mistral-medium-latest',           name: 'Mistral Medium',   tag: 'popular', desc: 'Seimbang cepat & cerdas' },
      { id: 'mistral-small-latest',            name: 'Mistral Small',    tag: 'fast',    desc: 'Super cepat & murah' },
      { id: 'codestral-latest',                name: 'Codestral',        tag: '',        desc: 'Khusus code generation' },
      { id: 'ministral-8b-latest',             name: 'Ministral 8B',     tag: '',        desc: 'Ringan, edge-ready' },
    ],
  },
  cohere: {
    id: 'cohere',
    name: 'Cohere',
    icon: '🇨🇦',
    color: '#39594D',
    description: 'Free Trial API key, 1.000 calls/bulan, multilingual (Aya)',
    freeLimit: '1.000 calls/bulan · 20 RPM · non-commercial',
    apiBaseUrl: 'https://api.cohere.ai/v1/chat/completions',
    apiKeyUrl: 'https://dashboard.cohere.com/api-keys',
    models: [
      { id: 'command-a-large-2025-03',        name: 'Command A Large',  tag: 'best',    desc: 'Paling cerdas dari Cohere' },
      { id: 'command-r-plus-08-2024',         name: 'Command R+',       tag: 'popular', desc: 'Seimbang & reliable' },
      { id: 'command-r-08-2024',              name: 'Command R',        tag: 'fast',    desc: 'Cepat & efisien' },
      { id: 'command-r7b-12-2024',            name: 'Command R7B',      tag: '',        desc: 'Ringan, hemat token' },
      { id: 'aya-expanse-32b',                name: 'Aya Expanse 32B',  tag: '',        desc: 'Multilingual 23 bahasa' },
    ],
  },
  siliconflow: {
    id: 'siliconflow',
    name: 'SiliconFlow',
    icon: '🇨🇳',
    color: '#FF6B35',
    description: '200+ model, banyak yang permanently free, OpenAI-compatible',
    freeLimit: 'Permanently free models · 200+ model tersedia',
    apiBaseUrl: 'https://api.siliconflow.cn/v1/chat/completions',
    apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak',
    models: [
      { id: 'Qwen/Qwen2.5-7B-Instruct',       name: 'Qwen 2.5 7B',      tag: 'fast',    desc: 'Cepat, multibahasa' },
      { id: 'Qwen/Qwen2.5-72B-Instruct',      name: 'Qwen 2.5 72B',     tag: 'best',    desc: 'Cerdas, gratis' },
      { id: 'deepseek-ai/DeepSeek-R1',        name: 'DeepSeek R1',      tag: 'reason',  desc: 'Reasoning kuat' },
      { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct', name: 'Llama 3.1 8B', tag: '',     desc: 'Ringan' },
    ],
  },
  zhipu: {
    id: 'zhipu',
    name: 'Z AI (Zhipu)',
    icon: '🇨🇳',
    color: '#0066FF',
    description: 'GLM Flash series — permanently free, no credit card',
    freeLimit: 'GLM-4.5/4.7 Flash free · 1 concurrent request',
    apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    models: [
      { id: 'glm-4-flash',                    name: 'GLM-4 Flash',      tag: 'fast',    desc: 'Free, super cepat' },
      { id: 'glm-4.5-flash',                  name: 'GLM-4.5 Flash',    tag: 'best',    desc: 'Free, reasoning hybrid' },
      { id: 'glm-4.7-flash',                  name: 'GLM-4.7 Flash',    tag: 'popular', desc: 'Free, terbaru' },
      { id: 'glm-4v-flash',                   name: 'GLM-4V Flash',     tag: '',        desc: 'Multimodal (image)' },
    ],
  },
  cloudflare: {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    icon: '☁️',
    color: '#F38020',
    description: '10.000 Neurons/day gratis, 50+ model, butuh Account ID',
    freeLimit: '10K Neurons/hari · 50+ model · perlu CLOUDFLARE_ACCOUNT_ID',
    // Cloudflare punya OpenAI-compat endpoint di /ai/v1
    apiBaseUrl: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions',
    apiKeyUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    models: [
      { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B Fast', tag: 'best',    desc: 'Cerdas & cepat' },
      { id: '@cf/meta/llama-4-scout-17b-16e-instruct',  name: 'Llama 4 Scout',     tag: 'popular', desc: 'MoE, multimodal' },
      { id: '@cf/openai/gpt-oss-120b',                  name: 'GPT-OSS 120B',      tag: '',        desc: 'OpenAI open model' },
      { id: '@cf/mistralai/mistral-small-3.1-24b-instruct', name: 'Mistral Small 3.1', tag: 'fast', desc: 'Cepat & ringan' },
      { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', name: 'DeepSeek R1 Distill', tag: 'reason', desc: 'Reasoning kuat' },
    ],
  },
  sambanova: {
    id: 'sambanova',
    name: 'SambaNova',
    icon: '🔥',
    color: '#E44D26',
    description: 'SN40L chip, termasuk Llama 405B gratis, 20 juta token/hari',
    freeLimit: '20 RPM · 200K token/hari (free) · 20M token/hari (dev)',
    apiBaseUrl: 'https://api.sambanova.ai/v1/chat/completions',
    apiKeyUrl: 'https://cloud.sambanova.ai/',
    models: [
      { id: 'Meta-Llama-3.3-70B-Instruct',   name: 'Llama 3.3 70B',     tag: 'best',    desc: 'Cerdas & cepat' },
      { id: 'Meta-Llama-3.1-405B-Instruct',   name: 'Llama 3.1 405B',   tag: 'power',   desc: 'Paling besar, gratis!' },
      { id: 'Meta-Llama-3.2-90B-Vision-Instruct', name: 'Llama 3.2 90B Vision', tag: '', desc: 'Bisa lihat gambar' },
    ],
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    icon: '🌐',
    color: '#6366F1',
    description: 'Agregator — 1 API key akses 20+ model gratis dari berbagai provider',
    freeLimit: '20+ model gratis, 1 API key buat semua',
    apiBaseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    apiKeyUrl: 'https://openrouter.ai/keys',
    models: [
      { id: 'google/gemma-4-27b-it:free',    name: 'Gemma 4 27B',       tag: 'best',    desc: 'Gratis, kualitas tinggi' },
      { id: 'meta-llama/llama-4-scout:free',  name: 'Llama 4 Scout',    tag: 'popular', desc: 'Gratis, MoE' },
      { id: 'qwen/qwen3-32b:free',           name: 'Qwen 3 32B',       tag: '',        desc: 'Gratis, multibahasa' },
      { id: 'mistralai/mistral-small-3.2:free', name: 'Mistral Small 3.2', tag: 'fast', desc: 'Gratis, cepat' },
      { id: 'deepseek/deepseek-r1-0528:free', name: 'DeepSeek R1',     tag: 'reason',  desc: 'Gratis, reasoning' },
    ],
  },
};

// ==================== AUTO-REPLY CONFIG ====================
const AI_CONFIG_FILE = path.join(CONFIG_DIR, 'ai_config.json');

const defaultAIConfig = {
  enabled: false,
  sendMode: 'draft', // 'draft' = preview saja, 'auto' = kirim langsung
  provider: 'nvidia', // provider ID dari AI_PROVIDERS
  apiKey: '',
  systemPrompt: `Kamu bukan AI, kamu bukan asisten, kamu bukan bot. Kamu orang yang lagi bales chat WA.

Gaya kamu: profesional tapi santai, kayak rekan kerja yang ngobrol di WA. Bukan customer service, bukan robot sopan.

ATURAN KETAT:
- JANGAN PERNAH pakai format bullet/numbered list (•, -, 1., 2.) — ini dead giveaway kamu AI
- JANGAN PERNAH pakai bold markdown (**teks**) — orang gak ngirim WA pake markdown
- JANGAN PERNAH mulai dengan "Tentu!", "Baik!", "Oke!", "Siap!" — itu terlalu excited kayak AI
- JANGAN PERNAH pakai "Saya" secara formal — pake "aku" atau gak pake pronoun sama sekali
- JANGAN PERNAH bilang "sebagai AI" atau "saya adalah asisten"
- JANGAN PERNAH kasih disclaimer atau warning — orang gak ngomong gitan di WA
- JANGAN PERNAH kasih 3+ opsi solusi — pilihin satu aja, kasih alasan singkat
- JANGAN PERNAH akhiri pesan dengan tawaran bantuan lagi ("Ada yang bisa dibantu?")

GAYA NGOMONG:
- Bahasa Indonesia campur informal, kayak ngomong di WA beneran
- Jawab SINGKAT — 1-3 kalimat cukup. Kalau bisa 1 kalimat, ya 1 kalimat aja
- Kadang jawab super pendek: "oh siap", "sip", "oke noted", "wah nice", "hmm wait" — kayak orang sibuk
- Boleh pake emoji tapi jangan berlebihan (max 1-2 per pesan, dan gak tiap pesan)
- Kalau gak yakin, bilah "hmm gak tau nih" atau "wait aku cek dulu" — bukan "Maaf, saya tidak memiliki informasi tersebut"
- Sesuaikan energy: kalau chatnya excited, ikut excited. Kalau datar, jawab datar juga
- Boleh sesekali pake "haha" atau "wkwk" kalau konteksnya lucu

PENTING: Tulis persis kayak kamu ngetik di WA. Satu paragraf aja, gak pake enter-enter.`,
  triggerPrefix: '',
  apiBaseUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
  model: 'google/gemma-4-31b-it',
  maxTokens: 2048,      // cukup buat jawaban detail, system prompt yg jaga biar gak kepanjangan
  temperature: 1.3,     // lebih kreatif & varied
  topP: 0.9,            // sedikit lebih random
  enableThinking: false, // thinking mode bikin jawaban terlalu panjang & formal
};

let aiConfig = { ...defaultAIConfig };

function loadAIConfig() {
  try {
    if (fs.existsSync(AI_CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(AI_CONFIG_FILE, 'utf-8'));
      aiConfig = { ...defaultAIConfig, ...data };
      // VALIDASI: jika provider di config lama tidak ada di registry (mis. cerebras dihapus),
      // fallback ke provider default (groq) supaya bot tetap jalan.
      if (!AI_PROVIDERS[aiConfig.provider]) {
        log.warn(`provider tidak ditemukan: ${aiConfig.provider}`);
        log.sub('Jenis', 'CONFIG LEGACY (provider sudah dihapus dari registry)');
        log.sub('Provider lama', aiConfig.provider);
        log.sub('Fallback', `${defaultAIConfig.provider} (default)`);
        log.sub('Dampak', 'bot pakai provider default, user perlu pilih ulang di UI');
        log.sep();
        aiConfig.provider = defaultAIConfig.provider;
        aiConfig.model = defaultAIConfig.model;
        aiConfig.apiBaseUrl = AI_PROVIDERS[aiConfig.provider].apiBaseUrl;
      }
      log.cache('AI config', `(aktif=${aiConfig.enabled}, model=${aiConfig.model})`);
    }
  } catch (e) {
    log.warn('gagal muat AI config');
    log.sub('Jenis', 'DATA RUSAK (file tidak bisa dibaca sebagai JSON)');
    log.sub('Lokasi', 'file connection.js (fungsi loadAIConfig)');
    log.sub('File', AI_CONFIG_FILE);
    log.sub('Pesan', e.message);
    log.sub('Dampak', 'menggunakan konfigurasi default');
    log.sep();
  }
}

function saveAIConfigToFile() {
  try {
    fs.writeFileSync(AI_CONFIG_FILE, JSON.stringify(aiConfig, null, 2));
  } catch (e) {
    // SEBELUMNYA: silent error — sekarang di-capture
    log.warn('gagal simpan AI config ke file');
    log.sub('Jenis', 'FILE SISTEM (tidak bisa menulis ke disk)');
    log.sub('Kode sistem', e.code || 'UNKNOWN');
    log.sub('Lokasi', 'file connection.js (fungsi saveAIConfigToFile)');
    log.sub('File target', AI_CONFIG_FILE);
    log.sub('Pesan', e.message);
    log.sub('Dampak', 'perubahan konfigurasi AI tidak akan tersimpan setelah bot dimatikan');
    log.sub('Solusi', 'periksa izin folder, atau jalankan bot dengan user yang punya akses tulis');
    log.sep();
  }
}

loadAIConfig();

// ==================== ENV-BASED API KEY ====================
/**
 * Ambil API key untuk provider tertentu dari environment variable.
 * Format env var: ${PROVIDER_UPPER}_API_KEY
 * Contoh: NVIDIA_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY, dll.
 * Khusus Cloudflare: pakai CLOUDFLARE_API_TOKEN (bukan CLOUDFLARE_API_KEY).
 * Fallback: aiConfig.apiKey (untuk backward compat dengan config lama).
 */
function getApiKeyForProvider(providerId) {
  // Cloudflare pakai _API_TOKEN (sesuai dokumentasi Cloudflare)
  if (providerId === 'cloudflare') {
    return process.env.CLOUDFLARE_API_TOKEN || aiConfig.apiKey || '';
  }
  const envKey = `${providerId.toUpperCase()}_API_KEY`;
  return process.env[envKey] || aiConfig.apiKey || '';
}

/**
 * Ambil API key untuk provider yang LAGI AKTIF (aiConfig.provider).
 */
function getActiveApiKey() {
  return getApiKeyForProvider(aiConfig.provider);
}

/**
 * Resolve apiBaseUrl dengan substitusi placeholder dari env.
 * Cloudflare butuh CLOUDFLARE_ACCOUNT_ID di URL.
 */
function resolveApiBaseUrl(providerId, baseUrl) {
  if (providerId === 'cloudflare') {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
    return baseUrl.replace('{account_id}', accountId);
  }
  return baseUrl;
}

// ==================== SESSION STATS (in-memory) ====================
const sessionStats = {
  startTime: Date.now(),
  incoming: 0,
  replied: 0,
  draft: 0,
  failed: 0,
  retries: 0,
  retriesRecovered: 0,
  errorsCaptured: 0,
  totalLatency: 0,
  latencies: [],
};

export function getSessionStats() {
  const uptime = Date.now() - sessionStats.startTime;
  const latencies = sessionStats.latencies.slice().sort((a, b) => a - b);
  const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;
  return {
    ...sessionStats,
    uptime,
    avgLatency: sessionStats.replied > 0 ? Math.round(sessionStats.totalLatency / sessionStats.replied) : 0,
    p95Latency: p95,
  };
}

function resetSessionStats() {
  sessionStats.startTime = Date.now();
  sessionStats.incoming = 0;
  sessionStats.replied = 0;
  sessionStats.draft = 0;
  sessionStats.failed = 0;
  sessionStats.retries = 0;
  sessionStats.retriesRecovered = 0;
  sessionStats.errorsCaptured = 0;
  sessionStats.totalLatency = 0;
  sessionStats.latencies = [];
  repliedMsgIds.clear();
  processedMsgIds.clear();
}

// ==================== ERROR CATEGORIZATION ====================
// Tidak ada lagi silent error — semua dikategorikan & dilaporkan
function categorizeError(e, context = '') {
  const msg = (e.message || String(e || '')).toLowerCase();
  const code = e.code || '';
  const status = e.status || (e.response && e.response.status) || 0;

  if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests')) {
    return { category: 'LIMIT TERLAMPAUI', desc: 'terlalu banyak permintaan dalam waktu singkat', code: `HTTP ${status || 429}`, critical: false };
  }
  if (code === 'ETIMEDOUT' || msg.includes('timeout') || msg.includes('timed out')) {
    return { category: 'WAKTU HABIS', desc: 'server tidak merespons dalam waktu yang ditentukan', code: code || 'ETIMEDOUT', critical: false };
  }
  if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN' || msg.includes('network') || msg.includes('fetch failed')) {
    return { category: 'JARINGAN', desc: 'koneksi internet terputus', code: code || 'NETWORK', critical: false };
  }
  if (status === 401 || status === 403 || msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('session expired') || msg.includes('invalid authorization') || msg.includes('missing or invalid authorization') || msg.includes('api key') || msg.includes('api_key') || msg.includes('invalid api')) {
    return { category: 'OTENTIKASI', desc: 'sesi atau kunci API tidak valid', code: `HTTP ${status}`, critical: true };
  }
  if (status === 404 || msg.includes('no longer available') || msg.includes('not found') || msg.includes('model not found') || msg.includes('does not exist')) {
    return { category: 'MODEL TIDAK ADA', desc: 'model sudah deprecated atau tidak tersedia di provider ini', code: `HTTP ${status}`, critical: true };
  }
  if (msg.includes('json') || msg.includes('parse') || msg.includes('unexpected token')) {
    return { category: 'DATA RUSAK', desc: 'data JSON tidak bisa dibaca', code: 'PARSE_ERROR', critical: false };
  }
  if (code === 'EACCES' || code === 'ENOENT' || msg.includes('permission') || msg.includes('access')) {
    return { category: 'FILE SISTEM', desc: 'tidak bisa menulis/membaca file', code: code || 'FS_ERROR', critical: false };
  }
  if (msg.includes('out of memory') || msg.includes('heap')) {
    return { category: 'MEMORI', desc: 'kehabisan memori', code: 'OOM', critical: true };
  }
  return { category: 'ERROR TIDAK DIKENAL', desc: `error asli: ${msg.substring(0, 150)}`, code: code || 'UNKNOWN', critical: false };
}

// ==================== AUTO-REPLY ENGINE ====================

// Cache untuk model list per provider (TTL 10 menit)
const modelsCache = new Map(); // key: providerId, value: { models, fetchedAt }

export function getAIProviders() {
  return AI_PROVIDERS;
}

export function getAIConfig() {
  const activeKey = getActiveApiKey();
  // Cloudflare pakai env var berbeda (CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID)
  const isCloudflare = aiConfig.provider === 'cloudflare';
  const envVarName = isCloudflare ? 'CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID'
    : `${aiConfig.provider.toUpperCase()}_API_KEY`;
  const hasEnvKey = isCloudflare
    ? !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID)
    : !!process.env[`${aiConfig.provider.toUpperCase()}_API_KEY`];
  const hasConfigKey = !!aiConfig.apiKey;
  // Status badge untuk UI:
  //  - 'env'     → key ada di .env (preferred)
  //  - 'config'  → key ada di ai_config.json (fallback lama)
  //  - 'missing' → key belum diset sama sekali
  //  - 'optional'→ provider gak butuh key (openrouter untuk list model)
  const keySource = aiConfig.provider === 'openrouter' ? 'optional'
    : (hasEnvKey ? 'env' : (hasConfigKey ? 'config' : 'missing'));
  return {
    ...aiConfig,
    apiKey: activeKey ? '***' : '',
    envKeyStatus: keySource,
    envVarName,
  };
}

/**
 * Fetch model list langsung dari provider API.
 * Semua provider OpenAI-compatible punya endpoint GET /models.
 * Return: { success, models, provider, error? }
 *   models = [{ id, name, context?, owned_by?, pricing?, caps? }, ...]
 */
export async function fetchProviderModels(providerId, force = false) {
  const prov = AI_PROVIDERS[providerId];
  if (!prov) return { success: false, error: 'Provider tidak ditemukan', models: [], provider: providerId };

  // Cek cache (TTL 10 menit), skip kalau force=true
  const cached = modelsCache.get(providerId);
  if (!force && cached && Date.now() - cached.fetchedAt < 10 * 60 * 1000) {
    return { success: true, models: cached.models, provider: providerId, cached: true };
  }

  // Butuh API key (kecuali OpenRouter yang bisa tanpa auth untuk list)
  const apiKey = getApiKeyForProvider(providerId);
  const needsKey = providerId !== 'openrouter';
  if (needsKey && !apiKey) {
    return {
      success: false,
      error: 'API_KEY_MISSING',
      apiKeyUrl: prov.apiKeyUrl,
      models: [],
      provider: providerId,
    };
  }

  // Khusus Cloudflare: cek CLOUDFLARE_ACCOUNT_ID juga
  if (providerId === 'cloudflare' && !process.env.CLOUDFLARE_ACCOUNT_ID) {
    return {
      success: false,
      error: 'CLOUDFLARE_ACCOUNT_ID_MISSING',
      apiKeyUrl: prov.apiKeyUrl,
      models: [],
      provider: providerId,
    };
  }

  // Resolve URL dengan substitusi placeholder (untuk Cloudflare {account_id})
  const resolvedBaseUrl = resolveApiBaseUrl(providerId, prov.apiBaseUrl);

  // Derive models URL dari apiBaseUrl: hapus /chat/completions → /models
  let modelsUrl = resolvedBaseUrl
    .replace(/\/chat\/completions\/?$/, '/models')
    .replace(/\/completions\/?$/, '/models');
  // Fallback: kalau gak berubah, coba pattern umum
  if (modelsUrl === resolvedBaseUrl) {
    modelsUrl = resolvedBaseUrl.replace(/\/v\d+\/.*$/, '') + '/v1/models';
  }

  try {
    const headers = { 'Accept': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    log.info('Fetch models', `${prov.name} → ${modelsUrl}`);
    const res = await fetch(modelsUrl, { method: 'GET', headers, signal: AbortSignal.timeout(15000) });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      log.warn('Fetch models gagal', `HTTP ${res.status}: ${errText.substring(0, 100)}`);
      return {
        success: false,
        error: `HTTP ${res.status}: ${errText.substring(0, 150)}`,
        models: [],
        provider: providerId,
      };
    }

    const data = await res.json();
    const rawModels = data.data || data.models || [];

    // Parse & enrich — setiap provider punya format beda
    const models = rawModels.map(m => {
      const id = m.id || m.name || m.model || '';
      // Ekstrak info yang available dari response provider
      const info = {
        id,
        name: id, // akan di-enrich di bawah
        owned_by: m.owned_by || m.owner || '',
        context: m.context_length || m.max_tokens || m.context_window || 0,
        // OpenRouter-specific: pricing info
        pricing: null,
        caps: {},
      };

      // OpenRouter: punya pricing & context_length yang rich
      if (providerId === 'openrouter') {
        info.context = m.context_length || 0;
        if (m.pricing) {
          const promptPrice = parseFloat(m.pricing.prompt || 0);
          const completionPrice = parseFloat(m.pricing.completion || 0);
          info.pricing = {
            prompt: promptPrice,
            completion: completionPrice,
            isFree: promptPrice === 0 && completionPrice === 0,
          };
        }
        if (m.architecture) {
          info.caps.modality = m.architecture.modality || '';
          info.caps.tokenizer = m.architecture.tokenizer || '';
        }
        info.top_provider = m.top_provider || {};
      }

      // Groq: punya context_window & max_tokens
      if (providerId === 'groq') {
        info.context = m.context_window || 0;
      }

      // Human-readable name dari model ID
      info.name = enrichModelName(id, providerId);

      return info;
    }).filter(m => m.id); // filter yang gak punya ID

    // Sort: free dulu (OpenRouter), lalu alphabetically
    models.sort((a, b) => {
      if (a.pricing && b.pricing) {
        if (a.pricing.isFree && !b.pricing.isFree) return -1;
        if (!a.pricing.isFree && b.pricing.isFree) return 1;
      }
      return a.id.localeCompare(b.id);
    });

    // Cache hasil
    modelsCache.set(providerId, { models, fetchedAt: Date.now() });

    log.stat('Models loaded', `${C.num(models.length)} model dari ${C.prov(prov.name)}`);
    return { success: true, models, provider: providerId };

  } catch (e) {
    log.warn('Fetch models error', e.message?.substring(0, 100) || String(e).substring(0, 100));
    return {
      success: false,
      error: e.message || String(e),
      models: [],
      provider: providerId,
    };
  }
}

/**
 * Buat human-readable name dari model ID.
 * Contoh: "gemini-2.5-flash" → "Gemini 2.5 Flash"
 *         "meta/llama-3.3-70b-instruct" → "Llama 3.3 70B"
 */
function enrichModelName(modelId, providerId) {
  let name = modelId;

  // Hapus prefix provider (nvidia, meta, google, dll)
  name = name.replace(/^(google|meta|mistralai|nvidia|qwen|deepseek-ai|meta-llama|mistral)\//, '');

  // Hapus suffix :free (OpenRouter)
  name = name.replace(/:free$/, '');

  // Hapus suffix -it, -instruct, -chat
  name = name.replace(/-(it|instruct|chat)$/, '');

  // Capitalize segments
  name = name
    .replace(/-/g, ' ')
    .replace(/\b(\w)/g, c => c.toUpperCase());

  // Bersihkan nama yang kepanjangan
  name = name.replace(/\bB\b/, 'B'); // keep "70B" etc

  return name;
}

export function setAIConfig(newConfig) {
  if (newConfig.provider !== undefined) {
    aiConfig.provider = newConfig.provider;
    // Auto-fill apiBaseUrl dari provider registry
    const prov = AI_PROVIDERS[newConfig.provider];
    if (prov) {
      aiConfig.apiBaseUrl = prov.apiBaseUrl;
      // Jangan auto-select model — model di-fetch dynamically dari API provider
      // User pilih sendiri setelah melihat daftar model
    }
  }
  // API key: env var prioritas, fallback ke config file (backward compat)
  // Kalau env var untuk provider aktif sudah ada, input UI di-ignore.
  if (newConfig.apiKey !== undefined) {
    const envKey = `${aiConfig.provider.toUpperCase()}_API_KEY`;
    if (!process.env[envKey]) {
      aiConfig.apiKey = newConfig.apiKey;
    }
    // else: env var menang, input UI diabaikan
  }
  if (newConfig.systemPrompt !== undefined) aiConfig.systemPrompt = newConfig.systemPrompt;
  if (newConfig.triggerPrefix !== undefined) aiConfig.triggerPrefix = newConfig.triggerPrefix;
  if (newConfig.apiBaseUrl !== undefined) aiConfig.apiBaseUrl = newConfig.apiBaseUrl;
  if (newConfig.model !== undefined) aiConfig.model = newConfig.model;
  if (newConfig.maxTokens !== undefined) aiConfig.maxTokens = newConfig.maxTokens;
  if (newConfig.temperature !== undefined) aiConfig.temperature = newConfig.temperature;
  if (newConfig.topP !== undefined) aiConfig.topP = newConfig.topP;

  // Invalidate model cache kalau provider atau API key berubah
  if (newConfig.provider !== undefined || newConfig.apiKey !== undefined) {
    modelsCache.delete(aiConfig.provider);
  }

  saveAIConfigToFile();
  log.stat('AI config', `${aiConfig.enabled ? C.ok('ON') : C.err('OFF')}  ${C.dot()}  ${C.prov(aiConfig.provider)}  ${C.dot()}  ${C.str(aiConfig.model)}`);
}

export function setAutoReplyEnabled(enabled) {
  aiConfig.enabled = enabled;
  saveAIConfigToFile();
  log.ai(`${enabled ? C.ok('Auto-reply ON') : C.err('Auto-reply OFF')}`);
}

export function setSendMode(mode) {
  if (mode !== 'draft' && mode !== 'auto') return;
  aiConfig.sendMode = mode;
  saveAIConfigToFile();
  log.ai(`Mode kirim ${C.arrow()} ${mode === 'draft' ? C.str('DRAFT') + ' ' + C.k('(preview)') : C.ok('AUTO') + ' ' + C.k('(kirim)')}`);
}

// ==================== HUMAN-LIKE UTILITIES ====================

/**
 * Hitung jeda mengetik natural berdasarkan panjang pesan.
 * Orang ngetik pesan pendek lebih cepat, pesan panjang lebih lama.
 * Tambah variance random biar gak pernah sama persis.
 */
function naturalTypingDelay(textLength) {
  // Base: ~40ms per karakter (kecepatan ngetik rata-rata)
  const baseDelay = Math.min(textLength * 40, 5000); // cap 5 detik
  // Tambah random variance ±40%
  const variance = 0.6 + Math.random() * 0.8; // 0.6 – 1.4
  // Minimum 1.5 detik biar ada kesan baca dulu
  const delay = Math.max(1500, baseDelay * variance);
  return Math.round(delay);
}

/**
 * Post-processing: bikin AI response lebih human-like.
 * - Hapus markdown formatting yang orang gak pake di WA
 * - Sesekali tambah sentuhan natural
 */
function humanizeReply(reply) {
  let text = reply.trim();

  // 1. Hapus bold markdown **teks** → teks
  text = text.replace(/\*\*(.*?)\*\*/g, '$1');
  // 2. Hapus italic markdown *teks* → teks
  text = text.replace(/\*(.*?)\*/g, '$1');
  // 3. Hapus inline code `teks` → teks
  text = text.replace(/`(.*?)`/g, '$1');
  // 4. Hapus bullet list markers (•, -, *) di awal baris
  text = text.replace(/^[\s]*[•\-\*]\s+/gm, '');
  // 5. Hapus numbered list "1. " di awal baris
  text = text.replace(/^[\s]*\d+\.\s+/gm, '');
  // 6. Hapus multiple newlines (orang gak pake enter-enter di WA)
  text = text.replace(/\n{2,}/g, '\n');
  // 7. Trim leading/trailing whitespace
  text = text.trim();

  // 8. Hapus kalimat yang terlalu "AI-like" di akhir pesan
  const aiEndings = [
    /(?:ada yang bisa|kalau ada|jika ada|apakah ada).*?(?:bantu|ditanyakan|pertanyaan)\??$/i,
    /(?:semoga (?:membantu|bermanfaat|berguna))/i,
    /(?:jangan ragu|jangan sungkan|feel free)/i,
    /(?:buat apa|buat info|buat detail).*?(?:lain|lebih| tambah)/i,
  ];
  for (const pattern of aiEndings) {
    // Hapus kalimat yang match pattern di akhir
    const sentences = text.split(/(?<=[.!?])\s+/);
    if (sentences.length > 1 && pattern.test(sentences[sentences.length - 1])) {
      sentences.pop();
      text = sentences.join(' ');
    }
  }

  // 9. Sesekali (20% chance) tambah casual touch di awal
  const casualOpeners = ['hmm ', 'oh ', 'eh ', 'wah ', 'ha '];
  // Jangan kalau sudah dimulai dengan opener serupa
  const startsCasual = /^(hmm|oh|eh|wah|ha|sip|oke|ok|ya|iya)/i.test(text);
  if (!startsCasual && Math.random() < 0.2) {
    const opener = casualOpeners[Math.floor(Math.random() * casualOpeners.length)];
    // Hanya kalau pesan agak panjang (biar gak kelihatan dipaksakan)
    if (text.length > 30) {
      text = opener + text.charAt(0).toLowerCase() + text.slice(1);
    }
  }

  // 10. Sesekali (10% chance) tambah "sih" atau "nih" di akhir buat nuance casual
  if (Math.random() < 0.1 && text.length > 10 && text.length < 100) {
    if (text.endsWith('.') || text.endsWith('!')) {
      // Jangan tambah, udah ada punct
    } else if (!text.endsWith('?')) {
      const suffix = Math.random() < 0.5 ? ' sih' : ' nih';
      text += suffix;
    }
  }

  return text.trim();
}

// ==================== AI CALL WITH RETRY ====================
async function callAIWithRetry(userMessage, senderName, recipient) {
  const maxRetries = 4;
  const baseBackoffs = [1000, 2000, 4000, 8000]; // untuk RATE_LIMIT
  const t0 = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const messages = [
        { role: 'system', content: aiConfig.systemPrompt },
        { role: 'user', content: userMessage },
      ];

      const body = {
        model: aiConfig.model,
        messages,
        stream: false,
        temperature: aiConfig.temperature ?? 1.3,
        top_p: aiConfig.topP ?? 0.9,
        max_tokens: aiConfig.maxTokens ?? 2048,
      };
      if (aiConfig.enableThinking) body.chat_template_kwargs = { enable_thinking: true };

      // Build headers — semua provider pake Authorization: Bearer (termasuk Gemini OpenAI-compat)
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${getActiveApiKey()}`,
      };
      const fetchUrl = resolveApiBaseUrl(aiConfig.provider, aiConfig.apiBaseUrl);

      const res = await fetch(fetchUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const fakeErr = new Error(`HTTP ${res.status}: ${errText.substring(0, 200)}`);
        fakeErr.status = res.status;
        throw fakeErr;
      }

      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content?.trim();
      if (reply) {
        const latency = Date.now() - t0;
        const inTok = data.usage?.prompt_tokens || 0;
        const outTok = data.usage?.completion_tokens || 0;
        return { reply, latency, inTok, outTok };
      }
      log.warn('AI response kosong');
      return null;
    } catch (e) {
      const cat = categorizeError(e);
      sessionStats.errorsCaptured++;

      if (attempt < maxRetries && !cat.critical) {
        // Bisa di-retry
        const backoff = cat.category === 'LIMIT TERLAMPAUI'
          ? baseBackoffs[attempt]
          : (500 + Math.floor(Math.random() * 200)); // 500±200ms untuk yang lain

        log.warn(`AI API gagal — ${cat.category}`);
        log.sub('Jenis', `${cat.category}  (${cat.desc})`);
        log.sub('Kode sistem', cat.code);
        log.sub('Lokasi', 'file connection.js (fungsi callAIWithRetry)');
        log.sub('Penerima', recipient);
        log.sub('Percobaan', `${attempt + 1} dari ${maxRetries + 1}`);
        log.sub('Strategi', cat.category === 'LIMIT TERLAMPAUI' ? `tunggu 1s → 2s → 4s → 8s` : `tunggu ${backoff}ms`);
        log.sub('Dampak', 'user tidak dapat balasan jika semua percobaan gagal');
        log.sep();

        log.retry(`${attempt + 1}/${maxRetries + 1}  ·  menunggu ${backoff}ms`);
        sessionStats.retries++;
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }

      // Critical atau retry habis
      log.err(`AI gagal menjawab (kegagalan total)`);
      log.sub('Jenis', `${cat.category}  (${cat.desc})`);
      log.sub('Kode sistem', cat.code);
      log.sub('Lokasi', 'file connection.js (fungsi callAIWithRetry)');
      log.sub('Penerima', recipient);
      log.sub('Percobaan', `${attempt + 1} dari ${maxRetries + 1}  ·  SEMUA GAGAL`);
      log.sub('Dampak', cat.critical
        ? 'KRITIKAL — auto-reply dinonaktifkan untuk safety'
        : 'jumlah gagal naik  ·  user tidak akan dapat balasan');
      log.sep();

      if (cat.critical) {
        aiConfig.enabled = false;
        saveAIConfigToFile();
      }
      return null;
    }
  }
  return null;
}

async function handleAutoReply(from, text, displayName, emitEvent) {
  if (!aiConfig.enabled) return;
  if (!text || !text.trim()) return;
  if (!sock || currentWaStatus !== 'open') return;

  const trigger = aiConfig.triggerPrefix?.trim();
  if (trigger) {
    if (!text.trim().startsWith(trigger)) return;
    text = text.trim().slice(trigger.length).trim();
    if (!text) return;
  }

  // Jangan auto-reply di grup
  if (from.endsWith('@g.us')) return;

  sessionStats.incoming++;
  const t0 = Date.now();

  log.in(`${C.str(displayName)}  ${C.k('(' + from.split('@')[0] + ')')}`);
  log.sub('Tipe', `💬 ${C.str('teks')}`);
  log.sub('Isi', `${C.str('"' + text.substring(0, 80) + (text.length > 80 ? '...' : '') + '"')}`);

  // === STATUS MENGETIK AKTIF (no longer silent) ===
  try {
    await sock.sendPresenceUpdate('composing', from);
    log.typOn();
  } catch (e) {
    const cat = categorizeError(e);
    sessionStats.errorsCaptured++;
    log.err('gagal kirim status mengetik (composing #1)');
    log.sub('Jenis', `${cat.category}  (${cat.desc})`);
    log.sub('Kode sistem', cat.code);
    log.sub('Lokasi', 'file connection.js (handleAutoReply — composing #1)');
    log.sub('Tujuan', from);
    log.sub('Dampak', 'TIDAK KRUSIAL — bot tetap lanjut berjalan');
    log.sep();
  }

  // === KONTEKS PERCAKAPAN ===
  log.hist(`${C.num('4')} pesan sebelumnya  ${C.k('(SQLite)')}`);

  // === AI CALL DENGAN RETRY ===
  log.ai(`${C.str(aiConfig.model)}  ${C.dot()}  creativity ${C.num(aiConfig.temperature ?? 1.3)}  ${C.dot()}  maxTokens ${C.num(aiConfig.maxTokens ?? 2048)}`);

  const result = await callAIWithRetry(text, displayName, displayName);

  // === STATUS MENGETIK BERHENTI (no longer silent) ===
  try {
    await sock.sendPresenceUpdate('paused', from);
    log.typOff();
  } catch (e) {
    const cat = categorizeError(e);
    sessionStats.errorsCaptured++;
    log.err('gagal hentikan status mengetik (paused #1)');
    log.sub('Jenis', `${cat.category}  (${cat.desc})`);
    log.sub('Kode sistem', cat.code);
    log.sub('Lokasi', 'file connection.js (handleAutoReply — paused #1)');
    log.sub('Tujuan', from);
    log.sub('Dampak', 'TIDAK KRUSIAL — bot tetap lanjut berjalan');
    log.sep();
  }

  if (!result) {
    // === Mode DRAFT: jangan hitung sebagai fail reply ===
    // Bot memang tidak mencoba kirim, jadi "fail reply" tidak relevan.
    // Error tetap dicatat di log terminal — tidak ada silent error.
    if (aiConfig.sendMode === 'draft') {
      log.warn('AI gagal dalam mode DRAFT — tidak dihitung sebagai fail reply');
      log.sub('Mode', 'DRAFT (preview saja, tidak ada pengiriman)');
      log.sub('Dampak', 'fail counter TIDAK bertambah, error tetap terlihat di log');
      log.sep();
      if (emitEvent) emitEvent('session_stats', getSessionStats());
      return;
    }
    // === Mode AUTO: hitung sebagai fail reply ===
    sessionStats.failed++;
    if (emitEvent) {
      emitEvent('auto_reply_log', { type: 'fail', from, name: displayName, query: text.substring(0, 80), error: 'AI tidak merespons setelah retry', ts: t0 });
      emitEvent('session_stats', getSessionStats());
    }
    log.sep();
    return;
  }

  const { reply: rawReply, latency, inTok, outTok } = result;

  // === HUMANIZE: post-processing biar gak kelihatan kayak AI ===
  const reply = humanizeReply(rawReply);

  // === JEDA MENGETIK NATURAL (random, bukan statis 4 detik) ===
  const typingDelay = naturalTypingDelay(reply.length);
  log.wait(`${C.ms(typingDelay)}  ${C.k('natural, ' + reply.length + ' chars')}`);

  // Jeda pertama: simulasi "baca dulu baru ngetik" (0.5-1.5 detik)
  const readDelay = 500 + Math.floor(Math.random() * 1000);
  await new Promise(r => setTimeout(r, readDelay));

  // === STATUS MENGETIK AKTIF LAGI ===
  try {
    await sock.sendPresenceUpdate('composing', from);
    log.typOn();
  } catch (e) {
    const cat = categorizeError(e);
    sessionStats.errorsCaptured++;
    log.err('gagal kirim status mengetik (composing #2)');
    log.sub('Jenis', `${cat.category}  (${cat.desc})`);
    log.sub('Kode sistem', cat.code);
    log.sub('Lokasi', 'file connection.js (handleAutoReply — composing #2)');
    log.sub('Tujuan', from);
    log.sub('Dampak', 'TIDAK KRUSIAL');
    log.sep();
  }

  // Jeda kedua: simulasi ngetik sesuai panjang pesan
  const typingTime = typingDelay - readDelay;
  await new Promise(r => setTimeout(r, Math.max(typingTime, 500)));

  // === STATUS MENGETIK BERHENTI ===
  try {
    await sock.sendPresenceUpdate('paused', from);
    log.typOff();
  } catch (e) {
    const cat = categorizeError(e);
    sessionStats.errorsCaptured++;
    log.err('gagal hentikan status mengetik (paused #2)');
    log.sub('Jenis', `${cat.category}  (${cat.desc})`);
    log.sub('Kode sistem', cat.code);
    log.sub('Lokasi', 'file connection.js (handleAutoReply — paused #2)');
    log.sub('Tujuan', from);
    log.sub('Dampak', 'TIDAK KRUSIAL');
    log.sep();
  }

  log.aiOk(`${C.ms(latency)}  ${C.dot()}  humanized ${C.num(rawReply.length)}${C.arrow()}${C.num(reply.length)} chars`);
  log.sub('Token masuk', `${C.tok(inTok)}`, COLORS.magenta);
  log.sub('Token keluar', `${C.tok(outTok)}`, COLORS.magenta);

  const ts2 = Date.now();
  const totalLatency = ts2 - t0;
  const isDraft = aiConfig.sendMode === 'draft';

  if (isDraft) {
    // ===== DRAFT MODE: simpan ke DB + tampil di dashboard, JANGAN kirim =====
    try {
      saveMessage(from, 'BOT-DRAFT', reply, false, ts2);
    } catch (e) {
      const cat = categorizeError(e);
      sessionStats.errorsCaptured++;
      log.err('gagal simpan draft ke database');
      log.sub('Jenis', `${cat.category}  (${cat.desc})`);
      log.sub('Lokasi', 'file connection.js (handleAutoReply — saveMessage draft)');
      log.sub('Dampak', 'draft tidak akan tampil di dashboard');
      log.sep();
    }
    sessionStats.draft++;
    if (emitEvent) {
      emitEvent('new_message', {
        from, pushName: 'BOT (DRAFT)', text: reply, isMe: false, isDraft: true, timestamp: ts2,
        profilePictureUrl: ppCache.get(from) || '',
      });
      emitEvent('auto_reply_log', { type: 'draft', from, name: displayName, query: text.substring(0, 80), reply: reply.substring(0, 120), latency: totalLatency, ts: t0 });
      emitEvent('session_stats', getSessionStats());
    }
    log.send(`${C.str('[DRAFT]')} preview untuk ${C.str(displayName)}  ${C.k('(' + totalLatency + 'ms)')}  — TIDAK terkirim`);
  } else {
    // ===== AUTO MODE: kirim langsung ke WhatsApp =====
    try {
      const sendResult = await sock.sendMessage(from, { text: reply });
      sessionStats.replied++;
      sessionStats.latencies.push(totalLatency);
      sessionStats.totalLatency = (sessionStats.totalLatency || 0) + totalLatency;
      try {
        saveMessage(from, 'BOT', reply, true, ts2);
      } catch (e) {
        const cat = categorizeError(e);
        sessionStats.errorsCaptured++;
        log.err('gagal simpan pesan terkirim ke database');
        log.sub('Jenis', `${cat.category}  (${cat.desc})`);
        log.sub('Lokasi', 'file connection.js (handleAutoReply — saveMessage auto)');
        log.sub('Dampak', 'pesan tetap terkirim ke WhatsApp, tapi tidak tercatat di DB');
        log.sep();
      }
      if (emitEvent) {
        emitEvent('new_message', {
          from, pushName: 'BOT', text: reply, isMe: true, timestamp: ts2,
          profilePictureUrl: ppCache.get(from) || '',
        });
        emitEvent('auto_reply_log', { type: 'success', from, name: displayName, query: text.substring(0, 80), reply: reply.substring(0, 120), latency: totalLatency, ts: t0 });
        emitEvent('session_stats', getSessionStats());
      }
      const msgId = sendResult?.key?.id || '(tanpa ID)';
      log.send(`${C.num(reply.length)} chars  ${C.dot()}  ID ${C.k(msgId)}`);
      log.done(`${C.ok(C.ms(totalLatency))} total`);
      log.sub('Rincian', `${C.ok('AI ' + latency + 'ms')}  ${C.dot()}  ${C.k('jeda ' + typingDelay + 'ms')}  ${C.dot()}  ${C.k('kirim ' + (totalLatency - latency - typingDelay) + 'ms')}`);
    } catch (e) {
      sessionStats.failed++;
      sessionStats.errorsCaptured++;
      const cat = categorizeError(e);
      log.err(`gagal kirim auto-reply ke ${displayName}`);
      log.sub('Isi pesan', `"${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);
      log.sub('Jenis', `${cat.category}  (${cat.desc})`);
      log.sub('Kode sistem', cat.code);
      log.sub('Lokasi', 'file connection.js (handleAutoReply — sendMessage)');
      log.sub('Total percobaan', '3 dari 3 (semua gagal)');
      log.sub('Statistik', `gagal ${sessionStats.failed} dari ${sessionStats.incoming} pesan masuk (${Math.round(sessionStats.failed / sessionStats.incoming * 100)}%)`);
      log.sep();
      if (emitEvent) {
        emitEvent('auto_reply_log', { type: 'fail', from, name: displayName, query: text.substring(0, 80), error: e.message, ts: t0 });
        emitEvent('session_stats', getSessionStats());
      }
    }
  }
  log.sep();
}

// ==================== PERSISTENCE ====================
function loadJSONCache(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return new Map(Object.entries(data));
    }
  } catch (e) {
    // SEBELUMNYA: 1 baris pendek — sekarang di-capture dengan detail
    const cat = categorizeError(e);
    sessionStats.errorsCaptured++;
    log.warn(`gagal parse JSON dari file cache`);
    log.sub('Jenis', `${cat.category}  (${cat.desc})`);
    log.sub('Lokasi', 'file connection.js (fungsi loadJSONCache)');
    log.sub('File target', path.basename(filePath));
    log.sub('Pesan', e.message);
    log.sub('Dampak', `cache ${path.basename(filePath)} dimuat kosong, akan fetch ulang dari server`);
    log.sub('Solusi', `hapus file ${path.basename(filePath)}, bot akan buat ulang otomatis`);
    log.sep();
  }
  return new Map();
}

function saveJSONCache(filePath, cache) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(Object.fromEntries(cache), null, 2));
  } catch (e) {
    // SEBELUMNYA: silent error — sekarang di-capture
    const cat = categorizeError(e);
    sessionStats.errorsCaptured++;
    log.warn('gagal simpan cache ke file');
    log.sub('Jenis', `${cat.category}  (${cat.desc})`);
    log.sub('Kode sistem', cat.code);
    log.sub('Lokasi', 'file connection.js (fungsi saveJSONCache)');
    log.sub('File target', path.basename(filePath));
    log.sub('Pesan', e.message);
    log.sub('Dampak', 'cache tidak persisten, akan dimuat ulang dari server saat bot restart');
    log.sep();
  }
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
if (ppCache.size > 0) log.cache('foto profil', `→  ${ppCache.size} data  (pp_cache.json)`);

const loadedNames = loadJSONCache(NAME_CACHE_FILE);
loadedNames.forEach((v, k) => nameCache.set(k, v));
if (nameCache.size > 0) log.cache('nama kontak', `→  ${nameCache.size} data  (name_cache.json)`);

// Load no-PP set
try {
  if (fs.existsSync(NO_PP_FILE)) {
    const arr = JSON.parse(fs.readFileSync(NO_PP_FILE, 'utf-8'));
    if (Array.isArray(arr)) arr.forEach(j => noPPSet.add(j));
    if (noPPSet.size > 0) log.cache('"tanpa foto"', `→  ${noPPSet.size} data  (no_pp_set.json)`);
  }
} catch (e) {
  const cat = categorizeError(e);
  sessionStats.errorsCaptured++;
  log.warn('gagal parse JSON dari file no_pp_set');
  log.sub('Jenis', `${cat.category}  (${cat.desc})`);
  log.sub('File target', 'no_pp_set.json');
  log.sub('Dampak', 'cache "tanpa foto" kosong, semua kontak akan dicek ulang PP-nya');
  log.sep();
}

function saveNoPPSet() {
  try {
    fs.writeFileSync(NO_PP_FILE, JSON.stringify([...noPPSet]));
  } catch (e) {
    const cat = categorizeError(e);
    sessionStats.errorsCaptured++;
    log.warn('gagal simpan no_pp_set ke file');
    log.sub('Jenis', `${cat.category}  (${cat.desc})`);
    log.sub('Kode sistem', cat.code);
    log.sub('File target', 'no_pp_set.json');
    log.sub('Dampak', 'daftar "tanpa PP" tidak persisten');
    log.sep();
  }
}

// ==================== PROFILE PICTURE ====================
async function fetchPP(jid, emitEvent) {
  if (!sock || ppCache.has(jid) || noPPSet.has(jid)) return;
  try {
    const url = await sock.profilePictureUrl(jid, 'image');
    savePPToFile(jid, url);
    if (emitEvent) emitEvent('profile_picture', { jid, url });
  } catch (e) {
    noPPSet.add(jid);
    saveNoPPSet();
    const cat = categorizeError(e);
    // Untuk PP no-PP, ini expected behavior — log sebagai info, bukan error
    if (cat.category === 'ERROR TIDAK DIKENAL' && e.message?.includes('not found')) {
      // expected — kontak tidak punya PP
    } else {
      sessionStats.errorsCaptured++;
      log.warn(`gagal ambil foto profil → ${jid}`);
      log.sub('Jenis', `${cat.category}  (${cat.desc})`);
      log.sub('Kode sistem', cat.code);
      log.sub('Dampak', 'kontak ditandai "tanpa PP", tidak akan di-fetch ulang');
      log.sep();
    }
  }
}

async function batchFetchPP(jids, emitEvent) {
  const toFetch = jids.filter(jid => !ppCache.has(jid) && !noPPSet.has(jid));
  const skipped = jids.length - toFetch.length;
  if (toFetch.length === 0) {
    log.pp(`semua sudah cached / tanpa PP  (${skipped} skip)`);
    return;
  }
  log.pp(`batch ${toFetch.length} foto  (${skipped} sudah dikenali)`);
  let success = 0, noPP = 0;
  for (const jid of toFetch) {
    if (!sock) break;
    await fetchPP(jid, emitEvent);
    if (ppCache.has(jid)) success++; else noPP++;
    await new Promise(r => setTimeout(r, 300));
  }
  log.pp(`${success} baru  ·  ${noPP} tanpa PP  ·  ${skipped} skip  ·  total: ${ppCache.size}`);
}

// ==================== PHONE NUMBER ====================
const askPhoneNumber = () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('\n📱 Masukkan nomor WhatsApp (contoh: 628123456789): ', (answer) => {
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
      const cat = categorizeError(e);
      sessionStats.errorsCaptured++;
      log.warn(`gagal fetch grup metadata → ${jid}`);
      log.sub('Jenis', `${cat.category}  (${cat.desc})`);
      log.sub('Kode sistem', cat.code);
      log.sub('Dampak', 'nama grup akan fallback ke "Grup WhatsApp"');
      log.sep();
    }
    return 'Grup WhatsApp';
  }

  // 3. Personal (@s.whatsapp.net atau @lid) — pakai pushName dari pesan
  if (isPersonalJid(jid)) {
    if (pushName && pushName.trim() !== '' && pushName.trim() !== 'undefined' && !/^\d+$/.test(pushName.trim())) {
      saveNameToFile(jid, pushName.trim());
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
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
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
      log.err('nomor tidak valid');
      process.exit(1);
    }

    log.pair('meminta kode pairing...');
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(cleanNumber);
        const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
        log.pair(`→  ${formattedCode}  (berlaku 60 detik)`);
        if (emitEvent) emitEvent('pairing_code', formattedCode);
      } catch (err) {
        const cat = categorizeError(err);
        sessionStats.errorsCaptured++;
        log.err('gagal minta kode pairing');
        log.sub('Jenis', `${cat.category}  (${cat.desc})`);
        log.sub('Kode sistem', cat.code);
        log.sub('Pesan', err.message);
        log.sub('Dampak', 'bot tidak bisa pairing, perlu restart dengan nomor valid');
        log.sep();
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
        log.warn('koneksi terputus');
        log.sub('Jenis', `KONEKSI TERPUTUS  (code: ${statusCode})`);
        log.sub('Dampak', 'menghubungkan ulang...');
        log.sep();
        connectWhatsApp(emitEvent);
      } else {
        log.err('LOGGED OUT — tidak reconnect');
        log.sub('Jenis', 'OTENTIKASI  (sesi logout, tidak bisa reconnect otomatis)');
        log.sub('Dampak', 'bot berhenti, perlu pairing ulang dengan nomor baru');
        log.sep();
        currentWaStatus = 'close';
        if (emitEvent) emitEvent('status', 'close');
      }
    } else if (connection === 'open') {
      log.ok('WhatsApp berhasil terhubung');
      const myJid = sock.user?.id || '';
      const myNumber = myJid ? myJid.split(':')[0].split('@')[0] : '(tidak diketahui)';
      log.sub('Nomor sendiri', `${C.ok('+' + myNumber)}`, COLORS.green);
      log.sub('Platform', `${C.str('Chrome')} ${C.k('di Ubuntu')}`);
      log.sep();
      resetSessionStats();
      log.stat('Sesi direset', `${C.num('0')} masuk  ${C.dot()}  ${C.num('0')} dibalas  ${C.dot()}  ${C.num('0')} gagal`);
      log.sep();

      // Kirim cache ke UI saat koneksi baru
      if (emitEvent) {
        emitEvent('session_stats', getSessionStats());
        if (nameCache.size > 0) {
          emitEvent('name_cache', Object.fromEntries(nameCache));
          log.stat('kirim ke UI', `cache nama kontak  →  ${nameCache.size} data`);
        }
        if (ppCache.size > 0) {
          emitEvent('pp_cache', Object.fromEntries(ppCache));
          log.stat('kirim ke UI', `cache foto profil  →  ${ppCache.size} data`);
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
    log.name(`${count}/${contacts.length} nama kontak diproses`);
    if (emitEvent && count > 0) {
      emitEvent('name_cache', Object.fromEntries(nameCache));
      log.stat('kirim ke UI', `cache nama kontak  →  ${nameCache.size} data`);
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
    if (count > 0) log.name(`${count} grup diperbarui`);
    if (emitEvent && count > 0) {
      emitEvent('name_cache', Object.fromEntries(nameCache));
    }
  });

  // ==================== HISTORY SYNC ====================
  sock.ev.on('messaging-history.set', async ({ messages, chats: chatMap, isLatest }) => {
    const msgCount = messages?.length || 0;
    const chatCount = chatMap ? Object.keys(chatMap).length : 0;
    log.sync('Sinkronisasi riwayat dimulai', `${msgCount} pesan  ·  ${chatCount} percakapan`);

    // 1. Proses chats metadata untuk ambil NAMA
    let nameCount = 0;
    let debugLogged = 0;
    if (chatMap) {
      for (const [jid, chatData] of Object.entries(chatMap)) {
        if (!jid || !chatData) continue;

        // Debug: log 5 pertama untuk lihat struktur
        if (debugLogged < 5) {
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
    log.name(`${nameCount} nama baru  (total: ${nameCache.size} kontak dikenali)`);

    // 2. Proses pesan
    const allJids = new Set();
    let savedCount = 0;
    if (messages && messages.length > 0) {
      for (const msg of messages) {
        await processIncomingMessage(msg, emitEvent, false);
        const jid = msg.key?.remoteJid;
        if (jid && jid !== 'status@broadcast') allJids.add(jid);
        savedCount++;
      }
    }
    log.stat('riwayat selesai diproses', `${savedCount} pesan masuk DB  ·  ${allJids.size} nomor unik  ·  0 duplikat`);

    // 3. Kirim cache ke UI
    if (emitEvent) {
      if (nameCache.size > 0) {
        emitEvent('name_cache', Object.fromEntries(nameCache));
        log.stat('kirim ke UI', `cache nama kontak  →  ${nameCache.size} data`);
      }
      if (ppCache.size > 0) {
        emitEvent('pp_cache', Object.fromEntries(ppCache));
        log.stat('kirim ke UI', `cache foto profil  →  ${ppCache.size} data`);
      }
    }

    // 4. Batch fetch PP di background (hanya jika isLatest)
    if (emitEvent && allJids.size > 0 && isLatest) {
      const toFetch = [...allJids].filter(jid => !ppCache.has(jid));
      if (toFetch.length > 0) {
        log.pp(`akan fetch ${toFetch.length} foto baru dalam 3 detik...`);
        setTimeout(() => batchFetchPP(toFetch, emitEvent), 3000);
      }
    }
    log.sep();
  });

  sock.ev.on('messages.upsert', async ({ type, messages }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      await processIncomingMessage(msg, emitEvent, true);
    }
  });

  // Kirim AI config + session stats ke UI saat connect
  if (emitEvent) {
    emitEvent('ai_config', getAIConfig());
    emitEvent('session_stats', getSessionStats());
  }

  log.boot(`socket dibuat  (disimulasikan: Chrome di Ubuntu)`);
  return sock;
}

// ==================== PROCESS MESSAGE ====================
async function processIncomingMessage(msg, emitEvent, canAutoReply = false) {
  if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

  // ===== DEDUP: skip pesan yang SUDAH diproses (dari path mana pun) =====
  const msgId = msg.key?.id;
  if (msgId && processedMsgIds.has(msgId)) return;
  if (msgId) processedMsgIds.add(msgId);

  const from = msg.key.remoteJid;
  const isMe = msg.key.fromMe;
  const rawPushName = msg.pushName || '';
  const displayName = await getChatName(from, rawPushName);

  const text = msg.message.conversation ||
               msg.message.extendedTextMessage?.text ||
               msg.message.imageMessage?.caption || '';

  if (text) {
    const rawTimestamp = (msg.messageTimestamp?.low || msg.messageTimestamp || Date.now() / 1000) * 1000;

    try {
      saveMessage(from, displayName, text, isMe, rawTimestamp);
    } catch (e) {
      const cat = categorizeError(e);
      sessionStats.errorsCaptured++;
      log.warn('gagal simpan pesan masuk ke database');
      log.sub('Jenis', `${cat.category}  (${cat.desc})`);
      log.sub('Lokasi', 'file connection.js (processIncomingMessage — saveMessage)');
      log.sub('Pesan', e.message);
      log.sub('Dampak', 'pesan tetap muncul di UI, tapi tidak tersimpan permanen');
      log.sep();
    }

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

    // ==================== AUTO-REPLY ====================
    if (canAutoReply && !isMe && from !== 'status@broadcast') {
      if (msgId && repliedMsgIds.has(msgId)) return;
      if (msgId) repliedMsgIds.add(msgId);
      handleAutoReply(from, text, displayName, emitEvent).catch(e => {
        const cat = categorizeError(e);
        sessionStats.errorsCaptured++;
        log.err('auto-reply error tidak tertangkap');
        log.sub('Jenis', `${cat.category}  (${cat.desc})`);
        log.sub('Kode sistem', cat.code);
        log.sub('Pesan', e.message);
        log.sub('Dampak', 'pesan masuk tidak dibalas, bot tetap berjalan');
        log.sep();
      });
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

  try {
    saveMessage(formattedJid, displayName, text, true, rawTimestamp);
  } catch (e) {
    const cat = categorizeError(e);
    sessionStats.errorsCaptured++;
    log.warn('gagal simpan pesan keluar ke database');
    log.sub('Jenis', `${cat.category}  (${cat.desc})`);
    log.sub('Lokasi', 'file connection.js (sendMessage — saveMessage)');
    log.sub('Dampak', 'pesan tetap terkirim ke WhatsApp, tapi tidak tercatat di DB');
    log.sep();
  }

  return { result, timestamp: rawTimestamp, displayName };
}

// ==================== GRACEFUL SHUTDOWN ====================
export async function shutdownBot(io) {
  log.sep();
  SEP_BOLD_TOP();
  console.log(`   🛑  MEMATIKAN BOT SECARA AMAN`);
  console.log(`   ${COLORS.dim}─────────────────────────────────────${COLORS.reset}`);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  console.log(`   🕐  Waktu mulai  :  ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}`);
  SEP_BOLD_BOT();

  log.stat('shutdown aman dimulai', 'sinyal berhenti dari user (Ctrl+C)');

  // 1. Stop menerima pesan baru
  log.wait('stop menerima pesan baru');

  // 2. Drain in-flight messages
  const inflight = sessionStats.incoming - sessionStats.replied - sessionStats.failed - sessionStats.draft;
  if (inflight > 0) {
    log.retry(`menunggu ${inflight} pesan yang sedang diproses...`);
    await new Promise(r => setTimeout(r, 1000));
  }
  log.recover(`semua pesan selesai diproses`);

  // 3. Save session + cache
  try {
    // auth_info disimpan otomatis oleh baileys via saveCreds
    // Simpan cache manual
    if (ppCache.size > 0) saveJSONCache(PP_CACHE_FILE, ppCache);
    if (nameCache.size > 0) saveJSONCache(NAME_CACHE_FILE, nameCache);
    if (noPPSet.size > 0) saveNoPPSet();
    log.done('sesi + cache berhasil disimpan');
    log.sub('auth_info/', '(sesi WhatsApp)');
    log.sub('pp_cache.json', '(foto profil)');
    log.sub('name_cache.json', '(nama kontak)');
    log.sub('no_pp_set.json', '(daftar tanpa PP)');
  } catch (e) {
    log.err('gagal simpan cache saat shutdown');
    log.sub('Pesan', e.message);
  }

  // 4. Close socket
  try {
    if (sock) {
      await sock.logout('Bot shutdown').catch(() => sock.end(new Error('shutdown')));
    }
    log.done('socket WhatsApp ditutup');
  } catch (e) {
    // ignore
  }

  // 5. Close Socket.IO
  if (io) {
    const clientCount = io.engine?.clientsCount || 0;
    io.close(() => {
      log.done(`koneksi Socket.IO dimatikan  (${clientCount} client diputus)`);
    });
  }

  // 6. Final stats
  const stats = getSessionStats();
  const uptimeMs = stats.uptime;
  const pad2 = (n) => String(n).padStart(2, '0');
  const uptimeStr = `${pad2(Math.floor(uptimeMs / 3600000))}:${pad2(Math.floor((uptimeMs % 3600000) / 60000))}:${pad2(Math.floor((uptimeMs % 60000) / 1000))}`;
  log.stat('ringkasan akhir', `${stats.incoming} masuk  ·  ${stats.replied} dibalas  ·  ${stats.failed} gagal`);
  log.done(`bot berhenti normal  (tidak ada error)  ·  total uptime: ${uptimeStr}`);

  process.exit(0);
}

// ==================== UNCAUGHT EXCEPTION & UNHANDLED REJECTION ====================
// SEBELUMNYA: tidak ada handler — sekarang di-capture
process.on('uncaughtException', (err) => {
  sessionStats.errorsCaptured++;
  const cat = categorizeError(err);
  log.crit('error tidak tertangkap (uncaughtException)');
  log.sub('Jenis', `${cat.category}  (${cat.desc})`);
  log.sub('Kode sistem', cat.code);
  log.sub('Lokasi', 'event loop Node.js');
  log.sub('Pesan', err.message);
  log.sub('Stack', err.stack?.split('\n')[1]?.trim() || '(tidak ada)');
  log.sub('Dampak', 'bot mungkin dalam state tidak stabil');
  log.sub('Otomatis', 'error dicatat, bot lanjut berjalan dengan hati-hati');
  log.sep();
});

process.on('unhandledRejection', (reason) => {
  sessionStats.errorsCaptured++;
  const err = reason instanceof Error ? reason : new Error(String(reason));
  const cat = categorizeError(err);
  log.crit('promise tidak tertangani (unhandledRejection)');
  log.sub('Jenis', `${cat.category}  (${cat.desc})`);
  log.sub('Kode sistem', cat.code);
  log.sub('Lokasi', 'async function tanpa try-catch');
  log.sub('Pesan', err.message);
  log.sub('Dampak', 'operasi background gagal, perlu investigasi');
  log.sub('Otomatis', 'dicatat di log, tidak crash bot');
  log.sep();
});
