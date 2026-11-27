// A Subsonic / OpenSubsonic compatible API (https://opensubsonic.netlify.app).
// The Hum PWA talks to this, and so can any other Subsonic app on iOS
// (Amperfy, play:Sub, Substreamer...). Because the PWA only relies on this
// API for the library, it can also be pointed at Navidrome later.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import express from 'express';
import { config } from './config.js';
import { db, now, tx, kvGet, kvSet } from './db.js';
import { checkAuth, authParams } from './auth.js';
import { songObj, albumObj, artistObj } from './serialize.js';
import { scanLibrary, scanState } from './scanner.js';
import { lyricsFor } from './lyrics.js';
import { similarSongs } from './recs.js';
import * as jamendo from './jamendo.js';
import { hashId } from './util.js';

export const API_VERSION = '1.16.1';
const router = express.Router();

// ---------- response helpers ----------
function xmlEscape(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
}
function toXml(name, value) {
  if (Array.isArray(value)) return value.map((v) => toXml(name, v)).join('');
  if (value === null || typeof value !== 'object') return `<${name}>${xmlEscape(value)}</${name}>`;
  let attrs = '', children = '';
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined || v === null) continue;
    if (k === 'value' && typeof v !== 'object') { children += xmlEscape(v); continue; }
    if (typeof v === 'object') children += toXml(k, v);
    else attrs += ` ${k}="${xmlEscape(v)}"`;
  }
  return `<${name}${attrs}>${children}</${name}>`;
}

