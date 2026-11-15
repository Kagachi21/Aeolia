/* QA Yan - renderer + Settings runtime probe on REAL Electron BrowserWindows.
   Own assertions: exact tab membership & order, real hit tests, native drag,
   clipboard success/failure feedback, CSS corners, cat stability, keyboard
   access, old-feature regressions, antislop. Run:
     env -u ELECTRON_RUN_AS_NODE electron.exe _qa-ui.js
*/
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const root = __dirname;
const ALL = ['web', 'notifications', 'shelf', 'clipboard', 'music', 'today',
  'sholat', 'timer', 'reminders', 'water', 'capture', 'controls', 'deck', 'calls'];

const initial = {
  status: {
    state: 'open', accent: '#e9eef7', surface: 'Black', cardWidth: 360,
    visibleTabs: [...ALL], miniMode: 'clock', meetingMicButton: true,
    media: false, word: false, hiddenUntilHover: false, openAction: 'last',
    meeting: false, mediaTitle: '',
  },
  settings: {
    visibleTabs: [...ALL], islandStyle: 'dynamic', islandContent: 'clock-robot',
    catGreeting: true, catIdleCenter: true, islandScale: 'auto', glassLevel: 55,
    barOrder: ['clock', 'cat', 'battery', 'media', 'mic'],
  },
  card: { lastTab: 'clipboard', clips: [], notices: [], sites: [], shelf: [], tasks: [] },
};

const results = [];
const consoleMessages = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);

function makeWindow(width, height) {
  const win = new BrowserWindow({
    width, height, frame: false, show: true, backgroundColor: '#17191d',
    webPreferences: {
      preload: path.join(root, '_qa-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.on('console-message', (_e, level, message) => {
    consoleMessages.push({ level, message });
  });
  return win;
}

async function key(win, name) {
  const spec = {
    Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 },
    Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' },
    Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, text: ' ' },
  }[name];
  try {
    const dbg = win.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...spec });
    await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...spec });
  } catch (err) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: name === 'Space' ? 'Space' : name });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: name === 'Space' ? 'Space' : name });
  }
  await sleep(80);
}

const LAYOUT = `(() => {
  const tabs = document.getElementById('tabs');
  const scroll = document.getElementById('tabsScroll');
  const settings = document.querySelector('.tab-settings');
  const grid = document.querySelector('.tab-grid');
  const tr = tabs.getBoundingClientRect();
  const sr = settings.getBoundingClientRect();
  const gr = grid.getBoundingClientRect();
  const hit = (el, r) => {
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!at && (at === el || el.contains(at));
  };
  return {
    visibleTabs: Array.from(document.querySelectorAll('#tabsScroll .tab'))
      .filter((b) => !b.hidden && b.getBoundingClientRect().width > 0).map((b) => b.dataset.tab),
    settingsVisible: getComputedStyle(settings).display !== 'none' && sr.width > 0,
    gridVisible: getComputedStyle(grid).display !== 'none' && gr.width > 0,
    settingsInside: sr.left >= tr.left - 1 && sr.right <= tr.right + 1,
    gridInside: gr.left >= tr.left - 1 && gr.right <= tr.right + 1,
    settingsHit: hit(settings, sr), gridHit: hit(grid, gr),
    settingsPinned: !scroll.contains(settings) && tabs.contains(settings),
    gridPinned: !scroll.contains(grid) && tabs.contains(grid),
    overflows: scroll.scrollWidth > scroll.clientWidth + 1,
  };
})()`;

