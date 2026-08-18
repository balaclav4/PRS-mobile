/**
 * Runs the detector against real target photographs in test-images/.
 *
 * Unlike the synthetic harness this has no per-hole ground truth, so it scores
 * against whatever is known about each photo (printed app overlays, manual
 * counts) and writes an annotated PNG next to the input so results can be
 * inspected by eye.
 *
 * Run: node scripts/test-real.mjs
 */
import fs from 'fs';
import { PNG } from 'pngjs';
import { toGrayscale, detectShots } from '../lib/detect.js';

function loadPng(path) {
  const png = PNG.sync.read(fs.readFileSync(path));
  return { gray: toGrayscale(png.data, png.width, png.height), png };
}

/**
 * Estimate the grid pitch (px between printed grid lines) from the median
 * spacing of bright-column peaks in a band clear of the banner and diamonds.
 *
 * An autocorrelation approach failed here: without detrending, broad structure
 * dominated and the best lag pinned to the search floor (60px vs a true ~167).
 * Peak spacing is direct and self-checking — the gaps come out as a run of
 * near-identical values when the estimate is trustworthy.
 */
function gridPitchPx(gray, w, h, bandY0 = 0.55, bandY1 = 0.72) {
  const y0 = Math.round(h * bandY0), y1 = Math.round(h * bandY1);
  const col = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = y0; y < y1; y++) s += gray[y * w + x];
    col[x] = s / (y1 - y0);
  }
  const mean = col.reduce((a, b) => a + b, 0) / w;
  const sd = Math.sqrt(col.reduce((a, b) => a + (b - mean) ** 2, 0) / w);

  const peaks = [];
  for (let x = 2; x < w - 2; x++) {
    if (col[x] > mean + sd && col[x] >= col[x - 1] && col[x] >= col[x + 1] &&
        (peaks.length === 0 || x - peaks[peaks.length - 1] > 30)) {
      peaks.push(x);
    }
  }
  const gaps = peaks.slice(1).map((p, i) => p - peaks[i]).sort((a, b) => a - b);
  return gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
}

function drawCircle(png, cx, cy, r, [R, G, B]) {
  const steps = Math.max(24, Math.round(r * 6));
  for (let k = 0; k < steps; k++) {
    const a = (k / steps) * Math.PI * 2;
    for (const rr of [r, r + 1]) {
      const x = Math.round(cx + Math.cos(a) * rr);
      const y = Math.round(cy + Math.sin(a) * rr);
      if (x < 0 || x >= png.width || y < 0 || y >= png.height) continue;
      const i = (y * png.width + x) * 4;
      png.data[i] = R; png.data[i + 1] = G; png.data[i + 2] = B; png.data[i + 3] = 255;
    }
  }
}

function es(pts) {
  let m = 0;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      m = Math.max(m, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  return m;
}

// ---------------------------------------------------------------------------
// Ballistic-X grid target: 10 rimfire shots at 200yd, 1" grid squares.
// The app overlay printed on the photo is the ground truth:
//   Group 2.511" (center-to-center), W 2.308", H 1.985"
// Known interference baked into the photo: a translucent banner, green
// crosshair overlays on each hole, and a blue POA dot.
// ---------------------------------------------------------------------------
{
  const path = 'test-images/03-ballistic-x-grid.png';
  if (!fs.existsSync(path)) {
    console.log('skip: ' + path + ' missing');
    process.exit(0);
  }
  const { gray, png } = loadPng(path);
  const { width: w, height: h } = png;

  const pitch = gridPitchPx(gray, w, h);          // px per inch, if squares are 1"
  const holeDiaIn = 0.224;                        // rimfire PRS -> .22 cal
  const radiusPx = (holeDiaIn * pitch) / 2;

  console.log(`image ${w}x${h}, grid pitch ${pitch}px/in, expected hole r=${radiusPx.toFixed(1)}px`);

  // Grid-derived scale is exact and a hole cannot be smaller than the bullet,
  // so the sub-caliber sweep scale is unphysical here. Dropping it removed the
  // junction false positives, which all fired at 0.75x.
  const t0 = Date.now();
  const { shots } = detectShots(gray, w, h, { radiusPx, scales: [1.0, 1.35] });
  const ms = Date.now() - t0;

  // The scored 10-shot group sits in the central card. The region excludes the
  // translucent banner (its bottom edge row at y~0.35h produces blob responses
  // — it is overlay ink from the other app, not target content) and a patch of
  // ragged old damage at x~0.83w that is not part of the scored string.
  const central = shots.filter(s => s.x > w * 0.18 && s.x < w * 0.82 && s.y > h * 0.37 && s.y < h * 0.78);
  const elsewhere = shots.length - central.length;

  for (const s of shots) {
    const inC = central.includes(s);
    drawCircle(png, s.x, s.y, Math.max(6, s.radius * 1.4), inC ? [0, 255, 128] : [255, 60, 60]);
  }
  fs.writeFileSync('test-images/03-annotated.png', PNG.sync.write(png));

  const grp = es(central) / pitch;
  const xs = central.map(p => p.x), ys = central.map(p => p.y);
  const W = (Math.max(...xs) - Math.min(...xs)) / pitch;
  const H = (Math.max(...ys) - Math.min(...ys)) / pitch;

  console.log(`detected ${shots.length} total in ${ms}ms — ${central.length} in group region, ${elsewhere} elsewhere`);
  console.log(`group from detections: ES ${grp.toFixed(3)}"  W ${W.toFixed(3)}"  H ${H.toFixed(3)}"`);
  console.log(`ground truth overlay:  ES 2.511"  W 2.308"  H 1.985"  (10 shots)`);
  console.log(`annotated -> test-images/03-annotated.png`);

  const countOk = central.length >= 9 && central.length <= 11;
  const esOk = Math.abs(grp - 2.511) < 0.35;
  console.log(`\ncount ${countOk ? 'OK' : 'FAIL'} (${central.length}/10)  ES ${esOk ? 'OK' : 'FAIL'} (${grp.toFixed(2)}" vs 2.51")`);
  process.exit(countOk && esOk ? 0 : 1);
}
