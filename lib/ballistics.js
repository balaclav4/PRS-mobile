import { secondaryEffects } from './effects.js';
import { inclinedDrop } from './incline.js';

/**
 * Point-mass trajectory solver on the standard G1/G7 drag models.
 *
 * The previous dope card used a single exponential decay with a hand-tuned
 * fudge factor. That is fine to about 300 yards and increasingly wrong past it,
 * because real drag is strongly non-linear through the transonic region — Cd
 * roughly triples between Mach 0.9 and Mach 1.0 on G7. A model that misses that
 * cannot be trusted where the dope actually matters.
 *
 * This integrates the equations of motion against the published drag tables
 * instead, so transonic behaviour comes out of the data rather than a constant.
 *
 * Conventions: feet and ft/s internally, yards and inches at the boundary.
 */

// Standard drag tables: Cd against Mach number.
//
// G1 = flat-base reference projectile; G7 = boat-tail, the better match for
// modern long-range bullets, which is why G7 BCs stay flatter across velocity.
// Six more standard models are carried alongside them so a BC quoted against
// any of them can be used as quoted, rather than silently solved as something
// else.
//
// Provenance, because it is the line that matters here. These are standard
// reference-projectile drag curves from the US Army Ballistic Research
// Laboratory and the Gavre Commission work behind it - US Government product,
// public domain, tabulated identically in every exterior ballistics text. They
// describe imaginary standard projectiles, not any real bullet.
//
// They were transcribed from files published by JBM Ballistics on 16 Aug 2026.
// JBM asserts copyright over its site, and its bullet library is its own and is
// deliberately not used here; these tables are not JBM's to hold rights in.
// Copying a public-domain government table does not create a new one.
//
// The numbers were not typed. They were parsed from the source files and the
// literals below were generated, because a drag coefficient wrong in the third
// decimal at Mach 1.2 looks entirely plausible on a chart and would never be
// caught by eye. The shipped G1 and G7 were then diffed against the new ones as
// a cross-check and agreed to within 0.00035 - and only where the old tables
// were coarser, which is why these are now carried at full resolution.
//
// What is deliberately NOT here is measured ballistic coefficients for actual
// bullets. Those are somebody's laboratory product - Litz's in particular - and
// transcribing them would be taking the work rather than the method. The app
// does not need them: BC is an input the shooter supplies from the box, and
// trueBC solves it backwards from their own dope, which beats a published
// figure for their rifle anyway.
//
// Anchors that identify each curve are asserted in scripts/test-ballistics.mjs.
const G1 = [
  [0.0, 0.2629], [0.05, 0.2558], [0.1, 0.2487], [0.15, 0.2413], [0.2, 0.2344],
  [0.25, 0.2278], [0.3, 0.2214], [0.35, 0.2155], [0.4, 0.2104], [0.45, 0.2061],
  [0.5, 0.2032], [0.55, 0.2020], [0.6, 0.2034], [0.7, 0.2165], [0.725, 0.2230],
  [0.75, 0.2313], [0.775, 0.2417], [0.8, 0.2546], [0.825, 0.2706], [0.85, 0.2901],
  [0.875, 0.3136], [0.9, 0.3415], [0.925, 0.3734], [0.95, 0.4084], [0.975, 0.4448],
  [1.0, 0.4805], [1.025, 0.5136], [1.05, 0.5427], [1.075, 0.5677], [1.1, 0.5883],
  [1.125, 0.6053], [1.15, 0.6191], [1.2, 0.6393], [1.25, 0.6518], [1.3, 0.6589],
  [1.35, 0.6621], [1.4, 0.6625], [1.45, 0.6607], [1.5, 0.6573], [1.55, 0.6528],
  [1.6, 0.6474], [1.65, 0.6413], [1.7, 0.6347], [1.75, 0.6280], [1.8, 0.6210],
  [1.85, 0.6141], [1.9, 0.6072], [1.95, 0.6003], [2.0, 0.5934], [2.05, 0.5867],
  [2.1, 0.5804], [2.15, 0.5743], [2.2, 0.5685], [2.25, 0.5630], [2.3, 0.5577],
  [2.35, 0.5527], [2.4, 0.5481], [2.45, 0.5438], [2.5, 0.5397], [2.6, 0.5325],
  [2.7, 0.5264], [2.8, 0.5211], [2.9, 0.5168], [3.0, 0.5133], [3.1, 0.5105],
  [3.2, 0.5084], [3.3, 0.5067], [3.4, 0.5054], [3.5, 0.5040], [3.6, 0.5030],
  [3.7, 0.5022], [3.8, 0.5016], [3.9, 0.5010], [4.0, 0.5006], [4.2, 0.4998],
  [4.4, 0.4995], [4.6, 0.4992], [4.8, 0.4990], [5.0, 0.4988],
];

