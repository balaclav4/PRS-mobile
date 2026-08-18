/**
 * Validates point of impact, group geometry and the dial correction.
 *
 * Sign conventions get the hardest testing here. Every other error in this app
 * costs a wasted range trip; a reversed windage correction actively moves the
 * next group further from where the shooter wants it, and it looks like the app
 * working. So each direction is asserted independently, in both the offset and
 * the turret instruction, and the two are asserted to be opposites.
 *
 * Run: node scripts/test-poi.mjs
 */
import { targetMetrics, sessionPoi } from '../lib/poi.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(52) + detail);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// A square-on 10" x 10" reference sheet occupying the unit square. With no
// perspective, one normalised unit is exactly 10 inches, which makes every
// expected value checkable by hand.
const SQUARE = {
  corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
  widthIn: 10,
  heightIn: 10,
};
// Aim dead centre of the sheet.
const AIM = { x: 0.5, y: 0.5 };
const target = (shots, aim = AIM) => ({ shots, scale: SQUARE, aim });

console.log('geometry on a known sheet');
{
  // Four shots 1 inch (0.1 normalised) either side of centre: a 2" square, so
  // the extreme spread is the diagonal, 2*sqrt(2) = 2.828".
  const m = targetMetrics(target([
    { x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 }, { x: 0.6, y: 0.6 }, { x: 0.4, y: 0.6 },
  ]), 100, 'Inches');
  check('  extreme spread is the diagonal', near(m.extremeSpread, 2.828, 0.01),
    `${m.extremeSpread}"`);
  check('  mean radius is the half-diagonal', near(m.meanRadius, 1.414, 0.01),
    `${m.meanRadius}"`);
  check('  centroid is the sheet centre',
    near(m.centroidIn.x, 5, 1e-9) && near(m.centroidIn.y, 5, 1e-9),
    `(${m.centroidIn.x.toFixed(2)}, ${m.centroidIn.y.toFixed(2)})`);
  check('  shot count is reported', m.n === 4);
}

console.log('\nunit conversion');
{
  const shots = [{ x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }];  // exactly 2" apart
  const inches = targetMetrics(target(shots), 100, 'Inches');
  const moa = targetMetrics(target(shots), 100, 'MOA');
  const mrad = targetMetrics(target(shots), 100, 'MRAD');
  check('  2" at 100yd is 2.00 inches', near(inches.extremeSpread, 2, 0.01),
    String(inches.extremeSpread));
  check('  and 1.91 MOA', near(moa.extremeSpread, 2 / 1.047, 0.01), String(moa.extremeSpread));
  check('  and 0.56 MRAD', near(mrad.extremeSpread, 2 / 3.6, 0.01), String(mrad.extremeSpread));
  // Same physical group, twice the distance, half the angle.
  const far = targetMetrics(target(shots), 200, 'MOA');
  check('  the same group at 200yd is half the MOA',
    near(far.extremeSpread, moa.extremeSpread / 2, 0.01),
    `${moa.extremeSpread} -> ${far.extremeSpread}`);
  check('  the unit label follows', inches.unit === 'in' && moa.unit === 'MOA');
}

console.log('\npoint of impact: every direction, independently');
{
  // One shot 1" right and 1" above the aim point. y is DOWN, so above is
  // a smaller y.
  const highRight = targetMetrics(target([{ x: 0.6, y: 0.4 }]), 100, 'Inches');
  check('  a group right of aim reads right', highRight.poi.horizontalWord === 'right');
  check('  a group above aim reads high', highRight.poi.verticalWord === 'high');
  check('  magnitudes are correct',
    near(highRight.poi.horizontal, 1, 0.01) && near(highRight.poi.vertical, 1, 0.01),
    `${highRight.poi.horizontal}" / ${highRight.poi.vertical}"`);

  const lowLeft = targetMetrics(target([{ x: 0.4, y: 0.6 }]), 100, 'Inches');
  check('  a group left of aim reads left', lowLeft.poi.horizontalWord === 'left');
  check('  a group below aim reads low', lowLeft.poi.verticalWord === 'low');

  check('  a centred group is centred',
    targetMetrics(target([{ x: 0.5, y: 0.5 }]), 100, 'Inches').poi.summary === 'Centred on aim');
}

