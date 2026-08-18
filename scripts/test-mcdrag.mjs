/**
 * Validates the McDrag port.
 *
 * The hard part of checking a ported empirical model is that there is nothing
 * obvious to check it against: McCoy's report has worked examples and we do not
 * have it, and a fixture written from the same source as the code would agree
 * with the code however wrong both were. That is the exact trap this project
 * has already fallen into once, with compareToStandard.
 *
 * So the validation is against data we already hold and did not derive from
 * McDrag: the standard G1 and G7 tables. A bullet whose shape matches a
 * standard projectile must show a form factor near 1 against it, and - the part
 * that actually tests the curve rather than its magnitude - a form factor that
 * stays near constant across Mach. A wrong port could be scaled correctly by
 * accident; it could not also track the shape of an independent table.
 *
 * The result is unambiguous. A long boat-tail match shape lands on G7 at 0.96
 * with 3.4% variation, and on G1 at 0.53 with 13.5%. A flat-base blunt shape
 * lands on G1 at 0.81 and on G7 at 1.47. McDrag puts each shape on the standard
 * it belongs to, from geometry alone, having never seen either table.
 *
 * Run: node scripts/test-mcdrag.mjs
 */
import { mcDrag, mcDragCurve, lengthInCalibers, MCDRAG_MACHS } from '../lib/mcdrag.js';
import { standardCd } from '../lib/ballistics.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(58) + detail);
};

// Illustrative geometries, not any manufacturer's bullet: a stubby flat-base
// and a long boat-tail, chosen to sit either side of the two standards.
const FLAT_BASE = {
  diameterMm: 7.82, totalLengthCal: 3.0, noseLengthCal: 1.6, headshape: 1,
  boattailLengthCal: 0, baseDiameterCal: 1, meplatDiameterCal: 0.10,
};
const BOAT_TAIL = {
  diameterMm: 6.71, totalLengthCal: 4.6, noseLengthCal: 2.7, headshape: 0.8,
  boattailLengthCal: 0.55, baseDiameterCal: 0.86, meplatDiameterCal: 0.07,
};

const formFactor = (rows, model) => {
  const band = rows.filter(r => r.mach >= 1.0 && r.mach <= 3.0);
  const ratios = band.map(r => r.cd0 / standardCd(model, r.mach));
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const sd = Math.sqrt(ratios.reduce((a, b) => a + (b - mean) ** 2, 0) / ratios.length);
  return { mean, cov: sd / mean };
};

console.log('the curve is put together the way the source says');
{
  const r = mcDrag(BOAT_TAIL);
  check('  it runs', r.ok, r.reason || '');
  check('  one row per tabulated Mach', r.rows.length === MCDRAG_MACHS.length, `${r.rows.length}`);

  const worst = Math.max(...r.rows.map(x =>
    Math.abs(x.cd0 - (x.cdHead + x.cdSkinFriction + x.cdBand + x.cdBoattail + x.cdBase))));
  check('  CD0 is exactly the sum of its components', worst < 1e-12, worst.toExponential(1));

  check('  every component is non-negative',
    r.rows.every(x => x.cdHead >= 0 && x.cdSkinFriction >= 0 && x.cdBoattail >= 0 && x.cdBase >= 0));
  check('  base pressure ratio stays physical',
    r.rows.every(x => x.basePressureRatio >= 0 && x.basePressureRatio <= 1.5));
}

console.log('\nthe curve behaves like a drag curve');
{
  const r = mcDrag(BOAT_TAIL);
  const at = (m) => r.rows.find(x => x.mach === m).cd0;

  check('  subsonic drag is low and nearly flat',
    Math.abs(at(0.5) - at(0.8)) / at(0.5) < 0.1,
    `${at(0.5).toFixed(4)} to ${at(0.8).toFixed(4)}`);
  check('  it climbs steeply through transonic', at(1.0) > at(0.9) * 1.6,
    `${at(0.9).toFixed(4)} to ${at(1.0).toFixed(4)}`);

  let peak = r.rows[0];
  for (const x of r.rows) if (x.cd0 > peak.cd0) peak = x;
  check('  and peaks just above Mach 1, not below it',
    peak.mach > 1.0 && peak.mach <= 1.4, `peak ${peak.cd0.toFixed(4)} at Mach ${peak.mach}`);
  check('  then falls away supersonically',
    at(3.0) < at(1.5) && at(1.5) < peak.cd0,
    `${peak.cd0.toFixed(4)} → ${at(1.5).toFixed(4)} → ${at(3.0).toFixed(4)}`);
}

