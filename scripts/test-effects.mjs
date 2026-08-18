/**
 * Validates the secondary trajectory effects.
 *
 * Two of these are exact physics and two are empirical fits, and the tests are
 * built differently for each. Coriolis is checked against its own derivation
 * and against the behaviours that make it counter-intuitive - horizontal
 * deflection that does not cancel when you turn around, vertical that does.
 * The fits are checked for magnitude, sign and, above all, for admitting when
 * they are outside the data they were fitted to.
 *
 * Run: node scripts/test-effects.mjs
 */
import {
  gyroscopicStability, stabilityVerdict, spinDrift,
  aerodynamicJump, coriolis, secondaryEffects,
  parseTwist, parseGrains, densityRatioFromDa,
} from '../lib/effects.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(56) + detail);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// A 6.5mm 140gr match bullet, the case this app is most often pointed at.
const SIX5 = { bulletGrains: 140, diameterIn: 0.264, lengthIn: 1.35, twistIn: 8, mvFps: 2800 };

console.log('reading what the shooter already typed');
{
  check('  every way people write twist reads the same',
    ['1:8', '1-8', '1 in 8', '1:8"', '8'].every(t => parseTwist(t) === 8),
    'asking again for something already in the rifle record is a bad trade');
  check('  fractional twists survive', parseTwist('1:7.5') === 7.5);
  check('  a cartridge in the wrong field is not a twist',
    parseTwist('308') === null && parseTwist('6.5 Creedmoor') === null,
    'a wrong Sg is worse than an empty field');
  check('  nothing is nothing', parseTwist('') === null && parseTwist(null) === null);

  check('  grains read out of a bullet description',
    parseGrains('140gr Hybrid') === 140 && parseGrains('105 Berger') === 105 &&
    parseGrains('77 grain SMK') === 77);
  check('  and are refused when absent', parseGrains('Hybrid Target') === null);
  check('  a caliber is not a weight', parseGrains('6.5mm') === null, parseGrains('6.5mm'));
}

console.log('\ngyroscopic stability');
{
  const sg = gyroscopicStability(SIX5);
  check('  a 6.5 140gr in a 1:8 is comfortably stable', sg > 1.4 && sg < 2.6, `Sg ${sg}`);

  const slow = gyroscopicStability({ ...SIX5, twistIn: 12 });
  check('  a slower twist destabilises it', slow < sg, `1:12 gives Sg ${slow} against 1:8 at ${sg}`);
  check('  and 1:14 is genuinely unstable',
    gyroscopicStability({ ...SIX5, twistIn: 14 }) < 1.0,
    `Sg ${gyroscopicStability({ ...SIX5, twistIn: 14 })}`);

  const long = gyroscopicStability({ ...SIX5, lengthIn: 1.6 });
  check('  a longer bullet needs more twist', long < sg, `${long} against ${sg}`);

  // Thin air is easier to stabilise in, which is why a load can be marginal at
  // sea level on a cold morning and fine at altitude.
  const thin = gyroscopicStability({ ...SIX5, densityRatio: 0.8 });
  check('  thinner air raises Sg', thin > sg, `${thin} at 0.8 density against ${sg} at 1.0`);
  const dense = gyroscopicStability({ ...SIX5, densityRatio: 1.15 });
  check('  denser air lowers it', dense < sg, `${dense} at 1.15 density`);

  check('  faster muzzle velocity raises it slightly',
    gyroscopicStability({ ...SIX5, mvFps: 3200 }) > sg);
  check('  missing inputs are refused',
    gyroscopicStability({ bulletGrains: 140 }) === null &&
    gyroscopicStability({}) === null);
}

