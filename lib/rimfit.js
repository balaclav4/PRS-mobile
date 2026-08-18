/**
 * Finding the printed bull from two taps.
 *
 * Four taps around a rim was the wrong trade. It is slow, it is done blind at a
 * zoom level where the bull is 78px across, and finger precision is the limit on
 * the answer. Two taps - the centre and any point on the edge - give a centre
 * and an approximate radius, and from there the image itself can say where the
 * rim actually is. A bull is a high-contrast disc on paper, which is a far
 * easier thing to find than a bullet hole.
 *
 * The measurement also buys back something four taps could never provide. A
 * circle photographed off-axis is an ellipse, and fitting the rim as an ellipse
 * means the major axis is the true diameter, unforeshortened. So an angled photo
 * yields the correct scale rather than a warning about a wrong one, and the axis
 * ratio reports the tilt without anyone being asked to tap more carefully.
 *
 * The approximation, stated plainly: under a genuine projective transform the
 * centre of a circle does not map to the centre of its image ellipse, and a
 * conic does not carry in-plane rotation. For a phone held a few feet from a
 * target the transform is very nearly affine and the error is far below finger
 * precision. For a severely oblique photograph the four-corner reference is
 * still the honest path, and rimQuality says so.
 */
import { fitCircle } from './circlefit.js';

const TAU = Math.PI * 2;

/** Bilinear sample, or null outside the image. */
function sample(gray, w, h, x, y) {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return null;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const i = y0 * w + x0;
  return gray[i] * (1 - fx) * (1 - fy) + gray[i + 1] * fx * (1 - fy)
       + gray[i + w] * (1 - fx) * fy + gray[i + w + 1] * fx * fy;
}

/**
 * Walk outward along one ray and return the strongest intensity step.
 *
 * Signed, because which way the edge runs is what separates the rim from the
 * things that also produce strong edges inside the search band: a bullet hole,
 * a scoring ring, printed text. The rim has one polarity and the majority of
 * rays agree on it, so disagreement is a usable rejection test.
 */
function edgeCandidates(gray, w, h, cx, cy, angle, rMin, rMax, minStep, step = 0.5) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const out = [];
  let prev = sample(gray, w, h, cx + ca * rMin, cy + sa * rMin);
  if (prev == null) return out;

  // Accumulate each run of same-signed change into one edge. A printed rim is a
  // step spread over two or three pixels, and treating every pixel pair as its
  // own candidate would flood the scoring with fragments of one edge.
  let runStart = null, runSum = 0;
  const flush = (rEnd) => {
    if (runStart != null && Math.abs(runSum) >= minStep) {
      out.push({ r: (runStart + rEnd) / 2, strength: Math.abs(runSum), polarity: Math.sign(runSum), angle });
    }
    runStart = null; runSum = 0;
  };

  for (let r = rMin + step; r <= rMax; r += step) {
    const v = sample(gray, w, h, cx + ca * r, cy + sa * r);
    if (v == null) break;
    const d = v - prev;
    prev = v;
    if (Math.abs(d) < 0.5) { flush(r); continue; }
    if (runStart != null && Math.sign(d) !== Math.sign(runSum)) flush(r);
    if (runStart == null) runStart = r;
    runSum += d;
  }
  flush(rMax);
  return out;
}

/**
 * Rim points around an approximate centre and radius.
 *
 * Rays whose edge disagrees with the majority polarity are dropped, as are those
 * whose radius is a wild outlier against the median. Between them that removes
 * impacts breaking the rim, printed numerals sitting just inside it, and the
 * torn edge of a target that has been shot to pieces.
 */
