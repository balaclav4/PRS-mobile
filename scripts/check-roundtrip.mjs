/**
 * Every field a put* reads must be a field sync can actually deliver.
 *
 * This exists because of a bug that lost data silently for as long as sync ran.
 * `readAllForSync` returned raw SQLite rows, so a rifle went to the server
 * carrying `torqueJson` as a string. On the way back `putRifle` looked for
 * `r.torque`, found nothing, and wrote NULL. Scope evaluations, zero baselines,
 * torque records, chronograph velocities, every load-development row and every
 * saved dope card were dropped on each round trip - and nothing errored, because
 * every one of those fields is nullable.
 *
 * The static shape of it is what makes it checkable. A put* reads properties off
 * its record; sync hands it whatever `readAllForSync` produced, which is table
 * columns plus whatever the hydrators add. If a put* reads a name that is in
 * neither set, that field cannot survive a sync, and it will fail quietly.
 *
 * Run: node scripts/check-roundtrip.mjs
 */
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';

const FILE = 'lib/db.js';
const src = readFileSync(FILE, 'utf8');
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(56) + detail);
};

// Which put* writes which table, and which hydrator sync uses to build its input.
const ENTITIES = [
  { put: 'putRifle',    table: 'rifles',    hydrator: 'hydrateRifle' },
  { put: 'putLoad',     table: 'loads',     hydrator: null },
  { put: 'putSession',  table: 'sessions',  hydrator: 'hydrateSession' },
  { put: 'putProject',  table: 'loaddev',   hydrator: 'hydrateProject' },
  { put: 'putDopeCard', table: 'dopecards', hydrator: 'hydrateDopeCard' },
];

// ------------------------------------------------------------------ columns
const schema = src.match(/const SCHEMA = `([\s\S]*?)`;/)?.[1] ?? '';
function columnsOf(table) {
  const body = schema.match(
    new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`))?.[1] ?? '';
  const cols = new Set();
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('--')) continue;
    for (const part of line.split(',')) {
      const m = part.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s+[A-Za-z]/);
      if (m) cols.add(m[1]);
    }
  }
  return cols;
}

// --------------------------------------------------------------- AST helpers
function walk(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, fn); return; }
  if (node.type) fn(node);
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments') continue;
    walk(node[k], fn);
  }
}

function findFn(name) {
  let found = null;
  walk(ast, (n) => {
    if (found) return;
    if (n.type === 'FunctionDeclaration' && n.id?.name === name) found = n;
    if (n.type === 'VariableDeclarator' && n.id?.name === name &&
        (n.init?.type === 'ArrowFunctionExpression' || n.init?.type === 'FunctionExpression')) {
      found = n.init;
    }
  });
  return found;
}

/** Property names read off the function's first parameter. */
function propsReadOffParam(fn) {
  const param = fn?.params?.[0];
  const name = param?.type === 'Identifier' ? param.name : null;
  const out = new Set();
  if (!name) return out;
  walk(fn.body, (n) => {
    if (n.type === 'MemberExpression' && !n.computed &&
        n.object?.type === 'Identifier' && n.object.name === name &&
        n.property?.type === 'Identifier') {
      out.add(n.property.name);
    }
    // s.targets?.length and the like arrive as OptionalMemberExpression.
    if (n.type === 'OptionalMemberExpression' && !n.computed &&
        n.object?.type === 'Identifier' && n.object.name === name &&
        n.property?.type === 'Identifier') {
      out.add(n.property.name);
    }
  });
  return out;
}

/** Keys an object-returning hydrator adds on top of the spread row. */
function keysAddedBy(name) {
  const fn = findFn(name);
  const out = new Set();
  if (!fn) return out;
  walk(fn.body ?? fn, (n) => {
    if (n.type === 'ObjectProperty' && !n.computed && n.key?.type === 'Identifier') {
      out.add(n.key.name);
    }
  });
  return out;
}

console.log('every field a put* reads can survive a sync round trip\n');

for (const { put, table, hydrator } of ENTITIES) {
  const fn = findFn(put);
  if (!fn) { check(`  ${put} found`, false); continue; }

  const cols = columnsOf(table);
  const added = hydrator ? keysAddedBy(hydrator) : new Set();
  const read = propsReadOffParam(fn);

  const missing = [...read].filter(p => !cols.has(p) && !added.has(p));
  check(`  ${put} reads only what sync delivers`,
    missing.length === 0,
    missing.length ? `orphaned: ${missing.join(', ')}` : `${read.size} fields`);
}

// The specific regression, named, so a future refactor cannot quietly undo it
// by dropping the hydrators back out of readAllForSync.
{
  const fn = findFn('readAllForSync');
  const body = fn ? src.slice(fn.start, fn.end) : '';
  check('  readAllForSync hydrates rather than returning raw rows',
    /hydrateRifle/.test(body) && /hydrateSession/.test(body) &&
    /hydrateProject/.test(body) && /hydrateDopeCard/.test(body));
  check('  and fetches targets, so a pushed session carries its shots',
    /FROM targets/.test(body));
}

console.log(fails ? `\n✗ ${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
