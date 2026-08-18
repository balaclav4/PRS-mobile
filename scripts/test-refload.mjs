/**
 * Validates reference-load confirmation.
 *
 * The two headline claims are checkable against published values: the Wilson
 * interval for 10/10, and the rule of three. Both are checked against exact
 * binomial coverage by simulation rather than taken on faith.
 *
 * Run: node scripts/test-refload.mjs
 */
import {
  wilsonInterval, exactLowerBound, shotsNeededFor, sigmaFromGroup, assessReference,
} from '../lib/refload.js';
import { hitProbability } from '../lib/stats.js';

let seed = 90210;
function rnd() {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(52) + detail);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('wilson interval');
{
  const ten = wilsonInterval(10, 10);
  check('  10/10 does not claim certainty', ten.high === 1 && ten.low < 0.8,
    `[${(ten.low * 100).toFixed(1)}%, 100%]`);
  check('  10/10 lower bound is about 72%', near(ten.low, 0.722, 0.01),
    (ten.low * 100).toFixed(1) + '%');

  const half = wilsonInterval(50, 100);
  check('  50/100 is centred near 50%', near(half.point, 0.5, 1e-9));
  check('  and about 40-60%', near(half.low, 0.404, 0.01) && near(half.high, 0.596, 0.01),
    `[${(half.low * 100).toFixed(1)}, ${(half.high * 100).toFixed(1)}]`);

  const none = wilsonInterval(0, 10);
  check('  0/10 stays inside [0,1]', none.low === 0 && none.high < 1,
    `[0, ${(none.high * 100).toFixed(1)}%]`);

  check('  more shots is a tighter interval',
    (wilsonInterval(80, 100).high - wilsonInterval(80, 100).low) <
    (wilsonInterval(8, 10).high - wilsonInterval(8, 10).low));
  check('  nonsense is refused',
    wilsonInterval(11, 10) === null && wilsonInterval(1, 0) === null);
}

console.log('\ninterval actually covers');
{
  // The point of an interval is its coverage. Simulate true rates and count how
  // often the interval contains them.
  for (const trueP of [0.5, 0.8, 0.95]) {
    let covered = 0;
    const TRIALS = 4000, N = 20;
    for (let t = 0; t < TRIALS; t++) {
      let k = 0;
      for (let i = 0; i < N; i++) if (rnd() < trueP) k++;
      const ci = wilsonInterval(k, N);
      if (ci.low <= trueP && trueP <= ci.high) covered++;
    }
    const rate = covered / TRIALS;
    check(`  covers a true ${trueP * 100}% at n=20`, rate >= 0.90,
      `${(rate * 100).toFixed(1)}% of ${TRIALS}`);
  }
}

console.log('\nrule of three');
{
  const n90 = shotsNeededFor(0.90);
  const n95 = shotsNeededFor(0.95);
  // Matches the exact Clopper-Pearson bound: ceil(ln 0.05 / ln p) is 29 and 59.
  check('  confirming 90% takes 29 straight hits', n90 === 29, String(n90));
  check('  confirming 95% takes 59', n95 === 59, String(n95));
  check('  a higher bar costs more shots', n95 > n90);
  check('  and it really is a clean-run bound',
    exactLowerBound(n90, n90) >= 0.90 && exactLowerBound(n90 - 1, n90 - 1) < 0.90);
  check('  clean-run bound is exactly alpha^(1/n)',
    near(exactLowerBound(10, 10), Math.pow(0.05, 1 / 10), 1e-9),
    (exactLowerBound(10, 10) * 100).toFixed(1) + '%');
  check('  Wilson would have stopped a shooter early',
    Math.round(20 / (1 - 0.9) * 0) + (0.9 * 0) === 0 &&
    wilsonInterval(25, 25, 0.95, true).low >= 0.90 && exactLowerBound(25, 25) < 0.90,
    'Wilson clears 90% at n=25, exact does not');
  // General k, not just clean runs: check against the binomial it inverts.
  for (const [k, n] of [[8, 10], [45, 50], [17, 20]]) {
    const L = exactLowerBound(k, n);
    let tail = 0;
    for (let i = k; i <= n; i++) {
      let c = 1;
      for (let j = 0; j < i; j++) c = c * (n - j) / (j + 1);
      tail += c * Math.pow(L, i) * Math.pow(1 - L, n - i);
    }
    check(`  ${k}/${n} bound inverts the binomial`, near(tail, 0.05, 1e-4),
      `P(X>=${k}|${L.toFixed(4)}) = ${tail.toFixed(5)}`);
  }
  check('  impossible targets are refused', shotsNeededFor(1) === null);
}

