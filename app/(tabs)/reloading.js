import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CircleCheck, Target, FlaskConical, TrendingUp, Gauge, Zap, BarChart3, Ruler, BookCheck, ChevronRight, ChevronDown, ArrowLeft, Plus, Trash2, Info, TriangleAlert, Crosshair } from 'lucide-react-native';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../lib/theme';
import PickerSheet from '../../components/PickerSheet';
import { useData } from '../../store/data';
import { parseRungs, findNode, bestGroup } from '../../lib/loaddev';
import { parseDepths, analyseSeating } from '../../lib/seating';
import { assessReference } from '../../lib/refload';
import { parseStrings, comparePrimers } from '../../lib/primers';
import { parseWorkup, analyseWorkup } from '../../lib/pressure';
import { parseCandidates, analyseScreen } from '../../lib/screening';
import { groupUnitLabel, inchesToUnit, formatDistance } from '../../lib/units';
import { reconcileRows, reconcileVelocityRows, variantLabel } from '../../lib/variants';
import { targetGroups } from '../../lib/analytics';
import Svg, { Path, Line, Circle, Text as SvgText } from 'react-native-svg';
import ChronoImport from '../../components/ChronoImport';
import MeasureGuide from '../../components/MeasureGuide';

const STEP_META = [
  { num: 1, label: 'Goal', icon: Target, desc: 'Define your accuracy goal and hit-rate target for this load.' },
  { num: 2, label: 'Screen', icon: FlaskConical, desc: 'Screen candidate powders and bullets for the barrel.' },
  { num: 3, label: 'Max Chg', icon: TrendingUp, desc: 'Chart velocity against charge and watch for the curve bending upward.' },
  { num: 4, label: 'Accuracy', icon: BarChart3, desc: 'Coarse accuracy check across the charge range.' },
  { num: 5, label: 'Primers', icon: Zap, desc: 'Compare primer brands for the lowest velocity SD.' },
  { num: 6, label: 'Ladder', icon: Gauge, desc: 'Vary charge in small steps and look for a flat velocity node.' },
  { num: 7, label: 'Seating', icon: Ruler, desc: 'Tune seating depth (CBTO) around the chosen node.' },
  { num: 8, label: 'Ref', icon: BookCheck, desc: 'Confirm the reference load over full distance.' },
];

function NumField({ colors, label, unit, value, onChange }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[cs.lbl, { color: colors.mut }]}>{label}</Text>
      <View style={[cs.inp, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
        <TextInput
          value={value == null ? '' : String(value)}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          style={[cs.inpText, { color: colors.tx }]}
        />
        {!!unit && <Text style={[cs.unit, { color: colors.fnt }]}>{unit}</Text>}
      </View>
    </View>
  );
}

