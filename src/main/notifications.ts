/* Real Windows toast capture.

   Windows keeps every delivered toast in
   %LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db, and Node's
   built-in SQLite reader can open it read-only from a normal (non packaged)
   process. That is the only way to see other apps' notifications without
   registering a UWP notification listener or asking for package identity.

   Two details cost real time and are load-bearing here:
     1. Id / ArrivalTime / HandlerId are 64-bit integers. node:sqlite refuses to
        hand back a value that does not fit a JS number, so every one of them is
        CAST to TEXT in the query and compared as BigInt.
     2. Payload is not a string. It is a byte array of UTF-8 XML, and depending
        on the driver it arrives as a Buffer, a Uint8Array or the literal text
        "60,116,111,97,115,116,...". decodePayload handles all three.

   The first poll only records the current high-water mark: replaying a week of
   history into the island on every launch would be worse than silence. */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
let DatabaseSync: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch {
  // Electron without node:sqlite: the watcher simply stays inert and the rest
  // of the island keeps working. Never throw from a background poller.
  DatabaseSync = null;
}

export function sqliteAvailable(): boolean {
  return Boolean(DatabaseSync);
}

export function toastDbPath(): string {
  const base = process.env.LOCALAPPDATA || '';
  return join(base, 'Microsoft', 'Windows', 'Notifications', 'wpndatabase.db');
}

/** Byte array / Buffer / Uint8Array / CSV-of-bytes / raw XML -> XML string. */
export function decodePayload(payload: unknown): string {
  try {
    if (payload === null || payload === undefined) return '';
    if (typeof payload === 'string') {
      const t = payload.trim();
      if (!t) return '';
      if (t.startsWith('<')) return t;
      if (/^\d+(\s*,\s*\d+)*$/.test(t)) {
        return Buffer.from(t.split(',').map((n) => Number(n.trim()))).toString('utf8');
      }
      return t;
    }
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(payload)) {
      return payload.toString('utf8');
    }
    if (payload instanceof Uint8Array) {
      return Buffer.from(payload).toString('utf8');
    }
    if (Array.isArray(payload)) {
      return Buffer.from(payload as number[]).toString('utf8');
    }
    if (typeof payload === 'object') {
      // node:sqlite may hand back { type: 'Buffer', data: [...] } after a JSON
      // round trip; accept that shape too.
      const data = (payload as { data?: unknown }).data;
      if (Array.isArray(data)) return Buffer.from(data as number[]).toString('utf8');
    }
  } catch {
    return '';
  }
  return '';
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

