/**
 * Chronograph string import.
 *
 * Every chronograph app exports a different shape — bare velocities one per
 * line, "shot, velocity" pairs, CSV with a header row, comma-separated runs,
 * values with units attached. Rather than support a fixed list of formats,
 * this pulls every number out and keeps the ones that could plausibly be a
 * muzzle velocity, which drops shot indices and header text without needing
 * to recognise them.
 *
 * Nothing is imported silently: the caller is expected to show what was parsed
 * and what was discarded before committing it to a session.
 */

// Below this a number is a shot index or a row count, not a velocity. Above it
// is beyond any small arm. Subsonic .22 (~1050) and .220 Swift (~4000) both sit
// comfortably inside.
const MIN_FPS = 300;
const MAX_FPS = 5000;
const MPS_TO_FPS = 3.280839895;

/**
 * @param text raw pasted string
 * @param unit 'fps' | 'mps' — m/s values overlap the fps index range, so the
 *             unit is asked for rather than guessed
 * @returns { velocities, rejected, unit }
 */
export function parseVelocities(text, unit = 'fps') {
  if (!text || typeof text !== 'string') return { velocities: [], rejected: [], unit };

  // Any signed decimal, ignoring surrounding punctuation and unit suffixes.
  const raw = (text.match(/-?\d+(?:\.\d+)?/g) || []).map(Number).filter(isFinite);

  const velocities = [];
  const rejected = [];
  for (const n of raw) {
    const fps = unit === 'mps' ? n * MPS_TO_FPS : n;
    if (fps >= MIN_FPS && fps <= MAX_FPS) velocities.push(+fps.toFixed(1));
    else rejected.push(n);
  }
  return { velocities, rejected, unit };
}

/**
 * Velocity statistics for a string.
 *
 * SD is the number handloaders chase, and at typical string lengths it is far
 * less certain than its two decimal places suggest — the SE of an SD estimate
 * is roughly sigma/sqrt(2(n-1)), which for a 5-shot string is about a third of
 * the SD itself. It is reported so the UI can show it.
 */
export function velocityStats(velocities) {
  const n = velocities.length;
  if (n === 0) return null;

  const mean = velocities.reduce((a, b) => a + b, 0) / n;
  const min = Math.min(...velocities);
  const max = Math.max(...velocities);

  if (n < 2) {
    return { n, mean, min, max, es: 0, sd: null, sdSe: null, weak: true };
  }

  const sd = Math.sqrt(velocities.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1));

  return {
    n,
    mean: +mean.toFixed(1),
    sd: +sd.toFixed(1),
    es: +(max - min).toFixed(1),
    min,
    max,
    sdSe: +(sd / Math.sqrt(2 * (n - 1))).toFixed(1),
    // Under ~10 shots the SD estimate is too loose to rank loads by.
    weak: n < 10,
  };
}

/** One-line summary of how trustworthy the SD is at this string length. */
// Velocity figures are stored canonically in fps; this renders one in whatever
// unit the shooter reads. Kept local so lib/chrono.js has no UI dependency.
const fmt = (v, unit) =>
  unit === 'm/s' ? `${(v * 0.3048).toFixed(1)} m/s` : `${v} fps`;

export function sdConfidenceNote(stats, unit = 'fps') {
  if (!stats || stats.sd == null) return null;
  if (!stats.weak) return null;
  return `SD from ${stats.n} shots is ±${fmt(stats.sdSe, unit)} — too loose to rank loads by on its own. 10+ shots tightens it.`;
}
