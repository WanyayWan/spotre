# Hum

Your own music streaming app. Hum is a small self-hosted server and an
installable web app (PWA) built for the iPhone. It plays **your own music
files**, plus free and legal Creative Commons music from **Jamendo**, from
anywhere.

It borrows the best ideas from the big streaming apps (mixes, smart shuffle,
synced lyrics, offline downloads, listening stats) but has its own name and
look.

## Features

**Player**
- Lock-screen and Control Centre controls, AirPods buttons, background playback (Media Session API)
- Queue: play next, add to queue, reorder, remove, clear
- Shuffle that keeps the same artist from playing twice in a row, and **smart shuffle** that mixes in suggested songs
- Repeat all / one, sleep timer (minutes or end of song)
- **Synced lyrics** that follow the song (tap a line to jump), from `.lrc` files, embedded tags, or [LRCLIB](https://lrclib.net)
- Player colours itself from the album artwork
- When the queue ends, it keeps going with similar songs (can be turned off)
- Resumes where you left off, and syncs your play queue to the server

**Library**
- Upload songs straight from your iPhone (Files app), or drop files into the `music/` folder
- Albums, artists, songs, genres, search
- Playlists, Liked Songs
- Smart playlists: On Repeat, Fresh Arrivals, Recently Played, Unheard, Rediscover
- **Daily Mixes**, rebuilt each day from what you listen to
- **Song radio** and artist radio
- **Offline downloads** for songs, albums and playlists
- **Listening stats**: minutes, top artists, songs and genres, and when you listen

**Free music (optional)**
- Discover page with trending tracks and genres from Jamendo
- Jamendo songs can be liked, added to playlists and downloaded like your own

**Server**
- Speaks the [Subsonic / OpenSubsonic API](https://opensubsonic.netlify.app), so other Subsonic apps (Amperfy, play:Sub, Substreamer…) also work with it
- The PWA also works with other Subsonic servers like **Navidrome**. Hum-only extras (uploads, Jamendo, mixes, stats) hide themselves when they aren't available
- One Node.js process with a SQLite database. No other services needed. Ships as a Docker image.

## Quick start (on your Mac)

You need Node.js 22.13 or newer.

```bash
cd server
npm install
HUM_PASSWORD=pick-a-password npm start
```

Open <http://localhost:4533> and sign in as `admin` with your password.
Put music in the `music/` folder at the repo root (any folder layout works),
or use **Library → Upload**. Hum scans the folder on start, and you can rescan
from Settings.

To turn on free music, get a client ID at <https://devportal.jamendo.com>
(free, takes a minute), then start with `JAMENDO_CLIENT_ID=yourid` as well.

## Run it with Docker (homelab)

```bash
cp .env.example .env      # set HUM_PASSWORD and JAMENDO_CLIENT_ID
docker compose up -d
```

Music lives in `./music` and the database in `./data`. Point the `./music`
volume at your existing music share if you have one.

| Variable | Default | What it does |
| --- | --- | --- |
| `HUM_USER` | `admin` | Username |
| `HUM_PASSWORD` | `hum` | Password. **Set this.** |
| `JAMENDO_CLIENT_ID` | *(empty)* | Turns on Jamendo free music |
| `MUSIC_DIR` | `./music` (`/music` in Docker) | Where your music files are |
| `DATA_DIR` | `./data` (`/data` in Docker) | Database and artwork cache |
| `PORT` | `4533` | HTTP port |
| `LRCLIB_ENABLED` | `true` | Look up lyrics online when a song has none |
| `MAX_UPLOAD_MB` | `500` | Largest single upload |

## Use it anywhere on your iPhone (Tailscale)

The easiest safe way to reach your server from anywhere is
[Tailscale](https://tailscale.com). Nothing is exposed to the internet and no
ports are opened.

1. Install Tailscale on the computer running Hum and on your iPhone, signed in to the same account.
2. On the computer, give Hum an HTTPS address on your tailnet:
   ```bash
   tailscale serve --bg 4533
   ```
   It prints an address like `https://your-mac.tailnet-name.ts.net`.
3. On the iPhone, open that address in **Safari**, sign in, then tap
   **Share → Add to Home Screen**.

HTTPS matters: iOS only installs the app, keeps offline downloads and runs
the service worker on HTTPS (or `localhost`).

## Getting music legally

- Your own files: CDs you rip, and music bought DRM-free (Bandcamp, Qobuz, 7digital, iTunes Store purchases are DRM-free AAC)
- Free Creative Commons music: Jamendo (built in), Free Music Archive, ccMixter
- Hum doesn't download from Spotify, Apple Music or YouTube, and that's on purpose: those tracks are DRM-protected

## Good to know on iOS

- Background playback and lock-screen controls work best when Hum is installed to the Home Screen.
- iOS ignores volume changes from web apps, so crossfade and an equaliser aren't possible in the PWA. A native app could add them later.
- Supported formats depend on Safari: MP3, AAC/M4A, ALAC, FLAC, WAV and (on iOS 17+) Ogg/Opus.
- Synced lyrics: put a `.lrc` file with the same name next to a song, e.g. `03 Song.mp3` + `03 Song.lrc`.

## Project layout

```
server/          Node.js server
  src/subsonic.js  Subsonic / OpenSubsonic API (/rest/*)
  src/api.js       Hum extras: uploads, Jamendo, mixes, stats (/api/*)
  src/scanner.js   Reads tags and artwork from the music folder
  src/recs.js      Song radio, smart playlists, daily mixes, stats
  src/jamendo.js   Jamendo client
  src/lyrics.js    .lrc / embedded / LRCLIB lyrics
  test/            End-to-end tests (npm test, needs ffmpeg)
web/             The PWA (plain ES modules, no build step)
  js/player.js     Playback engine, queue, Media Session, sleep timer
  js/nowplaying.js Mini player and full-screen player
  js/views.js      Pages
  sw.js            Service worker: app shell, artwork, offline audio
```

## Ideas for later

- Native SwiftUI app for crossfade, EQ and CarPlay
- Last.fm / ListenBrainz scrobbling and better recommendations
- Podcasts (RSS) and internet radio
- Multiple users
- Transcoding big FLAC files on the fly to save mobile data
