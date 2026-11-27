// Recommendations built only from your own library and listening history.
import { db } from './db.js';
import { shuffle, seeded } from './util.js';
import * as jamendo from './jamendo.js';

const local = "source = 'local'";

export async function similarSongs(seedId, count = 50) {
  const seed = db.prepare('SELECT * FROM songs WHERE id = ?').get(seedId);
  if (!seed) return [];
  if (seed.source === 'jamendo' && jamendo.jamendoEnabled()) {
    const tags = seed.genre?.toLowerCase();
    const more = await jamendo.tracks({ tags, order: 'popularity_month', limit: count }).catch(() => []);
    const byArtist = db.prepare("SELECT * FROM songs WHERE source='jamendo' AND artist_id = ? AND id != ? LIMIT 10").all(seed.artist_id, seed.id);
    return spread([seed, ...shuffle(byArtist).slice(0, 5), ...more.filter((s) => s.id !== seed.id)].map(toRowish));
  }
  const sameArtist = db.prepare(`SELECT * FROM songs WHERE ${local} AND artist_id = ? AND id != ?`).all(seed.artist_id, seed.id);
  const sameGenre = seed.genre
    ? db.prepare(`SELECT * FROM songs WHERE ${local} AND genre = ? AND artist_id != ? ORDER BY RANDOM() LIMIT ?`).all(seed.genre, seed.artist_id, count)
    : [];
  const era = seed.year
    ? db.prepare(`SELECT * FROM songs WHERE ${local} AND year BETWEEN ? AND ? AND artist_id != ? ORDER BY RANDOM() LIMIT ?`).all(seed.year - 4, seed.year + 4, seed.artist_id, 15)
    : [];
  const loved = db.prepare(`SELECT * FROM songs WHERE ${local} AND (starred_at IS NOT NULL OR play_count > 2) AND id != ? ORDER BY RANDOM() LIMIT 10`).all(seed.id);
  const pool = [...shuffle(sameArtist).slice(0, Math.ceil(count / 5)), ...sameGenre, ...era, ...loved];
  const seen = new Set([seed.id]);
  const picked = [seed];
  for (const s of pool) if (!seen.has(s.id)) { seen.add(s.id); picked.push(s); }
  if (picked.length < count) {
    for (const s of db.prepare(`SELECT * FROM songs WHERE ${local} ORDER BY RANDOM() LIMIT ?`).all(count)) {
      if (!seen.has(s.id)) { seen.add(s.id); picked.push(s); }
    }
  }
  return spread(picked.slice(0, count));
}

const toRowish = (o) => (o.album_id ? o : db.prepare('SELECT * FROM songs WHERE id = ?').get(o.id));

