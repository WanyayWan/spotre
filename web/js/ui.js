// Small DOM helpers, icons and shared UI pieces.
import { coverUrl } from './api.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  search: 'M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.7 4.7-1.4 1.4-4.7-4.7A7.5 7.5 0 1 1 10.5 3m0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11',
  library: 'M4 3h2v18H4zm5 0h2v18H9zm5.2.6 1.9-.6 5.4 17.3-1.9.6z',
  play: 'M7 4.5v15a1 1 0 0 0 1.5.86l12.6-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5',
  pause: 'M6 4h4v16H6zm8 0h4v16h-4z',
  next: 'M5 5.2v13.6a.8.8 0 0 0 1.2.7L16 13v5.5h2.5v-13H16V11L6.2 4.5a.8.8 0 0 0-1.2.7',
  prev: 'M19 5.2v13.6a.8.8 0 0 1-1.2.7L8 13v5.5H5.5v-13H8V11l9.8-6.5a.8.8 0 0 1 1.2.7',
  shuffle: 'M16 3h5v5l-1.8-1.8-4.6 4.6-1.4-1.4 4.6-4.6zM3 5.4 4.4 4l15.8 15.8L21 19v2h-5l1.8-1.8L3 5.4m10.6 9.2 1.4-1.4 3 3-1.4 1.4zM3 18.6l5.3-5.3 1.4 1.4L4.4 20z',
  repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z',
  heart: 'M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.5 1.1 5.3 3 1.8-1.9 3.2-3 5.3-3 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21',
  heartOutline: 'M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.5 1.1 5.3 3 1.8-1.9 3.2-3 5.3-3 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21m0-2.4c2.3-1.5 6.3-4.6 7.7-7.7 1-2.2-.3-4.4-2.4-4.4-1.4 0-2.4.8-4 2.6L12 10.5l-1.3-1.4C9.1 7.3 8.1 6.5 6.7 6.5c-2.1 0-3.4 2.2-2.4 4.4 1.4 3.1 5.4 6.2 7.7 7.7',
  more: 'M5 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3m7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3m7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3',
  down: 'M12 15.5 5 8.5l1.4-1.4 5.6 5.6 5.6-5.6L19 8.5z',
  back: 'M15.5 5 8.5 12l7 7-1.4 1.4L5.7 12l8.4-8.4z',
  queue: 'M3 5h13v2H3zm0 6h13v2H3zm0 6h8v2H3zm15-4v4.3A3 3 0 1 0 20 20v-7h2v-2h-4z',
  lyrics: 'M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-4 4V5a1 1 0 0 1 1-1m3 4v2h10V8zm0 4v2h7v-2z',
  moon: 'M14.5 3a8.5 8.5 0 1 0 6.4 14.1A7 7 0 0 1 14.5 3',
  download: 'M11 3h2v10.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4 3.6 3.6zM4 19h16v2H4z',
  check: 'M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z',
  plus: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z',
  upload: 'M11 21h2V10.8l3.6 3.6 1.4-1.4-6-6-6 6 1.4 1.4 3.6-3.6zM4 3h16v2H4z',
  radio: 'M12 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4M7.1 7.1l1.4 1.4a5 5 0 0 0 0 7l-1.4 1.4a7 7 0 0 1 0-9.8m9.8 0a7 7 0 0 1 0 9.8l-1.4-1.4a5 5 0 0 0 0-7zM4.2 4.2l1.4 1.4a9 9 0 0 0 0 12.8l-1.4 1.4a11 11 0 0 1 0-15.6m15.6 0a11 11 0 0 1 0 15.6l-1.4-1.4a9 9 0 0 0 0-12.8z',
  album: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18m0 6.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5',
  person: 'M12 3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9m0 11c4.4 0 8 2 8 4.5V21H4v-2.5C4 16 7.6 14 12 14',
  trash: 'M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7z',
  gear: 'M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7m8.4 2.2 1.6 1.3-1.8 3.2-2-.6a7.6 7.6 0 0 1-1.6 1l-.4 2H12.2h-1.9l-.4-2a7.6 7.6 0 0 1-1.6-1l-2 .6L4.5 12l1.6-1.3a7.7 7.7 0 0 1 0-1.9L4.5 7.5l1.8-3.2 2 .6c.5-.4 1-.7 1.6-1l.4-2h3.8l.4 2c.6.3 1.1.6 1.6 1l2-.6 1.8 3.2-1.6 1.3c.1.6.1 1.3 0 1.9',
  chart: 'M4 20V10h3v10zm6.5 0V4h3v16zM17 20v-7h3v7z',
  close: 'M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z',
  up: 'M12 8.5l7 7-1.4 1.4-5.6-5.6-5.6 5.6L5 15.5z',
  cloud: 'M7 19a5 5 0 0 1-.9-9.9A6.5 6.5 0 0 1 18.6 10 4.5 4.5 0 0 1 18 19z',
  sparkle: 'M12 2l2 6.5L20.5 10 14 12l-2 6.5L10 12 3.5 10 10 8.5zM19 15l1 2.6 2.5.9-2.5 1-1 2.5-.9-2.5-2.6-1 2.6-.9z',
};
export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon ${cls}`);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', P[name] || '');
  svg.append(p);
  return svg;
}

export const fmtTime = (s) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
};
export const fmtDuration = (s) => {
  const m = Math.round((s || 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`;
};
export const fmtBytes = (b = 0) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e7 ? `${Math.round(b / 1e6)} MB` : `${(b / 1e6).toFixed(1)} MB`);
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// Artwork with a generated gradient fallback.
export function art(coverArt, { size = 300, cls = '', round = false, label = '' } = {}) {
  const wrap = h('div', { class: `art ${round ? 'round' : ''} ${cls}` });
  const fallback = h('div', { class: 'art-fallback', style: { background: gradientFor(label || coverArt || '') } }, icon(round ? 'person' : 'album'));
  wrap.append(fallback);
  if (coverArt) {
    const img = h('img', { loading: 'lazy', decoding: 'async', alt: '', src: coverUrl(coverArt, size) });
    img.onload = () => fallback.remove();
    img.onerror = () => img.remove();
    wrap.append(img);
  }
  return wrap;
}

