export function computeScale(p1, p2, markerDiameterIn) {
  const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
  if (dist === 0) return null;
  return markerDiameterIn / dist;
}

export function computeGroupStats(shots, inchesPerUnit, distanceYd) {
  if (shots.length < 2 || !inchesPerUnit) return null;

  const cx = shots.reduce((a, s) => a + s.x, 0) / shots.length;
  const cy = shots.reduce((a, s) => a + s.y, 0) / shots.length;

  let esNorm = 0;
  for (let i = 0; i < shots.length; i++) {
    for (let j = i + 1; j < shots.length; j++) {
      const d = Math.hypot(shots[i].x - shots[j].x, shots[i].y - shots[j].y);
      if (d > esNorm) esNorm = d;
    }
  }

  const mrNorm =
    shots.reduce((a, s) => a + Math.hypot(s.x - cx, s.y - cy), 0) /
    shots.length;

  const extremeSpreadIn = esNorm * inchesPerUnit;
  const meanRadiusIn = mrNorm * inchesPerUnit;
  const groupMoa = extremeSpreadIn / (1.047 * (distanceYd / 100));

  return {
    extremeSpreadIn: +extremeSpreadIn.toFixed(3),
    groupMoa: +groupMoa.toFixed(3),
    meanRadiusIn: +meanRadiusIn.toFixed(3),
    centroid: { x: cx, y: cy },
  };
}

/**
 * The old dope-card solver lived here: a single exponential velocity decay with
 * a hand-tuned constant. It has been replaced by lib/ballistics.js, which
 * integrates against the standard G1/G7 drag tables — the old model could not
 * represent the transonic drag rise (Cd roughly triples between Mach 0.9 and
 * 1.0 on G7) and so was wrong exactly where long-range dope matters.
 */

export function twoSampleTTest(group1, group2) {
  if (group1.length < 2 || group2.length < 2) return null;

  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = (arr) => {
    const m = mean(arr);
    return arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1);
  };

  const m1 = mean(group1);
  const m2 = mean(group2);
  const v1 = variance(group1);
  const v2 = variance(group2);
  const n1 = group1.length;
  const n2 = group2.length;

  const se = Math.sqrt(v1 / n1 + v2 / n2);
  if (se === 0) return null;

  const t = (m1 - m2) / se;

  const num = (v1 / n1 + v2 / n2) ** 2;
  const den =
    (v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1);
  const df = Math.floor(num / den);

  const significant = Math.abs(t) > 2.0 && df >= 2;

  return { t: +t.toFixed(2), df, significant };
}
