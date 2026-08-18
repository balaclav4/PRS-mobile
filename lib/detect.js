/**
 * Bullet-hole detection.
 *
 * This is deliberately not machine learning. The app already knows two things
 * that collapse the problem: the bullet diameter (from the load's caliber) and
 * the image scale (from the user's two calibration taps). Together those pin
 * the expected hole radius in pixels to within a few percent, which turns
 * open-ended blob finding into a matched filter at a *known* scale.
 *
 * The filter is a difference-of-boxes centre-surround operator — a Laplacian of
 * Gaussian approximation that runs in O(1) per pixel via integral images, so
 * cost is independent of the radius.
 *
 * Everything here is pure and works on a plain grayscale array, so it can be
 * tested headlessly against synthetic targets with known hole positions.
 */

/**
 * Is a point inside a polygon? Even-odd ray cast.
 *
 * Used to keep the search inside the target the shooter marked. Measured on
 * their own photographs, this is the single largest source of false positives:
 * an NRA sheet photographed on a cutting mat returned 104 detections for about
 * a dozen real holes, and most of the rest were the mat's grid, the wall behind
 * it, staples, and a second target in the background. The quad was already
 * being collected and was being used only to compute scale.
 */
export function pointInPolygon(x, y, poly) {
  if (!poly || poly.length < 3) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Grow a polygon about its centroid.
 *
 * The marked quad is the reference rectangle, not a promise about where every
 * shot landed - a flyer off the edge of the bull is exactly the shot a shooter
 * most wants recorded. Searching a slightly larger area than was marked keeps
 * those without letting the whole photograph back in.
 */
export function expandPolygon(poly, factor) {
  if (!poly || poly.length < 3 || !(factor > 0)) return poly;
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
  return poly.map(p => ({ x: cx + (p.x - cx) * factor, y: cy + (p.y - cy) * factor }));
}

/** Axis-aligned bounds of a polygon, clamped to the image. */
export function polygonBounds(poly, width, height) {
  if (!poly || poly.length < 3) return { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return {
    x0: Math.max(0, Math.floor(x0)), y0: Math.max(0, Math.floor(y0)),
    x1: Math.min(width - 1, Math.ceil(x1)), y1: Math.min(height - 1, Math.ceil(y1)),
  };
}

/** Rec. 709 luma from RGBA bytes. */
export function toGrayscale(rgba, width, height) {
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
  }
  return out;
}

/** Summed-area table. Indexed (w+1) x (h+1) so box sums need no bounds logic. */
export function integralImage(src, w, h) {
  const W = w + 1;
  const ii = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += src[y * w + x];
      ii[(y + 1) * W + (x + 1)] = ii[y * W + (x + 1)] + rowSum;
    }
  }
  return ii;
}

/** Mean of the axis-aligned box [x0,x1] x [y0,y1], clamped to the image. */
function boxMean(ii, w, h, cx, cy, r) {
  const x0 = Math.max(0, cx - r), y0 = Math.max(0, cy - r);
  const x1 = Math.min(w - 1, cx + r), y1 = Math.min(h - 1, cy + r);
  const W = w + 1;
  const sum =
    ii[(y1 + 1) * W + (x1 + 1)] - ii[y0 * W + (x1 + 1)] -
    ii[(y1 + 1) * W + x0] + ii[y0 * W + x0];
  const area = (x1 - x0 + 1) * (y1 - y0 + 1);
  return sum / area;
}

/** Median of a sampled subset — full sort on 1MP would dominate runtime. */
function approxMedian(arr, sampleStride = 7) {
  const s = [];
  for (let i = 0; i < arr.length; i += sampleStride) s.push(arr[i]);
  s.sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Median absolute deviation — robust spread, unlike std which the holes skew. */
function mad(arr, med, sampleStride = 7) {
  const s = [];
  for (let i = 0; i < arr.length; i += sampleStride) s.push(Math.abs(arr[i] - med));
  s.sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] || 1e-6;
}

