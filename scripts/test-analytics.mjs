/**
 * Validates the analytics layer.
 *
 * Two properties matter more than the arithmetic.
 *
 * The unit of replication: a t-test on group sizes must count groups, not
 * shots. Pooling five-shot groups into a pile of shots would quintuple n and
 * shrink every p-value dishonestly, and the mistake is invisible in the output
 * — the number just looks more significant. It is asserted directly here.
 *
 * And the choice of angle over length: group sizes are compared across sessions
 * shot at different distances, where inches conflate precision with range. The
 * module docstring cites a specific case, and that case is checked rather than
 * trusted.
 *
 * Run: node scripts/test-analytics.mjs
 */
import {
  moaFromInches, targetGroups, shotsAsMoa, deriveAnalytics,
  comparisonBuckets, compareBuckets, fmtP, compareLoads,
} from '../lib/analytics.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(54) + detail);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// A square group of side `s` in normalised units: extreme spread is the
// diagonal, s*sqrt(2), which makes every expected value hand-checkable.
const square = (id, s, cx = 0.5, cy = 0.5) => ({
  id,
  shots: [
    { x: cx - s / 2, y: cy - s / 2 }, { x: cx + s / 2, y: cy - s / 2 },
    { x: cx + s / 2, y: cy + s / 2 }, { x: cx - s / 2, y: cy + s / 2 },
  ],
});

const session = (over) => ({
  id: 's1', name: 'Test', date: 'Jan 1, 2026', rifleId: 'r1', loadId: 'l1',
  distanceYd: 100, best: '1.00', targets: [square('t1', 0.1)], ...over,
});

console.log('angular conversion');
{
  check('  1.047" at 100 yd is 1 MOA', near(moaFromInches(1.047, 100), 1, 1e-9));
  check('  the same length at 200 yd is half', near(moaFromInches(1.047, 200), 0.5, 1e-9));
  check('  no distance is guarded, not NaN', moaFromInches(1, 0) === 0);
}

console.log('\nscale recovery from the session best');
{
  // Targets store normalised coords only. The session's `best` (inches) pins
  // the scale for every target, because they share one photo.
  const s = session({
    best: '1.00',
    targets: [square('t1', 0.1), square('t2', 0.2)],
  });
  const g = targetGroups(s);
  check('  the tightest target comes back at exactly `best`',
    near(g[0].inches, 1.0, 1e-9), `${g[0].inches.toFixed(3)}"`);
  check('  and a doubled spread is doubled inches',
    near(g[1].inches, 2.0, 1e-9), `${g[1].inches.toFixed(3)}"`);
  check('  MOA follows from the distance',
    near(g[0].moa, 1 / 1.047, 1e-9), g[0].moa.toFixed(3));

  check('  single-shot targets are dropped',
    targetGroups(session({ targets: [square('t1', 0.1), { id: 't2', shots: [{ x: 0.5, y: 0.5 }] }] })).length === 1);
  check('  a session with no usable best is empty',
    targetGroups(session({ best: '—' })).length === 0);
  check('  no targets is safe', targetGroups(session({ targets: [] })).length === 0);
}

console.log('\nangle beats length across distances');
{
  // Straight from the module docstring: 0.85" at 200 yd is angularly tighter
  // than 0.51" at 100 yd, even though it is the larger number.
  const near100 = moaFromInches(0.51, 100);
  const far200 = moaFromInches(0.85, 200);
  check('  0.51" at 100 yd is 0.49 MOA', near(near100, 0.487, 0.005), near100.toFixed(3));
  check('  0.85" at 200 yd is 0.41 MOA', near(far200, 0.406, 0.005), far200.toFixed(3));
  check('  so the bigger group is the tighter shooter', far200 < near100,
    'which is why every figure on the screen is angular');
}

console.log('\nshot offsets are recentred');
{
  const s = session({ targets: [square('t1', 0.2, 0.3, 0.7)] });
  const offs = shotsAsMoa(s, s.targets[0]);
  const sx = offs.reduce((a, o) => a + o.x, 0);
  const sy = offs.reduce((a, o) => a + o.y, 0);
  check('  offsets sum to zero about the centroid',
    near(sx, 0, 1e-9) && near(sy, 0, 1e-9), `(${sx.toExponential(1)}, ${sy.toExponential(1)})`);
  check('  and are independent of where the group sat on the sheet',
    near(offs[0].x, shotsAsMoa(session({ targets: [square('t1', 0.2, 0.8, 0.2)] }),
      square('t1', 0.2, 0.8, 0.2))[0].x, 1e-9));
  check('  a missing target is safe', shotsAsMoa(s, null).length === 0);
}