export function findRim(gray, width, height, {
  cx, cy, rApprox, rays = 72, band = 0.45, minStep = 8, minCoverage = 0.4, rounds = 4,
} = {}) {
  if (!(rApprox > 2) || !isFinite(cx) || !isFinite(cy)) return null;

  // Every candidate edge on every ray, not just the strongest.
  //
  // A real target is concentric by design, so the search band holds several
  // edges: scoring rings, the aiming disc, the coloured surround. Taking the
  // strongest per ray picks a different ring on different rays and the fit
  // collapses - measured on a Shoot-N-C it returned a 97px radius for a 122px
  // bull with 57% of rays agreeing. The strongest edge is simply not a reliable
  // proxy for the one the shooter pointed at.
  //
  // An edge has to be a real step. `strength > 0` was the first version of this
  // test and it accepted a perfectly uniform image, because bilinear sampling
  // leaves rounding dust near 1e-14 and a blank photograph came back with a
  // confidently measured bull.
  const perRay = [];
  for (let i = 0; i < rays; i++) {
    const a = (TAU * i) / rays;
    perRay.push(edgeCandidates(gray, width, height, cx, cy, a,
      Math.max(1, rApprox * (1 - band)), rApprox * (1 + band), minStep));
  }
  if (perRay.every(c => !c.length)) return null;

  // Majority polarity across all candidates: the rim runs one way round the
  // whole circle, the distractors do not agree with each other.
  let pos = 0, neg = 0;
  for (const cands of perRay) for (const c of cands) (c.polarity > 0 ? pos++ : neg++);
  const wantPolarity = pos >= neg ? 1 : -1;

  /**
   * Choose one candidate per ray, then refit, then choose again.
   *
   * The shooter's edge tap says roughly where the rim is, so the first pass
   * takes the candidate nearest that radius weighted by strength. Once a rim
   * exists, the prediction per ray becomes the fitted ellipse's own radius at
   * that angle, which is far sharper than a single global radius and is what
   * lets the fit walk onto the true rim from a sloppy tap.
   */
  let predict = () => rApprox;
  let chosen = [];

  for (let round = 0; round < rounds; round++) {
    chosen = [];
    for (let i = 0; i < rays; i++) {
      const a = (TAU * i) / rays;
      const want = predict(a);
      const tol = Math.max(3, want * (round === 0 ? 0.35 : 0.14));
      let best = null, bestScore = -Infinity;
      for (const c of perRay[i]) {
        if (c.polarity !== wantPolarity) continue;
        const dr = Math.abs(c.r - want);
        if (dr > tol) continue;
        // Nearness dominates; strength breaks ties between nearby edges.
        const score = -(dr / tol) * 2 + Math.min(1, c.strength / 120);
        if (score > bestScore) { bestScore = score; best = c; }
      }
      if (best) chosen.push(best);
    }
    if (chosen.length < Math.max(8, rays * minCoverage)) return null;

    const pts = chosen.map(h => ({ x: cx + Math.cos(h.angle) * h.r, y: cy + Math.sin(h.angle) * h.r }));
    const c0 = fitCircle(pts);
    if (!c0) return null;
    const ell = fitEllipseAbout(pts, c0.cx, c0.cy);
    if (!ell) return null;

    // Next round predicts from the ellipse, measured about the ORIGINAL ray
    // origin, because the rays are cast from there and their angles are fixed.
    const { cx: ex, cy: ey, a: ea, b: eb, phi } = ell;
    predict = (ang) => {
      const ca = Math.cos(ang), sa = Math.sin(ang);
      // Distance from (cx,cy) along this ray to the ellipse centred at (ex,ey).
      const ox = cx - ex, oy = cy - ey;
      const cp = Math.cos(phi), sp = Math.sin(phi);
      const ux = (ca * cp + sa * sp) / ea, uy = (-ca * sp + sa * cp) / eb;
      const px = (ox * cp + oy * sp) / ea, py = (-ox * sp + oy * cp) / eb;
      const A = ux * ux + uy * uy, B = 2 * (px * ux + py * uy), C = px * px + py * py - 1;
      const disc = B * B - 4 * A * C;
      if (disc < 0 || A <= 0) return rApprox;
      return (-B + Math.sqrt(disc)) / (2 * A);
    };
  }

  return {
    points: chosen.map(h => ({ x: cx + Math.cos(h.angle) * h.r, y: cy + Math.sin(h.angle) * h.r })),
    coverage: Math.round((chosen.length / rays) * 100),
    polarity: wantPolarity,
  };
}

