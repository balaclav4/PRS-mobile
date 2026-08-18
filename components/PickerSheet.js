import { View, Text, TextInput, TouchableOpacity, Modal, FlatList, StyleSheet } from 'react-native';
import { Search, X, Check } from 'lucide-react-native';
import { useState, useMemo } from 'react';
import { useTheme } from '../lib/theme';

/**
 * Searchable single-select list.
 *
 * A horizontal chip row stops working once there are more than a handful of
 * options — which is the normal case for loads and sessions after a season of
 * shooting. FlatList keeps it usable at any length, and the search box makes
 * a long list navigable without scrolling through it.
 *
 * @param options [{ key, label, sub, meta }]
 * @param disabledKey option that can't be picked (the other side of a compare)
 */
export default function PickerSheet({
  visible, title, options, selectedKey, disabledKey, onSelect, onClose,
}) {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o =>
      o.label.toLowerCase().includes(q) || (o.sub || '').toLowerCase().includes(q));
  }, [options, query]);

  const close = () => { setQuery(''); onClose(); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      {visible && (
        <View style={s.overlay}>
          <View style={[s.sheet, { backgroundColor: colors.bg }]}>
            <View style={s.header}>
              <Text style={[s.title, { color: colors.tx }]}>{title}</Text>
              <TouchableOpacity onPress={close}><X size={22} color={colors.mut} /></TouchableOpacity>
            </View>

            <View style={[s.searchRow, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
              <Search size={17} color={colors.fnt} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search"
                placeholderTextColor={colors.fnt}
                style={[s.searchInput, { color: colors.tx }]}
                autoCorrect={false}
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery('')}>
                  <X size={16} color={colors.fnt} />
                </TouchableOpacity>
              )}
            </View>

            <FlatList
              data={filtered}
              keyExtractor={(o) => o.key}
              keyboardShouldPersistTaps="handled"
              style={s.list}
              ListEmptyComponent={
                <Text style={[s.empty, { color: colors.mut }]}>Nothing matches “{query}”.</Text>
              }
              renderItem={({ item }) => {
                const selected = item.key === selectedKey;
                const disabled = item.key === disabledKey;
                return (
                  <TouchableOpacity
                    disabled={disabled}
                    onPress={() => { onSelect(item.key); close(); }}
                    style={[s.row, {
                      backgroundColor: selected ? colors.acs : colors.card,
                      borderColor: selected ? colors.act : colors.bd,
                      opacity: disabled ? 0.4 : 1,
                    }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[s.rowLabel, { color: selected ? colors.act : colors.tx }]} numberOfLines={1}>
                        {item.label}
                      </Text>
                      {!!item.sub && (
                        <Text style={[s.rowSub, { color: colors.mut }]} numberOfLines={1}>
                          {item.sub}{disabled ? ' · already selected' : ''}
                        </Text>
                      )}
                    </View>
                    {!!item.meta && (
                      <Text style={[s.rowMeta, { color: colors.fnt }]}>{item.meta}</Text>
                    )}
                    {selected && <Check size={18} color={colors.act} />}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      )}
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(11,11,16,0.45)' },
  sheet: { maxHeight: '80%', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 28 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { fontSize: 18, fontWeight: '800' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13 },
  // minWidth 0 so the field can shrink inside its row. A web <input> carries
  // a default size of 20 characters and a flex item will not shrink below its
  // intrinsic content width, so without this the box overflows and whatever
  // sits beside it is pushed out of view. That is how the distance unit went
  // missing: 'yd' was rendered every time, in a 215px input inside a 163px box.
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 12, fontSize: 15 },
  list: { marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 13, padding: 14, marginBottom: 8 },
  rowLabel: { fontSize: 15, fontWeight: '700' },
  rowSub: { fontSize: 12, fontWeight: '500', marginTop: 3 },
  rowMeta: { fontSize: 12, fontWeight: '700', fontFamily: 'JetBrainsMono_700Bold' },
  empty: { fontSize: 13, fontWeight: '600', textAlign: 'center', paddingVertical: 24 },
});
