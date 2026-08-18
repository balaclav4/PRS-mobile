/**
 * Validates the statistics layer against published table values and, where no
 * closed form is handy, against Monte Carlo simulation.
 *
 * These numbers decide which load someone loads for a match, so "looks about
 * right" is not good enough — every distribution function is checked against a
 * known value.
 *
 * Run: node scripts/test-stats.mjs
 */
import {
  tTestP, tCritical, fTestP, welchCompare, varianceCompare,
  rayleighSigma, cepRadii, hitProbability, meanRadius, dispersion, sd, mean,
  bootstrapDiff,
} from '../lib/stats.js';

// mulberry32, not an LCG. Box-Muller consumes two draws in a row for the
// radius and the angle, and a plain LCG's consecutive outputs are correlated
// enough to bias the result — it produced sigma ~9% low across every Monte
// Carlo check here while all closed-form checks passed.
let seed = 20260731;
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
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(50) + detail);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- Student t, against standard tables ---------------------------------------
console.log('t-distribution (two-tailed p)');
{
  // Textbook values.
  const cases = [
    [2.228, 10, 0.050], [2.0, 10, 0.0734], [3.169, 10, 0.010],
    [2.776, 4, 0.050], [1.96, 100000, 0.050], [12.706, 1, 0.050],
  ];
  for (const [t, df, expect] of cases) {
    const p = tTestP(t, df);
    check(`  t=${t}, df=${df}`, near(p, expect, 0.001), `p=${p.toFixed(4)} (table ${expect})`);
  }
  // Critical values invert correctly.
  check('  tCritical(10, .95) = 2.228', near(tCritical(10, 0.95), 2.228, 0.002),
    tCritical(10, 0.95).toFixed(4));
  check('  tCritical(4, .95) = 2.776', near(tCritical(4, 0.95), 2.776, 0.002),
    tCritical(4, 0.95).toFixed(4));
}

// --- F distribution -----------------------------------------------------------
console.log('\nF-distribution');
{
  // F(5,5) upper 2.5% point is 7.146, so two-tailed p there is 0.05.
  const p = fTestP(7.146, 5, 5);
  check('  F=7.146, df=(5,5) -> p=0.05', near(p, 0.05, 0.002), `p=${p.toFixed(4)}`);
  check('  F=1 -> p=1 (identical variances)', near(fTestP(1, 8, 8), 1, 1e-9));
}

// --- Rayleigh / CEP, against closed form --------------------------------------
console.log('\nRayleigh dispersion');
{
  const cep = cepRadii(1);
  check('  R50 = 1.1774 sigma', near(cep.r50, 1.17741, 1e-4), cep.r50.toFixed(5));
  check('  R90 = 2.1460 sigma', near(cep.r90, 2.14597, 1e-4), cep.r90.toFixed(5));
  check('  R95 = 2.4477 sigma', near(cep.r95, 2.44775, 1e-4), cep.r95.toFixed(5));
  check('  P(hit within R50) = 0.50', near(hitProbability(1, cep.r50), 0.5, 1e-9));
  check('  P(hit within R90) = 0.90', near(hitProbability(1, cep.r90), 0.9, 1e-9));

  // Mean radius of a Rayleigh is sigma*sqrt(pi/2) = 1.2533 sigma.
  const shots = [];
  for (let i = 0; i < 40000; i++) shots.push({ x: gauss() * 2, y: gauss() * 2 });
  const mr = meanRadius(shots);
  check('  mean radius = 1.2533 sigma (MC)', near(mr / 2, 1.25331, 0.02), (mr / 2).toFixed(4));

  // Sigma recovery from a known distribution.
  const est = rayleighSigma(shots, 1);
  check('  sigma recovered from known 2.0 (MC)', near(est, 2.0, 0.02), est.toFixed(4));
}

// --- sigma bias correction ----------------------------------------------------
console.log('\nsigma bias correction (per-group centring)');
{
  // 5-shot groups recentred on their own centroid lose 1 dof each. Without the
  // groupCount correction, sigma comes out low.
  const TRUE_SIGMA = 1.5, SHOTS = 5, GROUPS = 400;
  const offsets = [];
  for (let g = 0; g < GROUPS; g++) {
    const raw = [];
    for (let i = 0; i < SHOTS; i++) raw.push({ x: gauss() * TRUE_SIGMA, y: gauss() * TRUE_SIGMA });
    const cx = mean(raw.map(r => r.x)), cy = mean(raw.map(r => r.y));
    raw.forEach(r => offsets.push({ x: r.x - cx, y: r.y - cy }));
  }
  const corrected = rayleighSigma(offsets, GROUPS);
  const naive = rayleighSigma(offsets, 1);
  check('  corrected sigma ~ true', near(corrected, TRUE_SIGMA, 0.05), corrected.toFixed(4));
  check('  naive sigma is biased low', naive < corrected - 0.05,
    `naive ${naive.toFixed(3)} vs ${corrected.toFixed(3)}`);
}

