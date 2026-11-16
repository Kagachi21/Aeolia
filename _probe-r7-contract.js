/* R7 contract probe: notification IPC result shapes, guard order and no-reply
   rules. Static source checks plus real calls to the compiled launcher with
   injected OS hooks. Run: node _probe-r7-contract.js */
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + JSON.stringify(detail)}`);
};

const main = read('src/main/main.ts');
const preload = read('src/preload/preload.ts');
const types = read('src/renderer/global.d.ts');
const renderer = read('src/renderer/renderer.ts');
const settings = read('src/settings/settings.ts');

check('global.d.ts declares NoticeLaunchResult', /type NoticeLaunchResult\s*=/.test(types));
check('global.d.ts declares NoticeReplyResult', /type NoticeReplyResult\s*=/.test(types));
check('global.d.ts declares CamToggleResult', /type CamToggleResult\s*=/.test(types));
check('CardNotice carries optional aumid', /interface CardNotice\s*\{[^}]*aumid\?:\s*string/s.test(types));
check('preload forwards aumid to notice:open',
  /openNotice:\s*\([^)]*aumid\?:\s*string[^)]*\)[^{]*ipcRenderer\.invoke\('notice:open',\s*app,\s*body,\s*aumid\)/s.test(preload));
check('preload forwards aumid to notice:reply',
  /noticeReply:\s*\([^)]*aumid\?:\s*string[^)]*\)[^{]*ipcRenderer\.invoke\('notice:reply',\s*app,\s*body,\s*text,\s*aumid\)/s.test(preload));
check('main delegates notice:open to the launcher module',
  /ipcMain\.handle\('notice:open'[\s\S]{0,260}noticeLauncher\.open\(/.test(main));
check('main delegates notice:reply to the launcher module',
  /ipcMain\.handle\('notice:reply'[\s\S]{0,300}noticeLauncher\.reply\(/.test(main));
check('legacy NOTICE_PROTOCOLS block is gone', !/NOTICE_PROTOCOLS/.test(main));
check('main notice block has no clipboard write', !/clipboard\.writeText/.test(main.slice(main.indexOf("ipcMain.handle('notice:open'"), main.indexOf("ipcMain.handle('stats:get'"))));
check('main has no web-search fallback for notices',
  !/google\.com\/search/.test(main) && !/kind:\s*'search'/.test(main));
check('renderer no longer renders a reply composer',
  !/notice-reply-input|notice-reply-send|clipboardPaste/.test(renderer.slice(renderer.indexOf('function renderNotices'), renderer.indexOf('function renderShelf'))));
check('renderer shows the result hint from the launcher',
  /showFeedback\(r\?\.hint/.test(renderer)
  && read('src/main/noticeLaunch.ts').includes('Aplikasi dibuka · ketik dan kirim di sana'));
check('renderer has no search feedback', !/pencarian web/i.test(renderer));
check('settings describes both blocked actions',
  /klik notifikasi\s+dan\s+Balas|Balas/.test(settings) && !/pencarian web/.test(settings));

let launcher = null;
try {
  launcher = require('./dist/main/noticeLaunch.js');
} catch (err) {
  check('compiled noticeLaunch module loads', false, String(err && err.message || err));
}
if (launcher) {
  const calls = {
    opens: [], focuses: [], setting: true,
    focus: (app) => { calls.focuses.push(app); return true; },
  };
  launcher.setNoticeLaunchHooks({
    openExternal: async (url) => { calls.opens.push(url); },
    focus: (app) => calls.focus(app),
    setting: () => calls.setting,
  });
  const reset = (setting = true) => {
    calls.opens = []; calls.focuses = []; calls.setting = setting;
  };

  (async () => {
    reset(false);
    let r = await launcher.open('WhatsApp', 'body', '', false);
    check('disabled guard blocks open before target resolution',
      r.ok === false && r.kind === 'app' && r.via === 'none' && r.launched === false
      && r.focused === false && r.code === 'disabled' && calls.opens.length === 0
      && calls.focuses.length === 0, { r, calls });

    reset(false);
    r = await launcher.reply('WhatsApp', 'body', 'ignored', '', false);
    check('disabled guard blocks reply with a visible reason',
      r.ok === false && r.code === 'disabled' && r.hint === r.error
      && r.launched === false && calls.opens.length === 0 && calls.focuses.length === 0,
      { r, calls });

    reset(true);
    r = await launcher.reply('TeamViewer', 'body', 'x', '', true);
    check('whole-token matching rejects TeamViewer as Teams',
      r.ok === false && r.code === 'unknown-app' && r.error === 'Aplikasi sumber tidak dikenali.'
      && calls.opens.length === 0 && calls.opens.every((u) => !/google/.test(u)), { r, calls });

    reset(true);
    r = await launcher.open('Zoom Meeting', 'body', '', true);
    check('whole-token matching accepts Zoom Meeting',
      r.ok === true && r.via === 'protocol' && calls.opens[0] === 'zoommtg://', { r, calls });

    reset(true);
    r = await launcher.reply('WhatsApp', 'body', 'do not prefill me', '', true);
    check('reply opens the app without using text or clipboard',
      r.ok === true && r.hint === 'Aplikasi dibuka · ketik dan kirim di sana'
      && calls.opens[0] === 'whatsapp://' && calls.focuses.length === 1, { r, calls });
    check('reply never produces a send URL or search URL',
      calls.opens.every((u) => !/text=|google/.test(u)), calls.opens);

    reset(true);
    calls.focus = () => false;
    r = await launcher.reply('Discord', 'body', '', '', true);
    check('focused:false uses a different honest hint',
      r.ok === true && r.focused === false && r.hint === 'Perintah dibuka diterima Windows · cek jendela aplikasi', { r });
    calls.focus = (app) => { calls.focuses.push(app); return true; };

    reset(true);
    r = await launcher.open('WhatsApp', 'body', 'Bad<AUMID>;DROP', true);
    check('invalid AUMID falls back to a protocol',
      r.ok === true && r.via === 'protocol' && calls.opens[0] === 'whatsapp://', { r, calls });

    reset(true);
    r = await launcher.open('WhatsApp', 'body', 'WhatsApp.Native.Client', true);
    check('valid AUMID uses shell:AppsFolder',
      r.ok === true && r.via === 'aumid' && calls.opens[0] === 'shell:AppsFolder\\WhatsApp.Native.Client', { r, calls });

    reset(true);
    launcher.setNoticeLaunchHooks({ openExternal: async () => { throw ''; } });
    r = await launcher.open('WhatsApp', 'body', '', true);
    check('empty launch error still produces a non-empty message',
      r.ok === false && r.code === 'launch-failed' && typeof r.error === 'string' && r.error.length > 0, { r });
    launcher.setNoticeLaunchHooks({ openExternal: async (url) => { calls.opens.push(url); } });

    reset(true);
    const aumid = '5319275A.WhatsAppDesktop_cv1g1gvanyjgm';
    launcher.setNoticeLaunchHooks({
      openExternal: async (url) => {
        calls.opens.push(url);
        if (/^shell:AppsFolder\\/.test(url)) throw new Error('shell scheme refused');
      },
    });
    r = await launcher.open('WhatsApp', 'body', aumid, true);
    check('AUMID launch failure retries the mapped protocol exactly once',
      r.ok === true && r.via === 'protocol' && r.launched === true
      && calls.opens.length === 2
      && calls.opens[0] === `shell:AppsFolder\\${aumid}`
      && calls.opens[1] === 'whatsapp://', { r, opens: calls.opens });
    launcher.setNoticeLaunchHooks({ openExternal: async (url) => { calls.opens.push(url); } });

    reset(true);
    launcher.setNoticeLaunchHooks({
      openExternal: async (url) => { calls.opens.push(url); throw new Error('refused'); },
    });
    r = await launcher.open('WhatsApp', 'body', aumid, true);
    check('AUMID and protocol both fail: ok:false via:protocol with two opens',
      r.ok === false && r.code === 'launch-failed' && r.via === 'protocol'
      && r.launched === false && calls.opens.length === 2
      && calls.opens[0] === `shell:AppsFolder\\${aumid}`
      && calls.opens[1] === 'whatsapp://', { r, opens: calls.opens });
    launcher.setNoticeLaunchHooks({ openExternal: async (url) => { calls.opens.push(url); } });

    const failed = results.filter((x) => !x.ok);
    console.log(`\nR7_CONTRACT ${results.length - failed.length}/${results.length} FAILED=${failed.length}`);
    process.exit(failed.length ? 1 : 0);
  })().catch((err) => {
    console.error('R7_CONTRACT ERROR', err && err.stack || err);
    process.exit(2);
  });
} else {
  const failed = results.filter((x) => !x.ok);
  console.log(`\nR7_CONTRACT ${results.length - failed.length}/${results.length} FAILED=${failed.length}`);
  process.exit(1);
}