async function rendererProbe() {
  const win = makeWindow(360, 470);
  await win.loadFile(path.join(root, 'dist', 'renderer', 'index.html'));
  /* Force the initial status paint: the preload's startup emit can race the
     renderer's listener registration, which would leave #open hidden. */
  await js(win, `window.probe.emit('status', window.probe.data().status); true`);
  await sleep(260);

  /* greeting must be alive for 1.5 s, then settle */
  const early = await js(win, `(() => { const r = document.getElementById('island');
    return { greeting: r.dataset.greeting, catPos: r.dataset.catPos, state: r.dataset.state }; })()`);
  check('Regresi greeting 1,5 detik: kucing mulai di tengah',
    early.greeting === 'true' && early.catPos === 'center', JSON.stringify(early));
  await sleep(1550);
  const settled = await js(win, `(() => { const r = document.getElementById('island');
    return { greeting: r.dataset.greeting, catPos: r.dataset.catPos }; })()`);
  check('Regresi greeting selesai lalu kucing pindah ke kanan',
    settled.greeting === 'false' && settled.catPos === 'right', JSON.stringify(settled));

  const structure = await js(win, `(() => {
    const scroll = document.getElementById('tabsScroll');
    return { panelTabs: scroll.querySelectorAll('.tab').length,
      panels: document.querySelectorAll('.panel').length,
      pinned: !!document.querySelector('.tab-settings') && !!document.querySelector('.tab-grid') };
  })()`);
  check('Bar tab punya 14 tab panel + kontrol pinned (grid, Settings)',
    structure.panelTabs === 14 && structure.pinned && structure.panels >= 15, JSON.stringify(structure));

  const all360 = await js(win, LAYOUT);
  check('Bug3 14 tab @360px: semua tampil, Settings+grid reachable & bisa diklik (hit test)',
    all360.visibleTabs.length === 14 && all360.settingsVisible && all360.gridVisible
      && all360.settingsInside && all360.gridInside && all360.settingsHit && all360.gridHit
      && all360.settingsPinned && all360.gridPinned,
    JSON.stringify(all360));

  win.setSize(320, 470);
  await sleep(200);
  const all320 = await js(win, LAYOUT);
  check('Bug3 14 tab @320px: strip scroll, Settings+grid tetap di dalam & bisa diklik',
    all320.visibleTabs.length === 14 && all320.settingsVisible && all320.gridVisible
      && all320.settingsInside && all320.gridInside && all320.settingsHit && all320.gridHit
      && all320.overflows,
    JSON.stringify(all320));
  win.setSize(360, 470);
  await sleep(160);

  const emitStatus = (payload) => js(win, `window.probe.emit('status', ${JSON.stringify(payload)}); true`);
  await emitStatus({ state: 'open', visibleTabs: [] });
  await sleep(90);
  const empty = await js(win, LAYOUT);
  check('Bug3 visibleTabs=[] menyembunyikan 0 tab panel, kontrol pinned tetap aktif',
    empty.visibleTabs.length === 0 && empty.settingsVisible && empty.gridVisible
      && empty.settingsHit && empty.gridHit, JSON.stringify(empty));

  await emitStatus({ state: 'open', visibleTabs: ['clipboard'] });
  await sleep(90);
  const single = await js(win, LAYOUT);
  check('Bug3 1 tab: keanggotaan EKSAK (tepat tab itu saja)',
    single.visibleTabs.length === 1 && single.visibleTabs[0] === 'clipboard'
      && single.settingsHit && single.gridHit, JSON.stringify(single));

  await emitStatus({ state: 'open', visibleTabs: [...ALL].reverse() });
  await sleep(90);
  const reordered = await js(win, LAYOUT);
  check('Bug3 urutan saved permutation benar-benar dipakai DOM (14 tab dibalik)',
    reordered.visibleTabs.length === 14
      && JSON.stringify(reordered.visibleTabs) === JSON.stringify([...ALL].reverse()),
    JSON.stringify(reordered.visibleTabs));

  await emitStatus({ state: 'open', visibleTabs: ['web', '__evil__', 'clipboard'] });
  await sleep(90);
  const foreign = await js(win, LAYOUT);
  check('Bug3 token asing diabaikan (keanggotaan eksak)',
    JSON.stringify(foreign.visibleTabs) === '["web","clipboard"]', JSON.stringify(foreign.visibleTabs));

  await js(win, `window.probe.emit('status', { state: 'open', visibleTabs: undefined }); true`);
  await sleep(90);
  const missing = await js(win, LAYOUT);
  await js(win, `window.probe.emit('status', { state: 'open', visibleTabs: 'oops' }); true`);
  await sleep(90);
  const malformed = await js(win, LAYOUT);
  check('Bug3 visibleTabs hilang/rusak fallback ke semua 14 tab (tidak crash)',
    missing.visibleTabs.length === 14 && malformed.visibleTabs.length === 14,
    `missing=${missing.visibleTabs.length} malformed=${malformed.visibleTabs.length}`);

  /* real drag reorder */
  await emitStatus({ state: 'open', visibleTabs: ['web', 'notifications', 'shelf', 'clipboard', 'music'] });
  await sleep(90);
  await js(win, `window.probe.clear(); true`);
  const drag = await js(win, `(() => {
    const dt = new DataTransfer();
    const from = document.querySelector('#tabsScroll .tab[data-tab="web"]');
    const to = document.querySelector('#tabsScroll .tab[data-tab="shelf"]');
    if (!from || !to) return { ok: false };
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    from.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return { ok: true };
  })()`);
  await sleep(120);
  const dragCalls = await js(win, `window.probe.calls().filter((c) => c.kind === 'setSetting' && c.payload.key === 'visibleTabs')`);
  const dragOrder = await js(win, `Array.from(document.querySelectorAll('#tabsScroll .tab')).filter((b) => !b.hidden).map((b) => b.dataset.tab)`);
  check('Bug3 drag event asli persist permutasi & DOM ikut berubah',
    drag.ok && dragCalls.length === 1 && Array.isArray(dragCalls[0].payload.value)
      && dragCalls[0].payload.value[0] !== 'web'
      && dragCalls[0].payload.value.join(',') === dragOrder.join(','),
    JSON.stringify({ drag, value: dragCalls[0] && dragCalls[0].payload.value, dragOrder }));

  /* pinned controls really fire their actions even with 0 panel tabs */
  await emitStatus({ state: 'open', visibleTabs: [] });
  await sleep(90);
  await js(win, `window.probe.clear(); true`);
  const pinnedClicks = await js(win, `(() => {
    document.querySelector('.tab-settings').click();
    document.querySelector('.tab-grid').click();
    return true;
  })()`);
  const pinnedCalls = await js(win, `window.probe.calls().map((c) => c.kind)`);
  const gridPanel = await js(win, `!!document.querySelector('.panel[data-panel="panels"].active')`);
  check('Bug3 tombol Settings & grid benar-benar bisa diklik walau 0 tab dipilih',
    pinnedClicks && pinnedCalls.includes('openWindow') && gridPanel,
    JSON.stringify({ pinnedCalls, gridPanel }));

  /* ---- Bug4: separation, hints, feedback ---- */
  await js(win, `window.probe.emit('card', {
    clips: [{ id: 'c1', kind: 'text', text: 'QA-COPIED-ALPHA', at: Date.now() }],
    notices: [{ id: 'n1', app: 'Zoom', title: 'Rapat mulai', body: 'Standup', at: Date.now() }]
  }); true`);
  await sleep(110);
  const separation = await js(win, `(() => ({
    notice: document.getElementById('noticeList').textContent,
    clip: document.getElementById('clipList').textContent,
    noticeHint: document.getElementById('noticeHint').textContent,
    clipHint: document.getElementById('clipHint').textContent,
    acts: Array.from(document.querySelectorAll('#clipList .clip-act')).map((b) => ({
      label: b.textContent.trim(), tag: b.tagName, cursor: getComputedStyle(b).cursor,
      aria: b.getAttribute('aria-label'), live: b.getAttribute('aria-live') })),
  }))()`);
  check('Bug4 notifikasi aplikasi & teks salin terpisah + hint eksplisit',
    separation.notice.includes('Rapat mulai') && !separation.notice.includes('QA-COPIED-ALPHA')
      && separation.clip.includes('QA-COPIED-ALPHA')
      && separation.noticeHint.includes('Clipboard') && separation.clipHint.includes('Salin'),
    JSON.stringify(separation));
  check('Bug4 tombol Salin/Tempel native, aria-live polite, cursor pointer',
    separation.acts.length === 2
      && separation.acts.some((a) => a.label === 'Salin') && separation.acts.some((a) => a.label === 'Tempel')
      && separation.acts.every((a) => a.tag === 'BUTTON' && a.cursor === 'pointer'
        && a.live === 'polite' && a.aria.length > 0),
    JSON.stringify(separation.acts));

  await js(win, `window.probe.clear(); true`);
  await js(win, `(() => { const a = Array.from(document.querySelectorAll('#clipList .clip-act'));
    a.find((b) => b.textContent.trim() === 'Salin').click();
    a.find((b) => b.textContent.trim() === 'Tempel').click(); return true; })()`);
  await sleep(90);
  const okFeedback = await js(win, `Array.from(document.querySelectorAll('#clipList .clip-act')).map((b) => ({
    label: b.textContent.trim(), done: b.classList.contains('done'), fail: b.classList.contains('fail') }))`);
  const okCalls = await js(win, `window.probe.calls().filter((c) => c.kind === 'clipboardCopy' || c.kind === 'clipboardPaste').map((c) => c.kind)`);
  check('Bug4 feedback Tersalin / Ditempel + kelas .done + IPC nyata',
    okFeedback.some((b) => b.label === 'Tersalin' && b.done && !b.fail)
      && okFeedback.some((b) => b.label === 'Ditempel' && b.done && !b.fail)
      && okCalls.includes('clipboardCopy') && okCalls.includes('clipboardPaste'),
    JSON.stringify({ okFeedback, okCalls }));

  const failColor = await js(win, `getComputedStyle(document.querySelector('#clipList .clip-act')).color`);
  await js(win, `window.probe.flags({ failCopy: true, throwPaste: true });
    window.probe.emit('card', { clips: [{ id: 'c2', kind: 'text', text: 'QA-COPIED-BETA', at: Date.now() }], notices: [] }); true`);
  await sleep(110);
  await js(win, `(() => { const a = Array.from(document.querySelectorAll('#clipList .clip-act'));
    a.find((b) => b.textContent.trim() === 'Salin').click();
    a.find((b) => b.textContent.trim() === 'Tempel').click(); return true; })()`);
  await sleep(90);
  const badFeedback = await js(win, `(() => ({ labels: Array.from(document.querySelectorAll('#clipList .clip-act')).map((b) => ({
    label: b.textContent.trim(), done: b.classList.contains('done'), fail: b.classList.contains('fail'),
    color: getComputedStyle(b).color })) }))()`);
  check('Bug4 jalur Gagal: label, kelas .fail, warna CSS berubah (empty/error state bermakna)',
    badFeedback.labels.filter((b) => b.label === 'Gagal' && b.fail && !b.done).length === 2
      && badFeedback.labels.every((b) => b.color !== failColor),
    JSON.stringify({ before: failColor, badFeedback }));
  await sleep(1300);
  const restoredLabels = await js(win, `Array.from(document.querySelectorAll('#clipList .clip-act')).map((b) => b.textContent.trim())`);
  check('Bug4 label kembali ke Salin / Tempel setelah 1,2 detik',
    restoredLabels.includes('Salin') && restoredLabels.includes('Tempel'), JSON.stringify(restoredLabels));
  await js(win, `window.probe.flags({ failCopy: false, throwPaste: false }); true`);

  await js(win, `window.probe.emit('card', { clips: [], notices: [] }); true`);
  await sleep(100);
  const emptyStates = await js(win, `(() => ({
    notice: document.querySelector('#noticeList .empty')?.textContent ?? '',
    clip: document.querySelector('#clipList .empty')?.textContent ?? '',
  }))()`);
  check('Bug4 empty state jujur (notifikasi aplikasi vs teks salin)',
    emptyStates.notice.includes('Clipboard') && emptyStates.clip.toLowerCase().includes('teks')
      && emptyStates.clip.length > 20, JSON.stringify(emptyStates));

  /* ---- Bug1 CSS corners ---- */
  await js(win, `window.probe.emit('settings', { islandStyle: 'notched' });
    window.probe.emit('status', { state: 'pill', visibleTabs: [] }); true`);
  await sleep(680);
  const notchedCss = await js(win, `(() => { const cs = getComputedStyle(document.getElementById('island'));
    return { dataset: document.getElementById('island').dataset.islandStyle,
      topLeft: cs.borderTopLeftRadius, bottomLeft: cs.borderBottomLeftRadius }; })()`);
  check('Bug1 CSS notched: sudut atas 0px, sudut bawah tetap membulat',
    notchedCss.dataset === 'notched' && parseFloat(notchedCss.topLeft) === 0
      && parseFloat(notchedCss.bottomLeft) > 0, JSON.stringify(notchedCss));
  await js(win, `window.probe.emit('settings', { islandStyle: 'dynamic' }); true`);
  await sleep(680);
  const dynamicCss = await js(win, `getComputedStyle(document.getElementById('island')).borderTopLeftRadius`);
  check('Bug1 CSS dynamic: sudut atas 14px', parseFloat(dynamicCss) === 14, String(dynamicCss));

  /* ---- Bug5 data-cat-pos stability (count real DOM writes) ---- */
  await js(win, `(() => {
    window.__catWrites = 0;
    new MutationObserver((ms) => { for (const m of ms) if (m.attributeName === 'data-cat-pos') window.__catWrites++; })
      .observe(document.getElementById('island'), { attributes: true, attributeFilter: ['data-cat-pos'] });
    return true;
  })()`);
  await js(win, `(() => { for (let i = 0; i < 20; i++)
    window.probe.emit('robot', { idle: false, batteryPercent: 80, charging: false, cursorDx: 0 });
    return true; })()`);
  await sleep(120);
  const catWrites = await js(win, `window.__catWrites`);
  check('Bug5 20 robot state identik tanpa aksi user menulis data-cat-pos 0 kali',
    catWrites === 0, `writes=${catWrites}`);

  /* ---- banner: meeting edge shows banner, then notice banner, auto-hide ----
     Runs BEFORE the mic tests so the banner queue starts empty (each meeting
     rising edge queues its own banner; FIFO). */
  await js(win, `window.probe.emit('status', { state: 'pill', meeting: true, meetingApp: 'Discord' }); true`);
  await sleep(150);
  const bannerMeet = await js(win, `(() => { const r = document.getElementById('island');
    const b = document.getElementById('banner');
    return { banner: r.dataset.banner, hidden: b ? b.hidden : null, tone: r.dataset.bannerTone,
      title: b ? b.querySelector('.bn-title').textContent : '', pillHidden: getComputedStyle(document.getElementById('pill')).opacity }; })()`);
  check('meeting edge: banner tampil (tone meeting, pill tertutup)',
    bannerMeet.banner === 'true' && bannerMeet.hidden === false && bannerMeet.tone === 'meeting'
      && bannerMeet.title.includes('Meeting mode') && bannerMeet.pillHidden === '0', JSON.stringify(bannerMeet));
  await sleep(4600);
  const bannerGone = await js(win, `(() => ({ banner: document.getElementById('island').dataset.banner,
    hidden: document.getElementById('banner').hidden }))()`);
  check('banner meeting auto-hide setelah 4,2 detik',
    bannerGone.banner === 'false' && bannerGone.hidden === true, JSON.stringify(bannerGone));
  await js(win, `window.probe.emit('card', { notices: [{ id: 'bn1', app: 'WhatsApp', title: 'Bila', body: 'duren', at: ${Date.now()} }] }); true`);
  await sleep(200);
  const bannerNotice = await js(win, `(() => { const r = document.getElementById('island');
    const b = document.getElementById('banner');
    return { tone: r.dataset.bannerTone, title: b.querySelector('.bn-title').textContent,
      body: b.querySelector('.bn-body').textContent }; })()`);
  check('notifikasi baru muncul sebagai banner (avatar + judul + isi)',
    bannerNotice.tone === 'notice' && bannerNotice.title === 'Bila' && bannerNotice.body === 'duren',
    JSON.stringify(bannerNotice));

  /* ---- banner TIDAK menimpa notch mini: antrean menunggu state pill ---- */
  await js(win, `window.probe.emit('status', { state: 'mini', miniMode: 'clock' }); true`);
  await sleep(4600);                       // drain the bn1 notice banner first
  await js(win, `window.probe.emit('card', { notices: [{ id: 'bn2', app: 'Telegram', title: 'Obet', body: 'pesan saat notch', at: ${Date.now()} }] }); true`);
  await sleep(250);
  const bannerMini = await js(win, `(() => { const r = document.getElementById('island');
    const b = document.getElementById('banner');
    return { state: r.dataset.state, banner: r.dataset.banner, hidden: b.hidden,
      clock: getComputedStyle(document.querySelector('.mini-clock')).display }; })()`);
  check('notifikasi saat notch mini: banner TIDAK menimpa mini (jam tetap)',
    bannerMini.state === 'mini' && bannerMini.banner !== 'true' && bannerMini.hidden === true
      && bannerMini.clock !== 'none',
    JSON.stringify(bannerMini));
  await js(win, `window.probe.emit('status', { state: 'pill' }); true`);
  await sleep(900);
  const bannerAfterPeek = await js(win, `(() => { const r = document.getElementById('island');
    const b = document.getElementById('banner');
    return { state: r.dataset.state, banner: r.dataset.banner, hidden: b.hidden,
      body: b.querySelector('.bn-body').textContent }; })()`);
  check('antrean banner tidak hilang: tampil begitu island peek/pill',
    bannerAfterPeek.state === 'pill' && bannerAfterPeek.banner === 'true'
      && bannerAfterPeek.hidden === false && bannerAfterPeek.body === 'pesan saat notch',
    JSON.stringify(bannerAfterPeek));

  await js(win, `window.probe.emit('card', { notices: [] }); true`);
  await js(win, `window.probe.emit('status', { state: 'pill', meeting: false }); true`);
  await sleep(4600);

  /* ---- lirik otomatis: event lyrics -> timeline lirik jalan sendiri ---- */
  await js(win, `window.probe.emit('lyrics', { title: 'Kavi Rao - Neon Harbor', lrc: '[00:01.00] baris satu\\n[00:04.00] baris dua' }); true`);
  await sleep(150);
  const autoLyr = await js(win, `(() => { const snap = window.aeoliaLyricNow ? window.aeoliaLyricNow() : null;
    return { total: snap ? snap.total : -1, running: snap ? snap.running : null,
      meta: document.getElementById('lyricMeta').textContent }; })()`);
  check('lirik otomatis: LRC masuk timeline, total>0, auto berjalan',
    autoLyr.total === 4 && autoLyr.running === true, JSON.stringify(autoLyr));
  await js(win, `window.probe.emit('lyrics', { title: 'Lagu Lain', lrc: null }); true`);
  await sleep(120);
  const autoNone = await js(win, `document.querySelector('.lyric-empty') ? document.querySelector('.lyric-empty').textContent : ''`);
  check('lirik otomatis tidak ketemu: pesan jujur tampil',
    autoNone.includes('tidak ditemukan'), String(autoNone));

  /* ---- klik notch mini: expand lewat IPC island:open ---- */
  await js(win, `window.probe.emit('status', { state: 'mini', miniMode: 'clock' }); true`);
  await sleep(120);
  await js(win, `document.getElementById('mini').click(); true`);
  await sleep(120);
  const openCalls = await js(win, `window.probe.calls().filter((c) => c.kind === 'islandOpen').length`);
  check('klik notch mini memanggil island:open (expand)', openCalls >= 1, String(openCalls));
  /* In production the peek already flipped state to pill, so the click lands
     on #pill, not #mini. The pill must open the card too. */
  await js(win, `document.getElementById('pill').click(); true`);
  await sleep(120);
  const openCalls2 = await js(win, `window.probe.calls().filter((c) => c.kind === 'islandOpen').length`);
  check('klik pill (hasil peek) juga memanggil island:open', openCalls2 >= 2, String(openCalls2));
  await js(win, `window.probe.emit('status', { state: 'pill', meeting: false }); true`);
  await sleep(4600);

  /* ---- mic pill: separate layer, joining -> on, hidden when idle ---- */
  const micIdle = await js(win, `(() => { const p = document.getElementById('micPill');
    return { exists: !!p, hidden: p ? p.hidden : null, mic: document.getElementById('island').dataset.mic }; })()`);
  check('micPill ada di DOM, tersembunyi saat idle, data-mic off',
    micIdle.exists && micIdle.hidden === true && micIdle.mic === 'off', JSON.stringify(micIdle));
  await js(win, `window.probe.emit('status', { state: 'pill', meeting: true, meetingMicButton: true }); true`);
  await sleep(120);
  const micJoin = await js(win, `(() => ({ hidden: document.getElementById('micPill').hidden,
    mic: document.getElementById('island').dataset.mic }))()`);
  check('rapat terdeteksi: micPill tampil dengan status joining',
    micJoin.hidden === false && micJoin.mic === 'joining', JSON.stringify(micJoin));
  await sleep(1500);
  const micOn = await js(win, `document.getElementById('island').dataset.mic`);
  check('setelah 1,4 detik joining -> on (titik hijau)', micOn === 'on', String(micOn));
  await js(win, `window.probe.emit('status', { state: 'pill', meeting: false }); true`);
  await sleep(120);
  const micOff = await js(win, `(() => ({ hidden: document.getElementById('micPill').hidden,
    mic: document.getElementById('island').dataset.mic }))()`);
  check('rapat selesai: micPill kembali tersembunyi (tidak ada hantu joining)',
    micOff.hidden === true && micOff.mic === 'off', JSON.stringify(micOff));
  await js(win, `window.probe.emit('status', { state: 'pill', meeting: false, meetingMicButton: true }); true`);

  /* ---- tombol mic = mute asli, tombol kamera = shortcut per app ---- */
  await js(win, `window.probe.emit('status', { state: 'pill', meeting: true, meetingMicButton: true }); true`);
  await sleep(120);
  await js(win, `document.getElementById('meetingMic').click(); true`);
  await sleep(120);
  const micClick = await js(win, `(() => ({ muted: document.getElementById('island').dataset.micMuted,
    calls: window.probe.calls().filter((c) => c.kind === 'micMuteToggle').length,
    oldVol: window.probe.calls().filter((c) => c.kind === 'toggleMute').length }))()`);
  check('klik tombol mic: mute asli via mic:mute-toggle (bukan volume)',
    micClick.calls === 1 && micClick.muted === 'true' && micClick.oldVol === 0, JSON.stringify(micClick));
  const camBtn = await js(win, `(() => { const b = document.getElementById('meetingCam');
    if (!b) return { exists: false };
    b.click(); return { exists: true }; })()`);
  await sleep(120);
  const camClick = await js(win, `(() => ({ calls: window.probe.calls().filter((c) => c.kind === 'camToggle').length }))()`);
  check('tombol kamera ada di mic pill dan memanggil cam:toggle',
    camBtn.exists === true && camClick.calls === 1, JSON.stringify({ camBtn, camClick }));
  await js(win, `window.probe.emit('status', { state: 'pill', meeting: false }); true`);
  await sleep(120);

  /* ---- regresi 2026-11-15: [hidden] harus MENANG atas display dari id ----
     #micPill dan #banner dulu memakai selector id yang membawa display:flex,
     jadi aturan UA [hidden] { display: none } kalah dan layer tetap terlukis
     (kartu mic hantu + teks banner terakhir menempel di pill). Sekarang
     display hanya ada di :not([hidden]), dan #micPill adalah SAUDARA #island
     supaya badan island bisa menyusut tanpa memotong kapsul. */
  /* The meeting edge above queues a banner for 4,2 s; wait for the queue to
     drain so the "idle" snapshot really is idle. */
  for (let i = 0; i < 40; i += 1) {
    const bannerHidden = await js(win, `document.getElementById('banner').hidden`);
    if (bannerHidden) break;
    await sleep(250);
  }
  const hiddenWins = await js(win, `(() => {
    const mic = document.getElementById('micPill');
    const banner = document.getElementById('banner');
    const island = document.getElementById('island');
    return {
      state: island.dataset.state, meeting: island.dataset.meeting, mic: island.dataset.mic,
      micHidden: mic.hidden, micDisplay: getComputedStyle(mic).display,
      bannerHidden: banner.hidden, bannerDisplay: getComputedStyle(banner).display,
      micBg: getComputedStyle(mic).backgroundColor,
      micSibling: mic.parentElement === island.parentElement,
      micInsideIsland: island.contains(mic),
    };
  })()`);
  check('regresi: [hidden] menang -> micPill display:none saat idle (dulu flex)',
    hiddenWins.micHidden === true && hiddenWins.micDisplay === 'none', JSON.stringify(hiddenWins));
  check('regresi: [hidden] menang -> banner display:none saat idle (dulu flex)',
    hiddenWins.bannerHidden === true && hiddenWins.bannerDisplay === 'none',
    JSON.stringify({ hidden: hiddenWins.bannerHidden, display: hiddenWins.bannerDisplay }));
  check('regresi: micPill SAUDARA #island, bukan anak (badan bisa menyusut)',
    hiddenWins.micSibling === true && hiddenWins.micInsideIsland === false,
    JSON.stringify({ sibling: hiddenWins.micSibling, inside: hiddenWins.micInsideIsland }));
  check('regresi: micPill tidak melukis kartu (background transparan)',
    hiddenWins.micBg === 'rgba(0, 0, 0, 0)' || hiddenWins.micBg === 'transparent',
    hiddenWins.micBg);

  /* The real failure mode: an id-level display rule outranks [hidden]. Toggle
     the attribute on the VISIBLE layer - the layer must go display:none even
     though its own rule asks for flex. */
  await js(win, `window.probe.emit('status', { state: 'pill', meeting: true, meetingMicButton: true }); true`);
  await sleep(220);
  const toggleHidden = await js(win, `(() => {
    const mic = document.getElementById('micPill');
    const island = document.getElementById('island');
    const shown = getComputedStyle(mic).display;
    mic.hidden = true;
    const forced = getComputedStyle(mic).display;   // style recalc is forced here
    mic.hidden = false;
    const restored = getComputedStyle(mic).display;
    const cs = getComputedStyle(island);
    return { shown, forced, restored, bg: getComputedStyle(mic).backgroundColor,
      pos: island.dataset.pos, islandRight: cs.right, islandLeft: cs.left,
      extra: cs.getPropertyValue('--mic-extra').trim() };
  })()`);
  check('regresi: set hidden pada layer yang tampil -> langsung display:none',
    toggleHidden.shown === 'flex' && toggleHidden.forced === 'none'
      && toggleHidden.restored === 'flex', JSON.stringify(toggleHidden));
  check('regresi: micPill tampil tetap transparan (kapsul saja yang terlukis)',
    toggleHidden.bg === 'rgba(0, 0, 0, 0)' || toggleHidden.bg === 'transparent',
    toggleHidden.bg);
  check('regresi: rapat (center) -> #island memberi strip kanan (right = --mic-extra)',
    toggleHidden.pos === 'center' && toggleHidden.islandRight === toggleHidden.extra
      && toggleHidden.islandRight !== '0px' && toggleHidden.islandLeft === '0px',
    JSON.stringify({ pos: toggleHidden.pos, right: toggleHidden.islandRight, left: toggleHidden.islandLeft, extra: toggleHidden.extra }));

  /* Same reservation on a left island (no side flip: the strip stays right). */
  await js(win, `window.probe.emit('settings', { islandPosition: 'left' }); true`);
  await sleep(200);
  const leftInset = await js(win, `(() => { const island = document.getElementById('island');
    const cs = getComputedStyle(island);
    return { pos: island.dataset.pos, right: cs.right, left: cs.left,
      extra: cs.getPropertyValue('--mic-extra').trim() }; })()`);
  check('regresi: rapat (left) -> strip kanan tetap dipesan',
    leftInset.pos === 'left' && leftInset.right === leftInset.extra && leftInset.right !== '0px',
    JSON.stringify(leftInset));

  /* Right-hand island flips the reservation to the left side. */
  await js(win, `window.probe.emit('settings', { islandPosition: 'right' }); true`);
  await sleep(200);
  const rightInset = await js(win, `(() => { const island = document.getElementById('island');
    const cs = getComputedStyle(island);
    return { pos: island.dataset.pos, right: cs.right, left: cs.left,
      extra: cs.getPropertyValue('--mic-extra').trim() }; })()`);
  check('regresi: rapat (right) -> strip pindah ke kiri (left = --mic-extra, right = 0)',
    rightInset.pos === 'right' && rightInset.left === rightInset.extra
      && rightInset.right === '0px' && rightInset.left !== '0px',
    JSON.stringify(rightInset));
  await js(win, `window.probe.emit('settings', { islandPosition: 'center' }); true`);
  await js(win, `window.probe.emit('status', { state: 'pill', meeting: false }); true`);
  await sleep(200);

  /* ---- glass themes: --glass-a var follows glassLevel ---- */
  await js(win, `window.probe.emit('settings', { surface: 'Translucent', glassLevel: 70 }); true`);
  await sleep(120);
  const glass = await js(win, `(() => { const r = document.getElementById('island');
    return { surface: r.dataset.surface, a: r.style.getPropertyValue('--glass-a') }; })()`);
  check('Translucent terpilih + --glass-a = 0.7 dari glassLevel',
    glass.surface === 'Translucent' && glass.a === '0.7', JSON.stringify(glass));
  await js(win, `window.probe.emit('settings', { surface: 'Black', glassLevel: 55 }); true`);

  /* ---- notice reply: chat rows get an inline, honest reply flow ---- */
  await js(win, `window.probe.emit('card', { notices: [{ id: 'rp1', app: 'WhatsApp', title: 'Bila', body: 'duren :)', at: ${Date.now()} }] }); true`);
  await sleep(140);
  const replyFlow = await js(win, `(() => {
    const row = Array.from(document.querySelectorAll('#noticeList .notice-row'))
      .find((r) => r.querySelector('.title')?.textContent === 'Bila');
    if (!row) return { found: false };
    const toggle = row.querySelector('.notice-reply-toggle');
    if (!toggle) return { found: true, toggle: false };
    toggle.click();
    const input = row.querySelector('.notice-reply-input');
    input.value = 'oke bentar';
    row.querySelector('.notice-reply-send').click();
    return { found: true, toggle: true, openedInput: !row.querySelector('.notice-reply').hidden };
  })()`);
  await sleep(120);
  const replyAfter = await js(win, `(() => {
    const row = Array.from(document.querySelectorAll('#noticeList .notice-row'))
      .find((r) => r.querySelector('.title')?.textContent === 'Bila');
    return { note: row?.querySelector('.notice-reply-note')?.textContent ?? '',
      calls: window.probe.calls().filter((c) => c.kind === 'noticeReply') };
  })()`);
  check('balas notifikasi WhatsApp: input muncul, kirim -> clipboard + catatan jujur',
    replyFlow.found && replyFlow.toggle && replyFlow.openedInput
      && replyAfter.calls.length === 1 && replyAfter.calls[0].payload.text === 'oke bentar'
      && replyAfter.note.includes('disalin'), JSON.stringify({ replyFlow, note: replyAfter.note }));
  await js(win, `window.probe.emit('card', { notices: [] }); true`);

  /* ---- regression: old features still alive ---- */
  await js(win, `window.probe.emit('status', { state: 'mini', miniMode: 'clock-date' }); true`);
  await sleep(90);
  const miniDate = await js(win, `(() => ({ clock: getComputedStyle(document.getElementById('miniClock')).display,
    date: getComputedStyle(document.getElementById('miniDate')).display,
    cat: getComputedStyle(document.querySelector('#mini .cat-slot')).display }))()`);
  check('Regresi mini mode clock-date menampilkan jam+tanggal, kucing disembunyikan',
    miniDate.clock !== 'none' && miniDate.date !== 'none' && miniDate.cat === 'none', JSON.stringify(miniDate));
  await js(win, `window.probe.emit('status', { state: 'mini', miniMode: 'cat' }); true`);
  await sleep(90);
  const miniCat = await js(win, `(() => ({ clock: getComputedStyle(document.getElementById('miniClock')).display,
    cat: getComputedStyle(document.querySelector('#mini .cat-slot')).display }))()`);
  check('Regresi mini mode cat menampilkan kucing, jam disembunyikan',
    miniCat.clock === 'none' && miniCat.cat !== 'none', JSON.stringify(miniCat));
  await js(win, `window.probe.emit('status', { state: 'mini', miniMode: 'hide' }); true`);
  await sleep(90);
  const miniHide = await js(win, `getComputedStyle(document.getElementById('island')).opacity`);
  check('Regresi mini mode hide benar-benar transparan', parseFloat(miniHide) === 0, String(miniHide));

  /* ---- island scale reaches the notch: #mini layer zoomed like the pill ---- */
  await js(win, `window.probe.emit('status', { state: 'mini', miniMode: 'clock', scaleEffective: 130 }); true`);
  await sleep(90);
  const miniZoom = await js(win, `(() => ({ mini: document.getElementById('mini').style.zoom,
    pill: document.getElementById('pill').style.zoom }))()`);
  check('scale 130: layer mini di-zoom 1.3 (font & kucing ikut ukuran island)',
    miniZoom.mini === '1.3' && miniZoom.pill === '1.3', JSON.stringify(miniZoom));
  await js(win, `window.probe.emit('status', { state: 'mini', miniMode: 'clock', scaleEffective: 100 }); true`);
  await sleep(90);
  const miniZoomReset = await js(win, `document.getElementById('mini').style.zoom`);
  check('scale 100: zoom mini dihapus lagi (property dibersihkan)', miniZoomReset === '', String(miniZoomReset));

  await js(win, `window.probe.emit('settings', { worshipImsakIftar: true }); true`);
  await sleep(140);
  const worship = await js(win, `(() => ({ markers: document.getElementById('prayTimes').classList.contains('with-markers'),
    cells: document.querySelectorAll('#prayTimes .pray-cell.marker').length,
    hint: document.getElementById('prayHint').textContent }))()`);
  check('Regresi worship: marker Imsak/Iftar aktif lewat setting',
    worship.markers && worship.cells >= 2, JSON.stringify(worship));

  await js(win, `window.probe.emit('settings', { lyricsText: '[00:00.00] Baris A\\n[00:12.50] Baris B' }); true`);
  await sleep(140);
  const lyrics = await js(win, `(() => ({ lines: document.querySelectorAll('#lyricLines .lyric-line').length,
    meta: document.getElementById('lyricMeta').textContent }))()`);
  check('Regresi lyrics LRC terurai jadi 2 baris', lyrics.lines === 2 && lyrics.meta.includes('2 baris'),
    JSON.stringify(lyrics));

  await js(win, `window.probe.emit('settings', { captureShortcut: 'off' }); true`);
  await sleep(90);
  const capOff = await js(win, `document.getElementById('capShortcutHint').hidden`);
  await js(win, `window.probe.emit('settings', { captureShortcut: 'default' }); true`);
  await sleep(90);
  const capOn = await js(win, `document.getElementById('capShortcutHint').hidden`);
  check('Regresi capture shortcut: hint Ctrl+Shift+S mengikuti setting', capOff === true && capOn === false,
    `off=${capOff} on=${capOn}`);

  const clock = await js(win, `document.getElementById('clock').textContent`);
  check('Regresi jam berjalan (HH:MM)', /^\d{2}:\d{2}$/.test(clock), String(clock));

  await js(win, `window.probe.emit('status', { state: 'pill', media: true, mediaTitle: 'QA Track' }); true`);
  await sleep(120);
  const media = await js(win, `(() => ({ box: getComputedStyle(document.getElementById('mediaBox')).display,
    title: document.getElementById('mediaTrack').textContent }))()`);
  check('Regresi media pill menampilkan judul lagu', media.box !== 'none' && media.title.includes('QA Track'),
    JSON.stringify(media));

  /* ---- card musik sesuai referensi ---- */
  await js(win, `window.probe.emit('status', { state: 'open', visibleTabs: ['music'] }); true`);
  await sleep(150);
  await js(win, `window.probe.emit('lyrics', { title: 'Kavi Rao - Neon Harbor', lrc: '[00:01.00] satu\\n[00:04.00] dua' }); true`);
  await sleep(150);
  await js(win, `window.probe.emit('status', { state: 'open', media: true, mediaTitle: 'Kavi Rao - Neon Harbor' }); true`);
  await sleep(150);
  const mcard = await js(win, `(() => { const art = document.getElementById('musicArt');
    const cs = getComputedStyle(art, '::after');
    const row = art.closest('.music-now');
    return { gClass: /(^| )g[0-5]( |$)/.test(art.className), badge: cs.content !== 'none' && cs.content !== 'normal',
      title: document.getElementById('musicTitle').textContent,
      sub: document.getElementById('musicSub').textContent,
      end: document.getElementById('musicTimeEnd').textContent,
      transportInRow: !!row.querySelector('.music-transport'),
      volRow: !!document.querySelector('.music-volrow') }; })()`);
  check('card musik: art gradient konsisten + badge not di pojok',
    mcard.gClass && mcard.badge, JSON.stringify({ gClass: mcard.gClass, badge: mcard.badge }));
  check('card musik: judul lagu + artis terpisah (bukan teks kontrol)',
    mcard.title === 'Neon Harbor' && mcard.sub === 'Kavi Rao', JSON.stringify({ t: mcard.title, s: mcard.sub }));
  check('card musik: waktu kanan format sisa, transport sejajar judul, volume di baris sendiri',
    /^-0:0[2-4]$/.test(mcard.end) && mcard.transportInRow && mcard.volRow, JSON.stringify(mcard));

  /* ---- regresi latar kartu musik dinamis + fallback ---- */
  const bgState = `(() => { const c = document.getElementById('musicCard');
    return { dynamic: c.dataset.dynamic, vars: ['--mc-1', '--mc-2', '--mc-3'].map((v) => c.style.getPropertyValue(v)),
      bg: getComputedStyle(c).backgroundImage, art: getComputedStyle(document.getElementById('musicArt')).backgroundImage }; })()`;
  const bg0 = await js(win, bgState);
  check('Regresi musicbg: lagu jalan langsung pakai palet fallback (tidak panel abu-abu)',
    bg0.dynamic === 'fallback' && bg0.vars.length === 3
      && bg0.vars.every((v) => /^#[0-9a-f]{6}$/i.test(v)), JSON.stringify(bg0.dynamic));
  const track = 'Kavi Rao - Neon Harbor';
  const pal = { c1: '#c8412f', c2: '#7b3fa8', c3: '#242a4a' };
  await js(win, `window.probe.emit('musicColors', ${JSON.stringify({ title: track, colors: pal })}); true`);
  await sleep(180);
  const bgOn = await js(win, bgState);
  check('Regresi musicbg: palet lewat IPC mengisi CSSOM dan mengubah background',
    bgOn.dynamic === 'true' && bgOn.vars.join('|') === `${pal.c1}|${pal.c2}|${pal.c3}`
      && bgOn.bg !== bg0.bg && bgOn.art !== bg0.art,
    JSON.stringify(bgOn.vars));
  await js(win, `window.probe.emit('musicColors', ${JSON.stringify({ title: track, colors: null })}); true`);
  await sleep(180);
  const bgOff = await js(win, bgState);
  check('Regresi musicbg: lookup gagal tetap berwarna lewat palet fallback',
    bgOff.dynamic === 'fallback' && bgOff.vars.length === 3
      && bgOff.vars.every((v) => /^#[0-9a-f]{6}$/i.test(v))
      && bgOff.vars.join('|') === bg0.vars.join('|'), JSON.stringify(bgOff.vars));
  await js(win, `window.probe.emit('musicColors', ${JSON.stringify({ title: 'Lagu Lain - Judul', colors: pal })}); true`);
  await sleep(150);
  const bgStale = await js(win, bgState);
  check('Regresi musicbg: balasan untuk lagu lain diabaikan',
    bgStale.dynamic === bgOff.dynamic && bgStale.vars.join('|') === bgOff.vars.join('|'),
    JSON.stringify(bgStale.vars));
  await js(win, `window.probe.emit('status', { musicCardBackground: 'plain' }); true`);
  await js(win, `window.probe.emit('settings', { musicCardBackground: 'plain' }); true`);
  await sleep(180);
  await js(win, `window.probe.emit('musicColors', ${JSON.stringify({ title: track, colors: pal })}); true`);
  await sleep(180);
  const bgPlain = await js(win, bgState);
  check('Regresi musicbg: setting plain tidak berubah sama sekali',
    bgPlain.dynamic === 'false' && bgPlain.vars.every((v) => v === '')
      && !bgPlain.bg.includes('radial-gradient'),
    JSON.stringify({ dynamic: bgPlain.dynamic, bg: bgPlain.bg.slice(0, 50) }));
  await js(win, `window.probe.emit('status', { musicCardBackground: 'album' }); true`);
  await js(win, `window.probe.emit('settings', { musicCardBackground: 'album' }); true`);
  await sleep(150);

  await js(win, `window.probe.emit('settings', { barOrder: ['cat', 'clock', 'battery', 'media', 'mic'] }); true`);
  await sleep(120);
  const bar = await js(win, `(() => ({ clockRank: document.getElementById('clock').dataset.barRank,
    catRank: document.getElementById('pillCatSlot').dataset.barRank,
    rail: document.getElementById('island').dataset.catRail }))()`);
  check('Regresi barOrder: rank mengikuti permutasi tersimpan & cat pindah ke rail kiri',
    bar.clockRank === '1' && bar.catRank === '0' && bar.rail === 'left', JSON.stringify(bar));

  await js(win, `window.probe.emit('hover', true); true`);
  const hov1 = await js(win, `(() => { const r = document.getElementById('island');
    return [r.dataset.hovered, r.dataset.hoverCue]; })()`);
  await js(win, `window.probe.emit('hover', false); true`);
  const hov2 = await js(win, `(() => { const r = document.getElementById('island');
    return [r.dataset.hovered, r.dataset.hoverCue]; })()`);
  check('Regresi hover reveal: data-hovered / data-hover-cue mengikuti IPC',
    hov1[0] === 'true' && hov1[1] === 'true' && hov2[0] === 'false' && hov2[1] === 'false',
    JSON.stringify({ hov1, hov2 }));

  await js(win, `window.probe.emit('status', { state: 'open', visibleTabs: [] }); true`);
  await sleep(120);
  const panelsGrid = await js(win, `(() => { const g = document.getElementById('panelsGrid');
    return { count: g.children.length, allButtons: Array.from(g.children).every((b) => b.tagName === 'BUTTON'
      && getComputedStyle(b).cursor === 'pointer' && (b.textContent || '').trim().length > 0) }; })()`);
  check('Regresi grid semua panel: 15 tombol native bernama', panelsGrid.count === 15 && panelsGrid.allButtons,
    JSON.stringify(panelsGrid));

  /* ---- antislop ---- */
  await js(win, `window.probe.emit('status', { state: 'open', visibleTabs: [] }); true`);
  await sleep(120);
  const a11y = await js(win, `(() => {
    const els = Array.from(document.querySelectorAll('button'))
      .filter((b) => b.getBoundingClientRect().width > 0 && !b.disabled);
    const bad = els.filter((b) => {
      const name = (b.getAttribute('aria-label') || b.title || b.textContent || '').trim();
      return name.length === 0 || getComputedStyle(b).cursor !== 'pointer';
    });
    return { total: els.length, bad: bad.slice(0, 6).map((b) => b.outerHTML.slice(0, 110)),
      emDash: (document.documentElement.textContent || '').includes('\\u2014') };
  })()`);
  check('Antislop renderer: tombol native bernama, cursor pointer, tanpa em dash di UI',
    a11y.total > 0 && a11y.bad.length === 0 && !a11y.emDash, JSON.stringify(a11y));

  win.destroy();
}

async function settingsProbe() {
  const win = makeWindow(760, 560);
  await win.loadFile(path.join(root, 'dist', 'settings', 'settings.html'));
  await sleep(320);
  await js(win, `(() => { const b = Array.from(document.querySelectorAll('#nav button'))
    .find((x) => x.textContent.trim() === 'Panels'); if (b) b.click(); return !!b; })()`);
  await sleep(150);
  await js(win, `window.probe.clear(); true`);

  const picker = await js(win, `(() => {
    const c = Array.from(document.querySelectorAll('.tabchip'));
    return { count: c.length, on: c.filter((x) => x.classList.contains('on')).length,
      pressed: c.map((x) => x.getAttribute('aria-pressed')),
      native: c.every((x) => x.tagName === 'BUTTON' && getComputedStyle(x).cursor === 'pointer'
        && (x.textContent || '').trim().length > 0) };
  })()`);
  check('Bug3 picker: 14 tombol native ber-aria-pressed=true',
    picker.count === 14 && picker.on === 14 && picker.pressed.every((p) => p === 'true') && picker.native,
    JSON.stringify(picker));

  /* real keyboard: Tab moves focus, Space toggles */
  await js(win, `document.querySelector('.tabchip').focus(); true`);
  const focus0 = await js(win, `document.activeElement.dataset.tab`);
  await key(win, 'Tab');
  const focus1 = await js(win, `document.activeElement.dataset.tab`);
  await key(win, 'Space');
  const afterSpace = await js(win, `(() => ({ pressed: document.activeElement.getAttribute('aria-pressed'),
    on: document.activeElement.classList.contains('on') }))()`);
  const keyCalls = await js(win, `window.probe.calls().filter((c) => c.kind === 'settingsSet' && c.payload.key === 'visibleTabs').map((c) => c.payload.value.length)`);
  check('Bug3 keyboard Tab berpindah & Space men-toggle chip (bukan tombol mati)',
    focus0 === 'web' && focus1 !== focus0 && afterSpace.pressed === 'false' && afterSpace.on === false
      && keyCalls.length >= 1,
    JSON.stringify({ focus0, focus1, afterSpace, keyCalls }));

  /* restore to full 14 before the destructive cases */
  await js(win, `(() => { const c = Array.from(document.querySelectorAll('.tabchip'));
    const off = c.find((x) => !x.classList.contains('on')); if (off) off.click(); return true; })()`);
  await sleep(120);

  await js(win, `window.probe.clear(); true`);
  await js(win, `(() => { for (const c of Array.from(document.querySelectorAll('.tabchip'))) c.click(); return true; })()`);
  await sleep(200);
  const cleared = await js(win, `(() => {
    const calls = window.probe.calls().filter((c) => c.kind === 'settingsSet' && c.payload.key === 'visibleTabs');
    return { value: calls.length ? calls[calls.length - 1].payload.value : null,
      chipsOn: Array.from(document.querySelectorAll('.tabchip')).filter((c) => c.classList.contains('on')).length,
      pressedFalse: Array.from(document.querySelectorAll('.tabchip')).every((c) => c.getAttribute('aria-pressed') === 'false'),
      orderRows: document.querySelectorAll('.order-row').length,
      emptyLabel: document.querySelector('.order-empty')?.textContent ?? '',
      restoreText: document.querySelector('.order-empty button')?.textContent ?? '',
      restoreNative: document.querySelector('.order-empty button')?.tagName ?? '' };
  })()`);
  check('Bug3 deselect-all persist [] + aria-pressed false + empty state bermakna + tombol restore',
    Array.isArray(cleared.value) && cleared.value.length === 0 && cleared.chipsOn === 0
      && cleared.pressedFalse && cleared.orderRows === 0
      && cleared.emptyLabel.length > 20 && cleared.restoreText === 'Tampilkan semua tab'
      && cleared.restoreNative === 'BUTTON',
    JSON.stringify(cleared));

  await js(win, `window.probe.clear(); true`);
  await js(win, `(() => { const b = document.querySelector('.order-empty button'); if (b) b.click(); return !!b; })()`);
  await sleep(180);
  const restored = await js(win, `(() => {
    const calls = window.probe.calls().filter((c) => c.kind === 'settingsSet' && c.payload.key === 'visibleTabs');
    return { value: calls.length ? calls[calls.length - 1].payload.value : null,
      chipsOn: Array.from(document.querySelectorAll('.tabchip')).filter((c) => c.classList.contains('on')).length,
      orderRows: document.querySelectorAll('.order-row').length };
  })()`);
  check('Bug3 tombol "Tampilkan semua tab" mengembalikan 14 tab',
    Array.isArray(restored.value) && restored.value.length === 14
      && restored.chipsOn === 14 && restored.orderRows === 14, JSON.stringify(restored));

  await js(win, `window.probe.clear(); true`);
  const arrows = await js(win, `(() => {
    const rows = Array.from(document.querySelectorAll('.order-row'));
    const firstUp = rows[0]?.querySelector('.orderbtn');
    const firstDown = rows[0]?.querySelectorAll('.orderbtn')[1];
    const lastDown = rows[rows.length - 1]?.querySelectorAll('.orderbtn')[1];
    return { upDisabled: firstUp?.disabled, downDisabledOnLast: lastDown?.disabled,
      clicked: !!firstDown && (firstDown.click(), true) };
  })()`);
  await sleep(160);
  const arrowCalls = await js(win, `window.probe.calls().filter((c) => c.kind === 'settingsSet' && c.payload.key === 'visibleTabs').map((c) => c.payload.value)`);
  check('Bug3 tombol panah menyimpan permutasi & tombol tepi disabled',
    arrows.clicked && arrows.upDisabled === true && arrows.downDisabledOnLast === true
      && arrowCalls.length > 0
      && JSON.stringify(arrowCalls[arrowCalls.length - 1]) !== JSON.stringify([...ALL]),
    JSON.stringify({ arrows, last: arrowCalls[arrowCalls.length - 1] }));

  /* complete=false: selecting one tab after clearing must NOT resurrect 14 rows */
  await js(win, `(() => { for (const c of Array.from(document.querySelectorAll('.tabchip'))) c.click(); return true; })()`);
  await sleep(150);
  await js(win, `window.probe.clear(); true`);
  await js(win, `document.querySelector('.tabchip[data-tab="clipboard"]').click(); true`);
  await sleep(170);
  const oneRow = await js(win, `(() => ({ rows: document.querySelectorAll('.order-row').length,
    value: window.probe.calls().filter((c) => c.kind === 'settingsSet' && c.payload.key === 'visibleTabs').pop()?.payload.value }))()`);
  check('Bug3 orderEditor(complete=false): 1 tab dipilih = 1 baris (tidak menghidupkan 14 lagi)',
    oneRow.rows === 1 && JSON.stringify(oneRow.value) === '["clipboard"]', JSON.stringify(oneRow));
  await js(win, `document.querySelector('.tabchip[data-tab="music"]').click(); true`);
  await sleep(170);
  const twoRows = await js(win, `document.querySelectorAll('.order-row').length`);
  check('Bug3 bus in-page: picker langsung menyinkronkan editor urutan', twoRows === 2, String(twoRows));
  await js(win, `document.querySelector('.tabchip[data-tab="music"]').click(); true`);
  await sleep(120);

  /* Enter on a focused chip */
  await js(win, `document.querySelector('.tabchip[data-tab="web"]').focus(); true`);
  const beforeEnter = await js(win, `document.activeElement.getAttribute('aria-pressed')`);
  await key(win, 'Enter');
  const afterEnter = await js(win, `document.activeElement.getAttribute('aria-pressed')`);
  check('Bug3 keyboard Enter juga men-toggle chip', beforeEnter !== afterEnter,
    `${beforeEnter} -> ${afterEnter}`);

  /* Appearance style card */
  await js(win, `(() => { const b = Array.from(document.querySelectorAll('#nav button'))
    .find((x) => x.textContent.trim() === 'Appearance'); if (b) b.click(); return true; })()`);
  await sleep(150);
  await js(win, `window.probe.clear(); true`);
  const styleClick = await js(win, `(() => { const c = Array.from(document.querySelectorAll('.choice-card'))
    .find((x) => x.textContent.includes('Notched')); if (!c) return false; c.click(); return true; })()`);
  await sleep(140);
  const styleCalls = await js(win, `window.probe.calls().filter((c) => c.kind === 'settingsSet' && c.payload.key === 'islandStyle')`);
  check('Bug1 kartu Notched menulis setting islandStyle nyata',
    styleClick && styleCalls.length === 1 && styleCalls[0].payload.value === 'notched', JSON.stringify(styleCalls));

  /* Island size: Auto toggle + scroll-bar slider (bukan deretan angka) */
  const sizeUi = await js(win, `(() => {
    const auto = document.querySelector('.switch input[aria-label="Ukuran otomatis mengikuti lebar layar"]');
    const slider = document.querySelector('.range.size input[type="range"]');
    return {
      auto: !!auto, autoOn: auto ? auto.checked : null,
      slider: !!slider, disabled: slider ? slider.disabled : null,
      noSegment: !Array.from(document.querySelectorAll('.seg'))
        .some((s) => s.textContent.includes('Otomatis')),
      max: slider ? slider.max : null,
    };
  })()`);
  check('Ukuran island: toggle Otomatis + slider 75-130 (bukan segment angka)',
    sizeUi.auto && sizeUi.slider && sizeUi.autoOn === true && sizeUi.disabled === true
      && sizeUi.noSegment && sizeUi.max === '130', JSON.stringify(sizeUi));

  const a11y = await js(win, `(() => {
    const els = Array.from(document.querySelectorAll('button, input, select'))
      .filter((el) => el.getBoundingClientRect().width > 0 && !el.disabled);
    const bad = els.filter((el) => {
      const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim();
      return name.length === 0 || getComputedStyle(el).cursor === 'default';
    });
    return { total: els.length, bad: bad.slice(0, 6).map((b) => b.outerHTML.slice(0, 110)),
      emDash: (document.documentElement.textContent || '').includes('\\u2014') };
  })()`);
  check('Antislop Settings: kontrol native bernama, ada focus state, tanpa em dash',
    a11y.total > 0 && a11y.bad.length === 0 && !a11y.emDash, JSON.stringify(a11y));

  win.destroy();
}

app.on('window-all-closed', (event) => event.preventDefault());

app.whenReady().then(async () => {
  fs.writeFileSync(path.join(root, '_qa-state.json'), JSON.stringify(initial, null, 2), 'utf8');
  try {
    await rendererProbe();
    await settingsProbe();
  } catch (err) {
    check('probe selesai tanpa exception', false, String(err && err.stack || err));
  }
  const errors = consoleMessages.filter((m) => m.level >= 2);
  check('0 console error di renderer & Settings', errors.length === 0,
    JSON.stringify(errors.slice(0, 6)));
  const failed = results.filter((r) => !r.ok);
  console.log(`\nQA_UI ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  console.log(`QA_CONSOLE total=${consoleMessages.length} errors=${errors.length}`);
  app.exit(failed.length ? 1 : 0);
});
