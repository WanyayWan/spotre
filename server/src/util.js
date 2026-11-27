import crypto from 'node:crypto';

export const hashId = (prefix, ...parts) =>
  prefix + crypto.createHash('sha1').update(parts.map((p) => String(p ?? '').toLowerCase().trim()).join('\u0000')).digest('hex').slice(0, 16);

export const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

export const AUDIO_TYPES = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', alac: 'audio/mp4', flac: 'audio/flac',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', aif: 'audio/aiff', aiff: 'audio/aiff', webm: 'audio/webm',
};

export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Small deterministic PRNG so "daily" mixes stay the same for a whole day.
export function seeded(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export const safeName = (s) => String(s || 'Unknown').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_').trim().slice(0, 120) || 'Unknown';