const G2 = [
  [0.0, 0.2303], [0.05, 0.2298], [0.1, 0.2287], [0.15, 0.2271], [0.2, 0.2251],
  [0.25, 0.2227], [0.3, 0.2196], [0.35, 0.2156], [0.4, 0.2107], [0.45, 0.2048],
  [0.5, 0.1980], [0.55, 0.1905], [0.6, 0.1828], [0.65, 0.1758], [0.7, 0.1702],
  [0.75, 0.1669], [0.775, 0.1664], [0.8, 0.1667], [0.825, 0.1682], [0.85, 0.1711],
  [0.875, 0.1761], [0.9, 0.1831], [0.925, 0.2004], [0.95, 0.2589], [0.975, 0.3492],
  [1.0, 0.3983], [1.025, 0.4075], [1.05, 0.4103], [1.075, 0.4114], [1.1, 0.4106],
  [1.125, 0.4089], [1.15, 0.4068], [1.175, 0.4046], [1.2, 0.4021], [1.25, 0.3966],
  [1.3, 0.3904], [1.35, 0.3835], [1.4, 0.3759], [1.45, 0.3678], [1.5, 0.3594],
  [1.55, 0.3512], [1.6, 0.3432], [1.65, 0.3356], [1.7, 0.3282], [1.75, 0.3213],
  [1.8, 0.3149], [1.85, 0.3089], [1.9, 0.3033], [1.95, 0.2982], [2.0, 0.2933],
  [2.05, 0.2889], [2.1, 0.2846], [2.15, 0.2806], [2.2, 0.2768], [2.25, 0.2731],
  [2.3, 0.2696], [2.35, 0.2663], [2.4, 0.2632], [2.45, 0.2602], [2.5, 0.2572],
  [2.55, 0.2543], [2.6, 0.2515], [2.65, 0.2487], [2.7, 0.2460], [2.75, 0.2433],
  [2.8, 0.2408], [2.85, 0.2382], [2.9, 0.2357], [2.95, 0.2333], [3.0, 0.2309],
  [3.1, 0.2262], [3.2, 0.2217], [3.3, 0.2173], [3.4, 0.2132], [3.5, 0.2091],
  [3.6, 0.2052], [3.7, 0.2014], [3.8, 0.1978], [3.9, 0.1944], [4.0, 0.1912],
  [4.2, 0.1851], [4.4, 0.1794], [4.6, 0.1741], [4.8, 0.1693], [5.0, 0.1648],
];

const G5 = [
  [0.0, 0.1710], [0.05, 0.1719], [0.1, 0.1727], [0.15, 0.1732], [0.2, 0.1734],
  [0.25, 0.1730], [0.3, 0.1718], [0.35, 0.1696], [0.4, 0.1668], [0.45, 0.1637],
  [0.5, 0.1603], [0.55, 0.1566], [0.6, 0.1529], [0.65, 0.1497], [0.7, 0.1473],
  [0.75, 0.1463], [0.8, 0.1489], [0.85, 0.1583], [0.875, 0.1672], [0.9, 0.1815],
  [0.925, 0.2051], [0.95, 0.2413], [0.975, 0.2884], [1.0, 0.3379], [1.025, 0.3785],
  [1.05, 0.4032], [1.075, 0.4147], [1.1, 0.4201], [1.15, 0.4278], [1.2, 0.4338],
  [1.25, 0.4373], [1.3, 0.4392], [1.35, 0.4403], [1.4, 0.4406], [1.45, 0.4401],
  [1.5, 0.4386], [1.55, 0.4362], [1.6, 0.4328], [1.65, 0.4286], [1.7, 0.4237],
  [1.75, 0.4182], [1.8, 0.4121], [1.85, 0.4057], [1.9, 0.3991], [1.95, 0.3926],
  [2.0, 0.3861], [2.05, 0.3800], [2.1, 0.3741], [2.15, 0.3684], [2.2, 0.3630],
  [2.25, 0.3578], [2.3, 0.3529], [2.35, 0.3481], [2.4, 0.3435], [2.45, 0.3391],
  [2.5, 0.3349], [2.6, 0.3269], [2.7, 0.3194], [2.8, 0.3125], [2.9, 0.3060],
  [3.0, 0.2999], [3.1, 0.2942], [3.2, 0.2889], [3.3, 0.2838], [3.4, 0.2790],
  [3.5, 0.2745], [3.6, 0.2703], [3.7, 0.2662], [3.8, 0.2624], [3.9, 0.2588],
  [4.0, 0.2553], [4.2, 0.2488], [4.4, 0.2429], [4.6, 0.2376], [4.8, 0.2326],
  [5.0, 0.2280],
];

const G6 = [
  [0.0, 0.2617], [0.05, 0.2553], [0.1, 0.2491], [0.15, 0.2432], [0.2, 0.2376],
  [0.25, 0.2324], [0.3, 0.2278], [0.35, 0.2238], [0.4, 0.2205], [0.45, 0.2177],
  [0.5, 0.2155], [0.55, 0.2138], [0.6, 0.2126], [0.65, 0.2121], [0.7, 0.2122],
  [0.75, 0.2132], [0.8, 0.2154], [0.85, 0.2194], [0.875, 0.2229], [0.9, 0.2297],
  [0.925, 0.2449], [0.95, 0.2732], [0.975, 0.3141], [1.0, 0.3597], [1.025, 0.3994],
  [1.05, 0.4261], [1.075, 0.4402], [1.1, 0.4465], [1.125, 0.4490], [1.15, 0.4497],
  [1.175, 0.4494], [1.2, 0.4482], [1.225, 0.4464], [1.25, 0.4441], [1.3, 0.4390],
  [1.35, 0.4336], [1.4, 0.4279], [1.45, 0.4221], [1.5, 0.4162], [1.55, 0.4102],
  [1.6, 0.4042], [1.65, 0.3981], [1.7, 0.3919], [1.75, 0.3855], [1.8, 0.3788],
  [1.85, 0.3721], [1.9, 0.3652], [1.95, 0.3583], [2.0, 0.3515], [2.05, 0.3447],
  [2.1, 0.3381], [2.15, 0.3314], [2.2, 0.3249], [2.25, 0.3185], [2.3, 0.3122],
  [2.35, 0.3060], [2.4, 0.3000], [2.45, 0.2941], [2.5, 0.2883], [2.6, 0.2772],
  [2.7, 0.2668], [2.8, 0.2574], [2.9, 0.2487], [3.0, 0.2407], [3.1, 0.2333],
  [3.2, 0.2265], [3.3, 0.2202], [3.4, 0.2144], [3.5, 0.2089], [3.6, 0.2039],
  [3.7, 0.1991], [3.8, 0.1947], [3.9, 0.1905], [4.0, 0.1866], [4.2, 0.1794],
  [4.4, 0.1730], [4.6, 0.1673], [4.8, 0.1621], [5.0, 0.1574],
];

