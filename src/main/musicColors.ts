import { net, nativeImage } from 'electron';
import { trackParts } from './lyrics';

/* Album colour for the music card. Windows exposes no media session, so the
   cover art is looked up from the public iTunes Search API (no key, no auth),
   decoded in the main process with nativeImage (the CSP forbids remote <img>),
   and only three hex colours cross into the renderer. Every failure path is a
   quiet null: the card then keeps its deterministic g0..g5 fallback. */

export type TrackColors = { c1: string; c2: string; c3: string };
export type Palette = TrackColors | null;
export type Hsl = { h: number; s: number; l: number };

/** 8 s ceiling for the whole lookup, artwork download included. */
const TIMEOUT_MS = 8000;
/** A small bounded cache: one entry per track title, null results included. */
const MAX_CACHE = 96;
const cache = new Map<string, Palette>();

export function cacheKey(mediaTitle: string): string {
  const { title, artist } = trackParts(mediaTitle);
  return `${artist}::${title}`.toLowerCase();
}

export function colorCacheSize(): number {
  return cache.size;
}

export function cachedTrackColors(key: string): Palette | undefined {
  return cache.get(key);
}

export function clearColorCache(): void {
  cache.clear();
}

function remember(key: string, value: Palette): Palette {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, value);
  return value;
}

/** 5 bit per channel bucket key: coarse enough that anti aliasing and JPEG
    noise land together, fine enough to keep distinct album colours apart. */
export function quantizeKey(r: number, g: number, b: number): string {
  const q = (v: number) => Math.min(31, Math.max(0, Math.floor(v / 8)));
  return `${q(r)},${q(g)},${q(b)}`;
}

const hex2 = (v: number): string => Math.round(Math.min(255, Math.max(0, v)))
  .toString(16).padStart(2, '0');

const toHex = (r: number, g: number, b: number): string => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

const parseHex = (value: string): { r: number; g: number; b: number } | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(value || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

/** Pure HSL conversions, exported so the deep-palette rule can be tested
    without an artwork download. h is degrees 0..360, s and l are 0..1. */
export function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255; const gn = g / 255; const bn = b / 255;
  const max = Math.max(rn, gn, bn); const min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hh = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return {
    r: Math.round(channel(hh + 1 / 3) * 255),
    g: Math.round(channel(hh) * 255),
    b: Math.round(channel(hh - 1 / 3) * 255),
  };
}

export function hslToHex(h: number, s: number, l: number): string {
  const { r, g, b } = hslToRgb(h, s, l);
  return toHex(r, g, b);
}

/** A raw cover palette is often near grey (dark photos, monochrome art) or
    near white. Painted as-is it makes the card look like an ordinary dark
    panel. Keep each hue, force a visible saturation and a low lightness: the
    result is dark ENOUGH for AA text but coloured ENOUGH to read as the album.
    A fully achromatic palette has no hue to preserve, so it gets the three
    reference hues (orange, magenta, violet) instead of three identical reds. */
export function toDeepPalette(colors: Palette): Palette {
  if (!colors) return null;
  const entries = [colors.c1, colors.c2, colors.c3].map(parseHex);
  if (entries.some((e) => e === null)) return null;
  const hsl = entries.map((e) => rgbToHsl(e!.r, e!.g, e!.b));
  const achromatic = hsl.every((c) => c.s < 0.08);
  const referenceHues = [18, 305, 255];
  const deep = hsl.map((c, i) => {
    const hue = achromatic ? referenceHues[i] : c.h;
    /* 0.55 is the floor the spec asks for; 0.70 leaves enough colour after the
       card gradients mix it into the dark base (measured chroma >= 55). */
    const sat = Math.min(1, Math.max(0.70, c.s));
    const light = Math.min(0.32, Math.max(0.22, c.l));
    return hslToHex(hue, sat, light);
  });
  return { c1: deep[0], c2: deep[1], c3: deep[2] };
}

/** Three dominant, mutually distinct colours from a raw BGRA bitmap.
    Exported as a pure helper so the regression suite can feed it a synthetic
    image instead of relying on the network. Near black and near white pixels
    are dropped: they are covers' borders and lettering, not the palette. */
