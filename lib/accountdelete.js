/**
 * The account deletion sequence, separated from React so it can be tested.
 *
 * The dangerous property here is ordering. `deleteUser` must never run unless
 * reauthentication succeeded first — if a thrown reauth were swallowed and
 * deletion proceeded anyway, an unattended phone or a mistyped password would
 * destroy an account, and the bug would only ever be discovered by someone
 * losing their data. That cannot be asserted against a live account, so the
 * Firebase functions arrive as arguments and the harness supplies fakes.
 *
 * This file deliberately does not import firebase. It describes the sequence;
 * the caller supplies the implementation.
 */

/**
 * @param deps.currentUser  the signed-in user ({ email, ... })
 * @param deps.credential   (email, password) => credential
 * @param deps.reauthenticate  (user, credential) => Promise
 * @param deps.deleteUser   (user) => Promise
 * @param password          typed by the user, moments ago
 */
export async function runAccountDeletion(deps, password) {
  const { currentUser, credential, reauthenticate, deleteUser } = deps || {};

  if (!currentUser) {
    return { ok: false, code: 'auth/operation-not-allowed', reauthenticated: false, deleted: false };
  }
  if (!password) {
    // Refused before anything is attempted, so a blank field cannot reach
    // Firebase and cannot count against the rate limit either.
    return { ok: false, code: 'auth/missing-password', reauthenticated: false, deleted: false };
  }

  try {
    await reauthenticate(currentUser, credential(currentUser.email, password));
  } catch (e) {
    // The critical branch: deletion is not attempted.
    return { ok: false, code: e?.code || 'auth/invalid-credential', reauthenticated: false, deleted: false };
  }

  try {
    await deleteUser(currentUser);
  } catch (e) {
    // Reauth worked but deletion failed — the account still exists, and saying
    // it is gone would be worse than the failure.
    return { ok: false, code: e?.code || 'auth/internal-error', reauthenticated: true, deleted: false };
  }

  return { ok: true, code: null, reauthenticated: true, deleted: true };
}
