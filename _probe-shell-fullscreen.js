/* TDD probe: the desktop shell / live-wallpaper renderer must never be treated
   as a fullscreen app, otherwise the island shrinks to the 14px notch whenever
   the live wallpaper (Lively) / desktop has focus.
   Also: Excel + PowerPoint count as "work" apps for the busy trigger.
   Run with plain node against the compiled dist. */
const assert = require('node:assert/strict');
const path = require('node:path');

const mod = require(path.join(__dirname, 'dist', 'main', 'activeWindow.js'));
const results = [];
const check = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); console.log('PASS ', name); }
  catch (e) { results.push({ name, ok: false }); console.log('FAIL ', name, '::', e.message); }
};

// The pure helpers the fix must expose.
check('exports isDesktopShell(process,title)', () => {
  assert.equal(typeof mod.isDesktopShell, 'function');
});
check('exports resolveFullscreen(covers,process,title)', () => {
  assert.equal(typeof mod.resolveFullscreen, 'function');
});
check('exports rectCoversMonitor(rect,monitor) for DPI-safe comparison', () => {
  assert.equal(typeof mod.rectCoversMonitor, 'function');
});

if (typeof mod.isDesktopShell === 'function') {
  check('Program Manager (desktop) is a desktop shell', () => {
    assert.equal(mod.isDesktopShell('explorer', 'Program Manager'), true);
  });
  check('TextInputHost (desktop overlay) is a desktop shell', () => {
    assert.equal(mod.isDesktopShell('textinputhost', 'Windows Input Experience'), true);
  });
  check('Lively live-wallpaper renderer is a desktop shell', () => {
    assert.equal(mod.isDesktopShell('lively', ''), true);
    assert.equal(mod.isDesktopShell('lively.watchdog', ''), true);
  });
  check('WorkerW / Progman desktop windows are desktop shells', () => {
    assert.equal(mod.isDesktopShell('explorer', 'WorkerW'), true);
    assert.equal(mod.isDesktopShell('explorer', 'Progman'), true);
  });
  check('a real app is NOT a desktop shell', () => {
    assert.equal(mod.isDesktopShell('chrome', 'YouTube - Chrome'), false);
    assert.equal(mod.isDesktopShell('winword', 'Laporan.docx - Word'), false);
    assert.equal(mod.isDesktopShell('explorer', 'Dokumen - File Explorer'), false);
  });
}
if (typeof mod.resolveFullscreen === 'function') {
  check('monitor-covering desktop shell -> NOT fullscreen', () => {
    assert.equal(mod.resolveFullscreen(true, 'explorer', 'Program Manager'), false);
    assert.equal(mod.resolveFullscreen(true, 'textinputhost', 'Windows Input Experience'), false);
    assert.equal(mod.resolveFullscreen(true, 'lively', ''), false);
  });
  check('monitor-covering real app -> fullscreen', () => {
    assert.equal(mod.resolveFullscreen(true, 'chrome', 'Video'), true);
    assert.equal(mod.resolveFullscreen(true, 'game', ''), true);
  });
  check('non-covering window -> not fullscreen regardless of process', () => {
    assert.equal(mod.resolveFullscreen(false, 'chrome', 'Video'), false);
  });
  check('maximized window covering the monitor -> NOT fullscreen', () => {
    assert.equal(mod.resolveFullscreen(true, 'chrome', 'Video', true, true), false);
    assert.equal(mod.resolveFullscreen(true, 'game', 'Game', true, true), false);
  });
  check('genuine popup-style covering window -> fullscreen', () => {
    assert.equal(mod.resolveFullscreen(true, 'game', 'Game', false, true), true);
  });
  check('desktop shell excluded even with popup style', () => {
    assert.equal(mod.resolveFullscreen(true, 'explorer', 'Program Manager', false, true), false);
  });
}
if (typeof mod.rectCoversMonitor === 'function') {
  check('rectCoversMonitor: 150 percent physical bounds reject a quarter-screen window', () => {
    const physical = { x: 0, y: 0, width: 2880, height: 1620 };
    assert.equal(mod.rectCoversMonitor({ left: 0, top: 0, right: 1920, bottom: 1080 }, physical), false);
    assert.equal(mod.rectCoversMonitor({ left: 0, top: 0, right: 2880, bottom: 1620 }, physical), true);
    assert.equal(mod.rectCoversMonitor(null, physical), false);
  });
}
check('Excel + PowerPoint are busy work apps', () => {
  assert.equal(mod.isBusyProcess('excel'), true);
  assert.equal(mod.isBusyProcess('powerpnt'), true);
  assert.equal(mod.isBusyProcess('winword'), true);
  assert.equal(mod.isBusyProcess('chrome'), true);
  assert.equal(mod.isBusyProcess('notepad'), false);
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\nSHELL_FULLSCREEN ${results.length - failed}/${results.length}  FAILED=${failed}`);
process.exit(failed ? 1 : 0);
