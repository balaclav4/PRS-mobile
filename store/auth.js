import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { firebaseConfigured, getFirebaseAuth, authErrorMessage, firebaseProjectId } from '../lib/firebase';
import { runAccountDeletion } from '../lib/accountdelete';

/**
 * Authentication state.
 *
 * Three states, not two: signed in, signed out, and "there is no auth backend
 * configured". The third is the one that matters during development and for
 * anyone running the app without credentials — it must behave like the app
 * always has, locally and without an account, rather than trapping the user on
 * a login screen that cannot possibly succeed.
 *
 * `ready` gates navigation. Firebase restores a persisted session
 * asynchronously, so routing before the first onAuthStateChanged callback would
 * bounce a signed-in user to the login screen on every cold start.
 */

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!firebaseConfigured);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) { setReady(true); return; }
    const { onAuthStateChanged } = require('firebase/auth');
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u ? { uid: u.uid, email: u.email, displayName: u.displayName } : null);
      setReady(true);
    }, (e) => {
      console.warn('[auth] state listener failed:', e.message);
      setReady(true);
    });
    return unsub;
  }, []);

  const run = useCallback(async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return { ok: true };
    } catch (e) {
      const msg = authErrorMessage(e?.code);
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setBusy(false);
    }
  }, []);

  const signIn = useCallback((email, password) => run(async () => {
    const auth = getFirebaseAuth();
    if (!auth) throw { code: 'auth/operation-not-allowed' };
    const { signInWithEmailAndPassword } = require('firebase/auth');
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }), [run]);

  const signUp = useCallback((email, password) => run(async () => {
    const auth = getFirebaseAuth();
    if (!auth) throw { code: 'auth/operation-not-allowed' };
    const { createUserWithEmailAndPassword } = require('firebase/auth');
    await createUserWithEmailAndPassword(auth, email.trim(), password);
  }), [run]);

  const resetPassword = useCallback((email) => run(async () => {
    const auth = getFirebaseAuth();
    if (!auth) throw { code: 'auth/operation-not-allowed' };
    const { sendPasswordResetEmail } = require('firebase/auth');
    await sendPasswordResetEmail(auth, email.trim());
  }), [run]);

  /**
   * Delete the signed-in account.
   *
   * Required by App Store guideline 5.1.1(v): an app that lets users create an
   * account must let them delete it. Wiping local data and signing out is not
   * deletion — the account still exists and the reviewer can see it.
   *
   * Firebase refuses deleteUser unless the session is recent, so this
   * reauthenticates with the password first. That is also the right safety
   * behaviour: an unattended phone should not be able to destroy an account.
   */
  const deleteAccountForever = useCallback((password) => run(async () => {
    const auth = getFirebaseAuth();
    const {
      EmailAuthProvider, reauthenticateWithCredential, deleteUser,
    } = require('firebase/auth');
    // The sequence lives in lib/accountdelete.js so its ordering can be tested
    // with fakes — above all that deleteUser is unreachable unless reauth
    // succeeded, which cannot be proved against a real account.
    const r = await runAccountDeletion({
      currentUser: auth?.currentUser,
      credential: EmailAuthProvider.credential,
      reauthenticate: reauthenticateWithCredential,
      deleteUser,
    }, password);
    if (!r.ok) throw { code: r.code };
  }), [run]);

  const signOut = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    const { signOut: fbSignOut } = require('firebase/auth');
    try { await fbSignOut(auth); } catch (e) { console.warn('[auth] sign out failed:', e.message); }
  }, []);

  const value = useMemo(() => ({
    configured: firebaseConfigured,
    projectId: firebaseProjectId,
    user,
    ready,
    busy,
    error,
    clearError: () => setError(null),
    signIn, signUp, signOut, resetPassword, deleteAccountForever,
  }), [user, ready, busy, error, signIn, signUp, signOut, resetPassword, deleteAccountForever]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
