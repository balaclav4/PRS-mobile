/**
 * Validates the angled-shot correction.
 *
 * The one thing worth being careful about is that the answer is checked against
 * something other than the formula it came from. A cosine rule tested by
 * asserting cosine is a tautology, so the checks below anchor on physical facts:
 * uphill and downhill agree, the correction is always a reduction, and the size
 * at a few known angles matches the figures anyone can look up.
 *
 * Run: node scripts/test-incline.mjs
 */
import { inclinedDrop, inclineEffect, horizontalRange } from '../lib/incline.js';
import { solve, dopeCard } from '../lib/ballistics.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(56) + detail);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('the correction itself');
{
  check('  a level shot is unchanged', inclinedDrop(-100, 0) === -100);

  // Uphill and downhill are the same to first order. This is the fact people
  // get wrong - "hold low downhill" is half a rule.
  check('  uphill and downhill agree',
    inclinedDrop(-100, 30) === inclinedDrop(-100, -30),
    'the bullet drops less either way, which is the surprising part');

  // Always less drop, never more, at any angle.
  check('  every angle reduces the drop', (() => {
    for (let a = -80; a <= 80; a += 5) {
      if (Math.abs(inclinedDrop(-100, a)) > 100.0001) return false;
    }
    return true;
  })());

  // Sizes anyone can check: cos 30 = 0.866, cos 45 = 0.707, cos 60 = 0.5.
  check('  30 degrees removes about 13%', near(inclinedDrop(-100, 30), -86.6, 0.1),
    `${inclinedDrop(-100, 30).toFixed(1)}" of 100"`);
  check('  45 degrees removes about 29%', near(inclinedDrop(-100, 45), -70.7, 0.1));
  check('  60 degrees halves it', near(inclinedDrop(-100, 60), -50, 0.1));

  check('  nonsense in, level out', inclinedDrop(NaN, 30) === 0 && inclinedDrop(-100, NaN) === -100);
  check('  absurd angles are clamped rather than inverted',
    inclinedDrop(-100, 130) < 0, 'no sign flip from an unreachable angle');
}

console.log('\nwhat it reports');
{
  check('  a shallow angle reports nothing',
    inclineEffect({ dropIn: -100, angleDeg: 3, rangeYd: 500 }) === null,
    'cos(3) is 0.9986 - dialling for that is noise dressed as precision');

  const e = inclineEffect({ dropIn: -300, angleDeg: 30, rangeYd: 1000 });
  check('  a real angle does', !!e);
  check('  and names the direction', e.direction === 'uphill');
  check('  downhill too', inclineEffect({ dropIn: -300, angleDeg: -30, rangeYd: 1000 }).direction === 'downhill');
  check('  the drop is reduced', e.dropIn > -300 && e.dropIn < 0, `${e.dropIn}" from -300"`);
  check('  and the reduction is stated as a percentage', near(e.reductionPct, 13.4, 0.2),
    `${e.reductionPct}%`);

  // The angular correction has to be right or the shooter dials the wrong
  // amount: 40.2 inches at 1000 yards is 3.84 MOA.
  check('  the correction converts to MOA correctly',
    near(e.deltaAngular, 40.2 / 1.047 / 10, 0.05),
    `${e.deltaAngular} MOA at 1000 yd`);
  const mil = inclineEffect({ dropIn: -300, angleDeg: 30, rangeYd: 1000, unit: 'mil' });
  check('  and to MIL', near(mil.deltaAngular, e.deltaAngular * 1.047 / 3.438, 0.02),
    `${mil.deltaAngular} MIL`);
}

console.log('\nagainst a real trajectory');
{
  // A 6.5 Creedmoor at 800 yards, shot up a 25 degree bank.
  const opts = {
    mvFps: 2800, bc: 0.315, dragModel: 'G7', sightHeightIn: 1.5, zeroYd: 100,
    tempF: 59, pressureInHg: 29.92, humidityPct: 50,
    maxRangeYd: 800, stepYd: 800,
  };
  const flat = solve(opts).rows[0];
  const e = inclineEffect({ dropIn: flat.dropIn, angleDeg: 25, rangeYd: 800 });

  check('  the flat-fire drop is what the solver says', flat.dropIn < -150,
    `${flat.dropIn.toFixed(1)}" at 800`);
  check('  25 degrees is worth more than a minute',
    Math.abs(e.deltaAngular) > 1,
    `${e.deltaAngular} MOA — enough to miss a plate with`);

  // The rifleman's rule looks the dope up at the horizontal range instead. It
  // over-corrects, because it also removes the drag the bullet really did fly
  // through. Checking the direction of that error, which is the reason the
  // app does not use it.
  const horiz = horizontalRange(800, 25);
  check('  horizontal range is shorter than slant', horiz < 800, `${horiz} yd of 800`);
  const ruleDrop = solve({ ...opts, maxRangeYd: horiz, stepYd: horiz }).rows[0].dropIn;
  check('  and the rifleman\'s rule under-states the drop',
    ruleDrop > e.dropIn,
    `rule ${ruleDrop.toFixed(1)}" against ${e.dropIn}" — it removes drag it should not`);
}

console.log('\nthrough the dope card');
{
  const base = {
    mvFps: 2800, bc: 0.315, dragModel: 'G7', sightHeightIn: 1.5, zeroYd: 100,
    tempF: 59, pressureInHg: 29.92, humidityPct: 50, windMph: 10, windAngleDeg: 90,
    maxRangeYd: 800, stepYd: 800, unit: 'moa',
  };
  const level = dopeCard(base).rows[0];
  const up = dopeCard({ ...base, inclineDeg: 25 }).rows[0];
  const down = dopeCard({ ...base, inclineDeg: -25 }).rows[0];

  check('  the card reports the angle it used', dopeCard({ ...base, inclineDeg: 25 }).inclineDeg === 25);
  check('  an angled shot needs less elevation', up.elevation < level.elevation,
    `${level.elevation} -> ${up.elevation} MOA at 800`);
  check('  uphill and downhill match', up.elevation === down.elevation);
  check('  and wind is untouched by the angle', up.wind === level.wind,
    'the cosine is gravity, not drag');

  // The angle must scale gravity only. With effects folded in, the vertical
  // components are added after the cosine, so the difference between angled
  // and level is exactly the cosine applied to the gravity drop.
  const fx = { sg: 1.8, lengthCalibers: 4.6, rightHandTwist: true, latitudeDeg: 45 };
  const lvlFx = dopeCard({ ...base, effects: fx }).rows[0];
  const upFx = dopeCard({ ...base, effects: fx, inclineDeg: 25 }).rows[0];
  const gravityLevel = lvlFx.dropIn - lvlFx.aeroJumpIn - lvlFx.coriolisVIn;
  const gravityUp = upFx.dropIn - upFx.aeroJumpIn - upFx.coriolisVIn;
  check('  only gravity is scaled, not the effects',
    near(gravityUp, gravityLevel * Math.cos(25 * Math.PI / 180), 0.05),
    'aero jump and Coriolis are added after the cosine, not through it');
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