function send(req, res, body = {}, status = 'ok') {
  const payload = { status, version: API_VERSION, type: 'hum', serverVersion: '0.1.0', openSubsonic: true, ...body };
  const f = req.query.f || req.body?.f;
  if (f === 'json') return res.json({ 'subsonic-response': payload });
  if (f === 'jsonp' && req.query.callback) {
    return res.type('application/javascript').send(`${String(req.query.callback).replace(/[^\w.$]/g, '')}(${JSON.stringify({ 'subsonic-response': payload })})`);
  }
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>${toXml('subsonic-response', { xmlns: 'http://subsonic.org/restapi', ...payload })}`);
}
const fail = (req, res, code, message) => send(req, res, { error: { code, message } }, 'failed');

const param = (req, k) => req.query[k] ?? req.body?.[k];
const params = (req, k) => {
  const v = req.query[k] ?? req.body?.[k];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
};
const int = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

// ---------- auth ----------
router.use(express.urlencoded({ extended: false }));
router.use((req, res, next) => {
  req.url = req.url.replace(/\.view(?=\?|$)/, '');
  if (!param(req, 'u')) return fail(req, res, 10, 'Required parameter is missing: u');
  if (!checkAuth(authParams(req))) return fail(req, res, 40, 'Wrong username or password');
  next();
});

const getSong = (id) => db.prepare('SELECT * FROM songs WHERE id = ?').get(id);
const localSongs = "source = 'local'";

// ---------- system ----------
const route = (name, fn) => router.all(`/${name}`, async (req, res, next) => {
  try { await fn(req, res); } catch (e) { if (res.headersSent) return next(e); console.error(`[rest/${name}]`, e); fail(req, res, 0, e.message); }
});

route('ping', (req, res) => send(req, res));
route('getLicense', (req, res) => send(req, res, { license: { valid: true, email: 'self-hosted', licenseExpires: '2099-01-01T00:00:00Z' } }));
route('getOpenSubsonicExtensions', (req, res) => send(req, res, { openSubsonicExtensions: [{ name: 'songLyrics', versions: [1] }, { name: 'formPost', versions: [1] }] }));
route('getUser', (req, res) => send(req, res, {
  user: { username: config.user, scrobblingEnabled: true, adminRole: true, settingsRole: true, downloadRole: true, uploadRole: true,
    playlistRole: true, coverArtRole: true, commentRole: false, podcastRole: false, streamRole: true, jukeboxRole: false, shareRole: false, folder: [1] },
}));
route('getMusicFolders', (req, res) => send(req, res, { musicFolders: { musicFolder: [{ id: 1, name: 'Music' }] } }));
route('getScanStatus', (req, res) => send(req, res, { scanStatus: { scanning: scanState.scanning, count: scanState.count } }));
route('startScan', (req, res) => { scanLibrary(); send(req, res, { scanStatus: { scanning: true, count: 0 } }); });
route('getNowPlaying', (req, res) => send(req, res, { nowPlaying: { entry: [] } }));

// ---------- browsing ----------
function artistIndex() {
  const rows = db.prepare('SELECT * FROM artists ORDER BY name COLLATE NOCASE').all();
  const groups = new Map();
  for (const r of rows) {
    const letter = /^[a-z]/i.test(r.name) ? r.name[0].toUpperCase() : '#';
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(artistObj(r));
  }
  return [...groups].map(([name, artist]) => ({ name, artist }));
}
route('getArtists', (req, res) => send(req, res, { artists: { ignoredArticles: '', index: artistIndex() } }));
route('getIndexes', (req, res) => send(req, res, { indexes: { ignoredArticles: '', lastModified: now(), index: artistIndex() } }));

route('getArtist', (req, res) => {
  const a = db.prepare('SELECT * FROM artists WHERE id = ?').get(param(req, 'id'));
  if (!a) return fail(req, res, 70, 'Artist not found');
  const albums = db.prepare('SELECT * FROM albums WHERE artist_id = ? ORDER BY year DESC, name').all(a.id);
  send(req, res, { artist: artistObj(a, albums) });
});

route('getArtistInfo2', (req, res) => send(req, res, { artistInfo2: {} }));
route('getArtistInfo', (req, res) => send(req, res, { artistInfo: {} }));
route('getAlbumInfo2', (req, res) => send(req, res, { albumInfo: {} }));

const albumSongs = (id) => db.prepare('SELECT * FROM songs WHERE album_id = ? ORDER BY disc, track, title').all(id);
route('getAlbum', (req, res) => {
  const a = db.prepare('SELECT * FROM albums WHERE id = ?').get(param(req, 'id'));
  if (!a) return fail(req, res, 70, 'Album not found');
  send(req, res, { album: albumObj(a, albumSongs(a.id)) });
});

// Directory-style browsing for older clients: artist -> albums -> songs.
route('getMusicDirectory', (req, res) => {
  const id = param(req, 'id');
  const artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(id);
  if (artist) {
    const albums = db.prepare('SELECT * FROM albums WHERE artist_id = ? ORDER BY year DESC').all(id);
    return send(req, res, { directory: { id, name: artist.name, child: albums.map((a) => ({ ...albumObj(a), title: a.name, isDir: true })) } });
  }
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(id);
  if (album) return send(req, res, { directory: { id, name: album.name, parent: album.artist_id, child: albumSongs(id).map(songObj) } });
  fail(req, res, 70, 'Directory not found');
});

route('getSong', (req, res) => {
  const s = getSong(param(req, 'id'));
  if (!s) return fail(req, res, 70, 'Song not found');
  send(req, res, { song: songObj(s) });
});

function albumList(req) {
  const type = param(req, 'type') || 'newest';
  const size = Math.min(int(param(req, 'size'), 10), 500);
  const offset = int(param(req, 'offset'), 0);
  const orders = {
    random: 'RANDOM()', newest: 'created_at DESC', alphabeticalByName: 'name COLLATE NOCASE', alphabeticalByArtist: 'artist COLLATE NOCASE, year',
    recent: '(SELECT MAX(last_played) FROM songs s WHERE s.album_id = albums.id) DESC',
    frequent: '(SELECT SUM(play_count) FROM songs s WHERE s.album_id = albums.id) DESC',
    starred: 'starred_at DESC', byYear: 'year', byGenre: 'name',
  };
  let where = '1=1';
  const args = [];
  if (type === 'starred') where = 'starred_at IS NOT NULL';
  if (type === 'recent') where = 'EXISTS (SELECT 1 FROM songs s WHERE s.album_id = albums.id AND s.last_played IS NOT NULL)';
  if (type === 'frequent') where = 'EXISTS (SELECT 1 FROM songs s WHERE s.album_id = albums.id AND s.play_count > 0)';
  if (type === 'byGenre') { where = 'genre = ?'; args.push(param(req, 'genre')); }
  let order = orders[type] || orders.newest;
  if (type === 'byYear') {
    const from = int(param(req, 'fromYear'), 0), to = int(param(req, 'toYear'), 9999);
    where = 'year BETWEEN ? AND ?';
    args.push(Math.min(from, to), Math.max(from, to));
    if (from > to) order = 'year DESC';
  }
  return db.prepare(`SELECT * FROM albums WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, size, offset).map((a) => albumObj(a));
}
route('getAlbumList2', (req, res) => send(req, res, { albumList2: { album: albumList(req) } }));
route('getAlbumList', (req, res) => send(req, res, { albumList: { album: albumList(req) } }));

