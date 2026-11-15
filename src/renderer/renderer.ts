const root = document.getElementById('island') as HTMLDivElement;
const clock = document.getElementById('clock') as HTMLSpanElement;
const miniClock = document.getElementById('miniClock') as HTMLSpanElement;
const miniDate = document.getElementById('miniDate') as HTMLSpanElement;
const openClock = document.getElementById('openClock') as HTMLSpanElement;
const taskList = document.getElementById('taskList') as HTMLDivElement;
const taskForm = document.getElementById('taskForm') as HTMLFormElement;
const taskName = document.getElementById('taskName') as HTMLInputElement;
const timerChips = document.getElementById('timerChips') as HTMLDivElement;
const timerText = document.getElementById('timerText') as HTMLParagraphElement;
const muteBtn = document.getElementById('muteBtn') as HTMLButtonElement;
const mediaText = document.getElementById('mediaText') as HTMLElement;
const mediaTrack = document.getElementById('mediaTrack') as HTMLSpanElement;
const mediaLyric = document.getElementById('mediaLyric') as HTMLDivElement;
const mediaViz = document.getElementById('mediaViz') as HTMLElement;
const battery = document.getElementById('battery') as HTMLSpanElement;

const catTemplate = document.getElementById('catTemplate') as HTMLTemplateElement;
for (const slot of ['miniCatSlot', 'pillCatSlot', 'brandCatSlot']) {
  document.getElementById(slot)?.append(catTemplate.content.cloneNode(true));
}

/* Auto lyrics: main fetches synced LRC for the playing track and pushes it
   here. panels.js consumes it via aeoliaAutoLyric; events that land before
   panels.js has loaded wait in the pending slot. */
let autoLyricPending: { title: string; lrc: string | null } | null = null;
(window as unknown as Record<string, unknown>).aeoliaAutoLyricPendingGet = () => {
  const p = autoLyricPending;
  autoLyricPending = null;
  return p;
};
window.api.onLyricsAuto((p) => {
  const w = window as unknown as { aeoliaAutoLyric?: (lrc: string | null, title: string) => void };
  if (typeof w.aeoliaAutoLyric === 'function') w.aeoliaAutoLyric(p.lrc, p.title);
  else autoLyricPending = p;
});

const EYE_PALETTE = ['#46e0dc', '#6ea8ff', '#b48cff', '#ff8fc7', '#e9c46a', '#ff9c6b', '#ffffff'];

const BAR_TOKENS = ['clock', 'cat', 'battery', 'media', 'mic'] as const;
let barOrder: string[] = [...BAR_TOKENS];

function applyBarOrder(): void {
  // Resolve lazily: several of these consts are declared later in this module.
  const els: Record<string, HTMLElement> = {
    clock, cat: document.getElementById('pillCatSlot') as HTMLElement,
    battery, media: document.getElementById('mediaBox') as HTMLElement,
    mic: meetingMicBtn,
  };
  const content = root.dataset.islandContent ?? 'clock-robot';
  const media = root.dataset.media === 'true';
  const robotHidden = root.dataset.robotHidden === 'true';
  const shown = (t: string): boolean => {
    switch (t) {
      case 'clock': return content !== 'robot-only';
      case 'cat': return content !== 'clock-battery' && !robotHidden;
      case 'battery': return content === 'clock-battery' && !media;
      case 'media': return media;
      case 'mic': return root.dataset.mic === 'joining' || root.dataset.mic === 'on';
      default: return false;
    }
  };
  // Rank follows the SAVED permutation, not the visible subset. Renumbering by
  // the visible items made a move a no-op whenever the two neighbours were
  // hidden (battery, media and mic usually are), which felt like a dead
  // control. Hidden items keep their rank; they are display:none so they take
  // no space in the flex row.
  // `ordered` is the visible items in the SAVED order, which is what decides
  // which rail the cat sits on.
  const ordered = [...new Set([...barOrder.filter(shown), ...BAR_TOKENS.filter(shown)])];
  for (const t of BAR_TOKENS) {
    const el = els[t];
    const rank = barOrder.indexOf(t);
    if (rank >= 0) el.dataset.barRank = String(rank);
    else delete el.dataset.barRank;
  }
  // The cat is an absolute overlay, so it claims no flex slot. It takes the
  // left rail when it is the FIRST visible item in the saved order, otherwise
  // the right rail (its resting place the greeting animation slides into).
  const catFirst = ordered.length > 0 && ordered[0] === 'cat';
  const rail = !shown('cat') ? 'none' : (media ? 'left' : (catFirst ? 'left' : 'right'));
  root.dataset.catRail = rail;
  // The cat is an overlay, so the remaining items have to move out of its way:
  // when the cat holds the left rail the rest of the bar shifts right.
  const firstFlow = ordered.find((t) => t !== 'cat');
  for (const t of BAR_TOKENS) {
    const el = els[t];
    if (t === firstFlow && rail === 'left') el.dataset.barPush = 'true';
    else delete el.dataset.barPush;
  }
}

/* ---- island scale ----
   The window is resized by the main process (bounds.ts resolves 'auto'
   against the display width). Here the pill, notch and card CONTENT are
   scaled to fill the larger window. Auto resolves to arbitrary percents, so
   the zoom is written through the CSSOM (allowed; the CSP only blocks style
   attributes in markup). The inverse width/height cancels the zoom of the
   inset:0 layers so they still fill the window exactly. The mini notch is
   scaled too, so its clock and cat follow the same island size.
   openLayer is the existing card layer const below. */
const pillLayer = document.getElementById('pill') as HTMLElement;
const miniLayer = document.getElementById('mini') as HTMLElement;
const micPillLayer = document.getElementById('micPill') as HTMLElement;
const bannerLayer = document.getElementById('banner') as HTMLElement;
const bnAvatar = document.getElementById('bnAvatar') as HTMLElement;
const bnTitle = document.getElementById('bnTitle') as HTMLElement;
const bnBody = document.getElementById('bnBody') as HTMLElement;

/* Clicking the small notch expands the island into the open card. The window
   is click-through while the notch shows, so this fires once hover has peeked
   the island to the pill (clicks then land on the real window). */
miniLayer.addEventListener('click', () => { window.api.islandOpen(); });

