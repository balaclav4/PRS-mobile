const { getDefaultConfig } = require('expo/metro-config');

/**
 * Metro configuration.
 *
 * Exists for one reason: the Firebase JS SDK would not resolve. Expo SDK 57
 * enables `unstable_enablePackageExports` but ships `unstable_conditionNames`
 * empty, so Metro walks the `exports` map of packages like `@firebase/component`
 * with no conditions to match and reports the package as missing — a confusing
 * error, because the files are on disk and `npm ls` is clean.
 *
 * Supplying the conditions is the right fix rather than switching package
 * exports off. Firebase publishes a `react-native` condition, and that is what
 * resolves `firebase/auth` to the build containing `getReactNativePersistence`.
 * Disabling exports would fall back to the browser build, where that export does
 * not exist, and native sign-in would silently stop persisting between launches.
 *
 * Order matters: Metro takes the first condition that matches, so `react-native`
 * must precede `browser`.
 */
const config = getDefaultConfig(__dirname);

config.resolver.unstable_conditionNames = ['react-native', 'browser', 'require', 'import'];

module.exports = config;
