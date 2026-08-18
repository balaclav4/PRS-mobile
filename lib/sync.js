/**
 * Sync reconciliation.
 *
 * Pure decision logic: given what is on the device and what is on the server,
 * work out what to push, what to pull, and what genuinely conflicts. It performs
 * no I/O and knows nothing about Firestore, which is what makes it testable and
 * what keeps a wrong policy from being discovered against live data.
 *
 * The device is the source of truth for reading. People shoot where there is no
 * signal, so the app must work fully offline and treat sync as something that
 * catches up afterwards rather than something it depends on.
 *
 * Three decisions worth stating, because each has a failure mode that looks like
 * the app working:
 *
 *   1. Deletions need tombstones. Dropping a record locally and pushing nothing
 *      means the next pull finds it still on the server and restores it — the
 *      user deletes a session, it reappears, and nothing errors. A delete is
 *      recorded as a record with `deleted: true` and its own timestamp, so it
 *      competes on the same footing as an edit.
 *
 *   2. Last-write-wins is chosen deliberately, not by default. The alternative
 *      — merging field by field — would silently interleave two people's edits
 *      into a record neither of them wrote. For shooting data, where one person
 *      owns an account and edits from one device at a time, a whole-record
 *      winner is both correct and explicable. Genuine conflicts are still
 *      reported rather than swallowed.
 *
 *   3. A first sync unions rather than overwrites. With no previous sync there
 *      is no basis for deciding that either side is stale, and picking one would
 *      throw away whichever the user happened not to be holding.
 */

/** Milliseconds from whatever shape a timestamp arrived in. */
function ts(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  // Firestore Timestamps expose toMillis(); ISO strings parse.
  if (typeof v?.toMillis === 'function') return v.toMillis();
  const t = Date.parse(v);
  return isFinite(t) ? t : 0;
}

/**
 * Reconcile one collection.
 *
 * @param local   records on the device, each { id, updatedAt, deleted? }
 * @param remote  records on the server, same shape
 * @param lastSyncAt  when this collection last synced; null on a first sync
 *
 * Returns the actions to take. Nothing is applied here.
 */
export function reconcile(local = [], remote = [], lastSyncAt = null) {
  const since = ts(lastSyncAt);
  const firstSync = lastSyncAt == null;

  const byId = (list) => {
    const m = new Map();
    for (const r of list || []) if (r && r.id != null) m.set(r.id, r);
    return m;
  };
  const L = byId(local), R = byId(remote);

  const toPush = [];    // send to server
  const toPull = [];    // apply locally
  const conflicts = []; // both sides changed since the last sync

  for (const id of new Set([...L.keys(), ...R.keys()])) {
    const l = L.get(id), r = R.get(id);

    if (l && !r) {
      // Only local. On a first sync that is simply new. Afterwards, a record
      // missing from the server was either never pushed or was deleted there —
      // and a server-side delete arrives as a tombstone, not as an absence, so
      // absence means "never pushed".
      if (!(l.deleted && ts(l.updatedAt) <= since)) toPush.push(l);
      continue;
    }
    if (r && !l) {
      // Only remote. Pull unless it is a tombstone we have already applied.
      if (!r.deleted) toPull.push(r);
      continue;
    }

    const lt = ts(l.updatedAt), rt = ts(r.updatedAt);
    if (lt === rt) continue; // identical, nothing to do

    const localChanged = firstSync || lt > since;
    const remoteChanged = firstSync || rt > since;

    if (localChanged && remoteChanged) {
      // A real conflict. Report it, and still resolve it, so the caller can
      // surface the fact without being left without an answer.
      conflicts.push({ id, local: l, remote: r, winner: lt >= rt ? 'local' : 'remote' });
    }

    if (lt > rt) toPush.push(l);
    else toPull.push(r);
  }

  return {
    toPush,
    toPull,
    conflicts,
    // A tombstone that both sides agree on can stop being carried around.
    prunable: [...L.values()].filter(l => {
      const r = R.get(l.id);
      return l.deleted && r?.deleted;
    }).map(l => l.id),
  };
}

/**
 * Mark a record deleted rather than removing it.
 *
 * The tombstone has to carry a timestamp later than the record it replaces, or
 * reconcile will treat the server's older copy as the winner and restore it.
 */
export function tombstone(record, now = Date.now()) {
  if (!record?.id) return null;
  return { id: record.id, deleted: true, updatedAt: now };
}

/**
 * The ownership and versioning triple a syncable row is written with.
 *
 * Policy, so it lives here with the rest of the policy and can be tested
 * against the real function rather than a copy of it in a fixture. `lib/db`
 * calls this and supplies the owner; it does the writing and makes no decision.
 *
 * A local edit is new by definition: it happens now, and it is not a deletion.
 * A record arriving from sync is neither - it already carries a timestamp and
 * may be a tombstone, and both have to survive the write or sync cannot
 * converge. Writing `Date.now(), 0` for both cases did two kinds of damage:
 *
 *   - a pulled tombstone was written back as a live record and then pushed over
 *     the server's tombstone. Deletions did not fail to propagate, they
 *     inverted;
 *   - every pulled record was stamped newer than the server's copy, so it was
 *     re-uploaded on every sync from then on, and could overwrite a newer edit
 *     made on another device in between.
 *
 * A flag rather than "honour updatedAt when present", because the store edits
 * by spreading the row it read - `{ ...rifle, ...updates }` - so every local
 * edit arrives carrying the previous updatedAt and would freeze at it, never
 * looking newer than the server and never pushing again.
 */
export function syncStamp(rec, { fromSync = false } = {}, ownerId = 'local', now = Date.now()) {
  return fromSync
    ? [ownerId, Number(rec?.updatedAt) || now, rec?.deleted ? 1 : 0]
    : [ownerId, now, 0];
}

/** Stamp a record as locally modified. */
export function touch(record, now = Date.now()) {
  return { ...record, updatedAt: now };
}

/**
 * Reconcile a whole dataset, collection by collection.
 *
 * Collections are independent: a conflict in rifles says nothing about
 * sessions, and one failing must not block the rest.
 */
export function reconcileAll(localSets = {}, remoteSets = {}, lastSyncAt = null) {
  const names = new Set([...Object.keys(localSets), ...Object.keys(remoteSets)]);
  const out = {};
  let pushes = 0, pulls = 0, conflicts = 0;
  for (const name of names) {
    const r = reconcile(localSets[name] || [], remoteSets[name] || [], lastSyncAt);
    out[name] = r;
    pushes += r.toPush.length;
    pulls += r.toPull.length;
    conflicts += r.conflicts.length;
  }
  return {
    collections: out,
    totals: { pushes, pulls, conflicts },
    // Nothing to do is worth knowing explicitly — it is the normal state and
    // should not look like a failure.
    upToDate: pushes === 0 && pulls === 0,
  };
}
