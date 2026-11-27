// The playback engine. iOS only allows reliable background playback and
// lock-screen controls from a single <audio> element, so everything goes
// through one element and we swap its src between tracks.
import { api, streamUrl, coverUrl } from './api.js';
import { isDownloaded, offlineKey } from './offline.js';

const audio = document.getElementById('audio');
const STORE = 'hum.player';
const listeners = { change: new Set(), state: new Set(), time: new Set(), error: new Set() };

const state = {
  queue: [],          // songs in play order
  original: null,     // un-shuffled copy, when shuffled
  index: -1,
  shuffle: 'off',     // off | on | smart
  repeat: 'off',      // off | all | one
  sleep: null,        // { until: ms } or { endOfTrack: true }
  scrobbled: false,
  context: null,      // { type, id, name } for "Playing from ..."
};

const emit = (ev, ...a) => listeners[ev].forEach((fn) => { try { fn(...a); } catch (e) { console.error(e); } });
export const on = (ev, fn) => (listeners[ev].add(fn), () => listeners[ev].delete(fn));
export const current = () => state.queue[state.index] || null;
export const getState = () => state;
export const isPlaying = () => !audio.paused && !audio.ended;
export const element = audio;

function srcFor(song) {
  return isDownloaded(song.id) ? offlineKey(song.id) : streamUrl(song.id);
}

function load(autoplay = true, startAt = 0) {
  const song = current();
  if (!song) { audio.removeAttribute('src'); audio.load(); emit('change'); return; }
  state.scrobbled = false;
  audio.src = srcFor(song);
  if (startAt) {
    const seekOnce = () => { audio.currentTime = startAt; audio.removeEventListener('loadedmetadata', seekOnce); };
    audio.addEventListener('loadedmetadata', seekOnce);
  }
  if (autoplay) audio.play().catch((e) => { if (e.name !== 'AbortError') emit('state'); });
  updateMediaSession();
  if (navigator.onLine && autoplay) api.scrobble(song.id, false).catch(() => {});
  emit('change');
  persist();
}

// ---------- public controls ----------
export function playList(songs, startIndex = 0, { shuffle = false, context = null } = {}) {
  if (!songs?.length) return;
  state.context = context;
  state.queue = songs.slice();
  state.original = null;
  state.index = Math.max(0, Math.min(startIndex, songs.length - 1));
  if (shuffle || state.shuffle !== 'off') {
    if (shuffle && state.shuffle === 'off') state.shuffle = 'on';
    applyShuffle(shuffle && startIndex === 0 && !context?.keepFirst);
  }
  load(true);
  if (state.shuffle === 'smart') addSuggestions().then(() => { emit('change'); persist(); });
}

export function toggle() {
  if (!current()) return;
  if (audio.paused) {
    if (!audio.src) load(true);
    else audio.play().catch(() => {});
  } else audio.pause();
}
export const play = () => audio.paused && toggle();
export const pause = () => audio.pause();

export function next(auto = false) {
  if (!state.queue.length) return;
  if (auto && state.repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
  if (state.index < state.queue.length - 1) state.index++;
  else if (state.repeat === 'all') state.index = 0;
  else if (auto) { audio.pause(); audio.currentTime = 0; emit('state'); maybeAutoplayRadio(); return; }
  else return;
  load(true);
}

export function prev() {
  if (audio.currentTime > 3 || state.index === 0) { audio.currentTime = 0; return; }
  state.index--;
  load(true);
}

export function jump(i) {
  if (i < 0 || i >= state.queue.length) return;
  state.index = i;
  load(true);
}

export function seek(seconds) {
  if (!Number.isFinite(audio.duration)) return;
  audio.currentTime = Math.max(0, Math.min(seconds, audio.duration - 0.25));
}

export function playNext(songs) {
  songs = [].concat(songs);
  if (!current()) return playList(songs);
  state.queue.splice(state.index + 1, 0, ...songs);
  state.original?.push(...songs);
  emit('change'); persist();
}

export function addToQueue(songs) {
  songs = [].concat(songs);
  if (!current()) return playList(songs);
  state.queue.push(...songs);
  state.original?.push(...songs);
  emit('change'); persist();
}

export function removeAt(i) {
  if (i === state.index) return;
  const [s] = state.queue.splice(i, 1);
  if (i < state.index) state.index--;
  if (state.original && s) { const j = state.original.indexOf(s); if (j >= 0) state.original.splice(j, 1); }
  emit('change'); persist();
}

export function move(from, to) {
  if (from === to || from < 0 || to < 0 || from >= state.queue.length || to >= state.queue.length) return;
  const cur = current();
  const [s] = state.queue.splice(from, 1);
  state.queue.splice(to, 0, s);
  state.index = state.queue.indexOf(cur);
  emit('change'); persist();
}

export function clearUpNext() {
  state.queue = state.queue.slice(0, state.index + 1);
  state.original = null;
  emit('change'); persist();
}

// ---------- shuffle (incl. "smart" shuffle that mixes in suggestions) ----------
function spreadShuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  // nudge apart back-to-back songs by the same artist
  for (let i = 1; i < a.length; i++) {
    if (a[i].artist === a[i - 1].artist) {
      const k = a.findIndex((s, j) => j > i && s.artist !== a[i - 1].artist);
      if (k > 0) [a[i], a[k]] = [a[k], a[i]];
    }
  }
  return a;
}

