// ==================== ZERO-DEP .ENV LOADER ====================
// Baca file .env di root project, populate process.env.
// Shell env vars selalu menang (tidak di-override oleh .env).
// Support: komentar (#), quotes ("..." dan '...'), baris kosong.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  let loaded = 0;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // Shell env menang, jangan override
    if (!(key in process.env)) {
      process.env[key] = val;
      loaded++;
    }
  }
  // Silent on success — env vars siap dipakai
} else {
  // .env belum ada — bukan fatal, bot tetap jalan (AI key akan kosong)
  console.warn('\n⚠️  File .env tidak ditemukan di root project.');
  console.warn('   Buat file .env dengan isi: NVIDIA_API_KEY=xxx, GEMINI_API_KEY=xxx, dll.\n');
}
