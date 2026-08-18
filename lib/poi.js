/**
 * Point of impact, group geometry and the correction to dial.
 *
 * A recorded target holds shots and four reference corners in one normalised
 * space (both axes divided by the same number, so the space is uniform and a
 * homography built from the corners maps it straight to inches on the target
 * plane). That is enough for group size. It is not enough for point of impact,
 * which is measured from the point of aim — so an aim point is recorded too,
 * and without one this module reports group geometry and says POI is
 * unavailable rather than guessing at sheet centre.
 *
 * Axis convention: the rectified plane inherits screen orientation, so y grows
 * downward. A shot with larger y landed LOWER. Everything below converts to
 * plain words — right/left, high/low — at the boundary, because a sign error in
 * a scope correction sends the next group further away, not closer.
 *
 * The centroid's own uncertainty is reported alongside it. With three shots the
 * group centre is a poor estimate of where the rifle actually shoots, and
 * dialling a correction smaller than that uncertainty is chasing noise. This is
 * the number that stops a shooter zeroing off a three-shot group.
 */

import { rectifyToInches, project, orderCorners, quadCentre } from './homography.js';
import { rayleighSigma } from './stats.js';
import { inchesToUnit, groupUnitLabel } from './units.js';

/** 95% radius of a Rayleigh distribution, in units of sigma. */
const R95 = Math.sqrt(-2 * Math.log(0.05));

/**
 * Everything measurable about one recorded target.
 *
 * @param target      { shots: [{x,y}], scale: { corners, widthIn, heightIn }, aim }
 * @param distanceYd  distance the target was shot at
 * @param unit        display unit for group figures ('MOA' | 'MRAD' | 'Inches')
 */
export function targetMetrics(target, distanceYd, unit = 'MOA') {
  const shots = target?.shots || [];
  const scale = target?.scale;

  if (!scale?.corners || scale.corners.length !== 4) {
    return { ok: false, reason: 'This target has no reference corners, so nothing can be measured in real units.' };
  }
  if (shots.length < 1) {
    return { ok: false, reason: 'No shots recorded on this target.' };
  }

  const ordered = orderCorners(scale.corners);
  const H = rectifyToInches(ordered, scale.widthIn, scale.heightIn);
  if (!H) return { ok: false, reason: 'The reference corners on this target are unusable.' };

  const inches = shots.map(p => project(H, p)).filter(Boolean);
  if (inches.length !== shots.length) {
    return { ok: false, reason: 'Some shots could not be projected onto the target plane.' };
  }

  const n = inches.length;
  const cx = inches.reduce((a, p) => a + p.x, 0) / n;
  const cy = inches.reduce((a, p) => a + p.y, 0) / n;

  // Offsets from the group's own centre, which is what dispersion is about.
  const offsets = inches.map(p => ({ x: p.x - cx, y: p.y - cy }));

  let extremeSpreadIn = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(inches[i].x - inches[j].x, inches[i].y - inches[j].y);
      if (d > extremeSpreadIn) extremeSpreadIn = d;
    }
  }
  const meanRadiusIn = offsets.reduce((a, o) => a + Math.hypot(o.x, o.y), 0) / n;
  const sigmaIn = n >= 2 ? rayleighSigma(offsets, 1) : null;

  // How well this group pins down where the rifle shoots. The centre of n shots
  // scatters with sigma/sqrt(n), so its 95% circle shrinks only as sqrt(n).
  const centreSeIn = sigmaIn != null && n > 0 ? sigmaIn / Math.sqrt(n) : null;
  const centre95In = centreSeIn != null ? centreSeIn * R95 : null;

  const toUnit = (v) => (v == null ? null : inchesToUnit(v, distanceYd, unit));
  const round = (v) => (v == null ? null : +v.toFixed(2));

  const metrics = {
    ok: true,
    n,
    unit: groupUnitLabel(unit),
    shotsIn: inches,
    centroidIn: { x: cx, y: cy },
    offsetsIn: offsets,
    extremeSpread: round(toUnit(extremeSpreadIn)),
    meanRadius: round(toUnit(meanRadiusIn)),
    sigma: round(toUnit(sigmaIn)),
    centre95: round(toUnit(centre95In)),
    extremeSpreadIn: +extremeSpreadIn.toFixed(3),
    meanRadiusIn: +meanRadiusIn.toFixed(3),
    poi: null,
  };

  // Absent an explicit aim point, assume the centre of the reference the shooter
  // framed. That is usually right — people aim at the middle of what they put up
  // — but it is an assumption, so it travels with a flag and the UI says so.
  const explicit = target?.aim && isFinite(target.aim.x) && isFinite(target.aim.y);
  const aimPt = explicit ? target.aim : quadCentre(ordered);
  metrics.aimAssumed = !explicit;
  metrics.aimIn = aimPt ? project(H, aimPt) : null;
  metrics.poi = pointOfImpact(aimPt, !explicit, H, { x: cx, y: cy }, distanceYd, unit, metrics.centre95, n);
  return metrics;
}

/**
 * Where the group landed relative to where the shooter aimed, and what to dial.
 *
 * The correction is the negative of the offset: a group printing right of aim
 * needs left windage. Both are returned, named unambiguously, because "0.8
 * right" is a statement about the group and "0.8 left" is an instruction to the
 * turret and confusing them costs a whole zeroing session.
 */
