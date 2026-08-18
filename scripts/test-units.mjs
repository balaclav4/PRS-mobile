/**
 * Validates unit conversion and formatting.
 *
 * Group size is the one that can quietly lie: inches is a length, MOA and MRAD
 * are angles, so the same physical group is a different number at every
 * distance. A formatter that assumed 100 yd would understate a 200 yd group by
 * half and nobody would see anything wrong on screen.
 *
 * Run: node scripts/test-units.mjs
 */
import {
  MOA_PER_MRAD, angularUnit, angularFallsBack, moaToAngular, formatAngular,
  inchesToUnit, unitToInches, fToC, cToF, fpsToMps, mpsToFps, ydToM, mToYd,
  formatGroup, formatTemp, formatVelocity, formatDistance, groupUnitLabel,
  DEFAULT_UNITS, GROUP_UNITS,
} from '../lib/units.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(50) + detail);
};
const near = (a, b, tol = 1e-9) => a != null && Math.abs(a - b) <= tol;

console.log('angular conversion');
{
  // Definitions: 1 MOA = 1.047" at 100 yd, 1 mil = 3.6" at 100 yd.
  check('  1.047 in at 100 yd is 1 MOA', near(inchesToUnit(1.047, 100, 'MOA'), 1));
  check('  3.6 in at 100 yd is 1 MRAD', near(inchesToUnit(3.6, 100, 'MRAD'), 1));
  check('  inches passes through unchanged', near(inchesToUnit(1.047, 100, 'Inches'), 1.047));

  // The property that matters: the same group is a smaller angle further out.
  const oneInch = 1.0;
  const at100 = inchesToUnit(oneInch, 100, 'MOA');
  const at200 = inchesToUnit(oneInch, 200, 'MOA');
  check('  the same group is half the angle at twice the range',
    near(at200, at100 / 2, 1e-9), `${at100.toFixed(3)} -> ${at200.toFixed(3)} MOA`);

  check('  round-trips through inches', (() => {
    let worst = 0;
    for (const unit of GROUP_UNITS) {
      for (const d of [100, 200, 385, 1000]) {
        const back = unitToInches(inchesToUnit(1.234, d, unit), d, unit);
        worst = Math.max(worst, Math.abs(back - 1.234));
      }
    }
    return worst < 1e-9;
  })());

  // An angle without a distance is undefined, and must not be guessed at.
  check('  angular units need a distance', inchesToUnit(1, null, 'MOA') === null);
  check('  zero distance is refused', inchesToUnit(1, 0, 'MOA') === null);
  check('  inches works without a distance', near(inchesToUnit(1, null, 'Inches'), 1));
}

console.log('\nscalar conversion');
{
  check('  32F is 0C', near(fToC(32), 0));
  check('  212F is 100C', near(fToC(212), 100));
  check('  -40 is the same in both', near(fToC(-40), -40));
  check('  F/C round-trips', near(cToF(fToC(59)), 59, 1e-9));

  check('  1 fps is 0.3048 m/s', near(fpsToMps(1), 0.3048));
  check('  2800 fps is 853.4 m/s', near(fpsToMps(2800), 853.44, 0.01), fpsToMps(2800).toFixed(2));
  check('  fps round-trips', near(mpsToFps(fpsToMps(2750)), 2750, 1e-9));

  check('  1 yd is 0.9144 m', near(ydToM(1), 0.9144));
  check('  yards round-trip', near(mToYd(ydToM(1000)), 1000, 1e-9));
}

