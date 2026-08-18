import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Crosshair, ChevronRight } from 'lucide-react-native';
import { useTheme, groupColor } from '../lib/theme';

export default function SessionRow({
  bestLabelText, name, date, rifle, meta, best, onPress }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} style={[s.row, { backgroundColor: colors.card, borderColor: colors.bd }]}>
      <View style={[s.iconWrap, { backgroundColor: colors.acs }]}>
        <Crosshair size={21} color={colors.act} />
      </View>
      <View style={s.mid}>
        <Text numberOfLines={1} style={[s.name, { color: colors.tx }]}>{name}</Text>
        {date && <Text style={[s.sub, { color: colors.mut }]}>{date}{rifle ? ` · ${rifle}` : ''}</Text>}
        {meta && <Text style={[s.meta, { color: colors.fnt }]}>{meta}</Text>}
      </View>
      <View style={s.right}>
        <Text style={[s.best, { color: groupColor(best, colors), fontFamily: 'JetBrainsMono_700Bold' }]}>{bestLabelText}</Text>
        <Text style={[s.bestLabel, { color: colors.fnt }]}>best</Text>
      </View>
      <ChevronRight size={17} color={colors.fnt} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderRadius: 16, padding: 15 },
  iconWrap: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1, minWidth: 0 },
  name: { fontSize: 14.5, fontWeight: '700' },
  sub: { fontSize: 12, fontWeight: '500', marginTop: 3 },
  meta: { fontSize: 11.5, fontWeight: '600', marginTop: 2 },
  right: { alignItems: 'flex-end', marginRight: 4 },
  best: { fontSize: 16 },
  bestLabel: { fontSize: 10, fontWeight: '600', marginTop: 2 },
});
