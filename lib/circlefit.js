/**
 * Using the printed bull as the scale reference.
 *
 * The sheet is a poor reference. It is often bigger than the frame, its corners
 * curl, and on a stapled target they are not in the target's plane at all. The
 * bull is printed to a known diameter, sits flat, and is the thing the shooter
 * was aiming at - which means fitting it also hands back the aim point, rather
 * than assuming the centre of a marked rectangle.
 *
 * Three taps on the rim determine a circle exactly. More than three is a least
 * squares fit, and then the residual becomes a usable signal: a circle
 * photographed off-axis is an ellipse, and points taken around an ellipse will
 * not sit on any circle. That is the whole safety story for this mode, because
 * a circle carries no perspective information of its own. Four corners of a
 * rectangle do; a circle does not, and pretending otherwise would return a
 * confident scale that is wrong along one axis.
 */

/**
 * Algebraic (Kasa) circle fit.
 *
 * Solves x^2 + y^2 + Dx + Ey + F = 0 in the least squares sense, which is
 * linear in D, E, F and therefore has a closed form. Exact for three points.
 *
 * The algebraic fit is known to pull the radius in slightly when the points
 * cover only a short arc, because it weights by distance squared rather than
 * geometric distance. Taps spread around a printed bull cover the full circle,
 * where the bias is negligible - and `arcSpanDeg` is returned so a caller can
 * refuse the fit when they do not.
 */
export function fitCircle(points) {
  const pts = (points || []).filter(p => p && isFinite(p.x) && isFinite(p.y));
  if (pts.length < 3) return null;

  // Work relative to the centroid: the normal equations are badly conditioned
  // in absolute image coordinates, where x^2 + y^2 is large and the variation
  // between points is small.
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;

  let Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0;
  for (const p of pts) {
    const u = p.x - mx, v = p.y - my;
    const z = u * u + v * v;
    Sxx += u * u; Syy += v * v; Sxy += u * v;
    Sxz += u * z; Syz += v * z;
  }

  const det = 2 * (Sxx * Syy - Sxy * Sxy);
  // Collinear taps, or three taps on top of each other.
  if (Math.abs(det) < 1e-9) return null;

  const cu = (Syy * Sxz - Sxy * Syz) / det;
  const cv = (Sxx * Syz - Sxy * Sxz) / det;

  const cx = cu + mx, cy = cv + my;
  const radius = Math.sqrt(
    pts.reduce((s, p) => s + (p.x - cx) ** 2 + (p.y - cy) ** 2, 0) / pts.length
  );
  if (!(radius > 0) || !isFinite(radius)) return null;

  // How far each tap sits from the fitted circle, as a fraction of the radius.
  const residuals = pts.map(p => Math.abs(Math.hypot(p.x - cx, p.y - cy) - radius) / radius);
  const rms = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length);

  return {
    cx, cy, radius,
    rmsError: +rms.toFixed(5),
    maxError: +Math.max(...residuals).toFixed(5),
    count: pts.length,
    ...arcSpan(pts, cx, cy),
    // Three points always fit exactly, so a zero residual from three taps says
    // nothing at all about whether the bull was round in the photograph.
    exact: pts.length === 3,
  };
}

/**
 * How the taps are distributed around the fitted centre.
 *
 * Two numbers, because they answer different questions and conflating them
 * misreports the common case. `maxGapDeg` is the widest stretch of rim with no
 * tap on it, which is what a shooter should see: four taps at the compass
 * points leave a largest gap of 90 degrees, and that is a well covered bull.
 *
 * `arcSpanDeg` is 360 minus that gap, and is the right quantity to threshold
 * on, because taps bunched inside a 90 degree arc leave a 270 degree gap and
 * span only 90. But reporting it back for evenly spread taps reads as though a
 * quarter of the rim were missed - the first version of this printed "270
 * degrees of the rim" for taps that plainly went all the way round.
 */
