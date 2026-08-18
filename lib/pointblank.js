import { solve } from './ballistics.js';

/**
 * How far you can hold dead-on, and over what depth of ground a hit stays a hit.
 *
 * Two questions with the same geometry behind them.
 *
 * Maximum point-blank range: given a target of some height, what zero lets the
 * bullet stay inside it for the longest stretch, and how far does that stretch
 * reach? Under that range the shooter aims at the middle and fires, which on a
 * clock is worth more than a dialled solution.
 *
 * Danger space: at a given range, how much closer or further could the target
 * be and still be hit by the same hold? It answers "how badly can I have ranged
 * this", and it collapses at distance in a way that surprises people - the same
 * ten-inch plate that forgives eighty yards of ranging error at 300 forgives
 * about ten at 800, because the trajectory is falling so much faster.
 *
 * Both are computed by walking the solved trajectory rather than by a closed
 * form, because the closed forms in circulation assume a parabola and the whole
 * reason this app integrates a drag model is that a real trajectory is not one.
 */

/** Fine enough that a band edge lands within a couple of yards. */
const STEP_YD = 5;

/**
 * Trajectory height relative to the line of sight, sampled finely.
 * Positive is above the sight line.
 */
function heights(opts, zeroYd, maxRangeYd) {
  const { rows } = solve({ ...opts, zeroYd, maxRangeYd, stepYd: STEP_YD });
  return rows.map(r => ({ rangeYd: r.rangeYd, y: r.dropIn }));
}

/**
 * The zero that maximises how far a dead-on hold stays inside the target.
 *
 * @param targetHeightIn  full height of the vital area, not the radius
 *
 * Searched rather than solved. The optimum is where the bullet just kisses the
 * top of the band on the way up and just leaves the bottom on the way down, and
 * finding that analytically needs the parabola assumption this deliberately
 * avoids. A coarse sweep then a fine one costs a few dozen solves and is exact
 * to the step.
 */
export function maxPointBlank({ opts, targetHeightIn, maxSearchYd = 800 } = {}) {
  const h = Number(targetHeightIn);
  if (!(h > 0)) return null;
  const half = h / 2;

  let best = null;
  const consider = (zeroYd) => {
    const pts = heights(opts, zeroYd, maxSearchYd);
    // Walk out from the muzzle; the band ends the first time the bullet leaves
    // the target, in either direction.
    let near = null, far = null;
    for (const p of pts) {
      if (Math.abs(p.y) <= half) {
        if (near == null) near = p.rangeYd;
        far = p.rangeYd;
      } else if (far != null) {
        break;  // left the band and is not coming back
      }
    }
    if (far != null && (!best || far > best.farYd)) {
      best = { zeroYd, nearYd: near, farYd: far };
    }
  };

  // Coarse, then fine around the winner.
  for (let z = 50; z <= maxSearchYd; z += 25) consider(z);
  if (!best) return null;
  const around = best.zeroYd;
  for (let z = Math.max(25, around - 25); z <= around + 25; z += 5) consider(z);

  return {
    ...best,
    targetHeightIn: h,
    /** The depth of ground over which no hold-over is needed. */
    depthYd: best.farYd - (best.nearYd ?? 0),
  };
}

/**
 * Danger space around a target at a known range.
 *
 * How much the range could be wrong, in either direction, with the hold that is
 * correct at `rangeYd`, and still put the bullet inside the target.
 *
 * This is the honest form of "how much does ranging error matter": at close
 * range the answer is most of a football pitch, and at distance it is a few
 * yards, and the shooter should see which one they are in.
 */
export function dangerSpace({ opts, rangeYd, targetHeightIn } = {}) {
  const h = Number(targetHeightIn);
  const R = Number(rangeYd);
  if (!(h > 0) || !(R > 0)) return null;
  const half = h / 2;

  // Zero at the target range: that is what "the correct hold" means.
  const searchTo = Math.ceil((R * 1.6) / STEP_YD) * STEP_YD;
  const pts = heights(opts, R, searchTo);
  if (!pts.length) return null;

  // The contiguous band containing the target range.
  let near = null, far = null;
  for (const p of pts) {
    if (Math.abs(p.y) <= half) {
      if (near == null || far == null || p.rangeYd - far <= STEP_YD * 1.5) {
        if (near == null) near = p.rangeYd;
        far = p.rangeYd;
      }
    } else if (far != null && far >= R) {
      break;
    } else if (far != null) {
      near = null; far = null;   // an earlier band that did not reach the target
    }
  }
  if (near == null || far == null) return null;

  return {
    rangeYd: R,
    targetHeightIn: h,
    nearYd: near,
    farYd: far,
    depthYd: far - near,
    /** How much short, and how much long, the range estimate may be. */
    shortYd: Math.max(0, R - near),
    longYd: Math.max(0, far - R),
  };
}

/** Plain-language reading of a danger space, for the screen. */
export function describeDangerSpace(ds) {
  if (!ds) return null;
  const { depthYd, rangeYd, targetHeightIn, shortYd, longYd } = ds;
  const tight = depthYd <= 30;
  return tight
    ? `About ${depthYd} yards of depth on a ${targetHeightIn}" target at ${rangeYd}. Range it to within ${Math.min(shortYd, longYd)} yards or the hold is wrong — this is where a rangefinder stops being optional.`
    : `About ${depthYd} yards of depth on a ${targetHeightIn}" target at ${rangeYd}: ${shortYd} short and ${longYd} long. Ranging error is not what will make you miss here.`;
}
