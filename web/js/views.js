// Pages. Each view is an async function returning a DOM node.
import { api, getFeatures, getSession, uploadFiles, logout } from './api.js';
import * as player from './player.js';
import * as offline from './offline.js';
import { h, icon, art, fmtTime, fmtDuration, fmtBytes, plural, toast, actionSheet, ask, sheet, dominantColor, applyTheme, greeting } from './ui.js';

export const go = (path) => { location.hash = path; };

// ---------- likes ----------
const likedIds = new Set();
export async function loadLikes() {
  try { const s = await api.starred(); likedIds.clear(); (s.song || []).forEach((x) => likedIds.add(x.id)); } catch { /* offline */ }
}
export const isLiked = (id) => likedIds.has(id);
export async function toggleLike(song) {
  const was = likedIds.has(song.id);
  was ? likedIds.delete(song.id) : likedIds.add(song.id);
  document.dispatchEvent(new CustomEvent('hum:likes'));
  try { was ? await api.unstar(song.id) : await api.star(song.id); toast(was ? 'Removed from Liked Songs' : 'Added to Liked Songs'); }
  catch { was ? likedIds.add(song.id) : likedIds.delete(song.id); document.dispatchEvent(new CustomEvent('hum:likes')); toast('Could not update Liked Songs'); }
}

// ---------- song rows & actions ----------
export function songActions(song, { playlist, index } = {}) {
  const dl = offline.isDownloaded(song.id);
  actionSheet(
    h('div', { class: 'sheet-head' }, art(song.coverArt, { size: 120, cls: 'sm' }), h('div', {}, h('div', { class: 'title' }, song.title), h('div', { class: 'sub' }, song.artist))),
    [
      { icon: 'next', label: 'Play next', onSelect: () => { player.playNext(song); toast('Playing next'); } },
      { icon: 'queue', label: 'Add to queue', onSelect: () => { player.addToQueue(song); toast('Added to queue'); } },
      { icon: 'plus', label: 'Add to playlist', onSelect: () => pickPlaylist([song]) },
      { icon: isLiked(song.id) ? 'heart' : 'heartOutline', label: isLiked(song.id) ? 'Remove from Liked Songs' : 'Like', onSelect: () => toggleLike(song) },
      { icon: 'radio', label: 'Start song radio', onSelect: () => player.startRadio(song).catch(() => toast('Radio needs a connection')) },
      { icon: dl ? 'trash' : 'download', label: dl ? 'Remove download' : 'Download', onSelect: () => (dl ? offline.removeDownload(song.id) : downloadSongs([song])) },
      song.albumId && { icon: 'album', label: 'Go to album', onSelect: () => go(`/album/${encodeURIComponent(song.albumId)}`) },
      song.artistId && { icon: 'person', label: 'Go to artist', onSelect: () => go(`/artist/${encodeURIComponent(song.artistId)}`) },
      playlist && { icon: 'trash', label: 'Remove from this playlist', danger: true, onSelect: async () => {
        await api.updatePlaylist(playlist, { songIndexToRemove: index });
        toast('Removed'); window.dispatchEvent(new HashChangeEvent('hashchange'));
      } },
    ],
  );
}

export async function downloadSongs(songs) {
  offline.requestPersistence();
  const todo = songs.filter((s) => !offline.isDownloaded(s.id));
  if (!todo.length) return toast('Already downloaded');
  toast(`Downloading ${plural(todo.length, 'song')}…`);
  let ok = 0;
  for (const s of todo) { try { await offline.download(s); ok++; } catch { /* keep going */ } }
  toast(ok === todo.length ? `Downloaded ${plural(ok, 'song')}` : `Downloaded ${ok} of ${todo.length}`);
}

export async function pickPlaylist(songs) {
  let lists = [];
  try { lists = await api.playlists(); } catch { return toast('Playlists need a connection'); }
  const add = async (pl) => {
    try { await api.updatePlaylist(pl.id, { songIdToAdd: songs.map((s) => s.id) }); toast(`Added to ${pl.name}`); }
    catch { toast('Could not add to playlist'); }
  };
  actionSheet(h('h3', { class: 'sheet-title' }, 'Add to playlist'), [
    { icon: 'plus', label: 'New playlist…', onSelect: async () => {
      const name = await ask('New playlist', { placeholder: 'Playlist name', ok: 'Create' });
      if (name) { await api.createPlaylist(name, songs.map((s) => s.id)); toast(`Created ${name}`); }
    } },
    ...lists.map((pl) => ({ icon: 'queue', label: pl.name, onSelect: () => add(pl) })),
  ]);
}

