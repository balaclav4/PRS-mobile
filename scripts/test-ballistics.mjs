/**
 * Validates the trajectory solver against published data and physical limits.
 *
 * A dope card is used to make a first-round hit at distance, so "plausible
 * looking" is worthless — the numbers are checked against known solutions from
 * standard ballistic calculators and against invariants that must hold for any
 * correct solver.
 *
 * Run: node scripts/test-ballistics.mjs
 */
import {
  solve, dopeCard, zeroAngle, trueBC, densityRatio, speedOfSound,
  pressureAtAltitude, inchesToMoa, inchesToMil, standardCd, windBracket, trueBoth,
  DRAG_MODELS, isKnownDragModel } from '../lib/ballistics.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(52) + detail);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('atmosphere');
{
  check('  standard density ratio = 1', near(densityRatio({}), 1, 0.005),
    densityRatio({}).toFixed(4));
  check('  speed of sound at 59F = 1116.4 ft/s',
    near(speedOfSound(59), 1116.4, 0.5), speedOfSound(59).toFixed(1));
  check('  speed of sound rises with temperature', speedOfSound(90) > speedOfSound(30));
  check('  hot air is less dense', densityRatio({ tempF: 100 }) < 1);
  check('  cold air is more dense', densityRatio({ tempF: 10 }) > 1);
  // Humidity lowers density — water vapour is lighter than dry air.
  check('  humid air is slightly less dense',
    densityRatio({ humidityPct: 100, tempF: 90 }) < densityRatio({ humidityPct: 0, tempF: 90 }));
  // 5000 ft is close to 24.9 inHg on the standard atmosphere.
  check('  pressure at 5000 ft ~ 24.9 inHg',
    near(pressureAtAltitude(5000), 24.9, 0.15), pressureAtAltitude(5000).toFixed(2));
  check('  density falls with altitude',
    densityRatio({ pressureInHg: pressureAtAltitude(5000) }) < 0.9);
}

console.log('\nunit conversion');
{
  // 1 MOA is 1.047" at 100 yd; 1 mil is 3.6" at 100 yd.
  check('  1.047 in at 100 yd = 1 MOA', near(inchesToMoa(1.047, 100), 1, 1e-9));
  check('  3.6 in at 100 yd = 1 mil', near(inchesToMil(3.6, 100), 1, 1e-9));
  check('  10.47 in at 1000 yd = 1 MOA', near(inchesToMoa(10.47, 1000), 1, 1e-9));
}

console.log('\nzero and near-field behaviour');
{
  const opts = { mvFps: 2800, bc: 0.5, dragModel: 'G1', sightHeightIn: 1.5, zeroYd: 100 };
  const { rows } = solve({ ...opts, maxRangeYd: 100, stepYd: 100 });
  check('  drop at the zero range is ~0', Math.abs(rows[0].dropIn) < 0.05,
    `${rows[0].dropIn.toFixed(3)} in`);

  const a = zeroAngle(opts);
  check('  zero angle is small and positive', a > 0 && a < 0.01, a.toFixed(6) + ' rad');

  // A 200 yd zero must sit high at 100 yd.
  const far = solve({ ...opts, zeroYd: 200, maxRangeYd: 100, stepYd: 100 });
  check('  200 yd zero shoots high at 100 yd', far.rows[0].dropIn > 0.5,
    `+${far.rows[0].dropIn.toFixed(2)} in`);
}

