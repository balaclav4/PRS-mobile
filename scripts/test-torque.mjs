/**
 * Validates recorded torque figures.
 *
 * The property that matters most is that the app never invents one. Everything
 * here is the shooter's own number, so the tests are about carrying it
 * faithfully: converting exactly, warning about a slipped decimal or a value
 * typed in the wrong unit, and never quietly discarding a fastener that has
 * been named but not yet looked up.
 *
 * Run: node scripts/test-torque.mjs
 */
import {
  convert, toNm, toInLb, checkTorque, fmt, fmtBoth,
  newEntry, cleanEntries, summarise, findByName,
  TORQUE_UNITS, COMMON_FASTENERS,
} from '../lib/torque.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(56) + detail);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('conversion');
{
  // Both the pound-force and the inch are defined exactly, so this is not an
  // approximation: 1 lbf-in = 0.112984829... N m.
  check('  1 in-lb is 0.112985 Nm', near(toNm(1), 0.1129848, 1e-6), toNm(1).toFixed(7));
  check('  and back again', near(toInLb(toNm(65)), 65, 1e-9));
  check('  a common ring figure converts sensibly',
    near(toNm(18), 2.034, 0.001), `18 in-lb = ${toNm(18).toFixed(3)} Nm`);
  check('  a common action figure too',
    near(toNm(65), 7.344, 0.001), `65 in-lb = ${toNm(65).toFixed(3)} Nm`);

  check('  same unit is a no-op', convert(20, 'in-lb', 'in-lb') === 20);
  check('  junk converts to nothing', convert('x', 'Nm', 'in-lb') === null && toNm('x') === null);
}

console.log('\nthe app supplies no figures of its own');
{
  check('  the fastener list is names only, with no values',
    COMMON_FASTENERS.every(f => typeof f === 'string' && !/\d/.test(f)),
    `${COMMON_FASTENERS.length} fasteners, no numbers`);
  check('  a new entry starts blank', newEntry().value === '' && newEntry('Action screws').name === 'Action screws');
  check('  two new entries do not collide', newEntry().id !== newEntry().id);
  check('  only the two units are offered', TORQUE_UNITS.join() === 'in-lb,Nm');
}

console.log('\ncatching a slipped decimal or the wrong unit');
{
  check('  an ordinary figure passes quietly',
    checkTorque(18, 'in-lb').level === 'ok' && checkTorque(18, 'in-lb').text === null);
  check('  a very high one is flagged, not blocked', (() => {
    const r = checkTorque(200, 'in-lb');
    return r.ok === true && r.level === 'high' && /check/i.test(r.text);
  })(), 'the app does not know this fastener, so it warns and stores');
  check('  a very low one is flagged', checkTorque(2, 'in-lb').level === 'low');
  check('  and the warning names the other unit as the likely cause',
    /other unit/.test(checkTorque(2, 'in-lb').text));

  // The case the warning exists for: 65 is a sane action-screw figure in in-lb
  // and a ruinous one in Nm.
  check('  65 in-lb is ordinary', checkTorque(65, 'in-lb').level === 'ok');
  check('  65 Nm is flagged', checkTorque(65, 'Nm').level === 'high',
    `${toInLb(65).toFixed(0)} in-lb, which would wreck a scope tube`);

  check('  zero and negatives are refused',
    checkTorque(0, 'in-lb').ok === false && checkTorque(-5, 'in-lb').ok === false);
  check('  empty is not an error, just unset', checkTorque('', 'in-lb').level === 'empty');
}

console.log('\nreading it off the page');
{
  check('  in-lb reads to the half, like the wrench', fmt(17.6, 'in-lb') === '17.5 in-lb', fmt(17.6, 'in-lb'));
  check('  Nm reads to a tenth', fmt(2.0337, 'Nm') === '2.0 Nm', fmt(2.0337, 'Nm'));
  check('  both units at once, for the wrench you own',
    fmtBoth(18, 'in-lb') === '18 in-lb (2.0 Nm)', fmtBoth(18, 'in-lb'));
  check('  nothing recorded reads as nothing', fmt('', 'in-lb') === '—');
}

console.log('\nkeeping what was typed');
{
  const entries = [
    { name: 'Action screws', value: '65', unit: 'in-lb' },
    { name: 'Scope ring caps', value: '', unit: 'in-lb' },        // named, not looked up
    { name: '', value: '', unit: 'in-lb' },                        // genuinely empty
    { name: 'Base', value: '30', unit: 'bogus' },
  ];
  const clean = cleanEntries(entries);
  check('  a fastener named but not looked up is kept', clean.length === 3,
    'it is a reminder that this one has a spec nobody has found yet');
  check('  a wholly empty row is dropped', !clean.some(e => !e.name && !e.value));
  check('  an unknown unit falls back rather than corrupting',
    clean.find(e => e.name === 'Base').unit === 'in-lb');
  check('  every row gets an id', clean.every(e => !!e.id));

  const sum = summarise(entries);
  check('  the summary counts set against outstanding',
    sum.total === 3 && sum.set === 2 && sum.missing === 1,
    `${sum.set} of ${sum.total} recorded`);

  check('  a fastener can be found by name', findByName(entries, 'action screws').value === '65',
    'case-insensitive, so the checklist can look up what it needs');
  check('  and a missing one returns nothing', findByName(entries, 'nope') === null);
  check('  nothing at all is safe',
    cleanEntries(null).length === 0 && summarise(null).total === 0 && findByName(null, 'x') === null);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
