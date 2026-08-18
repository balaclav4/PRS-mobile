/**
 * Perspective correction.
 *
 * A target photographed off-axis is a projective distortion of the real target
 * plane: distances shrink with depth, so a group measured directly off the
 * photo reads skewed — and nothing about the photo announces it.
 *
 * Given four points whose real-world positions are known (the corners of the
 * target face, a backer board, or a sheet of paper), a homography maps image
 * coordinates back onto the target plane.
 *
 * Unlike the usual approach we never warp the image. Measurement only needs the
 * handful of detected shot centres moved onto the target plane, so we solve the
 * homography and project points through it — cheaper, and with no resampling
 * blur that would degrade the sub-pixel hole positions we worked to get.
 */

/**
 * Solve the 3x3 homography H with src -> dst, using the standard DLT setup.
 *
 * Each correspondence gives two linear equations in the 8 unknowns (h33 is
 * fixed at 1, which is safe for any non-degenerate quad):
 *   x' = (h11 x + h12 y + h13) / (h31 x + h32 y + 1)
 *   y' = (h21 x + h22 y + h23) / (h31 x + h32 y + 1)
 * Cross-multiplying linearises both.
 *
 * @param src 4 points [{x,y}] in image space
 * @param dst 4 points [{x,y}] on the target plane
 * @returns H as a 9-element row-major array, or null if degenerate
 */
export function solveHomography(src, dst) {
  if (src?.length !== 4 || dst?.length !== 4) return null;

  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: X, y: Y } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    b.push(Y);
  }

  const h = solveLinear(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Gaussian elimination with partial pivoting. */
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null; // singular: collinear points
    [M[col], M[pivot]] = [M[pivot], M[col]];

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }

  // After full elimination the matrix is diagonal: x[i] = M[i][n] / M[i][i].
  return M.map((row, i) => row[n] / row[i]);
}

/** Apply a homography to a point. */
export function project(H, p) {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  if (Math.abs(w) < 1e-12) return null;
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  };
}

/**
 * Build the mapping from image space onto a physical rectangle.
 *
 * Corners must be given consistently (clockwise or counter-clockwise from the
 * same starting corner) and describe a rectangle of widthIn x heightIn inches
 * in the real world. The resulting homography outputs inches directly, so
 * measurements need no further scale calibration.
 */
export function rectifyToInches(corners, widthIn, heightIn) {
  if (corners?.length !== 4 || !(widthIn > 0) || !(heightIn > 0)) return null;
  const dst = [
    { x: 0, y: 0 },
    { x: widthIn, y: 0 },
    { x: widthIn, y: heightIn },
    { x: 0, y: heightIn },
  ];
  return solveHomography(corners, dst);
}

/**
 * Sorts four tapped corners into TL, TR, BR, BL — the order rectifyToInches
 * expects — so the user can tap them in any sequence. Sorting by angle around
 * the centroid gives a consistent winding (screen y points down, so ascending
 * angle is clockwise on screen); rotating so the corner nearest the top-left
 * comes first pins the start.
 */
export function orderCorners(pts) {
  if (pts?.length !== 4) return null;
  const cx = pts.reduce((a, p) => a + p.x, 0) / 4;
  const cy = pts.reduce((a, p) => a + p.y, 0) / 4;
  const sorted = [...pts].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );
  let tl = 0;
  for (let i = 1; i < 4; i++) {
    if (sorted[i].x + sorted[i].y < sorted[tl].x + sorted[tl].y) tl = i;
  }
  return [0, 1, 2, 3].map(i => sorted[(tl + i) % 4]);
}

/**
 * How strongly the photo is skewed, as a rough severity signal for the UI.
 *
 * Compares opposite-edge lengths of the marked quad. A square-on shot gives
 * near-1 ratios; the further from 1, the more the perspective correction is
 * doing, and the more a naive measurement would have been wrong.
 */
export function perspectiveSeverity(corners) {
  if (corners?.length !== 4) return 0;
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const top = d(corners[0], corners[1]);
  const bottom = d(corners[3], corners[2]);
  const left = d(corners[0], corners[3]);
  const right = d(corners[1], corners[2]);
  const r1 = Math.max(top, bottom) / Math.max(1e-6, Math.min(top, bottom));
  const r2 = Math.max(left, right) / Math.max(1e-6, Math.min(left, right));
  return Math.max(r1, r2) - 1;
}

/**
 * Image of the reference rectangle's centre — the intersection of the quad's
 * diagonals.
 *
 * Averaging the four corners is the obvious guess and is wrong under
 * perspective: a homography does not preserve midpoints, so on an off-axis
 * photo the corner average drifts toward the near edge. Diagonals do intersect
 * at the image of the centre, because projection preserves incidence.
 *
 * `corners` must already be ordered TL, TR, BR, BL.
 */
export function quadCentre(corners) {
  if (corners?.length !== 4) return null;
  const [tl, tr, br, bl] = corners;
  // Intersection of TL–BR and TR–BL.
  const d1x = br.x - tl.x, d1y = br.y - tl.y;
  const d2x = bl.x - tr.x, d2y = bl.y - tr.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((tr.x - tl.x) * d2y - (tr.y - tl.y) * d2x) / denom;
  return { x: tl.x + t * d1x, y: tl.y + t * d1y };
}

/**
 * The inverse of rectifyToInches: plane inches back to the stored normalised
 * space. Solving the same correspondences in the opposite direction is exact,
 * and avoids inverting a 3x3 by hand.
 */
export function inchesToNormalised(corners, widthIn, heightIn) {
  if (corners?.length !== 4 || !(widthIn > 0) || !(heightIn > 0)) return null;
  const src = [
    { x: 0, y: 0 },
    { x: widthIn, y: 0 },
    { x: widthIn, y: heightIn },
    { x: 0, y: heightIn },
  ];
  return solveHomography(src, corners);
}
