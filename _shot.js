/* Temporary: capture the open card with every tab visible (tab-bar overflow case). */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 380,
    height: 470,
    frame: false,
    show: true,
    backgroundColor: '#1b1512',
    webPreferences: {
      preload: path.join(__dirname, '_shot-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  await win.loadFile(path.join(__dirname, 'dist', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 1400));

  // Report the geometry of the tab rail and the pinned settings button.
  const probe = await win.webContents.executeJavaScript(`(() => {
    const tabs = document.getElementById('tabs');
    const scroll = document.getElementById('tabsScroll');
    const settings = document.querySelector('.tab-settings');
    const grid = document.querySelector('.tab-grid');
    const clock = document.getElementById('openClock');
    const visible = [...document.querySelectorAll('#tabsScroll .tab')].filter(b => !b.hidden).length;
    const r = (el) => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) }; };
    return {
      tabCount: visible,
      tabsWidth: Math.round(tabs.getBoundingClientRect().width),
      scrollRect: r(scroll),
      scrollScrollWidth: scroll.scrollWidth,
      scrollClientWidth: scroll.clientWidth,
      overflows: scroll.scrollWidth > scroll.clientWidth + 1,
      gridRect: r(grid),
      clockRect: r(clock),
      settingsRect: r(settings),
      settingsVisible: settings.getBoundingClientRect().right <= tabs.getBoundingClientRect().right + 1,
    };
  })()`);
  console.log('PROBE ' + JSON.stringify(probe, null, 2));

  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '_shot_card.png'), img.toPNG());
  console.log('shot written');
  app.exit(0);
});
