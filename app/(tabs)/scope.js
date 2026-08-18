import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, CircleCheck, TriangleAlert, Info, Plus, Trash2, Wrench } from 'lucide-react-native';
import { useState, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useTheme } from '../../lib/theme';
import { useData } from '../../store/data';
import { findByName, fmtBoth } from '../../lib/torque';
import { trackingStep, rtzStep, evaluateScope, shotsForTracking } from '../../lib/scopeeval';
import { sigmaFromGroup } from '../../lib/refload';
import { unitToInches } from '../../lib/units';

/**
 * Scope field evaluation.
 *
 * A tall-target test is a difference between two group centres, and the screen
 * exists to keep that visible: every step reports what it measured and what it
 * could resolve, side by side. A scope is only called bad when the error beats
 * the noise of the test that found it.
 *
 * The mounting checklist is deliberately a checklist and nothing more. Whether
 * the rail was degreased is not something the app can measure, so it records
 * what the shooter says they did and does not pretend otherwise.
 */

const MOUNT_STEPS = [
  ['degreased', 'Rail and ring surfaces degreased'],
  ['bedded', 'Rail bedded or epoxied to the receiver'],
  ['lapped', 'Rings lapped or checked for contact'],
  // No figures here any more. These read "typically 15-18 in-lb" and
  // "typically 25-30 in-lb", which are hedged and were followed by a note
  // saying to use the manufacturer's numbers - but a printed range is still the
  // number someone reaches for with a wrench in their hand. The fastener names
  // map onto what the shooter recorded against this rifle in Equipment.
  ['torqued', 'Ring screws torqued to spec', 'Scope ring caps'],
  ['baseTorqued', 'Base screws torqued to spec', 'Scope base / rail'],
  ['levelled', 'Reticle levelled to the rifle'],
  ['witness', 'Witness marks applied to screws'],
];

