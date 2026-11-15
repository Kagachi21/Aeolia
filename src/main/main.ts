import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, powerMonitor, screen, shell } from 'electron';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { getActiveWindow, isBusyProcess } from './activeWindow';
import { activeDisplay, boundsFor, effectiveScalePct, type IslandState } from './bounds';
import { Island } from './island';
import { dropThickFrame } from './thinFrame';
import { loadSettings, setValue } from './settings';
import { readMedia } from './media';
import { readPower } from './power';
import { mediaNext, mediaPlayPause, mediaPrev } from './keys';
import { sendShortcut } from './keys';
import { fetchLyrics } from './lyrics';
import { getMicMuted, toggleMicMute } from './micMute';
import { camDecision } from './camToggle';
import { brightnessRange, pasteShortcut, setBrightness, toggleMute, volumeStep } from './systemControl';
import { cleanRam, cpuPercent, memoryInfo } from './ramClean';
import { registerCapture, disposeCapture } from './capture';
import { dismissResumeOffer, disposeExtras, getExtras, isMeeting, openPath,
  pickFile, pickFolder, registerExtras } from './extras';
import { addClip, addShelf, addSite, clearClips, clearNotices, load, patch, pushNotice, setLastTab, type Store } from './store';

/*
 * Portable mode: when a data folder sits next to the executable, all state
 * (settings, store, locks) lives in <exe>/data instead of %APPDATA%. The
 * portable build ships without a data folder, so it stays read-only on first run.
 */
function resolvePortableData(): void {
  const exeDir = dirname(app.getPath('exe'));
  const dataDir = join(exeDir, 'data');
  if (existsSync(dataDir)) app.setPath('userData', join(dataDir, 'aeolia'));
}

resolvePortableData();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => app.focus());
}

const settings = loadSettings();

let win: BrowserWindow | null = null;
let island: Island | null = null;
let poller: NodeJS.Timeout | null = null;
let hoverTimer: NodeJS.Timeout | null = null;
let leaveTimer: NodeJS.Timeout | null = null;
let hoverPoll: NodeJS.Timeout | null = null;
let zoneInside = false;
let busyForDelay = false;
let clickThrough = false;
let activeIsWord = false;
let mediaPlaying = false;
let mediaTitle = '';
let mediaTimer: NodeJS.Timeout | null = null;
let clipTimer: NodeJS.Timeout | null = null;
let robotTimer: NodeJS.Timeout | null = null;
let settingsWin: BrowserWindow | null = null;
let cpuSample: NodeJS.Timeout | null = null;
let lastClip: string | null = null;

/* Idle is sampled every 200 ms. Requiring a sustained run of identical samples
   keeps getSystemIdleTime() wobble around the threshold from sliding the cat
   between the centre and its rail. A change now needs seconds, not one tick. */
const ROBOT_TICK_MS = 200;
const IDLE_STABLE_TICKS = 15;
const ACTIVE_STABLE_TICKS = 8;
let idleStable = false;
let idleCandidate = false;
let idleRun = 0;
let lastRobotSig = '';

