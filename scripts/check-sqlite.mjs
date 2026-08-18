/**
 * Runs the app's SQL against a real SQLite, because a device is otherwise the
 * first place it executes.
 *
 * `scripts/check-schema.mjs` reads the SQL statically - parameter counts,
 * columns present in both CREATE and MIGRATIONS. That catches a mismatch but
 * not a mistake *inside* a statement: a misspelled column, a trailing comma, a
 * type SQLite rejects. Those parse fine as JavaScript strings and fail at
 * `execAsync` on launch, which on a phone reads as "the app is broken" with no
 * further detail.
 *
 * Node ships SQLite now, so the same statements can simply be run here. Three
 * things are proved:
 *
 *   1. The schema executes on an empty database.
 *   2. The migrations apply to an *old* install - one created without the newer
 *      columns - and leave it with the same shape as a fresh one. Divergence
 *      here is the bug a developer never sees, because they always test the
 *      fresh case.
 *   3. Every statement in lib/db.js prepares and binds. A statement that only
 *      runs on a rarely-taken path is checked identically to one that runs at
 *      launch.
 *
 * Run: node scripts/check-sqlite.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';

const FILE = 'lib/db.js';
const src = readFileSync(FILE, 'utf8');
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(58) + detail);
};

// ---------------------------------------------------------------- extraction

/** The value of a top-level `const NAME = ...` declaration. */
function declarator(name) {
  for (const node of ast.program.body) {
    const d = node.type === 'VariableDeclaration' ? node
      : node.type === 'ExportNamedDeclaration' ? node.declaration : null;
    if (d?.type !== 'VariableDeclaration') continue;
    for (const decl of d.declarations) if (decl.id.name === name) return decl.init;
  }
  return null;
}

const schemaNode = declarator('SCHEMA');
const SCHEMA = schemaNode?.type === 'TemplateLiteral' ? schemaNode.quasis.map(q => q.value.cooked).join('') : null;

const migNode = declarator('MIGRATIONS');
const MIGRATIONS = migNode?.elements?.map(el => el.elements.map(e => e.value)) ?? null;

check('lib/db.js exposes a schema and a migration list',
  !!SCHEMA && Array.isArray(MIGRATIONS), `${MIGRATIONS?.length ?? 0} migrations`);
if (!SCHEMA || !MIGRATIONS) process.exit(1);

/**
 * Every SQL string handed to a database method, with its call site.
 *
 * Template literals are flattened with a placeholder for each interpolation.
 * The only interpolations in this file are table names in PRAGMA/DELETE, so a
 * neutral identifier keeps the statement parseable.
 */
function sqlStatements() {
  const out = [];
  const METHODS = new Set(['execAsync', 'runAsync', 'getAllAsync', 'getFirstAsync', 'getEachAsync']);
  const walk = (node, parent) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) walk(n, parent); return; }
    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression'
        && METHODS.has(node.callee.property?.name)) {
      const arg = node.arguments[0];
      let sql = null;
      if (arg?.type === 'StringLiteral') sql = arg.value;
      else if (arg?.type === 'TemplateLiteral') {
        sql = arg.quasis.map(q => q.value.cooked).join('__ident__');
      }
      if (sql) out.push({ sql, method: node.callee.property.name, line: node.loc.start.line });
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments') continue;
      walk(node[k], node);
    }
  };
  walk(ast.program.body, null);
  return out;
}

// ------------------------------------------------------------------- 1. fresh

console.log('\nthe schema, on an empty database');
const fresh = new DatabaseSync(':memory:');
try {
  fresh.exec(SCHEMA);
  check('  executes', true);
} catch (e) {
  check('  executes', false, e.message);
  process.exit(1);
}

const tablesOf = (db) => db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all().map(r => r.name);

const columnsOf = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all()
  .map(c => c.name).sort();

const freshTables = tablesOf(fresh);
check('  creates the expected tables', freshTables.length > 0, freshTables.join(', '));

// Every migrated column must already be present in a fresh install, or the two
// installs diverge. check-schema.mjs asserts this textually; this asserts it
// against what SQLite actually built.
for (const [table, column] of MIGRATIONS) {
  const cols = columnsOf(fresh, table);
  if (!cols.includes(column)) {
    check(`  fresh install has ${table}.${column}`, false, 'in MIGRATIONS but not in CREATE TABLE');
  }
}
check('  every migrated column exists in a fresh install',
  MIGRATIONS.every(([t, c]) => columnsOf(fresh, t).includes(c)),
  `${MIGRATIONS.length} checked`);

// --------------------------------------------------------------- 2. upgrading