export function songRow(song, i, list, opts = {}) {
  const row = h('div', { class: `song ${song._suggested ? 'suggested' : ''}`, 'data-id': song.id, role: 'button', tabindex: 0 },
    opts.numbered ? h('div', { class: 'num' }, song.track || i + 1) : art(song.coverArt, { size: 120, cls: 'sm' }),
    h('div', { class: 'meta' },
      h('div', { class: 'title' }, song.title),
      h('div', { class: 'sub' },
        offline.isDownloaded(song.id) ? icon('download', 'tiny ok') : null,
        song.source === 'jamendo' && !opts.hideSource ? h('span', { class: 'badge' }, 'Jamendo') : null,
        opts.numbered ? song.artist : [song.artist, opts.showAlbum && song.album ? ` · ${song.album}` : ''].join(''))),
    opts.extra ? h('div', { class: 'extra' }, opts.extra) : null,
    h('button', { class: 'icon-btn more', 'aria-label': 'More', onclick: (e) => { e.stopPropagation(); songActions(song, opts.actions); } }, icon('more')));
  const playIt = () => player.playList(list, i, { context: opts.context });
  row.addEventListener('click', playIt);
  row.addEventListener('keydown', (e) => e.key === 'Enter' && playIt());
  return row;
}

export function songList(songs, opts = {}) {
  return h('div', { class: 'songs' }, songs.map((s, i) => songRow(s, i, songs, { ...opts, actions: opts.playlist ? { playlist: opts.playlist, index: i } : undefined })));
}

// ---------- cards & shelves ----------
function card({ title, sub, coverArt, round, href, onPlay, label }) {
  return h('a', { class: `card ${round ? 'round' : ''}`, href: `#${href}` },
    h('div', { class: 'card-art' }, art(coverArt, { size: 300, round, label: label || title }),
      onPlay ? h('button', { class: 'card-play', 'aria-label': `Play ${title}`, onclick: (e) => { e.preventDefault(); onPlay(); } }, icon('play')) : null),
    h('div', { class: 'card-title' }, title),
    sub ? h('div', { class: 'card-sub' }, sub) : null);
}
const albumCard = (a) => card({ title: a.name, sub: a.artist, coverArt: a.coverArt, href: `/album/${encodeURIComponent(a.id)}`,
  onPlay: async () => { const al = await api.album(a.id); player.playList(al.song, 0, { context: { type: 'album', id: a.id, name: a.name } }); } });
const artistCard = (a) => card({ title: a.name, sub: 'Artist', coverArt: a.coverArt, round: true, href: `/artist/${encodeURIComponent(a.id)}` });

function shelf(title, items, { more } = {}) {
  if (!items?.length) return null;
  return h('section', { class: 'shelf' },
    h('div', { class: 'shelf-head' }, h('h2', {}, title), more ? h('a', { href: `#${more}`, class: 'link' }, 'See all') : null),
    h('div', { class: 'scroller' }, items));
}

function empty(title, body, action) {
  return h('div', { class: 'empty' }, icon('sparkle', 'big'), h('h3', {}, title), h('p', {}, body), action || null);
}

const safe = (p, fallback = []) => p.catch(() => fallback);

