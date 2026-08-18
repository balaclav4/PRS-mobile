/**
 * Reference-load confirmation — load dev step 8.
 *
 * Steps 1 through 7 pick a load. This step asks whether it actually meets the
 * goal set in step 1, at the distance that matters, and it exists because the
 * usual answer is arrived at wrongly.
 *
 * Two mistakes it is built to prevent:
 *
 *   1. Treating a run of hits as proof. Ten for ten feels conclusive and is
 *      not: the exact 95% lower bound on that is 74%. Confirming a 90% hit rate
 *      takes 29 consecutive hits, and 95% takes 59. This is the "rule of
 *      three" — with zero failures in n trials the plausible failure rate still
 *      runs to about 3/n.
 *
 *   2. Blaming dispersion for misses it did not cause. A load's group size
 *      predicts a hit rate. If the observed rate is far below that prediction
 *      the misses are not the load — they are wind calls, ranging, or position.
 *      Chasing them with more load development wastes components. If observed
 *      is far above prediction, the sample is too small to mean anything yet.
 */

import { hitProbability, incompleteBeta } from './stats.js';
import { esCoefficientOfVariation, normalQuantile } from './seating.js';

/**
 * Exact (Clopper-Pearson) one-sided lower confidence bound on a hit rate.
 *
 * Wilson is the better interval to display, but it is anti-conservative at the
 * boundary this module cares most about. For a clean run its lower bound
 * collapses to n/(n+z^2), which said 25 straight hits confirm 90% when the
 * exact answer is 29 — it would send a shooter home four rounds early from the
 * one test built to stop exactly that. Clopper-Pearson inverts the binomial
 * directly and is guaranteed to hold its nominal coverage, so it is what the
 * pass/fail runs on.
 *
 * Solves I_L(k, n-k+1) = alpha by bisection. For k = n this reduces to
 * L = alpha^(1/n), the familiar rule of three.
 */
