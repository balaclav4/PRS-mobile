import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as db from '../lib/db';
import { useAuth } from './auth';
import { runSync } from '../lib/syncremote';
import { DEFAULT_UNITS, groupUnitLabel, inchesToUnit } from '../lib/units';
import { noConsent, grantConsent, revokeConsent } from '../lib/consent';

/**
 * How long a write waits before it asks for a sync.
 *
 * Long enough that a burst of writes from one interaction becomes one round
 * trip, short enough that a shooter who records a group and immediately closes
 * the app has already sent it. Backgrounding flushes early regardless.
 */
const SYNC_DEBOUNCE_MS = 4000;

const SEED_RIFLES = [
  { id: 'r1', name: 'Impact 737R', cartridge: '6.5 Creedmoor', barrelLength: '26"', twist: '1:8', notes: 'Bartlein barrel' },
  { id: 'r2', name: 'Tikka T3x TAC A1', cartridge: '.308 Win', barrelLength: '24"', twist: '1:11', notes: '' },
  { id: 'r3', name: 'AI AXSR', cartridge: '6mm Dasher', barrelLength: '27"', twist: '1:7.5', notes: 'Proof barrel' },
];

const SEED_LOADS = [
  { id: 'l1', rifleId: 'r1', bullet: '140 Hybrid', powder: 'H4350', chargeGr: 41.8, primer: 'Fed 210M', brass: 'Lapua', coalOrCbto: 2.825, velocityFps: 2820, name: '140 Hybrid / H4350', caliber: '6.5 CM', sd: 8.4 },
  { id: 'l2', rifleId: 'r3', bullet: '105 Hybrid', powder: 'Varget', chargeGr: 33.2, primer: 'CCI BR4', brass: 'Alpha', coalOrCbto: 2.550, velocityFps: 2915, name: '105 Hybrid / Varget', caliber: '6 Dasher', sd: 6.1 },
  { id: 'l3', rifleId: 'r2', bullet: '175 SMK', powder: 'Varget', chargeGr: 44.0, primer: 'CCI 200', brass: 'Hornady', coalOrCbto: 2.800, velocityFps: 2610, name: '175 SMK / Varget', caliber: '.308', sd: 11.2 },
];

const SEED_SESSIONS = [
  {
    id: 's1', date: 'Jul 18, 2026', rifleId: 'r1', loadId: 'l1', distanceYd: 100, suppressed: true,
    notes: '', name: 'Range Day — Steel Practice',
    targets: [
      { id: 't1', shots: [{ x: 0.48, y: 0.42 }, { x: 0.52, y: 0.46 }, { x: 0.50, y: 0.44 }, { x: 0.49, y: 0.47 }, { x: 0.51, y: 0.43 }] },
      { id: 't2', shots: [{ x: 0.47, y: 0.45 }, { x: 0.53, y: 0.43 }, { x: 0.50, y: 0.48 }, { x: 0.51, y: 0.42 }, { x: 0.49, y: 0.46 }] },
      { id: 't3', shots: [{ x: 0.48, y: 0.44 }, { x: 0.52, y: 0.47 }, { x: 0.50, y: 0.42 }, { x: 0.49, y: 0.46 }, { x: 0.51, y: 0.45 }] },
      { id: 't4', shots: [{ x: 0.49, y: 0.43 }, { x: 0.51, y: 0.47 }, { x: 0.50, y: 0.45 }, { x: 0.48, y: 0.46 }, { x: 0.52, y: 0.44 }] },
    ],
    best: '0.42', meanRadius: '0.14', sd: 8.4, mv: 2820, targetCount: 4,
  },
  {
    id: 's2', date: 'Jul 12, 2026', rifleId: 'r3', loadId: 'l2', distanceYd: 100, suppressed: true,
    notes: '', name: 'Load Verify — 6 Dasher',
    targets: [
      { id: 't5', shots: [{ x: 0.50, y: 0.45 }, { x: 0.51, y: 0.46 }, { x: 0.49, y: 0.44 }, { x: 0.50, y: 0.47 }, { x: 0.51, y: 0.45 }] },
      { id: 't6', shots: [{ x: 0.50, y: 0.44 }, { x: 0.49, y: 0.46 }, { x: 0.51, y: 0.45 }, { x: 0.50, y: 0.43 }, { x: 0.49, y: 0.45 }] },
      { id: 't7', shots: [{ x: 0.50, y: 0.45 }, { x: 0.51, y: 0.44 }, { x: 0.49, y: 0.46 }, { x: 0.50, y: 0.45 }, { x: 0.51, y: 0.44 }] },
    ],
    best: '0.28', meanRadius: '0.11', sd: 6.1, mv: 2915, targetCount: 3,
  },
  {
    id: 's3', date: 'Jul 5, 2026', rifleId: 'r2', loadId: 'l3', distanceYd: 200, suppressed: false,
    notes: '', name: '308 Cold Bore Check',
    targets: [
      { id: 't8', shots: [{ x: 0.46, y: 0.42 }, { x: 0.54, y: 0.48 }, { x: 0.50, y: 0.44 }, { x: 0.48, y: 0.50 }, { x: 0.52, y: 0.46 }] },
      { id: 't9', shots: [{ x: 0.47, y: 0.43 }, { x: 0.53, y: 0.47 }, { x: 0.50, y: 0.45 }, { x: 0.49, y: 0.49 }, { x: 0.51, y: 0.44 }] },
    ],
    best: '0.71', meanRadius: '0.32', sd: 11.2, mv: 2610, targetCount: 2,
  },
];

