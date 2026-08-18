import { View, Text, ScrollView, TextInput, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Crosshair, Thermometer, Gauge, Wind, ArrowLeft, ChevronDown, Mountain, Droplets, Compass, Target, Plus, Trash2, TriangleAlert, Check, BookOpen } from 'lucide-react-native';
import { useState, useMemo, useRef, useEffect } from 'react';
import Svg, { Path, Line as SvgLine, Circle as SvgCircle, Text as SvgText } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { useTheme } from '../../lib/theme';
import { useData } from '../../store/data';
import { formatVelocity, formatDistance, mToYd, cToF, mpsToFps, ydToM, fToC, fpsToMps } from '../../lib/units';
import { establishZero, zeroUnderConditions, densityAltitude } from '../../lib/zeroing';
import { dopeCard, trueBC, trueBoth, windBracket } from '../../lib/ballistics';
import { sightTape, tapeToRows } from '../../lib/sighttape';
import { saveCSV, slugify } from '../../lib/export';
import { bulletDiameterIn } from '../../lib/calibers';
import { hitCurve, rangeAtProbability, dominantAdvice } from '../../lib/hitprob';
import { maxPointBlank, dangerSpace, describeDangerSpace } from '../../lib/pointblank';
import {
  parseDragFunction, checkDragFunction, makeDragFunction,
  sectionalDensity, impliedBc, compareToStandard,
} from '../../lib/dragfn';
import { standardCd, DRAG_MODELS } from '../../lib/ballistics';
import {
  gyroscopicStability, stabilityVerdict, secondaryEffects,
  parseTwist, parseGrains, densityRatioFromDa,
} from '../../lib/effects';
import PickerSheet from '../../components/PickerSheet';
import { MeasureHint } from '../../components/MeasureGuide';

/** Labelled numeric field. */
/**
 * `hint` puts a question mark beside the label, opening the diagram for that
 * measurement. Only on fields where the number is measured off the rifle rather
 * than read off a screen or a box - those are the ones people get wrong.
 */
