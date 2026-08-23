import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, SPACING } from '../constants/theme';

interface WeatherDataRowProps {
  label: string;
  value: string;
  color?: string;
}

export function WeatherDataRow({ label, value, color = Colors.text }: WeatherDataRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceVariant,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
  value: {
    fontSize: 14,
    fontWeight: '600',
  },
});
