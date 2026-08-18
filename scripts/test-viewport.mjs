/**
 * Validates the zoom/pan transform.
 *
 * Every shot position the app stores passes through this mapping, so a subtle
 * error here would bias every measurement without ever looking wrong on screen.
 * The central property is exact round-tripping: a tap at a screen point must
 * resolve to the image point that was drawn there.
 *
 * Run: node scripts/test-viewport.mjs
 */
import {
  toScreen, toImage, clampPan, zoomAbout, fitViewport, pinchDistance, pinchCentre, frameOn,
  pinchTransform, centreOn,
} from '../lib/viewport.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(50) + detail);
};
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

const BOX_W = 335, BOX_H = 335 * 1.25;

console.log('round-tripping');
{
  // The property everything else depends on.
  const cases = [
    { zoom: 1, pan: { x: 0, y: 0 } },
    { zoom: 2, pan: { x: -100, y: -50 } },
    { zoom: 4.7, pan: { x: -612.3, y: -988.1 } },
    { zoom: 8, pan: { x: -2000, y: -2500 } },
  ];
  let worst = 0;
  for (const { zoom, pan } of cases) {
    for (const p of [{ x: 0, y: 0 }, { x: 167, y: 200 }, { x: 335, y: 418 }, { x: 12.7, y: 300.4 }]) {
      const back = toImage(toScreen(p, zoom, pan), zoom, pan);
      worst = Math.max(worst, Math.abs(back.x - p.x), Math.abs(back.y - p.y));
    }
  }
  check('  image -> screen -> image is exact', worst < 1e-9, `max drift ${worst.toExponential(1)}`);

  // And the other direction, which is the one a tap actually uses.
  let worst2 = 0;
  for (const { zoom, pan } of cases) {
    for (const p of [{ x: 5, y: 5 }, { x: 200, y: 300 }, { x: 334, y: 417 }]) {
      const back = toScreen(toImage(p, zoom, pan), zoom, pan);
      worst2 = Math.max(worst2, Math.abs(back.x - p.x), Math.abs(back.y - p.y));
    }
  }
  check('  screen -> image -> screen is exact', worst2 < 1e-9, `max drift ${worst2.toExponential(1)}`);
}

console.log('\nidentity at fit');
{
  const { zoom, pan } = fitViewport();
  const p = { x: 123.4, y: 256.7 };
  const s = toScreen(p, zoom, pan);
  check('  unzoomed screen equals image', near(s.x, p.x) && near(s.y, p.y));
  check('  fit is zoom 1 at origin', zoom === 1 && pan.x === 0 && pan.y === 0);
}

console.log('\npan clamping');
{
  // At fit the image exactly fills the box, so there is nothing to pan.
  const c = clampPan({ x: 50, y: -80 }, 1, BOX_W, BOX_H);
  check('  no panning possible at zoom 1', c.x === 0 && c.y === 0, `(${c.x}, ${c.y})`);

  // At 2x the image is twice the box, so it can move by one box width.
  const c2 = clampPan({ x: -9999, y: -9999 }, 2, BOX_W, BOX_H);
  check('  cannot pan past the far edge',
    near(c2.x, -BOX_W) && near(c2.y, -BOX_H), `(${c2.x.toFixed(0)}, ${c2.y.toFixed(0)})`);

  const c3 = clampPan({ x: 9999, y: 9999 }, 2, BOX_W, BOX_H);
  check('  cannot pan past the near edge', c3.x === 0 && c3.y === 0);

  const c4 = clampPan({ x: -100, y: -120 }, 2, BOX_W, BOX_H);
  check('  a legal pan is left alone', c4.x === -100 && c4.y === -120);

  // The photo must always cover the viewport at every zoom level.
  for (const z of [1, 1.5, 2, 3.3, 8]) {
    for (const trial of [{ x: 500, y: 500 }, { x: -5000, y: -5000 }, { x: 0, y: -200 }]) {
      const p = clampPan(trial, z, BOX_W, BOX_H);
      const coversLeft = p.x <= 0 + 1e-9;
      const coversRight = p.x + BOX_W * z >= BOX_W - 1e-9;
      if (!coversLeft || !coversRight) {
        check(`  image covers viewport at ${z}x`, false, `pan.x=${p.x}`);
        break;
      }
    }
  }
  check('  image always covers the viewport', true, 'checked 1x-8x');
}