/**
 * Sensor noise estimate from adjacent-pixel differences.
 *
 * Real detail is correlated between neighbours; noise is not, so the median
 * absolute horizontal difference is dominated by noise. The 0.6745 converts
 * MAD to a Gaussian sigma, and the sqrt(2) accounts for differencing two noisy
 * samples. Used to set a contrast floor — without one, a low-contrast noise
 * blob scores high symmetry simply because its ring variance is tiny too.
 */
function estimateNoise(gray, w, h) {
  const diffs = [];
  for (let y = 1; y < h - 1; y += 3) {
    for (let x = 1; x < w - 2; x += 3) {
      diffs.push(Math.abs(gray[y * w + x + 1] - gray[y * w + x]));
    }
  }
  if (!diffs.length) return 1;
  diffs.sort((a, b) => a - b);
  return (diffs[Math.floor(diffs.length / 2)] / 0.6745) / Math.SQRT2 || 1;
}

/**
 * Centre-surround response map.
 *
 * response[i] > 0 means "darker than surroundings" (a hole punched in light
 * paper); < 0 means brighter (a hole over a black bullseye, where the backing
 * or light shows through). Both are real cases, so the caller considers |r|.
 */
function centreSurround(ii, w, h, rIn, rOut) {
  const resp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const centre = boxMean(ii, w, h, x, y, rIn);
      const surround = boxMean(ii, w, h, x, y, rOut);
      resp[y * w + x] = surround - centre;
    }
  }
  return resp;
}

/**
 * Rejects edges, printed rings and text, which can out-respond a hole on the
 * centre-surround filter but are not radially symmetric.
 *
 * Samples the image on a ring just inside the hole and compares it against the
 * paper just outside. A real hole is uniformly dark all the way round; a line
 * or letter stroke is dark on two sides and light on the others, giving high
 * variance across the ring.
 */
function radialSymmetry(gray, w, h, cx, cy, r, polarity) {
  const N = 12;
  const inner = [], outer = [];
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    const ix = Math.round(cx + Math.cos(a) * r * 0.55);
    const iy = Math.round(cy + Math.sin(a) * r * 0.55);
    const ox = Math.round(cx + Math.cos(a) * r * 1.9);
    const oy = Math.round(cy + Math.sin(a) * r * 1.9);
    if (ix >= 0 && ix < w && iy >= 0 && iy < h) inner.push(gray[iy * w + ix]);
    if (ox >= 0 && ox < w && oy >= 0 && oy < h) outer.push(gray[oy * w + ox]);
  }
  if (inner.length < N * 0.6 || outer.length < N * 0.6) return { symmetry: 0, contrast: 0 };

  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const std = (a, m) => Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);

  const innerMean = mean(inner), outerMean = mean(outer);
  const contrast = polarity > 0 ? outerMean - innerMean : innerMean - outerMean;
  if (contrast <= 0) return { symmetry: 0, contrast: 0 };

  const denom = Math.abs(contrast) + 1e-6;
  // Inner ring uniform => the centre really is a disc, not a stroke or corner.
  const innerConsistency = Math.max(0, 1 - std(inner, innerMean) / denom);
  // Outer ring uniform => the disc is surrounded on all sides. This is what
  // separates a hole from a point just inside a printed bullseye's edge, where
  // the surroundings are black on one side and paper on the other.
  const outerConsistency = Math.max(0, 1 - std(outer, outerMean) / denom);

  return { symmetry: Math.min(innerConsistency, outerConsistency), contrast, innerMean, outerMean };
}

/**
 * Counts continuations of hole-coloured material out through the surround.
 *
 * Sampled on a ring just outside the hole edge, contiguous angular runs of
 * hole-like pixels distinguish shapes the ring-mean tests cannot:
 *   isolated hole              0 runs
 *   hole punched on a line     2 runs, ~180 deg apart   (must keep)
 *   line intersection          4 runs                    (reject)
 *   corner / L-junction        2 runs, ~90 deg apart     (reject)
 * Found via the Ballistic-X grid target, where junction false positives were
 * the dominant residual after the mean/variance ring checks.
 */
