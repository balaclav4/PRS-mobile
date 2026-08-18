/**
 * Undo for the capture screen.
 *
 * Marking a target is a long sequence of small, easily mistaken taps, and
 * before this every destructive one was final. Tapping a marker removed a shot
 * outright. Clear wiped every shot on a target. Long-pressing a chip - which is
 * the same gesture as tapping one to switch, held slightly too long - deleted an
 * entire target along with everything marked on it, silently.
 *
 * Undo rather than confirmation dialogs. A confirm taxes every correct action to
 * guard against the rare wrong one, and people learn to dismiss them without
 * reading, which removes the protection and keeps the tax. Undo costs nothing
 * until it is needed, and it covers mistakes a confirm cannot: the ones where
 * the action was intended but wrong anyway, like removing the shot next to the
 * one meant.
 *
 * Whole-state snapshots rather than inverse operations. A capture holds a
 * handful of targets with a few shots each, so a snapshot is cheap, and inverse
 * operations are where undo implementations go wrong - every new action needs a
 * matching inverse, and the one nobody wrote is the one that corrupts the
 * document.
 */

/**
 * A note for anyone testing this.
 *
 * Each entry snapshots the state the caller held when it recorded, so several
 * taps dispatched inside one JavaScript task all capture the same pre-batch
 * state and all read as step one. Real taps are separate events with a render
 * between them, so this is only reachable from a synthetic harness firing
 * clicks in a loop - which is exactly how it was first mistaken for a bug.
 */

/** How many steps back to keep. Deep enough to escape a bad run of taps. */
export const HISTORY_LIMIT = 25;

/** An empty history. */
export function emptyHistory() {
  return { entries: [] };
}

/**
 * Record a state, with a label describing the action about to happen.
 *
 * The label belongs to the action, not the state: it is what the button will
 * offer to undo, so it reads "Undo remove shot", not "Undo the state before
 * removing a shot".
 */
export function push(history, label, state) {
  if (!label || state === undefined) return history;
  const entries = [...(history?.entries || []), { label, state }];
  // Oldest first out. Dropping from the front keeps the most recent steps,
  // which are the ones anyone actually reaches for.
  return { entries: entries.slice(-HISTORY_LIMIT) };
}

/** What the next undo would reverse, or null. */
export function peek(history) {
  const e = history?.entries || [];
  return e.length ? e[e.length - 1].label : null;
}

/** How many steps are available. */
export function depth(history) {
  return (history?.entries || []).length;
}

/**
 * Step back one.
 *
 * Returns the restored state and the shortened history together, so a caller
 * cannot apply one without the other and leave them disagreeing.
 */
export function undo(history) {
  const e = history?.entries || [];
  if (!e.length) return { state: null, label: null, history: history || emptyHistory() };
  const last = e[e.length - 1];
  return { state: last.state, label: last.label, history: { entries: e.slice(0, -1) } };
}

/** Forget everything, for when the document itself is replaced. */
export function clear() {
  return emptyHistory();
}
