/**
 * McDrag: a drag curve from the bullet's shape, with no coefficient involved.
 *
 * A ballistic coefficient is somebody else's measurement of somebody else's
 * bullet, and the shooter is asked to trust it. This asks instead for what they
 * can measure with the calipers already on the bench - length, nose length,
 * meplat, boattail - and estimates Cd against Mach directly. The output is the
 * same kind of thing `lib/dragfn` accepts from a radar file, so it drives the
 * solver through sectional density and never touches a BC at all.
 *
 * PROVENANCE. This is a port of MCDRAG by R. L. McCoy, December 1974, US Army
 * Ballistic Research Laboratory - a US Government work and public domain. It
 * was transcribed from McCoy's published BASIC listing on 16 Aug 2026, line by
 * line, and the original line numbers are kept in the comments so any term can
 * be checked against the source rather than against a memory of it. Nothing
 * here was reconstructed from a description of the method.
 *
 * WHAT IT IS NOT. An estimate from geometry, not a measurement. McCoy's own
 * diagnostics - reproduced below - mark the shapes where he said it goes wrong,
 * and a modern very-low-drag match bullet sits near the edge of what a 1974 fit
 * was built for. Treat it as a starting curve for a bullet with no published
 * figure, and true it against real dope the moment there is any.
 */

/** The Mach numbers McDrag tabulates. Its own DATA statement, lines 180-190. */
export const MCDRAG_MACHS = [
  0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.925, 0.95, 0.975, 1.0,
  1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.0, 2.2,
  2.5, 3.0, 3.5, 4.0, 4.5, 5.0,
];

/**
 * Boundary layer state over the projectile.
 *
 * Full-scale small arms at service velocity are turbulent essentially from the
 * nose, so 'T/T' is the sane default; the laminar options exist for small,
 * slow, or very smooth projectiles and are McCoy's, not ours to remove.
 */
export const BOUNDARY_LAYERS = ['L/L', 'L/T', 'T/T'];

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/**
 * Estimate the drag curve for an axisymmetric projectile.
 *
 * Every length is in calibers except the reference diameter, which is in
 * millimetres - McCoy's convention, kept rather than tidied, because the
 * Reynolds number constant at line 760 is scaled to it and separating the two
 * would invite a silent unit error.
 *
 * @param diameterMm        reference (bore) diameter, mm
 * @param totalLengthCal    overall projectile length, calibers
 * @param noseLengthCal     nose length, calibers
 * @param headshape         RT/R: 0 for a cone, 1 for a tangent ogive
 * @param boattailLengthCal boattail length, calibers; 0 for a flat base
 * @param baseDiameterCal   base diameter, calibers; 1 for a flat base
 * @param meplatDiameterCal flat tip diameter, calibers; 0 for a perfect point
 * @param bandDiameterCal   rotating band diameter, calibers; 1 if there is none
 * @param boundaryLayer     'L/L', 'L/T' or 'T/T'
 */
