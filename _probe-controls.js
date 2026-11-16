/* Pure probe: Control Centre markup + styles, and the microphone helper
   contract. Reads source files only. Run: node _probe-controls.js */
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src/renderer/renderer.ts'), 'utf8');
const mic = fs.readFileSync(path.join(root, 'src/main/micMute.ts'), 'utf8');

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};

const panelStart = html.indexOf('data-panel="controls"');
const panelEnd = html.indexOf('</section>', panelStart);
const panel = panelStart >= 0 ? html.slice(panelStart, panelEnd) : '';
check('controls panel exists', panel.length > 0);

const count = (re) => (panel.match(re) || []).length;

// Structure: two vertical wells, five tiles, three strip cells.
check('two slider wells', count(/class="cc-well"/g) === 2, String(count(/class="cc-well"/g)));
check('five tiles', count(/class="cc-tile(?: cc-tile-wide)?"/g) === 5,
  String(count(/class="cc-tile(?: cc-tile-wide)?"/g)));
check('three strip cells', count(/class="cc-cell/g) === 3, String(count(/class="cc-cell/g)));
check('brightness slider kept its id', /id="brightnessSlider"/.test(panel));
check('volume slider kept its id', /id="volumeSlider"/.test(panel));
check('live value labels', /id="brightnessValue"/.test(panel) && /id="volumeValue"/.test(panel));
check('CPU + RAM cells', /id="statCpu"/.test(panel) && /id="statRam"/.test(panel));
check('Clear RAM sits in the strip', /class="cc-cell cc-action" id="cleanRam"/.test(panel));
check('Mute tile kept its id', /id="muteBtn"/.test(panel));

// The reference row is replaced, not kept alongside.
check('no Battery segment', !/Battery/i.test(panel));
check('no Balanced segment', !/Balanced/i.test(panel));
check('no Performance segment', !/Performance/i.test(panel));

// The tiles still route to the real Windows pages.
check('Wi-Fi opens its settings page', /ms-settings:network-wifi/.test(panel));
check('Bluetooth opens its settings page', /ms-settings:bluetooth/.test(panel));
check('Night light opens its settings page', /ms-settings:nightlight/.test(panel));
check('Focus opens its settings page', /ms-settings:quiethours/.test(panel));

// Styles: vertical rails are the whole point of the layout. Read the DECLARATION
// BODY of .cc-range: the old check searched the whole stylesheet, so the words
// "writing-mode: vertical-rl" inside the explanatory comment above the rule
// produced a false PASS while the input itself stayed horizontal.
const rangeRule = (css.match(/\.cc-range\s*\{([^}]*)\}/) || [])[1] || '';
check('.cc-range has a declaration body', rangeRule.length > 0);
check('native range is genuinely vertical',
  /writing-mode:\s*vertical-rl/.test(rangeRule), rangeRule.replace(/\s+/g, ' ').trim());
check('higher value points up', /direction:\s*rtl/.test(rangeRule),
  rangeRule.replace(/\s+/g, ' ').trim());
/* "Low end at the bottom" used to be enforced with `direction: rtl` on the
   native vertical range. The thumb is drawn now (a real element on a rail,
   with the native input transparent on top) because Chromium ignores margins
   on a vertical ::-webkit-slider-thumb, which is what put the thumb 5.5 px off
   its rail. The guarantee is now geometric: the thumb is positioned from
   `bottom` with --cc-pct, so 0 lands on the rail's bottom end by construction. */
check('low end at the bottom (thumb driven from bottom by --cc-pct)',
  /\.cc-thumb\s*\{[^}]*bottom:\s*calc\([^;]*var\(--cc-pct\)/.test(css));
check('drawn thumb is driven by the slider value',
  /--cc-pct/.test(renderer) && /setProperty\('--cc-pct'/.test(renderer));
check('cc grid declared', /\.cc\s*\{[^}]*grid-template-columns/.test(css));
check('strip is segmented', /\.cc-cell \+ \.cc-cell\s*\{[^}]*border-left/.test(css));

// Mic helper: all three endpoint roles, and a versioned assembly so a stale
// DLL from an older build can never be loaded.
check('mute helper covers comms role', /\$roles = @\(2, 1, 0\)/.test(mic));
check('SetMuted takes a role', /SetMuted\(bool mute, int role\)/.test(mic));
check('IsMuted takes a role', /IsMuted\(int role\)/.test(mic));
check('helper assembly is versioned', /aeolia-micmute-\$\{HELPER_VERSION\}/.test(mic));
check('script rewritten when content changes',
  /readFileSync\(target, 'utf8'\) === PS_SCRIPT/.test(mic));
check('read function does not print from inside the condition',
  /\[void\]\(Read-First\)/.test(mic));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