console.log('\nderived figures');
{
  const sessions = [
    session({ id: 'a', date: 'Jan 3, 2026', best: '1.00', targets: [square('t1', 0.1)] }),
    session({ id: 'b', date: 'Jan 1, 2026', best: '2.00', targets: [square('t2', 0.1)] }),
    session({ id: 'c', date: 'Jan 2, 2026', best: '1.50', targets: [square('t3', 0.1)] }),
  ];
  const rifles = [{ id: 'r1', name: 'Rifle One' }];
  const d = deriveAnalytics(sessions, rifles, []);

  check('  counts every session', d.sessionCount === 3);
  check('  counts every shot', d.rounds === 12, `${d.rounds} rounds`);
  check('  averages the groups', near(d.avg, moaFromInches(1.5, 100), 1e-9), d.avg.toFixed(3));

  // The trend must read oldest to latest regardless of array order.
  check('  the trend is chronological, not array order',
    d.trend.length === 3 && d.trend[0] > d.trend[1] && d.trend[1] > d.trend[2],
    d.trend.map(v => v.toFixed(2)).join(' -> '));

  check('  the distribution comes from the latest session',
    d.latestShots === 4 && near(d.latestGroup, 1.0, 1e-9), `${d.latestGroup}" on Jan 3`);

  const filtered = deriveAnalytics(sessions, rifles, [], 'Rifle One');
  check('  filtering by rifle name works', filtered.sessionCount === 3);
  check('  an unknown rifle filters to nothing',
    deriveAnalytics(sessions, rifles, [], 'Nope').sessionCount === 0);
  check('  no sessions is safe',
    deriveAnalytics([], rifles, []).avg === null);
}

console.log('\nthe unit of replication');
{
  // Four targets of five shots each. The t-test must see 4, not 20.
  const five = (id, cx) => ({
    id, shots: [
      { x: cx, y: 0.50 }, { x: cx + 0.05, y: 0.52 }, { x: cx + 0.02, y: 0.55 },
      { x: cx - 0.03, y: 0.48 }, { x: cx + 0.01, y: 0.51 },
    ],
  });
  const s = session({ targets: [five('t1', 0.3), five('t2', 0.4), five('t3', 0.5), five('t4', 0.6)] });
  const buckets = comparisonBuckets([s], [{ id: 'r1', name: 'R' }], [{ id: 'l1', name: 'L', caliber: '6.5' }], 'loads');

  check('  n counts groups', buckets[0].n === 4, `n = ${buckets[0].n}`);
  check('  not shots', buckets[0].moaOffsets.length === 20,
    `${buckets[0].moaOffsets.length} shot offsets held separately`);
  check('  and targetCount tracks the groups', buckets[0].targetCount === 4);
}

console.log('\nbucketing by dimension');
{
  const sessions = [
    session({ id: 'a', rifleId: 'r1', loadId: 'l1' }),
    session({ id: 'b', rifleId: 'r2', loadId: 'l1' }),
  ];
  const rifles = [{ id: 'r1', name: 'One', cartridge: '6.5' }, { id: 'r2', name: 'Two', cartridge: '.308' }];
  const loads = [{ id: 'l1', name: 'Load A', caliber: '6.5' }];

  check('  by rifle splits them', comparisonBuckets(sessions, rifles, loads, 'rifles').length === 2);
  check('  by load merges them', comparisonBuckets(sessions, rifles, loads, 'loads').length === 1);
  check('  by session splits them', comparisonBuckets(sessions, rifles, loads, 'sessions').length === 2);
  check('  sorted by sample size, largest first', (() => {
    const b = comparisonBuckets(
      [...sessions, session({ id: 'c', rifleId: 'r1', loadId: 'l1' })],
      rifles, loads, 'rifles'
    );
    return b[0].n >= b[1].n;
  })());
  check('  sessions with an unknown load are skipped',
    comparisonBuckets([session({ loadId: 'missing' })], rifles, loads, 'loads').length === 0);
}