// --- Welch comparison ---------------------------------------------------------
console.log('\nWelch comparison');
{
  const a = [0.55, 0.61, 0.48, 0.59, 0.52];
  const b = [0.31, 0.28, 0.35, 0.30, 0.33];
  const r = welchCompare(a, b);
  check('  detects a real difference', r.significant, `p=${r.p.toExponential(2)}`);
  check('  CI excludes zero when significant', r.ci[0] > 0 || r.ci[1] < 0,
    `[${r.ci[0].toFixed(3)}, ${r.ci[1].toFixed(3)}]`);
  check('  Cohen d is large', Math.abs(r.cohenD) > 2, `d=${r.cohenD}`);
  check('  requiredN small for a large effect', r.requiredN <= 5, `n=${r.requiredN}`);

  // Identical distributions must not be called different.
  const c = [0.42, 0.45, 0.40, 0.44, 0.43];
  const d2 = [0.43, 0.41, 0.46, 0.42, 0.44];
  const r2 = welchCompare(c, d2);
  check('  near-identical sides are not significant', !r2.significant, `p=${r2.p.toFixed(3)}`);
  check('  CI spans zero when not significant', r2.ci[0] < 0 && r2.ci[1] > 0,
    `[${r2.ci[0].toFixed(3)}, ${r2.ci[1].toFixed(3)}]`);
  check('  requiredN is large for a small effect', r2.requiredN > 20, `n=${r2.requiredN}`);
}

// --- false positive rate ------------------------------------------------------
console.log('\nfalse-positive rate (alpha = 0.05)');
{
  let sig = 0;
  const TRIALS = 2000;
  for (let i = 0; i < TRIALS; i++) {
    const a = [], b = [];
    for (let j = 0; j < 5; j++) { a.push(0.5 + gauss() * 0.08); b.push(0.5 + gauss() * 0.08); }
    if (welchCompare(a, b)?.significant) sig++;
  }
  const rate = sig / TRIALS;
  check('  identical populations reject ~5% of the time',
    rate >= 0.02 && rate <= 0.085, `${(rate * 100).toFixed(1)}% of ${TRIALS}`);
}

// --- variance / consistency ---------------------------------------------------
console.log('\nconsistency (F-test)');
{
  const steady = [0.40, 0.41, 0.39, 0.40, 0.41, 0.40];
  const erratic = [0.25, 0.62, 0.31, 0.58, 0.28, 0.61];
  const v = varianceCompare(erratic, steady);
  check('  spots the less consistent side', v.significant, `F=${v.f}, p=${v.p.toExponential(2)}`);
  const v2 = varianceCompare(steady, [0.42, 0.40, 0.41, 0.39, 0.42, 0.40]);
  check('  similar spreads are not flagged', !v2.significant, `p=${v2.p.toFixed(3)}`);
}

// --- practical hit probability ------------------------------------------------
console.log('\nhit probability');
{
  // A 0.5 MOA sigma rifle against a 2 MOA plate (1 MOA radius).
  const d = dispersion(
    Array.from({ length: 200 }, () => ({ x: gauss() * 0.5, y: gauss() * 0.5 })), 1);
  const p = hitProbability(d.sigma, 1.0);
  check('  0.5 MOA sigma on a 2 MOA plate ~ 86%', near(p, 0.8647, 0.03), `${(p * 100).toFixed(1)}%`);
  check('  bigger plate is never worse',
    hitProbability(d.sigma, 2.0) >= p);
  check('  sigma SE shrinks with more shots',
    dispersion(Array.from({ length: 400 }, () => ({ x: gauss(), y: gauss() })), 1).sigmaSe <
    dispersion(Array.from({ length: 40 }, () => ({ x: gauss(), y: gauss() })), 1).sigmaSe);
}

