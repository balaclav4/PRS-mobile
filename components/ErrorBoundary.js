import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { TriangleAlert, RotateCcw } from 'lucide-react-native';
import { recordError } from '../lib/errorlog';

/**
 * Catches a render error and offers a way out of it.
 *
 * Without this, a single bad render unmounts the whole tree and leaves a blank
 * screen: no message, no navigation, nothing to do but force-quit. On a phone
 * the shooter cannot open a console, so the entire bug report available to them
 * is "it went white" - which is unactionable, and was the state this app would
 * have gone to beta in.
 *
 * A class component because that is the only thing React gives an error
 * boundary; there is no hook for it.
 *
 * Placed per screen rather than only at the root. A boundary at the root alone
 * means one broken chart takes the navigation with it, and the shooter cannot
 * reach the five screens that still work. Wrapped per tab, a failure costs the
 * tab and nothing else.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Kept locally so Settings can bundle it into a report the shooter reads
    // and chooses to send. Nothing is transmitted from here.
    recordError(this.props.where || 'screen', error, {
      componentStack: String(info?.componentStack || '').split('\n').slice(0, 6).join('\n'),
    });
  }

  render() {
    const { error } = this.state;
    const { children, where, colors } = this.props;
    if (!error) return children;

    // Colours are passed in rather than read from the theme hook, because the
    // theme provider is one of the things that might have thrown.
    const c = colors || {};
    const tx = c.tx || '#EDEDF2';
    const mut = c.mut || '#9B98A8';
    const bg = c.bg || '#16141D';
    const card = c.card || '#1D1B26';
    const act = c.act || '#8B6BF5';
    const bd = c.bd || '#2A2833';

    return (
      <View style={[s.wrap, { backgroundColor: bg }]}>
        <ScrollView contentContainerStyle={s.scroll}>
          <View style={[s.card, { backgroundColor: card, borderColor: bd }]}>
            <TriangleAlert size={26} color={act} />
            <Text style={[s.title, { color: tx }]}>
              {where ? `${where} stopped working` : 'Something stopped working'}
            </Text>
            <Text style={[s.body, { color: mut }]}>
              The rest of the app is still fine — the tabs at the bottom still work. Nothing
              you have saved is affected.
            </Text>

            {/* The error, shown rather than hidden. A tester who can read it can
                describe it, and the alternative is asking them to guess. */}
            <View style={[s.detail, { borderColor: bd }]}>
              <Text style={[s.detailLabel, { color: mut }]}>WHAT BROKE</Text>
              <Text style={[s.detailText, { color: tx }]} selectable>
                {String(error?.message || error)}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => this.setState({ error: null })}
              style={[s.btn, { borderColor: act }]}
            >
              <RotateCcw size={15} color={act} />
              <Text style={[s.btnText, { color: act }]}>Try again</Text>
            </TouchableOpacity>

            <Text style={[s.hint, { color: mut }]}>
              If it keeps happening, Settings → Report a problem will bundle this up
              for you to send.
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  scroll: { padding: 20, paddingTop: 60 },
  card: { borderWidth: 1, borderRadius: 16, padding: 20, gap: 10 },
  title: { fontSize: 17, fontWeight: '800' },
  body: { fontSize: 13, lineHeight: 19 },
  detail: { borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 4 },
  detailLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, marginBottom: 5 },
  detailText: { fontSize: 12, lineHeight: 17, fontFamily: 'JetBrainsMono_500Medium' },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderRadius: 11, paddingVertical: 12, marginTop: 6,
  },
  btnText: { fontSize: 13, fontWeight: '800' },
  hint: { fontSize: 11.5, lineHeight: 16, marginTop: 2 },
});