function applyShuffle(randomFirst = false) {
  const cur = current();
  state.original = state.original || state.queue.filter((s) => !s._suggested);
  let rest = state.original.filter((s) => s !== cur);
  rest = spreadShuffle(rest);
  state.queue = randomFirst ? spreadShuffle(state.original) : [cur, ...rest];
  state.index = 0;
}

export async function cycleShuffle() {
  const order = ['off', 'on', 'smart'];
  state.shuffle = order[(order.indexOf(state.shuffle) + 1) % order.length];
  if (!current()) { emit('change'); return state.shuffle; }
  if (state.shuffle === 'on') applyShuffle();
  else if (state.shuffle === 'smart') await addSuggestions();
  else {
    const cur = current();
    state.queue = (state.original || state.queue).filter((s) => !s._suggested);
    state.original = null;
    state.index = Math.max(0, state.queue.indexOf(cur));
  }
  emit('change'); persist();
  return state.shuffle;
}

async function addSuggestions() {
  const cur = current();
  if (state.shuffle === 'off') applyShuffle();
  if (!state.original) applyShuffle();
  try {
    const have = new Set(state.queue.map((s) => s.id));
    const recs = (await api.similar(cur.id, 30)).filter((s) => !have.has(s.id)).map((s) => ({ ...s, _suggested: true }));
    const upcoming = state.queue.slice(state.index + 1).filter((s) => !s._suggested);
    const mixed = [];
    upcoming.forEach((s, i) => { mixed.push(s); if (i % 3 === 2 && recs.length) mixed.push(recs.shift()); });
    while (recs.length && mixed.length < 12) mixed.push(recs.shift());
    state.queue = [...state.queue.slice(0, state.index + 1), ...mixed];
  } catch { /* suggestions are a bonus */ }
}

export function cycleRepeat() {
  const order = ['off', 'all', 'one'];
  state.repeat = order[(order.indexOf(state.repeat) + 1) % order.length];
  emit('change'); persist();
  return state.repeat;
}

// ---------- radio ----------
export async function startRadio(song) {
  const songs = await api.similar(song.id, 60);
  const list = songs.length ? songs : [song];
  if (list[0]?.id !== song.id) list.unshift(song);
  state.shuffle = 'off';
  playList(list, 0, { context: { type: 'radio', id: song.id, name: `${song.title} Radio` } });
}

const autoplay = () => localStorage.getItem('hum.autoplay') !== 'false';
async function maybeAutoplayRadio() {
  const last = current();
  if (!last || !autoplay() || !navigator.onLine) return;
  try {
    const have = new Set(state.queue.map((s) => s.id));
    const more = (await api.similar(last.id, 25)).filter((s) => !have.has(s.id));
    if (!more.length) return;
    state.queue.push(...more.map((s) => ({ ...s, _suggested: true })));
    state.index++;
    load(true);
  } catch { /* offline */ }
}

// ---------- sleep timer ----------
let sleepTimer = null;
export function setSleep(minutes) {
  clearTimeout(sleepTimer);
  if (minutes === 'end') state.sleep = { endOfTrack: true };
  else if (minutes) {
    state.sleep = { until: Date.now() + minutes * 60000 };
    sleepTimer = setTimeout(() => { audio.pause(); state.sleep = null; emit('change'); }, minutes * 60000);
  } else state.sleep = null;
  emit('change');
}

