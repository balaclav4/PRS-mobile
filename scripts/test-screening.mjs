/**
 * Validates component screening.
 *
 * The module claims elimination is a sound call where crowning a winner is not.
 * That claim is only worth making if the elimination rate is measured: how
 * often does it discard a combination that was never actually worse? And does
 * it still catch one that genuinely is?
 *
 * Run: node scripts/test-screening.mjs
 */
import { parseCandidates, analyseScreen } from '../lib/screening.js';
import { esCoefficientOfVariation } from '../lib/seating.js';

let seed = 24601;
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

const rows = (pairs) => pairs.map(([name, groupMoa], i) =>
  ({ id: String(i), name, groupMoa: groupMoa == null ? '' : String(groupMoa) }));

console.log('parsing');
{
  const p = parseCandidates(rows([
    ['H4350 / 140 Hybrid', 0.62], ['Varget / 140 Hybrid', null], ['', 0.55],
    ['RL16 / 147 ELD', 0.71],
  ]));
  check('  keeps only named rows with a group', p.length === 2, `${p.length} of 4`);
  check('  too few candidates is refused', analyseScreen(parseCandidates(rows([
    ['A', 0.5], ['B', 0.6],
  ]))).ok === false);
  check('  empty is safe', analyseScreen([]).ok === false);
}

console.log('\nit does not crown a winner');
{
  const r = analyseScreen(parseCandidates(rows([
    ['H4350', 0.42], ['Varget', 0.55], ['RL16', 0.61], ['N150', 0.58],
    ['H4831', 0.63], ['IMR4451', 0.59],
  ])));
  check('  reports no winner', r.winner === null);
  check('  says the survivors are unranked', /deliberately unranked/.test(r.verdict));
  check('  and that the order is noise', /mostly noise/.test(r.verdict));
  check('  carries the good ones forward', r.carryForward.length >= 5,
    `${r.carryForward.length} of 6`);
}

console.log('\nfalse elimination rate');
{
  // Six combinations that are all genuinely identical. Any elimination here is
  // a component discarded for no reason.
  let discarded = 0, trials = 0;
  const TRIALS = 500, K = 6, SHOTS = 5, TRUE = 0.60;
  const cv = esCoefficientOfVariation(SHOTS);
  for (let t = 0; t < TRIALS; t++) {
    const pairs = [];
    for (let i = 0; i < K; i++) {
      pairs.push([`C${i}`, +Math.max(0.05, TRUE * (1 + gauss() * cv)).toFixed(3)]);
    }
    const r = analyseScreen(parseCandidates(rows(pairs)), SHOTS);
    trials++;
    if (r.eliminated.length) discarded++;
  }
  const rate = discarded / trials;
  // Nominal is 5% after the Bonferroni correction. It measured 9.2% until the
  // median's own sampling error was folded into the yardstick — a low median
  // dragged the cutoff down with it.
  check('  discards an identical combination near the nominal 5%', rate <= 0.07,
    `${(rate * 100).toFixed(1)}% of ${TRIALS} all-identical screens`);
}

console.log('\nbut it does catch a genuine dog');
{
  // Five good combinations and one that really is twice as bad.
  let caught = 0;
  const TRIALS = 500, SHOTS = 5, TRUE = 0.60, BAD = 1.45;
  const cv = esCoefficientOfVariation(SHOTS);
  for (let t = 0; t < TRIALS; t++) {
    const pairs = [];
    for (let i = 0; i < 5; i++) {
      pairs.push([`C${i}`, +Math.max(0.05, TRUE * (1 + gauss() * cv)).toFixed(3)]);
    }
    pairs.push(['Dog', +Math.max(0.05, BAD * (1 + gauss() * cv)).toFixed(3)]);
    const r = analyseScreen(parseCandidates(rows(pairs)), SHOTS);
    if (r.eliminated.some(c => c.name === 'Dog')) caught++;
  }
  const rate = caught / TRIALS;
  // Correcting the false-alarm rate cost almost nothing here: 77.6% -> 74.8%.
  check('  eliminates a genuinely bad combination', rate >= 0.60,
    `${(rate * 100).toFixed(1)}% of ${TRIALS} screens with one dog`);
}

console.log('\nthe correction for looking at everything');
{
  // More candidates means a stricter per-candidate threshold. Without that,
  // screening more components would throw more of them away for free.
  const six = analyseScreen(parseCandidates(rows([
    ['A', 0.60], ['B', 0.60], ['C', 0.60], ['D', 0.60], ['E', 0.60], ['F', 1.20],
  ])));
  const twelve = analyseScreen(parseCandidates(rows([
    ...Array.from({ length: 11 }, (_, i) => [`C${i}`, 0.60]), ['F', 1.20],
  ])));
  check('  a wider screen sets a higher bar', twelve.cutoff > six.cutoff,
    `${six.cutoff} MOA at k=6 vs ${twelve.cutoff} at k=12`);
  check('  the level is unmoved by the outlier',
    six.level === 0.6 && twelve.level === 0.6, `${six.level} MOA`);
}

console.log('\nmore shots sharpens the screen');
{
  const pairs = rows([
    ['A', 0.60], ['B', 0.62], ['C', 0.58], ['D', 0.61], ['E', 0.59], ['Dog', 1.05],
  ]);
  const at3 = analyseScreen(parseCandidates(pairs), 3);
  const at10 = analyseScreen(parseCandidates(pairs), 10);
  check('  3-shot groups cannot rule the dog out', at3.eliminated.length === 0,
    `cutoff ${at3.cutoff} MOA`);
  check('  10-shot groups can', at10.eliminated.some(c => c.name === 'Dog'),
    `cutoff ${at10.cutoff} MOA`);
}

console.log('\nnothing to eliminate');
{
  const r = analyseScreen(parseCandidates(rows([
    ['A', 0.58], ['B', 0.61], ['C', 0.60], ['D', 0.63], ['E', 0.59],
  ])));
  check('  says so plainly', /Nothing here is bad enough to rule out/.test(r.verdict));
  check('  and carries everything forward', r.carryForward.length === 5);
  check('  still names no winner', r.winner === null);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
