import { View, Text, TouchableOpacity, Pressable, StyleSheet, Platform, Modal, Animated, PanResponder } from 'react-native';
import { Wind, FlaskConical, Wrench, Settings, LogOut, ChevronRight, BookOpen, Crosshair } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useRef, useEffect } from 'react';
import { useTheme } from '../lib/theme';
import { useAuth } from '../store/auth';
import { useData } from '../store/data';

const items = [
  { icon: Wind, label: 'Ballistics', sub: 'Dope card & drops', route: '/ballistics' },
  { icon: BookOpen, label: 'Dope Cards', sub: 'Saved solutions', route: '/dopecards' },
  { icon: FlaskConical, label: 'Load Development', sub: '8-step reloading wizard', route: '/reloading' },
  { icon: Wrench, label: 'Equipment', sub: 'Rifles & loads', route: '/equipment' },
  { icon: Crosshair, label: 'Scope Evaluation', sub: 'Tracking & return to zero', route: '/scope' },
  { icon: Settings, label: 'Settings', sub: 'Units, export, appearance', route: '/settings' },
];

/**
 * The More sheet.
 *
 * Rendered inside a Modal rather than as a sibling of the navigator. As a
 * sibling it relied on zIndex, which Android ignores in favour of elevation —
 * and the tab bar became an elevated absolute pill, so it could sit on top of
 * the sheet and swallow the taps meant to dismiss it. A Modal is always above
 * native content and does not compete.
 *
 * Dismissal has three routes now, because it previously had one that could be
 * blocked: drag the sheet down, tap outside it, or press back on Android. A
 * sheet with a grab handle that cannot be grabbed reads as broken even when
 * tapping outside would have worked.
 */
export default function MoreSheet({ visible, onClose }) {
  const { colors } = useTheme();
  const { user, signOut } = useAuth();
  const { exitLocalOnly } = useData();
  const router = useRouter();
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) translateY.setValue(0);
  }, [visible, translateY]);

  const close = () => {
    // Animate out rather than vanishing, so the gesture feels connected to the
    // result.
    Animated.timing(translateY, { toValue: 600, duration: 180, useNativeDriver: true })
      .start(({ finished }) => { if (finished) onClose(); });
  };

  const pan = useRef(
    PanResponder.create({
      // Only claim the gesture once it is clearly a downward drag, or the rows
      // underneath stop being tappable.
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        // Far enough, or fast enough — a flick should dismiss without needing
        // the full distance.
        if (g.dy > 90 || g.vy > 0.8) {
          Animated.timing(translateY, { toValue: 600, duration: 160, useNativeDriver: true })
            .start(({ finished }) => { if (finished) onClose(); });
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
        }
      },
    })
  ).current;

  if (!visible) return null;

  const go = (route) => {
    onClose();
    router.push(route);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}   // Android hardware back
      statusBarTranslucent
    >
      <View style={s.overlay}>
        <Pressable style={s.backdrop} onPress={close} />
        <Animated.View
          style={[
            s.sheet,
            {
              backgroundColor: colors.bg,
              borderTopLeftRadius: 26,
              borderTopRightRadius: 26,
              transform: [{ translateY }],
            },
          ]}
          {...pan.panHandlers}
        >
          {/* Generous hit area around the handle: the visible bar is 5px tall,
              which is far below a comfortable touch target. */}
          <View style={s.handleArea}>
            <View style={[s.handle, { backgroundColor: colors.bd }]} />
          </View>

          <Text style={[s.title, { color: colors.tx }]}>More</Text>
          <View style={s.list}>
            {items.map((item) => (
              <TouchableOpacity key={item.route} onPress={() => go(item.route)} style={[s.row, { backgroundColor: colors.card, borderColor: colors.bd }]}>
                <View style={[s.iconWrap, { backgroundColor: colors.acs }]}>
                  <item.icon size={20} color={colors.act} />
                </View>
                <View style={s.mid}>
                  <Text style={[s.label, { color: colors.tx }]}>{item.label}</Text>
                  <Text style={[s.sub, { color: colors.mut }]}>{item.sub}</Text>
                </View>
                <ChevronRight size={18} color={colors.fnt} />
              </TouchableOpacity>
            ))}
            {/* This said Sign Out and only navigated to the login screen - it
                never signed anybody out. It looked like it worked because the
                login screen sends a signed-in user away again, so the shooter
                landed back on the dashboard still signed in, which reads as
                "it went back home".

                It also has to say the right thing: somebody working offline is
                not signed in, so offering to sign them out is nonsense. For
                them it is the way *in*. */}
            <TouchableOpacity
              onPress={async () => {
                onClose();
                if (user) await signOut();
                // Clears local-only as well, so the gate asks again rather than
                // waving through a session that has just been ended.
                exitLocalOnly();
              }}
              style={[s.row, { backgroundColor: colors.card, borderColor: colors.bd }]}
            >
              <View style={[s.iconWrap, { backgroundColor: user ? colors.dngs : colors.acs }]}>
                <LogOut size={20} color={user ? colors.dngt : colors.act} />
              </View>
              <View style={s.mid}>
                <Text style={[s.label, { color: user ? colors.dngt : colors.act }]}>
                  {user ? 'Sign Out' : 'Sign In'}
                </Text>
                <Text style={[s.sub, { color: colors.mut }]}>
                  {user ? user.email : 'Keep your data across devices'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={close} style={[s.closeBtn, { borderColor: colors.bd }]}>
            <Text style={[s.closeText, { color: colors.mut }]}>Close</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11,11,16,0.45)' },
  sheet: { paddingHorizontal: 20, paddingBottom: Platform.OS === 'ios' ? 40 : 30 },
  handleArea: { paddingTop: 10, paddingBottom: 12, alignItems: 'center' },
  handle: { width: 42, height: 5, borderRadius: 99 },
  title: { fontSize: 17, fontWeight: '800', marginBottom: 12 },
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderRadius: 15, padding: 15 },
  iconWrap: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1 },
  label: { fontSize: 15, fontWeight: '700' },
  sub: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  closeBtn: { marginTop: 12, paddingVertical: 12, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  closeText: { fontSize: 14, fontWeight: '700' },
});
