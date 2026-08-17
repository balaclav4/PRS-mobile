/**
 * A backup that is actually a backup.
 *
 * The CSV export was described as one and is not. It carries a summary row per
 * session - name, date, best group, mean radius - and none of the shots, aim
 * points, target corners or scale references. Restoring from it would give you
 * a list of numbers with nothing behind them, and every group would have to be
 * measured again from photographs that were never stored either. A shooter who
 * lost their phone and reached for that file would find out at the worst
 * moment.
 *
 * This carries everything the app holds, in one JSON file the shooter keeps.
 *
 * Restoring is where the care goes. Reading a backup means replacing what is
 * on the device, so the failure mode is destroying good data with a bad file.
 * Every check below exists to refuse rather than to half-succeed:
 *
 *  - the file must say it is one of ours, and say what version it is;
 *  - a version from the future is refused, because this code cannot know what
 *    the fields meant;
 *  - the shape is checked before anything is returned, so a truncated download
 *    or the wrong file entirely cannot be partially applied;
 *  - the caller is told what it contains before it is written, so the person
 *    pressing the button knows what they are about to overwrite.
 *
 * There is no merge. Merging two divergent copies of a dataset without a
 * synchronisation model is how people silently lose sessions, and this app has
 * a sync engine for that job. A restore replaces.
 */

export const BACKUP_FORMAT = 'on-paper-backup';

/**
 * Format strings from before the app was renamed.
 *
 * Read, never written. The check below compared for equality, so changing the
 * constant on its own would have made every backup written under the old name
 * fail with "that is not a backup" - a total loss of the restore path, and the
 * least recoverable moment to discover it is when somebody needs the restore.
 */
export const LEGACY_BACKUP_FORMATS = ['prs-precision-backup'];

export const BACKUP_VERSION = 1;

/** Collections carried, in the order they are reported. */
const COLLECTIONS = ['rifles', 'loads', 'sessions', 'projects', 'dopeCards'];

/**
 * Everything, as a JSON string.
 *
 * Pretty-printed on purpose. A backup a shooter can open and read is one they
 * can check, and can salvage by hand if this code ever refuses to load it.
 */
export function buildBackup(data = {}, meta = {}) {
  const payload = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    app: meta.appVersion || null,
    counts: Object.fromEntries(COLLECTIONS.map(k => [k, (data[k] || []).length])),
  };
  for (const k of COLLECTIONS) payload[k] = data[k] || [];
  payload.prefs = data.prefs || {};
  return JSON.stringify(payload, null, 2);
}

/**
 * Is this the CSV this app exports?
 *
 * Matched on the header rather than on "contains a comma", which every prose
 * file does. Anything else unparseable gets the generic message; guessing
 * wrongly about what a file is would be worse than not guessing.
 */
function looksLikeSessionCsv(raw) {
  const first = raw.split(/\r?\n/, 1)[0] || '';
  if (raw.trim().startsWith('{') || raw.trim().startsWith('[')) return false;
  const cols = first.split(',');
  if (cols.length < 3) return false;
  const header = first.toLowerCase();
  return header.includes('name') && (header.includes('date') || header.includes('rifle'));
}

/**
 * Read a backup, or explain why not.
 *
 * Returns `{ ok, data, counts, createdAt }` or `{ ok: false, reason }`. Never
 * throws: this is called on a file a human chose from a picker, and the wrong
 * file is an ordinary outcome rather than an exceptional one.
 */
export function readBackup(text) {
  const raw = String(text ?? '');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A session CSV is the wrong file somebody will actually pick, because it
    // is the other thing this app produces and it sits next to the backup in
    // the same folder. It is not valid JSON, so without this it fails with a
    // message about syntax at the exact moment the shooter is trying to
    // recover a season of data. Named specifically instead.
    if (looksLikeSessionCsv(raw)) {
      return {
        ok: false,
        reason: 'That is a session CSV. It is an export, not a backup — it carries a summary row per session and none of the shots, aim points or scale, so nothing could be restored from it.',
      };
    }
    return { ok: false, reason: 'That file is not readable as a backup — it is not valid JSON.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'That file does not contain a backup.' };
  }
  if (parsed.format !== BACKUP_FORMAT && !LEGACY_BACKUP_FORMATS.includes(parsed.format)) {
    return {
      ok: false,
      reason: 'That is not an On Paper backup. A session CSV is an export, not a backup — it carries no shots or scale.',
    };
  }
  const v = Number(parsed.version);
  if (!Number.isInteger(v) || v < 1) {
    return { ok: false, reason: 'That backup does not say which version it is, so it cannot be read safely.' };
  }
  if (v > BACKUP_VERSION) {
    return {
      ok: false,
      reason: `That backup was written by a newer version of the app (format ${v}, this build reads ${BACKUP_VERSION}). Update, then restore.`,
    };
  }

  // Shape, before anything is handed back. A file that parses and is missing
  // half its collections would otherwise restore as a silent partial wipe.
  const data = {};
  for (const k of COLLECTIONS) {
    const list = parsed[k];
    if (list != null && !Array.isArray(list)) {
      return { ok: false, reason: `That backup is damaged: "${k}" is not a list.` };
    }
    data[k] = list || [];
  }
  if (parsed.prefs != null && (typeof parsed.prefs !== 'object' || Array.isArray(parsed.prefs))) {
    return { ok: false, reason: 'That backup is damaged: its settings are not readable.' };
  }
  data.prefs = parsed.prefs || {};

  // Every record needs an id, or restoring produces rows nothing can reference
  // and sessions that point at rifles which do not exist.
  for (const k of COLLECTIONS) {
    const bad = data[k].findIndex(row => !row || typeof row !== 'object' || !row.id);
    if (bad >= 0) {
      return { ok: false, reason: `That backup is damaged: ${k} entry ${bad + 1} has no id.` };
    }
  }

  return {
    ok: true,
    data,
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : null,
    app: parsed.app || null,
    counts: Object.fromEntries(COLLECTIONS.map(k => [k, data[k].length])),
  };
}

/**
 * A one-line description of what a restore would do, for the confirmation.
 *
 * Both sides, deliberately. "Restore 12 sessions" is only half the sentence a
 * shooter needs; the half that matters is what is about to be replaced.
 */
export function describeRestore(counts, current = {}) {
  const parts = [];
  for (const k of COLLECTIONS) {
    const n = counts?.[k] ?? 0;
    if (n) parts.push(`${n} ${k === 'dopeCards' ? 'dope cards' : k}`);
  }
  const incoming = parts.length ? parts.join(', ') : 'nothing';
  const have = COLLECTIONS.reduce((a, k) => a + (current[k]?.length || 0), 0);
  return have > 0
    ? `Restoring brings in ${incoming}, and replaces the ${have} record${have === 1 ? '' : 's'} on this device.`
    : `Restoring brings in ${incoming}. There is nothing on this device to replace.`;
}
