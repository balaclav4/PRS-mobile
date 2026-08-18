/**
 * Verifies perspective correction against known ground truth.
 * Run: node scripts/test-homography.mjs
 */
import {
  quadCentre, solveHomography, project, rectifyToInches, perspectiveSeverity, orderCorners } from '../lib/homography.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(46) + detail);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// A synthetic camera: rotate the target plane away from the sensor, then
// project. This is what an off-axis photo does to a flat target.
function makeCamera(tiltDeg, panDeg, f = 1400, dist = 40) {
  const t = tiltDeg * Math.PI / 180, p = panDeg * Math.PI / 180;
  return (X, Y) => {
    // target-plane point (inches) -> camera space
    let x = X, y = Y, z = 0;
    // pan about Y, then tilt about X
    let x1 = x * Math.cos(p) + z * Math.sin(p);
    let z1 = -x * Math.sin(p) + z * Math.cos(p);
    let y2 = y * Math.cos(t) - z1 * Math.sin(t);
    let z2 = y * Math.sin(t) + z1 * Math.cos(t);
    const Z = z2 + dist;
    return { x: f * x1 / Z + 500, y: f * y2 / Z + 500 };
  };
}

// --- exact recovery on the defining correspondences -------------------------
{
  const cam = makeCamera(28, 22);
  const W = 12, H = 12;
  const corners = [cam(0, 0), cam(W, 0), cam(W, H), cam(0, H)];
  const Hm = rectifyToInches(corners, W, H);
  const dst = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  let worst = 0;
  corners.forEach((c, i) => {
    const p = project(Hm, c);
    worst = Math.max(worst, Math.hypot(p.x - dst[i].x, p.y - dst[i].y));
  });
  check('corners map to exact rectangle', worst < 1e-9, `max err ${worst.toExponential(1)} in`);
}

// --- the real test: does it recover interior points it never saw? -----------
{
  const cam = makeCamera(28, 22);
  const W = 12, H = 12;
  const Hm = rectifyToInches([cam(0, 0), cam(W, 0), cam(W, H), cam(0, H)], W, H);

  // A 5-shot group around the middle of the target, in true inches.
  const truth = [
    { x: 5.90, y: 5.90 }, { x: 6.35, y: 6.15 }, { x: 6.05, y: 6.50 },
    { x: 6.55, y: 5.80 }, { x: 5.75, y: 6.30 },
  ];
  const seen = truth.map(p => cam(p.x, p.y));
  const recovered = seen.map(p => project(Hm, p));

  let worst = 0;
  recovered.forEach((p, i) => {
    worst = Math.max(worst, Math.hypot(p.x - truth[i].x, p.y - truth[i].y));
  });
  check('interior shots recovered', worst < 1e-6, `max err ${worst.toExponential(1)} in`);

  const es = (pts) => {
    let m = 0;
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++)
        m = Math.max(m, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
    return m;
  };

  // What the app reports *without* correction: calibrate px-per-inch on a known
  // length elsewhere in the frame (the marker sticker), then measure the group
  // directly off the photo. Calibrating on the group itself would hide the
  // error, since the same foreshortening would cancel out.
  const pxPerIn = Math.hypot(cam(0, 0).x - cam(W, 0).x, cam(0, 0).y - cam(W, 0).y) / W;
  const naive = es(seen) / pxPerIn;
  const corrected = es(recovered);
  const trueES = es(truth);

  check('corrected group size matches truth', Math.abs(corrected - trueES) < 1e-6,
    `true ${trueES.toFixed(4)}" vs corrected ${corrected.toFixed(4)}"`);
  console.log(`   uncorrected would read ${naive.toFixed(4)}" ` +
    `(${((naive / trueES - 1) * 100).toFixed(1)}% error)`);
}

// --- severity signal --------------------------------------------------------
{
  const flat = makeCamera(0, 0);
  const sq = [flat(0, 0), flat(12, 0), flat(12, 12), flat(0, 12)];
  check('square-on photo reads ~0 severity', perspectiveSeverity(sq) < 0.01,
    `severity ${perspectiveSeverity(sq).toFixed(4)}`);

  const tilted = makeCamera(35, 0);
  const tq = [tilted(0, 0), tilted(12, 0), tilted(12, 12), tilted(0, 12)];
  check('tilted photo flagged', perspectiveSeverity(tq) > 0.1,
    `severity ${perspectiveSeverity(tq).toFixed(3)}`);
}

