import { Platform } from 'react-native';

/**
 * Normalizes a picked/captured photo once, at intake.
 *
 * Phone cameras store pixels in sensor orientation plus an EXIF tag saying how
 * to rotate them. If the display path honours that tag and the analysis path
 * does not (or vice versa), every detected hole lands 90 degrees away from
 * where the user sees it — silently. Rather than track the tag through both
 * paths, bake it out up front: both platforms re-encode to an upright image
 * with no EXIF, and that single URI feeds display *and* detection.
 *
 *  - Web: canvas drawImage applies EXIF orientation (image-orientation:
 *    from-image has been the browser default since ~2020), so the canvas
 *    output is upright.
 *  - Native: expo-image-manipulator applies EXIF orientation before running
 *    its actions, so the saved file is upright.
 *
 * Downscaling to maxDim also caps memory — a 12MP camera photo is ~48MB
 * decoded, and nothing downstream needs more than ~1600px.
 */

const MAX_DIM = 1600;

export async function normalizePhoto(uri, maxDim = MAX_DIM) {
  return Platform.OS === 'web' ? normalizeWeb(uri, maxDim) : normalizeNative(uri, maxDim);
}

function normalizeWeb(uri, maxDim) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      try {
        resolve({ uri: canvas.toDataURL('image/jpeg', 0.92), width: w, height: h });
      } catch (e) {
        reject(new Error('Could not process photo: ' + e.message));
      }
    };
    img.onerror = () => reject(new Error('Could not load photo'));
    img.src = uri;
  });
}

async function normalizeNative(uri, maxDim) {
  // `manipulate` is a method on the ImageManipulator *module object*, which the
  // package exports by name. It is not a top-level export of the package.
  //
  // This is the bug that reached a device: the namespace had been bound as
  //
  //     const ImageManipulator = require('expo-image-manipulator');
  //     ImageManipulator.manipulate(uri)
  //
  // which reads exactly like the documented call and is character-for-character
  // what the docs show — except the name is bound to the namespace rather than
  // to the export of the same name. `manipulate` was undefined, and iOS said
  // "undefined is not a function" at the first photo. Destructuring is what
  // makes the mistake impossible to write again.
  const { ImageManipulator, SaveFormat } = require('expo-image-manipulator');
  const context = ImageManipulator.manipulate(uri);
  // Width-only resize keeps aspect; a portrait photo may exceed maxDim in
  // height, which is fine — the cap is about memory, not exact bounds.
  context.resize({ width: maxDim });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: 0.92,
  });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}
