import { Platform } from 'react-native';

/**
 * Local persistence.
 *
 * Native uses expo-sqlite. Web uses localStorage instead: expo-sqlite's web
 * backend is alpha and requires SharedArrayBuffer, which means serving the app
 * with Cross-Origin-Embedder-Policy / Cross-Origin-Opener-Policy headers plus a
 * WASM Metro config. Not worth that for a local-first dataset this small.
 *
 * Shots are stored as JSON on the target row — they are never queried
 * independently of their target.
 */

const WEB_KEY = 'prs.db.v1';
const isWeb = Platform.OS === 'web';

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS rifles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT, cartridge TEXT, barrelLength TEXT, twist TEXT, notes TEXT,
  -- Rounds fired before the app existed. Without it a round count only knows
  -- about photographed groups and reads a fraction of the truth, which would
  -- make every barrel-life threshold meaningless.
  priorRounds INTEGER, barrelInstalledAt TEXT,
  -- One scope evaluation per rifle: you evaluate the optic that is mounted.
  scopeEvalJson TEXT, zeroBaselineJson TEXT, torqueJson TEXT,
  -- CBTO at which this barrel's lands are touched. A property of the barrel,
  -- not the load: it is what turns a seating ladder's raw CBTO figures into
  -- jump, which is the number shooters actually compare and the only one that
  -- means anything between rifles. Moves as the throat erodes, so it is
  -- re-measured rather than set once.
  landsCbto REAL, landsMeasuredAt TEXT,
  -- Whose data this is. 'local' for an install that has never signed
  -- in, a Firebase uid afterwards. Reads filter on it, so signing out hides
  -- an account's records rather than deleting them and two accounts on one
  -- phone cannot see each other's groups.
  ownerId TEXT NOT NULL DEFAULT 'local',
  -- Sync bookkeeping. updatedAt orders last-write-wins; deleted is a
  -- tombstone, because dropping a row and pushing nothing means the next pull
  -- finds it on the server and restores it.
  updatedAt INTEGER, deleted INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS loads (
  id TEXT PRIMARY KEY NOT NULL,
  rifleId TEXT, bullet TEXT, powder TEXT, chargeGr REAL, primer TEXT,
  brass TEXT, coalOrCbto REAL, velocityFps REAL, name TEXT, caliber TEXT, sd REAL,
  -- Components vary batch to batch; a lot number is what makes a velocity
  -- shift attributable rather than mysterious.
  powderLot TEXT, primerLot TEXT, bulletLot TEXT, brassLot TEXT,
  -- The ballistic coefficient belongs to the load, not to a screen. Typed
  -- fresh each visit it could not be compared against another load, and a
  -- trued BC - solved backwards from the shooter's own dope, which is the
  -- better number for their rifle - was discarded on leaving the screen.
  bc REAL, dragModel TEXT, bcTruedAt TEXT,
  -- A measured drag curve, when the shooter has one, with its provenance. The
  -- points and where they came from travel together deliberately: a curve whose
  -- origin has been lost cannot be checked, corrected or redistributed.
  dragCurveJson TEXT,
  ownerId TEXT NOT NULL DEFAULT 'local',
  updatedAt INTEGER, deleted INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT, date TEXT, rifleId TEXT, loadId TEXT, distanceYd REAL, distanceUnit TEXT,
  -- Which load development variant this group was fired for. Recorded at
  -- capture; never inferred from charge weights or dates, because a near-match
  -- attributed to the wrong rung corrupts the comparison the test exists for.
  projectId TEXT, projectStep INTEGER, projectRowId TEXT,
  suppressed INTEGER, notes TEXT, best TEXT, meanRadius TEXT,
  sd REAL, mv REAL, targetCount INTEGER,
  velocitiesJson TEXT, velocityEs REAL,
  ownerId TEXT NOT NULL DEFAULT 'local',
  updatedAt INTEGER, deleted INTEGER DEFAULT 0
);
-- A target records where the shots landed, not what they landed on. The photo
-- is a measuring instrument: it gets normalised, displayed, detected on and
-- marked, and then only the coordinates and the scale corners are worth
-- keeping. Nothing in the app ever read the photo back.
--
-- Installs from before this keep a vestigial photoUri column holding a dangling
-- cache path. Left in place deliberately rather than dropped: ALTER TABLE DROP
-- COLUMN is a comparatively recent SQLite addition and can fail outright, which
-- would break startup, whereas an unwritten NULL column costs nothing.
CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY NOT NULL,
  sessionId TEXT NOT NULL, ordinal INTEGER,
  scaleJson TEXT, shotsJson TEXT, aimJson TEXT
);
CREATE INDEX IF NOT EXISTS idx_targets_session ON targets(sessionId);
CREATE TABLE IF NOT EXISTS prefs (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT
);
CREATE TABLE IF NOT EXISTS dopecards (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT, loadId TEXT, rifleId TEXT,
  createdAt TEXT, optsJson TEXT, rowsJson TEXT,
  ownerId TEXT NOT NULL DEFAULT 'local',
  updatedAt INTEGER, deleted INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS loaddev (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT, rifleId TEXT, loadId TEXT,
  goalMoa REAL, hitRatePct REAL, testDistanceYd REAL,
  shotsPerCharge INTEGER, currentStep INTEGER,
  rungsJson TEXT, createdAt TEXT,
  seatingJson TEXT, seatingShots INTEGER,
  refShots INTEGER, refHits INTEGER, refGroupMoa REAL,
  refGroupShots INTEGER, refTargetIn REAL,
  primerJson TEXT, workupJson TEXT, bookMaxGr REAL,
  screenJson TEXT, screenShots INTEGER,
  coarseJson TEXT, coarseShots INTEGER,
  ownerId TEXT NOT NULL DEFAULT 'local',
  updatedAt INTEGER, deleted INTEGER DEFAULT 0
);
`;

let db = null;

/**
 * Whose data the app is currently reading and writing.
 *
 * 'local' until somebody signs in, then their Firebase uid. Every synced table
 * carries this and every read filters on it, which is what makes an account a
 * boundary rather than just a name: two people on one phone cannot see each
 * other's sessions, and signing out hides an account's data instead of
 * deleting it.
 *
 * Held here rather than threaded through every call because it changes rarely
 * and forgetting to pass it anywhere would silently widen the boundary - the
 * one failure this exists to prevent.
 */
let ownerId = 'local';

export function setOwner(id) { ownerId = id || 'local'; }
export function getOwner() { return ownerId; }

/** Stamp a record as this owner's, and mark when it changed, for sync. */
function owned(row) {
  return { ...row, ownerId, updatedAt: Date.now(), deleted: row.deleted ? 1 : 0 };
}

/**
 * Columns added after the first release. CREATE TABLE IF NOT EXISTS is a no-op
 * on an existing database, so new columns need an explicit ALTER; SQLite has no
 * IF NOT EXISTS for that, hence the check against the live column list.
 */
const MIGRATIONS = [
  ['rifles', 'ownerId', "TEXT NOT NULL DEFAULT 'local'"],
  ['rifles', 'updatedAt', 'INTEGER'],
  ['rifles', 'deleted', 'INTEGER DEFAULT 0'],
  ['loads', 'ownerId', "TEXT NOT NULL DEFAULT 'local'"],
  ['loads', 'updatedAt', 'INTEGER'],
  ['loads', 'deleted', 'INTEGER DEFAULT 0'],
  ['sessions', 'ownerId', "TEXT NOT NULL DEFAULT 'local'"],
  ['sessions', 'updatedAt', 'INTEGER'],
  ['sessions', 'deleted', 'INTEGER DEFAULT 0'],
  ['loaddev', 'ownerId', "TEXT NOT NULL DEFAULT 'local'"],
  ['loaddev', 'updatedAt', 'INTEGER'],
  ['loaddev', 'deleted', 'INTEGER DEFAULT 0'],
  ['dopecards', 'ownerId', "TEXT NOT NULL DEFAULT 'local'"],
  ['dopecards', 'updatedAt', 'INTEGER'],
  ['dopecards', 'deleted', 'INTEGER DEFAULT 0'],
  ['targets', 'aimJson', 'TEXT'],
  ['rifles', 'priorRounds', 'INTEGER'],
  ['rifles', 'scopeEvalJson', 'TEXT'],
  ['rifles', 'zeroBaselineJson', 'TEXT'],
  ['rifles', 'barrelInstalledAt', 'TEXT'],
  ['rifles', 'torqueJson', 'TEXT'],
  ['rifles', 'landsCbto', 'REAL'],
  ['rifles', 'landsMeasuredAt', 'TEXT'],
  ['loads', 'powderLot', 'TEXT'],
  ['loads', 'primerLot', 'TEXT'],
  ['loads', 'bulletLot', 'TEXT'],
  ['loads', 'brassLot', 'TEXT'],
  ['loads', 'bc', 'REAL'],
  ['loads', 'dragModel', 'TEXT'],
  ['loads', 'bcTruedAt', 'TEXT'],
  ['loads', 'dragCurveJson', 'TEXT'],
  ['sessions', 'distanceUnit', 'TEXT'],
  ['sessions', 'projectId', 'TEXT'],
  ['sessions', 'projectStep', 'INTEGER'],
  ['sessions', 'projectRowId', 'TEXT'],
  ['sessions', 'velocitiesJson', 'TEXT'],
  ['sessions', 'velocityEs', 'REAL'],
  ['loaddev', 'seatingJson', 'TEXT'],
  ['loaddev', 'seatingShots', 'INTEGER'],
  ['loaddev', 'refShots', 'INTEGER'],
  ['loaddev', 'refHits', 'INTEGER'],
  ['loaddev', 'refGroupMoa', 'REAL'],
  ['loaddev', 'refGroupShots', 'INTEGER'],
  ['loaddev', 'refTargetIn', 'REAL'],
  ['loaddev', 'primerJson', 'TEXT'],
  ['loaddev', 'workupJson', 'TEXT'],
  ['loaddev', 'bookMaxGr', 'REAL'],
  ['loaddev', 'screenJson', 'TEXT'],
  ['loaddev', 'screenShots', 'INTEGER'],
  ['loaddev', 'coarseJson', 'TEXT'],
  ['loaddev', 'coarseShots', 'INTEGER'],
];

async function migrate(d) {
  for (const [table, column, type] of MIGRATIONS) {
    const cols = await d.getAllAsync(`PRAGMA table_info(${table})`);
    if (!cols.some(c => c.name === column)) {
      await d.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }
}

async function open() {
  if (db) return db;
  const SQLite = require('expo-sqlite');
  db = await SQLite.openDatabaseAsync('prs.db');
  await db.execAsync(SCHEMA);
  await migrate(db);
  return db;
}

// ---------- web (localStorage) ----------

function webRead() {
  try {
    const raw = localStorage.getItem(WEB_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function webWrite(data) {
  try {
    localStorage.setItem(WEB_KEY, JSON.stringify(data));
  } catch {
    // Quota or private-mode failure — the in-memory state stays authoritative.
  }
}

function webMutate(fn) {
  const data = webRead() || { rifles: [], loads: [], sessions: [] };
  fn(data);
  webWrite(data);
}

function upsertInto(arr, row) {
  const r = owned(row);
  const i = arr.findIndex(x => x.id === r.id);
  if (i >= 0) arr[i] = { ...arr[i], ...r };
  else arr.push(r);
}

/**
 * A tombstone rather than a hard delete.
 *
 * Removing the row and pushing nothing means the next pull finds the record
 * still on the server and restores it: the user deletes a session, it comes
 * back, and nothing errors. See lib/sync.
 */
function tombstoneIn(arr, id) {
  const i = arr.findIndex(x => x.id === id);
  if (i >= 0) arr[i] = { ...arr[i], deleted: 1, updatedAt: Date.now(), ownerId };
}

/** Only this owner's live records. */
function mine(arr) {
  return (arr || []).filter(r => (r.ownerId || 'local') === ownerId && !r.deleted);
}

// ---------- public API ----------

/**
 * Opens storage and seeds it on first run.
 * Returns the full dataset, or null if storage is unavailable.
 */
/**
 * Seeding is gated on a `seeded` pref, not on the tables being empty.
 *
 * Counting rows looked equivalent and is not: after the user erases their data
 * every table is empty again, so the next launch helpfully restored the whole
 * demo dataset and made "delete everything" look like it had failed. The flag
 * records that seeding has already happened once, and erasing sets it too.
 *
 * Existing installs have data but no flag, and the row count still guards them,
 * so they are not re-seeded either.
 */
/**
 * Start a fresh install empty, and record that nothing has been chosen yet.
 *
 * Seeding on first launch was right while this app had one user who knew the
 * demo rifles were props. It is wrong the moment a stranger opens it: they see
 * three rifles and five sessions they did not shoot, cannot tell which data is
 * theirs, and every figure on the dashboard - typical group, best, trend - is
 * computed over invented numbers. Their first real group then lands in a list
 * indistinguishable from the fiction.
 *
 * So nothing is seeded until asked for. `seeded` still means "do not seed
 * again". Whether the shooter has seen the demo offer is not recorded: the
 * dashboard shows it while there is no rifle and stops when there is one, which
 * is self-clearing and needs no flag.
 */
export async function initDbEmpty() {
  try {
    if (isWeb) {
      if (!webRead()) {
        webWrite({ rifles: [], loads: [], sessions: [], projects: [], dopeCards: [], prefs: { seeded: true } });
      }
      return webRead();
    }
    const d = await open();
    const flag = await d.getFirstAsync("SELECT value FROM prefs WHERE key = 'seeded'");
    if (!flag) await putPref('seeded', true);
    return await readAll();
  } catch (e) {
    console.warn('[db] init failed, running in-memory only:', e.message);
    return null;
  }
}

/** Write the demo dataset on request, from the first-run prompt. */
export async function loadDemoData(seed) {
  if (isWeb) {
    const existing = webRead() || {};
    webWrite({
      ...existing,
      rifles: [...(existing.rifles || []), ...seed.rifles],
      loads: [...(existing.loads || []), ...seed.loads],
      sessions: [...(existing.sessions || []), ...seed.sessions],
      projects: [...(existing.projects || []), ...(seed.projects || [])],
      prefs: { ...(existing.prefs || {}), seeded: true },
    });
    return webRead();
  }
  const d = await open();
  await seedNative(d, seed);
  for (const p of seed.projects || []) await putProject(p);
  await putPref('seeded', true);
  return await readAll();
}

export async function initDb(seed) {
  try {
    if (isWeb) {
      const existing = webRead();
      if (!existing) {
        webWrite({ ...seed, prefs: { ...(seed.prefs || {}), seeded: true } });
      } else if (!existing.projects || !existing.dopeCards || !existing.prefs) {
        // Storage written before a later feature existed: backfill the missing
        // keys rather than discarding the user's sessions by re-seeding.
        webWrite({
          ...existing,
          projects: existing.projects || seed.projects || [],
          dopeCards: existing.dopeCards || [],
          prefs: existing.prefs || {},
        });
      }
      return webRead();
    }

    const d = await open();
    const flag = await d.getFirstAsync("SELECT value FROM prefs WHERE key = 'seeded'");
    const alreadySeeded = !!flag;
    const { n } = await d.getFirstAsync('SELECT COUNT(*) AS n FROM rifles');
    if (!alreadySeeded && n === 0) {
      await seedNative(d, seed);
      const { np } = await d.getFirstAsync('SELECT COUNT(*) AS np FROM loaddev');
      if (np === 0) for (const p of seed.projects || []) await putProject(p);
      await putPref('seeded', true);
    }
    return await readAll();
  } catch (e) {
    console.warn('[db] init failed, running in-memory only:', e.message);
    return null;
  }
}

async function seedNative(d, seed) {
  for (const r of seed.rifles) await putRifle(r);
  for (const l of seed.loads) await putLoad(l);
  for (const s of seed.sessions) await putSession(s);
}

export async function readAll() {
  if (isWeb) {
    const d = webRead() || {};
    return {
      rifles: mine(d.rifles), loads: mine(d.loads), sessions: mine(d.sessions),
      projects: mine(d.projects), dopeCards: mine(d.dopeCards), prefs: d.prefs || {},
    };
  }

  const d = await open();
  const rifleRows = await d.getAllAsync('SELECT * FROM rifles WHERE ownerId = ? AND COALESCE(deleted,0) = 0', ownerId);
  const rifles = rifleRows.map(r => ({
    ...r,
    scopeEval: r.scopeEvalJson ? JSON.parse(r.scopeEvalJson) : null,
    torque: r.torqueJson ? JSON.parse(r.torqueJson) : [],
    zeroBaseline: r.zeroBaselineJson ? JSON.parse(r.zeroBaselineJson) : null,
  }));
  const loads = await d.getAllAsync('SELECT * FROM loads WHERE ownerId = ? AND COALESCE(deleted,0) = 0', ownerId);
  const sessionRows = await d.getAllAsync('SELECT * FROM sessions WHERE ownerId = ? AND COALESCE(deleted,0) = 0', ownerId);
  const targetRows = await d.getAllAsync('SELECT * FROM targets ORDER BY ordinal');
  const projectRows = await d.getAllAsync('SELECT * FROM loaddev WHERE ownerId = ? AND COALESCE(deleted,0) = 0', ownerId);
  const dopeRows = await d.getAllAsync('SELECT * FROM dopecards WHERE ownerId = ? AND COALESCE(deleted,0) = 0', ownerId);
  const prefRows = await d.getAllAsync('SELECT * FROM prefs');

  const bySession = new Map();
  for (const t of targetRows) {
    const target = {
      id: t.id,
      scale: t.scaleJson ? JSON.parse(t.scaleJson) : null,
      shots: t.shotsJson ? JSON.parse(t.shotsJson) : [],
      aim: t.aimJson ? JSON.parse(t.aimJson) : null,
    };
    bySession.set(t.sessionId, (bySession.get(t.sessionId) || []).concat(target));
  }

  const sessions = sessionRows.map(s => ({
    ...s,
    suppressed: !!s.suppressed,
    velocities: s.velocitiesJson ? JSON.parse(s.velocitiesJson) : [],
    targets: bySession.get(s.id) || [],
  }));

  const projects = projectRows.map(p => ({
    ...p,
    rungs: p.rungsJson ? JSON.parse(p.rungsJson) : [],
    seatingRows: p.seatingJson ? JSON.parse(p.seatingJson) : [],
    primerRows: p.primerJson ? JSON.parse(p.primerJson) : [],
    workupRows: p.workupJson ? JSON.parse(p.workupJson) : [],
    screenRows: p.screenJson ? JSON.parse(p.screenJson) : [],
    coarseRows: p.coarseJson ? JSON.parse(p.coarseJson) : [],
  }));

  const dopeCards = dopeRows.map(c => ({
    ...c,
    opts: c.optsJson ? JSON.parse(c.optsJson) : {},
    rows: c.rowsJson ? JSON.parse(c.rowsJson) : [],
  }));

  const prefs = {};
  for (const r of prefRows) {
    try { prefs[r.key] = JSON.parse(r.value); } catch { prefs[r.key] = r.value; }
  }

  return { rifles, loads, sessions, projects, dopeCards, prefs };
}

export async function putRifle(r) {
  if (isWeb) return webMutate(d => upsertInto(d.rifles, r));
  const d = await open();
  await d.runAsync(
    `INSERT INTO rifles (id, name, cartridge, barrelLength, twist, notes,
                         priorRounds, barrelInstalledAt, scopeEvalJson, zeroBaselineJson,
                         torqueJson, landsCbto, landsMeasuredAt, ownerId, updatedAt, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, cartridge=excluded.cartridge,
       barrelLength=excluded.barrelLength, twist=excluded.twist, notes=excluded.notes,
       priorRounds=excluded.priorRounds, barrelInstalledAt=excluded.barrelInstalledAt,
       scopeEvalJson=excluded.scopeEvalJson, zeroBaselineJson=excluded.zeroBaselineJson,
       torqueJson=excluded.torqueJson,
       landsCbto=excluded.landsCbto, landsMeasuredAt=excluded.landsMeasuredAt,
       ownerId=excluded.ownerId, updatedAt=excluded.updatedAt, deleted=excluded.deleted`,
    r.id, r.name ?? '', r.cartridge ?? '', r.barrelLength ?? '', r.twist ?? '', r.notes ?? '',
    r.priorRounds ?? 0, r.barrelInstalledAt ?? null,
    r.scopeEval ? JSON.stringify(r.scopeEval) : null,
    r.zeroBaseline ? JSON.stringify(r.zeroBaseline) : null,
    r.torque?.length ? JSON.stringify(r.torque) : null,
    r.landsCbto ?? null, r.landsMeasuredAt ?? null,
    ownerId, Date.now(), 0
  );
}

export async function removeRifle(id) {
  if (isWeb) return webMutate(d => tombstoneIn(d.rifles || (d.rifles = []), id));
  const d = await open();
  // A tombstone, not a delete: see tombstoneIn. The row stays so the
  // change can be pushed, and every read already filters it out.
  await d.runAsync(
    `UPDATE rifles SET deleted = 1, updatedAt = ? WHERE id = ? AND ownerId = ?`,
    Date.now(), id, ownerId
  );
}

export async function putLoad(l) {
  if (isWeb) return webMutate(d => upsertInto(d.loads, l));
  const d = await open();
  await d.runAsync(
    `INSERT INTO loads (id, rifleId, bullet, powder, chargeGr, primer, brass,
                        coalOrCbto, velocityFps, name, caliber, sd,
                        powderLot, primerLot, bulletLot, brassLot,
                        bc, dragModel, bcTruedAt, dragCurveJson, ownerId, updatedAt, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       rifleId=excluded.rifleId, bullet=excluded.bullet, powder=excluded.powder,
       chargeGr=excluded.chargeGr, primer=excluded.primer, brass=excluded.brass,
       coalOrCbto=excluded.coalOrCbto, velocityFps=excluded.velocityFps,
       name=excluded.name, caliber=excluded.caliber, sd=excluded.sd,
       powderLot=excluded.powderLot, primerLot=excluded.primerLot,
       bulletLot=excluded.bulletLot, brassLot=excluded.brassLot,
       bc=excluded.bc, dragModel=excluded.dragModel, bcTruedAt=excluded.bcTruedAt,
       dragCurveJson=excluded.dragCurveJson,
       ownerId=excluded.ownerId, updatedAt=excluded.updatedAt, deleted=excluded.deleted`,
    l.id, l.rifleId ?? null, l.bullet ?? '', l.powder ?? '', l.chargeGr ?? 0,
    l.primer ?? '', l.brass ?? '', l.coalOrCbto ?? 0, l.velocityFps ?? 0,
    l.name ?? '', l.caliber ?? '', l.sd ?? 0,
    l.powderLot ?? '', l.primerLot ?? '', l.bulletLot ?? '', l.brassLot ?? '',
    l.bc ?? null, l.dragModel ?? null, l.bcTruedAt ?? null, l.dragCurveJson ?? null,
    ownerId, Date.now(), 0
  );
}

export async function removeLoad(id) {
  if (isWeb) return webMutate(d => tombstoneIn(d.loads || (d.loads = []), id));
  const d = await open();
  // A tombstone, not a delete: see tombstoneIn. The row stays so the
  // change can be pushed, and every read already filters it out.
  await d.runAsync(
    `UPDATE loads SET deleted = 1, updatedAt = ? WHERE id = ? AND ownerId = ?`,
    Date.now(), id, ownerId
  );
}

export async function putSession(s) {
  if (isWeb) return webMutate(d => upsertInto(d.sessions, s));
  const d = await open();
  await d.runAsync(
    `INSERT INTO sessions (id, name, date, rifleId, loadId, distanceYd, distanceUnit, suppressed,
                           notes, best, meanRadius, sd, mv, targetCount,
                           velocitiesJson, velocityEs,
                           projectId, projectStep, projectRowId, ownerId, updatedAt, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, date=excluded.date, rifleId=excluded.rifleId,
       loadId=excluded.loadId, distanceYd=excluded.distanceYd,
       distanceUnit=excluded.distanceUnit,
       suppressed=excluded.suppressed, notes=excluded.notes, best=excluded.best,
       meanRadius=excluded.meanRadius, sd=excluded.sd, mv=excluded.mv,
       targetCount=excluded.targetCount, velocitiesJson=excluded.velocitiesJson,
       velocityEs=excluded.velocityEs,
       projectId=excluded.projectId, projectStep=excluded.projectStep,
       projectRowId=excluded.projectRowId,
       ownerId=excluded.ownerId, updatedAt=excluded.updatedAt, deleted=excluded.deleted`,
    s.id, s.name ?? '', s.date ?? '', s.rifleId ?? null, s.loadId ?? null,
    s.distanceYd ?? 0, s.distanceUnit ?? 'yd', s.suppressed ? 1 : 0, s.notes ?? '', String(s.best ?? ''),
    String(s.meanRadius ?? ''), s.sd ?? 0, s.mv ?? 0, s.targetCount ?? 0,
    s.velocities?.length ? JSON.stringify(s.velocities) : null, s.velocityEs ?? null,
    s.projectId ?? null, s.projectStep ?? null, s.projectRowId ?? null,
    ownerId, Date.now(), 0
  );

  // Targets are owned by the session — replace them wholesale.
  await d.runAsync('DELETE FROM targets WHERE sessionId = ?', s.id);
  const targets = s.targets || [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    await d.runAsync(
      `INSERT INTO targets (id, sessionId, ordinal, scaleJson, shotsJson, aimJson)
       VALUES (?, ?, ?, ?, ?, ?)`,
      t.id, s.id, i,
      t.scale ? JSON.stringify(t.scale) : null,
      JSON.stringify(t.shots || []),
      t.aim ? JSON.stringify(t.aim) : null
    );
  }
}

export async function removeSession(id) {
  if (isWeb) return webMutate(d => tombstoneIn(d.sessions || (d.sessions = []), id));
  const d = await open();
  await d.runAsync('DELETE FROM targets WHERE sessionId = ?', id);
  // A tombstone, not a delete: see tombstoneIn. The row stays so the
  // change can be pushed, and every read already filters it out.
  await d.runAsync(
    `UPDATE sessions SET deleted = 1, updatedAt = ? WHERE id = ? AND ownerId = ?`,
    Date.now(), id, ownerId
  );
}

export async function putProject(p) {
  if (isWeb) return webMutate(d => {
    d.projects = d.projects || [];
    upsertInto(d.projects, p);
  });
  const d = await open();
  await d.runAsync(
    `INSERT INTO loaddev (id, name, rifleId, loadId, goalMoa, hitRatePct,
                          testDistanceYd, shotsPerCharge, currentStep, rungsJson, createdAt,
                          seatingJson, seatingShots,
                          refShots, refHits, refGroupMoa, refGroupShots, refTargetIn,
                          primerJson, workupJson, bookMaxGr,
                          screenJson, screenShots, coarseJson, coarseShots, ownerId, updatedAt, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, rifleId=excluded.rifleId, loadId=excluded.loadId,
       goalMoa=excluded.goalMoa, hitRatePct=excluded.hitRatePct,
       testDistanceYd=excluded.testDistanceYd, shotsPerCharge=excluded.shotsPerCharge,
       currentStep=excluded.currentStep, rungsJson=excluded.rungsJson,
       seatingJson=excluded.seatingJson, seatingShots=excluded.seatingShots,
       refShots=excluded.refShots, refHits=excluded.refHits,
       refGroupMoa=excluded.refGroupMoa, refGroupShots=excluded.refGroupShots,
       refTargetIn=excluded.refTargetIn, primerJson=excluded.primerJson,
       workupJson=excluded.workupJson, bookMaxGr=excluded.bookMaxGr,
       screenJson=excluded.screenJson, screenShots=excluded.screenShots,
       coarseJson=excluded.coarseJson, coarseShots=excluded.coarseShots,
       ownerId=excluded.ownerId, updatedAt=excluded.updatedAt, deleted=excluded.deleted`,
    p.id, p.name ?? '', p.rifleId ?? null, p.loadId ?? null,
    p.goalMoa ?? 0, p.hitRatePct ?? 0, p.testDistanceYd ?? 0,
    p.shotsPerCharge ?? 1, p.currentStep ?? 1,
    JSON.stringify(p.rungs || []), p.createdAt ?? new Date().toISOString(),
    JSON.stringify(p.seatingRows || []), p.seatingShots ?? 5,
    p.refShots ?? null, p.refHits ?? null, p.refGroupMoa ?? null,
    p.refGroupShots ?? null, p.refTargetIn ?? null,
    JSON.stringify(p.primerRows || []),
    JSON.stringify(p.workupRows || []), p.bookMaxGr ?? null,
    JSON.stringify(p.screenRows || []), p.screenShots ?? 5,
    JSON.stringify(p.coarseRows || []), p.coarseShots ?? 5,
    ownerId, Date.now(), 0
  );
}

export async function removeProject(id) {
  if (isWeb) return webMutate(d => { d.projects = (d.projects || []).filter(p => p.id !== id); });
  const d = await open();
  // A tombstone, not a delete: see tombstoneIn. The row stays so the
  // change can be pushed, and every read already filters it out.
  await d.runAsync(
    `UPDATE loaddev SET deleted = 1, updatedAt = ? WHERE id = ? AND ownerId = ?`,
    Date.now(), id, ownerId
  );
}

export async function putDopeCard(c) {
  if (isWeb) return webMutate(d => {
    d.dopeCards = d.dopeCards || [];
    upsertInto(d.dopeCards, c);
  });
  const d = await open();
  await d.runAsync(
    `INSERT INTO dopecards (id, name, loadId, rifleId, createdAt, optsJson, rowsJson, ownerId, updatedAt, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, loadId=excluded.loadId, rifleId=excluded.rifleId,
       optsJson=excluded.optsJson, rowsJson=excluded.rowsJson,
       ownerId=excluded.ownerId, updatedAt=excluded.updatedAt, deleted=excluded.deleted`,
    c.id, c.name ?? '', c.loadId ?? null, c.rifleId ?? null,
    c.createdAt ?? new Date().toISOString(),
    JSON.stringify(c.opts || {}), JSON.stringify(c.rows || []),
    ownerId, Date.now(), 0
  );
}

/**
 * Read one preference without loading the whole dataset.
 *
 * Theme needs this: it is settled before the data store mounts, so it cannot go
 * through readAll without either reordering the providers or flashing the wrong
 * colours while the rest of the data loads.
 */
export async function getPref(key, fallback = null) {
  try {
    if (isWeb) {
      const d = webRead();
      return d?.prefs && key in d.prefs ? d.prefs[key] : fallback;
    }
    const d = await open();
    const row = await d.getFirstAsync('SELECT value FROM prefs WHERE key = ?', key);
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch { return row.value; }
  } catch {
    return fallback;
  }
}

export async function putPref(key, value) {
  if (isWeb) return webMutate(d => { d.prefs = { ...(d.prefs || {}), [key]: value }; });
  const d = await open();
  await d.runAsync(
    `INSERT INTO prefs (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    key, JSON.stringify(value)
  );
}

/**
 * Erase everything the user recorded, keeping their preferences.
 *
 * Sets the seeded flag so the demo data does not reappear on next launch.
 */
export async function clearUserData() {
  if (isWeb) {
    return webMutate(d => {
      d.rifles = []; d.loads = []; d.sessions = [];
      d.projects = []; d.dopeCards = [];
      d.prefs = { ...(d.prefs || {}), seeded: true };
    });
  }
  const d = await open();
  for (const t of ['targets', 'sessions', 'loaddev', 'dopecards', 'loads', 'rifles']) {
    await d.runAsync(`DELETE FROM ${t}`);
  }
  await putPref('seeded', true);
}

/** Erase everything including preferences. */
export async function clearEverything() {
  if (isWeb) {
    return webMutate(d => {
      d.rifles = []; d.loads = []; d.sessions = [];
      d.projects = []; d.dopeCards = [];
      d.prefs = { seeded: true };
    });
  }
  const d = await open();
  for (const t of ['targets', 'sessions', 'loaddev', 'dopecards', 'loads', 'rifles', 'prefs']) {
    await d.runAsync(`DELETE FROM ${t}`);
  }
  await putPref('seeded', true);
}

/**
 * Replace everything on the device with a restored backup.
 *
 * Clear then write, in that order and in one call, because a restore that
 * half-applied would leave sessions pointing at rifles that no longer exist -
 * worse than either the old data or the new. The `seeded` flag is set so the
 * first-run prompt does not offer demo data on top of a restore.
 *
 * Not a merge. Reconciling two divergent copies without a synchronisation model
 * is how sessions get silently dropped, and lib/sync exists for that job.
 */
/**
 * Everything for the current owner, tombstones included, for sync.
 *
 * `readAll` hides deleted rows because no screen should show them. Sync needs
 * them: a deletion that is not pushed is a deletion that comes back on the next
 * pull from another device.
 */
export async function readAllForSync() {
  if (isWeb) {
    const d = webRead() || {};
    const own = (a) => (a || []).filter(r => (r.ownerId || 'local') === ownerId);
    return {
      rifles: own(d.rifles), loads: own(d.loads), sessions: own(d.sessions),
      projects: own(d.projects), dopeCards: own(d.dopeCards),
    };
  }
  // Written out rather than templated over a table name. Targets have no owner
  // of their own - they belong to a session and travel with it - so a loop that
  // substituted every table would have asked for a column that is not there.
  const d = await open();
  const [rifles, loads, sessions, projects, dopeCards] = await Promise.all([
    d.getAllAsync('SELECT * FROM rifles WHERE ownerId = ?', ownerId),
    d.getAllAsync('SELECT * FROM loads WHERE ownerId = ?', ownerId),
    d.getAllAsync('SELECT * FROM sessions WHERE ownerId = ?', ownerId),
    d.getAllAsync('SELECT * FROM loaddev WHERE ownerId = ?', ownerId),
    d.getAllAsync('SELECT * FROM dopecards WHERE ownerId = ?', ownerId),
  ]);
  return { rifles, loads, sessions, projects, dopeCards };
}

export async function restoreEverything(data) {
  if (isWeb) {
    webWrite({
      rifles: data.rifles || [],
      loads: data.loads || [],
      sessions: data.sessions || [],
      projects: data.projects || [],
      dopeCards: data.dopeCards || [],
      prefs: { ...(data.prefs || {}), seeded: true },
    });
    return webRead();
  }
  await clearEverything();
  for (const r of data.rifles || []) await putRifle(r);
  for (const l of data.loads || []) await putLoad(l);
  for (const sess of data.sessions || []) await putSession(sess);
  for (const pr of data.projects || []) await putProject(pr);
  for (const c of data.dopeCards || []) await putDopeCard(c);
  for (const [k, v] of Object.entries(data.prefs || {})) await putPref(k, v);
  await putPref('seeded', true);
  return await readAll();
}

export async function removeDopeCard(id) {
  if (isWeb) return webMutate(d => { d.dopeCards = (d.dopeCards || []).filter(c => c.id !== id); });
  const d = await open();
  // A tombstone, not a delete: see tombstoneIn. The row stays so the
  // change can be pushed, and every read already filters it out.
  await d.runAsync(
    `UPDATE dopecards SET deleted = 1, updatedAt = ? WHERE id = ? AND ownerId = ?`,
    Date.now(), id, ownerId
  );
}
