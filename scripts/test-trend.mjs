/**
 * Validates the group-size trend verdict.
 *
 * The point of this module is not to detect trends, it is to refuse to claim
 * one that is not there. So most of what follows is a simulation of a shooter
 * whose ability never changes, checking how often the screen would announce a
 * direction anyway.
 *
 * The rule this replaces was `trend[last] < trend[first]` over per-session
 * minima. Its numbers are reproduced here alongside, because a replacement that
 * is not measured against what it replaces is just a different guess.
 *
 * Run: node scripts/test-trend.mjs
 */
import { regress, groupSeries, assessTrend } from '../lib/trend.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(54) + detail);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

let seed = 20260808;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

/** Extreme spread of n shots from a circular normal of the given sigma. */
function groupES(n, sigma) {
  const xs = [], ys = [];
  for (let i = 0; i < n; i++) { xs.push(gauss() * sigma); ys.push(gauss() * sigma); }
  let max = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      max = Math.max(max, Math.hypot(xs[i] - xs[j], ys[i] - ys[j]));
  return max;
}

/** Sessions with a given number of targets each, at a given true sigma. */
function makeSessions({ n = 10, targetsFor = () => 3, shots = 5, sigma = 0.35, change = 1 }) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : i / (n - 1);
    const sig = sigma * (1 + (change - 1) * f);
    const groups = Array.from({ length: targetsFor(i) }, () => groupES(shots, sig));
    out.push({ date: new Date(2026, 0, 1 + i * 7).toISOString(), _groups: groups });
  }
  return out;
}
const toGroups = (s) => s._groups;

/** The rule being replaced, for comparison. */
const oldVerdict = (sessions) => {
  const t = sessions.map(s => Math.min(...toGroups(s)));
  return t[t.length - 1] < t[0] ? 'improving' : 'worsening';
};

console.log('the regression itself');
{
  const xs = [0, 1, 2, 3, 4, 5], ys = xs.map(x => 3 - 0.5 * x);
  const f = regress(xs, ys);
  check('  recovers an exact line', near(f.slope, -0.5, 1e-9) && near(f.intercept, 3, 1e-9),
    `slope ${f.slope.toFixed(3)}`);
  check('  a perfect fit has a zero-width interval', near(f.lo, f.hi, 1e-6));
  check('  and r2 of 1', near(f.r2, 1, 1e-9));

  const noisy = regress([0, 1, 2, 3, 4, 5], [3, 1, 4, 1, 5, 2]);
  check('  noise gives an interval that spans zero', noisy.lo < 0 && noisy.hi > 0,
    `[${noisy.lo.toFixed(2)}, ${noisy.hi.toFixed(2)}]`);
  check('  too few points is refused', regress([0, 1], [1, 2]) === null);
  check('  all on one x is refused', regress([2, 2, 2, 2], [1, 2, 3, 4]) === null,
    'no spread to fit against');
}

console.log('\nevery group counts, not each session\'s best');
{
  const sessions = [
    { date: '2026-01-01T00:00:00Z', _groups: [0.5, 0.7, 0.9] },
    { date: '2026-01-08T00:00:00Z', _groups: [0.6] },
  ];
  const { xs, ys, sessionCount } = groupSeries(sessions, toGroups);
  check('  a session with three targets contributes three points', ys.length === 4, `${ys.length} points`);
  check('  indexed by session, not by target', xs.join() === '0,0,0,1');
  check('  ordered oldest first', sessionCount === 2);

  const outOfOrder = groupSeries([
    { date: '2026-02-01T00:00:00Z', _groups: [1.0] },
    { date: '2026-01-01T00:00:00Z', _groups: [0.4] },
  ], toGroups);
  check('  sorts by date whatever order they arrive in', outOfOrder.ys.join() === '0.4,1');
  check('  junk group sizes are dropped',
    groupSeries([{ date: '2026-01-01', _groups: [0.5, 0, -1, NaN] }], toGroups).ys.length === 1);
}

