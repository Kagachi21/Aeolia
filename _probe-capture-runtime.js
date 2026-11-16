/* QA Kou - real Windows Core Audio runtime probe.
   Compiles the C#/COM helper once and enumerates ACTIVE capture sessions.
   Run: env -u ELECTRON_RUN_AS_NODE electron.exe _probe-capture-runtime.js */
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const mod = require('./dist/main/captureSessions.js');

app.whenReady().then(async () => {
  const dll = path.join(os.tmpdir(), 'aeolia-capture-sessions.dll');
  const script = path.join(os.tmpdir(), 'aeolia-capture-sessions.ps1');
  try { fs.rmSync(dll, { force: true }); } catch { /* first run */ }
  try { fs.rmSync(script, { force: true }); } catch { /* first run */ }

  const names = await mod.getActiveCaptureProcesses();
  console.log('CAPTURE_RUNTIME names=' + JSON.stringify(names));
  console.log('CAPTURE_RUNTIME script=' + fs.existsSync(script));
  console.log('CAPTURE_RUNTIME dll=' + fs.existsSync(dll));

  // Show the compiler's own verdict if the DLL did not appear.
  if (!fs.existsSync(dll)) {
    try {
      const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-Command', "$src = Get-Content -Raw '" + script + "'; Add-Type -TypeDefinition $src -OutputAssembly '" + dll + "' 2>&1 | Out-String"],
        { encoding: 'utf8', timeout: 30000 });
      console.log('CAPTURE_RUNTIME compile=' + String(out).slice(0, 400));
    } catch (e) {
      console.log('CAPTURE_RUNTIME compile_error=' + String(e.stdout || e.message).slice(0, 400));
    }
  }
  app.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });
