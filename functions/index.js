/**
 * Server-side data deletion.
 *
 * The client can delete its own auth record but not its Firestore data. The web
 * SDK has no recursive delete — deleting `users/{uid}` leaves every subcollection
 * beneath it orphaned and still stored, invisible to the client and untouched by
 * security rules, because a document's existence and its subcollections are
 * independent in Firestore. A client-side sweep would need to enumerate every
 * collection name it knows about, and would silently miss any added later.
 *
 * So deletion runs here, where the Admin SDK has recursiveDelete.
 *
 * There is an official Firebase extension, "Delete User Data", that does much of
 * this. It is a reasonable alternative and needs no code. This exists because the
 * training-data cleanup below is specific to this app and the extension does not
 * know about it.
 *
 * Deploy:  firebase deploy --only functions
 */

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const functions = require('firebase-functions/v1');

initializeApp();
const db = getFirestore();

/**
 * When an account is deleted, remove everything belonging to it.
 *
 * Triggered by the auth deletion the app performs, so the user does not have to
 * trust a second request to fire — the account going away is the signal.
 */
exports.onUserDeleted = functions.auth.user().onDelete(async (user) => {
  const uid = user.uid;
  const started = Date.now();

  try {
    // recursiveDelete walks subcollections, which is the whole reason this
    // cannot be done from the client.
    await db.recursiveDelete(db.doc(`users/${uid}`));
    console.log(`[delete] removed users/${uid} in ${Date.now() - started}ms`);
  } catch (e) {
    // Logged loudly rather than swallowed: a failure here leaves personal data
    // behind after someone asked for it to be gone, which is the one outcome
    // that must not pass quietly.
    console.error(`[delete] FAILED to remove users/${uid}:`, e);
    throw e;
  }

  // Contributed training images are stored without an account identifier in the
  // training set itself, but each carries submittedBy so a withdrawal can be
  // honoured. Deleting the account withdraws it.
  try {
    const contributions = await db
      .collection('training-data')
      .where('submittedBy', '==', uid)
      .get();

    if (!contributions.empty) {
      // Batches cap at 500 writes.
      const docs = contributions.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = db.batch();
        for (const d of docs.slice(i, i + 400)) batch.delete(d.ref);
        await batch.commit();
      }
      console.log(`[delete] removed ${docs.length} contributions for ${uid}`);
    }
  } catch (e) {
    // Non-fatal relative to the account data above, but still surfaced.
    console.error(`[delete] failed to remove contributions for ${uid}:`, e);
  }

  // Note: images already used to train a model cannot be un-learned. The stored
  // image is removed; the model is not retrained. This is stated in the privacy
  // policy rather than quietly glossed.
});

/**
 * Manual cleanup for a uid whose deletion trigger failed or predates this
 * function. Callable by an admin only — there is no client path to it.
 */
exports.purgeUserData = functions.https.onCall(async (data, context) => {
  if (!context.auth?.token?.admin) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Admin only.'
    );
  }
  const uid = String(data?.uid || '');
  if (!uid) {
    throw new functions.https.HttpsError('invalid-argument', 'uid is required.');
  }
  await db.recursiveDelete(db.doc(`users/${uid}`));
  return { ok: true, uid };
});
