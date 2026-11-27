import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db, now } from './db.js';

const DAY = 86400000;

export function parseLrc(body) {
  const lines = [];
  for (const raw of body.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) lines.push({ start: Math.round((Number(m[1]) * 60 + Number(m[2])) * 1000), value: text });
  }
  return lines.sort((a, b) => a.start - b.start);
}

function sidecar(song) {
  if (song.source !== 'local' || !song.path) return null;
  const file = path.join(config.musicDir, song.path);
  const lrc = file.replace(/\.[^.]+$/, '.lrc');
  if (fs.existsSync(lrc)) return { synced: true, body: fs.readFileSync(lrc, 'utf8') };
  const txt = file.replace(/\.[^.]+$/, '.txt');
  if (fs.existsSync(txt)) return { synced: false, body: fs.readFileSync(txt, 'utf8') };
  return null;
}

async function lrclib(song) {
  if (!config.lrclib) return null;
  const q = new URLSearchParams({ artist_name: song.artist, track_name: song.title });
  if (song.album) q.set('album_name', song.album);
  if (song.duration) q.set('duration', String(song.duration));
  const headers = { 'User-Agent': 'Hum self-hosted music server (https://github.com/)' };
  try {
    let res = await fetch(`https://lrclib.net/api/get?${q}`, { headers, signal: AbortSignal.timeout(8000) });
    let hit = res.ok ? await res.json() : null;
    if (!hit) {
      const s = new URLSearchParams({ artist_name: song.artist, track_name: song.title });
      res = await fetch(`https://lrclib.net/api/search?${s}`, { headers, signal: AbortSignal.timeout(8000) });
      const list = res.ok ? await res.json() : [];
      hit = list.find((l) => l.syncedLyrics) || list[0] || null;
    }
    if (!hit) return { synced: false, body: null };
    if (hit.syncedLyrics) return { synced: true, body: hit.syncedLyrics };
    return { synced: false, body: hit.plainLyrics || null };
  } catch {
    return undefined; // network problem: don't cache
  }
}

// Returns { synced, lines:[{start?, value}] } or null.
export async function lyricsFor(song) {
  let row = db.prepare('SELECT * FROM lyrics WHERE song_id = ?').get(song.id);
  if (!row || (!row.body && now() - row.fetched_at > 7 * DAY)) {
    const found = sidecar(song) ?? (await lrclib(song));
    if (found !== undefined) {
      db.prepare('INSERT OR REPLACE INTO lyrics(song_id, synced, body, fetched_at) VALUES(?,?,?,?)')
        .run(song.id, found?.synced ? 1 : 0, found?.body ?? null, now());
      row = { synced: found?.synced ? 1 : 0, body: found?.body ?? null };
    }
  }
  if (!row?.body) return null;
  if (row.synced) {
    const lines = parseLrc(row.body);
    if (lines.length) return { synced: true, lines };
  }
  return { synced: false, lines: row.body.split(/\r?\n/).map((value) => ({ value })) };
}