function ringContinuations(gray, w, h, cx, cy, r, polarity, innerMean, outerMean) {
  const N = 24;
  const mid = (innerMean + outerMean) / 2;
  const holeLike = [];
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * r * 1.35);
    const y = Math.round(cy + Math.sin(a) * r * 1.35);
    if (x < 0 || x >= w || y < 0 || y >= h) { holeLike.push(false); continue; }
    const v = gray[y * w + x];
    holeLike.push(polarity > 0 ? v < mid : v > mid);
  }

  // Circular run extraction, anchored at an off-sample so a run wrapping
  // through 0 deg is counted once. (Walking two laps from k=0 double-counted
  // wrapped runs — head and tail recorded separately — which manufactured a
  // phantom narrow run whenever a neighbour sat near angle zero.)
  let anchor = holeLike.indexOf(false);
  const runs = [];
  if (anchor === -1) {
    runs.push({ start: 0, len: N }); // fully surrounded
  } else {
    let start = -1;
    for (let k = anchor; k < anchor + N; k++) {
      const on = holeLike[k % N];
      if (on && start < 0) start = k;
      if (!on && start >= 0) { runs.push({ start: start % N, len: k - start }); start = -1; }
    }
    if (start >= 0) runs.push({ start: start % N, len: anchor + N - start });
  }

  // A run only counts as a *line* continuation if it is narrow AND the material
  // keeps going: probe along the run's centre angle at 2.5r and 4r. A printed
  // line extends across the target; a neighbouring hole ends by ~3r. Width
  // alone could not make this call — neighbours in a tight cluster subtend just
  // under 45deg and sit at corner-like separations, so the tight-group centre
  // hole kept getting rejected as a "junction".
  // The run centre angle is quantised to 360/N degrees; at 4r that puts the
  // probe up to ~10px off a thin line's centreline, so test a small angular
  // fan at each radius and accept if any ray still finds line material.
  const fan = (Math.PI * 2) / N / 2;
  const lineRuns = runs.filter(r2 => {
    if (r2.len * (360 / N) > 45) return false;
    const a = (((r2.start + r2.len / 2) % N) / N) * Math.PI * 2;
    for (const k of [2.5, 4.0]) {
      let hit = false;
      for (const da of [-fan, 0, fan]) {
        const x = Math.round(cx + Math.cos(a + da) * r * k);
        const y = Math.round(cy + Math.sin(a + da) * r * k);
        if (x < 0 || x >= w || y < 0 || y >= h) { hit = true; break; } // off-image: assume it continues
        const v = gray[y * w + x];
        if (polarity > 0 ? v < mid : v > mid) { hit = true; break; }
      }
      if (!hit) return false;
    }
    return true;
  });

  const centers = lineRuns.map(r2 => ((r2.start + r2.len / 2) % N) * (360 / N));
  let sep = null;
  if (lineRuns.length === 2) {
    const d = Math.abs(centers[0] - centers[1]);
    sep = Math.min(d, 360 - d);
  }
  return { runs: lineRuns.length, sep };
}

/**
 * Intensity-weighted centroid, for sub-pixel placement of the final mark.
 *
 * A full hole-radius window measured best: tightening it to 0.5-0.8r made
 * touching-hole accuracy worse (1.20px vs 1.02px), because the smaller sample
 * is noisier. The residual ~1px error on overlapping holes is inherent — two
 * merged holes have no separable centroid — versus 0.02px on isolated holes.
 */
function refineCentre(gray, w, h, cx, cy, r, polarity, background) {
  let sw = 0, sx = 0, sy = 0;
  const R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > R * R) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      const v = gray[y * w + x];
      const weight = polarity > 0 ? background - v : v - background;
      if (weight > 0) { sw += weight; sx += weight * x; sy += weight * y; }
    }
  }
  return sw > 0 ? { x: sx / sw, y: sy / sw } : { x: cx, y: cy };
}

