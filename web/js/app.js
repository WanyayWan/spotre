import { getSession, login, loadFeatures } from './api.js';
import * as player from './player.js';
import * as views from './views.js';
import './nowplaying.js';
import { h, icon, toast } from './ui.js';

const main = document.getElementById('main');
const tabs = document.getElementById('tabs');

const routes = [
  [/^\/?$/, () => views.home(), 'home'],
  [/^\/home$/, () => views.home(), 'home'],
  [/^\/search$/, () => views.search(), 'search'],
  [/^\/library(?:\/(\w+))?$/, (m) => views.library(m[1]), 'library'],
  [/^\/album\/(.+)$/, (m) => views.album(decodeURIComponent(m[1]))],
  [/^\/artist\/(.+)$/, (m) => views.artist(decodeURIComponent(m[1]))],
  [/^\/playlist\/(.+)$/, (m) => views.playlist(m[1]), 'library'],
  [/^\/liked$/, () => views.liked(), 'library'],
  [/^\/smart\/(.+)$/, (m) => views.smart(m[1]), 'library'],
  [/^\/mix\/(.+)$/, (m) => views.mix(m[1]), 'home'],
  [/^\/genre\/(.+)$/, (m) => views.genre(decodeURIComponent(m[1])), 'search'],
  [/^\/discover(?:\/(\w+))?$/, (m) => views.discover(m[1]), 'search'],
  [/^\/stats(?:\/(\w+))?$/, (m) => views.stats(m[1]), 'home'],
  [/^\/settings$/, () => views.settings(), 'home'],
];
const TOP = new Set(['/', '', '/home', '/search', '/library']);
const scrollMemo = new Map();
let renderSeq = 0;

async function route() {
  const path = location.hash.replace(/^#/, '') || '/';
  const found = routes.find(([re]) => re.test(path));
  const [re, view, tab] = found || routes[0];
  const my = ++renderSeq;
  tabs.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.tab === (tab || '')));
  const isTop = TOP.has(path) || /^\/library/.test(path);
  const back = isTop ? null : h('button', { class: 'back-btn', 'aria-label': 'Back', onclick: () => history.back() }, icon('back'));
  main.replaceChildren(h('div', { class: 'spinner page-spinner' }));
  try {
    const node = await view(path.match(re));
    if (my !== renderSeq) return;
    main.replaceChildren(...[back, node].filter(Boolean));
    const id = player.current()?.id;
    if (id) main.querySelectorAll(`.song[data-id="${CSS.escape(id)}"]`).forEach((el) => el.classList.add('playing'));
    window.scrollTo(0, scrollMemo.get(path) || 0);
  } catch (e) {
    if (my !== renderSeq) return;
    console.error(e);
    main.replaceChildren(...[back, h('div', { class: 'empty' }, icon('cloud', 'big'), h('h3', {}, navigator.onLine ? 'Something went wrong' : 'You’re offline'),
      h('p', {}, navigator.onLine ? e.message : 'Your downloaded songs still work.'),
      h('a', { class: 'btn ghost', href: '#/library/downloads' }, 'Go to downloads'))].filter(Boolean));
  }
}
let lastPath = location.hash;
window.addEventListener('scroll', () => { scrollMemo.set(lastPath.replace(/^#/, '') || '/', window.scrollY); }, { passive: true });
window.addEventListener('hashchange', () => { lastPath = location.hash; route(); });

function renderTabs() {
  const item = (tab, href, ic, label) => h('a', { href, 'data-tab': tab }, icon(ic), h('span', {}, label));
  tabs.replaceChildren(item('home', '#/', 'home', 'Home'), item('search', '#/search', 'search', 'Search'), item('library', '#/library', 'library', 'Library'));
}

async function start() {
  document.body.classList.add('ready');
  renderTabs();
  await loadFeatures();
  views.loadLikes();
  player.restore();
  player.flushScrobbles();
  route();
}

function showLogin() {
  document.body.classList.add('logged-out');
  main.replaceChildren(views.loginView(async (server, user, pass) => {
    await login(server, user, pass);
    document.body.classList.remove('logged-out');
    location.hash = '/';
    start();
  }));
}

window.addEventListener('offline', () => toast('You’re offline. Downloads still play.'));
window.addEventListener('online', () => toast('Back online'));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('SW registration failed', e));
}

if (getSession()) start();
else showLogin();
