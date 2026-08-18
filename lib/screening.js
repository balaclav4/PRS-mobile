/**
 * Component screening — load dev step 2.
 *
 * A screen puts several powder and bullet combinations across the chronograph
 * and target, one group each, to decide what is worth developing further. The
 * instinct is to rank them and take the winner. With one group per candidate
 * that ranking is mostly noise: a 5-shot group carries a 27% relative standard
 * deviation, and the best of six candidates is expected to land about 1.27
 * sigma below the middle by chance alone even if every combination is identical.
 *
 * So this module does not crown a winner, and says so. What a screen can do
 * honestly is the opposite job: eliminate. Deciding that a combination is much
 * worse than the rest is a far easier call than deciding one is best, because
 * it takes a large gap in the direction that a single group is least likely to
 * produce by accident.
 *
 * The output is therefore two lists — combinations the data can rule out, and
 * combinations to carry forward, deliberately left unranked. Ranking the
 * survivors would put back exactly the false precision this step exists to
 * strip out.
 */

import { esCoefficientOfVariation, normalQuantile } from './seating.js';

/** Clean UI rows into numeric candidates. */
export function parseCandidates(rows) {
  return (rows || [])
    .map(r => ({
      id: r.id,
      name: (r.name || '').trim(),
      groupMoa: r.groupMoa === '' || r.groupMoa == null ? null : parseFloat(r.groupMoa),
      velocitySd: r.velocitySd === '' || r.velocitySd == null ? null : parseFloat(r.velocitySd),
    }))
    .filter(r => r.name && r.groupMoa != null && isFinite(r.groupMoa) && r.groupMoa > 0);
}

/**
 * Screen candidates, eliminating only what the data can actually rule out.
 *
 * @param candidates     parsed rows
 * @param shotsPerGroup  shots behind each group
 * @param noun           what the rows are, for the messages — step 4 screens
 *                       charges through the same analysis, not combinations
 */
export function analyseScreen(candidates, shotsPerGroup = 5, noun = 'combinations', unit = 'MOA') {
  if (!candidates || candidates.length < 3) {
    return { ok: false, reason: `Add at least 3 ${noun} with a group size each.` };
  }

  const n = Number(shotsPerGroup);
  const shots = isFinite(n) && n >= 2 ? n : 5;
  const k = candidates.length;

  const sizes = candidates.map(c => c.groupMoa);
  const sorted = [...sizes].sort((a, b) => a - b);
  // Median, for the same reason the seating step uses it: a standout in either
  // direction must not move the level it is being compared against.
  const level = k % 2
    ? sorted[(k - 1) / 2]
    : (sorted[k / 2 - 1] + sorted[k / 2]) / 2;

  const cv = esCoefficientOfVariation(shots) ?? 0.27;
  const sigma = level * cv;

  // k candidates means k comparisons, so the threshold is corrected for having
  // looked at all of them. Without this, screening six combinations would
  // discard one roughly a quarter of the time with nothing wrong.
  const zCrit = normalQuantile(1 - 0.05 / k);

  // The level is a median of the same k numbers, not a known constant, and it
  // carries its own sampling error — variance about sigma^2 * pi/(2k). Ignoring
  // it left the measured false-elimination rate at 9.2% against a nominal 5%,
  // because a run where the median came in low dragged the cutoff down with it.
  const se = sigma * Math.sqrt(1 + Math.PI / (2 * k));
  const cutoff = level + zCrit * se;

  const scored = candidates.map(c => ({
    ...c,
    z: se > 0 ? +((c.groupMoa - level) / se).toFixed(2) : 0,
    eliminated: se > 0 && c.groupMoa > cutoff,
  }));

  const eliminated = scored.filter(c => c.eliminated);
  const carryForward = scored.filter(c => !c.eliminated);

  // What the screen would have to see before it could name a winner — reported
  // so the shooter knows the ranking they can see is not one.
  const bestSeen = scored.reduce((a, b) => (b.groupMoa < a.groupMoa ? b : a));

  const parts = [];
  if (eliminated.length) {
    parts.push(`${eliminated.map(c => c.name).join(', ')} ${eliminated.length === 1 ? 'is' : 'are'} far enough above the ${level.toFixed(2)} ${unit} middle to rule out across ${k} comparisons. Drop ${eliminated.length === 1 ? 'it' : 'them'}.`);
  } else {
    parts.push(`Nothing here is bad enough to rule out. All ${k} ${noun} sit within the scatter a ${shots}-shot group produces on its own.`);
  }
  parts.push(`${carryForward.length} to carry forward, deliberately unranked: ${bestSeen.name} measured smallest at ${bestSeen.groupMoa} ${unit}, but with one group each the order among the survivors is mostly noise. Take them all to the charge ladder, or shoot more of each before choosing.`);

  return {
    ok: true,
    level: +level.toFixed(3),
    sigma: +sigma.toFixed(3),
    se: +se.toFixed(3),
    cv: +cv.toFixed(3),
    cutoff: +cutoff.toFixed(3),
    shots,
    scored,
    eliminated,
    carryForward,
    // Never a recommendation. Screening does not produce one.
    winner: null,
    verdict: parts.join(' '),
  };
}
