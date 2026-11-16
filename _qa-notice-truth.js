/* QA-only probe (Edward): renderer feedback must match the shipped notice
   result shapes. Run with Electron: electron.exe _qa-notice-truth.js */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

const root = __dirname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};

app.whenReady().then(async () => {
  const notice = { id: 'n1', app: 'WhatsApp', title: 'Watashi', body: 'chat body', at: Date.now() };
  let openResult = { ok: false, kind: 'app', app: 'WhatsApp', via: 'none',
    launched: false, focused: false, code: 'unknown-app', error: 'Aplikasi sumber tidak dikenali.' };
  let replyResult = { ok: false, kind: 'app', app: 'WhatsApp', via: 'none', launched: false,
    focused: false, hint: 'Tautan notifikasi dinonaktifkan di pengaturan.',
    error: 'Tautan notifikasi dinonaktifkan di pengaturan.' };
  ipcMain.handle('state:get', () => ({
    lastTab: 'notifications', notices: [notice], clips: [], sites: [], shelf: [],
    tasks: [], waterMl: 0, waterGoalMl: 2000, waterStartHour: 8, waterEndHour: 22,
    waterEveryMin: 45, waterEnabled: false, waterSound: false, waterDay: '', eyeBreakMin: 20,
    eyeBreakSound: false, prayerCity: '', greetingSeen: true,
  }));
  ipcMain.handle('settings:get', () => ({
    surface: 'Liquid glass', glassLevel: 55, accent: '#e9eef7', cardWidth: 420,
    visibleTabs: ['notifications'], barOrder: ['clock'], miniMode: 'clock',
  }));
  ipcMain.handle('extras:get', () => ({ meeting: false, meetingApp: '', online: true,
    weather: null, weatherError: '', calendarEvents: [], calendarError: '',
    lastDownload: '', resumeOffer: false }));
  ipcMain.handle('ctl:brightness', () => ({ supported: false, current: 50 }));
  ipcMain.handle('stats:get', () => ({ cpu: 0, ramUsedMb: 0, ramTotalMb: 0, ramPercent: 0 }));
  ipcMain.handle('notice:open', async () => openResult);
  ipcMain.handle('notice:reply', async () => replyResult);

  const win = new BrowserWindow({
    width: 420, height: 520, frame: false, show: false, transparent: true,
    webPreferences: {
      preload: path.join(root, 'dist', 'preload', 'preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: false, backgroundThrottling: false,
    },
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const note = () => js(`document.querySelector('#noticeList .notice-reply-note')?.textContent || ''`);
  try {
    await win.loadFile(path.join(root, 'dist', 'renderer', 'index.html'));
    win.webContents.send('island:update', {
      state: 'open', surface: 'Liquid glass', glassLevel: 55, accent: '#e9eef7',
      cardWidth: 420, visibleTabs: ['notifications'], scaleEffective: 100,
      miniMode: 'clock', meeting: false, media: false, hiddenUntilHover: false,
    });
    await sleep(360);
    check('notice row rendered', await js(`document.querySelectorAll('#noticeList .notice-row').length === 1`));

    await js(`document.querySelector('.notice-main').click(); true`);
    await sleep(80);
    check('failure shows the launcher error', (await note()) === 'Aplikasi sumber tidak dikenali.', await note());

    openResult = { ok: true, kind: 'app', app: 'WhatsApp', via: 'protocol',
      launched: true, focused: true };
    await js(`document.querySelector('.notice-main').click(); true`);
    await sleep(80);
    check('success names the source app only', (await note()) === 'Membuka WhatsApp.', await note());

    await js(`document.querySelector('.notice-reply-toggle').click(); true`);
    await sleep(80);
    check('reply failure shows the visible reason',
      (await note()) === 'Tautan notifikasi dinonaktifkan di pengaturan.', await note());

    replyResult = { ok: true, kind: 'app', app: 'WhatsApp', via: 'protocol', launched: true,
      focused: true, hint: 'Aplikasi dibuka · ketik dan kirim di sana' };
    await js(`document.querySelector('.notice-reply-toggle').click(); true`);
    await sleep(80);
    const okNote = await note();
    check('reply success tells the user to type and send there',
      okNote === 'Aplikasi dibuka · ketik dan kirim di sana', okNote);
    check('no sent or copied claim and no composer',
      !/terkirim|tersalin/i.test(okNote)
      && await js(`!document.querySelector('.notice-reply-input') && !document.querySelector('.notice-reply-send')`));
  } catch (e) {
    check('truth probe ran without throwing', false, String(e && e.stack || e));
  } finally {
    win.destroy();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nNOTICE_TRUTH ${results.length - failed.length}/${results.length} FAILED=${failed.length}`);
  app.exit(failed.length ? 1 : 0);
}).catch((e) => { console.error(e); app.exit(1); });
