/**
 * Zoom/pan transform for the capture photo.
 *
 * Marking a tight group means placing points a few pixels apart on a phone
 * screen, which is the one part of the measurement a fingertip cannot do
 * accurately. Zooming fixes that, but only if the mapping between what is on
 * screen and what gets stored is exactly invertible — a transform that is even
 * slightly wrong silently biases every shot position, and the whole app is
 * built on those positions being right.
 *
 * Two coordinate spaces:
 *   image  — the unzoomed display box, 0..boxW and 0..boxH. Shot coordinates
 *            are stored as fractions of boxW in this space.
 *   screen — where a finger actually lands inside the container.
 *
 *   screen = image * zoom + pan
 *   image  = (screen - pan) / zoom
 */

/** Screen position of a point in image space. */
export function toScreen(p, zoom, pan) {
  return { x: p.x * zoom + pan.x, y: p.y * zoom + pan.y };
}

/** Image position of a point on screen — the inverse of toScreen. */
export function toImage(p, zoom, pan) {
  return { x: (p.x - pan.x) / zoom, y: (p.y - pan.y) / zoom };
}

/**
 * Keep the photo covering the viewport.
 *
 * Panning is bounded so the image can never be dragged away from under the
 * finger, which would leave the user marking blank space.
 */
export function clampPan(pan, zoom, boxW, boxH) {
  const minX = Math.min(0, boxW - boxW * zoom);
  const minY = Math.min(0, boxH - boxH * zoom);
  return {
    x: Math.min(0, Math.max(minX, pan.x)),
    y: Math.min(0, Math.max(minY, pan.y)),
  };
}

/**
 * Change zoom while holding one screen point still.
 *
 * Without a focal point, zooming always pulls toward the top-left and the group
 * you were working on slides out of view.
 */
export function zoomAbout(focal, nextZoom, zoom, pan, boxW, boxH, limits = {}) {
  const { min = 1, max = 8 } = limits;
  const z = Math.min(max, Math.max(min, nextZoom));
  const img = toImage(focal, zoom, pan);
  const pan2 = { x: focal.x - img.x * z, y: focal.y - img.y * z };
  return { zoom: z, pan: clampPan(pan2, z, boxW, boxH) };
}

/**
 * A two-finger gesture: scale and translation together, in one step.
 *
 * `zoomAbout` holds a *fixed* screen point still, which is right for a button
 * that zooms about the centre. It is not enough for two fingers, because those
 * fingers also move: the shooter expects to be able to pinch and slide in the
 * same gesture, and to pan without changing zoom at all by simply dragging two
 * fingers together.
 *
 * Both fall out of one rule - whatever part of the image was under the midpoint
 * when the gesture started stays under the midpoint now:
 *
 *   pan = centre - imageUnderStartCentre * zoom
 *
 * With the fingers held apart at a constant distance this is a pure translation.
 * With the midpoint held still it reduces exactly to `zoomAbout`. There is no
 * separate pan case to write, and no order-of-operations bug to have, because
 * the scale and the translation are never applied as two steps.
 *
 * Everything is measured against the gesture's *start*, not the previous frame,
 * so error cannot accumulate over a long drag.
 */
export function pinchTransform({
  startCentre, startDist, startZoom, startPan,
  centre, dist, boxW, boxH, limits = {},
}) {
  const { min = 1, max = 8 } = limits;
  if (!startCentre || !centre || !(startDist > 0) || !(dist > 0)) return null;
  const z = Math.min(max, Math.max(min, startZoom * (dist / startDist)));
  // The image point that was under the fingers when the gesture began.
  const img = toImage(startCentre, startZoom, startPan);
  const pan = { x: centre.x - img.x * z, y: centre.y - img.y * z };
  return { zoom: z, pan: clampPan(pan, z, boxW, boxH) };
}

/**
 * Put an image point in the middle of the viewport at a given zoom.
 *
 * Used when the shooter taps the centre of a bull and the view jumps in to meet
 * them. `zoomAbout` is the wrong tool there: it holds the tapped point exactly
 * where the finger was, which is usually near an edge of the screen, so half
 * the rim they are about to mark ends up off-screen or under their hand.
 * Centring costs nothing and puts the whole rim in reach.
 *
 * The clamp still applies, so a bull near the edge of the photo lands as close
 * to the middle as the image allows rather than dragging blank space into view.
 */
export function centreOn(point, zoom, boxW, boxH, limits = {}) {
  const { min = 1, max = 8 } = limits;
  const z = Math.min(max, Math.max(min, zoom));
  const pan = { x: boxW / 2 - point.x * z, y: boxH / 2 - point.y * z };
  return { zoom: z, pan: clampPan(pan, z, boxW, boxH) };
}

/** Reset to fit. */
export function fitViewport() {
  return { zoom: 1, pan: { x: 0, y: 0 } };
}

/**
 * Distance between two touches, for pinch.
 * Returns null unless exactly two are down.
 */
export function pinchDistance(touches) {
  if (!touches || touches.length !== 2) return null;
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

/** Midpoint of two touches, in container-relative coordinates. */
export function pinchCentre(touches, originX = 0, originY = 0) {
  if (!touches || touches.length !== 2) return null;
  const [a, b] = touches;
  return {
    x: (a.pageX + b.pageX) / 2 - originX,
    y: (a.pageY + b.pageY) / 2 - originY,
  };
}

/**
 * Zoom and pan so one target fills the viewport.
 *
 * The second capture screen shows a single face at a time, because at
 * whole-sheet zoom a .30 hole is 8px across against a 44pt minimum touch
 * target. Framed on its own bull the same hole is 34px, which is the difference
 * between marking shots and guessing at them.
 *
 * `fill` is the fraction of the shorter viewport edge the target's diameter
 * should occupy. Short of 1 on purpose: shots land outside the bull, and a frame
 * that crops them would quietly cost the shooter their flyers.
 */
export function frameOn(centre, radius, boxW, boxH, fill = 0.62, limits = {}) {
  const { min = 1, max = 14 } = limits;
  if (!(radius > 0)) return fitViewport();
  const want = (Math.min(boxW, boxH) * fill) / 2;
  const z = Math.min(max, Math.max(min, want / radius));
  const pan = { x: boxW / 2 - centre.x * z, y: boxH / 2 - centre.y * z };
  return { zoom: z, pan: clampPan(pan, z, boxW, boxH) };
}
