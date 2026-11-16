/* QA-only probe (Edward): real OS activation via the SAME Electron API the
   shipped notice flow uses. Does not type, send, or close anything. */
const { app, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const url = 'whatsapp://send?text=aeolia-qa';
const log = path.join(__dirname, '_qa-activation-result.txt');
const lines = [];
const say = (s) => { lines.push(s); console.log(s); fs.writeFileSync(log, lines.join('\n') + '\n', 'utf8'); };

app.whenReady().then(async () => {
  say(`CALL ${new Date().toISOString()} shell.openExternal(${url})`);
  try {
    const r = await shell.openExternal(url);
    say(`RESOLVED ${new Date().toISOString()} :: ${JSON.stringify(r)}`);
  } catch (e) {
    say(`THREW ${new Date().toISOString()} :: ${e && e.message || e}`);
  }
  // Give the OS ~1.2s to bring the target app forward, as requested.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  say(`SAMPLE_DONE ${new Date().toISOString()}`);
  app.exit(0);
}).catch((e) => { say('BOOT_ERROR ' + String(e && e.stack || e)); app.exit(1); });
