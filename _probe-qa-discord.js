/* QA Yan - READ-ONLY Discord voice-pill detection probe (throwaway).
 * Runs the production helper exactly as the main process does, then exercises
 * the pure meeting decision with a simulated Discord capture. Never joins a
 * call, never sends input, never modifies source or settings.
 *
 * Run: env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe _probe-qa-discord.js
 */
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const root = __dirname;
const say = (...a) => console.log(...a);
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

app.whenReady().then(async () => {
  try {
    const cap = require(path.join(root, 'dist', 'main', 'captureSessions.js'));
    const extras = require(path.join(root, 'dist', 'main', 'extras.js'));

    say('PLATFORM', process.platform, 'electron', process.versions.electron);

    /* 1. Production path: this is what main.ts:554 hands to extras.ts:140. */
    const first = await cap.getActiveCaptureProcesses();
    await new Promise((r) => setTimeout(r, 300));
    const second = await cap.getActiveCaptureProcesses();
    say('LIVE_CAPTURE_1', JSON.stringify(first));
    say('LIVE_CAPTURE_2', JSON.stringify(second));
    say('LIVE_DECISION', JSON.stringify(extras.selectMeetingApp([], first, true, [])));

    /* 2. Wire-format proof: a real Discord capture session line. */
    const synthetic = 'diag|devices=1|sessions=1\npid=4242|name=Discord|state=1';
    say('PARSE_DISCORD_LINE', JSON.stringify(cap.parseCaptureSessions(synthetic)));
    say('PARSE_REAL_HELPER_SHAPE', JSON.stringify(cap.parseCaptureSessions('diag|devices=1|sessions=4')));

    /* 3. Decision matrix (meetingAuto on, empty ignore list). */
    const calls = {
      simulatedDiscordCapture: extras.selectMeetingApp([], ['discord'], true, []),
      simulatedDiscordExeCapture: extras.selectMeetingApp([], ['Discord.exe'], true, []),
      simulatedZoomCapture: extras.selectMeetingApp([], ['zoom'], true, []),
      discordTitleOnly: extras.selectMeetingApp(
        [{ process: 'Discord', title: 'Discord | #general | Server' }], [], true, []),
      zoomTitleOnly: extras.selectMeetingApp(
        [{ process: 'Zoom', title: 'Zoom Meeting' }], [], true, []),
      discordCaptureAutoOff: extras.selectMeetingApp([], ['discord'], false, []),
      discordCaptureIgnored: extras.selectMeetingApp([], ['discord'], true, ['discord']),
      audiodgCapture: extras.selectMeetingApp([], ['audiodg'], true, []),
    };
    for (const [k, v] of Object.entries(calls)) say('DECIDE', k, JSON.stringify(v));

    /* 4. Is the cached PowerShell/DLL the one the current code would emit? */
    const compiled = fs.readFileSync(path.join(root, 'dist', 'main', 'captureSessions.js'), 'utf8').split(/\r?\n/);
    const start = compiled.findIndex((l) => l.startsWith('const PS_SCRIPT = `'));
    const end = compiled.findIndex((l, i) => i > start && l.includes('`.trim();'));
    const generated = compiled.slice(start + 1, end).join('\n');
    const cached = path.join(os.tmpdir(), 'aeolia-capture-sessions.ps1');
    const cachedText = fs.existsSync(cached) ? fs.readFileSync(cached, 'utf8') : '(missing)';
    say('PS_GENERATED_SHA', hash(generated), 'bytes', generated.length);
    say('PS_CACHED_SHA   ', hash(cachedText), 'bytes', cachedText.length);
    say('PS_MATCH', generated.trim() === cachedText.trim());
    say('DLL_EXISTS', fs.existsSync(path.join(os.tmpdir(), 'aeolia-capture-sessions.dll')));

    /* 5. What the installed profile actually has for the two gates. */
    const sp = path.join(process.env.APPDATA || '', 'Aeolia Island', 'settings.json');
    if (fs.existsSync(sp)) {
      const j = JSON.parse(fs.readFileSync(sp, 'utf8'));
      say('INSTALLED_SETTINGS', JSON.stringify({
        meetingAuto: j.meetingAuto, meetingMicButton: j.meetingMicButton,
        islandScale: j.islandScale, meetingIgnoreApps: j.meetingIgnoreApps,
      }));
    } else say('INSTALLED_SETTINGS (missing)');
  } catch (err) {
    say('PROBE_ERROR', String((err && err.stack) || err));
  }
  app.exit(0);
});
