/**
 * Comparing groups that were not shot the same way.
 *
 * Extreme spread grows with shot count. A 3-shot group and a 10-shot group from
 * the same rifle and load are not measurements of the same quantity, and the
 * larger one is not worse shooting - it is more chances to find the two shots
 * furthest apart. The analytics screen averaged them together anyway.
 *
 * The app already reasons about this carefully in load development, where every
 * comparison is told how many shots each group holds. It was dropped everywhere
 * else, so a shooter who moved from 3-shot to 5-shot groups saw their average
 * get worse for no reason.
 *
 * The fix is to go through sigma. Divide a group's extreme spread by the factor
 * expected for its own shot count and what is left estimates the underlying
 * dispersion, which is comparable across counts. Multiply back by the factor for
 * a reference count and it reads as a group size a shooter recognises.
 */

/**
 * E[extreme spread] / sigma for n shots from a circular normal.
 *
 * No closed form above n = 2, so these are simulated: see
 * scripts/derive-es-factors.mjs, which produced them and can reproduce them.
 * 400,000 groups per shot count, mulberry32.
 *
 * The n = 2 entry is the check on the rest. Two independent bivariate normals
 * are separated by a Rayleigh variate of scale sigma*sqrt(2), so the mean is
 * sigma*sqrt(pi) = 1.7725. The table reproduces that to 0.03%. An earlier run
 * of the same script used a weak LCG and returned 1.8034, 1.75% high, which
 * would have put that bias into every other row unnoticed.
 */
const ES_OVER_SIGMA = {
  2: 1.773, 3: 2.4109, 4: 2.7952, 5: 3.0676, 6: 3.276,
  7: 3.4432, 8: 3.5861, 9: 3.7058, 10: 3.8136, 11: 3.9051,
  12: 3.989, 13: 4.0663, 14: 4.1327, 15: 4.1973, 16: 4.2557,
  17: 4.31, 18: 4.3602, 19: 4.4084, 20: 4.4529,
};

/** The reference count everything is expressed at. Five is the common group. */
export const REFERENCE_SHOTS = 5;

/**
 * The factor for n shots, extrapolated beyond the table.
 *
 * Above 20 the growth is close to logarithmic, so the last two entries set a
 * slope. Returned rather than refused because a 25-shot group is a real thing
 * and refusing it would silently drop data; the extrapolation is mild and the
 * alternative is worse.
 */
export function esFactor(n) {
  const k = Math.round(Number(n));
  if (!(k >= 2)) return null;
  if (ES_OVER_SIGMA[k]) return ES_OVER_SIGMA[k];
  const a = ES_OVER_SIGMA[19], b = ES_OVER_SIGMA[20];
  const slope = (b - a) / (Math.log(20) - Math.log(19));
  return b + slope * (Math.log(k) - Math.log(20));
}

/** Dispersion implied by one group's extreme spread and its shot count. */
export function sigmaFromGroup(extremeSpread, shots) {
  const f = esFactor(shots);
  const es = Number(extremeSpread);
  if (!f || !(es > 0)) return null;
  return es / f;
}

/** A group size at the reference shot count, from a dispersion. */
export function groupFromSigma(sigma, shots = REFERENCE_SHOTS) {
  const f = esFactor(shots);
  if (!f || !(sigma > 0)) return null;
  return sigma * f;
}

/**
 * One group restated as though it had been shot with `shots` rounds.
 *
 * A 3-shot 0.4in group and a 10-shot 0.4in group say very different things
 * about a rifle, and this is what makes them sayable in the same sentence.
 */
export function normaliseGroup(extremeSpread, fromShots, toShots = REFERENCE_SHOTS) {
  const sigma = sigmaFromGroup(extremeSpread, fromShots);
  return sigma == null ? null : groupFromSigma(sigma, toShots);
}

/**
 * A typical group across many, all restated at the reference count.
 *
 * Median rather than mean: group size is right-skewed, so one called flyer
 * drags a mean and leaves a median alone.
 *
 * Returns what it was built from as well as the answer. A figure normalised
 * from a spread of shot counts is doing more work than it looks like, and the
 * screen should be able to say so rather than presenting it as a plain average.
 */
export function typicalGroup(groups, toShots = REFERENCE_SHOTS) {
  const vals = [];
  const counts = new Set();
  for (const g of groups || []) {
    const n = g.shots?.length ?? g.shotCount;
    const es = g.inches ?? g.extremeSpread ?? g.value;
    const v = normaliseGroup(es, n, toShots);
    if (v != null && isFinite(v)) { vals.push(v); counts.add(Math.round(n)); }
  }
  if (!vals.length) return null;

  vals.sort((a, b) => a - b);
  const mid = vals.length >> 1;
  const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;

  const shotCounts = [...counts].sort((a, b) => a - b);
  return {
    value: median,
    groups: vals.length,
    shotCounts,
    normalised: shotCounts.length > 1 || shotCounts[0] !== toShots,
    referenceShots: toShots,
  };
}