/**
 * Ellipse through rim points, taken about a known centre.
 *
 * In polar form about its own centre an ellipse satisfies
 *
 *   1 / r^2 = A cos^2 t + B sin t cos t + C sin^2 t
 *
 * which is linear in A, B and C, so this is an ordinary least squares solve and
 * not an eigenvalue problem. The semi-axes and rotation then come out of the
 * 2x2 matrix [[A, B/2], [B/2, C]] in closed form: its eigenvalues are the
 * inverse squared axes.
 *
 * The centre has to be right for this to hold, which is why the caller refines
 * it with a free-centre circle fit first. For the eccentricities a phone photo
 * produces, that centre is within a fraction of a pixel of the ellipse's.
 */
export function fitEllipseAbout(points, cx, cy) {
  if (!points || points.length < 5) return null;

  let m00 = 0, m01 = 0, m02 = 0, m11 = 0, m12 = 0, m22 = 0;
  let b0 = 0, b1 = 0, b2 = 0, n = 0;
  for (const p of points) {
    const dx = p.x - cx, dy = p.y - cy;
    const r2 = dx * dx + dy * dy;
    if (!(r2 > 1e-9)) continue;
    const r = Math.sqrt(r2);
    const c = dx / r, s = dy / r;
    const f0 = c * c, f1 = s * c, f2 = s * s;
    const y = 1 / r2;
    m00 += f0 * f0; m01 += f0 * f1; m02 += f0 * f2;
    m11 += f1 * f1; m12 += f1 * f2; m22 += f2 * f2;
    b0 += f0 * y; b1 += f1 * y; b2 += f2 * y;
    n++;
  }
  if (n < 5) return null;

  // Symmetric 3x3 solve by Cramer's rule.
  const det = m00 * (m11 * m22 - m12 * m12)
            - m01 * (m01 * m22 - m12 * m02)
            + m02 * (m01 * m12 - m11 * m02);
  if (Math.abs(det) < 1e-18) return null;
  const A = (b0 * (m11 * m22 - m12 * m12) - m01 * (b1 * m22 - m12 * b2) + m02 * (b1 * m12 - m11 * b2)) / det;
  const B = (m00 * (b1 * m22 - m12 * b2) - b0 * (m01 * m22 - m12 * m02) + m02 * (m01 * b2 - b1 * m02)) / det;
  const C = (m00 * (m11 * b2 - b1 * m12) - m01 * (m01 * b2 - b1 * m02) + b0 * (m01 * m12 - m11 * m02)) / det;

  // Eigenvalues of [[A, B/2], [B/2, C]].
  const tr = A + C, dsc = Math.sqrt(Math.max(0, (A - C) * (A - C) + B * B));
  const l1 = (tr - dsc) / 2, l2 = (tr + dsc) / 2;   // smaller eigenvalue -> longer axis
  if (!(l1 > 0) || !(l2 > 0)) return null;

  const a = 1 / Math.sqrt(l1);   // semi-major
  const b = 1 / Math.sqrt(l2);   // semi-minor

  // Angle of the MAJOR axis, which is the eigenvector of the SMALLER eigenvalue
  // because the eigenvalues are the inverse squared axes. The usual
  // 0.5*atan2(B, A-C) gives the other one, so it returns the minor axis and is
  // wrong by exactly 90 degrees. That was the first version here, and it did not
  // fail loudly: the semi-axes stayed correct and only the residual, which is
  // measured against the axes, blew up - so every tilted bull was reported as a
  // torn rim rather than as tilted. Checked against a hand-worked ellipse with
  // a=2, b=1 at 0 and at 30 degrees.
  const phi = 0.5 * Math.atan2(-B, C - A);

  // Residual, as a fraction of the major axis.
  let se = 0;
  for (const p of points) {
    const dx = p.x - cx, dy = p.y - cy;
    const t = Math.atan2(dy, dx) - phi;
    const ct = Math.cos(t), st = Math.sin(t);
    const rEll = (a * b) / Math.sqrt(b * b * ct * ct + a * a * st * st);
    se += ((Math.hypot(dx, dy) - rEll) / a) ** 2;
  }

  return { cx, cy, a, b, phi, axisRatio: b / a, rms: Math.sqrt(se / points.length) };
}

