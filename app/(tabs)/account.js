import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, User, ShieldCheck, Download, Settings, LogOut, Info, HardDrive, Trash2, UserX, RefreshCw } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../lib/theme';
import { useData } from '../../store/data';
import { initialsFrom } from '../../lib/profile';
import { useAuth } from '../../store/auth';
import { consentIsCurrent } from '../../lib/consent';
import { useState } from 'react';

/**
 * Account and data.
 *
 * The privacy section states what the app actually does rather than boilerplate:
 * nothing leaves the device, and target photos are never kept at all. Both are
 * true and checkable — the store writes to SQLite on device and localStorage on
 * web, there is no network client in the dependency list, and a saved target
 * holds only shot coordinates and the scale corners.
 *
 * The sign-in row says plainly that accounts are not connected yet. A screen
 * claiming to show "your profile" while the login form discards its input would
 * be worse than saying nothing.
 */
export default function AccountScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const {
    sessions, rifles, loads, dopeCards, projects, exportSessionsCSV,
    profileName, setProfile, clearAllData, deleteAccount, trainingConsent,
    signedIn, syncState, syncNow, exitLocalOnly,
  } = useData();

  const { configured, user, projectId, signOut, deleteAccountForever, busy, error } = useAuth();
  // Deleting a real account needs the password back, so it happens in a prompt
  // rather than a system confirm.
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [deleteNote, setDeleteNote] = useState(null);
  const back = () => (router.canGoBack?.() ? router.back() : router.replace('/'));
  const initials = initialsFrom(profileName);
  const total = sessions.length + rifles.length + loads.length + dopeCards.length + projects.length;

  /**
   * Both of these are irreversible and there is no server copy to restore from,
   * so each asks twice and the first prompt names exactly what goes. The web
   * branch mirrors the pattern already used for deleting a rifle: React
   * Native's Alert is a no-op under react-native-web.
   */
  const ask = (title, message, onYes) => {
    if (Platform.OS === 'web') { if (window.confirm(`${title}\n\n${message}`)) onYes(); }
    else Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onYes },
    ]);
  };

  const confirmErase = () => {
    if (total === 0) return;
    ask(
      'Erase all data?',
      `This removes ${sessions.length} session${sessions.length === 1 ? '' : 's'}, ` +
      `${rifles.length} rifle${rifles.length === 1 ? '' : 's'}, ${loads.length} load${loads.length === 1 ? '' : 's'}, ` +
      `${dopeCards.length} dope card${dopeCards.length === 1 ? '' : 's'} and ` +
      `${projects.length} load dev project${projects.length === 1 ? '' : 's'}. ` +
      'Your unit and appearance settings are kept. This cannot be undone.',
      () => ask('Are you sure?', 'There is no backup and no way to recover this.', () => {
        clearAllData();
        router.replace('/');
      })
    );
  };

  const confirmDeleteAccount = () => {
    // Signed in: the account itself has to go, not just this device's copy.
    // App Store guideline 5.1.1(v) treats a local wipe as not deleting at all.
    if (user) {
      setPassword('');
      setDeleteNote(null);
      setDeleting(true);
      return;
    }
    ask(
      'Delete account?',
      'No account is signed in, so there is nothing on a server to delete. ' +
      'This erases everything on this device — every session, rifle, load, dope card ' +
      'and load dev project, plus your settings — and returns you to the login screen.',
      () => ask('Delete everything?', 'This cannot be undone.', async () => {
        deleteAccount();
        await signOut();
        router.replace('/login');
      })
    );
  };

  const runDelete = async () => {
    setDeleteNote(null);
    const r = await deleteAccountForever(password);
    if (!r.ok) return;                       // error surfaces from useAuth
    deleteAccount();                          // wipe the device too
    setDeleting(false);
    router.replace('/login');
  };

  const counts = [
    ['Sessions', sessions.length],
    ['Rifles', rifles.length],
    ['Loads', loads.length],
    ['Dope cards', dopeCards.length],
    ['Load dev projects', projects.length],
  ];

  const Row = ({ icon: Icon, label, sub, onPress, tint }) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={onPress ? 0.7 : 1}
      style={[s.row, { backgroundColor: colors.card, borderColor: colors.bd }]}
    >
      <View style={[s.rowIcon, { backgroundColor: colors.inset }]}>
        <Icon size={18} color={tint || colors.act} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.rowLabel, { color: tint || colors.tx }]}>{label}</Text>
        {!!sub && <Text style={[s.rowSub, { color: colors.mut }]}>{sub}</Text>}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <TouchableOpacity
            onPress={back}
            style={[s.backBtn, { backgroundColor: colors.card, borderColor: colors.bd }]}
          >
            <ArrowLeft size={19} color={colors.tx} />
          </TouchableOpacity>
          <Text style={[s.title, { color: colors.tx }]}>Account</Text>
        </View>

        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.bd }]}>
          <View style={[s.avatar, { backgroundColor: colors.avb }]}>
            {initials
              ? <Text style={[s.avatarInitials, { color: colors.avt }]}>{initials}</Text>
              : <User size={22} color={colors.avt} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.sub, { color: colors.mut, marginTop: 0, marginBottom: 5 }]}>
              Display name — sets the initials in the corner
            </Text>
            <View style={[s.nameInput, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
              <TextInput
                value={profileName}
                onChangeText={setProfile}
                placeholder="Your name"
                placeholderTextColor={colors.fnt}
                style={[s.nameInputText, { color: colors.tx }]}
              />
            </View>
            <Text style={[s.sub, { color: colors.mut }]}>
              {user
                ? `Signed in as ${user.email}`
                : configured
                  ? 'Not signed in — sign in to use your account.'
                  : "This device isn't connected to an account, so the name is a local label."}
            </Text>
          </View>
        </View>

        <Text style={[s.section, { color: colors.mut }]}>YOUR DATA</Text>
        <View style={[s.countsCard, { backgroundColor: colors.card, borderColor: colors.bd }]}>
          {counts.map(([label, n]) => (
            <View key={label} style={s.countRow}>
              <Text style={[s.countLabel, { color: colors.mut }]}>{label}</Text>
              <Text style={[s.countVal, { color: colors.tx }]}>{n}</Text>
            </View>
          ))}
        </View>

        <Row
          icon={Download}
          label="Export sessions as CSV"
          sub="Every session, shot count and group size"
          onPress={() => exportSessionsCSV()}
        />
        <Row
          icon={Settings}
          label="Settings"
          sub="Units, appearance"
          onPress={() => router.push('/settings')}
        />

        {/* Whether the copy actually happened.
            Telling somebody their data is kept for them is a promise, and a
            promise with no way to check it is just a claim. This says when the
            last sync worked and what it moved - and says so plainly when it
            did not, because a shooter on a bay with no signal should know
            their groups are still only on the phone. */}
        {signedIn && (
          <>
            <Text style={[s.section, { color: colors.mut }]}>SYNC</Text>
            <TouchableOpacity
              onPress={syncNow}
              disabled={syncState.status === 'syncing'}
              style={[s.privacy, { backgroundColor: colors.inset, borderColor: colors.ibd }]}
            >
              <View style={s.privacyRow}>
                <RefreshCw size={17} color={syncState.status === 'error' ? colors.warnt : colors.act} />
                <Text style={[s.privacyText, { color: colors.tx }]}>
                  {syncState.status === 'syncing'
                    ? 'Syncing…'
                    : syncState.status === 'error'
                      ? `Not synced — ${syncState.reason === 'not-signed-in' ? 'you are signed out' : 'could not reach the server'}. Your data is safe on this phone and will go up next time. Tap to try now.`
                      : syncState.at
                        ? `Last synced ${new Date(syncState.at).toLocaleString()}`
                          + (syncState.pushed || syncState.pulled
                            ? ` — sent ${syncState.pushed}, received ${syncState.pulled}.`
                            // "nothing had changed" was the old wording, and it
                            // reads as reassurance in the one case that most
                            // needs not to: a fresh install against an account
                            // that has never received anything is also nothing
                            // to send. Same fact, without the comfort.
                            : ' — nothing to send; this phone and your account already match.')
                        : 'Not synced yet. Tap to sync now.'}
                </Text>
              </View>
            </TouchableOpacity>
          </>
        )}

        <Text style={[s.section, { color: colors.mut }]}>PRIVACY</Text>
        <View style={[s.privacy, { backgroundColor: colors.inset, borderColor: colors.ibd }]}>
          {/* Two different truths, and the screen has to tell the right one.
              This said "your data stays on this device... nothing is synced
              yet" for as long as that was true, and it stopped being true the
              moment an account became a boundary that follows you between
              phones. A privacy note that is out of date is worse than none,
              because it is the thing people read instead of asking. */}
          <View style={s.privacyRow}>
            <HardDrive size={17} color={colors.act} />
            <Text style={[s.privacyText, { color: colors.tx }]}>
              {signedIn
                ? `Your sessions, rifles, loads, dope cards and load development are stored on this device and copied to your account, so they reach your other devices and survive losing this one. Only you can read them.`
                : 'You are not signed in, so everything stays on this device and nothing is uploaded. It also means this phone holds the only copy — back it up from Settings, or sign in and it is kept for you.'}
            </Text>
          </View>
          <View style={s.privacyRow}>
            <ShieldCheck size={17} color={colors.act} />
            <Text style={[s.privacyText, { color: colors.tx }]}>
              {consentIsCurrent(trainingConsent)
                ? 'You have turned on contributing target photos to improve shot detection. Photos captured from now on may be uploaded for that purpose; photos taken before you turned it on are not. Turn it off any time in Settings.'
                : 'Target photos are never stored. A photo is used to measure the group and then discarded — a saved target keeps only the shot coordinates and the reference corners.'}
            </Text>
          </View>
          <View style={s.privacyRow}>
            <Info size={17} color={colors.mut} />
            <Text style={[s.privacyText, { color: colors.mut }]}>
              {signedIn
                ? 'Deleting the app leaves your account untouched — sign in on another phone and it is all there. Deleting the account itself removes the copy on the server as well, and cannot be undone.'
                : 'Deleting the app removes all of it. There is no copy on a server to restore from, and no way to recover it.'}
            </Text>
          </View>
        </View>

        <Row
          icon={LogOut}
          label="Sign out"
          sub={user ? `Signs out ${user.email}` : 'Returns to the login screen'}
          onPress={async () => { await signOut(); exitLocalOnly(); }}
        />

        <Text style={[s.section, { color: colors.mut }]}>DANGER ZONE</Text>
        {deleting && (
          <View style={[s.deleteBox, { backgroundColor: colors.dngs, borderColor: colors.dngt }]}>
            <Text style={[s.deleteTitle, { color: colors.dngt }]}>
              Permanently delete {user?.email}?
            </Text>
            <Text style={[s.deleteBody, { color: colors.dngt }]}>
              This deletes your account itself, not just this device. Every session,
              rifle, load, dope card and load dev project on this phone goes with it.
              It cannot be undone and there is no backup to restore from.
            </Text>
            <Text style={[s.deleteBody, { color: colors.dngt }]}>
              Enter your password to confirm.
            </Text>
            <View style={[s.nameInput, { backgroundColor: colors.input, borderColor: colors.ibd }]}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={colors.fnt}
                secureTextEntry
                style={[s.nameInputText, { color: colors.tx }]}
              />
            </View>
            {!!(error || deleteNote) && (
              <Text style={[s.deleteBody, { color: colors.dngt, fontWeight: '800' }]}>
                {error || deleteNote}
              </Text>
            )}
            <View style={{ flexDirection: 'row', gap: 9 }}>
              <TouchableOpacity
                onPress={() => { setDeleting(false); setPassword(''); }}
                style={[s.deleteBtn, { backgroundColor: colors.card, borderColor: colors.bd }]}
              >
                <Text style={[s.deleteBtnText, { color: colors.tx }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={runDelete}
                disabled={busy || !password}
                style={[s.deleteBtn, {
                  backgroundColor: colors.dngt,
                  borderColor: colors.dngt,
                  opacity: busy || !password ? 0.5 : 1,
                }]}
              >
                <Text style={[s.deleteBtnText, { color: '#fff' }]}>
                  {busy ? 'Deleting…' : 'Delete forever'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        <Row
          icon={Trash2}
          label="Erase all data"
          sub={total === 0
            ? 'Nothing recorded yet'
            : `Removes all ${total} recorded items. Settings are kept.`}
          tint={total === 0 ? colors.fnt : colors.dngt}
          onPress={total === 0 ? null : confirmErase}
        />
        <Row
          icon={UserX}
          label="Delete account"
          sub={user ? 'Permanently deletes your account' : 'Erases everything on this device, including settings'}
          tint={colors.dngt}
          onPress={confirmDeleteAccount}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  backBtn: { width: 38, height: 38, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  card: { flexDirection: 'row', gap: 14, alignItems: 'center', padding: 16, borderRadius: 14, borderWidth: 1 },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 16, fontWeight: '800' },
  avatarInitials: { fontWeight: '800', fontSize: 16 },
  deleteBox: { padding: 14, borderRadius: 14, borderWidth: 1, gap: 10 },
  deleteTitle: { fontSize: 14.5, fontWeight: '800' },
  deleteBody: { fontSize: 12, fontWeight: '600', lineHeight: 17 },
  deleteBtn: { flex: 1, paddingVertical: 11, borderRadius: 11, borderWidth: 1, alignItems: 'center' },
  deleteBtnText: { fontSize: 13, fontWeight: '800' },
  nameInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 11 },
  nameInputText: { paddingVertical: 8, fontSize: 14.5, fontWeight: '700' },
  sub: { fontSize: 12.5, fontWeight: '600', marginTop: 3, lineHeight: 17 },
  section: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, marginTop: 14, marginBottom: 2 },
  countsCard: { padding: 14, borderRadius: 14, borderWidth: 1, gap: 9 },
  countRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  countLabel: { fontSize: 13, fontWeight: '600' },
  countVal: { fontSize: 14, fontWeight: '800', fontFamily: 'JetBrainsMono_700Bold' },
  row: { flexDirection: 'row', gap: 13, alignItems: 'center', padding: 14, borderRadius: 14, borderWidth: 1 },
  rowIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 14.5, fontWeight: '700' },
  rowSub: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  privacy: { padding: 15, borderRadius: 14, borderWidth: 1, gap: 13 },
  privacyRow: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  privacyText: { flex: 1, fontSize: 12.5, fontWeight: '600', lineHeight: 18 },
});
