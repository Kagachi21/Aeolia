import { getWindowTitles, type WindowInfo } from './activeWindow';

const PLAYERS = new Set([
  'spotify.exe', 'music.ui.exe', 'foobar2000.exe', 'vlc.exe', 'aimp.exe',
  'wmplayer.exe', 'itunes.exe', 'tidal.exe', 'deezer.exe', 'youtube music.exe',
  'applemusic.exe', 'qobuz.exe',
]);

/* Browser tabs publish the track name in their window title. "Song - YouTube"
   has a title before the service name; a bare "YouTube" home tab does not. */
const SERVICE = /youtube\s*music|youtube|spotify|soundcloud|deezer|tidal|apple\s*music|bandcamp|mixcloud|pandora|last\.fm|bilibili|niconico/i;
const HOME_TITLE = /^(youtube|spotify|soundcloud|deezer|tidal|apple music|music|web player|home|browse|playlists)$/i;

export type MediaState = { playing: boolean; title: string };

export function trackFromTitle(raw: string): string | null {
  const parts = raw.split(/\s+[-–—|]\s+/);
  if (parts.length < 2) return null;
  // A track can contain its own separators ("Song - Artist - YouTube"), so cut
  // at the first service marker instead of taking only the first segment.
  const serviceIndex = parts.findIndex((part, i) => i > 0 && SERVICE.test(part));
  if (serviceIndex < 1) return null;
  const track = parts.slice(0, serviceIndex).join(' - ').trim();
  if (track.length < 2 || HOME_TITLE.test(track)) return null;
  return track.slice(0, 120);
}

export function detectMedia(windows: WindowInfo[]): MediaState {
  let playerName = '';
  let playerTitle = '';
  for (const row of windows) {
    if (row.title) {
      const track = trackFromTitle(row.title);
      if (track) return { playing: true, title: track };
    }
    if (PLAYERS.has(row.process)) {
      playerName = row.process.replace(/\.exe$/, '');
      if (row.title) playerTitle = row.title;
    }
  }
  if (playerName) {
    const label = playerTitle || playerName.replace(/^./, (c) => c.toUpperCase());
    return { playing: true, title: label.slice(0, 120) };
  }
  return { playing: false, title: '' };
}

/* EnumWindows is in-process and fast; tasklist /V hangs inside a GUI Electron
   process, so it cannot be used for title detection. */
export function readMedia(): MediaState {
  try {
    return detectMedia(getWindowTitles());
  } catch (err) {
    console.warn('[media] window enumeration failed:', err);
    return { playing: false, title: '' };
  }
}