function unescapeXml(value: string): string {
  return value.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, code: string) => {
    if (code.startsWith('#')) {
      const hex = code[1] === 'x' || code[1] === 'X';
      const n = hex ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export type ToastText = { title: string; body: string };

/** Title = first <text>, body = second. Badge-only toasts have neither.
    Order matters: tags are stripped from the RAW text first, then entities are
    unescaped. Doing it the other way round turned an escaped "&lt;aktif&gt;"
    into a real "<aktif>" and the next pass deleted it as a tag, silently
    truncating the message. */
export function parseToast(xml: string): ToastText | null {
  const src = String(xml || '');
  if (!src) return null;
  const parts: string[] = [];
  const re = /<text\b[^>]*>([\s\S]*?)<\/text>/gi;
  let m: RegExpExecArray | null = re.exec(src);
  while (m) {
    const value = unescapeXml(stripTags(m[1]));
    if (value) parts.push(value);
    m = re.exec(src);
  }
  const title = parts[0] ?? '';
  const body = parts[1] ?? '';
  if (!title && !body) return null;
  return { title: title.slice(0, 140), body: body.slice(0, 220) };
}

/* AUMIDs are long and unreadable ("5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App").
   Only the ones that actually show up in day-to-day use are named; anything
   else falls back to the last dotted segment, which is at least a word. */
const APP_NAMES: [RegExp, string][] = [
  [/whatsapp/i, 'WhatsApp'],
  [/workbuddy/i, 'WorkBuddy'],
  [/discord/i, 'Discord'],
  [/telegram/i, 'Telegram'],
  [/\bslack\b/i, 'Slack'],
  [/spotify/i, 'Spotify'],
  [/zunemusic|mediaplayer|media player/i, 'Media'],
  [/outlook/i, 'Outlook'],
  [/msteams|\.teams\b|teams/i, 'Teams'],
  [/zoom/i, 'Zoom'],
  [/microsoft\.windowsstore|windowsstore/i, 'Store'],
  [/aad\.brokerplugin|cloudexperiencehost|windows\.shell|shellexperience/i, 'Windows'],
  [/msedge/i, 'Edge'],
  [/chrome/i, 'Chrome'],
  [/firefox/i, 'Firefox'],
  [/steam/i, 'Steam'],
  [/nvapp|nvidia/i, 'NVIDIA'],
];

export function friendlyApp(aumid: string): string {
  const a = String(aumid || '');
  if (!a) return 'Notifikasi';
  for (const [re, name] of APP_NAMES) {
    if (re.test(a)) return name;
  }
  const base = a.split('!')[0].split('_')[0];
  const tail = base.split('.').filter(Boolean).pop() || '';
  return tail || 'Notifikasi';
}

/** Windows FILETIME (100 ns ticks since 1601) -> epoch ms. */
export function filetimeToMs(value: number | bigint | string): number {
  const n = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n / 10000 - 11644473600000);
}

type Row = { id: string; aumid: string | null; at: string | null; payload: unknown };

/* Opened and closed per poll on purpose: the notification service rotates and
   rewrites this file, and a long-lived handle ends up reading a stale snapshot
   or holding a lock the service wants back. */
function readRows(limit: number): Row[] {
  if (!DatabaseSync) return [];
  const path = toastDbPath();
  if (!path || !existsSync(path)) return [];
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const stmt = db.prepare(
      `SELECT CAST(n.Id AS TEXT) AS id,
              h.PrimaryId AS aumid,
              CAST(n.ArrivalTime AS TEXT) AS at,
              n.Payload AS payload
         FROM Notification n
         JOIN NotificationHandler h ON h.RecordId = n.HandlerId
        ORDER BY n.Id DESC
        LIMIT ?`
    );
    return stmt.all(limit) as Row[];
  } finally {
    try { db.close(); } catch { /* already closed */ }
  }
}

export type NoticeSink = (app: string, title: string, body: string, aumid?: string) => void;

let lastId: bigint | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/** One pass. `since` seeds the high-water mark for the first call, which is how
    the probe (and a manual check) can replay what is already in the database
    instead of waiting for a new toast. Production never passes it. */
export function pollToasts(sink: NoticeSink, since?: bigint): number {
  let rows: Row[] = [];
  try {
    rows = readRows(25);
  } catch {
    // Locked / mid-rewrite / schema drift: skip this tick, keep the timer.
    return 0;
  }
  if (lastId === null) {
    if (since !== undefined) {
      lastId = since;
    } else {
      let max = 0n;
      for (const r of rows) {
        try {
          const id = BigInt(r.id);
          if (id > max) max = id;
        } catch { /* unparsable id */ }
      }
      lastId = max;
      return 0;
    }
  }
  const fresh: { id: bigint; row: Row }[] = [];
  for (const r of rows) {
    try {
      const id = BigInt(r.id);
      if (id > lastId) fresh.push({ id, row: r });
    } catch { /* unparsable id */ }
  }
  if (fresh.length === 0) return 0;
  fresh.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let emitted = 0;
  for (const { id, row } of fresh) {
    if (id > lastId) lastId = id;
    const aumid = String(row.aumid ?? '');
    // Never echo the island's own notices back into itself.
    if (/aeolia/i.test(aumid)) continue;
    const parsed = parseToast(decodePayload(row.payload));
    if (!parsed) continue;
    sink(friendlyApp(aumid), parsed.title, parsed.body, aumid);
    emitted += 1;
  }
  return emitted;
}

export function startNotificationWatch(sink: NoticeSink, intervalMs = 3000): void {
  if (!sqliteAvailable() || timer) return;
  pollToasts(sink); // high-water mark only, no replay
  timer = setInterval(() => { pollToasts(sink); }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
}

export function stopNotificationWatch(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
