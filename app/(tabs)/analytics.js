import { View, Text, TouchableOpacity, ScrollView, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Download, TrendingDown, TrendingUp, Minus, CircleCheck, Info, ChartColumn, ChevronDown } from 'lucide-react-native';
import Svg, { Line, Path, Circle, Text as SvgText } from 'react-native-svg';
import { useState, useMemo } from 'react';
import { useTheme } from '../../lib/theme';
import { useData } from '../../store/data';
import { assessTrend } from '../../lib/trend';
import { typicalGroup, REFERENCE_SHOTS } from '../../lib/groupsize';
import { targetGroups } from '../../lib/analytics';
import { deriveAnalytics, comparisonBuckets, compareBuckets, fmtP } from '../../lib/analytics';
import { angularUnit, angularFallsBack, moaToAngular, formatAngular, MOA_PER_MRAD } from '../../lib/units';
import { saveCSV } from '../../lib/export';
import FilterChips from '../../components/FilterChips';
import TargetPlot from '../../components/TargetPlot';
import PickerSheet from '../../components/PickerSheet';


/**
 * Hit probability saturates near 100% for tight groups on a generous target,
 * where a flat "100%" hides which side is actually better. Add decimals as it
 * approaches the ceiling rather than rounding the difference away.
 */
const fmtPct = (v) => {
  if (v == null) return '—';
  if (v >= 99.995) return '>99.99%';
  if (v >= 99.9) return v.toFixed(3) + '%';
  if (v >= 99) return v.toFixed(2) + '%';
  return v.toFixed(1) + '%';
};

// Trend y-axis: keep the spec's 0.2–0.8 window unless real data runs outside it.
function trendDomain(trend) {
  let lo = 0.2, hi = 0.8;
  if (trend.length) {
    lo = Math.min(lo, Math.floor(Math.min(...trend) * 5) / 5);
    hi = Math.max(hi, Math.ceil(Math.max(...trend) * 5) / 5);
  }
  return { lo, hi };
}

