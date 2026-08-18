/**
 * Validates load variants.
 *
 * The property that matters is that association is never inferred. A session
 * belongs to a rung because it was captured against that rung and says so - not
 * because its charge weight happens to match, and not because it was shot on the
 * same day. A near-match silently attributed to the wrong rung would corrupt the
 * comparison the whole test exists to make, and would look like data.
 *
 * Run: node scripts/test-variants.mjs
 */
import {
  rowsForStep, stepDimension, variantLabel, variantComponents,
  sessionsForVariant, measuredGroups, reconcileRows,
  measuredVelocities, reconcileVelocityRows,
} from '../lib/variants.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(56) + detail);
};

const LOAD = { bullet: '140 Hybrid', powder: 'H4350', primer: 'Fed 210M', brass: 'Lapua', chargeGr: 41.2, coalOrCbto: 2.800 };

// One session carrying one or more measured groups, tagged to a variant.
const sess = (id, projectId, step, rowId, groups) =>
  ({ id, projectId, projectStep: step, projectRowId: rowId, _groups: groups });
const toMoa = (s) => s._groups;

console.log('steps and their varying dimension');
{
  check('  the ladder varies charge', stepDimension(6).key === 'charge');
  check('  seating varies CBTO', stepDimension(7).key === 'cbto');
  check('  primers vary brand', stepDimension(5).key === 'brand');
  check('  an unknown step has none', stepDimension(99) === null);

  const project = {
    rungs: [{ id: 'r1', charge: '41.6' }],
    seatingRows: [{ id: 'd1', cbto: '2.806' }],
    primerRows: [{ id: 'p1', brand: 'CCI 450' }],
  };
  check('  rows come from the right field per step',
    rowsForStep(project, 6)[0].id === 'r1' &&
    rowsForStep(project, 7)[0].id === 'd1' &&
    rowsForStep(project, 5)[0].id === 'p1');
  check('  a project with nothing is safe', rowsForStep(null, 6).length === 0);
}

console.log('\nlabels and components');
{
  check('  a charge reads with its unit', variantLabel(6, { charge: '41.6' }) === '41.6 gr',
    variantLabel(6, { charge: '41.6' }));
  check('  a seating depth reads in inches', variantLabel(7, { cbto: '2.806' }) === '2.806"',
    variantLabel(7, { cbto: '2.806' }));
  check('  a primer reads as its brand', variantLabel(5, { brand: 'CCI 450' }) === 'CCI 450');
  check('  an unset value says so', /unset/.test(variantLabel(6, { charge: '' })));

  // The variant is the base load with exactly one thing changed.
  const c = variantComponents(LOAD, 6, { charge: '41.6' });
  check('  a ladder rung overrides only the charge',
    c.charge === '41.6' && c.powder === 'H4350' && c.primer === 'Fed 210M' && c.cbto === 2.8,
    `charge ${c.charge}, everything else from the load`);
  const p = variantComponents(LOAD, 5, { brand: 'CCI 450' });
  check('  a primer row overrides only the primer',
    p.primer === 'CCI 450' && p.charge === 41.2);
  const d = variantComponents(LOAD, 7, { cbto: '2.806' });
  check('  a seating row overrides only the depth',
    d.cbto === '2.806' && d.charge === 41.2);
  check('  an empty row leaves the base load alone',
    variantComponents(LOAD, 6, { charge: '' }).charge === 41.2);
}

console.log('\nassociation is recorded, never inferred');
{
  const sessions = [
    sess('s1', 'p1', 6, 'r1', [0.42]),
    sess('s2', 'p1', 6, 'r1', [0.51]),
    sess('s3', 'p1', 6, 'r2', [0.88]),
    sess('s4', 'p1', 7, 'r1', [0.31]),   // same row id, different step
    sess('s5', 'p2', 6, 'r1', [0.99]),   // same row id, different project
    { id: 's6', _groups: [0.40] },        // untagged - shot outside a test
  ];

  check('  only sessions tagged to this rung are used',
    sessionsForVariant(sessions, 'p1', 6, 'r1').map(s => s.id).join() === 's1,s2');
  check('  a different step is not swept in',
    !sessionsForVariant(sessions, 'p1', 6, 'r1').some(s => s.id === 's4'),
    'step 7 shares the row id and must not match');
  check('  a different project is not swept in',
    !sessionsForVariant(sessions, 'p1', 6, 'r1').some(s => s.id === 's5'));
  check('  an untagged session belongs to no variant',
    !sessionsForVariant(sessions, 'p1', 6, 'r1').some(s => s.id === 's6'),
    'shooting a group does not enrol it in a test');
  check('  missing ids match nothing',
    sessionsForVariant(sessions, null, 6, 'r1').length === 0 &&
    sessionsForVariant(sessions, 'p1', 6, null).length === 0);
}

