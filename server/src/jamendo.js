// Jamendo (https://developer.jamendo.com) is a free, legal catalogue of
// Creative Commons music. Tracks returned from here are stored in the songs
// table with source = 'jamendo', so likes, playlists, stats and radio work the
// same way as for local files. Audio is proxied by /rest/stream.
import { config } from './config.js';
import { db, now } from './db.js';
import { songObj } from './serialize.js';

const API = 'https://api.jamendo.com/v3.0';
export const jamendoEnabled = () => Boolean(config.jamendoClientId);

async function call(endpoint, params = {}) {
  if (!jamendoEnabled()) throw Object.assign(new Error('Jamendo is not configured (set JAMENDO_CLIENT_ID)'), { status: 503 });
  const url = new URL(`${API}/${endpoint}/`);
  url.searchParams.set('client_id', config.jamendoClientId);
  url.searchParams.set('format', 'json');
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw Object.assign(new Error(`Jamendo HTTP ${res.status}`), { status: 502 });
  const json = await res.json();
  if (json.headers?.status !== 'success') throw Object.assign(new Error(json.headers?.error_message || 'Jamendo error'), { status: 502 });
  return json.results;
}

const upsert = db.prepare(`
INSERT INTO songs (id, source, remote_url, title, artist, artist_id, album, album_id, album_artist, track, year, genre,
  duration, suffix, content_type, cover, license, external_url, created_at)
VALUES (?, 'jamendo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mp3', 'audio/mpeg', ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET remote_url=excluded.remote_url, title=excluded.title, artist=excluded.artist,
  album=excluded.album, cover=excluded.cover, genre=COALESCE(excluded.genre, songs.genre), license=excluded.license`);

function storeTrack(t, albumImage) {
  const id = `jm-${t.id}`;
  const genre = t.musicinfo?.tags?.genres?.[0] ?? null;
  const year = t.releasedate ? Number(String(t.releasedate).slice(0, 4)) || null : null;
  upsert.run(id, t.audio, t.name, t.artist_name, `jmar-${t.artist_id}`, t.album_name || 'Single', `jmal-${t.album_id}`,
    t.artist_name, t.position ? Number(t.position) : null, year, genre ? cap(genre) : null, Number(t.duration) || 0,
    t.album_image || t.image || albumImage || null, t.license_ccurl || null, t.shareurl || null, now());
  return songObj(db.prepare('SELECT * FROM songs WHERE id = ?').get(id));
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const TRACK_PARAMS = { include: 'musicinfo licenses', audioformat: 'mp32', imagesize: 600 };

export async function tracks({ search, tags, order = 'popularity_week', limit = 30, offset = 0 } = {}) {
  const results = await call('tracks', { ...TRACK_PARAMS, search, fuzzytags: tags, order: search ? undefined : order, limit, offset });
  return results.map((t) => storeTrack(t));
}

export async function albums({ search, artistId, order = 'popularity_week', limit = 20 } = {}) {
  const results = await call('albums', { namesearch: search, artist_id: artistId, order: search ? undefined : order, limit, imagesize: 600 });
  return results.map((a) => ({
    id: `jmal-${a.id}`, name: a.name, artist: a.artist_name, artistId: `jmar-${a.artist_id}`,
    coverArt: a.image, year: a.releasedate ? Number(a.releasedate.slice(0, 4)) : undefined, source: 'jamendo',
  }));
}

export async function album(id) {
  const [a] = await call('albums/tracks', { id: id.replace(/^jmal-/, ''), ...TRACK_PARAMS, track_type: 'albumtrack' });
  if (!a) return null;
  return {
    id: `jmal-${a.id}`, name: a.name, artist: a.artist_name, artistId: `jmar-${a.artist_id}`, coverArt: a.image,
    year: a.releasedate ? Number(a.releasedate.slice(0, 4)) : undefined, source: 'jamendo',
    song: a.tracks.map((t) => storeTrack({ ...t, album_id: a.id, album_name: a.name, artist_id: a.artist_id, artist_name: a.artist_name, releasedate: a.releasedate }, a.image)),
  };
}

export async function artist(id) {
  const raw = id.replace(/^jmar-/, '');
  const [a] = await call('artists/tracks', { id: raw, ...TRACK_PARAMS, order: 'popularity_total', limit: 50 });
  if (!a) return null;
  const albs = await albums({ artistId: raw, limit: 50 }).catch(() => []);
  return {
    id: `jmar-${a.id}`, name: a.name, coverArt: a.image, source: 'jamendo', album: albs,
    song: a.tracks.map((t) => storeTrack({ ...t, artist_id: a.id, artist_name: a.name })),
  };
}

export async function artists({ search, limit = 20 } = {}) {
  const results = await call('artists', { namesearch: search, order: search ? undefined : 'popularity_week', limit, hasimage: true });
  return results.map((a) => ({ id: `jmar-${a.id}`, name: a.name, coverArt: a.image, source: 'jamendo' }));
}

// Re-fetch a stored track (audio URLs can expire).
export async function refreshTrack(songId) {
  const [t] = await call('tracks', { ...TRACK_PARAMS, id: songId.replace(/^jm-/, '') });
  return t ? storeTrack(t) : null;
}