export default function ReloadingScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { projects, rifles, loads, sessions, updateProject, addProject, updateRifle, units } = useData();
  // Load dev figures are whatever the shooter enters — the analyses are
  // scale-invariant (they work in ratios and multiples of sigma), so the unit
  // only has to be labelled consistently and used in the prose.
  const gUnit = units.group === 'Inches' ? 'Inches' : units.group;
  const gLabel = groupUnitLabel(units.group);
  const vLabel = units.velocity;

  /**
   * Which project is being worked on.
   *
   * This was `projects[0]`, so however many were stored, only the first was
   * ever reachable - a second load workup could be created and then never
   * opened again. The store has always held an array; the screen simply never
   * offered a way in.
   *
   * Held by id rather than index so that adding or deleting one cannot slide
   * the selection onto a different project.
   */
  // The dashboard links straight to a specific workup, so a shooter picking one
  // off the "In Progress" list lands on it rather than on whichever happens to
  // be first.
  const params = useLocalSearchParams();
  const [projectId, setProjectId] = useState(params.projectId ?? null);
  const [pickingProject, setPickingProject] = useState(false);
  const project = projects.find(p => p.id === projectId) || projects[0] || null;
  const [step, setStep] = useState(project?.currentStep || 6);

  // Switching project brings its own step with it, rather than showing one
  // project's data under another's position in the workflow.
  const lastProjectRef = useRef(project?.id ?? null);
  useEffect(() => {
    if (project?.id === lastProjectRef.current) return;
    lastProjectRef.current = project?.id ?? null;
    if (project) setStep(project.currentStep || 1);
  }, [project?.id, project?.currentStep]);
  const [chronoRung, setChronoRung] = useState(null);

  const meta = STEP_META[step - 1];
  const StepIcon = meta.icon;

  /**
   * Group sizes measured against each rung, in MOA.
   *
   * A session tagged to a rung supersedes whatever was typed there, because a
   * measured group is better evidence than a remembered one. Rows with no
   * sessions keep their typed value - a shooter working from a notebook should
   * not have to re-shoot to use this screen.
   */
  const toMoa = useCallback(
    (sess) => targetGroups(sess).map(g => g.moa),
    []
  );
  const measuredRows = useCallback(
    (rows, step, field = 'groupMoa') =>
      reconcileRows(rows, sessions, project?.id, step, toMoa, field),
    [sessions, project?.id, toMoa]
  );

  const rawRungs = project?.rungs || [];
  const rungs = useMemo(() => measuredRows(rawRungs, 6), [measuredRows, rawRungs]);
  const parsed = useMemo(() => parseRungs(rungs), [rungs]);
  const analysis = useMemo(
    () => findNode(parsed, { shotsPerCharge: project?.shotsPerCharge || 1 }),
    [parsed, project?.shotsPerCharge]
  );
  const best = useMemo(() => bestGroup(parsed), [parsed]);

  const rawSeatingRows = project?.seatingRows || [];
  const seatingRows = useMemo(() => measuredRows(rawSeatingRows, 7), [measuredRows, rawSeatingRows]);
  const seatingShots = project?.seatingShots || 5;
  const depths = useMemo(() => parseDepths(seatingRows), [seatingRows]);
  const seating = useMemo(() => analyseSeating(depths, seatingShots, gLabel), [depths, seatingShots, gLabel]);

  const setDepth = (id, field, value) => {
    if (!project) return;
    updateProject(project.id, {
      seatingRows: rawSeatingRows.map(r => r.id === id ? { ...r, [field]: value } : r),
    });
  };
  const addDepth = () => {
    if (!project) return;
    // Continue at whatever increment is already in use; 0.003" is the common
    // starting step for a seating ladder.
    const last = rawSeatingRows[rawSeatingRows.length - 1];
    const prev = rawSeatingRows[rawSeatingRows.length - 2];
    let next = '';
    if (last) {
      const lc = parseFloat(last.cbto), pc = prev ? parseFloat(prev.cbto) : NaN;
      const inc = isFinite(lc) && isFinite(pc) ? +(lc - pc).toFixed(4) : 0.003;
      if (isFinite(lc)) next = String(+(lc + (inc || 0.003)).toFixed(3));
    }
    updateProject(project.id, {
      seatingRows: [...rawSeatingRows, { id: 'd' + Date.now(), cbto: next, groupMoa: '' }],
    });
  };
  const removeDepth = (id) =>
    project && updateProject(project.id, { seatingRows: rawSeatingRows.filter(r => r.id !== id) });

  // Steps 2 and 4 are the same shape — several candidates, one group each, and
  // the same refusal to rank them. Only the label on the first column differs.
  const rawScreenRows = project?.screenRows || [];
  const screenRows = useMemo(() => measuredRows(rawScreenRows, 2), [measuredRows, rawScreenRows]);
  const screenShots = project?.screenShots || 5;
  const screen = useMemo(
    () => analyseScreen(parseCandidates(screenRows), screenShots, 'combinations', gLabel),
    [screenRows, screenShots, gLabel]
  );
  const rawCoarseRows = project?.coarseRows || [];
  const coarseRows = useMemo(() => measuredRows(rawCoarseRows, 4), [measuredRows, rawCoarseRows]);
  const coarseShots = project?.coarseShots || 5;
  const coarse = useMemo(
    () => analyseScreen(parseCandidates(coarseRows), coarseShots, 'charges', gLabel),
    [coarseRows, coarseShots, gLabel]
  );

  const candidateOps = (key, list) => ({
    set: (id, field, value) => project && updateProject(project.id, {
      [key]: list.map(r => r.id === id ? { ...r, [field]: value } : r),
    }),
    add: () => project && updateProject(project.id, {
      [key]: [...list, { id: 'x' + Date.now(), name: '', groupMoa: '' }],
    }),
    remove: (id) => project && updateProject(project.id, {
      [key]: list.filter(r => r.id !== id),
    }),
  });

  const rawWorkupRows = project?.workupRows || [];
  const workupRows = useMemo(
    () => reconcileVelocityRows(rawWorkupRows, sessions, project?.id, 3),
    [rawWorkupRows, sessions, project?.id]
  );
  const workupPoints = useMemo(() => parseWorkup(workupRows), [workupRows]);
  const workup = useMemo(
    () => analyseWorkup(workupPoints, project?.bookMaxGr ? Number(project.bookMaxGr) : null,
      { velocityUnit: vLabel }),
    [workupPoints, project?.bookMaxGr, vLabel]
  );

  const setWorkup = (id, field, value) => {
    if (!project) return;
    updateProject(project.id, {
      workupRows: rawWorkupRows.map(r => r.id === id ? { ...r, [field]: value } : r),
    });
  };
  const addWorkup = () => {
    if (!project) return;
    const last = rawWorkupRows[rawWorkupRows.length - 1];
    const prev = rawWorkupRows[rawWorkupRows.length - 2];
    let next = '';
    if (last) {
      const lc = parseFloat(last.charge), pc = prev ? parseFloat(prev.charge) : NaN;
      const inc = isFinite(lc) && isFinite(pc) ? +(lc - pc).toFixed(2) : 0.3;
      if (isFinite(lc)) next = String(+(lc + (inc || 0.3)).toFixed(2));
    }
    updateProject(project.id, {
      workupRows: [...rawWorkupRows, { id: 'w' + Date.now(), charge: next, velocity: '', sign: null }],
    });
  };
  const removeWorkup = (id) => project && updateProject(project.id, {
    workupRows: rawWorkupRows.filter(r => r.id !== id),
  });

  const rawPrimerRows = project?.primerRows || [];
  const primerRows = useMemo(
    () => reconcileVelocityRows(rawPrimerRows, sessions, project?.id, 5,
      { meanField: null, listField: 'velocities' }),
    [rawPrimerRows, sessions, project?.id]
  );
  const primerStrings = useMemo(() => parseStrings(primerRows), [primerRows]);
  const primers = useMemo(() => comparePrimers(primerStrings, vLabel), [primerStrings, vLabel]);

  const setPrimer = (id, field, value) => {
    if (!project) return;
    updateProject(project.id, {
      primerRows: rawPrimerRows.map(r => r.id === id ? { ...r, [field]: value } : r),
    });
  };
  const addPrimer = () => project && updateProject(project.id, {
    primerRows: [...rawPrimerRows, { id: 'p' + Date.now(), brand: '', velocities: '' }],
  });
  const removePrimer = (id) => project && updateProject(project.id, {
    primerRows: rawPrimerRows.filter(r => r.id !== id),
  });

  // Step 8 works in target inches at the test distance, because that is what a
  // shooter reads off a plate. It has to end up in the SAME unit the group
  // sizes were entered in — it was hardcoded to MOA while the group came from a
  // field labelled with the user's unit, so anyone working in MRAD was having a
  // 9.5 MOA plate compared against a 0.17 MRAD group.
  const refDistance = Number(project?.testDistanceYd) || 0;
  const refTargetIn = Number(project?.refTargetIn) || 0;
  const refTargetAng = refDistance > 0 && refTargetIn > 0
    ? inchesToUnit(refTargetIn, refDistance, gUnit)
    : null;
  const ref = useMemo(() => assessReference({
    hits: project?.refHits, shots: project?.refShots,
    groupMoa: project?.refGroupMoa, groupShots: project?.refGroupShots || 5,
    targetMoa: refTargetAng,
    goalMoa: project?.goalMoa, hitRatePct: project?.hitRatePct, unit: gLabel,
  }), [project?.refHits, project?.refShots, project?.refGroupMoa,
       project?.refGroupShots, refTargetAng, project?.goalMoa, project?.hitRatePct]);

  const rifle = rifles.find(r => r.id === project?.rifleId);
  const load = loads.find(l => l.id === project?.loadId);

  /**
   * CBTO at which this barrel touches the lands, if it has been measured.
   *
   * Read from the rifle rather than the project: two projects on one rifle
   * share a throat, and a project moved to a different barrel must not carry
   * the old figure with it.
   */
  const lands = Number(rifle?.landsCbto) > 0 ? Number(rifle.landsCbto) : 0;

  const setField = (field, value) => project && updateProject(project.id, { [field]: value });

  const setRung = (id, field, value) => {
    if (!project) return;
    updateProject(project.id, {
      rungs: rawRungs.map(r => r.id === id ? { ...r, [field]: value } : r),
    });
  };

  const addRung = () => {
    if (!project) return;
    // Continue the ladder at the same interval the user has been using.
    const last = rawRungs[rawRungs.length - 1];
    const prev = rawRungs[rawRungs.length - 2];
    let nextCharge = '';
    if (last) {
      const lc = parseFloat(last.charge);
      const pc = prev ? parseFloat(prev.charge) : NaN;
      const stepGr = isFinite(lc) && isFinite(pc) ? +(lc - pc).toFixed(2) : 0.2;
      if (isFinite(lc)) nextCharge = String(+(lc + (stepGr || 0.2)).toFixed(2));
    }
    updateProject(project.id, {
      rungs: [...rawRungs, { id: 'r' + Date.now(), charge: nextCharge, velocity: '', groupMoa: '' }],
    });
  };

  /**
   * Go and shoot a variant, rather than type what it measured.
   *
   * The session records the project, the step and the row, which is what
   * lib/variants keys on, so the row reads back from measured data instead of a
   * number transcribed by hand. Association is recorded here and never inferred
   * later from a matching charge weight.
   */
  const captureFor = (step, rowId) => {
    if (!project) return;
    router.push({
      pathname: '/capture',
      params: { projectId: project.id, step: String(step), rowId },
    });
  };

  const removeRung = (id) =>
    project && updateProject(project.id, { rungs: rawRungs.filter(r => r.id !== id) });

  const goStep = (n) => {
    setStep(n);
    if (project) updateProject(project.id, { currentStep: n });
  };

  /**
   * Start another workup, and open it.
   *
   * Begins at step 1 rather than at the ladder, because step 1 is where the
   * goal and hit rate are set and every later step is judged against them.
   * Named after the rifle and its cartridge, which is what a shooter calls a
   * workup out loud - and it stays editable.
   */
  const newProject = useCallback(() => {
    const r = rifles[0] || null;
    const l = loads.find(x => x.rifleId === r?.id) || null;
    const created = addProject({
      name: r ? `${r.cartridge || 'New'} — ${r.name}` : 'New workup',
      rifleId: r?.id ?? null,
      loadId: l?.id ?? null,
      goalMoa: null,
      hitRatePct: null,
      testDistanceYd: 100,
      shotsPerCharge: 3,
      currentStep: 1,
      rungs: [],
    });
    setProjectId(created.id);
    setStep(1);
  }, [addProject, rifles, loads]);

  if (!project) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <ScrollView contentContainerStyle={s.scroll}>
          <View style={s.header}>
            <TouchableOpacity
              onPress={() => router.canGoBack?.() ? router.back() : router.replace('/')}
              style={[s.backBtn, { backgroundColor: colors.card, borderColor: colors.bd }]}
            >
              <ArrowLeft size={19} color={colors.tx} />
            </TouchableOpacity>
            <Text style={[s.title, { color: colors.tx }]}>Load Development</Text>
          </View>
          <View style={[cs.notBuilt, { backgroundColor: colors.card, borderColor: colors.bd }]}>
            <Info size={18} color={colors.mut} />
            <Text style={[cs.notBuiltText, { color: colors.mut }]}>
              No load development project yet.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

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
          <Text style={[s.title, { color: colors.tx }]}>Load Development</Text>
        </View>

        <View style={[s.projCard, { backgroundColor: colors.card, borderColor: colors.bd }]}>
          <View style={s.projHeader}>
            {/* The name is the switch. Several workups run at once - a barrel
                being broken in while another rifle is on a seating ladder - and
                each keeps its own step, rungs and rows. */}
            <TouchableOpacity
              onPress={() => projects.length > 1 && setPickingProject(true)}
              disabled={projects.length < 2}
              style={{ flex: 1, minWidth: 0 }}
            >
              <View style={s.projNameRow}>
                <Text style={[s.projName, { color: colors.tx }]} numberOfLines={1}>{project.name}</Text>
                {projects.length > 1 && <ChevronDown size={17} color={colors.act} />}
              </View>
              <Text style={[s.projSub, { color: colors.mut }]}>
                {[rifle?.name, load?.name].filter(Boolean).join(' · ') || 'No rifle or load linked'}
                {projects.length > 1 ? ` · ${projects.length} projects` : ''}
              </Text>
            </TouchableOpacity>
            <View style={{ alignItems: 'flex-end', gap: 8 }}>
              <View style={[s.badge, { backgroundColor: colors.warns }]}>
                <Text style={[s.badgeText, { color: colors.warnt }]}>STEP {step}/8</Text>
              </View>
              {/* Starting another workup.
                  Nothing in the app created a project before this - the store
                  had always held an array and grown the API for it, but the
                  only one that existed was the seeded one, so "how many can I
                  run at once" answered itself: one, forever. */}
              <TouchableOpacity onPress={newProject} style={[s.newProjBtn, { borderColor: colors.act }]}>
                <Plus size={13} color={colors.act} />
                <Text style={[s.newProjText, { color: colors.act }]}>New</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* Reads from the project, so editing the goal in step 1 shows here. */}
          <View style={[s.projStats, { borderTopColor: colors.line }]}>
            <View>
              <Text style={[s.projStatVal, { color: colors.tx }]}>≤{project.goalMoa || '—'}</Text>
              <Text style={[s.projStatLabel, { color: colors.mut }]}>Goal {gLabel}</Text>
            </View>
            <View>
              <Text style={[s.projStatVal, { color: colors.tx }]}>{project.hitRatePct || '—'}%</Text>
              <Text style={[s.projStatLabel, { color: colors.mut }]}>Hit target</Text>
            </View>
            <View>
              <Text style={[s.projStatVal, { color: colors.tx }]}>{project.testDistanceYd || '—'}</Text>
              <Text style={[s.projStatLabel, { color: colors.mut }]}>yards</Text>
            </View>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, marginVertical: 16 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 6 }}>
          {STEP_META.map((sm) => {
            const sel = sm.num === step;
            // Only the ladder can be "done" — it is the only step holding data.
            const done = (sm.num === 6 && parsed.length >= 3) ||
              (sm.num === 7 && depths.length >= 3) || (sm.num === 8 && ref.ok) ||
              (sm.num === 5 && primerStrings.length >= 2) || (sm.num === 3 && workup.ok) ||
              (sm.num === 2 && screen.ok) || (sm.num === 4 && coarse.ok);
            return (
              <TouchableOpacity key={sm.num} onPress={() => goStep(sm.num)} style={s.stepBtn}>
                <View style={[s.stepCircle, {
                  backgroundColor: sel ? '#6D3BEB' : (done ? colors.acs : colors.inset),
                  borderColor: sel ? '#6D3BEB' : (done ? colors.acs : colors.ibd),
                }]}>
                  <Text style={[s.stepMark, { color: sel ? '#fff' : (done ? colors.act : colors.fnt) }]}>
                    {done && !sel ? '✓' : String(sm.num)}
                  </Text>
                </View>
                <Text style={[s.stepLabel, { color: colors.mut }]}>{sm.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={[s.contentCard, { backgroundColor: colors.card, borderColor: colors.bd }]}>
          <View style={s.contentHeader}>
            <StepIcon size={18} color={colors.act} />
            <Text style={[s.contentTitle, { color: colors.tx }]}>Step {step} — {meta.label}</Text>
          </View>
          <Text style={[s.contentDesc, { color: colors.mut }]}>{meta.desc}</Text>

          {step === 1 && (
            <View style={cs.wrap}>
              {/* The vocabulary every later step assumes. */}
              <MeasureGuide kind="anatomy" style={{ marginTop: 0, marginBottom: 12 }} />
              <View style={cs.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[cs.lbl, { color: colors.mut }]}>Goal {gLabel}</Text>
                  <View style={[cs.inp, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                    <TextInput
                      value={String(project.goalMoa ?? '')}
                      onChangeText={v => setField('goalMoa', v)}
                      keyboardType="decimal-pad"
                      style={[cs.inpText, { color: colors.tx }]}
                    />
                    <Text style={[cs.unit, { color: colors.fnt }]}>{gLabel}</Text>
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[cs.lbl, { color: colors.mut }]}>Hit Rate Target</Text>
                  <View style={[cs.inp, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                    <TextInput
                      value={String(project.hitRatePct ?? '')}
                      onChangeText={v => setField('hitRatePct', v)}
                      keyboardType="number-pad"
                      style={[cs.inpText, { color: colors.tx }]}
                    />
                    <Text style={[cs.unit, { color: colors.fnt }]}>%</Text>
                  </View>
                </View>
              </View>
              <View>
                <Text style={[cs.lbl, { color: colors.mut }]}>Test Distance</Text>
                <View style={[cs.inp, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                  <TextInput
                    value={String(project.testDistanceYd ?? '')}
                    onChangeText={v => setField('testDistanceYd', v)}
                    keyboardType="number-pad"
                    style={[cs.inpText, { color: colors.tx }]}
                  />
                  <Text style={[cs.unit, { color: colors.fnt }]}>yards</Text>
                </View>
              </View>
              <View style={[cs.note, { backgroundColor: colors.acs }]}>
                <Text style={[cs.noteText, { color: colors.act }]}>
                  Saved to the project — the card above updates as you type.
                </Text>
              </View>
            </View>
          )}

          {step === 6 && (
            <View style={cs.wrap}>
              <View style={cs.ladderHead}>
                <Text style={[cs.colH, { color: colors.fnt, flex: 1 }]}>CHARGE</Text>
                <Text style={[cs.colH, { color: colors.fnt, flex: 1, textAlign: 'center' }]}>VEL</Text>
                <Text style={[cs.colH, { color: colors.fnt, flex: 1, textAlign: 'center' }]}>GROUP</Text>
                <View style={{ width: 52 }} />
              </View>

              {rungs.length === 0 && (
                <Text style={[cs.emptyLadder, { color: colors.mut }]}>
                  No rungs yet. Add one for each charge weight you fired.
                </Text>
              )}

              {rungs.map((r) => {
                const isNode = analysis.node && parseFloat(r.charge) === analysis.node.centreCharge;
                return (
                  <View key={r.id} style={[cs.ladderRow, isNode && analysis.node.significant && { backgroundColor: colors.oks }]}>
                    <View style={[cs.cell, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                      <TextInput value={r.charge} onChangeText={v => setRung(r.id, 'charge', v)}
                        placeholder="gr" placeholderTextColor={colors.fnt}
                        keyboardType="decimal-pad" style={[cs.cellText, { color: colors.tx }]} />
                    </View>
                    {/* A rung with an imported string shows its mean and shot
                        count and is no longer hand-editable — the string is
                        the source of truth for both velocity and spread. */}
                    {r.velocities?.length ? (
                      <TouchableOpacity
                        onPress={() => setChronoRung(r.id)}
                        style={[cs.cell, cs.cellImported, { backgroundColor: colors.acs, borderColor: colors.act }]}
                      >
                        <Text style={[cs.cellText, { color: colors.act, paddingVertical: 10 }]}>
                          {Math.round(r.velocities.reduce((a, b) => a + b, 0) / r.velocities.length)}
                        </Text>
                        <Text style={[cs.cellBadge, { color: colors.act }]}>×{r.velocities.length}</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={[cs.cell, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                        <TextInput value={r.velocity} onChangeText={v => setRung(r.id, 'velocity', v)}
                          placeholder={vLabel} placeholderTextColor={colors.fnt}
                          keyboardType="number-pad" style={[cs.cellText, { color: colors.tx }]} />
                      </View>
                    )}
                    {/* A rung with sessions fired against it shows their mean
                        and how many groups it came from, and stops being
                        hand-editable. The measurement is the better evidence,
                        and letting a typed number sit on top of it would hide
                        which one the analysis actually used. */}
                    {r.source === 'measured' ? (
                      <View style={[cs.cell, cs.cellImported, { backgroundColor: colors.oks, borderColor: colors.okt }]}>
                        <Text style={[cs.cellText, { color: colors.okt, paddingVertical: 10 }]}>{r.groupMoa}</Text>
                        <Text style={[cs.cellBadge, { color: colors.okt }]}>×{r.measuredCount}</Text>
                      </View>
                    ) : (
                      <View style={[cs.cell, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                        <TextInput value={r.groupMoa} onChangeText={v => setRung(r.id, 'groupMoa', v)}
                          placeholder={gLabel} placeholderTextColor={colors.fnt}
                          keyboardType="decimal-pad" style={[cs.cellText, { color: colors.tx }]} />
                      </View>
                    )}
                    {/* Shoot this rung. Typing a group size means transcribing
                        a number from a target you already measured somewhere
                        else; this records the target itself, and the row then
                        reads from the session rather than from memory. */}
                    <TouchableOpacity onPress={() => captureFor(6, r.id)} style={cs.rowAct}>
                      <Crosshair size={15} color={r.source === 'measured' ? colors.okt : colors.fnt} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setChronoRung(r.id)} style={cs.rowAct}>
                      <Gauge size={15} color={r.velocities?.length ? colors.act : colors.fnt} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => removeRung(r.id)} style={cs.rowAct}>
                      <Trash2 size={15} color={colors.fnt} />
                    </TouchableOpacity>
                  </View>
                );
              })}

              {rungs.some(r => r.source === 'measured') && (
                <Text style={[cs.hint, { color: colors.fnt }]}>
                  Green group sizes are measured from sessions captured against that
                  rung, pooled across every target. Shoot a group and tag it to a rung
                  in the capture screen; it replaces anything typed here.
                </Text>
              )}
              {!rungs.some(r => r.source === 'measured') && rungs.length > 0 && (
                <Text style={[cs.hint, { color: colors.fnt }]}>
                  Typed values. To measure instead, capture a group and pick this
                  project and rung on the setup step.
                </Text>
              )}

              <TouchableOpacity onPress={addRung} style={[cs.addRung, { borderColor: colors.ibd }]}>
                <Plus size={15} color={colors.act} />
                <Text style={[cs.addRungText, { color: colors.act }]}>Add rung</Text>
              </TouchableOpacity>

              <View style={cs.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[cs.lbl, { color: colors.mut }]}>Shots per charge</Text>
                  <View style={[cs.inp, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                    <TextInput
                      value={String(project.shotsPerCharge ?? 1)}
                      onChangeText={v => setField('shotsPerCharge', v)}
                      keyboardType="number-pad"
                      style={[cs.inpText, { color: colors.tx }]}
                    />
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[cs.lbl, { color: colors.mut }]}>Best group</Text>
                  <View style={[cs.inp, { backgroundColor: colors.inset, borderColor: colors.ibd }]}>
                    <Text style={[cs.inpText, { color: colors.tx, paddingVertical: 12 }]}>
                      {best ? `${best.groupMoa} ${gLabel} @ ${best.charge}gr` : '—'}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Velocity against charge, with the spread it was measured
                  through.
                  A ladder plotted as a bare line makes every wobble look like a
                  node - the eye finds flat spots in noise reliably, which is
                  most of why node hunting persists. Shading each rung by its
                  own velocity spread puts the question the right way round: a
                  flat spot no wider than the band is the band, and one that
                  clears it is worth shooting again. Rungs with a pasted string
                  get their real SD; the rest get the ladder's scatter about its
                  own trend, which is the best available stand-in. */}
              {parsed.length >= 3 && (() => {
                const pts = parsed.filter(r => isFinite(r.charge) && isFinite(r.velocity));
                if (pts.length < 3) return null;
                const charges = pts.map(p => p.charge), vs = pts.map(p => p.velocity);
                const c0 = Math.min(...charges), c1 = Math.max(...charges);
                // Residual scatter about a straight fit, as the fallback spread.
                const mc = charges.reduce((a, b) => a + b, 0) / pts.length;
                const mv = vs.reduce((a, b) => a + b, 0) / pts.length;
                let sxy = 0, sxx = 0;
                for (const p of pts) { sxy += (p.charge - mc) * (p.velocity - mv); sxx += (p.charge - mc) ** 2; }
                const slope = sxx > 0 ? sxy / sxx : 0;
                const resid = Math.sqrt(pts.reduce((a, p) =>
                  a + (p.velocity - (mv + slope * (p.charge - mc))) ** 2, 0) / Math.max(1, pts.length - 2));
                const sdOf = (p) => {
                  if (p.velocities?.length > 2) {
                    const m = p.velocities.reduce((a, b) => a + b, 0) / p.velocities.length;
                    return Math.sqrt(p.velocities.reduce((a, v) => a + (v - m) ** 2, 0) / (p.velocities.length - 1));
                  }
                  return resid;
                };
                const band = Math.max(...pts.map(sdOf), 1);
                const v0 = Math.min(...vs) - band * 1.6, v1 = Math.max(...vs) + band * 1.6;
                const px = (c) => 34 + ((c - c0) / ((c1 - c0) || 1)) * 258;
                const py = (v) => 96 - ((v - v0) / ((v1 - v0) || 1)) * 84;
                return (
                  <>
                    <Text style={[cs.colH, { color: colors.fnt, marginTop: 16 }]}>
                      VELOCITY AGAINST CHARGE, WITH SPREAD
                    </Text>
                    <Svg viewBox="0 0 300 112" style={{ width: '100%', height: undefined, aspectRatio: 300 / 112, marginTop: 6 }}>
                      {pts.map((p, i) => {
                        const sd = sdOf(p);
                        return (
                          <Line key={'e' + i} x1={px(p.charge)} y1={py(p.velocity - sd)}
                            x2={px(p.charge)} y2={py(p.velocity + sd)}
                            stroke={colors.mut} strokeWidth={5} strokeLinecap="round" opacity={0.3} />
                        );
                      })}
                      <Path d={pts.map((p, i) => `${i ? 'L' : 'M'} ${px(p.charge)} ${py(p.velocity)}`).join(' ')}
                        fill="none" stroke={colors.act} strokeWidth={2} />
                      {pts.map((p, i) => (
                        <Circle key={'p' + i} cx={px(p.charge)} cy={py(p.velocity)} r={2.6}
                          fill={analysis.node && p.charge === analysis.node.centreCharge
                            ? (analysis.node.significant ? colors.okt : colors.warnt)
                            : colors.act} />
                      ))}
                      <SvgText x={34} y={108} fontSize="8" fill={colors.fnt}>{c0}gr</SvgText>
                      <SvgText x={292} y={108} fontSize="8" textAnchor="end" fill={colors.fnt}>{c1}gr</SvgText>
                      <SvgText x={30} y={py(Math.max(...vs)) + 3} fontSize="8" textAnchor="end"
                        fill={colors.fnt}>{Math.round(Math.max(...vs))}</SvgText>
                      <SvgText x={30} y={py(Math.min(...vs)) + 3} fontSize="8" textAnchor="end"
                        fill={colors.fnt}>{Math.round(Math.min(...vs))}</SvgText>
                    </Svg>
                    <Text style={[cs.landsHint, { color: colors.fnt, marginBottom: 10 }]}>
                      The bars are one standard deviation of velocity at each charge. A flat
                      spot no wider than a bar is the bar.
                    </Text>
                  </>
                );
              })()}

              {/* The analysis. Verdict wording comes from lib/loaddev so the
                  uncertainty can't be dropped on its way to the screen. */}
              {analysis.node ? (
                <View style={[cs.result, {
                  backgroundColor: analysis.node.significant ? colors.oks : colors.warns,
                }]}>
                  {analysis.node.significant
                    ? <CircleCheck size={17} color={colors.okt} />
                    : <TriangleAlert size={17} color={colors.warnt} />}
                  <View style={{ flex: 1 }}>
                    <Text style={[cs.resultText, { color: analysis.node.significant ? colors.okt : colors.warnt }]}>
                      {analysis.verdict}
                    </Text>
                    <Text style={[cs.resultMeta, { color: analysis.node.significant ? colors.okt : colors.warnt }]}>
                      {analysis.node.slope} {vLabel}/gr across the flat window vs {analysis.node.overallSlope} overall
                      {analysis.velocitySd != null && ` · noise ${analysis.velocitySd} ${vLabel} (${analysis.sdSource})`}
                      {analysis.sdIsWeak && ' — treat as rough'}
                      {analysis.sdSource !== 'measured' && '\nImport a chrono string per rung for a measured noise figure.'}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={[cs.result, { backgroundColor: colors.inset }]}>
                  <Info size={17} color={colors.mut} />
                  <Text style={[cs.resultText, { color: colors.mut, flex: 1 }]}>{analysis.reason}</Text>
                </View>
              )}
            </View>
          )}

          {step === 7 && (
            <View style={cs.wrap}>
              {/* Next to the field, not in a help screen nobody opens. CBTO is
                  the dimension most often measured as something else, and a
                  COAL typed here would solve and be wrong. */}
              <MeasureGuide kind="cbto" style={{ marginTop: 0, marginBottom: 6 }} />
              <MeasureGuide kind="jump" style={{ marginTop: 0, marginBottom: 10 }} />

              {/* The lands, recorded against the rifle.
                  Without it the rows below are raw CBTO, which cannot be
                  compared with anybody else's and means nothing on its own.
                  With it every row also reads as jump - "0.020 off" - which is
                  how the number is actually discussed and the only form that
                  transfers between rifles. Kept on the rifle rather than the
                  project because the throat belongs to the barrel, and it
                  moves as the barrel wears. */}
              <View style={[cs.landsRow, { borderColor: colors.bd, backgroundColor: colors.inset }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[cs.lbl, { color: colors.mut }]}>CBTO at the lands</Text>
                  <Text style={[cs.landsHint, { color: colors.fnt }]}>
                    {rifle ? `For ${rifle.name}. Re-measure as the throat erodes.` : 'Pick a rifle to record this.'}
                  </Text>
                </View>
                <View style={{ width: 104 }}>
                  <NumField colors={colors} label="" unit="in"
                    value={rifle?.landsCbto ?? ''}
                    onChange={(v) => rifle && updateRifle(rifle.id, {
                      landsCbto: v === '' ? null : parseFloat(v),
                      landsMeasuredAt: new Date().toISOString(),
                    })} />
                </View>
              </View>
              <View style={cs.ladderHead}>
                <Text style={[cs.colH, { color: colors.fnt, flex: 1 }]}>CBTO</Text>
                {lands > 0 && (
                  <Text style={[cs.colH, { color: colors.fnt, flex: 1, textAlign: 'center' }]}>JUMP</Text>
                )}
                <Text style={[cs.colH, { color: colors.fnt, flex: 1, textAlign: 'center' }]}>GROUP</Text>
                <View style={{ width: 26 }} />
              </View>

              {seatingRows.length === 0 && (
                <Text style={[cs.emptyLadder, { color: colors.mut }]}>
                  No depths yet. Add one for each seating depth you tested.
                </Text>
              )}

              {seatingRows.map(r => {
                const isBest = seating.best && parseFloat(r.cbto) === seating.best.cbto;
                return (
                  <View key={r.id} style={[cs.ladderRow, isBest && seating.significant && { backgroundColor: colors.oks }]}>
                    <View style={[cs.cell, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                      <TextInput value={r.cbto} onChangeText={v => setDepth(r.id, 'cbto', v)}
                        placeholder="in" placeholderTextColor={colors.fnt}
                        keyboardType="decimal-pad" style={[cs.cellText, { color: colors.tx }]} />
                    </View>
                    {lands > 0 && (() => {
                      const c = parseFloat(r.cbto);
                      // Positive means seated short of the lands, which is how
                      // "twenty thou off" is said. Into the lands is negative
                      // and shown as such rather than hidden.
                      const j = isFinite(c) ? lands - c : null;
                      return (
                        <Text style={[cs.jumpCell, {
                          color: j == null ? colors.fnt : j < 0 ? colors.warnt : colors.tx,
                        }]}>
                          {j == null ? '—' : `${j >= 0 ? '' : '+'}${(j * 1000).toFixed(0)}`}
                        </Text>
                      );
                    })()}
                    {/* Same rule as the ladder: a measured row is read-only
                        and says how many groups it came from. Leaving it
                        editable showed the measured mean in a field that took
                        typing and then silently reverted it on the next
                        render. */}
                    {r.source === 'measured' ? (
                      <View style={[cs.cell, cs.cellImported, { backgroundColor: colors.oks, borderColor: colors.okt }]}>
                        <Text style={[cs.cellText, { color: colors.okt, paddingVertical: 10 }]}>{r.groupMoa}</Text>
                        <Text style={[cs.cellBadge, { color: colors.okt }]}>×{r.measuredCount}</Text>
                      </View>
                    ) : (
                      <View style={[cs.cell, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                        <TextInput value={r.groupMoa} onChangeText={v => setDepth(r.id, 'groupMoa', v)}
                          placeholder={gLabel} placeholderTextColor={colors.fnt}
                          keyboardType="decimal-pad" style={[cs.cellText, { color: colors.tx }]} />
                      </View>
                    )}
                    <TouchableOpacity onPress={() => captureFor(7, r.id)} style={cs.rowAct}>
                      <Crosshair size={15} color={r.source === 'measured' ? colors.okt : colors.fnt} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => removeDepth(r.id)} style={cs.rowAct}>
                      <Trash2 size={15} color={colors.fnt} />
                    </TouchableOpacity>
                  </View>
                );
              })}

              <TouchableOpacity onPress={addDepth} style={[cs.addRung, { borderColor: colors.ibd }]}>
                <Plus size={15} color={colors.act} />
                <Text style={[cs.addRungText, { color: colors.act }]}>Add depth</Text>
              </TouchableOpacity>

              <View style={{ width: '50%' }}>
                <Text style={[cs.lbl, { color: colors.mut }]}>Shots per depth</Text>
                <View style={[cs.inp, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                  <TextInput
                    value={String(seatingShots)}
                    onChangeText={v => setField('seatingShots', v)}
                    keyboardType="number-pad"
                    style={[cs.inpText, { color: colors.tx }]}
                  />
                </View>
              </View>

              {seating.best ? (
                <View style={[cs.result, {
                  backgroundColor: seating.significant ? colors.oks : colors.warns,
                }]}>
                  {seating.significant
                    ? <CircleCheck size={17} color={colors.okt} />
                    : <TriangleAlert size={17} color={colors.warnt} />}
                  <View style={{ flex: 1 }}>
                    <Text style={[cs.resultText, { color: seating.significant ? colors.okt : colors.warnt }]}>
                      {seating.verdict}
                    </Text>
                    <Text style={[cs.resultMeta, { color: seating.significant ? colors.okt : colors.warnt }]}>
                      {depths.length} depths, typical {seating.level} {gLabel} · a {seatingShots}-shot
                      group varies about ±{(seating.cv * 100).toFixed(0)}% ({seating.sigma} {gLabel}) on
                      its own, before anything about the load changes
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={[cs.result, { backgroundColor: colors.inset }]}>
                  <Info size={17} color={colors.mut} />
                  <Text style={[cs.resultText, { color: colors.mut, flex: 1 }]}>{seating.reason}</Text>
                </View>
              )}
            </View>
          )}





          {(step === 2 || step === 4) && (() => {
            const isScreen = step === 2;
            const list = isScreen ? screenRows : coarseRows;
            const result = isScreen ? screen : coarse;
            const shotsVal = isScreen ? screenShots : coarseShots;
            const shotsKey = isScreen ? 'screenShots' : 'coarseShots';
            // Mutations act on the stored rows; `list` above is the reconciled
            // view and writing it back would persist derived fields and bury the
            // shooter's typed value under a measured one.
            const ops = candidateOps(
              isScreen ? 'screenRows' : 'coarseRows',
              isScreen ? rawScreenRows : rawCoarseRows
            );
            const nameLabel = isScreen ? 'POWDER / BULLET' : 'CHARGE';
            const namePlaceholder = isScreen ? 'H4350 / 140 Hybrid' : '42.0 gr';
            return (
              <View style={cs.wrap}>
                <View style={cs.ladderHead}>
                  <Text style={[cs.colH, { color: colors.fnt, flex: 2 }]}>{nameLabel}</Text>
                  <Text style={[cs.colH, { color: colors.fnt, flex: 1, textAlign: 'center' }]}>GROUP</Text>
                  <View style={{ width: 26 }} />
                </View>

                {list.length === 0 && (
                  <Text style={[cs.emptyLadder, { color: colors.mut }]}>
                    {isScreen
                      ? 'No combinations yet. Add one per powder and bullet pairing you shot.'
                      : 'No charges yet. Add one per charge weight you shot a group with.'}
                  </Text>
                )}

                {list.map(r => {
                  const stat = result.scored?.find(x => x.id === r.id);
                  return (
                    <View key={r.id} style={[cs.ladderRow,
                      stat?.eliminated && { backgroundColor: colors.warns }]}>
                      <View style={[cs.cell, { flex: 2, backgroundColor: colors.input, borderColor: colors.ibd }]}>
                        <TextInput value={r.name} onChangeText={v => ops.set(r.id, 'name', v)}
                          placeholder={namePlaceholder} placeholderTextColor={colors.fnt}
                          style={[cs.cellText, { color: colors.tx, textAlign: 'left' }]} />
                      </View>
                      {r.source === 'measured' ? (
                        <View style={[cs.cell, cs.cellImported, { backgroundColor: colors.oks, borderColor: colors.okt }]}>
                          <Text style={[cs.cellText, { color: colors.okt, paddingVertical: 10 }]}>{r.groupMoa}</Text>
                          <Text style={[cs.cellBadge, { color: colors.okt }]}>×{r.measuredCount}</Text>
                        </View>
                      ) : (
                        <View style={[cs.cell, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                          <TextInput value={r.groupMoa} onChangeText={v => ops.set(r.id, 'groupMoa', v)}
                            placeholder={gLabel} placeholderTextColor={colors.fnt}
                            keyboardType="decimal-pad" style={[cs.cellText, { color: colors.tx }]} />
                        </View>
                      )}
                      <TouchableOpacity onPress={() => captureFor(isScreen ? 2 : 4, r.id)} style={cs.rowAct}>
                        <Crosshair size={15} color={r.source === 'measured' ? colors.okt : colors.fnt} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => ops.remove(r.id)} style={cs.rowAct}>
                        <Trash2 size={15} color={colors.fnt} />
                      </TouchableOpacity>
                    </View>
                  );
                })}

                <TouchableOpacity onPress={ops.add} style={[cs.addRung, { borderColor: colors.ibd }]}>
                  <Plus size={15} color={colors.act} />
                  <Text style={[cs.addRungText, { color: colors.act }]}>
                    {isScreen ? 'Add combination' : 'Add charge'}
                  </Text>
                </TouchableOpacity>

                <View style={{ width: '50%' }}>
                  <Text style={[cs.lbl, { color: colors.mut }]}>Shots per group</Text>
                  <View style={[cs.inp, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                    <TextInput value={String(shotsVal)} onChangeText={v => setField(shotsKey, v)}
                      keyboardType="number-pad" style={[cs.inpText, { color: colors.tx }]} />
                  </View>
                </View>

                {result.ok ? (
                  <View style={[cs.result, {
                    backgroundColor: result.eliminated.length ? colors.warns : colors.inset,
                  }]}>
                    {result.eliminated.length
                      ? <TriangleAlert size={17} color={colors.warnt} />
                      : <Info size={17} color={colors.mut} />}
                    <Text style={[cs.resultText, {
                      color: result.eliminated.length ? colors.warnt : colors.mut, flex: 1,
                    }]}>{result.verdict}</Text>
                  </View>
                ) : (
                  <View style={[cs.result, { backgroundColor: colors.inset }]}>
                    <Info size={17} color={colors.mut} />
                    <Text style={[cs.resultText, { color: colors.mut, flex: 1 }]}>{result.reason}</Text>
                  </View>
                )}
              </View>
            );
          })()}

          {step === 3 && (
            <View style={cs.wrap}>
              <View style={[cs.note, { backgroundColor: colors.warns }]}>
                <Text style={[cs.noteText, { color: colors.warnt }]}>
                  This screen cannot tell you a load is safe, and never will. Your
                  powder and bullet maker's published data is the authority on
                  maximum charge. What it can do is spot velocity climbing faster
                  than the charge — a bend that shows up before brass does.
                </Text>
              </View>
              {/* Brass is the other half of this step: a case that has grown or
                  a shoulder that has moved is evidence, and both are measured
                  rather than eyeballed. */}
              <MeasureGuide kind="bump" style={{ marginBottom: 4 }} />
              {/* Why one shooter's bump figure means nothing to another. */}
              <MeasureGuide kind="datum" style={{ marginTop: 6, marginBottom: 4 }} />
              <MeasureGuide kind="caseLength" style={{ marginTop: 6, marginBottom: 4 }} />
              <MeasureGuide kind="trim" style={{ marginTop: 6, marginBottom: 12 }} />

              <View style={cs.ladderHead}>
                <Text style={[cs.colH, { color: colors.fnt, flex: 1 }]}>CHARGE</Text>
                <Text style={[cs.colH, { color: colors.fnt, flex: 1, textAlign: 'center' }]}>VEL</Text>
                <View style={{ width: 26 }} />
              </View>

              {workupRows.length === 0 && (
                <Text style={[cs.emptyLadder, { color: colors.mut }]}>
                  No charges yet. Add one per charge weight you fired.
                </Text>
              )}

              {workupRows.map(r => {
                const stat = workup.rungs?.find(x => x.id === r.id);
                const hot = workup.bending && workup.departureCharge != null &&
                  parseFloat(r.charge) >= workup.departureCharge;
                return (
                  <View key={r.id}>
                    <View style={[cs.ladderRow, hot && { backgroundColor: colors.warns }]}>
                      <View style={[cs.cell, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                        <TextInput value={r.charge} onChangeText={v => setWorkup(r.id, 'charge', v)}
                          placeholder="gr" placeholderTextColor={colors.fnt}
                          keyboardType="decimal-pad" style={[cs.cellText, { color: colors.tx }]} />
                      </View>
                      <View style={[cs.cell, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                        <TextInput value={r.velocity} onChangeText={v => setWorkup(r.id, 'velocity', v)}
                          placeholder={vLabel} placeholderTextColor={colors.fnt}
                          keyboardType="decimal-pad" style={[cs.cellText, { color: colors.tx }]} />
                      </View>
                      <TouchableOpacity onPress={() => removeWorkup(r.id)} style={cs.rowAct}>
                        <Trash2 size={15} color={colors.fnt} />
                      </TouchableOpacity>
                    </View>
                    <View style={cs.signRow}>
                      {['none', 'stiff bolt', 'ejector mark', 'cratered primer'].map(sg => {
                        const on = (r.sign || 'none') === sg;
                        return (
                          <TouchableOpacity key={sg} onPress={() => setWorkup(r.id, 'sign', sg)}
                            style={[cs.signChip, {
                              backgroundColor: on && sg !== 'none' ? colors.warns : on ? colors.inset : 'transparent',
                              borderColor: on ? colors.act : colors.ibd,
                            }]}>
                            <Text style={[cs.signText, {
                              color: on && sg !== 'none' ? colors.warnt : on ? colors.tx : colors.fnt,
                            }]}>{sg}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {stat && (
                      <Text style={[cs.hint, { color: colors.mut, marginBottom: 6 }]}>
                        {stat.excess >= 0 ? '+' : ''}{stat.excess} {vLabel} against the lower-charge trend
                      </Text>
                    )}
                  </View>
                );
              })}

              <TouchableOpacity onPress={addWorkup} style={[cs.addRung, { borderColor: colors.ibd }]}>
                <Plus size={15} color={colors.act} />
                <Text style={[cs.addRungText, { color: colors.act }]}>Add charge</Text>
              </TouchableOpacity>

              <View style={{ width: '55%' }}>
                <Text style={[cs.lbl, { color: colors.mut }]}>Book maximum</Text>
                <View style={[cs.inp, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                  <TextInput value={project.bookMaxGr == null ? '' : String(project.bookMaxGr)}
                    onChangeText={v => setField('bookMaxGr', v)}
                    placeholder="from your manual" placeholderTextColor={colors.fnt}
                    keyboardType="decimal-pad" style={[cs.inpText, { color: colors.tx }]} />
                  <Text style={[cs.unit, { color: colors.fnt }]}>gr</Text>
                </View>
              </View>

              {workup.ok ? (
                <View style={[cs.result, {
                  backgroundColor: workup.bending || workup.signs.length || workup.overBook.length
                    ? colors.warns : colors.inset,
                }]}>
                  {workup.bending || workup.signs.length || workup.overBook.length
                    ? <TriangleAlert size={17} color={colors.warnt} />
                    : <Info size={17} color={colors.mut} />}
                  <Text style={[cs.resultText, {
                    color: workup.bending || workup.signs.length || workup.overBook.length
                      ? colors.warnt : colors.mut,
                    flex: 1,
                  }]}>{workup.verdict}</Text>
                </View>
              ) : (
                <View style={[cs.result, { backgroundColor: colors.inset }]}>
                  <Info size={17} color={colors.mut} />
                  <Text style={[cs.resultText, { color: colors.mut, flex: 1 }]}>{workup.reason}</Text>
                </View>
              )}
            </View>
          )}

          {step === 5 && (
            <View style={cs.wrap}>
              {primerRows.length === 0 && (
                <Text style={[cs.emptyLadder, { color: colors.mut }]}>
                  No primers yet. Add one per brand and paste the chronograph string.
                </Text>
              )}

              {primerRows.map(r => {
                const stat = primers.rows?.find(x => x.id === r.id);
                const isBest = primers.best && primers.best.id === r.id;
                return (
                  <View key={r.id} style={[cs.primerCard, {
                    backgroundColor: isBest && primers.significant ? colors.oks : colors.inset,
                    borderColor: colors.ibd,
                  }]}>
                    <View style={cs.row}>
                      <View style={{ flex: 1 }}>
                        <Text style={[cs.lbl, { color: colors.mut }]}>Brand</Text>
                        <View style={[cs.inp, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                          <TextInput value={r.brand} onChangeText={v => setPrimer(r.id, 'brand', v)}
                            placeholder="CCI 450" placeholderTextColor={colors.fnt}
                            style={[cs.inpText, { color: colors.tx }]} />
                        </View>
                      </View>
                      <TouchableOpacity onPress={() => removePrimer(r.id)} style={cs.rowAct}>
                        <Trash2 size={15} color={colors.fnt} />
                      </TouchableOpacity>
                    </View>
                    <Text style={[cs.lbl, { color: colors.mut }]}>Velocities ({vLabel})</Text>
                    <View style={[cs.inp, { backgroundColor: colors.input, borderColor: colors.ibd, height: 'auto', minHeight: 44 }]}>
                      <TextInput value={r.velocities} onChangeText={v => setPrimer(r.id, 'velocities', v)}
                        placeholder="2810 2822 2815 2830 2818" placeholderTextColor={colors.fnt}
                        multiline style={[cs.inpText, { color: colors.tx, paddingVertical: 8 }]} />
                    </View>
                    {stat && (
                      <Text style={[cs.hint, { color: colors.mut, marginTop: 6 }]}>
                        {stat.n} shots · {stat.mean} {vLabel} avg · SD {stat.sd} {vLabel}
                        {stat.sdLow != null && ` (could be anywhere from ${stat.sdLow} to ${stat.sdHigh})`}
                        {' · ES '}{stat.es}
                      </Text>
                    )}
                  </View>
                );
              })}

              <TouchableOpacity onPress={addPrimer} style={[cs.addRung, { borderColor: colors.ibd }]}>
                <Plus size={15} color={colors.act} />
                <Text style={[cs.addRungText, { color: colors.act }]}>Add primer</Text>
              </TouchableOpacity>

              {primers.best ? (
                <View style={[cs.result, {
                  backgroundColor: primers.significant ? colors.oks : colors.warns,
                }]}>
                  {primers.significant
                    ? <CircleCheck size={17} color={colors.okt} />
                    : <TriangleAlert size={17} color={colors.warnt} />}
                  <Text style={[cs.resultText, {
                    color: primers.significant ? colors.okt : colors.warnt, flex: 1,
                  }]}>{primers.verdict}</Text>
                </View>
              ) : (
                <View style={[cs.result, { backgroundColor: colors.inset }]}>
                  <Info size={17} color={colors.mut} />
                  <Text style={[cs.resultText, { color: colors.mut, flex: 1 }]}>{primers.reason}</Text>
                </View>
              )}
            </View>
          )}

          {step === 8 && (
            <View style={cs.wrap}>
              <View style={cs.row}>
                <NumField colors={colors} label="Shots fired" unit=""
                  value={project.refShots} onChange={v => setField('refShots', v)} />
                <NumField colors={colors} label="Hits" unit=""
                  value={project.refHits} onChange={v => setField('refHits', v)} />
              </View>
              <View style={cs.row}>
                <NumField colors={colors} label="Group size" unit={gLabel}
                  value={project.refGroupMoa} onChange={v => setField('refGroupMoa', v)} />
                <NumField colors={colors} label="Shots in group" unit=""
                  value={project.refGroupShots} onChange={v => setField('refGroupShots', v)} />
              </View>
              <NumField colors={colors} label="Target size" unit="in"
                value={project.refTargetIn} onChange={v => setField('refTargetIn', v)} />
              {refDistance > 0 && refTargetIn > 0 ? (
                <Text style={[cs.hint, { color: colors.fnt }]}>
                  {refTargetIn}" at {formatDistance(refDistance, units.distance)} is {refTargetAng.toFixed(2)} {gLabel}
                </Text>
              ) : (
                <Text style={[cs.hint, { color: colors.fnt }]}>
                  Set a test distance in step 1 to convert this to {gLabel}.
                </Text>
              )}

              {ref.ok ? (
                <>
                  <View style={[cs.result, {
                    backgroundColor: ref.hitRate?.confirmed ? colors.oks : colors.warns,
                  }]}>
                    {ref.hitRate?.confirmed
                      ? <CircleCheck size={17} color={colors.okt} />
                      : <TriangleAlert size={17} color={colors.warnt} />}
                    <View style={{ flex: 1 }}>
                      <Text style={[cs.resultText, {
                        color: ref.hitRate?.confirmed ? colors.okt : colors.warnt,
                      }]}>{ref.verdict}</Text>
                    </View>
                  </View>
                  <View style={[cs.note, { backgroundColor: colors.inset }]}>
                    <Text style={[cs.noteText, { color: colors.mut }]}>
                      {ref.hits}/{ref.shots} is consistent with a true hit rate anywhere
                      from {ref.ci.low}% to {ref.ci.high}%.
                      {ref.diagnosis ? ` Dispersion alone predicts ${ref.diagnosis.predicted}% on this target.` : ''}
                    </Text>
                  </View>
                </>
              ) : (
                <View style={[cs.result, { backgroundColor: colors.inset }]}>
                  <Info size={17} color={colors.mut} />
                  <Text style={[cs.resultText, { color: colors.mut, flex: 1 }]}>{ref.reason}</Text>
                </View>
              )}
            </View>
          )}


        </View>

        {step < 8 && (
          <TouchableOpacity onPress={() => goStep(step + 1)} style={s.nextStepBtn}>
            <Text style={s.nextStepText}>Next: {STEP_META[step]?.label}</Text>
            <ChevronRight size={18} color="#fff" />
          </TouchableOpacity>
        )}
      </ScrollView>

      <ChronoImport
        visible={chronoRung !== null}
        onClose={() => setChronoRung(null)}
        onImport={({ velocities }) => setRung(chronoRung, 'velocities', velocities)}
      />
      <PickerSheet
        visible={pickingProject}
        title="Load development"
        options={projects.map(p => {
          const r = rifles.find(x => x.id === p.rifleId);
          return {
            key: p.id,
            label: p.name,
            sub: [r?.name, `Step ${p.currentStep || 1} — ${STEP_META[(p.currentStep || 1) - 1]?.label}`]
              .filter(Boolean).join(' · '),
            meta: p.goalMoa ? `≤${p.goalMoa} ${gLabel}` : '',
          };
        })}
        selectedKey={project?.id}
        onSelect={(id) => { setProjectId(id); setPickingProject(false); }}
        onClose={() => setPickingProject(false)}
      />
    </SafeAreaView>
  );
}

const cs = StyleSheet.create({
  landsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 11, padding: 12, marginBottom: 12,
  },
  landsHint: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  jumpCell: {
    flex: 1, fontSize: 13, textAlign: 'center',
    fontFamily: 'JetBrainsMono_700Bold',
  },
  wrap: { gap: 10, marginTop: 4 },
  row: { flexDirection: 'row', gap: 10 },
  lbl: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
  inp: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 14 },
  // minWidth 0 so the field can shrink inside its row. A web <input> carries
  // a default size of 20 characters and a flex item will not shrink below its
  // intrinsic content width, so without this the box overflows and whatever
  // sits beside it is pushed out of view. That is how the distance unit went
  // missing: 'yd' was rendered every time, in a 215px input inside a 163px box.
  inpText: { flex: 1, minWidth: 0, paddingVertical: 12, fontSize: 15, fontFamily: 'JetBrainsMono_700Bold' },
  unit: { fontSize: 13, fontWeight: '600' },
  note: { padding: 12, paddingHorizontal: 14, borderRadius: 12, marginTop: 4 },
  noteText: { fontSize: 12.5, fontWeight: '600', lineHeight: 18 },
  notBuilt: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 14, borderRadius: 12, borderWidth: 1, marginTop: 4 },
  hint: { fontSize: 12, marginTop: -4 },
  primerCard: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 6 },
  signRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  signChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  signText: { fontSize: 11, fontWeight: '600' },
  notBuiltText: { flex: 1, fontSize: 12.5, fontWeight: '600', lineHeight: 18 },
  ladderHead: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  colH: { fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  ladderRow: { flexDirection: 'row', gap: 8, alignItems: 'center', borderRadius: 10, paddingVertical: 3 },
  cell: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10 },
  cellText: { paddingVertical: 10, fontSize: 14, fontFamily: 'JetBrainsMono_700Bold', width: '100%' },
  cellImported: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  cellBadge: { fontSize: 10, fontWeight: '800' },
  rowAct: { width: 26, alignItems: 'center', justifyContent: 'center' },
  addRung: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderStyle: 'dashed', borderRadius: 11, paddingVertical: 11, marginTop: 2 },
  addRungText: { fontSize: 13.5, fontWeight: '700' },
  emptyLadder: { fontSize: 12.5, fontWeight: '600', paddingVertical: 10, textAlign: 'center' },
  result: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 13, borderRadius: 12, marginTop: 6 },
  resultText: { fontSize: 12.5, fontWeight: '700', lineHeight: 18 },
  resultMeta: { fontSize: 11.5, fontWeight: '600', lineHeight: 16, marginTop: 5, opacity: 0.85 },
});

const s = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  backBtn: { width: 38, height: 38, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  projCard: { borderWidth: 1, borderRadius: 18, padding: 18 },
  projHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  projNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  newProjBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10,
  },
  newProjText: { fontSize: 11.5, fontWeight: '800' },
  projName: { fontSize: 17, fontWeight: '800', flexShrink: 1 },
  projSub: { fontSize: 13, fontWeight: '500', marginTop: 4 },
  badge: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  projStats: { flexDirection: 'row', gap: 20, marginTop: 16, paddingTop: 16, borderTopWidth: 1 },
  projStatVal: { fontSize: 17, fontWeight: '700', fontFamily: 'JetBrainsMono_700Bold' },
  projStatLabel: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  stepBtn: { width: 56, alignItems: 'center' },
  stepCircle: { width: 40, height: 40, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  stepMark: { fontSize: 14, fontWeight: '800' },
  stepLabel: { fontSize: 10, fontWeight: '600', marginTop: 6, textAlign: 'center' },
  contentCard: { borderWidth: 1, borderRadius: 18, padding: 18, paddingHorizontal: 16 },
  contentHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  contentTitle: { fontSize: 15, fontWeight: '800' },
  contentDesc: { fontSize: 12.5, fontWeight: '500', lineHeight: 18, marginTop: 6, marginBottom: 14 },
  nextStepBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#6D3BEB', padding: 15, borderRadius: 14, marginTop: 16 },
  nextStepText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
