/* R7 runner: executes every contract, live and regression probe from the
   design's verification list and writes a plain-text summary artifact.
   Run: node _probe-r7-run-all.js */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = __dirname;
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const summaryPath = path.join(root, '_qa-shots', 'r7-run-all.txt');
const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const steps = [
  { name: 'build', cmd: command, args: ['run', 'build'] },
  { name: 'r7-contract', node: '_probe-r7-contract.js' },
  { name: 'notice-edges', node: '_qa-notice-edges.js' },
  { name: 'notice-launch', electron: '_probe-notice-launch.js' },
  { name: 'notice-truth', electron: '_qa-notice-truth.js' },
  { name: 'r7-notice-live', electron: '_probe-r7-notice-live.js' },
  { name: 'r7-mic-live', electron: '_probe-r7-mic-live.js' },
  { name: 'r7-mic-failure', node: '_probe-r7-mic-failure.js' },
  { name: 'r7-mic-failure-ui', electron: '_probe-r7-mic-failure.js' },
  { name: 'r7-cam-live', electron: '_probe-r7-cam-live.js' },
  { name: 'cam-decision', node: '_probe-cam-decision.js' },
  { name: 'micclick', electron: '_probe-micclick.js' },
  { name: 'probe-ui', electron: '_probe-ui.js' },
  { name: 'probe-live', electron: '_probe-live.js' },
  { name: 'glass-material', electron: '_probe-glass-material.js' },
  { name: 'r7-glass', electron: '_probe-r7-glass.js' },
  { name: 'r8-fixes', electron: '_probe-r8-fixes.js' },
  { name: 'ink-sweep', electron: '_probe-ink-sweep.js' },
  { name: 'qa-features', node: '_qa-features.js' },
  { name: 'qa-main', node: '_qa-main.js' },
  { name: 'qa-preload', node: '_qa-preload.js' },
];

function runStep(step) {
  let cmd = step.cmd || process.execPath;
  let args = step.args || [];
  const env = { ...process.env };
  if (step.electron) {
    cmd = electron;
    args = [path.join(root, step.electron)];
    delete env.ELECTRON_RUN_AS_NODE;
  } else if (step.node) {
    args = [path.join(root, step.node)];
  }
  const started = Date.now();
  const result = spawnSync(cmd, args, {
    cwd: root, env, encoding: 'utf8', timeout: 300000,
    maxBuffer: 32 * 1024 * 1024, windowsHide: true,
    shell: Boolean(step.cmd),
  });
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  const lines = out.split(/\r?\n/);
  const pass = lines.filter((l) => /^PASS\s/.test(l)).length;
  const fail = lines.filter((l) => /^FAIL\s/.test(l)).length;
  const inconclusive = lines.filter((l) => /^INCONCLUSIVE\s/.test(l)).length;
  const measured = (out.match(/elements measured:\s*(\d+)/) || [])[1];
  const note = measured ? `elements=${measured}` : pass + fail === 0
    ? (lines.find((l) => /\b(PASS|FAIL)\b/.test(l) && !/^(PASS|FAIL)\s/.test(l)) || '').trim()
    : '';
  const verdict = result.error ? 'ERROR' : result.status === 0 && fail === 0 ? 'PASS' : 'FAIL';
  return {
    name: step.name,
    cmd: step.electron ? `electron.exe ${step.electron}` : step.node ? `node ${step.node}` : `${command} run build`,
    verdict, pass, fail, inconclusive,
    code: result.status, note,
    seconds: Math.round((Date.now() - started) / 1000),
    failures: lines.filter((l) => /^FAIL\s/.test(l)).slice(0, 8),
    error: result.error ? String(result.error.message || result.error) : '',
  };
}

const results = [];
for (const step of steps) {
  process.stdout.write(`RUN  ${step.name} ... `);
  const result = runStep(step);
  results.push(result);
  process.stdout.write(`${result.verdict} (${result.pass}/${result.pass + result.fail})\n`);
  if (result.verdict !== 'PASS') {
    for (const line of result.failures) console.log('  ' + line);
    if (result.error) console.log('  ' + result.error);
  }
}

const totalPass = results.reduce((n, r) => n + r.pass, 0);
const totalFail = results.reduce((n, r) => n + r.fail, 0);
const lines = [
  `R7_RUN_ALL ${results.filter((r) => r.verdict === 'PASS').length}/${results.length} steps PASS`,
  `ASSERTIONS ${totalPass}/${totalPass + totalFail} PASS, ${totalFail} FAIL`,
  '',
  ...results.map((r) => `${r.verdict.padEnd(5)}  ${r.name.padEnd(18)} ${String(r.pass).padStart(3)}/${String(r.pass + r.fail).padEnd(3)}  ${r.seconds}s  ${r.cmd}${r.note ? '  ' + r.note : ''}`),
  '',
  'INCONCLUSIVE counted separately. Camera E2E and OS-desktop refraction are NOT proven by this runner.',
];
fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
fs.writeFileSync(summaryPath, lines.join('\n') + '\n', 'utf8');
console.log('\n' + lines.join('\n'));
console.log('\nSUMMARY ' + summaryPath);
process.exit(results.every((r) => r.verdict === 'PASS') ? 0 : 1);