console.log('\nair density from density altitude');
{
  check('  sea level standard is 1', near(densityRatioFromDa(0), 1, 1e-9));
  check('  5000 ft DA is about 86% of it', near(densityRatioFromDa(5000), 0.862, 0.01),
    densityRatioFromDa(5000).toFixed(3));
  check('  10000 ft DA is about 74%', near(densityRatioFromDa(10000), 0.738, 0.01),
    densityRatioFromDa(10000).toFixed(3));
  check('  below sea level is denser', densityRatioFromDa(-1000) > 1);
  check('  nonsense falls back to standard', densityRatioFromDa(NaN) === 1 && densityRatioFromDa(null) === 1);
}

console.log('\nstability verdicts');
{
  check('  below 1.0 is called unstable', stabilityVerdict(0.9).level === 'unstable');
  check('  1.2 is marginal, and says the BC suffers',
    stabilityVerdict(1.2).level === 'marginal' && /BC/.test(stabilityVerdict(1.2).text));
  check('  1.8 is good', stabilityVerdict(1.8).level === 'good');
  check('  3.0 is over-stable and mentions spin drift',
    stabilityVerdict(3.0).level === 'over' && /spin drift/.test(stabilityVerdict(3.0).text));
  check('  null asks for the inputs', stabilityVerdict(null).level === 'unknown');
}

console.log('\nspin drift');
{
  // 1000 yards for a 6.5 is roughly 1.5 s of flight.
  const d = spinDrift({ sg: 1.8, timeOfFlightSec: 1.5 });
  check('  about 8 inches at 1000 yards', near(d, 7.8, 1.5), `${d.toFixed(1)}"`);
  check('  right for right-hand twist', d > 0);
  check('  left for left-hand twist',
    spinDrift({ sg: 1.8, timeOfFlightSec: 1.5, rightHandTwist: false }) < 0);

  // Grows faster than linearly with time, which is why it is invisible up close.
  const near300 = spinDrift({ sg: 1.8, timeOfFlightSec: 0.35 });
  check('  negligible at short range', Math.abs(near300) < 0.8, `${near300.toFixed(2)}" at 0.35 s`);
  check('  superlinear in time of flight',
    spinDrift({ sg: 1.8, timeOfFlightSec: 3 }) > 2 * spinDrift({ sg: 1.8, timeOfFlightSec: 1.5 }),
    'doubling the flight time more than doubles the drift');
  check('  a more stable bullet drifts more',
    spinDrift({ sg: 2.4, timeOfFlightSec: 1.5 }) > d);
  check('  nothing without inputs', spinDrift({}) === 0);
}

console.log('\naerodynamic jump');
{
  const j = aerodynamicJump({ sg: 1.8, lengthCalibers: 5.1, crosswindMph: 10 });
  check('  a 10 mph crosswind moves impact vertically', Math.abs(j.moa) > 0.1,
    `${j.moa} MOA from ${j.moaPerMph} per mph`);
  check('  right-twist with wind from the left drops the impact', j.moa < 0,
    'positive crosswind is left-to-right');
  check('  wind from the right lifts it',
    aerodynamicJump({ sg: 1.8, lengthCalibers: 5.1, crosswindMph: -10 }).moa > 0);
  check('  left-hand twist reverses it',
    aerodynamicJump({ sg: 1.8, lengthCalibers: 5.1, crosswindMph: 10, rightHandTwist: false }).moa > 0);
  check('  scales with wind speed',
    near(aerodynamicJump({ sg: 1.8, lengthCalibers: 5.1, crosswindMph: 20 }).moa, j.moa * 2, 0.01));

  // The honesty requirement: the fit is anchored near Sg 1.75.
  check('  is trusted near the fitted range', j.reliable === true && j.note === null);
  const wild = aerodynamicJump({ sg: 3.4, lengthCalibers: 5.1, crosswindMph: 10 });
  check('  and admits when it is outside it', wild.reliable === false,
    'Litz\'s fit degrades fast away from Sg 1.75');
  check('  saying so in words', /indication, not a correction/.test(wild.note));
  check('  bad input is refused', aerodynamicJump({ sg: 0 }) === null);
}

