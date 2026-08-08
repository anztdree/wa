import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectWhatsApp, sendMessage, currentWaStatus, getPPCache, getNameCache, getAIConfig, setAIConfig, setAutoReplyEnabled, setSendMode, getSessionStats } from './src/connection.js';
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

console.clear();
console.log('========================================');
console.log('🚀 WA MOBILE WEB ENGINE RUNNING');
console.log('========================================');

connectWhatsApp(emitEvent);

io.on('connection', (socket) => {
  console.log('📱 Web UI Client Terhubung');

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

  // Kirim AI config + session stats ke UI
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
});

const PORT = 3500;
httpServer.listen(PORT, () => {
  console.log(`🌐 Akses Web UI di: http://localhost:${PORT}`);
});
