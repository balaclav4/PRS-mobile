/**
 * Derives E[extreme spread] / sigma for n shots from a circular normal.
 *
 * These factors have no closed form for n > 2, so they are estimated by
 * simulation. This script exists so the table embedded in lib/groupsize.js has
 * a stated provenance and can be re-derived rather than trusted: run it and the
 * numbers should reproduce, because the RNG is seeded.
 *
 * Why the table is needed at all: extreme spread grows with shot count, so a
 * 3-shot group and a 10-shot group are not measurements of the same thing.
 * Averaging them, which the analytics screen did, mixes quantities. Dividing
 * each by its own factor recovers an estimate of sigma, which is comparable
 * across shot counts, and multiplying back by the factor for a reference count
 * expresses it as a group size a shooter recognises.
 *
 * Run: node scripts/derive-es-factors.mjs
 */
const N = 400000;

// mulberry32. The LCG used first here biased E[ES]/sigma at n=2 to 1.8034
// against the exact sqrt(pi) = 1.7725, 1.75% high at 400k samples, which is far
// outside sampling error: consecutive values of a weak LCG are correlated and
// Box-Muller consumes them in pairs. Every factor in the table would have
// carried that bias.
let seed = 1234567 >>> 0;
const rnd = () => {
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
// Box-Muller, both values used so the stream is not half wasted.
let spare = null;
function gauss() {
  if (spare !== null) { const v = spare; spare = null; return v; }
  const u = Math.sqrt(-2 * Math.log(rnd() + 1e-12));
  const t = 2 * Math.PI * rnd();
  spare = u * Math.sin(t);
  return u * Math.cos(t);
}

function meanES(n) {
  let sum = 0;
  const xs = new Float64Array(n), ys = new Float64Array(n);
  for (let k = 0; k < N; k++) {
    for (let i = 0; i < n; i++) { xs[i] = gauss(); ys[i] = gauss(); }
    let max = 0;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const d = Math.hypot(xs[i] - xs[j], ys[i] - ys[j]);
        if (d > max) max = d;
      }
    sum += max;
  }
  return sum / N;
}

console.log(`E[extreme spread] / sigma, ${N.toLocaleString()} groups per shot count\n`);
console.log('  n     factor');
const table = {};
for (let n = 2; n <= 20; n++) {
  const f = meanES(n);
  table[n] = +f.toFixed(4);
  console.log(`  ${String(n).padStart(2)}    ${f.toFixed(4)}`);
}

// n = 2 is the one case with a closed form: the distance between two
// independent bivariate normals is Rayleigh with scale sigma*sqrt(2), so the
// mean is sigma*sqrt(2)*sqrt(pi/2) = sigma*sqrt(pi).
const exact2 = Math.sqrt(Math.PI);
console.log(`\n  check n=2 against the closed form sqrt(pi) = ${exact2.toFixed(4)}`);
console.log(`  simulated ${table[2].toFixed(4)}, off by ${(Math.abs(table[2] - exact2) / exact2 * 100).toFixed(2)}%`);

console.log('\nas a literal for lib/groupsize.js:\n');
console.log('const ES_OVER_SIGMA = {');
for (let n = 2; n <= 20; n += 5) {
  const row = [];
  for (let k = n; k < Math.min(n + 5, 21); k++) row.push(`${k}: ${table[k]}`);
  console.log('  ' + row.join(', ') + ',');
}
console.log('};');