console.log('\ncoriolis: the counter-intuitive parts');
{
  const R = 3000, T = 1.5;   // 1000 yards, 1.5 s

  const north45 = coriolis({ latitudeDeg: 45, azimuthDeg: 0, rangeFt: R, timeOfFlightSec: T });
  check('  a few inches at 1000 yards', near(Math.abs(north45.horizontalIn), 2.8, 0.5),
    `${north45.horizontalIn}" horizontal`);
  check('  right in the northern hemisphere', north45.horizontalWord === 'right');
  check('  left in the southern',
    coriolis({ latitudeDeg: -45, azimuthDeg: 0, rangeFt: R, timeOfFlightSec: T }).horizontalWord === 'left');

  // The part people expect to cancel and does not.
  const east = coriolis({ latitudeDeg: 45, azimuthDeg: 90, rangeFt: R, timeOfFlightSec: T });
  const west = coriolis({ latitudeDeg: 45, azimuthDeg: 270, rangeFt: R, timeOfFlightSec: T });
  check('  horizontal does not change when you turn around',
    near(east.horizontalIn, west.horizontalIn, 1e-9),
    'it depends on latitude, not on which way you face');
  check('  but vertical does', east.verticalWord === 'high' && west.verticalWord === 'low',
    `east ${east.verticalIn}", west ${west.verticalIn}"`);
  check('  and is equal and opposite', near(east.verticalIn, -west.verticalIn, 1e-9));

  check('  north and south have no vertical component',
    coriolis({ latitudeDeg: 45, azimuthDeg: 0, rangeFt: R, timeOfFlightSec: T }).verticalIn === 0 &&
    near(coriolis({ latitudeDeg: 45, azimuthDeg: 180, rangeFt: R, timeOfFlightSec: T }).verticalIn, 0, 1e-9));

  check('  no horizontal component at the equator',
    near(coriolis({ latitudeDeg: 0, azimuthDeg: 0, rangeFt: R, timeOfFlightSec: T }).horizontalIn, 0, 1e-9));
  check('  vertical is strongest at the equator shooting east',
    coriolis({ latitudeDeg: 0, azimuthDeg: 90, rangeFt: R, timeOfFlightSec: T }).verticalIn >
    east.verticalIn);

  check('  negligible at short range',
    Math.abs(coriolis({ latitudeDeg: 45, azimuthDeg: 90, rangeFt: 300, timeOfFlightSec: 0.35 }).horizontalIn) < 0.1);
  check('  bad input is refused', coriolis({ rangeFt: 0 }) === null);
}

console.log('\ncombined');
{
  const e = secondaryEffects({
    sg: 1.8, lengthCalibers: 5.1, timeOfFlightSec: 1.5, rangeFt: 3000,
    crosswindMph: 10, latitudeDeg: 45, azimuthDeg: 90,
  });
  check('  reports each effect separately', e.spinDriftIn > 0 && e.coriolis && e.aeroJump,
    'lumping them hides that Coriolis flips and spin drift does not');
  check('  horizontal total is drift plus Coriolis',
    near(e.totalHorizontalIn, e.spinDriftIn + e.coriolis.horizontalIn, 0.01),
    `${e.spinDriftIn} + ${e.coriolis.horizontalIn} = ${e.totalHorizontalIn}"`);
  check('  and they are worth about a minute together at 1000',
    Math.abs(e.totalHorizontalIn) > 8, `${e.totalHorizontalIn}" horizontal`);
  check('  vertical total is jump plus Eotvos',
    near(e.totalVerticalIn, e.aeroJumpIn + e.coriolis.verticalIn, 0.01));

  const noLat = secondaryEffects({
    sg: 1.8, lengthCalibers: 5.1, timeOfFlightSec: 1.5, rangeFt: 3000, crosswindMph: 10,
  });
  check('  Coriolis is omitted without a latitude', noLat.coriolis === null,
    'never guessed - it needs to be told where you are');
  check('  and the rest still works', noLat.spinDriftIn > 0);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
