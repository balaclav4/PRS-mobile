/**
 * Validates finding the bull from two taps.
 *
 * The claim being tested is not "an ellipse can be fitted" but that the fit is
 * better than the taps that seeded it. A finger on a phone is worth a few
 * pixels; the printed rim is worth a fraction of one. So every test here seeds
 * the fit with deliberately sloppy taps and checks the answer comes back close
 * to truth anyway, including when the rim is broken by impacts, when the bull is
 * photographed at an angle, and when it is a bright ring on dark rather than
 * dark on light.
 *
 * Run: node scripts/test-rimfit.mjs
 */
import { rimFit, findRim, fitEllipseAbout, rimQuality, rimQuad, cropFor } from '../lib/rimfit.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(56) + detail);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

let seed = 424242;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

/**
 * A target: paper, an elliptical bull, optional impacts breaking the rim.
 * tiltDeg foreshortens the vertical axis, which is what an angled photo does.
 */
function makeBull({
  w = 400, h = 400, cx = 200, cy = 200, r = 90, tiltDeg = 0, phi = 0,
  paper = 232, bull = 46, noise = 3, holes = [], invert = false, torn = 0,
} = {}) {
  const img = new Float32Array(w * h);
  const k = Math.cos(tiltDeg * Math.PI / 180);
  const ca = Math.cos(phi), sa = Math.sin(phi);
  const inside = paper, outside = bull;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      // Rotate into the ellipse frame, then unsquash.
      const u = dx * ca + dy * sa, v = (-dx * sa + dy * ca) / k;
      let rr = Math.hypot(u, v);
      if (torn) rr += torn * r * Math.sin(Math.atan2(v, u) * 7) * 0.5;
      const t = Math.max(0, Math.min(1, (r - rr) / 1.2 + 0.5));  // soft edge
      const v0 = invert ? outside : paper;
      const v1 = invert ? inside : bull;
      img[y * w + x] = v0 * (1 - t) + v1 * t;
    }
  }
  for (const hl of holes) {
    for (let y = Math.floor(hl.y - hl.r - 1); y <= hl.y + hl.r + 1; y++) {
      for (let x = Math.floor(hl.x - hl.r - 1); x <= hl.x + hl.r + 1; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (Math.hypot(x - hl.x, y - hl.y) <= hl.r) img[y * w + x] = hl.v ?? 20;
      }
    }
  }
  for (let i = 0; i < img.length; i++) img[i] += (rnd() - 0.5) * 2 * noise;
  return { img, w, h };
}

console.log('two sloppy taps beat four careful ones');
{
  const { img, w, h } = makeBull({ cx: 200, cy: 200, r: 90 });
  // Off-centre by 7px and the edge tap 9px inside the true rim.
  const fit = rimFit(img, w, h, { centre: { x: 207, y: 193 }, edge: { x: 207 + 81, y: 193 } });

  check('  recovers the centre from an off-centre tap',
    fit && near(fit.cx, 200, 1.5) && near(fit.cy, 200, 1.5),
    fit ? `centre ${fit.cx.toFixed(1)},${fit.cy.toFixed(1)} from a tap at 207,193` : 'no fit');
  check('  recovers the radius despite a short edge tap',
    near(fit.a, 90, 1.5), `a ${fit.a.toFixed(2)} from a tapped radius of 81`);
  check('  says it measured rather than guessed', fit.measured === true);
  check('  and reports how much of the rim it found', fit.coverage >= 95, `${fit.coverage}%`);
  check('  reads as round', near(fit.axisRatio, 1, 0.02), `axis ratio ${fit.axisRatio.toFixed(3)}`);
  check('  the verdict is good', rimQuality(fit).level === 'good');
}

console.log('\nan angled photo: the long axis is the true diameter');
{
  console.log('  tilt   axis ratio  implied   semi-major (true 90)');
  for (const t of [0, 15, 25, 35, 45]) {
    const { img, w, h } = makeBull({ r: 90, tiltDeg: t });
    const fit = rimFit(img, w, h, { centre: { x: 202, y: 198 }, edge: { x: 202 + 86, y: 198 } });
    const q = rimQuality(fit);
    console.log(
      `  ${String(t).padStart(3)}    ${fit.axisRatio.toFixed(3).padStart(8)}` +
      `${String(q.tiltDeg ?? '-').padStart(9)}   ${fit.a.toFixed(2).padStart(6)}   ${q.level}`
    );
  }

  const t30 = makeBull({ r: 90, tiltDeg: 30 });
  const f30 = rimFit(t30.img, t30.w, t30.h, { centre: { x: 200, y: 200 }, edge: { x: 288, y: 200 } });
  check('  the major axis is unforeshortened, so the size stays right',
    near(f30.a, 90, 1.5), `a ${f30.a.toFixed(2)} at 30 degrees, true 90`);
  check('  the minor axis carries the foreshortening',
    near(f30.b, 90 * Math.cos(30 * Math.PI / 180), 1.5), `b ${f30.b.toFixed(2)}, expected ${(90*Math.cos(Math.PI/6)).toFixed(2)}`);
  check('  and the reported tilt matches the real one',
    near(rimQuality(f30).tiltDeg, 30, 2), `${rimQuality(f30).tiltDeg} degrees`);

  // This is the whole gain over the four-tap path, which could only warn.
  check('  a moderate tilt is allowed, not refused', rimQuality(f30).ok === true);
  const t50 = makeBull({ r: 90, tiltDeg: 50 });
  const f50 = rimFit(t50.img, t50.w, t50.h, { centre: { x: 200, y: 200 }, edge: { x: 288, y: 200 } });
  check('  a severe tilt still refuses and names four corners',
    rimQuality(f50).ok === false && /four-corner/.test(rimQuality(f50).text),
    `axis ratio ${f50.axisRatio.toFixed(3)}`);
}