function arcSpan(pts, cx, cy) {
  const angles = pts.map(p => Math.atan2(p.y - cy, p.x - cx)).sort((a, b) => a - b);
  let gap = angles[0] + 2 * Math.PI - angles[angles.length - 1];
  for (let i = 1; i < angles.length; i++) gap = Math.max(gap, angles[i] - angles[i - 1]);
  const gapDeg = Math.round(gap * 180 / Math.PI);
  return { maxGapDeg: gapDeg, arcSpanDeg: 360 - gapDeg };
}

/**
 * How wrong the scale is, as a percentage, given the fit residual.
 *
 * A circle seen at angle t is an ellipse with semi-axes a and a*k, k = cos t.
 * The best fitting circle has radius a(1 + k)/2, so every point sits a(1 - k)/2
 * off it, which is (1 - k)/(1 + k) relative to the fitted radius. Spread around
 * the rim that peak becomes an RMS of about (1 - k) / ((1 + k) * sqrt 2).
 *
 * Since the single fitted radius is used as the scale, distances measured along
 * the major axis come out (1 + k)/2 too small and along the minor axis
 * (1 + k)/(2k) too large. Both are (1 - k)/(1 + k), which is exactly rms *
 * sqrt 2 - so the scale error is the residual multiplied by 1.414, and that is
 * the number worth showing rather than the residual itself.
 *
 * Checked against synthetic ellipses in the harness: 20 degrees of tilt gives a
 * 2.2% residual, 30 gives 5.1, 40 gives 9.3, all within 0.1 of this expression.
 * An earlier version inverted (1 - cos t)/2 instead and under-reported a 30
 * degree tilt as 26.
 */
export function scaleErrorPct(rms) {
  return +(rms * Math.SQRT2 * 100).toFixed(1);
}

/** Recover the off-axis angle from the residual, inverting the above. */
function obliquityDeg(rms) {
  const R = rms * Math.SQRT2;
  if (R >= 1) return 90;
  const k = (1 - R) / (1 + R);
  return Math.round(Math.acos(Math.max(-1, Math.min(1, k))) * 180 / Math.PI);
}

/**
 * Is the marked bull round enough to trust as a scale reference?
 *
 * With four or more taps a real ellipse shows up as residuals no circle can
 * absorb. Thresholds are set on the scale error, because that is the quantity
 * that reaches the shooter: a group is quoted to two decimal places in inches.
 *
 * Under 3% is waved through - on a 0.6 inch group that is under two hundredths.
 * Between 3% and 7% it is called out but allowed. Over 7% the mode is refused,
 * and the four-corner path is the honest answer because that one actually
 * recovers perspective. A circle cannot: it has no orientation to recover from.
 */
export function circleQuality(fit) {
  if (!fit) return { ok: false, level: 'none', text: 'Tap at least three points around the edge of the bull.' };

  if (fit.arcSpanDeg < 180) {
    return {
      ok: false, level: 'arc',
      text: `Those taps only cover ${fit.arcSpanDeg} degrees of the rim. Spread them right around the bull, otherwise the fitted size is a guess from one side of it.`,
    };
  }

  if (fit.exact) {
    return {
      ok: true, level: 'unchecked',
      text: 'Three taps fix a circle exactly, so nothing here can tell whether the bull was round in the photo. Add a fourth to have that checked.',
    };
  }

  const err = scaleErrorPct(fit.rmsError);

  if (err > 7) {
    return {
      ok: false, level: 'oblique', scaleErrorPct: err,
      text: `The marked bull is too far from round to size from. The photo is about ${obliquityDeg(fit.rmsError)} degrees off-axis, which would put every measurement out by ${err}% across one axis. Use the four-corner reference instead: that one corrects perspective, and a circle cannot.`,
    };
  }

  if (err > 3) {
    return {
      ok: true, level: 'tilted', scaleErrorPct: err,
      text: `The bull reads slightly oval, about ${obliquityDeg(fit.rmsError)} degrees off-axis. Sizes will be out by roughly ${err}% along one axis. Four corners would correct that.`,
    };
  }

  return {
    ok: true, level: 'good', scaleErrorPct: err,
    text: 'The marked bull is round, so the scale taken from it is sound.',
  };
}