function applyScale(): void {
  const zoom = Math.min(1.3, Math.max(0.75, (Number(root.dataset.scale) || 100) / 100));
  for (const el of [pillLayer, miniLayer, micPillLayer, bannerLayer, openLayer]) {
    if (zoom === 1) {
      el.style.removeProperty('zoom');
      el.style.removeProperty('width');
      el.style.removeProperty('height');
      el.style.removeProperty('right');
      el.style.removeProperty('bottom');
    } else {
      el.style.zoom = String(zoom);
      el.style.width = `${100 / zoom}%`;
      el.style.height = `${100 / zoom}%`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }
  }
}

function applyRobotSettings(s: IslandSettings): void {  const index = EYE_PALETTE.indexOf(s.robotEyeColor ?? '');
  root.dataset.robotEye = index < 0 ? '' : String(index);
  root.dataset.robotAccessory = s.robotAccessory ?? 'none';
  root.dataset.robotMove = s.robotEyeMovement ?? 'relaxed';
  root.dataset.robotIdleOnly = String(Boolean(s.robotIdleOnly));
  root.dataset.robotBattery = String(Boolean(s.robotBatteryExpressions));
  root.dataset.robotHoldsItems = String(Boolean(s.robotHoldsItems));
  root.dataset.islandStyle = s.islandStyle ?? 'dynamic';
  root.dataset.islandContent = s.islandContent ?? 'clock-robot';
  root.dataset.pos = s.islandPosition ?? 'center';
}

const pad = (n: number) => String(n).padStart(2, '0');

/* Glass solidity for the Liquid glass / Translucent themes: glassLevel 20-90
   becomes a 0.2-0.9 CSS custom property. Written through the CSSOM because
   the CSP blocks inline style attributes. */
function applyGlass(level: number | undefined): void {
  const a = Math.min(0.9, Math.max(0.2, (Number(level) || 55) / 100));
  root.style.setProperty('--glass-a', a.toFixed(2).replace(/0$/, ''));
}

function paintClock(): void {
  const now = new Date();
  const text = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  clock.textContent = text;
  miniClock.textContent = text;
  openClock.textContent = text;
  miniDate.textContent = `${now.getDate()} ${now.toLocaleDateString('id-ID', { month: 'short' })}`;
}

/* Duplicate the track only when it actually overflows, otherwise the second
   copy shows as a stray truncated fragment. */
function paintMedia(title: string): void {
  if (mediaTrack.dataset.title === title) return;
  mediaTrack.dataset.title = title;
  mediaText.dataset.scroll = 'false';
  mediaTrack.textContent = title;
  // The music card reads this title too; repaint it now instead of waiting
  // for the one-second clock tick.
  paintMusic();
  requestAnimationFrame(() => {
    if (mediaTrack.scrollWidth <= mediaText.clientWidth + 1) return;
    const unit = `${title}   ·   `;
    mediaTrack.textContent = unit + unit;
    const half = mediaTrack.scrollWidth / 2;
    mediaText.dataset.speed = half > 420 ? 'long' : half > 190 ? 'medium' : 'short';
    mediaText.dataset.scroll = 'true';
  });
}

let visibleTabs: string[] = [];

/* Only the PANEL tabs live in #tabsScroll and only they get reordered. The
   grid button, the clock and the Settings button are pinned outside the
   scroll strip, so they stay reachable even when every panel tab is hidden.
   visibleTabs is the exact ordered membership: an empty list means none. */
function applyVisibleTabs(): void {
  for (const b of tabButtons) {
    const tab = b.dataset.tab ?? '';
    if (tab === 'settings' || tab === 'panels') {
      b.hidden = false;
      continue;
    }
    b.hidden = !visibleTabs.includes(tab);
  }
  const tabsScroll = document.getElementById('tabsScroll');
  const order = visibleTabs;
  let ref: Element | null = null;
  for (const name of order) {
    const btn = tabButtons.find((b) => b.dataset.tab === name);
    if (!btn || btn.hidden || !tabsScroll || !tabsScroll.contains(btn)) continue;
    tabsScroll.insertBefore(btn, ref ? ref.nextSibling : tabsScroll.firstChild);
    ref = btn;
  }
  if (typeof updateTabArrows === 'function') updateTabArrows();
}

let lastState = '';
let hovered = false;

/* The mic chip is a one-click mute during a meeting. Windows has no public
   "microphone in use" flag, so the meeting itself comes from window titles.
   The capsule lives in its own layer beside the island: on join it plays a
   short "joining" look (mic + pulsing dot) before settling. */
const meetingMicBtn = document.getElementById('meetingMic') as HTMLButtonElement;
const meetingCamBtn = document.getElementById('meetingCam') as HTMLButtonElement | null;
const micPill = document.getElementById('micPill') as HTMLDivElement;
let micMuted = false;
let micJoinTimer: number | null = null;

function updateMeetingMic(): void {
  const active = root.dataset.meeting === 'true' && root.dataset.meetingMic !== 'false';
  const inPill = root.dataset.state === 'pill';
  if (!active || !inPill) {
    if (micJoinTimer !== null) { clearTimeout(micJoinTimer); micJoinTimer = null; }
    micPill.hidden = true;
    root.dataset.mic = 'off';
  } else {
    micPill.hidden = false;
    if (root.dataset.mic === 'off') {
      // Rising edge: play the joining animation once, then settle. The real
      // mute state is fetched so the button never claims an invented state.
      root.dataset.mic = 'joining';
      window.api.micMuteState().then((muted) => {
        micMuted = muted === true;
        root.dataset.micMuted = muted === null ? 'unknown' : String(micMuted);
        updateMeetingMic();
      }).catch(() => { root.dataset.micMuted = 'unknown'; });
      micJoinTimer = window.setTimeout(() => {
        micJoinTimer = null;
        if (root.dataset.mic === 'joining') root.dataset.mic = 'on';
      }, 1400);
    }
  }
  meetingMicBtn.classList.toggle('muted', micMuted);
  meetingMicBtn.setAttribute('aria-pressed', String(micMuted));
  applyBarOrder();
}

meetingMicBtn.addEventListener('click', () => {
  window.api.micMuteToggle().then((next) => {
    if (next === null) {
      root.dataset.micMuted = 'unknown';
      meetingMicBtn.title = 'Mikrofon tidak bisa dikontrol · cek izin aplikasi';
      return;
    }
    micMuted = next;
    root.dataset.micMuted = String(micMuted);
    meetingMicBtn.title = micMuted ? 'Buka bisukan mikrofon' : 'Bisukan mikrofon';
    updateMeetingMic();
  }).catch(() => { root.dataset.micMuted = 'unknown'; });
});