console.log('\ntrajectory against published solutions');
{
  // Reference: 6.5 Creedmoor 140gr, G7 BC 0.315, MV 2750, 100 yd zero,
  // standard atmosphere. Mainstream calculators put 1000 yd elevation near
  // 30 MOA and retained velocity near 1400 fps.
  const card = dopeCard({
    mvFps: 2750, bc: 0.315, dragModel: 'G7', sightHeightIn: 1.5,
    zeroYd: 100, maxRangeYd: 1000, stepYd: 100, unit: 'moa',
  });
  const at = (r) => card.rows.find(x => x.rangeYd === r);

  check('  1000 yd elevation ~ 30 MOA', near(at(1000).elevation, 30, 3),
    `${at(1000).elevation} MOA`);
  check('  1000 yd velocity ~ 1400 fps', near(at(1000).velFps, 1400, 120),
    `${at(1000).velFps} fps`);
  check('  1000 yd time of flight ~ 1.5 s', near(at(1000).tofSec, 1.5, 0.2),
    `${at(1000).tofSec} s`);
  check('  500 yd elevation ~ 10 MOA', near(at(500).elevation, 10, 1.5),
    `${at(500).elevation} MOA`);

  // .308 175 SMK, G7 BC 0.243, MV 2600 — a well-documented combination that
  // goes transonic around 900-1000 yd.
  const m118 = dopeCard({
    mvFps: 2600, bc: 0.243, dragModel: 'G7', sightHeightIn: 1.5,
    zeroYd: 100, maxRangeYd: 1000, stepYd: 100, unit: 'mil',
  });
  const m = (r) => m118.rows.find(x => x.rangeYd === r);
  check('  .308 1000 yd elevation ~ 11 mil', near(m(1000).elevation, 11, 1.5),
    `${m(1000).elevation} mil`);
  check('  .308 goes transonic by 1000 yd', m(1000).transonic === true,
    `mach ${m(1000).mach}`);
  check('  .308 still supersonic at 700 yd', m(700).mach > 1.2, `mach ${m(700).mach}`);
}

console.log('\ninvariants any correct solver must hold');
{
  const base = {
    mvFps: 2800, bc: 0.5, dragModel: 'G7', zeroYd: 100,
    maxRangeYd: 1000, stepYd: 100, unit: 'moa',
  };
  const card = dopeCard(base);

  check('  velocity decreases monotonically',
    card.rows.every((r, i) => i === 0 || r.velFps < card.rows[i - 1].velFps));
  check('  elevation increases monotonically',
    card.rows.every((r, i) => i === 0 || r.elevation > card.rows[i - 1].elevation));
  check('  time of flight increases monotonically',
    card.rows.every((r, i) => i === 0 || r.tofSec > card.rows[i - 1].tofSec));

  // Higher BC = less drop, more retained velocity.
  const slippery = dopeCard({ ...base, bc: 0.7 });
  check('  higher BC drops less',
    slippery.rows.at(-1).elevation < card.rows.at(-1).elevation,
    `${slippery.rows.at(-1).elevation} < ${card.rows.at(-1).elevation} MOA`);
  check('  higher BC retains more velocity',
    slippery.rows.at(-1).velFps > card.rows.at(-1).velFps);

  // Faster muzzle velocity = less drop.
  const fast = dopeCard({ ...base, mvFps: 3100 });
  check('  faster MV drops less', fast.rows.at(-1).elevation < card.rows.at(-1).elevation);

  // Thin air = less drag = less drop. This is why altitude matters.
  const denver = dopeCard({ ...base, altitudeFt: 5280 });
  check('  altitude reduces drop',
    denver.rows.at(-1).elevation < card.rows.at(-1).elevation,
    `${denver.rows.at(-1).elevation} vs ${card.rows.at(-1).elevation} MOA`);
}

console.log('\nwind');
{
  const base = {
    mvFps: 2800, bc: 0.5, dragModel: 'G7', zeroYd: 100,
    maxRangeYd: 1000, stepYd: 100, unit: 'moa',
  };
  const calm = dopeCard(base);
  const cross = dopeCard({ ...base, windMph: 10, windAngleDeg: 90 });
  const head = dopeCard({ ...base, windMph: 10, windAngleDeg: 0 });
  const half = dopeCard({ ...base, windMph: 10, windAngleDeg: 30 });

  check('  no wind means no drift', Math.abs(calm.rows.at(-1).windIn) < 0.01);
  check('  full-value crosswind drifts', cross.rows.at(-1).windIn > 10,
    `${cross.rows.at(-1).windIn.toFixed(1)} in at 1000 yd`);
  check('  headwind barely drifts',
    Math.abs(head.rows.at(-1).windIn) < Math.abs(cross.rows.at(-1).windIn) * 0.1);
  // sin(30) = 0.5, so a 30-degree wind is about half value.
  check('  30-degree wind is about half value',
    near(half.rows.at(-1).windIn / cross.rows.at(-1).windIn, 0.5, 0.08),
    (half.rows.at(-1).windIn / cross.rows.at(-1).windIn).toFixed(3));
  check('  drift grows faster than linearly with range',
    cross.rows.at(-1).windIn / cross.rows.find(r => r.rangeYd === 500).windIn > 2.5,
    'ratio ' + (cross.rows.at(-1).windIn / cross.rows.find(r => r.rangeYd === 500).windIn).toFixed(2));
}

