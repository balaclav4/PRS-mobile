/**
 * Validates charge work-up analysis.
 *
 * Two things matter more than the rest. It must find a real upward bend in
 * velocity, and it must not invent one from ordinary chronograph scatter — a
 * false alarm here teaches a shooter to ignore the alarm. And under no input
 * may it tell anyone a load is safe.
 *
 * Run: node scripts/test-pressure.mjs
 */
import { parseWorkup, fitLine, fitCurve, analyseWorkup } from '../lib/pressure.js';

let seed = 8675309;
function rnd() {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(54) + detail);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const rows = (triples) => triples.map(([charge, velocity, sign], i) =>
  ({ id: String(i), charge: String(charge), velocity: String(velocity), sign: sign || null }));

console.log('parsing and fitting');
{
  const p = parseWorkup(rows([[42.0, 2750], [41.0, 2700], [43.0, 'bad'], [44.0, 2800]]));
  check('  sorts by charge and drops bad rows', p.length === 3 && p[0].charge === 41.0,
    `${p.length} of 4`);

  // A clean line: 50 fps per grain.
  const line = fitLine(parseWorkup(rows([
    [41.0, 2700], [41.5, 2725], [42.0, 2750], [42.5, 2775], [43.0, 2800],
  ])));
  check('  recovers the slope', near(line.slope, 50, 0.01), line.slope.toFixed(2) + ' fps/gr');
  check('  a perfect line has no scatter', near(line.residualSd, 0, 1e-9));
  check('  predicts off the line', near(line.predict(44.0), 2850, 0.01),
    line.predict(44.0).toFixed(0) + ' fps at 44.0 gr');
  check('  refuses a single point', fitLine([{ charge: 1, velocity: 2 }]) === null);
}

console.log('\na linear ladder raises nothing');
{
  const r = analyseWorkup(parseWorkup(rows([
    [41.0, 2702], [41.3, 2716], [41.6, 2731], [41.9, 2748], [42.2, 2760],
    [42.5, 2776], [42.8, 2789], [43.1, 2803],
  ])));
  check('  finds no bend', !r.bending, `slope ${r.fit.slope} fps/gr`);
  check('  and says so without clearing the load',
    /not a clearance/.test(r.verdict) && r.safe === null);
  check('  never reports safe under any input', r.safe === null);
}

console.log('\na real upward bend is caught');
{
  // Linear to 42.5, then accelerating: the signature of pressure climbing.
  const r = analyseWorkup(parseWorkup(rows([
    [41.0, 2700], [41.3, 2715], [41.6, 2730], [41.9, 2745], [42.2, 2760],
    [42.5, 2778], [42.8, 2812], [43.1, 2860],
  ])));
  check('  is flagged', r.bending, `curvature ${r.fit?.curvature}, p = ${r.fit?.p}`);
  check('  reports positive curvature', r.fit.curvature > 0,
    `${r.fit.curvature} fps/gr^2, p = ${r.fit.p}`);
  // Descriptive, not inferred: the fitted parabola put this at 41.62 gr on a
  // ladder that is straight until 42.5.
  check('  names where the rungs start running above the line',
    r.departureCharge === 42.5, `${r.departureCharge} gr`);
  check('  and every rung from there up really is above it',
    r.rungs.filter(x => x.charge >= r.departureCharge).every(x => x.excess > 0),
    r.rungs.map(x => x.excess).join(', '));
  check('  verdict says to stop', /go back to your manual/.test(r.verdict));
  check('  used every rung', r.fit.df === 8 - 3, `df ${r.fit.df}`);
}

console.log('\nit does not cry wolf');
{
  // 400 genuinely linear ladders with realistic chronograph scatter. Every false
  // alarm here is a shooter who learns to ignore the next real one.
  let alarms = 0;
  const TRIALS = 400, SD = 12;
  for (let t = 0; t < TRIALS; t++) {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const charge = +(41.0 + i * 0.3).toFixed(1);
      pts.push([charge, Math.round(2700 + (charge - 41.0) * 50 + gauss() * SD)]);
    }
    if (analyseWorkup(parseWorkup(rows(pts))).bending) alarms++;
  }
  const rate = alarms / TRIALS;
  check('  rarely flags a linear ladder', rate <= 0.08,
    `${(rate * 100).toFixed(1)}% of ${TRIALS} linear ladders`);
}

