// Offline downloads: audio goes into the Cache Storage, and the service worker
// serves it back (with Range support, which iOS Safari needs for <audio>).
import { streamUrl, coverUrl } from './api.js';

const CACHE = 'hum-audio-v1';
const META = 'hum.downloads';
const listeners = new Set();
let meta = read();

function read() {
  try { return JSON.parse(localStorage.getItem(META)) || {}; } catch { return {}; }
}
function write() {
  try { localStorage.setItem(META, JSON.stringify(meta)); } catch { /* storage full */ }
  listeners.forEach((fn) => fn());
}

export const offlineKey = (id) => `${location.origin}/offline-audio/${encodeURIComponent(id)}`;
export const isDownloaded = (id) => Boolean(meta[id]);
export const downloadedSongs = () => Object.values(meta).sort((a, b) => b.savedAt - a.savedAt);
export const onDownloadsChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const pending = new Map();
export const isDownloading = (id) => pending.has(id);

export async function download(song) {
  if (isDownloaded(song.id) || pending.has(song.id)) return pending.get(song.id);
  const job = (async () => {
    const res = await fetch(streamUrl(song.id));
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const cache = await caches.open(CACHE);
    await cache.put(offlineKey(song.id), new Response(blob, {
      headers: { 'Content-Type': res.headers.get('content-type') || song.contentType || 'audio/mpeg', 'Content-Length': String(blob.size) },
    }));
    // Warm the artwork cache too so the lock screen has art offline.
    if (song.coverArt) fetch(coverUrl(song.coverArt)).catch(() => {});
    meta[song.id] = { ...song, savedAt: Date.now(), bytes: blob.size };
    write();
  })();
  pending.set(song.id, job);
  listeners.forEach((fn) => fn());
  try { await job; } finally { pending.delete(song.id); listeners.forEach((fn) => fn()); }
}

export async function removeDownload(id) {
  const cache = await caches.open(CACHE);
  await cache.delete(offlineKey(id));
  delete meta[id];
  write();
}

export async function clearDownloads() {
  await caches.delete(CACHE);
  meta = {};
  write();
}

export const downloadsBytes = () => Object.values(meta).reduce((t, s) => t + (s.bytes || 0), 0);

export async function requestPersistence() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch { /* ignore */ }
}