/**
 * Two taps plus the image: the bull, measured.
 *
 * @param centre  where the shooter tapped the middle
 * @param edge    where they tapped the rim
 */
export function rimFit(gray, width, height, { centre, edge, rays = 72 } = {}) {
  if (!centre || !edge) return null;
  const rApprox = Math.hypot(edge.x - centre.x, edge.y - centre.y);
  if (!(rApprox > 2)) return null;

  const rim = findRim(gray, width, height, { cx: centre.x, cy: centre.y, rApprox, rays });
  if (!rim) {
    // Nothing found in the image: fall back to exactly what was tapped, and say
    // so, because a silent fallback would look identical to a measurement.
    return {
      cx: centre.x, cy: centre.y, a: rApprox, b: rApprox, phi: 0,
      axisRatio: 1, rms: 0, coverage: 0, measured: false,
    };
  }

  // Free-centre circle fit to recentre, then the ellipse about that centre.
  const c = fitCircle(rim.points);
  const cx = c ? c.cx : centre.x, cy = c ? c.cy : centre.y;
  const ell = fitEllipseAbout(rim.points, cx, cy);
  if (!ell) return null;

  // Sanity: has the measurement wandered off the thing that was pointed at?
  //
  // On a target built from many concentric printed rings - an NRA 50ft face has
  // several outside the black - there are enough plausible edges for the search
  // to settle self-consistently on the wrong one. Measured on that target the
  // centre walked 16px on a 63px bull and a flat sheet was reported as 40
  // degrees off-axis, with a low residual, because the wrong ellipse fits its
  // own points perfectly well. A low residual says the points agree, not that
  // they are the rim.
  //
  // The shooter's two taps are the only independent evidence of which circle
  // was meant, so they get to veto. Falling back to the taps is worse geometry
  // and better information: it is what they pointed at, and it says so.
  const drift = Math.hypot(ell.cx - centre.x, ell.cy - centre.y);
  const grew = Math.abs(ell.a - rApprox) / rApprox;
  if (drift > rApprox * 0.22 || grew > 0.28) {
    return {
      cx: centre.x, cy: centre.y, a: rApprox, b: rApprox, phi: 0,
      axisRatio: 1, rms: 0, coverage: rim.coverage, measured: false,
      rejected: drift > rApprox * 0.22 ? 'centre' : 'radius',
    };
  }

  return { ...ell, coverage: rim.coverage, polarity: rim.polarity, measured: true };
}

/**
 * Is this fit safe to take a scale from?
 *
 * The axis ratio is cos of the off-axis angle, so it reports tilt directly and
 * without the residual gymnastics the four-tap path needed. Because the scale
 * comes from the major axis, which is not foreshortened, a tilt no longer
 * corrupts the size - what it costs is the accuracy of shot positions across the
 * minor axis, and that is what the thresholds below are about.
 *
 * Measured limitation, on a real NRA 50ft sheet, 10 Aug 2026: shots landing on
 * the rim itself defeat this. Four bulls on one photograph, same camera, same
 * distance. The two whose rims were clean fitted at 100% coverage and reported
 * square-on. The two with holes broken through the printed edge reported 54 and
 * 55 degrees off-axis, which the photograph plainly is not - the holes remove
 * arcs of the true rim, and the ellipse leans into whatever is left.
 *
 * Not worked around, because the failure is the honest one. A tilt this large is
 * refused, so it costs a refusal on a target that could in principle have been
 * measured, rather than a scale error on one that could not. The fix if it ever
 * matters is to drop the worst-fitting arc and refit, the same way the radius
 * search already considers several candidates; that is real work and this is a
 * known, reported, non-silent failure in the meantime.
 */
