const { app } = require('electron');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const koffi = require('koffi');
app.whenReady().then(() => {
  const aw = require('./dist/main/activeWindow.js');
  console.log('focusedChrome', aw.focusProcessWindow('chrome'));
  const user32 = koffi.load('user32.dll');
  const active = aw.getActiveWindow({ x: 0, y: 0, width: 1920, height: 1080 });
  const hwnd = String(active.hwnd || user32.func('void *GetForegroundWindow()')() || '0');
  console.log('hwnd', hwnd);
  console.log('active', JSON.stringify(active));
  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'scripts', 'browser-tab-count.ps1'), hwnd,
    ], { encoding: 'utf8', timeout: 4000 });
    console.log('tabs', out.trim());
  } catch (e) { console.log('failed', String(e && e.message || e)); }
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