const G7 = [
  [0.0, 0.1198], [0.05, 0.1197], [0.1, 0.1196], [0.15, 0.1194], [0.2, 0.1193],
  [0.25, 0.1194], [0.3, 0.1194], [0.35, 0.1194], [0.4, 0.1193], [0.45, 0.1193],
  [0.5, 0.1194], [0.55, 0.1193], [0.6, 0.1194], [0.65, 0.1197], [0.7, 0.1202],
  [0.725, 0.1207], [0.75, 0.1215], [0.775, 0.1226], [0.8, 0.1242], [0.825, 0.1266],
  [0.85, 0.1306], [0.875, 0.1368], [0.9, 0.1464], [0.925, 0.1660], [0.95, 0.2054],
  [0.975, 0.2993], [1.0, 0.3803], [1.025, 0.4015], [1.05, 0.4043], [1.075, 0.4034],
  [1.1, 0.4014], [1.125, 0.3987], [1.15, 0.3955], [1.2, 0.3884], [1.25, 0.3810],
  [1.3, 0.3732], [1.35, 0.3657], [1.4, 0.3580], [1.5, 0.3440], [1.55, 0.3376],
  [1.6, 0.3315], [1.65, 0.3260], [1.7, 0.3209], [1.75, 0.3160], [1.8, 0.3117],
  [1.85, 0.3078], [1.9, 0.3042], [1.95, 0.3010], [2.0, 0.2980], [2.05, 0.2951],
  [2.1, 0.2922], [2.15, 0.2892], [2.2, 0.2864], [2.25, 0.2835], [2.3, 0.2807],
  [2.35, 0.2779], [2.4, 0.2752], [2.45, 0.2725], [2.5, 0.2697], [2.55, 0.2670],
  [2.6, 0.2643], [2.65, 0.2615], [2.7, 0.2588], [2.75, 0.2561], [2.8, 0.2533],
  [2.85, 0.2506], [2.9, 0.2479], [2.95, 0.2451], [3.0, 0.2424], [3.1, 0.2368],
  [3.2, 0.2313], [3.3, 0.2258], [3.4, 0.2205], [3.5, 0.2154], [3.6, 0.2106],
  [3.7, 0.2060], [3.8, 0.2017], [3.9, 0.1975], [4.0, 0.1935], [4.2, 0.1861],
  [4.4, 0.1793], [4.6, 0.1730], [4.8, 0.1672], [5.0, 0.1618],
];

const G8 = [
  [0.0, 0.2105], [0.05, 0.2105], [0.1, 0.2104], [0.15, 0.2104], [0.2, 0.2103],
  [0.25, 0.2103], [0.3, 0.2103], [0.35, 0.2103], [0.4, 0.2103], [0.45, 0.2102],
  [0.5, 0.2102], [0.55, 0.2102], [0.6, 0.2102], [0.65, 0.2102], [0.7, 0.2103],
  [0.75, 0.2103], [0.8, 0.2104], [0.825, 0.2104], [0.85, 0.2105], [0.875, 0.2106],
  [0.9, 0.2109], [0.925, 0.2183], [0.95, 0.2571], [0.975, 0.3358], [1.0, 0.4068],
  [1.025, 0.4378], [1.05, 0.4476], [1.075, 0.4493], [1.1, 0.4477], [1.125, 0.4450],
  [1.15, 0.4419], [1.2, 0.4353], [1.25, 0.4283], [1.3, 0.4208], [1.35, 0.4133],
  [1.4, 0.4059], [1.45, 0.3986], [1.5, 0.3915], [1.55, 0.3845], [1.6, 0.3777],
  [1.65, 0.3710], [1.7, 0.3645], [1.75, 0.3581], [1.8, 0.3519], [1.85, 0.3458],
  [1.9, 0.3400], [1.95, 0.3343], [2.0, 0.3288], [2.05, 0.3234], [2.1, 0.3182],
  [2.15, 0.3131], [2.2, 0.3081], [2.25, 0.3032], [2.3, 0.2983], [2.35, 0.2937],
  [2.4, 0.2891], [2.45, 0.2845], [2.5, 0.2802], [2.6, 0.2720], [2.7, 0.2642],
  [2.8, 0.2569], [2.9, 0.2499], [3.0, 0.2432], [3.1, 0.2368], [3.2, 0.2308],
  [3.3, 0.2251], [3.4, 0.2197], [3.5, 0.2147], [3.6, 0.2101], [3.7, 0.2058],
  [3.8, 0.2019], [3.9, 0.1983], [4.0, 0.1950], [4.2, 0.1890], [4.4, 0.1837],
  [4.6, 0.1791], [4.8, 0.1750], [5.0, 0.1713],
];

