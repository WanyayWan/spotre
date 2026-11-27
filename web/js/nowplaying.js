// Mini player + full-screen Now Playing (lyrics, queue, sleep timer).
import { api } from './api.js';
import * as player from './player.js';
import * as offline from './offline.js';
import { h, icon, art, fmtTime, toast, actionSheet, dominantColor, applyTheme } from './ui.js';
import { isLiked, toggleLike, songActions, downloadSongs, go } from './views.js';

const mini = document.getElementById('mini');
const np = document.getElementById('nowplaying');
let panel = 'art'; // art | lyrics | queue
let lyrics = null, lyricsFor = null;
let seeking = false;

// ---------- mini player ----------
function renderMini() {
  const s = player.current();
  document.body.classList.toggle('has-mini', Boolean(s));
  if (!s) { mini.replaceChildren(); return; }
  mini.replaceChildren(
    h('div', { class: 'mini-inner', onclick: open },
      art(s.coverArt, { size: 120, cls: 'sm' }),
      h('div', { class: 'meta' }, h('div', { class: 'title' }, s.title), h('div', { class: 'sub' }, s.artist)),
      h('button', { class: `icon-btn like ${isLiked(s.id) ? 'on' : ''}`, 'aria-label': 'Like', onclick: (e) => { e.stopPropagation(); toggleLike(s); } }, icon(isLiked(s.id) ? 'heart' : 'heartOutline')),
      h('button', { class: 'icon-btn', 'aria-label': player.isPlaying() ? 'Pause' : 'Play', onclick: (e) => { e.stopPropagation(); player.toggle(); } }, icon(player.isPlaying() ? 'pause' : 'play')),
      h('div', { class: 'mini-progress' }, h('span', { id: 'mini-bar' }))));
  tint(s);
}

async function tint(s) {
  const enabled = localStorage.getItem('hum.tint') !== 'false';
  const c = enabled ? await dominantColor(s.coverArt) : null;
  if (player.current() !== s) return;
  applyTheme(document.documentElement, c);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', np.classList.contains('open') && c ? `hsl(${c.h} 40% 14%)` : '#0d0d12');
}

// ---------- full player ----------
export function open() {
  if (!player.current()) return;
  np.classList.add('open');
  document.body.classList.add('np-open');
  render();
}
export function close() {
  np.classList.remove('open');
  document.body.classList.remove('np-open');
  const s = player.current();
  if (s) tint(s);
}

function contextLabel() {
  const c = player.getState().context;
  return c?.name ? h('div', { class: 'np-context' }, h('span', {}, 'Playing from'), h('strong', {}, c.name)) : h('div', { class: 'np-context' }, h('strong', {}, 'Now playing'));
}

