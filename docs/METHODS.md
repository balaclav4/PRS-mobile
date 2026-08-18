# Methods and provenance

Where every equation, table and constant in this app comes from.

Written because a number with no stated origin is the most dangerous thing in a
tool like this. It looks authoritative, it survives review because it is only a
number, and when it is wrong nothing fails: the app just reports a slightly
incorrect answer forever, and the shooter trues their load against it.

Each entry says which of four things it is:

- **Named method** - a published technique, used by name. The method is the
  contribution of whoever devised it; implementing it from the description is
  ordinary practice, and naming them is the point.
- **Public-domain data** - reference tables that belong to nobody.
- **Derived** - worked out here from first principles, with the derivation in
  the source file.
- **Measured** - produced by simulation in this repository, by a script that is
  committed so it can be re-run rather than trusted.

## On sources, plainly

Three ballistics books were shared with me during development. I did not
transcribe from them, and nothing here is copied text, tables or measured data.
What the app uses are the standard published *methods*, which are named below
and are described in many places. The distinction that matters:

- **Miller's twist rule, Litz's spin-drift and aerodynamic-jump forms, McCoy's
  Coriolis treatment** are methods. They are named in the source, used as
  described, and their stated limitations are carried into the app rather than
  hidden. `aerodynamicJump` refuses to give a confident answer outside the
  stability band its fit was built around, because that is what its author says
  about it.
- **Measured ballistic coefficients for specific bullets** are somebody's
  laboratory product, and are deliberately absent. The app takes BC as an input
  from the box, and `trueBC` solves it backwards from the shooter's own dope,
  which is a better number for their rifle than any published figure.
- **The G1 and G7 drag functions** are neither. They are century-old
  reference-projectile curves in the public domain, tabulated identically
  everywhere, describing two imaginary standard projectiles rather than any real
  bullet.

## Exterior ballistics

| What | Where | Kind |
|---|---|---|
| G1 / G7 drag tables | `lib/ballistics.js` | Public-domain data. Gavre Commission and US Army BRL reference drag functions. Anchor values asserted in `test-ballistics.mjs`: G1 is 0.2629 at Mach 0 and peaks at 0.6625 near Mach 1.4; G7 is 0.1198 at Mach 0 and peaks at 0.4043 near Mach 1.05. |
| Point-mass integration | `lib/ballistics.js` | Named method. Standard flat-fire point-mass equations of motion, integrated against the drag table. |
| Standard atmosphere, density ratio, speed of sound | `lib/ballistics.js`, `lib/effects.js` | Named method. ICAO standard atmosphere; density ratio exponent 4.2559. |
| Pressure altitude, density altitude | `lib/zeroing.js` | Named method. `DA = PA + 120 x (OAT - ISA)`, the standard field approximation. |
| BC truing | `lib/ballistics.js` | Derived. Solves BC backwards from observed dope by bisection. |
| Gyroscopic stability | `lib/effects.js` | Named method: Miller's twist rule, with the usual velocity and air-density corrections. |
| Spin drift | `lib/effects.js` | Named method: Litz's closed form, `1.25 x (Sg + 1.2) x TOF^1.83`. Recorded in the source as an empirical fit, not a derivation. |
| Aerodynamic jump | `lib/effects.js` | Named method: Litz's fit in MOA per mph. Its limitation is enforced in code - outside roughly Sg 1.3 to 2.3 it returns `reliable: false` and the screen says so instead of printing a number. |
| Coriolis, horizontal and Eotvos | `lib/effects.js` | Named method. Flat-fire Coriolis as in McCoy. Exact physics rather than a fit, and the source says which is which. |
| Custom drag curves | `lib/dragfn.js` | Derived plumbing, **no data shipped**. The app parses and stores a curve the shooter supplies and records where it came from; it ships none of its own. A measured Cd already contains the form factor, so it is divided by sectional density rather than by BC. `test-dragfn.mjs` checks the two paths agree: a curve `i x Cd_G7` carried at `SD = i x BC` reproduces the BC solve to 0.1 inch at 1000 yards. |
| Sectional density | `lib/dragfn.js` | Definition. `SD = (grains / 7000) / d^2`, in lb/in^2. |
| Implied BC across Mach | `lib/dragfn.js` | Derived. `BC(M) = SD / (Cd(M) / Cd_std(M))`, which is the definition rearranged. Drawn because the answer moves: it is what a single quoted BC is averaging over. |

## Statistics

