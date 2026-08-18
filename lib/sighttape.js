/**
 * Turret sight tape.
 *
 * A sight tape is a strip printed at 1:1 and wrapped around the elevation
 * turret, marked with yardages at the angular positions they dial to. It turns
 * "what do I dial for 650?" into reading a label, which is the difference
 * between making a shot and fumbling a dope card under time.
 *
 * Because it is wrapped around a cylinder, the geometry is a straight
 * proportion: a turret that moves N units per revolution spreads those N units
 * evenly around its circumference, so a mark's distance along the tape is its
 * fraction of a revolution times pi*d.
 *
 * The output is only correct if the tape is printed without scaling, which the
 * caller is expected to say out loud.
 */

/**
 * @param rows        dope card rows: { rangeYd, elevation } in `unit`
 * @param opts.turretDiameterIn  turret body diameter
 * @param opts.perRev            elevation units in one full revolution
 * @param opts.clickValue        elevation units per click
 * @returns revolutions, each holding the marks that fall within it
 */
export function sightTape(rows, opts = {}) {
  const N = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };
  const turretDiameterIn = N(opts.turretDiameterIn, 1.5);
  const perRev = N(opts.perRev, 15);
  const clickValue = N(opts.clickValue, 0.25);

  if (!(turretDiameterIn > 0) || !(perRev > 0)) {
    return { error: 'Turret diameter and travel per revolution must be positive.' };
  }

  const circumferenceIn = Math.PI * turretDiameterIn;
  const byRev = new Map();
  let maxElevation = 0;

  for (const r of rows || []) {
    const elev = N(r.elevation, null);
    if (elev == null || elev < 0) continue;
    maxElevation = Math.max(maxElevation, elev);

    // Which turn of the turret this lands on, and where within it.
    const revIndex = Math.floor(elev / perRev);
    const within = elev - revIndex * perRev;

    const mark = {
      rangeYd: r.rangeYd,
      elevation: +elev.toFixed(2),
      // Distance along the printed strip from the revolution's start.
      offsetIn: +((within / perRev) * circumferenceIn).toFixed(3),
      withinRev: +within.toFixed(2),
      clicks: clickValue > 0 ? Math.round(elev / clickValue) : null,
      transonic: !!r.transonic,
    };

    if (!byRev.has(revIndex)) byRev.set(revIndex, []);
    byRev.get(revIndex).push(mark);
  }

  const revolutions = [...byRev.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, marks]) => ({
      index,
      marks: marks.sort((a, b) => a.offsetIn - b.offsetIn),
    }));

  return {
    error: null,
    circumferenceIn: +circumferenceIn.toFixed(3),
    perRev,
    clickValue,
    revolutions,
    // How many turns the load needs, which tells the shooter whether a
    // single-turn tape is enough or the scope will run out of travel.
    revolutionsNeeded: Math.ceil(maxElevation / perRev) || 0,
    maxElevation: +maxElevation.toFixed(2),
  };
}

/** Printable rows, one per mark, for export. */
export function tapeToRows(tape) {
  if (!tape || tape.error) return [];
  const out = [];
  for (const rev of tape.revolutions) {
    for (const m of rev.marks) {
      out.push({
        revolution: rev.index + 1,
        rangeYd: m.rangeYd,
        elevation: m.elevation,
        offsetIn: m.offsetIn,
        clicks: m.clicks,
      });
    }
  }
  return out;
}
