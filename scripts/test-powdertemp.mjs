/**
 * Validates the powder temperature fit.
 *
 * A straight line through two points is trivial arithmetic, so almost none of
 * this checks the slope. What it checks is the refusals: a span too small to
 * resolve, a difference smaller than the noise it was measured through, and a
 * sensitivity no real powder has. Those are the cases where a number would be
 * produced, believed, and dialled.
 *
 * The one numerical anchor is that the fit recovers a slope it was built from,
 * including through the least-squares path with scatter added.
 *
 * Run: node scripts/test-powdertemp.mjs
 */
import { fitPowderTemp, velocityAt } from '../lib/powdertemp.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(58) + detail);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('recovering a slope it was built from');
{
  // 0.8 fps per degree, which is an ordinary extruded powder.
  const pts = [{ tempF: 35, mvFps: 2772 }, { tempF: 85, mvFps: 2812 }];
  const f = fitPowderTemp(pts);
  check('  two sessions give a slope', f.ok && near(f.fpsPerF, 0.8, 0.001), `${f.fpsPerF} fps/°F`);
  check('  and are reported as the weaker evidence they are', f.weak === true,
    'a line through two points is a difference, not a fit');
  check('  which the prose says out loud', /difference rather than a fit/.test(f.text));

  // Least squares over a season, with scatter that should average out.
  const many = [
    { tempF: 20, mvFps: 2760 }, { tempF: 40, mvFps: 2779 }, { tempF: 55, mvFps: 2790 },
    { tempF: 70, mvFps: 2803 }, { tempF: 95, mvFps: 2820 },
  ];
  const g = fitPowderTemp(many);
  check('  five sessions fit by least squares', g.ok && g.points === 5);
  check('  and recover the slope through the scatter', near(g.fpsPerF, 0.8, 0.05),
    `${g.fpsPerF} fps/°F from data built at 0.80`);
  check('  no longer flagged as weak', g.weak === false);
}

console.log('\nrefusing what cannot be measured');
{
  check('  one session', !fitPowderTemp([{ tempF: 70, mvFps: 2800 }]).ok);
  check('  none at all', !fitPowderTemp([]).ok && !fitPowderTemp().ok);

  // The important one: too small a temperature span.
  const tight = fitPowderTemp([{ tempF: 68, mvFps: 2800 }, { tempF: 78, mvFps: 2812 }]);
  check('  sessions ten degrees apart', !tight.ok,
    'a 12 fps difference over 10°F is within ordinary spread');
  check('  and says how far apart they need to be', /at least 20°F apart/.test(tight.reason),
    tight.reason);

  check('  every session at the same temperature',
    !fitPowderTemp([{ tempF: 70, mvFps: 2800 }, { tempF: 70, mvFps: 2830 }]).ok);

  check('  junk rows are dropped rather than fitted', (() => {
    const f = fitPowderTemp([
      { tempF: 35, mvFps: 2772 }, { tempF: 85, mvFps: 2812 },
      { tempF: 'warm', mvFps: 2800 }, { tempF: 60, mvFps: 0 },
    ]);
    return f.ok && f.points === 2;
  })());
}

console.log('\nnoticing what is not real');
{
  // 8 fps per degree is not a powder, it is a mistake.
  const wild = fitPowderTemp([{ tempF: 30, mvFps: 2600 }, { tempF: 90, mvFps: 3080 }]);
  check('  an impossible sensitivity is flagged', wild.ok && wild.implausible === true,
    `${wild.fpsPerF} fps/°F`);
  check('  and blamed on the likely cause rather than the powder',
    /temperatures are the ammunition's rather than the air's/.test(wild.text));

  // A difference smaller than the noise the strings were measured through.
  const noisy = fitPowderTemp([
    { tempF: 35, mvFps: 2798, sdFps: 18, shots: 5 },
    { tempF: 85, mvFps: 2806, sdFps: 18, shots: 5 },
  ]);
  check('  a difference inside the spread is not claimed', noisy.confident === false,
    '8 fps apart with 18 fps SDs over five shots');
  check('  and the prose says provisional', /provisional/.test(noisy.text));

  const clear = fitPowderTemp([
    { tempF: 35, mvFps: 2760, sdFps: 8, shots: 10 },
    { tempF: 85, mvFps: 2810, sdFps: 8, shots: 10 },
  ]);
  check('  a clear one is not hedged', clear.confident === true && !/provisional/.test(clear.text),
    '50 fps apart with 8 fps SDs over ten shots');
  check('  with no SDs recorded it declines to judge',
    fitPowderTemp([{ tempF: 35, mvFps: 2760 }, { tempF: 85, mvFps: 2810 }]).confident === null,
    'silence rather than a guess');
}

console.log('\ngrading the powder');
{
  const stable = fitPowderTemp([{ tempF: 30, mvFps: 2795 }, { tempF: 90, mvFps: 2807 }]);
  check('  a stable powder is called stable', /temperature-stable/.test(stable.text),
    `${stable.fpsPerF} fps/°F`);
  const sensitive = fitPowderTemp([{ tempF: 30, mvFps: 2700 }, { tempF: 90, mvFps: 2790 }]);
  check('  a sensitive one is called sensitive', /Sensitive/.test(sensitive.text),
    `${sensitive.fpsPerF} fps/°F`);
  check('  and warns which way a cold morning goes',
    /land low/.test(sensitive.text));
}

console.log('\napplying it');
{
  check('  correcting to a colder day slows the load',
    velocityAt({ mvFps: 2800, refTempF: 70, tempF: 30, fpsPerF: 0.8 }) === 2768,
    '40 degrees colder at 0.8 fps/°F is 32 fps');
  check('  and to a hotter one speeds it up',
    velocityAt({ mvFps: 2800, refTempF: 70, tempF: 100, fpsPerF: 0.8 }) === 2824);
  check('  at the reference temperature nothing changes',
    velocityAt({ mvFps: 2800, refTempF: 70, tempF: 70, fpsPerF: 0.8 }) === 2800);
  check('  anything missing yields nothing',
    velocityAt({ mvFps: 2800, tempF: 30, fpsPerF: 0.8 }) === null,
    'a reference temperature is not optional — assuming 59°F would move the baseline');
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
