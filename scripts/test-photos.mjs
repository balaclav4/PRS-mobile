/**
 * The detector against real photographs.
 *
 * These four are the shooter's own targets, cropped so no handwritten load
 * notes or dates are published and stripped of EXIF, which on the originals
 * carried the date and would have carried the coordinates of the range.
 *
 * There is no per-hole ground truth here, so most of this reports rather than
 * asserts. What it does assert is the things that must hold whatever the true
 * hole positions are: that scoping the search to the marked target reduces the
 * count, that a supplied shot count is honoured, and that the detector never
 * invents a shot to reach a number it was given. Counting by eye and then
 * asserting my own count would be measuring my patience, not the detector.
 *
 * Run: node scripts/test-photos.mjs
 */
import fs from 'fs';
import { PNG } from 'pngjs';
import { toGrayscale, detectShots, expandPolygon, pointInPolygon } from '../lib/detect.js';
import { rimFit, rimQuality } from '../lib/rimfit.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(52) + detail);
};

function load(path) {
  const png = PNG.sync.read(fs.readFileSync(path));
  return { gray: toGrayscale(png.data, png.width, png.height), w: png.width, h: png.height };
}

/**
 * Each photo, with the region a shooter would have marked and the hole radius
 * the caliber and scale imply. Counts are what I could make out by eye and are
 * recorded as approximate on purpose: on the tight cluster in the pair target
 * I could not tell three impacts from four at full resolution, because the
 * information is not in the image. The shooter knew.
 */
const PHOTOS = [
  {
    file: 'test-images/04-nra-six-bull.png',
    what: 'NRA six-bull, clean white, held up',
    // The lower-middle bull, which holds a group.
    region: [{ x: 415, y: 500 }, { x: 610, y: 500 }, { x: 610, y: 690 }, { x: 415, y: 690 }],
    radiusPx: 6,
    approxShots: 6,
  },
  {
    file: 'test-images/05-nra-busy-background.png',
    what: 'NRA on a bench, grass and tarp behind',
    region: [{ x: 355, y: 320 }, { x: 610, y: 330 }, { x: 605, y: 560 }, { x: 350, y: 550 }],
    radiusPx: 7,
    approxShots: 8,
  },
  {
    file: 'test-images/06-splatter-shootnc.png',
    what: 'Shoot-N-C splatter, single bull',
    region: [{ x: 105, y: 90 }, { x: 620, y: 90 }, { x: 620, y: 610 }, { x: 105, y: 610 }],
    radiusPx: 11,
    approxShots: 6,
  },
  {
    file: 'test-images/07-splatter-pair.png',
    what: 'Two Shoot-N-C on one sheet',
    region: [{ x: 130, y: 150 }, { x: 340, y: 150 }, { x: 340, y: 360 }, { x: 130, y: 360 }],
    radiusPx: 6,
    approxShots: 3,
  },
];

console.log('photo                                    whole  scoped  +count   approx');
console.log('─'.repeat(76));

const rows = [];
for (const p of PHOTOS) {
  if (!fs.existsSync(p.file)) { console.log(`  (missing ${p.file})`); continue; }
  const { gray, w, h } = load(p.file);
  const region = expandPolygon(p.region, 1.15);

  const whole = detectShots(gray, w, h, { radiusPx: p.radiusPx }).shots.length;
  const scoped = detectShots(gray, w, h, { radiusPx: p.radiusPx, region });
  const counted = detectShots(gray, w, h, {
    radiusPx: p.radiusPx, region, expectedShots: p.approxShots,
  });

  rows.push({ p, whole, scoped, counted, gray, w, h, region });
  console.log(
    p.what.padEnd(40) +
    String(whole).padStart(6) + String(scoped.shots.length).padStart(8) +
    String(counted.shots.length).padStart(8) + String(p.approxShots).padStart(9)
  );
}

