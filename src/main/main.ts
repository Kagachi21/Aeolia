import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, powerMonitor, screen, shell } from 'electron';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { BROWSERS, browserShouldShrink, browserTabCount, focusProcessWindow, getActiveWindow, isBusyProcess } from './activeWindow';
import { activeDisplay, boundsFor, effectiveScalePct, micStripRect,
  pointInRect, type IslandState } from './bounds';
import { getActiveCaptureProcesses } from './captureSessions';
import { setDesktopGlass } from './desktopGlass';
import { Island } from './island';
import { dropThickFrame } from './thinFrame';
import { loadSettings, setValue } from './settings';
import { readMedia } from './media';
import { readPower } from './power';
import { mediaNext, mediaPlayPause, mediaPrev } from './keys';
import { sendShortcut } from './keys';
import { fetchLyrics } from './lyrics';
import { fetchTrackColors, toDeepPalette } from './musicColors';
import { getMicMuted, lastMicError, toggleMicMute } from './micMute';
import { cameraAppFor, cameraFocusTarget, camDecision, camResult, focusedAppMatches, type CamToggleResult } from './camToggle';
import { toggleWebcamConsent } from './cameraPrivacy';
import * as noticeLauncher from './noticeLaunch';
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
/* True while the pointer rests on a Mic/Cam capsule. The capsule strip is
   inside the pill window, so the cursor poll would otherwise arm hover-open
   and expand the card before the user's click can reach the button. */
let micHot = false;
let mediaPlaying = false;
/* True while the "hide" media behaviour keeps a shrunken island transparent
   until hover. Published to the renderer through island:update. */
let mediaHidden = false;
/* The renderer owns the 4200 ms notice banner; while it is up the pill must
   keep its width even if the foreground window turns fullscreen, or the
   banner gets clipped into the 14 px notch. */
let bannerActive = false;
/* True between island:drag-start and island:drag-end. Hover-open, the cursor
   zone poll and pointer IPC are all suspended so a drag cannot expand the card
   halfway through the gesture. */
let dragging = false;
let mediaTitle = '';
let mediaTimer: NodeJS.Timeout | null = null;
let clipTimer: NodeJS.Timeout | null = null;
let robotTimer: NodeJS.Timeout | null = null;
let settingsWin: BrowserWindow | null = null;
let cpuSample: NodeJS.Timeout | null = null;
let lastClip: string | null = null;
let captureProtectionOverride = false;

/* Idle is sampled every 200 ms. Requiring a sustained run of identical samples
   keeps getSystemIdleTime() wobble around the threshold from sliding the cat
   between the centre and its rail. A change now needs seconds, not one tick. */
const ROBOT_TICK_MS = 200;
/** Painted height of the cat notch, in logical px. Mirrors --mini-h in
    styles.css (clock and clock-date notches use settings.mini.height, which is
    the same 14 px the CSS falls back to). */
const MINI_CAT_H = 26;
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
  win.setContentProtection(!settings.captureShowIsland);
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

