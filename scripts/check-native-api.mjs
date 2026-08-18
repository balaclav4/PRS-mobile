/**
 * Do the native APIs this app calls actually exist in the installed packages?
 *
 * Written after a bug that reached a device. `lib/photo.js` had:
 *
 *     const ImageManipulator = require('expo-image-manipulator');
 *     ImageManipulator.manipulate(uri)
 *
 * `manipulate` is a method on the *exported* ImageManipulator module object,
 * not a top-level export of the package. Binding the namespace to that same
 * name makes the call read exactly like the documentation and resolve to
 * undefined. iOS said "undefined is not a function" at the first photo, and the
 * same mistake sat one step further down the flow in `lib/pixels.js`.
 *
 * Nothing could have caught it. Web never runs these branches - it uses canvas.
 * No harness imports a native module, because they cannot be imported outside a
 * device. `node --check` and ESLint both see a property access on an object and
 * have no opinion. So the first execution of that line was on a phone.
 *
 * This closes that gap by checking the contract rather than the behaviour: the
 * names below are the entire native surface this app depends on, and each is
 * verified against the type declarations shipped in node_modules. It cannot
 * prove the call works. It does prove the name is real, which is the failure
 * that actually happened and the one an SDK upgrade would cause again.
 *
 * Run: node scripts/check-native-api.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';

/**
 * What the app calls, and where.
 *
 * `exports` are names the package must export at top level. `members` are
 * methods that must exist on an exported object - the case that broke.
 */
const REQUIRED = [
  {
    module: 'expo-image-manipulator',
    usedBy: ['lib/photo.js', 'lib/pixels.js'],
    exports: ['ImageManipulator', 'SaveFormat'],
    members: [['ImageManipulator', 'manipulate']],
    // renderAsync/saveAsync live on the context object returned by manipulate.
    anywhere: ['renderAsync', 'saveAsync', 'resize'],
  },
  {
    module: 'expo-sqlite',
    usedBy: ['lib/db.js'],
    anywhere: ['openDatabaseAsync', 'execAsync', 'runAsync', 'getAllAsync', 'getFirstAsync'],
  },
  {
    module: 'expo-file-system',
    usedBy: ['lib/export.js'],
    exports: ['File', 'Paths'],
    // `write` is declared on the native base class File extends, not on File
    // itself, which is why a shallow read of File.d.ts suggests it is missing.
    // It is not - but the next SDK is exactly where that would change.
    anywhere: ['write', 'document'],
  },
  {
    module: 'expo-sharing',
    usedBy: ['lib/export.js'],
    anywhere: ['isAvailableAsync', 'shareAsync'],
  },
  {
    module: 'expo-haptics',
    usedBy: ['lib/haptics.js'],
    anywhere: ['impactAsync', 'notificationAsync', 'selectionAsync',
               'ImpactFeedbackStyle', 'NotificationFeedbackType'],
  },
  {
    module: 'expo-image-picker',
    usedBy: ['app/capture/index.js'],
    anywhere: ['launchCameraAsync', 'launchImageLibraryAsync',
               'requestCameraPermissionsAsync', 'requestMediaLibraryPermissionsAsync'],
  },
];

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(56) + detail);
};

/** Every .d.ts the package ships, concatenated. */
function declarations(mod) {
  const root = `node_modules/${mod}/build`;
  if (!existsSync(root)) return null;
  let text = '';
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}/${e.name}`);
      else if (e.name.endsWith('.d.ts')) text += readFileSync(`${dir}/${e.name}`, 'utf8') + '\n';
    }
  };
  walk(root);
  return text;
}

/** Names the package's index re-exports, however it phrases it. */
function topLevelExports(mod) {
  const idx = `node_modules/${mod}/build/index.d.ts`;
  if (!existsSync(idx)) return null;
  const src = readFileSync(idx, 'utf8');
  const names = new Set();
  // export { a, b as c } from '...'   /   export declare function a(
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const as = t.match(/\bas\s+(\w+)$/);
      names.add(as ? as[1] : t.replace(/^type\s+/, '').trim());
    }
  }
  for (const m of src.matchAll(/export\s+declare\s+(?:function|const|class)\s+(\w+)/g)) names.add(m[1]);
  // `export * from './X'` hides the names, so fall back to the whole package.
  const wildcard = /export\s+\*\s+from/.test(src);
  return { names, wildcard };
}

for (const spec of REQUIRED) {
  console.log(`\n${spec.module}  (${spec.usedBy.join(', ')})`);
  const decls = declarations(spec.module);
  if (decls == null) {
    check('  installed', false, 'no build/ directory - is it in package.json?');
    continue;
  }

  const top = topLevelExports(spec.module);
  for (const name of spec.exports || []) {
    const ok = top && (top.names.has(name) || (top.wildcard && new RegExp(`\\b${name}\\b`).test(decls)));
    check(`  exports ${name}`, !!ok,
      ok ? '' : 'not a top-level export - destructuring it would yield undefined');
  }

  for (const [owner, member] of spec.members || []) {
    // The member must be declared on a type of the owner's name, not merely
    // present somewhere in the package.
    const cls = decls.match(new RegExp(`declare class ${owner}[^{]*\\{([\\s\\S]*?)\\n\\}`));
    const ok = !!cls && new RegExp(`\\b${member}\\s*\\(`).test(cls[1]);
    check(`  ${owner}.${member}()`, ok,
      ok ? '' : `not a method of ${owner} - this is the shape that broke on iOS`);
  }

  for (const name of spec.anywhere || []) {
    check(`  ${name}`, new RegExp(`\\b${name}\\b`).test(decls));
  }
}

/**
 * The call sites, not just the package.
 *
 * The checks above prove `manipulate` is a method of the exported
 * ImageManipulator and *not* a top-level export. That is precisely why binding
 * the namespace and calling `.manipulate` on it fails - so the source has to be
 * read too, or this file would have passed against the code that broke.
 */
console.log('\ncall sites, since the package surface alone would have passed');
{
  const idx = topLevelExports('expo-image-manipulator');
  const decls = declarations('expo-image-manipulator');
  const topLevelManipulate = idx && (idx.names.has('manipulate')
    || (idx.wildcard && /export declare function manipulate\b/.test(decls)));
  check('  manipulate is not a top-level export', !topLevelManipulate,
    'which is the whole reason a namespace binding cannot work');

  for (const file of ['lib/photo.js', 'lib/pixels.js']) {
    // Comments stripped first. Both files *document* the broken form to explain
    // why the working one is written the way it is, and the first version of
    // this check flagged that comment as the bug - a false positive that would
    // have trained the next person to delete the explanation.
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    // Find what each require of the package is bound to.
    const binds = [...src.matchAll(/(?:const|let|var)\s+([^=]+?)\s*=\s*require\(['"]expo-image-manipulator['"]\)/g)];
    check(`  ${file} requires it`, binds.length > 0);
    for (const [, bound] of binds) {
      const destructured = bound.trim().startsWith('{');
      check(`  ${file} destructures rather than binding the namespace`, destructured,
        destructured ? '' : `bound as \`${bound.trim()}\` - .manipulate would be undefined`);
    }
  }
}

console.log('\n' + (fails === 0
  ? 'every native name this app calls exists in the installed packages'
  : `${fails} native API check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