/**
 * Split a detection that is actually several touching holes.
 *
 * Every published approach to target scoring names this as its unsolved case —
 * bullets landing close enough that the torn paper becomes one region, so
 * blob-style detectors return a single hit. The usual fixes fail because they
 * have no idea how big one hole should be.
 *
 * We do. Caliber and scale give the expected radius, so an over-large region is
 * unambiguous evidence of a merge, and a distance transform's local maxima are
 * the individual hole centres: distance-to-edge peaks once per hole and dips at
 * the waist between them.
 *
 * @returns array of centres — one entry when the region really is a single hole
 */
function splitMerged(gray, w, h, cx, cy, r, polarity, background) {
  const cxi = Math.round(cx), cyi = Math.round(cy);
  const core = gray[cyi * w + cxi];
  const mid = (background + core) / 2;
  const isHole = (i) => (polarity > 0 ? gray[i] < mid : gray[i] > mid);

  // Region-grow the torn area, bounded so one blown-out target can't run away.
  const R = Math.ceil(r * 4);
  const x0 = Math.max(0, cxi - R), x1 = Math.min(w - 1, cxi + R);
  const y0 = Math.max(0, cyi - R), y1 = Math.min(h - 1, cyi + R);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const inRegion = new Uint8Array(bw * bh);

  const stack = [[cxi, cyi]];
  let area = 0;
  while (stack.length) {
    const [px, py] = stack.pop();
    if (px < x0 || px > x1 || py < y0 || py > y1) continue;
    const li = (py - y0) * bw + (px - x0);
    if (inRegion[li]) continue;
    if (!isHole(py * w + px)) continue;
    inRegion[li] = 1;
    area++;
    stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
  }

  const oneHoleArea = Math.PI * r * r;
  // Under this a single torn hole comfortably accounts for the region. Paper
  // tears larger than the bullet, so the threshold has real headroom.
  if (area < oneHoleArea * 1.55) return [{ x: cx, y: cy }];

  // Chamfer distance transform: distance from each region pixel to the edge.
  const INF = 1e9;
  const dist = new Float32Array(bw * bh);
  for (let i = 0; i < dist.length; i++) dist[i] = inRegion[i] ? INF : 0;
  const D1 = 1, D2 = 1.41421356;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = y * bw + x;
      if (!inRegion[i]) continue;
      let d = dist[i];
      if (y > 0) d = Math.min(d, dist[i - bw] + D1);
      if (x > 0) d = Math.min(d, dist[i - 1] + D1);
      if (y > 0 && x > 0) d = Math.min(d, dist[i - bw - 1] + D2);
      if (y > 0 && x < bw - 1) d = Math.min(d, dist[i - bw + 1] + D2);
      dist[i] = d;
    }
  }
  for (let y = bh - 1; y >= 0; y--) {
    for (let x = bw - 1; x >= 0; x--) {
      const i = y * bw + x;
      if (!inRegion[i]) continue;
      let d = dist[i];
      if (y < bh - 1) d = Math.min(d, dist[i + bw] + D1);
      if (x < bw - 1) d = Math.min(d, dist[i + 1] + D1);
      if (y < bh - 1 && x < bw - 1) d = Math.min(d, dist[i + bw + 1] + D2);
      if (y < bh - 1 && x > 0) d = Math.min(d, dist[i + bw - 1] + D2);
      dist[i] = d;
    }
  }

  // Peaks of the distance transform are hole centres. Requiring at least 0.55r
  // of clearance rejects ragged edge nibbles; suppressing within 1.2r stops one
  // hole's plateau reporting twice.
  const minPeak = r * 0.55;
  const sep = r * 1.2;
  const peaks = [];
  for (let y = 1; y < bh - 1; y++) {
    for (let x = 1; x < bw - 1; x++) {
      const i = y * bw + x;
      const d = dist[i];
      if (d < minPeak) continue;
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dist[i + dy * bw + dx] > d) { isMax = false; break; }
        }
      }
      if (isMax) peaks.push({ x: x + x0, y: y + y0, d });
    }
  }

  // A ridge running through several holes has plateau pixels that all satisfy a
  // strict local-max test, so peak-finding alone over-reports — three holes in
  // a row came back as six. The region's area is a hard physical ceiling on how
  // many holes can be inside it, so take only the strongest that many.
  // Overlapping holes share area, hence the 0.75 rather than 1.0.
  const maxParts = Math.max(2, Math.round(area / (oneHoleArea * 0.75)));

  peaks.sort((a, b) => b.d - a.d);
  const kept = [];
  for (const p of peaks) {
    if (kept.length >= maxParts) break;
    if (kept.every(k => Math.hypot(k.x - p.x, k.y - p.y) >= sep)) kept.push(p);
  }

  // A merge we cannot resolve is better reported as the one blob we are sure
  // of than as a guess.
  return kept.length >= 2 ? kept.map(p => ({ x: p.x, y: p.y })) : [{ x: cx, y: cy }];
}

