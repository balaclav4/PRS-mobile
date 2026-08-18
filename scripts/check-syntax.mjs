/**
 * Syntax gate for every source file.
 *
 * Exists because `node --check` silently does nothing. Node detects ESM syntax
 * and reparses, and in that path the check is skipped entirely — a file
 * containing `const x = <div/>;`, a duplicate `const`, and a literal
 * `function ((( {` all exit 0. Every check run against the JSX screens this
 * session was therefore worthless, and a duplicate declaration introduced by a
 * careless rename passed straight through it.
 *
 * @babel/parser is already a dependency and understands the JSX these files
 * actually contain.
 *
 * Run: node scripts/check-syntax.mjs
 */
import { parse } from '@babel/parser';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['app', 'components', 'lib', 'store', 'scripts'];
const SKIP = new Set(['node_modules', '.git', '.expo', 'dist']);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|jsx|mjs)$/.test(e)) out.push(p);
  }
  return out;
}

/**
 * Same-scope temporal dead zone.
 *
 * `const a = f(b); const b = 1;` inside one function body is valid syntax and
 * throws ReferenceError the moment that function runs. It has happened twice
 * here, both times by inserting a derived value above the thing it derives
 * from.
 *
 * ESLint's no-use-before-define would catch it, but with `variables: true` it
 * also flags every `const s = StyleSheet.create({...})` at the foot of a file
 * that JSX above refers to - 916 of those, all harmless, because the function
 * runs long after the module finishes evaluating. The distinction that matters
 * is whether the reference and the declaration share a scope, so this checks
 * exactly that and nothing else.
 */
function findTdz(ast) {
  const problems = [];

  const scan = (body, label) => {
    // Declaration order within this block only.
    const declaredAt = new Map();
    body.forEach((node, i) => {
      if (node.type !== 'VariableDeclaration' || node.kind === 'var') return;
      for (const d of node.declarations) {
        if (d.id?.type === 'Identifier') declaredAt.set(d.id.name, i);
      }
    });
    if (!declaredAt.size) return;

    body.forEach((node, i) => {
      if (node.type !== 'VariableDeclaration' || node.kind === 'var') return;
      for (const d of node.declarations) {
        if (!d.init) continue;
        // Identifiers this initialiser reads, excluding ones inside nested
        // functions - those run later and are not a dead-zone reference.
        const seen = [];
        (function walkInit(n, inFn) {
          if (!n || typeof n !== 'object') return;
          if (Array.isArray(n)) return n.forEach(x => walkInit(x, inFn));
          const isFn = /FunctionExpression|ArrowFunctionExpression|FunctionDeclaration/.test(n.type);
          if (n.type === 'Identifier' && !inFn) seen.push(n.name);
          for (const k of Object.keys(n)) {
            if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments') continue;
            // Property keys and member accessors are not references.
            // Optional chaining is a different node type: `project?.rungs` has
            // property `rungs`, which is not a reference to a variable.
            if (/^Optional(MemberExpression)$|^MemberExpression$/.test(n.type)
                && k === 'property' && !n.computed) continue;
            // Babel names these ObjectProperty / ObjectMethod, not Property.
            if (/^(Object|Class)(Property|Method)$/.test(n.type) && k === 'key' && !n.computed) continue;
            if (n.type === 'JSXAttribute' && k === 'name') continue;
            walkInit(n[k], inFn || isFn);
          }
        })(d.init, false);

        for (const name of seen) {
          const at = declaredAt.get(name);
          if (at != null && at > i) {
            problems.push(`${label}: '${name}' is used on line ${d.loc.start.line} but declared below it`);
          }
        }
      }
    });
  };

  (function walk(node, label) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(n => walk(n, label));
    const named = node.id?.name || node.key?.name;
    const here = named || label;
    if (node.type === 'BlockStatement' || node.type === 'Program') scan(node.body, here);
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments') continue;
      walk(node[k], here);
    }
  })(ast.program, '(top level)');

  return problems;
}

const files = ROOTS.flatMap(r => walk(r));
let bad = 0;

for (const f of files) {
  try {
    const ast = parse(readFileSync(f, 'utf8'), {
      sourceType: 'module',
      plugins: ['jsx'],
      errorRecovery: false,
    });
    const tdz = findTdz(ast);
    if (tdz.length) {
      bad++;
      console.log(`✗ ${f}`);
      for (const t of tdz) console.log('    ' + t);
    }
  } catch (e) {
    bad++;
    console.log(`✗ ${f}\n    ${e.message}`);
  }
}

console.log(bad === 0
  ? `all ${files.length} files parse clean`
  : `${bad} of ${files.length} files failed to parse`);
process.exit(bad === 0 ? 0 : 1);
