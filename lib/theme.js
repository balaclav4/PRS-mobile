import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { Appearance, Platform } from 'react-native';
import * as db from './db';

const light = {
  bg: '#F4F3F8',
  card: '#FFFFFF',
  bd: '#ECEBF2',
  line: '#F2F1F7',
  tx: '#16151C',
  mut: '#8D8B99',
  fnt: '#B7B5C2',
  input: '#FFFFFF',
  ibd: '#E4E2EC',
  nav: 'rgba(255,255,255,0.94)',
  acs: '#F1EDFD',
  act: '#5A2FD0',
  avb: '#DDD8F5',
  avt: '#5A2FD0',
  inset: '#F7F6FB',
  tgt: '#FAF9FD',
  ring: '#E7E4F5',
  grid: '#EDECF3',
  st1: '#E8E7EE',
  st2: '#E1E0E9',
  oks: '#E7F6ED',
  okbd: '#C6EAD3',
  okt: '#15833E',
  warns: '#FBF0E1',
  warnt: '#B36A05',
  dngs: '#FBECEC',
  dngt: '#DC2626',
  primary: '#6D3BEB',
  primaryGradStart: '#7B4DF0',
  primaryGradEnd: '#5A2FD0',
  marker: '#F0872B',
  good: '#15A34A',
  warn: '#D97706',
  chart: '#8257F0',
  statusBar: 'dark',
};

const dark = {
  bg: '#111019',
  card: '#1A1922',
  bd: '#282634',
  line: '#26242F',
  tx: '#F2F1F6',
  mut: '#9997A6',
  fnt: '#66647A',
  input: '#201E29',
  ibd: '#302E3C',
  nav: 'rgba(20,19,26,0.92)',
  acs: '#251E3A',
  act: '#B49BF7',
  avb: '#2C2448',
  avt: '#C4AEF9',
  inset: '#221F2C',
  tgt: '#17161F',
  ring: '#332B4A',
  grid: '#26242F',
  st1: '#2A2833',
  st2: '#232130',
  oks: '#123020',
  okbd: '#204A31',
  okt: '#5FDB8B',
  warns: '#38290F',
  warnt: '#E8B056',
  dngs: '#3A1D1D',
  dngt: '#F16A6A',
  primary: '#6D3BEB',
  primaryGradStart: '#7B4DF0',
  primaryGradEnd: '#5A2FD0',
  marker: '#F0872B',
  good: '#15A34A',
  warn: '#D97706',
  chart: '#8257F0',
  statusBar: 'light',
};

const ThemeContext = createContext();

/**
 * Theme preference, persisted per device.
 *
 * Three states rather than two. "System" is the default and the one most people
 * want — the app follows the phone, including when it switches at dusk — but a
 * binary toggle cannot express it, because there is no way to tell "the user
 * chose light" from "the system is light and nobody has chosen".
 *
 * The stored value is the *preference*, not the resolved colour scheme. Storing
 * the resolved value would freeze a system-following user to whatever the phone
 * happened to be on the day they first opened Settings.
 *
 * `ready` gates the first render. Reading the preference is asynchronous, and
 * painting light before a stored dark preference arrives is a visible flash on
 * every launch.
 */
export function ThemeProvider({ children }) {
  // Subscribed to rather than sampled. useColorScheme() reads the scheme on
  // mount but was measured not to re-render when the system flips while the app
  // is open, which would leave "Auto" catching up only on relaunch — exactly
  // the case it exists for, since phones switch at dusk.
  const [system, setSystem] = useState(() => Appearance.getColorScheme());
  const [pref, setPref] = useState('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => setSystem(colorScheme));
    // react-native-web does not reliably drive Appearance from the media query,
    // so listen to it directly there.
    let mql = null, onMedia = null;
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.matchMedia) {
      mql = window.matchMedia('(prefers-color-scheme: dark)');
      onMedia = (e) => setSystem(e.matches ? 'dark' : 'light');
      mql.addEventListener?.('change', onMedia);
    }
    return () => {
      sub?.remove?.();
      if (mql && onMedia) mql.removeEventListener?.('change', onMedia);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    db.getPref('theme', 'system').then(v => {
      if (cancelled) return;
      if (v === 'light' || v === 'dark' || v === 'system') setPref(v);
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  const isDark = pref === 'system' ? system === 'dark' : pref === 'dark';

  const choose = useCallback((next) => {
    setPref(next);
    db.putPref('theme', next).catch(e => console.warn('[theme] save failed:', e.message));
  }, []);

  const colors = useMemo(() => (isDark ? dark : light), [isDark]);
  const value = useMemo(() => ({
    isDark,
    colors,
    pref,
    ready,
    systemScheme: system,
    choose,
    // Kept for callers that only want to flip; it commits an explicit choice.
    toggle: () => choose(isDark ? 'light' : 'dark'),
    setDark: () => choose('dark'),
    setLight: () => choose('light'),
    setSystem: () => choose('system'),
  }), [isDark, colors, pref, ready, system, choose]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function groupColor(value, colors, threshold = 0.5) {
  return parseFloat(value) <= threshold ? colors.okt : colors.tx;
}
