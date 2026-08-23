import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, SPACING, BORDER_RADIUS } from '../constants/theme';

interface WeatherCardProps {
  label: string;
  value: string;
  icon?: string;
  color?: string;
}

export function WeatherCard({ label, value, icon, color = Colors.primary }: WeatherCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueRow}>
        {icon ? <Text style={styles.icon}>{icon}</Text> : null}
        <Text style={[styles.value, { color }]}>{value}</Text>
      </View>
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
});
