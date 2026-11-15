/* Background services behind the Meetings / Notifications / Calendar pages.
   Everything here is best-effort: a failed network read or missing folder must
   never stop the island, so each source keeps its own error string. */
import { app, dialog, net, powerMonitor, shell } from 'electron';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { getWindowTitles } from './activeWindow';
import { loadSettings } from './settings';
import { load, pushNotice } from './store';

export type ExtrasState = {
  meeting: boolean;
  meetingApp: string;
  online: boolean;
  weather: { temp: number; rain: boolean; description: string } | null;
  weatherError: string;
  calendarEvents: { at: number; title: string }[];
  calendarError: string;
  lastDownload: string;
  resumeOffer: boolean;
};

/* Apps that ARE a meeting while they run (dedicated conferencing tools). Chat
   apps (WhatsApp, Telegram, Discord, Slack) are excluded on purpose: they run
   all day, so counting them made the island claim a meeting was on when none
   was — Discord chat windows lit meeting mode with no call in sight. */
const MEETING_APPS = /zoom|msteams|teams|skype|webex|google meet|meet\.google|facetime|jitsi|bluejeans/i;
/* A voice/video call in ANY app: window titles announce it. Bare words like
   "meeting" or "rapat" are NOT call words — channel and tab names contain
   them constantly. Only explicit call phrases count. */
const CALL_WORDS = /(voice|video)[ -]?(call|chat)|incoming[ -]?call|outgoing[ -]?call|ringing|in call|panggilan|voice connected|huddle|meet\.google/i;

/** Pure matcher so probes can pin the false-positive behaviour. */
export function matchesCall(label: string): boolean {
  return MEETING_APPS.test(label) || CALL_WORDS.test(label);
}
const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  'Jakarta': { lat: -6.2088, lon: 106.8456 },
  'Bandung': { lat: -6.9175, lon: 107.6191 },
  'Surabaya': { lat: -7.2575, lon: 112.7521 },
  'Yogyakarta': { lat: -7.7956, lon: 110.3695 },
  'Semarang': { lat: -6.9667, lon: 110.4167 },
  'Medan': { lat: 3.5952, lon: 98.6722 },
  'Makassar': { lat: -5.1477, lon: 119.4327 },
  'Denpasar': { lat: -8.65, lon: 115.2167 },
  'Banda Aceh': { lat: 5.5483, lon: 95.3238 },
};

const state: ExtrasState = {
  meeting: false,
  meetingApp: '',
  online: true,
  weather: null,
  weatherError: '',
  calendarEvents: [],
  calendarError: '',
  lastDownload: '',
  resumeOffer: false,
};

let onChange: (() => void) | null = null;
let notify: ((app: string, title: string, body: string) => void) | null = null;
let downloadsWatcher: FSWatcher | null = null;
let wasOffline = false;
let lockedAt = 0;
let wasPlayingBeforeMeeting = false;
let mediaPlaying = () => false;
let pauseMedia: (() => void) | null = null;

function publish(): void { onChange?.(); }

function ignored(appName: string): boolean {
  const list = loadSettings().meetingIgnoreApps;
  return list.some((entry) => appName.toLowerCase().includes(entry.toLowerCase().trim()));
}

/* Meeting detection uses window titles because Windows exposes no reliable
   "microphone in use" flag to a sandboxed app. Camera/mic-only apps can be
   excluded through the ignore list. */
function pollMeeting(): void {
  const s = loadSettings();
  let found = '';
  if (s.meetingAuto) {
    try {
      for (const w of getWindowTitles()) {
        const label = `${w.process} ${w.title}`;
        if (matchesCall(label) && !ignored(w.process) && !ignored(w.title)) {
          found = w.process.replace(/\.exe$/i, '') || w.title.slice(0, 30);
          break;
        }
      }
    } catch { /* enumeration can fail transiently */ }
  }
  const nowMeeting = Boolean(found);
  if (nowMeeting !== state.meeting) {
    if (nowMeeting) {
      wasPlayingBeforeMeeting = mediaPlaying();
      if (wasPlayingBeforeMeeting) pauseMedia?.();
    }
    state.meeting = nowMeeting;
    state.meetingApp = found;
    publish();
  } else {
    state.meetingApp = found;
  }
}

export function isMeeting(): boolean { return state.meeting; }

async function checkOnline(): Promise<void> {
  let online = true;
  try {
    const res = await net.fetch('https://www.google.com/generate_204', { method: 'HEAD' });
    online = res.ok || res.status === 204;
  } catch {
    online = false;
  }
  if (online !== state.online) {
    state.online = online;
    publish();
  }
  if (!online && !wasOffline && loadSettings().notifyInternet) {
    notify?.('Jaringan', 'Internet terputus', 'Koneksi akan dipantau sampai pulih.');
  }
  if (online && wasOffline && loadSettings().notifyInternet) {
    notify?.('Jaringan', 'Internet kembali', 'Koneksi sudah pulih.');
  }
  wasOffline = !online;
}

