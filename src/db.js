import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database disimpan di data/db/ — auto-create folder jika belum ada
const DB_DIR = path.join(__dirname, '..', 'data', 'db');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'messages.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jid TEXT NOT NULL,
    push_name TEXT DEFAULT '',
    text TEXT NOT NULL,
    is_me INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

export function saveMessage(jid, pushName, text, isMe, timestamp) {
  const stmt = db.prepare(`
    INSERT INTO messages (jid, push_name, text, is_me, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(jid, pushName || '', text, isMe ? 1 : 0, timestamp);
}

export function getAllMessages() {
  const stmt = db.prepare(`SELECT * FROM messages ORDER BY id ASC`);
  const rows = stmt.all();
  return rows.map(row => ({
    from: row.jid,
    pushName: row.push_name || '',
    text: row.text,
    isMe: Boolean(row.is_me),
    timestamp: row.timestamp
  }));
}
