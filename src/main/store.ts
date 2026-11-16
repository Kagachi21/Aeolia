import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type Site = { id: string; name: string; url: string };
export type ShelfItem = { id: string; name: string; path: string; size: number; at: number };
export type ClipItem = { id: string; kind: 'text' | 'image' | 'file'; text: string; at: number };
export type Notice = { id: string; app: string; title: string; body: string; at: number; aumid?: string };
export type Task = { id: string; name: string; done: boolean };

export type Store = {
  lastTab: string;
  sites: Site[];
  shelf: ShelfItem[];
  clips: ClipItem[];
  notices: Notice[];
  tasks: Task[];
  waterMl: number;
  waterGoalMl: number;
  waterStartHour: number;
  waterEndHour: number;
  waterEveryMin: number;
  waterEnabled: boolean;
  waterSound: boolean;
  waterDay: string;
  eyeBreakMin: number;
  eyeBreakSound: boolean;
  prayerCity: string;
  /** One-shot startup cat greeting. Persisted so it plays once per install,
      not once per launch. See the migration in load(). */
  greetingSeen: boolean;
};

const DEFAULTS: Store = {
  lastTab: 'web',
  sites: [
    { id: 'ytmusic', name: 'YT Music', url: 'https://music.youtube.com' },
    { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com' },
    { id: 'spotify', name: 'Spotify', url: 'https://open.spotify.com' },
  ],
  shelf: [],
  clips: [],
  notices: [],
  tasks: [],
  waterMl: 0,
  waterGoalMl: 2000,
  waterStartHour: 8,
  waterEndHour: 22,
  waterEveryMin: 60,
  waterEnabled: false,
  waterSound: true,
  waterDay: '',
  eyeBreakMin: 0,
  eyeBreakSound: true,
  prayerCity: 'Jakarta',
  greetingSeen: false,
};

let store: Store | null = null;
let file = '';
const MAX_CLIPS = 24;
const MAX_NOTICES = 24;
const MAX_SHELF = 24;

function storePath(): string {
  if (!file) file = join(app.getPath('userData'), 'state.json');
  return file;
}

export function load(): Store {
  if (store) return store;
  try {
    if (existsSync(storePath())) {
      const raw = JSON.parse(readFileSync(storePath(), 'utf8')) as Partial<Store>;
      store = {
        ...DEFAULTS,
        ...raw,
        sites: raw.sites ?? DEFAULTS.sites,
        shelf: raw.shelf ?? [],
        clips: raw.clips ?? [],
        notices: raw.notices ?? [],
        tasks: raw.tasks ?? [],
        waterMl: typeof raw.waterMl === 'number' ? raw.waterMl : 0,
        eyeBreakMin: typeof raw.eyeBreakMin === 'number' ? raw.eyeBreakMin : 0,
        waterGoalMl: typeof raw.waterGoalMl === 'number' ? Math.min(5000, Math.max(500, raw.waterGoalMl)) : 2000,
        waterStartHour: typeof raw.waterStartHour === 'number' ? Math.min(23, Math.max(0, raw.waterStartHour)) : 8,
        waterEndHour: typeof raw.waterEndHour === 'number' ? Math.min(23, Math.max(0, raw.waterEndHour)) : 22,
        waterEveryMin: typeof raw.waterEveryMin === 'number' ? Math.min(180, Math.max(15, raw.waterEveryMin)) : 60,
        waterEnabled: Boolean(raw.waterEnabled),
        waterSound: raw.waterSound !== false,
        waterDay: typeof raw.waterDay === 'string' ? raw.waterDay : '',
        eyeBreakSound: raw.eyeBreakSound !== false,
        prayerCity: typeof raw.prayerCity === 'string' ? raw.prayerCity : 'Jakarta',
        // Migration: an existing state.json predates the first-run flag. The
        // user still owes himself that first greeting, so an upgrading install
        // gets exactly one after the next restart. A genuinely new install has
        // NO state.json at all and keeps DEFAULTS.greetingSeen=false as well.
        // Once the renderer has played it, patch() writes true and later
        // launches stay quiet.
        greetingSeen: typeof raw.greetingSeen === 'boolean' ? raw.greetingSeen : false,
      };
      if (typeof raw.greetingSeen !== 'boolean') persist();
      return store;
    }
  } catch (err) {
    console.warn('[store] unreadable, resetting:', err);
  }
  store = { ...DEFAULTS, sites: [...DEFAULTS.sites] };
  persist();
  return store;
}

function persist(): void {
  if (!store) return;
  try {
    mkdirSync(dirname(storePath()), { recursive: true });
    writeFileSync(storePath(), JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.warn('[store] write failed:', err);
  }
}

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function setLastTab(tab: string): Store {
  const s = load();
  s.lastTab = tab;
  persist();
  return s;
}

export function addSite(name: string, url: string): Store {
  const s = load();
  const clean = url.trim();
  if (!clean) return s;
  s.sites.push({ id: uid(), name: name.trim() || clean.replace(/^https?:\/\//, ''), url: clean });
  persist();
  return s;
}

export function addShelf(items: { name: string; path: string; size: number }[]): Store {
  const s = load();
  for (const item of items) {
    s.shelf.unshift({ id: uid(), ...item, at: Date.now() });
  }
  s.shelf = s.shelf.slice(0, MAX_SHELF);
  persist();
  return s;
}

export function addClip(text: string): Store | null {
  const s = load();
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (s.clips[0]?.text === trimmed) return null;
  s.clips.unshift({ id: uid(), kind: 'text', text: trimmed.slice(0, 2000), at: Date.now() });
  s.clips = s.clips.slice(0, MAX_CLIPS);
  persist();
  return s;
}

export function pushNotice(appName: string, title: string, body: string, aumid?: string): Store {
  const s = load();
  s.notices.unshift({ id: uid(), app: appName, title, body, at: Date.now(), aumid });
  s.notices = s.notices.slice(0, MAX_NOTICES);
  persist();
  return s;
}

export function clearNotices(): Store {
  const s = load();
  s.notices = [];
  persist();
  return s;
}

export function patch(partial: Partial<Store>): Store {
  const s = load();
  Object.assign(s, partial);
  persist();
  return s;
}

export function clearClips(): Store {
  const s = load();
  s.clips = [];
  persist();
  return s;
}
