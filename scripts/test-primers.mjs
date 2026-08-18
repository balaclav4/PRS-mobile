/**
 * Validates primer comparison.
 *
 * The claim worth checking hardest is the one the module leads with: that a
 * five-shot SD comparison cannot resolve the differences reloaders argue about.
 * That is checked two ways — against the F distribution, and by simulating
 * primers that are genuinely identical and counting how often a winner is
 * declared.
 *
 * Run: node scripts/test-primers.mjs
 */
import {
  parseStrings, detectableRatio, shotsToDetect, sdInterval, comparePrimers,
} from '../lib/primers.js';
import { sd } from '../lib/stats.js';

let seed = 31337;
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

const rows = (pairs) => pairs.map(([brand, vs], i) =>
  ({ id: String(i), brand, velocities: vs.join(' ') }));

console.log('parsing');
{
  const p = parseStrings(rows([
    ['CCI 450', [2810, 2822, 2815, 2830, 2818]],
    ['BR-4', [2809, 2825]],           // too few
    ['', [2800, 2810, 2820]],         // no brand
  ]));
  check('  keeps only usable strings', p.length === 1 && p[0].brand === 'CCI 450',
    `${p.length} of 3`);
  check('  splits on commas and newlines',
    parseStrings([{ id: 'a', brand: 'X', velocities: '2810,2822\n2815; 2830' }])[0]
      .velocities.length === 4);
  check('  drops non-numeric junk',
    parseStrings([{ id: 'a', brand: 'X', velocities: '2810 oops 2822 2815' }])[0]
      .velocities.length === 3);
}

console.log('\nwhat a five-shot string can resolve');
{
  // Two-tailed F(0.975, 4, 4) = 9.605, so the SD ratio is sqrt of that. My first
  // expectation here was 2.4x, which is the one-tailed value.
  const r5 = detectableRatio(5, 5);
  check('  two 5-shot strings need a 3.10x SD ratio', near(r5, Math.sqrt(9.605), 0.01),
    r5.toFixed(2) + 'x');
  check('  10-shot strings do better', detectableRatio(10, 10) < r5,
    detectableRatio(10, 10).toFixed(2) + 'x');
  check('  20-shot strings better still', detectableRatio(20, 20) < detectableRatio(10, 10),
    detectableRatio(20, 20).toFixed(2) + 'x');
  check('  refuses strings too short to test', detectableRatio(2, 5) === null);

  // The headline claim, in fps: 12 vs 15 is nowhere near resolvable at n=5.
  check('  12 vs 15 fps is unresolvable at 5 shots', 15 / 12 < r5,
    `need ${(12 * r5).toFixed(0)} fps to beat 12`);

  check('  and it takes a long string to resolve it',
    shotsToDetect(15 / 12) >= 60, `${shotsToDetect(15 / 12)} shots per brand`);
  check('  while a 3x difference is quick', shotsToDetect(3) <= 6,
    `${shotsToDetect(3)} shots per brand`);
}

console.log('\nSD confidence interval');
{
  // Against published chi-square values for n=5 (df=4): chi2(0.975,4)=11.1433
  // and chi2(0.025,4)=0.4844, so a 12 fps string spans 7.2 to 34.5 fps.
  const ci = sdInterval([2800, 2812, 2806, 2820, 2810]);
  const s = sd([2800, 2812, 2806, 2820, 2810]);
  check('  interval brackets the sample SD', ci.low < s && s < ci.high,
    `${ci.low.toFixed(1)} < ${s.toFixed(1)} < ${ci.high.toFixed(1)}`);
  // Published chi2(0.975,4)=11.1433 and chi2(0.025,4)=0.4844 give exactly
  // 0.599x and 2.874x. Wilson-Hilferty returned 2.98 for the upper end.
  check('  n=5 spans 0.599x to 2.874x the estimate',
    near(ci.low / s, 0.599, 0.001) && near(ci.high / s, 2.874, 0.001),
    `${(ci.low / s).toFixed(3)}x to ${(ci.high / s).toFixed(3)}x`);
  check('  a longer string is tighter',
    (sdInterval(Array.from({ length: 30 }, () => 2800 + gauss() * 12)).high /
      sdInterval(Array.from({ length: 30 }, () => 2800 + gauss() * 12)).low) < 2);

  // And by simulation: the interval must actually cover the true SD.
  let covered = 0;
  const TRIALS = 3000, N = 8, TRUE_SD = 14;
  for (let t = 0; t < TRIALS; t++) {
    const s2 = Array.from({ length: N }, () => 2800 + gauss() * TRUE_SD);
    const c = sdInterval(s2);
    if (c.low <= TRUE_SD && TRUE_SD <= c.high) covered++;
  }
  const rate = covered / TRIALS;
  check('  covers the true SD about 95% of the time', rate >= 0.92 && rate <= 0.98,
    `${(rate * 100).toFixed(1)}% of ${TRIALS} at n=${N}`);
}