const GI = [
  [0.0, 0.2282], [0.05, 0.2282], [0.1, 0.2282], [0.15, 0.2282], [0.2, 0.2282],
  [0.25, 0.2282], [0.3, 0.2282], [0.35, 0.2282], [0.4, 0.2282], [0.45, 0.2282],
  [0.5, 0.2282], [0.55, 0.2282], [0.6, 0.2282], [0.65, 0.2282], [0.7, 0.2282],
  [0.725, 0.2353], [0.75, 0.2434], [0.775, 0.2515], [0.8, 0.2596], [0.825, 0.2677],
  [0.85, 0.2759], [0.875, 0.2913], [0.9, 0.3170], [0.925, 0.3442], [0.95, 0.3728],
  [1.0, 0.4349], [1.05, 0.5034], [1.075, 0.5402], [1.1, 0.5756], [1.125, 0.5887],
  [1.15, 0.6018], [1.175, 0.6149], [1.2, 0.6279], [1.225, 0.6418], [1.25, 0.6423],
  [1.3, 0.6423], [1.35, 0.6423], [1.4, 0.6423], [1.45, 0.6423], [1.5, 0.6423],
  [1.55, 0.6423], [1.6, 0.6423], [1.625, 0.6407], [1.65, 0.6378], [1.7, 0.6321],
  [1.75, 0.6266], [1.8, 0.6213], [1.85, 0.6163], [1.9, 0.6113], [1.95, 0.6066],
  [2.0, 0.6020], [2.05, 0.5976], [2.1, 0.5933], [2.15, 0.5891], [2.2, 0.5850],
  [2.25, 0.5811], [2.3, 0.5773], [2.35, 0.5733], [2.4, 0.5679], [2.45, 0.5626],
  [2.5, 0.5576], [2.6, 0.5478], [2.7, 0.5386], [2.8, 0.5298], [2.9, 0.5215],
  [3.0, 0.5136], [3.1, 0.5061], [3.2, 0.4989], [3.3, 0.4921], [3.4, 0.4855],
  [3.5, 0.4792], [3.6, 0.4732], [3.7, 0.4674], [3.8, 0.4618], [3.9, 0.4564],
  [4.0, 0.4513], [4.2, 0.4415], [4.4, 0.4323], [4.6, 0.4238], [4.8, 0.4157],
  [5.0, 0.4082],
];

const RA4 = [
  [0.0, 0.2283], [0.05, 0.2283], [0.1, 0.2282], [0.15, 0.2281], [0.2, 0.2281],
  [0.25, 0.2281], [0.3, 0.2281], [0.35, 0.2281], [0.4, 0.2281], [0.45, 0.2281],
  [0.5, 0.2281], [0.55, 0.2281], [0.6, 0.2281], [0.65, 0.2281], [0.7, 0.2288],
  [0.725, 0.2296], [0.75, 0.2307], [0.775, 0.2320], [0.8, 0.2334], [0.825, 0.2359],
  [0.85, 0.2389], [0.875, 0.2480], [0.9, 0.2604], [0.925, 0.2819], [0.95, 0.3111],
  [0.975, 0.3496], [1.0, 0.3975], [1.025, 0.4530], [1.05, 0.5010], [1.075, 0.5476],
  [1.1, 0.5719], [1.125, 0.5895], [1.15, 0.5943], [1.175, 0.5933], [1.2, 0.5881],
  [1.225, 0.5810], [1.25, 0.5736], [1.275, 0.5690], [1.3, 0.5651], [1.325, 0.5629],
  [1.35, 0.5609], [1.375, 0.5591], [1.4, 0.5575], [1.425, 0.5558], [1.45, 0.5543],
  [1.475, 0.5527], [1.5, 0.5513], [1.525, 0.5499], [1.55, 0.5485], [1.575, 0.5472],
  [1.6, 0.5460], [1.625, 0.5449], [1.65, 0.5438], [1.675, 0.5428], [1.7, 0.5419],
  [1.725, 0.5410], [1.75, 0.5401], [1.775, 0.5393], [1.8, 0.5385], [1.825, 0.5377],
  [1.85, 0.5369], [1.875, 0.5361], [1.9, 0.5354], [1.925, 0.5346], [1.95, 0.5338],
  [2.0, 0.5323], [2.1, 0.5294], [2.2, 0.5267], [2.3, 0.5240], [2.4, 0.5216],
  [2.5, 0.5193], [2.6, 0.5170], [2.65, 0.5160], [2.7, 0.5149], [2.8, 0.5129],
  [2.9, 0.5109], [3.0, 0.5091], [3.1, 0.5074], [3.2, 0.5058], [3.3, 0.5043],
  [3.4, 0.5029], [3.5, 0.5017], [3.6, 0.5006], [3.7, 0.4995], [3.8, 0.4986],
  [3.9, 0.4977], [4.0, 0.4969],
];

const TABLES = { G1, G2, G5, G6, G7, G8, GI, RA4 };

/**
 * The standard models offered to the shooter, most-used first.
 *
 * The note on each says what it is for, not what its geometry is: the
 * operative fact is that a BC belongs to the model it was measured against.
 * A G1 BC driven through the G7 curve is not a rough answer, it is the wrong
 * one - the two differ by roughly a factor of two, so it will look plausible
 * at the muzzle and be badly out at distance.
 */
export const DRAG_MODELS = [
  { id: 'G7', note: 'Long boat-tail. The usual fit for modern low-drag match bullets.' },
  { id: 'G1', note: 'Flat-base reference. Most BCs printed on a box are quoted against it.' },
  { id: 'G2', note: 'Conical banded form, from artillery work.' },
  { id: 'G5', note: 'Short boat-tail.' },
  { id: 'G6', note: 'Flat-base spitzer.' },
  { id: 'G8', note: 'Flat-base with a long ogive.' },
  { id: 'GI', note: 'The old Ingalls reference, behind many pre-war tables.' },
  { id: 'RA4', note: 'Rimfire reference projectile.' },
];