// One demo ladder so the screen isn't empty on first run. Unlike the old
// hardcoded table, the node and its confidence are computed from these rungs
// at render time — the conclusion is derived, not asserted.
const SEED_PROJECTS = [
  {
    id: 'p1',
    name: '6 Dasher — AXSR',
    rifleId: 'r3',
    loadId: 'l2',
    goalMoa: 0.5,
    hitRatePct: 90,
    testDistanceYd: 100,
    shotsPerCharge: 3,
    currentStep: 6,
    createdAt: '2026-07-01T00:00:00.000Z',
    rungs: [
      { id: 'g1', charge: '32.6', velocity: '2856', groupMoa: '0.52' },
      { id: 'g2', charge: '32.8', velocity: '2872', groupMoa: '0.44' },
      { id: 'g3', charge: '33.0', velocity: '2892', groupMoa: '0.34' },
      { id: 'g4', charge: '33.2', velocity: '2905', groupMoa: '0.29' },
      { id: 'g5', charge: '33.4', velocity: '2909', groupMoa: '0.31' },
      { id: 'g6', charge: '33.6', velocity: '2931', groupMoa: '0.44' },
      { id: 'g7', charge: '33.8', velocity: '2948', groupMoa: '0.52' },
    ],
  },
];

const DataContext = createContext();

const SEED = { rifles: SEED_RIFLES, loads: SEED_LOADS, sessions: SEED_SESSIONS, projects: SEED_PROJECTS };