function createWindow(): void {
  win = new BrowserWindow({
    ...boundsFor('pill', settings),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    // WS_THICKFRAME is what makes Windows clamp a window to SM_CYMINTRACK
    // (39 px). Removing it is the only way to get a 14 px tall window.
    thickFrame: false,
    useContentSize: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  win.setMinimumSize(1, 1);
  win.setMaximumSize(4000, 4000);
  dropThickFrame(win);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(join(__dirname, '../renderer/index.html'));
  win.once('ready-to-show', () => win?.showInactive());

  island = new Island(win, settings, (state) => {
    pushStatus();
    syncClickThrough(state);
  });
  island.place();
  syncClickThrough(island.current);

  // The first transition happens before the page loads, so the renderer would
  // otherwise stay on its default state until the next change.
  win.webContents.on('did-finish-load', () => {
    pushStatus();
    win?.webContents.send('settings:changed', loadSettings());
  });

  win.on('closed', () => {
    island?.dispose();
    island = null;
    win = null;
  });
}

/*
 * Verification seam: ISLAND_FORCE_STATE=mini|pill|open pins the state so the
 * window bounds can be measured without taking over the desktop. It is never
 * read unless the variable is set.
 */
const forcedState = process.env.ISLAND_FORCE_STATE;

/*
 * Windows will not shrink this window below 39 px tall, so the mini notch is
 * drawn in the top 14 px and everything under it is made click-through. That
 * keeps the browser tab strip usable even though the window is taller.
 */
function openSettingsWindow(): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 720,
    height: 500,
    frame: false,
    resizable: false,
    maximizable: false,
    backgroundColor: '#2b1e1a',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  settingsWin.loadFile(join(__dirname, '../settings/settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin?.show());
  settingsWin.on('closed', () => { settingsWin = null; });
}

function registerHotkeys(): void {
  const s = loadSettings();
  globalShortcut.unregisterAll();
  const bind = (accel: string, fn: () => void) => {
    if (!accel) return;
    try { globalShortcut.register(accel, fn); }
    catch (err) { console.warn('[hotkey] rejected', accel, err); }
  };
  bind(s.hotkeyOpen, () => {
    if (!island) return;
    cancelLeave();
    if (island.current === 'open') island.close(); else island.open();
  });
  bind(s.hotkeyPlayPause, () => mediaPlayPause());
  // "off" leaves Ctrl+Shift+S to whatever else owns it on the machine.
  if (s.captureShortcut !== 'off') {
    bind('Ctrl+Shift+S', () => win?.webContents.send('capture:hotkey', 'area'));
  }
}

function applySettings(): void {
  const s = loadSettings();
  app.setLoginItemSettings({ openAtLogin: Boolean(s.runAtStartup) });
  if (poller) clearInterval(poller);
  poller = setInterval(pollActiveWindow, s.pollIntervalMs);
  island?.reposition();
  syncMicPill();
  syncClickThrough(island?.current ?? 'pill');
  registerHotkeys();
  syncRobotTimer();
  pushStatus();
  win?.webContents.send('settings:changed', loadSettings());
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('settings:changed', loadSettings());
  }
}

function broadcast(): void {
  win?.webContents.send('state:changed', load());
}

function pushStatus(): void {
  const s = loadSettings();
  win?.webContents.send('island:update', {
    state: island?.current ?? 'pill',
    word: activeIsWord,
    media: mediaPlaying,
    mediaTitle,
    accent: s.accent,
    surface: s.surface,
    glassLevel: s.glassLevel,
    cardWidth: s.cardWidth,
    islandStyle: s.islandStyle,
    islandPosition: s.islandPosition,
    visibleTabs: s.visibleTabs,
    hiddenUntilHover: s.hiddenUntilHover,
    openAction: mediaPlaying ? 'music' : s.openAction,
    meeting: isMeeting(),
    meetingApp: getExtras().meetingApp,
    miniMode: s.miniMode,
    meetingMicButton: s.meetingMicButton,
    islandScale: s.islandScale,
    scaleEffective: effectiveScalePct(s),
    pillLyrics: s.pillLyrics,
    visualizer: s.visualizer,
    musicCardBackground: s.musicCardBackground,
    musicCardProgress: s.musicCardProgress,
    noticeOpenLinks: s.noticeOpenLinks,
  });
}

function pollMedia(): void {
  const next = readMedia();
  if (next.playing !== mediaPlaying || next.title !== mediaTitle) {
    const titleChanged = next.title !== mediaTitle;
    mediaPlaying = next.playing;
    mediaTitle = next.title;
    island?.setMedia(mediaPlaying);
    pushStatus();
    // A brand-new playing track pulls its synced lyrics once and pushes them.
    if (mediaPlaying && titleChanged && mediaTitle) {
      void fetchLyrics(mediaTitle).then((lrc) => {
        win?.webContents.send('lyrics:auto-loaded', { title: mediaTitle, lrc });
      });
    }
  }
}

/* One interval drives every robot behaviour that needs machine state: idle
   time, battery level and pointer direction. It only runs while at least one
   of those settings is active, so the idle cost stays at zero by default. */
function pollRobot(): void {
  const s = loadSettings();
  let rawIdle = idleStable;
  try {
    rawIdle = powerMonitor.getSystemIdleTime() * 1000 >= s.robotIdleAfterMs;
  } catch {
    rawIdle = idleStable;
  }
  if (rawIdle !== idleCandidate) {
    idleCandidate = rawIdle;
    idleRun = 1;
  } else {
    idleRun += 1;
  }
  const needed = idleCandidate ? IDLE_STABLE_TICKS : ACTIVE_STABLE_TICKS;
  if (idleCandidate !== idleStable && idleRun >= needed) idleStable = idleCandidate;

  const power = readPower();
  let cursorDx = 0;
  if (s.robotEyeMovement === 'cursor' && win && !win.isDestroyed()) {
    const point = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    const half = Math.max(1, bounds.width / 2);
    const rel = (point.x - (bounds.x + half)) / half;
    cursorDx = Math.max(-2, Math.min(2, Math.round(rel * 2)));
  }
  // Re-sending an unchanged payload 5 times a second made the renderer redo
  // its position math on every tick. Only a real state change crosses IPC.
  const sig = `${idleStable}|${power.percent}|${power.charging}|${cursorDx}`;
  if (sig === lastRobotSig) return;
  lastRobotSig = sig;
  win?.webContents.send('robot:state', {
    idle: idleStable,
    batteryPercent: power.percent,
    charging: power.charging,
    cursorDx,
  });
}

function syncRobotTimer(): void {
  const s = loadSettings();
  const needed =
    s.robotIdleOnly || s.robotBatteryExpressions || s.robotEyeMovement === 'cursor' || s.catIdleCenter;
  if (needed) {
    if (!robotTimer) robotTimer = setInterval(pollRobot, ROBOT_TICK_MS);
    // A settings change can alter how the renderer reads the same sample
    // (robotIdleOnly, battery expressions, eye movement), so republish once
    // even when the sampled numbers themselves did not move.
    lastRobotSig = '';
    pollRobot();
  } else if (robotTimer) {
    clearInterval(robotTimer);
    robotTimer = null;
    // Stopping the poller must not publish a synthetic idle:true. That single
    // message used to yank the cat to the centre without any user action.
    lastRobotSig = '';
  }
}

function setClickThrough(on: boolean): void {
  if (clickThrough === on || !win) return;
  clickThrough = on;
  win.setIgnoreMouseEvents(on, { forward: true });
}

/* The mini notch is drawn in the top 14 px, exactly where browsers put their
   tab strip. Clicks there must reach the window below for as long as the notch
   is showing. Island.onChange is the only source that sees every transition,
   including a card closing back to mini, so it owns this rule exclusively. */
function syncClickThrough(state: IslandState): void {
  setClickThrough(state === 'mini');
}

/** The mic capsule only exists while a meeting is detected and the user kept
    the mic button enabled; Island.setMicPill stores the flag so transitions
    back to the pill state re-apply it. */
function syncMicPill(): void {
  const s = loadSettings();
  island?.setMicPill(Boolean(isMeeting()) && s.meetingAuto && s.meetingMicButton);
}

function pollActiveWindow(): void {
  if (!island) return;

  if (forcedState === 'mini' || forcedState === 'pill' || forcedState === 'open') {
    busyForDelay = false;
    if (forcedState === 'open') island.open();
    else island.setBase(forcedState);
    return;
  }

  const display = activeDisplay(settings);
  const info = getActiveWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
  });

  busyForDelay = isBusyProcess(info.process) || info.fullscreen;

  // "off" keeps the full pill even under a fullscreen app; the trigger decides
  // which window conditions are allowed to shrink it to the 14 px notch.
  const miniOff = settings.miniMode === 'off';
  let shrinks = info.fullscreen;
  if (settings.miniTrigger === 'busy') shrinks = info.fullscreen || busyForDelay;
  else if (settings.miniTrigger === 'maximized') shrinks = info.fullscreen || info.maximized;
  else shrinks = info.fullscreen || (settings.slimStrip && info.maximized);
  // A playing track keeps the full pill awake (the notch hides the controls),
  // but a fullscreen app still wins so the island never covers a video.
  const hide = !miniOff && shrinks && (!mediaPlaying || info.fullscreen);
  const nextBase: 'mini' | 'pill' = hide ? 'mini' : 'pill';
  island.setBase(nextBase);

  const word = info.process === 'winword';
  if (word !== activeIsWord) {
    activeIsWord = word;
    pushStatus();
  }
}

