/**
 * Validates chronograph string parsing against the shapes real apps export,
 * and the velocity statistics against hand-computed values.
 *
 * Run: node scripts/test-chrono.mjs
 */
import { parseVelocities, velocityStats, sdConfidenceNote } from '../lib/chrono.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(48) + detail);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const EXPECT = [2905, 2912, 2898, 2921, 2903];

console.log('parsing real-world export shapes');
{
  const shapes = {
    'one per line': '2905\n2912\n2898\n2921\n2903',
    'comma separated': '2905, 2912, 2898, 2921, 2903',
    'space separated': '2905 2912 2898 2921 2903',
    'shot,velocity pairs': '1,2905\n2,2912\n3,2898\n4,2921\n5,2903',
    'CSV with header': '#,SPEED (FPS)\n1,2905\n2,2912\n3,2898\n4,2921\n5,2903',
    'units attached': '2905 fps\n2912 fps\n2898 fps\n2921 fps\n2903 fps',
    'blank lines and tabs': '\n2905\t\n\n2912\n2898\n\t2921\n2903\n\n',
    'trailing summary text': '2905\n2912\n2898\n2921\n2903\nAVG 2907  SD 9  ES 23',
  };
  for (const [name, text] of Object.entries(shapes)) {
    const { velocities } = parseVelocities(text);
    // The summary line legitimately contains 2907, so only check the leading run.
    const got = velocities.slice(0, 5);
    check(`  ${name}`, eq(got, EXPECT), got.join(','));
  }
}

console.log('\nfiltering');
{
  const { velocities, rejected } = parseVelocities('1,2905\n2,2912\n3,2898');
  check('  shot indices are dropped', eq(velocities, [2905, 2912, 2898]), `kept ${velocities.length}`);
  check('  and reported as rejected', eq(rejected, [1, 2, 3]), rejected.join(','));

  const junk = parseVelocities('Garmin Xero C1 Pro\nSession 4\n2905\n2912');
  check('  header text does not become data', eq(junk.velocities, [2905, 2912]),
    junk.velocities.join(','));

  check('  empty input is safe', eq(parseVelocities('').velocities, []));
  check('  null input is safe', eq(parseVelocities(null).velocities, []));
  check('  text with no numbers is safe', eq(parseVelocities('no data here').velocities, []));

  // Decimals survive; some chronos report tenths.
  check('  decimals are kept', eq(parseVelocities('2905.4\n2912.7').velocities, [2905.4, 2912.7]));
}

console.log('\nm/s conversion');
{
  // 886 m/s = 2907 fps, a typical 6mm Dasher.
  const { velocities } = parseVelocities('886\n888\n884', 'mps');
  check('  m/s converts into fps range', velocities.length === 3, velocities.join(','));
  check('  886 m/s -> 2907 fps', Math.abs(velocities[0] - 2906.8) < 0.2, String(velocities[0]));

  // The ambiguity the unit toggle exists for: 886 is a believable reading
  // either way — 886 m/s from a 6mm Dasher, or 886 fps from a .45 ACP. Both
  // parse, to very different velocities, so the unit cannot be inferred and is
  // asked for instead.
  const asFps = parseVelocities('886\n888\n884', 'fps').velocities;
  check('  same numbers also valid as fps', asFps.length === 3, asFps.join(','));
  check('  and mean a different velocity', Math.abs(asFps[0] - velocities[0]) > 2000,
    `${asFps[0]} fps vs ${velocities[0]} fps`);
}

console.log('\nvelocity statistics');
{
  const st = velocityStats(EXPECT);
  // mean of the five = 14539/5 = 2907.8
  check('  mean', st.mean === 2907.8, String(st.mean));
  check('  ES = max - min', st.es === 23, String(st.es));
  check('  min/max', st.min === 2898 && st.max === 2921, `${st.min}/${st.max}`);
  // sample SD of the five values is 8.9275, reported to one decimal
  check('  sample SD', Math.abs(st.sd - 8.9) < 0.001, String(st.sd));
  check('  n', st.n === 5);

  check('  SE of SD reported', st.sdSe > 0, `±${st.sdSe} fps`);
  check('  5 shots flagged weak', st.weak === true);
  const long = velocityStats(Array.from({ length: 12 }, (_, i) => 2900 + (i % 5)));
  check('  12 shots not flagged weak', long.weak === false);

  check('  single shot has no SD', velocityStats([2905]).sd === null);
  check('  empty is null', velocityStats([]) === null);
}

console.log('\nSD confidence note');
{
  const note = sdConfidenceNote(velocityStats(EXPECT));
  check('  short string gets a caveat', /too loose to rank loads by/.test(note || ''), '');
  const none = sdConfidenceNote(velocityStats(Array.from({ length: 15 }, (_, i) => 2900 + i % 7)));
  check('  long string gets none', none === null);
  check('  null-safe', sdConfidenceNote(null) === null);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