if (meetingCamBtn) {
  meetingCamBtn.addEventListener('click', () => {
    window.api.camToggle().then((r) => {
      meetingCamBtn.title = r.hint || (r.ok ? 'Kamera meeting' : 'Kamera dikontrol di aplikasi rapat');
    }).catch(() => { meetingCamBtn.title = 'Kamera dikontrol di aplikasi rapat'; });
  });
}

/* ---- notice / meeting banner ----
   The main process widens the pill window while a banner overlays it
   (IPC banner:show); the renderer owns timing. Events queue FIFO, each
   shows 4.2 s, and banners show in the pill AND the mini notch state
   (the main process expands the notch for the banner, island.ts). */
type BannerItem = { app: string; title: string; body: string; tone: 'meeting' | 'notice' };
const bannerQueue: BannerItem[] = [];
let bannerTimer: number | null = null;
let bannerGapTimer: number | null = null;
let lastNoticeId = '';
let lastMeetingSeen = false;
let callAnimTimer: number | null = null;

/* Banner-friendly states: pill and open only. The mini notch shows the clock
   and nothing else. A banner arriving there waits in the queue until the
   island peeks to pill (hover/click), so the notch is never overwritten. */
const bannerOk = (): boolean => root.dataset.state === 'pill' || root.dataset.state === 'open';

function hideBanner(): void {
  bannerLayer.hidden = true;
  root.dataset.banner = 'false';
  window.api.bannerShow(false);
}

function showNextBanner(): void {
  if (bannerTimer !== null) { clearTimeout(bannerTimer); bannerTimer = null; }
  /* State check BEFORE shift: an item taken while mini/open-unfriendly is
     gone forever. Leave it queued and retry until the state welcomes it. */
  if (!bannerOk()) {
    if (bannerQueue.length > 0) {
      bannerGapTimer = window.setTimeout(() => { bannerGapTimer = null; showNextBanner(); }, 400);
    } else hideBanner();
    return;
  }
  const item = bannerQueue.shift();
  if (!item) { hideBanner(); return; }
  bnAvatar.textContent = initial(item.app);
  bnAvatar.style.background = `hsl(${hueFor(item.app)} 42% 30%)`;
  bnAvatar.style.color = `hsl(${hueFor(item.app)} 90% 82%)`;
  bnTitle.textContent = item.title;
  bnBody.textContent = item.body;
  root.dataset.bannerTone = item.tone;
  bannerLayer.hidden = false;
  root.dataset.banner = 'true';
  window.api.bannerShow(true);
  bannerTimer = window.setTimeout(() => {
    bannerTimer = null;
    hideBanner();
    bannerGapTimer = window.setTimeout(() => { bannerGapTimer = null; showNextBanner(); }, 350);
  }, 4200);
}

function enqueueBanner(item: BannerItem): void {
  bannerQueue.push(item);
  if (bannerTimer === null && bannerGapTimer === null) showNextBanner();
}

const svcBar = document.getElementById('svcBar') as HTMLDivElement;
const svcText = document.getElementById('svcText') as HTMLSpanElement;
const svcResume = document.getElementById('svcResume') as HTMLButtonElement;
const svcDismiss = document.getElementById('svcDismiss') as HTMLButtonElement;

function renderExtras(s: ExtrasState): void {
  const meeting = s.meeting && root.dataset.meetingMic !== 'false';
  const offline = !s.online;
  const offer = s.resumeOffer;
  svcBar.hidden = !(meeting || offline || offer);
  svcBar.dataset.tone = meeting ? 'meeting' : offline ? 'offline' : 'ok';
  svcText.textContent = offline
    ? 'Internet terputus, beberapa layanan tertunda.'
    : meeting
      ? `Meeting mode${s.meetingApp ? ` · ${s.meetingApp}` : ''}. Notifikasi tetap masuk.`
      : 'Kembali online. Lanjutkan musik?';
  svcResume.hidden = !offer || offline;
  svcDismiss.hidden = !offer;
  updateMeetingMic();
  measureCard();
}

window.api.getExtras().then(renderExtras).catch(() => { /* main not ready yet */ });
window.api.onExtras(renderExtras);

svcResume.addEventListener('click', () => {
  window.api.playMedia();
  window.api.dismissResume();
});
svcDismiss.addEventListener('click', () => window.api.dismissResume());

function renderStatus(status: IslandStatus): void {
  const wasOpen = lastState === 'open';
  lastState = status.state;
  root.dataset.state = status.state;
  if (bannerOk() && bannerQueue.length > 0 && bannerTimer === null && bannerGapTimer === null) {
    showNextBanner();
  }
  root.dataset.word = String(status.word);
  root.dataset.media = String(status.media);
  root.dataset.accent = status.accent || '#e9eef7';
  root.dataset.surface = status.surface || 'Black';
  applyGlass((status as IslandStatus).glassLevel);  root.dataset.islandStyle = status.islandStyle || root.dataset.islandStyle || 'dynamic';
  root.dataset.pos = (status as IslandStatus).islandPosition || root.dataset.pos || 'center';
  root.dataset.hidden = String(Boolean(status.hiddenUntilHover));
  root.dataset.hovered = String(hovered);
  root.dataset.meeting = String(Boolean(status.meeting));
  root.dataset.meetingMic = String(Boolean(status.meetingMicButton));
  const meetingNow = Boolean(status.meeting);
  if (meetingNow && !lastMeetingSeen) {
    const app = (status as IslandStatus).meetingApp || 'rapat';
    enqueueBanner({ app, title: 'Meeting mode', body: `${app} · notifikasi tetap masuk`, tone: 'meeting' });
    root.dataset.callAnim = 'true';
    if (callAnimTimer !== null) clearTimeout(callAnimTimer);
    callAnimTimer = window.setTimeout(() => { callAnimTimer = null; root.dataset.callAnim = 'false'; }, 2400);
  }
  lastMeetingSeen = meetingNow;
  root.dataset.miniMode = status.miniMode || root.dataset.miniMode || 'clock';
  root.dataset.scale = String(status.scaleEffective ?? 100);
  root.dataset.viz = status.visualizer ?? 'pixels';
  root.dataset.musicBg = status.musicCardBackground ?? 'album';
  root.dataset.pillLyrics = String(Boolean(status.pillLyrics));
  root.dataset.musicProgress = status.musicCardProgress ?? 'Wave';
  applyScale();
  updateMeetingMic();
  visibleTabs = Array.isArray(status.visibleTabs) ? status.visibleTabs : [...TABS];
  applyVisibleTabs();
  applyBarOrder();
  paintClock();
  paintMedia(status.mediaTitle ?? '');
  if (status.state === 'open') {
    if (!wasOpen && status.openAction === 'music') activate('music', false);
    measureCard();
  }
}

