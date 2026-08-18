import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Target, TrendingUp, Crosshair, Camera, Wind, FlaskConical, BookOpen, User, ChevronRight } from 'lucide-react-native';
import { initialsFrom } from '../../lib/profile';
import { useRouter } from 'expo-router';
import { useTheme, groupColor } from '../../lib/theme';
import { useData } from '../../store/data';
import { formatGroup, groupUnitLabel } from '../../lib/units';
import { LinearGradient } from '../../components/Gradient';

/**
 * Step names, so the dashboard can say where a workup stopped rather than
 * printing a bare number. Kept in step order and short enough for one line.
 * The reloading screen owns the full metadata; this is only the labels.
 */
const LOADDEV_STEPS = ['Goal', 'Screen', 'Max Chg', 'Accuracy', 'Primers', 'Ladder', 'Seating', 'Ref'];

export default function HomeScreen() {
  const { colors } = useTheme();
  const { sessions, rifles, projects, dopeCards, units, getRifleName, profileName,
          loadDemo } = useData();
  const initials = initialsFrom(profileName);
  const router = useRouter();

  const recent = sessions.slice(0, 3);
  const bestSession = sessions.reduce((best, s) => {
    const v = parseFloat(s.best);
    if (!isFinite(v)) return best;
    return !best || v < parseFloat(best.best) ? s : best;
  }, null);
  const bestGroup = bestSession ? parseFloat(bestSession.best) : Infinity;

  /**
   * The typical group, not the luckiest one.
   *
   * "Best group" was the headline here, and it is the minimum over every
   * session on file. A minimum only ever falls, never reverts, and drifts down
   * with nothing but the number of groups shot - so it describes the best day
   * anyone has had rather than what the rifle does. It is the exact statistic
   * lib/seating corrects for with a best-of-k expectation, headlined
   * uncorrected on the first screen of the app.
   *
   * The median is used rather than the mean because group size is right-skewed:
   * one called flyer drags a mean up and leaves the median where it belongs.
   * The best is kept, demoted to a personal record on the tile it belongs to.
   */
  const typicalGroup = (() => {
    const vals = sessions
      .map(sn => parseFloat(sn.best))
      .filter(v => isFinite(v) && v > 0)
      .sort((a, b) => a - b);
    if (!vals.length) return null;
    const mid = vals.length >> 1;
    return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  })();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <View>
            <Text style={[s.welcome, { color: colors.mut }]}>Welcome back</Text>
            <Text style={[s.title, { color: colors.tx }]}>Dashboard</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/account')}
            activeOpacity={0.7}
            accessibilityLabel="Account, data and privacy"
            style={[s.avatar, { backgroundColor: colors.avb }]}
          >
            {initials
              ? <Text style={[s.avatarText, { color: colors.avt }]}>{initials}</Text>
              : <User size={19} color={colors.avt} />}
          </TouchableOpacity>
        </View>

        {/* Shown until there is something to shoot with, and no longer.
            Gating it on "have we asked" meant it hung around after the shooter
            had already got started, and needed a dismiss button to get rid of -
            a control whose only job was to admit the card had outstayed its
            welcome. Gating it on having a rifle makes it self-clearing: add
            one, or load the demo set, and it goes. */}
        {rifles.length === 0 && (
          <View style={[s.firstRun, { backgroundColor: colors.card, borderColor: colors.act }]}>
            <Text style={[s.firstRunTitle, { color: colors.tx }]}>Start with your own gear?</Text>
            <Text style={[s.firstRunBody, { color: colors.mut }]}>
              Nothing is set up yet. Add the rifle you shoot and the load you shoot in it, or
              load a demo set to look around first — it can be cleared from Settings.
            </Text>
            <View style={s.firstRunRow}>
              <TouchableOpacity onPress={() => router.push('/equipment')}
                style={[s.firstRunBtn, { backgroundColor: colors.act, borderColor: colors.act }]}>
                <Text style={[s.firstRunBtnText, { color: '#fff' }]}>Add equipment</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={loadDemo}
                style={[s.firstRunBtn, { borderColor: colors.bd }]}>
                <Text style={[s.firstRunBtnText, { color: colors.mut }]}>Load demo data</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <TouchableOpacity
          onPress={() => router.push('/capture')}
          activeOpacity={0.9}
          style={s.heroCard}
        >
          <View style={s.heroCircle1} />
          <View style={s.heroCircle2} />
          <Text style={s.heroSub}>READY TO SHOOT</Text>
          <Text style={s.heroTitle}>Capture your next group</Text>
          <View style={s.heroBtn}>
            <Camera size={17} color="#5A2FD0" />
            <Text style={s.heroBtnText}>New Session</Text>
          </View>
        </TouchableOpacity>

        {/* Each tile navigates to the screen that explains its number. Best
            Group jumps straight to the session that set it. */}
        <View style={s.statsRow}>
          <TouchableOpacity
            onPress={() => router.push('/sessions')}
            style={[s.statTile, { backgroundColor: colors.card, borderColor: colors.bd }]}
          >
            <Target size={20} color={colors.act} />
            <Text style={[s.statVal, { color: colors.tx }]}>{sessions.length}</Text>
            <Text style={[s.statLabel, { color: colors.mut }]}>Sessions</Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={!bestSession}
            onPress={() => bestSession && router.push(`/session/${bestSession.id}`)}
            style={[s.statTile, { backgroundColor: colors.card, borderColor: colors.bd }]}
          >
            <TrendingUp size={20} color="#15A34A" />
            <Text style={[s.statVal, { color: colors.tx }]}>
              {typicalGroup != null && bestSession
                ? formatGroup(typicalGroup, bestSession.distanceYd, units.group, { withUnit: false })
                : '—'}
            </Text>
            <Text style={[s.statLabel, { color: colors.mut }]}>Typical Group ({groupUnitLabel(units.group)})</Text>
            {typicalGroup != null && bestSession && (
              <Text style={[s.statSub, { color: colors.fnt }]}>
                best {formatGroup(bestGroup, bestSession.distanceYd, units.group, { withUnit: false })}
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/equipment')}
            style={[s.statTile, { backgroundColor: colors.card, borderColor: colors.bd }]}
          >
            <Crosshair size={20} color="#D97706" />
            <Text style={[s.statVal, { color: colors.tx }]}>{rifles.length}</Text>
            <Text style={[s.statLabel, { color: colors.mut }]}>Rifles</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/dopecards')}
            style={[s.statTile, { backgroundColor: colors.card, borderColor: colors.bd }]}
          >
            <BookOpen size={20} color="#0EA5E9" />
            <Text style={[s.statVal, { color: colors.tx }]}>{dopeCards.length}</Text>
            <Text style={[s.statLabel, { color: colors.mut }]}>Dope Cards</Text>
          </TouchableOpacity>
        </View>

        <View style={s.sectionHeader}>
          <Text style={[s.sectionTitle, { color: colors.tx }]}>Recent Sessions</Text>
          <TouchableOpacity onPress={() => router.push('/sessions')}>
            <Text style={[s.seeAll, { color: colors.act }]}>See all</Text>
          </TouchableOpacity>
        </View>

        <View style={s.recentList}>
          {recent.length === 0 ? (
            <View style={[s.emptyCard, { backgroundColor: colors.card, borderColor: colors.bd }]}>
              <Target size={28} color={colors.fnt} />
              <Text style={[s.emptyText, { color: colors.mut }]}>No sessions yet</Text>
              <Text style={[s.emptyHint, { color: colors.fnt }]}>Tap the capture button to record your first group</Text>
            </View>
          ) : recent.map((sess) => (
            <TouchableOpacity
              key={sess.id}
              onPress={() => router.push(`/session/${sess.id}`)}
              style={[s.recentRow, { backgroundColor: colors.card, borderColor: colors.bd }]}
            >
              <View style={[s.recentIcon, { backgroundColor: colors.acs }]}>
                <Crosshair size={20} color={colors.act} />
              </View>
              <View style={s.recentMid}>
                <Text numberOfLines={1} style={[s.recentName, { color: colors.tx }]}>{sess.name}</Text>
                <Text style={[s.recentMeta, { color: colors.mut }]}>{sess.date} · {getRifleName(sess.rifleId)}</Text>
              </View>
              <View style={s.recentRight}>
                <Text style={[s.recentBest, { color: groupColor(sess.best, colors), fontFamily: 'JetBrainsMono_700Bold' }]}>
                  {formatGroup(parseFloat(sess.best), sess.distanceYd, units.group)}
                </Text>
                <Text style={[s.recentBestLabel, { color: colors.fnt }]}>best</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.quickLinks}>
          <TouchableOpacity onPress={() => router.push('/ballistics')} style={[s.quickCard, { backgroundColor: colors.card, borderColor: colors.bd }]}>
            <Wind size={22} color={colors.act} style={{ marginBottom: 10 }} />
            <Text style={[s.quickTitle, { color: colors.tx }]}>Ballistics</Text>
            <Text style={[s.quickSub, { color: colors.mut }]}>Dope card & drops</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/reloading')} style={[s.quickCard, { backgroundColor: colors.card, borderColor: colors.bd }]}>
            <FlaskConical size={22} color={colors.act} style={{ marginBottom: 10 }} />
            <Text style={[s.quickTitle, { color: colors.tx }]}>Load Dev</Text>
            <Text style={[s.quickSub, { color: colors.mut }]}>
              {projects?.length
                ? `${projects.length} in progress`
                : 'No project yet'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Every workup, not just the first.
            The card above used to name projects[0] and nothing else, so a
            second one was invisible from here and easy to forget entirely -
            which is exactly what happens to a workup left half-finished over a
            winter. Each row says where it stopped, because "step 6 of 8" is the
            thing you need to remember and the thing you never do. */}
        {!!projects?.length && (
          <>
            <Text style={[s.sectionTitle, { color: colors.tx, marginTop: 24 }]}>In Progress</Text>
            {projects.map(p => {
              const done = Math.max(0, Math.min(8, (p.currentStep || 1) - 1));
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => router.push({ pathname: '/reloading', params: { projectId: p.id } })}
                  style={[s.devRow, { backgroundColor: colors.card, borderColor: colors.bd }]}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[s.devName, { color: colors.tx }]} numberOfLines={1}>{p.name}</Text>
                    <Text style={[s.devSub, { color: colors.mut }]} numberOfLines={1}>
                      {[getRifleName?.(p.rifleId), `Step ${p.currentStep || 1} of 8 — ${LOADDEV_STEPS[(p.currentStep || 1) - 1] || ''}`]
                        .filter(Boolean).join(' · ')}
                    </Text>
                    {/* Eight steps, eight ticks. A bar would imply the steps are
                        equal in effort, which they are not; discrete marks just
                        say how far along it is. */}
                    <View style={s.devTicks}>
                      {LOADDEV_STEPS.map((_, i) => (
                        <View key={i} style={[s.devTick, {
                          backgroundColor: i < done ? colors.act
                            : i === done ? colors.warnt : colors.ring,
                        }]} />
                      ))}
                    </View>
                  </View>
                  <ChevronRight size={18} color={colors.mut} />
                </TouchableOpacity>
              );
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  welcome: { fontSize: 13, fontWeight: '600' },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4, marginTop: 2 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '800', fontSize: 15 },
  heroCard: {
    borderRadius: 22, padding: 22, overflow: 'hidden', position: 'relative',
    backgroundColor: '#6D3BEB',
    shadowColor: 'rgba(90,47,208,0.6)', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 1, shadowRadius: 36, elevation: 8,
  },
  heroCircle1: { position: 'absolute', right: -30, top: -30, width: 150, height: 150, borderRadius: 75, borderWidth: 2, borderColor: 'rgba(255,255,255,0.14)' },
  heroCircle2: { position: 'absolute', right: 6, top: 6, width: 78, height: 78, borderRadius: 39, borderWidth: 2, borderColor: 'rgba(255,255,255,0.12)' },
  heroSub: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.8)', letterSpacing: 0.3 },
  heroTitle: { fontSize: 22, fontWeight: '800', color: '#fff', lineHeight: 28, maxWidth: 220, marginTop: 8, marginBottom: 16 },
  heroBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', paddingVertical: 12, paddingHorizontal: 18, borderRadius: 12, alignSelf: 'flex-start' },
  heroBtnText: { fontSize: 14, fontWeight: '700', color: '#5A2FD0' },
  // Four tiles are too narrow for one phone row, so they wrap to a 2x2 grid.
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  statTile: { flexGrow: 1, flexBasis: '46%', borderWidth: 1, borderRadius: 16, padding: 14, paddingHorizontal: 12 },
  statVal: { fontSize: 22, fontWeight: '700', marginTop: 10, fontFamily: 'JetBrainsMono_700Bold' },
  statSub: { fontSize: 10, fontWeight: '600', marginTop: 1 },
  statLabel: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '800' },
  firstRun: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 },
  firstRunTitle: { fontSize: 15.5, fontWeight: '800' },
  firstRunBody: { fontSize: 12.5, lineHeight: 18, marginTop: 6 },
  firstRunRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  firstRunBtn: {
    flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center',
  },
  firstRunBtnText: { fontSize: 12.5, fontWeight: '800' },
  devRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 10,
  },
  devName: { fontSize: 14.5, fontWeight: '700' },
  devSub: { fontSize: 12, marginTop: 2 },
  devTicks: { flexDirection: 'row', gap: 4, marginTop: 9 },
  devTick: { flex: 1, height: 4, borderRadius: 2 },
  seeAll: { fontSize: 13, fontWeight: '700' },
  recentList: { gap: 10 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderRadius: 16, padding: 14 },
  recentIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  recentMid: { flex: 1, minWidth: 0 },
  recentName: { fontSize: 14, fontWeight: '700' },
  recentMeta: { fontSize: 12, fontWeight: '500', marginTop: 3 },
  recentRight: { alignItems: 'flex-end' },
  recentBest: { fontSize: 15 },
  recentBestLabel: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  quickLinks: { flexDirection: 'row', gap: 10, marginTop: 16 },
  quickCard: { flex: 1, borderWidth: 1, borderRadius: 16, padding: 16 },
  quickTitle: { fontSize: 14, fontWeight: '700' },
  quickSub: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  emptyCard: { borderWidth: 1, borderRadius: 16, padding: 30, alignItems: 'center', gap: 8 },
  emptyText: { fontSize: 14, fontWeight: '700' },
  emptyHint: { fontSize: 12, fontWeight: '500', textAlign: 'center', lineHeight: 18 },
});