console.log('\nthe dial correction is the opposite of the offset');
{
  // This is the assertion that matters most. Dialling the same direction the
  // group already went doubles the error.
  const cases = [
    [{ x: 0.6, y: 0.4 }, 'right', 'high', 'L', 'D'],
    [{ x: 0.4, y: 0.6 }, 'left', 'low', 'R', 'U'],
    [{ x: 0.6, y: 0.6 }, 'right', 'low', 'L', 'U'],
    [{ x: 0.4, y: 0.4 }, 'left', 'high', 'R', 'D'],
  ];
  for (const [shot, hWord, vWord, dialH, dialV] of cases) {
    const p = targetMetrics(target([shot]), 100, 'Inches').poi;
    const ok = p.horizontalWord === hWord && p.verticalWord === vWord &&
      p.dial.includes(dialH) && p.dial.includes(dialV);
    check(`  ${vWord}/${hWord} dials ${dialV}/${dialH}`, ok, `dial = "${p.dial}"`);
  }
  check('  a centred group needs no correction',
    targetMetrics(target([{ x: 0.5, y: 0.5 }]), 100, 'Inches').poi.dial === 'On zero');
}

console.log('\nrefusing to dial on noise');
{
  // Three shots scattered 2" across but centred 0.2" off aim. The correction is
  // smaller than the centre's own uncertainty, so it must not be endorsed.
  const noisy = targetMetrics(target([
    { x: 0.40, y: 0.52 }, { x: 0.60, y: 0.48 }, { x: 0.52, y: 0.62 },
  ]), 100, 'Inches');
  check('  a tiny offset from a scattered group is flagged', !noisy.poi.meaningful,
    `offset ${noisy.poi.radial}" vs centre95 ±${noisy.centre95}"`);
  check('  and the note says to shoot more', /Shoot more before correcting/.test(noisy.poi.note));

  // The same scatter but a large, real offset.
  const real = targetMetrics(target([
    { x: 0.70, y: 0.22 }, { x: 0.90, y: 0.18 }, { x: 0.82, y: 0.32 },
  ]), 100, 'Inches');
  check('  a large offset is endorsed', real.poi.meaningful,
    `offset ${real.poi.radial}" vs centre95 ±${real.centre95}"`);
  check('  and carries no warning', real.poi.note === null);

  // More shots pin the centre down better, which is the whole point.
  const five = targetMetrics(target([
    { x: 0.40, y: 0.52 }, { x: 0.60, y: 0.48 }, { x: 0.52, y: 0.62 },
    { x: 0.48, y: 0.42 }, { x: 0.55, y: 0.55 },
  ]), 100, 'Inches');
  check('  the centre tightens with more shots', five.centre95 < noisy.centre95,
    `±${noisy.centre95}" at 3 shots -> ±${five.centre95}" at 5`);
}

console.log('\nperspective is corrected, not ignored');
{
  // The same physical group shot off-axis: the sheet is a trapezoid on screen.
  // A naive scalar scale would get this wrong; the homography should not.
  const skewed = {
    corners: [{ x: 0.10, y: 0.10 }, { x: 0.90, y: 0.18 }, { x: 0.84, y: 0.86 }, { x: 0.16, y: 0.78 }],
    widthIn: 10, heightIn: 10,
  };
  // Two points that are exactly half the sheet width apart along the top edge.
  const flat = targetMetrics({
    shots: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }], scale: SQUARE, aim: AIM,
  }, 100, 'Inches');
  const tilted = targetMetrics({
    // Corresponding points on the skewed quad: TL and the top-edge midpoint.
    shots: [{ x: 0.10, y: 0.10 }, { x: 0.50, y: 0.14 }], scale: skewed, aim: AIM,
  }, 100, 'Inches');
  check('  a 5" span reads 5" square-on', near(flat.extremeSpread, 5, 0.01),
    `${flat.extremeSpread}"`);
  check('  and still reads 5" off-axis', near(tilted.extremeSpread, 5, 0.05),
    `${tilted.extremeSpread}"`);
}