export default function AnalyticsScreen() {
  const { colors } = useTheme();
  const { rifles, loads, sessions, exportSessionsCSV, units } = useData();
  // Analytics aggregates sessions shot at different distances, so every figure
  // here is angular. An Inches preference cannot be honoured without a single
  // distance to convert against, so it falls back to MOA and the screen says so.
  const aUnit = angularUnit(units.group);
  const unitFellBack = angularFallsBack(units.group);
  const fmtMoa = (v) => formatAngular(v, units.group);
  const [filter, setFilter] = useState('all');

  const chips = [
    { key: 'all', label: 'All rifles' },
    ...rifles.map(r => ({ key: r.name, label: r.name })),
  ];

  const data = useMemo(
    () => deriveAnalytics(sessions, rifles, loads, filter),
    [sessions, rifles, loads, filter]
  );

  const scopedIds = useMemo(() => {
    if (filter === 'all') return null;
    const rifleId = rifles.find(r => r.name === filter)?.id;
    return sessions.filter(s => s.rifleId === rifleId).map(s => s.id);
  }, [sessions, rifles, filter]);

  /**
   * Whether the shooting is actually changing.
   *
   * Replaces `trend[last] < trend[first]`, which compared two points out of ten
   * - each of them a session's smallest group - and simulated to a 50% chance
   * of announcing a direction for a shooter who had not changed at all. Worse,
   * because a session's minimum falls the more targets are shot, someone who
   * simply shot more targets later in the year was told they were improving
   * 82% of the time. Now: a regression over every group with a confidence
   * interval, which claims a direction about 9% of the time on unchanged
   * shooting and refuses one otherwise.
   */
  const scopedSessions = useMemo(() => {
    if (filter === 'all') return sessions;
    const rifleId = rifles.find(r => r.name === filter)?.id;
    return sessions.filter(sn => sn.rifleId === rifleId);
  }, [sessions, rifles, filter]);

  const trendVerdict = useMemo(
    () => assessTrend(scopedSessions, (sn) => targetGroups(sn).map(g => g.moa)),
    [scopedSessions]
  );

  /**
   * A typical group, with shot count taken into account.
   *
   * The tile used to be a plain mean over every group regardless of how many
   * rounds each held. Extreme spread grows with shot count, so that average
   * moves when the shooter changes habits and not when their shooting changes.
   * Simulated on one unchanging rifle: switching from 3-shot to 10-shot groups
   * made the plain average 59% worse. Normalised to five shots it moved 0.4%.
   */
  const typical = useMemo(() => {
    const all = [];
    for (const sn of scopedSessions) for (const g of targetGroups(sn)) all.push(g);
    return typicalGroup(all.map(g => ({ inches: g.moa, shots: g.shots })));
  }, [scopedSessions]);

  // Statistical comparison: pick the dimension, then the two things to compare.
  const [cmpDim, setCmpDim] = useState('loads');
  const [cmpA, setCmpA] = useState(null);
  const [cmpB, setCmpB] = useState(null);
  const [picking, setPicking] = useState(null); // 'A' | 'B' | null
  // Held in whatever unit is on screen; converted to MOA before it reaches the
  // statistics, which work in MOA throughout.
  const [plateInput, setPlateInput] = useState(null);

  const buckets = useMemo(
    () => comparisonBuckets(sessions, rifles, loads, cmpDim),
    [sessions, rifles, loads, cmpDim]
  );

  // Default to the two best-sampled options whenever the dimension changes.
  const aKey = cmpA ?? buckets[0]?.key ?? null;
  const bKey = cmpB ?? buckets.find(x => x.key !== aKey)?.key ?? null;
  // 2 MOA is the default plate; shown as 0.58 when the screen is in MRAD.
  const plateShown = plateInput ?? moaToAngular(2, units.group).toFixed(2);
  const plate = (() => {
    const v = parseFloat(plateShown);
    if (!isFinite(v) || v <= 0) return 2;
    return aUnit === 'MRAD' ? v * MOA_PER_MRAD : v;
  })();
  const result = useMemo(
    () => compareBuckets(
      buckets.find(x => x.key === aKey),
      buckets.find(x => x.key === bKey),
      plate,
      aUnit
    ),
    [buckets, aKey, bKey, plate, aUnit]
  );

  const pickDim = (d) => { setCmpDim(d); setCmpA(null); setCmpB(null); };
  const pickerOptions = buckets.map(b => ({
    key: b.key, label: b.label, sub: b.sub,
    meta: `${b.n} group${b.n === 1 ? '' : 's'}`,
  }));
  const labelOf = (k) => buckets.find(x => x.key === k)?.label || 'Select';

  const trend = data.trend;
  const { lo: vLo, hi: vHi } = trendDomain(trend);
  const xL = 34, xR = 290, yT = 12, yB = 92;
  const n = trend.length;
  const yFor = (v) => +(yT + (vHi - v) / (vHi - vLo) * (yB - yT)).toFixed(1);

  const trendPts = trend.map((v, i) => ({
    cx: +(n === 1 ? (xL + xR) / 2 : xL + i * ((xR - xL) / (n - 1))).toFixed(1),
    cy: yFor(v),
  }));
  const trendPath = trendPts.length ? 'M ' + trendPts.map(p => p.cx + ' ' + p.cy).join(' L ') : '';
  const trendArea = trendPts.length > 1
    ? trendPath + ' L ' + trendPts[n - 1].cx + ' ' + yB + ' L ' + trendPts[0].cx + ' ' + yB + ' Z'
    : '';

  const step = (vHi - vLo) / 3;
  const gridLines = [0, 1, 2, 3].map(i => {
    const v = vHi - i * step;
    return { y: yFor(v), label: v.toFixed(1) };
  });

  // "Improving" means the latest group is tighter than the first.
  const improving = n >= 2 && trend[n - 1] < trend[0];
  const cmp = data.comparison;

  // Exports what the rifle filter is currently showing, not always everything.
  const doExport = () => saveCSV(
    exportSessionsCSV(scopedIds),
    filter === 'all' ? 'prs-sessions.csv' : `prs-${filter.replace(/\s+/g, '-').toLowerCase()}.csv`
  );

  const empty = data.sessionCount === 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <Text style={[s.title, { color: colors.tx }]}>Analytics</Text>
          <TouchableOpacity onPress={doExport} style={[s.dlBtn, { backgroundColor: colors.card, borderColor: colors.bd }]}>
            <Download size={19} color={colors.act} />
          </TouchableOpacity>
        </View>

        <View style={{ marginHorizontal: -20, marginBottom: 18 }}>
          <FilterChips items={chips} selected={filter} onSelect={setFilter} />
        </View>

        {empty ? (
          <View style={[s.emptyCard, { backgroundColor: colors.card, borderColor: colors.bd }]}>
            <View style={[s.emptyIcon, { backgroundColor: colors.acs }]}>
              <ChartColumn size={26} color={colors.act} />
            </View>
            <Text style={[s.emptyTitle, { color: colors.tx }]}>No data yet</Text>
            <Text style={[s.emptyText, { color: colors.mut }]}>
              {filter === 'all'
                ? 'Capture a session to start tracking your group sizes over time.'
                : `No sessions recorded for ${filter} yet.`}
            </Text>
          </View>
        ) : (
          <>
            {unitFellBack && (
              <View style={[s.unitNote, { backgroundColor: colors.inset }]}>
                <Info size={14} color={colors.mut} />
                <Text style={[s.unitNoteText, { color: colors.mut }]}>
                  Shown in MOA. These figures pool sessions shot at different
                  distances, and inches needs one distance to convert against.
                </Text>
              </View>
            )}

            <View style={s.tilesRow}>
              <View style={[s.tile, { backgroundColor: colors.card, borderColor: colors.bd }]}>
                <Text style={[s.tileLabel, { color: colors.mut }]}>Typical Group</Text>
                <Text style={[s.tileVal, { color: colors.tx }]}>
                  {typical ? moaToAngular(typical.value, units.group).toFixed(2) : '—'}
                </Text>
                <Text style={[s.tileUnit, { color: colors.fnt }]}>
                  {typical?.normalised ? `${aUnit} at ${REFERENCE_SHOTS} shots` : aUnit}
                </Text>
              </View>
              <View style={[s.tile, { backgroundColor: colors.card, borderColor: colors.bd }]}>
                <Text style={[s.tileLabel, { color: colors.mut }]}>Total Rounds</Text>
                <Text style={[s.tileVal, { color: colors.tx }]}>{data.rounds}</Text>
                <Text style={[s.tileUnit, { color: colors.fnt }]}>
                  {data.sessionCount} session{data.sessionCount === 1 ? '' : 's'}
                </Text>
              </View>
            </View>

            {/* Group Size Trend */}
            <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.bd }]}>
              <View style={s.cardHeader}>
                <Text style={[s.cardTitle, { color: colors.tx }]}>Group Size Trend</Text>
                {(() => {
                  const v = trendVerdict.level;
                  if (v === 'insufficient') return null;
                  const look = {
                    improving: { Icon: TrendingDown, colour: '#15A34A', label: 'Improving' },
                    worsening: { Icon: TrendingUp, colour: '#D9822B', label: 'Opening up' },
                    flat: { Icon: Minus, colour: colors.mut, label: 'No change' },
                  }[v];
                  const Icon = look.Icon;
                  return (
                    <View style={s.improving}>
                      <Icon size={14} color={look.colour} />
                      <Text style={[s.improvingText, { color: look.colour }]}>{look.label}</Text>
                    </View>
                  );
                })()}
              </View>
              {n === 0 ? (
                <Text style={[s.inlineEmpty, { color: colors.mut }]}>
                  No scaled groups recorded yet.
                </Text>
              ) : (
                <>
                  <Svg viewBox="0 0 300 106" style={{ width: '100%', height: undefined, aspectRatio: 300 / 106 }}>
                    {gridLines.map((g, i) => (
                      <Line key={i} x1={34} y1={g.y} x2={xR} y2={g.y} stroke={colors.grid} strokeWidth={1} />
                    ))}
                    {gridLines.map((g, i) => (
                      <SvgText key={'t' + i} x={28} y={g.y} textAnchor="end" alignmentBaseline="middle" fontSize={9} fontFamily="JetBrains Mono" fill={colors.fnt}>{g.label}</SvgText>
                    ))}
                    {trendArea ? <Path d={trendArea} fill="rgba(109,59,235,0.12)" /> : null}
                    {n > 1 ? <Path d={trendPath} fill="none" stroke="#8257F0" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" /> : null}
                    {trendPts.map((p, i) => (
                      <Circle key={i} cx={p.cx} cy={p.cy} r={3.4} fill={colors.card} stroke="#8257F0" strokeWidth={2} />
                    ))}
                  </Svg>
                  <View style={s.trendFooter}>
                    <Text style={[s.trendLabel, { color: colors.fnt }]}>
                      {n === 1 ? 'only session' : `${n} sessions ago`}
                    </Text>
                    <Text style={[s.trendLabel, { color: colors.fnt }]}>latest · {aUnit}</Text>
                  </View>

                  {/* The reasoning, not just a coloured word. "No change" is a
                      finding and is worded as one, with the size of shift that
                      would have been visible - which is the part that tells a
                      shooter whether to keep chasing something. */}
                  <Text style={[s.trendVerdict, {
                    color: trendVerdict.level === 'improving' ? '#15A34A'
                      : trendVerdict.level === 'worsening' ? '#D9822B'
                      : colors.mut,
                  }]}>
                    {trendVerdict.text}
                  </Text>
                </>
              )}
            </View>

            {/* Shot Distribution */}
            <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.bd, flexDirection: 'row', alignItems: 'center' }]}>
              <View style={{ flex: 1 }}>
                <Text style={[s.cardTitle, { color: colors.tx, marginBottom: 8 }]}>Shot{'\n'}Distribution</Text>
                <Text style={[s.distSub, { color: colors.mut }]}>
                  {/* Name the session when it is not the newest one, so a plot
                      from three weeks ago is not read as today's shooting. */}
                  {data.latestShots
                    ? `${data.plotIsLatest ? 'Latest group' : (data.plotSessionName || 'Most recent measured group')}\n${data.latestShots} shots · ${data.latestGroup.toFixed(2)}"`
                    : 'No measured group in any session yet'}
                </Text>
              </View>
              <TargetPlot moaShots={data.moaShots} size={140} showLabels unit={units.group} />
            </View>

            {/* Statistical Comparison — pick the dimension, then the two sides */}
            <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.bd }]}>
              <Text style={[s.cardTitle, { color: colors.tx, marginBottom: 12 }]}>Statistical Comparison</Text>

              <View style={[s.segmented, { backgroundColor: colors.inset }]}>
                {[['loads', 'Loads'], ['rifles', 'Rifles'], ['sessions', 'Sessions']].map(([key, label]) => (
                  <TouchableOpacity
                    key={key}
                    onPress={() => pickDim(key)}
                    style={[s.seg, cmpDim === key && { backgroundColor: colors.card }]}
                  >
                    <Text style={[s.segText, { color: cmpDim === key ? colors.tx : colors.mut }]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {buckets.length < 2 ? (
                <View style={[s.tTestResult, { backgroundColor: colors.inset }]}>
                  <Info size={18} color={colors.mut} style={{ marginTop: 1 }} />
                  <Text style={[s.tTestText, { color: colors.mut }]}>
                    Only {buckets.length} {cmpDim.slice(0, -1)}{buckets.length === 1 ? '' : 's'} with recorded groups — need two to compare.
                  </Text>
                </View>
              ) : (
                <>
                  {[['A', aKey], ['B', bKey]].map(([side, sel]) => (
                    <TouchableOpacity
                      key={side}
                      onPress={() => setPicking(side)}
                      style={[s.pickBtn, { backgroundColor: colors.input, borderColor: colors.ibd }]}
                    >
                      <Text style={[s.pickLabel, { color: colors.mut }]}>{side}</Text>
                      <Text style={[s.pickValue, { color: colors.tx }]} numberOfLines={1}>{labelOf(sel)}</Text>
                      <ChevronDown size={17} color={colors.fnt} />
                    </TouchableOpacity>
                  ))}

                  {result.error ? (
                    <View style={[s.tTestResult, { backgroundColor: colors.inset }]}>
                      <Info size={18} color={colors.mut} style={{ marginTop: 1 }} />
                      <Text style={[s.tTestText, { color: colors.mut }]}>{result.error}</Text>
                    </View>
                  ) : (
                    <>
                      {/* Side-by-side shot scatter — the groups behind the numbers */}
                      <View style={s.plotRow}>
                        {[result.a, result.b].map((sideData, i) => (
                          <View key={i} style={[s.plotBox, {
                            backgroundColor: i === 1 ? colors.oks : colors.inset,
                            borderColor: i === 1 ? colors.okbd : colors.ibd,
                          }]}>
                            <Text style={[s.plotName, { color: i === 1 ? colors.okt : colors.mut }]} numberOfLines={1}>
                              {sideData.label}
                            </Text>
                            <TargetPlot moaShots={sideData.moaOffsets} size={116} showLabels unit={units.group} />
                            <Text style={[s.plotMeta, { color: i === 1 ? colors.okt : colors.fnt }]}>
                              {sideData.shots} shots · {sideData.n} groups
                            </Text>
                          </View>
                        ))}
                      </View>

                      {/* Metric table: every row uses all shots, unlike extreme spread */}
                      <View style={[s.statTable, { borderColor: colors.line }]}>
                        {[
                          ['Avg group (ES)', fmtMoa(result.a.mean), fmtMoa(result.b.mean)],
                          ['Group SD', fmtMoa(result.a.sd), fmtMoa(result.b.sd)],
                          ['Mean radius', fmtMoa(result.a.dispersion?.meanRadius), fmtMoa(result.b.dispersion?.meanRadius)],
                          ['Sigma (dispersion)', fmtMoa(result.a.dispersion?.sigma), fmtMoa(result.b.dispersion?.sigma)],
                          ['CEP R50', fmtMoa(result.a.dispersion?.r50), fmtMoa(result.b.dispersion?.r50)],
                          ['R90', fmtMoa(result.a.dispersion?.r90), fmtMoa(result.b.dispersion?.r90)],
                          [`P(hit) ${plate} ${aUnit}`, fmtPct(result.a.hitPct), fmtPct(result.b.hitPct)],
                        ].map(([label, av, bv], i) => (
                          <View key={i} style={[s.statRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}>
                            <Text style={[s.statLabel, { color: colors.mut }]}>{label}</Text>
                            <Text style={[s.statCell, { color: colors.tx }]}>{av}</Text>
                            <Text style={[s.statCell, { color: colors.okt, fontWeight: '800' }]}>{bv}</Text>
                          </View>
                        ))}
                      </View>

                      <View style={s.plateRow}>
                        <Text style={[s.plateLabel, { color: colors.mut }]}>Target size for P(hit)</Text>
                        <View style={[s.plateInput, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
                          <TextInput
                            value={String(plateShown)}
                            onChangeText={setPlateInput}
                            keyboardType="decimal-pad"
                            style={[s.plateInputText, { color: colors.tx }]}
                          />
                          <Text style={[s.plateUnit, { color: colors.fnt }]}>{aUnit}</Text>
                        </View>
                      </View>

                      <View style={[s.tTestResult, { backgroundColor: result.welch?.significant ? colors.acs : colors.inset }]}>
                        {result.welch?.significant
                          ? <CircleCheck size={18} color={colors.act} style={{ marginTop: 1 }} />
                          : <Info size={18} color={colors.mut} style={{ marginTop: 1 }} />}
                        <Text style={[s.tTestText, { color: result.welch?.significant ? colors.act : colors.mut }]}>
                          {result.verdict}
                        </Text>
                      </View>

                      {result.boot && (
                        <View style={[s.confRow, { borderColor: colors.line }]}>
                          <Text style={[s.confLabel, { color: colors.mut }]}>
                            Chance {result.b.label} is genuinely tighter
                          </Text>
                          <Text style={[s.confVal, {
                            color: result.boot.probBTighter >= 0.9 ? colors.okt : colors.tx,
                          }]}>
                            {(result.boot.probBTighter * 100).toFixed(0)}%
                          </Text>
                        </View>
                      )}

                      {result.welch && (
                        <Text style={[s.fineprint, { color: colors.fnt }]}>
                          Welch t={result.welch.t}, df={result.welch.df}, p={fmtP(result.welch.p)} · Cohen d={result.welch.cohenD}
                          {result.variance && ` · consistency F=${result.variance.f}, p=${fmtP(result.variance.p)}${result.variance.significant ? ' (differs)' : ''}`}
                          {'\n'}Group test uses {result.a.n}+{result.b.n} groups; dispersion uses {result.a.shots}+{result.b.shots} shots.
                        </Text>
                      )}
                    </>
                  )}
                </>
              )}
            </View>
          </>
        )}
      </ScrollView>

      <PickerSheet
        visible={picking !== null}
        title={`Compare ${picking === 'B' ? 'B' : 'A'} — pick a ${cmpDim.slice(0, -1)}`}
        options={pickerOptions}
        selectedKey={picking === 'B' ? bKey : aKey}
        disabledKey={picking === 'B' ? aKey : bKey}
        onSelect={(k) => (picking === 'B' ? setCmpB(k) : setCmpA(k))}
        onClose={() => setPicking(null)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  dlBtn: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tilesRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  tile: { flex: 1, borderWidth: 1, borderRadius: 16, padding: 15 },
  tileLabel: { fontSize: 12, fontWeight: '600' },
  tileVal: { fontSize: 24, fontWeight: '700', marginTop: 6, fontFamily: 'JetBrainsMono_700Bold' },
  tileUnit: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  unitNote: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 11, borderRadius: 10, marginBottom: 4 },
  unitNoteText: { flex: 1, fontSize: 11.5, fontWeight: '600', lineHeight: 16 },
  card: { borderWidth: 1, borderRadius: 18, padding: 18, paddingHorizontal: 16, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  trendVerdict: { fontSize: 11.5, fontWeight: '600', lineHeight: 16, marginTop: 10 },
  improving: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  improvingText: { fontSize: 12, fontWeight: '700' },
  inlineEmpty: { fontSize: 13, fontWeight: '500', paddingVertical: 12 },
  trendFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, marginHorizontal: 4, marginLeft: 34 },
  trendLabel: { fontSize: 11, fontWeight: '600' },
  distSub: { fontSize: 12, fontWeight: '500', lineHeight: 18 },
  segmented: { flexDirection: 'row', gap: 4, borderRadius: 11, padding: 4, marginBottom: 12 },
  seg: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  segText: { fontSize: 13, fontWeight: '700' },
  pickBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 12, marginBottom: 8 },
  pickLabel: { width: 14, fontSize: 12, fontWeight: '800' },
  pickValue: { flex: 1, fontSize: 14.5, fontWeight: '700' },
  plotRow: { flexDirection: 'row', gap: 10, marginTop: 6, marginBottom: 12 },
  plotBox: { flex: 1, alignItems: 'center', borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 6, gap: 6 },
  plotName: { fontSize: 12, fontWeight: '700', maxWidth: '100%' },
  plotMeta: { fontSize: 10.5, fontWeight: '600' },
  statTable: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  statRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 12 },
  statLabel: { flex: 1.4, fontSize: 12, fontWeight: '600' },
  statCell: { flex: 1, fontSize: 12.5, fontWeight: '700', textAlign: 'right', fontFamily: 'JetBrainsMono_700Bold' },
  plateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  plateLabel: { flex: 1, fontSize: 12, fontWeight: '600' },
  plateInput: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, width: 108 },
  // minWidth 0 so the field can shrink inside its row. A web <input> carries
  // a default size of 20 characters and a flex item will not shrink below its
  // intrinsic content width, so without this the box overflows and whatever
  // sits beside it is pushed out of view. That is how the distance unit went
  // missing: 'yd' was rendered every time, in a 215px input inside a 163px box.
  plateInputText: { flex: 1, minWidth: 0, paddingVertical: 9, fontSize: 14, fontFamily: 'JetBrainsMono_700Bold' },
  plateUnit: { fontSize: 11, fontWeight: '700' },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 11, padding: 12, marginTop: 10 },
  confLabel: { flex: 1, fontSize: 12, fontWeight: '600' },
  confVal: { fontSize: 18, fontWeight: '800', fontFamily: 'JetBrainsMono_700Bold' },
  fineprint: { fontSize: 10.5, fontWeight: '600', lineHeight: 15, marginTop: 10, marginHorizontal: 2 },
  compareRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  compareBox: { flex: 1, alignItems: 'center', padding: 12, borderRadius: 12 },
  compareName: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  compareVal: { fontSize: 19, fontWeight: '700', marginTop: 6, fontFamily: 'JetBrainsMono_700Bold' },
  compareN: { fontSize: 10, fontWeight: '600', marginTop: 3 },
  vs: { fontSize: 12, fontWeight: '700' },
  tTestResult: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 12, padding: 12, paddingHorizontal: 14, borderRadius: 12 },
  tTestText: { flex: 1, fontSize: 12.5, fontWeight: '600', lineHeight: 18 },
  emptyCard: { borderWidth: 1, borderRadius: 18, padding: 28, alignItems: 'center' },
  emptyIcon: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { fontSize: 16, fontWeight: '800', marginBottom: 6 },
  emptyText: { fontSize: 13, fontWeight: '500', textAlign: 'center', lineHeight: 19 },
});