| What | Where | Kind |
|---|---|---|
| Welch's t-test | `lib/stats.js` | Named method. |
| F-test for variance | `lib/stats.js` | Named method. |
| Clopper-Pearson exact binomial bounds | `lib/refload.js` | Named method. Chosen over Wilson after measuring that Wilson is anti-conservative at k = n, where it collapses to `n/(n+z^2)` and claimed 25 hits confirmed 90% when the exact answer needs 29. |
| Wilson score interval | `lib/refload.js` | Named method, display only, for the reason above. |
| Rayleigh sigma, CEP | `lib/stats.js` | Named method. |
| Lanczos gamma, incomplete beta and gamma | `lib/stats.js` | Named method. Standard numerical recipes; coefficients are the published Lanczos set. |
| Acklam's inverse normal CDF | `lib/stats.js` | Named method. |
| Best-of-k selection bias | `lib/seating.js` | Named method: Blom's approximation to expected order statistics. |
| Bootstrap difference | `lib/stats.js` | Named method. Seeded so a result is reproducible. |
| Group-size trend | `lib/trend.js` | Derived. Least squares on log group size against session index, with a confidence interval on the slope. Simulated in `test-trend.mjs`: claims a direction 8.7% of the time for a shooter who has not changed, against 50% for the rule it replaced. |
| E[extreme spread] / sigma by shot count | `lib/groupsize.js` | **Measured.** No closed form above n = 2. Simulated by `scripts/derive-es-factors.mjs`, 400,000 groups per shot count, mulberry32. Checked against the one case with a closed form: two bivariate normals are separated by a Rayleigh variate, so the mean is `sigma x sqrt(pi)` = 1.7725, and the table reproduces it to 0.03%. |

## Vision and geometry

| What | Where | Kind |
|---|---|---|
| Homography from four points (DLT) | `lib/homography.js` | Named method. |
| Centre-surround blob detection | `lib/detect.js` | Named method. Difference-of-boxes approximation to a Laplacian of Gaussian, via integral images. |
| Distance-transform splitting of merged holes | `lib/detect.js` | Derived. |
| Algebraic circle fit | `lib/circlefit.js` | Named method: Kasa. Its known bias on short arcs is noted, and `arcSpanDeg` refuses fits that would suffer from it. |
| Ellipse fit about a known centre | `lib/rimfit.js` | Derived. Polar form is linear in three coefficients, so it is an ordinary least squares solve rather than an eigenvalue problem; the 2x2 eigen-decomposition is closed form. |
| Obliquity from an ellipse | `lib/rimfit.js` | Derived. The axis ratio is `cos t` directly. |
| Scale-error from a circle-fit residual | `lib/circlefit.js` | Derived, and corrected after being wrong. The first version inverted `(1 - cos t)/2` and under-read a 30 degree tilt as 26. The correct relation is residual `(1-k)/(1+k)` for semi-axes `a` and `ak`, RMS about that over root two. Checked against synthetic ellipses at 15, 25, 30 and 40 degrees. |

## Units and conventions

| What | Where | Kind |
|---|---|---|
| 1 MOA = 1.047 inches per 100 yd | `lib/units.js`, `lib/analytics.js` | Derived. `2 x 100yd x 36 x tan(1/60 degree)`. |
| 1 mil = 3.6 inches per 100 yd | `lib/units.js` | Derived. |
| Rec. 709 luma | `lib/detect.js` | Named standard. |
| Inch, yard, foot, grain conversions | `lib/units.js` | Definitional. |

## What is not backed by anything yet

Kept here rather than in a comment nobody reads.

- **Splatter-target detection.** Measured against real photographs and recorded
  as failing: on a Shoot-N-C, five of the six best-scoring detections are
  printed lettering. `lib/detect.js` states the cause and the intended fix. The
  UI says "Suggest shots" rather than claiming to have found them.
- **Bull diameter presets** are Shoot-N-C sizes only, because those are printed
  on the packaging. Competition ring diameters are deliberately not listed: a
  guessed reference size is a scale error applied silently to every measurement
  taken from that photograph.
- **Torque figures** are entered by the shooter. The app ships no defaults,
  because a wrong torque value can damage a rifle or a scope, and the
  manufacturer's figure is the only one worth having.
- **Rim fitting when shots land on the rim.** Measured on a real NRA 50ft
  sheet: of four bulls in one photograph, the two with clean rims fitted at
  100% coverage and read square-on; the two with holes broken through the
  printed edge read 54 and 55 degrees off-axis, which the photograph is not.
  Refused rather than worked around, so it costs a refusal rather than a silent
  scale error. `lib/rimfit.js` records the cause and the fix if it matters.
