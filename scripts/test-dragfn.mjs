/**
 * Validates importing a measured drag curve.
 *
 * The thing that matters is refusal. A half-parsed curve is worse than a
 * rejected one, because it will solve and it will be wrong, and nothing
 * downstream can tell. So most of this feeds the parser things that are not
 * drag curves and checks it says so.
 *
 * Run: node scripts/test-dragfn.mjs
 */
import {
  parseDragFunction, checkDragFunction, interpolateCd,
  makeDragFunction, compareToStandard, sectionalDensity, impliedBc,
} from '../lib/dragfn.js';
import { standardCd, solve } from '../lib/ballistics.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(56) + detail);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/** A plausible measured curve: flat subsonic, rising through transonic. */
const CURVE = [
  [0.00, 0.118], [0.40, 0.117], [0.70, 0.119], [0.80, 0.123], [0.85, 0.130],
  [0.90, 0.146], [0.95, 0.205], [1.00, 0.379], [1.05, 0.402], [1.20, 0.387],
  [1.50, 0.343], [2.00, 0.297], [2.50, 0.269], [3.00, 0.242],
];
const asCsv = (rows, sep = ',') => rows.map(r => r.join(sep)).join('\n');

console.log('reading a file');
{
  const p = parseDragFunction(asCsv(CURVE));
  check('  comma separated', p.ok && p.points.length === 14, `${p.points.length} points`);
  check('  tab separated', parseDragFunction(asCsv(CURVE, '\t')).ok);
  check('  space separated', parseDragFunction(asCsv(CURVE, ' ')).ok);
  check('  semicolon separated', parseDragFunction(asCsv(CURVE, ';')).ok);

  check('  a header row is skipped',
    parseDragFunction('Mach,Cd\n' + asCsv(CURVE)).points.length === 14);
  check('  comments are skipped',
    parseDragFunction('# Lapua GB528\n; notes\n' + asCsv(CURVE)).points.length === 14);

  // European files write 0,118 rather than 0.118.
  const euro = CURVE.map(([m, c]) => `${String(m).replace('.', ',')};${String(c).replace('.', ',')}`).join('\n');
  const pe = parseDragFunction(euro);
  check('  a decimal comma is understood', pe.ok && near(pe.points[0][1], 0.118, 1e-9),
    pe.ok ? `first Cd ${pe.points[0][1]}` : pe.reason);

  check('  points come back sorted', (() => {
    const shuffled = [...CURVE].reverse();
    const q = parseDragFunction(asCsv(shuffled));
    return q.points.every((pt, i) => i === 0 || pt[0] > q.points[i - 1][0]);
  })());
  check('  duplicate Mach values are collapsed',
    parseDragFunction(asCsv([...CURVE, [1.00, 0.380]])).points.length === 14,
    'two Cd values at one Mach would make interpolation ambiguous');
}

console.log('\nrefusing what is not a drag curve');
{
  check('  empty input', !parseDragFunction('').ok);
  check('  prose', !parseDragFunction('the quick brown fox\njumped over').ok);
  check('  too few points', !parseDragFunction('0.5,0.12\n1.0,0.38').ok);
  check('  and says how many it found',
    /Only 2 usable points/.test(parseDragFunction('0.5,0.12\n1.0,0.38').reason));

  // Numbers, but not this kind of data.
  const velocities = Array.from({ length: 20 }, (_, i) => `${2800 - i * 50},${1.2 + i * 0.1}`).join('\n');
  check('  a velocity table is not a drag curve', !parseDragFunction(velocities).ok,
    'Mach 2800 is outside anything real');

  const q = parseDragFunction(asCsv(CURVE.map(([m, c]) => [c, m])));
  check('  columns the wrong way round are caught by the shape check',
    !checkDragFunction(q).ok, checkDragFunction(q).level);
}

console.log('\nchecking the shape');
{
  const good = checkDragFunction(parseDragFunction(asCsv(CURVE)));
  check('  a real curve passes', good.ok && good.level === 'good', good.text);

  // Long enough to parse, so it reaches the coverage check rather than being
  // rejected for being too short. The first version filtered CURVE down to six
  // points and was refused one step earlier, for a different reason.
  const subsonicOnly = [];
  for (let m = 0; m <= 0.9; m += 0.05) subsonicOnly.push([+m.toFixed(2), 0.118 + m * 0.01]);
  const short = parseDragFunction(asCsv(subsonicOnly));
  const sc = checkDragFunction(short);
  check('  one that stops before transonic is refused', !sc.ok && sc.level === 'range');
  check('  and says why that matters', /transonic is where a custom curve earns/i.test(sc.text));

  // Falling through transonic is not a thing any projectile does.
  const backwards = CURVE.map(([m, c]) => [m, 0.5 - c * 0.5]);
  const bc = checkDragFunction(parseDragFunction(asCsv(backwards)));
  check('  drag that falls through transonic is refused', !bc.ok && bc.level === 'shape');
  check('  and suggests the likely cause', /columns are Mach first/.test(bc.text));
}