function settingsBackgroundColor(): string {
  const surface = String(loadSettings().surface ?? 'Black');
  if (surface === 'Liquid glass') return '#eef3fb';
  if (surface === 'Translucent') return '#d5dae1';
  if (surface === 'Candy glass') return '#f8e6ee';
  return '#2b1e1a';
}

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
    backgroundColor: settingsBackgroundColor(),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/settings-preload.js'),
      additionalArguments: [`--aeolia-surface=${String(loadSettings().surface ?? 'Black')}`],
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
  if (win && !win.isDestroyed()) {
    win.setContentProtection(captureProtectionOverride || !s.captureShowIsland);
  }
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
    mediaHidden,
    accent: s.accent,
    surface: s.surface,
    glassLevel: s.surface === 'Liquid glass' ? s.liquidGlassLevel
      : s.surface === 'Translucent' ? s.translucentGlassLevel
        : s.surface === 'Candy glass' ? s.candyGlassLevel : s.glassLevel,
    glassTint: s.surface === 'Liquid glass' ? s.liquidGlassTint
      : s.surface === 'Translucent' ? s.translucentGlassTint
        : s.surface === 'Candy glass' ? s.candyGlassTint : s.glassTint,
    glassHue: s.surface === 'Candy glass' ? s.candyGlassHue : s.glassHue,
    glassRefraction: s.glassRefraction,
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
      const title = mediaTitle;
      void fetchLyrics(title).then((lrc) => {
        if (!mediaPlaying || mediaTitle !== title) return;
        win?.webContents.send('lyrics:auto-loaded', { title, lrc });
      });
      // Only the album background needs cover colours; "Polos" stays as it is.
      if (loadSettings().musicCardBackground === 'album') {
        void fetchTrackColors(title).then((rawColors) => {
          win?.webContents.send('music:colors', { title, colors: toDeepPalette(rawColors) });
        });
      }
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
    s.robotIdleOnly || s.robotBatteryExpressions || s.robotEyeMovement === 'cursor';
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
  const active = Boolean(isMeeting()) && s.meetingAuto && s.meetingMicButton;
  if (!active) micHot = false;   // capsule vanished: never leave hover disabled
  island?.setMicPill(active);
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

  const browser = BROWSERS.has(info.process);
  // A tab count costs a synchronous PowerShell child process. Only ask for it
  // when the notch decision can actually use it: a fullscreen window already
  // shrinks on its own, and miniMode 'off' never shrinks at all. The 8-tab
  // threshold and the immediate fullscreen path are unchanged.
  const needTabs = browser && settings.miniMode !== 'off' && !info.fullscreen;
  const tabs = needTabs ? browserTabCount(info.hwnd) : 0;
  busyForDelay = info.fullscreen || (browser
    ? browserShouldShrink(info.process, info.title, false, tabs)
    : isBusyProcess(info.process));

  // "off" keeps the full pill even under a fullscreen app; the trigger decides
  // which window conditions are allowed to shrink it to the 14 px notch.
  // A browser is never busy merely by being a browser: one or two tabs keep
  // the full island, only a crowded window (or fullscreen) earns the notch.
  const miniOff = settings.miniMode === 'off';
  let shrinks: boolean;
  if (browser) shrinks = browserShouldShrink(info.process, info.title, info.fullscreen, tabs);
  else if (settings.miniTrigger === 'busy') shrinks = info.fullscreen || busyForDelay;
  else if (settings.miniTrigger === 'maximized') shrinks = info.fullscreen || info.maximized;
  else shrinks = info.fullscreen || (settings.slimStrip && info.maximized);
  // A playing track keeps the full pill awake by default (the notch hides the
  // controls), but a fullscreen app still wins so the island never covers a
  // video. mediaMiniBehavior may override the media rule: 'mini' shrinks to
  // the notch, 'hide' shrinks AND makes the island transparent until hover.
  const mediaBehavior = settings.mediaMiniBehavior ?? 'keep';
  const mediaOverrides = mediaPlaying && !info.fullscreen
    && (mediaBehavior === 'mini' || mediaBehavior === 'hide');
  const hide = !miniOff && !bannerActive
    && (mediaOverrides || (shrinks && (!mediaPlaying || info.fullscreen)));
  const nextMediaHidden = Boolean(hide && mediaPlaying && mediaBehavior === 'hide' && !info.fullscreen);
  const nextBase: 'mini' | 'pill' = hide ? 'mini' : 'pill';
  island.setBase(nextBase);
  if (nextMediaHidden !== mediaHidden) {
    mediaHidden = nextMediaHidden;
    pushStatus();
  }

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
  // While dragging, never arm hover-open: the pointer is moving the window,
  // not asking to expand it into the card.
  if (dragging) { cancelHover(); return; }
  if (!win || win.isDestroyed() || !island) return;
  // A hot capsule owns its own hit area: never peek, open or close the card
  // while the user is aiming at Mic/Cam.
  if (micHot) { cancelHover(); return; }
  const b = win.getBounds();
  const display = activeDisplay(settings).bounds;
  const p = screen.getCursorScreenPoint();
  const pad = 6;
  const withinX = p.x >= b.x - pad && p.x <= b.x + b.width + pad;
  // The notch paints only its top strip: Windows floors the frameless window at
  // 39 px, so the transparent remainder must not count as "on the island" or a
  // cursor 25 px below the notch would trigger a peek out of nowhere.
  const paintedH = island.current === 'mini'
    ? Math.min(b.height, Math.round(
      (settings.miniMode === 'cat' ? MINI_CAT_H : settings.mini.height) * effectiveScalePct(settings) / 100))
    : b.height;
  const overWindow = p.y >= b.y && p.y <= b.y + paintedH;
  // The gap only exists when the window is pushed below the screen edge.
  const gapTop = Math.min(b.y, display.y);
  const inGap = p.y >= gapTop && p.y < b.y;
  // #island gives the rightmost (or leftmost) MIC_PILL_EXTRA px back to the
  // two capsules. Excluding the whole strip - including the transparent gap
  // between the buttons - keeps hover-to-open from stealing their clicks.
  const strip = island.current === 'pill' && island.micPillActive
    ? micStripRect(b, loadSettings(), true)
    : null;
  if (pointInRect(p, strip)) {
    cancelHover();
    cancelLeave();
    zoneInside = false;
    return;
  }
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
  if (dragging) return;                  // a drag is not a hover request
  // Click-through is owned by syncClickThrough(state) via Island.onChange.
  // Pointer IPC only remains for the reveal effect of hiddenUntilHover and for
  // the capsule hover guard below.
  if (kind === 'mic-enter') {
    micHot = true;
    cancelHover();
    cancelLeave();
    zoneInside = false;
    return;
  }
  if (kind === 'mic-leave') {
    micHot = false;
    pollHoverZone();
    return;
  }
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
    notice: (app, title, body, aumid) => {
      // Notifications are never held — meeting or not, every notice lands
      // (user spec: "mau sedang meeting atau tidak jangan di hold").
      pushNotice(app, title, body, aumid);
      broadcast();
    },
    mediaPlaying: () => mediaPlaying,
    // mediaPlayPause() is a toggle, so only fire it when a change is needed.
    pauseMedia: () => { if (mediaPlaying) mediaPlayPause(); },
    // Live capture sessions are the reliable "Discord voice is on" signal.
    captureProbe: getActiveCaptureProcesses,
  });

  if (process.env.ISLAND_OPEN_SETTINGS === '1') setTimeout(() => openSettingsWindow(), 700);
  pollMedia();
  mediaTimer = setInterval(pollMedia, 2000);
  syncRobotTimer();

  ipcMain.on('card:height', (_e, height: number) => island?.setOpenHeight(height));
  ipcMain.on('banner:show', (_e, active: boolean) => {
    bannerActive = Boolean(active);
    island?.setBanner(bannerActive);
  });
  ipcMain.handle('glass:set-active', (_e, active: boolean) => {
    setDesktopGlass(Boolean(active), win || null);
    return Boolean(active);
  });
  // Clicking the small notch expands the island into the open card.
  ipcMain.handle('island:open', () => island?.open());

  /* Pointer dragging. The renderer sends a delta per pointermove and main
     moves the window; the final offset is persisted to settings so it survives
     a restart and a settings reload. */
  ipcMain.on('island:drag-start', () => {
    dragging = true;
    cancelHover();
    cancelLeave();
    island?.setDragging(true);
  });
  ipcMain.on('island:drag-move', (_e, dx: number, dy: number) => {
    if (dragging) island?.dragBy(Number(dx) || 0, Number(dy) || 0);
  });
  ipcMain.on('island:drag-end', () => {
    if (!dragging) return;
    dragging = false;
    island?.setDragging(false);
    const offset = island?.getOffset();
    if (offset) {
      setValue('islandOffset', offset);
      island?.reposition();
    }
    zoneInside = false;
    pollHoverZone();
  });

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
  ipcMain.handle('mic:mute-toggle', async () => {
    const next = await toggleMicMute();
    // null alone told the renderer nothing. The helper now captures stderr, so
    // publish the actual reason as a separate event without changing the
    // boolean|null contract the pill and existing probes rely on.
    if (next === null) win?.webContents.send('mic:error', lastMicError() || 'State mikrofon tidak bisa dibaca');
    return next;
  });

  /* One Cam capsule, two independent mechanisms:
     - shortcut: the meeting app's own hotkey, only after focus verification,
       honest "unverified" because Aeolia cannot read that app's camera state;
     - privacy: the HKCU webcam consent store, verified by reading the values
       back after writing them. 'both' runs both and reports the verified
       privacy state while still naming the shortcut outcome. */
  const shortcutToggle = async (): Promise<CamToggleResult> => {
    const active = getActiveWindow({ x: 0, y: 0, width: 0, height: 0 });
    const fallback = getExtras().meetingApp || '';
    const activeApp = cameraAppFor(active.process || fallback, active.title || fallback);
    // A browser tab with no Meet marker is not a camera target by itself.
    // Keep the detected meeting app as the fallback so "Zoom not focused"
    // still reports need-focus instead of "chrome has no shortcut".
    const app = activeApp === active.process && fallback ? fallback : activeApp;
    // Google Meet is identified by the tab title, so its resolved name is
    // the honest focus label. A plain browser window is not: pass the real
    // foreground process so a background Zoom reports need-focus.
    const focusedLabel = activeApp !== active.process ? activeApp : active.process;
    const decision = camDecision(app, focusedLabel, true);
    const bringTarget = cameraFocusTarget(decision.app || app, active.process);
    const brought = decision.focus && bringTarget
      ? focusProcessWindow(bringTarget) : false;
    if (decision.sendAfterFocus && brought) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    const nowActive = getActiveWindow({ x: 0, y: 0, width: 0, height: 0 });
    const targetFocused = focusedAppMatches(decision.app || app, nowActive.process);
    // Never fire a camera shortcut into the wrong window: send only when the
    // resolved meeting app was already focused or focus actually moved to it.
    const canSend = Boolean(decision.send && (targetFocused || brought));
    const sent = canSend ? Boolean(sendShortcut(decision.send as string)) : false;
    return camResult(decision, sent, targetFocused || brought);
  };

  ipcMain.handle('cam:toggle', async () => {
    const mode = loadSettings().cameraMode ?? 'both';
    if (mode === 'privacy') {
      const p = await toggleWebcamConsent();
      return { ...p, sent: false, focused: false, shortcut: '', mode } as CamToggleResult;
    }
    if (mode === 'both') {
      const p = await toggleWebcamConsent();
      const s = await shortcutToggle();
      return {
        ...s,
        ok: p.ok,
        verified: p.verified,
        enabled: p.enabled,
        mode,
        code: p.verified ? 'privacy-verified' : p.code,
        hint: `${p.hint} · ${s.hint}`,
      } as CamToggleResult;
    }
    return { ...(await shortcutToggle()), mode };
  });
  // Worship reminders pause the current track; the resume offer plays it again.
  // Both are guarded so a stale click can never invert playback.
  ipcMain.on('media:pause', () => { if (mediaPlaying) mediaPlayPause(); });
  ipcMain.on('media:play', () => { if (!mediaPlaying) mediaPlayPause(); });
  ipcMain.on('media:prev', () => mediaPrev());
  ipcMain.on('media:next', () => mediaNext());

  /* Both notice actions only open the source app. The launcher reads the
     setting inside the handler and refuses before resolving any target. */
  ipcMain.handle('notice:open', (_e, appName: string, body: string, aumid?: string) =>
    noticeLauncher.open(appName, body, aumid));
  ipcMain.handle('notice:reply', (_e, appName: string, body: string, text: string, aumid?: string) =>
    noticeLauncher.reply(appName, body, text, aumid));

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
    isVisible: () => Boolean(win && !win.isDestroyed() && win.isVisible()),
    hide: () => { if (win && !win.isDestroyed()) win.hide(); },
    show: () => { if (win && !win.isDestroyed()) win.showInactive(); },
    protect: (on) => {
      captureProtectionOverride = on;
      if (win && !win.isDestroyed()) {
        win.setContentProtection(captureProtectionOverride || !loadSettings().captureShowIsland);
      }
    },
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