route('getRandomSongs', (req, res) => {
  const size = Math.min(int(param(req, 'size'), 10), 500);
  const where = [localSongs], args = [];
  if (param(req, 'genre')) { where.push('genre = ?'); args.push(param(req, 'genre')); }
  if (param(req, 'fromYear')) { where.push('year >= ?'); args.push(int(param(req, 'fromYear'))); }
  if (param(req, 'toYear')) { where.push('year <= ?'); args.push(int(param(req, 'toYear'))); }
  const rows = db.prepare(`SELECT * FROM songs WHERE ${where.join(' AND ')} ORDER BY RANDOM() LIMIT ?`).all(...args, size);
  send(req, res, { randomSongs: { song: rows.map(songObj) } });
});

route('getGenres', (req, res) => {
  const rows = db.prepare(`SELECT genre AS value, COUNT(*) AS songCount, COUNT(DISTINCT album_id) AS albumCount FROM songs
    WHERE ${localSongs} AND genre IS NOT NULL GROUP BY genre ORDER BY songCount DESC`).all();
  send(req, res, { genres: { genre: rows } });
});
route('getSongsByGenre', (req, res) => {
  const rows = db.prepare(`SELECT * FROM songs WHERE ${localSongs} AND genre = ? ORDER BY artist, album, track LIMIT ? OFFSET ?`)
    .all(param(req, 'genre'), Math.min(int(param(req, 'count'), 10), 500), int(param(req, 'offset'), 0));
  send(req, res, { songsByGenre: { song: rows.map(songObj) } });
});

route('getTopSongs', (req, res) => {
  const rows = db.prepare('SELECT * FROM songs WHERE artist = ? COLLATE NOCASE ORDER BY play_count DESC, starred_at DESC LIMIT ?')
    .all(param(req, 'artist') || '', int(param(req, 'count'), 50));
  send(req, res, { topSongs: { song: rows.map(songObj) } });
});

route('getSimilarSongs2', async (req, res) => {
  let id = param(req, 'id');
  if (id?.startsWith('ar-')) id = db.prepare('SELECT id FROM songs WHERE artist_id = ? ORDER BY RANDOM() LIMIT 1').get(id)?.id;
  const rows = id ? await similarSongs(id, int(param(req, 'count'), 50)) : [];
  send(req, res, { similarSongs2: { song: rows.map(songObj) } });
});
route('getSimilarSongs', async (req, res) => {
  let id = param(req, 'id');
  if (id?.startsWith('al-')) id = db.prepare('SELECT id FROM songs WHERE album_id = ? ORDER BY RANDOM() LIMIT 1').get(id)?.id;
  if (id?.startsWith('ar-')) id = db.prepare('SELECT id FROM songs WHERE artist_id = ? ORDER BY RANDOM() LIMIT 1').get(id)?.id;
  const rows = id ? await similarSongs(id, int(param(req, 'count'), 50)) : [];
  send(req, res, { similarSongs: { song: rows.map(songObj) } });
});

