/**
 * Charge work-up analysis — load dev step 3.
 *
 * WHAT THIS DOES NOT DO: it does not tell you a load is safe. Nothing computed
 * here can. Published load data from the powder and bullet makers is the only
 * authority on maximum charge, and this module's every verdict defers to it.
 *
 * What it does do is catch one thing earlier than eyeballing brass does.
 *
 * Over the working range, muzzle velocity rises close to linearly with charge
 * weight. As pressure begins climbing faster than the case and chamber are
 * absorbing it, that line bends upward — each additional tenth of a grain buys
 * more velocity than the last. That upward bend is measurable from a chronograph
 * and shows up before the traditional signs do.
 *
 * The traditional signs are the problem this addresses. Ejector marks, stiff
 * bolt lift and cratered primers are real, but they are lagging indicators:
 * by the time brass shows them the load is already over pressure, and in some
 * rifles they never appear at all before a case head separates. A shooter
 * working up by "no signs yet" is reading a gauge that only moves after the
 * event.
 *
 * So: a departure from linearity is a reason to stop and go back to the manual.
 * The absence of one is not permission to continue.
 */

import { tTestP } from './stats.js';

/** Clean UI rows into numeric { charge, velocity } points. */
export function parseWorkup(rows) {
  return (rows || [])
    .map(r => ({
      id: r.id,
      charge: parseFloat(r.charge),
      velocity: parseFloat(r.velocity),
      sign: r.sign || null,
    }))
    .filter(r => isFinite(r.charge) && isFinite(r.velocity) && r.velocity > 0)
    .sort((a, b) => a.charge - b.charge);
}

/**
 * Ordinary least squares, velocity against charge by default.
 *
 * The axes are parameterised because the same fit answers a different question
 * for barrel wear — velocity against accumulated round count — and duplicating
 * a validated regression to change two property names would be worse than
 * threading them through.
 */
export function fitLine(points, xKey = 'charge', yKey = 'velocity') {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((a, p) => a + p[xKey], 0) / n;
  const my = points.reduce((a, p) => a + p[yKey], 0) / n;
  let sxy = 0, sxx = 0;
  for (const p of points) {
    sxy += (p[xKey] - mx) * (p[yKey] - my);
    sxx += (p[xKey] - mx) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const residuals = points.map(p => p[yKey] - (intercept + slope * p[xKey]));
  return {
    slope, intercept, n, meanX: mx, sxx,
    // Residual SD with the two fitted parameters accounted for.
    residualSd: n > 2 ? Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / (n - 2)) : 0,
    predict: (x) => intercept + slope * x,
  };
}

/**
 * Standard error of a single new observation at `x`.
 *
 * The residual SD alone is the wrong yardstick for the top rungs: they sit
 * outside the fitted range, and extrapolating a line makes the prediction less
 * certain the further out it reaches. Using plain residual SD ignored that and
 * flagged 15.3% of genuinely linear ladders — a false-alarm rate that teaches a
 * shooter to ignore the one warning this screen exists to give.
 *
 * The 1 covers the new shot's own scatter, 1/n the uncertainty in the fitted
 * mean, and the last term the uncertainty in the slope, which is what grows
 * with distance from the fitted centre.
 */
export function predictionSe(fit, x, scatter) {
  if (!fit || !(fit.sxx > 0)) return null;
  return scatter * Math.sqrt(1 + 1 / fit.n + ((x - fit.meanX) ** 2) / fit.sxx);
}


/**
 * Quadratic fit of velocity against charge, with a standard error on the
 * curvature term.
 *
 * Testing each top rung against a line fitted to the bottom ones looked
 * reasonable and is a weak test: it throws away most of the data, extrapolates
 * (so the honest error bars balloon just where the signal is), and the
 * two-consecutive-rungs rule can never fire on the last rung, which is exactly
 * where a bend shows first. On a ladder bending hard enough to reach +55 fps it
 * detected nothing.
 *
 * Asking whether the curvature coefficient is positive uses every rung, needs
 * no extrapolation, and is a direct test of the physical claim.
 *
 * Charge is centred before fitting to keep the normal equations well
 * conditioned; curvature is unaffected by the shift.
 */