console.log('\nwhat must hold regardless of the true hole positions');
for (const r of rows) {
  const tag = '  ' + r.p.what.slice(0, 30);
  check(`${tag}: scoping never adds detections`, r.scoped.shots.length <= r.whole,
    `${r.whole} -> ${r.scoped.shots.length}`);
  check(`${tag}: every shot is inside the marked region`,
    r.scoped.shots.every(s => pointInPolygon(s.x, s.y, r.region)));
  check(`${tag}: a count is never exceeded`,
    r.counted.shots.length <= r.p.approxShots,
    `${r.counted.shots.length} of ${r.p.approxShots}`);
  check(`${tag}: the kept shots are the highest scoring`,
    r.counted.shots.every(s =>
      r.scoped.shots.filter(o => o.score > s.score).length < r.p.approxShots));
}

// ---------------------------------------------------------------------------
// Printed furniture outranks real holes
// ---------------------------------------------------------------------------
// The finding that decides whether a shot count is any use.
//
// A printed mark is manufactured and a bullet hole is torn, so the printed mark
// is the rounder, more symmetric, higher-contrast blob of the two. Ranking by
// score therefore promotes furniture. Measured here: on the Shoot-N-C, five of
// the six highest-scoring detections are printed lettering - both o's of
// "Birchwood", a letter of "Casey", the 8 and the 9 - all polarity -1, scoring
// 0.79 to 0.83, and not one of the four obvious impacts survived. On the clean
// NRA bull the single highest-scoring detection in the image, at 0.99, is the
// printed white centre dot.
//
// So a shot count does not rescue these photographs on its own. It cuts the
// list to n and concentrates the error into it. The count only becomes useful
// once printed furniture is rejected first, which is what the colour route in
// detect.js is for.
//
// The boxes below are printed marks that cannot ever hold a shot. They are
// stable features of the target, not of one photograph.
const FURNITURE = {
  'test-images/06-splatter-shootnc.png': [
    { name: '"Birchwood Casey" lettering', x0: 280, y0: 145, x1: 665, y1: 215 },
    { name: 'the printed 8', x0: 148, y0: 498, x1: 212, y1: 562 },
    { name: 'the printed 9', x0: 276, y0: 492, x1: 340, y1: 556 },
  ],
  'test-images/04-nra-six-bull.png': [
    { name: 'the printed centre dot', x0: 478, y0: 498, x1: 522, y1: 542 },
  ],
};

console.log('\nprinted furniture outranks real holes (reported, not asserted)');
{
  let hits = 0, total = 0;
  for (const r of rows) {
    const boxes = FURNITURE[r.p.file];
    if (!boxes) continue;
    for (const b of boxes) {
      const on = r.counted.shots.filter(s => s.x >= b.x0 && s.x <= b.x1 && s.y >= b.y0 && s.y <= b.y1);
      total++;
      if (on.length) {
        hits++;
        console.log(`  - ${r.p.what.slice(0, 26).padEnd(28)}${on.length} detection(s) on ${b.name}`);
      }
    }
  }
  if (hits === 0) {
    failures++;
    console.log('✗ no detections land on printed furniture — the finding is stale, update this block');
  } else {
    console.log(`  ${hits} of ${total} printed marks are being reported as shots`);
  }
}