console.log('\ninterpolation');
{
  const pts = parseDragFunction(asCsv(CURVE)).points;
  check('  hits a tabulated point exactly', near(interpolateCd(pts, 1.05), 0.402, 1e-9));
  check('  interpolates between two', near(interpolateCd(pts, 1.025), (0.379 + 0.402) / 2, 1e-9));
  check('  clamps below the table', interpolateCd(pts, -1) === 0.118);
  check('  and above it', interpolateCd(pts, 99) === 0.242);
  check('  nothing in, nothing out', interpolateCd([], 1) === null);
}

console.log('\nprovenance is not optional');
{
  const pts = parseDragFunction(asCsv(CURVE)).points;
  check('  a curve without a source is refused',
    makeDragFunction({ name: 'GB528', points: pts }) === null,
    'six months on, nobody can tell where an unattributed curve came from');
  check('  or without a name', makeDragFunction({ source: 'Lapua', points: pts }) === null);
  check('  or without points', makeDragFunction({ name: 'x', source: 'y', points: [] }) === null);

  const df = makeDragFunction({ name: 'GB528', source: 'Lapua radar data', points: pts });
  check('  a complete one is kept, with when it arrived',
    df.name === 'GB528' && df.source === 'Lapua radar data' && !!df.addedAt);
  check('  and gets an id', !!df.id);
}

console.log('\nagainst the standard curve it replaces');
{
  const BC = 0.315, i = 0.65, SD = i * BC;
  const pts = parseDragFunction(asCsv(CURVE)).points;
  const cmp = compareToStandard({ points: pts, sd: SD, standardCd, model: 'G7', bc: BC });
  check('  compares at the Mach numbers that matter', cmp.rows.length >= 6);
  check('  and names where they diverge most',
    !!cmp.worst && cmp.worst.mach > 0, `worst at Mach ${cmp.worst.mach}, ratio ${cmp.worst.ratio.toFixed(2)}`);

  // The equivalence again, in the comparison rather than the solver: a bullet
  // whose Cd is i*Cd_G7, carried at SD = i*BC, is the bullet that BC describes.
  // Every row must read as no change.
  //
  // The earlier version of this built its fixture as Cd_std/BC and passed with
  // sd defaulting to 1, which made it agree with a comparison that was wrong.
  // A fixture built to the same convention as the code under test cannot
  // discover that the convention is the bug.
  const scaled = [];
  for (let m = 0; m <= 3; m += 0.05) scaled.push([+m.toFixed(2), standardCd('G7', +m.toFixed(2)) * i]);
  const same = compareToStandard({ points: scaled, sd: SD, standardCd, model: 'G7', bc: BC });
  check('  a curve equal to the standard reads as no change',
    same.rows.every(r => near(r.ratio, 1, 0.02)),
    `worst deviation ${(Math.abs(same.worst.ratio - 1) * 100).toFixed(1)}%`);

  // And the deceleration ratio is what the solver actually produces, so a
  // curve reading +20% here must drop measurably more there.
  const draggy = scaled.map(([m, c]) => [m, c * 1.2]);
  const worse = compareToStandard({ points: draggy, sd: SD, standardCd, model: 'G7', bc: BC });
  check('  a 20% draggier curve reads as +20%',
    worse.rows.every(r => near(r.ratio, 1.2, 0.03)),
    `${((worse.worst.ratio - 1) * 100).toFixed(0)}% at worst`);

  check('  refuses to compare without both divisors',
    compareToStandard({ points: scaled, sd: 0, standardCd, bc: BC }) === null
    && compareToStandard({ points: scaled, sd: SD, standardCd, bc: 0 }) === null,
    'a ratio of Cd against Cd/BC is a number with no meaning');
}

console.log('\nsectional density, which is what replaces the BC');
{
  // A 140gr 6.5mm: 140/7000 = 0.02 lb, over 0.264^2.
  check('  computed from weight and diameter',
    near(sectionalDensity(140, 0.264), 0.02 / (0.264 * 0.264), 1e-9),
    `${sectionalDensity(140, 0.264).toFixed(4)} lb/in²`);
  check('  refuses nonsense', sectionalDensity(0, 0.264) === null && sectionalDensity(140, 0) === null);
}

