import { Platform, Alert } from 'react-native';

/**
 * Save a text file to the device and offer it to the share sheet.
 *
 * Named for CSV because that was its only caller; the mime type is a parameter
 * now because the problem report is plain text, and handing a .txt to the share
 * sheet labelled text/csv makes the receiving app guess wrong.
 *
 * Web triggers an anchor download from a Blob; native writes to the app's
 * document directory and opens the share sheet. expo-file-system and
 * expo-sharing are required lazily because importing them at module scope
 * crashes the web bundle.
 */
export async function saveCSV(csv, filename, mimeType = 'text/csv') {
  try {
    if (Platform.OS === 'web') {
      const blob = new Blob([csv], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      // SDK 57 moved documentDirectory and writeAsStringAsync to
      // expo-file-system/legacy and replaced them with File/Paths. The old
      // calls were still here and expo-file-system was not even a dependency,
      // so export threw on every device — invisible from the web path, which
      // uses a Blob and never touches this branch.
      const { File, Paths } = require('expo-file-system');
      const Share = require('expo-sharing');
      const file = new File(Paths.document, filename);
      file.write(csv);
      if (await Share.isAvailableAsync()) {
        await Share.shareAsync(file.uri, { mimeType });
      } else {
        Alert.alert('Export', 'File saved to app documents.');
      }
    }
    return true;
  } catch (e) {
    const msg = 'Export failed: ' + e.message;
    if (Platform.OS === 'web') alert(msg);
    else Alert.alert('Export Error', msg);
    return false;
  }
}

/** Filesystem-safe filename stem from a session name. */
export function slugify(name, fallback = 'session') {
  const slug = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}
