import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type Size = { width: number; height: number };

export type Settings = {
  openDelayMs: number;
  openDelayBusyMs: number;
  animationMs: number;
  pollIntervalMs: number;
  hoverIdleResetMs: number;
  mini: Size;
  pill: Size;
  open: Size;

  runAtStartup: boolean;
  slimStrip: boolean;
  openAction: 'last' | 'music';
  cardWidth: number;
  visibleTabs: string[];

  surface: string;
  accent: string;
  /** Solidity of the glass themes (Liquid glass / Translucent), 20-90. */
  glassLevel: number;
  visualizer: 'pixels' | 'bars';
  musicCardBackground: 'album' | 'plain';
  musicCardProgress: string;

  islandPosition: 'left' | 'center' | 'right' | 'left-side' | 'right-side';
  islandStyle: 'dynamic' | 'notched';
  islandContent: 'clock-battery' | 'clock-robot' | 'robot-only';
  /** 'auto' follows the screen width; otherwise a fixed percent step. */
  islandScale: number | 'auto';
  barOrder: string[];
  edgeMargin: number;
  hiddenUntilHover: boolean;
  monitor: 'main' | 'cursor';

  pillLyrics: boolean;

  hotkeyOpen: string;
  hotkeyPlayPause: string;

  robotEyeColor: string;
  robotAccessory: 'none' | 'glasses' | 'hat' | 'headphones';
  robotEyeMovement: 'relaxed' | 'cursor';
  robotIdleOnly: boolean;
  robotIdleAfterMs: number;
  robotBatteryExpressions: boolean;
  robotHoldsItems: boolean;

  catGreeting: boolean;
  catIdleCenter: boolean;
  miniMode: 'off' | 'hide' | 'clock' | 'clock-date' | 'cat';
  miniTrigger: 'fullscreen' | 'busy' | 'maximized';

  lyricsOffsetSec: number;
  lyricsSpeed: number;
  lyricsText: string;

  meetingAuto: boolean;
  meetingMicButton: boolean;
  meetingIgnoreApps: string[];
  noticeOpenLinks: boolean;
  notifyDownloads: boolean;
  notifyInternet: boolean;
  notifyResumeMusic: boolean;

  weatherEnabled: boolean;
  weatherRainAlert: boolean;
  calendarIcalUrl: string;
  calendarCountdown: boolean;

  worshipMode: 'prayer' | 'other' | 'off';
  worshipRemind: boolean;
  worshipCountdown: boolean;
  worshipPauseMusic: boolean;
  worshipImsakIftar: boolean;
  worshipOther: { day: number; time: string; label: string }[];
  adhanEnabled: boolean;
  adhanVolume: number;
  adhanFajr: boolean;
  adhanFile: string;

  captureShortcut: 'default' | 'off';
  captureShowIsland: boolean;
  captureMic: boolean;
  captureClipboard: boolean;
  captureShotDir: string;
  captureVideoDir: string;
};

/** Notch sizes that earlier builds shipped as their default. A settings.json
    still carrying one of them is migrated to DEFAULTS.mini, otherwise changing
    the default would never reach a machine that already saved the old one. */
const LEGACY_MINI: Size[] = [
  { width: 64, height: 14 },
  { width: 150, height: 32 },
  { width: 112, height: 26 },
];

