import { Tabs, useRouter, usePathname } from 'expo-router';
import { View, TouchableOpacity, StyleSheet, Platform, Pressable, Text } from 'react-native';
import { Home, History, Camera, ChartColumn, Menu } from 'lucide-react-native';
import { useTheme } from '../../lib/theme';
import { useState, useCallback, useRef, useEffect } from 'react';
import MoreSheet from '../../components/MoreSheet';
import ErrorBoundary from '../../components/ErrorBoundary';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function TabBarIcon({ icon: Icon, color, size }) {
  return <Icon size={size || 23} color={color} />;
}

/**
 * The capture button is given a full tab slot and centres itself inside it.
 *
 * Returning the 56px button directly left-aligned it: React Navigation sizes the
 * slot, and a fixed-width child with no alignment sits at its leading edge. It
 * measured 36px left of centre, which reads as a mistake rather than a design.
 */
function CaptureButton({ onPress }) {
  return (
    <View style={[s.fabSlot, { pointerEvents: 'box-none' }]}>
      <TouchableOpacity onPress={onPress} style={s.fab} activeOpacity={0.8}>
        <Camera size={24} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

export default function TabLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const pathname = usePathname();

  // Close the sheet whenever the route changes. MoreSheet's own onClose fires
  // on tap, but the sheet was surviving the navigation and covering the tab
  // bar on the destination screen; keying off the route is unconditional.
  useEffect(() => { setMoreOpen(false); }, [pathname]);

  useEffect(() => {
    if (Platform.OS === 'web' && moreRef.current) {
      const el = moreRef.current;
      const handler = () => setMoreOpen(true);
      el.addEventListener('click', handler);
      return () => el.removeEventListener('click', handler);
    }
  }, []);

  const MoreButton = useCallback((props) => {
    return (
      <View ref={moreRef} style={props.style}>
        <Pressable
          onPress={() => setMoreOpen(true)}
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          {props.children}
        </Pressable>
      </View>
    );
  }, []);

  return (
    <>
      {/* One boundary per tab, not one around the navigator.
          A single boundary at the root means one broken chart takes the tab bar
          with it and the shooter cannot reach the screens that still work. Per
          screen, a failure costs that screen and nothing else. */}
      <Tabs
        screenLayout={({ children }) => (
          <ErrorBoundary colors={colors}>{children}</ErrorBoundary>
        )}
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.act,
          tabBarInactiveTintColor: colors.fnt,
          // A floating pill rather than a docked bar. Detached from the bottom
          // edge, so it needs its own safe-area inset — the navigator no longer
          // supplies one — and the scene needs padding to match or content
          // scrolls underneath and stops there.
          //
          // A 23px icon plus a 10px label needs about 36px of content box; at 64
          // with 20px of padding the label was shrunk to 5.2px and cropped.
          tabBarStyle: {
            position: 'absolute',
            left: 14,
            right: 14,
            bottom: Math.max(insets.bottom, 10),
            height: 68,
            borderRadius: 26,
            // A hairline edge, not decoration: on dark the nav colour sits close
            // to the background and a drop shadow is invisible, so without this
            // the pill loses its outline and stops reading as a floating
            // surface. In light it is barely perceptible.
            borderWidth: 1,
            borderTopWidth: 1,
            borderColor: colors.bd,
            backgroundColor: colors.nav,
            paddingTop: 8,
            paddingBottom: 8,
            paddingHorizontal: 6,
            // Lifts the pill off the content behind it.
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.16,
            shadowRadius: 20,
            elevation: 12,
          },
          // A detached bar no longer reserves space, so the scene has to. Without
          // this the last item on every long screen sits behind the pill and
          // cannot be scrolled to — measured 55px of "Next: Seating" hidden.
          sceneStyle: {
            backgroundColor: colors.bg,
            paddingBottom: Math.max(insets.bottom, 10) + 68 + 8,
          },
          // flexShrink: 0 keeps the label at its natural height rather than
          // letting it collapse again if the icon or padding ever changes;
          // lineHeight makes that natural height explicit instead of 'normal'.
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: '700',
            lineHeight: 13,
            flexShrink: 0,
            marginTop: 2,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color }) => <TabBarIcon icon={Home} color={color} />,
          }}
        />
        <Tabs.Screen
          name="sessions"
          options={{
            title: 'Sessions',
            tabBarIcon: ({ color }) => <TabBarIcon icon={History} color={color} />,
          }}
        />
        <Tabs.Screen
          name="capture-placeholder"
          options={{
            title: '',
            tabBarButton: () => <CaptureButton onPress={() => router.push('/capture')} />,
          }}
        />
        <Tabs.Screen
          name="analytics"
          options={{
            title: 'Analytics',
            tabBarIcon: ({ color }) => <TabBarIcon icon={ChartColumn} color={color} />,
          }}
        />
        <Tabs.Screen
          name="more-placeholder"
          options={{
            title: 'More',
            tabBarIcon: ({ color }) => <TabBarIcon icon={Menu} color={color} />,
            tabBarButton: MoreButton,
          }}
        />

        {/* Reached from the More sheet, not the bar. They live inside the tab
            navigator so the bar stays visible — pushed on the root stack they
            covered it, stranding the user on screens with no back button.
            Listed explicitly: expo-router enumerates the children of <Tabs> to
            build its route table, and a mapped array made it mis-associate
            names, mounting several of these screens at once. */}
        <Tabs.Screen name="ballistics" options={{ href: null }} />
        <Tabs.Screen name="reloading" options={{ href: null }} />
        <Tabs.Screen name="equipment" options={{ href: null }} />
        <Tabs.Screen name="settings" options={{ href: null }} />
        <Tabs.Screen name="dopecards" options={{ href: null }} />
        <Tabs.Screen name="account" options={{ href: null }} />
        <Tabs.Screen name="scope" options={{ href: null }} />
      </Tabs>
      <MoreSheet visible={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}

const s = StyleSheet.create({
  fabSlot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -26,
    shadowColor: '#6D3BEB',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.6,
    shadowRadius: 22,
    elevation: 8,
    backgroundColor: '#6D3BEB',
  },
});