/**
 * Cd for a standard drag function at a given Mach number.
 *
 * Exported so the tables themselves can be checked rather than trusted: the
 * harness asserts the anchor values that identify each curve, which is what
 * catches a transcription slip in a list of six hundred numbers nobody reads.
 *
 * This used to read `model === 'G1' ? G1 : G7`, which quietly meant that
 * anything not spelled exactly G1 was solved as G7. With two models that was
 * only reachable by typo. With eight it would be a wrong answer that never
 * announces itself - ask for G5, get G7, and the card looks fine. An unknown
 * model now throws, because there is no sane default: the whole point of the
 * model is that it is the one the BC was measured against.
 */
export function standardCd(model, mach) {
  return dragCoefficient(resolveTable(model), mach);
}

/** Look up a standard table by name, case-insensitively, or refuse. */
function resolveTable(model) {
  const table = TABLES[String(model ?? '').toUpperCase()];
  if (!table) {
    throw new Error(
      `Unknown drag model "${model}". Known models: ${Object.keys(TABLES).join(', ')}.`);
  }
  return table;
}

/** Is this a model the solver knows? For callers that want to ask rather than catch. */
export function isKnownDragModel(model) {
  return Object.prototype.hasOwnProperty.call(TABLES, String(model ?? '').toUpperCase());
}

/** Linear interpolation into a drag table, clamped at both ends. */
function dragCoefficient(table, mach) {
  if (mach <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (mach >= last[0]) return last[1];
  let lo = 0, hi = table.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid][0] <= mach) lo = mid; else hi = mid;
  }
  const [m0, c0] = table[lo], [m1, c1] = table[hi];
  return c0 + (c1 - c0) * (mach - m0) / (m1 - m0);
}

/** Coerce a value that may have arrived from a TextInput as a string. */
const N = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };

const STD_DENSITY = 0.0764742;  // lb/ft^3 at 59F, 29.92 inHg, dry
const STD_TEMP_F = 59;

/** Saturation vapour pressure over water, inHg (Tetens). */
function saturationVapourPressure(tempF) {
  const tC = (tempF - 32) * 5 / 9;
  const hPa = 6.1078 * Math.pow(10, (7.5 * tC) / (tC + 237.3));
  return hPa * 0.02953;
}

/**
 * Air density ratio against the standard atmosphere.
 *
 * Humidity *lowers* density — water vapour is lighter than dry air — which is
 * the opposite of what most people assume, though the effect is small next to
 * temperature and pressure.
 */
export function densityRatio({ tempF = STD_TEMP_F, pressureInHg = 29.92, humidityPct = 0 } = {}) {
  const tempR = tempF + 459.67;
  const pv = (humidityPct / 100) * saturationVapourPressure(tempF);
  const pd = pressureInHg - pv;
  // Densities scale with partial pressures over their gas constants.
  const density = (pd / (0.37373 * tempR)) + (pv / (0.59912 * tempR));
  const stdDensity = 29.92 / (0.37373 * (STD_TEMP_F + 459.67));
  return (density / stdDensity);
}

/** Speed of sound in ft/s. Depends on temperature only. */
export function speedOfSound(tempF = STD_TEMP_F) {
  return 49.0223 * Math.sqrt(tempF + 459.67);
}

/**
 * Station pressure from altitude, for when the user has altitude but not a
 * barometer reading.
 */
export function pressureAtAltitude(altitudeFt, seaLevelInHg = 29.92) {
  return seaLevelInHg * Math.pow(1 - 6.8756e-6 * altitudeFt, 5.2559);
}

/**
 * Drag deceleration constant.
 *
 * a = k * rho_ratio * Cd(M) * v^2 / BC, derived from a = rho v^2 Cd A / 2m with
 * BC = m/(d^2 i), mass in pounds and area in square inches:
 *   k = (1/2) * 32.174 * (pi/576) * rho_std_slug
 */
const DRAG_K = 0.5 * 32.174 * (Math.PI / 576) * (STD_DENSITY / 32.174);

/**
 * Integrate a trajectory.
 *
 * @param opts.mvFps        muzzle velocity
 * @param opts.bc           ballistic coefficient in the chosen model
 * @param opts.dragModel    'G1' | 'G7'
 * @param opts.sightHeightIn scope centre above bore
 * @param opts.zeroYd       range the rifle is zeroed at
 * @param opts.windMph      wind speed
 * @param opts.windAngleDeg clock angle; 90 is a full-value crosswind from the
 *                          left, 0 is a pure headwind
 * @param opts.maxRangeYd / opts.stepYd  table extent and spacing
 */
