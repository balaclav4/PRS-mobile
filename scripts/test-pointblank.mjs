/**
 * Validates point-blank range and danger space.
 *
 * Neither has a closed form worth checking against, because the closed forms in
 * circulation assume a parabola and this walks a real drag trajectory. So the
 * anchors are properties that must hold whatever the numbers are: the band
 * contains the range it was computed for, a bigger target forgives more, and
 * danger space collapses with distance because the trajectory is falling
 * faster. A result that satisfies all of those and is the wrong size would have
 * to be wrong in a very specific way.
 *
 * The one absolute check is against the solver itself: at the reported band
 * edges the bullet must actually be at the edge of the target, which is
 * independent of how the band was found.
 *
 * Run: node scripts/test-pointblank.mjs
 */
import { maxPointBlank, dangerSpace, describeDangerSpace } from '../lib/pointblank.js';
import { solve } from '../lib/ballistics.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(58) + detail);
};

const OPTS = {
  mvFps: 2800, bc: 0.315, dragModel: 'G7', sightHeightIn: 1.5,
  tempF: 59, pressureInHg: 29.92, humidityPct: 50, windMph: 0,
};

console.log('maximum point-blank range');
{
  // A 10 inch plate, which is an ordinary PRS target.
  const p = maxPointBlank({ opts: OPTS, targetHeightIn: 10 });
  check('  it finds a zero and a band', !!p && p.farYd > 0,
    p ? `zero ${p.zeroYd} yd, out to ${p.farYd} yd` : '');

  // The defining property: at the far edge the bullet is on the target, and
  // beyond it, it is not. Checked against a fresh solve rather than the search.
  const at = (yd) => {
    const { rows } = solve({ ...OPTS, zeroYd: p.zeroYd, maxRangeYd: yd, stepYd: yd });
    return rows[rows.length - 1].dropIn;
  };
  check('  the bullet is inside the target at the far edge',
    Math.abs(at(p.farYd)) <= 5.001, `${at(p.farYd).toFixed(2)}" of ±5"`);
  check('  and outside it beyond', Math.abs(at(p.farYd + 20)) > 5,
    `${at(p.farYd + 20).toFixed(2)}" at ${p.farYd + 20} yd`);

  // A bigger target must be forgiving of more, never less.
  const sizes = [4, 8, 12, 20].map(h => maxPointBlank({ opts: OPTS, targetHeightIn: h }));
  check('  a bigger target reaches further', (() => {
    for (let i = 1; i < sizes.length; i++) if (sizes[i].farYd < sizes[i - 1].farYd) return false;
    return true;
  })(), sizes.map((v, i) => `${[4, 8, 12, 20][i]}":${v.farYd}`).join(' '));

  check('  and wants a longer zero', sizes[3].zeroYd >= sizes[0].zeroYd,
    `${sizes[0].zeroYd} yd for 4", ${sizes[3].zeroYd} yd for 20"`);

  check('  a target with no size gives nothing',
    maxPointBlank({ opts: OPTS, targetHeightIn: 0 }) === null);
}

console.log('\ndanger space');
{
  const near = dangerSpace({ opts: OPTS, rangeYd: 300, targetHeightIn: 10 });
  const far = dangerSpace({ opts: OPTS, rangeYd: 800, targetHeightIn: 10 });

  check('  it brackets the range it was asked about',
    near.nearYd <= 300 && near.farYd >= 300, `${near.nearYd}–${near.farYd} yd`);
  check('  and so does the far one',
    far.nearYd <= 800 && far.farYd >= 800, `${far.nearYd}–${far.farYd} yd`);

  // The point of the whole exercise.
  check('  depth collapses with distance', far.depthYd < near.depthYd / 2,
    `${near.depthYd} yd at 300 against ${far.depthYd} yd at 800`);

  check('  a bigger target has more depth',
    dangerSpace({ opts: OPTS, rangeYd: 500, targetHeightIn: 20 }).depthYd >
    dangerSpace({ opts: OPTS, rangeYd: 500, targetHeightIn: 5 }).depthYd);

  // Edges verified against the solver, not against the search that found them.
  const { rows } = solve({ ...OPTS, zeroYd: 800, maxRangeYd: far.farYd, stepYd: far.farYd });
  check('  the far edge really is the edge of the target',
    Math.abs(rows[rows.length - 1].dropIn) <= 5.001,
    `${rows[rows.length - 1].dropIn.toFixed(2)}" of ±5"`);

  check('  nonsense in, nothing out',
    dangerSpace({ opts: OPTS, rangeYd: 0, targetHeightIn: 10 }) === null
    && dangerSpace({ opts: OPTS, rangeYd: 500, targetHeightIn: 0 }) === null);
}

console.log('\nsaying what it means');
{
  const tight = describeDangerSpace(dangerSpace({ opts: OPTS, rangeYd: 800, targetHeightIn: 10 }));
  check('  a tight one calls for a rangefinder', /rangefinder stops being optional/.test(tight), tight);

  const loose = describeDangerSpace(dangerSpace({ opts: OPTS, rangeYd: 200, targetHeightIn: 20 }));
  check('  a generous one says ranging is not the problem',
    /not what will make you miss/.test(loose), loose);

  check('  nothing in, nothing out', describeDangerSpace(null) === null);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
