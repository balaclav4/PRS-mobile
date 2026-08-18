/**
 * The chance of hitting the plate, and what is stopping you.
 *
 * A dope card answers "where do I aim". It does not answer the question a
 * shooter actually has at 900 yards, which is "am I going to hit it, and if
 * not, what should I fix". Those are different questions and the second one is
 * the useful one, because it is actionable: a shooter with a 0.4 MOA rifle and
 * a 3 mph wind call has a wind problem, not a rifle problem, and no amount of
 * load development will fix it.
 *
 * Method: propagate the uncertainties through the solver and count hits. That
 * is ordinary Monte Carlo error propagation, the same technique used anywhere a
 * model has uncertain inputs. Applied Ballistics markets an implementation of
 * it under a name of their own; the technique is not theirs and this does not
 * use their data, their branding or their presentation.
 *
 * Linearised rather than re-solved per trial. A full trajectory solve costs
 * milliseconds, and twenty thousand of them per range would make the screen
 * unusable on a phone. Instead the solver runs a handful of times to measure
 * how far the impact moves per unit of each input, and the trials are drawn in
 * that linear space. Over the range of uncertainties a shooter actually carries
 * - a mile an hour of wind, ten feet per second of velocity, a few yards of
 * ranging error - the trajectory is very close to linear in each, and the
 * harness checks that against a full re-solve.
 *
 * What it will not do is pretend to know the shooter's uncertainties. Every one
 * is an input. The defaults are zero, so an untouched screen reports the rifle
 * alone and the shooter has to say how well they call wind before the number
 * means anything.
 */
import { solve } from './ballistics.js';

/** Impact offsets are Gaussian in each input, so this is all that is needed. */
function gaussPair(rnd) {
  const u = Math.sqrt(-2 * Math.log(rnd() + 1e-12));
  const t = 2 * Math.PI * rnd();
  return [u * Math.cos(t), u * Math.sin(t)];
}

/** mulberry32, so a reported probability is reproducible. */
function makeRng(seed = 0x9E3779B9) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Drop and wind drift at one range, in inches, from a solved card. */
function atRange(rows, rangeYd) {
  if (!rows.length) return null;
  let best = rows[0];
  for (const r of rows) {
    if (Math.abs(r.rangeYd - rangeYd) < Math.abs(best.rangeYd - rangeYd)) best = r;
  }
  return best;
}

/**
 * How far the impact moves per unit of each uncertain input.
 *
 * Finite differences on the solver. The steps are deliberately larger than the
 * uncertainties being modelled, so the difference is well above the solver's
 * own integration noise, and small enough that the response is still linear.
 */
export function sensitivities(opts, rangeYd) {
  const base = solve(opts);
  const b = atRange(base.rows, rangeYd);
  if (!b) return null;

  // Vertical, per foot per second of muzzle velocity.
  const dv = 25;
  const fast = atRange(solve({ ...opts, mvFps: opts.mvFps + dv }).rows, rangeYd);
  const dDropDv = fast ? (fast.dropIn - b.dropIn) / dv : 0;

  // Vertical, per yard of ranging error. A shooter who ranges long dials too
  // much elevation, and the bullet passes high by the slope of the drop curve.
  const dr = 25;
  const far = atRange(solve({ ...opts, maxRangeYd: rangeYd + dr * 2, stepYd: dr }).rows, rangeYd + dr);
  const dDropDr = far ? (far.dropIn - b.dropIn) / dr : 0;

  // Horizontal, per mile an hour of crosswind. Drift is linear in wind speed,
  // so this is exact rather than a difference.
  const windPerMph = opts.windMph ? b.windIn / opts.windMph : (() => {
    const w = atRange(solve({ ...opts, windMph: 10, windAngleDeg: 90 }).rows, rangeYd);
    return w ? w.windIn / 10 : 0;
  })();

  return {
    rangeYd,
    dropIn: b.dropIn,
    tofSec: b.tofSec,
    velFps: b.velFps,
    perFpsIn: dDropDv,
    perYardIn: dDropDr,
    perMphIn: windPerMph,
  };
}

/**
 * Probability of hitting a target of a given size, at one range.
 *
 * `target` is in inches: a diameter for a round plate, or width and height.
 * Uncertainties are one standard deviation each:
 *
 *   windMphSd    how badly the wind is called, in mph
 *   mvFpsSd      velocity spread, which the chronograph already measures
 *   rangeYdSd    ranging error
 *   groupMoa     the shooter's own dispersion, as a group size in MOA
 *
 * groupMoa is converted to a per-axis sigma. An extreme spread is not a sigma:
 * for a five-shot group the expected spread is about 3.07 sigma, which is the
 * same factor lib/groupsize derives, so dividing by it recovers the dispersion
 * the group implies.
 */
