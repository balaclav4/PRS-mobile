/**
 * Validates round counting, barrel life staging and lot comparison.
 *
 * The claim worth testing hardest is the erosion trend, because it is the only
 * one here backed by the shooter's own data rather than a community estimate.
 * It is checked two ways: against a simulated barrel that genuinely is losing
 * velocity, and against a flat barrel with realistic session-to-session noise,
 * where declaring erosion would be a false alarm.
 *
 * Run: node scripts/test-barrel.mjs
 */
import {
  barrelLifeEstimate, totalRounds, lifeStatus, erosionTrend, compareLots, compareLotPoi,
} from '../lib/barrel.js';

let seed = 24601;
function rnd() {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(54) + detail);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('barrel life lookup');
{
  check('  6.5 Creedmoor resolves', barrelLifeEstimate('6.5 Creedmoor')?.low === 2000,
    JSON.stringify(barrelLifeEstimate('6.5 Creedmoor')));
  check('  6 Dasher resolves', barrelLifeEstimate('6 Dasher')?.low === 1500);
  check('  .308 Win lasts far longer than a 6mm',
    barrelLifeEstimate('308 Win').low > barrelLifeEstimate('6mm Creedmoor').high,
    `${barrelLifeEstimate('308 Win').low} vs ${barrelLifeEstimate('6mm Creedmoor').high}`);
  check('  22LR is effectively unlimited', barrelLifeEstimate('22LR').low >= 50000);
  check('  every range is ordered low < high',
    ['6.5 Creedmoor', '6 Dasher', '308 Win', '223 Rem', '300 PRC', '6.5x47 Lapua']
      .every(c => { const e = barrelLifeEstimate(c); return e && e.low < e.high; }));
  check('  6.5-284 is not mistaken for 284 Win',
    barrelLifeEstimate('6.5-284').low === 1000 && barrelLifeEstimate('284 Win').low === 2000,
    `${barrelLifeEstimate('6.5-284').low} vs ${barrelLifeEstimate('284 Win').low}`);
  check('  an unknown cartridge returns null', barrelLifeEstimate('9.3x62 Wildcat') === null);
  check('  blank is safe', barrelLifeEstimate('') === null && barrelLifeEstimate(null) === null);
}

console.log('\nround counting');
{
  const sessions = [
    { rifleId: 'r1', targets: [{ shots: [1, 2, 3, 4, 5] }, { shots: [1, 2, 3] }] },
    { rifleId: 'r1', targets: [{ shots: [1, 2, 3, 4, 5] }] },
    { rifleId: 'r2', targets: [{ shots: [1, 2, 3, 4, 5, 6, 7] }] },
    // Chronograph-only session: no plotted target, but rounds went downrange.
    { rifleId: 'r1', targets: [], velocities: [2800, 2810, 2805, 2812] },
  ];
  const r1 = totalRounds(sessions, 'r1');
  check('  sums shots across targets and sessions', r1.logged === 17, `${r1.logged} logged`);
  check('  counts a chrono-only session', totalRounds([sessions[3]], 'r1').logged === 4);
  check('  ignores other rifles', totalRounds(sessions, 'r2').logged === 7);
  check('  adds rounds fired before the app', totalRounds(sessions, 'r1', 1200).total === 1217,
    String(totalRounds(sessions, 'r1', 1200).total));
  check('  garbage prior count is ignored',
    totalRounds(sessions, 'r1', 'abc').total === 17 && totalRounds(sessions, 'r1', -5).total === 17);
  check('  no sessions is zero, not NaN', totalRounds([], 'r1').total === 0);
}

console.log('\nlife staging');
{
  check('  a fresh barrel reads early', lifeStatus(400, '6.5 Creedmoor').stage === 'early');
  check('  mid life', lifeStatus(1400, '6.5 Creedmoor').stage === 'mid');
  check('  approaching the range', lifeStatus(2400, '6.5 Creedmoor').stage === 'approaching');
  check('  past it', lifeStatus(3500, '6.5 Creedmoor').stage === 'past');
  check('  and always points back at the velocity trend',
    /velocity trend/.test(lifeStatus(400, '6.5 Creedmoor').note));
  check('  the estimate is described as an estimate',
    /estimate/.test(lifeStatus(400, '6.5 Creedmoor').note) &&
    /estimate/.test(lifeStatus(3500, '6.5 Creedmoor').note));
  check('  unknown cartridge degrades cleanly',
    lifeStatus(500, 'Nonexistent').est === null);
}

console.log('\nerosion: a barrel that really is going');
{
  // 25 fps lost per 100 rounds, with 12 fps of session noise on top.
  const points = [];
  for (let i = 0; i < 8; i++) {
    const rc = 200 + i * 250;
    points.push({ roundCount: rc, velocity: 2850 - 0.25 * rc + gauss() * 12 });
  }
  const t = erosionTrend(points);
  check('  is detected', t.losing, `${t.perHundred} fps/100, p = ${t.p?.toFixed(4)}`);
  check('  recovers roughly the right rate', near(t.perHundred, -25, 6),
    `${t.perHundred} fps per 100 vs true -25`);
  check('  verdict names throat erosion', /throat erosion/.test(t.verdict));
  check('  reports the span covered', t.spanRounds === 1750, String(t.spanRounds));
  check('  names the temperature confounder', /temperature/.test(t.caveat));
}

