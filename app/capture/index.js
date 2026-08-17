import { View, Text, TouchableOpacity, ScrollView, Image, TextInput, StyleSheet, useWindowDimensions, Alert, Platform, PanResponder } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Camera, ImageIcon, ArrowRight, Ruler, Crosshair, RotateCcw, Eraser, Save, ChevronRight, ChevronDown, Wand2, LoaderCircle, ZoomIn, ZoomOut, Maximize2, Plus, Trash2 } from 'lucide-react-native';
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Asset } from 'expo-asset';
import Svg, { Circle, Polygon, Line, Text as SvgText } from 'react-native-svg';
import { useTheme, groupColor } from '../../lib/theme';
import { useData } from '../../store/data';
import { computeGroupStats } from '../../lib/math';
import { rectifyToInches, project, orderCorners, perspectiveSeverity } from '../../lib/homography';
import { lightTap, mediumTap, successTap } from '../../lib/haptics';
import { loadGrayscale, imageToNormalized, normalizedToImage, coverScale } from '../../lib/pixels';
import { detectShots, expandPolygon } from '../../lib/detect';
import { fitCircle, circleQuality, circleQuad, allBullPresets, makeBullPreset } from '../../lib/circlefit';
import { emptyHistory, push as pushUndo, peek as peekUndo, undo as popUndo, clear as clearUndo } from '../../lib/undo';
import { rimFit, rimQuality, rimQuad, cropFor } from '../../lib/rimfit';
import { bulletDiameterIn } from '../../lib/calibers';
import { normalizePhoto } from '../../lib/photo';
import PickerSheet from '../../components/PickerSheet';
import { toImage, zoomAbout, fitViewport, pinchDistance, pinchCentre, pinchTransform, centreOn, frameOn } from '../../lib/viewport';
import { quadCentre } from '../../lib/homography';
import { formatGroup, groupUnitLabel, formatDistance } from '../../lib/units';
import { consentIsCurrent } from '../../lib/consent';
import { rowsForStep, stepDimension, variantLabel, variantComponents } from '../../lib/variants';

/**
 * How far a finger may travel and still count as a tap.
 *
 * Three pixels was the old figure and it is not a tap threshold, it is a mouse
 * threshold. A pointing device moves zero pixels between press and release; a
 * finger on glass routinely moves five to ten, and moves further the harder
 * someone is concentrating on placing a shot exactly. Every one of those became
 * a drag, `draggedRef` was set, and onTapImage returned without marking
 * anything - so on the zoomed screen, where people are being most careful,
 * shots simply did not appear.
 *
 * This is invisible in a browser, which is why it survived every pass: a click
 * has no travel at all. Ten points is in line with the slop the platforms
 * themselves allow before a press becomes a scroll.
 */
const TAP_SLOP_PX = 10;

/**
 * And how far before a marker being held is considered moved.
 *
 * Smaller, because picking a marker up is deliberate and the whole point is to
 * move it a little. Two pixels meant a tap on a marker nudged it.
 */
const DRAG_SLOP_PX = 5;

/**
 * How far in to jump when a bull's centre is tapped.
 *
 * Chosen against the sheets this is actually used on: a six-bull competition
 * face puts each bull at roughly a third of the photo's width, so 3x fills the
 * screen with one bull and a margin of the rings around it. Enough to place the
 * edge tap deliberately, and enough margin that a rim near the frame edge is
 * still reachable rather than pinned under the thumb.
 */
const CLOSE_UP_ZOOM = 3;

const STEP_LABELS = ['Photo', 'Setup', 'Place', 'Targets', 'Review'];
const IMG_ASPECT = 1.25;

/**
 * The demo target is a photograph, not a drawing.
 *
 * It used to be two SVG circles, which meant the demo exercised none of what
 * the app is actually for: a drawn circle has a perfect rim, no perspective, no
 * lighting, no paper texture and no bullet holes, so tapping through it proved
 * only that the taps registered. Anyone trying the app without a target to hand
 * saw a cartoon, and so did I every time I verified a change.
 *
 * This is a real NRA 50ft sheet, held in the hand, with real holes in it, so
 * the demo runs the same path as a real capture - scale, homography, detection
 * and all - and fails in the same places.
 *
 * expo-asset rather than Image.resolveAssetSource: react-native-web's Image
 * does not carry resolveAssetSource, so that route threw at module scope, which
 * takes down the whole screen rather than one component - the capture route
 * rendered as a blank page with nothing in the browser console, and the reason
 * was only visible in the dev server log. Asset.fromModule is supported on both
 * platforms and yields the uri loadGrayscale needs.
 */
const DEMO_ASSET = Asset.fromModule(require('../../assets/demo-target.jpg'));
const DEMO_PHOTO = {
  uri: DEMO_ASSET.uri ?? DEMO_ASSET.localUri,
  width: DEMO_ASSET.width,
  height: DEMO_ASSET.height,
  demo: true,
};

