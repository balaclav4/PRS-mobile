import { Platform } from 'react-native';

/**
 * Ask the shooter for a file and hand back its text.
 *
 * Returns null when they cancel, which is an ordinary outcome and not an error.
 *
 * Two implementations, because the platforms have nothing in common here. Web
 * has a file input and a FileReader; native has the picker on expo-file-system,
 * which arrived with the same SDK 57 rewrite that replaced documentDirectory
 * with File and Paths. Neither needs a new dependency.
 */
export async function pickBackupText() {
  if (Platform.OS === 'web') {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      // Not restricted to .json: a shooter may well have renamed it, and a
      // picker that hides their own backup is worse than one that lets them
      // choose the wrong file and be told so.
      input.accept = '.json,application/json,text/plain';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        // Reached through window, like the Image in lib/photo.js: these are
        // browser globals inside a Platform.OS check, and the lint gate is
        // right to refuse a bare reference that would be undefined on device.
        const reader = new window.FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => resolve(null);
        reader.readAsText(file);
      };
      // A cancelled picker fires no event at all in some browsers, so nothing
      // is resolved and the caller simply stays idle - which is correct, and
      // why the caller must not block on this.
      input.click();
    });
  }

  const { File } = require('expo-file-system');
  const result = await File.pickFileAsync({ mimeTypes: ['application/json', 'text/plain'] });
  if (!result || result.canceled) return null;
  const uri = result.file?.uri ?? result.uri;
  if (!uri) return null;
  return new File(uri).text();
}