let greetingDone = false;
let catIdle = false;

function updateCatPos(): void {
  const next = !greetingDone
    ? 'center'
    : catIdle && root.dataset.catIdleCenter === 'true' ? 'center' : 'right';
  // Writing the same value on every 200 ms robot tick restarted the CSS
  // transition in some Chromium builds. Only a real change touches the DOM.
  if (root.dataset.catPos !== next) root.dataset.catPos = next;
  applyBarOrder();
}

window.api.onSettingsChanged((s) => {
  barOrder = Array.isArray(s.barOrder) && s.barOrder.length ? s.barOrder : [...BAR_TOKENS];
  root.dataset.accent = s.accent || '#e9eef7';
  root.dataset.surface = s.surface || 'Black';
  applyGlass(s.glassLevel);
  applyRobotSettings(s);
  root.dataset.miniMode = s.miniMode || 'clock';
  // Scale is pushed as the resolved effective value via island:update; the
  // settings payload may carry 'auto', which the renderer cannot resolve.
  root.dataset.viz = s.visualizer ?? 'pixels';
  root.dataset.musicBg = s.musicCardBackground ?? 'album';
  root.dataset.pillLyrics = String(Boolean(s.pillLyrics));
  root.dataset.musicProgress = s.musicCardProgress ?? 'Wave';
  root.dataset.catIdleCenter = String(Boolean(s.catIdleCenter));
  root.dataset.worshipMode = s.worshipMode || 'prayer';
  root.dataset.worshipCountdown = String(s.worshipCountdown !== false);
  if (s.catGreeting === false) {
    greetingDone = true;
    root.dataset.greeting = 'false';
  }
  updateCatPos();
  updateMeetingMic();
  visibleTabs = Array.isArray(s.visibleTabs) ? s.visibleTabs : [...TABS];
  applyVisibleTabs();
  applyBarOrder();
  window.dispatchEvent(new CustomEvent('aeolia:settings', { detail: s }));
  measureCard();
});

/* Startup: the cat greets from the centre, then settles on the right. */
window.setTimeout(() => {
  greetingDone = true;
  root.dataset.greeting = 'false';
  updateCatPos();
}, 1500);

/* Idle time, battery level and pointer direction all arrive on one channel. */
window.island.onRobotState((st) => {
  const idleOnly = root.dataset.robotIdleOnly === 'true';
  root.dataset.robotHidden = String(idleOnly && !st.idle);
  applyBarOrder();
  catIdle = st.idle;
  root.dataset.catIdle = String(st.idle);
  updateCatPos();
  const percent = st.batteryPercent;
  battery.textContent = percent > 100 ? 'AC' : `${percent}%`;
  root.dataset.battery =
    percent > 100 ? 'ok'
      : percent < 10 ? (st.charging ? 'ok' : 'low')
        : percent >= 95 ? 'full'
          : 'ok';
  if (root.dataset.robotMove === 'cursor') root.dataset.eyeDx = String(st.cursorDx);
});

/* Brightness reads and writes the real monitor value; volume is relative. */
const brightnessSlider = document.getElementById('brightnessSlider') as HTMLInputElement;
const volumeSlider = document.getElementById('volumeSlider') as HTMLInputElement;
let volumeEstimate = 50;

window.api.getBrightness().then((b) => {
  brightnessSlider.disabled = !b.supported;
  if (b.supported) brightnessSlider.value = String(b.current);
});

brightnessSlider.addEventListener('change', async () => {
  const res = await window.api.setBrightness(Number(brightnessSlider.value));
  if (res.ok) brightnessSlider.value = String(res.current);
});

volumeSlider.addEventListener('change', () => {
  const target = Number(volumeSlider.value);
  const delta = target - volumeEstimate;
  const steps = Math.round(Math.abs(delta) / 2);
  if (steps > 0) window.api.volumeStep(delta > 0 ? 'up' : 'down', steps);
  volumeEstimate = target;
});

document.getElementById('muteBtn')?.addEventListener('click', () => window.api.toggleMute());

window.island.onStatus(renderStatus);

setInterval(paintClock, 1000);
paintClock();

/* ---- card ---- */
let timerEndsAt = 0;

const TABS = [
  'web', 'notifications', 'shelf', 'clipboard', 'music', 'today', 'sholat',
  'timer', 'reminders', 'water', 'capture',
  'controls', 'deck', 'calls',
];

const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab'));
const panels = Array.from(document.querySelectorAll<HTMLElement>('.panel'));
const siteGrid = document.getElementById('siteGrid') as HTMLDivElement;
const siteForm = document.getElementById('siteForm') as HTMLFormElement;
const siteName = document.getElementById('siteName') as HTMLInputElement;
const siteUrl = document.getElementById('siteUrl') as HTMLInputElement;
const noticeList = document.getElementById('noticeList') as HTMLDivElement;
const noticeCount = document.getElementById('noticeCount') as HTMLSpanElement;
const shelfList = document.getElementById('shelfList') as HTMLDivElement;
const dropZone = document.getElementById('dropZone') as HTMLDivElement;
const clipList = document.getElementById('clipList') as HTMLDivElement;
const clipCount = document.getElementById('clipCount') as HTMLSpanElement;
const panelsGrid = document.getElementById('panelsGrid') as HTMLDivElement;

let card: CardState | null = null;

/* Drag to reorder the panel tabs. Only the buttons inside the scroll strip
   are draggable; the pinned grid / clock / settings controls stay in place. */
let draggedTab: string | null = null;

const tabsScrollEl = document.getElementById('tabsScroll');
const panelTabButtons = tabButtons.filter((b) => (tabsScrollEl?.contains(b) ?? false));