const DEFAULTS: Settings = {
  openDelayMs: 150,
  openDelayBusyMs: 400,
  animationMs: 250,
  pollIntervalMs: 500,
  hoverIdleResetMs: 60,
  mini: { width: 64, height: 14 },
  pill: { width: 150, height: 36 },
  open: { width: 360, height: 92 },

  runAtStartup: false,
  slimStrip: false,
  openAction: 'last',
  cardWidth: 360,
  visibleTabs: [
    'web', 'notifications', 'shelf', 'clipboard', 'music', 'today',
    'controls', 'panels',
  ],

  surface: 'Black',
  accent: '#e9eef7',
  glassLevel: 55,
  visualizer: 'pixels',
  musicCardBackground: 'album',
  musicCardProgress: 'Wave',

  islandPosition: 'center',
  islandStyle: 'dynamic',
  islandContent: 'clock-robot',
  islandScale: 'auto',
  barOrder: ['clock', 'cat', 'battery', 'media', 'mic'],
  edgeMargin: 4,
  hiddenUntilHover: false,
  monitor: 'main',

  pillLyrics: false,

  hotkeyOpen: 'Ctrl+Alt+N',
  hotkeyPlayPause: 'Ctrl+Alt+P',

  robotEyeColor: '',
  robotAccessory: 'none',
  robotEyeMovement: 'relaxed',
  robotIdleOnly: false,
  robotIdleAfterMs: 30000,
  robotBatteryExpressions: true,
  robotHoldsItems: false,

  catGreeting: true,
  catIdleCenter: true,
  miniMode: 'clock',
  miniTrigger: 'fullscreen',

  lyricsOffsetSec: 0,
  lyricsSpeed: 1,
  lyricsText: '',

  meetingAuto: true,
  meetingMicButton: true,
  meetingIgnoreApps: [],
  noticeOpenLinks: true,
  notifyDownloads: false,
  notifyInternet: false,
  notifyResumeMusic: false,

  weatherEnabled: false,
  weatherRainAlert: false,
  calendarIcalUrl: '',
  calendarCountdown: true,

  worshipMode: 'prayer',
  worshipRemind: true,
  worshipCountdown: true,
  worshipPauseMusic: false,
  worshipImsakIftar: false,
  worshipOther: [{ day: 0, time: '08:00', label: 'Sunday service' }],
  adhanEnabled: false,
  adhanVolume: 70,
  adhanFajr: true,
  adhanFile: '',

  captureShortcut: 'default',
  captureShowIsland: false,
  captureMic: false,
  captureClipboard: true,
  captureShotDir: '',
  captureVideoDir: '',
};

export const ROBOT_EYES = ['#46e0dc', '#6ea8ff', '#b48cff', '#ff8fc7', '#e9c46a', '#ff9c6b', '#ffffff'];

export const PROGRESS_STYLES = ['Wave', 'Pixels', 'Comet', 'Song shape', 'Simple', 'Hearts'];
export const GLASS_LEVEL_MIN = 20;
export const GLASS_LEVEL_MAX = 90;
/* Fixed percents written by builds before the slider existed. */
const ISLAND_SCALE_MIGRATE: Record<number, number | 'auto'> = { 85: 90, 120: 115, 140: 130 };

let cached: Settings | null = null;
let cachedPath = '';

/* The card's panel tabs. An empty visibleTabs list is a valid choice: it hides
   every panel tab while the pinned grid and Settings buttons stay reachable. */
const TAB_TOKENS = [
  'web', 'notifications', 'shelf', 'clipboard', 'music', 'today', 'sholat',
  'timer', 'reminders', 'water', 'capture', 'controls', 'deck', 'calls',
];

export function settingsPath(): string {
  if (!cachedPath) cachedPath = join(app.getPath('userData'), 'settings.json');
  return cachedPath;
}

