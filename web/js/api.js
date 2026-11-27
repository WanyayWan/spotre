// Client for the Subsonic API (+ Hum extensions). Works against the Hum
// server, and the Subsonic parts also work against Navidrome & co.
import { md5 } from './md5.js';

const KEY = 'hum.session';
const CLIENT = 'hum-pwa';
let session = load();
let features = { uploads: false, jamendo: false, smart: false, mixes: false, stats: false };

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}

export const getSession = () => session;
export const getFeatures = () => features;

const base = () => (session?.server || location.origin).replace(/\/$/, '');

function authQuery() {
  return new URLSearchParams({ u: session.user, t: session.token, s: session.salt, v: '1.16.1', c: CLIENT, f: 'json' });
}

export async function login(server, user, password) {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  const candidate = { server: server || '', user, salt, token: md5(password + salt) };
  const prev = session;
  session = candidate;
  try {
    await rest('ping');
    localStorage.setItem(KEY, JSON.stringify(session));
    await loadFeatures();
    return true;
  } catch (e) {
    session = prev;
    throw e;
  }
}

export function logout() {
  localStorage.removeItem(KEY);
  session = null;
}

export async function loadFeatures() {
  try {
    const r = await fetch(`${base()}/api/info`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) features = { ...features, ...(await r.json()).features };
  } catch { /* not a Hum server, or offline */ }
  return features;
}

export class ApiError extends Error {}

export async function rest(method, params = {}) {
  if (!session) throw new ApiError('Not signed in');
  const q = authQuery();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
    else q.set(k, v);
  }
  // Long id lists (big playlists, play queues) go in a form body.
  const long = q.toString().length > 1800;
  const res = await fetch(long ? `${base()}/rest/${method}` : `${base()}/rest/${method}?${q}`, long
    ? { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: q }
    : undefined);
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`);
  const body = (await res.json())['subsonic-response'];
  if (body.status !== 'ok') throw new ApiError(body.error?.message || 'Request failed');
  return body;
}

export async function hum(path, opts = {}) {
  const q = authQuery();
  const url = `${base()}/api/${path}${path.includes('?') ? '&' : '?'}${q}`;
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error || `HTTP ${res.status}`);
  return body;
}

export function uploadFiles(files, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const f of files) form.append('files', f, f.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${base()}/api/upload?${authQuery()}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve(JSON.parse(xhr.responseText)) : reject(new ApiError(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new ApiError('Upload failed'));
    xhr.send(form);
  });
}

export function streamUrl(id) {
  return `${base()}/rest/stream?id=${encodeURIComponent(id)}&${authQuery()}`;
}

export function coverUrl(id, size = 600) {
  if (!id || !session) return '';
  const q = authQuery();
  q.delete('f');
  return `${base()}/rest/getCoverArt?id=${encodeURIComponent(id)}&size=${size}&${q}`;
}

// --- convenience wrappers ---
export const api = {
  albums: (type = 'newest', size = 30, extra = {}) => rest('getAlbumList2', { type, size, ...extra }).then((r) => r.albumList2?.album || []),
  album: (id) => (id.startsWith('jmal-') ? hum(`jamendo/album/${encodeURIComponent(id)}`) : rest('getAlbum', { id }).then((r) => r.album)),
  artists: () => rest('getArtists').then((r) => (r.artists?.index || []).flatMap((i) => i.artist || [])),
  artist: (id) => (id.startsWith('jmar-') ? hum(`jamendo/artist/${encodeURIComponent(id)}`) : rest('getArtist', { id }).then((r) => r.artist)),
  topSongs: (artist) => rest('getTopSongs', { artist, count: 10 }).then((r) => r.topSongs?.song || []),
  search: (query) => rest('search3', { query, songCount: 30, albumCount: 12, artistCount: 8 }).then((r) => r.searchResult3 || {}),
  allSongs: (size = 500, offset = 0) => rest('search3', { query: '', songCount: size, songOffset: offset, albumCount: 0, artistCount: 0 }).then((r) => r.searchResult3?.song || []),
  random: (size = 50, genre) => rest('getRandomSongs', { size, genre }).then((r) => r.randomSongs?.song || []),
  genres: () => rest('getGenres').then((r) => r.genres?.genre || []),
  starred: () => rest('getStarred2').then((r) => r.starred2 || {}),
  star: (id) => rest('star', { id }),
  unstar: (id) => rest('unstar', { id }),
  scrobble: (id, submission = true) => rest('scrobble', { id, submission, time: Date.now() }),
  playlists: () => rest('getPlaylists').then((r) => r.playlists?.playlist || []),
  playlist: (id) => rest('getPlaylist', { id }).then((r) => r.playlist),
  createPlaylist: (name, songId = []) => rest('createPlaylist', { name, songId }).then((r) => r.playlist),
  updatePlaylist: (playlistId, changes) => rest('updatePlaylist', { playlistId, ...changes }),
  deletePlaylist: (id) => rest('deletePlaylist', { id }),
  similar: (id, count = 50) => rest('getSimilarSongs2', { id, count }).then((r) => r.similarSongs2?.song || []),
  lyrics: (id) => rest('getLyricsBySongId', { id }).then((r) => r.lyricsList?.structuredLyrics?.[0] || null),
  savePlayQueue: (id, current, position) => rest('savePlayQueue', { id, current, position }),
  getPlayQueue: () => rest('getPlayQueue').then((r) => r.playQueue),
  startScan: () => rest('startScan'),
  // Hum extensions
  smartLists: () => hum('smart'),
  smart: (kind) => hum(`smart/${kind}`),
  mixes: () => hum('mixes'),
  stats: (days) => hum(`stats?days=${days || 0}&tz=${new Date().getTimezoneOffset()}`),
  jamendoTracks: (p = {}) => hum(`jamendo/tracks?${new URLSearchParams(p)}`).then((r) => r.song || []),
  jamendoAlbums: (p = {}) => hum(`jamendo/albums?${new URLSearchParams(p)}`).then((r) => r.album || []),
  jamendoArtists: (p = {}) => hum(`jamendo/artists?${new URLSearchParams(p)}`).then((r) => r.artist || []),
};
