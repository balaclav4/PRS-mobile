/**
 * Primer comparison — load dev step 5.
 *
 * The test is always the same: load identical rounds behind two or three primer
 * brands, chronograph a string of each, and adopt whichever gave the lowest
 * standard deviation. The trouble is that a standard deviation from a five-shot
 * string is one of the least stable numbers in reloading, and the differences
 * being chased are small.
 *
 * A sample SD from n shots has a sampling distribution of its own. At n = 5 the
 * measurement spans 0.60x to 2.87x the truth at 95%, so a rifle that genuinely
 * holds 12 fps will hand you strings reading 7 and 34 with nothing changed.
 * Comparing two such numbers by eye is not a measurement.
 *
 * The F-test says how much separation is needed before a difference is real.
 * With two five-shot strings the SD ratio has to exceed 3.10x — the gap between
 * 12 fps and 37 fps. Almost no primer comparison ever run has produced
 * that, which is why this module's most common honest answer is that the
 * brands are indistinguishable and the choice should be made on availability,
 * fit and consistency of supply.
 */

import { sd, varianceCompare, fTestP, chiSquareQuantile } from './stats.js';

/** Clean UI rows into { brand, velocities[] }, dropping anything unusable. */
export function parseStrings(rows) {
  return (rows || [])
    .map(r => ({
      id: r.id,
      brand: (r.brand || '').trim(),
      velocities: String(r.velocities || '')
        .split(/[\s,;]+/)
        .map(v => parseFloat(v))
        .filter(v => isFinite(v) && v > 0),
    }))
    .filter(r => r.brand && r.velocities.length >= 3);
}

/**
 * Smallest SD ratio that an F-test would call significant at these string
 * lengths. This is the number that tells a shooter whether the test they are
 * about to run can possibly answer the question.
 */
export function detectableRatio(nA, nB, alpha = 0.05) {
  if (!(nA >= 3) || !(nB >= 3)) return null;
  // Bisect on the variance ratio until the two-tailed p crosses alpha.
  let lo = 1, hi = 100;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const p = fTestP(mid, nA - 1, nB - 1);
    if (p != null && p < alpha) hi = mid; else lo = mid;
  }
  return Math.sqrt((lo + hi) / 2);
}

/**
 * String length at which a given SD ratio becomes detectable, assuming equal
 * string lengths. Answers "how many more do I need to shoot".
 */
export function shotsToDetect(ratio, alpha = 0.05, cap = 200) {
  const r = Number(ratio);
  if (!(r > 1)) return null;
  for (let n = 3; n <= cap; n++) {
    const need = detectableRatio(n, n, alpha);
    if (need != null && need <= r) return n;
  }
  return null;
}

/**
 * 95% confidence interval for a standard deviation from n shots, via the
 * chi-square distribution.
 *
 * Shown because it is the fact that settles most primer arguments on its own:
 * once a shooter sees that their 12 fps string is consistent with anything from
 * 7 to 34, the ranking of three brands stops looking like a result.
 */
export function sdInterval(sample, conf = 0.95) {
  const n = sample.length;
  if (n < 2) return null;
  const s = sd(sample);
  const df = n - 1;
  // Exact chi-square quantiles. Wilson-Hilferty was 3.7% high in the upper tail
  // at df = 4, which is the five-shot string this whole module is about.
  const alpha = 1 - conf;
  const chiHigh = chiSquareQuantile(1 - alpha / 2, df);
  const chiLow = chiSquareQuantile(alpha / 2, df);
  if (!(chiLow > 0) || !(chiHigh > 0)) return null;
  return {
    sd: s,
    low: s * Math.sqrt(df / chiHigh),
    high: s * Math.sqrt(df / chiLow),
  };
}

/**
 * Compare primer brands on velocity consistency.
 *
 * Ranks by SD, then asks whether the winner is separated from the runner-up by
 * more than the F-test can attribute to chance.
 */
export function comparePrimers(strings, unit = 'fps') {
  if (!strings || strings.length < 2) {
    return { best: null, reason: 'Add at least two primer brands with 3+ velocities each.' };
  }

  const rows = strings.map(s => {
    const ci = sdInterval(s.velocities);
    const vs = s.velocities;
    return {
      id: s.id,
      brand: s.brand,
      n: vs.length,
      mean: +(vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(1),
      sd: +sd(vs).toFixed(1),
      es: +(Math.max(...vs) - Math.min(...vs)).toFixed(1),
      sdLow: ci ? +ci.low.toFixed(1) : null,
      sdHigh: ci ? +ci.high.toFixed(1) : null,
    };
  }).sort((a, b) => a.sd - b.sd);

  const best = rows[0], runnerUp = rows[1];
  const bestSample = strings.find(s => s.id === best.id).velocities;
  const runnerSample = strings.find(s => s.id === runnerUp.id).velocities;

  const test = varianceCompare(runnerSample, bestSample);
  const observedRatio = best.sd > 0 ? runnerUp.sd / best.sd : null;
  const needed = detectableRatio(runnerUp.n, best.n);
  const significant = !!(test && test.significant);

  // If it is not significant, how long a string would settle it at the observed
  // separation? Null when the brands are so close that no practical string will.
  const wouldNeed = significant || observedRatio == null || observedRatio <= 1
    ? null
    : shotsToDetect(observedRatio);

  let verdict;
  if (significant) {
    verdict = `${best.brand} is genuinely more consistent — ${best.sd} ${unit} against ${runnerUp.brand}'s ${runnerUp.sd} ${unit}, a ratio the F-test puts at p = ${test.p.toFixed(3)}.`;
  } else {
    const detail = `At ${best.n} and ${runnerUp.n} shots, one string has to be ${needed.toFixed(1)}x the other before the difference means anything, and these differ by ${observedRatio ? observedRatio.toFixed(2) : '1.00'}x.`;
    const advice = wouldNeed
      ? ` Settling this at the separation you measured would take about ${wouldNeed} shots per brand.`
      : ` No practical string length will separate them.`;
    verdict = `${best.brand} measured lowest at ${best.sd} ${unit}, but that is not a result. ${detail}${advice} Pick on availability, fit and supply.`;
  }

  return {
    rows,
    best,
    runnerUp,
    significant,
    p: test ? test.p : null,
    observedRatio: observedRatio ? +observedRatio.toFixed(2) : null,
    neededRatio: needed ? +needed.toFixed(2) : null,
    wouldNeed,
    verdict,
  };
}
