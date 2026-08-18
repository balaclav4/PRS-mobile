/**
 * Validates seating-depth analysis, above all its refusal to crown a winner
 * that chance would have produced anyway.
 *
 * The headline test is the false-positive rate: given several depths that all
 * shoot identically, one of them always measures smallest. Reporting that as a
 * finding is the standard error this module exists to prevent.
 *
 * Run: node scripts/test-seating.mjs
 */
import {
  esCoefficientOfVariation, normalQuantile, expectedBestZ,
  parseDepths, analyseSeating,
} from '../lib/seating.js';

// mulberry32 — an LCG's consecutive draws are correlated enough to bias
// Box-Muller, which silently skewed an earlier harness by 9%.
let seed = 5150;
function rnd() {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
function gauss() { return Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd()); }

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(52) + detail);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const rows = (pairs) => pairs.map(([cbto, groupMoa], i) =>
  ({ id: String(i), cbto: String(cbto), groupMoa: groupMoa == null ? '' : String(groupMoa) }));

console.log('normal quantile');
{
  // Textbook values.
  check('  Q(0.975) = 1.95996', near(normalQuantile(0.975), 1.95996, 1e-4),
    normalQuantile(0.975).toFixed(5));
  check('  Q(0.5) = 0', near(normalQuantile(0.5), 0, 1e-9));
  check('  Q(0.025) = -1.95996', near(normalQuantile(0.025), -1.95996, 1e-4));
  check('  Q(0.99) = 2.32635', near(normalQuantile(0.99), 2.32635, 1e-4),
    normalQuantile(0.99).toFixed(5));
  check('  out of range is NaN', Number.isNaN(normalQuantile(0)) && Number.isNaN(normalQuantile(1)));
}

console.log('\nextreme spread variability');
{
  // Why 3-shot groups cannot settle anything: a third of the measurement is noise.
  check('  3-shot CV is about 36%', near(esCoefficientOfVariation(3), 0.359, 1e-3));
  check('  5-shot CV is about 27%', near(esCoefficientOfVariation(5), 0.271, 1e-3));
  check('  10-shot CV is about 20%', near(esCoefficientOfVariation(10), 0.201, 1e-3));
  check('  more shots is always tighter',
    esCoefficientOfVariation(10) < esCoefficientOfVariation(5) &&
    esCoefficientOfVariation(5) < esCoefficientOfVariation(3));
  check('  interpolates between table points',
    esCoefficientOfVariation(5.5) < esCoefficientOfVariation(5) &&
    esCoefficientOfVariation(5.5) > esCoefficientOfVariation(6));
  check('  one shot has no spread', esCoefficientOfVariation(1) === null);
}

console.log('\nbest-of-k bias');
{
  // Expected minimum of k standard normals, against simulation.
  for (const k of [3, 5, 8]) {
    let sum = 0;
    const TRIALS = 40000;
    for (let t = 0; t < TRIALS; t++) {
      let min = Infinity;
      for (let i = 0; i < k; i++) min = Math.min(min, gauss());
      sum += min;
    }
    const simulated = sum / TRIALS;
    const predicted = expectedBestZ(k);
    check(`  best of ${k} sits ${predicted.toFixed(2)} sigma low`,
      near(predicted, simulated, 0.04), `predicted ${predicted.toFixed(3)}, simulated ${simulated.toFixed(3)}`);
  }
  check('  more depths means a more flattering winner',
    expectedBestZ(10) < expectedBestZ(3));
}

console.log('\nparsing');
{
  const p = parseDepths(rows([[2.83, 0.41], [2.80, 0.52], [2.82, null], [2.81, 0.38]]));
  check('  sorted by depth and blanks dropped',
    p.length === 3 && p[0].cbto === 2.80 && p[2].cbto === 2.83, `${p.length} rows`);
  check('  too few depths is refused',
    analyseSeating(parseDepths(rows([[2.80, 0.5], [2.81, 0.4]]))).best === null);
  check('  empty is safe', analyseSeating(parseDepths([])).best === null);
}

