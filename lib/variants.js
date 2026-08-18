/**
 * Load variants: the specific combinations a development test compares.
 *
 * A charge ladder is not one load, it is ten. Each rung differs from its
 * neighbours in exactly one component, and the whole point of the exercise is
 * to tell them apart statistically. The same is true of a primer test, a
 * seating ladder or a component screen.
 *
 * The rows already in each step are those variants - they carry a stable id and
 * the value being varied. What was missing was a link from a fired group back to
 * the row it belongs to, so the analysis ran on hand-typed numbers while the
 * measured sessions sat in a separate pile with no way to associate them.
 *
 * This module supplies that link and, importantly, refuses to invent it: a
 * session belongs to a row only because it was captured against that row and
 * says so. Nothing is inferred from charge weights or timestamps, because a
 * near-match is not the same as a record.
 *
 * Why not create a Load record per rung: ten rows would mean ten library
 * entries the shooter never asked for, nine of which are dead the moment the
 * test concludes. A variant is a row in a test, not a load somebody keeps.
 */

/** Which field each step varies, and how to say it. */
const STEP_DIMENSION = {
  2: { key: 'label', unit: '', noun: 'combination' },   // screening
  3: { key: 'charge', unit: 'gr', noun: 'charge' },     // pressure work-up
  4: { key: 'charge', unit: 'gr', noun: 'charge' },     // coarse accuracy
  5: { key: 'brand', unit: '', noun: 'primer' },        // primers
  6: { key: 'charge', unit: 'gr', noun: 'charge' },     // ladder
  7: { key: 'cbto', unit: '"', noun: 'seating depth' }, // seating
};

/** Rows for a step, whatever they are called in the project. */
export function rowsForStep(project, step) {
  if (!project) return [];
  switch (Number(step)) {
    case 2: return project.screenRows || [];
    case 3: return project.workupRows || [];
    case 4: return project.coarseRows || [];
    case 5: return project.primerRows || [];
    case 6: return project.rungs || [];
    case 7: return project.seatingRows || [];
    default: return [];
  }
}

export function stepDimension(step) {
  return STEP_DIMENSION[Number(step)] || null;
}

/** Human label for one variant, e.g. "41.6 gr" or "CCI 450". */
export function variantLabel(step, row) {
  const dim = stepDimension(step);
  if (!dim || !row) return '';
  const v = row[dim.key];
  if (v == null || v === '') return `(unset ${dim.noun})`;
  return dim.unit ? `${v}${dim.unit === '"' ? '"' : ' ' + dim.unit}` : String(v);
}

/**
 * The full component set a variant represents: the base load, with the one
 * thing this step varies overridden.
 *
 * Shown so the shooter can see what they are actually about to fire, rather
 * than a bare number whose meaning depends on remembering which step they are
 * in.
 */
export function variantComponents(load, step, row) {
  const dim = stepDimension(step);
  const base = {
    bullet: load?.bullet || null,
    powder: load?.powder || null,
    primer: load?.primer || null,
    brass: load?.brass || null,
    charge: load?.chargeGr ?? null,
    cbto: load?.coalOrCbto ?? null,
  };
  if (!dim || !row) return base;
  const v = row[dim.key];
  if (v === '' || v == null) return base;
  if (dim.key === 'charge') return { ...base, charge: v };
  if (dim.key === 'cbto') return { ...base, cbto: v };
  if (dim.key === 'brand') return { ...base, primer: v };
  return { ...base, label: v };
}

/** Sessions explicitly captured against one variant. */
export function sessionsForVariant(sessions, projectId, step, rowId) {
  if (!projectId || !rowId) return [];
  return (sessions || []).filter(s =>
    s.projectId === projectId &&
    Number(s.projectStep) === Number(step) &&
    s.projectRowId === rowId);
}

/**
 * Measured group sizes for a variant, in MOA, one entry per target.
 *
 * Every target is an independent group and stays one - pooling shots across
 * targets would inflate the sample and shrink p-values dishonestly, which is
 * the same unit-of-replication point the comparison screens already turn on.
 */
export function measuredGroups(sessions, projectId, step, rowId, toMoa) {
  const scoped = sessionsForVariant(sessions, projectId, step, rowId);
  const out = [];
  for (const s of scoped) {
    for (const g of toMoa(s) || []) if (isFinite(g) && g > 0) out.push(g);
  }
  return out;
}

/**
 * Chronograph velocities recorded against a variant, pooled across sessions.
 *
 * The pressure work-up and the primer comparison both turn on velocity rather
 * than group size, so they need this instead of measuredGroups. Values stay
 * individual - the primer test compares standard deviations, and handing it a
 * mean would throw away the only thing it measures.
 */
export function measuredVelocities(sessions, projectId, step, rowId) {
  const out = [];
  for (const s of sessionsForVariant(sessions, projectId, step, rowId)) {
    for (const v of s.velocities || []) {
      const n = Number(v);
      if (isFinite(n) && n > 0) out.push(n);
    }
  }
  return out;
}

/**
 * Fold measured velocities into rows that carry a velocity field.
 *
 * `velocities` is the raw string the shooter may have pasted; when sessions
 * exist their readings replace it, and the row records how many.
 */
export function reconcileVelocityRows(rows, sessions, projectId, step, {
  meanField = 'velocity', listField = null,
} = {}) {
  return (rows || []).map(row => {
    const v = measuredVelocities(sessions, projectId, step, row.id);
    if (!v.length) {
      return { ...row, source: row[meanField] || row[listField] ? 'typed' : 'empty', measuredCount: 0 };
    }
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const next = { ...row, source: 'measured', measuredCount: v.length, measuredVelocities: v };
    if (meanField) next[meanField] = String(Math.round(mean));
    if (listField) next[listField] = v.join(' ');
    return next;
  });
}

/**
 * What a step's rows look like once measured data is folded in.
 *
 * A typed value is kept when nothing has been shot against that row, because a
 * shooter working from a notebook should not be forced to re-shoot. When
 * sessions do exist they win, and `source` says which it is - a number whose
 * provenance is invisible is a number nobody can check.
 */
export function reconcileRows(rows, sessions, projectId, step, toMoa, groupField = 'groupMoa') {
  return (rows || []).map(row => {
    const measured = measuredGroups(sessions, projectId, step, row.id, toMoa);
    if (!measured.length) {
      return { ...row, source: row[groupField] ? 'typed' : 'empty', measuredCount: 0 };
    }
    const mean = measured.reduce((a, b) => a + b, 0) / measured.length;
    return {
      ...row,
      [groupField]: mean.toFixed(2),
      source: 'measured',
      measuredCount: measured.length,
      measuredGroups: measured,
    };
  });
}
