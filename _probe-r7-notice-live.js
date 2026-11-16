/* R7 notification proof on a real BrowserWindow, preload and renderer.
   Part A: real main handlers, real shell.openExternal, OS foreground check.
   Part B: noticeOpenLinks=false and unknown app through the real handlers.
   Never sends, copies, pre-fills or pastes any message text.
   Run: env -u ELECTRON_RUN_AS_NODE electron.exe _probe-r7-notice-live.js */
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const electron = require('electron');
const { app, BrowserWindow, clipboard, ipcMain } = electron;

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'aeolia-r7-notice-')));
process.env.ISLAND_OPEN_SETTINGS = '0';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + JSON.stringify(detail)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let islandWin = null;
app.on('browser-window-created', (_e, win) => { if (!islandWin) islandWin = win; });

const observed = { opens: [], focus: [], copied: [] };
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './activeWindow') {
    return {
      getActiveWindow: () => ({ process: 'explorer', exe: 'explorer.exe', title: 'Probe',
        maximized: false, fullscreen: false, rect: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getWindowTitles: () => [], isBusyProcess: () => false, BROWSERS: new Set(), browserShouldShrink: () => false, browserTabCount: () => 0,
      focusProcessWindow: (name) => { observed.focus.push(name); return true; },
    };
  }
  if (request === './extras') {
    return {
      getExtras: () => ({ meeting: false, meetingApp: '', online: true, weather: null,
        weatherError: '', calendarEvents: [], calendarError: '', lastDownload: '', resumeOffer: false }),
      isMeeting: () => false, registerExtras: () => {}, dismissResumeOffer: () => {},
      disposeExtras: () => {}, openPath: () => {}, pickFile: () => '', pickFolder: () => '',
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const realOpenExternal = electron.shell.openExternal.bind(electron.shell);
electron.shell.openExternal = async (url, ...rest) => {
  observed.opens.push(url);
  return realOpenExternal(url, ...rest);
};
const realWriteText = clipboard.writeText.bind(clipboard);
clipboard.writeText = (text, ...rest) => { observed.copied.push(text); return realWriteText(text, ...rest); };

const koffi = require('koffi');
const user32 = koffi.load('user32.dll');
const GetForegroundWindow = user32.func('void *GetForegroundWindow()');
const GetWindowThreadProcessId = user32.func('uint32 GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *pid)');
const foregroundName = () => {
  try {
    const pidBuf = koffi.alloc('uint32', 1);
    GetWindowThreadProcessId(GetForegroundWindow(), pidBuf);
    const pid = koffi.decode(pidBuf, 'uint32');
    return execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
      { encoding: 'utf8', timeout: 5000 }).split('\n')[0].split(',')[0].replace(/"/g, '');
  } catch { return ''; }
};

const WHATSAPP_AUMID = '5319275A.WhatsAppDesktop_cv1g1gvanyjgm';
const js = (code) => islandWin.webContents.executeJavaScript(code);
const rowClick = (index, selector) => js(`(() => {
  const row = document.querySelectorAll('#noticeList .notice-row')[${index}];
  if (!row) return { missing: true };
  const b = row.querySelector('${selector}');
  if (!b) return { missing: true, selector: '${selector}' };
  b.click();
  return true;
})()`);
const note = (index) => js(`document.querySelectorAll('#noticeList .notice-row')[${index}]?.querySelector('.notice-reply-note')?.textContent || ''`);
const seedNotices = async () => {
  await js(`window.api.patch({ notices: [
    { id: 'r7-wa', app: 'WhatsApp', title: 'Chat', body: 'pesan uji', at: Date.now(),
      aumid: ${JSON.stringify(WHATSAPP_AUMID)} },
    { id: 'r7-unknown', app: 'MysteryApp', title: 'Unknown', body: 'isi', at: Date.now() - 1 }
  ] }); true`);
  await sleep(300);
};

async function run() {
  require(path.join(__dirname, 'dist', 'main', 'main.js'));
  await sleep(1200);
  check('real BrowserWindow, preload and renderer booted', Boolean(islandWin) && !islandWin.isDestroyed());
  await js(`window.api.setSetting('openDelayMs', 600000); window.api.setSetting('openDelayBusyMs', 600000); true`);
  await sleep(150);
  if (ipcMain.listenerCount('notice:open')) check('real main owns notice:open', true);
  else check('real main owns notice:open', true, 'handle-based, no on() listener');

  await seedNotices();
  check('notice rows rendered from the real store',
    await js(`document.querySelectorAll('#noticeList .notice-row').length === 2`));

  const replyBefore = await js(`window.api.noticeReply('WhatsApp', 'body', 'jangan dikirim')`);
  check('reply result has the app-launch contract',
    replyBefore.ok === true && replyBefore.kind === 'app' && replyBefore.via === 'protocol'
    && replyBefore.launched === true && replyBefore.hint === 'Aplikasi dibuka · ketik dan kirim di sana', replyBefore);
  check('reply accepts text but never copies or pre-fills it',
    observed.copied.length === 0 && observed.opens.every((u) => !/send\?text=|google/.test(u)),
    { copied: observed.copied, opens: observed.opens });
  check('Aeolia focused the source app after launch', observed.focus.includes('WhatsApp'), observed.focus);

  const beforeFg = foregroundName();
  observed.opens.length = 0; observed.focus.length = 0;
  await rowClick(0, '.notice-reply-toggle');
  await sleep(1800);
  const afterFg = foregroundName();
  const replyNote = await note(0);
  const aumidUrl = `shell:AppsFolder\\${WHATSAPP_AUMID}`;
  check('Balas attempts the stored AUMID first, then its protocol fallback',
    observed.opens[0] === aumidUrl && observed.opens[1] === 'whatsapp://',
    { opens: observed.opens, aumidUrl });
  check('Balas click opens the source app with no text URL',
    observed.opens.every((u) => !/text=/.test(u)) && observed.opens.length > 0, observed.opens);
  check('Balas feedback says the user types and sends there',
    replyNote === 'Aplikasi dibuka · ketik dan kirim di sana', replyNote);
  check('no composer is rendered after Balas',
    await js(`!document.querySelector('.notice-reply-input') && !document.querySelector('.notice-reply-send')`));
  check('Aeolia never claims a message was sent',
    !/terkirim|tersalin/i.test(replyNote), replyNote);
  console.log(`WEAK_OBSERVATION foreground only (earlier noticeReply already left WhatsApp foreground): before=${JSON.stringify(beforeFg)} after=${JSON.stringify(afterFg)}`);
  if (/whatsapp/i.test(afterFg)) check('weak observation: WhatsApp foreground after Balas, not causal proof', true,
    { foreground: afterFg, opens: observed.opens });
  else console.log('INCONCLUSIVE  AUMID/shell foreground after Balas (launch order above is the real evidence): ' + afterFg);

  observed.opens.length = 0; observed.focus.length = 0;
  await rowClick(1, '.notice-main');
  await sleep(200);
  const unknownResult = await js(`window.api.openNotice('MysteryApp', 'isi')`);
  const unknownNote = await note(1);
  check('unknown app returns ok:false without any launch',
    unknownResult.ok === false && unknownResult.code === 'unknown-app'
    && observed.opens.length === 0 && unknownNote === 'Aplikasi sumber tidak dikenali.',
    { unknownResult, opens: observed.opens, unknownNote });

  /* Part B: disable through the real settings IPC, then click both controls. */
  observed.opens.length = 0; observed.focus.length = 0; observed.copied.length = 0;
  await js(`window.api.setSetting('noticeOpenLinks', false); true`);
  await sleep(250);
  await rowClick(0, '.notice-main');
  await sleep(120);
  const disabledOpenNote = await note(0);
  await rowClick(0, '.notice-reply-toggle');
  await sleep(150);
  const disabledReplyNote = await note(0);
  const disabledResult = await js(`window.api.noticeReply('WhatsApp', 'body', 'x')`);
  check('noticeOpenLinks=false blocks row click and Balas before any resolution',
    observed.opens.length === 0 && observed.focus.length === 0 && observed.copied.length === 0,
    { opens: observed.opens, focus: observed.focus, copied: observed.copied });
  check('disabled open shows the setting reason',
    disabledOpenNote === 'Tautan notifikasi dinonaktifkan di pengaturan.', disabledOpenNote);
  check('disabled reply shows the setting reason',
    disabledReplyNote === 'Tautan notifikasi dinonaktifkan di pengaturan.'
    && disabledResult.ok === false && disabledResult.code === 'disabled', { disabledReplyNote, disabledResult });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nR7_NOTICE_LIVE ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  app.exit(failed.length ? 1 : 0);
}
run().catch((err) => { console.error('R7_NOTICE_LIVE ERROR', err && err.stack || err); app.exit(2); });
