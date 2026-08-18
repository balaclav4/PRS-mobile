import Svg, { Rect, Circle, G } from 'react-native-svg';

/**
 * The app's mark, drawn rather than imported.
 *
 * The login screen used a purple tile with a stock crosshair glyph, which was
 * fine when the app icon was also a purple tile. It is not fine now: the home
 * screen shows buff paper with a black bull, the app opens onto a purple
 * square, and the two read as different products.
 *
 * Drawn in SVG rather than pointing an <Image> at assets/icon.png, because the
 * PNG is full bleed and square by design - it exists to be masked by the OS -
 * and would need its own corner masking here, at whatever size it appeared.
 * The geometry is the same as assets/brand/icon.svg, in the same 1024 space,
 * so the two stay recognisably one mark.
 *
 * @param size    rendered size in points
 * @param radius  corner radius in points; defaults to the icon's proportion
 */

const PAPER = '#EFE9DC';
const INK = '#17161D';
const SHOT = '#F0872B';

/** The icon is a 1024 square; everything below is in that space. */
const BOX = 1024;

/** iOS masks its own icon at about 22.4% of the width. Matched here so the
 *  in-app mark and the home-screen icon have the same silhouette. */
const CORNER = 0.224;

export default function BrandMark({ size = 76, radius }) {
  // A radius given in points has to be expressed in viewBox units.
  const rx = (radius != null ? radius / size : CORNER) * BOX;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}>
      <Rect width={BOX} height={BOX} rx={rx} ry={rx} fill={PAPER} />

      <Circle cx={512} cy={512} r={336} fill={INK} />

      {/* Scoring rings are cut out of the black rather than drawn on it, which
          is how a target is printed and why they are paper-coloured. */}
      <G stroke={PAPER} strokeWidth={28} fill="none">
        <Circle cx={512} cy={512} r={244} />
        <Circle cx={512} cy={512} r={152} />
      </G>
      <Circle cx={512} cy={512} r={60} fill={PAPER} />

      {/* Three shots, unequal and barely touching, well off the bull. */}
      <G fill={SHOT}>
        <Circle cx={352} cy={368} r={56} />
        <Circle cx={442} cy={336} r={52} />
        <Circle cx={376} cy={452} r={54} />
      </G>
    </Svg>
  );
}