console.log('\nrotation of the ellipse is recovered');
{
  const { img, w, h } = makeBull({ r: 90, tiltDeg: 35, phi: 0.6 });
  const fit = rimFit(img, w, h, { centre: { x: 200, y: 200 }, edge: { x: 285, y: 200 } });
  check('  the long axis is found whichever way it points',
    near(fit.a, 90, 2), `a ${fit.a.toFixed(2)}`);
  const dphi = Math.abs(((fit.phi - 0.6 + Math.PI / 2) % Math.PI) - Math.PI / 2);
  check('  and its angle is right', dphi < 0.08, `off by ${(dphi * 180 / Math.PI).toFixed(1)} degrees`);
}

console.log('\nthings that break a rim');
{
  // Impacts sitting on the edge: the classic reason a rim is not a clean circle.
  const holes = [0.3, 1.1, 2.4, 4.0].map(a => ({
    x: 200 + Math.cos(a) * 90, y: 200 + Math.sin(a) * 90, r: 7, v: 18,
  }));
  const { img, w, h } = makeBull({ r: 90, holes });
  const fit = rimFit(img, w, h, { centre: { x: 200, y: 200 }, edge: { x: 288, y: 200 } });
  check('  impacts on the rim do not drag the fit', near(fit.a, 90, 2),
    `a ${fit.a.toFixed(2)} with 4 holes breaking the edge`);
  check('  and it still reads as round', near(fit.axisRatio, 1, 0.04),
    `axis ratio ${fit.axisRatio.toFixed(3)}`);

  // A splatter target is the other polarity: bright ring on a dark field.
  const inv = makeBull({ r: 90, invert: true });
  const fi = rimFit(inv.img, inv.w, inv.h, { centre: { x: 200, y: 200 }, edge: { x: 286, y: 200 } });
  check('  a bright bull on a dark field works too', near(fi.a, 90, 2),
    `a ${fi.a.toFixed(2)}, polarity ${fi.polarity}`);

  const torn = makeBull({ r: 90, torn: 0.5, noise: 6 });
  const ft = rimFit(torn.img, torn.w, torn.h, { centre: { x: 200, y: 200 }, edge: { x: 288, y: 200 } });
  check('  a rim shot to pieces is refused rather than fitted',
    rimQuality(ft).ok === false, `rms ${ft.rms.toFixed(3)}`);
}

console.log('\nwhen the image has nothing to say');
{
  const flat = new Float32Array(400 * 400).fill(180);
  const fit = rimFit(flat, 400, 400, { centre: { x: 200, y: 200 }, edge: { x: 260, y: 200 } });
  check('  falls back to exactly what was tapped', fit && near(fit.a, 60, 0.01) && near(fit.cx, 200, 0.01));
  check('  and admits it measured nothing', fit.measured === false);
  check('  the verdict says to check it by eye', rimQuality(fit).level === 'unmeasured');
  check('  it is still usable', rimQuality(fit).ok === true,
    'a blank fallback is honest, and refusing it would strand the shooter');

  check('  two taps in the same place are refused',
    rimFit(flat, 400, 400, { centre: { x: 5, y: 5 }, edge: { x: 5, y: 5 } }) === null);
  check('  missing taps are refused', rimFit(flat, 400, 400, {}) === null);
}

console.log('\nfeeding the existing pipeline');
{
  const { img, w, h } = makeBull({ r: 90, tiltDeg: 30 });
  const fit = rimFit(img, w, h, { centre: { x: 200, y: 200 }, edge: { x: 288, y: 200 } });
  const quad = rimQuad(fit);
  check('  gives four corners', quad.length === 4);

  // The quad must be the image of a square: its two diagonals are the ellipse
  // axes, so opposite corners are equidistant from the centre.
  const d = quad.map(p => Math.hypot(p.x - fit.cx, p.y - fit.cy));
  check('  centred on the bull', near((quad[0].x + quad[2].x) / 2, fit.cx, 0.01),
    'the aim point comes free');
  check('  opposite corners balance', near(d[0], d[2], 0.01) && near(d[1], d[3], 0.01));
  check('  and it is squashed the same way the bull is',
    near(Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y) /
         Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y), 1, 0.35),
    'a D by D square, foreshortened');

  const crop = cropFor(fit, w, h);
  check('  the crop box holds the bull with room around it',
    crop.w > 2 * fit.a && crop.x < fit.cx - fit.a && crop.x + crop.w > fit.cx + fit.a,
    `${Math.round(crop.w)}x${Math.round(crop.h)} around a bull ${Math.round(2*fit.a)} across`);
  check('  and is clamped to the image', crop.x >= 0 && crop.y >= 0 &&
    crop.x + crop.w <= w && crop.y + crop.h <= h);
  check('  nothing in, nothing out', cropFor(null, w, h) === null && rimQuad(null) === null);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