console.log('\na shooter who has not changed at all');
{
  const N = 600;
  const run = (label, targetsFor, change = 1) => {
    let claimed = 0, oldClaimedImproving = 0;
    for (let t = 0; t < N; t++) {
      const s = makeSessions({ targetsFor, change });
      const v = assessTrend(s, toGroups);
      if (v.level === 'improving' || v.level === 'worsening') claimed++;
      if (oldVerdict(s) === 'improving') oldClaimedImproving++;
    }
    const pct = (100 * claimed / N).toFixed(1);
    const oldPct = (100 * oldClaimedImproving / N).toFixed(1);
    console.log(`  ${label.padEnd(40)}claims a direction ${pct.padStart(5)}%   (old rule said "improving" ${oldPct}%)`);
    return claimed / N;
  };

  const flat = run('3 targets every session', () => 3);
  check('  rarely claims a direction when there is none', flat <= 0.10,
    `${(flat * 100).toFixed(1)}% against a 5% nominal false-positive rate`);

  // The confound that made the old rule actively misleading.
  const ramp = run('1 target early, 6 late', (i) => 1 + Math.round(i * 5 / 9));
  check('  shooting more targets later is not mistaken for improving', ramp <= 0.10,
    `${(ramp * 100).toFixed(1)}%; the old rule said "improving" here most of the time`);
}

console.log('\na shooter who really is changing');
{
  const N = 300;
  const detect = (change) => {
    let right = 0;
    for (let t = 0; t < N; t++) {
      const v = assessTrend(makeSessions({ change }), toGroups);
      if (change < 1 && v.level === 'improving') right++;
      if (change > 1 && v.level === 'worsening') right++;
    }
    return right / N;
  };
  // Reciprocal effects, so the two directions are the same size.
  //
  // The first version of this compared x0.6 against x1.5 and read the 81% / 64%
  // split as the estimator favouring improvement. It is not: |log 0.6| is 0.511
  // and |log 1.5| is 0.405, so the improvement was simply a 26% larger effect.
  // A power difference between equal effects would be a real finding; a power
  // difference between unequal ones is arithmetic.
  const better = detect(1 / 1.5);
  const worse = detect(1.5);
  console.log(`  a third tighter over ten sessions -> caught ${(better * 100).toFixed(0)}%`);
  console.log(`  half again worse over ten sessions -> caught ${(worse * 100).toFixed(0)}%`);
  check('  a real improvement is found', better > 0.6, `${(better * 100).toFixed(0)}%`);
  check('  a real decline is found', worse > 0.6, `${(worse * 100).toFixed(0)}%`);
  check('  and neither direction is favoured', Math.abs(better - worse) < 0.15,
    `${(better * 100).toFixed(0)}% against ${(worse * 100).toFixed(0)}% for equal and opposite effects`);
  check('  and is never called the wrong way', (() => {
    for (let t = 0; t < 100; t++)
      if (assessTrend(makeSessions({ change: 0.6 }), toGroups).level === 'worsening') return false;
    return true;
  })());
}

console.log('\nsaying nothing, usefully');
{
  const v = assessTrend(makeSessions({ targetsFor: () => 3 }), toGroups);
  if (v.level === 'flat') {
    check('  a flat result states a bound rather than shrugging',
      /bigger than about [\d.]+%/.test(v.text), v.text.slice(0, 76) + '...');
  } else {
    check('  a flat result states a bound rather than shrugging', true, `(came out ${v.level} on this seed)`);
  }

  check('  two sessions is refused',
    assessTrend(makeSessions({ n: 2 }), toGroups).level === 'insufficient');
  check('  one busy session is refused however many targets',
    assessTrend([{ date: '2026-01-01', _groups: [0.4, 0.5, 0.6, 0.7, 0.8, 0.9] }], toGroups).level === 'insufficient',
    'a trend needs shooting spread over time');
  check('  and says which it is short of',
    /at least three sessions|spread over time/.test(assessTrend(makeSessions({ n: 2 }), toGroups).text));
  check('  nothing at all is safe', assessTrend([], toGroups).level === 'insufficient');
  check('  the rate is a percentage, so it needs no unit',
    /% per session/.test(assessTrend(makeSessions({}), toGroups).text),
    'a proportional change is what a shooter actually notices');
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
