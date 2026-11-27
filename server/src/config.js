import path from 'node:path';

const env = process.env;
const root = path.resolve(import.meta.dirname, '..', '..');

export const config = {
  port: Number(env.PORT || 4533),
  host: env.HOST || '0.0.0.0',
  musicDir: path.resolve(env.MUSIC_DIR || path.join(root, 'music')),
  dataDir: path.resolve(env.DATA_DIR || path.join(root, 'data')),
  webDir: path.resolve(env.WEB_DIR || path.join(root, 'web')),
  user: env.HUM_USER || 'admin',
  password: env.HUM_PASSWORD || '',
  jamendoClientId: env.JAMENDO_CLIENT_ID || '',
  lrclib: env.LRCLIB_ENABLED !== 'false',
  scanOnStart: env.SCAN_ON_START !== 'false',
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 500),
};

if (!config.password) {
  config.password = 'hum';
  console.warn('[hum] HUM_PASSWORD is not set. Using the default password "hum". Set HUM_PASSWORD before exposing this server.');
}
