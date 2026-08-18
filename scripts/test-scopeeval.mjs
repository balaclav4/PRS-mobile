/**
 * Validates scope tracking and return-to-zero evaluation.
 *
 * The load-bearing claim is the displacement confidence interval, because every
 * verdict in the module rests on it. It is checked against simulation: shoot two
 * groups from a rifle with known dispersion and no tracking error at all, and
 * the measured displacement must fall inside the stated interval 95% of the
 * time. If that number is wrong the module either condemns good scopes or
 * clears bad ones.
 *
 * Run: node scripts/test-scopeeval.mjs
 */
import {
  centreSe, displacementCi95, trackingStep, shotsForTracking, rtzStep, evaluateScope,
} from '../lib/scopeeval.js';

let seed = 8675309;
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

console.log('centre and displacement uncertainty');
{
  check('  centre error shrinks as sqrt(n)',
    near(centreSe(1, 4), 0.5, 1e-9) && near(centreSe(1, 16), 0.25, 1e-9),
    `${centreSe(1, 4)} at n=4, ${centreSe(1, 16)} at n=16`);
  // Tolerance is 1e-6, not tighter: normalQuantile is Acklam's rational
  // approximation and is good to about 1e-8, not to machine precision.
  check('  a displacement is sqrt(2) noisier than one centre',
    near(displacementCi95(1, 5) / (1.959964 * centreSe(1, 5)), Math.SQRT2, 1e-6),
    (displacementCi95(1, 5) / (1.959964 * centreSe(1, 5))).toFixed(9));
  check('  refuses nonsense', centreSe(0, 5) === null && displacementCi95(1, 0) === null);

  // The headline figure from the module docstring: a 1 MOA rifle at 100yd has
  // per-axis sigma near 0.35", and five shots give roughly ±0.55" on a
  // displacement.
  const ci = displacementCi95(0.35, 5);
  check('  1 MOA rifle, 5 shots, gives about ±0.43"', near(ci, 0.434, 0.01), `±${ci.toFixed(3)}"`);
  check('  which on an 18" dial is about 2.4%',
    near((ci / 18) * 100, 2.41, 0.1), `${((ci / 18) * 100).toFixed(2)}%`);
}

console.log('\nthe interval actually covers');
{
  // A perfect scope: dial exactly 18", the true displacement is exactly 18".
  // The measured displacement must land inside the stated CI 95% of the time.
  const SIGMA = 0.35, N = 5, TRUE = 18;
  const ci = displacementCi95(SIGMA, N);
  let inside = 0;
  const TRIALS = 6000;
  for (let t = 0; t < TRIALS; t++) {
    let a = 0, b = 0;
    for (let i = 0; i < N; i++) { a += gauss() * SIGMA; b += gauss() * SIGMA; }
    const measured = TRUE + (b / N) - (a / N);
    if (Math.abs(measured - TRUE) <= ci) inside++;
  }
  const rate = inside / TRIALS;
  check('  a perfect scope stays inside the CI ~95% of the time',
    rate >= 0.93 && rate <= 0.97, `${(rate * 100).toFixed(1)}% of ${TRIALS}`);

  // And therefore a perfect scope is falsely condemned about 5% of the time.
  let condemned = 0;
  for (let t = 0; t < 2000; t++) {
    let a = 0, b = 0;
    for (let i = 0; i < N; i++) { a += gauss() * SIGMA; b += gauss() * SIGMA; }
    const measured = TRUE + (b / N) - (a / N);
    if (trackingStep({ dialled: TRUE, measured, sigma: SIGMA, shots: N }).resolved) condemned++;
  }
  check('  and is falsely condemned about 5% of the time', condemned / 2000 <= 0.07,
    `${((condemned / 2000) * 100).toFixed(1)}% of 2000 perfect scopes`);
}

console.log('\nthe test that proves nothing');
{
  // The scenario from the docstring: dial 18", measure 17.6", conclude 2% slow.
  const r = trackingStep({ dialled: 18, measured: 17.6, sigma: 0.35, shots: 5 });
  check('  a 2% reading from 5 shots is not resolved', r.resolved === false,
    `${r.errorPct}% measured, ±${r.ci95Pct}% resolvable`);
  check('  and the verdict says so', /indistinguishable from zero error/.test(r.verdict));
  check('  and refuses to condemn', /Nothing here condemns the scope/.test(r.verdict));
}