export function exactLowerBound(hits, shots, conf = 0.95) {
  const n = Number(shots), k = Number(hits);
  if (!(n > 0) || !(k >= 0) || k > n) return null;
  if (k === 0) return 0;
  const alpha = 1 - conf;
  if (k === n) return Math.pow(alpha, 1 / n);
  let lo = 0, hi = k / n;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (incompleteBeta(mid, k, n - k + 1) > alpha) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Wilson score interval for a binomial proportion.
 *
 * The textbook p ± z*sqrt(p(1-p)/n) is unusable here: at 10 hits from 10 shots
 * it returns [1, 1], claiming certainty from a sample that plainly cannot
 * support it. Wilson stays inside [0,1] and keeps its width at the extremes,
 * which is exactly the regime a confirmation run lives in.
 *
 * Used for the range shown to the user. The pass/fail runs on
 * `exactLowerBound` instead — see the note there.
 */
export function wilsonInterval(hits, shots, conf = 0.95, oneSided = false) {
  const n = Number(shots), k = Number(hits);
  if (!(n > 0) || !(k >= 0) || k > n) return null;
  // A two-sided interval is the right thing to *display* — it answers "what
  // range fits this data". But "have I reached 90%?" only looks downward, and
  // reading the lower end of a two-sided 95% interval is really a 97.5% bound
  // wearing a 95% label. That mismatch put the rule of three at 35 shots
  // instead of the correct 29, so confirmation uses the one-sided bound.
  const z = oneSided ? normalQuantile(conf) : normalQuantile(1 - (1 - conf) / 2);
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
  return {
    point: p,
    low: Math.max(0, centre - half),
    high: Math.min(1, centre + half),
  };
}

/**
 * Fewest consecutive hits needed before the lower bound clears `targetRate`.
 *
 * This is the number that turns "it felt good" into a plan. Confirming 90% at
 * 95% confidence takes 29 straight hits; confirming 95% takes 59.
 */
export function shotsNeededFor(targetRate, conf = 0.95) {
  const t = Number(targetRate);
  if (!(t > 0) || t >= 1) return null;
  for (let n = 1; n <= 2000; n++) {
    if (exactLowerBound(n, n, conf) >= t) return n;
  }
  return null;
}

/**
 * Hit rate the load's own dispersion predicts, for a circular target of
 * `targetMoa` diameter.
 *
 * Group size is converted to a Rayleigh sigma through the extreme-spread
 * relationship rather than measured from shot coordinates, because at step 8 a
 * shooter has a group size written down, not a plotted target. The divisor is
 * the expected extreme spread of an n-shot group in units of sigma.
 */
const ES_OVER_SIGMA = [
  [2, 1.77], [3, 2.41], [4, 2.78], [5, 3.06], [6, 3.26],
  [7, 3.43], [8, 3.57], [9, 3.69], [10, 3.79], [15, 4.18], [20, 4.44],
];

export function sigmaFromGroup(groupMoa, shots) {
  const g = Number(groupMoa), n = Number(shots);
  if (!(g > 0) || !(n >= 2)) return null;
  let ratio;
  if (n <= ES_OVER_SIGMA[0][0]) ratio = ES_OVER_SIGMA[0][1];
  else if (n >= ES_OVER_SIGMA[ES_OVER_SIGMA.length - 1][0]) {
    ratio = ES_OVER_SIGMA[ES_OVER_SIGMA.length - 1][1];
  } else {
    for (let i = 1; i < ES_OVER_SIGMA.length; i++) {
      const [n1, r1] = ES_OVER_SIGMA[i];
      if (n <= n1) {
        const [n0, r0] = ES_OVER_SIGMA[i - 1];
        ratio = r0 + (r1 - r0) * (n - n0) / (n1 - n0);
        break;
      }
    }
  }
  return g / ratio;
}

/**
 * Assess a confirmation run against the project goal.
 *
 * @param hits         shots that struck the target
 * @param shots        shots fired
 * @param groupMoa     group size from the confirmation run (optional)
 * @param groupShots   shots in that group
 * @param targetMoa    target diameter in MOA at the confirmation distance
 * @param goalMoa      the accuracy goal from step 1
 * @param hitRatePct   the hit-rate goal from step 1
 */
export function assessReference(opts = {}) {
  const N = (v) => { const n = Number(v); return isFinite(n) ? n : null; };
  const shots = N(opts.shots), hits = N(opts.hits);
  const goalMoa = N(opts.goalMoa);
  const targetRate = N(opts.hitRatePct) != null ? N(opts.hitRatePct) / 100 : null;
  const groupMoa = N(opts.groupMoa);
  const groupShots = N(opts.groupShots) || 5;
  const targetMoa = N(opts.targetMoa);
  const unit = opts.unit || 'MOA';

  if (!(shots > 0) || hits == null || hits > shots) {
    return { ok: false, reason: 'Record how many shots you fired and how many hit.' };
  }

  // Two-sided for the range shown to the user, one-sided for the pass/fail.
  const ci = wilsonInterval(hits, shots, 0.95);
  const exactLow = exactLowerBound(hits, shots, 0.95);
  const observed = ci.point;

  // Accuracy against the step 1 goal, judged with the same measurement-noise
  // model the seating step uses. A single group cannot resolve a goal it misses
  // by less than its own noise.
  let accuracy = null;
  if (groupMoa != null && goalMoa != null && goalMoa > 0) {
    const cv = esCoefficientOfVariation(groupShots) ?? 0.27;
    const sigmaG = groupMoa * cv;
    const marginSigma = sigmaG > 0 ? (goalMoa - groupMoa) / sigmaG : 0;
    accuracy = {
      groupMoa, goalMoa, shots: groupShots,
      noiseMoa: +sigmaG.toFixed(3),
      marginSigma: +marginSigma.toFixed(2),
      // Only claim the goal is met when the group clears it by more than the
      // group's own run-to-run variation.
      meets: marginSigma >= 1,
      // And only claim it is missed when it misses by the same margin.
      misses: marginSigma <= -1,
    };
  }

  // Hit rate against the step 1 target, judged on the lower bound rather than
  // the point estimate.
  let hitRate = null;
  if (targetRate != null) {
    const needed = shotsNeededFor(targetRate, 0.95);
    hitRate = {
      observed: +(observed * 100).toFixed(1),
      low: +(exactLow * 100).toFixed(1),
      range: [+(ci.low * 100).toFixed(1), +(ci.high * 100).toFixed(1)],
      high: +(ci.high * 100).toFixed(1),
      target: +(targetRate * 100).toFixed(1),
      confirmed: exactLow >= targetRate,
      // What a clean run would take, and how much further this one has to go.
      cleanRunNeeded: needed,
      moreNeeded: needed != null && hits === shots ? Math.max(0, needed - shots) : null,
    };
  }

  // Do the misses look like dispersion, or like something else?
  let diagnosis = null;
  const sigma = sigmaFromGroup(groupMoa, groupShots);
  if (sigma != null && targetMoa != null && targetMoa > 0) {
    const predicted = hitProbability(sigma, targetMoa / 2);
    // A 0.5 MOA load on a 2 MOA target predicts a hit probability of
    // 0.9999999925, whose binomial standard error is so small that going 6/12
    // scored z = -20189. Correct, and useless to read. Floor the variance at
    // the half-shot resolution the sample can actually distinguish.
    const pClamped = Math.min(1 - 1 / (2 * shots), Math.max(1 / (2 * shots), predicted));
    const se = Math.sqrt(pClamped * (1 - pClamped) / shots);
    const z = se > 0 ? (observed - predicted) / se : 0;
    diagnosis = {
      predicted: +(predicted * 100).toFixed(1),
      observed: +(observed * 100).toFixed(1),
      z: +z.toFixed(2),
      // A large shortfall means the load is not what is costing the hits.
      shortfall: z <= -2,
      matches: Math.abs(z) < 2,
    };
  }

  const parts = [];
  if (hitRate) {
    if (hitRate.confirmed) {
      parts.push(`${hits}/${shots} confirms ${hitRate.target}% — the 95% lower bound is ${hitRate.low}%.`);
    } else if (hits === shots) {
      parts.push(`${hits}/${shots} with no misses still only puts the lower bound at ${hitRate.low}%. Confirming ${hitRate.target}% takes ${hitRate.cleanRunNeeded} straight hits; you need ${hitRate.moreNeeded} more.`);
    } else {
      // `low` is the exact one-sided bound used for pass/fail; splicing it onto
      // the Wilson upper end would print a range that is neither interval.
      // A displayed range has to come from one interval.
      parts.push(`${hits}/${shots} is ${hitRate.observed}%, but the range that fits is ${hitRate.range[0]}–${hitRate.range[1]}%. That does not yet reach ${hitRate.target}%.`);
    }
  }
  if (accuracy) {
    if (accuracy.meets) parts.push(`${groupMoa} ${unit} clears the ${goalMoa} ${unit} goal by ${accuracy.marginSigma} sigma.`);
    else if (accuracy.misses) parts.push(`${groupMoa} ${unit} misses the ${goalMoa} ${unit} goal by ${Math.abs(accuracy.marginSigma)} sigma.`);
    else parts.push(`${groupMoa} ${unit} against a ${goalMoa} ${unit} goal is inside this group's own ±${accuracy.noiseMoa} ${unit} noise — it neither confirms nor rules out the goal.`);
  }
  if (diagnosis?.shortfall) {
    parts.push(`Dispersion alone predicts ${diagnosis.predicted}% on this target, well above the ${diagnosis.observed}% you shot. The misses are wind, range or position — not the load.`);
  }

  return {
    ok: true,
    hits, shots,
    ci: { low: +(ci.low * 100).toFixed(1), high: +(ci.high * 100).toFixed(1) },
    accuracy, hitRate, diagnosis,
    verdict: parts.join(' ') || `${hits}/${shots}. Set a goal in step 1 to judge it against.`,
  };
}
