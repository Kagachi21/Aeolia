import { net } from 'electron';

/* Auto lyrics: Windows gives no media session, only the player window title.
   lrclib.net is a free public lyrics API (no key, no auth); we query it for
   synced LRC matching the title, cache per song, and push the result to the
   renderer. Every failure path returns null and the UI says so honestly. */

const cache = new Map<string, string | null>();

export function trackParts(mediaTitle: string): { title: string; artist: string } {
  // Titles look like "Artist - Song" or just "Song"; split on the first " - ".
  const t = String(mediaTitle || '').trim();
  const i = t.indexOf(' - ');
  if (i > 0) return { artist: t.slice(0, i).trim(), title: t.slice(i + 3).trim() };
  return { artist: '', title: t };
}

/** First result that actually carries synced LRC; null when none do. */
export function pickSynced(results: unknown): string | null {
  if (!Array.isArray(results)) return null;
  for (const r of results as Array<Record<string, unknown>>) {
    const s = r && typeof r.syncedLyrics === 'string' ? r.syncedLyrics : '';
    if (s.includes('[')) return s;
  }
  return null;
}

export async function fetchLyrics(mediaTitle: string): Promise<string | null> {
  const { title, artist } = trackParts(mediaTitle);
  if (!title) return null;
  const key = `${artist}::${title}`.toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;
  const base = 'https://lrclib.net/api';
  let lrc: string | null = null;
  try {
    if (artist) {
      const r = await net.fetch(
        `${base}/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`
      );
      if (r.ok) {
        const j = (await r.json()) as Record<string, unknown>;
        if (typeof j.syncedLyrics === 'string' && j.syncedLyrics.includes('[')) lrc = j.syncedLyrics;
      }
    }
    if (!lrc) {
      const q = artist ? `${artist} ${title}` : title;
      const r = await net.fetch(`${base}/search?q=${encodeURIComponent(q)}`);
      if (r.ok) lrc = pickSynced(await r.json());
    }
  } catch {
    lrc = null;
  }
  cache.set(key, lrc);
  return lrc;
}
