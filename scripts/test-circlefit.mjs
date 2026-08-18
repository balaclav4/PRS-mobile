/**
 * Validates fitting the printed bull as a scale reference.
 *
 * The property that matters is not that a circle can be fitted - three points
 * always give one - but that the mode knows when it is being lied to. A circle
 * photographed off-axis is an ellipse, and a circle carries no perspective
 * information with which to undo that. So the tests below spend most of their
 * effort on synthetic ellipses at known tilts, checking that the reported
 * obliquity tracks the real one and that the refusal threshold lands where the
 * error stops being tolerable.
 *
 * Run: node scripts/test-circlefit.mjs
 */
import {
  fitCircle, circleQuality, circleQuad, scaleErrorPct,
  BULL_PRESETS, makeBullPreset, allBullPresets,
} from '../lib/circlefit.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(58) + detail);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/** n points around a circle, optionally foreshortened to simulate tilt. */
const ring = (cx, cy, r, n, { tiltDeg = 0, from = 0, span = 360, jitter = 0 } = {}) => {
  const k = Math.cos(tiltDeg * Math.PI / 180);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (from + (span * i) / n) * Math.PI / 180;
    out.push({
      x: cx + r * Math.cos(a) + (i % 2 ? jitter : -jitter),
      y: cy + r * Math.sin(a) * k,
    });
  }
  return out;
};

console.log('fitting');
{
  const f = fitCircle(ring(300, 220, 85, 3));
  check('  three taps recover the circle', f && near(f.cx, 300, 0.01) && near(f.cy, 220, 0.01) && near(f.radius, 85, 0.01),
    f ? `centre ${f.cx.toFixed(1)},${f.cy.toFixed(1)} r ${f.radius.toFixed(2)}` : 'no fit');
  check('  and say so, because three always fit exactly', f.exact === true);

  const f8 = fitCircle(ring(300, 220, 85, 8));
  check('  eight taps recover it too', near(f8.radius, 85, 0.01) && f8.exact === false);

  check('  collinear taps are refused', fitCircle([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }]) === null,
    'no circle passes through three points on a line');
  check('  duplicate taps are refused', fitCircle([{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }]) === null);
  check('  too few taps are refused', fitCircle([{ x: 0, y: 0 }, { x: 9, y: 3 }]) === null);
  check('  junk coordinates are dropped',
    fitCircle([{ x: 0, y: 0 }, { x: NaN, y: 3 }, { x: 9, y: 9 }]) === null, 'two survivors is not enough');

  // Image coordinates are large and the variation across a bull is small, which
  // is where a naive normal-equation solve loses its precision.
  const far = fitCircle(ring(3000, 4000, 40, 6));
  check('  stays accurate far from the origin', near(far.cx, 3000, 0.01) && near(far.radius, 40, 0.01),
    `r ${far.radius.toFixed(3)} at 3000,4000`);
}

console.log('\nnoise on the taps');
{
  const f = fitCircle(ring(300, 220, 85, 6, { jitter: 1.5 }));
  check('  a wobbly hand still lands within a percent', near(f.radius, 85, 1.2),
    `r ${f.radius.toFixed(2)} from taps +/-1.5px`);
  check('  and the residual is small enough to pass', circleQuality(f).ok, `rms ${(f.rmsError * 100).toFixed(1)}%`);
}

console.log('\nknowing when it is being lied to');
{
  // The whole point of the mode. A circle seen at t degrees is an ellipse with
  // its minor axis scaled by cos(t), and no circle fit can undo that.
  console.log('  tilt   rms    reported   verdict');
  for (const t of [0, 10, 20, 25, 30, 40]) {
    const f = fitCircle(ring(300, 220, 85, 8, { tiltDeg: t }));
    const q = circleQuality(f);
    const m = /(\d+) degrees/.exec(q.text);
    console.log(
      `  ${String(t).padStart(3)}째${(f.rmsError * 100).toFixed(1).padStart(7)}%` +
      `${(m ? m[1] + '째' : '-').padStart(11)}   ${q.level}`
    );
  }

  check('  square-on is called good', circleQuality(fitCircle(ring(300, 220, 85, 8))).level === 'good');
  check('  a mild tilt is flagged but allowed', (() => {
    const q = circleQuality(fitCircle(ring(300, 220, 85, 8, { tiltDeg: 20 })));
    return q.ok === true && q.level === 'tilted';
  })());
  check('  a heavy tilt is refused outright', (() => {
    const q = circleQuality(fitCircle(ring(300, 220, 85, 8, { tiltDeg: 35 })));
    return q.ok === false && q.level === 'oblique';
  })());
  check('  and the refusal names the honest alternative',
    /four-corner/.test(circleQuality(fitCircle(ring(300, 220, 85, 8, { tiltDeg: 35 }))).text),
    'four corners recover perspective; a circle cannot');

  // Three taps cannot detect this at all, and must not claim to.
  const three = circleQuality(fitCircle(ring(300, 220, 85, 3, { tiltDeg: 35 })));
  check('  three taps on an oblique bull do not claim it is round',
    three.level === 'unchecked' && /nothing here can tell/.test(three.text),
    'a zero residual from three points is arithmetic, not evidence');
}