console.log('\nthe honesty test');
{
  // Three primers that are genuinely identical. One always measures lowest.
  let claimed = 0;
  const TRIALS = 500, TRUE_SD = 13;
  for (let t = 0; t < TRIALS; t++) {
    const pairs = ['CCI 450', 'BR-4', 'Fed 205M'].map(b =>
      [b, Array.from({ length: 5 }, () => Math.round(2800 + gauss() * TRUE_SD))]);
    if (comparePrimers(parseStrings(rows(pairs))).significant) claimed++;
  }
  const rate = claimed / TRIALS;
  check('  identical primers rarely produce a "winner"', rate <= 0.10,
    `${(rate * 100).toFixed(1)}% of ${TRIALS} all-identical tests`);
}

console.log('\na typical primer test');
{
  // The comparison reloaders actually run and argue about.
  const r = comparePrimers(parseStrings(rows([
    ['CCI 450', [2810, 2822, 2815, 2830, 2818]],
    ['Fed 205M', [2808, 2831, 2812, 2840, 2820]],
  ])));
  check('  ranks by SD', r.rows[0].sd <= r.rows[1].sd,
    `${r.rows[0].brand} ${r.rows[0].sd} vs ${r.rows[1].brand} ${r.rows[1].sd}`);
  check('  refuses to call it', !r.significant, `observed ${r.observedRatio}x`);
  check('  says what separation would be needed', r.neededRatio > 2,
    `${r.neededRatio}x needed`);
  check('  and names the alternative', /availability, fit and supply/.test(r.verdict));
  check('  reports each SD with its interval',
    r.rows.every(x => x.sdLow < x.sd && x.sd < x.sdHigh),
    `${r.rows[0].sdLow}-${r.rows[0].sdHigh} fps`);
}

console.log('\na difference big enough to be real');
{
  // A 4x SD gap on 8-shot strings. This one genuinely is a result.
  const tight = [2800, 2804, 2798, 2802, 2801, 2803, 2799, 2802];
  const loose = [2780, 2825, 2795, 2840, 2770, 2830, 2805, 2850];
  const r = comparePrimers(parseStrings(rows([['Tight', tight], ['Loose', loose]])));
  check('  is called significant', r.significant, `p = ${r.p?.toFixed(4)}`);
  check('  identifies the right brand', r.best.brand === 'Tight');
  check('  verdict quotes the p-value', /p = 0\./.test(r.verdict));
  check('  no further shots suggested', r.wouldNeed === null);
}

console.log('\nedge cases');
{
  check('  one brand is refused',
    comparePrimers(parseStrings(rows([['CCI', [2800, 2810, 2820]]]))).best === null);
  check('  empty is safe', comparePrimers([]).best === null);
  check('  identical strings do not divide by zero',
    comparePrimers(parseStrings(rows([
      ['A', [2800, 2810, 2820]], ['B', [2800, 2810, 2820]],
    ]))).significant === false);
  check('  three brands rank all three',
    comparePrimers(parseStrings(rows([
      ['A', [2800, 2810, 2820]], ['B', [2800, 2805, 2810]], ['C', [2790, 2830, 2860]],
    ]))).rows.length === 3);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
