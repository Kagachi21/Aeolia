/* One-off live activation check (throwaway, NOT product).
 * Opens WhatsApp with its plain protocol and reports the foreground window.
 * It never copies, pre-fills, types, sends, or closes anything.
 * Run: env -u ELECTRON_RUN_AS_NODE electron.exe _qa-live-notice.js
 */
const { app, shell } = require('electron');
const { execFileSync } = require('node:child_process');
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const GetForegroundWindow = user32.func('void *GetForegroundWindow()');
const GetWindowThreadProcessId = user32.func('uint32 GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *pid)');

const foreground = () => {
  const hwnd = GetForegroundWindow();
  const pidBuf = koffi.alloc('uint32', 1);
  GetWindowThreadProcessId(hwnd, pidBuf);
  const pid = koffi.decode(pidBuf, 'uint32');
  let name = '';
  try {
    name = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
      .split('\n')[0].split(',')[0].replace(/"/g, '');
  } catch { /* tasklist unavailable */ }
  return { pid, name };
};

app.whenReady().then(async () => {
  console.log('before:', JSON.stringify(foreground()));
  try {
    const result = await shell.openExternal('whatsapp://');
    console.log('openExternal resolved:', String(result));
  } catch (e) {
    console.log('openExternal rejected:', String(e && e.message || e));
  }
  await new Promise((r) => setTimeout(r, 1800));
  const after = foreground();
  console.log('after:', JSON.stringify(after));
  const activated = /whatsapp/i.test(after.name);
  console.log(activated ? 'LIVE_ACTIVATION PASS' : 'LIVE_ACTIVATION INCONCLUSIVE');
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
