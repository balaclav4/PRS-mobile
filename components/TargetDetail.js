import { View, Text, StyleSheet, Pressable } from 'react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../lib/theme';

/**
 * One recorded target, drawn to scale.
 *
 * The plot is in inches on the target plane, not in image pixels, so a group
 * shot off-axis appears as it actually was rather than as the camera saw it.
 * Shots, the aim point and the group centre are drawn in one frame because the
 * relationship between those three is the entire point — where the group went
 * relative to where it was pointed.
 *
 * The view is squared and centred on the union of shots and aim, so the aim
 * point is never cropped out no matter how far the group landed from it.
 */
export default function TargetDetail({ metrics, size = 260, onSetAim, invert }) {
  const { colors } = useTheme();

  if (!metrics?.ok) {
    return (
      <View style={[s.empty, { backgroundColor: colors.inset }]}>
        <Text style={[s.emptyText, { color: colors.mut }]}>{metrics?.reason || 'Nothing to show.'}</Text>
      </View>
    );
  }

  const pts = metrics.shotsIn;
  const aim = metrics.aimIn;
  const c = metrics.centroidIn;

  // Bounds over everything that must stay visible.
  const all = aim ? [...pts, aim, c] : [...pts, c];
  const xs = all.map(p => p.x), ys = all.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cxMid = (minX + maxX) / 2, cyMid = (minY + maxY) / 2;
  // A square span with padding, floored so a single shot still has a sane frame.
  const span = Math.max(maxX - minX, maxY - minY, 1) * 1.45;
  const toPx = (v, mid) => size / 2 + ((v - mid) / span) * size;
  const px = (p) => ({ cx: toPx(p.x, cxMid), cy: toPx(p.y, cyMid) });
  const dot = Math.max(4, Math.min(8, size / 34));

  // Screen pixel -> plane inches, the inverse of `px` above. Used to turn a tap
  // into a new aim point.
  const fromPx = (sx, sy) => ({
    x: (sx - size / 2) / size * span + cxMid,
    y: (sy - size / 2) / size * span + cyMid,
  });

  const handleTap = (e) => {
    if (!onSetAim || !invert) return;
    const { locationX, locationY } = e.nativeEvent;
    const sx = locationX ?? e.nativeEvent.offsetX;
    const sy = locationY ?? e.nativeEvent.offsetY;
    if (!isFinite(sx) || !isFinite(sy)) return;
    const planePt = fromPx(sx, sy);
    const normalised = invert(planePt);
    if (normalised) onSetAim(normalised);
  };

  return (
    <View>
      <Pressable onPress={handleTap} disabled={!onSetAim}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* One-inch grid, so the scale is readable without a legend. */}
        {(() => {
          const lines = [];
          const step = span > 8 ? 2 : 1;
          for (let i = -6; i <= 6; i++) {
            const gx = toPx(cxMid + i * step, cxMid);
            const gy = toPx(cyMid + i * step, cyMid);
            if (gx > 0 && gx < size) {
              lines.push(<Line key={`v${i}`} x1={gx} y1={0} x2={gx} y2={size}
                stroke={colors.grid} strokeWidth={i === 0 ? 1.2 : 0.5} />);
            }
            if (gy > 0 && gy < size) {
              lines.push(<Line key={`h${i}`} x1={0} y1={gy} x2={size} y2={gy}
                stroke={colors.grid} strokeWidth={i === 0 ? 1.2 : 0.5} />);
            }
          }
          return lines;
        })()}

        {/* Aim point: what the shooter was pointing at. */}
        {aim && (() => {
          const a = px(aim);
          return (
            <>
              <Circle cx={a.cx} cy={a.cy} r={11} fill="none" stroke="#12B76A" strokeWidth={2}
                strokeDasharray={metrics.aimAssumed ? '3 3' : undefined} />
              <Line x1={a.cx} y1={a.cy - 16} x2={a.cx} y2={a.cy - 5} stroke="#12B76A" strokeWidth={2} />
              <Line x1={a.cx} y1={a.cy + 5} x2={a.cx} y2={a.cy + 16} stroke="#12B76A" strokeWidth={2} />
              <Line x1={a.cx - 16} y1={a.cy} x2={a.cx - 5} y2={a.cy} stroke="#12B76A" strokeWidth={2} />
              <Line x1={a.cx + 5} y1={a.cy} x2={a.cx + 16} y2={a.cy} stroke="#12B76A" strokeWidth={2} />
            </>
          );
        })()}

        {/* The offset being reported, drawn rather than only stated. */}
        {aim && (() => {
          const a = px(aim), g = px(c);
          return <Line x1={a.cx} y1={a.cy} x2={g.cx} y2={g.cy}
            stroke={colors.act} strokeWidth={1.5} strokeDasharray="4 3" />;
        })()}

        {/* Group centre. */}
        {(() => {
          const g = px(c);
          return (
            <>
              <Line x1={g.cx - 8} y1={g.cy} x2={g.cx + 8} y2={g.cy} stroke={colors.act} strokeWidth={2} />
              <Line x1={g.cx} y1={g.cy - 8} x2={g.cx} y2={g.cy + 8} stroke={colors.act} strokeWidth={2} />
            </>
          );
        })()}

        {pts.map((p, i) => {
          const q = px(p);
          return (
            <Circle key={i} cx={q.cx} cy={q.cy} r={dot}
              fill="rgba(130,87,240,0.9)" stroke={colors.card} strokeWidth={1.2} />
          );
        })}

        <SvgText x={6} y={size - 7} fontSize={9} fontFamily="JetBrains Mono" fill={colors.fnt}>
          {span > 8 ? '2in grid' : '1in grid'}
        </SvgText>
      </Svg>
      </Pressable>

      <View style={s.legend}>
        <Legend colour="rgba(130,87,240,0.9)" label={`${metrics.n} shots`} colors={colors} />
        <Legend colour={colors.act} label="Group centre" colors={colors} />
        {aim && <Legend colour="#12B76A" label={metrics.aimAssumed ? 'Aim (assumed centre)' : 'Aim point'} colors={colors} />}
      </View>
    </View>
  );
}

function Legend({ colour, label, colors }) {
  return (
    <View style={s.legendItem}>
      <View style={[s.legendDot, { backgroundColor: colour }]} />
      <Text style={[s.legendText, { color: colors.mut }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  empty: { padding: 14, borderRadius: 10 },
  emptyText: { fontSize: 12.5, fontWeight: '600', lineHeight: 17 },
  legend: { flexDirection: 'row', gap: 14, marginTop: 8, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { fontSize: 11, fontWeight: '600' },
});