// ---------- Home ----------
export async function home() {
  const f = getFeatures();
  const [recent, newest, mixes, trending, playlists] = await Promise.all([
    safe(api.albums('recent', 12)), safe(api.albums('newest', 12)), f.mixes ? safe(api.mixes()) : [],
    f.jamendo ? safe(api.jamendoTracks({ order: 'popularity_week', limit: 12 })) : [], safe(api.playlists()),
  ]);
  const quick = [
    { title: 'Liked Songs', href: '/liked', label: 'liked', cls: 'liked' },
    ...mixes.slice(0, 2).map((m) => ({ title: m.name, href: `/mix/${m.id}`, coverArt: m.coverArt })),
    ...playlists.slice(0, 3).map((p) => ({ title: p.name, href: `/playlist/${p.id}`, coverArt: p.coverArt })),
    ...recent.slice(0, 4).map((a) => ({ title: a.name, href: `/album/${encodeURIComponent(a.id)}`, coverArt: a.coverArt })),
  ].slice(0, 6);

  const page = h('div', { class: 'page home' },
    h('header', { class: 'page-head' },
      h('h1', {}, greeting()),
      h('div', { class: 'head-actions' },
        getFeatures().stats ? h('a', { class: 'icon-btn', href: '#/stats', 'aria-label': 'Listening stats' }, icon('chart')) : null,
        h('a', { class: 'icon-btn', href: '#/settings', 'aria-label': 'Settings' }, icon('gear')))),
    h('div', { class: 'quick' }, quick.map((q) => h('a', { class: `quick-item ${q.cls || ''}`, href: `#${q.href}` },
      q.cls === 'liked' ? h('div', { class: 'art sm liked-art' }, icon('heart')) : art(q.coverArt, { size: 120, cls: 'sm', label: q.title }),
      h('span', {}, q.title)))),
  );

  if (!newest.length && !trending.length) {
    page.append(empty('Your library is empty', f.uploads ? 'Upload some songs from your phone, or drop files in the server’s music folder.' : 'Add music to your server to get started.',
      f.uploads ? h('button', { class: 'btn primary', onclick: openUpload }, icon('upload'), 'Upload music') : null));
    if (!f.jamendo && f.uploads) page.append(h('p', { class: 'hint' }, 'Tip: set JAMENDO_CLIENT_ID on the server to stream free, legal music from Jamendo.'));
  }

  page.append(
    shelf('Made for you', mixes.map((m) => card({ title: m.name, sub: m.description, coverArt: m.coverArt, href: `/mix/${m.id}`,
      onPlay: () => player.playList(m.song, 0, { context: { type: 'mix', id: m.id, name: m.name } }) }))) || '',
    shelf('Recently played', recent.map(albumCard)) || '',
    shelf('Trending on Jamendo', trending.map((s, i) => card({ title: s.title, sub: s.artist, coverArt: s.coverArt, href: `/album/${encodeURIComponent(s.albumId)}`,
      onPlay: () => player.playList(trending, i, { context: { type: 'discover', name: 'Trending on Jamendo' } }) })), { more: '/discover' }) || '',
    shelf('Recently added', newest.map(albumCard), { more: '/library/albums' }) || '',
  );
  if (f.jamendo) page.append(h('a', { class: 'discover-banner', href: '#/discover' }, icon('cloud'), h('div', {}, h('strong', {}, 'Discover free music'), h('span', {}, 'Thousands of Creative Commons tracks from Jamendo'))));
  return page;
}

// ---------- Search ----------
const JAMENDO_TAGS = ['pop', 'rock', 'electronic', 'hiphop', 'jazz', 'ambient', 'lounge', 'classical', 'folk', 'metal', 'soundtrack', 'reggae', 'chillout', 'acoustic', 'piano', 'lofi'];
export async function search() {
  const input = h('input', { class: 'search-input', type: 'search', placeholder: 'Songs, artists, albums', autocapitalize: 'off', autocomplete: 'off', enterkeyhint: 'search' });
  const results = h('div', { class: 'results' });
  const page = h('div', { class: 'page search' },
    h('header', { class: 'page-head' }, h('h1', {}, 'Search')),
    h('div', { class: 'search-box' }, icon('search'), input), results);

  const last = sessionStorage.getItem('hum.lastSearch') || '';
  input.value = last;

  async function browse() {
    const genres = await safe(api.genres());
    results.replaceChildren(
      genres.length ? h('h2', { class: 'section-title' }, 'Your genres') : '',
      h('div', { class: 'tiles' }, genres.slice(0, 12).map((g) => h('a', { class: 'tile', href: `#/genre/${encodeURIComponent(g.value)}`, style: { background: tileColor(g.value) } }, h('span', {}, g.value)))),
      getFeatures().jamendo ? h('h2', { class: 'section-title' }, 'Browse free music') : '',
      getFeatures().jamendo ? h('div', { class: 'tiles' }, JAMENDO_TAGS.map((t) => h('a', { class: 'tile', href: `#/discover/${t}`, style: { background: tileColor(t) } }, h('span', {}, cap(t))))) : '',
    );
  }

  let seq = 0, timer;
  async function run() {
    const q = input.value.trim();
    sessionStorage.setItem('hum.lastSearch', q);
    if (!q) return browse();
    const my = ++seq;
    results.replaceChildren(h('div', { class: 'spinner' }));
    const [local, jt, ja] = await Promise.all([
      safe(api.search(q), {}),
      getFeatures().jamendo ? safe(api.jamendoTracks({ q, limit: 20 })) : [],
      getFeatures().jamendo ? safe(api.jamendoArtists({ q, limit: 8 })) : [],
    ]);
    if (my !== seq) return;
    const songs = local.song || [];
    const nodes = [];
    if (songs.length) nodes.push(h('h2', { class: 'section-title' }, 'Songs'), songList(songs.slice(0, 8), { showAlbum: true }));
    nodes.push(shelf('Artists', (local.artist || []).map(artistCard)) || '');
    nodes.push(shelf('Albums', (local.album || []).map(albumCard)) || '');
    if (jt.length) nodes.push(h('h2', { class: 'section-title' }, 'From Jamendo'), songList(jt, { hideSource: true }));
    nodes.push(shelf('Jamendo artists', ja.map(artistCard)) || '');
    if (!songs.length && !jt.length && !(local.album || []).length && !(local.artist || []).length) nodes.push(empty('No results', `Nothing matched “${q}”.`));
    results.replaceChildren(...nodes);
  }
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 280); });
  run();
  return page;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function tileColor(s) {
  let x = 7;
  for (const c of s) x = (x * 33 + c.charCodeAt(0)) >>> 0;
  return `linear-gradient(140deg, hsl(${x % 360} 62% 46%), hsl(${(x + 50) % 360} 58% 32%))`;
}

