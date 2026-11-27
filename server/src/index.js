import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import './db.js';
import subsonic from './subsonic.js';
import api from './api.js';
import { scanLibrary } from './scanner.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.use('/rest', subsonic);
app.use('/api', api);

// The PWA. The service worker and manifest must never be cached for long, or
// updates won't reach installed apps.
app.use(express.static(config.webDir, {
  setHeaders(res, file) {
    const base = path.basename(file);
    if (base === 'sw.js' || base === 'index.html' || base.endsWith('.webmanifest')) res.set('Cache-Control', 'no-cache');
  },
}));
app.get('/{*rest}', (req, res) => res.sendFile(path.join(config.webDir, 'index.html')));

app.listen(config.port, config.host, () => {
  console.log(`[hum] listening on http://${config.host}:${config.port}`);
  console.log(`[hum] music folder: ${config.musicDir}`);
  console.log(`[hum] Jamendo: ${config.jamendoClientId ? 'enabled' : 'disabled (set JAMENDO_CLIENT_ID to enable)'}`);
  if (config.scanOnStart) scanLibrary();
});