function cancelHover(): void {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
}

function cancelLeave(): void {
  if (leaveTimer) {
    clearTimeout(leaveTimer);
    leaveTimer = null;
  }
}

/**
 * "Mouse rests on the island": every move restarts the wait, so a cursor that
 * is merely passing through never opens the card.
 */
function armHover(): void {
  cancelHover();
  const delay = busyForDelay ? settings.openDelayBusyMs : settings.openDelayMs;
  hoverTimer = setTimeout(() => {
    hoverTimer = null;
    island?.open();
  }, delay);
}

/**
 * Cursor-driven activation zone.
 *
 * The window can only report pointer events that land inside it, so when the
 * island floats edgeMargin px below the screen edge the strip between the two
 * belongs to no window at all and no mouseenter ever fires. This poll mirrors
 * that dead strip onto the main process:
 *
 *   - horizontally: the island plus a small padding either side
 *   - vertically:   from the display's top edge down to the island's top
 *
 * Holding on the island itself also counts, so a cursor resting on the pill is
 * never mistaken for leaving it. Because the zone is measured against the
 * display the island actually lives on (activeDisplay), a secondary monitor
 * whose top edge is not y=0 works too.
 */
function pollHoverZone(): void {
  if (forcedState) return;               // verification seam must stay pinned
  if (!win || win.isDestroyed() || !island) return;
  const b = win.getBounds();
  const display = activeDisplay(settings).bounds;
  const p = screen.getCursorScreenPoint();
  const pad = 6;
  const withinX = p.x >= b.x - pad && p.x <= b.x + b.width + pad;
  const overWindow = p.y >= b.y && p.y <= b.y + b.height;
  // The gap only exists when the window is pushed below the screen edge.
  const gapTop = Math.min(b.y, display.y);
  const inGap = p.y >= gapTop && p.y < b.y;
  const inside = withinX && (overWindow || inGap);
  // Re-assert the peek on every tick while the cursor rests on the notch: a
  // banner that returns the island to mini must not swallow the expansion.
  if (inside && island.current === 'mini') island.peek();
  if (inside === zoneInside) return;
  zoneInside = inside;
  win.webContents.send('island:hover', inside);
  if (inside) {
    cancelLeave();
    if (settings.hiddenUntilHover) pushStatus();
    // Hovering the small notch first expands it (peek) so the island is
    // reachable again; the hover timer then opens the card as usual.
    if (island.current === 'mini') island.peek();
    armHover();
  } else {
    cancelHover();
    cancelLeave();
    const delay = Math.max(0, Number(settings.hoverIdleResetMs) || 0);
    leaveTimer = setTimeout(() => { leaveTimer = null; island?.close(); }, delay);
  }
}