// Re-order so the same artist doesn't play twice in a row when avoidable.
export function spread(rows) {
  if (rows.length < 3) return rows;
  const [first, ...rest] = rows;
  const out = [first];
  const pool = shuffle(rest);
  while (pool.length) {
    const last = out[out.length - 1];
    let i = pool.findIndex((r) => r.artist_id !== last.artist_id);
    if (i < 0) i = 0;
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

export function smartPlaylist(kind, limit = 100) {
  switch (kind) {
    case 'most-played':
      return db.prepare('SELECT * FROM songs WHERE play_count > 0 ORDER BY play_count DESC, last_played DESC LIMIT ?').all(limit);
    case 'recently-played':
      return db.prepare('SELECT * FROM songs WHERE last_played IS NOT NULL ORDER BY last_played DESC LIMIT ?').all(limit);
    case 'recently-added':
      return db.prepare(`SELECT * FROM songs WHERE ${local} ORDER BY created_at DESC LIMIT ?`).all(limit);
    case 'never-played':
      return db.prepare(`SELECT * FROM songs WHERE ${local} AND play_count = 0 ORDER BY RANDOM() LIMIT ?`).all(limit);
    case 'forgotten': // loved once, not heard in 60 days
      return db.prepare(`SELECT * FROM songs WHERE play_count >= 3 AND last_played < ? ORDER BY play_count DESC LIMIT ?`).all(Date.now() - 60 * 86400000, limit);
    case 'liked':
      return db.prepare('SELECT * FROM songs WHERE starred_at IS NOT NULL ORDER BY starred_at DESC LIMIT ?').all(limit);
    default:
      return null;
  }
}

export const SMART = [
  { id: 'liked', name: 'Liked Songs', description: 'Everything you have hearted' },
  { id: 'most-played', name: 'On Repeat', description: 'Your most played songs' },
  { id: 'recently-added', name: 'Fresh Arrivals', description: 'Newest in your library' },
  { id: 'recently-played', name: 'Recently Played', description: 'Pick up where you left off' },
  { id: 'never-played', name: 'Unheard', description: 'Songs you have never played' },
  { id: 'forgotten', name: 'Rediscover', description: 'Old favourites you have not played lately' },
];

// Up to 4 "daily mixes": each one is anchored on a favourite artist or genre,
// padded with related songs, and reshuffled once per day.
export function dailyMixes() {
  const day = new Date().toISOString().slice(0, 10);
  const rand = seeded(day);
  const since = Date.now() - 45 * 86400000;
  let anchors = db.prepare(`
    SELECT s.genre AS genre, s.artist_id AS artist_id, s.artist AS artist, COUNT(*) AS n
    FROM plays p JOIN songs s ON s.id = p.song_id
    WHERE p.played_at > ? AND s.genre IS NOT NULL GROUP BY s.genre ORDER BY n DESC LIMIT 4`).all(since);
  if (anchors.length < 2) {
    anchors = db.prepare(`SELECT genre, MAX(artist_id) AS artist_id, MAX(artist) AS artist, COUNT(*) AS n FROM songs
      WHERE ${local} AND genre IS NOT NULL GROUP BY genre HAVING n >= 5 ORDER BY n DESC LIMIT 4`).all();
  }
  const mixes = anchors.map((a, i) => {
    const core = db.prepare('SELECT * FROM songs WHERE genre = ? ORDER BY RANDOM() LIMIT 80').all(a.genre);
    const fav = db.prepare(`SELECT s.* FROM plays p JOIN songs s ON s.id = p.song_id WHERE s.genre = ? GROUP BY s.id ORDER BY COUNT(*) DESC LIMIT 10`).all(a.genre);
    const seen = new Set();
    const songs = spread(shuffle([...fav, ...core], rand).filter((s) => !seen.has(s.id) && seen.add(s.id))).slice(0, 40);
    const artistsInMix = [...new Set(songs.map((s) => s.artist))].slice(0, 3);
    return { id: `mix-${i + 1}`, name: `Daily Mix ${i + 1}`, genre: a.genre, description: artistsInMix.join(', ') + (artistsInMix.length ? ' and more' : ''), songs };
  }).filter((m) => m.songs.length >= 3);
  if (!mixes.length) {
    const songs = db.prepare(`SELECT * FROM songs WHERE ${local} ORDER BY RANDOM() LIMIT 40`).all();
    if (songs.length) mixes.push({ id: 'mix-1', name: 'Daily Mix 1', description: 'A bit of everything', songs: spread(songs) });
  }
  return mixes;
}

export function stats(days, tzOffsetMin = 0) {
  const shift = -Number(tzOffsetMin || 0) * 60000; // JS getTimezoneOffset() is UTC minus local
  const since = days ? Date.now() - days * 86400000 : 0;
  const totals = db.prepare('SELECT COUNT(*) AS plays, COALESCE(SUM(seconds),0) AS seconds, COUNT(DISTINCT song_id) AS songs FROM plays WHERE played_at > ?').get(since);
  const topSongs = db.prepare(`SELECT s.*, COUNT(*) AS n FROM plays p JOIN songs s ON s.id = p.song_id WHERE p.played_at > ?
    GROUP BY s.id ORDER BY n DESC LIMIT 10`).all(since);
  const topArtists = db.prepare(`SELECT s.artist AS name, s.artist_id AS id, MAX(s.cover) AS cover, MAX(s.album_id) AS album_id, MAX(s.source) AS source,
    COUNT(*) AS n, SUM(p.seconds) AS seconds FROM plays p JOIN songs s ON s.id = p.song_id WHERE p.played_at > ?
    GROUP BY s.artist_id ORDER BY n DESC LIMIT 10`).all(since);
  const topGenres = db.prepare(`SELECT s.genre AS name, COUNT(*) AS n FROM plays p JOIN songs s ON s.id = p.song_id
    WHERE p.played_at > ? AND s.genre IS NOT NULL GROUP BY s.genre ORDER BY n DESC LIMIT 8`).all(since);
  const hours = Array(24).fill(0);
  for (const r of db.prepare('SELECT played_at FROM plays WHERE played_at > ?').all(since)) hours[new Date(r.played_at + shift).getUTCHours()]++;
  const daily = db.prepare(`SELECT date((played_at + ?)/1000, 'unixepoch') AS day, SUM(seconds) AS seconds FROM plays
    WHERE played_at > ? GROUP BY day ORDER BY day DESC LIMIT 30`).all(shift, since).reverse();
  return { totals, topSongs, topArtists, topGenres, hours, daily };
}