console.log('\nand it does catch real ones');
{
  // Same scatter, but with genuine acceleration in the top three rungs.
  let caught = 0;
  const TRIALS = 400, SD = 12;
  for (let t = 0; t < TRIALS; t++) {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const charge = +(41.0 + i * 0.3).toFixed(1);
      const over = Math.max(0, i - 4);
      const bend = over * over * 12;
      pts.push([charge, Math.round(2700 + (charge - 41.0) * 50 + bend + gauss() * SD)]);
    }
    if (analyseWorkup(parseWorkup(rows(pts))).bending) caught++;
  }
  const rate = caught / TRIALS;
  check('  catches a genuine bend most of the time', rate >= 0.75,
    `${(rate * 100).toFixed(1)}% of ${TRIALS} bent ladders`);
}

console.log('\none stray reading is not a trend');
{
  const r = analyseWorkup(parseWorkup(rows([
    [41.0, 2700], [41.3, 2715], [41.6, 2730], [41.9, 2745], [42.2, 2760],
    [42.5, 2830], [42.8, 2790], [43.1, 2805],
  ])));
  check('  a single high rung is not a bend', !r.bending, `p = ${r.fit.p}`);
}

console.log('\na ladder flattening at the top is not a warning');
{
  // Powder running out of steam at the top is ordinary. Only an upward bend is
  // a pressure signal, so the test has to be one-sided.
  const r = analyseWorkup(parseWorkup(rows([
    [41.0, 2700], [41.3, 2718], [41.6, 2736], [41.9, 2752], [42.2, 2764],
    [42.5, 2772], [42.8, 2777], [43.1, 2779],
  ])));
  check('  downward curvature is not flagged', !r.bending,
    `curvature ${r.fit.curvature} fps/gr^2`);
  check('  and it is genuinely curving down', r.fit.curvature < 0);
}

console.log('\ncurvature fit against a known parabola');
{
  // v = 2700 + 50*(c-41) + 30*(c-41)^2 exactly.
  const pts = parseWorkup(rows(
    [0, 1, 2, 3, 4, 5, 6].map(i => {
      const c = +(41.0 + i * 0.3).toFixed(1);
      return [c, 2700 + 50 * (c - 41) + 30 * (c - 41) ** 2];
    })));
  const cv = fitCurve(pts);
  check('  recovers the curvature exactly', near(cv.curvature, 30, 1e-6),
    cv.curvature.toFixed(6) + ' fps/gr^2');
  check('  and leaves no residual', near(cv.residualSd, 0, 1e-6));
  check('  refuses too few points for three parameters', fitCurve(pts.slice(0, 3)) === null);
}

console.log('\ndeference to published data');
{
  const r = analyseWorkup(parseWorkup(rows([
    [41.0, 2702], [41.3, 2716], [41.6, 2731], [41.9, 2748], [42.2, 2760],
    [42.5, 2776], [42.8, 2789], [43.1, 2803],
  ])), 42.5);
  check('  charges over the book maximum are named', r.overBook.length === 2,
    `${r.overBook.join(', ')} gr over 42.5`);
  check('  and the manual is called the authority',
    /Published data is the authority/.test(r.verdict));
  check('  still never reports safe', r.safe === null);
}

console.log('\npressure signs are treated as lagging');
{
  const r = analyseWorkup(parseWorkup([
    ...rows([[41.0, 2702], [41.3, 2716], [41.6, 2731], [41.9, 2748], [42.2, 2760], [42.5, 2776]]),
    { id: '6', charge: '42.8', velocity: '2789', sign: 'ejector mark' },
  ]));
  check('  a recorded sign is surfaced', r.signs.length === 1, `at ${r.signs[0]} gr`);
  check('  described as lagging', /lagging indicators/.test(r.verdict));
  check('  and called a hard stop', /hard stop/.test(r.verdict));
  check('  a sign never clears anything', r.safe === null);
}

console.log('\nrefusals');
{
  check('  too few rungs is refused',
    analyseWorkup(parseWorkup(rows([[41, 2700], [42, 2750], [43, 2800]]))).ok === false);
  check('  empty is safe to call', analyseWorkup([]).ok === false);
  // A dead-flat ladder fits fine (slope 0); there is simply no bend in it.
  const flat = analyseWorkup(parseWorkup(rows([
    [41, 2700], [41.3, 2700], [41.6, 2700], [41.9, 2700], [42.2, 2700], [42.5, 2700],
  ])));
  check('  a flat ladder finds no bend rather than dividing by zero',
    flat.ok && !flat.bending && isFinite(flat.fit.t), `t = ${flat.fit.t}`);
  check('  a perfectly linear base does not become infinitely sensitive',
    analyseWorkup(parseWorkup(rows([
      [41.0, 2700], [41.3, 2715], [41.6, 2730], [41.9, 2745], [42.2, 2760],
      [42.5, 2775], [42.8, 2790], [43.1, 2805],
    ]))).bending === false, 'exact line, no alarm');
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