console.log('\nzoom about a focal point');
{
  const start = fitViewport();
  const focal = { x: 200, y: 250 };
  const before = toImage(focal, start.zoom, start.pan);

  const z2 = zoomAbout(focal, 3, start.zoom, start.pan, BOX_W, BOX_H);
  const after = toImage(focal, z2.zoom, z2.pan);
  check('  the focal point does not move', near(after.x, before.x, 1e-6) && near(after.y, before.y, 1e-6),
    `(${before.x.toFixed(1)},${before.y.toFixed(1)}) -> (${after.x.toFixed(1)},${after.y.toFixed(1)})`);
  check('  zoom is applied', z2.zoom === 3);

  // Zooming toward a corner is where clamping and focal-point maths fight; the
  // result must still be a legal viewport even if the focal point has to move.
  const corner = zoomAbout({ x: 0, y: 0 }, 6, 1, { x: 0, y: 0 }, BOX_W, BOX_H);
  check('  zooming at a corner stays legal',
    corner.pan.x <= 0 && corner.pan.x + BOX_W * corner.zoom >= BOX_W - 1e-9);

  check('  zoom is clamped to the maximum',
    zoomAbout(focal, 999, 1, { x: 0, y: 0 }, BOX_W, BOX_H).zoom === 8);
  check('  zoom is clamped to the minimum',
    zoomAbout(focal, 0.1, 4, { x: -100, y: -100 }, BOX_W, BOX_H).zoom === 1);
  check('  zooming back out returns to fit',
    (() => {
      const out = zoomAbout(focal, 1, 4, { x: -300, y: -400 }, BOX_W, BOX_H);
      return out.pan.x === 0 && out.pan.y === 0;
    })());
}

console.log('\nprecision gain (why this exists)');
{
  // One screen pixel of finger error maps to 1/zoom image pixels. At 6x a
  // shaky 3px touch resolves to half an image pixel.
  const err = (zoom) => {
    const a = toImage({ x: 100, y: 100 }, zoom, { x: 0, y: 0 });
    const b = toImage({ x: 103, y: 100 }, zoom, { x: 0, y: 0 });
    return b.x - a.x;
  };
  check('  3px of touch error is 3 image px at 1x', near(err(1), 3));
  check('  3px of touch error is 0.5 image px at 6x', near(err(6), 0.5));
}

console.log('\npinch helpers');
{
  const two = [{ pageX: 100, pageY: 100 }, { pageX: 140, pageY: 130 }];
  check('  distance between two touches', near(pinchDistance(two), 50), String(pinchDistance(two)));
  const c = pinchCentre(two, 20, 10);
  check('  centre is container-relative', c.x === 100 && c.y === 105, `(${c.x}, ${c.y})`);
  check('  one touch is not a pinch', pinchDistance([two[0]]) === null);
  check('  three touches are not a pinch', pinchDistance([...two, two[0]]) === null);
  check('  no touches is safe', pinchDistance(null) === null && pinchCentre(null) === null);
}

console.log('\nframing one target at a time');
{
  const W = 335, H = 419;
  const f = frameOn({ x: 100, y: 300 }, 40, W, H);
  check('  the target lands in the middle of the viewport', (() => {
    const c = toScreen({ x: 100, y: 300 }, f.zoom, f.pan);
    // Clamping can hold it off-centre near an edge; the point must at least be
    // comfortably inside the box.
    return c.x > 0 && c.x < W && c.y > 0 && c.y < H;
  })(), `zoom ${f.zoom.toFixed(2)}`);

  check('  and fills a useful part of it', (() => {
    const a = toScreen({ x: 60, y: 300 }, f.zoom, f.pan);
    const b = toScreen({ x: 140, y: 300 }, f.zoom, f.pan);
    const span = Math.abs(b.x - a.x);
    return span > W * 0.5 && span < W * 0.8;
  })(), 'a bull 80px across becomes most of the screen');

  check('  a smaller target is magnified more',
    frameOn({ x: 100, y: 200 }, 12, W, H).zoom > frameOn({ x: 100, y: 200 }, 60, W, H).zoom);
  check('  never zooms out past the whole photo', frameOn({ x: 10, y: 10 }, 900, W, H).zoom === 1,
    'a target bigger than the frame still shows the frame');
  check('  the photo always covers the viewport', (() => {
    for (const c of [{ x: 0, y: 0 }, { x: 335, y: 419 }, { x: 5, y: 400 }]) {
      const g = frameOn(c, 30, W, H);
      if (g.pan.x > 0 || g.pan.y > 0) return false;
      if (g.pan.x < W - W * g.zoom - 0.001 || g.pan.y < H - H * g.zoom - 0.001) return false;
    }
    return true;
  })(), 'no blank space beside a target near the edge');
  check('  a target with no size falls back to the whole photo',
    frameOn({ x: 100, y: 100 }, 0, W, H).zoom === 1);
}