export function dominantColors(bgra: Uint8Array | Buffer, width: number,
  height: number): TrackColors | null {
  if (!bgra || bgra.length < 4 || !Number.isFinite(width) || !Number.isFinite(height)
    || width <= 0 || height <= 0) return null;
  const pixels = Math.floor(width * height);
  if (pixels <= 0 || bgra.length < pixels * 4) return null;
  const step = Math.max(1, Math.floor(pixels / 9000));
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (let p = 0; p < pixels; p += step) {
    const i = p * 4;
    if (i + 3 >= bgra.length) break;
    const b = bgra[i];
    const g = bgra[i + 1];
    const r = bgra[i + 2];
    const a = bgra[i + 3];
    if (a < 128) continue;
    const brightest = Math.max(r, g, b);
    const darkest = Math.min(r, g, b);
    if (brightest < 30 || darkest > 235) continue;
    const key = quantizeKey(r, g, b);
    const row = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    row.n += 1;
    row.r += r;
    row.g += g;
    row.b += b;
    buckets.set(key, row);
  }
  const ranked = [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .map((row) => ({ r: row.r / row.n, g: row.g / row.n, b: row.b / row.n }));
  const chosen: Array<{ r: number; g: number; b: number }> = [];
  const far = (a: { r: number; g: number; b: number },
    b: { r: number; g: number; b: number }): boolean => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b) >= 48;
  for (const row of ranked) {
    if (chosen.every((c) => far(c, row))) chosen.push(row);
    if (chosen.length === 3) break;
  }
  if (chosen.length < 3) return null;
  return {
    c1: toHex(chosen[0].r, chosen[0].g, chosen[0].b),
    c2: toHex(chosen[1].r, chosen[1].g, chosen[1].b),
    c3: toHex(chosen[2].r, chosen[2].g, chosen[2].b),
  };
}

/** iTunes returns a 100 px thumbnail; ask the CDN for a 300 px one instead. */
export function upgradeArtwork(url: string): string {
  return String(url || '').replace(/\/100x100bb\.(jpg|png)/i, '/300x300bb.$1');
}

/** Prefer the result whose trackName matches the song, else the first one with
    artwork. Exported so the selection rule is testable without a request. */
export function pickArtworkUrl(results: unknown, title: string): string | null {
  if (!results || typeof results !== 'object') return null;
  const rows = (results as { results?: unknown }).results;
  if (!Array.isArray(rows)) return null;
  const wanted = String(title || '').toLowerCase().trim();
  let first: string | null = null;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const url = typeof item.artworkUrl100 === 'string' ? item.artworkUrl100 : '';
    if (!url) continue;
    if (first === null) first = url;
    const name = typeof item.trackName === 'string' ? item.trackName.toLowerCase().trim() : '';
    if (wanted.length >= 3 && name.length >= 3
      && (name.includes(wanted) || wanted.includes(name))) return url;
  }
  return first;
}

async function fetchBytes(url: string, signal: AbortSignal): Promise<Buffer | null> {
  const response = await net.fetch(url, { signal });
  if (!response.ok) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.length > 0 ? buffer : null;
}

async function lookup(mediaTitle: string, signal: AbortSignal): Promise<Palette> {
  const { title, artist } = trackParts(mediaTitle);
  if (!title) return null;
  const term = artist ? `${artist} ${title}` : title;
  const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}`
    + '&entity=song&limit=6';
  const search = await net.fetch(searchUrl, { signal });
  if (!search.ok) return null;
  const found = pickArtworkUrl(await search.json(), title);
  if (!found) return null;
  const bytes = await fetchBytes(upgradeArtwork(found), signal);
  if (!bytes) return null;
  const image = nativeImage.createFromBuffer(bytes);
  const size = image.getSize();
  if (!size.width || !size.height) return null;
  return dominantColors(image.toBitmap(), size.width, size.height);
}

/** Never throws, never logs: an unavailable API, an offline machine, a bad
    JPEG or a flat cover all resolve to null and the UI falls back cleanly. */
export async function fetchTrackColors(mediaTitle: string): Promise<Palette> {
  const key = cacheKey(mediaTitle);
  if (cache.has(key)) return cache.get(key) ?? null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let palette: Palette = null;
  try {
    palette = await lookup(mediaTitle, controller.signal);
  } catch {
    palette = null;
  } finally {
    clearTimeout(timer);
  }
  return remember(key, palette);
}
