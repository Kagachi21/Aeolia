/* Focused probe: the shipped notices only open the source app, and the UI
   prints the launcher's result without claiming a message was sent.
   Run: env -u ELECTRON_RUN_AS_NODE electron.exe _probe-notice-launch.js */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const main = read('src/main/main.ts');
const preload = read('src/preload/preload.ts');
const types = read('src/renderer/global.d.ts');
const renderer = read('src/renderer/renderer.ts');
const launcher = read('src/main/noticeLaunch.ts');
const liveNotice = read('_probe-r7-notice-live.js');
const uiBlock = renderer.slice(renderer.indexOf('function renderNotices'), renderer.indexOf('function renderShelf'));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};

check('main delegates both notice handlers',
  /noticeLauncher\.open\(/.test(main) && /noticeLauncher\.reply\(/.test(main));
check('guard lives in the launcher before target resolution',
  launcher.indexOf('const blocked = guard(') < launcher.indexOf('const key = matchKey('));
check('external launches are awaited', /await hooks\.openExternal\(/.test(launcher));
check('launch errors are returned with a code and message',
  /code: 'launch-failed'/.test(launcher)
  && /error:\s*(?:detail|error)\s*\|\|\s*LAUNCH_FAILED/.test(launcher));
check('reply has no clipboard, send URL or paste path',
  !/clipboard\.|send\?text=|pasteShortcut\(/.test(launcher));
check('web search fallback is gone',
  !/google\.com\/search|kind:\s*'search'/.test(main + launcher + renderer));
check('whole-token matching rejects TeamViewer',
  /split\(\/\[\^a-z0-9\]\+\/\)/.test(launcher) && /matchTokens/.test(launcher));
check('open success distinguishes launched from focused',
  /focused: focusTarget\(/.test(launcher) && /launched: true/.test(launcher));
check('reply hint is honest and has an unfocused variant',
  launcher.includes('Aplikasi dibuka · ketik dan kirim di sana')
  && launcher.includes('Perintah dibuka diterima Windows · cek jendela aplikasi'));
check('preload forwards aumid on both calls',
  /invoke\('notice:open',\s*app,\s*body,\s*aumid\)/.test(preload)
  && /invoke\('notice:reply',\s*app,\s*body,\s*text,\s*aumid\)/.test(preload));
check('types describe the one app-launch contract',
  /type NoticeLaunchResult/.test(types) && /type NoticeReplyResult/.test(types)
  && !/copied\?:|prefilled\?:|kind\?: 'app' \| 'search'/.test(types));
check('live AUMID assertion requires the exact two-step launch order',
  liveNotice.includes("observed.opens[0] === aumidUrl && observed.opens[1] === 'whatsapp://'")
  && !liveNotice.includes("observed.opens.includes('whatsapp://')"));
check('renderer renders one Balas button and no composer',
  /notice-reply-toggle/.test(uiBlock) && !/notice-reply-input|notice-reply-send/.test(uiBlock));
check('renderer shows launcher errors and hints',
  /showFeedback\(r\?\.error/.test(uiBlock) && /showFeedback\(r\?\.hint/.test(uiBlock));
check('renderer distinguishes focused and unfocused open',
  /r\.focused/.test(uiBlock) && /Perintah dibuka diterima Windows/.test(uiBlock));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function runtimeFeedback() {
  const notice = { id: 'n1', app: 'WhatsApp', title: 'Watashi', body: 'Test', at: Date.now() };
  let replyResult = { ok: false, hint: 'Aplikasi sumber tidak dikenali.', error: 'Aplikasi sumber tidak dikenali.' };
  let openResult = { ok: false, error: 'Gagal membuka WhatsApp.' };
  const baseState = () => ({
    lastTab: 'notifications', notices: [notice], clips: [], sites: [], shelf: [],
    tasks: [], waterMl: 0, waterGoalMl: 2000, waterStartHour: 8, waterEndHour: 22,
    waterEveryMin: 45, waterEnabled: false, waterSound: false, waterDay: '', eyeBreakMin: 20,
    eyeBreakSound: false, prayerCity: '', greetingSeen: true,
  });
  ipcMain.handle('state:get', baseState);
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
  const note = () => win.webContents.executeJavaScript(
    `document.querySelector('#noticeList .notice-reply-note')?.textContent || ''`);
  try {
    await win.loadFile(path.join(root, 'dist', 'renderer', 'index.html'));
    win.webContents.send('island:update', {
      state: 'open', surface: 'Liquid glass', glassLevel: 55, accent: '#e9eef7',
      cardWidth: 420, visibleTabs: ['notifications'], scaleEffective: 100,
      miniMode: 'clock', meeting: false, media: false, hiddenUntilHover: false,
    });
    await sleep(360);
    check('feedback harness rendered a notice row',
      await win.webContents.executeJavaScript(`Boolean(document.querySelector('#noticeList .notice-main'))`));

    await win.webContents.executeJavaScript(`document.querySelector('#noticeList .notice-main').click(); true`);
    await sleep(80);
    check('open failure is visible', (await note()).includes('Gagal membuka WhatsApp.'), await note());

    openResult = { ok: true, kind: 'app', app: 'WhatsApp', via: 'protocol',
      launched: true, focused: true };
    await win.webContents.executeJavaScript(`document.querySelector('#noticeList .notice-main').click(); true`);
    await sleep(80);
    const focusedNote = await note();
    check('open success names the app without claiming a chat',
      focusedNote === 'Membuka WhatsApp.', focusedNote);

    openResult = { ...openResult, focused: false };
    await win.webContents.executeJavaScript(`document.querySelector('#noticeList .notice-main').click(); true`);
    await sleep(80);
    const unfocusedNote = await note();
    check('unfocused open gets an honest, different hint',
      unfocusedNote === 'Perintah dibuka diterima Windows · cek jendela aplikasi', unfocusedNote);

    replyResult = { ok: false, hint: 'Tautan notifikasi dinonaktifkan di pengaturan.' };
    await win.webContents.executeJavaScript(`document.querySelector('.notice-reply-toggle').click(); true`);
    await sleep(80);
    check('reply failure prints the launcher hint',
      (await note()) === 'Tautan notifikasi dinonaktifkan di pengaturan.', await note());

    replyResult = { ok: true, kind: 'app', app: 'WhatsApp', via: 'protocol',
      launched: true, focused: true, hint: 'Aplikasi dibuka · ketik dan kirim di sana' };
    await win.webContents.executeJavaScript(`document.querySelector('.notice-reply-toggle').click(); true`);
    await sleep(80);
    const okNote = await note();
    check('Balas success says the user types and sends in the app',
      okNote === 'Aplikasi dibuka · ketik dan kirim di sana', okNote);
    check('no composer and no sent claim after Balas',
      await win.webContents.executeJavaScript(
        `!document.querySelector('.notice-reply-input') && !/terkirim|tersalin/i.test(document.querySelector('#noticeList .notice-reply-note').textContent)`));
  } catch (e) {
    check('feedback probe ran without throwing', false, String(e && e.stack || e));
  } finally {
    win.destroy();
  }
}
app.whenReady().then(async () => {
  await runtimeFeedback();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nNOTICELAUNCH ${results.length - failed.length}/${results.length} FAILED=${failed.length}`);
  app.exit(failed.length === 0 ? 0 : 1);
}).catch((e) => { console.error(e); app.exit(1); });