export function fitCurve(points) {
  const n = points.length;
  if (n < 4) return null;
  const mx = points.reduce((a, p) => a + p.charge, 0) / n;
  const u = points.map(p => p.charge - mx);
  const y = points.map(p => p.velocity);

  // Normal equations for [1, u, u^2].
  const S = (k) => u.reduce((a, x) => a + Math.pow(x, k), 0);
  const T = (k) => u.reduce((a, x, i) => a + Math.pow(x, k) * y[i], 0);
  const A = [
    [n, S(1), S(2)],
    [S(1), S(2), S(3)],
    [S(2), S(3), S(4)],
  ];
  const b = [T(0), T(1), T(2)];

  const inv = invert3(A);
  if (!inv) return null;
  const beta = inv.map(row => row.reduce((a, v, j) => a + v * b[j], 0));
  const [a0, a1, a2] = beta;

  const predict = (c) => { const d = c - mx; return a0 + a1 * d + a2 * d * d; };
  const rss = points.reduce((acc, p) => acc + (p.velocity - predict(p.charge)) ** 2, 0);
  const df = n - 3;
  const s2 = df > 0 ? rss / df : 0;

  return {
    n, df, meanX: mx,
    curvature: a2,
    slopeAtMean: a1,
    residualSd: Math.sqrt(s2),
    // Variance of the curvature coefficient is s^2 times the matching diagonal.
    curvatureVarUnit: inv[2][2],
    predict,
  };
}

/** Inverse of a symmetric 3x3, or null if singular. */
function invert3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

/**
 * Look for the upward bend.
 *
 * Tests whether the velocity-vs-charge curve has significant positive
 * curvature. A straight line through the whole ladder is the null; a curve that
 * turns upward is the signal.
 *
 * @param points   parsed rungs, ascending by charge
 * @param bookMax  published maximum charge, if the shooter entered one
 */