/**
 * Detect bullet holes.
 *
 * @param gray    grayscale intensities, length width*height
 * @param radiusPx expected hole radius in pixels (from caliber + scale)
 * @returns candidates sorted by descending confidence, in pixel coordinates
 */
export function detectShots(gray, width, height, options = {}) {
  const {
    radiusPx,
    maxDetections = 60,
    // Detection collapses once the assumed radius is off by more than ~1.5x, so
    // sweep around the estimate rather than trusting the user's scale taps to
    // be exact. Measured envelope per scale is roughly 0.7x-1.5x.
    scales = [0.75, 1.0, 1.35],
  } = options;

  if (!radiusPx || radiusPx < 1.2) {
    return { shots: [], reason: 'Scale too coarse to resolve holes — zoom in or set the scale more precisely.' };
  }

  const all = [];
  for (const k of scales) {
    const r = radiusPx * k;
    if (r < 1.2) continue;
    all.push(...detectAtRadius(gray, width, height, r, options));
  }

  // Rank by score, but nudge toward the caliber-derived radius. Two touching
  // holes read as one larger blob at a coarse scale; without this preference
  // that blob can outrank the two real holes it spans.
  for (const s of all) {
    s.rank = s.score * (1 - 0.12 * Math.abs(Math.log(s.radius / radiusPx)));
  }
  all.sort((a, b) => b.rank - a.rank);

  // Merge across scales. Suppression uses the larger of the two radii so a
  // coarse blob spanning a pair is rejected once either real hole is kept,
  // while the pair itself — separated by more than one hole radius — survives.
  const kept = [];
  for (const s of all) {
    const clash = kept.some(k =>
      Math.hypot(k.x - s.x, k.y - s.y) < Math.max(s.radius, k.radius) * 1.1
    );
    if (!clash) kept.push(s);
    if (kept.length >= maxDetections) break;
  }

  // Finally, break apart anything that is several touching holes read as one.
  // Every piece is re-validated on its own: splitting an irregular blob that is
  // not actually holes would otherwise turn one false positive into several,
  // which is a worse trade than missing the merge.
  const noiseSigma = estimateNoise(gray, width, height);
  const minContrast = Math.max(options.minContrast ?? 14, noiseSigma * 4);
  const minSymmetry = options.minSymmetry ?? 0.35;

  const split = [];
  for (const s of kept) {
    const parts = splitMerged(gray, width, height, s.x, s.y, radiusPx, s.polarity, s.background);
    if (parts.length === 1) { split.push(s); continue; }

    // Validate on core darkness, not radial symmetry: a piece of a merged pair
    // has its neighbour on one side by definition, so a symmetry test would
    // reject exactly the case this exists to solve. What must hold is that the
    // piece's core really is hole-coloured against the surrounding paper — and
    // the distance-transform peak has already established a disc of the right
    // size sits there.
    const valid = parts.filter(p => {
      const px = Math.round(p.x), py = Math.round(p.y);
      const rr = Math.max(1, Math.round(radiusPx * 0.4));
      let sum = 0, n = 0;
      for (let dy = -rr; dy <= rr; dy++) {
        for (let dx = -rr; dx <= rr; dx++) {
          if (dx * dx + dy * dy > rr * rr) continue;
          const x = px + dx, y = py + dy;
          if (x < 0 || x >= width || y < 0 || y >= height) continue;
          sum += gray[y * width + x];
          n++;
        }
      }
      if (!n) return false;
      const core = sum / n;
      const contrast = s.polarity > 0 ? s.background - core : core - s.background;
      return contrast >= minContrast;
    });

    if (valid.length >= 2) {
      valid.forEach(p => split.push({
        ...s, x: p.x, y: p.y,
        merged: true,
        mergedCount: valid.length,
        // A split hole is inferred from the region's shape rather than measured
        // in isolation, so it should not carry the parent's full confidence.
        score: +(s.score * 0.85).toFixed(3),
      }));
    } else {
      split.push(s);
    }
  }

  // Splitting runs per parent blob, and a long merged region can survive the
  // cross-scale merge as more than one parent — so their split parts land on
  // top of each other. Three holes in a row came back as six until this pass.
  split.sort((a, b) => b.score - a.score);

  // Splatter targets (Shoot-N-C and the like) flake their dark coating away
  // around the impact, leaving a bright ragged halo two to three calibres
  // across. Each lobe of that halo is a legitimate bright blob at the search
  // radius: a synthetic four-shot splatter target produced eighteen false
  // positives, all opposite-polarity detections scoring ~0.58 against the real
  // hole's 0.99, sitting on the halo of a hole already found.
  //
  // Suppressing an opposite-polarity, weaker detection within 3r of a stronger
  // one cleared all eighteen — and dropped the real Ballistic-X photograph from
  // 10/10 to 8/10. That target is printed with a grid, so a hole on a line and
  // a hole on paper genuinely detect with opposite polarity, and two real holes
  // 2.15r apart were eaten. The separating margins are thin (2.15r vs 1.6r,
  // score ratio 0.69 vs 0.59) and one side of that comparison is a fixture
  // invented for this harness, so any threshold splitting them is fitted to my
  // own synthetic at the cost of the only real ground truth available.
  //
  // Left unfixed deliberately. The splatter scenarios stay in the harness,
  // reported as a known gap, until a real splatter photograph exists to
  // validate a fix against.
  //
  // Twenty real photographs have since been run through this, four of them
  // Shoot-N-C. They confirm the halo problem and show it is not the whole of
  // it. Measured, at the radius the caliber implies:
  //
  //   A 3in Shoot-N-C with about six impacts returned 64 detections. The
  //   surplus was halo lobes, the printed chartreuse lettering, the "8" and "9"
  //   ring numerals, the handwritten "40 Jump" on the backer, and the printed
  //   orange aiming dot. An enclosed letter counter - o, a, e, d, 8, 9 - is a
  //   dark ring around a light centre, which is structurally what this operator
  //   is built to find. Text is not a nuisance here, it is a decoy.
  //
  //   An NRA bull scoped to its own quad returned 14 for about 8 holes, of
  //   which 4 sat inside the printed aiming mark, in the small orange patches
  //   between the centre diamond and the crosshair arms.
  //
  // Three synthetic fixtures were written to reproduce that crosshair case and
  // none of them did; each looked like the gap had closed when it had not. They
  // were removed rather than tuned until they agreed, because a fixture fitted
  // backwards from a desired result is not evidence. The finding stands on the
  // photograph.
  //
  // What the photographs do point at: grayscale throws away the one signal that
  // separates these cases. A splatter impact is a dark core inside a saturated
  // chartreuse halo; the printed lettering is the same chartreuse with no dark
  // core; handwriting is a dark core with no chartreuse. That conjunction needs
  // colour, which toGrayscale discards before any of this runs.
  const deduped = [];
  for (const s of split) {
    if (deduped.every(k => Math.hypot(k.x - s.x, k.y - s.y) >= radiusPx * 1.1)) {
      deduped.push(s);
    }
  }

  // Splitting and sub-pixel refinement both move a detection after the scan, so
  // the region is enforced once more at the end rather than trusted from the
  // peak loop alone.
  const region = options.region && options.region.length >= 3 ? options.region : null;
  const inside = region ? deduped.filter(s => pointInPolygon(s.x, s.y, region)) : deduped;

  // The shooter knows how many rounds they fired, and nothing in the image does.
  //
  // This is the strongest prior available and it costs nothing to supply: the
  // detector is scoring candidates it already ranks, so an expected count turns
  // an open-ended search into "the best n of these". On a real splatter target
  // where 64 candidates were reported for six impacts, no threshold recovers
  // the answer, but the count does.
  //
  // Deliberately a truncation and not a guarantee. If the detector genuinely
  // found fewer than n it does not invent the difference - a fabricated shot
  // would move the group centre and the group size, which is the number the
  // whole app exists to report. `expected` and `dropped` are returned so the
  // caller can say what happened rather than silently present n markers.
  //
  // NOT WIRED INTO CAPTURE, and the measurement is why.
  //
  // A printed mark is manufactured and a bullet hole is torn, so the printed
  // mark is the rounder, more symmetric, higher-contrast blob of the two.
  // Ranking by score promotes it. On the Shoot-N-C photograph five of the six
  // highest-scoring detections are printed lettering - both o's of "Birchwood",
  // a letter of "Casey", the 8 and the 9 - and not one of the four obvious
  // impacts survived the cut. On the clean NRA bull the highest-scoring
  // detection in the entire image, at 0.99, is the printed white centre dot.
  //
  // So the count does not rescue these photographs, it concentrates the error
  // into a shorter list and makes it look confident. Offering it in the UI
  // would hand the shooter six markers, five of them lettering, with no signal
  // that anything was wrong. It stays here, tested, until printed furniture is
  // rejected first - see the colour note further down, which is the same fix.
  //
  // scripts/test-photos.mjs holds this as a standing measurement against the
  // real photographs and fails if it ever silently stops being true.
  const n = Number(options.expectedShots);
  const useCount = Number.isFinite(n) && n > 0;
  const ranked = useCount ? [...inside].sort((a, b) => b.score - a.score) : inside;
  const final = useCount ? ranked.slice(0, n) : ranked;

  return {
    shots: final,
    expected: useCount ? n : null,
    dropped: useCount ? Math.max(0, inside.length - n) : 0,
    short: useCount ? Math.max(0, n - inside.length) : 0,
    reason: final.length === 0
      ? 'No holes found. Check the scale marks match the reference object, or mark shots manually.'
      : null,
  };
}

