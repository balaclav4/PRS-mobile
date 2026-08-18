/**
 * Shooting up or down a hill.
 *
 * Gravity acts vertically. A bullet fired along a slope only has the component
 * of gravity perpendicular to its flight path bending it away from the bore
 * line, so it drops less relative to the line of sight than it would over the
 * same distance on the flat - and it drops less whether the shot is uphill or
 * downhill, which is the part people find surprising and which is why "aim low
 * downhill" is wrong as often as it is right.
 *
 * PRS stages are shot up and down banks routinely and the correction is large
 * enough to miss with: at 30 degrees it removes about 13% of the drop.
 *
 * Two treatments here, because they disagree and the disagreement matters.
 *
 * The rifleman's rule multiplies the *range* by cos(theta) and looks up the
 * dope for that shorter range. It is a field approximation from an era of
 * paper tables, it is exact only for a vacuum trajectory, and it
 * over-corrects at long range because it also pretends the bullet has less
 * time to be slowed by drag - which it has not, because it has travelled the
 * full slant distance through air.
 *
 * The improved method keeps the full slant range for drag and velocity, and
 * scales only the *drop* by cos(theta). That matches what actually happens: the
 * air the bullet flies through does not care about the angle; only gravity
 * does. It is the treatment used by every modern solver and it is what this
 * app applies.
 *
 * Both are exposed, because a shooter who has been taught the rifleman's rule
 * should be able to see what it costs rather than be told it is wrong.
 */

/** cos of an angle in degrees, clamped to a sane shooting range. */
function cosDeg(deg) {
  const d = Number(deg);
  if (!isFinite(d)) return 1;
  const clamped = Math.max(-89, Math.min(89, d));
  return Math.cos((clamped * Math.PI) / 180);
}

/**
 * Correct a flat-fire drop for an inclined shot.
 *
 * @param dropIn      drop at the slant range, from the solver, inches, negative
 *                    below the line of sight
 * @param angleDeg    look angle: positive uphill, negative downhill
 * @returns the drop to actually dial for, in inches
 *
 * Uphill and downhill give the same answer here, because cos is even. That is
 * correct to first order and is the whole content of the rule - the small
 * asymmetry between them comes from drag acting over a slightly different
 * velocity profile, which is below the noise of a wind call.
 */
export function inclinedDrop(dropIn, angleDeg) {
  const d = Number(dropIn);
  if (!isFinite(d)) return 0;
  return d * cosDeg(angleDeg);
}

/**
 * What the angle does to a shot, in the terms a shooter needs.
 *
 * Returns null below a threshold rather than reporting a correction of nothing:
 * cos(5 degrees) is 0.996, and dialling for four tenths of a percent is noise
 * dressed as precision.
 */
export function inclineEffect({ dropIn, angleDeg, rangeYd, unit = 'moa' } = {}) {
  const angle = Number(angleDeg);
  const drop = Number(dropIn);
  if (!isFinite(angle) || !isFinite(drop) || !isFinite(rangeYd) || rangeYd <= 0) return null;
  if (Math.abs(angle) < 5) return null;

  const cos = cosDeg(angle);
  const corrected = drop * cos;
  const deltaIn = corrected - drop;          // positive: shoots high, dial less

  const perUnit = unit === 'mil' ? 3.438 : 1.047;
  const toAngular = (inches) => (inches / (perUnit * (rangeYd / 100)));

  // What the rifleman's rule would have said, for comparison. It shortens the
  // range, so its answer is looked up elsewhere; what can be stated here is the
  // ratio it applies, which is the same cos - the difference between the two
  // methods is that it also removes drag over the horizontal distance.
  return {
    angleDeg: angle,
    cos: +cos.toFixed(4),
    dropIn: +corrected.toFixed(2),
    deltaIn: +deltaIn.toFixed(2),
    deltaAngular: +toAngular(deltaIn).toFixed(2),
    /** Percentage of the flat-fire drop removed by the angle. */
    reductionPct: +((1 - cos) * 100).toFixed(1),
    direction: angle > 0 ? 'uphill' : 'downhill',
  };
}

/**
 * The horizontal distance covered by a slant shot.
 *
 * Not used for the correction - it is what the rifleman's rule would look the
 * dope up at, and it is worth showing because a laser rangefinder without an
 * angle sensor reports the slant range while a map reports this one, and
 * confusing the two is a real error at distance.
 */
export function horizontalRange(slantRangeYd, angleDeg) {
  const r = Number(slantRangeYd);
  if (!isFinite(r) || r <= 0) return 0;
  return +(r * cosDeg(angleDeg)).toFixed(1);
}