// ---------- search ----------
function search(req) {
  const raw = String(param(req, 'query') || '').replace(/^"|"$/g, '').trim();
  const q = `%${raw.replace(/[%_]/g, '')}%`;
  const all = raw === '' || raw === '*';
  const n = (k, d) => Math.min(int(param(req, k), d), 500);
  const o = (k) => int(param(req, k), 0);
  const artists = db.prepare(`SELECT * FROM artists WHERE ${all ? '1=1' : 'name LIKE ?'} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`)
    .all(...(all ? [] : [q]), n('artistCount', 20), o('artistOffset'));
  const albums = db.prepare(`SELECT * FROM albums WHERE ${all ? '1=1' : '(name LIKE ? OR artist LIKE ?)'} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`)
    .all(...(all ? [] : [q, q]), n('albumCount', 20), o('albumOffset'));
  const songs = db.prepare(`SELECT * FROM songs WHERE ${localSongs} AND ${all ? '1=1' : '(title LIKE ? OR artist LIKE ? OR album LIKE ?)'}
    ORDER BY (title LIKE ?) DESC, play_count DESC, title COLLATE NOCASE LIMIT ? OFFSET ?`)
    .all(...(all ? [] : [q, q, q]), all ? '%' : q, n('songCount', 20), o('songOffset'));
  return { artist: artists.map((a) => artistObj(a)), album: albums.map((a) => albumObj(a)), song: songs.map(songObj) };
}
route('search3', (req, res) => send(req, res, { searchResult3: search(req) }));
route('search2', (req, res) => send(req, res, { searchResult2: search(req) }));

// ---------- stars & scrobbles ----------
function setStar(req, value) {
  const ids = [...params(req, 'id'), ...params(req, 'albumId'), ...params(req, 'artistId')];
  tx(() => {
    for (const id of ids) {
      if (id.startsWith('al-')) db.prepare('UPDATE albums SET starred_at = ? WHERE id = ?').run(value, id);
      else if (id.startsWith('ar-')) db.prepare('UPDATE artists SET starred_at = ? WHERE id = ?').run(value, id);
      else db.prepare('UPDATE songs SET starred_at = ? WHERE id = ?').run(value, id);
    }
  });
}
route('star', (req, res) => { setStar(req, now()); send(req, res); });
route('unstar', (req, res) => { setStar(req, null); send(req, res); });

function starred() {
  return {
    artist: db.prepare('SELECT * FROM artists WHERE starred_at IS NOT NULL ORDER BY starred_at DESC').all().map((a) => artistObj(a)),
    album: db.prepare('SELECT * FROM albums WHERE starred_at IS NOT NULL ORDER BY starred_at DESC').all().map((a) => albumObj(a)),
    song: db.prepare('SELECT * FROM songs WHERE starred_at IS NOT NULL ORDER BY starred_at DESC').all().map(songObj),
  };
}
route('getStarred2', (req, res) => send(req, res, { starred2: starred() }));
route('getStarred', (req, res) => send(req, res, { starred: starred() }));

route('scrobble', (req, res) => {
  const ids = params(req, 'id');
  const times = params(req, 'time');
  const submission = param(req, 'submission') !== 'false';
  if (submission) {
    tx(() => ids.forEach((id, i) => {
      const s = getSong(id);
      if (!s) return;
      const at = int(times[i], now());
      db.prepare('INSERT INTO plays(song_id, played_at, seconds) VALUES(?,?,?)').run(id, at, s.duration || 0);
      db.prepare('UPDATE songs SET play_count = play_count + 1, last_played = ? WHERE id = ?').run(at, id);
    }));
  }
  send(req, res);
});

