/**
 * Consistency checks for lib/db.js.
 *
 * These matter because the SQLite path is the one the web preview never
 * exercises — on web the store falls back to localStorage, so a miscounted
 * parameter list or a column added to only one of the two places would pass
 * every browser check and fail on a device.
 *
 * Two things are verified:
 *
 *   1. Every INSERT declares as many columns as it has ? placeholders, and is
 *      called with exactly that many arguments. Arguments are counted from the
 *      AST rather than by splitting on commas, which miscounts any argument
 *      containing one.
 *
 *   2. Every column in MIGRATIONS also exists in the CREATE TABLE. Adding a
 *      column to one and not the other leaves a fresh install and an upgraded
 *      install with different schemas — and the fresh one is the case a
 *      developer tests.
 *
 * Run: node scripts/check-schema.mjs
 */
import { parse } from '@babel/parser';
import { readFileSync } from 'node:fs';

const FILE = 'lib/db.js';
const src = readFileSync(FILE, 'utf8');
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });

let bad = 0;
const fail = (msg) => { bad++; console.log('✗ ' + msg); };

// --- 1. INSERT arity -------------------------------------------------------
const calls = [];
(function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach(walk);
  if (node.type === 'CallExpression' &&
      node.callee?.type === 'MemberExpression' &&
      node.callee.property?.name === 'runAsync') {
    calls.push(node);
  }
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments') continue;
    walk(node[k]);
  }
})(ast.program);

let inserts = 0;
for (const call of calls) {
  const first = call.arguments[0];
  const sql = first?.type === 'TemplateLiteral'
    ? first.quasis.map(q => q.value.cooked).join('')
    : first?.type === 'StringLiteral' ? first.value : null;
  if (!sql || !/INSERT INTO/i.test(sql)) continue;
  inserts++;

  const m = sql.match(/INSERT INTO (\w+)\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)/i);
  if (!m) { fail(`could not parse an INSERT near line ${call.loc.start.line}`); continue; }
  const [, table, colBlob, qBlob] = m;
  const cols = colBlob.split(',').map(s => s.trim()).filter(Boolean);
  const qs = qBlob.split(',').map(s => s.trim()).filter(Boolean);
  const args = call.arguments.length - 1;

  if (cols.length !== qs.length || qs.length !== args) {
    fail(`${table} (line ${call.loc.start.line}): ${cols.length} columns, ${qs.length} placeholders, ${args} arguments`);
  } else {
    console.log(`✓ ${table.padEnd(11)} ${cols.length} columns, placeholders and arguments agree`);
  }
}
if (inserts === 0) fail('found no INSERT statements — did db.js move?');

// --- 2. fresh schema vs migrations ----------------------------------------
const created = {};
for (const m of src.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)) {
  created[m[1]] = m[2]
    // Strip -- comments first. Splitting the raw body on commas turned a
    // comment line into a phantom column named "--" and swallowed the real
    // column declared after it, which reported priorRounds and powderLot as
    // missing when both were present.
    .replace(/--[^\n]*/g, '')
    .split(',')
    .map(s => s.trim().split(/\s+/)[0])
    .filter(c => c && !/^(PRIMARY|FOREIGN|UNIQUE|CHECK)$/i.test(c));
}
const migBlock = src.match(/const MIGRATIONS = \[([\s\S]*?)\n\];/);
if (!migBlock) fail('could not find MIGRATIONS');
else {
  let checked = 0;
  for (const m of migBlock[1].matchAll(/\['(\w+)',\s*'(\w+)'/g)) {
    const [, table, col] = m;
    checked++;
    if (!created[table]) fail(`MIGRATIONS names table ${table}, which has no CREATE TABLE`);
    else if (!created[table].includes(col)) {
      fail(`${table}.${col} is in MIGRATIONS but missing from CREATE TABLE — a fresh install would not have it`);
    }
  }
  if (!bad) console.log(`✓ ${checked} migrated columns all present in CREATE TABLE`);
}

console.log(bad === 0 ? '\ndb.js is consistent' : `\n${bad} problem(s)`);
process.exit(bad === 0 ? 0 : 1);
