import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import { X, Check, Info } from 'lucide-react-native';
import { useState, useMemo } from 'react';
import { useTheme } from '../lib/theme';
import { parseVelocities, velocityStats, sdConfidenceNote } from '../lib/chrono';
import { formatVelocity } from '../lib/units';
import { useData } from '../store/data';

/**
 * Paste a chronograph string and import its velocity statistics.
 *
 * The parse is shown before it is committed — which values were kept, which
 * were discarded, and what they work out to. Silently importing a
 * misinterpreted paste would put a wrong SD in front of load decisions.
 */
export default function ChronoImport({ visible, onClose, onImport }) {
  const { units } = useData();
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const [unit, setUnit] = useState('fps');

  const { velocities, rejected } = useMemo(() => parseVelocities(text, unit), [text, unit]);
  const stats = useMemo(() => velocityStats(velocities), [velocities]);
  const caveat = sdConfidenceNote(stats, units.velocity);

  const close = () => { setText(''); setUnit('fps'); onClose(); };
  const commit = () => { onImport({ velocities, stats }); close(); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      {visible && (
        <View style={s.overlay}>
          <View style={[s.sheet, { backgroundColor: colors.bg }]}>
            <View style={s.header}>
              <Text style={[s.title, { color: colors.tx }]}>Import Chrono String</Text>
              <TouchableOpacity onPress={close}><X size={22} color={colors.mut} /></TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={[s.hint, { color: colors.mut }]}>
                Paste from your chronograph app — one per line, comma separated, or
                CSV with shot numbers. Headers and shot indices are ignored.
              </Text>

              <View style={[s.segmented, { backgroundColor: colors.inset }]}>
                {[['fps', 'fps'], ['mps', 'm/s']].map(([k, label]) => (
                  <TouchableOpacity key={k} onPress={() => setUnit(k)}
                    style={[s.seg, unit === k && { backgroundColor: colors.card }]}>
                    <Text style={[s.segText, { color: unit === k ? colors.tx : colors.mut }]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TextInput
                value={text}
                onChangeText={setText}
                multiline
                placeholder={'2905\n2912\n2898\n2921\n2903'}
                placeholderTextColor={colors.fnt}
                style={[s.textArea, { backgroundColor: colors.input, borderColor: colors.ibd, color: colors.tx }]}
              />

              {text.trim().length > 0 && (
                stats ? (
                  <>
                    <View style={[s.statGrid, { borderColor: colors.line }]}>
                      {[
                        ['SHOTS', String(stats.n)],
                        ['AVG', formatVelocity(stats.mean, units.velocity)],
                        ['SD', stats.sd == null ? '—' : formatVelocity(stats.sd, units.velocity)],
                        ['ES', formatVelocity(stats.es, units.velocity)],
                      ].map(([label, val], i) => (
                        <View key={i} style={[s.statCell, { backgroundColor: colors.card, borderColor: colors.bd }]}>
                          <Text style={[s.statLabel, { color: colors.mut }]}>{label}</Text>
                          <Text style={[s.statVal, { color: colors.tx }]}>{val}</Text>
                        </View>
                      ))}
                    </View>

                    <Text style={[s.parsed, { color: colors.fnt }]} numberOfLines={3}>
                      Keeping {stats.n}: {velocities.join(', ')}
                      {rejected.length > 0 && `\nIgnored ${rejected.length}: ${rejected.slice(0, 12).join(', ')}${rejected.length > 12 ? '…' : ''}`}
                    </Text>

                    {caveat && (
                      <View style={[s.caveat, { backgroundColor: colors.warns }]}>
                        <Info size={16} color={colors.warnt} style={{ marginTop: 1 }} />
                        <Text style={[s.caveatText, { color: colors.warnt }]}>{caveat}</Text>
                      </View>
                    )}
                  </>
                ) : (
                  <View style={[s.caveat, { backgroundColor: colors.inset }]}>
                    <Info size={16} color={colors.mut} style={{ marginTop: 1 }} />
                    <Text style={[s.caveatText, { color: colors.mut }]}>
                      No velocities found in that text{unit === 'fps' ? ' — if these are m/s, switch the unit above.' : '.'}
                    </Text>
                  </View>
                )
              )}
            </ScrollView>

            <TouchableOpacity
              onPress={commit}
              disabled={!stats}
              style={[s.importBtn, { opacity: stats ? 1 : 0.4 }]}
            >
              <Check size={17} color="#fff" />
              <Text style={s.importBtnText}>
                {stats ? `Import ${stats.n} shot${stats.n === 1 ? '' : 's'}` : 'Import'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(11,11,16,0.45)' },
  sheet: { maxHeight: '88%', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 26 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 18, fontWeight: '800' },
  hint: { fontSize: 12.5, fontWeight: '500', lineHeight: 18, marginBottom: 12 },
  segmented: { flexDirection: 'row', gap: 4, borderRadius: 11, padding: 4, marginBottom: 12 },
  seg: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  segText: { fontSize: 13, fontWeight: '700' },
  textArea: { borderWidth: 1, borderRadius: 12, padding: 13, fontSize: 14, minHeight: 120, textAlignVertical: 'top', fontFamily: 'JetBrainsMono_500Medium' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  statCell: { flexGrow: 1, flexBasis: '46%', borderWidth: 1, borderRadius: 12, padding: 12 },
  statLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4 },
  statVal: { fontSize: 17, fontWeight: '700', marginTop: 4, fontFamily: 'JetBrainsMono_700Bold' },
  parsed: { fontSize: 11, fontWeight: '600', lineHeight: 16, marginTop: 10 },
  caveat: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', padding: 12, borderRadius: 11, marginTop: 12 },
  caveatText: { flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 17 },
  importBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#6D3BEB', padding: 15, borderRadius: 14, marginTop: 14 },
  importBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