export function rimQuality(fit) {
  if (!fit) return { ok: false, level: 'none', text: 'Tap the middle of the bull, then its edge.' };

  if (!fit.measured) {
    return {
      ok: true, level: 'unmeasured',
      text: 'Could not make out the printed edge, so the size is exactly the two points tapped. Check the circle sits on the rim, and nudge it if not.',
    };
  }

  const tilt = Math.round(Math.acos(Math.max(-1, Math.min(1, fit.axisRatio))) * 180 / Math.PI);

  if (fit.rms > 0.06) {
    return {
      ok: false, level: 'noisy',
      text: `The edge found in the photo is not a clean oval, so this bull cannot be sized reliably. A torn or heavily shot-out rim will do this. Mark the target sheet with four corners instead.`,
    };
  }

  if (fit.axisRatio < 0.72) {
    return {
      ok: false, level: 'oblique', tiltDeg: tilt,
      text: `The bull is about ${tilt} degrees off-axis. The size is still read from the long axis so it stays right, but shot positions across the short axis would be stretched by ${Math.round((1 / fit.axisRatio - 1) * 100)}%. Use the four-corner reference, which corrects that properly.`,
    };
  }

  if (fit.axisRatio < 0.94) {
    return {
      ok: true, level: 'tilted', tiltDeg: tilt,
      text: `About ${tilt} degrees off-axis. The size is taken from the long axis so it is unaffected; shot positions are out by a few percent across the short axis.`,
    };
  }

  return {
    ok: true, level: 'good', tiltDeg: tilt,
    text: `Found the printed edge around ${fit.coverage}% of the rim. Square-on, so the scale is sound.`,
  };
}

/**
 * The fitted ellipse as four corners of the square it is an image of.
 *
 * A circle of diameter D seen at an angle images as an ellipse whose major axis
 * is D and whose minor axis is D cos t. Those two diameters are perpendicular on
 * the target, so the four axis endpoints are the image of a D by D square and
 * feed rectifyToInches unchanged - which means shot positions get the
 * foreshortening undone rather than merely flagged.
 *
 * Ordered to match orderCorners: the two major-axis endpoints and the two
 * minor-axis endpoints, taken round the ellipse rather than across it.
 */
export function rimQuad(fit) {
  if (!fit) return null;
  const { cx, cy, a, b, phi } = fit;
  const ca = Math.cos(phi), sa = Math.sin(phi);
  // Corners of the square, at 45 degrees to the axes, so the quad's edges are
  // the target's own axes rather than its diagonals.
  const k = Math.SQRT1_2;
  return [
    { x: cx + (-a * k) * ca - (-b * k) * sa, y: cy + (-a * k) * sa + (-b * k) * ca },
    { x: cx + (a * k) * ca - (-b * k) * sa, y: cy + (a * k) * sa + (-b * k) * ca },
    { x: cx + (a * k) * ca - (b * k) * sa, y: cy + (a * k) * sa + (b * k) * ca },
    { x: cx + (-a * k) * ca - (b * k) * sa, y: cy + (-a * k) * sa + (b * k) * ca },
  ];
}

/**
 * A crop box around one target, for the screen that shows it on its own.
 *
 * Padded well past the rim because shots land outside the bull and a crop that
 * hides them would quietly cost the shooter their flyers.
 */
export function cropFor(fit, imgW, imgH, pad = 1.9) {
  if (!fit) return null;
  const r = Math.max(fit.a, fit.b) * pad;
  const x0 = Math.max(0, fit.cx - r), y0 = Math.max(0, fit.cy - r);
  const x1 = Math.min(imgW, fit.cx + r), y1 = Math.min(imgH, fit.cy + r);
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}
