import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import { Colors, SPACING, BORDER_RADIUS } from '../constants/theme';

interface MiniLineChartProps {
  values: number[];
  color: string;
  height?: number;
  label?: string;
}

export function MiniLineChart({ values, color, height = 120, label }: MiniLineChartProps) {
  if (values.length === 0) return null;

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = Math.max(maxVal - minVal, 0.01);

  const chartWidth = 300;
  const padding = SPACING.md;
  const drawHeight = height - padding * 2;
  const drawWidth = chartWidth - padding * 2;

  const points = values.map((val, i) => {
    const x = padding + (drawWidth * i) / Math.max(values.length - 1, 1);
    const normalizedY = (val - minVal) / range;
    const y = padding + drawHeight - normalizedY * drawHeight;
    return { x, y };
  });

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  return (
    <View style={styles.container}>
      {label ? (
        <View style={styles.labelRow}>
          <React.Fragment>
            <View style={[styles.dot, { backgroundColor: color }]} />
            <React.Fragment>
              <View style={{ width: 4 }} />
            </React.Fragment>
          </React.Fragment>
        </View>
      ) : null}
      <Svg width="100%" height={height} viewBox={`0 0 ${chartWidth} ${height}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
          const y = padding + drawHeight * (1 - ratio);
          return (
            <Line
              key={i}
              x1={padding}
              y1={y}
              x2={chartWidth - padding}
              y2={y}
              stroke={Colors.surfaceVariant}
              strokeWidth={0.5}
            />
          );
        })}
        <Path d={pathD} fill="none" stroke={color} strokeWidth={2} />
        {points.length <= 30 &&
          points.map((p, i) => (
            <Circle key={i} cx={p.x} cy={p.y} r={2.5} fill={color} />
          ))}
      </Svg>
      <View style={styles.minMaxRow}>
        <View style={[styles.minMax, { backgroundColor: color + '20' }]}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <View style={{ width: 4 }} />
        </View>
        <View style={styles.minMaxSpacer} />
        <View style={[styles.minMax, { backgroundColor: color + '20' }]}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <View style={{ width: 4 }} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  minMaxRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.xs,
    marginTop: SPACING.xs,
  },
  minMax: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  minMaxSpacer: {
    flex: 1,
  },
});
