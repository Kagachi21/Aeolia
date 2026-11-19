/* Renderer + Settings runtime probe.
   Opens the compiled dist pages with a stub preload, drives real DOM events
   and measures real layout. Run with: electron.exe _probe-ui.js
*/
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const root = __dirname;
const results = [];
const consoleErrors = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const initial = {
  status: {
    state: 'open', accent: '#6ea8ff', surface: 'Graphite', cardWidth: 360,
    visibleTabs: ['web', 'notifications', 'shelf', 'clipboard', 'music', 'today',
      'sholat', 'timer', 'reminders', 'water', 'capture', 'controls', 'deck', 'calls'],
    miniMode: 'clock', meetingMicButton: true, media: false, word: false,
    hiddenUntilHover: false, openAction: 'last', meeting: false, mediaTitle: '',
  },
  settings: {
    visibleTabs: ['web', 'notifications', 'shelf', 'clipboard', 'music', 'today',
      'sholat', 'timer', 'reminders', 'water', 'capture', 'controls', 'deck', 'calls'],
    islandStyle: 'notched', catGreeting: true, catIdleCenter: true,
    barOrder: ['clock', 'cat', 'battery', 'media', 'mic'],
  },
  card: {
    lastTab: 'clipboard', clips: [], notices: [], sites: [], shelf: [], tasks: [],
  },
};

