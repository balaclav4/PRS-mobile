/**
 * Bullet diameters in inches, used as the size prior for hole detection.
 *
 * A bullet hole in paper is very close to the bullet's diameter — paper tears
 * rather than stretching much — so this plus the photo scale pins the expected
 * hole radius in pixels, which is what makes detection tractable without ML.
 *
 * Provenance: these are the nominal bullet diameters that define the
 * cartridges themselves — .308 is .308 because that is what the name means.
 * They are facts about the cartridge rather than anyone's measurements, which
 * is why no source is credited: there is nothing here that could have come out
 * differently. Anything requiring an actual measurement — a bullet's BC, its
 * length, a target's ring diameters — is not in this file and is not shipped
 * anywhere else either, because it would need a source and a licence.
 *
 * The fallback is what makes this safe to be approximate: an unrecognised
 * cartridge returns 6.5mm with `matched: false`, and every caller that would
 * be wrong rather than merely imprecise checks that flag. Sizing a bullet hole
 * tolerates a near miss; cubing the diameter into a stability factor does not.
 */
const DIAMETERS = [
  [/\.?17\b|17 hmr/i, 0.172],
  [/\.?20\b/i, 0.204],
  [/22 ?lr|\.?223|5\.56|22-250|\.?222\b|\.?204\b/i, 0.224],
  [/6mm|\.?243|dasher|6 ?br|6 ?xc|6 ?gt|6 ?creed/i, 0.243],
  [/25-06|\.?257|25 ?creed/i, 0.257],
  [/6\.5|\.?264|creedmoor|6 ?5 ?prc/i, 0.264],
  [/270|\.?277/i, 0.277],
  [/7mm|\.?284|280|7 ?prc|7 ?saum/i, 0.284],
  [/\.?308|7\.62|30-06|30 ?nosler|300 ?(win|wsm|prc|norma|blk|blackout)|\.?30\b/i, 0.308],
  [/\.?338|338 ?lapua/i, 0.338],
  [/\.?375/i, 0.375],
  [/\.?408|\.?416/i, 0.416],
  [/\.?50 ?bmg|\.?510/i, 0.510],
];

const FALLBACK_IN = 0.264;

/**
 * Best-guess bullet diameter for a cartridge or caliber string.
 * Returns the fallback when nothing matches, flagged so the UI can say so.
 */
export function bulletDiameterIn(text) {
  if (!text) return { diameterIn: FALLBACK_IN, matched: false };
  for (const [pattern, dia] of DIAMETERS) {
    if (pattern.test(text)) return { diameterIn: dia, matched: true };
  }
  return { diameterIn: FALLBACK_IN, matched: false };
}
