import { View, Text, ScrollView, TouchableOpacity, TextInput, Modal, StyleSheet, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, Crosshair, ChevronRight, X, Trash2, Check, ArrowLeft } from 'lucide-react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useTheme } from '../../lib/theme';
import { useData } from '../../store/data';
import { totalRounds, lifeStatus } from '../../lib/barrel';
import { COMMON_FASTENERS, TORQUE_UNITS, newEntry, cleanEntries, checkTorque, fmtBoth } from '../../lib/torque';

const EMPTY_RIFLE = { name: '', cartridge: '', barrelLength: '', twist: '', notes: '', priorRounds: '', torque: [] };
const EMPTY_LOAD = { rifleId: '', bullet: '', powder: '', chargeGr: '', primer: '', brass: '', coalOrCbto: '', velocityFps: '', name: '', caliber: '', sd: '', powderLot: '', primerLot: '', bulletLot: '', brassLot: '' };

/**
 * Coerce a stored row into form state. Persisted rows hold numbers and may omit
 * optional fields; TextInput needs every bound value to be a defined string, or
 * React flips the input from controlled to uncontrolled mid-edit.
 */
function toFormState(template, row) {
  const out = { ...template };
  for (const key of Object.keys(template)) {
    const v = row[key];
    out[key] = v == null ? '' : String(v);
  }
  return { ...out, id: row.id };
}

