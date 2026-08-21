import './src/loadEnv.js'; // Load .env di paling awal, sebelum import lain
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectWhatsApp, sendMessage, currentWaStatus, getPPCache, getNameCache, getAIProviders, getAIConfig, setAIConfig, setAutoReplyEnabled, setSendMode, getSessionStats, fetchProviderModels, shutdownBot } from './src/connection.js';
import { getAllMessages } from './src/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const emitEvent = (event, data) => {
  io.emit(event, data);
};

// ==================== STARTUP BANNER ====================
const COLORS = {
  reset: '\x1b[0m',
  dim:   '\x1b[2m',
  cyan:  '\x1b[36m',
  bold:  '\x1b[1m',
};

function printBanner() {
  const now = new Date();
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}  ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}  WIB`;
  const pid = process.pid;
  const nodeVer = process.version;
  const port = process.env.PORT || 3500;

  console.log();
  console.log(`${COLORS.cyan}${'═'.repeat(69)}${COLORS.reset}`);
  console.log(`   🚀  ${COLORS.bold}WA MOBILE WEB ENGINE${COLORS.reset}  v1.0.0`);
  console.log(`   ${COLORS.dim}─────────────────────────────────────${COLORS.reset}`);
  console.log(`   📅  Tanggal         :  ${dateStr}`);
  console.log(`   🆔  Nomor proses    :  ${pid}  ${COLORS.dim}(PENGENAL DI SISTEM)${COLORS.reset}`);
  console.log(`   🌐  Web UI          :  http://localhost:${port}`);
  console.log(`   🔧  Versi Node.js   :  ${nodeVer}`);
  console.log(`${COLORS.cyan}${'═'.repeat(69)}${COLORS.reset}`);
  console.log();
}

console.clear();
printBanner();

connectWhatsApp(emitEvent);

io.on('connection', (socket) => {
  console.log(`📱 Web UI Client Terhubung  →  ${socket.id}`);

  // PERBAIKAN: Langsung kirimkan status WA terkini saat UI dibuka/refresh
  socket.emit('status', currentWaStatus);

  // Kirim riwayat pesan dari DB saat client terhubung
  const storedMessages = getAllMessages();
  socket.emit('load_history', storedMessages);

  // Kirim cached PP & nama (supaya survive refresh)
  const ppData = getPPCache();
  if (Object.keys(ppData).length > 0) socket.emit('pp_cache', ppData);
  const nameData = getNameCache();
  if (Object.keys(nameData).length > 0) socket.emit('name_cache', nameData);

  // Kirim AI providers + config + session stats ke UI
  socket.emit('ai_providers', getAIProviders());
  socket.emit('ai_config', getAIConfig());
  socket.emit('session_stats', getSessionStats());

  socket.on('send_message', async (data, callback) => {
    try {
      await sendMessage(data.to, data.message);
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('save_ai_config', (data, callback) => {
    try {
      setAIConfig(data);
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  socket.on('toggle_autoreply', (data) => {
    setAutoReplyEnabled(data.enabled);
  });

  socket.on('set_send_mode', (data) => {
    setSendMode(data.mode);
  });

  socket.on('fetch_models', async (data, callback) => {
    try {
      const result = await fetchProviderModels(data.provider, data.force || false);
      if (callback) callback(result);
    } catch (err) {
      if (callback) callback({ success: false, error: err.message, models: [], provider: data.provider });
    }
  });

  socket.on('disconnect', () => {
    console.log(`📱 Web UI Client terputus  →  ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3500;
httpServer.listen(PORT, () => {
  console.log(`🌐 Web UI siap diakses di: http://localhost:${PORT}`);
  console.log();
});

// ==================== PERIODIC SESSION STATS (every 5 minutes) ====================
setInterval(() => {
  const stats = getSessionStats();
  if (stats.incoming === 0) return; // skip jika belum ada aktivitas
  const pad2 = (n) => String(n).padStart(2, '0');
  const uptimeStr = `${pad2(Math.floor(stats.uptime / 3600000))}:${pad2(Math.floor((stats.uptime % 3600000) / 60000))}:${pad2(Math.floor((stats.uptime % 60000) / 1000))}`;
  console.log(`${COLORS.cyan}${'═'.repeat(69)}${COLORS.reset}`);
  console.log(`   📊  RINGKASAN STATISTIK SESI`);
  console.log(`   ${COLORS.dim}─────────────────────────────────────${COLORS.reset}`);
  console.log(`   🕐  Durasi sesi            :  ${uptimeStr}`);
  console.log(`   📥  Pesan masuk            :  ${stats.incoming}`);
  console.log(`   🤖  Pesan dibalas          :  ${stats.replied}   (${stats.incoming > 0 ? (stats.replied / stats.incoming * 100).toFixed(1) : 0}%)`);
  console.log(`   📝  Disimpan draft         :  ${stats.draft}   (${stats.incoming > 0 ? (stats.draft / stats.incoming * 100).toFixed(1) : 0}%)`);
  console.log(`   ❌  Gagal                  :  ${stats.failed}   (${stats.incoming > 0 ? (stats.failed / stats.incoming * 100).toFixed(1) : 0}%)`);
  console.log(`   🔁  Total percobaan ulang  :  ${stats.retries}   (${stats.retriesRecovered} berhasil pulih)`);
  console.log(`   ⏱️  Rata-rata waktu        :  ${stats.avgLatency} ms`);
  console.log(`   📈  Waktu maksimal 95%     :  ${stats.p95Latency} ms  ${COLORS.dim}(hanya 5% pesan lebih lambat dari ini)${COLORS.reset}`);
  console.log(`   💾  Memori yang dipakai    :  ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`);
  console.log(`   🔌  Client Web UI          :  ${io.engine?.clientsCount || 0}`);
  console.log(`   ⚠️  Error tertangkap       :  ${stats.errorsCaptured}   ${COLORS.dim}(sebelumnya silent, sekarang terlihat)${COLORS.reset}`);
  console.log(`${COLORS.cyan}${'═'.repeat(69)}${COLORS.reset}`);
  console.log();
}, 5 * 60 * 1000); // 5 menit

// ==================== GRACEFUL SHUTDOWN ====================
let isShuttingDown = false;
async function gracefulShutdown(signal) {
  if (isShuttingDown) return; // cegah double shutdown
  isShuttingDown = true;
  await shutdownBot(io);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
