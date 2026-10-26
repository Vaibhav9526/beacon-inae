import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS alerts_sent (alert_id TEXT, device TEXT, ts INTEGER, PRIMARY KEY (alert_id, device));
CREATE TABLE IF NOT EXISTS devices (
  device TEXT PRIMARY KEY, push_token TEXT, lat REAL, lon REAL, lang TEXT, updated INTEGER
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, device TEXT NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL,
  media_path TEXT NOT NULL, thumb_path TEXT, caption TEXT, lat REAL NOT NULL, lon REAL NOT NULL,
  captured_at INTEGER NOT NULL, created_at INTEGER NOT NULL, delayed INTEGER DEFAULT 0,
  status TEXT NOT NULL, ai_json TEXT, summary TEXT, category TEXT, mod_note TEXT,
  real_votes INTEGER DEFAULT 0, fake_votes INTEGER DEFAULT 0, proof TEXT
);
CREATE INDEX IF NOT EXISTS reports_status ON reports (status, created_at);
CREATE TABLE IF NOT EXISTS votes (report_id TEXT, device TEXT, vote TEXT, ts INTEGER, PRIMARY KEY (report_id, device));
CREATE TABLE IF NOT EXISTS sos (
  id TEXT PRIMARY KEY, device TEXT, name TEXT, lat REAL, lon REAL, note TEXT, medical TEXT,
  ts INTEGER, via TEXT, resolved INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS safe (
  id TEXT PRIMARY KEY, device TEXT, name TEXT, family TEXT, lat REAL, lon REAL, note TEXT, ts INTEGER, kind TEXT DEFAULT 'safe'
);
CREATE TABLE IF NOT EXISTS family_zones (
  family TEXT, id TEXT, name TEXT, lat REAL, lon REAL, radius REAL, PRIMARY KEY (family, id)
);
CREATE TABLE IF NOT EXISTS family_loc (
  family TEXT, device TEXT, name TEXT, lat REAL, lon REAL, ts INTEGER, PRIMARY KEY (family, device)
);
CREATE TABLE IF NOT EXISTS board (
  id TEXT PRIMARY KEY, device TEXT, kind TEXT, text TEXT, nickname TEXT, lat REAL, lon REAL, ts INTEGER
);
CREATE TABLE IF NOT EXISTS hubs (hub_id TEXT PRIMARY KEY, pub_key TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hub_pair_tokens (
  token TEXT PRIMARY KEY, hub_id TEXT NOT NULL, expires INTEGER NOT NULL, used_by TEXT
);
CREATE TABLE IF NOT EXISTS hub_links (
  hub_id TEXT, device TEXT, push_token TEXT, paired_at INTEGER, PRIMARY KEY (hub_id, device)
);
CREATE TABLE IF NOT EXISTS mail (
  id TEXT PRIMARY KEY, recipient TEXT NOT NULL, sender TEXT NOT NULL, kind TEXT NOT NULL, blob TEXT NOT NULL, at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mail_recipient ON mail (recipient, at);
CREATE TABLE IF NOT EXISTS chat_msgs (
  id TEXT PRIMARY KEY, room TEXT NOT NULL, ts INTEGER NOT NULL, nick TEXT NOT NULL, text TEXT NOT NULL,
  device TEXT NOT NULL, flags TEXT NOT NULL DEFAULT '', hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS chat_room_ts ON chat_msgs (room, ts);
CREATE TABLE IF NOT EXISTS chat_reports (msg_id TEXT, reporter TEXT, reason TEXT, ts INTEGER, PRIMARY KEY (msg_id, reporter));
CREATE TABLE IF NOT EXISTS chat_bans (device TEXT PRIMARY KEY, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_cfg (
  hub_id TEXT PRIMARY KEY, token TEXT NOT NULL, secret TEXT NOT NULL, username TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS telegram_chats (
  hub_id TEXT NOT NULL, chat_id INTEGER NOT NULL, name TEXT NOT NULL, paired_at INTEGER NOT NULL, PRIMARY KEY (hub_id, chat_id)
);
CREATE TABLE IF NOT EXISTS telegram_codes (code TEXT PRIMARY KEY, hub_id TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, hub_id TEXT NOT NULL, chat_id INTEGER NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS telegram_inbox_hub ON telegram_inbox (hub_id, id);
`;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}