console.log('\nthe migrations, on an install that predates them');
{
  // Rebuild the schema with every migrated column stripped out, which is what
  // an older install actually looks like.
  let old = SCHEMA;
  for (const [, column, type] of MIGRATIONS) {
    // Match the column wherever it sits in the CREATE TABLE body.
    old = old
      .replace(new RegExp(`(,\\s*)${column}\\s+${type}\\b`, 'gi'), '')
      .replace(new RegExp(`\\b${column}\\s+${type}\\s*,\\s*`, 'gi'), '');
  }

  const aged = new DatabaseSync(':memory:');
  let built = true;
  try { aged.exec(old); } catch (e) { built = false; check('  an older schema builds', false, e.message); }

  if (built) {
    const missing = MIGRATIONS.filter(([t, c]) => !columnsOf(aged, t).includes(c));
    check('  the older schema really is missing them', missing.length > 0,
      `${missing.length} of ${MIGRATIONS.length} absent before migrating`);

    // The same loop lib/db.js runs.
    let ok = true;
    for (const [table, column, type] of MIGRATIONS) {
      const cols = aged.prepare(`PRAGMA table_info(${table})`).all();
      if (!cols.some(c => c.name === column)) {
        try { aged.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); }
        catch (e) { ok = false; check(`  ALTER ${table}.${column}`, false, e.message); }
      }
    }
    check('  every ALTER applies', ok);

    // The point of the exercise: both installs end up identical.
    let converged = true;
    for (const t of freshTables) {
      const a = columnsOf(fresh, t).join(','), b = columnsOf(aged, t).join(',');
      if (a !== b) {
        converged = false;
        check(`  ${t} converges`, false, `fresh has [${a}], upgraded has [${b}]`);
      }
    }
    check('  an upgraded install matches a fresh one', converged,
      'the divergence a developer never sees, because they test the fresh case');

    // And migrating twice is harmless, which is what every later launch does.
    let idempotent = true;
    try {
      for (const [table, column, type] of MIGRATIONS) {
        const cols = aged.prepare(`PRAGMA table_info(${table})`).all();
        if (!cols.some(c => c.name === column)) aged.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      }
    } catch { idempotent = false; }
    check('  migrating again is a no-op', idempotent, 'every launch after the first runs this');
  }
}

// ------------------------------------------------------------- 3. statements

console.log('\nevery statement in lib/db.js');
{
  const stmts = sqlStatements();
  check('  found some to check', stmts.length > 0, `${stmts.length} statements`);

  let prepared = 0;
  for (const { sql, method, line } of stmts) {
    // Statements built around an interpolated table name are exercised against
    // a real table rather than skipped.
    const candidates = sql.includes('__ident__')
      ? freshTables.map(t => sql.split('__ident__').join(t))
      : [sql];

    for (const text of candidates) {
      // execAsync may carry several statements; prepare() takes one at a time.
      const parts = method === 'execAsync'
        ? text.split(';').map(s => s.trim()).filter(Boolean)
        : [text];
      for (const part of parts) {
        try {
          fresh.prepare(part);
          prepared++;
        } catch (e) {
          check(`  ${FILE}:${line} ${part.slice(0, 44).replace(/\s+/g, ' ')}`, false, e.message);
        }
      }
    }
  }
  check('  all prepare against the real schema', true, `${prepared} prepared`);
}

// ------------------------------------------------------- 4. ownership

console.log('\nownership is a boundary, not a label');
{
  const q = (sql, ...a) => fresh.prepare(sql).all(...a);
  const run = (sql, ...a) => fresh.prepare(sql).run(...a);

  run(`INSERT INTO rifles (id, name, ownerId, updatedAt, deleted) VALUES (?, ?, ?, ?, 0)`,
    'r-a', 'A rifle', 'uid-a', Date.now());
  run(`INSERT INTO rifles (id, name, ownerId, updatedAt, deleted) VALUES (?, ?, ?, ?, 0)`,
    'r-b', 'B rifle', 'uid-b', Date.now());
  run(`INSERT INTO rifles (id, name, ownerId, updatedAt, deleted) VALUES (?, ?, ?, ?, 0)`,
    'r-l', 'Local rifle', 'local', Date.now());

  const forOwner = (o) =>
    q('SELECT * FROM rifles WHERE ownerId = ? AND COALESCE(deleted,0) = 0', o);

  check('  one account cannot see another\'s', forOwner('uid-a').length === 1
    && forOwner('uid-a')[0].id === 'r-a',
    'two people on one phone was the failure this closes');
  check('  and neither sees the signed-out data', forOwner('uid-b').length === 1);
  check('  signed out sees only its own', forOwner('local').length === 1);

  // A tombstone hides the row from every read but leaves it to be pushed.
  run('UPDATE rifles SET deleted = 1, updatedAt = ? WHERE id = ?', Date.now(), 'r-a');
  check('  a deleted record disappears from reads', forOwner('uid-a').length === 0);
  check('  but is still there to be synced',
    q('SELECT * FROM rifles WHERE ownerId = ?', 'uid-a').length === 1,
    'dropping the row means the next pull restores it');

  // Existing installs, which have no ownerId written, must land somewhere
  // readable rather than vanishing.
  const aged = new DatabaseSync(':memory:');
  aged.exec(SCHEMA.replace(/ownerId TEXT NOT NULL DEFAULT 'local',?/g, ''));
  aged.prepare('INSERT INTO rifles (id, name) VALUES (?, ?)').run('old', 'Pre-accounts');
  for (const [t, c, ty] of MIGRATIONS) {
    const cols = aged.prepare(`PRAGMA table_info(${t})`).all();
    if (!cols.some(x => x.name === c)) aged.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${ty}`);
  }
  const migrated = aged.prepare("SELECT * FROM rifles WHERE ownerId = 'local'").all();
  check('  an install from before accounts becomes local, not invisible',
    migrated.length === 1,
    'their data must still be there when they open the update');
}

console.log('\n' + (fails === 0
  ? 'the schema, the migrations and every statement run against real SQLite'
  : `${fails} SQLite check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