export function analyseWorkup(points, bookMax = null, opts = {}) {
  // Velocities arrive in whatever unit the shooter works in. The scatter floor
  // below is an absolute quantity, so it has to be expressed in that same unit
  // or it silently changes meaning: 10 fps is 3 m/s, and a floor three times too
  // large would suppress real bends for anyone working metric.
  const velocityUnit = opts.velocityUnit || 'fps';
  if (!points || points.length < 5) {
    return { ok: false, reason: 'Need at least 5 charges with velocities to see a trend.' };
  }

  const line = fitLine(points);
  const curve = fitCurve(points);
  if (!line || !curve) {
    return { ok: false, reason: 'These charges are too few or too flat to fit a trend.' };
  }

  // One velocity per charge means the residual scatter IS the shot-to-shot
  // variation, which no rifle beats by much. A ladder that happens to fit almost
  // perfectly would otherwise divide by nearly zero and flag any wobble in it.
  // Floor it at the scatter a single chronographed shot really carries.
  const MIN_SCATTER_FPS = 10;
  const minScatter = velocityUnit === 'm/s' ? MIN_SCATTER_FPS * 0.3048 : MIN_SCATTER_FPS;
  const scatter = Math.max(curve.residualSd, minScatter);

  const seCurv = scatter * Math.sqrt(curve.curvatureVarUnit);
  const t = seCurv > 0 ? curve.curvature / seCurv : 0;
  // One-sided: only an upward bend matters. A ladder flattening at the top is
  // ordinary powder behaviour, not a pressure warning.
  const p2 = tTestP(t, curve.df);
  const pOneSided = p2 == null ? null : (t > 0 ? p2 / 2 : 1 - p2 / 2);
  const bending = t > 0 && pOneSided != null && pOneSided < 0.05;

  // The rung table is measured against a line fitted to the lower rungs only.
  // A line through the whole ladder tilts to absorb the bend, which is what it
  // is there to reveal: on a ladder departing at 42.5 gr the all-points line
  // left excesses of 11, 5, -1, -7, -13, -16, -3, 24 and made the departure look
  // like the last rung alone. Detection still uses the curvature of the full
  // fit; only this description uses the base line.
  const nBase = Math.max(3, Math.floor(points.length * 0.6));
  const baseLine = fitLine(points.slice(0, nBase)) || line;
  const rungs = points.map(p => {
    const expected = baseLine.predict(p.charge);
    return {
      ...p,
      expected: +expected.toFixed(0),
      excess: +(p.velocity - expected).toFixed(0),
    };
  });

  // Where the departure starts, stated descriptively rather than inferred from
  // the parabola. Solving the fitted curve for where it clears its own tangent
  // put the onset at 41.62 gr on a ladder that is visibly straight until 42.5 —
  // a global quadratic spreads curvature across the whole range and cannot
  // locate an onset. So: the lowest charge from which every rung sits above the
  // straight line. That is a statement about the data, not about a model.
  let departureCharge = null;
  if (bending) {
    for (let i = 0; i < rungs.length; i++) {
      if (rungs.slice(i).every(r => r.excess > 0) && rungs[i].excess > 0) {
        departureCharge = rungs[i].charge;
        break;
      }
    }
  }

  // Independently of the curve: did the ladder run past the book?
  const overBook = bookMax != null && isFinite(bookMax)
    ? points.filter(p => p.charge > bookMax)
    : [];

  // Pressure signs the shooter recorded, reported back but never used to clear
  // a load — they only ever add a reason to stop.
  const signs = points.filter(p => p.sign && p.sign !== 'none');

  const parts = [];
  if (overBook.length) {
    parts.push(`${overBook.length} ${overBook.length === 1 ? 'charge is' : 'charges are'} above the ${bookMax} gr book maximum you entered. Published data is the authority here, not this screen.`);
  }
  if (bending) {
    const where = departureCharge != null
      ? ` Every rung from ${departureCharge} gr up sits above the straight line.`
      : '';
    parts.push(`Velocity is climbing faster than the charge, not with it — the curve bends upward by ${curve.curvature.toFixed(0)} ${velocityUnit} per grain squared (p = ${pOneSided.toFixed(3)}).${where} That bend is the signal to stop and go back to your manual.`);
  }
  if (signs.length) {
    parts.push(`You recorded pressure signs at ${signs.map(s => s.charge + ' gr').join(', ')}. Those are lagging indicators — brass shows them after a load is already too hot, so treat them as a hard stop rather than a limit to approach.`);
  }
  if (!parts.length) {
    parts.push(`Velocity is tracking the charge linearly at ${line.slope.toFixed(0)} ${velocityUnit} per grain across all ${points.length} rungs, with no upward bend (p = ${pOneSided == null ? 'n/a' : pOneSided.toFixed(2)}). That is the absence of one warning sign, not a clearance — the published maximum still governs.`);
  }

  return {
    ok: true,
    fit: {
      slope: +line.slope.toFixed(1),
      baseSlope: +baseLine.slope.toFixed(1),
      basedOn: nBase,
      curvature: +curve.curvature.toFixed(1),
      residualSd: +scatter.toFixed(1),
      rawResidualSd: +curve.residualSd.toFixed(1),
      t: +t.toFixed(2),
      p: pOneSided == null ? null : +pOneSided.toFixed(4),
      df: curve.df,
    },
    rungs,
    bending,
    departureCharge,
    overBook: overBook.map(p => p.charge),
    signs: signs.map(p => p.charge),
    // Deliberately never true. There is no computation that clears a load.
    safe: null,
    verdict: parts.join(' '),
  };
}