console.log('\na tracking error big enough to be real');
{
  // 10% slow is a genuinely broken scope and five shots can see it.
  const r = trackingStep({ dialled: 18, measured: 16.2, sigma: 0.35, shots: 5 });
  check('  a 10% error is caught', r.resolved === true, `${r.errorPct}%`);
  check('  named as under-tracking', /under by 10\.0%/.test(r.verdict), r.verdict.slice(0, 44));

  const over = trackingStep({ dialled: 18, measured: 19.8, sigma: 0.35, shots: 5 });
  check('  and over-tracking is named the other way', /over by 10\.0%/.test(over.verdict));
  check('  sign of the error follows', over.errorPct > 0 && r.errorPct < 0,
    `${r.errorPct}% vs +${over.errorPct}%`);
}

console.log('\nhow many shots the test actually needs');
{
  const n1 = shotsForTracking(1, 18, 0.35);
  const n2 = shotsForTracking(2, 18, 0.35);
  const n5 = shotsForTracking(5, 18, 0.35);
  check('  detecting 1% takes far more than 2%', n1 > n2 && n2 > n5,
    `1%: ${n1}, 2%: ${n2}, 5%: ${n5} shots`);
  // Quadrupling shots halves the detectable error, so the counts scale ~4x.
  check('  halving the tolerance roughly quadruples the shots',
    near(n1 / n2, 4, 1.2), `${n1}/${n2} = ${(n1 / n2).toFixed(1)}x`);
  check('  a more precise rifle needs fewer shots',
    shotsForTracking(2, 18, 0.2) < shotsForTracking(2, 18, 0.5),
    `${shotsForTracking(2, 18, 0.2)} vs ${shotsForTracking(2, 18, 0.5)}`);
  check('  nonsense is refused', shotsForTracking(0, 18, 0.35) === null);
}

console.log('\nreturn to zero');
{
  const clean = rtzStep({ deviation: 0.2, sigma: 0.35, shots: 5, milsTravelled: 2000 });
  check('  a small deviation is not a failure', clean.resolved === false,
    `${clean.deviation}" vs ±${clean.ci95In}"`);
  check('  and the travel is quoted', /after 2000 mils of travel/.test(clean.verdict));

  const bad = rtzStep({ deviation: 1.4, sigma: 0.35, shots: 5, milsTravelled: 2000 });
  check('  a large one is', bad.resolved === true, `${bad.deviation}"`);
  check('  and is called a real failure', /a real failure/.test(bad.verdict));

  const noSigma = rtzStep({ deviation: 0.9, shots: 5 });
  check('  without a group size it will not judge', noSigma.resolved === null);
  check('  and asks for one', /Record your group size/.test(noSigma.verdict));
  check('  negative deviation is refused', rtzStep({ deviation: -1 }).ok === false);
}

console.log('\nrolling up an evaluation');
{
  const sigma = 0.35, shots = 5;
  const good = [
    trackingStep({ dialled: 18, measured: 18.1, sigma, shots }),
    trackingStep({ dialled: 36, measured: 35.8, sigma, shots }),
    rtzStep({ deviation: 0.15, sigma, shots, milsTravelled: 2000 }),
  ];
  const r = evaluateScope(good);
  check('  all-pass reads as pass', r.failures === 0 && r.passes === 3, r.verdict.slice(0, 46));

  const withFault = [...good, trackingStep({ dialled: 18, measured: 15.5, sigma, shots })];
  const f = evaluateScope(withFault);
  check('  one real fault condemns the scope', f.failures === 1 && /not tracking/.test(f.verdict));

  // A step with no dispersion recorded must not be counted as a pass.
  const murky = [good[0], trackingStep({ dialled: 18, measured: 17.5 })];
  const m = evaluateScope(murky);
  check('  an unresolvable step is not a pass',
    m.passes === 1 && m.undecidable === 1 && m.failures === 0,
    `${m.passes} pass, ${m.undecidable} undecidable`);
  check('  and the verdict withholds approval',
    /before calling this scope good/.test(m.verdict));

  check('  empty is safe', evaluateScope([]).ok === false && evaluateScope(null).ok === false);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