// --- degenerate input -------------------------------------------------------
{
  const collinear = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
  check('collinear corners rejected', rectifyToInches(collinear, 12, 12) === null);
  check('bad arity rejected', solveHomography([{ x: 0, y: 0 }], [{ x: 0, y: 0 }]) === null);
}

// --- corner auto-ordering ---------------------------------------------------
{
  const TL = { x: 10, y: 12 }, TR = { x: 90, y: 14 }, BR = { x: 88, y: 95 }, BL = { x: 8, y: 93 };
  const want = [TL, TR, BR, BL];
  // Every tap order must come back as TL, TR, BR, BL.
  const perms = [
    [TL, TR, BR, BL], [BL, TL, BR, TR], [BR, BL, TR, TL], [TR, BR, TL, BL],
  ];
  const ok = perms.every(p => {
    const o = orderCorners(p);
    return o.every((c, i) => c.x === want[i].x && c.y === want[i].y);
  });
  check('corner ordering is tap-order invariant', ok);

  // A skewed quad (rotated ~20deg) still orders consistently.
  const rot = (p, a) => ({
    x: 50 + (p.x - 50) * Math.cos(a) - (p.y - 50) * Math.sin(a),
    y: 50 + (p.x - 50) * Math.sin(a) + (p.y - 50) * Math.cos(a),
  });
  const rq = [BR, TL, TR, BL].map(p => rot(p, 0.35));
  const ro = orderCorners(rq);
  const H2 = rectifyToInches(ro, 10, 10);
  check('rotated quad still yields valid homography', H2 !== null);
}

// --- error across tilt range ------------------------------------------------
console.log('\ngroup-size error if perspective is ignored');
console.log('tilt   pan    uncorrected error');
console.log('─'.repeat(38));
for (const [tilt, pan] of [[0, 0], [10, 5], [20, 10], [30, 20], [45, 30]]) {
  const cam = makeCamera(tilt, pan);
  const Hm = rectifyToInches([cam(0, 0), cam(12, 0), cam(12, 12), cam(0, 12)], 12, 12);
  const truth = [{ x: 5.5, y: 5.5 }, { x: 6.5, y: 6.5 }, { x: 5.6, y: 6.6 }];
  const seen = truth.map(p => cam(p.x, p.y));
  const rec = seen.map(p => project(Hm, p));
  const es = (p) => Math.max(
    Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y),
    Math.hypot(p[0].x - p[2].x, p[0].y - p[2].y),
    Math.hypot(p[1].x - p[2].x, p[1].y - p[2].y));
  const pxPerIn = Math.hypot(cam(0, 0).x - cam(12, 0).x, cam(0, 0).y - cam(12, 0).y) / 12;
  const naiveErr = (es(seen) / pxPerIn / es(truth) - 1) * 100;
  const corrErr = (es(rec) / es(truth) - 1) * 100;
  console.log(
    `${String(tilt).padStart(3)}°  ${String(pan).padStart(3)}°   ` +
    `${naiveErr.toFixed(2).padStart(7)}%   (corrected ${corrErr.toFixed(4)}%)`
  );
}

console.log('\nquad centre (the default point of aim)');
{
  const sq = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const c = quadCentre(sq);
  check('  square-on is the obvious centre', near(c.x, 0.5, 1e-9) && near(c.y, 0.5, 1e-9));

  // Under perspective the corner average is NOT the centre. Averaging drifts
  // toward the near edge; the diagonals do not.
  const tr = [{ x: 0.20, y: 0.10 }, { x: 0.90, y: 0.20 }, { x: 0.80, y: 0.85 }, { x: 0.10, y: 0.70 }];
  const H = rectifyToInches(orderCorners(tr), 10, 10);
  const viaDiagonals = project(H, quadCentre(orderCorners(tr)));
  const avg = { x: tr.reduce((a, p) => a + p.x, 0) / 4, y: tr.reduce((a, p) => a + p.y, 0) / 4 };
  const viaAverage = project(H, avg);
  check('  off-axis, diagonals land on the true centre',
    near(viaDiagonals.x, 5, 1e-6) && near(viaDiagonals.y, 5, 1e-6),
    `(${viaDiagonals.x.toFixed(4)}, ${viaDiagonals.y.toFixed(4)})`);
  check('  while the corner average does not',
    Math.hypot(viaAverage.x - 5, viaAverage.y - 5) > 0.1,
    `off by ${Math.hypot(viaAverage.x - 5, viaAverage.y - 5).toFixed(3)}" on a 10" sheet`);
  check('  degenerate input is refused',
    quadCentre(null) === null && quadCentre([{ x: 0, y: 0 }]) === null);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
