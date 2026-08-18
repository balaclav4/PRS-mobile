/**
 * Secondary trajectory effects: the ones a drag model alone does not produce.
 *
 * The solver already handles drag, gravity and wind as an air-mass velocity.
 * That leaves four things which are individually small and jointly worth about
 * a minute of angle at 1000 yards - currently attributed to nothing, which
 * means a shooter truing their BC is quietly absorbing them into a number that
 * is supposed to describe the bullet.
 *
 * Two are exact physics and two are empirical fits. The difference matters and
 * is recorded per function, because a fit outside the data it was fitted to is
 * a guess wearing a formula.
 *
 * Sources are public: Miller's twist rule, McCoy's Modern Exterior Ballistics
 * for the Coriolis treatment, and Litz's published closed forms for spin drift
 * and aerodynamic jump. No proprietary drag or BC data is used - the solver
 * takes BC as an input and can true it, which is better for a specific rifle
 * than any published figure.
 */

/** Earth's rotation rate, rad/s. */
const OMEGA = 7.292115e-5;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Reading what the shooter already typed
// ---------------------------------------------------------------------------

/**
 * Twist rate in inches per turn, from however it was written down.
 *
 * Rifles store twist as free text because that is how people say it: "1:8",
 * "1-8", '1:7.5"', or just "8". All four mean the same thing. Parsing it saves
 * asking again for something already in the rifle record, and returning null
 * rather than a guess means the caller shows a field instead of a wrong Sg.
 */
