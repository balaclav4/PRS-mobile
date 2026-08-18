/**
 * Torque figures the shooter records for their own rifle.
 *
 * The app ships no default values, and that is a deliberate refusal rather than
 * an omission. Over-torquing a scope ring crushes a tube; under-torquing an
 * action screw moves the zero between strings and looks exactly like bad
 * ammunition. The correct figure comes from the manufacturer of that specific
 * part, and no generic number is safe enough to put in front of someone holding
 * a wrench.
 *
 * This replaces two figures that were printed in the scope checklist as
 * "typically 15-18 in-lb" and "typically 25-30 in-lb". They were hedged, and
 * the screen did say to use the manufacturer's numbers, but a printed range is
 * still the number people will reach for. Now the checklist shows what the
 * shooter recorded for that rifle, or asks them to record it.
 *
 * Recording it has a second use beyond the wrench. A torque that has been
 * changed is a change to the rifle, and it belongs in the same history as a
 * barrel swap: if groups open up the week after the action screws were redone,
 * that is worth being able to see.
 */

/**
 * Exact by definition: one pound-force inch is 0.112984829... newton metres,
 * from the pound-force and the inch, both of which are defined exactly.
 */
const NM_PER_IN_LB = 0.1129848290276167;

export const TORQUE_UNITS = ['in-lb', 'Nm'];

/** The fasteners worth recording, offered as a starting point. */
export const COMMON_FASTENERS = [
  'Action screws',
  'Scope ring caps',
  'Scope base / rail',
  'Muzzle device',
  'Barrel nut',
  'Bipod mount',
];

export const toNm = (v) => (isFinite(v) ? v * NM_PER_IN_LB : null);
export const toInLb = (v) => (isFinite(v) ? v / NM_PER_IN_LB : null);

/** Convert between the two units the app offers. */
export function convert(value, from, to) {
  const v = Number(value);
  if (!isFinite(v)) return null;
  if (from === to) return v;
  return from === 'in-lb' ? toNm(v) : toInLb(v);
}

/**
 * Is this a figure worth storing?
 *
 * The bounds are deliberately wide. This is not the app second-guessing a
 * manufacturer, it is catching a slipped decimal or a value typed into the
 * wrong unit: 65 in-lb on a scope ring is a crushed tube, and 0.5 is a screw
 * that will not stay put, but which of those applies to a given fastener is not
 * something the app knows. So it warns and still stores.
 */
export function checkTorque(value, unit) {
  const v = Number(value);
  if (value === '' || value == null) return { ok: false, level: 'empty', text: null };
  if (!isFinite(v) || v <= 0) {
    return { ok: false, level: 'invalid', text: 'Enter a positive number.' };
  }

  const inLb = unit === 'Nm' ? toInLb(v) : v;
  if (inLb > 120) {
    return {
      ok: true, level: 'high',
      text: `${fmt(v, unit)} is high for anything on a rifle scope or action. Worth checking the figure and the unit before you reach for the wrench.`,
    };
  }
  if (inLb < 5) {
    return {
      ok: true, level: 'low',
      text: `${fmt(v, unit)} is low for a fastener. Check whether the figure was meant in the other unit.`,
    };
  }
  return { ok: true, level: 'ok', text: null };
}

/** A torque, written the way a wrench is labelled. */
export function fmt(value, unit) {
  // Empty is not zero. Number('') is 0 and passes isFinite, so an unset
  // fastener printed as "0 in-lb" - a figure, next to a wrench.
  if (value === '' || value == null) return '—';
  const v = Number(value);
  if (!isFinite(v)) return '—';
  // in-lb wrenches are graduated in whole or half units; Nm in tenths.
  return unit === 'Nm' ? `${v.toFixed(1)} Nm` : `${(Math.round(v * 2) / 2)} in-lb`;
}

/** The same figure in both units, for a shooter whose wrench is the other one. */
export function fmtBoth(value, unit) {
  const other = unit === 'Nm' ? 'in-lb' : 'Nm';
  const converted = convert(value, unit, other);
  if (converted == null) return fmt(value, unit);
  return `${fmt(value, unit)} (${fmt(converted, other)})`;
}

/** A new, empty entry. */
export function newEntry(name = '') {
  return { id: 't' + Date.now() + Math.random().toString(36).slice(2, 6), name, value: '', unit: 'in-lb', note: '' };
}

/**
 * Entries worth keeping, in the order given.
 *
 * An entry with a name but no figure is kept: it is a reminder that this
 * fastener has a spec nobody has looked up yet, which is more useful than
 * silently dropping it.
 */
export function cleanEntries(entries) {
  return (entries || [])
    .filter(e => e && (String(e.name).trim() || String(e.value).trim()))
    .map(e => ({
      id: e.id || newEntry().id,
      name: String(e.name || '').trim(),
      value: String(e.value ?? '').trim(),
      unit: TORQUE_UNITS.includes(e.unit) ? e.unit : 'in-lb',
      note: String(e.note || '').trim(),
    }));
}

/** How many are recorded against how many are named but unset. */
export function summarise(entries) {
  const clean = cleanEntries(entries);
  const set = clean.filter(e => isFinite(Number(e.value)) && Number(e.value) > 0);
  return { total: clean.length, set: set.length, missing: clean.length - set.length };
}

/** One fastener's recorded figure, by name, or null. */
export function findByName(entries, name) {
  const want = String(name || '').toLowerCase();
  return cleanEntries(entries).find(e => e.name.toLowerCase() === want) || null;
}
