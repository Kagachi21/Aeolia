/* Empirical check: with CSS zoom on the open card, what do offsetHeight and
   getBoundingClientRect report? Decides whether measureCard must divide by
   the island scale. Run: env -u ELECTRON_RUN_AS_NODE electron.exe _qa-zoom.js */
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 504, height: 300, show: false, webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  await win.loadURL('data:text/html,<html><body style="margin:0">' +
    '<div id="island" style="position:absolute;inset:0">' +
    '<div id="open" style="position:absolute;inset:0;display:block">' +
    '<div class="content" style="height:200px"></div>' +
    '</div></div>' +
    '<script>' +
    'window.result = (() => {' +
    'const open = document.getElementById("open");' +
    'open.style.zoom = "1.4";' +
    'const r = open.getBoundingClientRect();' +
    'return { offsetHeight: open.offsetHeight, rectHeight: r.height, inner: window.innerHeight };' +
    '})();' +
    '</script></body></html>');
  const result = await win.webContents.executeJavaScript('window.result');
  console.log('ZOOM_PROBE', JSON.stringify(result));
  console.log('offsetHeight includes zoom:', result.offsetHeight === Math.round(300 * 1.4) || result.offsetHeight === 420);
  app.quit();
});
