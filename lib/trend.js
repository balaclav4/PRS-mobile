/**
 * Is the shooting actually changing, or is it just noise?
 *
 * The screen this replaces answered that with `last < first`: two points out of
 * ten, each of them the smallest group of its session. Simulated against a
 * shooter whose ability never moved, it announced "Improving" 50.5% of the
 * time. Worse, because a session's minimum falls as more targets are shot, a
 * shooter who simply shot more targets later in the year was told they were
 * improving 83.8% of the time, and one who genuinely got 30% worse while doing
 * so was told the same 61.8% of the time.
 *
 * Group size is a very noisy measurement. Two five-shot groups from the same
 * rifle and load routinely differ by a factor of two, so any claim about a
 * direction needs to clear that noise before it is worth printing.
 *
 * What this does instead: fit a straight line through every group against its
 * session index, and report the slope with a confidence interval. When the
 * interval spans zero, the honest answer is that nothing is detectable, and
 * saying so is a result rather than a failure - "your groups have not changed"
 * is exactly what a shooter chasing a phantom trend needs to hear.
 *
 * Two deliberate departures from the old behaviour:
 *
 *   Every group is a point, not each session's best. A minimum over k draws is
 *   biased downward by an amount that depends on k, so a series of per-session
 *   minima confounds "shot better" with "shot more".
 *
 *   Sessions are ordered by date, and the x axis is the session index rather
 *   than the raw timestamp. Ordinary least squares against calendar time would
 *   let one long winter gap dominate the fit.
 *
 *   The fit is on the logarithm of group size. A group is a scale quantity: its
 *   spread grows in proportion to its size, so logs stabilise the variance and
 *   make the reported figure a percentage per session rather than MOA per
 *   session, which is closer to how a change in shooting is experienced.
 *
 *   Note on what this did NOT fix. It was introduced believing linear space
 *   favoured detecting improvement, on the evidence that a x0.6 change was
 *   caught 82% of the time and a x1.5 change 66%. That gap was the test's
 *   fault: |log 0.6| is 0.511 and |log 1.5| is 0.405, so the improvement was
 *   simply the larger effect. Against reciprocal effects the two directions
 *   come out level in either space. The change is kept for the unit and the
 *   variance, not for a bias it never removed.
 */
import { tCritical } from './stats.js';

/**
 * Ordinary least squares with a confidence interval on the slope.
 *
 * Standard textbook result; written out rather than pulled in because the
 * interval, not the slope, is the part that decides what the screen says.
 */
export function regress(xs, ys, conf = 0.95) {
  const n = xs.length;
  if (n < 3) return null;

  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;

  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  // Every group came from the same session: there is no spread in x to fit to.
  if (sxx <= 0) return null;

  const slope = sxy / sxx;
  const intercept = my - slope * mx;

  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - (intercept + slope * xs[i])) ** 2;
  const df = n - 2;
  if (df < 1) return null;

  const se = Math.sqrt(sse / df / sxx);
  const t = tCritical(df, conf);
  return {
    slope, intercept, n, df,
    stdErr: se,
    lo: slope - t * se,
    hi: slope + t * se,
    // Fraction of the variance the line accounts for. Reported but never used
    // as the verdict: a tight fit to a meaningless slope is still meaningless.
    r2: (() => {
      let sst = 0;
      for (const y of ys) sst += (y - my) ** 2;
      return sst > 0 ? Math.max(0, 1 - sse / sst) : 0;
    })(),
  };
}

/**
 * Every group, tagged with the index of the session it was fired in.
 *
 * Sessions are sorted oldest first so the index is chronological, and a session
 * that produced several targets contributes several points - which is the whole
 * correction over taking each session's best.
 */
export function groupSeries(sessions, toGroups) {
  const ordered = [...(sessions || [])]
    .filter(Boolean)
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

  const xs = [], ys = [], perSession = [];
  ordered.forEach((s, i) => {
    const gs = (toGroups(s) || []).filter(g => isFinite(g) && g > 0);
    perSession.push({ session: s, count: gs.length });
    for (const g of gs) { xs.push(i); ys.push(g); }
  });
  return { xs, ys, perSession, sessionCount: ordered.length };
}

/**
 * The verdict, in the shooter's own units, per session.
 *
 * `level` is what the screen colours on. 'flat' is a real answer and not an
 * absence of one, so it is worded as a finding.
 */
export function assessTrend(sessions, toGroups, { conf = 0.95 } = {}) {
  const { xs, ys, perSession, sessionCount } = groupSeries(sessions, toGroups);

  if (sessionCount < 3 || xs.length < 4) {
    return {
      level: 'insufficient', groups: xs.length, sessions: sessionCount,
      text: `Not enough yet to say. ${xs.length} group${xs.length === 1 ? '' : 's'} across ${sessionCount} session${sessionCount === 1 ? '' : 's'}; a direction needs at least three sessions and four groups before it means anything.`,
    };
  }

  const uniqueX = new Set(xs).size;
  if (uniqueX < 3) {
    return {
      level: 'insufficient', groups: xs.length, sessions: sessionCount,
      text: `All of these groups come from ${uniqueX} session${uniqueX === 1 ? '' : 's'}. A trend needs shooting spread over time, not more targets on one day.`,
    };
  }

  const fit = regress(xs, ys.map(Math.log), conf);
  if (!fit) {
    return { level: 'insufficient', groups: xs.length, sessions: sessionCount,
             text: 'Not enough spread in the data to fit a trend.' };
  }

  // A slope in log space is a proportional rate: exp(b) - 1 per session.
  const pct = (b) => (Math.exp(b) - 1) * 100;
  const perSess = pct(fit.slope);
  const mag = Math.abs(perSess);
  const spansZero = fit.lo <= 0 && fit.hi >= 0;

  if (spansZero) {
    // The most likely honest answer, and the one the old screen could never
    // give. The bound is what makes it useful: it says how big a change would
    // have had to be to show up.
    const bound = Math.max(Math.abs(pct(fit.lo)), Math.abs(pct(fit.hi)));
    return {
      level: 'flat', pctPerSession: perSess, lo: pct(fit.lo), hi: pct(fit.hi),
      n: xs.length, sessions: sessionCount,
      text: `No detectable change across ${sessionCount} sessions. A shift bigger than about ${bound.toFixed(1)}% per session would have shown up in ${xs.length} groups, so if your shooting is moving it is moving slower than that.`,
    };
  }

  const improving = perSess < 0;
  return {
    level: improving ? 'improving' : 'worsening',
    pctPerSession: perSess, lo: pct(fit.lo), hi: pct(fit.hi),
    n: xs.length, sessions: sessionCount,
    text: improving
      ? `Groups are tightening by about ${mag.toFixed(1)}% per session, and the confidence interval stays below zero across ${xs.length} groups, so this is more than noise.`
      : `Groups are opening by about ${mag.toFixed(1)}% per session, and the confidence interval stays above zero across ${xs.length} groups, so this is more than noise.`,
  };
}