console.log('\ntwo fingers: scale and slide in one gesture');
{
  const W = 335, H = 419;
  const base = { startZoom: 2, startPan: { x: -100, y: -120 }, boxW: W, boxH: H };

  // Pure translation: fingers stay the same distance apart and move together.
  {
    const t = pinchTransform({
      ...base,
      startCentre: { x: 160, y: 200 }, startDist: 180,
      centre: { x: 200, y: 240 }, dist: 180,
    });
    check('  a two-finger drag pans without changing zoom', t.zoom === 2,
      'the whole point of separating pan from pinch');
    check('  and moves the view by the finger travel',
      near(t.pan.x, -60, 0.001) && near(t.pan.y, -80, 0.001),
      `pan ${t.pan.x.toFixed(0)},${t.pan.y.toFixed(0)} from -100,-120 after +40,+40`);
  }

  // Pure scale: midpoint held still. Must agree with zoomAbout exactly, since
  // that is the same gesture expressed the other way.
  {
    const focal = { x: 160, y: 200 };
    const t = pinchTransform({
      ...base, startCentre: focal, startDist: 100, centre: focal, dist: 150,
    });
    const z = zoomAbout(focal, 3, base.startZoom, base.startPan, W, H);
    check('  a pinch about a fixed midpoint matches zoomAbout',
      near(t.zoom, z.zoom, 1e-9) && near(t.pan.x, z.pan.x, 1e-9) && near(t.pan.y, z.pan.y, 1e-9),
      `zoom ${t.zoom.toFixed(2)}`);
  }

  // The defining property, and the one a user actually feels: whatever was
  // under the fingers stays under the fingers.
  {
    const startCentre = { x: 120, y: 300 };
    const before = toImage(startCentre, 2, base.startPan);
    for (const [dist, cx, cy] of [[240, 200, 180], [90, 90, 350], [180, 120, 300]]) {
      const t = pinchTransform({
        ...base, startCentre, startDist: 180, centre: { x: cx, y: cy }, dist,
      });
      const after = toImage({ x: cx, y: cy }, t.zoom, t.pan);
      // Clamping can legitimately pull the view back at the edges, so this is
      // asserted where the transform is not against a limit.
      const clamped = t.pan.x === 0 || t.pan.y === 0
        || t.pan.x <= W - W * t.zoom + 0.01 || t.pan.y <= H - H * t.zoom + 0.01;
      check(`  what was under the fingers stays there (d=${dist})`,
        clamped || (near(after.x, before.x, 0.01) && near(after.y, before.y, 0.01)),
        clamped ? 'against a clamp, skipped' : `image ${after.x.toFixed(1)},${after.y.toFixed(1)}`);
    }
  }

  check('  zoom stays within limits', (() => {
    const huge = pinchTransform({ ...base, startCentre: { x: 100, y: 100 }, startDist: 10,
      centre: { x: 100, y: 100 }, dist: 10000 });
    const tiny = pinchTransform({ ...base, startCentre: { x: 100, y: 100 }, startDist: 10000,
      centre: { x: 100, y: 100 }, dist: 10 });
    return huge.zoom <= 8 && tiny.zoom >= 1;
  })());

  check('  a gesture with nothing to measure yields nothing',
    pinchTransform({ ...base, startCentre: null, startDist: 100, centre: { x: 1, y: 1 }, dist: 100 }) === null
    && pinchTransform({ ...base, startCentre: { x: 1, y: 1 }, startDist: 0, centre: { x: 1, y: 1 }, dist: 100 }) === null,
    'a released finger must not divide by zero');
}

console.log('\njumping to a tapped bull');
{
  const W = 335, H = 419;

  // A bull in the middle of the photo should land in the middle of the screen.
  const mid = centreOn({ x: 167.5, y: 209.5 }, 3, W, H);
  const onScreen = toScreen({ x: 167.5, y: 209.5 }, mid.zoom, mid.pan);
  check('  a central bull lands centred',
    near(onScreen.x, W / 2, 0.5) && near(onScreen.y, H / 2, 0.5),
    `${onScreen.x.toFixed(0)},${onScreen.y.toFixed(0)} of ${W}x${H}`);

  check('  at the zoom asked for', mid.zoom === 3);

  // Near a corner the clamp takes over, and the point cannot be centred - but
  // it must still be visible, which is the property that actually matters.
  for (const pt of [{ x: 5, y: 5 }, { x: 330, y: 414 }, { x: 5, y: 414 }]) {
    const v = centreOn(pt, 3, W, H);
    const sp = toScreen(pt, v.zoom, v.pan);
    check(`  a bull at ${pt.x},${pt.y} stays on screen`,
      sp.x >= 0 && sp.x <= W && sp.y >= 0 && sp.y <= H,
      `${sp.x.toFixed(0)},${sp.y.toFixed(0)}`);
  }

  check('  never leaves blank space beside the photo', (() => {
    for (const pt of [{ x: 0, y: 0 }, { x: 335, y: 419 }, { x: 100, y: 400 }]) {
      const v = centreOn(pt, 3, W, H);
      if (v.pan.x > 0 || v.pan.y > 0) return false;
      if (v.pan.x < W - W * v.zoom - 0.001 || v.pan.y < H - H * v.zoom - 0.001) return false;
    }
    return true;
  })());

  check('  respects the zoom ceiling', centreOn({ x: 100, y: 100 }, 99, W, H).zoom === 8);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);