console.log('\ngroup size to sigma');
{
  // Round trip: a sigma that produces a known extreme spread should come back.
  const sigma = sigmaFromGroup(1.0, 5);
  check('  a 1 MOA 5-shot group is about 0.33 sigma', near(sigma, 0.327, 0.01),
    sigma.toFixed(3));
  check('  same group from more shots means a tighter rifle',
    sigmaFromGroup(1.0, 10) < sigmaFromGroup(1.0, 5),
    `${sigmaFromGroup(1.0, 10).toFixed(3)} vs ${sigmaFromGroup(1.0, 5).toFixed(3)}`);
  check('  scales linearly with group size',
    near(sigmaFromGroup(2.0, 5) / sigmaFromGroup(1.0, 5), 2, 1e-9));
  check('  refuses a one-shot group', sigmaFromGroup(1.0, 1) === null);

  // And against simulation: draw 5-shot groups at a known sigma and check the
  // mean extreme spread inverts back.
  const TRUE_SIGMA = 0.4;
  let sum = 0;
  const TRIALS = 3000;
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  for (let t = 0; t < TRIALS; t++) {
    const pts = [];
    for (let i = 0; i < 5; i++) pts.push({ x: gauss() * TRUE_SIGMA, y: gauss() * TRUE_SIGMA });
    let es = 0;
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
      es = Math.max(es, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
    }
    sum += es;
  }
  const recovered = sigmaFromGroup(sum / TRIALS, 5);
  check('  inverts a simulated 5-shot group', near(recovered, TRUE_SIGMA, 0.02),
    `recovered ${recovered.toFixed(3)} from true ${TRUE_SIGMA}`);
}

console.log('\nthe ten-for-ten trap');
{
  const r = assessReference({ hits: 10, shots: 10, hitRatePct: 90 });
  check('  a clean 10 does not confirm 90%', !r.hitRate.confirmed,
    `lower bound ${r.hitRate.low}%`);
  check('  and says how many more are needed', r.hitRate.moreNeeded > 0,
    `${r.hitRate.moreNeeded} more`);
  check('  verdict names the real bound', /lower bound at 7\d/.test(r.verdict), r.hitRate.low + '%');

  // A displayed range must come from a single interval. The verdict once spliced
  // the exact one-sided lower bound onto the Wilson two-sided upper end and
  // printed 24.5-74.6% while the panel beside it read 25.4-74.6%.
  const mixed = assessReference({ hits: 6, shots: 12, hitRatePct: 90 });
  const shown = mixed.verdict.match(/range that fits is ([\d.]+)–([\d.]+)%/);
  check('  the displayed range comes from one interval',
    shown && +shown[1] === mixed.ci.low && +shown[2] === mixed.ci.high,
    shown ? `${shown[1]}-${shown[2]} vs ci ${mixed.ci.low}-${mixed.ci.high}` : 'no range printed');
  check('  and the pass/fail bound stays the stricter one',
    mixed.hitRate.low < mixed.ci.low,
    `bound ${mixed.hitRate.low}% vs range low ${mixed.ci.low}%`);

  const enough = assessReference({ hits: 30, shots: 30, hitRatePct: 90 });
  check('  a clean 30 does confirm it', enough.hitRate.confirmed,
    `lower bound ${enough.hitRate.low}%`);
}

