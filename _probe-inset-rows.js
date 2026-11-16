/* QA Yan - throwaway: per-row bottom inset of the notch, so a single "inset"
   number cannot be quoted without saying which row AND which ruler it came from.
 *
 * Two rulers, because the two of us quoted different numbers for the same
 * radius:
 *   raw       - the transparent capture as Electron returns it (BGRA, partial
 *               alpha). Edge pixels keep r,g,b ~0, so a smaller inset wins.
 *   flattened - composited over the same light tone a screenshot has. This is
 *               the only ruler comparable with the user's reference PNG, which
 *               is already composited over a browser window.
 * Insets are measured from the notch's own left edge, so the reference (which
 * starts at x=73 in a 220 px screenshot) and the live capture line up.
 */
const { app, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const root = __dirname;
const SHOTS = path.join(root, '.superpowers', 'shots');
const LIVE = [
  { name: 'notch-after-dynamic-raw.png', ruler: 'raw', rows: 14 },
  { name: 'notch-after-dynamic-light.png', ruler: 'flattened', rows: 14 },
  { name: 'notch-after-cat-raw.png', ruler: 'raw', rows: 26 },
  { name: 'notch-after-cat-light.png', ruler: 'flattened', rows: 26 },
];
const REF = 'C:\\Users\\Lycaon\\.workbuddy-ai\\blobs\\10\\10222b5a0f389ae8df1ac4361527560b36050e6df0c7f2e61949bb46e5923e27.png';

function decode(file) {
  const img = nativeImage.createFromPath(file);
  const { width, height } = img.getSize();
  const buf = img.toBitmap(); // BGRA
  const at = (x, y) => { const i = (y * width + x) * 4; return { b: buf[i], g: buf[i + 1], r: buf[i + 2], a: buf[i + 3] }; };
  return { width, height, at };
}
const nearBlack = (p) => p.r < 40 && p.g < 40 && p.b < 40 && p.a > 128;

/** Inset per row, relative to the first row's left edge (the notch's own edge). */
function rowInsets(px) {
  const rows = [];
  let origin = null;
  for (let y = 0; y < px.height; y++) {
    let l = -1;
    let r = -1;
    for (let x = 0; x < px.width; x++) if (nearBlack(px.at(x, y))) { l = x; break; }
    for (let x = px.width - 1; x >= 0; x--) if (nearBlack(px.at(x, y))) { r = x; break; }
    if (l < 0) continue;
    if (origin === null) origin = l;
    rows.push({ y, left: l, right: r, insetL: l - origin, insetR: r - origin });
  }
  return { rows, origin };
}

app.whenReady().then(() => {
  const ref = rowInsets(decode(REF));
  console.log(`== REFERENCE 220x50, notch starts x=${ref.origin} ==`);
  console.log('   last 6 rows: ' + ref.rows.slice(-6).map((r) => `y${r.y}:${r.insetL}`).join('  '));

  for (const f of LIVE) {
    const px = decode(path.join(SHOTS, f.name));
    const { rows } = rowInsets(px);
    const strip = rows.filter((r) => r.y < f.rows);
    console.log(`\n== ${f.name}  (${f.ruler}) ${px.width}x${px.height} ==`);
    console.log('   last 6 rows: ' + strip.slice(-6).map((r) => `y${r.y}:${r.insetL}/${r.insetR}`).join('  '));
    const a = strip.slice(-5);
    const b = ref.rows.slice(-5);
    let err = 0;
    const pairs = [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const d = Math.abs(a[i].insetL - b[i].insetL);
      err += d;
      pairs.push(`${a[i].insetL} vs ${b[i].insetL} (${d})`);
    }
    console.log(`   vs reference last 5 rows: ${pairs.join(', ')}  | total error ${err} px`);
  }
  app.exit(0);
});
