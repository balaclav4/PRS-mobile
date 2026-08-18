import { twoSampleTTest } from './math.js';
import { welchCompare, varianceCompare, dispersion, hitProbability, bootstrapDiff, mean, sd } from './stats.js';

// Extreme spread of a target's shots, in normalized image units.
function esNorm(shots) {
  let max = 0;
  for (let i = 0; i < shots.length; i++) {
    for (let j = i + 1; j < shots.length; j++) {
      const d = Math.hypot(shots[i].x - shots[j].x, shots[i].y - shots[j].y);
      if (d > max) max = d;
    }
  }
  return max;
}

function centroid(shots) {
  const cx = shots.reduce((a, s) => a + s.x, 0) / shots.length;
  const cy = shots.reduce((a, s) => a + s.y, 0) / shots.length;
  return { cx, cy };
}

export function moaFromInches(inches, distanceYd) {
  if (!distanceYd) return 0;
  return inches / (1.047 * (distanceYd / 100));
}

/**
 * Recover the session's inches-per-normalized-unit scale.
 *
 * Targets store shots in normalized image coords only, but the session records
 * `best` — the smallest target group, in inches. Since every target in a session
 * shares one photo scale, that pins the scale for all of them:
 *   inchesPerUnit = bestIn / min(esNorm over targets)
 */
function sessionScale(session) {
  const bestIn = parseFloat(session.best);
  if (!isFinite(bestIn) || !session.targets?.length) return null;

  const spreads = session.targets
    .filter(t => t.shots?.length >= 2)
    .map(t => esNorm(t.shots))
    .filter(v => v > 0);

  if (!spreads.length) return null;
  const minSpread = Math.min(...spreads);
  return bestIn / minSpread;
}

/** Per-target group sizes for a session, in inches and MOA. */
export function targetGroups(session) {
  const scale = sessionScale(session);
  if (!scale) return [];

  return session.targets
    .filter(t => t.shots?.length >= 2)
    .map(t => {
      const inches = esNorm(t.shots) * scale;
      return {
        id: t.id,
        shots: t.shots,
        inches,
        moa: moaFromInches(inches, session.distanceYd),
      };
    });
}

/** Shot offsets from the group centroid, expressed in MOA. */
export function shotsAsMoa(session, target) {
  const scale = sessionScale(session);
  if (!scale || !target?.shots?.length) return [];
  const { cx, cy } = centroid(target.shots);
  return target.shots.map(s => ({
    x: moaFromInches((s.x - cx) * scale, session.distanceYd),
    y: moaFromInches((s.y - cy) * scale, session.distanceYd),
  }));
}

function parseDate(d) {
  const t = Date.parse(d);
  return isFinite(t) ? t : 0;
}

/**
 * Derive every analytics figure from real session data.
 * `filter` is 'all' or a rifle name.
 */
export function deriveAnalytics(sessions, rifles, loads, filter = 'all') {
  const rifleByName = {};
  rifles.forEach(r => { rifleByName[r.name] = r.id; });

  const scoped = filter === 'all'
    ? sessions
    : sessions.filter(s => s.rifleId === rifleByName[filter]);

  const ordered = [...scoped].sort((a, b) => parseDate(a.date) - parseDate(b.date));

  // Every target is one independent group.
  const groups = [];
  ordered.forEach(s => targetGroups(s).forEach(g => groups.push({ ...g, session: s })));

  const rounds = scoped.reduce(
    (a, s) => a + (s.targets?.reduce((b, t) => b + (t.shots?.length || 0), 0) || 0),
    0
  );

  const avg = groups.length
    ? groups.reduce((a, g) => a + g.moa, 0) / groups.length
    : null;

  // Trend: one point per session (its best group, in MOA), oldest → latest.
  const trend = ordered
    .map(s => {
      const g = targetGroups(s);
      return g.length ? Math.min(...g.map(x => x.moa)) : null;
    })
    .filter(v => v != null);

  // Shot distribution: the tightest group of the most recent session that has
  // one.
  //
  // Reading only the last session meant the card went blank whenever the newest
  // one happened to hold no measured group - ten sessions on file and a
  // full-size plot showing "No group recorded", for a reason the shooter could
  // not deduce. Walking back finds something to show, and `plotSessionId` lets
  // the screen name which session it settled on rather than implying it is the
  // latest.
  let moaShots = [];
  let latestShots = 0;
  let latestGroup = null;
  let plotSession = null;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const g = targetGroups(ordered[i]);
    if (!g.length) continue;
    const best = g.reduce((a, b) => (b.moa < a.moa ? b : a));
    moaShots = shotsAsMoa(ordered[i], best);
    latestShots = best.shots.length;
    latestGroup = best.inches;
    plotSession = ordered[i];
    break;
  }

  return {
    plotSessionName: plotSession?.name ?? null,
    plotSessionDate: plotSession?.date ?? null,
    plotIsLatest: plotSession ? plotSession === ordered[ordered.length - 1] : true,
    avg,
    rounds,
    trend,
    moaShots,
    latestShots,
    latestGroup,
    sessionCount: scoped.length,
    comparison: compareLoads(scoped, loads),
  };
}

/**
 * Bucket every recorded group by load, rifle or session so the user can pick
 * which two to compare. Each target is one group, which is the independent
 * unit — pooling raw shots would inflate n and shrink p-values dishonestly.
 */