console.log('\naccuracy against the goal');
{
  // Inside the group's own noise: refuse to rule either way.
  const marginal = assessReference({
    hits: 8, shots: 10, groupMoa: 0.72, groupShots: 5, goalMoa: 0.75,
  });
  check('  a near miss of the goal is called undecided',
    !marginal.accuracy.meets && !marginal.accuracy.misses,
    `${marginal.accuracy.marginSigma} sigma`);
  check('  and says so plainly', /neither confirms nor rules out/.test(marginal.verdict));

  const clears = assessReference({
    hits: 8, shots: 10, groupMoa: 0.40, groupShots: 5, goalMoa: 0.75,
  });
  check('  a clear pass is called met', clears.accuracy.meets,
    `${clears.accuracy.marginSigma} sigma`);

  const fails2 = assessReference({
    hits: 8, shots: 10, groupMoa: 1.40, groupShots: 5, goalMoa: 0.75,
  });
  check('  a clear fail is called missed', fails2.accuracy.misses,
    `${fails2.accuracy.marginSigma} sigma`);

  // Same group size, more shots behind it, so the same number carries more
  // weight. At a 0.75 goal a 0.65 group reaches only 0.96 sigma even from 20
  // shots — genuinely still short, and the threshold does not bend for it.
  const at5 = assessReference({ hits: 8, shots: 10, groupMoa: 0.65, groupShots: 5, goalMoa: 0.80 });
  const at20 = assessReference({ hits: 8, shots: 10, groupMoa: 0.65, groupShots: 20, goalMoa: 0.80 });
  check('  more shots behind the same group resolves it',
    !at5.accuracy.meets && at20.accuracy.meets,
    `${at5.accuracy.marginSigma} -> ${at20.accuracy.marginSigma} sigma`);
  check('  and a hair short stays short',
    !assessReference({ hits: 8, shots: 10, groupMoa: 0.65, groupShots: 20, goalMoa: 0.75 })
      .accuracy.meets, '0.96 sigma against a 1.0 bar');
}

console.log('\nmisses the load did not cause');
{
  // A 0.5 MOA load on a 2 MOA target should almost never miss. Going 6/12 is
  // not a load problem.
  const r = assessReference({
    hits: 6, shots: 12, groupMoa: 0.5, groupShots: 5, targetMoa: 2.0, hitRatePct: 90,
  });
  check('  a large shortfall is flagged', r.diagnosis.shortfall,
    `predicted ${r.diagnosis.predicted}%, shot ${r.diagnosis.observed}%, z=${r.diagnosis.z}`);
  check('  and its z stays readable', Math.abs(r.diagnosis.z) < 20,
    `z=${r.diagnosis.z}, was -20189 before the variance floor`);
  check('  and blamed on wind, range or position',
    /not the load/.test(r.verdict));

  // A 2 MOA load on a 2 MOA target genuinely will miss a lot. Do not blame wind.
  const honest = assessReference({
    hits: 7, shots: 12, groupMoa: 2.0, groupShots: 5, targetMoa: 2.0,
  });
  check('  a real dispersion limit is not misattributed', !honest.diagnosis.shortfall,
    `predicted ${honest.diagnosis.predicted}%, shot ${honest.diagnosis.observed}%`);

  // Cross-check the prediction against the same Rayleigh model directly.
  const sigma = sigmaFromGroup(1.0, 5);
  const direct = hitProbability(sigma, 1.0);
  check('  prediction agrees with the Rayleigh model',
    near(assessReference({ hits: 1, shots: 10, groupMoa: 1.0, groupShots: 5, targetMoa: 2.0 })
      .diagnosis.predicted / 100, direct, 1e-3),
    (direct * 100).toFixed(1) + '%');
}

console.log('\nbad input');
{
  check('  no shots is refused', assessReference({ hits: 0, shots: 0 }).ok === false);
  check('  more hits than shots is refused',
    assessReference({ hits: 5, shots: 3 }).ok === false);
  check('  strings from TextInputs are coerced',
    assessReference({ hits: '9', shots: '10', hitRatePct: '90' }).hitRate.observed === 90);
  check('  no goal still returns a verdict',
    /Set a goal/.test(assessReference({ hits: 9, shots: 10 }).verdict));
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
