/**
 * Validates charge-ladder node detection, above all its honesty about noise.
 *
 * The headline test is the false-positive rate: a ladder with NO real node —
 * pure linear velocity plus shot noise — must not be reported as having one.
 * That is the failure mode the load-development literature is full of.
 *
 * Run: node scripts/test-loaddev.mjs
 */
import { parseRungs, findNode, residualSd, bestGroup, pooledWithinSd } from '../lib/loaddev.js';

let seed = 987654321;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function gauss() { return Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd()); }

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(52) + detail);
};

const rows = (arr) => arr.map(([c, v, g], i) => ({ id: String(i), charge: String(c), velocity: String(v), groupMoa: g == null ? '' : String(g) }));

// --- parsing -----------------------------------------------------------------
{
  const parsed = parseRungs(rows([[33.4, 2915, 0.31], [33.0, 2892, 0.34], [33.2, 2905, null]]));
  check('parse sorts by charge and drops blanks', parsed.length === 3 && parsed[0].charge === 33.0);

  const partial = parseRungs([
    { id: 'a', charge: '33.0', velocity: '', groupMoa: '' },
    { id: 'b', charge: '', velocity: '2900', groupMoa: '' },
    { id: 'c', charge: '33.2', velocity: '2905', groupMoa: '' },
  ]);
  check('incomplete rows are ignored', partial.length === 1 && partial[0].charge === 33.2);
}

// --- a genuinely flat node ---------------------------------------------------
{
  // Velocity climbs ~30 fps/gr except across 33.2-33.6, which is deliberately flat.
  const ladder = rows([
    [32.6, 2830], [32.8, 2846], [33.0, 2862],
    [33.2, 2878], [33.4, 2880], [33.6, 2882],
    [33.8, 2898], [34.0, 2914],
  ]);
  const { node, verdict } = findNode(parseRungs(ladder), { shotsPerCharge: 5 });
  check('real node is found', node && node.centreCharge === 33.4, `centre ${node?.centreCharge}gr`);
  check('real node is flatter than overall', node && node.slope < node.overallSlope,
    `${node?.slope} vs ${node?.overallSlope} fps/gr`);
  check('real node is called significant', node?.significant === true, `z=${node?.flatteningZ}`);
}

// --- no node at all: pure line + noise ---------------------------------------
{
  // The honesty test. 30 fps/gr, 15 fps SD, one shot per charge. Any "flattest
  // window" here is chance, and must be reported as such.
  let falsePositives = 0;
  const TRIALS = 200;
  for (let t = 0; t < TRIALS; t++) {
    const ladder = [];
    for (let i = 0; i < 8; i++) {
      const c = 32.6 + i * 0.2;
      ladder.push([+c.toFixed(1), Math.round(2830 + (c - 32.6) * 30 + gauss() * 15)]);
    }
    const { node } = findNode(parseRungs(rows(ladder)), { shotsPerCharge: 1 });
    if (node?.significant) falsePositives++;
  }
  const rate = falsePositives / TRIALS;
  check('no-node ladder rarely claims a node', rate <= 0.05,
    `${(rate * 100).toFixed(1)}% of ${TRIALS} noise-only ladders (want <=5%)`);
}

// --- the verdict wording is honest on a single-shot ladder --------------------
{
  const ladder = rows([
    [32.6, 2830], [32.8, 2846], [33.0, 2862],
    [33.2, 2878], [33.4, 2880], [33.6, 2882],
    [33.8, 2898], [34.0, 2914],
  ]);
  const one = findNode(parseRungs(ladder), { shotsPerCharge: 1 });
  const five = findNode(parseRungs(ladder), { shotsPerCharge: 5 });
  check('same data, 1 shot/charge is less certain than 5',
    one.node.flatteningZ < five.node.flatteningZ,
    `z ${one.node.flatteningZ} -> ${five.node.flatteningZ}`);

  // A ladder whose flattest window really is noise must say so and prescribe
  // the fix, rather than naming a charge as if it were established.
  const noisy = [];
  for (let i = 0; i < 8; i++) {
    const c = +(32.6 + i * 0.2).toFixed(1);
    noisy.push([c, Math.round(2830 + (c - 32.6) * 30 + gauss() * 15)]);
  }
  const weak = findNode(parseRungs(rows(noisy)), { shotsPerCharge: 1 });
  check('noise-only verdict prescribes more shots',
    !weak.node.significant && /shoot 3-5 per charge/.test(weak.verdict),
    `z=${weak.node.flatteningZ}`);
}

// --- degenerate input --------------------------------------------------------
{
  check('too few rungs is refused',
    findNode(parseRungs(rows([[33.0, 2890], [33.2, 2905]]))).node === null);
  check('falling velocity is refused',
    findNode(parseRungs(rows([[33.0, 2950], [33.2, 2900], [33.4, 2850]]))).node === null);
  const flat = findNode(parseRungs(rows([[33.0, 2900], [33.2, 2900], [33.4, 2900]])));
  check('perfectly flat ladder does not crash', flat.node === null || flat.node.slope === 0);
}

// --- helpers -----------------------------------------------------------------
{
  const parsed = parseRungs(rows([[33.0, 2892, 0.34], [33.2, 2905, 0.29], [33.4, 2915, 0.31]]));
  check('bestGroup picks the smallest', bestGroup(parsed)?.groupMoa === 0.29);
  check('bestGroup is null without group data',
    bestGroup(parseRungs(rows([[33.0, 2892], [33.2, 2905]]))) === null);
  const sd = residualSd(parsed);
  check('residual SD reported and flagged weak when short', sd.sd != null && sd.weak === true,
    `sd=${sd.sd?.toFixed(1)} fps`);
}


// --- measured noise from per-rung strings ------------------------------------
{
  // Same ladder, but each rung carries a real chrono string. The pooled
  // within-rung SD should be used instead of the residual-from-trend estimate.
  const mk = (c, vs) => ({ id: 'x' + c, charge: String(c), velocity: '', groupMoa: '', velocities: vs });
  const jitter = (base) => [base - 6, base, base + 6];
  const ladder = [
    mk(32.6, jitter(2830)), mk(32.8, jitter(2846)), mk(33.0, jitter(2862)),
    mk(33.2, jitter(2878)), mk(33.4, jitter(2880)), mk(33.6, jitter(2882)),
    mk(33.8, jitter(2898)), mk(34.0, jitter(2914)),
  ];
  const parsed = parseRungs(ladder);
  check('velocity comes from the string mean', parsed[0].velocity === 2830, String(parsed[0].velocity));

  const pooled = pooledWithinSd(parsed);
  // SD of [-6, 0, +6] is 6 exactly.
  check('pooled within-rung SD is measured', Math.abs(pooled.sd - 6) < 1e-9, `${pooled.sd.toFixed(2)} fps`);

  const r = findNode(parsed);
  check('node uses measured noise', r.sdSource === 'measured', r.sdSource);
  check('shots per rung derived from data', r.shotsPerRung === 3, String(r.shotsPerRung));
  check('verdict names measured noise', /measured noise/.test(r.verdict) || !r.node.significant);

  // Without strings the same ladder falls back.
  const bare = parseRungs(ladder.map(x => ({ ...x, velocities: [], velocity: String(x.velocities[1]) })));
  check('falls back to residual without strings', findNode(bare).sdSource === 'residual');
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