// ---------- Library ----------
export async function library(tab = 'playlists') {
  const f = getFeatures();
  const tabs = [['playlists', 'Playlists'], ['albums', 'Albums'], ['artists', 'Artists'], ['songs', 'Songs'], ['downloads', 'Downloaded']];
  const body = h('div', { class: 'lib-body' }, h('div', { class: 'spinner' }));
  const page = h('div', { class: 'page library' },
    h('header', { class: 'page-head' }, h('h1', {}, 'Library'),
      h('div', { class: 'head-actions' },
        f.uploads ? h('button', { class: 'icon-btn', 'aria-label': 'Upload music', onclick: openUpload }, icon('upload')) : null,
        h('button', { class: 'icon-btn', 'aria-label': 'New playlist', onclick: newPlaylist }, icon('plus')))),
    h('nav', { class: 'pills' }, tabs.map(([id, label]) => h('a', { class: `pill ${id === tab ? 'active' : ''}`, href: `#/library/${id}` }, label))),
    body);

  const render = async () => {
    if (tab === 'playlists') {
      const [lists, smart] = await Promise.all([safe(api.playlists()), f.smart ? safe(api.smartLists()) : []]);
      const rows = [
        listRow({ title: 'Liked Songs', sub: 'Playlist', href: '/liked', liked: true }),
        ...lists.map((p) => listRow({ title: p.name, sub: `Playlist · ${plural(p.songCount, 'song')}`, coverArt: p.coverArt, href: `/playlist/${p.id}` })),
        ...smart.filter((s) => s.id !== 'liked' && s.songCount).map((s) => listRow({ title: s.name, sub: `Smart playlist · ${s.description}`, href: `/smart/${s.id}`, smart: true })),
      ];
      body.replaceChildren(h('div', { class: 'list' }, rows));
    } else if (tab === 'albums') {
      const albums = await safe(api.albums('alphabeticalByName', 500));
      body.replaceChildren(albums.length ? h('div', { class: 'grid' }, albums.map(albumCard)) : empty('No albums yet', 'Uploaded music shows up here.'));
    } else if (tab === 'artists') {
      const artists = await safe(api.artists());
      body.replaceChildren(h('div', { class: 'list' }, artists.map((a) => listRow({ title: a.name, sub: plural(a.albumCount || 0, 'album'), coverArt: a.coverArt, round: true, href: `/artist/${encodeURIComponent(a.id)}` }))));
    } else if (tab === 'songs') {
      const songs = await safe(api.allSongs(500));
      body.replaceChildren(playBar(songs, { type: 'songs', name: 'All songs' }), songList(songs, { showAlbum: true, context: { type: 'songs', name: 'All songs' } }));
    } else if (tab === 'downloads') {
      const songs = offline.downloadedSongs();
      body.replaceChildren(
        h('p', { class: 'hint' }, `${plural(songs.length, 'song')} · ${fmtBytes(offline.downloadsBytes())} on this device`),
        ...(songs.length ? [playBar(songs, { type: 'downloads', name: 'Downloaded' }), songList(songs, { showAlbum: true })] : [empty('Nothing downloaded', 'Tap ••• on any song, album or playlist and choose Download to listen offline.')]));
    }
  };
  render();
  return page;
}

function listRow({ title, sub, coverArt, href, round, liked: isLikedRow, smart }) {
  return h('a', { class: 'list-row', href: `#${href}` },
    isLikedRow ? h('div', { class: 'art sm liked-art' }, icon('heart')) : smart ? h('div', { class: 'art sm smart-art' }, icon('sparkle')) : art(coverArt, { size: 120, cls: 'sm', round, label: title }),
    h('div', { class: 'meta' }, h('div', { class: 'title' }, title), h('div', { class: 'sub' }, sub)));
}

