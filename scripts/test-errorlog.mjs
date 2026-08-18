/**
 * Validates the problem report.
 *
 * This exists because the report makes a promise in its own last line — that it
 * carries no target photographs, session data or account details — and a
 * promise printed at the bottom of a file is only as good as the code that
 * builds the file. If a future change starts including something, the sentence
 * will keep saying otherwise, and the shooter reading it before pressing send
 * has no way to know.
 *
 * So the checks are mostly about what is *absent*, and about the footer telling
 * the truth in both cases.
 *
 * Run: node scripts/test-errorlog.mjs
 */
import {
  recordError, getErrors, clearErrors, subscribe, buildReport,
} from '../lib/errorlog.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(58) + detail);
};

console.log('recording');
{
  clearErrors();
  check('  starts empty', getErrors().length === 0);

  recordError('capture', new Error('boom'));
  check('  keeps one', getErrors().length === 1);
  check('  with where it happened', getErrors()[0].where === 'capture',
    'a minified stack often says nothing; the screen name always does');

  recordError('ballistics', new Error('second'));
  check('  newest first', getErrors()[0].message === 'second');

  // Bounded, because an unbounded list on a device with no way to clear it is
  // its own bug.
  for (let i = 0; i < 40; i++) recordError('loop', new Error(`e${i}`));
  check('  bounded', getErrors().length === 25, `${getErrors().length} kept`);
  check('  and keeps the newest', getErrors()[0].message === 'e39');

  check('  a non-Error is still recorded', (() => {
    clearErrors();
    recordError('odd', 'just a string');
    return getErrors()[0].message === 'just a string';
  })(), 'a throw is not always an Error');

  check('  subscribers are told', (() => {
    let seen = -1;
    const off = subscribe(list => { seen = list.length; });
    recordError('x', new Error('y'));
    off();
    return seen > 0;
  })());
}

console.log('\nthe promise in the footer');
{
  clearErrors();
  recordError('capture', new Error('placement failed'));

  const anon = buildReport({ note: 'it went white', app: { version: '1.0.0' }, device: { os: 'ios' } });
  check('  carries the note', /it went white/.test(anon));
  check('  carries the error', /placement failed/.test(anon));
  check('  and where it happened', /capture/.test(anon));
  check('  says no account details when there are none',
    /no target photographs, session data or account details/i.test(anon));
  check('  and there really is no address in it', !/@/.test(anon),
    'the sentence and the file agree');

  const named = buildReport({
    note: 'same again', contact: 'shooter@example.com',
    app: { version: '1.0.0' }, device: { os: 'ios' },
  });
  check('  an included address appears once', (named.match(/shooter@example\.com/g) || []).length === 1);
  check('  near the top, where it will be read', named.indexOf('shooter@example.com') < named.length / 2);
  check('  and the footer changes to match', /only the email above and the errors listed/.test(named),
    'the claim tracks the contents rather than being a fixed sentence');
  check('  it no longer claims to carry no account details',
    !/no account details/i.test(named),
    'this is the failure the whole test exists for');
}

console.log('\nwhat is never in it');
{
  clearErrors();
  recordError('capture', new Error('failed'), { componentStack: '  at TargetPlot' });
  const r = buildReport({ note: 'x', app: { version: '1.0.0' }, device: { os: 'ios' } });
  // Nothing here should be capable of carrying a session, a shot or a photo:
  // the log only ever sees an error and a screen name.
  for (const word of ['shots', 'sessionId', 'photoUri', 'targets', 'aim']) {
    check(`  no ${word}`, !new RegExp(word, 'i').test(r));
  }
  check('  the stack is trimmed rather than dumped', (() => {
    clearErrors();
    const e = new Error('deep');
    e.stack = Array.from({ length: 40 }, (_, i) => `  at frame${i}`).join('\n');
    recordError('x', e);
    return (getErrors()[0].stack.match(/\n/g) || []).length < 10;
  })(), 'a full React stack is thousands of characters and the top is the useful part');
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