console.log('\nerosion: a flat barrel must not be condemned');
{
  // The false-alarm test. No real trend, only session noise.
  let alarms = 0;
  const TRIALS = 500;
  for (let k = 0; k < TRIALS; k++) {
    const points = [];
    for (let i = 0; i < 8; i++) {
      points.push({ roundCount: 200 + i * 250, velocity: 2850 + gauss() * 12 });
    }
    if (erosionTrend(points).losing) alarms++;
  }
  const rate = alarms / TRIALS;
  check('  a flat barrel rarely triggers an alarm', rate <= 0.05,
    `${(rate * 100).toFixed(1)}% of ${TRIALS} flat barrels`);

  const flat = erosionTrend([
    { roundCount: 200, velocity: 2850 }, { roundCount: 700, velocity: 2854 },
    { roundCount: 1200, velocity: 2848 }, { roundCount: 1700, velocity: 2852 },
  ]);
  check('  and says so plainly', !flat.losing, flat.verdict.slice(0, 46));
}

console.log('\nerosion: refusals');
{
  check('  needs three sessions',
    erosionTrend([{ roundCount: 100, velocity: 2800 }, { roundCount: 500, velocity: 2790 }]).ok === false);
  check('  needs spread in round count',
    erosionTrend([
      { roundCount: 500, velocity: 2800 }, { roundCount: 500, velocity: 2790 },
      { roundCount: 500, velocity: 2795 },
    ]).ok === false);
  check('  drops unusable rows',
    erosionTrend([
      { roundCount: 100, velocity: 2850 }, { roundCount: 600, velocity: 0 },
      { roundCount: 1100, velocity: 2820 }, { roundCount: 1600, velocity: 2800 },
    ]).n === 3);
  check('  empty is safe', erosionTrend([]).ok === false && erosionTrend(null).ok === false);
}

console.log('\nlot comparison');
{
  // A genuinely slower lot: 35 fps down, tight strings.
  const a = { label: 'Lot A', velocities: [2850, 2856, 2848, 2853, 2851, 2849, 2854, 2852] };
  const b = { label: 'Lot B', velocities: [2815, 2820, 2812, 2818, 2816, 2814, 2819, 2817] };
  const r = compareLots(a, b);
  check('  a real 35 fps gap is caught', r.significant, `${r.diff} fps, p = ${r.p?.toFixed(5)}`);
  check('  direction is right', r.diff < 0 && /slower/.test(r.verdict), String(r.diff));
  check('  and it tells you to re-confirm dope', /re-confirm your dope/i.test(r.verdict));

  // Two samples from the same lot must not be called different.
  const c = { label: 'Lot A', velocities: [2850, 2862, 2841, 2855, 2847] };
  const d = { label: 'Lot A run 2', velocities: [2845, 2858, 2852, 2843, 2860] };
  const same = compareLots(c, d);
  check('  the same lot twice is not a difference', !same.significant,
    `${same.diff} fps, p = ${same.p?.toFixed(2)}`);
  check('  and it says to treat them as the same', /treat them as the same/i.test(same.verdict));

  check('  and points at the separate POI comparison', /compareLotPoi/.test(r.poiNote));
  check('  short strings are refused',
    compareLots({ label: 'A', velocities: [2850, 2855] }, b).ok === false);
  check('  empty is safe', compareLots({}, {}).ok === false);
}

console.log('\npoint of impact between lots');
{
  // A square-on 10" sheet on the unit square: one normalised unit is 10 inches,
  // so every expected value is checkable by hand.
  const SQUARE = { corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], widthIn: 10, heightIn: 10 };
  const AIM = { x: 0.5, y: 0.5 };
  // A tight group centred `off` normalised units below aim.
  const sess = (off, reps) => ({
    distanceYd: 100,
    targets: Array.from({ length: reps }, (_, k) => ({
      id: 't' + k,
      scale: SQUARE, aim: AIM,
      shots: [
        { x: 0.49, y: 0.5 + off }, { x: 0.51, y: 0.5 + off },
        { x: 0.50, y: 0.49 + off }, { x: 0.50, y: 0.51 + off },
      ],
    })),
  });

  // Lot B prints 1" (0.1 units) lower than lot A, from tight groups.
  const moved = compareLotPoi(
    { label: 'Lot A', sessions: [sess(0, 3)] },
    { label: 'Lot B', sessions: [sess(0.1, 3)] },
    100, 'Inches'
  );
  check('  a real 1" drop is caught', moved.ok && moved.resolved,
    `${moved.radial}" vs ±${moved.ci95}" resolvable`);
  check('  direction is named', /lower/.test(moved.verdict), moved.verdict.slice(0, 52));
  check('  and it says to re-confirm zero', /Re-confirm your zero/.test(moved.verdict));

  // The same lot twice must not read as a shift.
  const same = compareLotPoi(
    { label: 'Lot A', sessions: [sess(0, 3)] },
    { label: 'Lot A again', sessions: [sess(0, 3)] },
    100, 'Inches'
  );
  check('  the same lot twice shows no shift', !same.resolved, `${same.radial}"`);
  check('  and says so', /No shift shown/.test(same.verdict));

  // Converts to the display unit.
  const moa = compareLotPoi(
    { label: 'A', sessions: [sess(0, 3)] },
    { label: 'B', sessions: [sess(0.1, 3)] },
    100, 'MOA'
  );
  check('  reports in the requested unit', near(moa.radial, 1 / 1.047, 0.02),
    `${moa.radial} MOA for a 1" shift at 100yd`);

  check('  targets without an aim point are refused',
    compareLotPoi({ label: 'A', sessions: [] }, { label: 'B', sessions: [] }, 100).ok === false);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