for (const b of panelTabButtons) {
  b.draggable = true;
  b.addEventListener('dragstart', (event) => {
    const name = b.dataset.tab ?? '';
    draggedTab = name;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', name);
    }
    b.classList.add('dragging');
  });
  b.addEventListener('dragover', (event) => {
    if (!draggedTab) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  });
  b.addEventListener('drop', async (event) => {
    if (!draggedTab) return;
    event.preventDefault();
    const target = b.dataset.tab ?? '';
    const moved = draggedTab;
    draggedTab = null;
    b.classList.remove('dragging');
    if (!target || target === moved) return;
    // The saved list is the exact ordered membership. A drag reorders only
    // the tabs the user chose to show; hidden tabs keep their saved rank.
    const current = [...visibleTabs];
    const from = current.indexOf(moved);
    const to = current.indexOf(target);
    if (from < 0 || to < 0) return;
    const next = [...current];
    next.splice(from, 1);
    next.splice(to, 0, moved);
    try {
      await window.api.setSetting('visibleTabs', next);
    } catch {
      return;
    }
    visibleTabs = next;
    applyVisibleTabs();
    updateTabArrows();
  });
  b.addEventListener('dragend', () => {
    b.classList.remove('dragging');
    draggedTab = null;
  });
}

/* ---- tab strip arrows ----
   At Small/Medium card widths the visible tabs overflow the scroll strip and
   the overflow itself is invisible (the scrollbar is hidden). Arrow buttons
   appear only when content actually overflows, so Large/Extra never see them. */
const tabsPrev = document.getElementById('tabsPrev') as HTMLButtonElement;
const tabsNext = document.getElementById('tabsNext') as HTMLButtonElement;
const tabsScrollBox = document.getElementById('tabsScroll') as HTMLDivElement;

function updateTabArrows(): void {
  const el = tabsScrollBox;
  const overflow = el.scrollWidth - el.clientWidth > 2;
  tabsPrev.hidden = !overflow || el.scrollLeft <= 2;
  tabsNext.hidden = !overflow || el.scrollLeft >= el.scrollWidth - el.clientWidth - 2;
}

tabsPrev.addEventListener('click', () => {
  tabsScrollBox.scrollBy({ left: -Math.round(tabsScrollBox.clientWidth * 0.7), behavior: 'smooth' });
});
tabsNext.addEventListener('click', () => {
  tabsScrollBox.scrollBy({ left: Math.round(tabsScrollBox.clientWidth * 0.7), behavior: 'smooth' });
});
tabsScrollBox.addEventListener('scroll', updateTabArrows, { passive: true });
window.addEventListener('resize', updateTabArrows);

/* Height follows the visible content, so a single-row panel never leaves a
   large empty area. Children are measured instead of scrollHeight because an
   absolutely positioned panel reports the window height when content is short. */
let measureQueued = false;

function measureCard(): void {
  if (root.dataset.state !== 'open') return;
  if (measureQueued) return;
  measureQueued = true;
  requestAnimationFrame(() => {
    measureQueued = false;
    const panel = document.querySelector<HTMLElement>('.panel.active');
    if (!panel) return;
    // The open layer carries a CSS zoom when the island scale is not 100%.
    // Layout reads (offsetHeight, scrollHeight) stay in logical px, but
    // getBoundingClientRect reports visual px, so the rect deltas are divided
    // back to logical before they meet the other numbers.
    const zoom = Math.min(1.3, Math.max(0.75, (Number(root.dataset.scale) || 100) / 100));
    const top = panel.getBoundingClientRect().top;
    let bottom = 0;
    for (const child of Array.from(panel.children)) {
      const el = child as HTMLElement;
      if (el.hidden) continue;
      const rect = el.getBoundingClientRect();
      if (rect.height > 0) bottom = Math.max(bottom, (rect.bottom - top) / zoom);
    }
    const tabs = document.getElementById('tabs');
    // scrollHeight is only trusted when content actually overflows; otherwise
    // it equals clientHeight and would keep inflating the window on each pass.
    const content = panel.scrollHeight > panel.clientHeight ? panel.scrollHeight : bottom;
    window.api.setCardHeight((tabs?.offsetHeight ?? 28) + content + 10);
  });
}

function activate(tab: string, persist = true): void {
  const target = TABS.includes(tab) || tab === 'panels' ? tab : 'web';
  tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === target));
  panels.forEach((p) => p.classList.toggle('active', p.dataset.panel === target));
  if (persist && TABS.includes(target)) window.api.setTab(target);
  measureCard();
}

tabButtons.forEach((b) => {
  b.addEventListener('click', () => {
    const tab = b.dataset.tab ?? 'web';
    if (tab === 'settings') {
      window.api.openWindow();
      return;
    }
    activate(tab);
  });
});

const openLayer = document.getElementById('open') as HTMLElement;
/* List rebuilds change the height; clock text does not, and watching
   characterData would re-measure every second. */
new MutationObserver(() => measureCard()).observe(openLayer, {
  childList: true, subtree: true,
});
// panels.js hides/shows whole blocks; attribute changes do not fire the
// observer above, so it asks for a re-measure explicitly.
window.addEventListener('aeolia:measure', () => measureCard());

const initial = (value: string) => (value.trim()[0] ?? '?').toUpperCase();

