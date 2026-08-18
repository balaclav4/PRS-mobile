/**
 * Scope field evaluation — tracking, return to zero, and whether the test you
 * ran could have detected the fault you are looking for.
 *
 * The protocol is well known: shoot a baseline group, dial a known amount, shoot
 * again, and check the group moved by what you dialled. Repeat after running the
 * turret through thousands of mils of travel and confirm it returns to zero.
 *
 * What the protocol usually leaves out is that every one of those measurements
 * is a difference between two group centres, and a group centre is not a point.
 * With five shots from a 1 MOA rifle each centre is known to about ±0.4", so
 * their difference carries ±0.55" — on an 18" dial that is ±3%. A shooter who
 * dials 18", measures 17.6" and concludes the scope tracks 2% slow has measured
 * nothing: the result is inside the noise of their own test.
 *
 * So this module answers two questions rather than one. What was the tracking
 * error, and could this test have seen it. It refuses to call a scope bad on a
 * test that could not have proved it, and it says how many shots would.
 *
 * Everything here is the shooter's own measurement. There are no manufacturer
 * claims and no reliability scores.
 */

import { normalQuantile } from './seating.js';

/**
 * Standard error of a single group's centre, per axis, in the same units as
 * sigma.
 *
 * A tracking test measures movement along one axis, so the per-axis error is
 * what matters — not the radial circle used when reporting point of impact.
 */
export function centreSe(sigma, shots) {
  const s = Number(sigma), n = Number(shots);
  if (!(s > 0) || !(n >= 1)) return null;
  return s / Math.sqrt(n);
}

/**
 * Uncertainty in a measured displacement between two groups, at 95%.
 *
 * Two independent centres, so the variances add and the standard error grows by
 * sqrt(2). This is the number that decides whether a tracking test means
 * anything.
 */
export function displacementCi95(sigma, shotsA, shotsB = shotsA) {
  const a = centreSe(sigma, shotsA), b = centreSe(sigma, shotsB);
  if (a == null || b == null) return null;
  return normalQuantile(0.975) * Math.sqrt(a * a + b * b);
}

/**
 * A single tracking step: dial a known amount, measure how far the group moved.
 *
 * @param dialled   what the turret was moved, in inches at the test distance
 * @param measured  how far the group centre actually moved, in inches
 * @param sigma     the rifle's per-axis dispersion sigma, in inches
 * @param shots     shots in each group
 */
export function trackingStep({ dialled, measured, sigma, shots }) {
  const d = Number(dialled), m = Number(measured);
  const sg = Number(sigma), n = Number(shots);
  if (!(d > 0) || !isFinite(m)) {
    return { ok: false, reason: 'Enter what you dialled and how far the group moved.' };
  }

  const errorIn = m - d;
  const errorPct = (errorIn / d) * 100;

  // Without a dispersion estimate the error can be reported but not judged.
  const ci = sg > 0 && n >= 1 ? displacementCi95(sg, n) : null;
  const ciPct = ci != null ? (ci / d) * 100 : null;
  // Real only when the discrepancy exceeds what the measurement itself can
  // resolve.
  const resolved = ci != null ? Math.abs(errorIn) > ci : null;

  let verdict;
  if (ci == null) {
    verdict = `Moved ${m.toFixed(2)}" for ${d.toFixed(2)}" dialled — ${errorPct >= 0 ? '+' : ''}${errorPct.toFixed(1)}%. Record your group size to know whether that is a real error or measurement noise.`;
  } else if (resolved) {
    verdict = `Tracking is ${errorPct >= 0 ? 'over' : 'under'} by ${Math.abs(errorPct).toFixed(1)}% — moved ${m.toFixed(2)}" for ${d.toFixed(2)}" dialled. That exceeds the ±${ciPct.toFixed(1)}% this test can resolve, so it is a real error.`;
  } else {
    verdict = `Moved ${m.toFixed(2)}" for ${d.toFixed(2)}" dialled, a ${errorPct >= 0 ? '+' : ''}${errorPct.toFixed(1)}% difference. This test resolves ±${ciPct.toFixed(1)}%, so that is indistinguishable from zero error. Nothing here condemns the scope.`;
  }

  return {
    ok: true,
    dialled: d,
    measured: m,
    errorIn: +errorIn.toFixed(3),
    errorPct: +errorPct.toFixed(2),
    ci95In: ci == null ? null : +ci.toFixed(3),
    ci95Pct: ciPct == null ? null : +ciPct.toFixed(2),
    resolved,
    verdict,
  };
}

