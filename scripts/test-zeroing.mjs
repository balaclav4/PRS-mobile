/**
 * Validates density altitude and angle-based zeroing.
 *
 * DA is checked against hand-computable standard-atmosphere cases, because the
 * formula is the one shooters already trade numbers in and a wrong constant
 * would be invisible until someone compared against a Kestrel.
 *
 * The zeroing claim is checked by construction: establish a zero, re-solve at
 * the same conditions, and the rifle must still be on. Anything else means the
 * angle is not being held.
 *
 * Run: node scripts/test-zeroing.mjs
 */
import { pressureAltitude, densityAltitude, establishZero, zeroUnderConditions } from '../lib/zeroing.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(52) + detail);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const LOAD = { mvFps: 2800, bc: 0.315, dragModel: 'G7', sightHeightIn: 1.5, zeroYd: 100 };
const STD = { tempF: 59, pressureInHg: 29.92, humidityPct: 0, altitudeFt: 0 };

console.log('pressure altitude');
{
  check('  standard pressure at sea level is 0', pressureAltitude(29.92, 0) === 0);
  check('  1 inHg low is 1000 ft up', near(pressureAltitude(28.92, 0), 1000, 1e-9));
  check('  field elevation adds', near(pressureAltitude(29.92, 5000), 5000, 1e-9));
  check('  refuses nonsense', pressureAltitude(0) === null);
}

console.log('\ndensity altitude');
{
  // Standard day: 15C at sea level with standard pressure is by definition 0.
  check('  standard day is zero', near(densityAltitude({ tempF: 59, pressureInHg: 29.92 }), 0, 1),
    String(densityAltitude({ tempF: 59, pressureInHg: 29.92 })));

  // 30C at sea level, standard pressure: DA = 120 * (30 - 15) = 1800 ft.
  check('  30C at sea level is about 1800 ft',
    near(densityAltitude({ tempF: 86, pressureInHg: 29.92 }), 1800, 15),
    String(densityAltitude({ tempF: 86, pressureInHg: 29.92 })));

  // Cold is negative DA — denser air, less drop.
  check('  a cold day goes negative',
    densityAltitude({ tempF: 20, pressureInHg: 29.92 }) < 0,
    String(densityAltitude({ tempF: 20, pressureInHg: 29.92 })));

  // 5000 ft elevation, standard pressure for that altitude, 15C ambient.
  // ISA at 5000 ft is 15 - 9.9 = 5.1C, so 15C ambient is 120*(15-5.1) ~ 1188
  // above the 5000 ft PA.
  const high = densityAltitude({ tempF: 59, pressureInHg: 29.92, elevationFt: 5000 });
  check('  warm air at altitude stacks on the elevation', near(high, 6188, 30), String(high));

  check('  monotonic in temperature',
    densityAltitude({ tempF: 90, pressureInHg: 29.92 }) >
    densityAltitude({ tempF: 50, pressureInHg: 29.92 }));
  check('  monotonic in pressure (lower pressure, higher DA)',
    densityAltitude({ tempF: 59, pressureInHg: 28.0 }) >
    densityAltitude({ tempF: 59, pressureInHg: 30.0 }));
  check('  bad input is null', densityAltitude({ tempF: NaN, pressureInHg: 29.92 }) === null);
}

console.log('\nestablishing a zero');
{
  const z = establishZero({ ...LOAD, ...STD });
  check('  solves', z.ok);
  // A 100 yd zero with a 1.5" sight height is a small positive bore angle.
  check('  the angle is small and positive', z.angleMil > 0 && z.angleMil < 5,
    `${z.angleMil} mil (${z.angleMoa} MOA)`);
  check('  conditions travel with it', z.conditions.densityAltitudeFt === 0,
    `DA ${z.conditions.densityAltitudeFt} ft`);

  // The self-consistency test: same angle, same conditions, still on zero.
  const same = zeroUnderConditions(z, { ...LOAD, ...STD });
  check('  re-solving at the same conditions is still on zero',
    same.ok && Math.abs(same.dropIn) < 0.05, `${same.dropIn}" off`);
  check('  and is not flagged as mattering', same.matters === false);
  check('  verdict says leave it alone', /Leave the turret alone/.test(same.verdict));
}

console.log('\nthe same rifle in different air');
{
  const z = establishZero({ ...LOAD, ...STD });

  // Hot and high: thinner air, less drag, so the bullet shoots flatter and
  // prints high at the original zero distance.
  const hot = zeroUnderConditions(z, {
    ...LOAD, tempF: 95, pressureInHg: 24.9, humidityPct: 40, altitudeFt: 5000,
  });
  check('  hot and high is solvable', hot.ok);
  check('  and reports a large DA change', hot.daShiftFt > 6000,
    `${hot.daShiftFt} ft shift, DA now ${hot.densityAltitudeFt}`);

  // At 100 yd the difference is tiny — which is the honest and useful finding.
  check('  yet barely moves a 100 yd zero', Math.abs(hot.moaOff) < 0.2,
    `${hot.moaOff} MOA at 100 yd`);

  // The same angle at distance is where it shows up.
  const far = establishZero({ ...LOAD, ...STD, zeroYd: 600 });
  const farHot = zeroUnderConditions(far, {
    ...LOAD, zeroYd: 600, tempF: 95, pressureInHg: 24.9, humidityPct: 40, altitudeFt: 5000,
  });
  check('  but matters at 600 yd', Math.abs(farHot.moaOff) > Math.abs(hot.moaOff),
    `${farHot.moaOff} MOA at 600 vs ${hot.moaOff} at 100`);
  check('  and thin air prints high', farHot.dropIn > 0, `${farHot.dropIn}"`);
}

console.log('\nverdict formatting');
{
  // The verdict once interpolated the unrounded solver value and printed
  // "crossing at 585.4726930944877 yd".
  const far = establishZero({ ...LOAD, ...STD, zeroYd: 600 });
  const cold = zeroUnderConditions(far, { ...LOAD, zeroYd: 600, tempF: 10, pressureInHg: 30.4, humidityPct: 0, altitudeFt: 0 });
  check('  no raw floats leak into the verdict',
    !/\d+\.\d{3,}/.test(cold.verdict), cold.verdict.slice(0, 60));
  check('  and the rounded field matches',
    cold.crossYd == null || Number.isInteger(cold.crossYd), String(cold.crossYd));
}

console.log('\nrefusals');
{
  check('  no baseline is refused', zeroUnderConditions(null, LOAD).ok === false);
  check('  a failed baseline is refused',
    zeroUnderConditions({ ok: false }, LOAD).ok === false);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