function relTime(at: number): string {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

function renderSites(): void {
  if (!card) return;
  siteGrid.replaceChildren();
  for (const site of card.sites) {
    const btn = document.createElement('button');
    btn.className = 'site';
    btn.type = 'button';
    btn.innerHTML =
      `<span class="mark">${initial(site.name)}</span>` +
      `<span class="meta"><span class="name"></span><span class="url"></span></span>`;
    (btn.querySelector('.name') as HTMLElement).textContent = site.name;
    (btn.querySelector('.url') as HTMLElement).textContent = site.url.replace(/^https?:\/\//, '');
    btn.addEventListener('click', () => window.api.openUrl(site.url));
    siteGrid.appendChild(btn);
  }
  const add = document.createElement('button');
  add.className = 'site add';
  add.type = 'button';
  add.textContent = '+ Add a site';
  add.addEventListener('click', () => {
    siteForm.hidden = !siteForm.hidden;
    if (!siteForm.hidden) siteUrl.focus();
  });
  siteGrid.appendChild(add);
}

/* Stable hue per app name so WhatsApp rows look like WhatsApp, Discord rows
   like Discord, and so on. Not real brand colours, just consistent identity. */
function hueFor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/* Apps that accept the clipboard-reply flow: the same list the main process
   maps to deep-link protocols (minus web-only Gmail). */
const CHAT_APPS = ['whatsapp', 'discord', 'telegram', 'zoom', 'teams', 'outlook', 'slack'];

function renderNotices(): void {
  if (!card) return;
  noticeCount.textContent = `${card.notices.length} notices`;
  noticeList.replaceChildren();
  if (card.notices.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Belum ada notifikasi dari aplikasi. Teks yang disalin ada di tab Clipboard.';
    noticeList.appendChild(p);
    return;
  }
  for (const n of card.notices) {
    const row = document.createElement('div');
    row.className = 'row notice-row';
    row.innerHTML =
      `<span class="notice-avatar"></span>` +
      `<span class="body"><span class="ntop"><span class="title"></span><span class="time"></span></span>` +
      `<span class="text"></span></span>`;
    const avatar = row.querySelector('.notice-avatar') as HTMLElement;
    avatar.textContent = initial(n.app);
    avatar.style.background = `hsl(${hueFor(n.app)} 42% 30%)`;
    avatar.style.color = `hsl(${hueFor(n.app)} 90% 82%)`;
    (row.querySelector('.title') as HTMLElement).textContent = n.title || n.app;
    (row.querySelector('.text') as HTMLElement).textContent = n.body;
    (row.querySelector('.time') as HTMLElement).textContent = relTime(n.at);
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'notice-main';
    main.title = 'Buka aplikasi sumber notifikasi';
    main.setAttribute('aria-label', `Buka ${n.app}`);
    main.append(...Array.from(row.childNodes));
    main.addEventListener('click', () => window.api.openNotice(n.app, n.body));
    row.appendChild(main);
    // Chat apps get the honest reply flow: text goes to the clipboard and the
    // app opens; Windows gives a toast we own no reply action on.
    if (CHAT_APPS.some((c) => n.app.toLowerCase().includes(c))) {
      const replyBtn = document.createElement('button');
      replyBtn.type = 'button';
      replyBtn.className = 'notice-reply-toggle';
      replyBtn.textContent = 'Balas';
      replyBtn.setAttribute('aria-label', `Balas pesan dari ${n.app}`);
      const replyBox = document.createElement('div');
      replyBox.className = 'notice-reply';
      replyBox.hidden = true;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'notice-reply-input';
      input.placeholder = 'Tulis balasan…';
      input.setAttribute('aria-label', `Balasan untuk ${n.app}`);
      const send = document.createElement('button');
      send.type = 'button';
      send.className = 'notice-reply-send';
      send.textContent = 'Kirim';
      const note = document.createElement('span');
      note.className = 'notice-reply-note';
      const finish = (opened: boolean): void => {
        input.value = '';
        replyBox.hidden = true;
        note.textContent = opened
          ? 'Teks disalin. Buka aplikasinya lalu tempel di chat.'
          : 'Tidak ada aplikasi yang cocok untuk dibuka.';
        row.appendChild(note);
      };
      send.addEventListener('click', () => {
        void window.api.noticeReply(n.app, n.body, input.value).then((r) => finish(Boolean(r?.opened)));
      });
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') send.click();
      });
      replyBtn.addEventListener('click', () => {
        replyBox.hidden = !replyBox.hidden;
        replyBtn.classList.toggle('open', !replyBox.hidden);
        if (!replyBox.hidden) input.focus();
      });
      replyBox.append(input, send);
      row.append(replyBtn, replyBox);
    }
    noticeList.appendChild(row);
  }
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'Klik notifikasi untuk membuka aplikasinya. Balas menyalin teks ke clipboard lalu membuka aplikasinya. Windows tidak mengizinkan membalas langsung dari notifikasi.';
  noticeList.appendChild(hint);
}

function renderShelf(): void {
  if (!card) return;
  shelfList.replaceChildren();
  if (card.shelf.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Shelf kosong. Seret file ke area di atas.';
    shelfList.appendChild(p);
    return;
  }
  for (const item of card.shelf) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML =
      `<span class="mark">${initial(item.name)}</span>` +
      `<span class="body"><span class="title"></span><span class="text"></span></span>` +
      `<span class="time"></span>`;
    (row.querySelector('.title') as HTMLElement).textContent = item.name;
    (row.querySelector('.text') as HTMLElement).textContent = `${(item.size / 1024).toFixed(1)} KB`;
    (row.querySelector('.time') as HTMLElement).textContent = relTime(item.at);
    shelfList.appendChild(row);
  }
}

/* The clip list only ever holds text, so there is no kind filter to offer.
   Every entry can be sent back to the clipboard, and pasted into whichever app
   has focus. */
function renderClips(): void {
  if (!card) return;
  const clips = card.clips;
  clipList.replaceChildren();
  clipCount.textContent = `${clips.length} item`;
  if (clips.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Belum ada riwayat. Hanya teks yang direkam. Salin teks apa pun untuk memulai.';
    clipList.appendChild(p);
    return;
  }
  for (const c of clips) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML =
      `<span class="mark">T</span>` +
      `<span class="body"><span class="title"></span></span>` +
      `<span class="time"></span>`;
    (row.querySelector('.title') as HTMLElement).textContent = c.text.replace(/\s+/g, ' ').slice(0, 120);
    (row.querySelector('.time') as HTMLElement).textContent = relTime(c.at);

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'clip-act';
    copy.textContent = 'Salin';
    copy.title = 'Salin teks ini ke clipboard';
    copy.setAttribute('aria-label', 'Salin teks ini ke clipboard');
    copy.setAttribute('aria-live', 'polite');
    copy.addEventListener('click', () => void copyClip(c.text, copy, 'Salin'));

    const paste = document.createElement('button');
    paste.type = 'button';
    paste.className = 'clip-act';
    paste.textContent = 'Tempel';
    paste.title = 'Salin lalu tempel ke aplikasi yang sedang aktif';
    paste.setAttribute('aria-label', 'Salin lalu tempel ke aplikasi yang sedang aktif');
    paste.setAttribute('aria-live', 'polite');
    paste.addEventListener('click', () => void pasteClip(c.text, paste));

    row.append(copy, paste);
    clipList.appendChild(row);
  }
}

/* Feedback for the row buttons: the label swaps for a moment so the user
   sees the action landed, then returns to the original wording. */
function flashLabel(btn: HTMLButtonElement, label: string, back: string, ok: boolean): void {
  btn.textContent = label;
  btn.classList.toggle('done', ok);
  btn.classList.toggle('fail', !ok);
  window.setTimeout(() => {
    btn.textContent = back;
    btn.classList.remove('done', 'fail');
  }, 1200);
}

async function copyClip(text: string, btn: HTMLButtonElement, back: string): Promise<void> {
  try {
    const res = await window.api.clipboardCopy(text);
    flashLabel(btn, res.ok ? 'Tersalin' : 'Gagal', back, res.ok);
  } catch {
    flashLabel(btn, 'Gagal', back, false);
  }
}