function playBar(songs, context, extra = []) {
  if (!songs.length) return '';
  return h('div', { class: 'play-bar' },
    h('button', { class: 'btn primary round-lg', 'aria-label': 'Play', onclick: () => player.playList(songs, 0, { context }) }, icon('play')),
    h('button', { class: 'icon-btn lg', 'aria-label': 'Shuffle', onclick: () => player.playList(songs, 0, { shuffle: true, context }) }, icon('shuffle')),
    h('button', { class: 'icon-btn lg', 'aria-label': 'Download', onclick: () => downloadSongs(songs) }, icon('download')),
    extra);
}

async function newPlaylist() {
  const name = await ask('New playlist', { placeholder: 'Playlist name', ok: 'Create' });
  if (!name) return;
  const pl = await api.createPlaylist(name);
  go(`/playlist/${pl.id}`);
}

// ---------- detail pages ----------
async function hero({ title, kind, sub, coverArt, round, songs, context, extra, liked: likedHero }) {
  const top = h('div', { class: 'hero' },
    likedHero ? h('div', { class: 'art hero-art liked-art' }, icon('heart')) : art(coverArt, { size: 600, cls: 'hero-art', round, label: title }),
    h('div', { class: 'hero-text' }, kind ? h('div', { class: 'kind' }, kind) : null, h('h1', {}, title), sub ? h('div', { class: 'hero-sub' }, sub) : null));
  const page = h('div', { class: 'page detail' }, top, playBar(songs, context, extra || []));
  dominantColor(coverArt).then((c) => applyTheme(page, c));
  return page;
}

export async function album(id) {
  const a = await api.album(id);
  if (!a) return empty('Album not found', '');
  const songs = a.song || [];
  const total = songs.reduce((t, s) => t + (s.duration || 0), 0);
  const ctx = { type: 'album', id, name: a.name };
  const page = await hero({
    title: a.name, kind: a.source === 'jamendo' ? 'Album · Jamendo' : 'Album', coverArt: a.coverArt, songs, context: ctx,
    sub: [h('a', { href: `#/artist/${encodeURIComponent(a.artistId)}`, class: 'strong' }, a.artist), [a.year, plural(songs.length, 'song'), fmtDuration(total)].filter(Boolean).join(' · ')],
    extra: [h('button', { class: 'icon-btn lg', 'aria-label': 'Add to playlist', onclick: () => pickPlaylist(songs) }, icon('plus'))],
  });
  page.append(songList(songs, { numbered: true, context: ctx }));
  const lic = songs.find((s) => s.license);
  if (lic) page.append(h('p', { class: 'hint' }, 'Licensed under ', h('a', { href: lic.license, target: '_blank', rel: 'noopener' }, 'Creative Commons'), ' via Jamendo.'));
  return page;
}

export async function artist(id) {
  const a = await api.artist(id);
  if (!a) return empty('Artist not found', '');
  let top = a.song || [];
  if (!top.length && a.source !== 'jamendo') top = await safe(api.topSongs(a.name));
  const albums = a.album || [];
  if (!top.length && albums.length && a.source !== 'jamendo') top = (await safe(api.album(albums[0].id), {})).song || [];
  const ctx = { type: 'artist', id, name: a.name };
  const page = await hero({
    title: a.name, kind: a.source === 'jamendo' ? 'Artist · Jamendo' : 'Artist', coverArt: a.coverArt || albums[0]?.coverArt, round: true, songs: top, context: ctx,
    sub: albums.length ? plural(albums.length, 'album') : '',
    extra: [top[0] ? h('button', { class: 'icon-btn lg', 'aria-label': 'Artist radio', onclick: () => player.startRadio(top[0]) }, icon('radio')) : ''],
  });
  if (top.length) page.append(h('h2', { class: 'section-title' }, 'Popular'), songList(top.slice(0, 10), { context: ctx }));
  page.append(shelf('Albums', albums.map(albumCard)) || '');
  return page;
}

