/**
 * Validates comparing groups shot with different numbers of rounds.
 *
 * The property that matters is that a rifle which has not changed does not
 * appear to change when the shooter switches from 3-shot groups to 10-shot
 * groups. So the last block simulates exactly that and measures the error the
 * old plain average carried, alongside the corrected figure.
 *
 * Run: node scripts/test-groupsize.mjs
 */
import {
  esFactor, sigmaFromGroup, groupFromSigma, normaliseGroup, typicalGroup,
  REFERENCE_SHOTS,
} from '../lib/groupsize.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(56) + detail);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

let seed = 99991 >>> 0;
const rnd = () => {
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let spare = null;
const gauss = () => {
  if (spare !== null) { const v = spare; spare = null; return v; }
  const u = Math.sqrt(-2 * Math.log(rnd() + 1e-12)), t = 2 * Math.PI * rnd();
  spare = u * Math.sin(t);
  return u * Math.cos(t);
};
const groupES = (n, sigma) => {
  const xs = [], ys = [];
  for (let i = 0; i < n; i++) { xs.push(gauss() * sigma); ys.push(gauss() * sigma); }
  let max = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) max = Math.max(max, Math.hypot(xs[i] - xs[j], ys[i] - ys[j]));
  return max;
};

console.log('the factors');
{
  // The one case with a closed form, and the check on all the others.
  check('  n=2 matches sqrt(pi)', near(esFactor(2), Math.sqrt(Math.PI), 0.002),
    `${esFactor(2)} against ${Math.sqrt(Math.PI).toFixed(4)}`);
  check('  they grow with shot count', (() => {
    for (let n = 3; n <= 20; n++) if (esFactor(n) <= esFactor(n - 1)) return false;
    return true;
  })(), 'more shots means more chances to find the widest pair');
  check('  and grow more slowly as they go',
    esFactor(4) - esFactor(3) > esFactor(20) - esFactor(19));
  check('  above the table it extrapolates rather than refusing',
    esFactor(30) > esFactor(20) && esFactor(30) < esFactor(20) * 1.25, `n=30 -> ${esFactor(30).toFixed(3)}`);
  check('  fewer than two shots is not a group', esFactor(1) === null && esFactor(0) === null);
  check('  junk is refused', esFactor('x') === null);
}

console.log('\nsigma in, group out, and back');
{
  const s = sigmaFromGroup(3.0676, 5);
  check('  a 5-shot group of 3.07 implies sigma 1', near(s, 1, 0.001), `sigma ${s.toFixed(4)}`);
  check('  and converts back', near(groupFromSigma(1, 5), 3.0676, 0.001));
  check('  round trips at any count', (() => {
    for (const n of [2, 3, 7, 12, 20]) {
      const back = groupFromSigma(sigmaFromGroup(2.5, n), n);
      if (!near(back, 2.5, 1e-9)) return false;
    }
    return true;
  })());
  check('  nothing in, nothing out',
    sigmaFromGroup(0, 5) === null && sigmaFromGroup(2, 1) === null && groupFromSigma(-1) === null);
}

console.log('\nthe same rifle, different shot counts');
{
  // Groups that all imply sigma = 1, shot with different numbers of rounds.
  const three = groupFromSigma(1, 3);
  const ten = groupFromSigma(1, 10);
  check('  a 10-shot group is genuinely bigger than a 3-shot one',
    ten > three * 1.4, `${three.toFixed(2)} against ${ten.toFixed(2)} for identical shooting`);
  check('  normalising brings them to the same number',
    near(normaliseGroup(three, 3), normaliseGroup(ten, 10), 1e-9),
    `both read ${normaliseGroup(ten, 10).toFixed(3)} at ${REFERENCE_SHOTS} shots`);
  check('  a 5-shot group is left alone', near(normaliseGroup(2.4, 5), 2.4, 1e-9),
    'the reference count is a no-op');
}

console.log('\nwhat the old average did to a shooter who changed nothing');
{
  // One rifle, one load, sigma fixed. Early sessions are 3-shot groups, later
  // ones are 10-shot. Nothing about the shooting changed.
  const SIGMA = 0.35, N = 4000;
  let naiveEarly = 0, naiveLate = 0, normEarly = 0, normLate = 0;
  for (let i = 0; i < N; i++) {
    const e = groupES(3, SIGMA), l = groupES(10, SIGMA);
    naiveEarly += e; naiveLate += l;
    normEarly += normaliseGroup(e, 3); normLate += normaliseGroup(l, 10);
  }
  const nE = naiveEarly / N, nL = naiveLate / N;
  const oE = normEarly / N, oL = normLate / N;

  console.log(`  plain average   3-shot ${nE.toFixed(3)}  ->  10-shot ${nL.toFixed(3)}   (${((nL / nE - 1) * 100).toFixed(0)}% "worse")`);
  console.log(`  normalised      3-shot ${oE.toFixed(3)}  ->  10-shot ${oL.toFixed(3)}   (${((oL / oE - 1) * 100).toFixed(1)}% change)`);

  check('  the plain average moves a lot for no reason', nL / nE > 1.4,
    'this is what the analytics tile was reporting as a change in shooting');
  check('  the normalised figure barely moves', Math.abs(oL / oE - 1) < 0.03,
    'same rifle, same load, same number');
}

console.log('\na typical group across a mixed pile');
{
  const groups = [
    { inches: 0.9, shots: new Array(3) },
    { inches: 1.5, shots: new Array(10) },
    { inches: 1.1, shots: new Array(5) },
  ];
  const t = typicalGroup(groups);
  check('  reports one number', t && t.groups === 3, `${t.value.toFixed(3)}" from ${t.groups} groups`);
  check('  says which shot counts went into it', t.shotCounts.join() === '3,5,10');
  check('  and flags that it had to normalise', t.normalised === true,
    'a figure doing this much work should say so');
  check('  a pile of plain 5-shot groups is not flagged',
    typicalGroup([{ inches: 1, shots: new Array(5) }, { inches: 2, shots: new Array(5) }]).normalised === false);
  check('  median, not mean, so a flyer does not drag it', (() => {
    const withFlyer = typicalGroup([
      { inches: 1.0, shots: new Array(5) },
      { inches: 1.1, shots: new Array(5) },
      { inches: 9.0, shots: new Array(5) },
    ]);
    return near(withFlyer.value, 1.1, 1e-9);
  })());
  check('  nothing usable gives nothing', typicalGroup([]) === null &&
    typicalGroup([{ inches: 0, shots: new Array(5) }]) === null);
  check('  a group with one shot is dropped, not counted',
    typicalGroup([{ inches: 1, shots: new Array(5) }, { inches: 2, shots: new Array(1) }]).groups === 1);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
