/**
 * Validates the hit-probability model.
 *
 * Two things need checking and they are different in kind.
 *
 * The linearisation is an approximation, so it is checked against the thing it
 * approximates: the solver, re-run with a perturbed input. If the sensitivities
 * do not predict what a full re-solve produces, the whole model is decorative.
 *
 * The probabilities are a simulation, so they are checked against the cases
 * where the answer is known analytically. A circular target with equal sigma on
 * both axes is Rayleigh, and P(hit) = 1 - exp(-R^2 / 2 sigma^2). That closed
 * form is the anchor for everything else.
 *
 * Run: node scripts/test-hitprob.mjs
 */
import { sensitivities, hitProbability, hitCurve, rangeAtProbability, dominantAdvice } from '../lib/hitprob.js';
import { solve } from '../lib/ballistics.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(58) + detail);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// A 6.5 Creedmoor, which is what most of this app is pointed at.
const OPTS = {
  mvFps: 2800, bc: 0.315, dragModel: 'G7', sightHeightIn: 1.5, zeroYd: 100,
  tempF: 59, pressureInHg: 29.92, humidityPct: 50, altitudeFt: null,
  windMph: 10, windAngleDeg: 90, maxRangeYd: 1200, stepYd: 100, unit: 'moa',
};

console.log('sensitivities against a full re-solve');
{
  const s = sensitivities(OPTS, 800);
  check('  measured at 800 yards', !!s, `drop ${s.dropIn.toFixed(1)}", ${s.tofSec.toFixed(2)}s`);

  // Velocity: predict the drop change for +40 fps, then actually solve it.
  const predicted = s.perFpsIn * 40;
  const rows = solve({ ...OPTS, mvFps: OPTS.mvFps + 40 }).rows;
  const actual = rows.find(r => r.rangeYd === 800).dropIn - s.dropIn;
  check('  velocity prediction matches a re-solve',
    near(predicted, actual, Math.abs(actual) * 0.06 + 0.2),
    `predicted ${predicted.toFixed(2)}", solved ${actual.toFixed(2)}"`);

  // Wind is exactly linear, so this should be near-exact.
  const w20 = solve({ ...OPTS, windMph: 20 }).rows.find(r => r.rangeYd === 800).windIn;
  check('  wind prediction matches a re-solve',
    near(s.perMphIn * 20, w20, Math.abs(w20) * 0.02),
    `predicted ${(s.perMphIn * 20).toFixed(2)}", solved ${w20.toFixed(2)}"`);

  // Compared by magnitude. Drop is negative and grows more negative with
  // range, so the signed values run the other way and the first version of this
  // check read that as the sensitivity shrinking.
  check('  drop grows faster with range further out',
    Math.abs(sensitivities(OPTS, 1000).perYardIn) > Math.abs(sensitivities(OPTS, 300).perYardIn) * 3,
    `${Math.abs(sensitivities(OPTS, 300).perYardIn).toFixed(3)}"/yd at 300 against ` +
    `${Math.abs(sensitivities(OPTS, 1000).perYardIn).toFixed(3)}" at 1000 - why ranging error hurts at distance`);
  check('  and wind drift does too',
    sensitivities(OPTS, 1000).perMphIn > sensitivities(OPTS, 400).perMphIn * 2.5);
}

console.log('\nprobabilities against the closed form');
{
  // Only group dispersion, so both axes share one sigma and the answer is
  // Rayleigh: P = 1 - exp(-R^2 / 2 sigma^2).
  const rangeYd = 500, groupMoa = 1.0;
  const sigmaIn = (groupMoa * 1.047 * (rangeYd / 100)) / 3.07;

  for (const diameterIn of [4, 8, 12, 20]) {
    const p = hitProbability({
      opts: OPTS, rangeYd, target: { diameterIn }, groupMoa, trials: 40000,
    });
    const R = diameterIn / 2;
    const exact = 1 - Math.exp(-(R * R) / (2 * sigmaIn * sigmaIn));
    check(`  ${diameterIn}" plate at 500 yd`, near(p.pHit, exact, 0.012),
      `simulated ${(p.pHit * 100).toFixed(1)}%, exact ${(exact * 100).toFixed(1)}%`);
  }
}

