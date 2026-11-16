/* QA-only edge probe (Edward). Exercises the SHIPPED compiled launcher with
   injected OS hooks so guard order, AUMID validation and error shapes are
   checked without launching any app. Run: node _qa-notice-edges.js */
const launcher = require('./dist/main/noticeLaunch.js');

const state = { enabled: true, opens: [], focuses: [], focusResult: true, throwValue: null };
launcher.setNoticeLaunchHooks({
  openExternal: async (url) => {
    state.opens.push(url);
    if (state.throwValue !== null) throw state.throwValue;
  },
  focus: (app) => { state.focuses.push(app); return state.focusResult; },
  setting: () => state.enabled,
});

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + JSON.stringify(detail)}`);
};
const reset = (enabled = true) => {
  state.enabled = enabled; state.opens = []; state.focuses = [];
  state.focusResult = true; state.throwValue = null;
};

async function run() {
  reset(false);
  let r = await launcher.open('WhatsApp', 'body', 'Valid.Aumid', false);
  check('disabled known app: no launch, no focus, no AUMID resolution',
    r.code === 'disabled' && r.via === 'none' && !r.launched && !r.focused
    && state.opens.length === 0 && state.focuses.length === 0, { r, state });

  reset(false);
  r = await launcher.reply('MysteryApp', 'body', 'ignored', '', false);
  check('disabled unknown app is blocked before matching',
    r.code === 'disabled' && r.hint === r.error && state.opens.length === 0, { r });

  reset(false);
  r = await launcher.open('WhatsApp', 'body', 'Valid.Aumid');
  check('setting hook is consulted when no explicit flag is passed',
    r.code === 'disabled' && state.opens.length === 0, { r });

  reset(true);
  r = await launcher.reply('MysteryApp', 'body', 'x', '', true);
  check('unknown app: ok:false and no web search',
    r.ok === false && r.code === 'unknown-app' && r.error === 'Aplikasi sumber tidak dikenali.'
    && r.hint === r.error && state.opens.length === 0
    && state.opens.every((u) => !/google/.test(u)), { r, opens: state.opens });

  reset(true);
  r = await launcher.open('WhatsApp', 'body', '', true);
  check('known app opens its protocol and reports focus result',
    r.ok === true && r.via === 'protocol' && state.opens[0] === 'whatsapp://'
    && r.focused === true && state.focuses[0] === 'WhatsApp', { r, state });

  state.focusResult = false;
  r = await launcher.reply('Discord', 'body', '', '', true);
  check('focus failure gets a different honest hint',
    r.ok === true && r.focused === false
    && r.hint === 'Perintah dibuka diterima Windows · cek jendela aplikasi', { r });

  reset(true);
  r = await launcher.open('WhatsApp', 'body', 'Bad<AUMID>;DROP', true);
  check('malformed AUMID never reaches openExternal',
    r.ok === true && r.via === 'protocol' && state.opens[0] === 'whatsapp://', { r, opens: state.opens });

  reset(true);
  r = await launcher.open('WhatsApp', 'body', 'WhatsApp.Native.Client', true);
  check('valid AUMID uses shell:AppsFolder',
    r.via === 'aumid' && state.opens[0] === 'shell:AppsFolder\\WhatsApp.Native.Client', { r, opens: state.opens });

  reset(true);
  state.throwValue = '';
  r = await launcher.reply('WhatsApp', 'body', 'anything', '', true);
  check('empty launch error has a non-empty fallback message',
    r.ok === false && r.code === 'launch-failed' && r.error.length > 0
    && r.hint === r.error, { r });

  reset(true);
  r = await launcher.reply('WhatsApp', 'body', 'A & B', '', true);
  check('reply ignores text entirely',
    state.opens.length === 1 && state.opens[0] === 'whatsapp://'
    && !/A%20%26%20B|send\?text=/.test(state.opens.join(' ')), { r, opens: state.opens });

  const failed = results.filter((x) => !x.ok);
  console.log(`\nNOTICE_EDGES ${results.length - failed.length}/${results.length} FAILED=${failed.length}`);
  process.exitCode = failed.length ? 1 : 0;
}
run().catch((e) => { console.error(e); process.exitCode = 1; });