function makeWindow(width, height) {
  const win = new BrowserWindow({
    width, height, frame: false, show: true,
    backgroundColor: '#17191d',
    webPreferences: {
      preload: path.join(root, '_probe-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) consoleErrors.push(message);
  });
  return win;
}

const js = (win, code) => win.webContents.executeJavaScript(code);

async function rendererProbe() {
  const win = makeWindow(360, 470);
  await win.loadFile(path.join(root, 'dist', 'renderer', 'index.html'));
  await sleep(1900);

  /* Give the renderer its first state before measuring layout. Without this the
     card is still in its boot state: no visibleTabs have arrived yet, so the
     tab strip lays out at zero width and every geometry assertion compares
     0 <= 0 and reads as "inside the card" for the wrong reason. The later
     checks emit their own state, so this only seeds the initial frame. */
  await js(win, `window.probe.emit('settings', ${JSON.stringify(initial.settings)});
    window.probe.emit('status', ${JSON.stringify(initial.status)});
    window.probe.emit('card', ${JSON.stringify(initial.card)}); true`);
  await sleep(320);

  const structure = await js(win, `(() => {
    const scroll = document.getElementById('tabsScroll');
    const tabs = document.getElementById('tabs');
    const settings = document.querySelector('.tab-settings');
    const grid = document.querySelector('.tab-grid');
    return {
      hasScroll: !!scroll,
      settingsPinned: !!scroll && !!settings && !scroll.contains(settings) && tabs.contains(settings),
      gridPinned: !!scroll && !!grid && !scroll.contains(grid) && tabs.contains(grid),
    };
  })()`);
  check('card tab bar has a scroll strip with pinned Settings and grid buttons',
    structure.hasScroll && structure.settingsPinned && structure.gridPinned,
    JSON.stringify(structure));

  const layoutAt = async (label) => js(win, `(() => {
    const tabs = document.getElementById('tabs');
    const scroll = document.getElementById('tabsScroll');
    const settings = document.querySelector('.tab-settings');
    const grid = document.querySelector('.tab-grid');
    const tr = tabs.getBoundingClientRect();
    const sr = settings.getBoundingClientRect();
    const gr = grid.getBoundingClientRect();
    return {
      label: '${label}',
      visibleTabs: Array.from(document.querySelectorAll('#tabsScroll .tab')).filter((b) => !b.hidden && b.getBoundingClientRect().width > 0).length,
      settingsVisible: getComputedStyle(settings).display !== 'none' && sr.width > 0,
      settingsInside: sr.left >= tr.left - 1 && sr.right <= tr.right + 1,
      gridInside: gr.left >= tr.left - 1 && gr.right <= tr.right + 1,
      overflows: scroll.scrollWidth > scroll.clientWidth + 1,
      scrollClientWidth: scroll.clientWidth,
    };
  })()`);

  const all360 = await layoutAt('360px');
  check('with all 14 tabs the Settings button stays inside the card at 360px',
    all360.visibleTabs === 14 && all360.settingsVisible && all360.settingsInside && all360.gridInside,
    JSON.stringify(all360));

  win.setSize(320, 470);
  await sleep(160);
  const all320 = await layoutAt('320px');
  check('with all 14 tabs the Settings button stays inside the card at 320px',
    all320.visibleTabs === 14 && all320.settingsVisible && all320.settingsInside && all320.gridInside
    && all320.overflows,
    JSON.stringify(all320));
  win.setSize(360, 470);
  await sleep(120);

  await js(win, `window.probe.emit('status', { state: 'open', visibleTabs: [] }); true`);
  await sleep(80);
  const empty = await layoutAt('empty');
  check('removing every tab really hides every panel tab, pinned controls remain',
    empty.visibleTabs === 0 && empty.settingsVisible && empty.settingsInside && empty.gridInside,
    JSON.stringify(empty));

  await js(win, `window.probe.emit('status', { state: 'open', visibleTabs: ['clipboard'] }); true`);
  await sleep(80);
  const single = await layoutAt('single');
  check('choosing a single tab shows exactly that tab',
    single.visibleTabs === 1 && single.settingsVisible && single.settingsInside,
    JSON.stringify(single));

  await js(win, `window.probe.emit('status', { state: 'open', visibleTabs: ['web','notifications','shelf','clipboard','music'] }); window.probe.clear(); true`);
  await sleep(80);
  const drag = await js(win, `(() => {
    const dt = new DataTransfer();
    const from = document.querySelector('#tabsScroll .tab[data-tab="web"]');
    const to = document.querySelector('#tabsScroll .tab[data-tab="shelf"]');
    if (!from || !to) return { ok: false, reason: 'missing tabs' };
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return { ok: true };
  })()`);
  await sleep(80);
  const dragCalls = await js(win, `window.probe.calls().filter((c) => c.kind === 'setSetting' && c.payload.key === 'visibleTabs')`);
  const domOrder = await js(win, `Array.from(document.querySelectorAll('#tabsScroll .tab')).filter((b) => !b.hidden).map((b) => b.dataset.tab)`);
  check('dragging a tab onto another persists a new order',
    drag.ok && dragCalls.length === 1 && dragCalls[0].payload.value[0] !== 'web',
    JSON.stringify({ drag, dragCalls, domOrder }));

  await js(win, `window.probe.emit('card', {
    clips: [{ id: 'c1', kind: 'text', text: 'COPIED-TEXT-ALPHA', at: Date.now() }],
    notices: [{ id: 'n1', app: 'Zoom', title: 'Rapat mulai', body: 'Standup', at: Date.now() }]
  }); window.probe.clear(); true`);
  await sleep(100);
  const separation = await js(win, `(() => {
    const noticeText = document.getElementById('noticeList').textContent;
    const clipText = document.getElementById('clipList').textContent;
    const acts = Array.from(document.querySelectorAll('#clipList .clip-act'));
    return {
      noticeHasAppNotice: noticeText.includes('Rapat mulai'),
      noticeHasClipText: noticeText.includes('COPIED-TEXT-ALPHA'),
      clipHasClipText: clipText.includes('COPIED-TEXT-ALPHA'),
      actions: acts.map((b) => ({
        label: b.textContent.trim(), tag: b.tagName,
        cursor: getComputedStyle(b).cursor,
        title: b.title, aria: b.getAttribute('aria-label'),
      })),
    };
  })()`);
  check('Notifications and Clipboard hold different data',
    separation.noticeHasAppNotice && !separation.noticeHasClipText && separation.clipHasClipText,
    JSON.stringify(separation));
  check('Clipboard entries expose real Salin and Tempel buttons',
    separation.actions.length === 2
    && separation.actions.some((a) => a.label === 'Salin')
    && separation.actions.some((a) => a.label === 'Tempel')
    && separation.actions.every((a) => a.tag === 'BUTTON' && a.cursor === 'pointer'
      && (a.title || a.aria || a.label).length > 0),
    JSON.stringify(separation.actions));

  await js(win, `(() => {
    const acts = Array.from(document.querySelectorAll('#clipList .clip-act'));
    const salin = acts.find((b) => b.textContent.trim() === 'Salin');
    const tempel = acts.find((b) => b.textContent.trim() === 'Tempel');
    if (salin) salin.click();
    if (tempel) tempel.click();
    return true;
  })()`);
  await sleep(80);
  const clipCalls = await js(win, `window.probe.calls().filter((c) => c.kind === 'clipboardCopy' || c.kind === 'clipboardPaste')`);
  check('Salin and Tempel both invoke their real IPC actions',
    clipCalls.some((c) => c.kind === 'clipboardCopy' && c.payload === 'COPIED-TEXT-ALPHA')
    && clipCalls.some((c) => c.kind === 'clipboardPaste' && c.payload === 'COPIED-TEXT-ALPHA'),
    JSON.stringify(clipCalls));

  await js(win, `window.probe.emit('card', { clips: [], notices: [] }); true`);
  await sleep(80);
  const emptyStates = await js(win, `(() => ({
    notice: document.querySelector('#noticeList .empty')?.textContent ?? '',
    clip: document.querySelector('#clipList .empty')?.textContent ?? '',
  }))()`);
  check('empty states state the truth about app notices vs copied text',
    emptyStates.notice.includes('Clipboard') && !emptyStates.notice.includes('Salin teks')
    && emptyStates.clip.length > 0,
    JSON.stringify(emptyStates));

  await js(win, `window.probe.emit('settings', { islandStyle: 'notched' }); window.probe.emit('status', { state: 'pill', visibleTabs: ['web'] }); true`);
  await sleep(650);
  const notchedCss = await js(win, `(() => {
    const el = document.getElementById('island');
    const cs = getComputedStyle(el);
    return { dataset: el.dataset.islandStyle, topLeft: cs.borderTopLeftRadius, bottomLeft: cs.borderBottomLeftRadius };
  })()`);
  check('Notched style renders square top corners (flush to the edge)',
    notchedCss.dataset === 'notched' && parseFloat(notchedCss.topLeft) === 0
    && parseFloat(notchedCss.bottomLeft) > 0,
    JSON.stringify(notchedCss));

  const cat = await js(win, `(() => {
    const root = document.getElementById('island');
    const before = root.dataset.catPos;
    window.probe.emit('robot', { idle: false, batteryPercent: 80, charging: false, cursorDx: 0 });
    const active = root.dataset.catPos;
    for (let i = 0; i < 5; i++) window.probe.emit('robot', { idle: false, batteryPercent: 80, charging: false, cursorDx: 0 });
    const repeated = root.dataset.catPos;
    return { before, active, repeated };
  })()`);
  check('repeated identical robot states keep the cat at one deterministic rail',
    cat.active === cat.repeated && cat.active === 'right', JSON.stringify(cat));

  win.destroy();
}

async function settingsProbe() {
  const win = makeWindow(720, 500);
  await win.loadFile(path.join(root, 'dist', 'settings', 'settings.html'));
  await sleep(300);

  await js(win, `(() => {
    const b = Array.from(document.querySelectorAll('#nav button')).find((x) => x.textContent.trim() === 'Panels');
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(120);
  await js(win, `window.probe.clear(); true`);

  const picker = await js(win, `(() => {
    const chips = Array.from(document.querySelectorAll('.tabchip'));
    return { count: chips.length, on: chips.filter((c) => c.classList.contains('on')).length };
  })()`);
  check('Panels page offers one real toggle per panel tab',
    picker.count === 14 && picker.on === 14, JSON.stringify(picker));

  await js(win, `(() => {
    for (const c of Array.from(document.querySelectorAll('.tabchip'))) c.click();
    return true;
  })()`);
  await sleep(180);
  const cleared = await js(win, `(() => {
    const calls = window.probe.calls().filter((c) => c.kind === 'settingsSet' && c.payload.key === 'visibleTabs');
    const last = calls[calls.length - 1];
    return { count: calls.length, value: last ? last.payload.value : null,
      chipsOn: Array.from(document.querySelectorAll('.tabchip')).filter((c) => c.classList.contains('on')).length,
      orderRows: document.querySelectorAll('.order-row').length,
      emptyLabel: document.querySelector('.order-empty')?.textContent ?? '' };
  })()`);
  check('deselecting every tab persists an empty list (all tabs removable)',
    Array.isArray(cleared.value) && cleared.value.length === 0 && cleared.chipsOn === 0,
    JSON.stringify(cleared));
  check('the tab order editor shows an honest empty state with a restore action',
    cleared.orderRows === 0 && cleared.emptyLabel.length > 0,
    JSON.stringify(cleared));

  const restore = await js(win, `(() => {
    window.probe.clear();
    const b = document.querySelector('.order-empty button');
    if (!b) return { clicked: false };
    b.click();
    return { clicked: true };
  })()`);
  await sleep(150);
  const restored = await js(win, `(() => {
    const calls = window.probe.calls().filter((c) => c.kind === 'settingsSet' && c.payload.key === 'visibleTabs');
    return {
      value: calls.length ? calls[calls.length - 1].payload.value : null,
      chipsOn: Array.from(document.querySelectorAll('.tabchip')).filter((c) => c.classList.contains('on')).length,
      orderRows: document.querySelectorAll('.order-row').length,
    };
  })()`);
  check('the empty-state restore button really shows all tabs again',
    restore.clicked && Array.isArray(restored.value) && restored.value.length === 14
    && restored.chipsOn === 14 && restored.orderRows === 14,
    JSON.stringify({ restore, restored }));

  await js(win, `window.probe.clear(); true`);
  const reorder = await js(win, `(() => {
    const rows = Array.from(document.querySelectorAll('.order-row'));
    const up = rows[1] ? rows[1].querySelector('.orderbtn') : null;
    if (up) up.click();
    return { clicked: !!up };
  })()`);
  await sleep(150);
  const reorderCalls = await js(win, `window.probe.calls().filter((c) => c.kind === 'settingsSet' && c.payload.key === 'visibleTabs')`);
  check('arrow reordering persists a changed permutation',
    reorder.clicked && reorderCalls.length > 0
    && JSON.stringify(reorderCalls[reorderCalls.length - 1].payload.value) !== JSON.stringify(initial.settings.visibleTabs),
    JSON.stringify(reorderCalls.map((c) => c.payload.value)));

  await js(win, `(() => {
    const b = Array.from(document.querySelectorAll('#nav button')).find((x) => x.textContent.trim() === 'Appearance');
    if (b) b.click();
    return true;
  })()`);
  await sleep(120);
  await js(win, `window.probe.clear(); true`);
  const styleClick = await js(win, `(() => {
    const cards = Array.from(document.querySelectorAll('.choice-card'));
    const notched = cards.find((c) => c.textContent.includes('Notched'));
    if (!notched) return false;
    notched.click();
    return true;
  })()`);
  await sleep(120);
  const styleCalls = await js(win, `window.probe.calls().filter((c) => c.kind === 'settingsSet' && c.payload.key === 'islandStyle')`);
  check('the Notched choice card writes the real islandStyle setting',
    styleClick && styleCalls.length === 1 && styleCalls[0].payload.value === 'notched',
    JSON.stringify(styleCalls));

  const a11y = await js(win, `(() => {
    const els = Array.from(document.querySelectorAll('.choice-card, .nav button, .tabchip, .orderbtn, .switch input, .seg button'))
      .filter((el) => el.getBoundingClientRect().width > 0 && !el.disabled);
    const bad = els.filter((el) => {
      const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim();
      return (el.tagName !== 'BUTTON' && el.tagName !== 'INPUT') || name.length === 0 || getComputedStyle(el).cursor !== 'pointer';
    });
    return { total: els.length, bad: bad.slice(0, 5).map((b) => b.outerHTML.slice(0, 120)) };
  })()`);
  check('touched Settings controls are native, named and show a pointer cursor',
    a11y.total > 0 && a11y.bad.length === 0, JSON.stringify(a11y));

  win.destroy();
}

app.on('window-all-closed', (event) => event.preventDefault());

app.whenReady().then(async () => {
  fs.writeFileSync(path.join(root, '_probe-state.json'), JSON.stringify(initial, null, 2), 'utf8');
  try {
    await rendererProbe();
    await settingsProbe();
  } catch (err) {
    check('probe completed without an exception', false, String(err && err.stack || err));
  }
  check('renderer and Settings pages produced no console errors',
    consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 5)));
  const failed = results.filter((r) => !r.ok);
  console.log(`\nPROBE_UI ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  app.exit(failed.length ? 1 : 0);
});
