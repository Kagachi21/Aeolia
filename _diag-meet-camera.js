const { app } = require('electron');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const keybd_event = user32.func('void keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr extra)');
const CTRL = 0x11, E = 0x45, UP = 0x0002;

app.whenReady().then(() => {
  const aw = require('./dist/main/activeWindow.js');
  console.log('focusChrome', aw.focusProcessWindow('chrome'));
  const active = aw.getActiveWindow({ x: 0, y: 0, width: 1920, height: 1080 });
  console.log('active', active.process, active.title, active.hwnd);
  const script = path.join(__dirname, 'scripts', 'meet-camera-state.ps1');
  const read = () => {
    try {
      return execFileSync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, String(active.hwnd),
      ], { encoding: 'utf8', timeout: 4000 }).trim();
    } catch (e) { return 'ERROR ' + String(e && e.message || e); }
  };
  const toggle = () => {
    keybd_event(CTRL, 0, 0, 0);
    keybd_event(E, 0, 0, 0);
    keybd_event(E, 0, UP, 0);
    keybd_event(CTRL, 0, UP, 0);
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  (async () => {
    console.log('before:', JSON.stringify(read()));
    toggle(); await wait(1200);
    console.log('after1:', JSON.stringify(read()));
    toggle(); await wait(1200);
    console.log('restored:', JSON.stringify(read()));
    app.quit();
  })().catch((e) => { console.error(e); app.exit(1); });
}).catch((e) => { console.error(e); app.exit(1); });
