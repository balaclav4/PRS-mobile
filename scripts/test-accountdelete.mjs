/**
 * Validates the account deletion sequence with fake Firebase functions.
 *
 * The property worth proving is negative: deleteUser must NOT be called unless
 * reauthentication succeeded. A bug there would destroy an account on a
 * mistyped password, and it could only ever be discovered by someone losing
 * their data — which is precisely why it cannot be tested against a live
 * account. Fakes record what was called, in what order, with what arguments.
 *
 * This does not prove Firebase deletes users. It proves this app asks it to,
 * correctly and only when it should.
 *
 * Run: node scripts/test-accountdelete.mjs
 */
import { runAccountDeletion } from '../lib/accountdelete.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(56) + detail);
};

const USER = { uid: 'u1', email: 'shooter@example.com' };

/** Fakes that record the call sequence. */
function harness({ reauthFails = false, deleteFails = false, user = USER } = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      currentUser: user,
      credential: (email, password) => {
        calls.push(['credential', email, password]);
        return { email, password, _type: 'cred' };
      },
      reauthenticate: async (u, cred) => {
        calls.push(['reauthenticate', u.uid, cred._type]);
        if (reauthFails) throw { code: 'auth/invalid-credential' };
      },
      deleteUser: async (u) => {
        calls.push(['deleteUser', u.uid]);
        if (deleteFails) throw { code: 'auth/network-request-failed' };
      },
    },
  };
}

console.log('the happy path');
{
  const h = harness();
  const r = await runAccountDeletion(h.deps, 'correct-horse');
  check('  succeeds', r.ok && r.deleted && r.reauthenticated);
  check('  reauthenticates before deleting',
    h.calls.map(c => c[0]).join(' -> ') === 'credential -> reauthenticate -> deleteUser',
    h.calls.map(c => c[0]).join(' -> '));
  check('  builds the credential from the signed-in email',
    h.calls[0][1] === 'shooter@example.com' && h.calls[0][2] === 'correct-horse');
  check('  deletes exactly once',
    h.calls.filter(c => c[0] === 'deleteUser').length === 1);
}

console.log('\nthe branch that matters: a wrong password');
{
  const h = harness({ reauthFails: true });
  const r = await runAccountDeletion(h.deps, 'wrong-password');
  check('  refuses', !r.ok && r.code === 'auth/invalid-credential');
  check('  and NEVER calls deleteUser',
    !h.calls.some(c => c[0] === 'deleteUser'),
    h.calls.map(c => c[0]).join(' -> '));
  check('  reports the account as not deleted',
    r.deleted === false && r.reauthenticated === false);
}

console.log('\na blank password never reaches Firebase');
{
  for (const pw of ['', null, undefined]) {
    const h = harness();
    const r = await runAccountDeletion(h.deps, pw);
    check(`  ${JSON.stringify(pw)} is refused locally`,
      !r.ok && r.code === 'auth/missing-password' && h.calls.length === 0,
      `${h.calls.length} network calls`);
  }
}

console.log('\nnot signed in');
{
  const h = harness({ user: null });
  const r = await runAccountDeletion(h.deps, 'anything');
  check('  refuses with nothing attempted',
    !r.ok && r.code === 'auth/operation-not-allowed' && h.calls.length === 0);
}

console.log('\nreauth succeeds but deletion fails');
{
  const h = harness({ deleteFails: true });
  const r = await runAccountDeletion(h.deps, 'correct-horse');
  check('  does not claim success', !r.ok, r.code);
  check('  and does not claim the account is gone', r.deleted === false,
    'saying it is deleted when it is not would be worse than the failure');
  check('  but records that reauth did work', r.reauthenticated === true);
  check('  it did attempt the delete', h.calls.some(c => c[0] === 'deleteUser'));
}

console.log('\nmissing dependencies are not silently skipped');
{
  // A missing reauthenticate raises a TypeError inside the same try that guards
  // a wrong password, so it lands on the refusal branch. That is the behaviour
  // to want: the property is "never deletes", not "throws".
  let deleted = false;
  const r = await runAccountDeletion({
    currentUser: USER,
    credential: () => ({}),
    deleteUser: async () => { deleted = true; },
  }, 'pw');
  check('  a broken reauth refuses rather than deleting',
    !r.ok && r.deleted === false && deleted === false,
    'deleteUser was never reached');
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