console.log('\nthe honesty test');
{
  // Five depths that all shoot exactly 0.50 MOA on average. Every trial still
  // produces a "best" depth. Calling it real is the error.
  let claimed = 0;
  const TRIALS = 500, K = 5, SHOTS = 5;
  const TRUE_MEAN = 0.50;
  const cv = esCoefficientOfVariation(SHOTS);
  for (let t = 0; t < TRIALS; t++) {
    const pairs = [];
    for (let i = 0; i < K; i++) {
      const observed = Math.max(0.05, TRUE_MEAN * (1 + gauss() * cv));
      pairs.push([+(2.800 + i * 0.005).toFixed(3), +observed.toFixed(3)]);
    }
    const r = analyseSeating(parseDepths(rows(pairs)), SHOTS);
    if (r.significant) claimed++;
  }
  const rate = claimed / TRIALS;
  check('  identical depths rarely produce a "winner"', rate <= 0.10,
    `${(rate * 100).toFixed(1)}% of ${TRIALS} all-identical ladders`);

  // And the verdict tells the shooter what to do instead.
  const flat = analyseSeating(parseDepths(rows([
    [2.800, 0.52], [2.805, 0.48], [2.810, 0.45], [2.815, 0.51], [2.820, 0.49],
  ])), 5);
  check('  a flat ladder is called flat', !flat.significant, `margin ${flat.margin} sigma`);
  check('  and prescribes more shots', /Shoot \d+\+ per depth/.test(flat.verdict));
  check('  and suggests a shot count', flat.suggestedShots >= 8, String(flat.suggestedShots));
}

console.log('\na genuinely better depth');
{
  // One depth far outside what best-of-5 noise would hand you.
  const r = analyseSeating(parseDepths(rows([
    [2.800, 0.62], [2.805, 0.58], [2.810, 0.21], [2.815, 0.61], [2.820, 0.59],
  ])), 5);
  check('  is called significant', r.significant, `margin ${r.margin} sigma`);
  check('  identifies the right depth', r.best.cbto === 2.810, String(r.best.cbto));
  check('  verdict names the margin', /sigma/.test(r.verdict));
  check('  no further shots suggested', r.suggestedShots === null);

  // Found by entering it in the UI, not by writing a test: 0.21 among four
  // ~0.50s. With the mean as the reference the winner pulled the level to 0.44
  // and so lowered its own bar, scoring 0.76 sigma. Against the median it scores
  // 0.93 — better, and still short of significant, which is correct. A 0.21 is
  // 2.1 sigma below a true 0.50 at 5-shot noise, and across 5 depths something
  // that low turns up about 9% of the time with nothing changed. Marginal is the
  // honest verdict; the fix was to stop the winner biasing the comparison, not
  // to move the threshold until this case passed.
  const standout = analyseSeating(parseDepths(rows([
    [2.800, 0.52], [2.803, 0.48], [2.806, 0.21], [2.809, 0.51], [2.812, 0.49],
  ])), 5);
  check('  reference level is not dragged by the winner', standout.level > standout.mean,
    `level ${standout.level} vs mean ${standout.mean}`);
  check('  which scores the standout higher than the mean did', standout.margin >= 0.9,
    `${standout.margin} sigma, was 0.76`);
  check('  but still calls it marginal', !standout.significant);

  // Shooting more of the same tips it over, which is the advice the flat verdict
  // gives. The prescription has to actually work.
  const more = analyseSeating(parseDepths(rows([
    [2.800, 0.52], [2.803, 0.48], [2.806, 0.21], [2.809, 0.51], [2.812, 0.49],
  ])), 10);
  check('  and 10 shots per depth settles it', more.significant, `margin ${more.margin} sigma`);
}

console.log('\nshot count changes the conclusion');
{
  // The same numbers are more convincing when each came from more shots.
  const pairs = rows([
    [2.800, 0.55], [2.805, 0.50], [2.810, 0.36], [2.815, 0.54], [2.820, 0.52],
  ]);
  const at3 = analyseSeating(parseDepths(pairs), 3);
  const at10 = analyseSeating(parseDepths(pairs), 10);
  check('  same data is weaker at 3 shots than 10',
    at3.margin < at10.margin, `${at3.margin} -> ${at10.margin} sigma`);
  check('  3-shot groups do not settle it', !at3.significant);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
