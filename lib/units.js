/**
 * Unit preferences and conversion.
 *
 * The Settings toggles cycled through MOA/MRAD/Inches, F/C and fps/m/s while
 * every screen went on printing inches and Fahrenheit regardless. This makes
 * them mean something.
 *
 * Group size is the awkward one: inches is an absolute length, while MOA and
 * MRAD are angles, so converting between them needs the distance the group was
 * shot at. A formatter that silently assumed 100 yards would understate a
 * 200-yard group by half.
 */

export const GROUP_UNITS = ['MOA', 'MRAD', 'Inches'];
export const TEMP_UNITS = ['°F', '°C'];
export const VELOCITY_UNITS = ['fps', 'm/s'];
export const DISTANCE_UNITS = ['yd', 'm'];

export const DEFAULT_UNITS = {
  group: 'MOA',
  temp: '°F',
  velocity: 'fps',
  distance: 'yd',
};

// 1 MOA subtends 1.047" at 100 yd; 1 mil subtends 3.6" at 100 yd.
const IN_PER_MOA_100YD = 1.047;
const IN_PER_MIL_100YD = 3.6;
const FPS_TO_MPS = 0.3048;
const YD_TO_M = 0.9144;

/** Angular size of a length at a distance. Needs both, hence no default. */
export function inchesToUnit(inches, distanceYd, unit) {
  if (inches == null || !isFinite(inches)) return null;
  if (unit === 'Inches') return inches;
  if (!distanceYd || !isFinite(distanceYd) || distanceYd <= 0) return null;
  const per100 = unit === 'MRAD' ? IN_PER_MIL_100YD : IN_PER_MOA_100YD;
  return inches / (per100 * (distanceYd / 100));
}

export function unitToInches(value, distanceYd, unit) {
  if (value == null || !isFinite(value)) return null;
  if (unit === 'Inches') return value;
  if (!distanceYd || distanceYd <= 0) return null;
  const per100 = unit === 'MRAD' ? IN_PER_MIL_100YD : IN_PER_MOA_100YD;
  return value * (per100 * (distanceYd / 100));
}

export const fToC = (f) => (f == null || !isFinite(f) ? null : (f - 32) * 5 / 9);
export const cToF = (c) => (c == null || !isFinite(c) ? null : c * 9 / 5 + 32);
export const fpsToMps = (v) => (v == null || !isFinite(v) ? null : v * FPS_TO_MPS);
export const mpsToFps = (v) => (v == null || !isFinite(v) ? null : v / FPS_TO_MPS);
export const ydToM = (d) => (d == null || !isFinite(d) ? null : d * YD_TO_M);
export const mToYd = (d) => (d == null || !isFinite(d) ? null : d / YD_TO_M);

/**
 * Display a group size stored in inches.
 *
 * Angular units are dimensionless, so they carry no inch mark — printing
 * `1.20"` for a MOA value would be actively misleading.
 */
export function formatGroup(inches, distanceYd, unit = 'MOA', { withUnit = true } = {}) {
  const v = inchesToUnit(inches, distanceYd, unit);
  if (v == null) return '—';
  if (unit === 'Inches') return withUnit ? `${v.toFixed(2)}"` : v.toFixed(2);
  return withUnit ? `${v.toFixed(2)} ${unit}` : v.toFixed(2);
}

export function formatTemp(tempF, unit = '°F', { withUnit = true } = {}) {
  if (tempF == null || !isFinite(tempF)) return '—';
  const v = unit === '°C' ? fToC(tempF) : tempF;
  return withUnit ? `${Math.round(v)}${unit}` : String(Math.round(v));
}

export function formatVelocity(fps, unit = 'fps', { withUnit = true } = {}) {
  if (fps == null || !isFinite(fps) || fps <= 0) return '—';
  const v = unit === 'm/s' ? fpsToMps(fps) : fps;
  return withUnit ? `${Math.round(v)} ${unit}` : String(Math.round(v));
}

export function formatDistance(yd, unit = 'yd', { withUnit = true } = {}) {
  if (yd == null || !isFinite(yd)) return '—';
  const v = unit === 'm' ? ydToM(yd) : yd;
  return withUnit ? `${Math.round(v)} ${unit}` : String(Math.round(v));
}

/** Short label for a column header, where the value carries no suffix. */
export function groupUnitLabel(unit) {
  return unit === 'Inches' ? 'in' : unit;
}

// Derived from the two subtension constants so the three units stay mutually
// consistent: 3.6 / 1.047 = 3.4384 MOA per mil.
export const MOA_PER_MRAD = IN_PER_MIL_100YD / IN_PER_MOA_100YD;

/**
 * The unit an *angular* figure should actually be shown in.
 *
 * Analytics works in MOA throughout, because comparing a group shot at 100 yd
 * with one shot at 600 yd is only meaningful in angle. MOA and MRAD interconvert
 * by a constant, so either is available. Inches cannot be: it needs the distance
 * the group was shot at, and an aggregate spanning several distances has no
 * single one to use.
 *
 * Rather than silently pick a distance and be wrong, an Inches preference falls
 * back to MOA here, and the screen says so.
 */
export function angularUnit(unit) {
  return unit === 'MRAD' ? 'MRAD' : 'MOA';
}

/** True when the preference cannot be honoured for a distance-free figure. */
export function angularFallsBack(unit) {
  return unit === 'Inches';
}

export function moaToAngular(moa, unit) {
  if (moa == null || !isFinite(moa)) return null;
  return angularUnit(unit) === 'MRAD' ? moa / MOA_PER_MRAD : moa;
}

export function formatAngular(moa, unit = 'MOA', { withUnit = true, digits = 2 } = {}) {
  const v = moaToAngular(moa, unit);
  if (v == null) return '—';
  return withUnit ? `${v.toFixed(digits)} ${angularUnit(unit)}` : v.toFixed(digits);
}
