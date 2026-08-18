import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Download, Gauge, ChevronDown, Crosshair } from 'lucide-react-native';
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme, groupColor } from '../../lib/theme';
import { useData } from '../../store/data';
import { saveCSV, slugify } from '../../lib/export';
import { formatGroup, formatVelocity, formatDistance, groupUnitLabel } from '../../lib/units';
import { targetGroups } from '../../lib/analytics';
import TargetPlot from '../../components/TargetPlot';
import TargetDetail from '../../components/TargetDetail';
import { targetMetrics, sessionPoi } from '../../lib/poi';
import { inchesToNormalised, orderCorners, project } from '../../lib/homography';
import ChronoImport from '../../components/ChronoImport';

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();
  const { getSession, getRifleName, exportSessionsCSV, updateSession, units } = useData();
  const [importing, setImporting] = useState(false);
  const [openTarget, setOpenTarget] = useState(null);
  const [aimEditing, setAimEditing] = useState(null);

  // Store a new aim point for one target, in the same normalised space the
  // shots and corners already live in.
  const setAim = (targetId, aim) => {
    updateSession(sess.id, {
      targets: sess.targets.map(t => (t.id === targetId ? { ...t, aim } : t)),
    });
  };

  const sess = getSession(id);
  if (!sess) return null;

  const rifleName = getRifleName(sess.rifleId);
  const allShots = sess.targets.flatMap(t => t.shots);
  // Real per-target sizes. These were previously synthesised as
  // best + index * 0.18, which produced a plausible ascending list that was
  // not a measurement of anything.
  const perTarget = targetGroups(sess);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={[s.backBtn, { backgroundColor: colors.card, borderColor: colors.bd }]}>
            <ArrowLeft size={19} color={colors.tx} />
          </TouchableOpacity>
          <View style={s.headerMid}>
            <Text numberOfLines={1} style={[s.title, { color: colors.tx }]}>{sess.name}</Text>
            <Text style={[s.date, { color: colors.mut }]}>{sess.date}</Text>
          </View>
          <TouchableOpacity
            onPress={() => saveCSV(exportSessionsCSV([sess.id]), `${slugify(sess.name)}.csv`)}
            style={[s.backBtn, { backgroundColor: colors.card, borderColor: colors.bd }]}
          >
            <Download size={18} color={colors.act} />
          </TouchableOpacity>
        </View>

        <View style={s.badges}>
          {[rifleName, formatDistance(sess.distanceYd, sess.distanceUnit || units.distance), sess.suppressed ? 'Suppressed' : 'Bare muzzle'].map((b, i) => (
            <View key={i} style={[s.badge, { backgroundColor: colors.card, borderColor: colors.bd }]}>
              <Text style={[s.badgeText, { color: colors.tx }]}>{b}</Text>
            </View>
          ))}
        </View>

        {/* Group plot + stats */}
        <View style={[s.plotCard, { backgroundColor: colors.card, borderColor: colors.bd }]}>
          <TargetPlot shots={allShots} size={130} />
          <View style={s.plotStats}>
            <Text style={[s.plotLabel, { color: colors.mut }]}>BEST GROUP</Text>
            <Text style={[s.plotBest, { color: groupColor(sess.best, colors), fontFamily: 'JetBrainsMono_700Bold' }]}>
              {formatGroup(parseFloat(sess.best), sess.distanceYd, units.group)}
            </Text>
            <Text style={[s.plotLabel, { color: colors.mut, marginTop: 12 }]}>MEAN RADIUS</Text>
            <Text style={[s.plotMR, { color: colors.tx, fontFamily: 'JetBrainsMono_700Bold' }]}>
              {formatGroup(parseFloat(sess.meanRadius), sess.distanceYd, units.group)}
            </Text>
          </View>
        </View>

        {/* No chronograph import yet, so these are unmeasured on captured
            sessions. Show an em dash rather than 0 fps, which reads as a real
            reading of zero. */}
        <View style={s.velRow}>
          <View style={[s.velTile, { backgroundColor: colors.card, borderColor: colors.bd }]}>
            <Text style={[s.velLabel, { color: colors.mut }]}>AVG VELOCITY</Text>
            {sess.mv > 0
              ? <Text style={[s.velVal, { color: colors.tx }]}>{formatVelocity(sess.mv, units.velocity)}</Text>
              : <Text style={[s.velVal, { color: colors.fnt }]}>—</Text>}
          </View>
          <View style={[s.velTile, { backgroundColor: colors.card, borderColor: colors.bd }]}>
            <Text style={[s.velLabel, { color: colors.mut }]}>VELOCITY SD</Text>
            {sess.sd > 0
              ? <Text style={[s.velVal, { color: colors.tx }]}>{formatVelocity(sess.sd, units.velocity)}</Text>
              : <Text style={[s.velVal, { color: colors.fnt }]}>—</Text>}
          </View>
        </View>

        {sess.velocities?.length > 0 && (
          <View style={[s.chronoCard, { backgroundColor: colors.card, borderColor: colors.bd }]}>
            <Text style={[s.chronoLabel, { color: colors.mut }]}>
              CHRONO · {sess.velocities.length} SHOTS · ES {sess.velocityEs ?? '—'} fps
            </Text>
            <Text style={[s.chronoList, { color: colors.tx }]} numberOfLines={3}>
              {sess.velocities.join(', ')}
            </Text>
          </View>
        )}

        <TouchableOpacity
          onPress={() => setImporting(true)}
          style={[s.chronoBtn, { backgroundColor: colors.acs }]}
        >
          <Gauge size={17} color={colors.act} />
          <Text style={[s.chronoBtnText, { color: colors.act }]}>
            {sess.velocities?.length ? 'Replace chrono data' : 'Import chrono string'}
          </Text>
        </TouchableOpacity>

        {/* Point of impact for the whole session: what to dial. */}
        {(() => {
          const poi = sessionPoi(sess, units.group);
          return (
            <View style={[s.poiCard, {
              backgroundColor: poi.ok ? colors.acs : colors.inset,
              borderColor: poi.ok ? colors.act : colors.ibd,
            }]}>
              <Text style={[s.poiLabel, { color: poi.ok ? colors.act : colors.mut }]}>
                POINT OF IMPACT
              </Text>
              {poi.ok ? (
                <>
                  <Text style={[s.poiValue, { color: colors.act }]}>{poi.summary}</Text>
                  <Text style={[s.poiDial, { color: colors.act }]}>Dial {poi.dial}</Text>
                  <Text style={[s.poiMeta, { color: colors.act }]}>
                    Pooled from {poi.shots} shot{poi.shots === 1 ? '' : 's'} across{' '}
                    {poi.targetsUsed} target{poi.targetsUsed === 1 ? '' : 's'} · {poi.unit}
                  </Text>
                </>
              ) : (
                <Text style={[s.poiMeta, { color: colors.mut, marginTop: 2 }]}>{poi.reason}</Text>
              )}
            </View>
          );
        })()}

        <Text style={[s.targetsTitle, { color: colors.tx }]}>Targets ({sess.targetCount})</Text>
        <Text style={[s.targetsHint, { color: colors.fnt }]}>Tap a target to see its shots and point of impact.</Text>
        <View style={s.targetsList}>
          {sess.targets.map((t, i) => {
            const measured = perTarget.find(g => g.id === t.id);
            const groupSize = measured ? measured.inches.toFixed(2) : null;
            const open = openTarget === t.id;
            const m = open ? targetMetrics(t, sess.distanceYd, units.group) : null;
            return (
              <View key={t.id}>
                <TouchableOpacity
                  onPress={() => setOpenTarget(open ? null : t.id)}
                  activeOpacity={0.7}
                  style={[s.targetRow, {
                    backgroundColor: colors.card,
                    borderColor: open ? colors.act : colors.bd,
                  }]}
                >
                  <View style={[s.targetNum, { backgroundColor: colors.acs }]}>
                    <Text style={[s.targetNumText, { color: colors.act }]}>{i + 1}</Text>
                  </View>
                  <Text style={[s.targetShots, { color: colors.mut }]}>{t.shots.length} shots</Text>
                  <Text style={[s.targetGroup, { color: groupColor(groupSize, colors), fontFamily: 'JetBrainsMono_700Bold' }]}>
                    {groupSize ? formatGroup(parseFloat(groupSize), sess.distanceYd, units.group) : '—'}
                  </Text>
                  <ChevronDown
                    size={16}
                    color={colors.fnt}
                    style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
                  />
                </TouchableOpacity>

                {open && (
                  <View style={[s.targetPanel, { backgroundColor: colors.card, borderColor: colors.act }]}>
                    <TargetDetail
                      metrics={m}
                      size={250}
                      onSetAim={aimEditing === t.id ? (pt) => setAim(t.id, pt) : null}
                      invert={aimEditing === t.id && t.scale ? (planePt) => {
                        const Hi = inchesToNormalised(orderCorners(t.scale.corners), t.scale.widthIn, t.scale.heightIn);
                        return Hi ? project(Hi, planePt) : null;
                      } : null}
                    />

                    {m.ok && (
                      <TouchableOpacity
                        onPress={() => setAimEditing(aimEditing === t.id ? null : t.id)}
                        style={[s.aimBtn, {
                          backgroundColor: aimEditing === t.id ? colors.act : colors.inset,
                          borderColor: aimEditing === t.id ? colors.act : colors.ibd,
                        }]}
                      >
                        <Crosshair size={14} color={aimEditing === t.id ? '#fff' : colors.act} />
                        <Text style={[s.aimBtnText, { color: aimEditing === t.id ? '#fff' : colors.act }]}>
                          {aimEditing === t.id
                            ? 'Tap the plot to place your aim point · Done'
                            : m.aimAssumed ? 'Aim assumed at centre — adjust' : 'Adjust aim point'}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {m.ok && (
                      <>
                        <View style={s.statGrid}>
                          {[
                            ['GROUP', m.extremeSpread],
                            ['MEAN RADIUS', m.meanRadius],
                            ['SIGMA', m.sigma],
                            ['CENTRE ±95%', m.centre95],
                          ].map(([label, val]) => (
                            <View key={label} style={[s.statTile, { backgroundColor: colors.inset }]}>
                              <Text style={[s.statLabel, { color: colors.mut }]}>{label}</Text>
                              <Text style={[s.statVal, { color: colors.tx }]}>
                                {val == null ? '—' : `${val} ${m.unit}`}
                              </Text>
                            </View>
                          ))}
                        </View>

                        {m.poi.available ? (
                          <View style={[s.poiInline, { backgroundColor: m.poi.meaningful ? colors.oks : colors.warns }]}>
                            <Text style={[s.poiInlineVal, { color: m.poi.meaningful ? colors.okt : colors.warnt }]}>
                              {m.poi.summary} · dial {m.poi.dial}
                            </Text>
                            {!!m.poi.note && (
                              <Text style={[s.poiInlineNote, { color: colors.warnt }]}>{m.poi.note}</Text>
                            )}
                          </View>
                        ) : (
                          <View style={[s.poiInline, { backgroundColor: colors.inset }]}>
                            <Text style={[s.poiInlineNote, { color: colors.mut }]}>{m.poi.reason}</Text>
                          </View>
                        )}
                      </>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <ChronoImport
        visible={importing}
        onClose={() => setImporting(false)}
        onImport={({ velocities, stats }) => updateSession(sess.id, {
          velocities,
          mv: stats.mean,
          sd: stats.sd ?? 0,
          velocityEs: stats.es,
        })}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  backBtn: { width: 38, height: 38, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerMid: { flex: 1, minWidth: 0 },
  title: { fontSize: 19, fontWeight: '800' },
  date: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 14 },
  badge: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  plotCard: { flexDirection: 'row', alignItems: 'center', gap: 16, borderWidth: 1, borderRadius: 18, padding: 18 },
  plotStats: { flex: 1 },
  plotLabel: { fontSize: 11, fontWeight: '700' },
  plotBest: { fontSize: 26, marginTop: 3 },
  plotMR: { fontSize: 18, marginTop: 3 },
  velRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  velTile: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 15 },
  velLabel: { fontSize: 11, fontWeight: '700' },
  velVal: { fontSize: 19, fontWeight: '700', marginTop: 5, fontFamily: 'JetBrainsMono_700Bold' },
  chronoCard: { borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 10 },
  chronoLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4 },
  chronoList: { fontSize: 12.5, fontWeight: '600', lineHeight: 18, marginTop: 6, fontFamily: 'JetBrainsMono_500Medium' },
  chronoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 13, padding: 13, marginTop: 10 },
  chronoBtnText: { fontSize: 14, fontWeight: '700' },
  targetsTitle: { fontSize: 14, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 22, marginBottom: 10 },
  aimBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, marginTop: 10, width: '100%' },
  aimBtnText: { fontSize: 12, fontWeight: '700', flexShrink: 1 },
  poiCard: { padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 16 },
  poiLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.7 },
  poiValue: { fontSize: 21, fontWeight: '800', marginTop: 5, fontFamily: 'JetBrainsMono_700Bold' },
  poiDial: { fontSize: 14, fontWeight: '800', marginTop: 2 },
  poiMeta: { fontSize: 11.5, fontWeight: '600', marginTop: 4, lineHeight: 16 },
  targetsHint: { fontSize: 11.5, fontWeight: '600', marginTop: -6, marginBottom: 8 },
  targetPanel: { padding: 14, borderRadius: 12, borderWidth: 1, marginTop: -4, marginBottom: 8, alignItems: 'center' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, width: '100%' },
  statTile: { flexGrow: 1, flexBasis: '45%', padding: 10, borderRadius: 10 },
  statLabel: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.5 },
  statVal: { fontSize: 15, fontWeight: '800', marginTop: 3, fontFamily: 'JetBrainsMono_700Bold' },
  poiInline: { padding: 11, borderRadius: 10, marginTop: 10, width: '100%' },
  poiInlineVal: { fontSize: 13.5, fontWeight: '800' },
  poiInlineNote: { fontSize: 11.5, fontWeight: '600', lineHeight: 16, marginTop: 3 },
  targetsList: { gap: 10 },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 15 },
  targetNum: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  targetNumText: { fontWeight: '800', fontSize: 14, fontFamily: 'JetBrainsMono_700Bold' },
  targetShots: { flex: 1, fontSize: 13, fontWeight: '600' },
  targetGroup: { fontSize: 15 },
});
