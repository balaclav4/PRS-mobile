import { Platform } from 'react-native';

/**
 * Firebase client, initialised lazily and only when configured.
 *
 * Firebase is optional at runtime. With no credentials present the app keeps
 * working exactly as it does today — local storage, no account — and the login
 * screen says so. That is not a fallback for convenience: this project's
 * Firebase holds real data, so the app has to be developable and testable
 * without ever pointing at it, and a missing .env must degrade rather than
 * crash on launch.
 *
 * Auth initialisation differs by platform and getting it wrong is quiet. On
 * native, plain getAuth() keeps the session in memory only, so the user is
 * signed out every time the app restarts and it looks like a login bug.
 * initializeAuth with AsyncStorage persistence is what the Expo guide
 * prescribes, and the RN-only export is required inside the platform branch
 * because `firebase/auth` resolves to a browser build on web where
 * getReactNativePersistence does not exist.
 *
 * The API key is not a secret. Expo inlines EXPO_PUBLIC_ variables in plain
 * text and warns against putting private keys in them — a Firebase web key is
 * a project identifier, not a credential, and access is controlled by Firestore
 * security rules. Rules are what protect the data; the key being visible is
 * expected and documented by Firebase.
 */

// Dot notation is required — Expo inlines these statically and bracket access
// is not substituted.
const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

/** True when enough config is present to talk to a project at all. */
export const firebaseConfigured = Boolean(
  config.apiKey && config.projectId && config.appId
);

let cachedAuth = null;
let initError = null;

/** The Auth instance, or null when Firebase is not configured or failed to start. */
export function getFirebaseAuth() {
  if (!firebaseConfigured || initError) return null;
  if (cachedAuth) return cachedAuth;

  try {
    const { initializeApp, getApps, getApp } = require('firebase/app');
    const app = getApps().length ? getApp() : initializeApp(config);

    if (Platform.OS === 'web') {
      const { getAuth } = require('firebase/auth');
      cachedAuth = getAuth(app);
    } else {
      const { initializeAuth, getReactNativePersistence } = require('firebase/auth');
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      cachedAuth = initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage),
      });
    }
    return cachedAuth;
  } catch (e) {
    // A misconfigured project must not take the whole app down on launch.
    initError = e;
    console.warn('[firebase] auth unavailable, staying local-only:', e.message);
    return null;
  }
}

/** Which project the app is pointed at, for display. Never the key. */
export const firebaseProjectId = config.projectId || null;

/**
 * Firebase error codes are not readable. These are the ones a shooter can
 * actually hit at a login screen.
 */
export function authErrorMessage(code) {
  switch (code) {
    case 'auth/invalid-email': return 'That email address is not valid.';
    case 'auth/user-disabled': return 'That account has been disabled.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential': return 'Email or password is incorrect.';
    case 'auth/email-already-in-use': return 'An account already exists for that email.';
    case 'auth/weak-password': return 'Password needs to be at least 6 characters.';
    case 'auth/too-many-requests': return 'Too many attempts. Wait a minute and try again.';
    case 'auth/network-request-failed': return 'No connection. Check your signal and try again.';
    case 'auth/operation-not-allowed': return 'Email sign-in is not enabled on this project.';
    case 'auth/requires-recent-login': return 'For safety this needs your password again.';
    case 'auth/missing-password': return 'Enter your password to confirm.';
    default: return 'Could not sign in. Please try again.';
  }
}