async function pasteClip(text: string, btn: HTMLButtonElement): Promise<void> {
  try {
    const res = await window.api.clipboardPaste(text);
    flashLabel(btn, res.ok ? 'Ditempel' : 'Gagal', 'Tempel', res.ok);
  } catch {
    flashLabel(btn, 'Gagal', 'Tempel', false);
  }
}

/* Small line icons for the "All panels" grid so the buttons read at a glance
   instead of a wall of words. Same stroke language as the tab strip. */
const PANEL_ICONS: Record<string, string> = {
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18"/>',
  notifications: '<path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9Z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  shelf: '<path d="M3 7h6l2 2h10v10H3z"/>',
  clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9z"/>',
  music: '<circle cx="7" cy="17" r="3"/><circle cx="17" cy="15" r="3"/><path d="M10 17V6l10-2v11"/>',
  today: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 11h16"/>',
  sholat: '<path d="M12 3v4M12 17a5 5 0 0 0 5-5H7a5 5 0 0 0 5 5ZM12 13V7"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4M9 2h6"/>',
  reminders: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  water: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z"/>',
  capture: '<rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="4"/><path d="M9 6l1.5-2h3L15 6"/>',
  controls: '<path d="M4 8h9M19 8h1M4 16h4M12 16h8"/><circle cx="16" cy="8" r="2"/><circle cx="9" cy="16" r="2"/>',
  deck: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
  calls: '<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>',
};

function renderPanels(): void {
  panelsGrid.replaceChildren();
  for (const tab of TABS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pg-tile';
    btn.innerHTML =
      `<svg viewBox="0 0 24 24" aria-hidden="true">${PANEL_ICONS[tab] ?? ''}</svg>` +
      `<span>${tab.charAt(0).toUpperCase() + tab.slice(1)}</span>`;
    btn.addEventListener('click', () => activate(tab));
    panelsGrid.appendChild(btn);
  }
  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'pg-tile pg-settings';
  all.innerHTML =
    `<svg viewBox="0 0 24 24" aria-hidden="true">${PANEL_ICONS.settings}</svg><span>Settings</span>`;
  all.addEventListener('click', () => window.api.openWindow());
  panelsGrid.appendChild(all);
}

function renderTasks(): void {
  if (!card) return;
  taskList.replaceChildren();
  if (card.tasks.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No tasks yet';
    taskList.appendChild(p);
  }
  for (const t of card.tasks) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span class="body"><span class="title"></span></span><span class="time">x</span>`;
    (row.querySelector('.title') as HTMLElement).textContent = t.name;
    (row.querySelector('.time') as HTMLElement).addEventListener('click', () =>
      window.api.patch({ tasks: card!.tasks.filter((x) => x.id !== t.id) }));
    taskList.appendChild(row);
  }
}

function renderTimer(): void {
  if (!timerEndsAt) { timerText.textContent = 'Nothing running yet'; return; }
  const left = Math.max(0, Math.round((timerEndsAt - Date.now()) / 1000));
  timerText.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} tersisa`;
}

function renderCard(state: CardState): void {
  card = state;
  // A brand-new top notice becomes a banner (the full list lives in the card).
  // The first snapshot after boot is absorbed silently (no banner flood).
  const top = state.notices[0];
  if (top && top.id && top.id !== lastNoticeId) {
    const firstSnapshot = lastNoticeId === '';
    lastNoticeId = top.id;
    if (!firstSnapshot) {
      /* Queue regardless of state: the banner queue holds the item until the
         island is in a banner-friendly state, so nothing is lost in mini. */
      enqueueBanner({ app: top.app, title: top.title || top.app, body: top.body, tone: 'notice' });
    }
  }
  renderSites();
  renderNotices();
  renderShelf();
  renderClips();
  renderPanels();
  renderTasks();
  activate(state.lastTab, false);
}

window.api.getState().then(renderCard);
window.api.onState(renderCard);

siteForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const url = siteUrl.value.trim();
  if (!url) return;
  window.api.addSite(siteName.value, url);
  siteName.value = '';
  siteUrl.value = '';
  siteForm.hidden = true;
});

document.getElementById('clearNotices')?.addEventListener('click', () => window.api.clearNotices());
document.getElementById('clearClips')?.addEventListener('click', () => window.api.clearClips());

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('over');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));

dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('over');
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length === 0) return;
  window.api.addShelf(files.map((file) => ({
    name: file.name,
    path: window.api.pathForFile(file),
    size: file.size,
  })));
});

document.addEventListener('click', (event) => {
  const btn = (event.target as HTMLElement).closest<HTMLElement>('[data-settings]');
  if (!btn) return;
  window.api.openSettings(btn.dataset.settings ?? '');
});

taskForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = taskName.value.trim();
  if (!name || !card) return;
  const t = { id: `${Date.now().toString(36)}`, name, done: false };
  window.api.patch({ tasks: [...card.tasks, t] });
  taskName.value = '';
});

timerChips.addEventListener('click', (event) => {
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-min]');
  if (!btn) return;
  timerEndsAt = Date.now() + Number(btn.dataset.min) * 60000;
  renderTimer();
});

document.getElementById('timerStop')?.addEventListener('click', () => {
  timerEndsAt = 0;
  renderTimer();
});

setInterval(() => {
  if (timerEndsAt && root.dataset.state === 'open') renderTimer();
}, 1000);

const statCpu = document.getElementById('statCpu') as HTMLElement;
const statRam = document.getElementById('statRam') as HTMLElement;

async function refreshStats(): Promise<void> {
  try {
    const s = await window.api.getStats();
    statCpu.textContent = s.cpu < 0 ? '-' : `${s.cpu}%`;
    statRam.textContent = `${s.ramUsedMb}/${s.ramTotalMb} MB`;
  } catch { /* window closing */ }
}

setInterval(refreshStats, 1500);
refreshStats();

document.getElementById('cleanRam')?.addEventListener('click', async () => {
  const btn = document.getElementById('cleanRam') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Cleaning...';
  try {
    const res = await window.api.cleanRam();
    btn.textContent = `${res.freedMb} MB freed`;
    window.setTimeout(() => { btn.textContent = 'Clear RAM'; btn.disabled = false; }, 1600);
  } catch {
    btn.textContent = 'Clear RAM';
    btn.disabled = false;
  }
});

document.getElementById('testSpeaker')?.addEventListener('click', () => {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 660;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.65);
  osc.onended = () => ctx.close();
});

