import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'covers'), { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'hum.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'local',
  path TEXT UNIQUE,
  remote_url TEXT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT 'Unknown Artist',
  artist_id TEXT,
  album TEXT NOT NULL DEFAULT 'Unknown Album',
  album_id TEXT,
  album_artist TEXT,
  track INTEGER,
  disc INTEGER,
  year INTEGER,
  genre TEXT,
  duration INTEGER DEFAULT 0,
  bitrate INTEGER,
  suffix TEXT,
  content_type TEXT,
  size INTEGER DEFAULT 0,
  mtime INTEGER DEFAULT 0,
  cover TEXT,
  license TEXT,
  external_url TEXT,
  created_at INTEGER NOT NULL,
  starred_at INTEGER,
  play_count INTEGER NOT NULL DEFAULT 0,
  last_played INTEGER
);
CREATE INDEX IF NOT EXISTS songs_album ON songs(album_id);
CREATE INDEX IF NOT EXISTS songs_artist ON songs(artist_id);
CREATE INDEX IF NOT EXISTS songs_source ON songs(source);

CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  artist TEXT NOT NULL,
  artist_id TEXT,
  year INTEGER,
  genre TEXT,
  cover TEXT,
  song_count INTEGER DEFAULT 0,
  duration INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  starred_at INTEGER
);

CREATE TABLE IF NOT EXISTS artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  album_count INTEGER DEFAULT 0,
  cover TEXT,
  starred_at INTEGER
);

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  comment TEXT,
  created_at INTEGER NOT NULL,
  changed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_songs (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  song_id TEXT NOT NULL,
  PRIMARY KEY (playlist_id, position)
);

CREATE TABLE IF NOT EXISTS plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id TEXT NOT NULL,
  played_at INTEGER NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS plays_time ON plays(played_at);

CREATE TABLE IF NOT EXISTS lyrics (
  song_id TEXT PRIMARY KEY,
  synced INTEGER NOT NULL DEFAULT 0,
  body TEXT,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

export const now = () => Date.now();

export function kvGet(key, fallback = null) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}
export function kvSet(key, value) {
  db.prepare('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