- **Bullet BCs.** None are shipped. The BC is typed from the box or trued from
  the shooter's own dope, and the screen distinguishes the two. A library of
  published BCs is wanted and is not here, because the catalogued sets belong
  to whoever measured them.
- **Target dimensions.** Ring diameters for competition faces are still not
  listed. The rulebooks are the right source and the PDFs would not fetch, so
  the numbers were never read. Nothing was estimated in the meantime.

## Where free data can actually come from

Checked 11 Aug 2026, because "it is on the internet" and "we may ship it" are
different questions and the second one is the one that matters.

**Usable, and already used or worth using.**

| Source | Status | What it gives |
|---|---|---|
| G1, G2, G5–G8, GI, RA4 standard drag functions | US Army BRL — US Government work, public domain | The reference drag curves. All eight shipped in `lib/ballistics.js` as of 16 Aug 2026; before that only G1 and G7, so a BC quoted against any other model had nowhere to go. |
| US Standard Atmosphere 1976 | NOAA / NASA / USAF, public domain | The atmosphere model already in use. |
| MCRP 3-01A | US Marine Corps, public domain | Field method for wind, ranging and holds. Quotable **with citation**, unlike the commercial titles. |
| NOAA/NCEI World Magnetic Model | Public domain, reissued every five years | Magnetic declination. Wanted because Coriolis needs a *true* azimuth and a shooter reads a magnetic one off a compass — currently the app just asks and hopes. |
| DTIC / BRL technical reports (McCoy and others) | US Government works, public domain | Measured drag data for standard and military projectiles, and the derivations behind the fits this app uses. |
| McDrag (McCoy, Dec 1974, BRL) | US Government work, public domain | A drag curve from the bullet's measured shape, with no ballistic coefficient anywhere. Ported line by line from McCoy's published listing into `lib/mcdrag.js` on 16 Aug 2026, original line numbers kept in the comments. Validated against the G1 and G7 tables, which it never sees: a boat-tail shape lands on G7 at i = 0.96 with 3.4% variation across Mach 1-3, a flat-base shape on G1 at 0.81. It is an estimate from geometry, not a measurement, and McCoy's own diagnostics for the shapes it was not fitted to are reproduced rather than dropped. |

**Not ours to ship, whatever the wording elsewhere.**

- **Lapua radar curves.** Free to download and use in ballistics software, and the
  intended source for `lib/dragfn.js`. But the redistribution permission that
  exists is a specific grant to a specific vendor, not a general licence — so
  the app must not carry the files. This is exactly why import exists: the
  shooter downloads from Lapua and imports, and the curve is stored with its
  source recorded. That design was right for a better reason than we knew.
- **JBM's bullet library** — all rights reserved. Note the line drawn on
  16 Aug 2026 when the six extra drag models were added: the standard drag
  *tables* were transcribed from files JBM publishes, and that is fine, because
  they are BRL's public-domain government product and copying a public-domain
  table does not create rights in it. JBM's own compilations — the bullet
  library and the bullet-length list — are a different thing and stay out. The
  length list is the tempting one, since bullet length is exactly the input
  Miller's Sg needs and the figure shooters least often have. It is still
  theirs.
- **Applied Ballistics data** — all rights reserved, stated on their own papers.
- **Manufacturer BC tables** — individual figures are facts, but the tables are
  compilations and scraping one is taking the compilation. Ask, or let the
  shooter type the number off the box.
- **SAAMI and CIP cartridge dimensions.** These are the authority for case
  length, trim-to length and the headspace datum diameter, and headspace gauges
  are cut to them. SAAMI's standards carry "all rights reserved"; the CIP
  tables are widely mirrored on document-sharing sites, which is not the same
  as being licensed. So the measurement guides now *name* the standards and say
  a specified figure exists for the shooter's cartridge, without reproducing
  any of it. Pointing at a standard is not copying it.

The pattern: ship the *method*, import the *data*. Everything in the first table
is a method or a government dataset; everything in the second is somebody's
measurement programme, and the app already has the machinery to accept it from
whoever is entitled to hand it over.

## Provenance of what ships

Audited rather than assumed, on 2026-08-10.

Every data table in `lib/` now states what kind of numbers it holds and where
they came from. The audit found one gap, `lib/calibers.js`, which had a table
of bullet diameters and no note; those are definitional rather than measured
and the file now says so.

The only route by which outside data enters the app is a drag curve the
shooter imports, and `makeDragFunction` refuses one that does not carry a
source. That is the whole of it today. When a BC library or a target dimension
set does arrive, each entry needs the same field before it is stored, so that
this document stays true rather than becoming a description of what was once
the case.
