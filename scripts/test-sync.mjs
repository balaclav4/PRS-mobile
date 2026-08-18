/**
 * Validates sync reconciliation.
 *
 * The check that matters most is resurrection: delete a session, sync, and it
 * must stay deleted. Without tombstones the next pull finds the server's copy
 * still there and restores it — the record comes back, nothing errors, and the
 * user is left believing the app lost their delete. It is asserted here from
 * both directions.
 *
 * Everything else follows from three rules: the device reads offline, a first
 * sync unions rather than picks a side, and last-write-wins resolves conflicts
 * while still reporting them.
 *
 * Run: node scripts/test-sync.mjs
 */
import { reconcile, reconcileAll, tombstone, touch, syncStamp } from '../lib/sync.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(56) + detail);
};

const T0 = 1_000_000;          // an old timestamp
const SYNC = 2_000_000;        // when we last synced
const T1 = 3_000_000;          // after that sync
const T2 = 4_000_000;          // later still

const rec = (id, updatedAt, extra = {}) => ({ id, updatedAt, name: id, ...extra });
const ids = (list) => list.map(r => r.id).sort();

console.log('the simple cases');
{
  const r = reconcile([rec('a', T1)], [], SYNC);
  check('  a record only on the device is pushed', ids(r.toPush).join() === 'a');

  const p = reconcile([], [rec('b', T1)], SYNC);
  check('  a record only on the server is pulled', ids(p.toPull).join() === 'b');

  const same = reconcile([rec('a', T1)], [rec('a', T1)], SYNC);
  check('  identical records do nothing',
    same.toPush.length === 0 && same.toPull.length === 0);
  check('  and that reads as up to date',
    reconcileAll({ x: [rec('a', T1)] }, { x: [rec('a', T1)] }, SYNC).upToDate);
}

console.log('\nnewer wins');
{
  const localNewer = reconcile([rec('a', T2)], [rec('a', T1)], SYNC);
  check('  a newer local edit is pushed',
    ids(localNewer.toPush).join() === 'a' && localNewer.toPull.length === 0);

  const remoteNewer = reconcile([rec('a', T1)], [rec('a', T2)], SYNC);
  check('  a newer remote edit is pulled',
    ids(remoteNewer.toPull).join() === 'a' && remoteNewer.toPush.length === 0);
}

console.log('\ndeletes must not come back');
{
  // The headline case. Deleted locally after the last sync; the server still
  // has the old record.
  const local = [tombstone(rec('a', T0), T1)];
  const remote = [rec('a', T0)];
  const r = reconcile(local, remote, SYNC);
  check('  a local delete is pushed as a tombstone',
    r.toPush.length === 1 && r.toPush[0].deleted === true,
    JSON.stringify(r.toPush[0]));
  check('  and the old server copy is NOT pulled back',
    r.toPull.length === 0, `${r.toPull.length} pulls`);

  // And the mirror: deleted on the server, still present locally.
  const r2 = reconcile([rec('a', T0)], [tombstone(rec('a', T0), T1)], SYNC);
  check('  a remote delete is pulled', r2.toPull.length === 1 && r2.toPull[0].deleted === true);
  check('  and the local copy is not pushed back over it', r2.toPush.length === 0);

  // A tombstone both sides already have is dead weight.
  const settled = reconcile(
    [tombstone(rec('a', T0), T1)], [tombstone(rec('a', T0), T1)], SYNC
  );
  check('  a tombstone both sides agree on is prunable',
    settled.prunable.join() === 'a');
  check('  and generates no traffic',
    settled.toPush.length === 0 && settled.toPull.length === 0);

  // An edit made after a delete legitimately restores the record.
  const restored = reconcile([tombstone(rec('a', T0), T1)], [rec('a', T2)], SYNC);
  check('  an edit newer than the delete does restore it',
    restored.toPull.length === 1 && !restored.toPull[0].deleted,
    'someone edited it after the delete');

  // A tombstone already pushed before the last sync is not re-pushed forever.
  const old = reconcile([tombstone(rec('a', T0), T0)], [], SYNC);
  check('  an already-synced tombstone stops being pushed',
    old.toPush.length === 0, `${old.toPush.length} pushes`);
}

console.log('\nconflicts');
{
  // Both sides edited since the last sync.
  const r = reconcile([rec('a', T2)], [rec('a', T1)], SYNC);
  check('  a genuine conflict is reported', r.conflicts.length === 1);
  check('  and still resolved rather than left hanging',
    r.conflicts[0].winner === 'local' && ids(r.toPush).join() === 'a');

  const remoteWins = reconcile([rec('a', T1)], [rec('a', T2)], SYNC);
  check('  the newer side wins either way',
    remoteWins.conflicts[0].winner === 'remote' && ids(remoteWins.toPull).join() === 'a');

  // Only one side changed since the sync — not a conflict, just an update.
  const notConflict = reconcile([rec('a', T0)], [rec('a', T2)], SYNC);
  check('  a one-sided change is not called a conflict',
    notConflict.conflicts.length === 0 && notConflict.toPull.length === 1);

  check('  the conflict carries both versions',
    r.conflicts[0].local.id === 'a' && r.conflicts[0].remote.id === 'a');
}

console.log('\nthe first sync unions');
{
  // No lastSyncAt: neither side is stale, so nothing may be discarded.
  const r = reconcile([rec('a', T0), rec('b', T1)], [rec('c', T0), rec('b', T0)], null);
  check('  local-only records are pushed', ids(r.toPush).join() === 'a,b');
  check('  remote-only records are pulled', ids(r.toPull).join() === 'c');
  check('  nothing is lost from either side',
    new Set([...ids(r.toPush), ...ids(r.toPull), 'b']).size === 3);
  check('  overlapping records are flagged as conflicting',
    r.conflicts.length === 1 && r.conflicts[0].id === 'b',
    'no basis to call either stale');
}