console.log('\nsolving with a curve rather than a coefficient');
{
  // The equivalence check, and the one that matters most.
  //
  // Take G7 scaled by a form factor: Cd = i * Cd_G7. A bullet with that curve
  // and sectional density SD = i * BC is, by definition, the same bullet as one
  // quoted at that BC. The two paths through solve() must agree - if they do
  // not, one of them is applying the form factor a second time.
  const BC = 0.315;
  const i = 0.65;
  const SD = i * BC;
  const scaled = [];
  for (let m = 0; m <= 4.001; m += 0.05) scaled.push([+m.toFixed(2), standardCd('G7', +m.toFixed(2)) * i]);

  const OPTS = {
    mvFps: 2800, sightHeightIn: 1.5, zeroYd: 100,
    tempF: 59, pressureInHg: 29.92, humidityPct: 50,
    windMph: 10, windAngleDeg: 90, maxRangeYd: 1000, stepYd: 200,
  };
  const std = solve({ ...OPTS, bc: BC, dragModel: 'G7' }).rows;
  const cus = solve({ ...OPTS, bc: BC, dragModel: 'G7', dragCurve: scaled, sectionalDensity: SD }).rows;

  check('  a curve equal to the standard reproduces the same drop',
    std.every((r, k) => near(r.dropIn, cus[k].dropIn, Math.max(0.2, Math.abs(r.dropIn) * 0.004))),
    `at 1000 yd: ${std[std.length - 1].dropIn.toFixed(1)}" against ${cus[cus.length - 1].dropIn.toFixed(1)}"`);
  check('  and the same wind drift',
    near(std[std.length - 1].windIn, cus[cus.length - 1].windIn, 0.5),
    `${std[std.length - 1].windIn.toFixed(1)}" against ${cus[cus.length - 1].windIn.toFixed(1)}"`);

  // A curve with no sectional density must not be used with the BC as divisor.
  const noSd = solve({ ...OPTS, bc: BC, dragModel: 'G7', dragCurve: scaled }).rows;
  check('  a curve without a sectional density falls back to the standard model',
    near(noSd[noSd.length - 1].dropIn, std[std.length - 1].dropIn, 1e-9),
    'rather than dividing a real Cd by a BC, which would understate drag by 1/i');

  // And that the curve is actually being used, so the check above is not passing
  // because the argument is ignored altogether.
  const draggier = scaled.map(([m, c]) => [m, c * 1.3]);
  const worse = solve({ ...OPTS, bc: BC, dragModel: 'G7', dragCurve: draggier, sectionalDensity: SD }).rows;
  check('  a draggier curve drops more',
    worse[worse.length - 1].dropIn < std[std.length - 1].dropIn - 5,
    `${worse[worse.length - 1].dropIn.toFixed(1)}" against ${std[std.length - 1].dropIn.toFixed(1)}"`);
}

console.log('\nthe BC a curve implies, which is not one number');
{
  const BC = 0.315, i = 0.65, SD = i * BC;
  const flat = [];
  for (let m = 0; m <= 3.001; m += 0.05) flat.push([+m.toFixed(2), standardCd('G7', +m.toFixed(2)) * i]);

  const same = impliedBc(flat, SD, standardCd, 'G7');
  check('  a curve that is the standard reads as one flat BC',
    same.spreadPct < 0.5, `spread ${same.spreadPct.toFixed(2)}% around ${BC}`);
  check('  and that BC is the one it was built from', near(same.rows[0].bc, BC, 0.002),
    `${same.rows[0].bc.toFixed(3)}`);

  // Built to depart from G7 rather than reused from the parsing fixture. CURVE
  // happens to sit within 2% of G7 everywhere, so asserting spread on it was
  // really asserting an accident of numbers invented for a different test.
  //
  // This one is shaped the way a real bullet departs: a form factor that is
  // better than the reference supersonically and worse through transonic, which
  // is where the reference shape stops describing modern boat-tails.
  const departs = [];
  for (let m = 0; m <= 3.001; m += 0.05) {
    const mm = +m.toFixed(2);
    const factor = i * (1 + 0.25 * Math.exp(-Math.pow((mm - 1.05) / 0.18, 2)));
    departs.push([mm, standardCd('G7', mm) * factor]);
  }
  const real = impliedBc(departs, SD, standardCd, 'G7');
  check('  one that departs from the reference shape does not', real.spreadPct > 15,
    `${real.min.toFixed(3)} to ${real.max.toFixed(3)}, ${real.spreadPct.toFixed(0)}% - why one quoted number drifts`);
  check('  and it is lowest through transonic, where it should be',
    Math.abs(real.rows.reduce((a, b) => (b.bc < a.bc ? b : a)).mach - 1.05) < 0.15,
    `minimum at Mach ${real.rows.reduce((a, b) => (b.bc < a.bc ? b : a)).mach}`);
  check('  nothing in, nothing out', impliedBc([], SD, standardCd) === null && impliedBc(flat, 0, standardCd) === null);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