export function comparisonBuckets(sessions, rifles, loads, dimension) {
  const buckets = new Map();

  const labelFor = (s) => {
    if (dimension === 'rifles') {
      const r = rifles.find(x => x.id === s.rifleId);
      return r ? { key: r.id, label: r.name, sub: r.cartridge } : null;
    }
    if (dimension === 'sessions') return { key: s.id, label: s.name, sub: s.date };
    const l = loads.find(x => x.id === s.loadId);
    return l ? { key: l.id, label: l.name, sub: l.caliber } : null;
  };

  sessions.forEach(s => {
    const id = labelFor(s);
    if (!id) return;
    const groups = targetGroups(s);
    if (!groups.length) return;

    const existing = buckets.get(id.key) ||
      { key: id.key, label: id.label, sub: id.sub, groups: [], moaOffsets: [], targetCount: 0 };

    // MOA, not inches. Group sizes get compared across sessions shot at
    // different distances, and inches conflate precision with range: the seed
    // .308 string reads 0.85" at 200yd vs 0.51" at 100yd, which looks worse
    // but is angularly tighter (0.41 vs 0.49 MOA). Every metric on this screen
    // is therefore angular.
    existing.groups.push(...groups.map(g => g.moa));
    existing.targetCount += groups.length;
    // Shot offsets from each target's own centroid, in MOA. These are the
    // shot-level samples used for sigma/CEP; group sizes above stay the
    // group-level samples used for the t-test.
    groups.forEach(g => existing.moaOffsets.push(...shotsAsMoa(s, g)));
    buckets.set(id.key, existing);
  });

  return [...buckets.values()]
    .map(b => ({ ...b, n: b.groups.length }))
    .sort((a, b) => b.n - a.n);
}

/**
 * Full comparison of two buckets.
 *
 * Reports the group-size test (unit = group) and the shot dispersion
 * (unit = shot) separately, because they answer different questions and have
 * different sample sizes. See lib/stats.js for why conflating them is wrong.
 *
 * @param plateMoa target size used for the hit-probability estimate
 */
export function compareBuckets(a, b, plateMoa = 2, unit = 'MOA') {
  // Everything here is computed in MOA; `unit` only decides how the verdict
  // reads. MRAD is a constant factor away, so the figures convert with it.
  const cv = (moa) => (unit === 'MRAD' ? moa / 3.4384 : moa).toFixed(2);
  if (!a || !b) return { error: 'Pick two things to compare.' };
  if (a.n < 2 || b.n < 2) {
    return { error: `Need at least 2 recorded groups on each side — ${a.label} has ${a.n}, ${b.label} has ${b.n}.` };
  }

  const ma = mean(a.groups), mb = mean(b.groups);
  // Order so the tighter side reads as the winner throughout.
  const [hi, lo] = ma <= mb ? [b, a] : [a, b];

  const w = welchCompare(hi.groups, lo.groups);
  const variance = varianceCompare(hi.groups, lo.groups);
  // Directional confidence only — the interval shown is Welch's, which covers
  // better than the bootstrap at these sample sizes (see lib/stats.js).
  const boot = bootstrapDiff(hi.groups, lo.groups);

  const side = (bucket) => {
    const d = dispersion(bucket.moaOffsets, bucket.targetCount);
    return {
      label: bucket.label,
      sub: bucket.sub,
      n: bucket.n,
      shots: bucket.moaOffsets.length,
      mean: mean(bucket.groups),
      sd: sd(bucket.groups),
      moaOffsets: bucket.moaOffsets,
      dispersion: d,
      hitPct: d ? hitProbability(d.sigma, plateMoa / 2) * 100 : null,
    };
  };

  const A = side(hi), B = side(lo);

  let verdict;
  if (!w) {
    verdict = 'Not enough data to run the test.';
  } else if (w.significant) {
    const lo = Math.min(Math.abs(w.ci[0]), Math.abs(w.ci[1]));
    const hi = Math.max(Math.abs(w.ci[0]), Math.abs(w.ci[1]));
    verdict = `${B.label} is tighter by ${cv(Math.abs(w.diff))} ${unit} on average (p=${fmtP(w.p)}). The true difference is likely between ${cv(lo)} and ${cv(hi)} ${unit}.`;
  } else {
    verdict = `No significant difference (p=${fmtP(w.p)}). The ${cv(Math.abs(w.diff))} ${unit} gap is within normal group-to-group variation` +
      (w.requiredN ? ` — you would need about ${w.requiredN} groups per side to settle a difference this size.` : '.');
  }

  return { error: null, a: A, b: B, welch: w, variance, boot, verdict, plateMoa };
}

/** p-values below the resolution of the wording get an explicit bound. */
export function fmtP(p) {
  if (p == null) return '—';
  if (p < 0.001) return '<0.001';
  return p.toFixed(3);
}

/**
 * Two-sample t-test between the two loads with the most recorded groups.
 * Returns null when there isn't enough data to say anything honest.
 */
export function compareLoads(sessions, loads) {
  const byLoad = new Map();
  sessions.forEach(s => {
    if (!s.loadId) return;
    const g = targetGroups(s).map(x => x.inches);
    if (!g.length) return;
    byLoad.set(s.loadId, (byLoad.get(s.loadId) || []).concat(g));
  });

  const ranked = [...byLoad.entries()]
    .filter(([, g]) => g.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);

  if (ranked.length < 2) {
    return { insufficient: true, needed: 'Two loads with 2+ recorded groups each' };
  }

  const nameOf = (id) => loads.find(l => l.id === id)?.name || 'Unknown load';
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

  // Present the tighter load second so it reads as the winner.
  let [a, b] = ranked.slice(0, 2);
  if (mean(a[1]) < mean(b[1])) [a, b] = [b, a];

  const test = twoSampleTTest(a[1], b[1]);

  return {
    insufficient: false,
    a: { name: nameOf(a[0]), mean: mean(a[1]), n: a[1].length },
    b: { name: nameOf(b[0]), mean: mean(b[1]), n: b[1].length },
    test,
  };
}
