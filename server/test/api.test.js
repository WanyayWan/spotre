// End-to-end smoke test: starts the server on a temp library made with ffmpeg
// (skipped if ffmpeg is missing) and exercises the main Subsonic endpoints.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hum-test-'));
const music = path.join(tmp, 'music', 'Test Artist', 'Test Album');
const PORT = 4700 + Math.floor(Math.random() * 200);
const base = `http://127.0.0.1:${PORT}`;
const auth = 'u=admin&p=secret&f=json&v=1.16.1&c=test';
let proc;
let hasFfmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { hasFfmpeg = false; }

const rest = async (method, q = '') => (await (await fetch(`${base}/rest/${method}?${auth}&${q}`)).json())['subsonic-response'];

before(async () => {
  if (!hasFfmpeg) return;
  fs.mkdirSync(music, { recursive: true });
  for (const [i, title] of ['One', 'Two'].entries()) {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-metadata', `title=${title}`,
      '-metadata', 'artist=Test Artist', '-metadata', 'album=Test Album', '-metadata', `track=${i + 1}`, '-metadata', 'genre=Testcore',
      path.join(music, `${i + 1} ${title}.mp3`)]);
  }
  fs.writeFileSync(path.join(music, '1 One.lrc'), '[00:00.50]Hello\n[00:01.50]World\n');
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', MUSIC_DIR: path.join(tmp, 'music'), DATA_DIR: path.join(tmp, 'data'), HUM_PASSWORD: 'secret', LRCLIB_ENABLED: 'false', JAMENDO_CLIENT_ID: '' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { const r = await rest('getScanStatus'); if (r.status === 'ok' && !r.scanStatus.scanning && (await rest('search3', 'query=')).searchResult3.song?.length === 2) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start');
});
after(() => { proc?.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('rejects bad credentials', { skip: !hasFfmpeg }, async () => {
  const r = await (await fetch(`${base}/rest/ping?u=admin&p=nope&f=json`)).json();
  assert.equal(r['subsonic-response'].error.code, 40);
});

test('token auth works', { skip: !hasFfmpeg }, async () => {
  const { createHash } = await import('node:crypto');
  const t = createHash('md5').update('secretabc').digest('hex');
  const r = await (await fetch(`${base}/rest/ping.view?u=admin&t=${t}&s=abc&f=json`)).json();
  assert.equal(r['subsonic-response'].status, 'ok');
});

test('library, album, lyrics, stream', { skip: !hasFfmpeg }, async () => {
  const albums = (await rest('getAlbumList2', 'type=newest')).albumList2.album;
  assert.equal(albums.length, 1);
  const album = (await rest('getAlbum', `id=${albums[0].id}`)).album;
  assert.deepEqual(album.song.map((s) => s.title), ['One', 'Two']);
  const lyr = (await rest('getLyricsBySongId', `id=${album.song[0].id}`)).lyricsList.structuredLyrics[0];
  assert.equal(lyr.synced, true);
  assert.deepEqual(lyr.line.map((l) => l.start), [500, 1500]);
  const res = await fetch(`${base}/rest/stream?${auth}&id=${album.song[0].id}`, { headers: { Range: 'bytes=0-9' } });
  assert.equal(res.status, 206);
  assert.equal((await res.arrayBuffer()).byteLength, 10);
});

test('playlists, stars, scrobbles, stats', { skip: !hasFfmpeg }, async () => {
  const songs = (await rest('search3', 'query=')).searchResult3.song;
  const pl = (await rest('createPlaylist', `name=Mine&songId=${songs[0].id}&songId=${songs[1].id}`)).playlist;
  assert.equal(pl.songCount, 2);
  await rest('updatePlaylist', `playlistId=${pl.id}&songIndexToRemove=0`);
  assert.equal((await rest('getPlaylist', `id=${pl.id}`)).playlist.entry[0].id, songs[1].id);
  await rest('star', `id=${songs[0].id}`);
  assert.equal((await rest('getStarred2')).starred2.song.length, 1);
  await rest('scrobble', `id=${songs[0].id}`);
  const stats = await (await fetch(`${base}/api/stats?${auth}`)).json();
  assert.equal(stats.totals.plays, 1);
});

test('xml responses for classic clients', { skip: !hasFfmpeg }, async () => {
  const xml = await (await fetch(`${base}/rest/getAlbumList2?u=admin&p=secret&type=newest`)).text();
  assert.match(xml, /<albumList2><album id="al-[0-9a-f]+" name="Test Album"/);
});