export function parseTwist(text) {
  if (text == null) return null;
  const s = String(text).trim();
  if (!s) return null;
  // "1:8", "1-8", "1 in 8"
  const ratio = s.match(/1\s*(?::|-|\bin\b)\s*([\d.]+)/i);
  if (ratio) { const n = parseFloat(ratio[1]); return n > 0 ? n : null; }
  // A bare number is a twist only if that is all there is, and only if it is
  // plausible as one. "308" is a cartridge that wandered into the wrong field
  // rather than a 308-inch twist, and "6.5 Creedmoor" leads with a number that
  // is in range and still means nothing of the kind.
  const bare = s.match(/^([\d.]+)\s*"?$/);
  if (!bare) return null;
  const n = parseFloat(bare[1]);
  return n > 2 && n < 30 ? n : null;
}

/**
 * Bullet weight in grains, from a description like "140gr Hybrid".
 *
 * Same reasoning: the load already carries the bullet as text. Anything that
 * does not clearly read as a weight returns null and the caller asks.
 */
export function parseGrains(text) {
  if (text == null) return null;
  const m = String(text).match(/(\d{2,4}(?:\.\d+)?)\s*(?:gr|grain|grains)\b/i);
  if (m) { const n = parseFloat(m[1]); return n > 0 && n < 1000 ? n : null; }
  const lead = String(text).trim().match(/^(\d{2,4}(?:\.\d+)?)\b/);
  if (lead) { const n = parseFloat(lead[1]); return n >= 15 && n < 1000 ? n : null; }
  return null;
}

// ---------------------------------------------------------------------------
// Gyroscopic stability (Miller twist rule)
// ---------------------------------------------------------------------------

/**
 * Miller's approximation to the gyroscopic stability factor.
 *
 *   Sg = 30m / (t^2 d^3 l (1 + l^2))
 *
 * with m in grains, d in inches, t the twist in calibers per turn, and l the
 * length in calibers. Corrected for muzzle velocity and air density, both of
 * which move it: a bullet is more stable in thin air and at higher speed.
 *
 * Sg below 1.0 is unstable. Below about 1.4 is marginal, and the bullet's BC
 * suffers before it ever keyholes - which is why this is worth showing even
 * when nothing looks obviously wrong on paper.
 */
export function gyroscopicStability({
  bulletGrains, diameterIn, lengthIn, twistIn,
  mvFps = 2800, densityRatio = 1,
} = {}) {
  const m = Number(bulletGrains), d = Number(diameterIn);
  const L = Number(lengthIn), tw = Number(twistIn);
  if (!(m > 0) || !(d > 0) || !(L > 0) || !(tw > 0)) return null;

  const t = tw / d;   // twist in calibers per turn
  const l = L / d;    // length in calibers
  const base = (30 * m) / (t * t * Math.pow(d, 3) * l * (1 + l * l));

  // Velocity correction, cube root of the ratio to the 2800 fps reference.
  const v = Number(mvFps) > 0 ? Number(mvFps) : 2800;
  const vCorr = Math.pow(v / 2800, 1 / 3);

  // Thinner air is less stabilising demand: Sg rises as density falls.
  const rho = Number(densityRatio) > 0 ? Number(densityRatio) : 1;

  return +(base * vCorr / rho).toFixed(3);
}

/**
 * Air density as a fraction of sea-level standard, from density altitude.
 *
 * The ballistics screen already computes DA for the zero baseline, so stability
 * can use the same number rather than a second atmosphere model that disagrees
 * with the first. Standard atmosphere density ratio, exponent 4.2559.
 */
export function densityRatioFromDa(daFt) {
  const da = Number(daFt);
  if (!isFinite(da)) return 1;
  const r = Math.pow(1 - 6.8756e-6 * da, 4.2559);
  return isFinite(r) && r > 0 ? r : 1;
}

/** Plain-language reading of an Sg value. */
export function stabilityVerdict(sg) {
  if (sg == null) return { level: 'unknown', text: 'Enter bullet length, weight, diameter and twist to check stability.' };
  if (sg < 1.0) return { level: 'unstable', text: `Sg ${sg} is below 1.0 - the bullet is not stabilised and will not fly point-forward. A faster twist is needed.` };
  if (sg < 1.4) return { level: 'marginal', text: `Sg ${sg} is marginal. It will fly, but its BC will fall short of the published figure and the shortfall grows in denser air.` };
  if (sg < 2.5) return { level: 'good', text: `Sg ${sg} is comfortably stable.` };
  return { level: 'over', text: `Sg ${sg} is more stable than needed. Harmless for accuracy, but the extra spin increases spin drift.` };
}

// ---------------------------------------------------------------------------
// Spin drift
// ---------------------------------------------------------------------------

/**
 * Lateral drift from gyroscopic precession, Litz's closed form:
 *
 *   drift (inches) = 1.25 * (Sg + 1.2) * TOF^1.83
 *
 * Right for right-hand twist, left for left-hand. It depends only on stability
 * and time of flight, not on the wind, which is why it is a systematic bias
 * rather than a condition: it is present on every shot and always the same
 * direction.
 *
 * This is an empirical fit, not a derivation. It tracks well over the range of
 * ordinary rifle stability and should not be extrapolated to exotic values.
 */
export function spinDrift({ sg, timeOfFlightSec, rightHandTwist = true } = {}) {
  const s = Number(sg), t = Number(timeOfFlightSec);
  if (!(s > 0) || !(t > 0)) return 0;
  const inches = 1.25 * (s + 1.2) * Math.pow(t, 1.83);
  return rightHandTwist ? inches : -inches;
}

// ---------------------------------------------------------------------------
// Aerodynamic jump
// ---------------------------------------------------------------------------

/**
 * Vertical deflection caused by a *crosswind*.
 *
 * The effect people find hardest to believe: a horizontal wind moves the impact
 * up or down. A crosswind gives the bullet an angle of attack as it leaves the
 * muzzle, and a spinning bullet answers an off-axis load by precessing
 * perpendicular to it. With right-hand twist a wind from the right lifts the
 * impact; from the left it drops it.
 *
 * Litz's fit, in MOA per mph of crosswind:
 *
 *   0.01*Sg - 0.0024*L + 0.032       (L = bullet length in calibers)
 *
 * Unlike drift and drop this is a constant angle for the whole trajectory, not
 * something that accumulates with range - it is set in the first few feet.
 *
 * The limitation is real and is not hidden here: the fit is strongly linear in
 * Sg and was built around bullets near Sg 1.75. Away from that it degrades
 * quickly, so `reliable` is false outside a band around it and the caller is
 * expected to say so rather than print a confident number.
 */
export function aerodynamicJump({
  sg, lengthCalibers, crosswindMph, rightHandTwist = true,
} = {}) {
  const s = Number(sg), L = Number(lengthCalibers), w = Number(crosswindMph);
  if (!(s > 0) || !(L > 0) || !isFinite(w)) return null;

  const moaPerMph = 0.01 * s - 0.0024 * L + 0.032;
  // A wind from the right lifts a right-twist bullet. Positive crosswind is
  // taken as left-to-right, so it drops the impact.
  const signed = -moaPerMph * w * (rightHandTwist ? 1 : -1);

  return {
    moaPerMph: +moaPerMph.toFixed(4),
    moa: +signed.toFixed(2),
    // Litz's fit is anchored near Sg 1.75 and its error grows fast away from
    // there. Saying so beats printing a number nobody should trust.
    reliable: s >= 1.3 && s <= 2.3,
    note: s >= 1.3 && s <= 2.3
      ? null
      : `This estimate is fitted around Sg 1.75 and degrades quickly away from it. At Sg ${s} treat it as an indication, not a correction.`,
  };
}

// ---------------------------------------------------------------------------
// Coriolis
// ---------------------------------------------------------------------------

/**
 * Deflection from the Earth's rotation.
 *
 * Exact physics rather than a fit, under the flat-fire approximation. Two
 * separate components, and they behave differently:
 *
 *   Horizontal - depends on latitude only, never on which way you face. Right
 *   in the northern hemisphere, left in the southern. This surprises people who
 *   expect it to cancel when they turn around; it does not.
 *
 *   Vertical (Eotvos) - depends on azimuth. Shooting east adds to the bullet's
 *   eastward speed and reduces its effective weight, so it strikes high;
 *   shooting west, low. North and south, nothing.
 *
 * Both scale with range and time of flight, so they are negligible up close and
 * worth several inches at 1000 yards.
 *
 * @param latitudeDeg  positive north, negative south
 * @param azimuthDeg   compass bearing of fire, 0 = north, 90 = east
 */
export function coriolis({ latitudeDeg, azimuthDeg = 0, rangeFt, timeOfFlightSec } = {}) {
  const lat = Number(latitudeDeg), az = Number(azimuthDeg);
  const R = Number(rangeFt), t = Number(timeOfFlightSec);
  if (!isFinite(lat) || !(R > 0) || !(t > 0)) return null;

  // Horizontal: a = 2*Omega*V*sin(lat), displacement = a t^2 / 2 = Omega*R*t*sin(lat)
  const horizontalFt = OMEGA * R * t * Math.sin(lat * DEG);
  // Vertical: same form with cos(lat) and the eastward component of the shot.
  const verticalFt = OMEGA * R * t * Math.cos(lat * DEG) * Math.sin(az * DEG);

  return {
    horizontalIn: +(horizontalFt * 12).toFixed(2),
    verticalIn: +(verticalFt * 12).toFixed(2),
    horizontalWord: horizontalFt > 0 ? 'right' : horizontalFt < 0 ? 'left' : null,
    verticalWord: verticalFt > 0 ? 'high' : verticalFt < 0 ? 'low' : null,
  };
}

// ---------------------------------------------------------------------------
// Combined
// ---------------------------------------------------------------------------

/**
 * Every secondary effect for one range row, in inches.
 *
 * Returned separately rather than pre-summed. A shooter dialling a correction
 * needs to know that spin drift is always there and Coriolis flips sign when
 * they turn around - a single lumped figure hides exactly the thing that makes
 * them behave differently.
 */
export function secondaryEffects({
  sg, lengthCalibers, timeOfFlightSec, rangeFt,
  crosswindMph = 0, rightHandTwist = true,
  latitudeDeg = null, azimuthDeg = 0,
} = {}) {
  const drift = spinDrift({ sg, timeOfFlightSec, rightHandTwist });
  const jump = aerodynamicJump({ sg, lengthCalibers, crosswindMph, rightHandTwist });
  const cor = latitudeDeg == null ? null
    : coriolis({ latitudeDeg, azimuthDeg, rangeFt, timeOfFlightSec });

  // Aerodynamic jump is an angle, so it grows with range in linear terms.
  const jumpIn = jump && rangeFt > 0
    ? jump.moa * 1.047 * (rangeFt / 300)   // 1 MOA = 1.047" per 100 yd = per 300 ft
    : 0;

  return {
    spinDriftIn: +drift.toFixed(2),
    aeroJump: jump,
    aeroJumpIn: +jumpIn.toFixed(2),
    coriolis: cor,
    totalHorizontalIn: +(drift + (cor?.horizontalIn ?? 0)).toFixed(2),
    totalVerticalIn: +(jumpIn + (cor?.verticalIn ?? 0)).toFixed(2),
  };
}
