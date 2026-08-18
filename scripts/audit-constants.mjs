/**
 * Every number in the maths, and whether anything explains it.
 *
 * A constant with no stated origin is the most dangerous thing in this codebase.
 * It looks authoritative, it survives review because it is only a number, and
 * when it is wrong nothing fails - the app simply reports a slightly incorrect
 * answer forever. This walks the library and reports each numeric literal with
 * the comment attached to it, so every one can be checked against a source, a
 * derivation, or a measurement.
 *
 * Not a pass/fail gate. It is a worksheet: the output is meant to be read.
 *
 * Run: node scripts/audit-constants.mjs [--unexplained]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Plumbing rather than maths: no physical constants to justify.
const SKIP = new Set([
  'db.js', 'theme.js', 'haptics.js', 'export.js', 'firebase.js', 'photo.js',
  'accountdelete.js', 'consent.js', 'profile.js', 'sync.js', 'undo.js',
  'variants.js', 'calibers.js',
]);

// Numbers that carry no claim about the world.
const STRUCTURAL = new Set([
  '0', '1', '2', '-1', '0.5', '100', '1000', '10', '3', '4', '60', '360', '180',
  '1e-9', '1e-6', '1e-12', '255', '2.5', '1.5',
]);

const files = readdirSync('lib').filter(f => f.endsWith('.js') && !SKIP.has(f));
const onlyUnexplained = process.argv.includes('--unexplained');

let total = 0, explained = 0;
const rows = [];

for (const f of files) {
  const src = readFileSync(join('lib', f), 'utf8');
  const lines = src.split('\n');

  lines.forEach((line, i) => {
    // Skip comment lines themselves.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const nums = line.match(/(?<![\w.])\d+\.\d+(e-?\d+)?|(?<![\w.])\d{2,}(?![\w.])/g);
    if (!nums) return;

    for (const n of nums) {
      if (STRUCTURAL.has(n)) continue;
      total++;

      // Is there prose within the preceding 14 lines, or trailing on this one?
      let ctx = '';
      for (let k = Math.max(0, i - 14); k < i; k++) {
        if (/^\s*(\/\/|\*)/.test(lines[k])) ctx += ' ' + lines[k].replace(/^\s*(\/\/|\*)\s?/, '');
      }
      const trailing = line.match(/\/\/(.*)$/);
      if (trailing) ctx += ' ' + trailing[1];

      // Does that prose actually account for a number, rather than merely
      // being nearby? Look for the number itself, or language of provenance.
      const named = new RegExp(
        n.replace('.', '\\.') + '|' +
        'measured|simulat|derived|published|standard|closed form|per |from the|' +
        'because|so that|chosen|fitted|Miller|Litz|McCoy|Clopper|Wilson|Welch|' +
        'Rayleigh|Blom|Acklam|Kasa|ISA|Rec\\. 709|sqrt',
        'i'
      ).test(ctx);

      if (named) explained++;
      if (!named || !onlyUnexplained) {
        rows.push({ f, line: i + 1, n, ok: named, code: line.trim().slice(0, 66) });
      }
    }
  });
}

const shown = onlyUnexplained ? rows.filter(r => !r.ok) : rows;
let current = '';
for (const r of shown) {
  if (r.f !== current) { current = r.f; console.log('\n' + r.f); }
  console.log(`  ${r.ok ? '·' : '?'} ${String(r.line).padStart(4)}  ${String(r.n).padEnd(9)} ${r.code}`);
}

console.log(`\n${explained}/${total} numeric constants have provenance in nearby prose`);
console.log(`${total - explained} to check\n`);