console.log('\nwhole datasets');
{
  const local = {
    rifles: [rec('r1', T1)],
    sessions: [rec('s1', T2), tombstone(rec('s2', T0), T1)],
    loads: [],
  };
  const remote = {
    rifles: [rec('r1', T1)],
    sessions: [rec('s1', T0), rec('s2', T0)],
    dopecards: [rec('d1', T1)],
  };
  const r = reconcileAll(local, remote, SYNC);
  check('  every collection is reconciled',
    Object.keys(r.collections).sort().join() === 'dopecards,loads,rifles,sessions');
  check('  totals add up', r.totals.pushes === 2 && r.totals.pulls === 1,
    `${r.totals.pushes} push, ${r.totals.pulls} pull`);
  check('  an untouched collection contributes nothing',
    r.collections.rifles.toPush.length === 0 && r.collections.rifles.toPull.length === 0);
  check('  a mobile-only collection is pushed, not dropped',
    reconcileAll({ loaddev: [rec('p1', T1)] }, {}, SYNC).collections.loaddev.toPush.length === 1);
  check('  a web-only collection is pulled, not dropped',
    r.collections.dopecards.toPull.length === 1);
  check('  not up to date when there is work', r.upToDate === false);
}

console.log('\ntimestamp shapes and bad input');
{
  check('  ISO strings compare correctly', (() => {
    const a = reconcile([rec('a', '2026-08-05T10:00:00Z')], [rec('a', '2026-08-04T10:00:00Z')], null);
    return a.toPush.length === 1;
  })());
  check('  Firestore Timestamps compare correctly', (() => {
    const stamp = (ms) => ({ toMillis: () => ms });
    const a = reconcile([rec('a', stamp(T2))], [rec('a', stamp(T1))], SYNC);
    return a.toPush.length === 1;
  })());
  check('  a missing timestamp does not win by accident', (() => {
    const a = reconcile([rec('a', null)], [rec('a', T1)], SYNC);
    return a.toPull.length === 1 && a.toPush.length === 0;
  })());
  check('  records without an id are ignored',
    reconcile([{ updatedAt: T1 }], [], SYNC).toPush.length === 0);
  check('  empty input is safe',
    reconcile().toPush.length === 0 && reconcileAll().upToDate === true);
  check('  touch stamps a record', touch(rec('a', T0), T2).updatedAt === T2);
  check('  tombstone refuses a record with no id', tombstone({}) === null);
}


console.log('\nwhat a record is stamped with, and whether sync then converges');
{
  // The real function lib/db writes through, not a copy of it. A fixture built
  // to the same convention as the bug would have agreed with the bug.
  const [own, at, del] = syncStamp({ updatedAt: 2000, deleted: 1 }, {}, 'uid-a', 5000);
  check('  a local edit is stamped now and alive', own === 'uid-a' && at === 5000 && del === 0,
    `${own} ${at} ${del}`);

  const [own2, at2, del2] = syncStamp({ updatedAt: 2000, deleted: 1 }, { fromSync: true }, 'uid-a', 5000);
  check('  a record from sync keeps its own timestamp and its tombstone',
    own2 === 'uid-a' && at2 === 2000 && del2 === 1, `${own2} ${at2} ${del2}`);

  const [, at3] = syncStamp({ deleted: 0 }, { fromSync: true }, 'uid-a', 5000);
  check('  and falls back to now if the record carries no timestamp', at3 === 5000);

  // Convergence. Pull a record, write it the way applyPull does, and reconcile
  // again against the same server: there must be nothing left to do. Stamping
  // pulled records with Date.now() made this push forever.
  const remote = [{ id: 'r1', name: 'Impact', updatedAt: 2000 }];
  const first = reconcile([], remote, null);
  check('  a first sync pulls the record', first.toPull.length === 1 && first.toPush.length === 0);

  const written = first.toPull.map(rec => {
    const [ownerId, updatedAt, deleted] = syncStamp(rec, { fromSync: true }, 'uid-a', 9000);
    return { ...rec, ownerId, updatedAt, deleted };
  });
  const second = reconcile(written, remote, 9000);
  check('  and the next sync has nothing to send back',
    second.toPush.length === 0 && second.toPull.length === 0,
    `push ${second.toPush.length}, pull ${second.toPull.length}`);

  // The same for a tombstone: it must stay dead on arrival.
  const deadRemote = [{ id: 's1', deleted: true, updatedAt: 3000 }];
  const pulled = reconcile([{ id: 's1', name: 'group', updatedAt: 1000 }], deadRemote, 2000);
  check('  a server tombstone beats an older local record', pulled.toPull.length === 1);
  const afterDelete = pulled.toPull.map(rec => {
    const [ownerId, updatedAt, deleted] = syncStamp(rec, { fromSync: true }, 'uid-a', 9000);
    return { ...rec, ownerId, updatedAt, deleted };
  });
  check('  and is written as still deleted, not resurrected',
    afterDelete[0].deleted === 1 && afterDelete[0].updatedAt === 3000,
    `deleted ${afterDelete[0].deleted}, at ${afterDelete[0].updatedAt}`);
  const third = reconcile(afterDelete, deadRemote, 9000);
  check('  so the deletion is not pushed back over the server as alive',
    third.toPush.length === 0, `push ${third.toPush.length}`);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