export default function CaptureScreen() {
  const { colors } = useTheme();
  const { addSession, rifles, loads, projects, units, trainingConsent,
          bullPresets, addBullPreset, deleteBullPreset } = useData();
  const params = useLocalSearchParams();
  const router = useRouter();

  // Reactive, not Dimensions.get() at module scope: that captured the width
  // once at first load, so a browser resize or device rotation left the photo
  // box at a stale width and it overflowed the viewport. Tap coordinates are
  // normalised fractions of this width, so they stay valid across a resize.
  const { width: SCREEN_W } = useWindowDimensions();
  const IMG_W = SCREEN_W - 40;
  const IMG_H = IMG_W * IMG_ASPECT;

  const [step, setStep] = useState(0);
  const [photo, setPhoto] = useState(null); // { uri, width, height } — normalized, upright
  const [processing, setProcessing] = useState(false);
  const [refW, setRefW] = useState('8.5');
  const [refH, setRefH] = useState('11');
  const [distanceStr, setDistanceStr] = useState('100');
  // Starting from a load development rung, the rifle is not a guess: the test
  // belongs to one. Selecting it here saves a cycle through the rifle control
  // and stops a group being filed against the wrong barrel by inattention.
  const [rifleIdx, setRifleIdx] = useState(() => {
    const pr = (projects || []).find(p => p.id === params.projectId);
    const i = pr ? (rifles || []).findIndex(r => r.id === pr.rifleId) : -1;
    return i >= 0 ? i : 0;
  });
  // Which load development variant this group is being fired for, if any.
  // Recorded here so the analysis reads measured sessions instead of numbers
  // typed from a notebook.
  // Arriving from a load development row, the test is already known.
  //
  // Seeded from the route rather than set by an effect, because an effect would
  // run after the first render and briefly show "Not a test" for a capture the
  // shooter started from a specific rung. Reading params in the initialiser also
  // leaves them free to change it afterwards, which an effect keyed on params
  // would fight.
  // The view to come back to once a bull has been marked up close. Held in a
  // ref rather than state: it is not rendered, and writing it during a tap
  // must not queue another render.
  const wideViewRef = useRef(null);
  const [closeUp, setCloseUp] = useState(false);
  const [pickingRifle, setPickingRifle] = useState(false);
  const [pickingLoad, setPickingLoad] = useState(false);
  const [devProjectId, setDevProjectId] = useState(params.projectId ?? null);
  const [devStep, setDevStep] = useState(params.step ? Number(params.step) : null);
  const [devRowId, setDevRowId] = useState(params.rowId ?? null);
  const cameFromLoadDev = !!(params.projectId && params.rowId);
  const [loadIdx, setLoadIdx] = useState(0);
  const [suppressed, setSuppressed] = useState(true);
  const [sessionName, setSessionName] = useState('');

  // Point of aim. Optional: only a shooter zeroing or truing needs it, so it
  // never blocks saving, but without it point of impact is unmeasurable.
  /**
   * One photo can hold several targets - a sheet of diamonds, a row of bulls.
   * They share the reference and therefore the scale, but each has its own
   * shots and its own point of aim, because each is a separate group.
   *
   * `shots` and `aim` below are views onto the active group, with setters that
   * write through. Everything downstream that already reads them keeps working
   * unchanged, which is what makes this tractable rather than a rewrite.
   */
  const [groups, setGroups] = useState([{ id: 'g' + Date.now(), corners: [], shots: [], aim: null, fit: null }]);
  const [activeGroup, setActiveGroup] = useState(0);
  const [markMode, setMarkMode] = useState('shot');
  // Which placed corner is being moved. Tap a corner to pick it up, tap the
  // photo to put it down — more reliable than dragging a 24px dot on a zoomed
  // photo, and it works the same whether or not the view is panned.
  const [editingCorner, setEditingCorner] = useState(null);
  const [editingGroup, setEditingGroup] = useState(null);
  // 'quad' corrects perspective from four corners. 'span' takes two points a
  // known distance apart and assumes the photo is square-on. 'bull' fits a
  // circle to taps around a printed bull of known diameter, which is one number
  // instead of two and is usually a better reference than the sheet: the bull
  // lies flat, its printed size is exact, and its centre is where the shooter
  // was actually aiming. It shares span's limitation - a circle carries no
  // perspective information, so an off-axis photo is caught and reported rather
  // than silently mis-scaled.
  const [refMode, setRefMode] = useState('bull');
  const [bullDiameter, setBullDiameter] = useState('3');
  const [presetLabel, setPresetLabel] = useState('');
  const shots = groups[activeGroup]?.shots ?? [];
  const aim = groups[activeGroup]?.aim ?? null;
  const corners = groups[activeGroup]?.corners ?? [];

  const setCorners = useCallback((updater) => {
    setGroups(prev => prev.map((g, i) => (i === activeGroup
      ? { ...g, corners: typeof updater === 'function' ? updater(g.corners) : updater }
      : g)));
  }, [activeGroup]);

  const setShots = useCallback((updater) => {
    setGroups(prev => prev.map((g, i) => (i === activeGroup
      ? { ...g, shots: typeof updater === 'function' ? updater(g.shots) : updater }
      : g)));
  }, [activeGroup]);

  const setAim = useCallback((updater) => {
    setGroups(prev => prev.map((g, i) => (i === activeGroup
      ? { ...g, aim: typeof updater === 'function' ? updater(g.aim) : updater }
      : g)));
  }, [activeGroup]);

  /**
   * Undo, for a screen made entirely of small mistakable taps.
   *
   * Everything that destroys work records the state before it and a name for
   * what it did. Snapshots of the whole target list rather than inverse
   * operations: a capture is a handful of targets, so it is cheap, and the
   * inverse nobody remembered to write is how undo implementations corrupt
   * documents.
   */
  const [history, setHistory] = useState(emptyHistory());
  const undoLabel = peekUndo(history);

  const remember = useCallback((label) => {
    setHistory(h => pushUndo(h, label, { groups, activeGroup }));
  }, [groups, activeGroup]);

  const undoLast = useCallback(() => {
    const { state, history: next } = popUndo(history);
    if (!state) return;
    setGroups(state.groups);
    setActiveGroup(Math.min(state.activeGroup, state.groups.length - 1));
    setHistory(next);
    setEditingCorner(null);
    setEditingGroup(null);
    detectedRef.current = false;
    mediumTap();
  }, [history]);

  const addGroup = useCallback(() => {
    setGroups(prev => [...prev, { id: 'g' + Date.now(), corners: [], shots: [], aim: null, fit: null }]);
    setActiveGroup(prev => prev + 1);
    detectedRef.current = false;
    mediumTap();
  }, []);

  const removeGroup = useCallback((idx) => {
    // The most expensive action on the screen and the easiest to trigger by
    // accident: it is a long press on the same chip that switches targets.
    remember(`remove target ${idx + 1}`);
    setGroups(prev => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
    setActiveGroup(prev => (prev >= idx && prev > 0 ? prev - 1 : prev));
  }, [remember]);

  const [detecting, setDetecting] = useState(false);
  const [detectNote, setDetectNote] = useState(null);
  // True while the shot set is exactly what detection produced. Re-running
  // detection then is idempotent and needs no confirmation; any hand edit
  // clears it so the next run warns before overwriting that work.
  const detectedRef = useRef(false);

  // Photo viewport. Zooming is what makes marking a tight group possible at
  // all: at 6x, a touch that wanders three screen pixels still resolves to half
  // an image pixel.
  //
  // That is a statement about precision, not about intent, and conflating the
  // two is what broke tapping on the zoomed screen. Three pixels of travel
  // buying image accuracy does not mean three pixels of travel is a drag - see
  // TAP_SLOP_PX.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const draggedRef = useRef(false);
  // Which marker a drag picked up, if any. Dragging is the reliable way to
  // reposition a point: tapping a marker relies on the tap not also reaching
  // the photo underneath, and that propagation behaves differently on native
  // than on web, which is why moving a point worked in one place and not the
  // other.
  /**
   * The photo's pixels, decoded once.
   *
   * Placing a target measures its printed rim, which needs the image rather
   * than only the taps. Decoding per tap would be wasteful and would make
   * placement feel laggy on a phone, so it is done once when the photo arrives
   * and held for the life of the screen.
   */
  const grayRef = useRef(null);
  const [grayReady, setGrayReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    grayRef.current = null;
    setGrayReady(false);
    if (!photo?.uri) return undefined;
    loadGrayscale(photo.uri)
      .then(g => { if (!cancelled) { grayRef.current = g; setGrayReady(true); } })
      .catch(() => { /* placement falls back to the taps alone */ });
    return () => { cancelled = true; };
  }, [photo?.uri]);

  const dragMarkerRef = useRef(null);
  const gestureRef = useRef({ startPan: null, startDist: null, startZoom: 1 });

  // A bull is described by one number, and it is square by definition, so both
  // reference dimensions come from the diameter.
  const bullIn = parseFloat(bullDiameter) || 0;
  const refWIn = refMode === 'bull' ? bullIn : (parseFloat(refW) || 0);
  const refHIn = refMode === 'bull' ? bullIn : (parseFloat(refH) || 0);
  // What the shooter typed, in whatever unit the field shows.
  const distanceEntered = parseFloat(distanceStr) || 0;
  // Yards is the canonical unit every angular calculation needs. Keeping the
  // two separate is the whole point: the field can show metres without every
  // MOA figure silently becoming wrong.
  const distance = units.distance === 'm' ? distanceEntered / 0.9144 : distanceEntered;

  // Continue is disabled on bad input; say why rather than just greying it out.
  const badNum = (raw, parsed) => raw.trim() !== '' && parsed <= 0;
  const refSizeError = refMode === 'bull'
    ? (badNum(bullDiameter, bullIn) ? 'Bull diameter must be a positive number.' : null)
    : (badNum(refW, refWIn) || badNum(refH, refHIn)
        ? 'Width and height must be positive numbers.'
        : null);
  const distanceError = badNum(distanceStr, distanceEntered)
    ? 'Distance must be a positive number.'
    : null;

  // Rifle selection cycles through equipment; loads are scoped to the rifle.
  const rifle = rifles.length ? rifles[rifleIdx % rifles.length] : null;
  const rifleLoads = useMemo(
    () => loads.filter(l => l.rifleId === rifle?.id),
    [loads, rifle]
  );
  const load = rifleLoads.length ? rifleLoads[loadIdx % rifleLoads.length] : null;

  /**
   * Every project, with ones for the selected rifle first.
   *
   * Filtering to the selected rifle hid the picker entirely whenever the rifle
   * did not match, which reads as the feature not existing rather than as a
   * filter doing its job. Ordering conveys the same relevance without removing
   * the option - and a shooter genuinely might fire a ladder with a rifle other
   * than the one recorded on the project.
   */
  const devProjects = useMemo(() => {
    const all = projects || [];
    if (!rifle) return all;
    return [...all].sort((a, b) =>
      (b.rifleId === rifle.id ? 1 : 0) - (a.rifleId === rifle.id ? 1 : 0));
  }, [projects, rifle]);
  const devProject = devProjects.find(pr => pr.id === devProjectId) || null;
  const devRows = useMemo(
    () => (devProject && devStep ? rowsForStep(devProject, devStep) : []),
    [devProject, devStep]
  );
  const devVariant = useMemo(() => {
    if (!devProject || !devRowId) return null;
    const row = devRows.find(r => r.id === devRowId);
    if (!row) return null;
    const baseLoad = loads.find(l => l.id === devProject.loadId) || load;
    return variantComponents(baseLoad, devStep, row);
  }, [devProject, devRows, devRowId, devStep, loads, load]);


  // Selection by identity rather than by position in the list, so that adding
  // or removing equipment cannot silently change what is selected.
  const pickRifle = (id) => {
    const i = rifles.findIndex(r => r.id === id);
    if (i >= 0) { setRifleIdx(i); setLoadIdx(0); }
    setPickingRifle(false);
  };
  const pickLoad = (id) => {
    const i = rifleLoads.findIndex(l => l.id === id);
    if (i >= 0) setLoadIdx(i);
    setPickingLoad(false);
  };

  // Suggested name follows the selections, so leaving the field blank still
  // yields something more useful than a bare date.
  const defaultSessionName = rifle
    ? `${rifle.name} · ${distanceEntered || '—'}${units.distance}`
    : 'Session ' + new Date().toLocaleDateString();

  // Four corners of a reference rectangle of known size give both the absolute
  // scale and the perspective correction in one homography — shots project
  // straight to inches on the target plane, no marker sticker needed.
  // Six for a bull rather than a fixed three: three taps determine a circle
  // exactly and therefore cannot reveal that the bull was photographed as an
  // ellipse. Extra taps are what make that check possible, so the mode invites
  // them and reports the fit as soon as three exist.
  // Two taps for a bull: the centre and any point on its edge. The rim itself
  // is measured from the photograph, so more taps would buy nothing.
  const maxRefPoints = refMode === 'quad' ? 4 : 2;

  /**
   * Four corners, however they were obtained.
   *
   * Span mode records two points a known width apart and builds the rectangle
   * they imply, using the reference aspect ratio for the perpendicular edge.
   * The result feeds the same homography, so nothing downstream changes — but
   * it encodes an assumption the four-corner path does not make, namely that
   * the photo was taken square-on. Perspective cannot be recovered from two
   * points; there is not enough information in them.
   */
  const quadFrom = useCallback((pts) => {
    if (refMode === 'quad') return pts.length === 4 ? pts : null;
    if (refMode === 'bull') {
      // The bounding square of the fitted circle, which is a D by D rectangle
      // and so joins the existing homography path unchanged. Refused outright
      // when the fit says the bull is too oval to size from, because a scale
      // taken from an ellipse is wrong along one axis and nothing downstream
      // would ever notice.
      const fit = fitCircle(pts);
      return fit && circleQuality(fit).ok ? circleQuad(fit) : null;
    }
    if (pts.length !== 2 || !(refWIn > 0) || !(refHIn > 0)) return null;
    const [a, b] = pts;
    const vx = b.x - a.x, vy = b.y - a.y;
    if (Math.hypot(vx, vy) < 1e-6) return null;
    // Perpendicular, scaled so the rectangle matches the reference aspect.
    const k = (refHIn / refWIn);
    const px = -vy * k, py = vx * k;
    return [a, b, { x: b.x + px, y: b.y + py }, { x: a.x + px, y: a.y + py }];
  }, [refMode, refWIn, refHIn]);

  /** Ordered corners and homography for one target's own reference. */
  const solveFor = useCallback((pts) => {
    const quad = quadFrom(pts || []);
    if (!quad || refWIn <= 0 || refHIn <= 0) return { H: null, ord: null, sev: 0 };
    const ord = orderCorners(quad);
    return { H: rectifyToInches(ord, refWIn, refHIn), ord, sev: perspectiveSeverity(ord) };
  }, [quadFrom, refWIn, refHIn]);

  const refQuad = useMemo(() => quadFrom(corners), [quadFrom, corners]);

  const { Hmat, ordered, severity } = useMemo(() => {
    const { H, ord, sev } = solveFor(corners);
    return { Hmat: H, ordered: ord, severity: sev };
  }, [solveFor, corners]);

  // Seed the aim at the centre of the framed reference as soon as it exists, so
  // the assumption is visible and movable at capture time rather than applied
  // silently when the target is read back.
  //
  // In bull mode this is not an assumption at all: the quad is the circle's
  // bounding square, so its centre is the fitted centre of the bull, which is
  // the thing the shooter was aiming at. That falls out of circleQuad rather
  // than needing a special case, but it is the main reason the mode is worth
  // having over a sheet.
  useEffect(() => {
    if (ordered && !aim) setAim(quadCentre(ordered));
  }, [ordered, aim]);

  // The raw fit, for the setup screen to report on. Kept separate from the quad
  // because the quad is null once quality fails, and that is exactly when there
  // is most to say.
  // The active target's measured rim, and what it says about itself. Held on
  // the group rather than recomputed, because it is a measurement taken once
  // when the target was placed, not a function of the current taps.
  const activeFit = groups[activeGroup]?.fit ?? null;
  const activeQuality = useMemo(() => rimQuality(activeFit), [activeFit]);

  /**
   * On the Place step, report on the target just placed.
   *
   * Placing one opens the next, so the active group becomes the empty pending
   * slot and its fit is null - which meant the verdict for the target that had
   * just been measured vanished the instant it was measured. The detail screen
   * uses the active target; this screen wants the last one that has an answer.
   */
  const lastPlaced = useMemo(() => {
    for (let i = groups.length - 1; i >= 0; i--) if (groups[i].fit) return groups[i];
    return null;
  }, [groups]);
  /**
   * A bull half-placed is still the one being worked on.
   *
   * This selected the active target only once it had a *fit*, which takes two
   * taps - so between the centre tap and the edge tap it fell back to the last
   * completed target, and the centre mark just placed was drawn nowhere. On the
   * whole sheet that was a missing dot nobody noticed. Zooming in on the centre
   * tap made it obvious: the shooter is looking straight at the mark they just
   * made, and it is not there.
   *
   * Taps count, not just fits. After a successful placement the flow opens a
   * fresh empty slot, which has neither, so the fallback still shows the target
   * that was just finished - which is what it was written for.
   */
  const placeGroup = useMemo(() => {
    const active = groups[activeGroup];
    const started = active?.fit || active?.taps?.length || active?.corners?.length;
    return started ? active : lastPlaced;
  }, [groups, activeGroup, lastPlaced]);
  const placeFit = placeGroup?.fit ?? null;
  const placeQuality = useMemo(() => rimQuality(placeFit), [placeFit]);
  // The quad belonging to the target being reported on, not to whichever slot
  // happens to be selected: after placing, the selection has already moved to
  // the next empty one and its `ordered` is null, which printed "-px".
  const placeQuad = useMemo(
    () => (placeGroup ? solveFor(placeGroup.corners).ord : null),
    [placeGroup, solveFor]
  );

  // Shot positions on the target plane, in inches.
  const shotsIn = useMemo(
    () => (Hmat ? shots.map(p => project(Hmat, p)).filter(Boolean) : []),
    [Hmat, shots]
  );
  const stats = computeGroupStats(shotsIn, Hmat ? 1 : null, distance);

  // Every group measured, not just the visible one.
  const groupStats = useMemo(() => groups.map(g => {
    const { H } = solveFor(g.corners);
    if (!H) return null;
    const pts = g.shots.map(p => project(H, p)).filter(Boolean);
    return computeGroupStats(pts, 1, distance);
  }), [groups, solveFor, distance]);

  const savedCount = groups.filter(g => g.shots.length >= 2).length;
  const savedShots = groups.reduce((a, g) => a + (g.shots.length >= 2 ? g.shots.length : 0), 0);
  const scored = groupStats.filter(Boolean);
  const bestStat = scored.length
    ? scored.reduce((a, b) => (b.extremeSpreadIn < a.extremeSpreadIn ? b : a))
    : null;

  // Shrink the markers when the group is tight enough that fixed 24px badges
  // would overlap and make individual shots impossible to tap. Floors at 14px
  // so they stay a usable target.
  const dotSize = useMemo(() => {
    if (shots.length < 2) return 24;
    let min = Infinity;
    for (let i = 0; i < shots.length; i++) {
      for (let j = i + 1; j < shots.length; j++) {
        const d = Math.hypot(shots[i].x - shots[j].x, shots[i].y - shots[j].y) * IMG_W;
        if (d < min) min = d;
      }
    }
    // Floor raised from 14. A 14px marker is not something a thumb can hit,
    // and the detail screen zooms in specifically so it does not have to be
    // that small.
    return Math.max(18, Math.min(26, min));
  }, [shots, IMG_W]);

  // Normalize at intake: bakes out EXIF orientation so the displayed image and
  // the analyzed pixels can never disagree, and caps decoded size.
  const acceptPhoto = useCallback(async (asset) => {
    setProcessing(true);
    try {
      const norm = await normalizePhoto(asset.uri);
      setPhoto(norm);
      setHistory(clearUndo());
      setStep(1);
    } catch (e) {
      const msg = 'Could not process that photo: ' + e.message;
      if (Platform.OS === 'web') alert(msg);
      else Alert.alert('Photo Error', msg);
    }
    setProcessing(false);
  }, []);

  /**
   * Both pickers previously ran with no try/catch, so any rejection became an
   * unhandled promise and the button simply did nothing — indistinguishable
   * from a dead control. Every failure now says what went wrong.
   */
  const reportPickerFailure = useCallback((what, e) => {
    const msg = e?.message || String(e);
    if (Platform.OS === 'web') alert(`${what} failed: ${msg}`);
    else Alert.alert(`${what} failed`, msg);
  }, []);

  const pickPhoto = useCallback(async () => {
    try {
      // Requested explicitly rather than relying on the picker to prompt.
      // Without this a denied library permission returns `canceled` and looks
      // identical to the user backing out.
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        const msg = 'Photo library access is needed to import a target. Enable it in Settings for On Paper.';
        if (Platform.OS === 'web') alert(msg); else Alert.alert('Photo Permission', msg);
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (!result.canceled && result.assets?.[0]) await acceptPhoto(result.assets[0]);
    } catch (e) {
      reportPickerFailure('Import', e);
    }
  }, [acceptPhoto, reportPickerFailure]);

  const takePhoto = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        const msg = 'Camera access is needed to photograph targets. Enable it in Settings for On Paper.';
        if (Platform.OS === 'web') alert(msg); else Alert.alert('Camera Permission', msg);
        return;
      }
      // `capture` is not a valid ImagePickerOptions field in SDK 57 — it only
      // ever meant anything to the web file input. Passing it on native was at
      // best ignored and at worst rejected, so it is confined to web.
      const opts = { quality: 0.8 };
      if (Platform.OS === 'web') opts.capture = 'back';
      const result = await ImagePicker.launchCameraAsync(opts);
      if (!result.canceled && result.assets?.[0]) await acceptPhoto(result.assets[0]);
    } catch (e) {
      reportPickerFailure('Camera', e);
    }
  }, [acceptPhoto, reportPickerFailure]);

  /**
   * Target selector.
   *
   * Shown at the reference step as well as the shot step, because on a
   * competition face each target has its own edges and centre - the choice of
   * which target you are working on has to come before marking its edges, not
   * after.
   */
  const TargetChips = () => (
    <>
      <View style={s.groupRow}>
        {groups.map((g, i) => {
          const ready = solveFor(g.corners).H;
          const live = i === activeGroup;
          return (
            <TouchableOpacity
              key={g.id}
              onPress={() => { setActiveGroup(i); setEditingCorner(null); detectedRef.current = false; }}
              style={[s.groupChip, {
                backgroundColor: live ? colors.act : colors.card,
                borderColor: live ? colors.act : (ready ? colors.okt : colors.bd),
              }]}
            >
              <Text style={[s.groupChipText, { color: live ? '#fff' : colors.mut }]}>
                Target {i + 1}
                {g.shots.length ? ` · ${g.shots.length}` : (ready ? ' ·' : '')}
                {ready && !g.shots.length ? ' ✓' : ''}
              </Text>
              {/* A bin on the selected chip, replacing a long press.
                  A long press is not discoverable, and it is the same gesture
                  as tapping a chip to switch targets held a moment too long, so
                  the most expensive action on the screen was also among the
                  easiest to trigger by accident. Attaching it to the selected
                  chip removes the other half of the problem too: there is no
                  question which target it deletes. Undo covers the mis-tap. */}
              {live && (ready || g.shots.length > 0) && groups.length > 1 && (
                <TouchableOpacity
                  onPress={(e) => { e.stopPropagation(); removeGroup(i); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={s.groupChipBin}
                >
                  <Trash2 size={12} color="#fff" />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity onPress={addGroup} style={[s.groupAdd, { borderColor: colors.ibd }]}>
          <Plus size={14} color={colors.act} />
        </TouchableOpacity>
      </View>
      {groups.length > 1 && (
        <Text style={[s.markModeHint, { color: colors.fnt }]}>
          Each target is measured on its own.
        </Text>
      )}
    </>
  );

  /**
   * Two taps into a measured target.
   *
   * The taps say which circle was meant; the pixels say exactly where its edge
   * runs. Measured on the committed photographs the fit lands within about a
   * pixel of the printed rim from taps several pixels out, so the answer is
   * better than the fingers that produced it.
   *
   * Returns the quad rather than the ellipse, because everything downstream -
   * the homography, rectifyToInches, every group statistic - already speaks in
   * four corners of a rectangle of known size. A bull of diameter D is a D by D
   * square, so this is where the circle path rejoins the existing pipeline and
   * nothing after it needs to know which mode was used.
   */
  const measureBull = useCallback((taps) => {
    if (taps.length < 2) return null;
    const gs = grayRef.current;

    // No pixels yet: honour exactly what was tapped. rimFit reports this as
    // unmeasured, and the detail screen says so rather than implying the edge
    // was found.
    if (!gs) {
      const r = Math.hypot(taps[1].x - taps[0].x, taps[1].y - taps[0].y);
      if (!(r > 0)) return null;
      const fit = { cx: taps[0].x, cy: taps[0].y, a: r, b: r, phi: 0,
                    axisRatio: 1, rms: 0, coverage: 0, measured: false };
      return { fit, corners: rimQuad(fit) };
    }

    const toImg = (p) => normalizedToImage(p.x, p.y, gs.width, gs.height, IMG_W, IMG_H);
    const fit = rimFit(gs.gray, gs.width, gs.height, {
      centre: toImg(taps[0]), edge: toImg(taps[1]),
    });
    if (!fit) return null;

    // A fit this module has already judged unusable does not become corners.
    //
    // This was the gap. The four-corner circle path refuses on quality
    // (`circleQuality(fit).ok ? circleQuad(fit) : null`), but the two-tap path
    // handed back a quad whatever the verdict said, so a rejected fit still
    // counted as placed and still fed the homography, under a green tick.
    //
    // What made it silent rather than merely wrong: an oblique fit becomes a
    // rectangle here, `solveFor` fits a circle back to those four corners, and
    // the four corners of a rectangle are always exactly concyclic - so the
    // re-fit is perfect, passes its own quality check, and yields the
    // circumcircle, whose diameter is the rectangle's *diagonal*. Measured on
    // an NRA 50ft sheet: one bull read 94px across where the same bull on the
    // same photo read 65px. A 45% scale error on every group from that target,
    // announced by a green tick.
    //
    // The verdict text already tells the shooter to use the four-corner
    // reference. Now the flow means it. `fit` is still returned so that verdict
    // has something to report on; only the corners are withheld.
    const verdict = rimQuality(fit);
    if (!verdict.ok) return { fit, corners: [] };

    const quad = rimQuad(fit)
      .map(p => imageToNormalized(p.x, p.y, gs.width, gs.height, IMG_W, IMG_H));
    return { fit, corners: quad };
  }, [IMG_W, IMG_H]);

  /**
   * On the detail screen, frame whichever target is selected.
   *
   * At whole-sheet zoom a .30 hole is 8px across against a 44pt minimum touch
   * target, which is not a size anyone can mark accurately. Framed on its own
   * bull it is 34px. This is the whole reason the flow has two screens rather
   * than one, so the framing is applied rather than offered.
   *
   * Only on entering the step or changing target: re-framing on every render
   * would fight the shooter the moment they pinched in to place a shot
   * precisely.
   */
  const placedCount = useMemo(
    () => groups.filter(g => solveFor(g.corners).H).length,
    [groups, solveFor]
  );

  useEffect(() => {
    if (step === 2) setActiveGroup(groups.length - 1);
  }, [step, groups.length]);

  const framedRef = useRef(null);
  useEffect(() => {
    if (step !== 3) { framedRef.current = null; return; }
    // Entering the detail screen, start on the first target that was placed.
    if (framedRef.current === null && !solveFor(groups[activeGroup]?.corners).H) {
      const first = groups.findIndex(g => solveFor(g.corners).H);
      if (first >= 0 && first !== activeGroup) { setActiveGroup(first); return; }
    }
    const key = `${activeGroup}:${groups[activeGroup]?.id}`;
    if (framedRef.current === key) return;
    framedRef.current = key;

    const g = groups[activeGroup];
    const q = g && solveFor(g.corners).ord;
    if (!q) { setZoom(1); setPan({ x: 0, y: 0 }); return; }

    // Corners are normalized by box width; the viewport works in box pixels.
    const cx = (q.reduce((a, p) => a + p.x, 0) / 4) * IMG_W;
    const cy = (q.reduce((a, p) => a + p.y, 0) / 4) * IMG_W;
    let r = Math.max(...q.map(p => Math.hypot(p.x * IMG_W - cx, p.y * IMG_W - cy)));

    // Include shots already marked, so returning to a target never frames one
    // of them off screen. A flyer that cannot be seen is a flyer that does not
    // get marked, and dropping it makes the group look tighter than it was -
    // an error in the direction nobody would question.
    for (const sh of g.shots || []) {
      r = Math.max(r, Math.hypot(sh.x * IMG_W - cx, sh.y * IMG_W - cy) * 1.12);
    }

    const v = frameOn({ x: cx, y: cy }, r, IMG_W, IMG_H);
    setZoom(v.zoom);
    setPan(v.pan);
  }, [step, activeGroup, groups, solveFor, IMG_W, IMG_H]);

  const onTapImage = useCallback((e, mode) => {
    // A pan gesture ends with a release over the photo, which would otherwise
    // drop a shot wherever the drag finished.
    if (draggedRef.current) { draggedRef.current = false; return; }

    const ne = e.nativeEvent || e;
    const locationX = ne.locationX ?? ne.offsetX;
    const locationY = ne.locationY ?? ne.offsetY;
    if (locationX == null || locationY == null) return;
    // Undo zoom/pan first: the tap is in screen space, the stored point is in
    // the unzoomed image space.
    const img = toImage({ x: locationX, y: locationY }, zoom, pan);

    // Both axes divide by the same reference length. Dividing y by the box
    // height instead made the coordinate space anisotropic, so hypot() mixed
    // units and vertical distances measured 20% short.
    const x = img.x / IMG_W;
    const y = img.y / IMG_W;
    if (!isFinite(x) || !isFinite(y)) return;
    const pt = { x, y };

    if (mode === 'corner') {
      // One entry per tap, so undo walks back through a placement rather than
      // discarding it whole. Centre down with the edge still to come is a real
      // state and worth being able to return to.
      if (refMode === 'bull') {
        const pending = groups[groups.length - 1];
        const n = editingCorner != null ? activeGroup + 1 : groups.length;
        remember(editingCorner != null
          ? `move point ${editingCorner + 1} of target ${n}`
          : `target ${n} ${(pending?.corners.length ?? 0) === 0 ? 'centre' : 'edge'}`);
      } else {
        remember(`reference point ${corners.length + 1}`);
      }
      setGroups(prev => {
        // While placing, the pending target is always the last one.
        //
        // Advancing an activeGroup index after the update read `groups` from a
        // stale closure, so taps arriving faster than React commits all landed
        // on the same target: ten taps across four bulls placed exactly one.
        // Deriving the pending slot from the array being updated removes the
        // race rather than narrowing it.
        const idx = editingCorner != null ? (editingGroup ?? activeGroup) : prev.length - 1;
        const g = prev[idx];
        if (!g) return prev;

        // A point was picked up: put it down here.
        //
        // Which points are being edited matters. Once a bull is placed, its
        // `corners` hold the four-point quad derived from the fit while the
        // dots on screen are the two taps that produced it. Indexing the edit
        // into `corners` therefore moved a quad corner that nobody could see,
        // changed the scale reference, and left the fit and the drawn circle
        // untouched - so the reference and the picture silently disagreed.
        const isBull = refMode === 'bull';
        const points = isBull && g.taps?.length ? g.taps : g.corners;

        let taps;
        if (editingCorner != null && editingCorner < points.length) {
          taps = [...points];
          taps[editingCorner] = pt;
        } else if (points.length >= maxRefPoints) {
          // Extra taps are inert rather than restarting - a stray tap past the
          // last point must not silently destroy the calibration.
          return prev;
        } else {
          taps = [...points, pt];
        }

        const next = [...prev];
        next[idx] = isBull ? { ...g, corners: taps, taps } : { ...g, corners: taps };

        // Two taps means a bull is ready to measure, whether they were just
        // placed or one of them was moved. Re-measuring on a move is what lets
        // a fit that grabbed the wrong ring of a concentric target be dragged
        // onto the right one, instead of re-placing the target.
        if (isBull && taps.length === 2) {
          const measured = measureBull(taps);
          if (measured) {
            next[idx] = { ...g, corners: measured.corners, taps, fit: measured.fit };
            // Only open a fresh target when this was a new placement, so that
            // adjusting an existing one does not spawn an empty slot. This is
            // what makes a six-bull sheet a matter of tapping round the page
            // rather than a round trip per target.
            //
            // And only when the measurement was actually usable. Advancing off
            // a refused fit moves the shooter away from the one target that
            // needs their attention, onto a fresh empty slot that looks like
            // progress - so the verdict scrolls past unread and the sheet ends
            // up one target short. Staying put keeps the two taps they need to
            // adjust under the finger that is already there.
            if (editingCorner == null && idx === prev.length - 1 && measured.corners.length) {
              next.push({ id: 'g' + Date.now() + '-' + next.length, corners: [], shots: [], aim: null, fit: null });
            }
          }
        }
        return next;
      });

      /**
       * Tapping a bull's centre brings the view to it.
       *
       * The edge tap is the one that decides the scale for every measurement
       * taken from this target, and at whole-sheet zoom it is being placed on a
       * rim a few pixels wide under a thumb. Jumping in makes that tap a
       * considered one, and leaves the marker big enough to drag afterwards.
       *
       * Only on the *first* tap of a bull, and only when the view is still
       * wide: doing it on the second tap would move the ground under the
       * finger mid-gesture, and doing it while already close up would zoom in
       * on a zoom.
       */
      if (refMode === 'bull' && editingCorner == null) {
        const g = groups[groups.length - 1];
        const wasEmpty = !(g?.taps?.length ?? g?.corners?.length ?? 0);
        if (wasEmpty && !closeUp) {
          wideViewRef.current = { zoom, pan };
          const v = centreOn({ x: pt.x * IMG_W, y: pt.y * IMG_W }, CLOSE_UP_ZOOM, IMG_W, IMG_H);
          setZoom(v.zoom);
          setPan(v.pan);
          setCloseUp(true);
        }
      }

      setEditingCorner(null);
      setEditingGroup(null);
      mediumTap();
    } else if (mode === 'aim') {
      // One aim point per target; tapping again moves it.
      setAim(pt);
      mediumTap();
    } else {
      // Constructive actions go in the history too. Undo that only reversed
      // deletions was worse than no undo on a mis-tap: it left the stray shot
      // in place and quietly reversed something older instead.
      remember(`shot ${shots.length + 1}`);
      detectedRef.current = false;
      setShots(prev => [...prev, pt]);
      lightTap();
    }
  // setShots and setAim are rebound whenever the active target changes. Omitting
  // them here meant every tap wrote to whichever target was selected when the
  // handler was first created, so adding a second target silently kept filling
  // the first.
  // zoom and pan belong here. The handler undoes the viewport transform to turn
  // a tap into an image coordinate, and without them in the list it kept the
  // values captured when it was first created - zoom 1, pan 0. On the Place
  // step those are the real values, so nothing looked wrong. On the detail
  // screen, which frames each target at around 2x, every tap was converted as
  // though the photo were not zoomed at all: the picture moved and the shots
  // did not follow it.
  }, [IMG_W, zoom, pan, editingCorner, editingGroup, maxRefPoints, setShots, setAim, refMode, activeGroup, groups, measureBull]);

  /**
   * One responder handles both panning and pinching, and decides at release
   * whether the gesture was a tap. Doing this with a single PanResponder keeps
   * it identical on web and native rather than depending on gesture-handler's
   * differing web behaviour.
   */
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) =>
      Math.abs(g.dx) > TAP_SLOP_PX || Math.abs(g.dy) > TAP_SLOP_PX ||
      _e.nativeEvent.touches?.length === 2,

    onPanResponderGrant: (e) => {
      draggedRef.current = false;
      // Snapshot before anything moves. Recorded only if a drag actually
      // begins, so a plain tap does not fill the history with no-ops.
      gestureRef.current = {
        startPan: pan, startDist: null, startCentre: null, startZoom: zoom,
        groupsBefore: groups, activeBefore: activeGroup, recorded: false,
      };
      dragMarkerRef.current = null;

      // Did this touch land on an existing marker? Test in screen space so the
      // hit radius stays a constant finger-sized target at any zoom.
      const { locationX, locationY } = e.nativeEvent;
      if (locationX == null || locationY == null) return;
      // Grab radius, in screen pixels so it stays a constant finger target at
      // any zoom. Raised from 26: this is a phone, and a thumb is nearer 40
      // across. It can be generous because the detail screen frames one target
      // at a time, which spreads the markers out on screen.
      const HIT_PX = 34;
      const list = step === 2 ? corners : step === 3 ? shots : [];
      let best = -1, bestD = HIT_PX;
      for (let i = 0; i < list.length; i++) {
        const sx = list[i].x * IMG_W * zoom + pan.x;
        const sy = list[i].y * IMG_W * zoom + pan.y;
        const d = Math.hypot(sx - locationX, sy - locationY);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) {
        dragMarkerRef.current = { kind: step === 2 ? 'corner' : 'shot', index: best };
        if (step === 2) setEditingCorner(best);
      }
    },

    onPanResponderMove: (e, g) => {
      const touches = e.nativeEvent.touches;
      const dist = pinchDistance(touches);

      // A marker is being dragged: move it and do not pan the view.
      const held = dragMarkerRef.current;
      if (held && dist == null) {
        if (Math.abs(g.dx) > DRAG_SLOP_PX || Math.abs(g.dy) > DRAG_SLOP_PX) {
          draggedRef.current = true;
          // The move becomes undoable at the moment it becomes a move.
          const st = gestureRef.current;
          if (!st.recorded) {
            st.recorded = true;
            setHistory(h => pushUndo(
              h,
              held.kind === 'corner' ? `move point ${held.index + 1}` : `move shot ${held.index + 1}`,
              { groups: st.groupsBefore, activeGroup: st.activeBefore }
            ));
          }
        }
        const { locationX, locationY } = e.nativeEvent;
        if (locationX == null || locationY == null) return;
        const img = toImage({ x: locationX, y: locationY }, zoom, pan);
        const pt = { x: img.x / IMG_W, y: img.y / IMG_W };
        if (!isFinite(pt.x) || !isFinite(pt.y)) return;
        if (held.kind === 'corner') {
          setCorners(prev => prev.map((c, i) => (i === held.index ? pt : c)));
        } else {
          setShots(prev => prev.map((c, i) => (i === held.index ? pt : c)));
        }
        return;
      }

      if (dist != null) {
        // Two fingers move the view: pinch and slide are one gesture, handled
        // in one step so they cannot fight each other. See pinchTransform.
        draggedRef.current = true;
        const st = gestureRef.current;
        const centre = pinchCentre(touches, 0, 0) || { x: IMG_W / 2, y: IMG_H / 2 };
        if (st.startDist == null) {
          st.startDist = dist;
          st.startCentre = centre;
          st.startZoom = zoom;
          st.startPan = pan;
          return;
        }
        const next = pinchTransform({
          startCentre: st.startCentre, startDist: st.startDist,
          startZoom: st.startZoom, startPan: st.startPan,
          centre, dist, boxW: IMG_W, boxH: IMG_H,
        });
        if (next) { setZoom(next.zoom); setPan(next.pan); }
        return;
      }

      // One finger moves marks, not the view.
      //
      // It used to pan whenever the touch missed a marker, which put the two
      // most common actions on the same gesture: a drag starting a few pixels
      // off a shot slid the whole photo instead of moving the shot, and on a
      // zoomed screen that is most of them. Panning is now two fingers, which
      // nothing else uses, so neither gesture can be mistaken for the other.
      if (Math.abs(g.dx) > TAP_SLOP_PX || Math.abs(g.dy) > TAP_SLOP_PX) draggedRef.current = true;
    },

    onPanResponderRelease: () => {
      gestureRef.current.startDist = null;
      gestureRef.current.startCentre = null;
      // A dragged corner is already where it belongs; clear the pick-up state so
      // the next tap on the photo adds a point rather than moving this one.
      if (dragMarkerRef.current?.kind === 'corner' && draggedRef.current) setEditingCorner(null);
      dragMarkerRef.current = null;
    },
    onPanResponderTerminate: () => {
      gestureRef.current.startDist = null;
      gestureRef.current.startCentre = null;
      dragMarkerRef.current = null;
    },
  }), [zoom, pan, IMG_W, IMG_H, step, corners, shots, setShots, setCorners, groups, activeGroup]);

  /**
   * Leave a close-up and return to whatever the sheet looked like before.
   *
   * Restores the remembered view rather than resetting to fit, because the
   * shooter may have zoomed or panned deliberately to reach a bull on a large
   * sheet, and throwing that away would make them do it again for every target.
   */
  const exitCloseUp = useCallback(() => {
    const w = wideViewRef.current;
    if (w) { setZoom(w.zoom); setPan(w.pan); }
    else { const f = fitViewport(); setZoom(f.zoom); setPan(f.pan); }
    wideViewRef.current = null;
    setCloseUp(false);
    setEditingCorner(null);
  }, []);

  // Leaving the Place step ends any close-up with it, so returning later does
  // not offer to restore a view from a different photo or a different target.
  useEffect(() => {
    if (step !== 2 && closeUp) { wideViewRef.current = null; setCloseUp(false); }
  }, [step, closeUp]);

  const stepZoom = (factor) => {
    const next = zoomAbout({ x: IMG_W / 2, y: IMG_H / 2 }, zoom * factor, zoom, pan, IMG_W, IMG_H);
    setZoom(next.zoom);
    setPan(next.pan);
  };
  const resetView = () => { const f = fitViewport(); setZoom(f.zoom); setPan(f.pan); };

  const removeShot = (i) => {
    remember(`remove shot ${i + 1}`);
    detectedRef.current = false;
    setShots(prev => prev.filter((_, j) => j !== i));
  };

  const clearShots = () => {
    if (!shots.length) return;
    remember(`clear ${shots.length} shot${shots.length === 1 ? '' : 's'}`);
    detectedRef.current = false;
    setShots([]);
    setDetectNote(null);
  };

  /**
   * Find bullet holes automatically.
   *
   * Needs the scale first: the caliber gives the hole's real diameter, and the
   * scale converts that to pixels, which is the prior the detector runs on.
   */
  const autoDetect = useCallback(async () => {
    if (!photo || !Hmat) return;

    // Detection replaces the whole set, so confirm before discarding manual work.
    if (shots.length && !detectedRef.current) {
      const ok = Platform.OS === 'web'
        ? confirm('Replace your marked shots with auto-detected ones?')
        : await new Promise(res => Alert.alert(
            'Replace marked shots?',
            'Auto-detect will discard the shots you marked by hand.',
            [{ text: 'Cancel', style: 'cancel', onPress: () => res(false) },
             { text: 'Replace', style: 'destructive', onPress: () => res(true) }]
          ));
      if (!ok) return;
      remember(`replace ${shots.length} marked shot${shots.length === 1 ? '' : 's'}`);
    }

    setDetecting(true);
    setDetectNote(null);
    try {
      // Reuse the decode the placement step already did for this photo.
      //
      // `grayRef` is keyed on photo.uri and holds exactly this result. Decoding
      // again costs nothing measurable on web, where it is a canvas call - but
      // on a device the chain is manipulate, resize, save as base64, decode the
      // base64, then decode the JPEG in JS. Running that twice put the whole
      // cost on a button press, with the shooter watching.
      const { gray, width, height } = grayRef.current ?? await loadGrayscale(photo.uri);
      const boxH = IMG_H;
      const k = coverScale(width, height, IMG_W, boxH);

      const caliberText = load?.caliber || rifle?.cartridge;
      const { diameterIn, matched } = bulletDiameterIn(caliberText);

      // Source-image px per inch, averaged over the quad's top and bottom
      // edges (display units -> display px -> source px).
      const edge = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      const quadWDisp = (edge(ordered[0], ordered[1]) + edge(ordered[3], ordered[2])) / 2;
      const pxPerIn = (quadWDisp * IMG_W / k) / refWIn;
      const radiusPx = (diameterIn * pxPerIn) / 2;

      // Search only the target the shooter marked.
      //
      // Measured on real photographs this is the largest single source of false
      // positives: an NRA sheet on a cutting mat returned 104 detections for
      // about a dozen holes, and the surplus was the mat's grid, the wall, the
      // staples and a second target in the background. The quad was already
      // being collected here and was being used only for scale.
      //
      // Grown by 15%, because the quad marks the reference rectangle rather
      // than a promise about where every shot landed, and a flyer off the edge
      // is the shot most worth recording. On the measured photo the count is
      // unchanged from 0% to 20% and climbs past 30% as neighbouring bulls come
      // into range.
      const region = expandPolygon(
        ordered.map(p => normalizedToImage(p.x, p.y, width, height, IMG_W, boxH)),
        1.15
      );

      // Corner-derived scale is exact, and a hole cannot be smaller than the
      // bullet, so skip the sub-caliber sweep scale — on the real-photo
      // harness it produced every junction false positive.
      const { shots: found, reason } = detectShots(gray, width, height, {
        radiusPx,
        scales: [1.0, 1.35],
        region,
      });

      if (!found.length) {
        setDetectNote(reason || 'No holes found — mark them manually.');
      } else {
        setShots(found.map(f => imageToNormalized(f.x, f.y, width, height, IMG_W, boxH)));
        detectedRef.current = true;
        // Worded as a suggestion because that is what it is.
        //
        // Measured against the committed photographs: on a Shoot-N-C, five of
        // the six best-scoring detections are printed lettering - both o's of
        // "Birchwood", a letter of "Casey", the 8 and the 9 - and none of the
        // four obvious impacts survived. A printed mark is manufactured and a
        // bullet hole is torn, so the printed mark is the cleaner blob of the
        // two and outranks real holes. Calling that "Found 6 holes" invites the
        // shooter to accept it.
        setDetectNote(
          `${found.length} suggestion${found.length === 1 ? '' : 's'} — check every one before moving on. ` +
          'Printed numbers and lettering read like bullet holes to this and are often picked up.' +
          (matched ? '' : ' Caliber not recognised, so 6.5mm was assumed.')
        );
        await successTap();
      }
    } catch (e) {
      setDetectNote('Detection failed: ' + e.message);
    }
    setDetecting(false);
  }, [photo, Hmat, ordered, refWIn, load, rifle, shots.length, IMG_W, IMG_H]);

  const canNext =
    (step === 1 && refWIn > 0 && refHIn > 0 && distance > 0) ||
    (step === 2 && placedCount > 0) ||
    (step === 3 && groups.some(g => g.shots.length >= 2 && solveFor(g.corners).H));

  const saveAndFinish = async () => {
    await successTap();
    const id = 's' + Date.now();
    // An empty group is one the shooter added and did not use; saving it would
    // create a target with no shots that every downstream statistic has to
    // guard against.
    const savedGroups = groups.filter(g => g.shots.length >= 2 && solveFor(g.corners).H);
    addSession({
      id,
      name: sessionName.trim() || defaultSessionName,
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      rifleId: rifle?.id || null,
      loadId: load?.id || null,
      // Canonical yards for every calculation, plus the unit it was entered in.
      // A recorded distance is a fact about that session; changing the app's
      // units later must not rewrite what was shot.
      distanceYd: distance,
      projectId: devProjectId,
      projectStep: devStep,
      projectRowId: devRowId,
      distanceUnit: units.distance,
      suppressed,
      notes: '',
      // Every group from this photo becomes its own target. They share the
      // reference, so they share the scale.
      targets: savedGroups.map(g => ({
        id: g.id,
        shots: g.shots.map(sh => ({ x: sh.x, y: sh.y })),
        // Its own reference, not the active one - each face on the sheet is
        // measured against the edges marked around it.
        scale: (() => {
          const { ord } = solveFor(g.corners);
          return ord ? { corners: ord, widthIn: refWIn, heightIn: refHIn } : null;
        })(),
        aim: g.aim,
        // Recorded at capture, because that is when the decision applied.
        // Enabling contribution later must not reach back over photos taken
        // while it was off.
        contributeConsent: consentIsCurrent(trainingConsent) ? trainingConsent : null,
      })),
      best: bestStat ? bestStat.extremeSpreadIn.toFixed(2) : '—',
      meanRadius: bestStat ? bestStat.meanRadiusIn.toFixed(2) : '—',
      sd: 0,
      mv: 0,
      targetCount: savedGroups.length,
    });
    // On web a deep link straight to /capture has no history to pop.
    if (router.canGoBack?.()) router.back();
    else router.replace('/');
  };

  const capGood = stats && stats.groupMoa <= 0.5;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity
            onPress={() => step > 0 ? setStep(step - 1) : (router.canGoBack?.() ? router.back() : router.replace('/'))}
            style={[s.backBtn, { backgroundColor: colors.card, borderColor: colors.bd }]}
          >
            <ArrowLeft size={19} color={colors.tx} />
          </TouchableOpacity>
          <View>
            <Text style={[s.title, { color: colors.tx }]}>New Session</Text>
            <Text style={[s.subtitle, { color: colors.mut }]}>Step {step + 1} of 5 · {STEP_LABELS[step]}</Text>
          </View>
        </View>

        {/* Progress dots */}
        <View style={s.dots}>
          {STEP_LABELS.map((_, i) => (
            <View key={i} style={[s.dot, { backgroundColor: i <= step ? '#6D3BEB' : colors.ibd }]} />
          ))}
        </View>

        {/* Step 0: Photo */}
        {step === 0 && (
          <View style={[s.photoBox, { borderColor: colors.ibd, backgroundColor: colors.inset }]}>
            <View style={[s.photoIcon, { backgroundColor: colors.acs }]}>
              <Camera size={30} color={colors.act} />
            </View>
            <Text style={[s.photoTitle, { color: colors.tx }]}>Add a target photo</Text>
            <Text style={[s.photoDesc, { color: colors.mut }]}>Photograph the whole target sheet — square-on{'\n'}or at an angle, perspective is corrected</Text>
            <View style={s.photoBtns}>
              <TouchableOpacity onPress={takePhoto} disabled={processing} style={[s.primaryBtn, { opacity: processing ? 0.6 : 1 }]}>
                <Camera size={16} color="#fff" />
                <Text style={s.primaryBtnText}>{processing ? 'Processing…' : 'Take Photo'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={pickPhoto} disabled={processing} style={[s.secondaryBtn, { backgroundColor: colors.acs, opacity: processing ? 0.6 : 1 }]}>
                <ImageIcon size={16} color={colors.act} />
                <Text style={[s.secondaryBtnText, { color: colors.act }]}>Upload Photo</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => { setPhoto(DEMO_PHOTO); setStep(1); }}>
              <Text style={[s.demoLink, { color: colors.act }]}>Use a demo target instead</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Step 1: Setup */}
        {step === 1 && (
          <View style={s.setupWrap}>
            {/* What the scale is taken from. A bull is one number rather than
                two and is usually the better reference: it lies flat, its
                printed diameter is exact, and its centre is the aim point. */}
            <View style={s.field}>
              <Text style={[s.fieldLabel, { color: colors.mut }]}>Scale reference</Text>
              <View style={s.twoCol}>
                {[['bull', 'Printed bull'], ['quad', 'Sheet, 4 corners'], ['span', 'Known width']].map(([k, label]) => (
                  <TouchableOpacity
                    key={k}
                    onPress={() => { setRefMode(k); setCorners([]); }}
                    style={[s.refModeBtn, {
                      backgroundColor: refMode === k ? colors.act : colors.input,
                      borderColor: refMode === k ? colors.act : colors.ibd,
                    }]}
                  >
                    <Text style={[s.refModeText, { color: refMode === k ? '#fff' : colors.mut }]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {refMode === 'bull' ? (
              <View style={s.field}>
                <Text style={[s.fieldLabel, { color: colors.mut }]}>Bull diameter</Text>
                <View style={[s.inputRow, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                  <TextInput
                    value={bullDiameter}
                    onChangeText={setBullDiameter}
                    keyboardType="decimal-pad"
                    style={[s.input, { color: colors.tx, fontFamily: 'JetBrainsMono_500Medium' }]}
                  />
                  <Text style={[s.inputUnit, { color: colors.mut }]}>in</Text>
                </View>
                <View style={s.presetRow}>
                  {allBullPresets(bullPresets).map(p => {
                    const on = bullIn === p.inches;
                    return (
                      <TouchableOpacity
                        key={p.id || p.inches}
                        onPress={() => setBullDiameter(String(p.inches))}
                        style={[s.presetChip, {
                          backgroundColor: on ? colors.acs : colors.input,
                          borderColor: on ? colors.act : colors.ibd,
                        }]}
                      >
                        <Text style={[s.presetText, { color: on ? colors.act : colors.mut }]}
                          numberOfLines={1}>
                          {p.measuredBy === 'user' ? `${p.label} ${p.inches}"` : `${p.inches}"`}
                        </Text>
                        {/* The bin appears on the selected chip, the same way it
                            does on a target chip. Long-press would have been
                            tidier in the row and is the thing a thumb cannot
                            discover, which is why it lost that argument once
                            already. Built-in sizes cannot be removed, so they
                            never show one. */}
                        {on && p.measuredBy === 'user' && (
                          <TouchableOpacity
                            // Removing a preset leaves its diameter in the
                            // field, so the save row reappears immediately.
                            // Putting the name back into it too makes that row
                            // the undo: one tap restores what was just binned,
                            // rather than asking for the name again.
                            onPress={() => { deleteBullPreset(p.id); setPresetLabel(p.label); }}
                            hitSlop={{ top: 12, bottom: 12, left: 10, right: 12 }}
                            style={s.presetBin}
                          >
                            <Trash2 size={13} color={colors.dngt} />
                          </TouchableOpacity>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Saving a measured size. Offered only once the typed diameter
                    is not already a chip, so it does not sit there inviting a
                    duplicate of something already in the row. */}
                {bullIn > 0 && !allBullPresets(bullPresets).some(p => p.inches === bullIn) && (
                  <View style={s.savePresetRow}>
                    <TextInput
                      value={presetLabel}
                      onChangeText={setPresetLabel}
                      placeholder={`Name this ${bullIn}" bull to keep it`}
                      placeholderTextColor={colors.fnt}
                      style={[s.savePresetInput, {
                        backgroundColor: colors.input, borderColor: colors.ibd, color: colors.tx,
                      }]}
                    />
                    <TouchableOpacity
                      disabled={!presetLabel.trim()}
                      onPress={() => {
                        const p = makeBullPreset({ label: presetLabel, inches: bullIn });
                        if (!p) return;
                        addBullPreset(p);
                        setPresetLabel('');
                      }}
                      style={[s.savePresetBtn, {
                        backgroundColor: presetLabel.trim() ? colors.acs : colors.input,
                        borderColor: presetLabel.trim() ? colors.act : colors.ibd,
                      }]}
                    >
                      <Text style={[s.savePresetText, { color: presetLabel.trim() ? colors.act : colors.fnt }]}>
                        Save
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                {refSizeError
                  ? <Text style={[s.fieldError, { color: colors.dngt }]}>{refSizeError}</Text>
                  : <Text style={[s.fieldHint, { color: colors.fnt }]}>
                      The printed diameter of the bull you shot at. Next you'll tap around its edge.
                      The plain sizes are Shoot-N-C; competition faces are not listed because their
                      published figures disagree with each other, and a guessed reference size is a
                      scale error on every number read off this photo. Measure yours once, name it,
                      and it stays.
                    </Text>}
              </View>
            ) : (
              <View style={s.field}>
                <Text style={[s.fieldLabel, { color: colors.mut }]}>Reference Size (width × height)</Text>
                <View style={s.twoCol}>
                  <View style={[s.inputRow, { flex: 1, backgroundColor: colors.input, borderColor: colors.ibd }]}>
                    <TextInput
                      value={refW}
                      onChangeText={setRefW}
                      keyboardType="decimal-pad"
                      style={[s.input, { color: colors.tx, fontFamily: 'JetBrainsMono_500Medium' }]}
                    />
                    <Text style={[s.inputUnit, { color: colors.mut }]}>in</Text>
                  </View>
                  <View style={[s.inputRow, { flex: 1, backgroundColor: colors.input, borderColor: colors.ibd }]}>
                    <TextInput
                      value={refH}
                      onChangeText={setRefH}
                      keyboardType="decimal-pad"
                      style={[s.input, { color: colors.tx, fontFamily: 'JetBrainsMono_500Medium' }]}
                    />
                    <Text style={[s.inputUnit, { color: colors.mut }]}>in</Text>
                  </View>
                </View>
                {refSizeError
                  ? <Text style={[s.fieldError, { color: colors.dngt }]}>{refSizeError}</Text>
                  : <Text style={[s.fieldHint, { color: colors.fnt }]}>
                      {refMode === 'quad'
                        ? 'The printed size of your target sheet or backer — you\'ll tap its four corners next. Sets the scale and corrects off-axis photos. Letter paper is 8.5 × 11.'
                        : 'The size of whatever you\'ll mark two points across. Assumes the photo is square-on; perspective cannot be recovered from two points.'}
                    </Text>}
              </View>
            )}
            {/* A list, not a cycler.
                Cycling was fine for two rifles and became a game of tapping
                past the wrong ones the moment there were several - and it can
                only ever go forwards, so overshooting means going all the way
                round. PickerSheet is the control the rest of the app already
                uses, and it searches. */}
            <View style={s.field}>
              <Text style={[s.fieldLabel, { color: colors.mut }]}>Rifle</Text>
              <TouchableOpacity onPress={() => rifles.length && setPickingRifle(true)}
                disabled={!rifles.length}
                style={[s.picker, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                <Text style={[s.pickerText, { color: rifle ? colors.tx : colors.mut }]}>
                  {rifle ? `${rifle.name} · ${rifle.cartridge}` : 'No rifles — add one in Equipment'}
                </Text>
                {rifles.length > 1 && (
                  <View style={s.pickerCycle}>
                    <Text style={[s.pickerCount, { color: colors.mut }]}>{rifles.length}</Text>
                    <ChevronDown size={18} color={colors.act} />
                  </View>
                )}
              </TouchableOpacity>
            </View>
            <View style={s.field}>
              <Text style={[s.fieldLabel, { color: colors.mut }]}>Load</Text>
              <TouchableOpacity onPress={() => rifleLoads.length && setPickingLoad(true)}
                disabled={!rifleLoads.length}
                style={[s.picker, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                <Text style={[s.pickerText, { color: load ? colors.tx : colors.mut }]}>
                  {load ? load.name : 'No loads for this rifle'}
                </Text>
                {rifleLoads.length > 1 && (
                  <View style={s.pickerCycle}>
                    <Text style={[s.pickerCount, { color: colors.mut }]}>{rifleLoads.length}</Text>
                    <ChevronDown size={18} color={colors.act} />
                  </View>
                )}
              </TouchableOpacity>
            </View>
            <View style={s.twoCol}>
              <View style={{ flex: 1 }}>
                <Text style={[s.fieldLabel, { color: colors.mut }]}>Distance</Text>
                <View style={[s.inputRow, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                  <TextInput
                    value={distanceStr}
                    onChangeText={setDistanceStr}
                    keyboardType="number-pad"
                    style={[s.input, { color: colors.tx, fontFamily: 'JetBrainsMono_700Bold' }]}
                  />
                  <Text style={[s.inputUnit, { color: colors.mut }]}>{units.distance}</Text>
                </View>
                {distanceError && <Text style={[s.fieldError, { color: colors.dngt }]}>{distanceError}</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.fieldLabel, { color: colors.mut }]}>Suppressor</Text>
                <TouchableOpacity
                  onPress={() => setSuppressed(v => !v)}
                  style={[s.picker, suppressed
                    ? { backgroundColor: colors.acs, borderColor: colors.acs }
                    : { backgroundColor: colors.input, borderColor: colors.ibd }]}
                >
                  <Text style={[s.pickerText, { color: suppressed ? colors.act : colors.mut, fontWeight: '700' }]}>
                    {suppressed ? 'Yes' : 'No'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Arrived from a specific rung: say what this will be filed
                against, before any of it is measured. The picker stays below
                and unlocked, because a mis-tap on the way in should not commit
                a group to the wrong variant. */}
            {cameFromLoadDev && devVariant && (
              <View style={[s.devCard, { backgroundColor: colors.acs, borderColor: colors.act }]}>
                <Text style={[s.fieldLabel, { color: colors.act }]}>Recording against</Text>
                <Text style={[s.devVariantText, { color: colors.tx }]}>
                  {devProject?.name}{' · '}
                  {variantLabel(devStep, devRows.find(r => r.id === devRowId) || {})}
                </Text>
                <Text style={[s.devVariantSub, { color: colors.mut }]}>
                  {[devVariant.bullet, devVariant.powder, devVariant.primer, devVariant.brass]
                    .filter(Boolean).join(' · ') || 'Components not set on this project'}
                </Text>
              </View>
            )}

            {/* Load development: pin this group to the variant it tests. */}
            {!!devProjects.length && (
              <View style={[s.devCard, { backgroundColor: colors.card, borderColor: devRowId ? colors.act : colors.bd }]}>
                <Text style={[s.fieldLabel, { color: colors.mut }]}>Load development</Text>

                <View style={s.devChips}>
                  <TouchableOpacity
                    onPress={() => { setDevProjectId(null); setDevStep(null); setDevRowId(null); }}
                    style={[s.devChip, {
                      backgroundColor: devProjectId ? colors.inset : colors.act,
                      borderColor: devProjectId ? colors.ibd : colors.act,
                    }]}
                  >
                    <Text style={[s.devChipText, { color: devProjectId ? colors.mut : '#fff' }]}>Not a test</Text>
                  </TouchableOpacity>
                  {devProjects.map(pr => (
                    <TouchableOpacity
                      key={pr.id}
                      onPress={() => {
                        setDevProjectId(pr.id);
                        setDevStep(pr.currentStep || 6);
                        setDevRowId(null);
                      }}
                      style={[s.devChip, {
                        backgroundColor: devProjectId === pr.id ? colors.act : colors.inset,
                        borderColor: devProjectId === pr.id ? colors.act : colors.ibd,
                      }]}
                    >
                      <Text style={[s.devChipText, { color: devProjectId === pr.id ? '#fff' : colors.mut }]}>
                        {pr.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {!!devProjectId && (
                  <>
                    <Text style={[s.devHint, { color: colors.fnt }]}>
                      Step {devStep} · pick which {stepDimension(devStep)?.noun || 'variant'} this group is
                    </Text>
                    <View style={s.devChips}>
                      {devRows.length === 0 && (
                        <Text style={[s.devHint, { color: colors.fnt }]}>
                          No rows on that step yet. Add them in Load Development first.
                        </Text>
                      )}
                      {devRows.map(row => (
                        <TouchableOpacity
                          key={row.id}
                          onPress={() => setDevRowId(devRowId === row.id ? null : row.id)}
                          style={[s.devChip, {
                            backgroundColor: devRowId === row.id ? colors.act : colors.inset,
                            borderColor: devRowId === row.id ? colors.act : colors.ibd,
                          }]}
                        >
                          <Text style={[s.devChipText, { color: devRowId === row.id ? '#fff' : colors.mut }]}>
                            {variantLabel(devStep, row)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}

                {!!devVariant && (
                  <Text style={[s.devHint, { color: colors.act }]}>
                    {[devVariant.bullet, devVariant.powder, devVariant.charge ? `${devVariant.charge} gr` : null,
                      devVariant.primer, devVariant.cbto ? `${devVariant.cbto}" CBTO` : null]
                      .filter(Boolean).join(' · ')}
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {/* Step 2: Corners */}
        {step === 2 && (
          <View>
            <TargetChips />
            {/* The reference type is chosen on Setup, one step back. It was
                also sitting here, where switching clears the active target's
                points - so a mis-tap in the middle of placing a sheet threw
                away work with no warning, to change a setting the shooter had
                already made. */}
            <View style={[s.instruction, { backgroundColor: colors.acs }]}>
              <Ruler size={17} color={colors.act} />
              <Text style={[s.instructionText, { color: colors.act }]}>
                {editingCorner != null
                  ? `Moving point ${editingCorner + 1} — tap where it should go.`
                  : refMode === 'bull'
                    ? (corners.length === 0
                        ? `Tap the middle of a ${bullDiameter}″ bull, then its edge. ${placedCount ? `${placedCount} placed — keep going for the rest.` : 'Do that for every target on the sheet.'}`
                        : 'Now tap its edge. The printed rim is found from the photo, so this only has to be close.')
                    : refMode === 'span'
                      ? `Tap the two ends of the ${refW}″ edge. Faster, but it assumes the photo is square-on — it cannot correct for angle.`
                      : `Tap the four corners of your ${refW}″ × ${refH}″ reference, in any order. Tap a placed corner to move it.`}
              </Text>
            </View>
            {/* Placing measures the rim from the pixels, and decoding the photo
                takes a moment on a phone. Tapping before it is ready is not an
                error - the fit falls back to the two taps and says so - but the
                shooter would have no idea why one target came out measured and
                the next did not. */}
            {refMode === 'bull' && !!photo && !grayReady && (
              <View style={[s.detectNote, { backgroundColor: colors.inset, borderColor: colors.ibd, marginBottom: 10 }]}>
                <Text style={[s.detectNoteText, { color: colors.mut }]}>
                  Still reading the photo. You can place targets now, but the printed rim
                  will not be measured until this clears.
                </Text>
              </View>
            )}
            <TouchableOpacity
              activeOpacity={1}
              onPress={(e) => onTapImage(e, 'corner')}
              style={[s.imgContainer, { borderColor: colors.bd, width: IMG_W, height: IMG_H }]}
              {...panResponder.panHandlers}
            >
              {/* pointerEvents none, and it is load-bearing.
                  A tap's locationX/locationY are relative to the view that
                  received it. This view is offset by `pan`, so when it was the
                  touch target the handler subtracted pan a second time and every
                  shot landed displaced by exactly -pan. At 1x pan is zero and
                  nothing looked wrong; zoomed in, the photo appeared to move
                  while the shots stayed on the unzoomed picture. Making it
                  transparent to touches sends them to the container, whose
                  coordinates are the ones the maths already assumes. */}
              <View style={{
                pointerEvents: 'none',
                position: 'absolute',
                left: pan.x, top: pan.y,
                width: IMG_W * zoom, height: IMG_H * zoom,
              }}>
                {photo ? (
                  <Image source={{ uri: photo.uri }} style={s.targetImg} resizeMode="cover" />
                ) : null}
              </View>
              {/* Every target placed so far, not only the active one.
                  Drawing just the active target meant adding a second one made
                  the first disappear, so on a six-bull sheet nothing showed
                  which bulls were done and marking one twice was silent.
                  Corners are normalized by the box *width*, so y spans 0..1.25
                  in a 1.25-aspect box: the viewBox must be 100x125 for a
                  uniform x100 mapping on both axes. */}
              {/* Also transparent to touches, and for the same reason: it is
                  offset by `pan`, so any tap landing on it would be measured
                  from the wrong origin. It sits over the whole photo, so it
                  swallowed nearly every tap on the Place step. */}
              <Svg viewBox="0 0 100 125" preserveAspectRatio="none" style={{
                pointerEvents: 'none',
                position: 'absolute',
                left: pan.x, top: pan.y,
                width: IMG_W * zoom, height: IMG_H * zoom,
              }}>
                {groups.map((g, gi) => {
                  const q = solveFor(g.corners).ord;
                  if (!q) return null;
                  const live = gi === activeGroup;
                  const cx = q.reduce((a, p) => a + p.x, 0) / 4;
                  const cy = q.reduce((a, p) => a + p.y, 0) / 4;
                  return (
                    <React.Fragment key={g.id}>
                      <Polygon
                        points={q.map(p => `${p.x * 100},${p.y * 100}`).join(' ')}
                        fill={live ? 'rgba(240,135,43,0.10)' : 'rgba(18,183,106,0.10)'}
                        stroke={live ? '#F0872B' : '#12B76A'}
                        strokeWidth="1.5" strokeDasharray="3 2" vectorEffect="non-scaling-stroke"
                      />
                      <SvgText
                        x={cx * 100} y={cy * 100 + 2}
                        fontSize="5" fontWeight="700" textAnchor="middle"
                        fill={live ? '#F0872B' : '#12B76A'}
                      >{gi + 1}</SvgText>
                    </React.Fragment>
                  );
                })}
              </Svg>
              {/* The dots belong to whichever target is being reported on, which
                  after a placement is the one just finished rather than the
                  empty slot now selected. Without this they vanished the moment
                  a target was placed, so there was nothing to grab. */}
              {(refMode === 'bull' ? (placeGroup?.taps ?? []) : corners).map((p, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={(e) => {
                    e.stopPropagation();
                    setEditingCorner(editingCorner === i ? null : i);
                    // Remember which target the dot came from: it is not always
                    // the selected one, and editing the wrong group would move
                    // a point on a target the shooter is not looking at.
                    setEditingGroup(refMode === 'bull' ? groups.indexOf(placeGroup) : activeGroup);
                    mediumTap();
                  }}
                  style={[
                    s.cornerDot,
                    { left: p.x * IMG_W * zoom + pan.x - 12, top: p.y * IMG_W * zoom + pan.y - 12 },
                    editingCorner === i && s.cornerDotEditing,
                  ]}
                >
                  <Text style={s.cornerDotText}>{i + 1}</Text>
                </TouchableOpacity>
              ))}
            </TouchableOpacity>
            {Hmat && severity > 0.04 && (
              <View style={[s.detectNote, { backgroundColor: colors.acs, borderColor: colors.acs, marginTop: 10, marginBottom: 0 }]}>
                <Text style={[s.detectNoteText, { color: colors.act }]}>
                  Off-axis photo detected ({(severity * 100).toFixed(0)}% skew) — measurements are perspective-corrected.
                </Text>
              </View>
            )}
            {/* What the fitted bull says about itself. A circle has no
                perspective information in it, so this verdict is the only thing
                standing between an off-axis photo and a scale that is quietly
                wrong along one axis. */}
            {refMode === 'bull' && placeFit && (
              <View style={[s.detectNote, {
                backgroundColor: placeQuality.ok
                  ? (placeQuality.level === 'good' ? colors.oks : colors.warns)
                  : colors.dngs,
                borderColor: 'transparent', marginTop: 10, marginBottom: 0,
              }]}>
                <Text style={[s.detectNoteText, {
                  color: placeQuality.ok
                    ? (placeQuality.level === 'good' ? colors.okt : colors.warnt)
                    : colors.dngt,
                }]}>
                  {placeQuality.text}
                </Text>
                {placeFit && (
                  <Text style={[s.detectNoteText, { color: colors.mut, marginTop: 4 }]}>
                    {/* The fit works in normalized tap space, where both axes
                        are divided by the box width, so a radius has to be
                        multiplied back up to mean anything on screen. Printed
                        raw it read "1px". */}
                    {/* The fit's axes are in image pixels; the quad is what
                        carries them into normalized space. Multiplying the
                        image-space radius by the box width read "58757px". */}
                    {bullDiameter}″ across {placeQuad
                      ? (Math.hypot(placeQuad[1].x - placeQuad[0].x, placeQuad[1].y - placeQuad[0].y) * Math.SQRT2 * IMG_W).toFixed(0)
                      : '—'}px on screen
                    {placeFit.measured ? `, rim found around ${placeFit.coverage}% of it` : ', from your taps alone'}.
                  </Text>
                )}
              </View>
            )}
            {refMode !== 'bull' && corners.length === maxRefPoints && !Hmat && (
              <View style={[s.detectNote, { backgroundColor: colors.inset, borderColor: colors.ibd, marginTop: 10, marginBottom: 0 }]}>
                <Text style={[s.detectNoteText, { color: colors.mut }]}>
                  Those points don't form a usable reference. Tap one to move it, or Reset.
                </Text>
              </View>
            )}
            <View style={s.zoomBar}>
              <TouchableOpacity onPress={() => stepZoom(1 / 1.6)} disabled={zoom <= 1}
                style={[s.zoomBtn, { backgroundColor: colors.card, borderColor: colors.bd, opacity: zoom <= 1 ? 0.4 : 1 }]}>
                <ZoomOut size={16} color={colors.tx} />
              </TouchableOpacity>
              <Text style={[s.zoomLabel, { color: colors.mut }]}>{zoom.toFixed(1)}x</Text>
              <TouchableOpacity onPress={() => stepZoom(1.6)} disabled={zoom >= 8}
                style={[s.zoomBtn, { backgroundColor: colors.card, borderColor: colors.bd, opacity: zoom >= 8 ? 0.4 : 1 }]}>
                <ZoomIn size={16} color={colors.tx} />
              </TouchableOpacity>
              <TouchableOpacity onPress={resetView} disabled={zoom === 1}
                style={[s.zoomBtn, { backgroundColor: colors.card, borderColor: colors.bd, opacity: zoom === 1 ? 0.4 : 1 }]}>
                <Maximize2 size={15} color={colors.tx} />
              </TouchableOpacity>
              <Text style={[s.zoomHint, { color: colors.fnt }]}>
                {zoom > 1 ? 'Two fingers to move the view' : 'Pinch, or zoom in to place precisely'}
              </Text>
            </View>
            {/* The way back out of a close-up.
                Deliberately a button rather than an automatic zoom-out the
                moment the edge is tapped. Zooming out on its own would be one
                tap cheaper and would remove the very window this feature
                exists for: seeing the fitted rim large enough to judge, and
                dragging either mark if it is off. The shooter decides when
                they are happy with the target rather than the app deciding
                for them. */}
            {closeUp && (
              <TouchableOpacity onPress={exitCloseUp}
                style={[s.closeUpBar, { backgroundColor: colors.acs, borderColor: colors.act }]}>
                <Maximize2 size={15} color={colors.act} />
                <Text style={[s.closeUpText, { color: colors.act }]}>
                  {lastPlaced && placeQuality.ok ? 'Done — back to the sheet' : 'Back to the sheet'}
                </Text>
              </TouchableOpacity>
            )}
            {/* Undo, named. "Undo" alone makes people guess what they are
                about to change; naming the action means they can tell whether
                it is the one they regret. Sits on both working steps because
                mistakes on either are equally easy. */}
            {undoLabel && (
              <TouchableOpacity onPress={undoLast} style={[s.undoBar, { backgroundColor: colors.inset, borderColor: colors.ibd }]}>
                <RotateCcw size={14} color={colors.act} />
                <Text style={[s.undoText, { color: colors.act }]}>Undo {undoLabel}</Text>
              </TouchableOpacity>
            )}
            <View style={s.scaleFooter}>
              <Text style={[s.scaleCount, { color: colors.mut }]}>
                <Text style={{ color: colors.tx, fontWeight: '700', fontFamily: 'JetBrainsMono_700Bold' }}>{refMode === 'bull' ? placedCount : corners.length}</Text>
                {refMode === 'bull'
                  ? ` target${placedCount === 1 ? '' : 's'} placed`
                  : `/${maxRefPoints} ${refMode === 'span' ? 'points' : 'corners'} set`}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  if (!corners.length && placedCount === 0) return;
                  remember(refMode === 'bull' ? `reset ${placedCount} target${placedCount === 1 ? '' : 's'}` : 'reset points');
                  setCorners([]); setEditingCorner(null);
                }}
                style={s.resetBtn}>
                <RotateCcw size={14} color={colors.act} />
                <Text style={[s.resetText, { color: colors.act }]}>Reset</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Step 3: Mark Shots */}
        {step === 3 && (
          <View>
            <TargetChips />
            <View style={s.markModeRow}>
              {[['shot', 'Shots'], ['aim', 'Aim point']].map(([k, label]) => (
                <TouchableOpacity
                  key={k}
                  onPress={() => setMarkMode(k)}
                  style={[s.markModeBtn, {
                    backgroundColor: markMode === k ? colors.act : colors.card,
                    borderColor: markMode === k ? colors.act : colors.bd,
                  }]}
                >
                  <Text style={[s.markModeText, { color: markMode === k ? '#fff' : colors.mut }]}>
                    {label}{k === 'aim' && aim ? ' ✓' : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {markMode === 'aim' && (
              <Text style={[s.markModeHint, { color: colors.fnt }]}>
                Tap where you were aiming. Optional — but without it, point of impact
                can't be measured for zeroing or truing.
              </Text>
            )}

            <TouchableOpacity
              activeOpacity={1}
              onPress={(e) => onTapImage(e, markMode === 'aim' ? 'aim' : 'shots')}
              style={[s.imgContainer, { borderColor: colors.bd, width: IMG_W, height: IMG_H }]}
              {...panResponder.panHandlers}
            >
              {/* pointerEvents none, and it is load-bearing.
                  A tap's locationX/locationY are relative to the view that
                  received it. This view is offset by `pan`, so when it was the
                  touch target the handler subtracted pan a second time and every
                  shot landed displaced by exactly -pan. At 1x pan is zero and
                  nothing looked wrong; zoomed in, the photo appeared to move
                  while the shots stayed on the unzoomed picture. Making it
                  transparent to touches sends them to the container, whose
                  coordinates are the ones the maths already assumes. */}
              <View style={{
                pointerEvents: 'none',
                position: 'absolute',
                left: pan.x, top: pan.y,
                width: IMG_W * zoom, height: IMG_H * zoom,
              }}>
                {photo ? (
                  <Image source={{ uri: photo.uri }} style={s.targetImg} resizeMode="cover" />
                ) : null}
              </View>
              {groups.map((g, gi) => (gi === activeGroup ? null : g.shots.map((p, i) => (
                <View
                  key={`${g.id}-${i}`}
                  style={[s.shotDot, {
                    pointerEvents: 'none',
                    width: dotSize, height: dotSize, borderRadius: dotSize / 2,
                    left: p.x * IMG_W * zoom + pan.x - dotSize / 2,
                    top: p.y * IMG_W * zoom + pan.y - dotSize / 2,
                    opacity: 0.28,
                  }]}
                />
              ))))}
              {aim && (
                <View style={{
                  pointerEvents: 'none',
                  position: 'absolute',
                  left: aim.x * IMG_W * zoom + pan.x - 13,
                  top: aim.y * IMG_W * zoom + pan.y - 13,
                  width: 26, height: 26,
                }}>
                  <Svg width={26} height={26} viewBox="0 0 26 26">
                    <Circle cx="13" cy="13" r="10" fill="none" stroke="#12B76A" strokeWidth="2" />
                    <Line x1="13" y1="0" x2="13" y2="8" stroke="#12B76A" strokeWidth="2" />
                    <Line x1="13" y1="18" x2="13" y2="26" stroke="#12B76A" strokeWidth="2" />
                    <Line x1="0" y1="13" x2="8" y2="13" stroke="#12B76A" strokeWidth="2" />
                    <Line x1="18" y1="13" x2="26" y2="13" stroke="#12B76A" strokeWidth="2" />
                  </Svg>
                </View>
              )}
              {shots.map((p, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={(e) => { e.stopPropagation(); removeShot(i); }}
                  style={[s.shotDot, {
                    width: dotSize, height: dotSize, borderRadius: dotSize / 2,
                    left: p.x * IMG_W * zoom + pan.x - dotSize / 2,
                    top: p.y * IMG_W * zoom + pan.y - dotSize / 2,
                  }]}
                >
                  <Text style={[s.shotDotText, { fontSize: dotSize < 20 ? 8 : 10 }]}>{i + 1}</Text>
                </TouchableOpacity>
              ))}
              <View style={s.shotOverlay}>
                <Text style={s.shotOverlayText}>
                  {shots.length} shots · {stats ? formatGroup(stats.extremeSpreadIn, distance, units.group) : '—'}
                </Text>
              </View>
            </TouchableOpacity>
            {/* The prose sits below the photo. It used to stack three blocks
                above it - the instruction, the fit verdict and the detect
                button - which put the photo 58% of the way down a phone, on the
                step whose whole job is tapping holes. The chips stay above,
                because they choose what you are about to tap, and they were
                also scrolling out of reach while marking. */}
            <View style={[s.instruction, { backgroundColor: colors.acs }]}>
              <Crosshair size={17} color={colors.act} />
              <Text style={[s.instructionText, { color: colors.act }]}>Tap each bullet hole. Tap a marker again to remove it.</Text>
            </View>
            {/* What this target's rim measurement decided, and a way out of it.
                Placing happens on the previous screen at whole-sheet zoom; this
                is the first view where the circle is big enough to judge. Until
                now the verdict was only shown while placing and the sole
                recovery was Reset, which threw away every target. */}
            {refMode === 'bull' && activeFit && (
              <View style={[s.detectNote, {
                backgroundColor: activeQuality.ok
                  ? (activeQuality.level === 'good' ? colors.oks : colors.warns)
                  : colors.dngs,
                borderColor: 'transparent',
              }]}>
                <Text style={[s.detectNoteText, {
                  color: activeQuality.ok
                    ? (activeQuality.level === 'good' ? colors.okt : colors.warnt)
                    : colors.dngt,
                }]}>{activeQuality.text}</Text>
                <TouchableOpacity
                  onPress={() => {
                    // Re-place this one target, keeping every other target and
                    // every shot already marked on them.
                    remember(`re-place target ${activeGroup + 1}`);
                    setGroups(prev => prev.map((g, i) =>
                      i === activeGroup ? { ...g, corners: [], taps: [], fit: null } : g));
                    setEditingCorner(null);
                    setStep(2);
                  }}
                  style={[s.replaceBtn, { borderColor: colors.ibd }]}
                >
                  <RotateCcw size={13} color={colors.mut} />
                  <Text style={[s.replaceBtnText, { color: colors.mut }]}>
                    Re-place target {activeGroup + 1}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {photo && (
              <TouchableOpacity
                onPress={autoDetect}
                disabled={detecting}
                style={[s.detectBtn, { opacity: detecting ? 0.6 : 1 }]}
              >
                {detecting
                  ? <LoaderCircle size={17} color="#fff" />
                  : <Wand2 size={17} color="#fff" />}
                <Text style={s.detectBtnText}>
                  {detecting ? 'Scanning target…' : 'Suggest shots'}
                </Text>
              </TouchableOpacity>
            )}

            {detectNote && (
              <View style={[s.detectNote, { backgroundColor: colors.inset, borderColor: colors.ibd }]}>
                <Text style={[s.detectNoteText, { color: colors.mut }]}>{detectNote}</Text>
              </View>
            )}
            <View style={s.zoomBar}>
              <TouchableOpacity onPress={() => stepZoom(1 / 1.6)} disabled={zoom <= 1}
                style={[s.zoomBtn, { backgroundColor: colors.card, borderColor: colors.bd, opacity: zoom <= 1 ? 0.4 : 1 }]}>
                <ZoomOut size={16} color={colors.tx} />
              </TouchableOpacity>
              <Text style={[s.zoomLabel, { color: colors.mut }]}>{zoom.toFixed(1)}x</Text>
              <TouchableOpacity onPress={() => stepZoom(1.6)} disabled={zoom >= 8}
                style={[s.zoomBtn, { backgroundColor: colors.card, borderColor: colors.bd, opacity: zoom >= 8 ? 0.4 : 1 }]}>
                <ZoomIn size={16} color={colors.tx} />
              </TouchableOpacity>
              <TouchableOpacity onPress={resetView} disabled={zoom === 1}
                style={[s.zoomBtn, { backgroundColor: colors.card, borderColor: colors.bd, opacity: zoom === 1 ? 0.4 : 1 }]}>
                <Maximize2 size={15} color={colors.tx} />
              </TouchableOpacity>
              <Text style={[s.zoomHint, { color: colors.fnt }]}>
                {zoom > 1 ? 'Two fingers to move the view' : 'Pinch, or zoom in to place precisely'}
              </Text>
            </View>
            {undoLabel && (
              <TouchableOpacity onPress={undoLast} style={[s.undoBar, { backgroundColor: colors.inset, borderColor: colors.ibd }]}>
                <RotateCcw size={14} color={colors.act} />
                <Text style={[s.undoText, { color: colors.act }]}>Undo {undoLabel}</Text>
              </TouchableOpacity>
            )}
            <View style={s.scaleFooter}>
              <Text style={[s.scaleCount, { color: colors.mut }]}>
                Live group <Text style={{ color: colors.tx, fontWeight: '700', fontFamily: 'JetBrainsMono_700Bold' }}>{stats ? formatGroup(stats.extremeSpreadIn, distance, units.group) : '—'}</Text>
              </Text>
              <TouchableOpacity onPress={clearShots} style={s.resetBtn}>
                <Eraser size={14} color={colors.act} />
                <Text style={[s.resetText, { color: colors.act }]}>Clear</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Step 4: Review */}
        {step === 4 && (
          <View>
            <View style={[s.reviewCard, { backgroundColor: colors.card, borderColor: colors.bd }]}>
              <View style={[s.reviewThumb, { borderColor: colors.bd }]}>
                {photo && <Image source={{ uri: photo.uri }} style={{ position: 'absolute', width: '100%', height: '100%' }} resizeMode="cover" />}
              </View>
              <View>
                <Text style={[s.reviewMsg, { color: capGood ? colors.okt : colors.tx }]}>
                  {capGood ? 'Tight group!' : (savedCount ? (savedCount > 1 ? `${savedCount} groups measured` : 'Group measured') : 'Mark at least 2 shots')}
                </Text>
                <Text style={[s.reviewSub, { color: colors.mut }]}>
                  <Text style={{ fontFamily: 'JetBrainsMono_700Bold' }}>{savedShots}</Text> shots
                  {savedCount > 1 ? ` across ${savedCount} targets` : ''} · best{' '}
                  <Text style={{ fontFamily: 'JetBrainsMono_700Bold' }}>{bestStat ? formatGroup(bestStat.extremeSpreadIn, distance, units.group) : '—'}</Text>
                </Text>
              </View>
            </View>

            {/* The demo used to be an obvious drawing, so nobody could mistake
                its output for a measurement. Now that it is a photograph the
                numbers look real, and they are only as real as the reference
                size that was typed in - which for this sheet nobody has
                measured. Say so here rather than let a sample walkthrough be
                filed as data. */}
            {photo?.demo && (
              <View style={[s.detectNote, { backgroundColor: colors.warns, borderColor: 'transparent' }]}>
                <Text style={[s.detectNoteText, { color: colors.warnt }]}>
                  This is the sample photograph. The shots and the group shape are real, but the
                  sizes above are scaled to the reference you entered, which was not measured off
                  this sheet. Treat them as a walkthrough, not a result.
                </Text>
              </View>
            )}

            {savedCount > 1 && (
              <View style={[s.perTarget, { backgroundColor: colors.inset }]}>
                {groups.map((g, i) => {
                  const st = groupStats[i];
                  if (g.shots.length < 2) return null;
                  return (
                    <View key={g.id} style={s.perTargetRow}>
                      <Text style={[s.perTargetLabel, { color: colors.mut }]}>Target {i + 1}</Text>
                      <Text style={[s.perTargetVal, { color: colors.tx }]}>
                        {g.shots.length} shots · {st ? formatGroup(st.extremeSpreadIn, distance, units.group) : '—'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}

            <View style={s.reviewGrid}>
              {[
                [`BEST GROUP (${groupUnitLabel(units.group)})`,
                  bestStat ? formatGroup(bestStat.extremeSpreadIn, distance, units.group, { withUnit: false }) : '—'],
                // The complement: an angle alone hides how big the group is, an
                // absolute length alone hides how it compares across distances.
                units.group === 'Inches'
                  ? ['BEST MOA', bestStat ? bestStat.groupMoa.toFixed(2) : '—']
                  : ['BEST SIZE', bestStat ? formatGroup(bestStat.extremeSpreadIn, distance, 'Inches') : '—'],
                [`MEAN RADIUS (${groupUnitLabel(units.group)})`,
                  bestStat ? formatGroup(bestStat.meanRadiusIn, distance, units.group, { withUnit: false }) : '—'],
                [savedCount > 1 ? 'TARGETS' : 'SHOTS', savedCount > 1 ? String(savedCount) : String(savedShots)],
              ].map(([label, val], i) => (
                <View key={i} style={[s.reviewTile, { backgroundColor: colors.card, borderColor: colors.bd }]}>
                  <Text style={[s.reviewTileLabel, { color: colors.mut }]}>{label}</Text>
                  <Text style={[s.reviewTileVal, { color: colors.tx }]}>{val}</Text>
                </View>
              ))}
            </View>

            <View style={s.field}>
              <Text style={[s.fieldLabel, { color: colors.mut }]}>Session Name</Text>
              <View style={[s.inputRow, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                <TextInput
                  value={sessionName}
                  onChangeText={setSessionName}
                  placeholder={defaultSessionName}
                  placeholderTextColor={colors.fnt}
                  style={[s.input, { color: colors.tx }]}
                />
              </View>
            </View>

            <TouchableOpacity onPress={saveAndFinish} style={s.saveBtn}>
              <Save size={18} color="#fff" />
              <Text style={s.saveBtnText}>Save Session</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Next button */}
        {(step >= 1 && step <= 3) && (
          <TouchableOpacity
            onPress={() => canNext && setStep(step + 1)}
            style={[s.nextBtn, { opacity: canNext ? 1 : 0.45 }]}
            disabled={!canNext}
          >
            <Text style={s.nextBtnText}>
              {step === 3 ? 'Review Group' : step === 2 ? (placedCount > 1 ? `Size & mark ${placedCount} targets` : 'Size & mark shots') : 'Continue'}
            </Text>
            <ArrowRight size={18} color="#fff" />
          </TouchableOpacity>
        )}
      </ScrollView>

      <PickerSheet
        visible={pickingRifle}
        title="Rifle"
        options={rifles.map(r => ({
          key: r.id,
          label: r.name,
          sub: [r.cartridge, r.twist && `1:${String(r.twist).replace(/^1:/, '')}`].filter(Boolean).join(' · '),
          meta: loads.filter(l => l.rifleId === r.id).length
            ? `${loads.filter(l => l.rifleId === r.id).length} loads` : 'no loads',
        }))}
        selectedKey={rifle?.id}
        onSelect={pickRifle}
        onClose={() => setPickingRifle(false)}
      />
      <PickerSheet
        visible={pickingLoad}
        title="Load"
        options={rifleLoads.map(l => ({
          key: l.id,
          label: l.name,
          sub: [l.bullet, l.powder && `${l.powder}${l.chargeGr ? ` ${l.chargeGr}gr` : ''}`]
            .filter(Boolean).join(' · '),
          meta: l.velocityFps ? `${Math.round(l.velocityFps)} fps` : '',
        }))}
        selectedKey={load?.id}
        onSelect={pickLoad}
        onClose={() => setPickingLoad(false)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  backBtn: { width: 38, height: 38, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' },
  subtitle: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  dots: { flexDirection: 'row', gap: 5, marginBottom: 20 },
  dot: { flex: 1, height: 5, borderRadius: 99 },

  // Photo step
  photoBox: { borderWidth: 2, borderStyle: 'dashed', borderRadius: 20, padding: 40, paddingHorizontal: 20, alignItems: 'center' },
  photoIcon: { width: 64, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  photoTitle: { fontSize: 16, fontWeight: '700' },
  photoDesc: { fontSize: 13, fontWeight: '500', lineHeight: 20, textAlign: 'center', marginTop: 6, marginBottom: 20 },
  photoBtns: { flexDirection: 'row', gap: 10 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#6D3BEB', paddingVertical: 13, paddingHorizontal: 20, borderRadius: 12 },
  primaryBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 13, paddingHorizontal: 20, borderRadius: 12 },
  secondaryBtnText: { fontSize: 14, fontWeight: '700' },
  demoLink: { fontSize: 13, fontWeight: '700', marginTop: 14 },

  // Setup step
  setupWrap: { gap: 14 },
  field: {},
  fieldLabel: { fontSize: 12, fontWeight: '700', marginBottom: 7 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 13, paddingHorizontal: 14 },
  // minWidth 0 so the field can shrink inside its row. A web <input> carries
  // a default size of 20 characters and a flex item will not shrink below its
  // intrinsic content width, so without this the box overflows and whatever
  // sits beside it is pushed out of view. That is how the distance unit went
  // missing: 'yd' was rendered every time, in a 215px input inside a 163px box.
  input: { flex: 1, minWidth: 0, paddingVertical: 14, fontSize: 15 },
  inputUnit: { fontSize: 13, fontWeight: '600' },
  fieldHint: { fontSize: 11.5, fontWeight: '600', lineHeight: 16, marginTop: 7, marginHorizontal: 2 },
  fieldError: { fontSize: 11.5, fontWeight: '700', lineHeight: 16, marginTop: 7, marginHorizontal: 2 },
  picker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 13, padding: 14, gap: 8 },
  pickerText: { flex: 1, fontSize: 15, fontWeight: '600' },
  pickerCycle: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pickerCount: { fontSize: 12, fontWeight: '700', fontFamily: 'JetBrainsMono_700Bold' },
  twoCol: { flexDirection: 'row', gap: 10 },

  // Scale / Shots
  instruction: { flexDirection: 'row', gap: 9, alignItems: 'center', padding: 12, paddingHorizontal: 14, borderRadius: 12, marginBottom: 14 },
  instructionText: { flex: 1, fontSize: 12.5, fontWeight: '600' },
  imgContainer: { position: 'relative', borderRadius: 18, overflow: 'hidden', borderWidth: 1, backgroundColor: '#222' },
  targetImg: { position: 'absolute', width: '100%', height: '100%' },
  overlayLine: { position: 'absolute', width: '100%', height: '100%' },
  cornerDot: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: '#F0872B', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.45, shadowRadius: 5, elevation: 4 },
  cornerDotText: { color: '#fff', fontSize: 11, fontWeight: '800', fontFamily: 'JetBrainsMono_700Bold' },
  shotDot: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(21,16,25,0.55)', borderWidth: 2.5, borderColor: '#8257F0', alignItems: 'center', justifyContent: 'center', zIndex: 3 },
  shotDotText: { color: '#fff', fontSize: 10, fontWeight: '800', fontFamily: 'JetBrainsMono_700Bold' },
  shotOverlay: { position: 'absolute', left: 12, bottom: 12, backgroundColor: 'rgba(11,11,16,0.82)', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8, zIndex: 4 },
  shotOverlayText: { color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: 'JetBrainsMono_700Bold' },
  detectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#6D3BEB', padding: 13, borderRadius: 13, marginBottom: 10 },
  detectBtnText: { fontSize: 14.5, fontWeight: '700', color: '#fff' },
  refModeBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  refModeText: { fontSize: 11.5, fontWeight: '700', textAlign: 'center' },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  presetChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingVertical: 6, paddingHorizontal: 11, borderRadius: 8, borderWidth: 1,
  },
  presetBin: { paddingVertical: 2, paddingLeft: 1 },
  presetText: { fontSize: 12, fontWeight: '700', fontFamily: 'JetBrainsMono_700Bold' },
  savePresetRow: { flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'stretch' },
  // minWidth 0 for the same reason as everywhere else: without it the web
  // <input> keeps its 20-character intrinsic width and pushes Save off the row.
  savePresetInput: {
    flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 9,
    paddingHorizontal: 11, paddingVertical: 9, fontSize: 12.5,
  },
  savePresetBtn: {
    justifyContent: 'center', paddingHorizontal: 16, borderRadius: 9, borderWidth: 1,
  },
  savePresetText: { fontSize: 12.5, fontWeight: '800' },
  markModeRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  devVariantText: { fontSize: 15, fontWeight: '800', marginTop: 2 },
  devVariantSub: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  devCard: { marginTop: 14, padding: 14, borderRadius: 14, borderWidth: 1, gap: 9 },
  devChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  devChip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, borderWidth: 1 },
  devChipText: { fontSize: 12, fontWeight: '700' },
  devHint: { fontSize: 11.5, fontWeight: '600', lineHeight: 16 },
  groupRow: { flexDirection: 'row', gap: 7, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 },
  groupChip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, borderWidth: 1 },
  groupChipText: { fontSize: 12, fontWeight: '700' },
  groupChipBin: { marginLeft: 6, opacity: 0.85 },
  groupAdd: { width: 32, height: 32, borderRadius: 9, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  cornerDotEditing: { borderColor: '#12B76A', borderWidth: 3, transform: [{ scale: 1.25 }] },
  markModeBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  markModeText: { fontSize: 13, fontWeight: '700' },
  markModeHint: { fontSize: 11.5, fontWeight: '600', marginBottom: 8, lineHeight: 16 },
  closeUpBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderRadius: 11, borderWidth: 1, marginTop: 10,
  },
  closeUpText: { fontSize: 13, fontWeight: '800' },
  undoBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 10, paddingVertical: 10, borderRadius: 11, borderWidth: 1 },
  undoText: { fontSize: 13, fontWeight: '700' },
  replaceBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8, paddingVertical: 8, borderRadius: 9, borderWidth: 1 },
  replaceBtnText: { fontSize: 12, fontWeight: '700' },
  detectNote: { borderWidth: 1, borderRadius: 11, padding: 11, paddingHorizontal: 13, marginBottom: 10 },
  detectNoteText: { fontSize: 12.5, fontWeight: '600', lineHeight: 18 },
  zoomBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  zoomBtn: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  zoomLabel: { fontSize: 12.5, fontWeight: '700', fontFamily: 'JetBrainsMono_700Bold', minWidth: 34, textAlign: 'center' },
  zoomHint: { flex: 1, fontSize: 10.5, fontWeight: '600', textAlign: 'right' },
  scaleFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  scaleCount: { fontSize: 12.5, fontWeight: '600' },
  resetBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  resetText: { fontSize: 13, fontWeight: '700' },

  // Review
  reviewCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 18, padding: 16, paddingHorizontal: 18, marginBottom: 14 },
  reviewThumb: { width: 78, height: 78, borderRadius: 12, overflow: 'hidden', borderWidth: 1, backgroundColor: '#222' },
  reviewMsg: { fontSize: 17, fontWeight: '800' },
  reviewSub: { fontSize: 13, fontWeight: '600', marginTop: 4 },
  perTarget: { padding: 12, borderRadius: 12, gap: 7, marginBottom: 12 },
  perTargetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  perTargetLabel: { fontSize: 12, fontWeight: '700' },
  perTargetVal: { fontSize: 12.5, fontWeight: '700', fontFamily: 'JetBrainsMono_700Bold' },
  reviewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  reviewTile: { flexGrow: 1, flexBasis: '47%', borderWidth: 1, borderRadius: 14, padding: 14 },
  reviewTileLabel: { fontSize: 11, fontWeight: '600' },
  reviewTileVal: { fontSize: 19, fontWeight: '700', marginTop: 5, fontFamily: 'JetBrainsMono_700Bold' },

  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#6D3BEB', padding: 16, borderRadius: 14 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  nextBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#6D3BEB', padding: 16, borderRadius: 14, marginTop: 20 },
  nextBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