// ---------- playlists ----------
function playlistObj(p, withSongs = false) {
  const songs = db.prepare(`SELECT s.* FROM playlist_songs ps JOIN songs s ON s.id = ps.song_id WHERE ps.playlist_id = ? ORDER BY ps.position`).all(p.id);
  const cover = songs.find((s) => s.cover);
  const o = {
    id: p.id, name: p.name, comment: p.comment ?? undefined, owner: config.user, public: false,
    songCount: songs.length, duration: songs.reduce((t, s) => t + (s.duration || 0), 0),
    created: new Date(p.created_at).toISOString(), changed: new Date(p.changed_at).toISOString(),
    coverArt: cover ? (cover.source === 'local' ? cover.album_id : cover.id) : undefined,
  };
  if (!o.comment) delete o.comment;
  if (!o.coverArt) delete o.coverArt;
  if (withSongs) o.entry = songs.map(songObj);
  return o;
}
function writePlaylistSongs(id, songIds) {
  db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ?').run(id);
  const ins = db.prepare('INSERT INTO playlist_songs(playlist_id, position, song_id) VALUES(?,?,?)');
  songIds.forEach((sid, i) => ins.run(id, i, sid));
  db.prepare('UPDATE playlists SET changed_at = ? WHERE id = ?').run(now(), id);
}
const playlistSongIds = (id) => db.prepare('SELECT song_id FROM playlist_songs WHERE playlist_id = ? ORDER BY position').all(id).map((r) => r.song_id);

route('getPlaylists', (req, res) => {
  const rows = db.prepare('SELECT * FROM playlists ORDER BY changed_at DESC').all();
  send(req, res, { playlists: { playlist: rows.map((p) => playlistObj(p)) } });
});
route('getPlaylist', (req, res) => {
  const p = db.prepare('SELECT * FROM playlists WHERE id = ?').get(param(req, 'id'));
  if (!p) return fail(req, res, 70, 'Playlist not found');
  send(req, res, { playlist: playlistObj(p, true) });
});
route('createPlaylist', (req, res) => {
  let id = param(req, 'playlistId');
  const songIds = params(req, 'songId');
  tx(() => {
    if (!id || !db.prepare('SELECT 1 FROM playlists WHERE id = ?').get(id)) {
      id = hashId('pl-', param(req, 'name'), now(), Math.random());
      db.prepare('INSERT INTO playlists(id, name, created_at, changed_at) VALUES(?,?,?,?)').run(id, param(req, 'name') || 'New Playlist', now(), now());
    } else if (param(req, 'name')) {
      db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(param(req, 'name'), id);
    }
    writePlaylistSongs(id, songIds);
  });
  send(req, res, { playlist: playlistObj(db.prepare('SELECT * FROM playlists WHERE id = ?').get(id), true) });
});
route('updatePlaylist', (req, res) => {
  const id = param(req, 'playlistId');
  const p = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
  if (!p) return fail(req, res, 70, 'Playlist not found');
  tx(() => {
    if (param(req, 'name') !== undefined) db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(param(req, 'name'), id);
    if (param(req, 'comment') !== undefined) db.prepare('UPDATE playlists SET comment = ? WHERE id = ?').run(param(req, 'comment'), id);
    let songs = playlistSongIds(id);
    const remove = new Set(params(req, 'songIndexToRemove').map(Number));
    songs = songs.filter((_, i) => !remove.has(i));
    songs.push(...params(req, 'songIdToAdd'));
    writePlaylistSongs(id, songs);
  });
  send(req, res);
});
route('deletePlaylist', (req, res) => {
  db.prepare('DELETE FROM playlists WHERE id = ?').run(param(req, 'id'));
  send(req, res);
});

// ---------- play queue (resume on another device) ----------
route('getPlayQueue', (req, res) => {
  const q = kvGet('playQueue');
  if (!q) return send(req, res, { playQueue: {} });
  const entry = q.ids.map(getSong).filter(Boolean).map(songObj);
  send(req, res, { playQueue: { current: q.current, position: q.position, username: config.user, changed: q.changed, changedBy: q.changedBy, entry } });
});
route('savePlayQueue', (req, res) => {
  kvSet('playQueue', { ids: params(req, 'id'), current: param(req, 'current'), position: int(param(req, 'position'), 0), changed: new Date().toISOString(), changedBy: param(req, 'c') || 'unknown' });
  send(req, res);
});