function handleIslandPointer(kind: string): void {
  // Click-through is owned by syncClickThrough(state) via Island.onChange.
  // Pointer IPC only remains for the reveal effect of hiddenUntilHover.
  if (settings.hiddenUntilHover && kind === 'enter') pushStatus();
}

app.whenReady().then(() => {
  app.setLoginItemSettings({ openAtLogin: Boolean(loadSettings().runAtStartup) });
  createWindow();
  hoverPoll = setInterval(pollHoverZone, 80);
  pollHoverZone();
  pollActiveWindow();
  poller = setInterval(pollActiveWindow, settings.pollIntervalMs);
  cpuPercent();
  cpuSample = setInterval(() => cpuPercent(), 1000);
  registerHotkeys();
  registerExtras({
    changed: () => {
      win?.webContents.send('extras:changed', getExtras());
      syncMicPill();
      pushStatus();
      broadcast();
    },
    notice: (app, title, body) => {
      // Notifications are never held — meeting or not, every notice lands
      // (user spec: "mau sedang meeting atau tidak jangan di hold").
      pushNotice(app, title, body);
      broadcast();
    },
    mediaPlaying: () => mediaPlaying,
    // mediaPlayPause() is a toggle, so only fire it when a change is needed.
    pauseMedia: () => { if (mediaPlaying) mediaPlayPause(); },
  });

  if (process.env.ISLAND_OPEN_SETTINGS === '1') setTimeout(() => openSettingsWindow(), 700);
  pollMedia();
  mediaTimer = setInterval(pollMedia, 2000);
  syncRobotTimer();

  ipcMain.on('card:height', (_e, height: number) => island?.setOpenHeight(height));
  ipcMain.on('banner:show', (_e, active: boolean) => island?.setBanner(Boolean(active)));
  // Clicking the small notch expands the island into the open card.
  ipcMain.handle('island:open', () => island?.open());

  ipcMain.on('settings:window', () => openSettingsWindow());
  ipcMain.handle('settings:get', () => loadSettings());
  // The Settings window shows what Auto resolves to on this machine; it has
  // no nodeIntegration, so the display width comes over IPC instead.
  ipcMain.handle('screen:info', () => {
    const display = activeDisplay(loadSettings());
    return {
      screenWidth: display.bounds.width,
      autoScalePct: effectiveScalePct(loadSettings()),
      islandScale: loadSettings().islandScale,
    };
  });
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => {
    const next = setValue(key, value);
    applySettings();
    return next;
  });
  ipcMain.on('settings:close', () => settingsWin?.close());

  ipcMain.handle('ctl:brightness', () => brightnessRange());
  ipcMain.handle('ctl:brightness-set', (_e, percent: number) => {
    const ok = setBrightness(percent);
    return { ok, current: brightnessRange().current };
  });
  ipcMain.on('ctl:volume', (_e, direction: 'up' | 'down', steps: number) => {
    volumeStep(direction, steps);
  });
  ipcMain.on('ctl:mute', () => toggleMute());
  // Real microphone mute (Core Audio capture endpoint) + per-app camera
  // shortcut for the meeting pill. Null/ok:false are honest failure states.
  ipcMain.handle('mic:mute-state', () => getMicMuted());
  ipcMain.handle('mic:mute-toggle', () => toggleMicMute());
  ipcMain.handle('cam:toggle', () => {
    const app = getExtras().meetingApp || '';
    const focused = getActiveWindow({ x: 0, y: 0, width: 0, height: 0 });
    const decision = camDecision(app, focused.process || '');
    if (decision.send) sendShortcut(decision.send);
    return { ok: Boolean(decision.send), hint: decision.hint ?? '' };
  });
  // Worship reminders pause the current track; the resume offer plays it again.
  // Both are guarded so a stale click can never invert playback.
  ipcMain.on('media:pause', () => { if (mediaPlaying) mediaPlayPause(); });
  ipcMain.on('media:play', () => { if (!mediaPlaying) mediaPlayPause(); });
  ipcMain.on('media:prev', () => mediaPrev());
  ipcMain.on('media:next', () => mediaNext());

  /* Clicking a notification opens the source app. Windows does not expose the
     sender's process for toast text we scrape, so the app name is matched to
     its own deep-link protocol; unknown names just fall back to the plain
     https search so the click is never silently dropped. */
  const NOTICE_PROTOCOLS: Record<string, string> = {
    whatsapp: 'whatsapp://',
    discord: 'discord://',
    telegram: 'tg://',
    zoom: 'zoommtg://',
    teams: 'msteams://',
    gmail: 'https://mail.google.com',
    outlook: 'msoutlook://',
    slack: 'slack://',
  };
  const noticeTarget = (appName: string): string | null =>
    Object.entries(NOTICE_PROTOCOLS).find(([name]) => String(appName || '').toLowerCase().includes(name))?.[1] ?? null;
  ipcMain.on('notice:open', (_e, appName: string, body: string) => {
    const target = noticeTarget(appName);
    if (target) {
      shell.openExternal(target);
      return;
    }
    if (!loadSettings().noticeOpenLinks) return;
    const q = encodeURIComponent(String(body || appName || '').slice(0, 60));
    if (q) shell.openExternal(`https://www.google.com/search?q=${q}`);
  });
  /* Direct reply is impossible from a Windows toast we do not own, so the
     honest flow is: put the typed text on the clipboard and open the chat
     app; the renderer labels it "teks disalin — tempel di chat". */
  ipcMain.handle('notice:reply', (_e, appName: string, _body: string, text: string) => {
    const clean = String(text || '').trim().slice(0, 500);
    const target = noticeTarget(appName);
    if (!clean || !target) return { opened: false };
    clipboard.writeText(clean);
    shell.openExternal(target);
    return { opened: true };
  });

  ipcMain.handle('stats:get', () => {
    const mem = memoryInfo();
    return { cpu: cpuPercent(), ramUsedMb: mem.usedMb, ramTotalMb: mem.totalMb, ramPercent: mem.percent };
  });
  ipcMain.handle('ram:clean', () => {
    const result = cleanRam();
    pushNotice('Memory', 'Memori dirapikan', `${result.freedMb} MB dibebaskan · ${result.trimmed} proses`);
    broadcast();
    return result;
  });

  ipcMain.handle('state:get', () => load());
  ipcMain.on('state:patch', (_e, partial: Partial<Store>) => {
    if (partial && typeof partial === 'object') { patch(partial); broadcast(); }
  });
  ipcMain.on('state:tab', (_e, tab: string) => { setLastTab(tab); broadcast(); });
  ipcMain.on('open:url', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
  ipcMain.on('site:add', (_e, payload: { name: string; url: string }) => {
    addSite(payload.name, payload.url);
    broadcast();
  });
  ipcMain.on('shelf:add', (_e, files: { name: string; path: string; size: number }[]) => {
    if (!Array.isArray(files) || files.length === 0) return;
    addShelf(files);
    pushNotice('Shelf', 'File ditambahkan', files.map((f) => f.name).join(', ').slice(0, 90));
    broadcast();
  });
  ipcMain.on('notices:clear', () => { clearNotices(); broadcast(); });
  ipcMain.on('clips:clear', () => { clearClips(); broadcast(); });
  ipcMain.handle('clip:copy', (_e, text: string) => {
    if (typeof text !== 'string' || !text) return { ok: false };
    clipboard.writeText(text);
    lastClip = text;          // our own write must not become a new history entry
    return { ok: true };
  });
  ipcMain.handle('clip:paste', (_e, text: string) => {
    if (typeof text !== 'string' || !text) return { ok: false };
    clipboard.writeText(text);
    lastClip = text;
    pasteShortcut();
    return { ok: true };
  });
  ipcMain.on('notify:push', (_e, title: string, body: string) => {
    pushNotice('Pengingat', title, body);
    broadcast();
  });
  ipcMain.handle('extras:get', () => getExtras());
  ipcMain.on('extras:dismiss-resume', () => dismissResumeOffer());
  ipcMain.handle('settings:pick-file', () => pickFile());
  ipcMain.handle('settings:pick-folder', () => pickFolder());
  ipcMain.on('settings:open-path', (_e, path: string) => openPath(path));
  registerCapture({
    hide: () => { if (win && !win.isDestroyed()) win.hide(); },
    show: () => { if (win && !win.isDestroyed()) win.showInactive(); },
    protect: (on) => { if (win && !win.isDestroyed()) win.setContentProtection(on); },
  });
  ipcMain.on('settings:open', (_e, uri: string) => {
    if (uri.startsWith('ms-settings:')) shell.openExternal(uri);
  });

  clipTimer = setInterval(async () => {
    const text = await clipboard.readText();
    if (!text || text === lastClip) return;
    lastClip = text;
    // Only the Clipboard panel is updated. Copying text must not also drop a
    // duplicate entry into Notifications.
    if (addClip(text)) broadcast();
  }, 900);

  ipcMain.on('island:pointer', (_event, kind: string) => handleIslandPointer(kind));
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  if (poller) clearInterval(poller);
  if (mediaTimer) clearInterval(mediaTimer);
  if (robotTimer) clearInterval(robotTimer);
  if (clipTimer) clearInterval(clipTimer);
  if (cpuSample) clearInterval(cpuSample);
  globalShortcut.unregisterAll();
  cancelHover();
  cancelLeave();
  if (hoverPoll) clearInterval(hoverPoll);
  disposeCapture();
  disposeExtras();
  island?.dispose();
});