function FormField({ label, value, onChangeText, placeholder, colors, keyboardType }) {
  return (
    <View style={s.field}>
      <Text style={[s.fieldLabel, { color: colors.mut }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.fnt}
        keyboardType={keyboardType}
        style={[s.fieldInput, { backgroundColor: colors.input, borderColor: colors.ibd, color: colors.tx }]}
      />
    </View>
  );
}

export default function EquipmentScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { rifles, loads, sessions, addRifle, updateRifle, deleteRifle, addLoad, updateLoad, deleteLoad } = useData();
  const [rifleModal, setRifleModal] = useState(null);
  const [loadModal, setLoadModal] = useState(null);

  const openAddRifle = () => setRifleModal({ ...EMPTY_RIFLE, _isNew: true });
  const openEditRifle = (r) => setRifleModal({ ...toFormState(EMPTY_RIFLE, r), _isNew: false });
  const openAddLoad = () => setLoadModal({ ...EMPTY_LOAD, _isNew: true, rifleId: rifles[0]?.id || '' });
  const openEditLoad = (l) => setLoadModal({ ...toFormState(EMPTY_LOAD, l), _isNew: false });

  const saveRifle = () => {
    if (!rifleModal.name.trim()) return;
    if (rifleModal._isNew) {
      addRifle({ name: rifleModal.name, cartridge: rifleModal.cartridge, barrelLength: rifleModal.barrelLength, twist: rifleModal.twist, notes: rifleModal.notes, priorRounds: Number(rifleModal.priorRounds) || 0, torque: cleanEntries(rifleModal.torque) });
    } else {
      updateRifle(rifleModal.id, { name: rifleModal.name, cartridge: rifleModal.cartridge, barrelLength: rifleModal.barrelLength, twist: rifleModal.twist, notes: rifleModal.notes, priorRounds: Number(rifleModal.priorRounds) || 0, torque: cleanEntries(rifleModal.torque) });
    }
    setRifleModal(null);
  };

  const confirmDeleteRifle = () => {
    const doDelete = () => { deleteRifle(rifleModal.id); setRifleModal(null); };
    if (Platform.OS === 'web') { if (confirm('Delete this rifle?')) doDelete(); }
    else Alert.alert('Delete Rifle', 'Are you sure?', [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: doDelete }]);
  };

  const saveLoad = () => {
    if (!loadModal.bullet.trim() || !loadModal.powder.trim()) return;
    const data = {
      rifleId: loadModal.rifleId, bullet: loadModal.bullet, powder: loadModal.powder,
      chargeGr: parseFloat(loadModal.chargeGr) || 0, primer: loadModal.primer, brass: loadModal.brass,
      coalOrCbto: parseFloat(loadModal.coalOrCbto) || 0, velocityFps: parseInt(loadModal.velocityFps) || 0,
      name: `${loadModal.bullet} / ${loadModal.powder}`, caliber: loadModal.caliber || '',
      sd: parseFloat(loadModal.sd) || 0,
    };
    if (loadModal._isNew) addLoad(data);
    else updateLoad(loadModal.id, data);
    setLoadModal(null);
  };

  const confirmDeleteLoad = () => {
    const doDelete = () => { deleteLoad(loadModal.id); setLoadModal(null); };
    if (Platform.OS === 'web') { if (confirm('Delete this load?')) doDelete(); }
    else Alert.alert('Delete Load', 'Are you sure?', [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: doDelete }]);
  };

  const updateRifleField = (field, val) => setRifleModal(prev => ({ ...prev, [field]: val }));
  const updateLoadField = (field, val) => setLoadModal(prev => ({ ...prev, [field]: val }));

  const addTorque = (name) =>
    setRifleModal(prev => ({ ...prev, torque: [...(prev.torque || []), newEntry(name)] }));
  const updateTorque = (i, patch) =>
    setRifleModal(prev => ({
      ...prev,
      torque: (prev.torque || []).map((t, j) => (j === i ? { ...t, ...patch } : t)),
    }));
  const removeTorque = (i) =>
    setRifleModal(prev => ({ ...prev, torque: (prev.torque || []).filter((_, j) => j !== i) }));

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
          <Text style={[s.title, { color: colors.tx }]}>Equipment</Text>
        </View>

        <View style={s.sectionHeader}>
          <Text style={[s.sectionTitle, { color: colors.tx }]}>RIFLES</Text>
          <TouchableOpacity onPress={openAddRifle} style={s.addBtn}>
            <Plus size={15} color={colors.act} />
            <Text style={[s.addText, { color: colors.act }]}>Add</Text>
          </TouchableOpacity>
        </View>

        {rifles.length === 0 ? (
          <View style={[s.emptyCard, { backgroundColor: colors.card, borderColor: colors.bd }]}>
            <Crosshair size={28} color={colors.fnt} />
            <Text style={[s.emptyText, { color: colors.mut }]}>No rifles yet</Text>
            <TouchableOpacity onPress={openAddRifle} style={[s.emptyBtn, { backgroundColor: colors.acs }]}>
              <Text style={[s.emptyBtnText, { color: colors.act }]}>Add your first rifle</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.list}>
            {rifles.map((r) => (
              <TouchableOpacity key={r.id} onPress={() => openEditRifle(r)} style={[s.rifleRow, { backgroundColor: colors.card, borderColor: colors.bd }]}>
                <View style={[s.iconWrap, { backgroundColor: colors.acs }]}>
                  <Crosshair size={21} color={colors.act} />
                </View>
                <View style={s.mid}>
                  <Text style={[s.name, { color: colors.tx }]}>{r.name}</Text>
                  <Text style={[s.spec, { color: colors.mut }]}>{r.cartridge} · {r.barrelLength} {r.twist ? `· ${r.twist}` : ''}</Text>
                  {(() => {
                    const rc = totalRounds(sessions, r.id, r.priorRounds);
                    if (rc.total === 0) return null;
                    const life = lifeStatus(rc.total, r.cartridge);
                    const tint = life.stage === 'past' ? colors.dngt
                      : life.stage === 'approaching' ? colors.warnt : colors.mut;
                    return (
                      <Text style={[s.spec, { color: tint, marginTop: 3 }]}>
                        {rc.total} rounds
                        {rc.prior ? ` (${rc.logged} logged + ${rc.prior} prior)` : ''}
                        {life.est ? ` · est. life ${life.est.low}–${life.est.high}` : ''}
                      </Text>
                    );
                  })()}
                </View>
                <ChevronRight size={18} color={colors.fnt} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={[s.sectionHeader, { marginTop: 24 }]}>
          <Text style={[s.sectionTitle, { color: colors.tx }]}>LOADS</Text>
          <TouchableOpacity onPress={openAddLoad} style={s.addBtn}>
            <Plus size={15} color={colors.act} />
            <Text style={[s.addText, { color: colors.act }]}>Add</Text>
          </TouchableOpacity>
        </View>

        {loads.length === 0 ? (
          <View style={[s.emptyCard, { backgroundColor: colors.card, borderColor: colors.bd }]}>
            <Text style={[s.emptyText, { color: colors.mut }]}>No loads yet</Text>
            <TouchableOpacity onPress={openAddLoad} style={[s.emptyBtn, { backgroundColor: colors.acs }]}>
              <Text style={[s.emptyBtnText, { color: colors.act }]}>Add your first load</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.list}>
            {loads.map((l) => (
              <TouchableOpacity key={l.id} onPress={() => openEditLoad(l)} style={[s.loadRow, { backgroundColor: colors.card, borderColor: colors.bd }]}>
                <View style={s.loadHeader}>
                  <Text style={[s.name, { color: colors.tx }]}>{l.name}</Text>
                  <View style={[s.calBadge, { backgroundColor: colors.acs }]}>
                    <Text style={[s.calText, { color: colors.act }]}>{l.caliber}</Text>
                  </View>
                </View>
                <View style={s.loadStats}>
                  <View>
                    <Text style={[s.loadStatVal, { color: colors.tx }]}>{l.chargeGr}gr</Text>
                    <Text style={[s.loadStatLabel, { color: colors.fnt }]}>CHARGE</Text>
                  </View>
                  <View>
                    <Text style={[s.loadStatVal, { color: colors.tx }]}>{l.velocityFps}</Text>
                    <Text style={[s.loadStatLabel, { color: colors.fnt }]}>MV</Text>
                  </View>
                  <View>
                    <Text style={[s.loadStatVal, { color: colors.tx }]}>{l.sd}</Text>
                    <Text style={[s.loadStatLabel, { color: colors.fnt }]}>SD</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Rifle Modal */}
      {/* Body is gated on the state object, not just Modal's visible prop:
          React Native Web keeps Modal children mounted when visible flips to
          false, so on save/delete the fields re-rendered once with value
          undefined and React flipped every input controlled -> uncontrolled. */}
      <Modal visible={rifleModal !== null} transparent animationType="slide">
        {rifleModal && (
          <View style={s.modalOverlay}>
            <View style={[s.modalContent, { backgroundColor: colors.bg }]}>
              <View style={s.modalHeader}>
                <Text style={[s.modalTitle, { color: colors.tx }]}>{rifleModal._isNew ? 'Add Rifle' : 'Edit Rifle'}</Text>
                <TouchableOpacity onPress={() => setRifleModal(null)}><X size={22} color={colors.mut} /></TouchableOpacity>
              </View>
              <ScrollView style={s.modalScroll} showsVerticalScrollIndicator={false}>
                <FormField label="Name" value={rifleModal.name} onChangeText={v => updateRifleField('name', v)} placeholder="e.g. Impact 737R" colors={colors} />
                <FormField label="Cartridge" value={rifleModal.cartridge} onChangeText={v => updateRifleField('cartridge', v)} placeholder="e.g. 6.5 Creedmoor" colors={colors} />
                <FormField label="Barrel Length" value={rifleModal.barrelLength} onChangeText={v => updateRifleField('barrelLength', v)} placeholder={'e.g. 26"'} colors={colors} />
                <FormField label="Twist Rate" value={rifleModal.twist} onChangeText={v => updateRifleField('twist', v)} placeholder="e.g. 1:8" colors={colors} />
                <FormField label="Rounds before this app" value={String(rifleModal.priorRounds ?? '')} onChangeText={v => updateRifleField('priorRounds', v)} placeholder="e.g. 1200" colors={colors} keyboardType="number-pad" />
                <FormField label="Notes" value={rifleModal.notes} onChangeText={v => updateRifleField('notes', v)} placeholder="Optional" colors={colors} />

                {/* Torque figures, all of them the shooter's own.
                    No defaults ship with the app: over-torquing a ring crushes
                    a tube and under-torquing an action screw moves the zero
                    between strings, and the only figure worth having is the one
                    from whoever made the part. */}
                <Text style={[s.torqueHead, { color: colors.mut }]}>TORQUE</Text>
                <Text style={[s.torqueIntro, { color: colors.fnt }]}>
                  Your own figures, from the manufacturer of each part. Nothing here is
                  filled in for you, because a wrong torque value damages a rifle.
                </Text>

                {(rifleModal.torque || []).map((t, i) => {
                  const v = checkTorque(t.value, t.unit);
                  return (
                    <View key={t.id || i} style={[s.torqueRow, { borderColor: colors.ibd }]}>
                      <View style={s.torqueTop}>
                        <TextInput
                          value={t.name}
                          onChangeText={x => updateTorque(i, { name: x })}
                          placeholder="Fastener"
                          placeholderTextColor={colors.fnt}
                          style={[s.torqueName, { color: colors.tx, backgroundColor: colors.input, borderColor: colors.ibd }]}
                        />
                        <TouchableOpacity onPress={() => removeTorque(i)} style={s.torqueDel}>
                          <Trash2 size={15} color={colors.fnt} />
                        </TouchableOpacity>
                      </View>
                      <View style={s.torqueBottom}>
                        <TextInput
                          value={String(t.value ?? '')}
                          onChangeText={x => updateTorque(i, { value: x })}
                          placeholder="Value"
                          placeholderTextColor={colors.fnt}
                          keyboardType="decimal-pad"
                          style={[s.torqueVal, { color: colors.tx, backgroundColor: colors.input, borderColor: colors.ibd }]}
                        />
                        {TORQUE_UNITS.map(u => (
                          <TouchableOpacity
                            key={u}
                            onPress={() => updateTorque(i, { unit: u })}
                            style={[s.torqueUnit, {
                              backgroundColor: t.unit === u ? colors.act : colors.input,
                              borderColor: t.unit === u ? colors.act : colors.ibd,
                            }]}
                          >
                            <Text style={[s.torqueUnitText, { color: t.unit === u ? '#fff' : colors.mut }]}>{u}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      {v.text && (
                        <Text style={[s.torqueWarn, { color: v.ok ? colors.warnt : colors.dngt }]}>{v.text}</Text>
                      )}
                      {v.level === 'ok' && (
                        <Text style={[s.torqueBoth, { color: colors.fnt }]}>{fmtBoth(t.value, t.unit)}</Text>
                      )}
                    </View>
                  );
                })}

                <View style={s.torqueAddRow}>
                  {COMMON_FASTENERS
                    .filter(f => !(rifleModal.torque || []).some(t => t.name === f))
                    .map(f => (
                      <TouchableOpacity
                        key={f}
                        onPress={() => addTorque(f)}
                        style={[s.torqueChip, { borderColor: colors.ibd }]}
                      >
                        <Plus size={11} color={colors.act} />
                        <Text style={[s.torqueChipText, { color: colors.act }]}>{f}</Text>
                      </TouchableOpacity>
                    ))}
                  <TouchableOpacity onPress={() => addTorque('')} style={[s.torqueChip, { borderColor: colors.ibd }]}>
                    <Plus size={11} color={colors.act} />
                    <Text style={[s.torqueChipText, { color: colors.act }]}>Something else</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
              <View style={s.modalActions}>
                {!rifleModal._isNew && (
                  <TouchableOpacity onPress={confirmDeleteRifle} style={[s.deleteBtn, { backgroundColor: colors.dngs }]}>
                    <Trash2 size={17} color={colors.dngt} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={saveRifle} style={[s.saveBtn, { opacity: rifleModal.name?.trim() ? 1 : 0.4 }]}>
                  <Check size={17} color="#fff" />
                  <Text style={s.saveBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </Modal>

      {/* Load Modal */}
      <Modal visible={loadModal !== null} transparent animationType="slide">
        {loadModal && (
          <View style={s.modalOverlay}>
            <View style={[s.modalContent, { backgroundColor: colors.bg }]}>
              <View style={s.modalHeader}>
                <Text style={[s.modalTitle, { color: colors.tx }]}>{loadModal._isNew ? 'Add Load' : 'Edit Load'}</Text>
                <TouchableOpacity onPress={() => setLoadModal(null)}><X size={22} color={colors.mut} /></TouchableOpacity>
              </View>
              <ScrollView style={s.modalScroll} showsVerticalScrollIndicator={false}>
                <View style={s.field}>
                  <Text style={[s.fieldLabel, { color: colors.mut }]}>Rifle</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {rifles.map(r => (
                        <TouchableOpacity key={r.id} onPress={() => updateLoadField('rifleId', r.id)}
                          style={[s.chipBtn, { backgroundColor: loadModal.rifleId === r.id ? colors.act : colors.inset, borderColor: loadModal.rifleId === r.id ? colors.act : colors.ibd }]}>
                          <Text style={[s.chipText, { color: loadModal.rifleId === r.id ? '#fff' : colors.tx }]}>{r.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>
                <FormField label="Caliber" value={loadModal.caliber} onChangeText={v => updateLoadField('caliber', v)} placeholder="e.g. 6.5 CM" colors={colors} />
                <FormField label="Bullet" value={loadModal.bullet} onChangeText={v => updateLoadField('bullet', v)} placeholder="e.g. 140 Hybrid" colors={colors} />
                <FormField label="Powder" value={loadModal.powder} onChangeText={v => updateLoadField('powder', v)} placeholder="e.g. H4350" colors={colors} />
                <FormField label="Charge (gr)" value={loadModal.chargeGr} onChangeText={v => updateLoadField('chargeGr', v)} placeholder="e.g. 41.8" colors={colors} keyboardType="decimal-pad" />
                <FormField label="Primer" value={loadModal.primer} onChangeText={v => updateLoadField('primer', v)} placeholder="e.g. Fed 210M" colors={colors} />
                <FormField label="Brass" value={loadModal.brass} onChangeText={v => updateLoadField('brass', v)} placeholder="e.g. Lapua" colors={colors} />
                <FormField label="COAL / CBTO" value={loadModal.coalOrCbto} onChangeText={v => updateLoadField('coalOrCbto', v)} placeholder="e.g. 2.825" colors={colors} keyboardType="decimal-pad" />
                <Text style={[s.lotHeading, { color: colors.mut }]}>LOT NUMBERS</Text>
                <Text style={[s.lotHint, { color: colors.fnt }]}>
                  Components vary batch to batch. Recording lots is what makes a velocity shift attributable later.
                </Text>
                <FormField label="Powder lot" value={loadModal.powderLot} onChangeText={v => updateLoadField('powderLot', v)} placeholder="Optional" colors={colors} />
                <FormField label="Primer lot" value={loadModal.primerLot} onChangeText={v => updateLoadField('primerLot', v)} placeholder="Optional" colors={colors} />
                <FormField label="Bullet lot" value={loadModal.bulletLot} onChangeText={v => updateLoadField('bulletLot', v)} placeholder="Optional" colors={colors} />
                <FormField label="Brass lot" value={loadModal.brassLot} onChangeText={v => updateLoadField('brassLot', v)} placeholder="Optional" colors={colors} />
                <FormField label="Velocity (fps)" value={loadModal.velocityFps} onChangeText={v => updateLoadField('velocityFps', v)} placeholder="e.g. 2820" colors={colors} keyboardType="number-pad" />
                <FormField label="SD (fps)" value={loadModal.sd} onChangeText={v => updateLoadField('sd', v)} placeholder="e.g. 8.4" colors={colors} keyboardType="decimal-pad" />
              </ScrollView>
              <View style={s.modalActions}>
                {!loadModal._isNew && (
                  <TouchableOpacity onPress={confirmDeleteLoad} style={[s.deleteBtn, { backgroundColor: colors.dngs }]}>
                    <Trash2 size={17} color={colors.dngt} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={saveLoad} style={[s.saveBtn, { opacity: (loadModal.bullet?.trim() && loadModal.powder?.trim()) ? 1 : 0.4 }]}>
                  <Check size={17} color="#fff" />
                  <Text style={s.saveBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  torqueHead: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginTop: 20, marginBottom: 4 },
  torqueIntro: { fontSize: 11.5, fontWeight: '600', lineHeight: 16, marginBottom: 10 },
  torqueRow: { borderWidth: 1, borderRadius: 11, padding: 10, marginBottom: 8, gap: 8 },
  torqueTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  torqueName: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 9, fontSize: 14, fontWeight: '600' },
  torqueDel: { padding: 6 },
  torqueBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  torqueVal: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 9, fontSize: 14, fontFamily: 'JetBrainsMono_700Bold' },
  torqueUnit: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, borderWidth: 1 },
  torqueUnitText: { fontSize: 12, fontWeight: '700' },
  torqueWarn: { fontSize: 11.5, fontWeight: '600', lineHeight: 16 },
  torqueBoth: { fontSize: 11, fontWeight: '600', fontFamily: 'JetBrainsMono_500Medium' },
  torqueAddRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  torqueChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7 },
  torqueChipText: { fontSize: 11.5, fontWeight: '700' },
  scroll: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  backBtn: { width: 38, height: 38, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 14, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  addText: { fontSize: 13, fontWeight: '700' },
  list: { gap: 10 },
  rifleRow: { flexDirection: 'row', alignItems: 'center', gap: 13, borderWidth: 1, borderRadius: 16, padding: 15 },
  iconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '700' },
  lotHeading: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, marginTop: 8 },
  lotHint: { fontSize: 11.5, fontWeight: '600', lineHeight: 16, marginTop: -4, marginBottom: 2 },
  spec: { fontSize: 12, fontWeight: '500', marginTop: 3 },
  loadRow: { borderWidth: 1, borderRadius: 16, padding: 15 },
  loadHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  calBadge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  calText: { fontSize: 11, fontWeight: '700' },
  loadStats: { flexDirection: 'row', gap: 16, marginTop: 11 },
  loadStatVal: { fontSize: 14, fontWeight: '700', fontFamily: 'JetBrainsMono_700Bold' },
  loadStatLabel: { fontSize: 10, fontWeight: '600', marginTop: 1 },
  emptyCard: { borderWidth: 1, borderRadius: 16, padding: 30, alignItems: 'center', gap: 10 },
  emptyText: { fontSize: 14, fontWeight: '600' },
  emptyBtn: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 12, marginTop: 4 },
  emptyBtnText: { fontSize: 13, fontWeight: '700' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  modalContent: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 20, paddingHorizontal: 20, paddingBottom: 34, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  modalTitle: { fontSize: 18, fontWeight: '800' },
  modalScroll: { marginBottom: 16 },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
  fieldInput: { borderWidth: 1, borderRadius: 12, padding: 13, paddingHorizontal: 15, fontSize: 15 },
  chipBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14 },
  chipText: { fontSize: 13, fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: 10 },
  deleteBtn: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  saveBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#6D3BEB', height: 48, borderRadius: 14 },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