/**
 * The circle as four corners of its bounding square.
 *
 * Everything downstream - the homography, rectifyToInches, the group maths -
 * already speaks in rectangles of known size. A bull of diameter D is a D by D
 * square, so the circle path joins the existing pipeline here and nothing after
 * this point needs to know which mode was used.
 *
 * Ordered top-left, top-right, bottom-right, bottom-left to match orderCorners.
 */
export function circleQuad(fit) {
  if (!fit) return null;
  const { cx, cy, radius: r } = fit;
  return [
    { x: cx - r, y: cy - r },
    { x: cx + r, y: cy - r },
    { x: cx + r, y: cy + r },
    { x: cx - r, y: cy + r },
  ];
}

/**
 * Diameters printed on Birchwood Casey Shoot-N-C packaging.
 *
 * Only these are listed. Ring diameters for NRA and other competition faces are
 * not, because they vary by target number and I would be guessing at them - and
 * a guessed reference size is a scale error applied to every measurement taken
 * from the photograph, silently. Anything not here is measured with a ruler and
 * typed.
 *
 * That was checked again rather than assumed, and the answer got firmer. Two
 * independent sources agree on the NRA LR ring diameters, but they contradict
 * each other on the *aiming black* of the MR-1 - 12 inches against 24 - and the
 * aiming black is the one figure this app would use, because it is the circle a
 * photograph actually shows. Shipping the number a coin-flip picked would put a
 * 2x scale error on every group measured from that photo. So the list below
 * stays as it is, and what the shooter measures themselves goes in the one
 * below it.
 */
export const BULL_PRESETS = [
  { label: 'Shoot-N-C 1"', inches: 1 },
  { label: 'Shoot-N-C 2"', inches: 2 },
  { label: 'Shoot-N-C 3"', inches: 3 },
  { label: 'Shoot-N-C 5.5"', inches: 5.5 },
  { label: 'Shoot-N-C 8"', inches: 8 },
  { label: 'Shoot-N-C 12"', inches: 12 },
];

/**
 * A preset the shooter measured, which is the only kind this app can be sure of.
 *
 * The competition faces are the case that motivated this. A shooter who shoots
 * MR-1s every month knows what their aiming black measures, because they can
 * hold a ruler against one; the app does not, and cannot find out reliably. So
 * they measure it once, name it, and it is a chip from then on.
 *
 * The label is what makes it worth keeping, and it is also the trap. "24" is
 * useless in six months. A name is required for the same reason a drag curve
 * needs a source: a number whose meaning has been lost is worse than no number,
 * because it will still be tapped.
 */
export function makeBullPreset({ label, inches }) {
  const name = String(label || '').trim();
  const d = Number(inches);
  // The upper bound is a real target: LR faces run to a 60 inch seven ring.
  if (!name || !isFinite(d) || d <= 0 || d > 120) return null;
  return {
    id: 'bp' + Date.now() + Math.random().toString(36).slice(2, 5),
    label: name,
    inches: d,
    // Recorded so the list can say these are the shooter's own measurements
    // rather than anything the app claims to know.
    measuredBy: 'user',
    addedAt: new Date().toISOString(),
  };
}

/**
 * The built-in presets and the shooter's own, in one list.
 *
 * Custom ones come first: someone who has saved their own has told you which
 * targets they actually shoot, and the Shoot-N-C sizes are the fallback.
 * A custom entry at the same diameter as a built-in replaces it, so saving
 * "MR-1 black" at 12 inches does not leave two chips both reading 12".
 */
export function allBullPresets(custom = []) {
  const mine = (custom || []).filter(p => p && isFinite(Number(p.inches)) && Number(p.inches) > 0);
  const taken = new Set(mine.map(p => Number(p.inches)));
  return [...mine, ...BULL_PRESETS.filter(p => !taken.has(p.inches))];
}