console.log('\ntruing');
{
  const opts = {
    mvFps: 2750, bc: 0.315, dragModel: 'G7', sightHeightIn: 1.5,
    zeroYd: 100, unit: 'moa',
  };
  // Take a true trajectory at a known BC, then feed its own numbers back in.
  // Truing must recover the BC it came from.
  const truth = dopeCard({ ...opts, bc: 0.290, maxRangeYd: 800, stepYd: 800 });
  const observed = [{ rangeYd: 800, observedElevation: truth.rows.at(-1).elevation }];
  const result = trueBC(opts, observed);
  check('  recovers the BC that produced the data',
    near(result.bc, 0.290, 0.006), `${result.bc} (want 0.290)`);
  check('  reports a correction factor', near(result.factor, 0.290 / 0.315, 0.03),
    `x${result.factor}`);
  check('  empty observations return null', trueBC(opts, []) === null);
  check('  garbage observations return null',
    trueBC(opts, [{ rangeYd: 0, observedElevation: NaN }]) === null);
}


// --- robustness and cost ------------------------------------------------------
console.log('\nrobustness');
{
  // The zero solver runs inside a bisection loop, so a diverged trial angle
  // used to send the bullet nearly vertical and run the integrator to its time
  // cap on every iteration — which hung the UI thread rather than erroring.
  const opts = { mvFps: 2820, bc: 0.315, dragModel: 'G7', sightHeightIn: 1.5, zeroYd: 100, unit: 'moa' };

  let t0 = Date.now();
  dopeCard({ ...opts, maxRangeYd: 1000, stepYd: 100 });
  const cardMs = Date.now() - t0;
  check('  dope card solves in under 100ms', cardMs < 100, `${cardMs} ms`);

  t0 = Date.now();
  const trued = trueBC(opts, [{ rangeYd: 1000, observedElevation: 31 }]);
  const trueMs = Date.now() - t0;
  check('  truing solves in under 500ms', trueMs < 500, `${trueMs} ms`);

  // Dialling more elevation than predicted means the bullet drops more than
  // the book BC says, so the trued BC must come out lower.
  check('  more observed drop lowers the BC', trued.bc < 0.315, `${trued.bc} < 0.315`);
  const less = trueBC(opts, [{ rangeYd: 1000, observedElevation: 25 }]);
  check('  less observed drop raises the BC', less.bc > 0.315, `${less.bc} > 0.315`);

  // Absurd inputs must terminate rather than spin.
  t0 = Date.now();
  dopeCard({ ...opts, mvFps: 400, bc: 0.05, maxRangeYd: 2000, stepYd: 500 });
  dopeCard({ ...opts, mvFps: 4000, bc: 2.0, maxRangeYd: 2000, stepYd: 500 });
  dopeCard({ ...opts, zeroYd: 1000, maxRangeYd: 1000, stepYd: 500 });
  check('  extreme inputs terminate quickly', Date.now() - t0 < 1000, `${Date.now() - t0} ms`);

  // A subsonic load never reaching the far end should still return what it can.
  const slow = dopeCard({ ...opts, mvFps: 1050, bc: 0.15, maxRangeYd: 1000, stepYd: 200 });
  check('  subsonic load returns partial table without hanging',
    Array.isArray(slow.rows), `${slow.rows.length} rows`);
}


