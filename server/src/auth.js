import crypto from 'node:crypto';
import { config } from './config.js';
import { md5 } from './util.js';

const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Accepts the standard Subsonic auth parameters (u + t/s, or u + p) from the
// query string, a form body, or X-Hum-* headers (used by the PWA for uploads).
export function checkAuth(params) {
  const u = params.u;
  if (!u || !safeEq(u.toLowerCase(), config.user.toLowerCase())) return false;
  if (params.t && params.s) return safeEq(params.t.toLowerCase(), md5(config.password + params.s));
  if (params.p) {
    let p = params.p;
    if (p.startsWith('enc:')) p = Buffer.from(p.slice(4), 'hex').toString('utf8');
    return safeEq(p, config.password);
  }
  return false;
}

export function authParams(req) {
  return {
    u: req.query.u ?? req.body?.u ?? req.get('x-hum-u'),
    t: req.query.t ?? req.body?.t ?? req.get('x-hum-t'),
    s: req.query.s ?? req.body?.s ?? req.get('x-hum-s'),
    p: req.query.p ?? req.body?.p,
  };
}
