/**
 * Statistics for comparing precision.
 *
 * Two different questions get two different units of replication, and conflating
 * them is the usual way shooting statistics go wrong:
 *
 *   "Does load A shoot smaller groups than B?"  -> the GROUP is the unit.
 *      Group sizes from the same target are one observation. Pooling raw shots
 *      here would inflate n several-fold and manufacture significance.
 *
 *   "How tightly does this rifle disperse shots?" -> the SHOT is the unit.
 *      Sigma is a property of the shot distribution, so every shot offset from
 *      its own target's centre is a legitimate independent sample.
 *
 * Extreme spread — the number everyone quotes — is also a poor statistic: it
 * uses only the two worst shots and its variance grows with shot count, so a
 * 10-shot group is expected to measure larger than a 5-shot group from the same
 * rifle. Mean radius and the Rayleigh sigma below use every shot, so they are
 * far more efficient and comparable across differing shot counts.
 */

// ---------------------------------------------------------------------------
// Distributions
// ---------------------------------------------------------------------------

/** Continued-fraction expansion for the incomplete beta (Lentz's method). */
function betacf(a, b, x) {
  const MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function logGamma(z) {
  // Lanczos approximation.
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) x += g[i] / (z + i + 1);
  const t = z + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Regularised lower incomplete gamma P(a, x), by series below the crossover and
 * continued fraction above it. Needed for exact chi-square quantiles, which the
 * primer step uses to put a confidence interval on a standard deviation.
 *
 * The Wilson-Hilferty approximation it replaced is off by 3.7% in the upper tail
 * at df = 4 — precisely the five-shot string the primer comparison exists to
 * talk about.
 */
export function incompleteGamma(a, x) {
  if (x < 0 || a <= 0) return NaN;
  if (x === 0) return 0;
  if (x < a + 1) {
    // Series representation.
    let ap = a, sum = 1 / a, del = sum;
    for (let i = 0; i < 500; i++) {
      ap++; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  // Continued fraction for the complement.
  const TINY = 1e-300;
  let b = x + 1 - a, c = 1 / TINY, d = 1 / b, h = d;
  for (let i = 1; i <= 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** Chi-square quantile: the x with P(X <= x) = p for `df` degrees of freedom. */
export function chiSquareQuantile(p, df) {
  if (!(p > 0) || !(p < 1) || !(df > 0)) return NaN;
  let lo = 0, hi = Math.max(10, df * 10);
  while (incompleteGamma(df / 2, hi / 2) < p && hi < 1e8) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (incompleteGamma(df / 2, mid / 2) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Regularised incomplete beta I_x(a,b). */
export function incompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) +
    a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2)
    ? front * betacf(a, b, x) / a
    : 1 - front * betacf(b, a, 1 - x) / b;
}

/** Two-tailed p-value for Student's t. */
export function tTestP(t, df) {
  if (!isFinite(t) || !isFinite(df) || df <= 0) return null;
  return incompleteBeta(df / (df + t * t), df / 2, 0.5);
}

/** Critical two-tailed t for a given confidence, by bisection on the CDF. */
export function tCritical(df, conf = 0.95) {
  const target = 1 - conf;
  let lo = 0, hi = 100;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tTestP(mid, df) > target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Two-tailed p for an F variance ratio. */
export function fTestP(f, df1, df2) {
  if (!isFinite(f) || f <= 0) return null;
  const cdf = incompleteBeta(df1 * f / (df1 * f + df2), df1 / 2, df2 / 2);
  return 2 * Math.min(cdf, 1 - cdf);
}

// ---------------------------------------------------------------------------
// Descriptives
// ---------------------------------------------------------------------------

export const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

export function sd(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
}

// ---------------------------------------------------------------------------
// Group-level comparison (unit = group)
// ---------------------------------------------------------------------------

/**
 * Welch's t-test plus the things a p-value alone won't tell you: how big the
 * difference is, how uncertain it is, and how many groups you'd need to settle
 * it.
 */
export function welchCompare(a, b, conf = 0.95) {
  if (a.length < 2 || b.length < 2) return null;

  const ma = mean(a), mb = mean(b);
  const va = sd(a) ** 2, vb = sd(b) ** 2;
  const na = a.length, nb = b.length;

  const se = Math.sqrt(va / na + vb / nb);
  if (se === 0) return null;

  const t = (ma - mb) / se;
  const df = (va / na + vb / nb) ** 2 /
    ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1));
  const p = tTestP(t, df);

  const tCrit = tCritical(df, conf);
  const diff = ma - mb;
  const ci = [diff - tCrit * se, diff + tCrit * se];

  // Cohen's d on the pooled SD — the standardised size of the difference.
  const pooledSd = Math.sqrt(((na - 1) * va + (nb - 1) * vb) / (na + nb - 2));
  const d = pooledSd > 0 ? diff / pooledSd : 0;

  return {
    meanA: ma, meanB: mb, sdA: Math.sqrt(va), sdB: Math.sqrt(vb), nA: na, nB: nb,
    diff, ci, t: +t.toFixed(3), df: +df.toFixed(1), p,
    significant: p != null && p < 1 - conf,
    cohenD: +d.toFixed(3),
    // Groups per side needed for 80% power at alpha=.05, normal approximation.
    requiredN: Math.abs(d) > 1e-6 ? Math.ceil(15.7 / (d * d)) : null,
  };
}

/**
 * Bootstrap resampling of the difference in means.
 *
 * This was added on the assumption that resampling would give a better
 * interval than Welch's on right-skewed group sizes, since it assumes no
 * distribution. Measured against a known truth on exponential data, that is
 * false at the sample sizes this app sees:
 *
 *     n=3   bootstrap 76.3%   welch 95.9%     (nominal 95%)
 *     n=5   bootstrap 85.7%   welch 95.1%
 *     n=10  bootstrap 89.7%   welch 93.9%
 *
 * The percentile bootstrap under-covers badly with few values to resample
 * from, while the t-interval's heavy tails absorb the skew. So Welch's CI
 * stays the interval shown, and this is kept only for probBTighter — a plain
 * "how sure am I that B is better" reading that a p-value does not give. Treat
 * that number as directional, not as a calibrated probability.
 *
 * Deterministic by design: a seeded generator means the same data always gives
 * the same answer. A figure that flickered between viewings would be worse
 * than none.
 */
export function bootstrapDiff(a, b, iterations = 4000, seed = 0x2F6E2B1) {
  if (a.length < 2 || b.length < 2) return null;

  let s = seed >>> 0;
  const rnd = () => {
    // mulberry32 — cheap, well-distributed, and reproducible.
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const resampleMean = (arr) => {
    let sum = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[(rnd() * arr.length) | 0];
    return sum / arr.length;
  };

  const diffs = new Float64Array(iterations);
  let bTighter = 0;
  for (let i = 0; i < iterations; i++) {
    const d = resampleMean(a) - resampleMean(b);
    diffs[i] = d;
    if (d > 0) bTighter++;
  }
  diffs.sort();

  const at = (q) => diffs[Math.min(iterations - 1, Math.max(0, Math.floor(q * iterations)))];
  return {
    ci: [at(0.025), at(0.975)],
    median: at(0.5),
    // Fraction of resamples where b came out tighter — reads directly as
    // "how confident am I that b really is better", which a p-value does not.
    probBTighter: bTighter / iterations,
    iterations,
  };
}

/** F-test for whether one side is more *consistent*, not just smaller. */
export function varianceCompare(a, b) {
  if (a.length < 3 || b.length < 3) return null;
  const va = sd(a) ** 2, vb = sd(b) ** 2;
  if (va === 0 || vb === 0) return null;
  const f = va / vb;
  const p = fTestP(f, a.length - 1, b.length - 1);
  return { f: +f.toFixed(3), p, significant: p != null && p < 0.05 };
}

// ---------------------------------------------------------------------------
// Shot-level dispersion (unit = shot)
// ---------------------------------------------------------------------------

/**
 * Rayleigh sigma from shot offsets, by maximum likelihood.
 *
 * offsets are per-shot displacements from their own target's centroid, so each
 * target contributes its own recentred shots. The 2(n-k) denominator corrects
 * for the k centroids having been estimated from the same data — without it
 * sigma comes out biased low.
 */
export function rayleighSigma(offsets, groupCount = 1) {
  const n = offsets.length;
  if (n < 2) return null;
  const ss = offsets.reduce((a, o) => a + o.x * o.x + o.y * o.y, 0);
  const dof = 2 * (n - groupCount);
  if (dof <= 0) return null;
  return Math.sqrt(ss / dof);
}

/** Circular error probable radii: the circle containing p of all shots. */
export function cepRadii(sigma) {
  if (!sigma) return null;
  return {
    r50: sigma * Math.sqrt(-2 * Math.log(0.5)),
    r90: sigma * Math.sqrt(-2 * Math.log(0.10)),
    r95: sigma * Math.sqrt(-2 * Math.log(0.05)),
  };
}

/** Probability a shot lands within `radius` of point of aim. */
export function hitProbability(sigma, radius) {
  if (!sigma || sigma <= 0 || radius <= 0) return 0;
  return 1 - Math.exp(-(radius * radius) / (2 * sigma * sigma));
}

/** Mean radius — the average distance from centre. Uses every shot. */
export function meanRadius(offsets) {
  if (!offsets.length) return null;
  return mean(offsets.map(o => Math.hypot(o.x, o.y)));
}

/**
 * Full dispersion picture for one side of a comparison.
 * `offsets` in MOA, recentred per target; `groupCount` is how many targets.
 */
export function dispersion(offsets, groupCount) {
  const sigma = rayleighSigma(offsets, groupCount);
  if (sigma == null) return null;
  const cep = cepRadii(sigma);
  return {
    n: offsets.length,
    sigma,
    meanRadius: meanRadius(offsets),
    ...cep,
    // Sigma's own uncertainty: SE ~ sigma / sqrt(2(n-k)).
    sigmaSe: sigma / Math.sqrt(2 * Math.max(1, offsets.length - groupCount)),
  };
}