function pointOfImpact(aim, assumed, H, centroidIn, distanceYd, unit, centre95, n) {
  if (!aim || !isFinite(aim.x) || !isFinite(aim.y)) {
    return {
      available: false,
      reason: 'This target has no usable reference, so point of impact cannot be measured.',
    };
  }
  const aimIn = project(H, aim);
  if (!aimIn) return { available: false, reason: 'The aim point could not be projected.' };

  const dxIn = centroidIn.x - aimIn.x;
  // y grows downward on the rectified plane, so a positive dy means the group
  // landed below the aim point.
  const dyIn = centroidIn.y - aimIn.y;

  const conv = (v) => {
    const u = inchesToUnit(Math.abs(v), distanceYd, unit);
    return u == null ? null : +u.toFixed(2);
  };

  const right = conv(dxIn), vertical = conv(dyIn);
  const radialIn = Math.hypot(dxIn, dyIn);
  const radial = conv(radialIn);

  const horizWord = Math.abs(dxIn) < 1e-9 ? null : dxIn > 0 ? 'right' : 'left';
  const vertWord = Math.abs(dyIn) < 1e-9 ? null : dyIn > 0 ? 'low' : 'high';

  // What the turret needs, which is the opposite of where the group went.
  const dialH = horizWord === 'right' ? 'L' : horizWord === 'left' ? 'R' : null;
  const dialV = vertWord === 'low' ? 'U' : vertWord === 'high' ? 'D' : null;

  // Dialling a correction smaller than the centre's own uncertainty is chasing
  // noise, and with three shots that threshold is large.
  const meaningful = centre95 == null || radial == null ? true : radial > centre95;

  const parts = [];
  if (vertWord) parts.push(`${vertical} ${vertWord}`);
  if (horizWord) parts.push(`${right} ${horizWord}`);

  return {
    available: true,
    assumed,
    horizontal: right,
    vertical,
    radial,
    horizontalWord: horizWord,
    verticalWord: vertWord,
    dial: [
      dialV ? `${vertical} ${dialV}` : null,
      dialH ? `${right} ${dialH}` : null,
    ].filter(Boolean).join(' · ') || 'On zero',
    summary: parts.length ? parts.join(' · ') : 'Centred on aim',
    meaningful,
    note: meaningful
      ? null
      : `That is inside the ±${centre95} ${groupUnitLabel(unit)} this group can resolve — ${n} shot${n === 1 ? '' : 's'} does not pin the centre down well enough to dial on. Shoot more before correcting.`,
  };
}

/**
 * Session-level point of impact: every shot from every target of the session,
 * pooled against each target's own aim point.
 *
 * Pooling matters for zeroing. One five-shot group locates the centre to within
 * a circle; three of them shrink it by sqrt(3), and it is the pooled centre a
 * shooter should actually dial on.
 */
export function sessionPoi(session, unit = 'MOA') {
  const targets = (session?.targets || []);
  const distanceYd = Number(session?.distanceYd) || 0;

  const perTarget = targets.map(t => targetMetrics(t, distanceYd, unit));
  const usable = perTarget.filter(m => m.ok && m.poi?.available);

  if (!usable.length) {
    return {
      ok: false,
      perTarget,
      reason: targets.length
        ? 'No target in this session has reference corners, so point of impact cannot be measured.'
        : 'This session has no targets.',
    };
  }

  // Offset of each target's centroid from its own aim, in inches, then pooled
  // weighted by shot count.
  let sx = 0, sy = 0, total = 0, anyAssumed = false;
  for (const m of usable) {
    sx += (m.centroidIn.x - m.aimIn.x) * m.n;
    sy += (m.centroidIn.y - m.aimIn.y) * m.n;
    total += m.n;
    if (m.aimAssumed) anyAssumed = true;
  }
  const dxIn = sx / total, dyIn = sy / total;

  const conv = (v) => {
    const u = inchesToUnit(Math.abs(v), distanceYd, unit);
    return u == null ? null : +u.toFixed(2);
  };
  const horizWord = Math.abs(dxIn) < 1e-9 ? null : dxIn > 0 ? 'right' : 'left';
  const vertWord = Math.abs(dyIn) < 1e-9 ? null : dyIn > 0 ? 'low' : 'high';
  const dialH = horizWord === 'right' ? 'L' : horizWord === 'left' ? 'R' : null;
  const dialV = vertWord === 'low' ? 'U' : vertWord === 'high' ? 'D' : null;
  const h = conv(dxIn), v = conv(dyIn);

  return {
    ok: true,
    perTarget,
    // True when any pooled target fell back to the assumed centre, so the
    // screen can say the figure rests on that assumption.
    assumed: anyAssumed,
    targetsUsed: usable.length,
    shots: total,
    unit: groupUnitLabel(unit),
    horizontal: h,
    vertical: v,
    horizontalWord: horizWord,
    verticalWord: vertWord,
    summary: [vertWord ? `${v} ${vertWord}` : null, horizWord ? `${h} ${horizWord}` : null]
      .filter(Boolean).join(' · ') || 'Centred on aim',
    dial: [dialV ? `${v} ${dialV}` : null, dialH ? `${h} ${dialH}` : null]
      .filter(Boolean).join(' · ') || 'On zero',
  };
}