function render() {
  const s = player.current();
  if (!s || !np.classList.contains('open')) return;
  const st = player.getState();
  const a = player.element;
  const seek = h('input', { type: 'range', class: 'seek', min: 0, max: Math.round(a.duration || s.duration || 0), step: 1, value: Math.round(a.currentTime), 'aria-label': 'Seek' });
  seek.addEventListener('input', () => { seeking = true; elapsed.textContent = fmtTime(Number(seek.value)); paintSeek(seek); });
  seek.addEventListener('change', () => { player.seek(Number(seek.value)); seeking = false; });
  const elapsed = h('span', { id: 'np-elapsed' }, fmtTime(a.currentTime));
  const remain = h('span', { id: 'np-remain' }, `-${fmtTime((a.duration || s.duration) - a.currentTime)}`);
  paintSeek(seek);

  const sleepOn = Boolean(st.sleep);
  const body = panel === 'lyrics' ? lyricsPanel(s) : panel === 'queue' ? queuePanel() : h('div', { class: 'np-art-wrap' }, art(s.coverArt, { size: 800, cls: `np-art ${player.isPlaying() ? 'playing' : ''}` }));

  np.replaceChildren(
    h('div', { class: 'np-bg' }),
    h('header', { class: 'np-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('down')),
      contextLabel(),
      h('button', { class: 'icon-btn', 'aria-label': 'More', onclick: () => songActions(s) }, icon('more'))),
    h('div', { class: `np-body panel-${panel}` }, body),
    h('div', { class: 'np-info' },
      panel !== 'art' ? art(s.coverArt, { size: 120, cls: 'sm' }) : null,
      h('div', { class: 'meta' },
        h('div', { class: 'np-title' }, s.title),
        h('a', { class: 'np-artist', href: `#/artist/${encodeURIComponent(s.artistId || '')}`, onclick: close }, s.artist)),
      h('button', { class: `icon-btn like ${isLiked(s.id) ? 'on' : ''}`, 'aria-label': 'Like', onclick: () => toggleLike(s) }, icon(isLiked(s.id) ? 'heart' : 'heartOutline'))),
    h('div', { class: 'np-seek' }, seek, h('div', { class: 'times' }, elapsed, s.source === 'jamendo' ? h('span', { class: 'badge' }, 'Jamendo') : offline.isDownloaded(s.id) ? h('span', { class: 'badge' }, 'Downloaded') : '', remain)),
    h('div', { class: 'np-controls' },
      h('button', { class: `icon-btn mode ${st.shuffle !== 'off' ? 'on' : ''}`, 'aria-label': `Shuffle: ${st.shuffle}`, onclick: async () => { const m = await player.cycleShuffle(); toast({ off: 'Shuffle off', on: 'Shuffle on', smart: 'Smart shuffle: mixing in suggestions' }[m]); } },
        icon('shuffle'), st.shuffle === 'smart' ? icon('sparkle', 'mini-badge') : null),
      h('button', { class: 'icon-btn xl', 'aria-label': 'Previous', onclick: () => player.prev() }, icon('prev')),
      h('button', { class: 'play-btn', 'aria-label': player.isPlaying() ? 'Pause' : 'Play', onclick: () => player.toggle() }, icon(player.isPlaying() ? 'pause' : 'play')),
      h('button', { class: 'icon-btn xl', 'aria-label': 'Next', onclick: () => player.next() }, icon('next')),
      h('button', { class: `icon-btn mode ${st.repeat !== 'off' ? 'on' : ''}`, 'aria-label': `Repeat: ${st.repeat}`, onclick: () => player.cycleRepeat() },
        icon('repeat'), st.repeat === 'one' ? h('span', { class: 'mini-badge num' }, '1') : null)),
    h('div', { class: 'np-tools' },
      h('button', { class: `icon-btn ${panel === 'lyrics' ? 'on' : ''}`, 'aria-label': 'Lyrics', onclick: () => { panel = panel === 'lyrics' ? 'art' : 'lyrics'; render(); } }, icon('lyrics')),
      h('button', { class: `icon-btn ${sleepOn ? 'on' : ''}`, 'aria-label': 'Sleep timer', onclick: sleepMenu }, icon('moon'), sleepOn ? h('span', { class: 'tool-label', id: 'sleep-left' }, sleepLabel()) : null),
      h('button', { class: `icon-btn ${offline.isDownloaded(s.id) ? 'on' : ''}`, 'aria-label': 'Download', onclick: () => (offline.isDownloaded(s.id) ? toast('Already downloaded') : downloadSongs([s])) }, icon(offline.isDownloaded(s.id) ? 'check' : 'download')),
      h('button', { class: `icon-btn ${panel === 'queue' ? 'on' : ''}`, 'aria-label': 'Queue', onclick: () => { panel = panel === 'queue' ? 'art' : 'queue'; render(); } }, icon('queue'))),
  );
  addSwipeToClose();
}

function paintSeek(seek) {
  const pct = Number(seek.max) ? (Number(seek.value) / Number(seek.max)) * 100 : 0;
  seek.style.setProperty('--pct', `${pct}%`);
}

function sleepLabel() {
  const sl = player.getState().sleep;
  if (!sl) return '';
  if (sl.endOfTrack) return 'End';
  return `${Math.max(1, Math.ceil((sl.until - Date.now()) / 60000))}m`;
}

function sleepMenu() {
  const opts = [5, 15, 30, 45, 60, 90].map((m) => ({ icon: 'moon', label: `${m} minutes`, onSelect: () => { player.setSleep(m); toast(`Sleep timer: ${m} minutes`); } }));
  actionSheet(h('h3', { class: 'sheet-title' }, 'Sleep timer'), [
    ...opts,
    { icon: 'album', label: 'End of this song', onSelect: () => { player.setSleep('end'); toast('Stopping after this song'); } },
    player.getState().sleep && { icon: 'close', label: 'Turn off timer', danger: true, onSelect: () => { player.setSleep(null); toast('Sleep timer off'); } },
  ]);
}

// ---------- lyrics ----------
function lyricsPanel(s) {
  const box = h('div', { class: 'lyrics' });
  const fill = () => {
    if (lyrics === 'loading') return box.replaceChildren(h('div', { class: 'spinner' }));
    if (!lyrics?.line?.length) return box.replaceChildren(h('p', { class: 'lyrics-empty' }, 'No lyrics found for this song.'), h('p', { class: 'hint' }, 'Tip: put a .lrc file next to the song on the server for synced lyrics.'));
    box.classList.toggle('synced', Boolean(lyrics.synced));
    box.replaceChildren(...lyrics.line.map((l) => h('p', { class: 'ly', 'data-t': l.start ?? '', onclick: () => l.start !== undefined && player.seek(l.start / 1000) }, l.value || '♪')));
    syncLyrics(true);
  };
  if (lyricsFor !== s.id) {
    lyricsFor = s.id;
    lyrics = 'loading';
    api.lyrics(s.id).then((l) => { if (lyricsFor === s.id) { lyrics = l; fill(); } }).catch(() => { lyrics = null; fill(); });
  }
  fill();
  return box;
}

let lastLine = -1;
function syncLyrics(force = false) {
  if (panel !== 'lyrics' || !lyrics?.synced) return;
  const box = np.querySelector('.lyrics');
  if (!box) return;
  const t = player.element.currentTime * 1000 + 250;
  let idx = -1;
  for (let i = 0; i < lyrics.line.length; i++) { if (lyrics.line[i].start <= t) idx = i; else break; }
  if (idx === lastLine && !force) return;
  lastLine = idx;
  box.querySelectorAll('.ly').forEach((el, i) => { el.classList.toggle('active', i === idx); el.classList.toggle('past', i < idx); });
  const el = box.children[idx];
  if (el) box.scrollTo({ top: el.offsetTop - box.clientHeight * 0.35, behavior: force ? 'auto' : 'smooth' });
}

// ---------- queue ----------
function queuePanel() {
  const st = player.getState();
  const upNext = st.queue.slice(st.index + 1);
  const cur = player.current();
  return h('div', { class: 'queue' },
    h('h3', {}, 'Now playing'),
    h('div', { class: 'q-row current' }, art(cur.coverArt, { size: 120, cls: 'sm' }), h('div', { class: 'meta' }, h('div', { class: 'title' }, cur.title), h('div', { class: 'sub' }, cur.artist))),
    h('div', { class: 'q-head' }, h('h3', {}, upNext.length ? 'Up next' : 'Nothing up next'),
      upNext.length ? h('button', { class: 'link', onclick: () => { player.clearUpNext(); render(); } }, 'Clear') : ''),
    upNext.map((s, k) => {
      const i = st.index + 1 + k;
      return h('div', { class: `q-row ${s._suggested ? 'suggested' : ''}` },
        h('div', { class: 'meta', onclick: () => player.jump(i) }, h('div', { class: 'title' }, s.title), h('div', { class: 'sub' }, s._suggested ? [icon('sparkle', 'tiny'), ' Suggested · ', s.artist] : s.artist)),
        k > 0 ? h('button', { class: 'icon-btn sm', 'aria-label': 'Move up', onclick: () => { player.move(i, i - 1); render(); } }, icon('up')) : null,
        h('button', { class: 'icon-btn sm', 'aria-label': 'Remove', onclick: () => { player.removeAt(i); render(); } }, icon('close')));
    }),
    upNext.length < 3 && navigator.onLine ? h('button', { class: 'btn ghost', onclick: async () => { await player.startRadio(cur); render(); } }, icon('radio'), 'Fill with song radio') : '');
}

// ---------- gestures ----------
function addSwipeToClose() {
  const head = np.querySelector('.np-head');
  let y0 = null;
  head.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
  head.addEventListener('touchmove', (e) => {
    if (y0 === null) return;
    const dy = Math.max(0, e.touches[0].clientY - y0);
    np.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  head.addEventListener('touchend', (e) => {
    const dy = (e.changedTouches[0]?.clientY ?? y0) - y0;
    np.style.transform = '';
    y0 = null;
    if (dy > 90) close();
  });
}

// ---------- wiring ----------
player.on('change', () => {
  renderMini();
  if (np.classList.contains('open')) {
    if (panel === 'lyrics' && lyricsFor !== player.current()?.id) lastLine = -1;
    render();
  }
  document.querySelectorAll('.song.playing').forEach((el) => el.classList.remove('playing'));
  const id = player.current()?.id;
  if (id) document.querySelectorAll(`.song[data-id="${CSS.escape(id)}"]`).forEach((el) => el.classList.add('playing'));
});
player.on('state', () => {
  renderMini();
  if (np.classList.contains('open')) {
    const btn = np.querySelector('.play-btn');
    if (btn) { btn.replaceChildren(icon(player.isPlaying() ? 'pause' : 'play')); btn.setAttribute('aria-label', player.isPlaying() ? 'Pause' : 'Play'); }
    np.querySelector('.np-art')?.classList.toggle('playing', player.isPlaying());
  }
});
player.on('time', (t, d) => {
  const bar = document.getElementById('mini-bar');
  if (bar && d) bar.style.width = `${(t / d) * 100}%`;
  if (!np.classList.contains('open')) return;
  const seek = np.querySelector('.seek');
  if (seek && !seeking) {
    if (Number.isFinite(d) && Number(seek.max) !== Math.round(d)) seek.max = Math.round(d);
    seek.value = Math.round(t);
    paintSeek(seek);
    const e = document.getElementById('np-elapsed'), r = document.getElementById('np-remain');
    if (e) e.textContent = fmtTime(t);
    if (r) r.textContent = `-${fmtTime((d || 0) - t)}`;
  }
  const sl = document.getElementById('sleep-left');
  if (sl) sl.textContent = sleepLabel();
  syncLyrics();
});
player.on('error', (s) => toast(`Couldn’t play “${s.title}”${navigator.onLine ? '' : ' (offline)'}`));
document.addEventListener('hum:likes', () => { renderMini(); if (np.classList.contains('open')) render(); });
offline.onDownloadsChange(() => { if (np.classList.contains('open')) render(); });
window.addEventListener('hashchange', () => { if (np.classList.contains('open')) close(); });

export const goTo = go;
