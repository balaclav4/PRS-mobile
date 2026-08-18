import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, BookOpen, Trash2, ChevronDown, ChevronUp, Plus, Thermometer, Gauge, Wind, Mountain } from 'lucide-react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useTheme } from '../../lib/theme';
import { useData } from '../../store/data';
import { formatTemp, formatDistance, formatVelocity } from '../../lib/units';
import { saveCSV, slugify } from '../../lib/export';

/**
 * Saved dope cards.
 *
 * A card is a solution for one load under one set of conditions, frozen at the
 * moment it was made. It deliberately does not recompute on open: the whole
 * point is to have the numbers you confirmed, including the atmosphere they
 * were confirmed in, available at the range without a live solve.
 */
export default function DopeCardsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { dopeCards, loads, rifles, deleteDopeCard, units } = useData();
  const [expanded, setExpanded] = useState(null);

  const confirmDelete = (card) => {
    const doIt = () => deleteDopeCard(card.id);
    if (Platform.OS === 'web') { if (confirm(`Delete "${card.name}"?`)) doIt(); }
    else Alert.alert('Delete card', `Delete "${card.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: doIt },
    ]);
  };

  const exportCard = (card) => {
    const unit = (card.opts?.unit || 'moa').toUpperCase();
    const header = `Range (${units.distance}),Elevation (${unit}),Wind (${unit}),Velocity (${units.velocity}),Mach,TOF (s)`;
    // The header carries the user's units, so the values have to be converted
    // to match — emitting raw yd/fps under a metric header would mislabel every
    // row in the file.
    const rows = card.rows.map(r => [
      units.distance === 'm' ? (r.rangeYd * 0.9144).toFixed(0) : r.rangeYd,
      r.elevation, r.wind,
      units.velocity === 'm/s' ? (r.velFps * 0.3048).toFixed(0) : r.velFps,
      r.mach, r.tofSec,
    ].join(','));
    saveCSV([header, ...rows].join('\n'), `${slugify(card.name, 'dope')}.csv`);
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
          <Text style={[s.title, { color: colors.tx }]}>Dope Cards</Text>
        </View>

        {dopeCards.length === 0 ? (
          <View style={[s.empty, { backgroundColor: colors.card, borderColor: colors.bd }]}>
            <View style={[s.emptyIcon, { backgroundColor: colors.acs }]}>
              <BookOpen size={26} color={colors.act} />
            </View>
            <Text style={[s.emptyTitle, { color: colors.tx }]}>No saved cards</Text>
            <Text style={[s.emptyText, { color: colors.mut }]}>
              Build a solution in Ballistics and save it. Cards keep the conditions
              they were made for, so you can pull the right one at the range.
            </Text>
            <TouchableOpacity onPress={() => router.push('/ballistics')} style={[s.emptyBtn, { backgroundColor: colors.acs }]}>
              <Plus size={15} color={colors.act} />
              <Text style={[s.emptyBtnText, { color: colors.act }]}>Open Ballistics</Text>
            </TouchableOpacity>
          </View>
        ) : (
          dopeCards.map(card => {
            const o = card.opts || {};
            const load = loads.find(l => l.id === card.loadId);
            const rifle = rifles.find(r => r.id === card.rifleId);
            const open = expanded === card.id;
            const unit = (o.unit || 'moa').toUpperCase();

            return (
              <View key={card.id} style={[s.card, { backgroundColor: colors.card, borderColor: colors.bd }]}>
                <TouchableOpacity onPress={() => setExpanded(open ? null : card.id)} style={s.cardHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.cardName, { color: colors.tx }]}>{card.name}</Text>
                    <Text style={[s.cardSub, { color: colors.mut }]}>
                      {[rifle?.name, load?.name].filter(Boolean).join(' · ') || 'No load linked'}
                    </Text>
                  </View>
                  {open ? <ChevronUp size={18} color={colors.fnt} /> : <ChevronDown size={18} color={colors.fnt} />}
                </TouchableOpacity>

                {/* Conditions are part of the card — a solution is only valid
                    for the atmosphere it was built in. */}
                <View style={s.condRow}>
                  {[
                    [Thermometer, o.tempF == null ? '—' : formatTemp(o.tempF, units.temp)],
                    [Gauge, units.distance === 'm'
                      ? (o.altitudeFt ? `${Math.round(o.altitudeFt * 0.3048)} m` : `${o.pressureInHg == null ? '—' : Math.round(o.pressureInHg * 33.8639)} hPa`)
                      : (o.altitudeFt ? `${o.altitudeFt} ft` : `${o.pressureInHg ?? '—'} inHg`)],
                    [Wind, units.velocity === 'm/s'
                      ? `${((o.windMph ?? 0) / 2.236936).toFixed(1)} m/s @ ${o.windAngleDeg ?? 90}°`
                      : `${o.windMph ?? 0} mph @ ${o.windAngleDeg ?? 90}°`],
                    [Mountain, `${formatDistance(o.zeroYd ?? 100, units.distance)} zero`],
                  ].map(([Icon, label], i) => (
                    <View key={i} style={[s.cond, { backgroundColor: colors.inset }]}>
                      <Icon size={12} color={colors.mut} />
                      <Text style={[s.condText, { color: colors.mut }]}>{label}</Text>
                    </View>
                  ))}
                </View>

                <Text style={[s.meta, { color: colors.fnt }]}>
                  {o.dragModel || 'G7'} BC {o.bc} · {formatVelocity(o.mvFps, units.velocity)} · {unit}
                </Text>

                {open && (
                  <>
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
                          {units.distance === 'm' ? Math.round(r.rangeYd * 0.9144) : r.rangeYd}<Text style={{ fontSize: 10, color: colors.fnt }}> {units.distance}</Text>
                        </Text>
                        <Text style={[s.td, { color: colors.act, fontWeight: '800' }]}>{r.elevation}</Text>
                        <Text style={[s.td, { color: colors.tx }]}>{r.wind}</Text>
                        <Text style={[s.td, { color: r.transonic ? colors.warnt : colors.mut }]}>{r.velFps}</Text>
                        <Text style={[s.td, { color: colors.mut, textAlign: 'right' }]}>{r.tofSec?.toFixed?.(2) ?? r.tofSec}</Text>
                      </View>
                    ))}
                  </>
                )}

                <View style={s.actions}>
                  <TouchableOpacity onPress={() => exportCard(card)} style={[s.actBtn, { backgroundColor: colors.acs }]}>
                    <Text style={[s.actText, { color: colors.act }]}>Export CSV</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => confirmDelete(card)} style={[s.actBtn, { backgroundColor: colors.dngs }]}>
                    <Trash2 size={14} color={colors.dngt} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  backBtn: { width: 38, height: 38, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },

  empty: { borderWidth: 1, borderRadius: 18, padding: 28, alignItems: 'center' },
  emptyIcon: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { fontSize: 16, fontWeight: '800', marginBottom: 6 },
  emptyText: { fontSize: 13, fontWeight: '500', textAlign: 'center', lineHeight: 19 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 11 },
  emptyBtnText: { fontSize: 13.5, fontWeight: '700' },

  card: { borderWidth: 1, borderRadius: 16, padding: 15, marginBottom: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardName: { fontSize: 15.5, fontWeight: '800' },
  cardSub: { fontSize: 12.5, fontWeight: '500', marginTop: 3 },
  condRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 11 },
  cond: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 9, borderRadius: 999 },
  condText: { fontSize: 11, fontWeight: '600' },
  meta: { fontSize: 11, fontWeight: '600', marginTop: 9, fontFamily: 'JetBrainsMono_500Medium' },

  tableHead: { flexDirection: 'row', paddingTop: 12, paddingBottom: 5, paddingHorizontal: 6 },
  th: { flex: 1, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.4 },
  tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 6, borderRadius: 7 },
  td: { flex: 1, fontSize: 12.5, fontWeight: '700', fontFamily: 'JetBrainsMono_700Bold' },

  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  actText: { fontSize: 12.5, fontWeight: '700' },
});