// --- string inputs ------------------------------------------------------------
console.log('\nstring inputs from TextInput');
{
  // Every value on the ballistics screen arrives as a string. A string stepYd
  // made `r += stepYd` concatenate rather than add, so the range list grew
  // '1000' -> '10001000' -> '100010001000' while staying lexicographically
  // below the limit — an infinite loop that hung the UI thread while the same
  // call with numbers finished in 2ms.
  const t0 = Date.now();
  const card = dopeCard({
    mvFps: '2820', bc: '0.315', dragModel: 'G7', sightHeightIn: '1.5',
    zeroYd: '100', tempF: '59', pressureInHg: '29.92', humidityPct: '50',
    altitudeFt: '', windMph: '10', windAngleDeg: '90',
    maxRangeYd: '1000', stepYd: '100', unit: 'moa',
  });
  const ms = Date.now() - t0;
  check('  all-string options terminate', ms < 500, `${ms} ms`);
  check('  and produce the right number of rows', card.rows.length === 10, `${card.rows.length} rows`);
  check('  with numeric ranges', typeof card.rows[0].rangeYd === 'number', typeof card.rows[0].rangeYd);
  check('  matching the numeric call',
    near(card.rows.at(-1).elevation,
      dopeCard({ mvFps: 2820, bc: 0.315, dragModel: 'G7', sightHeightIn: 1.5, zeroYd: 100,
        tempF: 59, pressureInHg: 29.92, humidityPct: 50, windMph: 10, windAngleDeg: 90,
        maxRangeYd: 1000, stepYd: 100, unit: 'moa' }).rows.at(-1).elevation, 0.01),
    `${card.rows.at(-1).elevation} MOA`);

  // Truing is fed strings straight from the observation rows.
  const t1 = Date.now();
  const trued = trueBC(
    { mvFps: '2820', bc: 0.315, dragModel: 'G7', sightHeightIn: '1.5', zeroYd: '100', unit: 'moa' },
    [{ rangeYd: '1000', observedElevation: '31' }]
  );
  check('  truing with string observations terminates', Date.now() - t1 < 1000,
    `${Date.now() - t1} ms -> BC ${trued?.bc}`);
  check('  and returns a sane BC', trued && trued.bc > 0.1 && trued.bc < 0.5, String(trued?.bc));

  // An empty altitude field must mean "not set", not zero.
  const noAlt = dopeCard({ ...{ mvFps: 2820, bc: 0.315, zeroYd: 100, maxRangeYd: 500, stepYd: 500 }, altitudeFt: '' });
  const seaLevel = dopeCard({ mvFps: 2820, bc: 0.315, zeroYd: 100, maxRangeYd: 500, stepYd: 500 });
  check('  empty altitude is treated as unset',
    near(noAlt.rows.at(-1).elevation, seaLevel.rows.at(-1).elevation, 0.01));
}

console.log('\nthe standard drag tables are the standard ones');
{
  // Anchor values that identify each curve. A transcription slip anywhere in
  // six hundred numbers would corrupt every trajectory silently, and these are
  // the points where the curves are most distinctive: the subsonic floor and
  // the transonic peak, which differ per model in both height and where they
  // fall. Two curves agreeing at Mach 0 and disagreeing at the peak is the
  // signature of the wrong table under the right name.
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  // model  Cd(0)    peak Cd  at Mach
  const ANCHORS = [
    ['G1',  0.2629,  0.6625,  1.400],
    ['G2',  0.2303,  0.4114,  1.075],
    ['G5',  0.1710,  0.4406,  1.400],
    ['G6',  0.2617,  0.4497,  1.150],
    ['G7',  0.1198,  0.4043,  1.050],
    ['G8',  0.2105,  0.4493,  1.075],
    ['GI',  0.2282,  0.6423,  1.250],
    ['RA4', 0.2283,  0.5943,  1.150],
  ];
  for (const [model, floor, peak, peakMach] of ANCHORS) {
    check(`  ${model} subsonic floor`,
      near(standardCd(model, 0), floor, 0.0002), standardCd(model, 0).toFixed(4));
    check(`  ${model} peaks ${peak} near Mach ${peakMach}`,
      near(standardCd(model, peakMach), peak, 0.0002), standardCd(model, peakMach).toFixed(4));
  }

  // Each peak really is the maximum of its own curve, not just a value that
  // happens to match. This is what catches two models sharing one table.
  for (const [model, , peak] of ANCHORS) {
    let max = 0;
    for (let m = 0; m <= 5; m += 0.005) max = Math.max(max, standardCd(model, m));
    check(`  ${model}'s peak is its actual maximum`, near(max, peak, 0.0005), max.toFixed(4));
  }

  check('  G7 is far flatter than G1 through the subsonic range',
    standardCd('G7', 0.5) < standardCd('G1', 0.5) * 0.65,
    `${standardCd('G7', 0.5).toFixed(4)} against ${standardCd('G1', 0.5).toFixed(4)}`);
  check('  both climb steeply through transonic',
    standardCd('G7', 1.0) > standardCd('G7', 0.9) * 2.4 &&
    standardCd('G1', 1.0) > standardCd('G1', 0.9) * 1.35,
    'this is the behaviour a single exponential decay cannot produce');
  // The tables now run to Mach 5 rather than Mach 4, so the clamp point moved.
  // Asserted against each table's own last point rather than a literal, which
  // is what the previous version got wrong when the range changed under it.
  check('  and are clamped rather than extrapolated past the ends',
    standardCd('G7', 99) === standardCd('G7', 5.0) &&
    standardCd('RA4', 99) === standardCd('RA4', 4.0) &&
    standardCd('G1', -5) === standardCd('G1', 0));

  // An unknown model must refuse rather than default. It used to fall through
  // to G7, so asking for G5 and getting G7 produced a card that looked fine.
  let refused = false;
  try { standardCd('G9', 1.0); } catch { refused = true; }
  check('  an unknown model is refused, not quietly solved as G7', refused);
  check('  and the name is matched case-insensitively',
    standardCd('g5', 1.4) === standardCd('G5', 1.4));
  check('  every offered model resolves',
    DRAG_MODELS.every(m => isKnownDragModel(m.id)),
    DRAG_MODELS.map(m => m.id).join(' '));
}