/** One pass of the pipeline at a single assumed hole radius. */
function detectAtRadius(gray, width, height, r, options = {}) {
  const {
    minSymmetry = 0.35,
    sensitivity = 1.0, // higher = more permissive
    // Debug hook: inspect(stage, data) is called for every candidate decision.
    // Used by the test harnesses to answer "why was this hole rejected".
    inspect = null,
  } = options;
  const rIn = Math.max(1, Math.round(r * 0.8));
  const rOut = Math.max(rIn + 2, Math.round(r * 2.2));

  const ii = integralImage(gray, width, height);
  const resp = centreSurround(ii, width, height, rIn, rOut);

  // A hole must be darker (or brighter) than its surroundings by clearly more
  // than the sensor noise, otherwise noise blobs pass the symmetry test.
  const noiseSigma = estimateNoise(gray, width, height);
  const minContrast = Math.max(options.minContrast ?? 14, noiseSigma * 4);

  // Robust threshold: holes are rare, so most of the response map is noise.
  const absResp = new Float32Array(resp.length);
  for (let i = 0; i < resp.length; i++) absResp[i] = Math.abs(resp[i]);

  // The threshold has to be built from the target's own statistics, not the
  // photograph's. A sheet laid on a patterned cutting mat has a response map
  // dominated by the mat, which lifts the threshold and hides real holes on the
  // paper. Sampling inside the region fixes what the region is compared against
  // as well as where it is searched.
  const region = options.region && options.region.length >= 3 ? options.region : null;
  let statSample = absResp;
  if (region) {
    const b = polygonBounds(region, width, height);
    const picked = [];
    for (let y = b.y0; y <= b.y1; y += 3) {
      for (let x = b.x0; x <= b.x1; x += 3) {
        if (pointInPolygon(x, y, region)) picked.push(absResp[y * width + x]);
      }
    }
    if (picked.length > 64) statSample = Float32Array.from(picked);
  }
  const med = approxMedian(statSample, statSample === absResp ? 7 : 1);
  const spread = mad(statSample, med, statSample === absResp ? 7 : 1);
  const threshold = med + (4.0 / sensitivity) * spread;

  // Non-maximum suppression over a hole-sized window.
  const nmsR = Math.max(2, Math.round(r * 1.1));
  // Inside this margin the surround box clamps against the edge, so its mean is
  // biased and produces phantom responses along the border.
  const margin = rOut + 1;
  const bounds = region
    ? polygonBounds(region, width, height)
    : { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
  const peaks = [];
  for (let y = Math.max(margin, bounds.y0); y < Math.min(height - margin, bounds.y1 + 1); y++) {
    for (let x = Math.max(margin, bounds.x0); x < Math.min(width - margin, bounds.x1 + 1); x++) {
      const v = absResp[y * width + x];
      if (v < threshold) continue;
      if (region && !pointInPolygon(x, y, region)) continue;
      let isMax = true;
      for (let dy = -nmsR; dy <= nmsR && isMax; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -nmsR; dx <= nmsR; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const o = absResp[yy * width + xx];
          if (o > v || (o === v && (yy < y || (yy === y && xx < x)))) { isMax = false; break; }
        }
      }
      if (isMax) peaks.push({ x, y, v, polarity: Math.sign(resp[y * width + x]) || 1 });
    }
  }

  // Validate each peak for radial symmetry, then refine to sub-pixel.
  const shots = [];
  for (const p of peaks) {
    const { symmetry, contrast, innerMean, outerMean } = radialSymmetry(gray, width, height, p.x, p.y, r, p.polarity);
    if (symmetry < minSymmetry || contrast < minContrast) {
      inspect?.('reject-symmetry', { r, x: p.x, y: p.y, symmetry, contrast, minSymmetry, minContrast });
      continue;
    }

    // Junction rejection: allow at most a straight line passing through.
    const cont = ringContinuations(gray, width, height, p.x, p.y, r, p.polarity, innerMean, outerMean);
    if (cont.runs > 2 || (cont.runs === 2 && (cont.sep < 130 || cont.sep > 230))) {
      inspect?.('reject-junction', { r, x: p.x, y: p.y, runs: cont.runs, sep: cont.sep });
      continue;
    }

    const background = boxMean(ii, width, height, p.x, p.y, rOut);
    const c = refineCentre(gray, width, height, p.x, p.y, r, p.polarity, background);

    // Confidence blends how far above noise the response is with how round it is.
    const strength = Math.min(1, (p.v - threshold) / (threshold + 1e-6) + 0.5);
    shots.push({
      x: c.x,
      y: c.y,
      radius: r,
      polarity: p.polarity,
      // Kept so the merge-splitting pass can rebuild the hole/paper threshold
      // without recomputing the surround integral.
      background,
      contrast: +contrast.toFixed(1),
      symmetry: +symmetry.toFixed(3),
      score: +(strength * 0.5 + symmetry * 0.5).toFixed(3),
    });
  }

  return shots;
}