// ---------------------------------------------------------------------------
// Two taps onto the printed bull
// ---------------------------------------------------------------------------
// Truth radii are measured, not eyeballed: a horizontal scan through each bull,
// reading where the intensity crosses mid-grey. The first version of this block
// used radii read off a resized grid by eye and they were wrong by 20px, which
// made a correct fit look like a 9.5px error.
//
// That mistake taught something worth keeping. An NRA 50ft face is concentric:
// the black disc is r=43, and there are printed rings at r=74 and beyond. A tap
// at r=68 is genuinely pointing at the r=74 ring, and the fit returning 72 was
// right. Which circle gets measured is the shooter's choice, expressed by where
// they put the edge tap, and the mode has to honour that rather than assume the
// black disc is always what was meant.
//
// What is asserted is the property that makes the feature worth having: the
// answer is closer to the rim than the taps that seeded it, or it declines.
console.log('\ntwo taps onto a printed bull');
{
  const RIM = [
    { file: 'test-images/07-splatter-pair.png', centre: { x: 203, y: 210 }, tapR: 114, truth: 122, what: 'Shoot-N-C, left bull' },
    { file: 'test-images/07-splatter-pair.png', centre: { x: 759, y: 218 }, tapR: 117, truth: 122, what: 'Shoot-N-C, right bull' },
    { file: 'test-images/04-nra-six-bull.png', centre: { x: 502, y: 516 }, tapR: 37, truth: 41, what: 'NRA bottom-mid, black disc' },
    { file: 'test-images/04-nra-six-bull.png', centre: { x: 502, y: 212 }, tapR: 47, truth: 43, what: 'NRA top-mid, black disc' },
    { file: 'test-images/04-nra-six-bull.png', centre: { x: 502, y: 212 }, tapR: 70, truth: 74, what: 'NRA top-mid, outer ring' },
  ];

  for (const c of RIM) {
    if (!fs.existsSync(c.file)) continue;
    const { gray, w, h } = load(c.file);
    const fit = rimFit(gray, w, h, {
      centre: c.centre, edge: { x: c.centre.x + c.tapR, y: c.centre.y },
    });
    const tag = '  ' + c.what.slice(0, 24);
    check(`${tag}: returns something usable`, !!fit && rimQuality(fit).ok !== undefined,
      fit ? (fit.measured ? `measured a=${fit.a.toFixed(1)}` : `fell back (${fit.rejected || 'no rim'})`) : 'null');
    if (!fit) continue;

    if (fit.measured) {
      check(`${tag}: measured rim beats the tap`,
        Math.abs(fit.a - c.truth) <= Math.abs(c.tapR - c.truth) + 4,
        `tap was ${Math.abs(c.tapR - c.truth)}px out, fit is ${Math.abs(fit.a - c.truth).toFixed(1)}px out`);
    } else {
      check(`${tag}: a refused fit returns the taps unchanged`,
        Math.abs(fit.a - c.tapR) < 0.01 && fit.axisRatio === 1,
        'never a half-measured answer');
    }
  }

  // The Shoot-N-C is the case this was built for: one dominant high-contrast
  // rim. It should be measured, not fallen back on.
  const { gray, w, h } = load('test-images/07-splatter-pair.png');
  const f = rimFit(gray, w, h, { centre: { x: 203, y: 210 }, edge: { x: 317, y: 210 } });
  check('  a clean bull is found to within 2px of a 122px truth',
    f.measured && Math.abs(f.a - 122) < 2, `a=${f.a.toFixed(1)}`);
  check('  and the whole rim is found', f.coverage >= 95, `${f.coverage}%`);
}

console.log('\nthe count is a truncation, never a fabrication');
{
  const r = rows[0];
  if (r) {
    const greedy = detectShots(r.gray, r.w, r.h, {
      radiusPx: r.p.radiusPx, region: r.region, expectedShots: 500,
    });
    check('  asking for 500 does not invent 500', greedy.shots.length < 500,
      `${greedy.shots.length} found, ${greedy.short} short of the number asked for`);
    check('  and it says how far short it fell', greedy.short === 500 - greedy.shots.length);
    check('  asking for fewer reports what was dropped',
      detectShots(r.gray, r.w, r.h, { radiusPx: r.p.radiusPx, region: r.region, expectedShots: 1 })
        .dropped === r.scoped.shots.length - 1);
    check('  no count given means no truncation and no claim',
      r.scoped.expected === null && r.scoped.dropped === 0);
  }
}

console.log('\n' + (failures === 0 ? 'all checks passed' : `${failures} check(s) failed`));
process.exit(failures === 0 ? 0 : 1);