console.log('\nagainst the standard tables, which it has never seen');
{
  const bt = mcDrag(BOAT_TAIL).rows;
  const fb = mcDrag(FLAT_BASE).rows;

  const btG7 = formFactor(bt, 'G7'), btG1 = formFactor(bt, 'G1');
  const fbG1 = formFactor(fb, 'G1'), fbG7 = formFactor(fb, 'G7');

  check('  the boat-tail shape sits on G7 near unity',
    btG7.mean > 0.85 && btG7.mean < 1.15, `i = ${btG7.mean.toFixed(3)}`);
  check('  and holds that form factor across Mach 1-3',
    btG7.cov < 0.06, `${(btG7.cov * 100).toFixed(1)}% variation`);
  check('  the same shape fits G1 far worse',
    btG1.cov > btG7.cov * 2 && Math.abs(btG1.mean - 1) > Math.abs(btG7.mean - 1),
    `i = ${btG1.mean.toFixed(3)}, ${(btG1.cov * 100).toFixed(1)}% variation`);

  check('  the flat-base shape belongs to G1, not G7',
    Math.abs(fbG1.mean - 1) < Math.abs(fbG7.mean - 1),
    `G1 i = ${fbG1.mean.toFixed(3)} against G7 i = ${fbG7.mean.toFixed(3)}`);

  // The physical claim underneath all of it.
  const btAt = (m) => bt.find(x => x.mach === m).cd0;
  const fbAt = (m) => fb.find(x => x.mach === m).cd0;
  check('  and a boattail lowers drag everywhere it matters',
    btAt(0.5) < fbAt(0.5) && btAt(1.5) < fbAt(1.5) && btAt(3.0) < fbAt(3.0),
    `${btAt(1.5).toFixed(4)} against ${fbAt(1.5).toFixed(4)} at Mach 1.5`);

  // Base drag is most of subsonic drag, and the boattail is what reduces it.
  const fbBase = fb.find(x => x.mach === 0.5).cdBase;
  const btBase = bt.find(x => x.mach === 0.5).cdBase;
  check('  because it cuts base drag, which dominates subsonic',
    fbBase / fbAt(0.5) > 0.6 && btBase < fbBase * 0.75,
    `base ${fbBase.toFixed(4)} → ${btBase.toFixed(4)}`);
}

console.log('\nit refuses geometry it cannot mean anything for');
{
  check('  no diameter', !mcDrag({ totalLengthCal: 4, noseLengthCal: 2 }).ok);
  check('  nose longer than the bullet',
    !mcDrag({ diameterMm: 7, totalLengthCal: 2, noseLengthCal: 3 }).ok);
  check('  nose plus boattail longer than the bullet',
    !mcDrag({ diameterMm: 7, totalLengthCal: 3, noseLengthCal: 2.5, boattailLengthCal: 1 }).ok);
  check('  and says why rather than returning an empty curve',
    /nose/i.test(mcDrag({ diameterMm: 7, totalLengthCal: 2, noseLengthCal: 3 }).reason || ''));
}

console.log("\nMcCoy's own diagnostics still fire");
{
  const short = mcDrag({ ...BOAT_TAIL, noseLengthCal: 0.8 });
  check('  a nose under one caliber is flagged',
    short.warnings.some(w => /nose short/i.test(w)));
  const blunt = mcDrag({ ...BOAT_TAIL, meplatDiameterCal: 0.6 });
  check('  so is a meplat over half a caliber',
    blunt.warnings.some(w => /meplat/i.test(w)));
  const longBt = mcDrag({ ...BOAT_TAIL, totalLengthCal: 6, boattailLengthCal: 1.6 });
  check('  so is a boattail over 1.5 calibers',
    longBt.warnings.some(w => /boattail long/i.test(w)));
  const steep = mcDrag({ ...BOAT_TAIL, baseDiameterCal: 0.5 });
  check('  so is a boattail steeper than the fit allows',
    steep.warnings.some(w => /steeper/i.test(w)));
  check('  and a sane bullet is flagged for nothing',
    mcDrag(BOAT_TAIL).warnings.length === 0, `${mcDrag(BOAT_TAIL).warnings.length} warnings`);
}

console.log('\nand it hands the solver something it already accepts');
{
  const curve = mcDragCurve(mcDrag(BOAT_TAIL));
  check('  a [mach, cd] curve of the right length', curve.length === MCDRAG_MACHS.length);
  check('  ascending in Mach, positive in Cd',
    curve.every(([m, c], i) => c > 0 && (i === 0 || m > curve[i - 1][0])));
  check('  and nothing at all from a refused geometry',
    mcDragCurve({ ok: false }).length === 0);

  check('  length in calibers from inches',
    Math.abs(lengthInCalibers(1.35, 0.264) - 5.114) < 0.001,
    lengthInCalibers(1.35, 0.264).toFixed(3));
  check('  and refuses nonsense rather than returning Infinity',
    lengthInCalibers(1.35, 0) === null && lengthInCalibers(0, 0.264) === null);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