export function solve(opts = {}) {
  const {
    mvFps = 2800, bc = 0.5, dragModel = 'G7',
    sightHeightIn = 1.5, zeroYd = 100,
    tempF = STD_TEMP_F, pressureInHg = 29.92, humidityPct = 0, altitudeFt = null,
    windMph = 0, windAngleDeg = 90,
    maxRangeYd = 1000, stepYd = 100,
    muzzleAngleRad = null,
  } = opts;

  // Coerce every numeric input. These arrive from TextInputs as strings, and a
  // string stepYd turned `r += stepYd` in the range loop below into
  // concatenation — '1000' + '1000' = '10001000', which stays lexicographically
  // less than the limit forever and hangs the thread.
  const _mv = N(mvFps, 2800), _bc = N(bc, 0.5);
  const _sight = N(sightHeightIn, 1.5), _zero = N(zeroYd, 100);
  const _maxRange = N(maxRangeYd, 1000), _step = Math.max(1, N(stepYd, 100));
  const _wind = N(windMph, 0), _windAngle = N(windAngleDeg, 90);

  // A measured curve replaces the standard table, and takes sectional density
  // with it. See lib/dragfn.js: a custom Cd already carries the form factor, so
  // dividing by BC as well would apply it twice. Both are required together -
  // a curve without a sectional density falls back to the standard model rather
  // than guessing a divisor, because guessing would produce a card that solves
  // and is wrong, which is the one outcome nothing downstream could detect.
  const { dragCurve = null, sectionalDensity = null } = opts;
  const _sd = Number(sectionalDensity);
  const useCurve = Array.isArray(dragCurve) && dragCurve.length >= 2 && isFinite(_sd) && _sd > 0;
  // Same resolver as standardCd. This line used to read `TABLES[dragModel] ||
  // G7`, which was case-sensitive as well as silent: a stored 'g1' resolved to
  // G7 and solved a G1 BC through the wrong curve, roughly a factor of two out.
  const table = useCurve ? dragCurve : resolveTable(dragModel);
  const divisor = useCurve ? _sd : _bc;

  const rawPressure = N(pressureInHg, 29.92);
  const alt = altitudeFt == null || altitudeFt === '' ? null : N(altitudeFt, null);
  const pressure = alt != null ? pressureAtAltitude(alt, rawPressure) : rawPressure;
  const rho = densityRatio({ tempF: N(tempF, STD_TEMP_F), pressureInHg: pressure, humidityPct: N(humidityPct, 0) });
  const sos = speedOfSound(N(tempF, STD_TEMP_F));

  // Crosswind pushes laterally; the headwind component slightly changes drag.
  const wa = _windAngle * Math.PI / 180;
  const windCross = _wind * 1.46667 * Math.sin(wa);
  const windHead = _wind * 1.46667 * Math.cos(wa);

  const angle = muzzleAngleRad ?? zeroAngle({ ...opts, dragModel, bc: _bc, mvFps: _mv, zeroYd: _zero, sightHeightIn: _sight });

  const dt = 0.0005;
  const maxRangeFt = _maxRange * 3;

  let x = 0;
  let y = -_sight / 12;          // bore starts below the line of sight
  let z = 0;                     // lateral
  let vx = _mv * Math.cos(angle);
  let vy = _mv * Math.sin(angle);
  let t = 0;

  const wanted = [];
  for (let r = _step; r <= _maxRange + 1e-9; r += _step) wanted.push(r);
  const rows = [];
  let next = 0;

  let vz = 0;

  while (x < maxRangeFt && t < 20) {
    // Drag acts on velocity relative to the air mass, so the wind enters here
    // rather than as a separate correction. Lateral drift then falls out of the
    // integration: the bullet starts with no sideways speed, drag accelerates
    // it toward the air mass's, and it never fully catches up.
    const relVx = vx - windHead;
    const relVz = vz - windCross;
    const v = Math.sqrt(relVx * relVx + vy * vy + relVz * relVz);
    if (v <= 0) break;

    const cd = dragCoefficient(table, v / sos);
    const decel = DRAG_K * rho * cd * v * v / divisor;

    const ax = -decel * (relVx / v);
    const ay = -decel * (vy / v) - 32.174;
    const az = -decel * (relVz / v);

    const px = x;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    vx += ax * dt;
    vy += ay * dt;
    vz += az * dt;
    t += dt;

    // A bullet that has stopped advancing will never reach the next range, so
    // without this the loop runs to its time cap. That matters because the
    // zero solver calls solve() in a tight loop and a diverged trial angle can
    // send the bullet nearly vertical — the difference between milliseconds
    // and a hung UI thread.
    if (vx <= 0 || !isFinite(x) || !isFinite(y)) break;

    if (next < wanted.length) {
      const targetFt = wanted[next] * 3;
      if (px <= targetFt && x >= targetFt) {
        const frac = (targetFt - px) / (x - px || 1);
        rows.push({
          rangeYd: wanted[next],
          dropIn: (y) * 12,
          velFps: Math.sqrt(vx * vx + vy * vy),
          machAtRange: Math.sqrt(vx * vx + vy * vy) / sos,
          tofSec: t,
          windIn: z * 12,
        });
        next++;
      }
    }
  }

  return { rows, densityRatio: rho, speedOfSound: sos, muzzleAngleRad: angle };
}

/**
 * Muzzle angle that puts the bullet on the line of sight at the zero range.
 * Secant search on the drop at that distance.
 */
export function zeroAngle(opts = {}) {
  const { zeroYd = 100, sightHeightIn = 1.5 } = opts;
  const dropAt = (angle) => {
    const { rows } = solve({
      ...opts, muzzleAngleRad: angle, windMph: 0,
      maxRangeYd: zeroYd, stepYd: zeroYd,
    });
    return rows.length ? rows[rows.length - 1].dropIn : 0;
  };

  // A launch angle outside this range is unphysical for small arms, and letting
  // the secant wander outside it is how the solver used to hang.
  const MAX_ANGLE = 0.2; // ~11 degrees
  const clamp = (a) => Math.min(MAX_ANGLE, Math.max(-MAX_ANGLE, a));

  let a0 = 0;
  let a1 = clamp((sightHeightIn / 12) / (zeroYd * 3) + 0.001);
  let f0 = dropAt(a0), f1 = dropAt(a1);

  for (let i = 0; i < 30 && Math.abs(f1) > 0.005; i++) {
    const denom = f1 - f0;
    if (!isFinite(denom) || Math.abs(denom) < 1e-12) break;
    const a2 = clamp(a1 - f1 * (a1 - a0) / denom);
    if (!isFinite(a2)) break;
    a0 = a1; f0 = f1;
    a1 = a2; f1 = dropAt(a1);
    if (!isFinite(f1)) { a1 = a0; break; }
  }
  return a1;
}

/** Inches to MOA / mils at a given range. */
export const inchesToMoa = (inches, rangeYd) => rangeYd ? inches / (1.047 * rangeYd / 100) : 0;
export const inchesToMil = (inches, rangeYd) => rangeYd ? inches / (3.6 * rangeYd / 100) : 0;

