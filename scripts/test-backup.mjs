/**
 * Validates backup and restore.
 *
 * Restoring replaces what is on the device, so the whole risk is a bad file
 * being partially applied and taking good data with it. Nearly every check here
 * feeds `readBackup` something that is not a backup and asserts it refuses -
 * and refuses with a sentence a shooter can act on, because "invalid file" at
 * the moment you are trying to recover a season of data is not help.
 *
 * The round trip matters too: what comes out has to be what went in, including
 * the parts the CSV export drops, which is the reason this file exists.
 *
 * Run: node scripts/test-backup.mjs
 */
import {
  buildBackup, readBackup, describeRestore, BACKUP_FORMAT, BACKUP_VERSION,
} from '../lib/backup.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(58) + detail);
};

/** A dataset with the things a CSV export throws away. */
const DATA = {
  rifles: [{ id: 'r1', name: 'Impact 737R', cartridge: '6.5 Creedmoor', twist: '1:8' }],
  loads: [{ id: 'l1', rifleId: 'r1', name: '140 Hybrid', bc: 0.315, dragModel: 'G7' }],
  sessions: [{
    id: 's1', name: 'Range Day', rifleId: 'r1', loadId: 'l1', distanceYd: 100,
    targets: [{
      id: 't1',
      // The parts a summary row cannot carry.
      shots: [{ x: 0.51, y: 0.48 }, { x: 0.53, y: 0.5 }, { x: 0.49, y: 0.52 }],
      aim: { x: 0.5, y: 0.5 },
      corners: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }],
      refWIn: 3, refHIn: 3,
    }],
  }],
  projects: [{ id: 'p1', name: '6 Dasher', currentStep: 6, rungs: [{ id: 'g1', charge: '32.6' }] }],
  dopeCards: [{ id: 'd1', name: 'Card', rows: [{ rangeYd: 100, elevation: 0 }] }],
  prefs: { units: { distance: 'yd' }, bullPresets: [{ id: 'bp1', label: 'MR-1', inches: 24 }] },
};

console.log('the round trip');
{
  const text = buildBackup(DATA, { appVersion: '1.0.0' });
  const r = readBackup(text);
  check('  a backup reads back', r.ok, r.ok ? '' : r.reason);
  check('  with every collection', ['rifles', 'loads', 'sessions', 'projects', 'dopeCards']
    .every(k => r.data[k].length === DATA[k].length));

  // The point of the exercise: the things the CSV drops.
  const t = r.data.sessions[0].targets[0];
  check('  shots survive', t.shots.length === 3 && t.shots[1].x === 0.53,
    'a CSV export carries none of these');
  check('  the aim point survives', t.aim.x === 0.5 && t.aim.y === 0.5);
  check('  the scale reference survives', t.corners.length === 4 && t.refWIn === 3,
    'without it a group cannot be re-measured at all');
  check('  load development survives', r.data.projects[0].rungs.length === 1);
  check('  and settings', r.data.prefs.bullPresets[0].label === 'MR-1');

  check('  it records when it was made', !!r.createdAt);
  check('  and which build made it', r.app === '1.0.0');
  check('  and is readable by a human', text.includes('\n  "sessions"'),
    'pretty-printed, so it can be salvaged by hand if this code ever refuses it');
}

console.log('\nrefusing what is not a backup');
{
  const bad = (text) => readBackup(text);
  check('  empty', !bad('').ok);
  check('  not JSON', !bad('this is not json').ok);
  check('  and says so in those words', /not valid JSON/.test(bad('nope {').reason));
  check('  a bare array', !bad('[1,2,3]').ok);
  check('  JSON that is not ours', !bad('{"hello":"world"}').ok);

  // The mistake people will actually make.
  const csv = 'Name,Date,Rifle\nRange Day,2026-07-18,Impact';
  const r = bad(csv);
  check('  a session CSV', !r.ok);
  check('  and explains why a CSV is not a backup',
    /export, not a backup/.test(r.reason), r.reason);

  const future = JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION + 1, rifles: [] });
  check('  a backup from a newer build', !bad(future).ok);
  check('  and says to update rather than blaming the file',
    /Update, then restore/.test(bad(future).reason));

  const noVersion = JSON.stringify({ format: BACKUP_FORMAT, rifles: [] });
  check('  one with no version', !bad(noVersion).ok);
}

console.log('\nrefusing a damaged one, rather than half-applying it');
{
  const damaged = (patch) => readBackup(JSON.stringify({
    format: BACKUP_FORMAT, version: BACKUP_VERSION, rifles: [], loads: [],
    sessions: [], projects: [], dopeCards: [], prefs: {}, ...patch,
  }));

  check('  a collection that is not a list', !damaged({ sessions: { id: 's1' } }).ok);
  check('  and names which one', /"sessions" is not a list/.test(damaged({ sessions: 5 }).reason));
  check('  settings that are not an object', !damaged({ prefs: [1, 2] }).ok);

  const noId = damaged({ rifles: [{ id: 'r1' }, { name: 'no id here' }] });
  check('  a record with no id', !noId.ok,
    'restoring it would leave sessions pointing at a rifle that does not exist');
  check('  and says which entry', /rifles entry 2/.test(noId.reason), noId.reason);

  // A backup of an empty app is valid, and must not be confused with a broken
  // one - somebody who has just started is allowed to back that up.
  check('  an empty but well-formed backup is fine', damaged({}).ok);
}

console.log('\nsaying what a restore will do');
{
  const r = readBackup(buildBackup(DATA));
  const onto = describeRestore(r.counts, DATA);
  check('  names what is coming in', /1 sessions/.test(onto), onto);
  check('  and what it replaces', /replaces the 5 records/.test(onto),
    'the half of the sentence that actually matters');

  const empty = describeRestore(r.counts, {});
  check('  a fresh device is told there is nothing to lose',
    /nothing on this device to replace/.test(empty), empty);

  check('  an empty backup says so',
    /brings in nothing/.test(describeRestore({}, DATA)));
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