console.log('\nthe card carries the effects the app computes');
{
  const base = {
    mvFps: 2800, bc: 0.315, dragModel: 'G7', sightHeightIn: 1.5, zeroYd: 100,
    tempF: 59, pressureInHg: 29.92, humidityPct: 50,
    windMph: 10, windAngleDeg: 90, maxRangeYd: 1000, stepYd: 1000, unit: 'moa',
  };
  const plain = dopeCard(base);
  const withFx = dopeCard({
    ...base,
    effects: { sg: 1.8, lengthCalibers: 4.6, rightHandTwist: true, latitudeDeg: 45, azimuthDeg: 90 },
  });

  check('  a card without them says so', plain.includesEffects === false);
  check('  and with them says so too', withFx.includesEffects === true);

  const a = plain.rows[plain.rows.length - 1], b = withFx.rows[withFx.rows.length - 1];
  check('  windage at 1000 moves once they are included',
    Math.abs(b.wind - a.wind) > 0.05,
    `${a.wind} -> ${b.wind} MOA`);
  check('  spin drift is right-hand and positive', b.spinDriftIn > 0,
    `${b.spinDriftIn}" at 1000`);
  check('  and is the size the Litz form predicts, a few inches at 1000',
    b.spinDriftIn > 3 && b.spinDriftIn < 15, `${b.spinDriftIn}"`);
  check('  the components sum to the difference', (() => {
    const delta = b.windIn - a.windIn;
    return near(delta, b.spinDriftIn + b.coriolisHIn, 0.05);
  })(), 'the total is auditable rather than magic');

  // Left-hand twist must drift the other way, which is the cheapest possible
  // check that the sign is threaded through rather than assumed.
  const lh = dopeCard({
    ...base,
    effects: { sg: 1.8, lengthCalibers: 4.6, rightHandTwist: false, latitudeDeg: null },
  });
  check('  a left-hand twist drifts the other way',
    lh.rows[lh.rows.length - 1].spinDriftIn < 0,
    `${lh.rows[lh.rows.length - 1].spinDriftIn}"`);

  check('  an unusable effects block is ignored rather than half-applied',
    dopeCard({ ...base, effects: { sg: 0, lengthCalibers: 4.6 } }).includesEffects === false);
}