export async function playlist(id) {
  const p = await api.playlist(id);
  const songs = p.entry || [];
  const ctx = { type: 'playlist', id, name: p.name };
  const more = () => actionSheet(h('h3', { class: 'sheet-title' }, p.name), [
    { icon: 'lyrics', label: 'Rename', onSelect: async () => { const n = await ask('Rename playlist', { value: p.name }); if (n) { await api.updatePlaylist(id, { name: n }); window.dispatchEvent(new HashChangeEvent('hashchange')); } } },
    { icon: 'queue', label: 'Add all to queue', onSelect: () => player.addToQueue(songs) },
    { icon: 'trash', label: 'Delete playlist', danger: true, onSelect: async () => { if (confirm(`Delete “${p.name}”?`)) { await api.deletePlaylist(id); go('/library/playlists'); } } },
  ]);
  const page = await hero({
    title: p.name, kind: 'Playlist', coverArt: p.coverArt, songs, context: ctx,
    sub: `${plural(songs.length, 'song')} · ${fmtDuration(p.duration)}`,
    extra: [h('button', { class: 'icon-btn lg', 'aria-label': 'More', onclick: more }, icon('more'))],
  });
  if (!songs.length) page.append(h('div', { class: 'play-bar' }, h('button', { class: 'icon-btn lg', onclick: more }, icon('more'))), empty('This playlist is empty', 'Tap ••• on any song and choose Add to playlist.'));
  else page.append(songList(songs, { playlist: id, showAlbum: true, context: ctx }));
  return page;
}

export async function liked() {
  const s = await api.starred();
  const songs = s.song || [];
  const ctx = { type: 'liked', name: 'Liked Songs' };
  const page = await hero({ title: 'Liked Songs', kind: 'Playlist', liked: true, songs, context: ctx, sub: plural(songs.length, 'song') });
  page.append(songs.length ? songList(songs, { showAlbum: true, context: ctx }) : empty('No liked songs yet', 'Tap the heart on the player to save songs here.'));
  return page;
}

export async function smart(kind) {
  const s = await api.smart(kind);
  const songs = s.song || [];
  const ctx = { type: 'smart', id: kind, name: s.name };
  const page = await hero({ title: s.name, kind: 'Smart playlist', songs, context: ctx, coverArt: songs[0]?.coverArt, sub: `${s.description} · ${plural(songs.length, 'song')}` });
  page.append(songList(songs, { showAlbum: true, context: ctx }));
  return page;
}

export async function mix(id) {
  const mixes = await api.mixes();
  const m = mixes.find((x) => x.id === id);
  if (!m) return empty('Mix not found', 'Mixes refresh every day.');
  const ctx = { type: 'mix', id, name: m.name };
  const page = await hero({ title: m.name, kind: 'Made for you', coverArt: m.coverArt, songs: m.song, context: ctx, sub: m.description });
  page.append(songList(m.song, { showAlbum: true, context: ctx }));
  return page;
}

export async function genre(name) {
  const [songs, jam] = await Promise.all([safe(api.random(80, name)), getFeatures().jamendo ? safe(api.jamendoTracks({ tags: name.toLowerCase(), limit: 30 })) : []]);
  const ctx = { type: 'genre', name };
  const page = h('div', { class: 'page detail' }, h('div', { class: 'hero text-only', style: { background: tileColor(name) } }, h('div', { class: 'hero-text' }, h('div', { class: 'kind' }, 'Genre'), h('h1', {}, name))),
    playBar(songs.length ? songs : jam, ctx));
  if (songs.length) page.append(h('h2', { class: 'section-title' }, 'In your library'), songList(songs, { showAlbum: true, context: ctx }));
  if (jam.length) page.append(h('h2', { class: 'section-title' }, 'From Jamendo'), songList(jam, { hideSource: true, context: ctx }));
  return page;
}

export async function discover(tag = '') {
  if (!getFeatures().jamendo) return empty('Jamendo is off', 'Set JAMENDO_CLIENT_ID on the server to stream free Creative Commons music.');
  const chips = ['', ...JAMENDO_TAGS];
  const order = tag ? 'popularity_month' : 'popularity_week';
  const [songs, albums] = await Promise.all([safe(api.jamendoTracks({ tags: tag, order, limit: 50 })), tag ? [] : safe(api.jamendoAlbums({ limit: 16 }))]);
  const ctx = { type: 'discover', name: tag ? `${cap(tag)} on Jamendo` : 'Trending on Jamendo' };
  return h('div', { class: 'page discover' },
    h('header', { class: 'page-head' }, h('h1', {}, 'Discover')),
    h('p', { class: 'hint' }, 'Free and legal Creative Commons music from Jamendo.'),
    h('nav', { class: 'pills' }, chips.map((t) => h('a', { class: `pill ${t === tag ? 'active' : ''}`, href: `#/discover${t ? `/${t}` : ''}` }, t ? cap(t) : 'Trending'))),
    shelf('Popular albums', albums.map(albumCard)) || '',
    playBar(songs, ctx),
    songList(songs, { hideSource: true, context: ctx }));
}

