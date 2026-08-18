/**
 * Validates the undo history.
 *
 * The properties that matter are the ones that make undo trustworthy rather
 * than merely present: that it is bounded so a long session cannot exhaust
 * memory, that stepping back yields exactly the state that was recorded, that
 * the history and the state can never be applied separately, and that undoing
 * past the beginning is a no-op rather than a crash.
 *
 * Run: node scripts/test-undo.mjs
 */
import {
  emptyHistory, push, peek, depth, undo, clear, HISTORY_LIMIT,
} from '../lib/undo.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(56) + detail);
};

console.log('recording');
{
  let h = emptyHistory();
  check('  starts empty', depth(h) === 0 && peek(h) === null);

  h = push(h, 'remove shot', { shots: [1, 2, 3] });
  check('  a step is recorded', depth(h) === 1);
  check('  and named by the action it would reverse', peek(h) === 'remove shot',
    'the button reads "Undo remove shot"');

  h = push(h, 'clear target', { shots: [1, 2] });
  check('  the newest is what comes back first', peek(h) === 'clear target');

  check('  a step with no label is refused', depth(push(h, '', { a: 1 })) === 2,
    'an unlabelled step would offer to undo something unnameable');
  check('  a step with no state is refused', depth(push(h, 'x', undefined)) === 2);
}

console.log('\nstepping back');
{
  let h = emptyHistory();
  h = push(h, 'first', { n: 1 });
  h = push(h, 'second', { n: 2 });

  const a = undo(h);
  check('  returns the state that was recorded', a.state.n === 2);
  check('  and says what it reversed', a.label === 'second');
  check('  the history shortens with it', depth(a.history) === 1,
    'state and history come back together, so they cannot be applied apart');

  const b = undo(a.history);
  check('  the next step back goes further', b.state.n === 1 && depth(b.history) === 0);

  const c = undo(b.history);
  check('  past the beginning is a no-op, not a crash', c.state === null && depth(c.history) === 0);
  check('  and offers nothing', peek(b.history) === null);
}

console.log('\nbounded');
{
  let h = emptyHistory();
  for (let i = 0; i < HISTORY_LIMIT * 3; i++) h = push(h, `step ${i}`, { i });
  check('  never grows past the limit', depth(h) === HISTORY_LIMIT, `${depth(h)} of ${HISTORY_LIMIT}`);
  check('  and keeps the most recent, not the oldest',
    peek(h) === `step ${HISTORY_LIMIT * 3 - 1}`,
    'the recent steps are the ones anyone reaches for');

  const back = undo(h);
  check('  the newest is still first out', back.state.i === HISTORY_LIMIT * 3 - 1);
}

console.log('\nsnapshots are not aliases');
{
  // The screen hands in a state object; undo must give back what it was told,
  // not a live reference that later edits have already changed underneath it.
  const original = { groups: [{ shots: ['a'] }] };
  let h = push(emptyHistory(), 'edit', original);
  const restored = undo(h).state;
  check('  what goes in comes out', restored === original,
    'the module stores the reference it was given and does not copy');
  check('  so callers must snapshot before mutating',
    Object.isFrozen(restored) === false,
    'documented rather than enforced: the screen builds a fresh array each edit');
}

console.log('\nstarting over');
{
  let h = push(emptyHistory(), 'a', { n: 1 });
  h = push(h, 'b', { n: 2 });
  check('  clear forgets everything', depth(clear(h)) === 0,
    'a new photo is a new document and its history is not the old one');
  check('  and is safe on an empty history', depth(clear(emptyHistory())) === 0);
}

console.log('\nbad input');
{
  check('  a missing history reads as empty',
    depth(undefined) === 0 && peek(undefined) === null && depth(null) === 0);
  check('  and can still be undone', undo(null).state === null);
  check('  and pushed to', depth(push(null, 'x', { a: 1 })) === 1);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