/**
 * Build a dope card with elevation and wind in the requested unit.
 */
/**
 * @param opts.effects  Optional. When supplied, spin drift, aerodynamic jump
 *   and Coriolis are folded into the elevation and windage the card prints,
 *   rather than being left in a panel the shooter has to add up themselves.
 *   `{ sg, lengthCalibers, rightHandTwist, latitudeDeg, azimuthDeg }`.
 *
 * Folding them in is the point. The app computed all three, checked them
 * against published forms, and then printed a card that excluded them - and
 * said so, in a panel next to it. They come to roughly a minute at 1000 yards,
 * which is a miss on a small plate. A shooter carrying the card was carrying
 * numbers the app knew were incomplete.
 *
 * The components are still returned per row, so the card can show its working
 * and the shooter can see which correction is doing what.
 */
export function dopeCard(opts = {}) {
  const { unit = 'moa', effects = null, inclineDeg = 0 } = opts;
  const { rows, densityRatio: rho } = solve(opts);
  const conv = unit === 'mil' ? inchesToMil : inchesToMoa;

  // Aerodynamic jump responds to the crosswind component, not the wind speed.
  const wa = N(opts.windAngleDeg, 90) * Math.PI / 180;
  const crosswindMph = N(opts.windMph, 0) * Math.sin(wa);

  const usable = effects && effects.sg > 0 && effects.lengthCalibers > 0;

  return {
    densityRatio: rho,
    includesEffects: !!usable,
    inclineDeg: N(inclineDeg, 0),
    rows: rows.map(r => {
      const sec = usable
        ? secondaryEffects({
            sg: effects.sg,
            lengthCalibers: effects.lengthCalibers,
            timeOfFlightSec: r.tofSec,
            rangeFt: r.rangeYd * 3,
            crosswindMph,
            rightHandTwist: effects.rightHandTwist !== false,
            latitudeDeg: effects.latitudeDeg ?? null,
            azimuthDeg: effects.azimuthDeg ?? 0,
          })
        : null;

      // The angle scales *gravity* drop and nothing else. Aerodynamic jump and
      // the Coriolis vertical are not gravity, so they are added after the
      // cosine rather than through it - scaling them too would be applying a
      // correction to a quantity it does not describe.
      const gravity = inclinedDrop(r.dropIn, inclineDeg);
      // Vertical effects raise the impact, so they reduce the elevation dialled.
      // dropIn is negative below the line of sight, hence the sign.
      const dropWith = gravity + (sec?.totalVerticalIn ?? 0);
      // Lateral effects add to wind drift in the same sense: positive is right.
      const lateral = r.windIn + (sec?.totalHorizontalIn ?? 0);

      return {
        rangeYd: r.rangeYd,
        dropIn: +dropWith.toFixed(2),
        elevation: +conv(-dropWith, r.rangeYd).toFixed(2),
        windIn: +lateral.toFixed(2),
        wind: +conv(Math.abs(lateral), r.rangeYd).toFixed(2),
        // Signed, so a card can say which way to hold rather than only how far.
        windRight: lateral >= 0,
        velFps: Math.round(r.velFps),
        mach: +r.machAtRange.toFixed(2),
        tofSec: +r.tofSec.toFixed(3),
        // The working, so the total is auditable rather than magic.
        spinDriftIn: sec ? sec.spinDriftIn : 0,
        aeroJumpIn: sec ? sec.aeroJumpIn : 0,
        coriolisHIn: sec?.coriolis ? +sec.coriolis.horizontalIn.toFixed(2) : 0,
        coriolisVIn: sec?.coriolis ? +sec.coriolis.verticalIn.toFixed(2) : 0,
        // Past about Mach 1.2 the bullet enters transonic buffeting, where drag
        // models lose accuracy and groups typically open up.
        transonic: r.machAtRange < 1.2,
      };
    }),
  };
}

/**
 * Wind as a bracket, not a single number.
 *
 * The card is solved for one wind speed, and nobody knows the wind — they
 * estimate it. Drift is exactly linear in wind speed, which the solver already
 * knows, so the whole table can be produced from one solve and the field
 * arithmetic becomes "call it eight, read the eight column".
 *
 * Deliberately drift only. Aerodynamic jump also scales with crosswind and is
 * *vertical*, so folding it into a horizontal bracket would be wrong; it stays
 * in the elevation column where it belongs.
 */
export function windBracket(opts = {}, speeds = [5, 10, 15, 20]) {
  const { unit = 'moa' } = opts;
  const conv = unit === 'mil' ? inchesToMil : inchesToMoa;
  // One solve at a reference speed; everything else is proportional.
  const REF = 10;
  const { rows } = solve({ ...opts, windMph: REF, windAngleDeg: 90 });
  return {
    speeds,
    rows: rows.map(r => ({
      rangeYd: r.rangeYd,
      perMph: +conv(Math.abs(r.windIn) / REF, r.rangeYd).toFixed(3),
      holds: speeds.map(v => +conv(Math.abs(r.windIn) * (v / REF), r.rangeYd).toFixed(2)),
    })),
  };
}

/**
 * Trued BC from an observed drop.
 *
 * Solves for the BC that reproduces what the shooter actually saw at a known
 * distance. Real BCs vary from the box figure with barrel, atmosphere and
 * bullet lot, and truing is how a card is made to match the rifle rather than
 * the catalogue.
 */