root.addEventListener('mouseenter', (e) => {
  hovered = true;
  root.dataset.hovered = 'true';
  window.island.pointer('enter', e.clientY);
});
root.addEventListener('mousemove', (e) => window.island.pointer('move', e.clientY));
root.addEventListener('mouseleave', (e) => {
  hovered = false;
  root.dataset.hovered = 'false';
  window.island.pointer('leave', e.clientY);
});

window.addEventListener('contextmenu', (e) => { e.preventDefault(); });

/* The window can only report pointer events that land inside it. When the
   island floats, the strip between it and the screen edge belongs to no window,
   so the main process polls the cursor and pushes this flag instead. */
window.island.onHover((inside) => {
  hovered = inside;
  root.dataset.hovered = String(inside);
  // Let the reveal fire even if hiddenUntilHover suppressed the paint.
  root.dataset.hoverCue = String(inside);
});

/* ---- music card ----
   Windows does not expose the media session (no SMTC read), so the card shows
   the track name it can see and binds the progress strip to the lyric
   timeline - real, synced data the user controls. */
const musicTitle = document.getElementById('musicTitle') as HTMLElement;
const musicSub = document.getElementById('musicSub') as HTMLElement;
const musicCard = document.getElementById('musicCard') as HTMLDivElement;
const musicProgress = document.getElementById('musicProgress') as HTMLDivElement;
const musicFill = document.getElementById('musicFill') as HTMLDivElement;
const musicTimeCur = document.getElementById('musicTimeCur') as HTMLSpanElement;
const musicTimeEnd = document.getElementById('musicTimeEnd') as HTMLSpanElement;
const musicPlayBtn = document.getElementById('musicPlay') as HTMLButtonElement;
const musicVolSlider = document.getElementById('musicVol') as HTMLInputElement;
const musicArt = document.getElementById('musicArt') as HTMLElement;
const musicViz = document.getElementById('musicViz') as HTMLElement;

document.getElementById('musicPrev')?.addEventListener('click', () => window.api.prevMedia());
document.getElementById('musicNext')?.addEventListener('click', () => window.api.nextMedia());
musicPlayBtn.addEventListener('click', () => {
  const playing = root.dataset.media === 'true';
  if (playing) window.api.pauseMedia(); else window.api.playMedia();
});

let musicVolEstimate = 50;
musicVolSlider.addEventListener('change', () => {
  const target = Number(musicVolSlider.value);
  const delta = target - musicVolEstimate;
  const steps = Math.round(Math.abs(delta) / 2);
  if (steps > 0) window.api.volumeStep(delta > 0 ? 'up' : 'down', steps);
  musicVolEstimate = target;
});

const fmtSec = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Deterministic gradient class per title, so the same song always paints the
    same album-style art (Windows gives us no real cover). */
function artGradientClass(title: string): string {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) | 0;
  return `g${Math.abs(h) % 6}`;
}

function paintMusic(): void {
  const playing = root.dataset.media === 'true';
  const raw = mediaTrack.dataset.title ?? '';
  // "Artist - Song" splits like the reference card; a bare title keeps the
  // generic source line so nothing is invented.
  const sep = raw.indexOf(' - ');
  const song = sep > 0 ? raw.slice(sep + 3).trim() : raw;
  const artist = sep > 0 ? raw.slice(0, sep).trim() : '';
  musicTitle.textContent = playing && song ? song : 'Tidak ada lagu';
  musicSub.textContent = playing ? (artist || 'Pemutar media') : 'Putar musik di pemutar mana pun';
  musicArt.classList.remove('g0', 'g1', 'g2', 'g3', 'g4', 'g5');
  if (playing && song) musicArt.classList.add(artGradientClass(song));
  musicPlayBtn.setAttribute('aria-pressed', String(playing));
  musicCard.dataset.playing = String(playing);
  const vizMode = root.dataset.viz ?? 'pixels';
  mediaViz.setAttribute('data-viz', vizMode);
  musicViz.setAttribute('data-viz', vizMode);
  musicProgress.setAttribute('data-style', root.dataset.musicProgress ?? 'Simple');
  musicArt.dataset.bg = root.dataset.musicBg ?? 'album';

  const snap = (window as unknown as {
    aeoliaLyricNow?: () => { text: string; at: number; total: number; running: boolean };
  }).aeoliaLyricNow?.();
  const hasLyric = snap && snap.total > 0;
  const pct = hasLyric ? Math.max(0, Math.min(100, (snap!.at / snap!.total) * 100)) : 0;
  musicFill.style.width = `${pct}%`;
  // Song shape knob and Hearts mask are driven by one custom property because
  // CSP blocks inline style attributes on markup.
  musicProgress.style.setProperty('--mp-pct', pct.toFixed(1));
  musicProgress.dataset.empty = String(!hasLyric);
  musicTimeCur.textContent = hasLyric ? fmtSec(snap!.at) : '0:00';
  // Right side shows what is LEFT of the lyric timeline, like the reference.
  musicTimeEnd.textContent = hasLyric ? `-${fmtSec(Math.max(0, snap!.total - snap!.at))}` : '--:--';
  if (!hasLyric) {
    musicProgress.title = 'Progress mengikuti lirik LRC. Tambahkan lirik di Settings > Music.';
  } else {
    musicProgress.removeAttribute('title');
  }

  // Pill lyric line: only in pill state, only when enabled, only while playing.
  const wantPillLyric = root.dataset.pillLyrics === 'true'
    && playing && root.dataset.state !== 'open' && Boolean(snap?.text);
  mediaLyric.hidden = !wantPillLyric;
  if (wantPillLyric && mediaLyric.textContent !== snap!.text) {
    mediaLyric.textContent = snap!.text;
  }
}

setInterval(() => {
  if (root.dataset.state === 'open' || root.dataset.media === 'true') paintMusic();
}, 500);

window.api.getSettings().then((s) => {
  if (Array.isArray(s.barOrder) && s.barOrder.length) { barOrder = s.barOrder; applyBarOrder(); }
  root.dataset.viz = (s as IslandSettings).visualizer ?? 'pixels';
  root.dataset.musicBg = (s as IslandSettings).musicCardBackground ?? 'album';
  root.dataset.pillLyrics = String(Boolean((s as IslandSettings).pillLyrics));
  root.dataset.musicProgress = (s as IslandSettings).musicCardProgress ?? 'Wave';
  updateTabArrows();
}).catch(() => { /* not ready yet */ });