console.log('\nwind as a bracket');
{
  const base = {
    mvFps: 2800, bc: 0.315, dragModel: 'G7', sightHeightIn: 1.5, zeroYd: 100,
    maxRangeYd: 600, stepYd: 200, unit: 'moa',
  };
  const wb = windBracket(base, [5, 10, 20]);
  check('  one row per range', wb.rows.length === 3);

  const r = wb.rows[wb.rows.length - 1];
  check('  drift is linear in wind speed', near(r.holds[2], r.holds[0] * 4, 0.02),
    `5mph ${r.holds[0]}, 20mph ${r.holds[2]} MOA — exactly four times`);
  check('  and ten is twice five', near(r.holds[1], r.holds[0] * 2, 0.02));
  check('  per-mph agrees with the bracket', near(r.perMph * 10, r.holds[1], 0.02),
    `${r.perMph} MOA per mph at 600`);

  // The bracket must agree with a full solve at that wind, or it is a shortcut
  // that quietly disagrees with the card printed beside it.
  const solved = dopeCard({ ...base, windMph: 20, windAngleDeg: 90 });
  const last = solved.rows[solved.rows.length - 1];
  check('  and with a real solve at that speed', near(r.holds[2], last.wind, 0.05),
    `bracket ${r.holds[2]}, solved ${last.wind} MOA`);
}

console.log('\ntruing velocity and BC together');
{
  const truth = { mvFps: 2755, bc: 0.291 };
  const base = {
    mvFps: 2800, bc: 0.315, dragModel: 'G7', sightHeightIn: 1.5, zeroYd: 100,
    tempF: 59, pressureInHg: 29.92, humidityPct: 50, unit: 'moa',
  };
  // Dope the shooter would actually have recorded, generated from a rifle whose
  // real velocity and BC are both different from what they typed.
  const dopeAt = (yd) => {
    const { rows } = solve({ ...base, ...truth, maxRangeYd: yd, stepYd: yd });
    return +inchesToMoa(-rows[0].dropIn, yd).toFixed(2);
  };
  const obs = [
    { rangeYd: 300, observedElevation: dopeAt(300) },
    { rangeYd: 900, observedElevation: dopeAt(900) },
  ];

  const t = trueBoth(base, obs);
  check('  it solves', t.ok, t.ok ? '' : t.reason);
  check('  and recovers the velocity it was built from',
    Math.abs(t.mvFps - truth.mvFps) <= 12, `${t.mvFps} fps against ${truth.mvFps}`);
  check('  and the BC', Math.abs(t.bc - truth.bc) <= 0.012,
    `${t.bc} against ${truth.bc}`);
  check('  with the dope reproduced to within a fraction of a minute',
    t.residual < 0.06, `${t.residual} MOA mean miss`);
  check('  and reports how far it moved each', t.mvDelta < 0 && t.bcFactor < 1,
    `${t.mvDelta} fps, BC x${t.bcFactor}`);

  // The degenerate case, which is the reason this needs a guard at all.
  const tight = trueBoth(base, [
    { rangeYd: 500, observedElevation: dopeAt(500) },
    { rangeYd: 600, observedElevation: dopeAt(600) },
  ]);
  check('  observations too close together are refused', !tight.ok);
  check('  and it says the two cannot be told apart',
    /cannot be told apart/.test(tight.reason), tight.reason);

  check('  one observation is refused', !trueBoth(base, [obs[0]]).ok);
  check('  and says why two are needed',
    /one near, one far/.test(trueBoth(base, [obs[0]]).reason));

  // Truing BC alone against a velocity error produces a BC that fits where it
  // was trued and drifts elsewhere. That is the reason trueBoth exists, so it
  // is worth showing rather than asserting.
  const bcOnly = trueBC(base, [obs[1]]);
  const withBcOnly = solve({ ...base, bc: bcOnly.bc, maxRangeYd: 300, stepYd: 300 }).rows[0];
  const missAt300 = Math.abs(inchesToMoa(-withBcOnly.dropIn, 300) - obs[0].observedElevation);
  const bothAt300 = Math.abs(inchesToMoa(
    -solve({ ...base, bc: t.bc, mvFps: t.mvFps, maxRangeYd: 300, stepYd: 300 }).rows[0].dropIn, 300
  ) - obs[0].observedElevation);
  check('  truing BC alone misses at the other range', missAt300 > bothAt300,
    `BC-only is ${missAt300.toFixed(2)} MOA out at 300, both is ${bothAt300.toFixed(2)}`);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
