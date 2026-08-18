/**
 * Velocity moves with ammunition temperature.
 *
 * Powder burn rate depends on the temperature of the propellant when the primer
 * lights it, so a load chronographed at 70°F does not leave the muzzle at the
 * same speed on a 25°F morning. The size varies enormously by powder: the
 * temperature-stable extruded powders sold for exactly this reason sit near a
 * tenth of a foot per second per degree, and older or less stable powders run
 * several times that. Over a 60 degree swing between a summer load workup and a
 * winter match, a bad powder is worth enough velocity to miss with at distance.
 *
 * This app does not ship a table of powders. It cannot: the sensitivity of a
 * given powder in a given case with a given charge is a measurement, it varies
 * by lot, and the only figure worth using is the shooter's own. What it can do
 * is turn two chronograph sessions at different temperatures into a number, and
 * then apply that number - which is a thing they already have the data for and
 * no way to use.
 *
 * The refusals matter more than the arithmetic:
 *
 *  - two points measured a few degrees apart cannot resolve a slope, because
 *    ordinary shot-to-shot spread swamps the difference;
 *  - a slope fitted from two averages says nothing about confidence, so where
 *    the spread of the strings is known it is compared against the difference
 *    being claimed;
 *  - and a sensitivity far outside what any real powder does is reported as
 *    suspect rather than used, because it is nearly always a mislabelled
 *    temperature or a chronograph error.
 */

/** Above this, a claimed sensitivity is more likely an error than a powder. */
const IMPLAUSIBLE_FPS_PER_F = 4;

/** Below this temperature separation, ordinary spread swamps the signal. */
const MIN_SPAN_F = 20;

/**
 * Fit fps per degree from observations.
 *
 * @param points [{ tempF, mvFps, sdFps?, shots? }]
 *
 * Least squares when there are three or more, because a shooter who has
 * chronographed across a season should get the benefit of all of it. Two points
 * are a straight difference, and are reported as the weaker evidence they are.
 */
export function fitPowderTemp(points = []) {
  const pts = (points || [])
    .map(p => ({
      tempF: Number(p.tempF),
      mvFps: Number(p.mvFps),
      sdFps: Number(p.sdFps),
      shots: Number(p.shots),
    }))
    .filter(p => isFinite(p.tempF) && isFinite(p.mvFps) && p.mvFps > 0);

  if (pts.length < 2) {
    return { ok: false, reason: 'Two chronograph sessions at different temperatures are needed to measure this.' };
  }

  const temps = pts.map(p => p.tempF);
  const span = Math.max(...temps) - Math.min(...temps);
  if (span < MIN_SPAN_F) {
    return {
      ok: false,
      reason: `Those sessions are only ${span.toFixed(0)}°F apart. Shot-to-shot spread swamps the difference over a span that small — measure again at least ${MIN_SPAN_F}°F apart.`,
    };
  }

  // Ordinary least squares on velocity against temperature.
  const n = pts.length;
  const mt = temps.reduce((a, b) => a + b, 0) / n;
  const mv = pts.reduce((a, p) => a + p.mvFps, 0) / n;
  let sxy = 0, sxx = 0;
  for (const p of pts) {
    sxy += (p.tempF - mt) * (p.mvFps - mv);
    sxx += (p.tempF - mt) ** 2;
  }
  if (sxx <= 0) return { ok: false, reason: 'Every session is at the same temperature.' };
  const slope = sxy / sxx;
  const intercept = mv - slope * mt;

  // Is the velocity difference bigger than the noise it was measured through?
  // With SDs recorded, the standard error of each mean is sd/sqrt(shots), and
  // the difference has to clear the combined error to mean anything.
  let confident = null;
  const withSd = pts.filter(p => isFinite(p.sdFps) && p.sdFps > 0 && p.shots > 1);
  if (withSd.length >= 2) {
    const lo = pts.reduce((a, b) => (b.tempF < a.tempF ? b : a));
    const hi = pts.reduce((a, b) => (b.tempF > a.tempF ? b : a));
    if (isFinite(lo.sdFps) && isFinite(hi.sdFps) && lo.shots > 1 && hi.shots > 1) {
      const se = Math.sqrt((lo.sdFps ** 2) / lo.shots + (hi.sdFps ** 2) / hi.shots);
      const diff = Math.abs(hi.mvFps - lo.mvFps);
      confident = se > 0 ? diff / se >= 2 : null;
    }
  }

  const magnitude = Math.abs(slope);
  return {
    ok: true,
    fpsPerF: +slope.toFixed(3),
    intercept,
    points: n,
    spanF: +span.toFixed(0),
    /** Two points is a difference, not a fit. Said, rather than implied. */
    weak: n === 2,
    confident,
    implausible: magnitude > IMPLAUSIBLE_FPS_PER_F,
    text: describe(slope, n, span, confident),
  };
}

function describe(slope, n, span, confident) {
  const m = Math.abs(slope);
  const dir = slope >= 0 ? 'faster as it warms' : 'slower as it warms';
  if (m > IMPLAUSIBLE_FPS_PER_F) {
    return `That works out at ${m.toFixed(2)} fps per degree, which is far outside what any powder does. Check the temperatures are the ammunition's rather than the air's, and that the chronograph readings belong to the sessions they are filed under.`;
  }
  const base = `${m.toFixed(2)} fps per degree, ${dir}, from ${n} session${n === 1 ? '' : 's'} spanning ${span.toFixed(0)}°F.`;
  const grade = m < 0.4
    ? ' That is temperature-stable — a 40 degree swing costs less than a typical extreme spread.'
    : m < 1.2
      ? ' Ordinary. Worth carrying a correction for a match in a different season.'
      : ' Sensitive. A cold morning on a load worked up in summer will land low, and the difference is dial-able rather than negligible.';
  const caveat = n === 2
    ? ' Two sessions is a difference rather than a fit; a third at an intermediate temperature would show whether it is really a straight line.'
    : '';
  const conf = confident === false
    ? ' The velocity difference is not clear of the spread in those strings, so treat this as provisional.'
    : '';
  return base + grade + caveat + conf;
}

/**
 * Muzzle velocity at a temperature, given a measured sensitivity.
 *
 * `refTempF` is the temperature the reference velocity was measured at, not a
 * standard: correcting to 59°F when the chronograph session was at 85°F would
 * silently move the load's baseline.
 */
export function velocityAt({ mvFps, refTempF, tempF, fpsPerF } = {}) {
  const v = Number(mvFps), r = Number(refTempF), t = Number(tempF), k = Number(fpsPerF);
  if (!isFinite(v) || !isFinite(r) || !isFinite(t) || !isFinite(k)) return null;
  return v + k * (t - r);
}