export function hitProbability({
  opts, rangeYd, target,
  windMphSd = 0, mvFpsSd = 0, rangeYdSd = 0, groupMoa = 0,
  trials = 4000, seed = 0x9E3779B9,
  sens = null,
}) {
  const s = sens || sensitivities(opts, rangeYd);
  if (!s) return null;

  const w = Number(target?.widthIn ?? target?.diameterIn);
  const h = Number(target?.heightIn ?? target?.diameterIn ?? w);
  const round = target?.diameterIn != null;
  if (!(w > 0) || !(h > 0)) return null;

  // Group size in MOA to a one-axis sigma in inches at this range.
  const moaIn = 1.047 * (rangeYd / 100);
  const groupSigmaIn = groupMoa > 0 ? (groupMoa * moaIn) / 3.07 : 0;

  const rnd = makeRng(seed);
  let hits = 0;
  // Track how much of the miss each source accounted for.
  let sumV = 0, sumH = 0, sumWind = 0, sumMv = 0, sumRange = 0, sumGroup = 0;

  for (let i = 0; i < trials; i++) {
    const [g1, g2] = gaussPair(rnd);
    const [g3, g4] = gaussPair(rnd);
    const [g5] = gaussPair(rnd);

    const eWind = g1 * windMphSd * s.perMphIn;
    const eMv = g2 * mvFpsSd * s.perFpsIn;
    const eRange = g3 * rangeYdSd * s.perYardIn;
    const eGroupH = g4 * groupSigmaIn;
    const eGroupV = g5 * groupSigmaIn;

    const dx = eWind + eGroupH;
    const dy = eMv + eRange + eGroupV;

    const hit = round
      ? Math.hypot(dx, dy) <= w / 2
      : Math.abs(dx) <= w / 2 && Math.abs(dy) <= h / 2;
    if (hit) hits++;

    sumH += dx * dx; sumV += dy * dy;
    sumWind += eWind * eWind; sumMv += eMv * eMv;
    sumRange += eRange * eRange; sumGroup += eGroupH * eGroupH + eGroupV * eGroupV;
  }

  const varTotal = (sumH + sumV) / trials;
  const share = (v) => (varTotal > 0 ? (v / trials) / varTotal : 0);

  return {
    rangeYd,
    pHit: hits / trials,
    sigmaHorizIn: Math.sqrt(sumH / trials),
    sigmaVertIn: Math.sqrt(sumV / trials),
    // Variance shares, which is what makes this actionable: they say what to
    // fix. Variances add, so these are the honest proportions - a source with
    // twice the standard deviation of another contributes four times as much.
    contributions: {
      wind: share(sumWind),
      velocity: share(sumMv),
      ranging: share(sumRange),
      group: share(sumGroup),
    },
    trials,
  };
}

/** The curve: probability against range, plus what dominates at each. */
export function hitCurve({
  opts, target, ranges,
  windMphSd = 0, mvFpsSd = 0, rangeYdSd = 0, groupMoa = 0,
  trials = 3000, seed = 0x9E3779B9,
}) {
  return (ranges || []).map((r, i) => hitProbability({
    opts, rangeYd: r, target, windMphSd, mvFpsSd, rangeYdSd, groupMoa,
    trials, seed: seed + i * 7919,
  })).filter(Boolean);
}

/**
 * The range at which the chance of a hit falls through a threshold.
 *
 * Interpolated between the two bracketing points rather than snapped to the
 * nearer one, because a card stepped every 100 yards would otherwise report
 * this in 100 yard lumps and imply a precision it does not have.
 */
export function rangeAtProbability(curve, p = 0.5) {
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1], b = curve[i];
    if (a.pHit >= p && b.pHit < p) {
      const f = (a.pHit - p) / (a.pHit - b.pHit);
      return a.rangeYd + f * (b.rangeYd - a.rangeYd);
    }
  }
  return null;
}

/** Which uncertainty to attack first, in the shooter's own words. */
export function dominantAdvice(point) {
  if (!point) return null;
  const c = point.contributions;
  const named = [
    ['wind', c.wind, 'Calling the wind is the biggest single thing between you and this target. A better wind call beats a better rifle here.'],
    ['ranging', c.ranging, 'Ranging error dominates. A more certain range does more for this shot than anything to do with the load.'],
    ['velocity', c.velocity, 'Velocity spread dominates. This is a reloading problem: powder charge consistency and ignition.'],
    ['group', c.group, 'The rifle and load are the limit here, not the conditions. This is where load development actually pays.'],
  ].sort((a, b) => b[1] - a[1]);

  const [name, shareOf, text] = named[0];
  if (shareOf <= 0) return null;
  return { source: name, share: shareOf, text };
}
