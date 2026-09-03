import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, SPACING, BORDER_RADIUS } from '../constants/theme';
import type { PressureTrendDirection } from '../services/analysis/types';

interface WeatherCardProps {
  label: string;
  value: string;
  icon?: string;
  color?: string;
  trend?: PressureTrendDirection | null;
  trendDetail?: string | null;
}

export function WeatherCard({
  label,
  value,
  icon,
  color = Colors.primary,
  trend,
  trendDetail,
}: WeatherCardProps) {
  const hasTrend = trend != null;
  const trendIcon: keyof typeof Ionicons.glyphMap = trend === 'RISING'
    ? 'arrow-up'
    : trend === 'FALLING'
      ? 'arrow-down'
      : 'arrow-forward';
  const trendColor = trend === 'RISING'
    ? Colors.secondary
    : trend === 'FALLING'
      ? Colors.danger
      : Colors.textSecondary;

  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueRow}>
        {icon ? <Text style={styles.icon}>{icon}</Text> : null}
        <Text style={[styles.value, { color }]}>{value}</Text>
        {hasTrend ? (
          <Ionicons
            name={trendIcon}
            size={24}
            color={trendColor}
            style={styles.trendIcon}
            accessibilityLabel={`Pressure ${trend.toLowerCase()}`}
          />
        ) : null}
      </View>
      {hasTrend ? (
        <View style={styles.trendRow}>
          <Text style={[styles.trendText, { color: trendColor }]}>{trend}</Text>
          {trendDetail ? <Text style={styles.trendDetail}>{trendDetail}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    flex: 1,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginBottom: SPACING.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    fontSize: 16,
    marginRight: SPACING.xs,
  },
  value: {
    fontSize: 20,
    fontWeight: '700',
  },
  trendIcon: {
    marginLeft: 'auto',
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.xs,
    gap: SPACING.xs,
  },
  trendText: {
    fontSize: 11,
    fontWeight: '700',
  },
  trendDetail: {
    color: Colors.textSecondary,
    fontSize: 10,
  },
});
