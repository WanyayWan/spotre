// Hum-only endpoints that the Subsonic API doesn't cover: uploads, Jamendo,
// smart playlists, daily mixes and listening stats. The PWA hides these
// features when it is pointed at a server without them (e.g. Navidrome).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { parseFile } from 'music-metadata';
import { config } from './config.js';
import { db } from './db.js';
import { checkAuth, authParams } from './auth.js';
import { songObj } from './serialize.js';
import { scanFile, rebuildAggregates, scanLibrary, scanState } from './scanner.js';
import { smartPlaylist, SMART, dailyMixes, stats } from './recs.js';
import * as jamendo from './jamendo.js';
import { AUDIO_TYPES, safeName } from './util.js';

const router = express.Router();
router.use(express.json());

router.get('/info', (req, res) => res.json({
  name: 'hum', version: '0.1.0',
  features: { uploads: true, jamendo: jamendo.jamendoEnabled(), smart: true, mixes: true, stats: true },
}));

router.use((req, res, next) => (checkAuth(authParams(req)) ? next() : res.status(401).json({ error: 'Unauthorized' })));

const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req, res)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
};

// ---------- uploads ----------
const tmpDir = path.join(config.dataDir, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const upload = multer({
  dest: tmpDir,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, Boolean(AUDIO_TYPES[path.extname(file.originalname).slice(1).toLowerCase()])),
});

router.post('/upload', upload.array('files', 200), wrap(async (req) => {
  const added = [], skipped = [];
  for (const f of req.files || []) {
    try {
      const ext = path.extname(f.originalname).toLowerCase();
      const meta = await parseFile(f.path, { duration: false, skipCovers: true }).catch(() => null);
      const artist = safeName(meta?.common.albumartist || meta?.common.artist || 'Unknown Artist');
      const album = safeName(meta?.common.album || 'Uploads');
      const dir = path.join(config.musicDir, 'Uploads', artist, album);
      await fsp.mkdir(dir, { recursive: true });
      let dest = path.join(dir, safeName(path.basename(f.originalname, ext)) + ext);
      for (let i = 2; fs.existsSync(dest); i++) dest = path.join(dir, `${safeName(path.basename(f.originalname, ext))} (${i})${ext}`);
      await fsp.copyFile(f.path, dest);
      const id = await scanFile(dest);
      if (id) added.push(id); else skipped.push(f.originalname);
    } catch (e) {
      skipped.push(f.originalname);
    } finally {
      fsp.rm(f.path, { force: true });
    }
  }
  rebuildAggregates();
  const songs = added.map((id) => songObj(db.prepare('SELECT * FROM songs WHERE id = ?').get(id)));
  return { added: songs, skipped };
}));

router.post('/scan', wrap(async () => { scanLibrary(); return scanState; }));
router.get('/scan', wrap(async () => scanState));

// ---------- smart playlists, mixes, stats ----------
router.get('/smart', wrap(async () => SMART.map((s) => ({ ...s, songCount: smartPlaylist(s.id, 1000).length }))));
router.get('/smart/:kind', wrap(async (req) => {
  const meta = SMART.find((s) => s.id === req.params.kind);
  const rows = smartPlaylist(req.params.kind, 200);
  if (!rows) throw Object.assign(new Error('Unknown smart playlist'), { status: 404 });
  return { ...meta, song: rows.map(songObj) };
}));
router.get('/mixes', wrap(async () => dailyMixes().map((m) => ({ ...m, coverArt: songObj(m.songs.find((s) => s.cover) ?? m.songs[0])?.coverArt, song: m.songs.map(songObj), songs: undefined }))));
router.get('/stats', wrap(async (req) => {
  const s = stats(Number(req.query.days) || 0, Number(req.query.tz) || 0);
  return {
    ...s,
    topSongs: s.topSongs.map((r) => ({ ...songObj(r), plays: r.n })),
    topArtists: s.topArtists.map((r) => ({ id: r.id, name: r.name, plays: r.n, seconds: r.seconds, coverArt: r.cover ? (r.source === 'local' ? r.album_id : undefined) : undefined, source: r.source })),
  };
}));

// ---------- Jamendo ----------
router.get('/jamendo/tracks', wrap(async (req) => ({ song: await jamendo.tracks({
  search: req.query.q, tags: req.query.tags, order: req.query.order, limit: Math.min(Number(req.query.limit) || 30, 100), offset: Number(req.query.offset) || 0,
}) })));
router.get('/jamendo/albums', wrap(async (req) => ({ album: await jamendo.albums({ search: req.query.q, order: req.query.order, limit: Math.min(Number(req.query.limit) || 20, 50) }) })));
router.get('/jamendo/artists', wrap(async (req) => ({ artist: await jamendo.artists({ search: req.query.q, limit: Math.min(Number(req.query.limit) || 20, 50) }) })));
router.get('/jamendo/album/:id', wrap(async (req) => {
  const a = await jamendo.album(req.params.id);
  if (!a) throw Object.assign(new Error('Album not found'), { status: 404 });
  return a;
}));
router.get('/jamendo/artist/:id', wrap(async (req) => {
  const a = await jamendo.artist(req.params.id);
  if (!a) throw Object.assign(new Error('Artist not found'), { status: 404 });
  return a;
}));

export default router;