console.log('\ncomparing two buckets');
{
  const mk = (label, sizes) => ({
    key: label, label, sub: '', n: sizes.length, targetCount: sizes.length,
    groups: sizes,
    // Shot offsets scaled to roughly match the group sizes.
    moaOffsets: sizes.flatMap(g => [
      { x: g / 3, y: 0 }, { x: -g / 3, y: 0 }, { x: 0, y: g / 3 }, { x: 0, y: -g / 3 },
    ]),
  });

  const tight = mk('Tight', [0.30, 0.34, 0.28, 0.32, 0.31, 0.29]);
  const loose = mk('Loose', [0.85, 0.92, 0.88, 0.90, 0.86, 0.91]);
  const r = compareBuckets(tight, loose, 2);
  check('  a large real difference is significant', r.welch.significant, `p = ${fmtP(r.welch.p)}`);
  check('  the tighter side is named the winner', /Tight is tighter/.test(r.verdict), r.verdict.slice(0, 40));
  check('  dispersion is reported per side', r.a.dispersion && r.b.dispersion);
  // A 2 MOA plate is huge relative to both groups and both saturate at 100%,
  // which is correct and useless as a discriminator. Use a plate small enough
  // that the difference in dispersion actually shows.
  // compareBuckets orders the sides so the tighter one is `b` — it reads as the
  // winner throughout — so b is the one that should hit more often.
  const small = compareBuckets(tight, loose, 0.5);
  check('  hit probability follows dispersion', small.b.hitPct > small.a.hitPct,
    `tighter ${small.b.hitPct.toFixed(1)}% vs looser ${small.a.hitPct.toFixed(1)}% on a 0.5 MOA plate`);
  check('  and the tighter side is `b`', small.b.mean < small.a.mean,
    `${small.b.mean.toFixed(2)} vs ${small.a.mean.toFixed(2)} MOA`);
  check('  a generous plate saturates both', r.a.hitPct > 99.9 && r.b.hitPct > 99.9,
    `${r.a.hitPct.toFixed(2)}% / ${r.b.hitPct.toFixed(2)}% on 2 MOA`);

  const same = compareBuckets(mk('A', [0.5, 0.55, 0.48, 0.52]), mk('B', [0.51, 0.54, 0.49, 0.53]), 2);
  check('  near-identical buckets are not significant', !same.welch.significant, `p = ${fmtP(same.welch.p)}`);
  check('  and it says how many groups would settle it',
    /groups per side/.test(same.verdict) || same.welch.requiredN == null, same.verdict.slice(-46));

  check('  MRAD converts the verdict figures', (() => {
    const m = compareBuckets(tight, loose, 2, 'MRAD');
    return /MRAD/.test(m.verdict) && !/MOA/.test(m.verdict);
  })());

  check('  one group a side is refused',
    compareBuckets(mk('A', [0.5]), mk('B', [0.6]), 2).error != null);
  check('  a missing side is refused', compareBuckets(null, tight, 2).error != null);
}

console.log('\np-value formatting');
{
  check('  very small p gets a bound', fmtP(0.0001) === '<0.001');
  check('  ordinary p is fixed to three places', fmtP(0.0423) === '0.042');
  check('  null is an em dash', fmtP(null) === '—');
}

console.log('\nload comparison');
{
  const mkSession = (id, loadId, best) => session({ id, loadId, best, targets: [square('t' + id, 0.1)] });
  const loads = [{ id: 'l1', name: 'Load One' }, { id: 'l2', name: 'Load Two' }];
  const sessions = [
    mkSession('a', 'l1', '0.50'), mkSession('b', 'l1', '0.55'),
    mkSession('c', 'l2', '1.20'), mkSession('d', 'l2', '1.25'),
  ];
  const r = compareLoads(sessions, loads);
  check('  compares the two best-sampled loads', !r.insufficient, `${r.a.name} vs ${r.b.name}`);
  check('  the tighter load is presented second', r.b.mean < r.a.mean,
    `${r.a.mean.toFixed(2)}" vs ${r.b.mean.toFixed(2)}"`);
  check('  one load is not enough',
    compareLoads([mkSession('a', 'l1', '0.5'), mkSession('b', 'l1', '0.6')], loads).insufficient === true);
  check('  and says what is needed',
    /Two loads with 2\+ recorded groups/.test(compareLoads([], loads).needed));
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