console.log('\nthe things a shooter can change');
{
  const base = { opts: OPTS, rangeYd: 700, target: { diameterIn: 10 }, groupMoa: 0.6, trials: 20000 };

  const calm = hitProbability({ ...base, windMphSd: 0 });
  const windy = hitProbability({ ...base, windMphSd: 4 });
  check('  a worse wind call lowers the odds', windy.pHit < calm.pHit,
    `${(calm.pHit * 100).toFixed(0)}% with a perfect call, ${(windy.pHit * 100).toFixed(0)}% at 4 mph of doubt`);

  const tight = hitProbability({ ...base, groupMoa: 0.3 });
  check('  a tighter rifle raises them', tight.pHit > calm.pHit,
    `${(tight.pHit * 100).toFixed(0)}% at 0.3 MOA against ${(calm.pHit * 100).toFixed(0)}% at 0.6`);

  const sloppyRange = hitProbability({ ...base, rangeYdSd: 25 });
  check('  so does knowing the range', sloppyRange.pHit < calm.pHit);

  const es = hitProbability({ ...base, mvFpsSd: 20 });
  check('  and a tighter velocity spread', es.pHit < calm.pHit,
    `20 fps of SD costs ${((calm.pHit - es.pHit) * 100).toFixed(0)} points here`);

  check('  a target that cannot be missed reads as certain',
    hitProbability({ ...base, target: { diameterIn: 400 } }).pHit === 1);
  // Not asserted as exactly zero: the true probability here is about 6e-6, so
  // over 20,000 trials whether any land is a coin flip, and === 0 was a test
  // that failed at random.
  check('  and one that cannot be hit reads as hopeless',
    hitProbability({ ...base, target: { diameterIn: 0.01 } }).pHit < 0.001);

  // Rectangular plates are common in PRS and are not the same as a circle.
  const square = hitProbability({ ...base, target: { widthIn: 10, heightIn: 10 } });
  const circle = hitProbability({ ...base, target: { diameterIn: 10 } });
  check('  a 10 inch square beats a 10 inch circle', square.pHit > circle.pHit,
    'it has the corners, which is 4/pi more area');
}

console.log('\nwhat is actually stopping you');
{
  const windLimited = hitProbability({
    opts: OPTS, rangeYd: 900, target: { diameterIn: 10 },
    groupMoa: 0.3, windMphSd: 5, trials: 20000,
  });
  const a1 = dominantAdvice(windLimited);
  check('  a good rifle in a bad wind call is wind-limited', a1.source === 'wind',
    `${(a1.share * 100).toFixed(0)}% of the variance`);
  check('  and it says so in words worth acting on', /wind call beats a better rifle/.test(a1.text));

  const rifleLimited = hitProbability({
    opts: OPTS, rangeYd: 400, target: { diameterIn: 6 },
    groupMoa: 2.0, windMphSd: 0.5, trials: 20000,
  });
  const a2 = dominantAdvice(rifleLimited);
  check('  a poor rifle in a good call is rifle-limited', a2.source === 'group',
    `${(a2.share * 100).toFixed(0)}% of the variance`);
  check('  and points at load development', /load development actually pays/.test(a2.text));

  check('  the shares are proportions of variance and sum to one', (() => {
    const c = windLimited.contributions;
    return near(c.wind + c.velocity + c.ranging + c.group, 1, 0.02);
  })());
  check('  no uncertainties means no advice',
    dominantAdvice(hitProbability({ opts: OPTS, rangeYd: 300, target: { diameterIn: 10 } })) === null,
    'an untouched screen reports the rifle alone and claims nothing');
}

console.log('\nthe curve');
{
  const curve = hitCurve({
    opts: OPTS, target: { diameterIn: 10 },
    ranges: [200, 300, 400, 500, 600, 700, 800, 900, 1000],
    groupMoa: 0.5, windMphSd: 3, mvFpsSd: 12, rangeYdSd: 10, trials: 6000,
  });
  check('  one point per range', curve.length === 9);
  check('  falls away with distance', (() => {
    for (let i = 1; i < curve.length; i++) if (curve[i].pHit > curve[i - 1].pHit + 0.03) return false;
    return true;
  })(), curve.map(c => `${c.rangeYd}:${(c.pHit * 100).toFixed(0)}%`).join(' '));

  const r50 = rangeAtProbability(curve, 0.5);
  check('  and gives the range where it is even money', r50 > 200 && r50 < 1000,
    `${Math.round(r50)} yd for a 10" plate`);
  check('  interpolated rather than snapped to the card step',
    r50 % 100 !== 0, `${r50.toFixed(0)} rather than a round hundred`);
  // A threshold the curve never starts above. Asking for 0.999 was the wrong
  // case: the curve is at 100% at 200 yards, so it reaches 0.999 and then
  // crosses it, and returning a range was correct.
  const hopeless = hitCurve({
    opts: OPTS, target: { diameterIn: 1 },
    ranges: [600, 800, 1000], groupMoa: 2, windMphSd: 6, trials: 3000,
  });
  check('  a threshold never reached returns nothing',
    rangeAtProbability(hopeless, 0.5) === null,
    `a 1" plate never gets to even money, best is ${(Math.max(...hopeless.map(h => h.pHit)) * 100).toFixed(1)}%`);

  // Same seed, same answer: a probability that jitters is not one anyone trusts.
  const again = hitCurve({
    opts: OPTS, target: { diameterIn: 10 },
    ranges: [500], groupMoa: 0.5, windMphSd: 3, trials: 6000,
  });
  const twice = hitCurve({
    opts: OPTS, target: { diameterIn: 10 },
    ranges: [500], groupMoa: 0.5, windMphSd: 3, trials: 6000,
  });
  check('  reproducible', again[0].pHit === twice[0].pHit, `${(again[0].pHit * 100).toFixed(2)}% both times`);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