/**
 * True muzzle velocity and BC together, from dope at two separated ranges.
 *
 * `trueBC` assumes the muzzle velocity is right and blames every discrepancy on
 * the bullet. That is a choice, not a fact, and often the wrong one: a
 * chronograph sitting a few feet from the muzzle, a barrel that is not the one
 * the load was worked up in, or a lot change all move velocity, and truing BC
 * against a velocity error produces a coefficient that is wrong in a way that
 * happens to fit - right at the range it was trued at and drifting either side.
 *
 * The two are separable because they act differently with distance. Muzzle
 * velocity dominates near, where time of flight is short and drag has done
 * little; BC dominates far, where the bullet has been decelerating the whole
 * way. Given dope at a near and a far range, each can be attributed.
 *
 * That separation is also the constraint. Two observations a hundred yards
 * apart cannot distinguish them - the fit is degenerate and will happily return
 * a confident pair of wrong numbers. So a minimum spread is required and the
 * refusal says why.
 *
 * Solved by coordinate descent: hold velocity, bisect BC with the existing
 * routine, then hold BC and bisect velocity, and repeat. Both errors are
 * monotonic in their parameter, so this converges quickly and without the
 * apparatus of a general optimiser.
 */
export function trueBoth(opts, observations) {
  const valid = (observations || []).filter(o =>
    isFinite(o.rangeYd) && o.rangeYd > 0 && isFinite(o.observedElevation));
  if (valid.length < 2) {
    return { ok: false, reason: 'Two observations are needed — one near, one far — to tell a velocity error from a BC error.' };
  }

  const ranges = valid.map(o => o.rangeYd);
  const near = Math.min(...ranges), far = Math.max(...ranges);
  // Below roughly a doubling, the two parameters are not separable: the same
  // drop can be produced by either, and the fit is free to trade them off.
  if (far < near * 2) {
    return {
      ok: false,
      reason: `Those observations run ${near} to ${far} yards. Velocity and BC do the same thing over that span, so the two cannot be told apart — the far one needs to be at least twice the near one.`,
    };
  }

  const conv = opts.unit === 'mil' ? inchesToMil : inchesToMoa;
  const errAt = (o, over) => {
    const { rows } = solve({ ...opts, ...over, maxRangeYd: o.rangeYd, stepYd: o.rangeYd });
    const row = rows[rows.length - 1];
    return row ? conv(-row.dropIn, o.rangeYd) - o.observedElevation : 0;
  };

  const nearObs = valid.reduce((a, b) => (b.rangeYd < a.rangeYd ? b : a));
  const farObs = valid.reduce((a, b) => (b.rangeYd > a.rangeYd ? b : a));

  let mv = N(opts.mvFps, 2800);
  let bc = N(opts.bc, 0.5);

  for (let pass = 0; pass < 12; pass++) {
    // BC against the far observation, where it does most of its work.
    let lo = bc * 0.5, hi = bc * 1.8, fLo = errAt(farObs, { bc: lo, mvFps: mv });
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2;
      const f = errAt(farObs, { bc: mid, mvFps: mv });
      if (Math.abs(f) < 0.002) { lo = hi = mid; break; }
      if ((fLo < 0) === (f < 0)) { lo = mid; fLo = f; } else { hi = mid; }
    }
    bc = (lo + hi) / 2;

    // Velocity against the near one, where BC has barely acted.
    let vLo = mv * 0.9, vHi = mv * 1.1, gLo = errAt(nearObs, { bc, mvFps: vLo });
    for (let i = 0; i < 32; i++) {
      const mid = (vLo + vHi) / 2;
      const g = errAt(nearObs, { bc, mvFps: mid });
      if (Math.abs(g) < 0.002) { vLo = vHi = mid; break; }
      if ((gLo < 0) === (g < 0)) { vLo = mid; gLo = g; } else { vHi = mid; }
    }
    const next = (vLo + vHi) / 2;
    const settled = Math.abs(next - mv) < 0.5;
    mv = next;
    if (settled) break;
  }

  const residual = valid.reduce((a, o) => a + Math.abs(errAt(o, { bc, mvFps: mv })), 0) / valid.length;

  return {
    ok: true,
    mvFps: Math.round(mv),
    bc: +bc.toFixed(4),
    mvDelta: Math.round(mv - N(opts.mvFps, 2800)),
    bcFactor: +(bc / N(opts.bc, 0.5)).toFixed(3),
    observations: valid.length,
    /** Mean absolute miss across the observations, in the card's unit. */
    residual: +residual.toFixed(3),
    nearYd: near,
    farYd: far,
  };
}

export function trueBC(opts, observations) {
  const valid = (observations || []).filter(o =>
    isFinite(o.rangeYd) && o.rangeYd > 0 && isFinite(o.observedElevation));
  if (!valid.length) return null;

  const err = (bc) => {
    let sum = 0;
    for (const o of valid) {
      const { rows } = solve({ ...opts, bc, maxRangeYd: o.rangeYd, stepYd: o.rangeYd });
      const row = rows[rows.length - 1];
      if (!row) continue;
      const conv = opts.unit === 'mil' ? inchesToMil : inchesToMoa;
      sum += conv(-row.dropIn, o.rangeYd) - o.observedElevation;
    }
    return sum / valid.length;
  };

  // A higher BC means less drop, so the error is monotonic in BC — bisect.
  let lo = opts.bc * 0.5, hi = opts.bc * 1.8;
  let fLo = err(lo);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const fMid = err(mid);
    if (Math.abs(fMid) < 0.005) { lo = hi = mid; break; }
    if ((fLo < 0) === (fMid < 0)) { lo = mid; fLo = fMid; } else { hi = mid; }
  }
  const trued = (lo + hi) / 2;
  return {
    bc: +trued.toFixed(4),
    factor: +(trued / opts.bc).toFixed(3),
    observations: valid.length,
  };
}