// ---------- Stats ----------
export async function stats(range = '30') {
  const days = range === 'all' ? 0 : Number(range);
  const s = await api.stats(days);
  const minutes = Math.round(s.totals.seconds / 60);
  const maxArtist = Math.max(1, ...s.topArtists.map((a) => a.plays));
  const maxHour = Math.max(1, ...s.hours);
  const peak = s.hours.indexOf(Math.max(...s.hours));
  const peakLabel = s.totals.plays ? (peak < 5 ? 'a night owl' : peak < 12 ? 'an early bird' : peak < 18 ? 'an afternoon listener' : 'an evening listener') : null;
  return h('div', { class: 'page stats' },
    h('header', { class: 'page-head' }, h('h1', {}, 'Your listening')),
    h('nav', { class: 'pills' }, [['7', '7 days'], ['30', '30 days'], ['365', 'Year'], ['all', 'All time']].map(([v, l]) => h('a', { class: `pill ${v === range ? 'active' : ''}`, href: `#/stats/${v}` }, l))),
    h('div', { class: 'stat-cards' },
      statCard(minutes.toLocaleString(), 'minutes listened'),
      statCard(s.totals.plays.toLocaleString(), 'plays'),
      statCard(s.totals.songs.toLocaleString(), 'different songs')),
    !s.totals.plays ? empty('No listening yet', 'Play some music and your stats will appear here.') : '',
    s.topArtists.length ? h('section', {}, h('h2', { class: 'section-title' }, 'Top artists'),
      h('div', { class: 'bars' }, s.topArtists.map((a, i) => h('a', { class: 'bar-row', href: `#/artist/${encodeURIComponent(a.id)}` },
        h('span', { class: 'rank' }, i + 1), h('span', { class: 'bar-label' }, a.name),
        h('span', { class: 'bar' }, h('span', { style: { width: `${(a.plays / maxArtist) * 100}%` } })), h('span', { class: 'bar-val' }, a.plays))))) : '',
    s.topSongs.length ? h('section', {}, h('h2', { class: 'section-title' }, 'Top songs'), songList(s.topSongs, { extra: null, context: { type: 'stats', name: 'Your top songs' } })) : '',
    s.topGenres.length ? h('section', {}, h('h2', { class: 'section-title' }, 'Top genres'), h('div', { class: 'chips' }, s.topGenres.map((g) => h('a', { class: 'chip', href: `#/genre/${encodeURIComponent(g.name)}` }, `${g.name} · ${g.n}`)))) : '',
    s.totals.plays ? h('section', {}, h('h2', { class: 'section-title' }, 'When you listen'),
      peakLabel ? h('p', { class: 'hint' }, `You’re ${peakLabel}. Most plays happen around ${peak}:00.`) : '',
      h('div', { class: 'hours' }, s.hours.map((n, hr) => h('div', { class: 'hour', title: `${hr}:00 · ${n} plays` }, h('span', { style: { height: `${(n / maxHour) * 100}%` } })))),
      h('div', { class: 'hours-axis' }, h('span', {}, '12am'), h('span', {}, '6am'), h('span', {}, '12pm'), h('span', {}, '6pm'), h('span', {}, '11pm'))) : '',
  );
}
const statCard = (big, label) => h('div', { class: 'stat-card' }, h('div', { class: 'big' }, big), h('div', { class: 'label' }, label));