/**
 * Shots per group needed before a tracking error of `tolerancePct` becomes
 * detectable.
 *
 * This is the number that decides whether the test is worth firing at all. It
 * grows as the square of the precision demanded: halving the detectable error
 * costs four times the ammunition.
 */
export function shotsForTracking(tolerancePct, dialled, sigma, cap = 200) {
  const t = Number(tolerancePct), d = Number(dialled), s = Number(sigma);
  if (!(t > 0) || !(d > 0) || !(s > 0)) return null;
  const targetIn = (t / 100) * d;
  for (let n = 1; n <= cap; n++) {
    const ci = displacementCi95(s, n);
    if (ci != null && ci <= targetIn) return n;
  }
  return null;
}

/**
 * Return to zero after running the turret through its travel.
 *
 * Judged the same way: a group that comes back 0.3" from zero has not proved a
 * fault if the test only resolves 0.6".
 */
export function rtzStep({ deviation, sigma, shots, milsTravelled }) {
  const dev = Number(deviation);
  const sg = Number(sigma), n = Number(shots);
  if (!isFinite(dev) || dev < 0) {
    return { ok: false, reason: 'Enter how far from zero the group returned.' };
  }
  const ci = sg > 0 && n >= 1 ? displacementCi95(sg, n) : null;
  const resolved = ci != null ? dev > ci : null;
  const travel = Number(milsTravelled);
  const travelNote = isFinite(travel) && travel > 0
    ? ` after ${Math.round(travel)} mils of travel`
    : '';

  return {
    ok: true,
    deviation: +dev.toFixed(3),
    ci95In: ci == null ? null : +ci.toFixed(3),
    resolved,
    verdict: ci == null
      ? `Returned ${dev.toFixed(2)}" from zero${travelNote}. Record your group size to know whether that is real.`
      : resolved
        ? `Did not return to zero${travelNote} — ${dev.toFixed(2)}" off, beyond the ±${ci.toFixed(2)}" this test resolves. That is a real failure.`
        : `Returned to within ${dev.toFixed(2)}"${travelNote}, inside the ±${ci.toFixed(2)}" this test can resolve. No fault shown.`,
  };
}

/**
 * Roll up a whole evaluation.
 *
 * A scope passes only when every step that could resolve a fault failed to find
 * one. Steps too noisy to decide anything are counted separately rather than
 * silently treated as passes — that distinction is the difference between "this
 * scope is good" and "I have not tested it properly yet".
 */
export function evaluateScope(steps) {
  const done = (steps || []).filter(s => s && s.ok);
  if (!done.length) {
    return { ok: false, reason: 'No completed steps yet.' };
  }
  const failures = done.filter(s => s.resolved === true);
  const undecidable = done.filter(s => s.resolved === null);
  const passes = done.filter(s => s.resolved === false);

  return {
    ok: true,
    steps: done.length,
    failures: failures.length,
    passes: passes.length,
    undecidable: undecidable.length,
    verdict: failures.length
      ? `${failures.length} of ${done.length} step${done.length === 1 ? '' : 's'} showed a real fault. This scope is not tracking.`
      : undecidable.length
        ? `${passes.length} step${passes.length === 1 ? '' : 's'} passed and ${undecidable.length} could not resolve anything. Record group sizes on those before calling this scope good.`
        : `All ${passes.length} step${passes.length === 1 ? '' : 's'} passed within what they could resolve. Nothing here shows a fault.`,
  };
}
