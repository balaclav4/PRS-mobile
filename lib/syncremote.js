import { getFirebaseAuth } from './firebase';
import { reconcileAll } from './sync';

/**
 * The Firestore side of sync.
 *
 * `lib/sync` decides what should happen and touches no network; this does the
 * I/O and makes no decisions. Keeping them apart is what let the policy be
 * tested against fabricated data rather than discovered against somebody's real
 * sessions.
 *
 * Everything lives under `users/{uid}/`, which is what the deployed Firestore
 * rules allow and nothing else: a signed-in user can read and write their own
 * subtree and no part of anyone else's.
 *
 * Offline is the normal case, not the error case. People shoot where there is
 * no signal. Every entry point here returns a result rather than throwing, the
 * device stays the source of truth for reading, and a failed sync leaves the
 * local data exactly as it was.
 */

/** Collections that sync, and the Firestore subcollection each maps to. */
const COLLECTIONS = {
  rifles: 'rifles',
  loads: 'loads',
  sessions: 'sessions',
  projects: 'loaddev',
  dopeCards: 'dopecards',
};

/**
 * Firestore rejects `undefined`, and a single one anywhere fails the whole
 * write with a message that names the field but not the record.
 */
function clean(obj) {
  if (Array.isArray(obj)) return obj.map(clean);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      out[k] = clean(v);
    }
    return out;
  }
  return obj;
}

function db() {
  const auth = getFirebaseAuth();
  if (!auth?.currentUser) return null;
  const { getFirestore } = require('firebase/firestore');
  return { fs: getFirestore(), uid: auth.currentUser.uid };
}

/** Everything the server holds for this user. */
async function pullAll(fs, uid) {
  const { collection, getDocs } = require('firebase/firestore');
  const out = {};
  for (const [name, path] of Object.entries(COLLECTIONS)) {
    const snap = await getDocs(collection(fs, 'users', uid, path));
    out[name] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  return out;
}

/**
 * Run one sync.
 *
 * @param local   `readAllForSync()` output — tombstones included
 * @param applyPull  called with the records to write locally
 * @param lastSyncAt  when this device last completed a sync, or null
 *
 * Returns `{ ok, pushed, pulled, conflicts, at }`, or `{ ok: false, reason }`.
 * Never throws: a sync failing is an ordinary thing that must not take a screen
 * down with it.
 */
export async function runSync({ local, applyPull, lastSyncAt = null } = {}) {
  const conn = db();
  if (!conn) return { ok: false, reason: 'not-signed-in' };
  const { fs, uid } = conn;

  try {
    const remote = await pullAll(fs, uid);
    const plan = reconcileAll(local, remote, lastSyncAt);

    // Pull first. If the push then fails, the device has the server's changes
    // and its own are still queued — the safe order. Pushing first and failing
    // to pull would leave the device believing it was up to date.
    const pulls = {};
    for (const [name, r] of Object.entries(plan.collections)) {
      if (r.toPull.length) pulls[name] = r.toPull;
    }
    if (Object.keys(pulls).length && applyPull) await applyPull(pulls);

    const { doc, writeBatch } = require('firebase/firestore');
    let pushed = 0;
    // Batched, and chunked under Firestore's 500-operation limit. A shooter
    // syncing a season's work for the first time will exceed it.
    let batch = writeBatch(fs), n = 0;
    for (const [name, r] of Object.entries(plan.collections)) {
      const path = COLLECTIONS[name];
      for (const rec of r.toPush) {
        batch.set(doc(fs, 'users', uid, path, String(rec.id)), clean(rec));
        pushed++;
        if (++n >= 400) { await batch.commit(); batch = writeBatch(fs); n = 0; }
      }
    }
    if (n > 0) await batch.commit();

    return {
      ok: true,
      pushed,
      pulled: Object.values(pulls).reduce((a, b) => a + b.length, 0),
      conflicts: plan.totals.conflicts,
      at: Date.now(),
    };
  } catch (e) {
    // Offline, rules, quota — all the same from here: the local data is
    // untouched and it can be tried again.
    return { ok: false, reason: e?.code || e?.message || 'sync-failed' };
  }
}

/**
 * Delete this user's whole subtree from the server.
 *
 * Used when an account is deleted from a device. It cannot be complete - the
 * web SDK has no recursive delete and a subcollection under a removed document
 * is orphaned rather than deleted, which is what the Cloud Function in
 * functions/ exists to finish. This is the client doing what it can, not a
 * substitute for that.
 */
export async function purgeRemote() {
  const conn = db();
  if (!conn) return { ok: false, reason: 'not-signed-in' };
  const { fs, uid } = conn;
  try {
    const { collection, getDocs, doc, writeBatch } = require('firebase/firestore');
    let batch = writeBatch(fs), n = 0, removed = 0;
    for (const path of Object.values(COLLECTIONS)) {
      const snap = await getDocs(collection(fs, 'users', uid, path));
      for (const d of snap.docs) {
        batch.delete(doc(fs, 'users', uid, path, d.id));
        removed++;
        if (++n >= 400) { await batch.commit(); batch = writeBatch(fs); n = 0; }
      }
    }
    if (n > 0) await batch.commit();
    return { ok: true, removed };
  } catch (e) {
    return { ok: false, reason: e?.code || e?.message || 'purge-failed' };
  }
}