function Field({ label, value, onChange, unit, colors, flex = 1, placeholder, hint }) {
  return (
    <View style={{ flex }}>
      <View style={s.fieldLabelRow}>
        <Text style={[s.fieldLabel, { color: colors.mut, marginBottom: 0 }]}>{label}</Text>
        {!!hint && <MeasureHint kind={hint} />}
      </View>
      <View style={[s.fieldBox, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          placeholder={placeholder}
          placeholderTextColor={colors.fnt}
          style={[s.fieldInput, { color: colors.tx }]}
          selectTextOnFocus
        />
        {!!unit && <Text style={[s.fieldUnit, { color: colors.fnt }]}>{unit}</Text>}
      </View>
    </View>
  );
}

function Segmented({ options, value, onChange, colors }) {
  return (
    <View style={[s.segmented, { backgroundColor: colors.inset }]}>
      {options.map(([k, label]) => (
        <TouchableOpacity key={k} onPress={() => onChange(k)}
          style={[s.seg, value === k && { backgroundColor: colors.card }]}>
          <Text style={[s.segText, { color: value === k ? colors.tx : colors.mut }]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function BallisticsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { loads, rifles, addDopeCard, updateRifle, updateLoad, units } = useData();

  const [loadIdx, setLoadIdx] = useState(0);
  const [picking, setPicking] = useState(false);
  const load = loads[loadIdx] || null;
  const rifle = rifles.find(r => r.id === load?.rifleId);

  const [mvFps, setMvFps] = useState(String(load?.velocityFps || 2800));
  // The BC belongs to the load. Typed fresh each visit it could not be compared
  // against another load, and a trued BC was discarded on leaving the screen.
  const [bc, setBc] = useState(String(load?.bc ?? '0.315'));
  const [dragModel, setDragModel] = useState(load?.dragModel || 'G7');
  const [unit, setUnit] = useState('moa');

  const [sightHeight, setSightHeight] = useState('1.5');
  const [zeroYd, setZeroYd] = useState('100');
  const [tempF, setTempF] = useState('59');
  const [pressureInHg, setPressureInHg] = useState('29.92');
  const [humidityPct, setHumidityPct] = useState('50');
  const [altitudeFt, setAltitudeFt] = useState('');
  const [windMph, setWindMph] = useState('10');
  const [windAngleDeg, setWindAngleDeg] = useState('90');
  const [maxRangeYd, setMaxRangeYd] = useState('1000');
  const [stepYd, setStepYd] = useState('100');

  const [turretDia, setTurretDia] = useState('1.5');
  const [perRev, setPerRev] = useState('15');
  const [clickValue, setClickValue] = useState('0.25');
  const [showTape, setShowTape] = useState(false);
  const [truing, setTruing] = useState(false);
  const [observations, setObservations] = useState([]);
  const [truedResult, setTruedResult] = useState(null);
  const [savedBc, setSavedBc] = useState(false);

  // A measured drag curve, when the shooter has one for this bullet.
  const [showCurve, setShowCurve] = useState(false);
  const [curveText, setCurveText] = useState('');
  const [curveName, setCurveName] = useState('');
  const [curveSource, setCurveSource] = useState('');
  const [curveWeight, setCurveWeight] = useState('');

  // Changing the active load brings its own coefficient with it.
  const lastLoadRef = useRef(load?.id ?? null);
  useEffect(() => {
    if (load?.id === lastLoadRef.current) return;
    lastLoadRef.current = load?.id ?? null;
    if (load?.bc) setBc(String(load.bc));
    if (load?.dragModel) setDragModel(load.dragModel);
    if (load?.velocityFps) setMvFps(String(Math.round(load.velocityFps)));
    setTruedResult(null);
    // A half-typed curve belongs to the load it was being typed for. Carrying
    // it across would offer to save one bullet's radar data against another's.
    setCurveText(''); setCurveName(''); setCurveSource(''); setCurveWeight('');
  }, [load?.id, load?.bc, load?.dragModel, load?.velocityFps]);

  const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };

  // The solver works in fps, yards and Fahrenheit. The fields are labelled in
  // whatever the shooter uses, so the typed string is interpreted in that unit
  // and converted here, at the boundary. Converting the displayed value instead
  // would rewrite the field mid-keystroke and fight the typing.
  const dU = units.distance, tU = units.temp, vU = units.velocity;
  const toYd = (v, d) => (dU === 'm' ? mToYd(num(v, d)) : num(v, d));
  const toF = (v, d) => (tU === '°C' ? cToF(num(v, d)) : num(v, d));
  const toFps = (v, d) => (vU === 'm/s' ? mpsToFps(num(v, d)) : num(v, d));
  // Defaults shown in the field, expressed in the display unit.
  // Sight height, pressure, altitude, wind speed and turret diameter have no
  // setting of their own — the four preferences cover group, temp, velocity and
  // distance. Rather than leave a metric shooter typing feet and inHg, they
  // follow the preference that implies the system: distance for lengths, and
  // velocity for wind, which is a speed.
  const metricLen = dU === 'm';
  const lenU = metricLen ? 'mm' : 'in';
  const altU = metricLen ? 'm' : 'ft';
  const presU = metricLen ? 'hPa' : 'inHg';
  const windU = vU === 'm/s' ? 'm/s' : 'mph';
  const toIn = (v, d) => (metricLen ? num(v, d) / 25.4 : num(v, d));
  const toFt = (v, d) => (metricLen ? num(v, d) / 0.3048 : num(v, d));
  const toInHg = (v, d) => (metricLen ? num(v, d) / 33.8639 : num(v, d));
  const toMph = (v, d) => (windU === 'm/s' ? num(v, d) * 2.236936 : num(v, d));

  const dflt = {
    zero: dU === 'm' ? '91' : '100',
    temp: tU === '°C' ? '15' : '59',
    maxRange: dU === 'm' ? '900' : '1000',
    step: dU === 'm' ? '100' : '100',
  };

  // The curve stored against this load, if any, and whether it can actually be
  // used. A custom Cd is divided by sectional density rather than BC (see
  // lib/dragfn), so weight and diameter are not optional extras here - without
  // them there is no divisor, and the curve stays stored but unused rather than
  // being applied with a number that would be wrong.
  const storedCurve = useMemo(() => {
    if (!load?.dragCurveJson) return null;
    try {
      const c = JSON.parse(load.dragCurveJson);
      return c?.points?.length ? c : null;
    } catch { return null; }
  }, [load?.dragCurveJson]);

  const curveSd = useMemo(() => {
    const grains = num(curveWeight, 0) || parseGrains(load?.bullet) || 0;
    const cal = bulletDiameterIn(load?.caliber || rifle?.cartridge || '');
    // Same reasoning as the stability panel: the fallback diameter is fine for
    // sizing a bullet hole and wrong when it is squared into a divisor.
    if (!cal.matched || !(grains > 0)) {
      return { sd: null, grains, dia: cal.matched ? cal.diameterIn : null, matched: cal.matched };
    }
    return { sd: sectionalDensity(grains, cal.diameterIn), grains, dia: cal.diameterIn, matched: true };
  }, [curveWeight, load?.bullet, load?.caliber, rifle?.cartridge]);

  const curveActive = !!(storedCurve && curveSd.sd > 0);

  const opts = useMemo(() => ({
    mvFps: toFps(mvFps, vU === 'm/s' ? 853 : 2800),
    bc: num(bc, 0.315),
    dragModel,
    // Present only when both halves are: solve() checks the same pair, but a
    // half-filled option object would leave the reason invisible here.
    dragCurve: curveActive ? storedCurve.points : null,
    sectionalDensity: curveActive ? curveSd.sd : null,
    sightHeightIn: toIn(sightHeight, metricLen ? 38 : 1.5),
    zeroYd: toYd(zeroYd, dU === 'm' ? 91 : 100),
    tempF: toF(tempF, tU === '°C' ? 15 : 59),
    pressureInHg: toInHg(pressureInHg, metricLen ? 1013 : 29.92),
    humidityPct: num(humidityPct, 0),
    altitudeFt: altitudeFt.trim() === '' ? null : toFt(altitudeFt, 0),
    windMph: toMph(windMph, 0),
    windAngleDeg: num(windAngleDeg, 90),
    maxRangeYd: Math.min(2000, Math.max(100, toYd(maxRangeYd, dU === 'm' ? 900 : 1000))),
    stepYd: Math.min(500, Math.max(25, toYd(stepYd, 100))),
    unit,
  }), [mvFps, bc, dragModel, sightHeight, zeroYd, tempF, pressureInHg, humidityPct,
       altitudeFt, windMph, windAngleDeg, maxRangeYd, stepYd, unit, dU, tU, vU,
       curveActive, storedCurve, curveSd.sd]);

  // What the pasted text amounts to, recomputed as it is typed so the verdict
  // arrives before the shooter commits rather than after.
  const pending = useMemo(() => {
    if (!curveText.trim()) return null;
    const parsed = parseDragFunction(curveText);
    return { parsed, verdict: checkDragFunction(parsed) };
  }, [curveText]);

  // The BC the active curve implies, across the flight. This is the chart worth
  // drawing: a quoted BC is one number, and the curve says by how much that is
  // a simplification and where.
  const implied = useMemo(() => {
    const pts = pending?.verdict?.ok ? pending.parsed.points : storedCurve?.points;
    if (!pts || !(curveSd.sd > 0)) return null;
    return impliedBc(pts, curveSd.sd, standardCd, dragModel);
  }, [pending, storedCurve, curveSd.sd, dragModel]);

  const vsStandard = useMemo(() => {
    const pts = pending?.verdict?.ok ? pending.parsed.points : storedCurve?.points;
    if (!pts) return null;
    return compareToStandard({
      points: pts, sd: curveSd.sd, standardCd, model: dragModel, bc: num(bc, 0),
    });
  }, [pending, storedCurve, bc, dragModel, curveSd.sd]);

  // Whether the printed card carries spin drift, Coriolis and aero jump.
  // Default on: the app computes them, they are worth about a minute at 1000,
  // and a card that silently omits them is the thing the audit called out.
  // Bullet and rifle geometry. These used to sit beside the Long Range panel,
  // which was their only reader. The dope card folds the same effects in now,
  // so they are declared with the rest of the state rather than halfway down
  // the component, below the memo that needs them.
  const [showLR, setShowLR] = useState(false);
  const [bulletLen, setBulletLen] = useState('');
  const [twistIn, setTwistIn] = useState('');
  const [grainsIn, setGrainsIn] = useState('');
  const [rightTwist, setRightTwist] = useState(true);
  const [latitude, setLatitude] = useState('');
  const [azimuth, setAzimuth] = useState('');
  /**
   * Whether the azimuth typed above is magnetic or true, and by how much they
   * differ here.
   *
   * Coriolis needs a *true* bearing, and a compass reads a magnetic one. The
   * app asked for "azimuth" and used whatever arrived, which in western North
   * America is well over ten degrees adrift and in parts of Alaska more than
   * twenty. The horizontal Coriolis term goes as sin of the bearing, so near
   * east or west that is a few percent and near north or south it is most of
   * the answer.
   *
   * The declination itself is asked for rather than computed. The NOAA World
   * Magnetic Model is public domain and would give it from a position, but it
   * is a set of coefficients reissued every five years - shipping numbers from
   * memory is exactly the failure this project keeps refusing, and the figure
   * is printed on every chart and given by any compass app.
   */
  const [azimuthIsMagnetic, setAzimuthIsMagnetic] = useState(false);
  const [declination, setDeclination] = useState('');

  /**
   * The bearing Coriolis actually wants. East declination is positive, so a
   * magnetic bearing plus the declination is the true one.
   */
  const trueAzimuth = useMemo(
    () => num(azimuth, 0) + (azimuthIsMagnetic ? num(declination, 0) : 0),
    [azimuth, azimuthIsMagnetic, declination]
  );

  const [foldEffects, setFoldEffects] = useState(true);
  // Look angle to the target. Uphill positive, downhill negative — though the
  // correction is the same either way, which is the thing shooters get wrong.
  const [inclineDeg, setInclineDeg] = useState('');

  /**
   * The effects block handed to dopeCard.
   *
   * Built from the same inputs as the Long Range panel but not from `lr`, which
   * is derived from `card` - taking it from there would make the card depend on
   * itself. Both read the rifle and the bullet; only the plumbing differs.
   */
  const cardEffects = useMemo(() => {
    if (!foldEffects) return null;
    const grains = num(grainsIn, 0) || parseGrains(load?.bullet);
    const twist = num(twistIn, 0) || parseTwist(rifle?.twist);
    const cal = bulletDiameterIn(load?.caliber || rifle?.cartridge || '');
    const dia = cal.matched ? cal.diameterIn : 0;
    const lengthIn = toIn(bulletLen, 0);
    if (!(grains > 0) || !(twist > 0) || !(dia > 0) || !(lengthIn > 0)) return null;
    const da = densityAltitude({
      pressureInHg: opts.pressureInHg, tempF: opts.tempF, humidityPct: opts.humidityPct,
    });
    const sg = gyroscopicStability({
      bulletGrains: grains, diameterIn: dia, lengthIn, twistIn: twist,
      mvFps: opts.mvFps, densityRatio: densityRatioFromDa(da),
    });
    if (!(sg > 0)) return null;
    return {
      sg,
      lengthCalibers: lengthIn / dia,
      rightHandTwist: rightTwist,
      latitudeDeg: latitude.trim() === '' ? null : num(latitude, 0),
      azimuthDeg: trueAzimuth,
    };
  }, [foldEffects, grainsIn, twistIn, bulletLen, latitude, trueAzimuth, rightTwist,
      load, rifle, opts.mvFps, opts.pressureInHg, opts.tempF, opts.humidityPct]);

  const card = useMemo(
    () => dopeCard({ ...opts, effects: cardEffects, inclineDeg: num(inclineDeg, 0) }),
    [opts, cardEffects, inclineDeg]
  );
  const wind = useMemo(() => windBracket(opts), [opts]);

  /**
   * A finely sampled solve, for the chart only.
   *
   * The card steps at whatever the shooter chose, usually 100 yards, and the
   * first row is therefore the zero. Drawn from that, the trajectory appears to
   * start *on* the line of sight and cross it once - when it starts an inch and
   * a half below the sight line, rises through it inside the first few dozen
   * yards, and comes back down through it at the zero. Two crossings, and the
   * near one is the one people have never seen. Sampling every fortieth of the
   * range costs one more solve and is the difference between a chart that
   * teaches the shape and one that hides it.
   */
  const traj = useMemo(() => dopeCard({
    ...opts,
    effects: cardEffects,
    inclineDeg: num(inclineDeg, 0),
    stepYd: Math.max(5, Math.round(opts.maxRangeYd / 40)),
  }), [opts, cardEffects, inclineDeg]);
  const unitLabel = unit === 'mil' ? 'MIL' : 'MOA';
  const firstTransonic = card.rows.find(r => r.transonic);

  // Long-range effects. Bullet length has no home in the load record and has to
  // be measured or looked up, so it is asked for. Weight, diameter and twist do
  // have homes, so they are read from there and only asked for when unreadable.

  const lr = useMemo(() => {
    const grains = num(grainsIn, 0) || parseGrains(load?.bullet);
    const twist = num(twistIn, 0) || parseTwist(rifle?.twist);
    // bulletDiameterIn falls back to 6.5mm when it recognises nothing, which is
    // fine for sizing a bullet hole and wrong here: diameter is cubed in Sg, so
    // an unmatched caliber has to stop the calculation rather than lean on a
    // default. Only a matched diameter is accepted.
    const cal = bulletDiameterIn(load?.caliber || rifle?.cartridge || '');
    const dia = cal.matched ? cal.diameterIn : 0;
    const lengthIn = toIn(bulletLen, 0);

    const da = densityAltitude({
      tempF: opts.tempF, pressureInHg: opts.pressureInHg, elevationFt: opts.altitudeFt || 0,
    });
    const sg = gyroscopicStability({
      bulletGrains: grains, diameterIn: dia, lengthIn, twistIn: twist,
      mvFps: opts.mvFps, densityRatio: densityRatioFromDa(da),
    });

    // Only the crosswind component causes aerodynamic jump, same as drift.
    const crosswindMph = opts.windMph * Math.sin(opts.windAngleDeg * Math.PI / 180);
    const lat = latitude.trim() === '' ? null : num(latitude, 0);

    const rows = sg == null ? [] : card.rows.map(r => ({
      rangeYd: r.rangeYd,
      ...secondaryEffects({
        sg, lengthCalibers: dia > 0 ? lengthIn / dia : 0,
        timeOfFlightSec: r.tofSec, rangeFt: r.rangeYd * 3,
        crosswindMph, rightHandTwist: rightTwist,
        latitudeDeg: lat, azimuthDeg: trueAzimuth,
      }),
    }));

    return { grains, twist, dia, lengthIn, sg, rows, needsLength: !(lengthIn > 0),
             needsGrains: !(grains > 0), needsTwist: !(twist > 0), needsDia: !(dia > 0) };
  }, [grainsIn, twistIn, bulletLen, latitude, trueAzimuth, rightTwist, load, rifle,
      opts, card.rows, metricLen]);

  // Hit probability. Every uncertainty starts empty, so the curve shows the
  // rifle alone until the shooter says how well they range and call wind.
  const [showHit, setShowHit] = useState(false);
  const [plateIn, setPlateIn] = useState('10');
  const [windSd, setWindSd] = useState('');
  const [rangeSd, setRangeSd] = useState('');
  const [mvSd, setMvSd] = useState('');
  const [groupMoa, setGroupMoa] = useState('');
  const [compareLoadId, setCompareLoadId] = useState(null);

  /**
   * Where a dead-on hold works, and how much ranging error a hit survives.
   *
   * Shares the plate size with the hit curve, because it is the same target and
   * asking twice would be an invitation to answer differently.
   */
  const reach = useMemo(() => {
    if (!showHit) return null;
    const dia = num(plateIn, 0);
    if (!(dia > 0)) return null;
    return {
      pbr: maxPointBlank({ opts, targetHeightIn: dia }),
      ds: dangerSpace({ opts, rangeYd: opts.maxRangeYd, targetHeightIn: dia }),
    };
  }, [showHit, plateIn, opts]);

  const hit = useMemo(() => {
    if (!showHit) return null;
    const dia = num(plateIn, 0);
    if (!(dia > 0)) return null;
    const step = Math.max(50, Math.round(opts.maxRangeYd / 12 / 50) * 50);
    const ranges = [];
    for (let r = step; r <= opts.maxRangeYd; r += step) ranges.push(r);
    const curve = hitCurve({
      opts, target: { diameterIn: dia }, ranges,
      windMphSd: num(windSd, 0), mvFpsSd: num(mvSd, 0),
      rangeYdSd: num(rangeSd, 0), groupMoa: num(groupMoa, 0),
      trials: 2500,
    });
    // A second load on the same axes, when one is chosen. Only the load's own
    // coefficient and velocity change; the rifle, the conditions and every
    // uncertainty stay identical, so the difference between the curves is the
    // ammunition and nothing else. That is the comparison worth making the
    // night before a match.
    const other = compareLoadId ? loads.find(l => l.id === compareLoadId) : null;
    let otherCurve = null;
    if (other?.bc) {
      const otherOpts = {
        ...opts,
        bc: Number(other.bc),
        dragModel: other.dragModel || opts.dragModel,
        mvFps: other.velocityFps ? Number(other.velocityFps) : opts.mvFps,
      };
      otherCurve = hitCurve({
        opts: otherOpts, target: { diameterIn: dia }, ranges,
        windMphSd: num(windSd, 0), mvFpsSd: num(mvSd, 0),
        rangeYdSd: num(rangeSd, 0), groupMoa: num(groupMoa, 0),
        trials: 2500,
      });
    }

    return {
      curve, ranges,
      even: rangeAtProbability(curve, 0.5),
      r90: rangeAtProbability(curve, 0.9),
      other, otherCurve,
      otherEven: otherCurve ? rangeAtProbability(otherCurve, 0.5) : null,
    };
  }, [showHit, plateIn, windSd, mvSd, rangeSd, groupMoa, opts, compareLoadId, loads]);

  // A bare linear distance, in whichever system the shooter reads lengths in.
  const fmtLen = (inches) =>
    metricLen ? `${Math.round(inches * 25.4)} mm` : `${inches.toFixed(1)}"`;

  // Inches to the output unit at that range, so the correction reads in the
  // same currency as the elevation and wind columns beside it.
  const toUnit = (inches, rangeYd) => {
    if (!rangeYd) return 0;
    const moa = inches / (1.047 * rangeYd / 100);
    return +(unit === 'mil' ? moa / 3.438 : moa).toFixed(2);
  };

  /**
   * Solve for whatever the dope can actually separate.
   *
   * With observations at well-separated ranges, velocity and BC can be told
   * apart and both are solved. Otherwise only BC is, because attributing a
   * velocity error to the bullet is the failure this exists to avoid and
   * guessing at it from one range would be exactly that.
   */
  const applyTruing = () => {
    const both = trueBoth(opts, observations);
    if (both.ok) {
      setTruedResult({ ...both, joint: true, factor: both.bcFactor });
      setBc(String(both.bc));
      setMvFps(String(vU === 'm/s' ? Math.round(fpsToMps(both.mvFps)) : both.mvFps));
      return;
    }
    const r = trueBC(opts, observations);
    setTruedResult(r ? { ...r, joint: false, why: both.reason } : null);
    if (r) setBc(String(r.bc));
  };

  // Per-revolution defaults differ by unit: 15 MOA and 10 mil are the common
  // scope conventions, and a click is 0.25 MOA or 0.1 mil.
  const tape = useMemo(() => sightTape(card.rows, {
    // Labelled in mm for a metric shooter, but sighttape works in inches.
    turretDiameterIn: toIn(turretDia, metricLen ? 38 : 1.5),
    perRev,
    clickValue,
  }), [card.rows, turretDia, perRev, clickValue, metricLen]);

  const [justSaved, setJustSaved] = useState(false);
  const saveCard = () => {
    // Freeze the rows as solved, not the inputs — a saved card is the answer
    // you confirmed, and re-solving it later under different defaults would
    // quietly change the numbers you are dialling at the range.
    addDopeCard({
      name: `${load?.name || 'Custom'} · ${formatDistance(opts.zeroYd, dU)} · ${tU === '°C' ? Math.round(fToC(opts.tempF)) : opts.tempF}${tU}`,
      loadId: load?.id ?? null,
      rifleId: rifle?.id ?? null,
      opts,
      rows: card.rows,
    });
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <TouchableOpacity
            onPress={() => router.canGoBack?.() ? router.back() : router.replace('/')}
            style={[s.backBtn, { backgroundColor: colors.card, borderColor: colors.bd }]}
          >
            <ArrowLeft size={19} color={colors.tx} />
          </TouchableOpacity>
          <Text style={[s.title, { color: colors.tx }]}>Ballistics</Text>
        </View>

        {/* Active load */}
        <View style={s.loadCard}>
          <TouchableOpacity onPress={() => setPicking(true)} style={s.loadHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.loadSub}>ACTIVE LOAD</Text>
              <Text style={s.loadName}>{load?.name || 'No load selected'}</Text>
              <Text style={s.loadDetail}>
                {[rifle?.name, load?.caliber].filter(Boolean).join(' · ') || 'Pick a load'}
              </Text>
            </View>
            <ChevronDown size={20} color="#8B6BF5" />
          </TouchableOpacity>

          <View style={s.loadStats}>
            <View style={s.loadStatCol}>
              <TextInput value={mvFps} onChangeText={setMvFps} keyboardType="number-pad"
                style={s.loadStatInput} selectTextOnFocus />
              <Text style={s.loadStatLabel}>MV {vU}</Text>
            </View>
            <View style={s.loadStatCol}>
              <TextInput value={bc} onChangeText={setBc} keyboardType="decimal-pad"
                style={s.loadStatInput} selectTextOnFocus />
              {/* Say where the figure came from. A trued BC and a box figure
                  are different kinds of number and should not look alike. */}
              <Text style={s.loadStatLabel}>
                BC {dragModel}{load?.bcTruedAt && Number(load.bc) === num(bc, -1) ? ' · trued' : ''}
              </Text>
            </View>
            <View style={s.loadStatCol}>
              <Text style={s.loadStatVal}>{card.densityRatio.toFixed(3)}</Text>
              <Text style={s.loadStatLabel}>Air density</Text>
            </View>
          </View>
        </View>

        {/* Eight models, so this is a wrapping chip row rather than the
            Segmented control it used to be: Segmented divides the width
            evenly, and eight even slices leaves each one too narrow to read
            "RA4", let alone hit.

            They are ordered by how often they are actually wanted, not
            alphabetically - G7 and G1 cover nearly every shooter, and the
            other six exist so a BC quoted against one of them can be used as
            quoted instead of being solved as something else. */}
        <View style={{ marginTop: 14 }}>
          <Text style={[s.fieldLabel, { color: colors.mut }]}>Drag model</Text>
          <View style={s.modelWrap}>
            {DRAG_MODELS.map((m) => {
              const on = dragModel === m.id;
              return (
                <TouchableOpacity key={m.id} onPress={() => setDragModel(m.id)}
                  style={[s.modelChip, {
                    backgroundColor: on ? colors.acs : colors.card,
                    borderColor: on ? colors.act : colors.bd,
                  }]}>
                  <Text style={[s.modelChipText, { color: on ? colors.act : colors.mut }]}>{m.id}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {/* Says what the selected model is for. Nobody remembers what G6 is,
              and picking one at random is worse than leaving it on G7. */}
          <Text style={[s.note, { color: colors.fnt }]}>
            {DRAG_MODELS.find(m => m.id === dragModel)?.note
              ?? 'Use the model your BC was quoted against.'}
          </Text>
        </View>

        <View style={s.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={[s.fieldLabel, { color: colors.mut }]}>Output</Text>
            <Segmented options={[['moa', 'MOA'], ['mil', 'MIL']]} value={unit} onChange={setUnit} colors={colors} />
          </View>
        </View>

        {/* A typed coefficient needs a way to be kept, not only a trued one.
            Without this the only route to storing a BC was to true it, which
            needs range dope a shooter may not have yet. */}
        {load && num(bc, 0) > 0 && Number(load.bc ?? -1) !== num(bc, -1) && (
          <TouchableOpacity
            onPress={() => {
              updateLoad(load.id, { bc: num(bc, 0), dragModel, bcTruedAt: null });
              setSavedBc(true);
              setTimeout(() => setSavedBc(false), 2200);
            }}
            style={[s.zeroBtn, { borderColor: colors.act, backgroundColor: colors.acs, marginTop: 12 }]}
          >
            <Text style={[s.zeroBtnText, { color: colors.act }]}>
              {savedBc ? 'Saved' : `Save BC ${num(bc, 0)} ${dragModel} to ${load.name}`}
            </Text>
          </TouchableOpacity>
        )}

        {/* Measured drag curve.
            Folded away by default: most shooters have a BC off a box and
            nothing else, and this is the answer to a question they have not
            asked yet. The header states which of the two is actually driving
            the card, because that is the part that must never be ambiguous. */}
        <TouchableOpacity onPress={() => setShowCurve(v => !v)}
          style={[s.curveHead, { borderColor: colors.bd, backgroundColor: colors.card }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.curveHeadTitle, { color: colors.tx }]}>Drag curve</Text>
            <Text style={[s.curveStoredMeta, { color: curveActive ? colors.act : colors.mut }]} numberOfLines={1}>
              {curveActive
                ? `Measured · ${storedCurve.name}`
                : storedCurve ? 'Stored, not in use' : `Standard ${dragModel}`}
            </Text>
          </View>
          <View style={[s.saveCardBtn, { backgroundColor: colors.acs }]}>
            <Text style={[s.saveCardText, { color: colors.act }]}>{showCurve ? 'Hide' : 'Show'}</Text>
          </View>
        </TouchableOpacity>

        {/* Said outside the fold as well. A shooter who has stored a curve and
            then edits the BC field would otherwise watch a number they changed
            do nothing to the card. */}
        {curveActive && (
          <Text style={[s.curveNote, { color: colors.mut }]}>
            This card is solved from {storedCurve.name}, not from the BC above. The BC field is
            kept for comparison and for the hit curve's second load.
          </Text>
        )}
        {storedCurve && !curveActive && (
          <Text style={[s.curveNote, { color: colors.warnt }]}>
            {storedCurve.name} is stored but not in use: a measured curve needs the bullet's
            sectional density, and {!curveSd.matched
              ? `the caliber "${load?.caliber || rifle?.cartridge || ''}" was not recognised`
              : 'the bullet weight could not be read from the load'}. Open the panel to supply it.
          </Text>
        )}

        {showCurve && (
          <View style={[s.curvePanel, { borderColor: colors.bd, backgroundColor: colors.inset }]}>
            <Text style={[s.curveProse, { color: colors.mut }]}>
              A ballistic coefficient says a bullet behaves like a reference shape, scaled. A
              measured curve is the bullet's own drag, from radar, used directly — which matters
              most through transonic, where the reference shape stops describing modern bullets.
            </Text>

            {storedCurve ? (
              <View style={[s.curveStored, { borderColor: colors.bd }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[s.curveStoredName, { color: colors.tx }]}>{storedCurve.name}</Text>
                  <Text style={[s.curveStoredMeta, { color: colors.mut }]} numberOfLines={2}>
                    {storedCurve.points.length} points · {storedCurve.source}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => updateLoad(load.id, { dragCurveJson: null })}
                  hitSlop={10} style={s.curveRemove}>
                  <Trash2 size={17} color={colors.dngt} />
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Sectional density: shown always, because when it is missing the
                curve silently does nothing, and that has to be visible. */}
            <View style={[s.curveSd, { borderColor: colors.bd }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.fieldLabel, { color: colors.mut }]}>Sectional density</Text>
                <Text style={[s.curveSdVal, { color: curveSd.sd > 0 ? colors.tx : colors.warnt }]}>
                  {curveSd.sd > 0
                    ? `${curveSd.sd.toFixed(4)} lb/in²`
                    : !curveSd.matched ? 'Caliber not recognised' : 'Bullet weight needed'}
                </Text>
                {curveSd.sd > 0 && (
                  <Text style={[s.curveStoredMeta, { color: colors.fnt }]}>
                    {curveSd.grains} gr at {curveSd.dia}"
                  </Text>
                )}
              </View>
              <View style={{ width: 92 }}>
                <Field label="Weight" value={curveWeight} onChange={setCurveWeight}
                  unit="gr" colors={colors}
                  placeholder={parseGrains(load?.bullet) ? String(parseGrains(load?.bullet)) : '140'} />
              </View>
            </View>

            <Text style={[s.fieldLabel, { color: colors.mut, marginTop: 14 }]}>
              Paste the curve — Mach and Cd, two numbers a line
            </Text>
            <TextInput
              value={curveText}
              onChangeText={setCurveText}
              multiline
              placeholder={'0.00, 0.118\n0.90, 0.146\n1.00, 0.379\n…'}
              placeholderTextColor={colors.fnt}
              style={[s.curveInput, {
                backgroundColor: colors.input, borderColor: colors.ibd, color: colors.tx,
              }]}
            />

            {pending && (
              <Text style={[s.curveVerdict, {
                color: pending.verdict.ok ? colors.okt : colors.warnt,
              }]}>
                {pending.verdict.text}
              </Text>
            )}

            {pending?.verdict?.ok && (
              <>
                <View style={[s.row, { marginTop: 10 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.fieldLabel, { color: colors.mut }]}>Name</Text>
                    <View style={[s.fieldBox, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                      <TextInput value={curveName} onChangeText={setCurveName}
                        placeholder={load?.bullet || 'Bullet'} placeholderTextColor={colors.fnt}
                        style={[s.fieldInput, { color: colors.tx }]} />
                    </View>
                  </View>
                </View>
                <View style={{ marginTop: 8 }}>
                  <Text style={[s.fieldLabel, { color: colors.mut }]}>Where it came from</Text>
                  <View style={[s.fieldBox, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                    <TextInput value={curveSource} onChangeText={setCurveSource}
                      placeholder="e.g. Lapua published radar data"
                      placeholderTextColor={colors.fnt}
                      style={[s.fieldInput, { color: colors.tx }]} />
                  </View>
                  {/* Required, and said plainly rather than enforced silently. */}
                  <Text style={[s.curveStoredMeta, { color: colors.fnt, marginTop: 4 }]}>
                    Required. A curve with no recorded origin cannot be checked later, and nobody
                    can tell whether it may be shared.
                  </Text>
                </View>
              </>
            )}

            {/* The chart. The claim it makes is specific: the BC this curve
                implies is not one number, and here is where it sags. */}
            {implied && (
              <>
                <Text style={[s.fieldLabel, { color: colors.mut, marginTop: 16 }]}>
                  The {dragModel} BC this curve implies
                </Text>
                <Svg viewBox="0 0 300 120" style={{ width: '100%', height: undefined, aspectRatio: 300 / 120, marginTop: 8 }}>
                  {(() => {
                    // The quoted BC shares the axis when it is close enough to
                    // be worth comparing against. When it is not - and a curve
                    // implying 0.44 against a typed 0.315 is not - drawing it
                    // would flatten the curve's shape to a line, so it is left
                    // off and the prose says so rather than promising a line
                    // that is not there.
                    const quoted = num(bc, 0);
                    const showQuoted = quoted > implied.min * 0.8 && quoted < implied.max * 1.2;
                    const lo = Math.min(implied.min * 0.96, showQuoted ? quoted * 0.98 : Infinity);
                    const hi = Math.max(implied.max * 1.04, showQuoted ? quoted * 1.02 : -Infinity);
                    const px = (m) => 34 + ((m - 0.6) / 2.4) * 262;
                    const py = (b) => 100 - ((b - lo) / (hi - lo || 1)) * 88;
                    const d = implied.rows.map((r, i) => `${i ? 'L' : 'M'} ${px(r.mach)} ${py(r.bc)}`).join(' ');
                    return (
                      <>
                        {[lo, (lo + hi) / 2, hi].map((b, i) => (
                          <SvgLine key={i} x1={34} y1={py(b)} x2={296} y2={py(b)}
                            stroke={colors.grid} strokeWidth={0.6} />
                        ))}
                        {[lo, hi].map((b, i) => (
                          <SvgText key={i} x={30} y={py(b) + 3} fontSize="8"
                            textAnchor="end" fill={colors.fnt}>{b.toFixed(2)}</SvgText>
                        ))}
                        {/* The single quoted figure, for contrast. */}
                        {showQuoted && (
                          <SvgLine x1={34} y1={py(quoted)} x2={296} y2={py(quoted)}
                            stroke={colors.mut} strokeWidth={1} strokeDasharray="4 3" />
                        )}
                        {/* Mach 1, which is where the divergence lives. */}
                        <SvgLine x1={px(1)} y1={8} x2={px(1)} y2={100}
                          stroke={colors.warnt} strokeWidth={0.8} strokeDasharray="2 2" />
                        <SvgText x={px(1)} y={116} fontSize="8" textAnchor="middle" fill={colors.fnt}>Mach 1</SvgText>
                        <Path d={d} fill="none" stroke="#8B6BF5" strokeWidth={2} />
                        <SvgText x={34} y={116} fontSize="8" fill={colors.fnt}>0.6</SvgText>
                        <SvgText x={296} y={116} fontSize="8" textAnchor="end" fill={colors.fnt}>3.0</SvgText>
                      </>
                    );
                  })()}
                </Svg>
                <Text style={[s.curveProse, { color: colors.mut }]}>
                  {implied.min.toFixed(3)} to {implied.max.toFixed(3)} across the flight,
                  a spread of {implied.spreadPct.toFixed(0)}%. One quoted BC has to stand in for
                  all of that, and the sag through Mach 1 is where it stands in worst.
                  {' '}
                  {num(bc, 0) > 0 && (num(bc, 0) <= implied.min * 0.8 || num(bc, 0) >= implied.max * 1.2)
                    ? `Your ${num(bc, 0)} is off this scale entirely — the curve implies nearer ${((implied.min + implied.max) / 2).toFixed(2)}, so check the weight and caliber above are right for this bullet before trusting either.`
                    : 'The flat dashed line is the BC you typed.'}
                </Text>
              </>
            )}

            {vsStandard && (
              <>
                <Text style={[s.fieldLabel, { color: colors.mut, marginTop: 12 }]}>
                  Drag against {dragModel} at BC {num(bc, 0.315)}
                </Text>
                <View style={s.curveRow}>
                  <Text style={[s.curveCell, { color: colors.fnt }]}>MACH</Text>
                  <Text style={[s.curveCell, { color: colors.fnt, textAlign: 'right' }]}>Cd</Text>
                  <Text style={[s.curveCell, { color: colors.fnt, textAlign: 'right' }]}>DRAG</Text>
                </View>
                {vsStandard.rows.map(r => (
                  <View key={r.mach} style={s.curveRow}>
                    <Text style={[s.curveCell, { color: colors.mut }]}>{r.mach.toFixed(2)}</Text>
                    <Text style={[s.curveCell, { color: colors.tx, textAlign: 'right' }]}>
                      {r.cd.toFixed(4)}
                    </Text>
                    {/* The ratio of decelerations, not of bare Cd - a raw Cd
                        and a Cd/BC are not comparable quantities. */}
                    <Text style={[s.curveCell, {
                      color: Math.abs(r.ratio - 1) > 0.05 ? colors.warnt : colors.mut,
                      textAlign: 'right',
                    }]}>
                      {r.ratio > 1 ? '+' : ''}{((r.ratio - 1) * 100).toFixed(1)}%
                    </Text>
                  </View>
                ))}
                <Text style={[s.curveProse, { color: colors.mut }]}>
                  Positive means this curve produces more drag than your BC assumes, so the card
                  under-dials. {vsStandard.worst && Math.abs(vsStandard.worst.ratio - 1) > 0.02
                    ? `Furthest apart at Mach ${vsStandard.worst.mach.toFixed(2)}, by ${Math.abs((vsStandard.worst.ratio - 1) * 100).toFixed(0)}%.`
                    : 'This curve and your BC agree closely, so importing it will change little.'}
                </Text>
              </>
            )}

            {pending?.verdict?.ok && (
              <TouchableOpacity
                disabled={!load || !curveSource.trim()}
                onPress={() => {
                  const df = makeDragFunction({
                    name: curveName.trim() || load?.bullet || 'Measured curve',
                    source: curveSource.trim(),
                    points: pending.parsed.points,
                  });
                  if (!df) return;
                  updateLoad(load.id, { dragCurveJson: JSON.stringify(df) });
                  setCurveText(''); setCurveName(''); setCurveSource('');
                }}
                style={[s.zeroBtn, {
                  borderColor: curveSource.trim() ? colors.act : colors.bd,
                  backgroundColor: curveSource.trim() ? colors.acs : 'transparent',
                  marginTop: 14,
                }]}
              >
                <Text style={[s.zeroBtnText, { color: curveSource.trim() ? colors.act : colors.fnt }]}>
                  {!load ? 'Pick a load first'
                    : !curveSource.trim() ? 'Say where it came from to save'
                    : `Save to ${load.name}`}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Rifle setup */}
        <Text style={[s.sectionLabel, { color: colors.fnt }]}>RIFLE</Text>
        <View style={s.row}>
          <Field label="Sight height" value={sightHeight} onChange={setSightHeight} unit={lenU} colors={colors} hint="sightHeight" />
          <Field label="Zero" value={zeroYd} onChange={setZeroYd} unit={dU} colors={colors} />
        </View>

        {/* Atmosphere */}
        <Text style={[s.sectionLabel, { color: colors.fnt }]}>ATMOSPHERE</Text>
        <View style={s.row}>
          <Field label="Temp" value={tempF} onChange={setTempF} unit={tU} colors={colors} />
          <Field label="Pressure" value={pressureInHg} onChange={setPressureInHg} unit={presU} colors={colors} />
        </View>
        <View style={s.row}>
          <Field label="Humidity" value={humidityPct} onChange={setHumidityPct} unit="%" colors={colors} />
          <Field label="Altitude" value={altitudeFt} onChange={setAltitudeFt} unit={altU} colors={colors} />
        </View>
        {altitudeFt.trim() !== '' && (
          <Text style={[s.note, { color: colors.fnt }]}>
            Altitude overrides the pressure field — station pressure is computed from it.
          </Text>
        )}

        {/* Wind */}
        <Text style={[s.sectionLabel, { color: colors.fnt }]}>WIND</Text>
        <View style={s.row}>
          <Field label="Speed" value={windMph} onChange={setWindMph} unit={windU} colors={colors} />
          <Field label="Angle" value={windAngleDeg} onChange={setWindAngleDeg} unit="°" colors={colors} />
          </View>
          <View style={s.row}>
            {/* The look angle to the target. Sits with wind because both are
                read off the target rather than set up at the bench. */}
            <Field label="Shot angle" value={inclineDeg} onChange={setInclineDeg} unit="°"
              placeholder="0" colors={colors} hint="incline" />
            <View style={{ flex: 1 }} />
        </View>
        <Text style={[s.note, { color: colors.fnt }]}>
          90° is a full-value crosswind, 0° a pure headwind. Drift scales with the sine,
          so a 30° wind is about half value.
        </Text>

        {/* Zero baseline: the angle, not a range. */}
        <Text style={[s.sectionLabel, { color: colors.fnt }]}>ZERO</Text>
        {(() => {
          const baseline = rifle?.zeroBaseline || null;
          const todayDa = densityAltitude({
            tempF: opts.tempF, pressureInHg: opts.pressureInHg, elevationFt: opts.altitudeFt || 0,
          });
          const check = baseline ? zeroUnderConditions(baseline, opts) : null;
          return (
            <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.bd }]}>
              <Text style={[s.zeroDa, { color: colors.mut }]}>
                Density altitude right now: {todayDa == null ? '—' : `${todayDa} ft`}
              </Text>
              {baseline ? (
                <>
                  <Text style={[s.zeroAngle, { color: colors.tx }]}>
                    {baseline.angleMil} mil bore angle · set at {baseline.zeroYd} yd,
                    {' '}{baseline.conditions.densityAltitudeFt} ft DA
                  </Text>
                  {check?.ok && (
                    <View style={[s.zeroResult, {
                      backgroundColor: check.matters ? colors.warns : colors.oks,
                    }]}>
                      <Text style={[s.zeroResultText, {
                        color: check.matters ? colors.warnt : colors.okt,
                      }]}>{check.verdict}</Text>
                    </View>
                  )}
                  <Text style={[s.note, { color: colors.fnt }]}>
                    The angle is the thing that does not move — only the turret changes it.
                    The range it zeroes at is computed for the conditions above.
                  </Text>
                  <TouchableOpacity
                    onPress={() => rifle && updateRifle(rifle.id, { zeroBaseline: null })}
                    style={[s.zeroBtn, { borderColor: colors.ibd }]}
                  >
                    <Text style={[s.zeroBtnText, { color: colors.mut }]}>Clear baseline</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={[s.note, { color: colors.fnt }]}>
                    {rifle
                      ? 'Record the bore angle once, in the conditions you zeroed in. After that the app tells you where the rifle shoots today instead of assuming the zero range never moved.'
                      : 'Link this load to a rifle to record a zero baseline.'}
                  </Text>
                  {!!rifle && (
                    <TouchableOpacity
                      onPress={() => {
                        const z = establishZero(opts);
                        if (z.ok) updateRifle(rifle.id, { zeroBaseline: z });
                      }}
                      style={[s.zeroBtn, { borderColor: colors.act, backgroundColor: colors.acs }]}
                    >
                      <Text style={[s.zeroBtnText, { color: colors.act }]}>
                        Set zero baseline from these conditions
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          );
        })()}

        {/* Table extent */}
        <Text style={[s.sectionLabel, { color: colors.fnt }]}>TABLE</Text>
        <View style={s.row}>
          <Field label="Max range" value={maxRangeYd} onChange={setMaxRangeYd} unit={dU} colors={colors} />
          <Field label="Step" value={stepYd} onChange={setStepYd} unit={dU} colors={colors} />
        </View>

        {/* Dope card */}
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.bd }]}>
          <View style={s.cardHead}>
            <Text style={[s.cardTitle, { color: colors.tx }]}>Dope Card</Text>
            <TouchableOpacity onPress={saveCard} style={[s.saveCardBtn, { backgroundColor: colors.acs }]}>
              <BookOpen size={14} color={colors.act} />
              <Text style={[s.saveCardText, { color: colors.act }]}>
                {justSaved ? 'Saved' : 'Save card'}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={[s.cardSub, { color: colors.fnt, marginBottom: 10 }]}>
            {formatDistance(opts.zeroYd, dU)} zero · {unitLabel} · {tU === '°C' ? Math.round(fToC(opts.tempF)) : opts.tempF}{tU}
          </Text>

          {/* Whether the card carries spin drift, Coriolis and aero jump.
              Stated on the card itself rather than hidden in a setting: a
              shooter comparing this against another solver needs to know
              which numbers are in it, and one that silently included them
              would be as misleading as one that silently did not. */}
          <TouchableOpacity onPress={() => setFoldEffects(v => !v)}
            style={[s.fxRow, {
              backgroundColor: card.includesEffects ? colors.acs : colors.inset,
              borderColor: card.includesEffects ? colors.act : colors.bd,
            }]}>
            <Text style={[s.fxText, { color: card.includesEffects ? colors.act : colors.mut }]}>
              {card.includesEffects
                ? 'Includes spin drift, Coriolis and aero jump'
                : foldEffects
                  ? 'Spin drift and Coriolis need bullet length, twist and caliber'
                  : 'Elevation and wind only'}
            </Text>
            <Text style={[s.fxToggle, { color: card.includesEffects ? colors.act : colors.fnt }]}>
              {foldEffects ? 'ON' : 'OFF'}
            </Text>
          </TouchableOpacity>

          <View style={s.tableHead}>
            <Text style={[s.th, { color: colors.fnt, flex: 1.1 }]}>RANGE</Text>
            <Text style={[s.th, { color: colors.fnt }]}>ELEV</Text>
            <Text style={[s.th, { color: colors.fnt }]}>WIND</Text>
            <Text style={[s.th, { color: colors.fnt }]}>VEL</Text>
            <Text style={[s.th, { color: colors.fnt, textAlign: 'right' }]}>TOF</Text>
          </View>

          {card.rows.map((r, i) => (
            <View key={r.rangeYd} style={[
              s.tr,
              i % 2 === 0 && { backgroundColor: colors.inset },
              r.transonic && { backgroundColor: colors.warns },
            ]}>
              <Text style={[s.td, { color: colors.tx, flex: 1.1 }]}>
                {dU === 'm' ? Math.round(ydToM(r.rangeYd)) : r.rangeYd}<Text style={{ fontSize: 10, color: colors.fnt }}> {dU}</Text>
              </Text>
              <Text style={[s.td, { color: colors.act, fontWeight: '800' }]}>{r.elevation}</Text>
              <Text style={[s.td, { color: colors.tx }]}>{r.wind}</Text>
              <Text style={[s.td, { color: r.transonic ? colors.warnt : colors.mut }]}>{r.velFps}</Text>
              <Text style={[s.td, { color: colors.mut, textAlign: 'right' }]}>{r.tofSec.toFixed(2)}</Text>
            </View>
          ))}

          {/* The trajectory, drawn.
              Every number in it was already computed and only ever tabulated.
              The shape is what a table hides: the bullet crosses the line of
              sight twice, and where the near crossing falls surprises people
              who have only ever read the far one off a card. */}
          {traj.rows.length > 1 && (() => {
            const pts = traj.rows;
            const maxR = pts[pts.length - 1].rangeYd;
            // Include zero on the vertical axis: a chart of drop that never
            // shows the line of sight has nothing to be a drop from.
            const drops = pts.map(r => r.dropIn);
            const lo = Math.min(0, ...drops) * 1.08;
            const hi = Math.max(0, ...drops, Math.abs(Math.min(...drops)) * 0.06);
            const px = (r) => 34 + (r / maxR) * 258;
            const py = (d) => 96 - ((d - lo) / ((hi - lo) || 1)) * 84;
            const path = pts.map((r, i) => `${i ? 'L' : 'M'} ${px(r.rangeYd)} ${py(r.dropIn)}`).join(' ');
            const first = pts.find(r => r.transonic);
            return (
              <>
                <Text style={[s.sectionLabel, { color: colors.fnt, marginTop: 18 }]}>
                  TRAJECTORY, RELATIVE TO THE LINE OF SIGHT
                </Text>
                <Svg viewBox="0 0 300 112" style={{ width: '100%', height: undefined, aspectRatio: 300 / 112, marginTop: 6 }}>
                  {/* The line of sight. Everything is measured from this. */}
                  <SvgLine x1={34} y1={py(0)} x2={292} y2={py(0)}
                    stroke={colors.mut} strokeWidth={1} strokeDasharray="4 3" />
                  <SvgText x={30} y={py(0) + 3} fontSize="8" textAnchor="end" fill={colors.fnt}>0</SvgText>
                  <SvgText x={30} y={py(lo) + 3} fontSize="8" textAnchor="end" fill={colors.fnt}>
                    {Math.round(lo)}"
                  </SvgText>

                  {/* Transonic, where the drag model starts guessing. */}
                  {first && (
                    <>
                      <SvgLine x1={px(first.rangeYd)} y1={8} x2={px(first.rangeYd)} y2={96}
                        stroke={colors.warnt} strokeWidth={0.9} strokeDasharray="2 2" />
                      <SvgText x={px(first.rangeYd)} y={108} fontSize="7.5" textAnchor="middle"
                        fill={colors.warnt}>transonic</SvgText>
                    </>
                  )}

                  <Path d={path} fill="none" stroke="#8B6BF5" strokeWidth={2} />

                  {/* Where it crosses the line of sight. The far one is the
                      zero everybody knows; the near one is the one that
                      surprises, and it is why a 100 yard zero is not a
                      straight line out to 100 yards. */}
                  {pts.map((r, i) => {
                    if (i === 0) return null;
                    const prev = pts[i - 1];
                    if ((prev.dropIn < 0) === (r.dropIn < 0)) return null;
                    const f = Math.abs(prev.dropIn) / (Math.abs(prev.dropIn) + Math.abs(r.dropIn) || 1);
                    const xr = prev.rangeYd + f * (r.rangeYd - prev.rangeYd);
                    return <SvgCircle key={`z${i}`} cx={px(xr)} cy={py(0)} r={2.6} fill={colors.okt} />;
                  })}

                  <SvgText x={34} y={108} fontSize="8" fill={colors.fnt}>0</SvgText>
                  <SvgText x={292} y={108} fontSize="8" textAnchor="end" fill={colors.fnt}>
                    {dU === 'm' ? Math.round(ydToM(maxR)) : maxR} {dU}
                  </SvgText>
                </Svg>
                <Text style={[s.cardBody, { color: colors.fnt }]}>
                  Green marks where the bullet crosses the line of sight. There are two on
                  any zero above the bore — it rises through the sight line, and comes back
                  down through it at the zero range.
                </Text>
              </>
            );
          })()}

          {/* Wind as a bracket.
              The card above solves one wind speed, and nobody knows the wind -
              they estimate it. Drift is exactly linear in speed, so the whole
              table comes out of the same solve for nothing, and the field
              arithmetic becomes "call it eight, read the eight column" rather
              than going back to the inputs and re-solving. */}
          <Text style={[s.sectionLabel, { color: colors.fnt, marginTop: 18 }]}>
            WIND HOLD ({unitLabel}), FULL VALUE
          </Text>
          <View style={s.wbRow}>
            <Text style={[s.wbHead, { color: colors.fnt, textAlign: 'left' }]}>RANGE</Text>
            {wind.speeds.map(v => (
              <Text key={v} style={[s.wbHead, { color: colors.fnt }]}>{v}{windU}</Text>
            ))}
            <Text style={[s.wbHead, { color: colors.fnt }]}>PER</Text>
          </View>
          {wind.rows.map((r, i) => (
            <View key={r.rangeYd} style={[s.wbRow, i % 2 === 0 && { backgroundColor: colors.inset }]}>
              <Text style={[s.wbCell, { color: colors.tx, textAlign: 'left' }]}>
                {dU === 'm' ? Math.round(ydToM(r.rangeYd)) : r.rangeYd}
              </Text>
              {r.holds.map((h, j) => (
                <Text key={j} style={[s.wbCell, { color: j === 1 ? colors.act : colors.tx }]}>{h}</Text>
              ))}
              <Text style={[s.wbCell, { color: colors.mut }]}>{r.perMph}</Text>
            </View>
          ))}
          <Text style={[s.cardBody, { color: colors.fnt, marginTop: 6 }]}>
            A full-value crosswind. Multiply by the sine of the clock angle for anything
            else — half value at 30°. The last column is per mile an hour, for a call
            between the columns.
          </Text>

          {firstTransonic && (
            <View style={[s.warn, { backgroundColor: colors.warns }]}>
              <TriangleAlert size={16} color={colors.warnt} style={{ marginTop: 1 }} />
              <Text style={[s.warnText, { color: colors.warnt }]}>
                Transonic from {formatDistance(firstTransonic.rangeYd, dU)} (Mach {firstTransonic.mach}). Drag models
                lose accuracy through the sound barrier and groups usually open up — treat dope
                past here as a starting point, then true it.
              </Text>
            </View>
          )}
        </View>

        {/* Hit probability */}
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.bd }]}>
          <View style={s.cardHead}>
            <Text style={[s.cardTitle, { color: colors.tx }]}>Chance of a Hit</Text>
            <TouchableOpacity onPress={() => setShowHit(v => !v)}
              style={[s.saveCardBtn, { backgroundColor: colors.acs }]}>
              <Text style={[s.saveCardText, { color: colors.act }]}>{showHit ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={[s.cardBody, { color: colors.mut }]}>
            A dope card says where to aim. This says whether you will hit, and which of
            your uncertainties is costing you the most. Everything below starts empty:
            until you say how well you range and call wind, this shows the rifle alone.
          </Text>

          {showHit && (
            <>
              <View style={[s.row, { marginTop: 12 }]}>
                <Field label="Plate size" value={plateIn} onChange={setPlateIn} unit={lenU} colors={colors} />
                <Field label="Your group" value={groupMoa} onChange={setGroupMoa} unit={unitLabel} colors={colors} placeholder="0.0" />
              </View>
              <Text style={[s.sectionLabel, { color: colors.fnt, marginTop: 10 }]}>HOW SURE ARE YOU</Text>
              <View style={s.row}>
                <Field label="Wind call" value={windSd} onChange={setWindSd} unit={`± ${windU}`} colors={colors} placeholder="0" />
                <Field label="Range" value={rangeSd} onChange={setRangeSd} unit={`± ${dU}`} colors={colors} placeholder="0" />
              </View>
              <View style={s.row}>
                <Field label="Velocity SD" value={mvSd} onChange={setMvSd} unit={vU} colors={colors} placeholder="0" />
                <View style={{ flex: 1 }} />
              </View>

              {hit?.curve?.length ? (
                <>
                  {/* The curve. Drawn rather than tabulated because the shape is
                      the point: where it falls off a cliff is the range worth
                      knowing, and a column of percentages hides that. */}
                  <Svg viewBox="0 0 300 130" style={{ width: '100%', height: undefined, aspectRatio: 300 / 130, marginTop: 14 }}>
                    {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
                      <SvgLine key={i} x1={30} y1={110 - p * 100} x2={296} y2={110 - p * 100}
                        stroke={colors.grid} strokeWidth={p === 0.5 ? 1.2 : 0.6}
                        strokeDasharray={p === 0.5 ? '3 3' : undefined} />
                    ))}
                    {[0, 0.5, 1].map((p, i) => (
                      <SvgText key={i} x={26} y={110 - p * 100 + 3} fontSize="8"
                        textAnchor="end" fill={colors.fnt}>{Math.round(p * 100)}%</SvgText>
                    ))}
                    {(() => {
                      const c = hit.curve;
                      const maxR = c[c.length - 1].rangeYd;
                      const px = (r) => 30 + (r / maxR) * 266;
                      const py = (p) => 110 - p * 100;
                      const d = c.map((pt, i) => `${i ? 'L' : 'M'} ${px(pt.rangeYd)} ${py(pt.pHit)}`).join(' ');
                      return (
                        <>
                          {hit.otherCurve && (
                            <Path
                              d={hit.otherCurve.map((pt, i) => `${i ? 'L' : 'M'} ${px(pt.rangeYd)} ${py(pt.pHit)}`).join(' ')}
                              fill="none" stroke={colors.mut} strokeWidth={1.6} strokeDasharray="4 3"
                            />
                          )}
                          <Path d={d} fill="none" stroke="#8B6BF5" strokeWidth={2} />
                          {c.map((pt, i) => (
                            <SvgCircle key={i} cx={px(pt.rangeYd)} cy={py(pt.pHit)} r={2.2} fill="#8B6BF5" />
                          ))}
                          {hit.even != null && (
                            <SvgLine x1={px(hit.even)} y1={10} x2={px(hit.even)} y2={110}
                              stroke={colors.warnt} strokeWidth={1} strokeDasharray="2 2" />
                          )}
                          <SvgText x={30} y={124} fontSize="8" fill={colors.fnt}>0</SvgText>
                          <SvgText x={296} y={124} fontSize="8" textAnchor="end" fill={colors.fnt}>
                            {dU === 'm' ? Math.round(ydToM(maxR)) : maxR} {dU}
                          </SvgText>
                        </>
                      );
                    })()}
                  </Svg>

                  <View style={s.hitStats}>
                    <View style={s.hitStat}>
                      <Text style={[s.hitStatVal, { color: colors.tx }]}>
                        {hit.r90 != null ? formatDistance(hit.r90, dU) : '—'}
                      </Text>
                      <Text style={[s.hitStatLabel, { color: colors.mut }]}>9 in 10</Text>
                    </View>
                    <View style={s.hitStat}>
                      <Text style={[s.hitStatVal, { color: colors.warnt }]}>
                        {hit.even != null ? formatDistance(hit.even, dU) : '—'}
                      </Text>
                      <Text style={[s.hitStatLabel, { color: colors.mut }]}>Even money</Text>
                    </View>
                  </View>

                  {/* The two questions a plate size answers besides "will I
                      hit it": how far you can ignore the dope entirely, and
                      how well you have to have ranged it. */}
                  {reach?.pbr && (
                    <View style={[s.pbrBox, { borderColor: colors.bd, backgroundColor: colors.inset }]}>
                      <Text style={[s.pbrTitle, { color: colors.tx }]}>
                        Hold dead-on to {formatDistance(reach.pbr.farYd, dU)}
                      </Text>
                      <Text style={[s.pbrBody, { color: colors.mut }]}>
                        Zeroed at {formatDistance(reach.pbr.zeroYd, dU)}, a centre hold keeps a
                        {' '}{num(plateIn, 0)}" target from {formatDistance(reach.pbr.nearYd ?? 0, dU)} out
                        to {formatDistance(reach.pbr.farYd, dU)} — no dialling, no hold-over.
                      </Text>
                      {reach.ds && (
                        <Text style={[s.pbrBody, { color: colors.mut, marginTop: 8 }]}>
                          {describeDangerSpace(reach.ds)}
                        </Text>
                      )}
                    </View>
                  )}

                  {/* Compare against another load. Only the ammunition changes,
                      so the gap between the curves is the bullet and the
                      velocity, not the conditions. */}
                  {loads.length > 1 && (
                    <>
                      <Text style={[s.sectionLabel, { color: colors.fnt, marginTop: 14 }]}>COMPARE WITH</Text>
                      <View style={s.presetRow}>
                        <TouchableOpacity
                          onPress={() => setCompareLoadId(null)}
                          style={[s.presetChip, {
                            backgroundColor: compareLoadId ? colors.input : colors.acs,
                            borderColor: compareLoadId ? colors.ibd : colors.act,
                          }]}
                        >
                          <Text style={[s.presetText, { color: compareLoadId ? colors.mut : colors.act }]}>None</Text>
                        </TouchableOpacity>
                        {loads.filter(l => l.id !== load?.id).map(l => (
                          <TouchableOpacity
                            key={l.id}
                            onPress={() => setCompareLoadId(compareLoadId === l.id ? null : l.id)}
                            style={[s.presetChip, {
                              backgroundColor: compareLoadId === l.id ? colors.acs : colors.input,
                              borderColor: compareLoadId === l.id ? colors.act : colors.ibd,
                            }]}
                          >
                            <Text style={[s.presetText, { color: compareLoadId === l.id ? colors.act : colors.mut }]}>
                              {l.name}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      {compareLoadId && !hit.other?.bc && (
                        <Text style={[s.note, { color: colors.warnt }]}>
                          {hit.other?.name} has no ballistic coefficient recorded, so it cannot be
                          compared. Open it on this screen and save one.
                        </Text>
                      )}
                      {hit.otherCurve && (
                        <Text style={[s.note, { color: colors.fnt }]}>
                          {/* Was `G{dragModel === 'G1' ? '1' : '7'}`, which
                              labelled a G5 load as G7. With eight models a
                              two-way guess is a wrong label on a comparison
                              whose whole job is telling two loads apart. */}
                          Dashed: {hit.other.name}, {hit.other.dragModel || 'G7'} BC {hit.other.bc}
                          {hit.otherEven != null && hit.even != null && (
                            hit.even === hit.otherEven
                              ? '. Even money at the same range.'
                              : `. Even money ${formatDistance(Math.abs(hit.even - hit.otherEven), dU)} ` +
                                `${hit.even > hit.otherEven ? 'closer' : 'further'} than the active load.`
                          )}
                        </Text>
                      )}
                    </>
                  )}

                  {/* What to fix. Variance shares, so the biggest is genuinely
                      the one worth attacking first. */}
                  {(() => {
                    const mid = hit.curve.find(c => c.pHit < 0.9) || hit.curve[hit.curve.length - 1];
                    const advice = dominantAdvice(mid);
                    if (!advice) {
                      return (
                        <Text style={[s.note, { color: colors.fnt, marginTop: 10 }]}>
                          No uncertainties entered, so this is the rifle on its own. Add your
                          wind call and ranging error to see what actually limits you.
                        </Text>
                      );
                    }
                    return (
                      <View style={[s.lrCallout, { borderColor: colors.ibd }]}>
                        <Text style={[s.lrCalloutTitle, { color: colors.tx }]}>
                          At {formatDistance(mid.rangeYd, dU)}: {Math.round(advice.share * 100)}% of your miss is {advice.source}
                        </Text>
                        <Text style={[s.note, { color: colors.fnt, marginTop: 2 }]}>{advice.text}</Text>
                      </View>
                    );
                  })()}
                </>
              ) : (
                <Text style={[s.note, { color: colors.fnt, marginTop: 10 }]}>
                  Enter a plate size to see the curve.
                </Text>
              )}
            </>
          )}
        </View>

        {/* Long-range effects */}
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.bd }]}>
          <View style={s.cardHead}>
            <Text style={[s.cardTitle, { color: colors.tx }]}>Long Range Effects</Text>
            <TouchableOpacity onPress={() => setShowLR(v => !v)}
              style={[s.saveCardBtn, { backgroundColor: colors.acs }]}>
              <Text style={[s.saveCardText, { color: colors.act }]}>{showLR ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={[s.cardBody, { color: colors.mut }]}>
            Spin drift, Coriolis and aerodynamic jump. Each is small on its own and they
            add up to roughly a minute at 1000. Fill these in and the card above carries
            them; leave them and it says so rather than quietly leaving them out. Truing a
            BC without them folds them into a number that is supposed to describe the
            bullet.
          </Text>

          {showLR && (
            <>
              <View style={[s.row, { marginTop: 12 }]}>
                <Field label="Bullet length" value={bulletLen} onChange={setBulletLen} unit={lenU} colors={colors} />
                {/* The rifle's twist shows as a placeholder rather than a
                    pre-filled value: it is used when the field is blank, and a
                    filled-in box would look like something the shooter typed. */}
                <Field label="Twist" value={twistIn} onChange={setTwistIn} unit="in"
                  placeholder={parseTwist(rifle?.twist) ? String(parseTwist(rifle.twist)) : ''}
                  colors={colors} />
              </View>
              {lr.needsGrains && (
                <View style={s.row}>
                  <Field label="Bullet weight" value={grainsIn} onChange={setGrainsIn} unit="gr" colors={colors} />
                  <View style={{ flex: 1 }} />
                </View>
              )}
              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.fieldLabel, { color: colors.mut }]}>Twist direction</Text>
                  <Segmented
                    options={[[true, 'Right'], [false, 'Left']]}
                    value={rightTwist} onChange={setRightTwist} colors={colors}
                  />
                </View>
              </View>

              {lr.sg == null ? (
                <Text style={[s.note, { color: colors.fnt }]}>
                  {lr.needsLength ? `Measure the bullet from tip to base and enter it in ${metricLen ? 'millimetres' : 'inches'}. ` : ''}
                  {lr.needsTwist ? 'Enter the barrel twist, or record it on the rifle. ' : ''}
                  {lr.needsGrains ? 'Enter the bullet weight in grains. ' : ''}
                  {lr.needsDia ? `Set a caliber on this load that names the cartridge, such as 6.5 Creedmoor or .308 Win. "${load?.caliber || rifle?.cartridge || ''}" does not identify a bullet diameter, and stability is far too sensitive to it to guess. ` : ''}
                  Nothing here is guessed, so all of these are needed before any of it means anything.
                </Text>
              ) : (
                <>
                  {(() => {
                    const v = stabilityVerdict(lr.sg);
                    const tone = v.level === 'unstable' || v.level === 'marginal'
                      ? { bg: colors.warns, fg: colors.warnt } : { bg: colors.oks, fg: colors.okt };
                    return (
                      <View style={[s.zeroResult, { backgroundColor: tone.bg, marginTop: 12 }]}>
                        <Text style={[s.zeroResultText, { color: tone.fg }]}>{v.text}</Text>
                      </View>
                    );
                  })()}

                  {/* Aerodynamic jump is a fixed angle, not something that
                      accumulates with range, so it belongs above the table
                      rather than repeated identically down a column. It is also
                      the only vertical effect here, and putting it beside three
                      horizontal ones invites adding it to them. */}
                  {(() => {
                    const j = lr.rows[0]?.aeroJump;
                    if (!j) return null;
                    const moa = unit === 'mil' ? +(j.moa / 3.438).toFixed(2) : j.moa;
                    const dir = moa > 0 ? 'higher' : moa < 0 ? 'lower' : null;
                    return (
                      <View style={[s.lrCallout, { borderColor: colors.ibd }]}>
                        <Text style={[s.lrCalloutTitle, { color: colors.tx }]}>
                          Aerodynamic jump {moa > 0 ? '+' : ''}{moa} {unitLabel} vertical
                        </Text>
                        <Text style={[s.note, { color: colors.fnt, marginTop: 2 }]}>
                          {dir
                            ? `This crosswind puts the shot ${dir}, by the same angle at every distance. It is set in the first few feet of flight, so unlike drop and drift it does not grow with range. Reverse the wind and it reverses.`
                            : 'No crosswind, so no jump. Set a wind speed and angle above to see it.'}
                        </Text>
                        {!j.reliable && (
                          <Text style={[s.note, { color: colors.warnt, marginTop: 4 }]}>{j.note}</Text>
                        )}
                      </View>
                    );
                  })()}

                  {lr.rows[0]?.coriolis && (
                    <View style={[s.lrCallout, { borderColor: colors.ibd }]}>
                      <Text style={[s.lrCalloutTitle, { color: colors.tx }]}>
                        Coriolis vertical {lr.rows[lr.rows.length - 1].coriolis.verticalWord || 'none'}
                      </Text>
                      <Text style={[s.note, { color: colors.fnt, marginTop: 2 }]}>
                        {lr.rows[lr.rows.length - 1].coriolis.verticalIn === 0
                          ? 'Firing due north or south, so there is no vertical component. Turn east or west and it appears.'
                          : `${fmtLen(Math.abs(lr.rows[lr.rows.length - 1].coriolis.verticalIn))} at the far end of this card. Shooting east adds to the bullet's eastward speed and it strikes high; west, low.`}
                      </Text>
                    </View>
                  )}

                  <View style={[s.tableHead, { marginTop: 12 }]}>
                    <Text style={[s.th, { color: colors.fnt, flex: 1.1 }]}>RANGE</Text>
                    <Text style={[s.th, { color: colors.fnt }]}>SPIN</Text>
                    <Text style={[s.th, { color: colors.fnt }]}>CORIOLIS</Text>
                    <Text style={[s.th, { color: colors.fnt, textAlign: 'right' }]}>HOLD</Text>
                  </View>
                  {lr.rows.map((r, i) => (
                    <View key={r.rangeYd} style={[s.tr, i % 2 === 0 && { backgroundColor: colors.inset }]}>
                      <Text style={[s.td, { color: colors.tx, flex: 1.1 }]}>
                        {dU === 'm' ? Math.round(ydToM(r.rangeYd)) : r.rangeYd}
                        <Text style={{ fontSize: 10, color: colors.fnt }}> {dU}</Text>
                      </Text>
                      <Text style={[s.td, { color: colors.tx }]}>{toUnit(r.spinDriftIn, r.rangeYd)}</Text>
                      <Text style={[s.td, { color: colors.mut }]}>
                        {r.coriolis ? toUnit(r.coriolis.horizontalIn, r.rangeYd) : '—'}
                      </Text>
                      <Text style={[s.td, { color: colors.act, fontWeight: '800', textAlign: 'right' }]}>
                        {toUnit(r.totalHorizontalIn, r.rangeYd)}
                      </Text>
                    </View>
                  ))}
                  <Text style={[s.note, { color: colors.fnt }]}>
                    Horizontal only, in {unitLabel}, positive to the right. Hold this in addition to
                    the wind on the dope card above. Spin drift never changes direction, so it is a
                    standing correction rather than a condition to read.
                  </Text>

                  <Text style={[s.sectionLabel, { color: colors.fnt, marginTop: 14 }]}>CORIOLIS</Text>
                  <View style={s.row}>
                    <Field label="Latitude" value={latitude} onChange={setLatitude} unit="° N" colors={colors} />
                    <Field label="Azimuth" value={azimuth} onChange={setAzimuth} unit="° from N" colors={colors} />
                  </View>
                  {/* Which north that bearing was read from. Coriolis wants
                      true; a compass gives magnetic, and the difference is
                      over ten degrees across much of western North America. */}
                  <View style={s.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.fieldLabel, { color: colors.mut }]}>Bearing is</Text>
                      <Segmented
                        options={[['true', 'True N'], ['mag', 'Magnetic']]}
                        value={azimuthIsMagnetic ? 'mag' : 'true'}
                        onChange={(v) => setAzimuthIsMagnetic(v === 'mag')}
                        colors={colors}
                      />
                    </View>
                    {azimuthIsMagnetic && (
                      <Field label="Declination" value={declination} onChange={setDeclination}
                        unit="° E" placeholder="0" colors={colors} />
                    )}
                  </View>
                  <Text style={[s.note, { color: colors.fnt }]}>
                    {latitude.trim() === ''
                      ? 'Left blank, Coriolis is left out rather than assumed. Enter your latitude to include it, negative in the southern hemisphere.'
                      : 'Horizontal deflection depends on latitude alone and does not cancel when you turn around. The vertical component depends on which way you face: east shoots high, west low.'}
                  </Text>
                </>
              )}
            </>
          )}
        </View>

        {/* Sight tape */}
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.bd }]}>
          <View style={s.cardHead}>
            <Text style={[s.cardTitle, { color: colors.tx }]}>Sight Tape</Text>
            <TouchableOpacity onPress={() => setShowTape(v => !v)}
              style={[s.saveCardBtn, { backgroundColor: colors.acs }]}>
              <Text style={[s.saveCardText, { color: colors.act }]}>{showTape ? 'Hide' : 'Build'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={[s.cardBody, { color: colors.mut }]}>
            A strip printed at 1:1 and wrapped round the elevation turret, marked with
            the yardage each position dials to.
          </Text>

          {showTape && (
            <>
              <View style={s.row}>
                <Field label="Turret dia" value={turretDia} onChange={setTurretDia} unit={lenU} colors={colors} />
                <Field label={`Per turn`} value={perRev} onChange={setPerRev} unit={unitLabel} colors={colors} />
                <Field label="Click" value={clickValue} onChange={setClickValue} unit={unitLabel} colors={colors} />
              </View>

              {tape.error ? (
                <View style={[s.warn, { backgroundColor: colors.inset }]}>
                  <TriangleAlert size={16} color={colors.mut} style={{ marginTop: 1 }} />
                  <Text style={[s.warnText, { color: colors.mut }]}>{tape.error}</Text>
                </View>
              ) : (
                <>
                  <Text style={[s.note, { color: colors.fnt, marginBottom: 10 }]}>
                    {tape.circumferenceIn}" circumference · {tape.revolutionsNeeded} turn
                    {tape.revolutionsNeeded === 1 ? '' : 's'} to reach {tape.maxElevation} {unitLabel}
                  </Text>

                  {/* Marks are drawn at their true fraction round the turret, so
                      the preview is a scale picture of the printed strip. */}
                  {tape.revolutions.map(rev => (
                    <View key={rev.index} style={s.tapeWrap}>
                      <Text style={[s.tapeRev, { color: colors.mut }]}>Turn {rev.index + 1}</Text>
                      <View style={[s.tapeStrip, { backgroundColor: colors.inset, borderColor: colors.ibd }]}>
                        {rev.marks.map(m => (
                          <View key={m.rangeYd} style={[s.tapeMark, {
                            left: `${(m.offsetIn / tape.circumferenceIn) * 100}%`,
                          }]}>
                            <View style={[s.tapeTick, { backgroundColor: m.transonic ? colors.warnt : colors.act }]} />
                            <Text style={[s.tapeLabel, { color: m.transonic ? colors.warnt : colors.tx }]}>
                              {m.rangeYd}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ))}

                  <TouchableOpacity
                    onPress={() => {
                      const header = `Turn,Range (yd),Elevation (${unitLabel}),Offset (in),Clicks`;
                      const body = tapeToRows(tape).map(r =>
                        [r.revolution, r.rangeYd, r.elevation, r.offsetIn, r.clicks].join(','));
                      saveCSV([header, ...body].join('\n'),
                        `${slugify(load?.name || 'load', 'tape')}-sight-tape.csv`);
                    }}
                    style={[s.addBtn, { borderColor: colors.ibd, marginTop: 4 }]}
                  >
                    <Text style={[s.addBtnText, { color: colors.act }]}>Export tape (CSV)</Text>
                  </TouchableOpacity>

                  <Text style={[s.note, { color: colors.fnt }]}>
                    Print without scaling — "actual size", not "fit to page". A tape
                    printed at 96% wraps a turret that is not 96% smaller.
                  </Text>
                </>
              )}
            </>
          )}
        </View>

        {/* Truing */}
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.bd }]}>
          <Text style={[s.cardTitle, { color: colors.tx, marginBottom: 6 }]}>Truing</Text>
          <Text style={[s.cardBody, { color: colors.mut }]}>
            Enter the elevation you actually dialled for a first-round hit at a known
            distance. The BC is solved backwards from it, so the card matches this rifle
            rather than the box figure.
          </Text>

          {observations.map((o, i) => (
            <View key={i} style={s.trueRow}>
              <View style={[s.fieldBox, { flex: 1, backgroundColor: colors.input, borderColor: colors.ibd }]}>
                <TextInput
                  value={o.rangeYd}
                  onChangeText={v => setObservations(prev => prev.map((x, j) => j === i ? { ...x, rangeYd: v } : x))}
                  placeholder="yd" placeholderTextColor={colors.fnt}
                  keyboardType="number-pad" style={[s.fieldInput, { color: colors.tx }]}
                />
              </View>
              <View style={[s.fieldBox, { flex: 1, backgroundColor: colors.input, borderColor: colors.ibd }]}>
                <TextInput
                  value={o.observedElevation}
                  onChangeText={v => setObservations(prev => prev.map((x, j) => j === i ? { ...x, observedElevation: v } : x))}
                  placeholder={unitLabel} placeholderTextColor={colors.fnt}
                  keyboardType="decimal-pad" style={[s.fieldInput, { color: colors.tx }]}
                />
              </View>
              <TouchableOpacity onPress={() => setObservations(prev => prev.filter((_, j) => j !== i))} style={s.trueDel}>
                <Trash2 size={15} color={colors.fnt} />
              </TouchableOpacity>
            </View>
          ))}

          <View style={s.trueActions}>
            <TouchableOpacity
              onPress={() => setObservations(prev => [...prev, { rangeYd: '', observedElevation: '' }])}
              style={[s.addBtn, { borderColor: colors.ibd }]}
            >
              <Plus size={15} color={colors.act} />
              <Text style={[s.addBtnText, { color: colors.act }]}>Add observation</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={applyTruing}
              disabled={!observations.length}
              style={[s.trueBtn, { opacity: observations.length ? 1 : 0.4 }]}
            >
              <Check size={15} color="#fff" />
              <Text style={s.trueBtnText}>True</Text>
            </TouchableOpacity>
          </View>

          {truedResult && (
            <View style={[s.trueResult, { backgroundColor: colors.oks }]}>
              <Text style={[s.trueResultText, { color: colors.okt }]}>
                {truedResult.joint
                  ? `Trued to ${formatVelocity(truedResult.mvFps, vU)} and BC ${truedResult.bc} — `
                    + `${truedResult.mvDelta >= 0 ? '+' : ''}${truedResult.mvDelta} fps and a ×${truedResult.bcFactor} `
                    + `correction, from ${truedResult.nearYd} and ${truedResult.farYd} yards. `
                    + `Reproduces your dope to ${truedResult.residual} ${unitLabel}. The card above now uses both.`
                  : `Trued BC ${truedResult.bc} — a ×${truedResult.factor} correction from the book `
                    + `figure, from ${truedResult.observations} observation`
                    + `${truedResult.observations === 1 ? '' : 's'}. The card above now uses it.`}
              </Text>
              {/* Why only the BC moved. Without this the shooter has no idea
                  the app could have done better with different dope. */}
              {!truedResult.joint && !!truedResult.why && (
                <Text style={[s.trueResultText, { color: colors.mut, marginTop: 6 }]}>
                  Velocity was left alone: {truedResult.why.charAt(0).toLowerCase() + truedResult.why.slice(1)}
                </Text>
              )}
              {/* Keep it. A BC solved backwards from this rifle's own dope is a
                  better number for this rifle than anything on the box, and it
                  was being discarded the moment the screen was left. */}
              {load && (
                <TouchableOpacity
                  onPress={() => {
                    updateLoad(load.id, {
                      bc: Number(truedResult.bc), dragModel,
                      bcTruedAt: new Date().toISOString(),
                    });
                    setSavedBc(true);
                    setTimeout(() => setSavedBc(false), 2200);
                  }}
                  style={[s.zeroBtn, { borderColor: colors.okt, marginTop: 8 }]}
                >
                  <Text style={[s.zeroBtnText, { color: colors.okt }]}>
                    {savedBc ? 'Saved to this load' : `Save ${truedResult.bc} to ${load.name}`}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      <PickerSheet
        visible={picking}
        title="Pick a load"
        options={loads.map((l, i) => ({
          key: String(i),
          label: l.name,
          sub: [rifles.find(r => r.id === l.rifleId)?.name, l.caliber].filter(Boolean).join(' · '),
          meta: l.velocityFps ? `${l.velocityFps} fps` : '',
        }))}
        selectedKey={String(loadIdx)}
        onSelect={(k) => {
          const i = Number(k);
          setLoadIdx(i);
          if (loads[i]?.velocityFps) setMvFps(String(loads[i].velocityFps));
          // Reset truing: it belongs to the load it was measured with.
          setTruedResult(null);
        }}
        onClose={() => setPicking(false)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  backBtn: { width: 38, height: 38, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },

  loadCard: { borderRadius: 18, padding: 18, backgroundColor: '#1A1922', overflow: 'hidden' },
  loadHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  loadSub: { fontSize: 12, fontWeight: '600', color: '#9E9BB0' },
  loadName: { fontSize: 18, fontWeight: '800', color: '#fff', marginTop: 6 },
  loadDetail: { fontSize: 13, fontWeight: '500', color: '#B9B6C8', marginTop: 4 },
  loadStats: { flexDirection: 'row', gap: 12, marginTop: 16 },
  loadStatCol: { flex: 1, minWidth: 0 },
  loadStatInput: { fontSize: 19, fontWeight: '700', color: '#fff', fontFamily: 'JetBrainsMono_700Bold', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.2)', paddingBottom: 2, width: '100%' },
  loadStatVal: { fontSize: 19, fontWeight: '700', color: '#fff', fontFamily: 'JetBrainsMono_700Bold' },
  loadStatLabel: { fontSize: 11, fontWeight: '600', color: '#9E9BB0', marginTop: 4 },

  toggleRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  modelWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  modelChip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 10, borderWidth: 1, minWidth: 52, alignItems: 'center' },
  modelChipText: { fontSize: 13, fontWeight: '700' },
  segmented: { flexDirection: 'row', gap: 4, borderRadius: 10, padding: 4 },
  seg: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 7 },
  segText: { fontSize: 13, fontWeight: '700' },

  zeroDa: { fontSize: 11.5, fontWeight: '700' },
  zeroAngle: { fontSize: 14, fontWeight: '800', fontFamily: 'JetBrainsMono_700Bold', lineHeight: 20 },
  zeroResult: { padding: 11, borderRadius: 10 },
  zeroResultText: { fontSize: 12.5, fontWeight: '700', lineHeight: 17 },
  zeroBtn: { paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  zeroBtnText: { fontSize: 12.5, fontWeight: '700' },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginTop: 18, marginBottom: 8 },
  curveHead: {
    flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1,
    borderRadius: 12, padding: 12, marginTop: 12,
  },
  curveHeadTitle: { fontSize: 13.5, fontWeight: '800', marginBottom: 2 },
  curveNote: { fontSize: 11.5, lineHeight: 16.5, marginTop: 8, paddingHorizontal: 2 },
  curvePanel: { borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 8 },
  curveProse: { fontSize: 11.5, lineHeight: 16.5, marginTop: 8 },
  curveStored: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 12,
  },
  curveStoredName: { fontSize: 13, fontWeight: '700' },
  curveStoredMeta: { fontSize: 11, lineHeight: 15 },
  // Comfortably past a thumb's width: this one deletes work.
  curveRemove: { padding: 8 },
  curveSd: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 10,
  },
  curveSdVal: { fontSize: 13, fontWeight: '700', fontFamily: 'JetBrainsMono_700Bold' },
  curveInput: {
    borderWidth: 1, borderRadius: 11, padding: 12, minHeight: 110,
    fontSize: 12.5, fontFamily: 'JetBrainsMono_700Bold', textAlignVertical: 'top',
  },
  curveVerdict: { fontSize: 11.5, lineHeight: 16.5, fontWeight: '700', marginTop: 8 },
  curveRow: { flexDirection: 'row', gap: 8, paddingVertical: 5 },
  curveCell: { flex: 1, fontSize: 11.5, fontFamily: 'JetBrainsMono_700Bold' },
  row: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  fieldLabel: { fontSize: 11.5, fontWeight: '700', marginBottom: 6 },
  fxRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12,
    marginBottom: 10,
  },
  fxText: { flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: '600', lineHeight: 16 },
  fxToggle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  pbrBox: { borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 14 },
  pbrTitle: { fontSize: 14, fontWeight: '800' },
  pbrBody: { fontSize: 12, lineHeight: 17.5, marginTop: 5 },
  wbRow: { flexDirection: 'row', paddingVertical: 6 },
  wbCell: { flex: 1, fontSize: 12, fontFamily: 'JetBrainsMono_700Bold', textAlign: 'right' },
  wbHead: { flex: 1, fontSize: 10, fontWeight: '800', letterSpacing: 0.4, textAlign: 'right' },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  fieldBox: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12 },
  // minWidth 0 because a flex item will not shrink below its intrinsic content
  // width by default. On web the underlying <input> carries a default size of
  // 20 characters, which made every box overflow its container and push the
  // unit suffix out of sight - "in", "yd", "°F" and the rest were all being
  // rendered and all invisible. Inert on native, where TextInput has no such
  // intrinsic width.
  fieldInput: { flex: 1, minWidth: 0, paddingVertical: 11, fontSize: 14.5, fontFamily: 'JetBrainsMono_700Bold' },
  fieldUnit: { fontSize: 11, fontWeight: '700' },
  note: { fontSize: 11, fontWeight: '600', lineHeight: 16, marginTop: 2, marginHorizontal: 2 },
  hitStats: { flexDirection: 'row', gap: 10, marginTop: 10 },
  hitStat: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10 },
  hitStatVal: { fontSize: 17, fontWeight: '800', fontFamily: 'JetBrainsMono_700Bold' },
  hitStatLabel: { fontSize: 10.5, fontWeight: '700', marginTop: 2 },
  lrCallout: { borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 10 },
  lrCalloutTitle: { fontSize: 13, fontWeight: '800' },

  card: { borderWidth: 1, borderRadius: 18, padding: 16, marginTop: 18, gap: 10 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  cardSub: { fontSize: 11, fontWeight: '600' },
  saveCardBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999 },
  saveCardText: { fontSize: 12, fontWeight: '700' },
  cardBody: { fontSize: 12.5, fontWeight: '500', lineHeight: 18, marginBottom: 12 },
  tableHead: { flexDirection: 'row', paddingBottom: 6, paddingHorizontal: 8 },
  th: { flex: 1, fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 8, borderRadius: 8 },
  td: { flex: 1, fontSize: 13, fontWeight: '700', fontFamily: 'JetBrainsMono_700Bold' },
  warn: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', padding: 12, borderRadius: 11, marginTop: 10 },
  warnText: { flex: 1, fontSize: 11.5, fontWeight: '600', lineHeight: 16 },

  trueRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 },
  trueDel: { width: 28, alignItems: 'center', justifyContent: 'center' },
  trueActions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  addBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderStyle: 'dashed', borderRadius: 11, paddingVertical: 11 },
  addBtnText: { fontSize: 13, fontWeight: '700' },
  trueBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#6D3BEB', borderRadius: 11, paddingVertical: 11, paddingHorizontal: 20 },
  trueBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  trueResult: { padding: 12, borderRadius: 11, marginTop: 10 },
  trueResultText: { fontSize: 12, fontWeight: '600', lineHeight: 17 },
  tapeWrap: { marginBottom: 14 },
  tapeRev: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4, marginBottom: 5 },
  tapeStrip: { height: 52, borderWidth: 1, borderRadius: 8, position: 'relative' },
  tapeMark: { position: 'absolute', top: 0, alignItems: 'center', width: 34, marginLeft: -17 },
  tapeTick: { width: 1.5, height: 16, marginTop: 4 },
  tapeLabel: { fontSize: 10, fontWeight: '800', marginTop: 3, fontFamily: 'JetBrainsMono_700Bold' },
});