export function gradientFor(str) {
  let x = 0;
  for (const c of String(str)) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  const h1 = x % 360, h2 = (h1 + 40 + (x % 80)) % 360;
  return `linear-gradient(135deg, hsl(${h1} 55% 42%), hsl(${h2} 60% 28%))`;
}

// ---------- toast ----------
let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- bottom sheets ----------
export function sheet(content, { onClose } = {}) {
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const panel = h('div', { class: 'sheet', role: 'dialog' }, h('div', { class: 'sheet-grip' }), content);
  const close = () => {
    backdrop.classList.remove('open');
    panel.classList.remove('open');
    setTimeout(() => { backdrop.remove(); panel.remove(); onClose?.(); }, 220);
  };
  backdrop.addEventListener('click', close);
  document.body.append(backdrop, panel);
  requestAnimationFrame(() => { backdrop.classList.add('open'); panel.classList.add('open'); });
  return close;
}

// items: [{ icon, label, onSelect, danger }]
export function actionSheet(header, items) {
  let close;
  const list = h('div', { class: 'actions' }, items.filter(Boolean).map((it) =>
    h('button', { class: `action ${it.danger ? 'danger' : ''}`, onclick: () => { close(); it.onSelect(); } }, icon(it.icon), h('span', {}, it.label))));
  close = sheet(h('div', {}, header, list));
  return close;
}

export function ask(title, { placeholder = '', value = '', ok = 'Save' } = {}) {
  return new Promise((resolve) => {
    let done = false, close;
    const input = h('input', { class: 'field', placeholder, value, enterkeyhint: 'done' });
    const submit = () => { done = true; close(); resolve(input.value.trim() || null); };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
    close = sheet(h('form', { class: 'ask', onsubmit: (e) => { e.preventDefault(); submit(); } },
      h('h3', {}, title), input, h('button', { class: 'btn primary', type: 'submit' }, ok)), { onClose: () => !done && resolve(null) });
    setTimeout(() => input.focus(), 250);
  });
}

// ---------- album colour ----------
const colorCache = new Map();
export async function dominantColor(coverArt) {
  if (!coverArt) return null;
  if (colorCache.has(coverArt)) return colorCache.get(coverArt);
  const color = await new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 24;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, 24, 24);
        const d = ctx.getImageData(0, 0, 24, 24).data;
        // Weight pixels by saturation so we pick the "colour" not the greys.
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2]);
          const wt = 0.05 + (max - min) / 255 + (max > 30 && max < 240 ? 0.2 : 0);
          r += d[i] * wt; g += d[i + 1] * wt; b += d[i + 2] * wt; w += wt;
        }
        resolve(toHsl(r / w, g / w, b / w));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = coverUrl(coverArt, 64);
  });
  colorCache.set(coverArt, color);
  return color;
}

function toHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hh = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    hh = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hh *= 60;
  }
  return { h: Math.round(hh), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function applyTheme(el, c) {
  if (!c) { el.style.removeProperty('--tint'); el.style.removeProperty('--tint-deep'); el.style.removeProperty('--tint-bright'); return; }
  const s = Math.min(Math.max(c.s, 25), 70);
  el.style.setProperty('--tint', `hsl(${c.h} ${s}% 38%)`);
  el.style.setProperty('--tint-deep', `hsl(${c.h} ${s}% 14%)`);
  el.style.setProperty('--tint-bright', `hsl(${c.h} ${Math.min(s + 15, 90)}% 68%)`);
}

export const greeting = () => {
  const hr = new Date().getHours();
  return hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
};
