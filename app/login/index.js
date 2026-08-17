import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useTheme } from '../../lib/theme';
import { useAuth } from '../../store/auth';
import { useData } from '../../store/data';
import BrandMark from '../../components/BrandMark';

export default function LoginScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState(null);
  const { configured, projectId, user, ready, busy, error, clearError, signIn, signUp, resetPassword } = useAuth();
  const { chooseLocalOnly } = useData();
  const [localOpen, setLocalOpen] = useState(false);

  // A restored session should land on the app, not on this screen.
  useEffect(() => {
    // '/' rather than '/(tabs)'. A route group is a directory convention, not
    // a path segment - navigating to the group name did nothing, silently, so
    // signing in left the shooter looking at the login screen wondering
    // whether it had worked.
    if (ready && user) router.replace('/');
  }, [ready, user, router]);

  const submit = async () => {
    setNotice(null);
    // With no backend configured the app is local-only, which is a supported
    // mode rather than an error — going straight in is the honest behaviour.
    if (!configured) return router.replace('/');
    if (!email.trim() || !password) {
      setNotice('Enter an email and password.');
      return;
    }
    const r = creating ? await signUp(email, password) : await signIn(email, password);
    if (r.ok) router.replace('/');
  };

  const forgot = async () => {
    setNotice(null);
    if (!configured) return;
    if (!email.trim()) { setNotice('Enter your email first, then tap this again.'); return; }
    const r = await resetPassword(email);
    if (r.ok) setNotice('Password reset email sent.');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.content}>
          <View style={s.center}>
            <View style={s.logo}>
              <BrandMark size={76} radius={22} />
            </View>
            <Text style={[s.appName, { color: colors.tx }]}>Brass & Ballistics</Text>
            {/* Two jobs, so two lines. The first says what the app does, which
                a login screen owes somebody who has never opened it before.
                The second is the point of it: not the number on the box, what
                your rifle actually put on the paper. */}
            <Text style={[s.tagline, { color: colors.mut }]}>Measure groups. Track loads.{'\n'}Proof on paper.</Text>

            <View style={s.form}>
              <View>
                <Text style={[s.label, { color: colors.mut }]}>Email</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="shooter@precision.com"
                  placeholderTextColor={colors.fnt}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  style={[s.input, { backgroundColor: colors.input, borderColor: colors.ibd, color: colors.tx }]}
                />
              </View>
              <View>
                <Text style={[s.label, { color: colors.mut }]}>Password</Text>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor={colors.fnt}
                  secureTextEntry
                  style={[s.input, { backgroundColor: colors.input, borderColor: colors.ibd, color: colors.tx }]}
                />
              </View>
            </View>

            {(error || notice) && (
              <View style={[s.banner, { backgroundColor: error ? colors.dngs : colors.acs }]}>
                <Text style={[s.bannerText, { color: error ? colors.dngt : colors.act }]}>
                  {error || notice}
                </Text>
              </View>
            )}

            <TouchableOpacity onPress={submit} disabled={busy} style={[s.signIn, busy && { opacity: 0.6 }]}>
              {busy
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.signInText}>
                    {!configured ? 'Continue' : creating ? 'Create Account' : 'Sign In'}
                  </Text>}
            </TouchableOpacity>

            {configured && (
              <TouchableOpacity onPress={forgot} disabled={busy} style={s.forgotBtn}>
                <Text style={[s.forgotText, { color: colors.mut }]}>Forgot password?</Text>
              </TouchableOpacity>
            )}
          </View>

          {configured ? (
            <TouchableOpacity onPress={() => { clearError(); setNotice(null); setCreating(v => !v); }}>
              <Text style={[s.footer, { color: colors.fnt }]}>
                {creating ? 'Already have an account? ' : 'New here? '}
                <Text style={{ color: colors.act }}>{creating ? 'Sign in' : 'Create an account'}</Text>
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={[s.footer, { color: colors.fnt }]}>
              No account needed — this device isn't connected to an account, so
              everything stays local to it.
            </Text>
          )}

          {/* Folded away, because it was dominating the screen it is meant to
              be secondary to. Two taps rather than one: the first reveals what
              working without an account costs, the second accepts it. That
              keeps the choice an informed one - which was the whole point of
              the panel - without the explanation crowding out the sign-in form
              for everybody who was never going to pick it. */}
          {configured && (
            <View style={s.localWrap}>
              {!localOpen ? (
                <TouchableOpacity onPress={() => setLocalOpen(true)}>
                  <Text style={[s.localLink, { color: colors.fnt }]}>
                    Rather not make an account? <Text style={{ color: colors.act }}>Use it offline</Text>
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={[s.localBox, { borderColor: colors.bd }]}>
                  <Text style={[s.localBody, { color: colors.mut }]}>
                    Everything works without one. Your groups, loads and workups stay on this
                    phone — nothing is uploaded and nothing is shared. The cost is that they
                    stay on this phone: a new device, a lost phone or a reinstall starts
                    empty, and the only copy is whatever you back up from Settings yourself.
                  </Text>
                  <TouchableOpacity
                    onPress={chooseLocalOnly}
                    style={[s.localBtn, { borderColor: colors.bd }]}
                  >
                    <Text style={[s.localBtnText, { color: colors.mut }]}>Use without an account</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setLocalOpen(false)}>
                    <Text style={[s.localLink, { color: colors.fnt, marginTop: 10 }]}>Back to signing in</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  content: { flex: 1, padding: 26, paddingTop: 28, paddingBottom: 40 },
  banner: { width: '100%', padding: 11, borderRadius: 11, marginTop: 14 },
  bannerText: { fontSize: 12.5, fontWeight: '600', lineHeight: 17 },
  forgotBtn: { marginTop: 12, alignSelf: 'center' },
  forgotText: { fontSize: 12.5, fontWeight: '600' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  logo: {
    width: 76, height: 76, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    shadowColor: 'rgba(0,0,0,0.55)', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 1, shadowRadius: 24, elevation: 8,
    marginBottom: 22,
  },
  appName: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  tagline: { fontSize: 15, fontWeight: '500', lineHeight: 21, textAlign: 'center', marginTop: 6, marginBottom: 30 },
  form: { width: '100%', gap: 12 },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  input: { width: '100%', padding: 14, paddingHorizontal: 16, borderWidth: 1, borderRadius: 13, fontSize: 15 },
  localWrap: { marginTop: 22 },
  localLink: { fontSize: 12.5, textAlign: 'center', lineHeight: 18 },
  localBox: { borderWidth: 1, borderRadius: 14, padding: 16 },
  localBody: { fontSize: 12.5, lineHeight: 18 },
  localBtn: {
    borderWidth: 1, borderRadius: 11, paddingVertical: 12,
    alignItems: 'center', marginTop: 14,
  },
  localBtnText: { fontSize: 13, fontWeight: '700' },
  signIn: {
    width: '100%', marginTop: 22, padding: 16, borderRadius: 14, alignItems: 'center',
    backgroundColor: '#6D3BEB',
    shadowColor: 'rgba(109,59,235,0.55)', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 1, shadowRadius: 24, elevation: 6,
  },
  signInText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 12, fontWeight: '600' },
  apple: { width: '100%', padding: 14, borderRadius: 14, borderWidth: 1, alignItems: 'center' },
  appleText: { fontSize: 15, fontWeight: '600' },
  footer: { textAlign: 'center', fontSize: 12 },
});