// ---------- Settings ----------
export async function settings() {
  const s = getSession();
  const f = getFeatures();
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const toggleRow = (label, key, def = true) => {
    const input = h('input', { type: 'checkbox', checked: (localStorage.getItem(key) ?? String(def)) === 'true' });
    input.addEventListener('change', () => localStorage.setItem(key, String(input.checked)));
    return h('label', { class: 'set-row' }, h('span', {}, label), h('span', { class: 'switch' }, input, h('i')));
  };
  const usage = h('span', { class: 'muted' }, fmtBytes(offline.downloadsBytes()));
  return h('div', { class: 'page settings' },
    h('header', { class: 'page-head' }, h('h1', {}, 'Settings')),
    !standalone ? h('div', { class: 'install-card' }, h('strong', {}, 'Install Hum on your iPhone'),
      h('p', {}, 'In Safari, tap the Share button, then “Add to Home Screen”. Hum then opens full-screen and keeps playing from the lock screen.')) : '',
    h('h2', { class: 'section-title' }, 'Account'),
    h('div', { class: 'set-group' },
      h('div', { class: 'set-row' }, h('span', {}, 'Signed in as'), h('span', { class: 'muted' }, s.user)),
      h('div', { class: 'set-row' }, h('span', {}, 'Server'), h('span', { class: 'muted ellipsis' }, s.server || location.origin)),
      h('button', { class: 'set-row danger', onclick: () => { logout(); location.hash = '/'; location.reload(); } }, 'Sign out')),
    h('h2', { class: 'section-title' }, 'Playback'),
    h('div', { class: 'set-group' },
      toggleRow('Keep playing similar songs when the queue ends', 'hum.autoplay'),
      toggleRow('Colour the player from album art', 'hum.tint')),
    h('h2', { class: 'section-title' }, 'Library'),
    h('div', { class: 'set-group' },
      f.uploads ? h('button', { class: 'set-row', onclick: openUpload }, h('span', {}, 'Upload music'), icon('upload')) : '',
      h('button', { class: 'set-row', onclick: async () => { await api.startScan(); toast('Scanning the music folder…'); } }, h('span', {}, 'Rescan music folder'), icon('repeat')),
      h('div', { class: 'set-row' }, h('span', {}, 'Downloads on this device'), usage),
      h('button', { class: 'set-row danger', onclick: async () => { if (confirm('Remove all downloaded songs from this device?')) { await offline.clearDownloads(); usage.textContent = fmtBytes(0); toast('Downloads removed'); } } }, 'Remove all downloads')),
    h('h2', { class: 'section-title' }, 'Use other apps'),
    h('p', { class: 'hint' }, 'Hum speaks the Subsonic API, so apps like Amperfy or play:Sub can use this server too. Use the server address above, your username and password.'),
    h('h2', { class: 'section-title' }, 'About'),
    h('p', { class: 'hint' }, 'Hum 0.1 · your own music, anywhere. ', f.jamendo ? ['Free music from ', h('a', { href: 'https://www.jamendo.com', target: '_blank', rel: 'noopener' }, 'Jamendo'), ' under Creative Commons licences. '] : '', 'Lyrics from your files or LRCLIB.'),
  );
}

// ---------- Upload ----------
export function openUpload() {
  const input = h('input', { type: 'file', multiple: true, accept: 'audio/*,.mp3,.m4a,.flac,.ogg,.opus,.wav,.aac,.aiff', class: 'hidden' });
  const bar = h('div', { class: 'progress' }, h('span'));
  const status = h('p', { class: 'hint' }, 'Pick songs from Files. MP3, AAC/M4A, FLAC, ALAC, WAV and Ogg work. Tags and artwork are read automatically.');
  const pickBtn = h('button', { class: 'btn primary', onclick: () => input.click() }, icon('upload'), 'Choose files');
  const close = sheet(h('div', { class: 'upload' }, h('h3', {}, 'Upload music'), status, bar, pickBtn, input));
  input.addEventListener('change', async () => {
    const files = [...input.files];
    if (!files.length) return;
    pickBtn.disabled = true;
    status.textContent = `Uploading ${plural(files.length, 'file')}…`;
    try {
      const r = await uploadFiles(files, (p) => { bar.firstChild.style.width = `${Math.round(p * 100)}%`; });
      status.textContent = `Added ${plural(r.added.length, 'song')}${r.skipped.length ? `, skipped ${r.skipped.length}` : ''}.`;
      toast(`Added ${plural(r.added.length, 'song')}`);
      setTimeout(() => { close(); window.dispatchEvent(new HashChangeEvent('hashchange')); }, 900);
    } catch (e) {
      status.textContent = e.message;
      pickBtn.disabled = false;
    }
  });
}

// ---------- Login ----------
export function loginView(onLogin) {
  const server = h('input', { class: 'field', placeholder: location.origin, autocapitalize: 'off', autocomplete: 'url', inputmode: 'url' });
  const user = h('input', { class: 'field', placeholder: 'Username', autocapitalize: 'off', autocomplete: 'username', required: true });
  const pass = h('input', { class: 'field', placeholder: 'Password', type: 'password', autocomplete: 'current-password', required: true });
  const err = h('p', { class: 'error' });
  const btn = h('button', { class: 'btn primary wide', type: 'submit' }, 'Sign in');
  const adv = h('details', { class: 'adv' }, h('summary', {}, 'Use a different server'), h('p', { class: 'hint' }, 'Any Subsonic server works, for example Navidrome on your homelab.'), server);
  return h('div', { class: 'login' },
    h('div', { class: 'brand' }, h('img', { src: '/icons/icon.svg', alt: '', class: 'logo' }), h('h1', {}, 'Hum'), h('p', {}, 'Your music, anywhere.')),
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true; err.textContent = '';
      try { await onLogin(server.value.trim(), user.value.trim(), pass.value); }
      catch (x) { err.textContent = x.message === 'Failed to fetch' ? 'Could not reach the server.' : x.message; btn.disabled = false; }
    } }, user, pass, adv, err, btn));
}

export { fmtTime };