export function mcDrag({
  diameterMm,
  totalLengthCal,
  noseLengthCal,
  headshape = 0.5,
  boattailLengthCal = 0,
  baseDiameterCal = 1,
  meplatDiameterCal = 0,
  bandDiameterCal = 1,
  boundaryLayer = 'T/T',
} = {}) {
  const D1 = num(diameterMm, NaN);
  const L1 = num(totalLengthCal, NaN);
  const L2 = num(noseLengthCal, NaN);
  const R1 = num(headshape, 0.5);
  const L3 = Math.max(0, num(boattailLengthCal, 0));
  const D2 = num(baseDiameterCal, 1);
  const D3 = num(meplatDiameterCal, 0);
  const D4 = num(bandDiameterCal, 1);
  const K = BOUNDARY_LAYERS.includes(boundaryLayer) ? boundaryLayer : 'T/T';

  // Refuse rather than return a curve built on nonsense. A drag curve that
  // solves is indistinguishable from a correct one on a chart.
  const bad = [];
  if (!(D1 > 0)) bad.push('reference diameter');
  if (!(L1 > 0)) bad.push('total length');
  if (!(L2 > 0)) bad.push('nose length');
  if (bad.length) return { ok: false, reason: `Needs a positive ${bad.join(', ')}.`, rows: [] };
  if (L2 > L1) {
    return { ok: false, reason: 'The nose cannot be longer than the whole bullet.', rows: [] };
  }
  if (L2 + L3 > L1) {
    return { ok: false, reason: 'Nose plus boattail is longer than the bullet.', rows: [] };
  }

  const T1 = (1 - D3) / L2;                                  // 740

  const rows = MCDRAG_MACHS.map((M) => {
    const M2 = M * M;                                        // 750

    // ---- skin friction ------------------------------------------------ 760
    const R2 = 23296.3 * M * L1 * D1;                        // Reynolds number
    const R3 = 0.4343 * Math.log(R2);                        // 770 = log10(R2)
    const C7 = (1.328 / Math.sqrt(R2)) * Math.pow(1 + 0.12 * M2, -0.12);   // 780 laminar
    const C8 = (0.455 / Math.pow(R3, 2.58)) * Math.pow(1 + 0.21 * M2, -0.32); // 790 turbulent

    const D5 = 1 + (0.333 + 0.02 / (L2 * L2)) * R1;          // 800
    const S1 = 1.5708 * L2 * D5 * (1 + 1 / (8 * L2 * L2));   // 810 nose wetted area
    const S2 = 3.1416 * (L1 - L2);                           // 820 body wetted area
    const S3 = S1 + S2;                                      // 830

    let C9, C10;
    if (K === 'L/L') { C9 = 1.2732 * S3 * C7; C10 = C9; }               // 870-880
    else if (K === 'L/T') { C9 = 1.2732 * S3 * C7; C10 = 1.2732 * S3 * C8; } // 900-910
    else { C9 = 1.2732 * S3 * C8; C10 = C9; }                            // 930-940
    const C3 = (C9 * S1 + C10 * S2) / S3;                    // 950 CDSF

    // ---- meplat / blunt-tip contribution ------------------------------ 960
    const C15 = (M2 - 1) / (2.4 * M2);
    const P5 = M <= 1
      ? Math.pow(1 + 0.2 * M2, 3.5)                          // 990 isentropic
      : Math.pow(1.2 * M2, 3.5) * Math.pow(6 / (7 * M2 - 1), 2.5); // 1010 Rayleigh pitot
    const C16 = (1.122 * (P5 - 1) * D3 * D3) / M2;           // 1020
    let C18;
    if (M <= 0.91) C18 = 0;                                  // 1070
    else if (M >= 1.41) C18 = 0.85 * C16;                    // 1090
    else C18 = (0.254 + 2.88 * C15) * C16;                   // 1050

    // ---- base pressure and base drag ---------------------------------- 1100
    const P2 = M < 1
      ? 1 / (1 + 0.1875 * M2 + 0.0531 * M2 * M2)             // 1120
      : 1 / (1 + 0.2477 * M2 + 0.0345 * M2 * M2);            // 1140
    const P4 = (1 + 0.09 * M2 * (1 - Math.exp(L2 - L1)))
             * (1 + 0.25 * M2 * (1 - D2));                   // 1150
    let P1 = P2 * P4;                                        // 1160
    if (!(P1 >= 0)) P1 = 0;                                  // 1170-1180
    const C6 = (1.4286 * (1 - P1) * D2 * D2) / M2;           // 1190 CDB

    // ---- rotating band ------------------------------------------------ 1200
    const C4 = M < 0.95
      ? Math.pow(M, 12.5) * (D4 - 1)                         // 1220
      : (0.21 + 0.28 / M2) * (D4 - 1);                       // 1240

    // ---- head and boattail, by regime --------------------------------- 1260
    let C2, C5;
    if (M <= 1) {
      // Boattail, subsonic. Zero below Mach 0.85 as well as with no boattail.
      if (L3 <= 0 || M <= 0.85) C5 = 0;                      // 1290, 1310
      else {
        const T2 = (1 - D2) / (2 * L3);                      // 1320
        const T3 = 2 * T2 * T2 + T2 * T2 * T2;               // 1330
        const E1 = Math.exp(-2 * L3);                        // 1340
        const B4 = 1 - E1 + 2 * T2 * (E1 * (L3 + 0.5) - 0.5); // 1350
        C5 = 2 * T3 * B4 * (1 / (0.564 + 1250 * C15 * C15)); // 1360
      }
      const X2 = Math.pow(1 + 0.552 * Math.pow(T1, 0.8), -0.5); // 1370
      const C17 = M <= X2 ? 0 : 0.368 * Math.pow(T1, 1.8) + 1.6 * T1 * C15; // 1400, 1420
      C2 = C17 + C18;                                        // 1430
    } else {
      const B2 = M2 - 1;                                     // 1460
      const B = Math.sqrt(B2);                               // 1470
      const S4 = 1 + 0.368 * Math.pow(T1, 1.85);             // 1490
      const Z = M >= S4 ? B : Math.sqrt(S4 * S4 - 1);        // 1480, 1500-1510

      const C11 = 0.7156 - 0.5313 * R1 + 0.595 * R1 * R1;    // 1520
      const C12 = 0.0796 + 0.0779 * R1;                      // 1530
      const C13 = 1.587 + 0.049 * R1;                        // 1540
      const C14 = 0.1122 + 0.1658 * R1;                      // 1550
      const R4 = 1 / (Z * Z);                                // 1560
      const C17 = (C11 - C12 * T1 * T1) * R4
                * Math.pow(T1 * Z, C13 + C14 * T1);          // 1570
      C2 = C17 + C18;                                        // 1580

      if (L3 <= 0) C5 = 0;                                   // 1610
      else {
        const T2 = (1 - D2) / (2 * L3);                      // 1630
        if (M <= 1.1) {
          const T3 = 2 * T2 * T2 + T2 * T2 * T2;             // 1660
          const E1 = Math.exp(-2 * L3);                      // 1670
          const B4 = 1 - E1 + 2 * T2 * (E1 * (L3 + 0.5) - 0.5); // 1680
          C5 = 2 * T3 * B4 * (1.774 - 9.3 * C15);            // 1690
        } else {
          const B3 = 0.85 / B;                               // 1710
          const A12 = (5 * T1) / (6 * B) + Math.pow(0.5 * T1, 2)
                    - (0.7435 / M2) * Math.pow(T1 * M, 1.6); // 1720
          const A11 = (1 - (0.6 * R1) / M) * A12;            // 1730
          const E2 = Math.exp((-1.1952 / M) * (L1 - L2 - L3)); // 1740
          const X3 = ((2.4 * M2 * M2 - 4 * B2) * (T2 * T2)) / (2 * B2 * B2); // 1750
          const A1 = A11 * E2 - X3 + (2 * T2) / B;           // 1760
          const R5 = 1 / B3;                                 // 1770
          const E3 = Math.exp(-B3 * L3);                     // 1780
          const A2 = 1 - E3 + 2 * T2 * (E3 * (L3 + R5) - R5); // 1790
          C5 = 4 * A1 * T2 * A2 * R5;                        // 1800
        }
      }
    }

    const C1 = C2 + C3 + C4 + C5 + C6;                       // 1810 CD0

    return {
      mach: M,
      cd0: C1,
      cdHead: C2,
      cdSkinFriction: C3,
      cdBand: C4,
      cdBoattail: C5,
      cdBase: C6,
      basePressureRatio: P1,
    };
  });

  // McCoy's own diagnostics, lines 1970-2070. They are the honest part of the
  // program: the shapes it was not fitted for, said plainly rather than left
  // for the user to discover from a trajectory that does not match.
  const warnings = [];
  if (L2 < 1) warnings.push('Nose shorter than one caliber — head drag will read too high through transonic and above.');
  if (D3 > 0.5) warnings.push('Meplat wider than half a caliber — head drag will read too high through transonic and above.');
  if (L3 >= 1.5) warnings.push('Boattail longer than 1.5 calibers — boattail and base drag may be wrong.');
  if (D2 < 0.65) warnings.push('Boattail steeper than the fit allows — boattail and base drag may be wrong.');
  else if (D2 > 1.35) warnings.push('Flare tail steeper than the fit allows — boattail and base drag may be wrong.');

  return { ok: true, rows, warnings };
}

/**
 * The curve in the form the solver takes: [[mach, cd], ...].
 *
 * `lib/ballistics.solve` accepts this together with a sectional density, and
 * then no ballistic coefficient is involved anywhere in the trajectory - the
 * form factor is already in the Cd. See lib/dragfn for why the two must arrive
 * together.
 */
export function mcDragCurve(result) {
  if (!result?.ok) return [];
  return result.rows.map(r => [r.mach, r.cd0]);
}

/**
 * Bullet length in calibers, from the two figures a shooter actually has.
 *
 * Length is the input people are least likely to know and most likely to
 * mis-enter, because it is the one figure not printed on the box.
 */
export function lengthInCalibers(lengthIn, diameterIn) {
  const l = Number(lengthIn), d = Number(diameterIn);
  if (!(l > 0) || !(d > 0)) return null;
  return l / d;
}