function merge(base: Settings, raw: Partial<Settings>): Settings {
  const merged: Settings = {
    ...base,
    ...raw,
    mini: { ...base.mini, ...(raw.mini ?? {}) },
    pill: { ...base.pill, ...(raw.pill ?? {}) },
    open: { ...base.open, ...(raw.open ?? {}) },
  };

  // Legacy 470/620 px cards were mostly empty space. Clamp saved widths into
  // the compact range; height is measured from the active panel at runtime.
  if (merged.open.width > 520) merged.open.width = base.open.width;
  merged.open.height = base.open.height;
  merged.pill.height = base.pill.height;
  merged.pill.width = Math.min(180, Math.max(110, Number(merged.pill.width) || base.pill.width));
  // Sizes saved by earlier default builds migrate once; genuinely customized
  // sizes are left alone. Every entry here is a notch size that used to be a
  // default, so a settings.json still carrying one of them snaps to the current
  // reference notch instead of pinning the old geometry forever.
  if (raw.mini && LEGACY_MINI.some((s) => s.width === raw.mini!.width && s.height === raw.mini!.height)) {
    merged.mini = { ...base.mini };
  }
  if (raw.pill && raw.pill.width === 138) merged.pill.width = base.pill.width;
  merged.cardWidth = Math.min(520, Math.max(320, Number(merged.cardWidth) || base.cardWidth));
  merged.hoverIdleResetMs = Math.min(600, Math.max(0, Number(merged.hoverIdleResetMs) || 0));
  merged.visibleTabs = Array.isArray(merged.visibleTabs)
    ? [...new Set((merged.visibleTabs as unknown[]).filter(
      (x): x is string => typeof x === 'string' && TAB_TOKENS.includes(x),
    ))]
    : [...base.visibleTabs];
  if (!['none', 'glasses', 'hat', 'headphones'].includes(merged.robotAccessory)) {
    merged.robotAccessory = base.robotAccessory;
  }
  if (!['relaxed', 'cursor'].includes(merged.robotEyeMovement)) {
    merged.robotEyeMovement = base.robotEyeMovement;
  }
  if (merged.robotEyeColor !== '' && !ROBOT_EYES.includes(merged.robotEyeColor)) {
    merged.robotEyeColor = base.robotEyeColor;
  }
  merged.robotIdleAfterMs = Math.min(120000, Math.max(5000, Number(merged.robotIdleAfterMs) || base.robotIdleAfterMs));
  if (typeof merged.robotHoldsItems !== 'boolean') merged.robotHoldsItems = base.robotHoldsItems;
  if (!['dynamic', 'notched'].includes(merged.islandStyle)) merged.islandStyle = base.islandStyle;
  if (!['clock-battery', 'clock-robot', 'robot-only'].includes(merged.islandContent)) merged.islandContent = base.islandContent;
  if (merged.islandScale === 'auto') {
    merged.islandScale = 'auto';
  } else if (ISLAND_SCALE_MIGRATE[Number(merged.islandScale)] !== undefined) {
    // Old whitelist steps map onto the nearest current range; anything else
    // falls through to the clamp below.
    merged.islandScale = ISLAND_SCALE_MIGRATE[Number(merged.islandScale)];
  }
  if (merged.islandScale !== 'auto') {
    // The size slider writes any integer in range; out-of-range numbers clamp.
    const n = Number(merged.islandScale);
    merged.islandScale = Number.isFinite(n) ? Math.min(130, Math.max(75, Math.round(n))) : base.islandScale;
  }
  merged.glassLevel = Math.min(GLASS_LEVEL_MAX, Math.max(GLASS_LEVEL_MIN,
    Math.round(Number(merged.glassLevel) || base.glassLevel)));
  if (!['pixels', 'bars'].includes(merged.visualizer)) merged.visualizer = base.visualizer;
  if (!['album', 'plain'].includes(merged.musicCardBackground)) merged.musicCardBackground = base.musicCardBackground;
  if (!PROGRESS_STYLES.includes(merged.musicCardProgress)) merged.musicCardProgress = base.musicCardProgress;
  merged.pillLyrics = typeof merged.pillLyrics === 'boolean' ? merged.pillLyrics : base.pillLyrics;
  merged.noticeOpenLinks = typeof merged.noticeOpenLinks === 'boolean' ? merged.noticeOpenLinks : base.noticeOpenLinks;
  merged.edgeMargin = Math.min(40, Math.max(0, Math.round(Number(merged.edgeMargin) || 0)));
  if (!['left', 'center', 'right', 'left-side', 'right-side'].includes(merged.islandPosition)) {
    merged.islandPosition = base.islandPosition;
  }

  merged.catGreeting = typeof merged.catGreeting === 'boolean' ? merged.catGreeting : base.catGreeting;
  merged.catIdleCenter = typeof merged.catIdleCenter === 'boolean' ? merged.catIdleCenter : base.catIdleCenter;
  if (!['off', 'hide', 'clock', 'clock-date', 'cat'].includes(merged.miniMode)) merged.miniMode = base.miniMode;
  if (!['fullscreen', 'busy', 'maximized'].includes(merged.miniTrigger)) merged.miniTrigger = base.miniTrigger;
  merged.lyricsOffsetSec = Math.round(Math.min(5, Math.max(-5, Number(merged.lyricsOffsetSec) || 0)) * 10) / 10;
  merged.lyricsSpeed = Math.min(2, Math.max(0.5, Number(merged.lyricsSpeed) || 1));
  merged.lyricsText = typeof merged.lyricsText === 'string' ? merged.lyricsText.slice(0, 20000) : '';
  for (const k of ['meetingAuto', 'meetingMicButton', 'notifyDownloads',
    'notifyInternet', 'notifyResumeMusic', 'weatherEnabled', 'weatherRainAlert',
    'calendarCountdown', 'worshipRemind', 'worshipCountdown', 'worshipPauseMusic',
    'worshipImsakIftar', 'adhanEnabled', 'adhanFajr', 'captureShowIsland',
    'captureMic', 'captureClipboard'] as const) {
    if (typeof merged[k] !== 'boolean') merged[k] = base[k];
  }
  // Settings files written before islandScale existed carried meetingAuto:false
  // from the old inert default, not a real choice; wake it up for those only.
  if (raw.islandScale === undefined && raw.meetingAuto === false) merged.meetingAuto = true;
  if (!Array.isArray(merged.meetingIgnoreApps)) merged.meetingIgnoreApps = [];
  merged.meetingIgnoreApps = merged.meetingIgnoreApps.filter((x) => typeof x === 'string').slice(0, 40);
  const BAR_TOKENS = ['clock', 'cat', 'battery', 'media', 'mic'];
  const rawOrder: unknown[] = Array.isArray(merged.barOrder) ? merged.barOrder : [];
  merged.barOrder = [...new Set(rawOrder.filter(
    (x): x is string => typeof x === 'string' && BAR_TOKENS.includes(x),
  ))];
  for (const t of BAR_TOKENS) if (!merged.barOrder.includes(t)) merged.barOrder.push(t);
  if (!Array.isArray(merged.worshipOther)) merged.worshipOther = base.worshipOther;
  merged.worshipOther = merged.worshipOther.filter(
    (x) => x && typeof x.label === 'string' && typeof x.time === 'string' && Number.isFinite(x.day),
  ).slice(0, 20);
  if (!['prayer', 'other', 'off'].includes(merged.worshipMode)) merged.worshipMode = base.worshipMode;
  if (!['default', 'off'].includes(merged.captureShortcut)) merged.captureShortcut = base.captureShortcut;
  merged.adhanVolume = Math.min(100, Math.max(0, Number(merged.adhanVolume) || 70));
  merged.adhanFile = typeof merged.adhanFile === 'string' ? merged.adhanFile : '';
  merged.calendarIcalUrl = typeof merged.calendarIcalUrl === 'string' ? merged.calendarIcalUrl.slice(0, 500) : '';
  merged.captureShotDir = typeof merged.captureShotDir === 'string' ? merged.captureShotDir : '';
  merged.captureVideoDir = typeof merged.captureVideoDir === 'string' ? merged.captureVideoDir : '';
  return merged;
}

export function loadSettings(): Settings {
  if (cached) return cached;
  const file = settingsPath();
  try {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Settings>;
      cached = merge(DEFAULTS, raw);
      return cached;
    }
  } catch (err) {
    console.warn('[settings] unreadable, using defaults:', err);
  }
  cached = { ...DEFAULTS };
  saveSettings(cached);
  return cached;
}

export function saveSettings(next: Settings): void {
  // Mutated in place so the Island keeps a live reference.
  cached = Object.assign(cached ?? ({} as Settings), next);
  try {
    mkdirSync(dirname(settingsPath()), { recursive: true });
    writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.warn('[settings] could not write:', err);
  }
}

export function current(): Settings {
  return cached ?? loadSettings();
}

export function setValue(key: string, value: unknown): Settings {
  const s = loadSettings();
  if (key === 'visibleTabs') {
    // Runtime writes bypass merge(), so keep the same token whitelist here.
    s.visibleTabs = Array.isArray(value)
      ? [...new Set((value as unknown[]).filter(
        (x): x is string => typeof x === 'string' && TAB_TOKENS.includes(x),
      ))]
      : s.visibleTabs;
  } else {
    (s as unknown as Record<string, unknown>)[key] = value;
  }
  saveSettings(s);
  return s;
}
