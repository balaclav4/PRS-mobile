/**
 * Runs every gate: syntax, database consistency, and all maths harnesses.
 *
 * Run: npm test
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const gates = [
  'scripts/check-syntax.mjs',
  'scripts/check-schema.mjs',
  // Native APIs are executed by neither the web build nor any harness, so
  // until this existed their first run was on a phone. See the file header.
  'scripts/check-native-api.mjs',
  // Runs the schema, the migrations and every statement against real SQLite.
  // The static check above catches mismatches between statements; this catches
  // mistakes inside one, which otherwise first execute on a phone at launch.
  'scripts/check-sqlite.mjs',
  // Every field a put* reads must be one sync can actually deliver. The bug
  // this exists for lost the structured half of every record on each round
  // trip and errored nowhere, because all of those columns are nullable.
  'scripts/check-roundtrip.mjs',
];

/**
 * ESLint runs first and separately because it catches a class the parser
 * cannot: an identifier with no binding. A JSX component used without being
 * imported parses perfectly and throws the moment the screen renders, which is
 * how one reached a device. Warnings do not fail the run; undefined references
 * do.
 */
function runLint() {
  const r = spawnSync('npx', ['eslint', '.', '--no-warn-ignored'], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+) error/);
  const errors = m ? Number(m[1]) : (r.status === 0 ? 0 : 1);
  if (errors > 0) {
    console.log(`✗ ${'lint'.padEnd(16)} ${errors} error(s)`);
    for (const l of out.split('\n')) if (/\serror\s/.test(l)) console.log('    ' + l.trim());
    return false;
  }
  const warn = out.match(/(\d+) warning/);
  console.log(`✓ ${'lint'.padEnd(16)} no undefined references${warn ? ` (${warn[1]} warnings)` : ''}`);
  return true;
}
const harnesses = readdirSync('scripts')
  .filter(f => /^test-.*\.mjs$/.test(f))
  .sort()
  .map(f => 'scripts/' + f);

let failed = [];

if (!runLint()) failed.push('lint');

for (const script of [...gates, ...harnesses]) {
  const r = spawnSync('node', [script], { encoding: 'utf8' });
  const lines = (r.stdout || '').trimEnd().split('\n');
  const last = lines[lines.length - 1] || '(no output)';
  const name = script.replace('scripts/', '').replace('.mjs', '');
  if (r.status !== 0) {
    failed.push(name);
    console.log(`✗ ${name.padEnd(16)} ${last}`);
    // Show what actually failed, not just the tally.
    for (const l of lines) if (l.startsWith('✗')) console.log('    ' + l);
    if (r.stderr) console.log('    ' + r.stderr.trim().split('\n')[0]);
  } else {
    console.log(`✓ ${name.padEnd(16)} ${last}`);
  }
}

console.log(failed.length === 0
  ? `\nall ${gates.length + harnesses.length + 1} checks passed`
  : `\n${failed.length} failed: ${failed.join(', ')}`);
process.exit(failed.length === 0 ? 0 : 1);