console.log('\nmeasured groups');
{
  const sessions = [
    sess('s1', 'p1', 6, 'r1', [0.42, 0.55]),   // two targets, two groups
    sess('s2', 'p1', 6, 'r1', [0.51]),
  ];
  const g = measuredGroups(sessions, 'p1', 6, 'r1', toMoa);
  check('  every target counts as its own group', g.length === 3, `${g.length} groups from 2 sessions`);
  check('  values come through', g.join() === '0.42,0.55,0.51');
  check('  junk is dropped',
    measuredGroups([sess('s', 'p1', 6, 'r1', [0.4, 0, -1, NaN])], 'p1', 6, 'r1', toMoa).length === 1);
  check('  nothing tagged means nothing measured',
    measuredGroups([], 'p1', 6, 'r1', toMoa).length === 0);
}

console.log('\nreconciling typed and measured');
{
  const rows = [
    { id: 'r1', charge: '41.2', groupMoa: '0.90' },   // typed, and shot
    { id: 'r2', charge: '41.4', groupMoa: '0.75' },   // typed only
    { id: 'r3', charge: '41.6', groupMoa: '' },       // neither
  ];
  const sessions = [
    sess('s1', 'p1', 6, 'r1', [0.40]),
    sess('s2', 'p1', 6, 'r1', [0.50]),
  ];
  const out = reconcileRows(rows, sessions, 'p1', 6, toMoa);

  check('  measured data replaces the typed value',
    out[0].groupMoa === '0.45' && out[0].source === 'measured',
    `${out[0].groupMoa} from ${out[0].measuredCount} groups, was 0.90`);
  check('  and keeps the individual groups', out[0].measuredGroups.join() === '0.4,0.5');
  check('  a typed row with no sessions is kept', out[1].groupMoa === '0.75' && out[1].source === 'typed',
    'a notebook is still valid data');
  check('  an empty row reads empty', out[2].source === 'empty');
  check('  provenance is always stated',
    out.every(r => ['measured', 'typed', 'empty'].includes(r.source)),
    'a number whose origin is invisible cannot be checked');
  check('  empty input is safe', reconcileRows(null, [], 'p1', 6, toMoa).length === 0);
}

console.log('\nmeasured velocities');
{
  const vs = (id, rowId, velocities) =>
    ({ id, projectId: 'p1', projectStep: 3, projectRowId: rowId, velocities });
  const sessions = [vs('s1', 'w1', [2810, 2822]), vs('s2', 'w1', [2815]), vs('s3', 'w2', [2900])];

  check('  pools every reading for the variant',
    measuredVelocities(sessions, 'p1', 3, 'w1').join() === '2810,2822,2815');
  check('  keeps them individual, not averaged',
    measuredVelocities(sessions, 'p1', 3, 'w1').length === 3,
    'an SD comparison needs the readings, not their mean');
  check('  another row is not swept in',
    measuredVelocities(sessions, 'p1', 3, 'w2').join() === '2900');
  check('  junk is dropped',
    measuredVelocities([vs('s', 'w1', [2800, 0, -5, NaN, 'x'])], 'p1', 3, 'w1').length === 1);

  const rows = [
    { id: 'w1', charge: '41.2', velocity: '2700' },   // has sessions
    { id: 'w3', charge: '41.6', velocity: '2750' },   // typed only, no sessions
  ];
  const out = reconcileVelocityRows(rows, sessions, 'p1', 3);
  check('  a measured row reports the mean', out[0].velocity === '2816' && out[0].source === 'measured',
    `${out[0].velocity} from ${out[0].measuredCount} readings, was 2700`);
  check('  and keeps the readings', out[0].measuredVelocities.length === 3);
  check('  a row with no sessions keeps its typed value',
    out[1].velocity === '2750' && out[1].source === 'typed', out[1].source);

  // Primer rows carry a whole string rather than a single number.
  const pr = reconcileVelocityRows(
    [{ id: 'w1', brand: 'CCI 450', velocities: '' }],
    sessions, 'p1', 3, { meanField: null, listField: 'velocities' }
  );
  check('  a primer row receives the full string',
    pr[0].velocities === '2810 2822 2815', pr[0].velocities);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