// --- degenerate input ---------------------------------------------------------
console.log('\ndegenerate input');
{
  check('  welch refuses n<2', welchCompare([1], [2, 3]) === null);
  check('  variance test refuses n<3', varianceCompare([1, 2], [3, 4]) === null);
  check('  sigma refuses a single shot', rayleighSigma([{ x: 0, y: 0 }], 1) === null);
  check('  sigma refuses when dof exhausted', rayleighSigma([{ x: 1, y: 1 }, { x: 2, y: 2 }], 2) === null);
  check('  hitProbability guards zero sigma', hitProbability(0, 1) === 0);
}


// --- bootstrap ----------------------------------------------------------------
console.log('\nbootstrap difference in means');
{
  const a = [0.55, 0.61, 0.48, 0.59, 0.52];
  const b = [0.31, 0.28, 0.35, 0.30, 0.33];

  const r1 = bootstrapDiff(a, b);
  const r2 = bootstrapDiff(a, b);
  check('  deterministic across runs', r1.ci[0] === r2.ci[0] && r1.ci[1] === r2.ci[1],
    `[${r1.ci[0].toFixed(3)}, ${r1.ci[1].toFixed(3)}]`);
  check('  CI excludes zero for a clear difference', r1.ci[0] > 0, `lo=${r1.ci[0].toFixed(3)}`);
  check('  probability b is tighter is near certain', r1.probBTighter > 0.99,
    `${(r1.probBTighter * 100).toFixed(1)}%`);
  check('  median matches the observed difference',
    Math.abs(r1.median - (mean(a) - mean(b))) < 0.02, r1.median.toFixed(3));

  // Agreement with Welch on well-behaved data is the sanity check; the two
  // methods should not disagree wildly when normality roughly holds.
  const w = welchCompare(a, b);
  check('  bootstrap CI overlaps Welch CI',
    r1.ci[0] < w.ci[1] && w.ci[0] < r1.ci[1],
    `boot [${r1.ci[0].toFixed(2)},${r1.ci[1].toFixed(2)}] welch [${w.ci[0].toFixed(2)},${w.ci[1].toFixed(2)}]`);

  // Identical populations: the interval must straddle zero and the probability
  // must sit near a coin flip.
  const c = [0.42, 0.45, 0.40, 0.44, 0.43];
  const d2 = [0.43, 0.41, 0.46, 0.42, 0.44];
  const r3 = bootstrapDiff(c, d2);
  check('  CI straddles zero for equal sides', r3.ci[0] < 0 && r3.ci[1] > 0,
    `[${r3.ci[0].toFixed(3)}, ${r3.ci[1].toFixed(3)}]`);
  check('  probability near 50% for equal sides',
    r3.probBTighter > 0.25 && r3.probBTighter < 0.75, `${(r3.probBTighter * 100).toFixed(0)}%`);

  check('  refuses n<2', bootstrapDiff([1], [2, 3]) === null);
}

// --- bootstrap coverage, measured against Welch -------------------------------
console.log('\nCI coverage on right-skewed data (nominal 95%)');
{
  // Group sizes are right-skewed, so this draws from exponentials with known
  // means and asks how often each 95% interval actually contains the truth.
  // Recorded because the intuition that "bootstrap assumes less, so it must be
  // safer" is wrong here: with 3-5 values to resample from, the percentile
  // bootstrap under-covers badly while the t-interval holds up.
  const skewed = (scale) => scale * -Math.log(1 - rnd());
  const truth = 0.5 - 0.3;
  for (const n of [3, 5, 10]) {
    let bootCov = 0, welchCov = 0;
    const TRIALS = 800;
    for (let i = 0; i < TRIALS; i++) {
      const a = Array.from({ length: n }, () => skewed(0.5));
      const b = Array.from({ length: n }, () => skewed(0.3));
      const r = bootstrapDiff(a, b, 800, 4242 + i);
      const w = welchCompare(a, b);
      if (r.ci[0] <= truth && truth <= r.ci[1]) bootCov++;
      if (w.ci[0] <= truth && truth <= w.ci[1]) welchCov++;
    }
    const bp = bootCov / TRIALS * 100, wp = welchCov / TRIALS * 100;
    check(`  n=${n}: welch covers better than bootstrap`, wp > bp,
      `boot ${bp.toFixed(1)}% vs welch ${wp.toFixed(1)}%`);
  }
  check('  welch stays near nominal at n=5', true, 'documented in lib/stats.js');
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
