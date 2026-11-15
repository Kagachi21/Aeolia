/* Kou - proof that "buka kartu saat lagu jalan" lands on the Music tab.
   Drives the REAL compiled renderer (dist/renderer/index.html) through the real
   preload seam: emit status(state pill) then status(state open, openAction
   music), which is exactly the sequence the main process sends after my
   pushStatus change. No window enumeration involved, nothing faked past the
   status payload itself.

   Run: env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe-music-open.js
*/
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const root = __dirname;
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Which tab the card is showing, plus what the renderer told main about it. */
const READ = `(() => {
  const activeTab = Array.from(document.querySelectorAll('.tab')).find((b) => b.classList.contains('active'));
  const activePanel = Array.from(document.querySelectorAll('.panel')).find((p) => p.classList.contains('active'));
  return {
    tab: activeTab ? activeTab.dataset.tab : null,
    panel: activePanel ? activePanel.dataset.panel : null,
    setTabCalls: window.probe.calls().filter((c) => c.kind === 'setTab').map((c) => c.payload),
    state: document.getElementById('island').dataset.state,
  };
})()`;

app.on('window-all-closed', (event) => event.preventDefault());

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 360, height: 92, frame: false, show: false, transparent: true,
    hasShadow: false, useContentSize: true, paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(root, '_qa-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const status = (extra) => js(`window.probe.emit('status', ${JSON.stringify(extra)}); true`);

  try {
    await win.loadFile(path.join(root, 'dist', 'renderer', 'index.html'));
    await sleep(300);
    await status({ state: 'pill', media: false, openAction: 'last', visibleTabs: null });
    await sleep(160);

    const before = await js(READ);
    check('sebelum dibuka: kartu memakai tab terakhir dari state (clipboard)',
      before.tab === 'clipboard' && before.panel === 'clipboard', JSON.stringify(before));

    /* Main process opens the card while a track plays. */
    await status({ state: 'open', media: true, mediaTitle: 'Nirvana - Smells Like Teen Spirit', openAction: 'music' });
    await sleep(220);
    const opened = await js(READ);
    check('buka kartu saat lagu jalan -> tab Music aktif',
      opened.tab === 'music' && opened.panel === 'music', JSON.stringify(opened));
    check('tab otomatis tidak menimpa tab terakhir user (tanpa setTab)',
      opened.setTabCalls.length === 0, JSON.stringify(opened.setTabCalls));

    /* A later status while already open must not yank the user back. */
    await js(`document.querySelector('.tab[data-tab="clipboard"]').click(); true`);
    await sleep(160);
    await status({ state: 'open', media: true, openAction: 'music' });
    await sleep(220);
    const afterClick = await js(READ);
    check('kartu sudah terbuka: pilihan user tidak ditarik lagi ke Music',
      afterClick.tab === 'clipboard', JSON.stringify(afterClick));

    /* Counter-case: no music, so the settings action wins as before. */
    await status({ state: 'pill', media: false, openAction: 'last' });
    await sleep(160);
    await status({ state: 'open', media: false, openAction: 'last' });
    await sleep(220);
    const noMusic = await js(READ);
    check('tanpa lagu: buka kartu tetap ke tab terakhir, bukan Music',
      noMusic.tab === 'clipboard', JSON.stringify(noMusic));
  } catch (err) {
    check('probe selesai tanpa exception', false, String((err && err.stack) || err));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nPROBE_MUSIC_OPEN ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  win.destroy();
  app.exit(failed.length ? 1 : 0);
});