// ---------- lyrics ----------
route('getLyricsBySongId', async (req, res) => {
  const s = getSong(param(req, 'id'));
  const l = s ? await lyricsFor(s) : null;
  const structuredLyrics = l ? [{ displayArtist: s.artist, displayTitle: s.title, lang: 'xxx', synced: l.synced, line: l.lines }] : [];
  send(req, res, { lyricsList: { structuredLyrics } });
});
route('getLyrics', async (req, res) => {
  const s = db.prepare('SELECT * FROM songs WHERE artist = ? COLLATE NOCASE AND title = ? COLLATE NOCASE').get(param(req, 'artist') || '', param(req, 'title') || '');
  const l = s ? await lyricsFor(s) : null;
  send(req, res, { lyrics: l ? { artist: s.artist, title: s.title, value: l.lines.map((x) => x.value).join('\n') } : {} });
});

// ---------- media ----------
async function proxy(req, res, url, fallbackType) {
  const headers = {};
  if (req.get('range')) headers.range = req.get('range');
  const up = await fetch(url, { headers, redirect: 'follow' });
  if (!up.ok && up.status !== 206) return false;
  res.status(up.status);
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
    const v = up.headers.get(h);
    if (v) res.set(h, v);
  }
  if (!up.headers.get('content-type') && fallbackType) res.type(fallbackType);
  if (!up.headers.get('accept-ranges')) res.set('accept-ranges', 'bytes');
  res.set('cache-control', 'private, max-age=86400');
  if (req.method === 'HEAD' || !up.body) return res.end(), true;
  Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res);
  return true;
}

async function stream(req, res) {
  let s = getSong(param(req, 'id'));
  if (!s) return fail(req, res, 70, 'Song not found');
  if (s.source === 'jamendo') {
    let ok = s.remote_url && (await proxy(req, res, s.remote_url, 'audio/mpeg').catch(() => false));
    if (!ok && jamendo.jamendoEnabled()) {
      await jamendo.refreshTrack(s.id).catch(() => null);
      s = getSong(s.id);
      ok = s.remote_url && (await proxy(req, res, s.remote_url, 'audio/mpeg').catch(() => false));
    }
    if (!ok && !res.headersSent) res.status(502).end();
    return;
  }
  const file = path.join(config.musicDir, s.path);
  if (!file.startsWith(config.musicDir) || !fs.existsSync(file)) return fail(req, res, 70, 'File missing');
  res.sendFile(file, { headers: { 'Content-Type': s.content_type || 'application/octet-stream', 'Cache-Control': 'private, max-age=86400' }, acceptRanges: true });
}
route('stream', stream);
route('download', stream);

route('getCoverArt', async (req, res) => {
  const id = param(req, 'id') || '';
  let cover = null;
  if (id.startsWith('al-')) cover = db.prepare('SELECT cover FROM albums WHERE id = ?').get(id)?.cover;
  else if (id.startsWith('ar-')) cover = db.prepare('SELECT cover FROM artists WHERE id = ?').get(id)?.cover;
  else if (id.startsWith('pl-')) cover = db.prepare('SELECT s.cover FROM playlist_songs ps JOIN songs s ON s.id = ps.song_id WHERE ps.playlist_id = ? AND s.cover IS NOT NULL ORDER BY ps.position LIMIT 1').get(id)?.cover;
  else cover = getSong(id)?.cover;
  if (!cover && /^https:\/\/[^/]*jamendo\.com\//.test(id)) cover = id; // Jamendo album/artist images
  if (!cover) return res.status(404).end();
  if (/^https?:\/\//.test(cover)) {
    if (!/^https:\/\/[^/]*jamendo\.com\//.test(cover)) return res.status(404).end();
    const ok = await proxy(req, res, cover, 'image/jpeg').catch(() => false);
    if (!ok && !res.headersSent) res.status(404).end();
    return;
  }
  if (!fs.existsSync(cover)) return res.status(404).end();
  res.sendFile(cover, { headers: { 'Cache-Control': 'private, max-age=604800' } });
});

router.all('/{*rest}', (req, res) => fail(req, res, 0, `Unknown method ${req.path}`));

export default router;