export function DataProvider({ children }) {
  // DataProvider sits inside AuthProvider in app/_layout, so who is signed in
  // is known here. That is the whole point: the dataset shown is a function of
  // the account, not of the phone.
  const { user, ready: authReady } = useAuth();
  const [rifles, setRifles] = useState(SEED_RIFLES);
  const [loads, setLoads] = useState(SEED_LOADS);
  const [sessions, setSessions] = useState(SEED_SESSIONS);
  const [projects, setProjects] = useState(SEED_PROJECTS);
  const [dopeCards, setDopeCards] = useState([]);
  const [units, setUnits] = useState(DEFAULT_UNITS);
  // Backs the initials in the dashboard corner. Local label, not an identity —
  // there is no account behind it yet.
  const [profileName, setProfileName] = useState('');
  // Bull diameters the shooter measured themselves. The app ships none for
  // competition faces, so this is the only place those can come from.
  const [bullPresets, setBullPresets] = useState([]);
  // Off until explicitly granted. Never inferred, never defaulted on.
  const [trainingConsent, setTrainingConsentState] = useState(noConsent());
  const [ready, setReady] = useState(false);
  // Whether the shooter has chosen to work without an account. Recorded, so
  // the choice is made once rather than being re-asked every launch.
  const [localOnly, setLocalOnly] = useState(false);
  const [prefsReady, setPrefsReady] = useState(false);

  const [syncState, setSyncState] = useState({ status: 'idle', at: null, reason: null });
  const lastSyncRef = useRef(null);

  /**
   * Load whatever belongs to the current owner.
   *
   * Runs on boot and again whenever the signed-in account changes, because
   * switching accounts must switch the dataset - not merge it, and not leave
   * the previous one on screen. Signing out returns to the 'local' scope, which
   * still holds anything recorded before signing in.
   */
  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    (async () => {
      db.setOwner(user?.uid ?? 'local');
      // Empty, always. The demo set is loaded only if asked for - see
      // db.initDbEmpty for why a stranger must not inherit someone else's
      // rifles and have the dashboard average them.
      const data = await db.initDbEmpty();
      if (!cancelled && data) {
        setRifles(data.rifles);
        setLoads(data.loads);
        setSessions(data.sessions);
        // Nullish, not falsy. Falling back on an *empty* array could not tell
        // "this install predates load dev" from "the user erased their data",
        // so the seed project reappeared on the dashboard immediately after an
        // erase — the one place it must not.
        setProjects(data.projects || []);
        setDopeCards(data.dopeCards || []);
        // Stored prefs override defaults per key, so a partially-set prefs
        // object still yields a complete unit set.
        setUnits({ ...DEFAULT_UNITS, ...(data.prefs?.units || {}) });
        setProfileName(data.prefs?.profileName ?? '');
        setTrainingConsentState(data.prefs?.trainingConsent ?? noConsent());
        setBullPresets(data.prefs?.bullPresets || []);
        setLocalOnly(data.prefs?.localOnly === true);
      }
      if (!cancelled) { setReady(true); setPrefsReady(true); }
    })();
    return () => { cancelled = true; };
  }, [authReady, user?.uid]);

  /**
   * Catch up once after signing in.
   *
   * Deliberately fire-and-forget and deliberately not on a timer. Sync is
   * something the app does when it can, not something any screen waits on -
   * the device is the source of truth for reading, and a shooter with no signal
   * must never be held up by it.
   */
  useEffect(() => {
    if (!ready || !user?.uid) return;
    let cancelled = false;
    (async () => {
      const stored = await db.getPref('lastSyncAt', null);
      if (cancelled) return;
      lastSyncRef.current = stored ?? null;
      syncNow();
    })();
    return () => { cancelled = true; };
  }, [ready, user?.uid]);

  const getRifle = useCallback((id) => rifles.find(r => r.id === id), [rifles]);
  const getLoad = useCallback((id) => loads.find(l => l.id === id), [loads]);
  const getSession = useCallback((id) => sessions.find(s => s.id === id), [sessions]);

  const getRifleName = useCallback((id) => {
    const r = rifles.find(r => r.id === id);
    return r ? r.name : 'Unknown';
  }, [rifles]);

  // Writes go to React state first (so the UI is immediate) and are persisted
  // in the background; a storage failure never blocks the interaction.
  //
  // Every write also asks for a sync. It used to not, and sync ran exactly
  // once per sign-in: a shooter signed in, recorded a season, and none of it
  // was ever pushed, because the only other trigger was a button on a screen
  // nobody had a reason to open. Reinstalling then found an empty server and
  // reported a perfectly successful sync of nothing.
  const persist = (fn) => {
    fn().catch(e => console.warn('[db] write failed:', e.message));
    requestSync();
  };

  /**
   * Ask for a sync shortly.
   *
   * Debounced, because a single interaction can be several writes - saving a
   * session writes the session and touches its project - and each one asking
   * for its own round trip would be wasteful rather than safer.
   *
   * Through a ref rather than calling syncNow directly: syncNow is declared
   * further down, and persist is referenced by callbacks defined between the
   * two. Reaching for it by name here is exactly the "cannot access before
   * initialization" this file has been bitten by before.
   */
  const syncNowRef = useRef(null);
  const syncTimer = useRef(null);

  const requestSync = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      syncTimer.current = null;
      syncNowRef.current?.();
    }, SYNC_DEBOUNCE_MS);
  }, []);

  /** Send anything outstanding now, without waiting out the debounce. */
  const flushSync = useCallback(() => {
    if (syncTimer.current) { clearTimeout(syncTimer.current); syncTimer.current = null; }
    syncNowRef.current?.();
  }, []);

  const addSession = useCallback((session) => {
    setSessions(prev => [session, ...prev]);
    persist(() => db.putSession(session));
  }, []);

  const updateSession = useCallback((id, updates) => {
    setSessions(prev => {
      const next = prev.map(s => s.id === id ? { ...s, ...updates } : s);
      const row = next.find(s => s.id === id);
      if (row) persist(() => db.putSession(row));
      return next;
    });
  }, []);

  const addRifle = useCallback((rifle) => {
    const row = { ...rifle, id: 'r' + Date.now() };
    setRifles(prev => [...prev, row]);
    persist(() => db.putRifle(row));
  }, []);

  const updateRifle = useCallback((id, updates) => {
    setRifles(prev => {
      const next = prev.map(r => r.id === id ? { ...r, ...updates } : r);
      const row = next.find(r => r.id === id);
      if (row) persist(() => db.putRifle(row));
      return next;
    });
  }, []);

  const deleteRifle = useCallback((id) => {
    setRifles(prev => prev.filter(r => r.id !== id));
    persist(() => db.removeRifle(id));
  }, []);

  const addLoad = useCallback((load) => {
    const row = { ...load, id: 'l' + Date.now() };
    setLoads(prev => [...prev, row]);
    persist(() => db.putLoad(row));
  }, []);

  const updateLoad = useCallback((id, updates) => {
    setLoads(prev => {
      const next = prev.map(l => l.id === id ? { ...l, ...updates } : l);
      const row = next.find(l => l.id === id);
      if (row) persist(() => db.putLoad(row));
      return next;
    });
  }, []);

  const deleteLoad = useCallback((id) => {
    setLoads(prev => prev.filter(l => l.id !== id));
    persist(() => db.removeLoad(id));
  }, []);

  const deleteSession = useCallback((id) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    persist(() => db.removeSession(id));
  }, []);

  const getProject = useCallback((id) => projects.find(p => p.id === id), [projects]);

  const addProject = useCallback((project) => {
    const row = { ...project, id: 'p' + Date.now(), createdAt: new Date().toISOString() };
    setProjects(prev => [...prev, row]);
    persist(() => db.putProject(row));
    return row;
  }, []);

  const updateProject = useCallback((id, updates) => {
    setProjects(prev => {
      const next = prev.map(p => p.id === id ? { ...p, ...updates } : p);
      const row = next.find(p => p.id === id);
      if (row) persist(() => db.putProject(row));
      return next;
    });
  }, []);

  const deleteProject = useCallback((id) => {
    setProjects(prev => prev.filter(p => p.id !== id));
    persist(() => db.removeProject(id));
  }, []);

  /**
   * Erase everything the user recorded. In-memory state is cleared alongside
   * storage — clearing only the database would leave the screens showing data
   * that no longer exists until the app was relaunched.
   */
  const clearAllData = useCallback(() => {
    setSessions([]); setRifles([]); setLoads([]); setProjects([]); setDopeCards([]);
    persist(() => db.clearUserData());
  }, []);

  /**
   * The same, plus preferences. There is no server account to delete yet, so
   * this is the whole of what "delete account" can honestly do today.
   */
  const deleteAccount = useCallback(() => {
    setSessions([]); setRifles([]); setLoads([]); setProjects([]); setDopeCards([]);
    setUnits(DEFAULT_UNITS);
    setProfileName('');
    setTrainingConsentState(noConsent());
    persist(() => db.clearEverything());
  }, []);

  const setUnit = useCallback((kind, value) => {
    setUnits(prev => {
      const next = { ...prev, [kind]: value };
      persist(() => db.putPref('units', next));
      return next;
    });
  }, []);

  const setTrainingConsent = useCallback((on) => {
    setTrainingConsentState(prev => {
      const next = on ? grantConsent() : revokeConsent(prev);
      persist(() => db.putPref('trainingConsent', next));
      return next;
    });
  }, []);

  const setProfile = useCallback((name) => {
    setProfileName(name);
    persist(() => db.putPref('profileName', name));
  }, []);

  /** Take the demo dataset, and stop asking. */
  const loadDemo = useCallback(async () => {
    const data = await db.loadDemoData(SEED);
    if (data) {
      setRifles(data.rifles || []);
      setLoads(data.loads || []);
      setSessions(data.sessions || []);
      setProjects(data.projects || []);
    }
  }, []);

  /** Everything the app holds, for the backup file. */
  const snapshot = useCallback(() => ({
    rifles, loads, sessions, projects, dopeCards,
    prefs: { units, profileName, trainingConsent, bullPresets },
  }), [rifles, loads, sessions, projects, dopeCards, units, profileName, trainingConsent, bullPresets]);

  /**
   * Replace everything with a restored backup.
   *
   * State is set from what the database returns rather than from the file, so
   * what ends up on screen is what actually persisted - if a write failed, the
   * shooter sees that immediately instead of a screen full of data that is gone
   * on next launch.
   */
  const restoreBackup = useCallback(async (data) => {
    const fresh = await db.restoreEverything(data);
    const d = fresh || data;
    setRifles(d.rifles || []);
    setLoads(d.loads || []);
    setSessions(d.sessions || []);
    setProjects(d.projects || []);
    setDopeCards(d.dopeCards || []);
    setUnits({ ...DEFAULT_UNITS, ...(d.prefs?.units || {}) });
    setProfileName(d.prefs?.profileName ?? '');
    setTrainingConsentState(d.prefs?.trainingConsent ?? noConsent());
    setBullPresets(d.prefs?.bullPresets || []);
    return d;
  }, []);

  /**
   * Push what is here, pull what is not, and reload.
   *
   * Reloads from the database rather than from the sync result, so the screen
   * shows what actually persisted. Never throws - a shooter on a bay with no
   * signal should see "could not reach the server", not a broken screen.
   */
  const syncNow = useCallback(async () => {
    if (!user?.uid) return { ok: false, reason: 'not-signed-in' };
    setSyncState(st => ({ ...st, status: 'syncing', reason: null }));
    const local = await db.readAllForSync();
    const r = await runSync({
      local,
      lastSyncAt: lastSyncRef.current,
      // fromSync, so each record keeps the timestamp and the tombstone it
      // arrived with. Without it every pulled record was stamped as a local
      // edit made now: tombstones came back to life and were pushed over the
      // server's, and unchanged records looked newer than the server's copy
      // and were re-uploaded on every sync from then on.
      applyPull: async (pulls) => {
        const fromSync = { fromSync: true };
        for (const rec of pulls.rifles || []) await db.putRifle(rec, fromSync);
        for (const rec of pulls.loads || []) await db.putLoad(rec, fromSync);
        for (const rec of pulls.sessions || []) await db.putSession(rec, fromSync);
        for (const rec of pulls.projects || []) await db.putProject(rec, fromSync);
        for (const rec of pulls.dopeCards || []) await db.putDopeCard(rec, fromSync);
      },
    });
    if (r.ok) {
      lastSyncRef.current = r.at;
      await db.putPref('lastSyncAt', r.at);
      const fresh = await db.readAll();
      if (fresh) {
        setRifles(fresh.rifles || []);
        setLoads(fresh.loads || []);
        setSessions(fresh.sessions || []);
        setProjects(fresh.projects || []);
        setDopeCards(fresh.dopeCards || []);
      }
      setSyncState({ status: 'ok', at: r.at, pushed: r.pushed, pulled: r.pulled, reason: null });
    } else {
      setSyncState({ status: 'error', at: null, reason: r.reason });
    }
    return r;
  }, [user?.uid]);

  // Published for requestSync/flushSync, which cannot name syncNow directly.
  syncNowRef.current = syncNow;

  /**
   * Send what is outstanding when the app goes to the background.
   *
   * This is the one that covers the reported failure: record a group, close
   * the app, delete it. A debounce alone does not survive the process going
   * away, and 'inactive' is included because iOS passes through it on the way
   * out and does not always reach 'background' before the app is killed.
   */
  useEffect(() => {
    if (!user?.uid) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') flushSync();
    });
    return () => sub.remove();
  }, [user?.uid, flushSync]);

  /**
   * Leave local-only, so the gate asks again.
   *
   * Signing out has to clear this too, or a shooter who once chose to work
   * offline and later made an account would press Sign Out and stay in the app
   * - signed out of Firebase but still waved through by the local-only flag,
   * looking at an empty dataset with no way back to the login screen.
   */
  const exitLocalOnly = useCallback(() => {
    setLocalOnly(false);
    persist(() => db.putPref('localOnly', false));
  }, []);

  /** Work without an account, knowingly. */
  const chooseLocalOnly = useCallback(() => {
    setLocalOnly(true);
    persist(() => db.putPref('localOnly', true));
  }, []);

  const addBullPreset = useCallback((preset) => {
    if (!preset) return;
    setBullPresets(prev => {
      // Same diameter means the same target measured twice, so the newer name
      // wins rather than the list growing a duplicate.
      const next = [preset, ...prev.filter(p => Number(p.inches) !== Number(preset.inches))];
      persist(() => db.putPref('bullPresets', next));
      return next;
    });
  }, []);

  const deleteBullPreset = useCallback((id) => {
    setBullPresets(prev => {
      const next = prev.filter(p => p.id !== id);
      persist(() => db.putPref('bullPresets', next));
      return next;
    });
  }, []);

  const getDopeCard = useCallback((id) => dopeCards.find(c => c.id === id), [dopeCards]);

  const addDopeCard = useCallback((card) => {
    const row = { ...card, id: 'd' + Date.now(), createdAt: new Date().toISOString() };
    setDopeCards(prev => [row, ...prev]);
    persist(() => db.putDopeCard(row));
    return row;
  }, []);

  const deleteDopeCard = useCallback((id) => {
    setDopeCards(prev => prev.filter(c => c.id !== id));
    persist(() => db.removeDopeCard(id));
  }, []);

  /**
   * CSV for every session, or just the ones whose ids are passed.
   * Values are quoted and embedded quotes doubled per RFC 4180 — a session
   * named `6.5 "hot" load` previously produced a malformed row.
   */
  const exportSessionsCSV = useCallback((ids = null) => {
    // Quotes are doubled and the value wrapped, which handles commas and
    // newlines. Leading =, +, - and @ need separate treatment: Excel and Sheets
    // read those as formulas, so a session named `=HYPERLINK(...)` becomes
    // executable content in the reader rather than text. Prefixing a tab keeps
    // the value visually identical and stops it being parsed as a formula.
    const cell = (v) => {
      let t = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(t)) t = '\t' + t;
      return `"${t.replace(/"/g, '""')}"`;
    };

    // Group sizes are stored in inches and velocities in fps; the export follows
    // the same unit preference as every screen, and the header says which.
    const gLabel = groupUnitLabel(units.group);
    const dLabel = units.distance;
    const vLabel = units.velocity;
    const grp = (inches, distanceYd) => {
      const v = inchesToUnit(parseFloat(inches), distanceYd, units.group);
      return v == null ? '' : v.toFixed(2);
    };
    const vel = (fps) => {
      const n = Number(fps);
      if (!isFinite(n) || n <= 0) return '';
      return units.velocity === 'm/s' ? (n * 0.3048).toFixed(0) : String(Math.round(n));
    };

    const header = [
      'Name', 'Date', 'Rifle', 'Load', `Distance (${dLabel})`, 'Suppressed',
      `Best Group (${gLabel})`, `Mean Radius (${gLabel})`,
      `MV (${vLabel})`, `SD (${vLabel})`, 'Targets', 'Total Shots',
    ].join(',');

    const scoped = ids ? sessions.filter(s => ids.includes(s.id)) : sessions;
    const rows = scoped.map(s => {
      const rifleName = rifles.find(r => r.id === s.rifleId)?.name || '';
      const loadName = loads.find(l => l.id === s.loadId)?.name || '';
      const totalShots = s.targets.reduce((a, t) => a + t.shots.length, 0);
      const dist = units.distance === 'm'
        ? Math.round(Number(s.distanceYd) * 0.9144)
        : s.distanceYd;
      return [
        s.name, s.date, rifleName, loadName, dist, s.suppressed ? 'Yes' : 'No',
        grp(s.best, s.distanceYd), grp(s.meanRadius, s.distanceYd),
        vel(s.mv), vel(s.sd), s.targetCount, totalShots,
      ].map(cell).join(',');
    });
    return header + '\n' + rows.join('\n');
  }, [sessions, rifles, loads, units]);

  const value = useMemo(() => ({
    rifles, loads, sessions, projects, dopeCards, units, setUnit, ready,
    profileName, setProfile, clearAllData, deleteAccount,
    trainingConsent, setTrainingConsent,
    getRifle, getLoad, getSession, getRifleName,
    addSession, updateSession, addRifle, addLoad,
    updateRifle, deleteRifle,
    updateLoad, deleteLoad,
    deleteSession,
    getProject, addProject, updateProject, deleteProject,
    getDopeCard, addDopeCard, deleteDopeCard,
    bullPresets, addBullPreset, deleteBullPreset,
    loadDemo,
    snapshot, restoreBackup, syncNow, syncState, signedIn: !!user?.uid,
    localOnly, chooseLocalOnly, exitLocalOnly, prefsReady,
    exportSessionsCSV,
  }), [rifles, loads, sessions, projects, dopeCards, units, setUnit, ready,
       bullPresets, addBullPreset, deleteBullPreset,
       loadDemo, snapshot, restoreBackup, syncNow, syncState, user?.uid,
       localOnly, chooseLocalOnly, exitLocalOnly, prefsReady,
       profileName, setProfile, clearAllData, deleteAccount,
       trainingConsent, setTrainingConsent, getRifle, getLoad, getSession, getRifleName, addSession, updateSession, addRifle, addLoad, updateRifle, deleteRifle, updateLoad, deleteLoad, deleteSession, getProject, addProject, updateProject, deleteProject, getDopeCard, addDopeCard, deleteDopeCard, exportSessionsCSV]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  return useContext(DataContext);
}
