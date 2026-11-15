/*
 * ELECTRON_RUN_AS_NODE makes Electron run as plain Node, which breaks `app`.
 * Clearing it here keeps `npm start` working in shells that set it.
 */
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [join(__dirname, '..')], {
  env,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('close', (code) => process.exit(code ?? 0));