async function fetchWeather(): Promise<void> {
  const s = loadSettings();
  if (!s.weatherEnabled) {
    if (state.weather || state.weatherError) { state.weather = null; state.weatherError = ''; publish(); }
    return;
  }
  // The city lives in the card state (the Sholat panel owns it), not in
  // Settings. Reusing it keeps weather and prayer times on the same location.
  const preferred = load().prayerCity;
  const city = CITY_COORDS[preferred] ? preferred : 'Jakarta';
  const { lat, lon } = CITY_COORDS[city];
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&forecast_days=1&timezone=auto`;
  try {
    const res = await net.fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as {
      current?: { temperature_2m?: number; weather_code?: number };
    };
    const temp = Math.round(data.current?.temperature_2m ?? 0);
    const code = data.current?.weather_code ?? 0;
    const rain = code >= 51 && code <= 82;
    state.weather = { temp, rain, description: rain ? 'Hujan' : code >= 1 ? 'Berawan' : 'Cerah' };
    state.weatherError = '';
    if (rain && s.weatherRainAlert) {
      notify?.('Cuaca', 'Hujan diperkirakan', `${city}: ${temp}°C. Bawa payung.`);
    }
    publish();
  } catch (err) {
    state.weatherError = err instanceof Error ? err.message : String(err);
    publish();
  }
}

/* Minimal iCalendar reader: unfolds lines and reads DTSTART/DTEND/SUMMARY of
   each VEVENT. Small on purpose; private feeds only need these fields. */
function parseIcs(text: string): { at: number; title: string }[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const events: { at: number; title: string }[] = [];
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0] ?? '';
    const lines = body.split(/\r?\n/);
    let start = '';
    let title = '(Tanpa judul)';
    for (const line of lines) {
      if (line.startsWith('DTSTART')) start = line.split(':').slice(1).join(':').trim();
      else if (line.startsWith('SUMMARY')) title = line.split(':').slice(1).join(':').trim() || title;
    }
    if (!start) continue;
    const at = Date.parse(start.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/, '$1-$2-$3T$4:$5:$6Z'));
    if (Number.isFinite(at)) events.push({ at, title });
  }
  return events.sort((a, b) => a.at - b.at).slice(0, 40);
}

async function fetchCalendar(): Promise<void> {
  const s = loadSettings();
  if (!s.calendarIcalUrl) {
    if (state.calendarEvents.length || state.calendarError) {
      state.calendarEvents = []; state.calendarError = ''; publish();
    }
    return;
  }
  try {
    const res = await net.fetch(s.calendarIcalUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.calendarEvents = parseIcs(await res.text());
    state.calendarError = '';
  } catch (err) {
    state.calendarError = err instanceof Error ? err.message : String(err);
  }
  publish();
}

function watchDownloads(): void {
  if (downloadsWatcher) { downloadsWatcher.close(); downloadsWatcher = null; }
  const dir = join(app.getPath('home'), 'Downloads');
  if (!existsSync(dir)) return;
  try {
    downloadsWatcher = watch(dir, (_event, filename) => {
      if (!filename || /\.crdownload$|\.tmp$/i.test(String(filename))) return;
      if (!loadSettings().notifyDownloads) return;
      const name = String(filename);
      state.lastDownload = name;
      notify?.('Unduhan', 'Berkas selesai', name);
      publish();
    });
  } catch { /* folder may be permission-restricted */ }
}

export function registerExtras(deps: {
  changed(): void;
  notice(app: string, title: string, body: string): void;
  mediaPlaying(): boolean;
  pauseMedia(): void;
}): void {
  onChange = deps.changed;
  notify = deps.notice;
  mediaPlaying = deps.mediaPlaying;
  pauseMedia = deps.pauseMedia;

  powerMonitor.on('lock-screen', () => { lockedAt = Date.now(); });
  powerMonitor.on('suspend', () => { lockedAt = Date.now(); });
  powerMonitor.on('unlock-screen', maybeOfferResume);
  powerMonitor.on('resume', maybeOfferResume);

  setInterval(pollMeeting, 4000);
  setInterval(() => void checkOnline(), 15000);
  setInterval(() => void fetchWeather(), 10 * 60 * 1000);
  setInterval(() => void fetchCalendar(), 10 * 60 * 1000);
  watchDownloads();
  void checkOnline();
  void fetchWeather();
  void fetchCalendar();
  pollMeeting();
}

function maybeOfferResume(): void {
  if (!lockedAt || !loadSettings().notifyResumeMusic) { lockedAt = 0; return; }
  const awayMin = (Date.now() - lockedAt) / 60000;
  lockedAt = 0;
  if (awayMin < 5) return;
  state.resumeOffer = true;
  notify?.('Musik', 'Lanjutkan musik?', `Anda pergi ${Math.round(awayMin)} menit. Putar ulang dari panel Music.`);
  publish();
}

export function dismissResumeOffer(): void {
  state.resumeOffer = false;
  publish();
}

export function getExtras(): ExtrasState { return { ...state }; }

export function pickFile(): Promise<string> {
  return dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] }],
  }).then((r) => (r.canceled || r.filePaths.length === 0 ? '' : r.filePaths[0]));
}

export function pickFolder(): Promise<string> {
  return dialog.showOpenDialog({ properties: ['openDirectory'] })
    .then((r) => (r.canceled || r.filePaths.length === 0 ? '' : r.filePaths[0]));
}

export function openPath(path: string): void {
  if (path) void shell.openPath(path);
}

export function disposeExtras(): void {
  downloadsWatcher?.close();
  downloadsWatcher = null;
}

export function pushServiceNotice(app: string, title: string, body: string): void {
  pushNotice(app, title, body);
}
