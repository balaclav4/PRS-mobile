/**
 * Validates sight-tape geometry.
 *
 * The tape is printed at 1:1 and wrapped around a turret, so an error in the
 * offsets puts every yardage label in the wrong place on a physical object.
 * Unlike a screen number, a mis-printed tape gets trusted in the field.
 *
 * Run: node scripts/test-sighttape.mjs
 */
import { sightTape, tapeToRows } from '../lib/sighttape.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(52) + detail);
};
const near = (a, b, tol = 1e-6) => a != null && Math.abs(a - b) <= tol;

const rows = (pairs) => pairs.map(([rangeYd, elevation]) => ({ rangeYd, elevation }));

console.log('geometry');
{
  const t = sightTape(rows([[100, 0]]), { turretDiameterIn: 1.5, perRev: 15 });
  check('  circumference is pi x diameter',
    near(t.circumferenceIn, Math.PI * 1.5, 1e-3), `${t.circumferenceIn} in`);

  // A mark at zero sits at the start of the strip; one at half a revolution
  // sits at half the circumference.
  const half = sightTape(rows([[100, 0], [500, 7.5]]), { turretDiameterIn: 1.5, perRev: 15 });
  const marks = half.revolutions[0].marks;
  check('  zero elevation is at offset 0', near(marks[0].offsetIn, 0));
  check('  half a revolution is half the circumference',
    near(marks[1].offsetIn, Math.PI * 1.5 / 2, 1e-3), `${marks[1].offsetIn} in`);

  // Offsets must be a straight proportion of elevation within a turn.
  const quarter = sightTape(rows([[300, 3.75]]), { turretDiameterIn: 2, perRev: 15 });
  check('  a quarter turn is a quarter of the way round',
    near(quarter.revolutions[0].marks[0].offsetIn, Math.PI * 2 / 4, 1e-3));
}

console.log('\nrevolution wrapping');
{
  // 15 MOA per revolution: 14.9 is still the first turn, 15.0 starts the second.
  const t = sightTape(rows([[100, 0], [800, 14.9], [900, 15.0], [1000, 22.5]]),
    { turretDiameterIn: 1.5, perRev: 15 });

  check('  two revolutions are produced', t.revolutions.length === 2,
    `${t.revolutions.length}`);
  check('  first turn holds the sub-15 marks',
    t.revolutions[0].marks.map(m => m.rangeYd).join(',') === '100,800');
  check('  second turn holds the rest',
    t.revolutions[1].marks.map(m => m.rangeYd).join(',') === '900,1000');

  // Exactly one revolution wraps to the start of the next, not the end of the
  // first — the boundary case that would otherwise print a duplicate label.
  const wrap = t.revolutions[1].marks.find(m => m.rangeYd === 900);
  check('  an exact revolution lands at offset 0 of the next',
    near(wrap.offsetIn, 0), `${wrap.offsetIn} in`);
  check('  1.5 revolutions is halfway round the second turn',
    near(t.revolutions[1].marks.find(m => m.rangeYd === 1000).offsetIn,
      Math.PI * 1.5 / 2, 1e-3));

  check('  revolutions needed is reported', t.revolutionsNeeded === 2,
    String(t.revolutionsNeeded));
}

console.log('\nordering and clicks');
{
  // Input order must not matter; a tape is read by position.
  const t = sightTape(rows([[1000, 12], [100, 0], [500, 6]]),
    { turretDiameterIn: 1.5, perRev: 15, clickValue: 0.25 });
  const offs = t.revolutions[0].marks.map(m => m.offsetIn);
  check('  marks are sorted along the strip',
    offs.every((v, i) => i === 0 || v >= offs[i - 1]), offs.join(', '));

  const m = t.revolutions[0].marks.find(x => x.rangeYd === 500);
  check('  clicks are elevation over click value', m.clicks === 24, `${m.clicks} clicks`);

  const mil = sightTape(rows([[600, 3.4]]), { turretDiameterIn: 1.5, perRev: 10, clickValue: 0.1 });
  check('  mil turrets compute clicks too',
    mil.revolutions[0].marks[0].clicks === 34, `${mil.revolutions[0].marks[0].clicks}`);
}

console.log('\nstring inputs and bad data');
{
  // Values arrive from TextInputs, the failure that hung the ballistics solver.
  const t = sightTape(rows([[100, 0], [800, 14.9]]),
    { turretDiameterIn: '1.5', perRev: '15', clickValue: '0.25' });
  check('  string options work', t.error === null && t.revolutions.length === 1);
  check('  and give the same geometry', near(t.circumferenceIn, Math.PI * 1.5, 1e-3));

  check('  zero diameter is refused', sightTape(rows([[100, 0]]), { turretDiameterIn: 0 }).error !== null);
  check('  zero travel per rev is refused', sightTape(rows([[100, 0]]), { perRev: 0 }).error !== null);
  check('  no rows is safe', sightTape([], {}).revolutions.length === 0);
  check('  null rows is safe', sightTape(null, {}).revolutions.length === 0);

  // A negative elevation means the bullet is above the line of sight — there is
  // no turret position for it, so it must not be given one.
  const neg = sightTape(rows([[50, -0.4], [100, 0]]), {});
  check('  negative elevations are dropped',
    neg.revolutions[0].marks.length === 1 && neg.revolutions[0].marks[0].rangeYd === 100);
}

console.log('\nexport');
{
  const t = sightTape(rows([[100, 0], [900, 15.0]]), { turretDiameterIn: 1.5, perRev: 15 });
  const out = tapeToRows(t);
  check('  every mark becomes a row', out.length === 2, `${out.length} rows`);
  check('  revolutions are 1-indexed for humans',
    out[0].revolution === 1 && out[1].revolution === 2,
    out.map(r => r.revolution).join(','));
  check('  an errored tape exports nothing',
    tapeToRows(sightTape(rows([[100, 0]]), { perRev: 0 })).length === 0);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
