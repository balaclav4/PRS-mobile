/**
 * Zero as a barrel angle, and density altitude.
 *
 * A "100 yard zero" is not a property of the rifle. It is the range at which the
 * bullet happens to recross the line of sight, and that range moves with air
 * density — the same rifle untouched between a cold morning at sea level and a
 * hot afternoon at 6,000 ft is zeroed at two different distances.
 *
 * What does not move is the angle between the bore and the sight line. That is
 * mechanical: it changes when the turret is turned and at no other time. Storing
 * the angle rather than a range means conditions can change without the baseline
 * becoming a lie, and the zero range becomes something computed for today rather
 * than something asserted.
 *
 * Density altitude is the shorthand shooters actually trade — one number
 * standing in for pressure, temperature and humidity. It is reported here
 * because it is what people write on a dope card, but it is never what the
 * trajectory is solved from: the solver gets the real conditions, because DA is
 * a linearised approximation and throwing away the inputs to recover them
 * loses accuracy for no reason.
 */

import { solve, zeroAngle } from './ballistics.js';

const STD_PRESSURE_INHG = 29.92;
const STD_TEMP_C = 15;
// ISA lapse rate: 1.98 degrees C per 1000 ft.
const LAPSE_C_PER_1000FT = 1.98;

const fToC = (f) => (f - 32) * 5 / 9;

/**
 * Pressure altitude: the altitude at which the standard atmosphere has the
 * observed pressure.
 *
 * Takes a station pressure reading. A Kestrel gives this directly; an aviation
 * altimeter setting is corrected to sea level and is not the same number.
 */
export function pressureAltitude(pressureInHg, elevationFt = 0) {
  const p = Number(pressureInHg), e = Number(elevationFt) || 0;
  if (!(p > 0)) return null;
  return e + (STD_PRESSURE_INHG - p) * 1000;
}

/**
 * Density altitude, by the standard field approximation
 * DA = PA + 120 * (OAT - ISA), with temperatures in Celsius.
 *
 * Humidity is accepted and deliberately ignored here: it moves DA by a few
 * hundred feet at most and the formula this reproduces has no term for it.
 * The trajectory solver does model humidity, which is the number that matters.
 */
export function densityAltitude({ tempF, pressureInHg, elevationFt = 0 } = {}) {
  const pa = pressureAltitude(pressureInHg, elevationFt);
  if (pa == null) return null;
  const t = Number(tempF);
  if (!isFinite(t)) return null;
  const isaC = STD_TEMP_C - LAPSE_C_PER_1000FT * (pa / 1000);
  return Math.round(pa + 120 * (fToC(t) - isaC));
}

/**
 * Establish a zero: the barrel angle that puts the bullet on the sight line at
 * `zeroYd` under the conditions given.
 *
 * Returns the angle plus the conditions it was set in, because an angle without
 * its conditions cannot be checked later.
 */
export function establishZero(opts = {}) {
  const angleRad = zeroAngle(opts);
  if (!isFinite(angleRad)) return { ok: false, reason: 'Could not solve a zero for these inputs.' };
  return {
    ok: true,
    angleRad,
    // Milliradians is the readable form; a bore angle is a few mils at most.
    angleMil: +(angleRad * 1000).toFixed(3),
    angleMoa: +(angleRad * (180 / Math.PI) * 60).toFixed(3),
    zeroYd: Number(opts.zeroYd) || 100,
    conditions: {
      tempF: Number(opts.tempF) ?? null,
      pressureInHg: Number(opts.pressureInHg) ?? null,
      humidityPct: Number(opts.humidityPct) ?? null,
      altitudeFt: opts.altitudeFt == null ? null : Number(opts.altitudeFt),
      densityAltitudeFt: densityAltitude({
        tempF: opts.tempF,
        pressureInHg: opts.pressureInHg,
        elevationFt: opts.altitudeFt || 0,
      }),
    },
  };
}

/**
 * Hold the barrel angle fixed and re-solve under new conditions.
 *
 * This is the whole point of storing an angle: it answers "where does this rifle
 * shoot today" without the shooter touching the turret, and it says whether the
 * difference is worth caring about.
 */
export function zeroUnderConditions(baseline, newOpts = {}) {
  if (!baseline?.ok) return { ok: false, reason: 'No baseline zero recorded.' };

  const opts = { ...newOpts, muzzleAngleRad: baseline.angleRad, windMph: 0 };
  const zeroYd = baseline.zeroYd;

  // Where the bullet now crosses at the original zero distance.
  const { rows } = solve({ ...opts, maxRangeYd: zeroYd, stepYd: zeroYd });
  const dropIn = rows.length ? rows[rows.length - 1].dropIn : null;
  if (dropIn == null) return { ok: false, reason: 'Could not solve under these conditions.' };

  // And where it now crosses zero, by walking out in fine steps.
  const fine = solve({ ...opts, maxRangeYd: Math.max(zeroYd * 2, 400), stepYd: 5 });
  let crossYd = null;
  for (let i = 1; i < fine.rows.length; i++) {
    const a = fine.rows[i - 1], b = fine.rows[i];
    if (a.dropIn >= 0 && b.dropIn < 0) {
      // Linear interpolation between the bracketing steps.
      const t = a.dropIn / (a.dropIn - b.dropIn);
      crossYd = a.rangeYd + t * (b.rangeYd - a.rangeYd);
      break;
    }
  }

  const da = densityAltitude({
    tempF: newOpts.tempF,
    pressureInHg: newOpts.pressureInHg,
    elevationFt: newOpts.altitudeFt || 0,
  });
  const daShift = da != null && baseline.conditions.densityAltitudeFt != null
    ? da - baseline.conditions.densityAltitudeFt
    : null;

  const moaOff = zeroYd > 0 ? dropIn / (1.047 * (zeroYd / 100)) : 0;
  // Round once, here. The verdict string previously interpolated the raw
  // solver value and printed "crossing at 585.4726930944877 yd".
  const crossRounded = crossYd == null ? null : Math.round(crossYd);

  return {
    ok: true,
    dropIn: +dropIn.toFixed(3),
    moaOff: +moaOff.toFixed(2),
    crossYd: crossRounded,
    densityAltitudeFt: da,
    daShiftFt: daShift,
    // A tenth of a MOA is below what anyone can hold or dial reliably, so it is
    // the sensible floor for calling a shift actionable.
    matters: Math.abs(moaOff) >= 0.1,
    verdict: Math.abs(moaOff) < 0.1
      ? `Still on at ${zeroYd} yd${daShift == null ? '' : ` despite a ${daShift >= 0 ? '+' : ''}${daShift} ft density altitude change`} — ${Math.abs(dropIn).toFixed(2)}" off, under 0.1 MOA. Leave the turret alone.`
      : `${Math.abs(moaOff).toFixed(2)} MOA ${dropIn > 0 ? 'high' : 'low'} at ${zeroYd} yd${daShift == null ? '' : ` on a ${daShift >= 0 ? '+' : ''}${daShift} ft density altitude change`}${crossRounded ? `, now crossing at ${crossRounded} yd` : ''}.`,
  };
}
