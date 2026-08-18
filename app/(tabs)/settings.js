import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal, TextInput, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Palette, Sparkles, Sun, Moon, SunMoon, Ruler, Thermometer, Gauge, FileDown, LogOut, ChevronRight, TriangleAlert, X, Save, Upload } from 'lucide-react-native';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useTheme } from '../../lib/theme';
import { CONSENT_SUMMARY, consentIsCurrent, consentNeedsRenewal, describeConsent } from '../../lib/consent';
import { useData } from '../../store/data';
import { useAuth } from '../../store/auth';
import { saveCSV } from '../../lib/export';
import { getErrors, clearErrors, subscribe, buildReport, recordError } from '../../lib/errorlog';
import { buildBackup, readBackup, describeRestore } from '../../lib/backup';
import { pickBackupText } from '../../lib/pickfile';
import Constants from 'expo-constants';

import { GROUP_UNITS, TEMP_UNITS, VELOCITY_UNITS, DISTANCE_UNITS } from '../../lib/units';

const UNIT_OPTIONS = {
  group: GROUP_UNITS,
  temp: TEMP_UNITS,
  velocity: VELOCITY_UNITS,
  distance: DISTANCE_UNITS,
};

export default function SettingsScreen() {
  const { colors, pref, choose, systemScheme } = useTheme();
  const { exportSessionsCSV, units, setUnit, trainingConsent, setTrainingConsent,
          snapshot, restoreBackup, exitLocalOnly } = useData();
  const consentOn = consentIsCurrent(trainingConsent);
  const needsRenewal = consentNeedsRenewal(trainingConsent);
  const router = useRouter();
  const { signOut, user } = useAuth();

  const [exporting, setExporting] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState('');
  // On by default when there is an address to give: a beta report nobody can
  // reply to is one that can only be counted.
  const [includeEmail, setIncludeEmail] = useState(true);
  const [errorCount, setErrorCount] = useState(getErrors().length);
  useEffect(() => subscribe(list => setErrorCount(list.length)), []);

  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [pending, setPending] = useState(null);

  const doBackup = async () => {
    setBackingUp(true);
    const text = buildBackup(snapshot(), { appVersion: Constants.expoConfig?.version });
    const stamp = new Date().toISOString().slice(0, 10);
    await saveCSV(text, `brass-ballistics-backup-${stamp}.json`, 'application/json');
    setBackingUp(false);
  };

  /**
   * Read a chosen file and describe it, without applying anything.
   *
   * Two steps on purpose: a restore replaces everything, so the shooter reads
   * what is in the file and what it will overwrite before it happens.
   */
  const pickRestore = async () => {
    setRestoring(true);
    try {
      const text = await pickBackupText();
      if (text == null) { setRestoring(false); return; }
      const parsed = readBackup(text);
      if (!parsed.ok) { setPending({ error: parsed.reason }); setRestoring(false); return; }
      setPending({
        parsed,
        summary: describeRestore(parsed.counts, snapshot()),
      });
    } catch (e) {
      recordError('restore', e);
      setPending({ error: `Could not read that file: ${e.message}` });
    }
    setRestoring(false);
  };

  const sendReport = async () => {
    const text = buildReport({
      note,
      contact: includeEmail ? (user?.email ?? null) : null,
      app: { version: Constants.expoConfig?.version, build: Constants.expoConfig?.ios?.buildNumber },
      device: { os: Platform.OS, osVersion: String(Platform.Version) },
    });
    await saveCSV(text, 'prs-problem-report.txt', 'text/plain');
    setReporting(false);
    setNote('');
  };

  const doExport = async () => {
    setExporting(true);
    await saveCSV(exportSessionsCSV(), 'prs-sessions.csv');
    setExporting(false);
  };

  // Cycles the stored preference, which every screen reads through
  // lib/units — these used to be local state that nothing else could see.
  const cycle = (kind) => {
    const opts = UNIT_OPTIONS[kind];
    const idx = opts.indexOf(units[kind]);
    setUnit(kind, opts[(idx + 1) % opts.length]);
  };

  const unitRows = [
    { icon: Ruler, label: 'Group size', value: units.group, onPress: () => cycle('group') },
    { icon: Thermometer, label: 'Temperature', value: units.temp, onPress: () => cycle('temp') },
    { icon: Gauge, label: 'Velocity', value: units.velocity, onPress: () => cycle('velocity') },
    { icon: Ruler, label: 'Distance', value: units.distance, onPress: () => cycle('distance') },
  ];

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
          <Text style={[s.title, { color: colors.tx }]}>Settings</Text>
        </View>

        <Text style={[s.sectionLabel, { color: colors.fnt }]}>APPEARANCE</Text>
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.bd }]}>
          <View style={s.themeHeader}>
            <View style={[s.themeIcon, { backgroundColor: colors.acs }]}>
              <Palette size={20} color={colors.act} />
            </View>
            <View>
              <Text style={[s.themeTitle, { color: colors.tx }]}>Theme</Text>
              <Text style={[s.themeSub, { color: colors.mut }]}>
                {pref === 'system'
                  ? `Following your device — currently ${systemScheme === 'dark' ? 'dark' : 'light'}`
                  : `Always ${pref}`}
              </Text>
            </View>
          </View>
          <View style={[s.segmented, { backgroundColor: colors.inset }]}>
            {[['system', 'Auto', SunMoon], ['light', 'Light', Sun], ['dark', 'Dark', Moon]].map(([k, label, Icon]) => {
              const on = pref === k;
              return (
                <TouchableOpacity
                  key={k}
                  onPress={() => choose(k)}
                  style={[s.seg, on && [s.segActive, { backgroundColor: colors.card }]]}
                >
                  <Icon size={16} color={on ? colors.tx : colors.mut} />
                  <Text style={[s.segText, { color: on ? colors.tx : colors.mut }]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <Text style={[s.sectionLabel, { color: colors.fnt, marginTop: 22 }]}>CONTRIBUTE</Text>
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.bd }]}>
          <View style={s.themeHeader}>
            <View style={[s.themeIcon, { backgroundColor: colors.acs }]}>
              <Sparkles size={18} color={colors.act} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.themeTitle, { color: colors.tx }]}>{CONSENT_SUMMARY}</Text>
              <Text style={[s.themeSub, { color: colors.mut }]}>
                {describeConsent(trainingConsent)}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            onPress={() => setTrainingConsent(!consentOn)}
            style={[s.consentBtn, {
              backgroundColor: consentOn ? colors.oks : colors.inset,
              borderColor: consentOn ? colors.okt : colors.ibd,
            }]}
          >
            <Text style={[s.consentBtnText, { color: consentOn ? colors.okt : colors.act }]}>
              {consentOn ? 'Contributing — tap to stop'
                : needsRenewal ? 'Review and turn back on'
                : 'Turn on'}
            </Text>
          </TouchableOpacity>

          <Text style={[s.consentDetail, { color: colors.fnt }]}>
            Only the target photo, the shot positions and aim point you marked, the
            reference corners and the caliber are sent. Your name, email, rifles,
            loads and notes are not. Camera metadata including any GPS location is
            already stripped from every photo before it is used.
          </Text>
          <Text style={[s.consentDetail, { color: colors.fnt }]}>
            Photos already captured are never included — only ones taken while this
            is on. Every feature works the same either way.
          </Text>
        </View>

        <Text style={[s.sectionLabel, { color: colors.fnt, marginTop: 22 }]}>UNITS</Text>
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.bd, padding: 0, overflow: 'hidden' }]}>
          {unitRows.map((u, i) => (
            <TouchableOpacity key={i} onPress={u.onPress} style={[s.unitRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}>
              <u.icon size={19} color={colors.mut} />
              <Text style={[s.unitLabel, { color: colors.tx }]}>{u.label}</Text>
              <View style={[s.unitBadge, { backgroundColor: colors.acs }]}>
                <Text style={[s.unitValue, { color: colors.act }]}>{u.value}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[s.sectionLabel, { color: colors.fnt, marginTop: 22 }]}>DATA</Text>
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.bd, padding: 0, overflow: 'hidden' }]}>
          <TouchableOpacity onPress={doExport} disabled={exporting} style={s.dataRow}>
            <FileDown size={19} color={colors.mut} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[s.dataLabel, { color: colors.tx }]}>
                {exporting ? 'Exporting…' : 'Export sessions (CSV)'}
              </Text>
              {/* Said plainly, because it was described as a backup and is not.
                  A shooter who lost their phone and reached for this file
                  would find out at the worst possible moment. */}
              <Text style={[s.dataSub, { color: colors.fnt }]}>
                A summary per session, for a spreadsheet. Not a backup — no shots or scale.
              </Text>
            </View>
            <ChevronRight size={18} color={colors.fnt} />
          </TouchableOpacity>

          <TouchableOpacity onPress={doBackup} disabled={backingUp} style={[s.dataRow, { borderTopWidth: 1, borderTopColor: colors.bd }]}>
            <Save size={19} color={colors.mut} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[s.dataLabel, { color: colors.tx }]}>
                {backingUp ? 'Backing up…' : 'Back up everything'}
              </Text>
              <Text style={[s.dataSub, { color: colors.fnt }]}>
                Every shot, aim point and scale, plus equipment and load development.
              </Text>
            </View>
            <ChevronRight size={18} color={colors.fnt} />
          </TouchableOpacity>

          <TouchableOpacity onPress={pickRestore} disabled={restoring} style={[s.dataRow, { borderTopWidth: 1, borderTopColor: colors.bd }]}>
            <Upload size={19} color={colors.mut} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[s.dataLabel, { color: colors.tx }]}>
                {restoring ? 'Reading…' : 'Restore from a backup'}
              </Text>
              <Text style={[s.dataSub, { color: colors.fnt }]}>
                Replaces what is on this device. You will be told what, first.
              </Text>
            </View>
            <ChevronRight size={18} color={colors.fnt} />
          </TouchableOpacity>
        </View>

        {/* The other half of the error boundary.
            Catching an error is worth nothing during a beta if the tester has
            no way to hand it over, and the app deliberately ships no crash
            reporter. What the app uploads is the shooter's own shooting data
            to their own account, which they chose by signing in; a crash SDK
            posting stack traces and device identifiers to a third party is a
            different thing entirely and not one anybody asked for. So
            the report is built locally, shown in full, and sent only if the
            shooter presses send. */}
        <Text style={[s.sectionLabel, { color: colors.fnt, marginTop: 22 }]}>HELP</Text>
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.bd, padding: 0, overflow: 'hidden' }]}>
          <TouchableOpacity onPress={() => setReporting(true)} style={s.dataRow}>
            <TriangleAlert size={19} color={colors.mut} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[s.dataLabel, { color: colors.tx }]}>Report a problem</Text>
              {errorCount > 0 && (
                <Text style={[s.dataSub, { color: colors.warnt }]}>
                  {errorCount} error{errorCount === 1 ? '' : 's'} recorded this session
                </Text>
              )}
            </View>
            <ChevronRight size={18} color={colors.fnt} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={async () => { await signOut(); exitLocalOnly(); }}
          style={[s.signOut, { backgroundColor: colors.dngs }]}
        >
          <LogOut size={18} color={colors.dngt} />
          <Text style={[s.signOutText, { color: colors.dngt }]}>Sign Out</Text>
        </TouchableOpacity>

        <Text style={[s.version, { color: colors.fnt }]}>Brass & Ballistics · v1.0.0</Text>
      </ScrollView>

      {/* The confirmation. A restore replaces everything, so it is shown as a
          sentence about what will be lost as well as what arrives - "restore
          12 sessions" is only the half nobody regrets. */}
      <Modal visible={!!pending} transparent animationType="fade" onRequestClose={() => setPending(null)}>
        <View style={s.overlay}>
          <View style={[s.sheet, { backgroundColor: colors.bg }]}>
            <View style={s.sheetHead}>
              <Text style={[s.sheetTitle, { color: colors.tx }]}>
                {pending?.error ? 'That file cannot be restored' : 'Restore this backup?'}
              </Text>
              <TouchableOpacity onPress={() => setPending(null)} hitSlop={10}>
                <X size={22} color={colors.mut} />
              </TouchableOpacity>
            </View>

            {pending?.error ? (
              <Text style={[s.reportBody, { color: colors.dngt }]}>{pending.error}</Text>
            ) : (
              <>
                <Text style={[s.reportBody, { color: colors.tx }]}>{pending?.summary}</Text>
                {!!pending?.parsed?.createdAt && (
                  <Text style={[s.dataSub, { color: colors.fnt }]}>
                    Made {new Date(pending.parsed.createdAt).toLocaleString()}
                    {pending.parsed.app ? ` by v${pending.parsed.app}` : ''}
                  </Text>
                )}
                <Text style={[s.reportBody, { color: colors.mut, marginTop: 10 }]}>
                  This cannot be undone. If there is anything on this device you have not
                  backed up, close this and back it up first.
                </Text>
                <TouchableOpacity
                  onPress={async () => {
                    const data = pending.parsed.data;
                    setPending(null);
                    await restoreBackup(data);
                  }}
                  style={[s.reportBtn, { backgroundColor: colors.dngs, borderColor: colors.dngt }]}>
                  <Text style={[s.reportBtnText, { color: colors.dngt }]}>Replace everything and restore</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity onPress={() => setPending(null)} style={s.reportClear}>
              <Text style={[s.reportClearText, { color: colors.mut }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={reporting} transparent animationType="slide" onRequestClose={() => setReporting(false)}>
        <View style={s.overlay}>
          <View style={[s.sheet, { backgroundColor: colors.bg }]}>
            <View style={s.sheetHead}>
              <Text style={[s.sheetTitle, { color: colors.tx }]}>Report a problem</Text>
              <TouchableOpacity onPress={() => setReporting(false)} hitSlop={10}>
                <X size={22} color={colors.mut} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
              <Text style={[s.reportBody, { color: colors.mut }]}>
                This builds a text file and hands it to the share sheet. Nothing is sent
                anywhere on its own, and you can read the whole thing first. No target
                photographs, session data or account details are included.
              </Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                multiline
                placeholder="What were you doing when it went wrong?"
                placeholderTextColor={colors.fnt}
                style={[s.reportInput, { backgroundColor: colors.input, borderColor: colors.ibd, color: colors.tx }]}
              />
              {user?.email ? (
                <TouchableOpacity onPress={() => setIncludeEmail(v => !v)}
                  style={[s.emailRow, {
                    borderColor: includeEmail ? colors.act : colors.bd,
                    backgroundColor: includeEmail ? colors.acs : 'transparent',
                  }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[s.dataLabel, { color: includeEmail ? colors.act : colors.tx }]}>
                      Include {user.email}
                    </Text>
                    <Text style={[s.dataSub, { color: colors.fnt }]}>
                      So the report can be answered rather than only counted.
                    </Text>
                  </View>
                  <Text style={[s.fxToggleText, { color: includeEmail ? colors.act : colors.fnt }]}>
                    {includeEmail ? 'ON' : 'OFF'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text style={[s.dataSub, { color: colors.fnt, marginTop: 12 }]}>
                  You are not signed in, so this report carries no way to reply to you. Sign in
                  from More if you would like a response.
                </Text>
              )}

              <Text style={[s.sectionLabel, { color: colors.fnt, marginTop: 16 }]}>WHAT WILL BE SENT</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Text style={[s.reportPreview, { color: colors.mut }]} selectable>
                  {buildReport({
                    note,
                    contact: includeEmail ? (user?.email ?? null) : null,
                    app: { version: Constants.expoConfig?.version },
                    device: { os: Platform.OS, osVersion: String(Platform.Version) },
                  })}
                </Text>
              </ScrollView>
              <TouchableOpacity onPress={sendReport}
                style={[s.reportBtn, { backgroundColor: colors.acs, borderColor: colors.act }]}>
                <Text style={[s.reportBtnText, { color: colors.act }]}>Save and share the report</Text>
              </TouchableOpacity>
              {errorCount > 0 && (
                <TouchableOpacity onPress={() => clearErrors()} style={s.reportClear}>
                  <Text style={[s.reportClearText, { color: colors.mut }]}>Clear recorded errors</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  backBtn: { width: 38, height: 38, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  consentBtn: { paddingVertical: 11, borderRadius: 11, borderWidth: 1, alignItems: 'center', marginTop: 12 },
  consentBtnText: { fontSize: 13, fontWeight: '800' },
  consentDetail: { fontSize: 11.5, fontWeight: '600', lineHeight: 16.5, marginTop: 9 },
  sectionLabel: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16 },
  themeHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  themeIcon: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  themeTitle: { fontSize: 15, fontWeight: '700' },
  themeSub: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  segmented: { flexDirection: 'row', gap: 6, borderRadius: 13, padding: 5 },
  seg: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 9 },
  segActive: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.12, shadowRadius: 3, elevation: 2 },
  segText: { fontSize: 14, fontWeight: '700' },
  unitRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  unitLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  unitBadge: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999 },
  unitValue: { fontSize: 13, fontWeight: '700' },
  dataRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15, paddingHorizontal: 16 },
  dataSub: { fontSize: 11.5, marginTop: 2 },
  emailRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: 11, padding: 12, marginTop: 12,
  },
  fxToggleText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '88%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '800', flex: 1, minWidth: 0 },
  reportBody: { fontSize: 12.5, lineHeight: 18, marginBottom: 12 },
  reportInput: {
    borderWidth: 1, borderRadius: 11, padding: 12, minHeight: 84,
    fontSize: 13, textAlignVertical: 'top',
  },
  reportPreview: { fontSize: 10.5, lineHeight: 15, fontFamily: 'JetBrainsMono_500Medium' },
  reportBtn: { borderWidth: 1, borderRadius: 11, paddingVertical: 13, alignItems: 'center', marginTop: 16 },
  reportBtnText: { fontSize: 13, fontWeight: '800' },
  reportClear: { alignItems: 'center', paddingVertical: 12 },
  reportClearText: { fontSize: 12, fontWeight: '600' },
  dataLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  signOut: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 22, borderRadius: 14, padding: 15 },
  signOutText: { fontSize: 15, fontWeight: '700' },
  version: { textAlign: 'center', fontSize: 11, fontWeight: '600', marginTop: 16 },
});