export default function ScopeScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { rifles, updateRifle, units } = useData();

  const [rifleId, setRifleId] = useState(rifles[0]?.id || null);
  const rifle = rifles.find(r => r.id === rifleId) || null;
  const evalData = rifle?.scopeEval || {};

  const save = (patch) => rifle && updateRifle(rifle.id, {
    scopeEval: { ...evalData, ...patch },
  });

  const distanceYd = Number(evalData.distanceYd) || 100;
  const baseGroup = Number(evalData.baselineGroup) || 0;
  const baseShots = Number(evalData.baselineShots) || 0;
  const turret = evalData.turret === 'mil' ? 'mil' : 'moa';

  // Per-axis sigma in inches at the test distance. The baseline group is entered
  // in the user's unit; everything downstream is inches on the target.
  const sigmaIn = useMemo(() => {
    if (!(baseGroup > 0) || !(baseShots >= 2)) return 0;
    const groupIn = unitToInches(baseGroup, distanceYd, units.group) ?? baseGroup;
    // sigmaFromGroup inverts extreme spread to a Rayleigh sigma; per-axis sigma
    // is that same value, which is what a one-axis displacement test uses.
    return sigmaFromGroup(groupIn, baseShots) || 0;
  }, [baseGroup, baseShots, distanceYd, units.group]);

  const rows = evalData.rows || [];
  const setRow = (id, field, value) =>
    save({ rows: rows.map(r => (r.id === id ? { ...r, [field]: value } : r)) });
  const addRow = (kind) =>
    save({ rows: [...rows, { id: 'e' + Date.now(), kind, dialled: '', measured: '', shots: String(baseShots || 5), mils: '' }] });
  const removeRow = (id) => save({ rows: rows.filter(r => r.id !== id) });

  // Inches the turret should have moved the group.
  const expectedIn = (dialled) => {
    const d = parseFloat(dialled);
    if (!isFinite(d) || d <= 0) return null;
    const perUnitPer100 = turret === 'mil' ? 3.6 : 1.047;
    return d * perUnitPer100 * (distanceYd / 100);
  };

  const results = useMemo(() => rows.map(r => {
    const shots = Number(r.shots) || baseShots || 0;
    if (r.kind === 'rtz') {
      return {
        row: r,
        result: rtzStep({
          deviation: parseFloat(r.measured),
          sigma: sigmaIn, shots, milsTravelled: parseFloat(r.mils),
        }),
      };
    }
    const exp = expectedIn(r.dialled);
    return {
      row: r,
      expected: exp,
      result: trackingStep({
        dialled: exp, measured: parseFloat(r.measured), sigma: sigmaIn, shots,
      }),
    };
  }), [rows, sigmaIn, baseShots, distanceYd, turret]);

  const summary = useMemo(
    () => evaluateScope(results.map(r => r.result)),
    [results]
  );

  // What a 1% test would cost at this rifle's precision — the number that says
  // whether the test is worth firing.
  const shotsFor1 = sigmaIn > 0 ? shotsForTracking(1, expectedIn('10') || 10, sigmaIn) : null;

  const mount = evalData.mount || {};
  const mountDone = MOUNT_STEPS.filter(([k]) => mount[k]).length;

  const Field = ({ label, value, onChange, unit, flex = 1, keyboard = 'decimal-pad' }) => (
    <View style={{ flex }}>
      <Text style={[s.lbl, { color: colors.mut }]}>{label}</Text>
      <View style={[s.inp, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
        <TextInput value={value == null ? '' : String(value)} onChangeText={onChange}
          keyboardType={keyboard} style={[s.inpText, { color: colors.tx }]} />
        {!!unit && <Text style={[s.unit, { color: colors.fnt }]}>{unit}</Text>}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <TouchableOpacity
            onPress={() => (router.canGoBack?.() ? router.back() : router.replace('/'))}
            style={[s.backBtn, { backgroundColor: colors.card, borderColor: colors.bd }]}
          >
            <ArrowLeft size={19} color={colors.tx} />
          </TouchableOpacity>
          <Text style={[s.title, { color: colors.tx }]}>Scope Evaluation</Text>
        </View>

        {!rifles.length ? (
          <View style={[s.note, { backgroundColor: colors.inset }]}>
            <Info size={17} color={colors.mut} />
            <Text style={[s.noteText, { color: colors.mut }]}>Add a rifle first.</Text>
          </View>
        ) : (
          <>
            <View style={s.chipRow}>
              {rifles.map(r => (
                <TouchableOpacity key={r.id} onPress={() => setRifleId(r.id)}
                  style={[s.chip, {
                    backgroundColor: r.id === rifleId ? colors.act : colors.card,
                    borderColor: r.id === rifleId ? colors.act : colors.bd,
                  }]}>
                  <Text style={[s.chipText, { color: r.id === rifleId ? '#fff' : colors.mut }]}>{r.name}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[s.section, { color: colors.mut }]}>BASELINE</Text>
            <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.bd }]}>
              <View style={s.row}>
                <Field label={`Group (${units.group === 'Inches' ? 'in' : units.group})`}
                  value={evalData.baselineGroup} onChange={v => save({ baselineGroup: v })} />
                <Field label="Shots" value={evalData.baselineShots}
                  onChange={v => save({ baselineShots: v })} keyboard="number-pad" />
                <Field label="Distance" value={evalData.distanceYd ?? '100'}
                  onChange={v => save({ distanceYd: v })} unit="yd" keyboard="number-pad" />
              </View>
              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.lbl, { color: colors.mut }]}>Turret</Text>
                  <View style={s.segRow}>
                    {[['moa', 'MOA'], ['mil', 'MIL']].map(([k, label]) => (
                      <TouchableOpacity key={k} onPress={() => save({ turret: k })}
                        style={[s.seg, {
                          backgroundColor: turret === k ? colors.act : colors.inset,
                          borderColor: turret === k ? colors.act : colors.ibd,
                        }]}>
                        <Text style={[s.segText, { color: turret === k ? '#fff' : colors.mut }]}>{label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
              <Text style={[s.hint, { color: colors.fnt }]}>
                {sigmaIn > 0
                  ? `Your ${baseShots}-shot baseline puts this rifle's dispersion at ${sigmaIn.toFixed(2)}" per axis at ${distanceYd} yd. Every step below is judged against that.`
                  : 'Record a baseline group and shot count — without it no step below can tell a real fault from noise.'}
              </Text>
              {shotsFor1 && (
                <Text style={[s.hint, { color: colors.fnt }]}>
                  Detecting a 1% tracking error on a 10 {turret === 'mil' ? 'mil' : 'MOA'} dial
                  would take about {shotsFor1} shots per group at this precision.
                </Text>
              )}
            </View>

            <Text style={[s.section, { color: colors.mut }]}>STEPS</Text>
            {!rows.length && (
              <Text style={[s.hint, { color: colors.fnt, marginTop: -2 }]}>
                Add a tracking test (dial a known amount, measure how far the group moved)
                or a return-to-zero check after running the turret through its travel.
              </Text>
            )}

            {results.map(({ row, result, expected }, i) => (
              <View key={row.id} style={[s.card, { backgroundColor: colors.card, borderColor: colors.bd }]}>
                <View style={s.stepHead}>
                  <Text style={[s.stepTitle, { color: colors.tx }]}>
                    {row.kind === 'rtz' ? `Return to zero` : `Tracking test ${i + 1}`}
                  </Text>
                  <TouchableOpacity onPress={() => removeRow(row.id)}>
                    <Trash2 size={15} color={colors.fnt} />
                  </TouchableOpacity>
                </View>
                <View style={s.row}>
                  {row.kind === 'rtz' ? (
                    <>
                      <Field label="Off zero" value={row.measured}
                        onChange={v => setRow(row.id, 'measured', v)} unit="in" />
                      <Field label="Travel" value={row.mils}
                        onChange={v => setRow(row.id, 'mils', v)} unit="mils" keyboard="number-pad" />
                    </>
                  ) : (
                    <>
                      <Field label="Dialled" value={row.dialled}
                        onChange={v => setRow(row.id, 'dialled', v)} unit={turret === 'mil' ? 'mil' : 'MOA'} />
                      <Field label="Group moved" value={row.measured}
                        onChange={v => setRow(row.id, 'measured', v)} unit="in" />
                    </>
                  )}
                  <Field label="Shots" value={row.shots}
                    onChange={v => setRow(row.id, 'shots', v)} keyboard="number-pad" flex={0.6} />
                </View>
                {row.kind !== 'rtz' && expected != null && (
                  <Text style={[s.hint, { color: colors.fnt }]}>
                    {row.dialled} {turret === 'mil' ? 'mil' : 'MOA'} at {distanceYd} yd should move the group {expected.toFixed(2)}"
                  </Text>
                )}
                {result.ok && (
                  <View style={[s.result, {
                    backgroundColor: result.resolved === true ? colors.dngs
                      : result.resolved === false ? colors.oks : colors.inset,
                  }]}>
                    {result.resolved === true ? <TriangleAlert size={16} color={colors.dngt} />
                      : result.resolved === false ? <CircleCheck size={16} color={colors.okt} />
                      : <Info size={16} color={colors.mut} />}
                    <Text style={[s.resultText, {
                      color: result.resolved === true ? colors.dngt
                        : result.resolved === false ? colors.okt : colors.mut,
                    }]}>{result.verdict}</Text>
                  </View>
                )}
              </View>
            ))}

            <View style={s.row}>
              <TouchableOpacity onPress={() => addRow('track')}
                style={[s.addBtn, { borderColor: colors.ibd }]}>
                <Plus size={15} color={colors.act} />
                <Text style={[s.addText, { color: colors.act }]}>Tracking test</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => addRow('rtz')}
                style={[s.addBtn, { borderColor: colors.ibd }]}>
                <Plus size={15} color={colors.act} />
                <Text style={[s.addText, { color: colors.act }]}>Return to zero</Text>
              </TouchableOpacity>
            </View>

            {summary.ok && (
              <View style={[s.summary, {
                backgroundColor: summary.failures ? colors.dngs
                  : summary.undecidable ? colors.warns : colors.oks,
              }]}>
                <Text style={[s.summaryText, {
                  color: summary.failures ? colors.dngt
                    : summary.undecidable ? colors.warnt : colors.okt,
                }]}>{summary.verdict}</Text>
              </View>
            )}

            <Text style={[s.section, { color: colors.mut }]}>
              MOUNTING · {mountDone}/{MOUNT_STEPS.length}
            </Text>
            <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.bd }]}>
              {MOUNT_STEPS.map(([key, label, fastener]) => {
                const spec = fastener ? findByName(rifle?.torque, fastener) : null;
                return (
                  <TouchableOpacity key={key}
                    onPress={() => save({ mount: { ...mount, [key]: !mount[key] } })}
                    style={s.checkRow}>
                    <View style={[s.checkbox, {
                      backgroundColor: mount[key] ? colors.act : 'transparent',
                      borderColor: mount[key] ? colors.act : colors.ibd,
                    }]}>
                      {mount[key] && <CircleCheck size={13} color="#fff" />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.checkText, { color: mount[key] ? colors.tx : colors.mut }]}>{label}</Text>
                      {/* Their figure, or a prompt to record it. Never one of ours. */}
                      {fastener && (
                        spec?.value
                          ? <Text style={[s.checkSpec, { color: colors.act }]}>{fmtBoth(spec.value, spec.unit)}</Text>
                          : <Text style={[s.checkSpec, { color: colors.fnt }]}>
                              No figure recorded — add it against this rifle in Equipment
                            </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
              <View style={[s.note, { backgroundColor: colors.inset, marginTop: 6 }]}>
                <Wrench size={15} color={colors.mut} />
                <Text style={[s.noteText, { color: colors.mut }]}>
                  This is a record of what you did, not a measurement — the app has no
                  way to verify any of it. Torque figures shown are the ones you recorded
                  against this rifle; the app supplies none of its own.
                </Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  backBtn: { width: 38, height: 38, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9, borderWidth: 1 },
  chipText: { fontSize: 12.5, fontWeight: '700' },
  section: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, marginTop: 12 },
  card: { padding: 14, borderRadius: 14, borderWidth: 1, gap: 10 },
  row: { flexDirection: 'row', gap: 9 },
  lbl: { fontSize: 11, fontWeight: '700', marginBottom: 5 },
  inp: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11 },
  // minWidth 0 so the field can shrink inside its row. A web <input> carries
  // a default size of 20 characters and a flex item will not shrink below its
  // intrinsic content width, so without this the box overflows and whatever
  // sits beside it is pushed out of view. That is how the distance unit went
  // missing: 'yd' was rendered every time, in a 215px input inside a 163px box.
  inpText: { flex: 1, minWidth: 0, paddingVertical: 9, fontSize: 14, fontFamily: 'JetBrainsMono_700Bold' },
  unit: { fontSize: 11, fontWeight: '700' },
  segRow: { flexDirection: 'row', gap: 7 },
  seg: { flex: 1, paddingVertical: 9, borderRadius: 9, borderWidth: 1, alignItems: 'center' },
  segText: { fontSize: 12.5, fontWeight: '700' },
  hint: { fontSize: 11.5, fontWeight: '600', lineHeight: 16 },
  stepHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepTitle: { fontSize: 14, fontWeight: '800' },
  result: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', padding: 11, borderRadius: 10 },
  resultText: { flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 17 },
  addBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 11, borderWidth: 1, borderStyle: 'dashed' },
  addText: { fontSize: 12.5, fontWeight: '700' },
  summary: { padding: 13, borderRadius: 12, marginTop: 4 },
  summaryText: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 4 },
  checkbox: { width: 21, height: 21, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  checkText: { flex: 1, fontSize: 12.5, fontWeight: '600', lineHeight: 17 },
  checkSpec: { fontSize: 11, fontWeight: '700', marginTop: 2, fontFamily: 'JetBrainsMono_500Medium' },
  note: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', padding: 11, borderRadius: 10 },
  noteText: { flex: 1, fontSize: 11.5, fontWeight: '600', lineHeight: 16 },
});
