/* Pure probe: the camera decision table. No Electron, no window focus.
   Run: node _probe-cam-decision.js */
const c = require('./dist/main/camToggle.js');

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};

// 1. Apps that really ship a camera shortcut still get one.
check('zoom has a shortcut', c.camShortcutFor('zoom') === 'alt+v');
check('teams has a shortcut', c.camShortcutFor('ms-teams') === 'ctrl+shift+o');
check('camShortcutKnown is true for zoom', c.camShortcutKnown('zoom') === true);

// 2. Discord ships no camera keybind. Sending a guessed combo would be a lie.
check('discord has no shortcut', c.camShortcutFor('discord') === null);
check('camShortcutKnown is false for discord', c.camShortcutKnown('discord') === false);

// 3. Focused Zoom -> send the real toggle.
const zoom = c.camDecision('zoom', 'zoom');
check('focused zoom sends the shortcut', zoom.send === 'alt+v' && !zoom.hint);

// 4. Zoom in the background -> bring it forward, ask for a second press.
const zoomBack = c.camDecision('zoom', 'chrome');
check('unfocused zoom focuses instead of sending',
  !zoomBack.send && zoomBack.focus === true && /Fokuskan/.test(zoomBack.hint || ''), zoomBack.hint);

// 5. Discord focused -> no send, but a hint the user can actually read.
const discord = c.camDecision('discord', 'discord');
check('focused discord never sends', !discord.send);
check('focused discord explains itself', /tidak punya shortcut kamera/.test(discord.hint || ''), discord.hint);
check('focused discord does not steal focus', discord.focus !== true);

// 6. Discord in the background -> focus it, so the click does something real.
const discordBack = c.camDecision('discord', 'explorer');
check('unfocused discord brings the app forward', discordBack.focus === true);

// 7. Unknown app -> still a named hint, never a silent no-op.
const unknown = c.camDecision('', 'explorer');
check('empty app still returns a hint', Boolean(unknown.hint), unknown.hint);

// 8. Result contract: no claimed success until camera state is observable.
const noShortcut = c.camResult(c.camDecision('Discord', 'discord'), false, true);
check('no-shortcut result is ok:false and verified:false',
  noShortcut.ok === false && noShortcut.verified === false && noShortcut.code === 'no-shortcut'
  && /best effort/.test(noShortcut.hint), noShortcut);
const needFocus = c.camResult(c.camDecision('Zoom', 'chrome'), false, true);
check('need-focus result carries the focus hint',
  needFocus.code === 'need-focus' && needFocus.sent === false && /best effort/.test(needFocus.hint), needFocus);
const sent = c.camResult(c.camDecision('Zoom', 'zoom'), true, true);
check('sent shortcut is never reported as a verified success',
  sent.code === 'unverified-shortcut' && sent.sent === true && sent.ok === false
  && sent.verified === false && /best effort/.test(sent.hint), sent);
const sendFail = c.camResult(c.camDecision('Zoom', 'zoom'), false, true);
check('failed send reports send-failed', sendFail.code === 'send-failed' && sendFail.ok === false, sendFail);
check('camResult never returns ok:true',
  [noShortcut, needFocus, sent, sendFail].every((r) => r.ok === false && r.verified === false));

// 9. Whole-token matching: MeetNow is not Meet, Zoom Meeting is still Zoom.
check('MeetNow does not inherit the Meet shortcut', c.camShortcutFor('MeetNow') === null,
  c.camShortcutFor('MeetNow'));
check('Zoom Meeting still resolves to alt+v', c.camShortcutFor('Zoom Meeting') === 'alt+v',
  c.camShortcutFor('Zoom Meeting'));
check('Google Meet resolves to ctrl+e', c.camShortcutFor('Google Meet') === 'ctrl+e',
  c.camShortcutFor('Google Meet'));
check('ms-teams resolves to the Teams shortcut', c.camShortcutFor('ms-teams') === 'ctrl+shift+o',
  c.camShortcutFor('ms-teams'));
const meetNow = c.camDecision('MeetNow', 'meetnow');
check('focused MeetNow stays a no-shortcut decision', meetNow.code === 'no-shortcut'
  && !meetNow.send && meetNow.observedFocus === true, meetNow);
const zoomTokens = c.camDecision('Zoom Meeting', 'zoom.exe');
check('process basename matches app tokens as a whole', zoomTokens.observedFocus === true
  && zoomTokens.send === 'alt+v', zoomTokens);
const notFocused = c.camDecision('Zoom Meeting', 'MeetNow.exe');
check('different basename is not reported as focused', notFocused.observedFocus === false
  && notFocused.code === 'need-focus', notFocused);
check('camResult uses observed foreground or a successful focus call',
  c.camResult(zoomTokens, true, false).focused === true
  && c.camResult(notFocused, false, false).focused === false
  && c.camResult(notFocused, false, true).focused === true);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
