/* Pure probe: no outer drop shadow anywhere the window would clip it.
   A window cannot be taller than the island (39 px pill, 14 px notch), and an
   element's own box-shadow is NOT clipped by its own overflow, so any outer
   shadow lands on the window edge and the OS cuts it into a hard rectangle.
   Run: node _probe-no-shadow.js */
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, 'src/renderer/styles.css'), 'utf8');

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};

/** Body of the first rule whose header starts with `selector`. */
function ruleBody(selector) {
  const at = css.indexOf(selector);
  if (at < 0) return null;
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  if (open < 0 || close < 0) return null;
  return css.slice(open + 1, close);
}

/** True when any comma-separated shadow part is an outer shadow. */
function hasOuterShadow(body) {
  if (!body) return false;
  const decl = /box-shadow\s*:([^;]+);/.exec(body);
  if (!decl) return false;
  return decl[1]
    .split(/,(?![^(]*\))/)
    .map((s) => s.trim())
    .filter(Boolean)
    .some((part) => !part.startsWith('inset')
      && /-?\d+(\.\d+)?(px|em|rem)/.test(part));
}

// 1. The glass pane itself: rim only.
const glass = ruleBody('#island[data-surface="Liquid glass"],');
check('glass pane has no outer shadow', glass !== null && !hasOuterShadow(glass));
check('glass pane keeps its inset rim', /inset/.test(glass || ''));

// 2. The notice banner fills the pill window edge to edge.
const banner = ruleBody('#banner:not([hidden])');
check('banner has no outer shadow', banner !== null && !hasOuterShadow(banner));

// 3. The two meeting capsules are 36 px tall in a 39 px window.
const mic = ruleBody('.meeting-mic {');
const cam = ruleBody('.meeting-cam {');
check('mic capsule has no outer shadow', mic !== null && !hasOuterShadow(mic));
check('cam capsule has no outer shadow', cam !== null && !hasOuterShadow(cam));

// 4. The exact values that produced the reported rectangles are gone.
check('old island shadow removed', !/0 12px 30px rgba\(0, 0, 0, 0\.34\)/.test(css));
check('old banner shadow removed', !/0 8px 22px rgba\(0, 0, 0, 0\.38\)/.test(css));
check('old capsule shadow removed', !/0 4px 12px rgba\(0, 0, 0, 0\.35\)/.test(css));

// 5. The notch shares the island rule, so it is covered by (1); make sure no
//    separate mini-only shadow was reintroduced.
const miniBlocks = css.match(/#island\[data-state="mini"\][^{]*\{[^}]*\}/g) || [];
check('no shadow added to the mini notch',
  miniBlocks.every((b) => !/box-shadow\s*:\s*[^;]*[1-9]\d*px/.test(b.replace(/inset[^,;]*/g, ''))),
  `${miniBlocks.length} mini rules`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