console.log('\nmissing data is reported, not guessed');
{
  // With no aim point the centre of the framed reference is assumed, because
  // that is what people aim at. It is still an assumption and is flagged.
  const noAim = targetMetrics({ shots: [{ x: 0.6, y: 0.5 }], scale: SQUARE }, 100, 'Inches');
  check('  group stats work without an aim point', noAim.ok && noAim.extremeSpread != null);
  check('  POI falls back to the sheet centre', noAim.poi.available === true);
  check('  and lands where that centre implies',
    near(noAim.poi.horizontal, 1, 0.01) && noAim.poi.horizontalWord === 'right',
    `${noAim.poi.horizontal}" right`);
  check('  the assumption is flagged', noAim.aimAssumed === true && noAim.poi.assumed === true);
  check('  an explicit aim is not flagged',
    targetMetrics(target([{ x: 0.6, y: 0.5 }]), 100, 'Inches').aimAssumed === false);
  check('  the assumed centre is the diagonal intersection, not the corner average',
    near(noAim.aimIn.x, 5, 1e-6) && near(noAim.aimIn.y, 5, 1e-6),
    `(${noAim.aimIn.x.toFixed(3)}, ${noAim.aimIn.y.toFixed(3)})`);

  check('  no corners is refused',
    targetMetrics({ shots: [{ x: 0.5, y: 0.5 }] }, 100).ok === false);
  check('  no shots is refused',
    targetMetrics({ shots: [], scale: SQUARE }, 100).ok === false);
  check('  a null target is safe', targetMetrics(null, 100).ok === false);
}

console.log('\nsession level: pooling across targets');
{
  // Three targets, each printing about 2" low and 1" right.
  const t = (dx, dy) => target([{ x: 0.5 + dx, y: 0.5 + dy }]);
  const session = {
    distanceYd: 100,
    targets: [t(0.10, 0.20), t(0.10, 0.20), t(0.10, 0.20)],
  };
  const p = sessionPoi(session, 'Inches');
  check('  pools every target', p.ok && p.targetsUsed === 3 && p.shots === 3,
    `${p.targetsUsed} targets, ${p.shots} shots`);
  check('  reports the common offset',
    near(p.horizontal, 1, 0.01) && near(p.vertical, 2, 0.01) &&
    p.horizontalWord === 'right' && p.verticalWord === 'low',
    p.summary);
  check('  and the opposite correction', p.dial.includes('U') && p.dial.includes('L'),
    p.dial);

  // Weighted by shot count, not by target count.
  const weighted = sessionPoi({
    distanceYd: 100,
    targets: [
      target([{ x: 0.6, y: 0.5 }, { x: 0.6, y: 0.5 }, { x: 0.6, y: 0.5 }]),  // 3 shots, 1" right
      target([{ x: 0.4, y: 0.5 }]),                                          // 1 shot, 1" left
    ],
  }, 'Inches');
  check('  weights by shots, not targets', near(weighted.horizontal, 0.5, 0.01),
    `${weighted.horizontal}" right (3 right + 1 left)`);

  // A session whose targets have corners but no aim points now resolves, on the
  // assumed centre, and says so.
  const assumed = sessionPoi({ distanceYd: 100, targets: [{ shots: [{ x: 0.6, y: 0.5 }], scale: SQUARE }] });
  check('  a session without aim points uses the assumed centre', assumed.ok === true);
  check('  and flags the assumption', assumed.assumed === true);
  const none = sessionPoi({ distanceYd: 100, targets: [{ shots: [{ x: 0.5, y: 0.5 }] }] });
  check('  but a session with no reference at all is refused', none.ok === false);
  check('  and says why', /reference corners/i.test(none.reason), none.reason.slice(0, 44));
  check('  an empty session is safe', sessionPoi({ targets: [] }).ok === false);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
