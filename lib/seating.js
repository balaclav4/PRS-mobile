/**
 * Seating-depth test analysis.
 *
 * The usual method is to load a few rounds at each of several seating depths,
 * shoot one group per depth, and adopt whichever shot smallest. That procedure
 * will always produce a winner, which is exactly the problem: the smallest of
 * several groups is expected to be noticeably smaller than the others even when
 * every depth shoots identically.
 *
 * Two effects combine, and this module quantifies both:
 *
 *   1. A single group size is a poor measurement. Extreme spread uses only the
 *      two worst shots, so a 5-shot group has a relative standard deviation
 *      around 27% — a rifle that truly averages 0.50" will routinely produce
 *      groups from 0.35" to 0.65" with nothing changed.
 *
 *   2. Taking the best of k tries biases the result downward. With 5 depths
 *      tested, the winner is expected to land about 1.16 standard deviations
 *      below the mean by chance alone.
 *
 * So the question is never "which depth won" but "did the winner beat what
 * chance would have handed me anyway".
 */

/**
 * Relative standard deviation of extreme spread for an n-shot group, from the
 * order statistics of a circular normal (Rayleigh) impact distribution.
 *
 * Interpolated between tabulated values; this is why 3-shot groups are nearly
 * useless for comparing loads and 10-shot groups are merely noisy.
 */
const ES_CV = [
  [2, 0.523], [3, 0.359], [4, 0.305], [5, 0.271], [6, 0.248],
  [7, 0.231], [8, 0.219], [9, 0.209], [10, 0.201], [15, 0.175], [20, 0.160],
];

export function esCoefficientOfVariation(n) {
  if (!(n >= 2)) return null;
  if (n <= ES_CV[0][0]) return ES_CV[0][1];
  const last = ES_CV[ES_CV.length - 1];
  if (n >= last[0]) return last[1];
  for (let i = 1; i < ES_CV.length; i++) {
    const [n1, c1] = ES_CV[i];
    if (n <= n1) {
      const [n0, c0] = ES_CV[i - 1];
      return c0 + (c1 - c0) * (n - n0) / (n1 - n0);
    }
  }
  return last[1];
}

/** Inverse standard normal CDF (Acklam's rational approximation). */
export function normalQuantile(p) {
  if (p <= 0 || p >= 1) return NaN;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
    1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
    6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
    -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
    3.754408661907416e+00];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > pHigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * How far below the mean the best of k samples is expected to fall, in standard
 * deviations. Blom's approximation to the expected first order statistic.
 *
 * This is the number that makes a seating ladder honest: it is what you would
 * "win" by testing k depths that are all identical.
 */
export function expectedBestZ(k) {
  if (!(k >= 2)) return 0;
  return normalQuantile((1 - 0.375) / (k + 0.25));
}

/** Clean UI rows into numeric depths. */
export function parseDepths(rows) {
  return (rows || [])
    .map(r => ({
      id: r.id,
      cbto: parseFloat(r.cbto),
      groupMoa: r.groupMoa === '' || r.groupMoa == null ? null : parseFloat(r.groupMoa),
      shots: parseInt(r.shots, 10) || null,
    }))
    .filter(r => isFinite(r.cbto) && r.groupMoa != null && isFinite(r.groupMoa))
    .sort((a, b) => a.cbto - b.cbto);
}

/**
 * Decide whether the best-shooting depth is distinguishable from chance.
 *
 * @param depths        parsed rows
 * @param shotsPerGroup shots fired at each depth
 */
export function analyseSeating(depths, shotsPerGroup = 5, unit = 'MOA') {
  if (!depths || depths.length < 3) {
    return { best: null, reason: 'Need at least 3 depths with a group size recorded.' };
  }

  // Arrives from a TextInput as a string. Comparisons coerce, but `n * 2` in the
  // suggested-shots line would concatenate — the same class of bug that once hung
  // the ballistics range loop.
  const n = Number(shotsPerGroup);
  shotsPerGroup = isFinite(n) && n >= 2 ? n : 5;

  const k = depths.length;
  const sizes = depths.map(d => d.groupMoa);
  const mean = sizes.reduce((a, b) => a + b, 0) / k;
  const best = depths.reduce((a, b) => (b.groupMoa < a.groupMoa ? b : a));
  const worst = depths.reduce((a, b) => (b.groupMoa > a.groupMoa ? b : a));

  // The reference level has to come from a statistic the winner cannot drag
  // down, or a genuinely excellent depth lowers the very bar it is being asked
  // to clear. Measured: 0.21 against four groups near 0.50 failed the test when
  // the mean was the reference, because the 0.21 pulled the mean to 0.44. The
  // median moves by at most one rank no matter how good the winner is.
  const sorted = [...sizes].sort((a, b) => a - b);
  const level = k % 2
    ? sorted[(k - 1) / 2]
    : (sorted[k / 2 - 1] + sorted[k / 2]) / 2;

  const cv = esCoefficientOfVariation(shotsPerGroup) ?? 0.27;
  // Spread expected from group-to-group variation alone at this shot count.
  const sigma = level * cv;

  // Where the winner would be expected to land if every depth were identical.
  const zBest = expectedBestZ(k);
  const expectedBestByChance = level + zBest * sigma;

  // How far the observed winner beat that expectation, in sigmas.
  const margin = sigma > 0 ? (expectedBestByChance - best.groupMoa) / sigma : 0;
  const significant = margin >= 1;

  return {
    best,
    worst,
    mean: +mean.toFixed(3),
    level: +level.toFixed(3),
    sigma: +sigma.toFixed(3),
    cv: +cv.toFixed(3),
    expectedBestByChance: +expectedBestByChance.toFixed(3),
    margin: +margin.toFixed(2),
    significant,
    shotsPerGroup,
    // Group count per depth that would make a difference this size detectable.
    suggestedShots: significant ? null : Math.min(20, Math.max(8, shotsPerGroup * 2)),
    verdict: significant
      ? `${best.cbto}" is genuinely tighter — it beat the best-of-${k} expectation by ${margin.toFixed(1)} sigma.`
      : `${best.cbto}" shot smallest, but testing ${k} depths at ${shotsPerGroup} shots would produce a winner near ${expectedBestByChance.toFixed(2)} ${unit} by chance alone. This result is within that. Shoot ${Math.min(20, Math.max(8, shotsPerGroup * 2))}+ per depth, or treat the depths as equivalent and pick on feed and pressure.`,
  };
}
