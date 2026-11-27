// Turns DB rows into Subsonic/OpenSubsonic response objects.
const iso = (ms) => (ms ? new Date(ms).toISOString() : undefined);

export function songObj(r) {
  if (!r) return null;
  const o = {
    id: r.id,
    parent: r.album_id,
    isDir: false,
    title: r.title,
    album: r.album,
    artist: r.artist,
    track: r.track ?? undefined,
    discNumber: r.disc ?? undefined,
    year: r.year ?? undefined,
    genre: r.genre ?? undefined,
    coverArt: r.cover ? (r.source === 'local' ? r.album_id : r.id) : undefined,
    size: r.size || undefined,
    contentType: r.content_type || 'audio/mpeg',
    suffix: r.suffix || 'mp3',
    duration: r.duration || 0,
    bitRate: r.bitrate ?? undefined,
    path: r.source === 'local' ? r.path : undefined,
    playCount: r.play_count || 0,
    played: iso(r.last_played),
    created: iso(r.created_at),
    starred: iso(r.starred_at),
    albumId: r.album_id,
    artistId: r.artist_id,
    type: 'music',
    mediaType: 'song',
    isVideo: false,
    // Hum extensions (ignored by other Subsonic clients)
    source: r.source,
  };
  if (r.license) o.license = r.license;
  if (r.external_url) o.externalUrl = r.external_url;
  return clean(o);
}

export function albumObj(a, songs) {
  const o = clean({
    id: a.id,
    name: a.name,
    title: a.name,
    album: a.name,
    artist: a.artist,
    artistId: a.artist_id,
    coverArt: a.cover ? a.id : undefined,
    songCount: a.song_count,
    duration: a.duration,
    year: a.year ?? undefined,
    genre: a.genre ?? undefined,
    created: iso(a.created_at),
    starred: iso(a.starred_at),
    isDir: true,
    parent: a.artist_id,
  });
  if (songs) o.song = songs.map(songObj);
  return o;
}

export function artistObj(r, albums) {
  const o = clean({
    id: r.id,
    name: r.name,
    albumCount: r.album_count,
    coverArt: r.cover ? r.id : undefined,
    starred: iso(r.starred_at),
  });
  if (albums) o.album = albums.map((a) => albumObj(a));
  return o;
}

export function clean(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null) delete o[k];
  return o;
}
