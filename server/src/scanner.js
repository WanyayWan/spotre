import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { config } from './config.js';
import { db, now, tx } from './db.js';
import { hashId, AUDIO_TYPES } from './util.js';

export const scanState = { scanning: false, count: 0, lastScan: null, error: null };

const COVER_NAMES = ['cover', 'folder', 'front', 'album', 'artwork'];
const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

async function* walk(dir) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile() && AUDIO_TYPES[path.extname(e.name).slice(1).toLowerCase()]) yield full;
  }
}

function findFolderCover(dir) {
  let files;
  try { files = fs.readdirSync(dir); } catch { return null; }
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (IMG_EXT.includes(ext) && COVER_NAMES.includes(path.basename(f, ext).toLowerCase())) return path.join(dir, f);
  }
  return null;
}

const upsert = db.prepare(`
INSERT INTO songs (id, source, path, title, artist, artist_id, album, album_id, album_artist, track, disc, year, genre,
  duration, bitrate, suffix, content_type, size, mtime, cover, created_at)
VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET path=excluded.path, title=excluded.title, artist=excluded.artist, artist_id=excluded.artist_id,
  album=excluded.album, album_id=excluded.album_id, album_artist=excluded.album_artist, track=excluded.track, disc=excluded.disc,
  year=excluded.year, genre=excluded.genre, duration=excluded.duration, bitrate=excluded.bitrate, suffix=excluded.suffix,
  content_type=excluded.content_type, size=excluded.size, mtime=excluded.mtime, cover=excluded.cover`);

export async function scanFile(file, known = null) {
  const stat = await fsp.stat(file);
  const rel = path.relative(config.musicDir, file);
  const id = hashId('tr-', rel);
  const prev = known ?? db.prepare('SELECT mtime, size FROM songs WHERE id = ?').get(id);
  if (prev && prev.mtime === Math.floor(stat.mtimeMs) && prev.size === stat.size) return id;

  let meta;
  try { meta = await parseFile(file, { duration: true, skipCovers: false }); }
  catch (e) { console.warn('[scan] could not read', rel, e.message); return null; }
  const c = meta.common;
  const ext = path.extname(file).slice(1).toLowerCase();
  const title = c.title || path.basename(file, path.extname(file));
  const artist = c.artist || c.albumartist || 'Unknown Artist';
  const albumArtist = c.albumartist || artist;
  const album = c.album || path.basename(path.dirname(file)) || 'Unknown Album';
  const albumId = hashId('al-', albumArtist, album);
  const artistId = hashId('ar-', albumArtist);

  let cover = null;
  const pic = c.picture?.[0];
  if (pic?.data?.length) {
    const pext = pic.format?.includes('png') ? 'png' : 'jpg';
    cover = path.join(config.dataDir, 'covers', `${albumId}.${pext}`);
    if (!fs.existsSync(cover)) await fsp.writeFile(cover, pic.data);
  } else {
    cover = findFolderCover(path.dirname(file));
  }

  upsert.run(id, rel, title, artist, artistId, album, albumId, albumArtist,
    c.track?.no ?? null, c.disk?.no ?? null, c.year ?? null, c.genre?.[0] ?? null,
    Math.round(meta.format.duration || 0), meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : null,
    ext, AUDIO_TYPES[ext], stat.size, Math.floor(stat.mtimeMs), cover, now());

  // Keep embedded lyrics so they show up without any network lookup.
  const lyr = extractEmbeddedLyrics(c.lyrics);
  if (lyr) db.prepare('INSERT OR REPLACE INTO lyrics(song_id, synced, body, fetched_at) VALUES(?,?,?,?)').run(id, lyr.synced ? 1 : 0, lyr.body, now());
  return id;
}

function extractEmbeddedLyrics(list) {
  if (!list?.length) return null;
  const l = list[0];
  if (typeof l === 'string') return { synced: /\[\d+:\d+/.test(l), body: l };
  if (l.syncText?.length) {
    const body = l.syncText.map((s) => `[${fmtLrc(s.timestamp)}]${s.text}`).join('\n');
    return { synced: true, body };
  }
  if (l.text) return { synced: /\[\d+:\d+/.test(l.text), body: l.text };
  return null;
}
const fmtLrc = (ms = 0) => {
  const m = Math.floor(ms / 60000), s = ((ms % 60000) / 1000).toFixed(2).padStart(5, '0');
  return `${String(m).padStart(2, '0')}:${s}`;
};

export function rebuildAggregates() {
  tx(() => {
    const prevAlbums = new Map(db.prepare('SELECT id, created_at, starred_at FROM albums').all().map((r) => [r.id, r]));
    const prevArtists = new Map(db.prepare('SELECT id, starred_at FROM artists').all().map((r) => [r.id, r]));
    db.exec('DELETE FROM albums; DELETE FROM artists;');
    const albums = db.prepare(`
      SELECT album_id AS id, album AS name, COALESCE(album_artist, artist) AS artist, artist_id,
        MAX(year) AS year, MAX(genre) AS genre, MAX(cover) AS cover, COUNT(*) AS song_count,
        SUM(duration) AS duration, MIN(created_at) AS created_at
      FROM songs WHERE source = 'local' GROUP BY album_id`).all();
    const insA = db.prepare('INSERT INTO albums VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    for (const a of albums) {
      const p = prevAlbums.get(a.id);
      insA.run(a.id, a.name, a.artist, a.artist_id, a.year, a.genre, a.cover, a.song_count, a.duration, p?.created_at ?? a.created_at, p?.starred_at ?? null);
    }
    const artists = db.prepare(`
      SELECT artist_id AS id, artist AS name, COUNT(*) AS album_count, MAX(cover) AS cover
      FROM albums GROUP BY artist_id`).all();
    const insR = db.prepare('INSERT INTO artists VALUES (?,?,?,?,?)');
    for (const r of artists) insR.run(r.id, r.name, r.album_count, r.cover, prevArtists.get(r.id)?.starred_at ?? null);
  });
}

export async function scanLibrary() {
  if (scanState.scanning) return scanState;
  Object.assign(scanState, { scanning: true, count: 0, error: null });
  try {
    fs.mkdirSync(config.musicDir, { recursive: true });
    const known = new Map(db.prepare("SELECT id, mtime, size FROM songs WHERE source = 'local'").all().map((r) => [r.id, r]));
    const seen = new Set();
    for await (const file of walk(config.musicDir)) {
      const id = hashId('tr-', path.relative(config.musicDir, file));
      const got = await scanFile(file, known.get(id) ?? null);
      if (got) seen.add(got);
      scanState.count++;
    }
    const gone = [...known.keys()].filter((id) => !seen.has(id));
    if (gone.length) {
      const del = db.prepare('DELETE FROM songs WHERE id = ?');
      tx(() => gone.forEach((id) => del.run(id)));
    }
    rebuildAggregates();
    scanState.lastScan = new Date().toISOString();
    console.log(`[scan] ${seen.size} tracks in library (${gone.length} removed)`);
  } catch (e) {
    scanState.error = e.message;
    console.error('[scan] failed', e);
  } finally {
    scanState.scanning = false;
  }
  return scanState;
}