console.log('\nformatting');
{
  // A 1.047" group at 100 yd, shown three ways.
  check('  MOA carries no inch mark',
    formatGroup(1.047, 100, 'MOA') === '1.00 MOA', formatGroup(1.047, 100, 'MOA'));
  check('  MRAD carries no inch mark',
    formatGroup(3.6, 100, 'MRAD') === '1.00 MRAD', formatGroup(3.6, 100, 'MRAD'));
  check('  inches keeps the inch mark',
    formatGroup(1.047, 100, 'Inches') === '1.05"', formatGroup(1.047, 100, 'Inches'));

  // The distance-dependence has to survive formatting.
  check('  a 2 in group at 200 yd is under 1 MOA',
    formatGroup(2, 200, 'MOA') === '0.96 MOA', formatGroup(2, 200, 'MOA'));

  check('  temperature converts', formatTemp(59, '°C') === '15°C', formatTemp(59, '°C'));
  check('  temperature passes through', formatTemp(59, '°F') === '59°F');
  check('  velocity converts', formatVelocity(2800, 'm/s') === '853 m/s', formatVelocity(2800, 'm/s'));
  check('  velocity passes through', formatVelocity(2800, 'fps') === '2800 fps');
  check('  distance converts', formatDistance(1000, 'm') === '914 m', formatDistance(1000, 'm'));

  check('  withUnit false drops the suffix',
    formatGroup(1.047, 100, 'MOA', { withUnit: false }) === '1.00');
}

console.log('\nmissing data');
{
  // Unmeasured values must read as unmeasured, never as zero.
  check('  null group is a dash', formatGroup(null, 100, 'MOA') === '—');
  check('  null temp is a dash', formatTemp(null, '°F') === '—');
  check('  zero velocity is a dash', formatVelocity(0, 'fps') === '—');
  check('  null velocity is a dash', formatVelocity(null, 'fps') === '—');
  check('  NaN is a dash', formatGroup(NaN, 100, 'MOA') === '—');
  check('  a group with no distance is a dash in MOA',
    formatGroup(1.5, null, 'MOA') === '—');
}

console.log('\nlabels and defaults');
{
  check('  inches label is short', groupUnitLabel('Inches') === 'in');
  check('  angular labels pass through', groupUnitLabel('MOA') === 'MOA');
  check('  defaults are imperial',
    DEFAULT_UNITS.group === 'MOA' && DEFAULT_UNITS.temp === '°F' &&
    DEFAULT_UNITS.velocity === 'fps' && DEFAULT_UNITS.distance === 'yd');
}

console.log('\nangular figures (analytics works in MOA throughout)');
{
  // 1 mil subtends 3.6" at 100yd, 1 MOA subtends 1.047", so 3.4384 MOA per mil.
  check('  MOA per MRAD is 3.4384', near(MOA_PER_MRAD, 3.4384, 1e-3), MOA_PER_MRAD.toFixed(4));
  check('  MOA stays MOA', moaToAngular(1.0, 'MOA') === 1.0);
  check('  1 MOA is 0.291 MRAD', near(moaToAngular(1.0, 'MRAD'), 0.2908, 1e-3),
    moaToAngular(1.0, 'MRAD').toFixed(4));
  check('  round trips through MRAD',
    near(moaToAngular(1.0, 'MRAD') * MOA_PER_MRAD, 1.0, 1e-12));

  // Inches needs a distance, which an aggregate across sessions does not have.
  check('  an Inches preference falls back to MOA', angularUnit('Inches') === 'MOA');
  check('  and the fallback is announceable', angularFallsBack('Inches') === true);
  check('  MOA and MRAD do not fall back',
    !angularFallsBack('MOA') && !angularFallsBack('MRAD'));

  check('  formats with its unit', formatAngular(1.234, 'MOA') === '1.23 MOA',
    formatAngular(1.234, 'MOA'));
  check('  formats MRAD', formatAngular(1.0, 'MRAD') === '0.29 MRAD', formatAngular(1.0, 'MRAD'));
  check('  Inches formats as MOA, never as inches',
    formatAngular(1.234, 'Inches') === '1.23 MOA', formatAngular(1.234, 'Inches'));
  check('  null is an em dash', formatAngular(null, 'MOA') === '—');

  // The angular path must agree with the distance-aware one at a known distance.
  const inches = 1.047; // exactly 1 MOA at 100yd
  check('  agrees with the distance-aware formatter at 100yd',
    near(inchesToUnit(inches, 100, 'MOA'), moaToAngular(1.0, 'MOA'), 1e-9));
  check('  and in MRAD at 100yd',
    near(inchesToUnit(inches, 100, 'MRAD'), moaToAngular(1.0, 'MRAD'), 1e-9),
    inchesToUnit(inches, 100, 'MRAD').toFixed(4));
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
