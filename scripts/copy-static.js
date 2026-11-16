/* tsc only emits JavaScript; the renderer's html and css are copied here. */
const { cpSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const from = join(root, 'src', 'renderer');
const to = join(root, 'dist', 'renderer');

mkdirSync(to, { recursive: true });
for (const file of ['index.html', 'styles.css', 'capture-overlay.html']) {
  cpSync(join(from, file), join(to, file));
}
console.log('[build] renderer static files copied');

const settingsFrom = join(root, 'src', 'settings');
const settingsTo = join(root, 'dist', 'settings');
mkdirSync(settingsTo, { recursive: true });
for (const file of ['settings.html', 'settings.css']) {
  cpSync(join(settingsFrom, file), join(settingsTo, file));
}
console.log('[build] settings static files copied');

// robot asset for both windows
mkdirSync(join(to, 'assets'), { recursive: true });
cpSync(join(root, 'src', 'renderer', 'assets', 'robot.svg'), join(to, 'assets', 'robot.svg'));
const settingsAssets = join(root, 'dist', 'settings', 'assets');
mkdirSync(settingsAssets, { recursive: true });
cpSync(join(root, 'src', 'settings', 'assets', 'robot.svg'), join(settingsAssets, 'robot.svg'));
console.log('[build] robot asset copied');

// The browser mini trigger reads the live tab count through UI Automation.
// Ship the helper next to dist/main so the packaged app can find it.
cpSync(join(root, 'scripts', 'browser-tab-count.ps1'),
  join(root, 'dist', 'main', 'browser-tab-count.ps1'));
console.log('[build] browser tab helper copied');