// ---------- Media Session (lock screen, Control Centre, AirPods) ----------
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const s = current();
  if (!s) { navigator.mediaSession.metadata = null; return; }
  const art = s.coverArt ? [256, 512].map((size) => ({ src: coverUrl(s.coverArt, size), sizes: `${size}x${size}`, type: 'image/jpeg' })) : [];
  navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: s.artist, album: s.album, artwork: art });
}

function positionState() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: audio.playbackRate || 1 });
  } catch { /* ignore */ }
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* unsupported */ } };
  set('play', () => play());
  set('pause', () => pause());
  set('previoustrack', () => prev());
  set('nexttrack', () => next());
  set('seekto', (d) => { if (d.fastSeek && audio.fastSeek) audio.fastSeek(d.seekTime); else seek(d.seekTime); positionState(); });
  // iOS shows skip-15 buttons instead of next/prev if these are set, so only offer them on other platforms.
  if (!/iPhone|iPad|iPod/.test(navigator.userAgent)) {
    set('seekbackward', (d) => seek(audio.currentTime - (d.seekOffset || 10)));
    set('seekforward', (d) => seek(audio.currentTime + (d.seekOffset || 10)));
  }
}

// ---------- audio element events ----------
audio.addEventListener('play', () => { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; emit('state'); });
audio.addEventListener('pause', () => { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; emit('state'); persist(); });
audio.addEventListener('loadedmetadata', positionState);
audio.addEventListener('ratechange', positionState);
audio.addEventListener('seeked', positionState);
audio.addEventListener('ended', () => {
  if (state.sleep?.endOfTrack) { state.sleep = null; emit('change'); return; }
  next(true);
});
audio.addEventListener('timeupdate', () => {
  emit('time', audio.currentTime, audio.duration);
  const s = current();
  if (s && !state.scrobbled && audio.duration > 0) {
    const threshold = Math.min(audio.duration / 2, 240);
    if (audio.currentTime >= threshold) {
      state.scrobbled = true;
      api.scrobble(s.id, true).catch(() => queueOfflineScrobble(s.id));
    }
  }
});
let errorSkips = 0;
audio.addEventListener('error', () => {
  if (!audio.src || !current()) return;
  emit('error', current());
  if (errorSkips++ < 3 && state.index < state.queue.length - 1) setTimeout(() => next(), 800);
});
audio.addEventListener('playing', () => { errorSkips = 0; });

// Scrobbles made offline are sent when we're back online.
function queueOfflineScrobble(id) {
  const q = JSON.parse(localStorage.getItem('hum.pendingScrobbles') || '[]');
  q.push({ id, time: Date.now() });
  localStorage.setItem('hum.pendingScrobbles', JSON.stringify(q.slice(-500)));
}
export async function flushScrobbles() {
  const q = JSON.parse(localStorage.getItem('hum.pendingScrobbles') || '[]');
  if (!q.length) return;
  try {
    const { rest } = await import('./api.js');
    await rest('scrobble', { id: q.map((x) => x.id), time: q.map((x) => x.time), submission: true });
    localStorage.removeItem('hum.pendingScrobbles');
  } catch { /* try later */ }
}
window.addEventListener('online', flushScrobbles);

// ---------- persistence ----------
let saveTimer = null;
function persist() {
  const data = {
    queue: state.queue.slice(Math.max(0, state.index - 50), state.index + 300),
    index: Math.min(state.index, 50),
    shuffle: state.shuffle, repeat: state.repeat, context: state.context,
    position: audio.currentTime || 0,
  };
  try { localStorage.setItem(STORE, JSON.stringify(data)); } catch { /* full */ }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const s = current();
    if (s && navigator.onLine) api.savePlayQueue(state.queue.slice(0, 500).map((x) => x.id), s.id, Math.round((audio.currentTime || 0) * 1000)).catch(() => {});
  }, 4000);
}
setInterval(() => { if (isPlaying()) persist(); }, 15000);

export function restore() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE));
    if (!d?.queue?.length) return;
    Object.assign(state, { queue: d.queue, index: d.index, shuffle: d.shuffle || 'off', repeat: d.repeat || 'off', context: d.context });
    load(false, d.position || 0);
  } catch { /* ignore */ }
}