console.log('\ntaps bunched on one side');
{
  const q = circleQuality(fitCircle(ring(300, 220, 85, 4, { span: 90 })));
  check('  a short arc is refused', q.ok === false && q.level === 'arc');
  check('  and says how much of the rim was covered', /\d+ degrees of the rim/.test(q.text));

  // Two numbers, because they answer different questions. Reporting the span
  // back for evenly spread taps reads as though a quarter of the rim were
  // missed, which is what the first version of the capture screen printed.
  const even = fitCircle(ring(300, 220, 85, 4));
  check('  four taps at the compass points leave a 90 degree gap',
    even.maxGapDeg === 90, `gap ${even.maxGapDeg}째, span ${even.arcSpanDeg}째`);
  check('  and that is a well covered bull', circleQuality(even).ok === true);
  const bunched = fitCircle(ring(300, 220, 85, 4, { span: 90 }));
  check('  bunched taps leave a gap most of the way round',
    bunched.maxGapDeg > 180, `gap ${bunched.maxGapDeg}째`);
  // ring() places n points at from + span*i/n for i < n, so the last one lands
  // at span*(n-1)/n. 250 with five points spans 200 degrees; asking for 200
  // here spans 160 and is correctly refused, which is what the first version of
  // this check tripped over.
  check('  half the rim is enough to proceed',
    circleQuality(fitCircle(ring(300, 220, 85, 5, { span: 250 }))).ok === true);
}

console.log('\njoining the existing pipeline');
{
  const f = fitCircle(ring(300, 220, 85, 5));
  const quad = circleQuad(f);
  check('  a bull becomes its bounding square', quad.length === 4);
  check('  ordered top-left, top-right, bottom-right, bottom-left',
    quad[0].x < quad[1].x && quad[1].y < quad[2].y && quad[3].x < quad[2].x);
  check('  sized to the diameter, so refW equals refH',
    near(quad[1].x - quad[0].x, 2 * f.radius, 0.01) && near(quad[2].y - quad[1].y, 2 * f.radius, 0.01),
    `${(2 * f.radius).toFixed(1)}px square`);
  check('  centred on the bull, which is also the aim point',
    near((quad[0].x + quad[2].x) / 2, f.cx, 0.01) && near((quad[0].y + quad[2].y) / 2, f.cy, 0.01),
    'no need to assume the aim was the centre of a marked rectangle');
  check('  nothing to fit means nothing to hand on', circleQuad(null) === null);
}

console.log('\npresets');
{
  check('  only sizes printed on the packaging are offered',
    BULL_PRESETS.every(p => /Shoot-N-C/.test(p.label) && p.inches > 0),
    `${BULL_PRESETS.length} Shoot-N-C sizes, no guessed competition ring diameters`);
  check('  and they are distinct', new Set(BULL_PRESETS.map(p => p.inches)).size === BULL_PRESETS.length);

  // What the shooter measures themselves, which is the only competition-face
  // dimension this app is willing to hold.
  check('  a measured preset needs a name', makeBullPreset({ inches: 24 }) === null,
    '"24" tells nobody anything in six months');
  check('  and a diameter', makeBullPreset({ label: 'MR-1 black' }) === null);
  check('  and a believable one',
    makeBullPreset({ label: 'x', inches: 0 }) === null
    && makeBullPreset({ label: 'x', inches: 500 }) === null,
    'though 60 inch LR seven rings are real, so the cap is generous');

  const mine = makeBullPreset({ label: 'MR-1 aiming black', inches: 24 });
  check('  a complete one is kept and marked as the shooter\'s own',
    mine.inches === 24 && mine.measuredBy === 'user' && !!mine.addedAt);

  const merged = allBullPresets([mine]);
  check('  custom presets come first', merged[0].label === 'MR-1 aiming black',
    'someone who saved one has said which targets they actually shoot');
  check('  and the built-ins follow', merged.length === BULL_PRESETS.length + 1);

  const clash = allBullPresets([makeBullPreset({ label: 'My 3in bull', inches: 3 })]);
  check('  a custom entry replaces a built-in of the same size',
    clash.length === BULL_PRESETS.length && clash.filter(p => p.inches === 3).length === 1,
    'rather than two chips both reading 3"');

  check('  no custom presets means the built-in list, unchanged',
    allBullPresets().length === BULL_PRESETS.length && allBullPresets(null).length === BULL_PRESETS.length);
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
