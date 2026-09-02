import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, SPACING, BORDER_RADIUS } from '../constants/theme';
import type { PressureTrendDirection } from '../services/analysis/types';

type Props = {
  trend: PressureTrendDirection | null | undefined;
};

/**
 * Small glanceable pressure-trend indicator for the main weather view.
 * Uses the existing environmental pressure-trend calculation; it does not
 * calculate or reinterpret the trend itself.
 */
export function PressureTrendIndicator({ trend }: Props) {
  const iconName: keyof typeof Ionicons.glyphMap =
    trend === 'RISING' ? 'arrow-up' :
    trend === 'FALLING' ? 'arrow-down' :
    'arrow-forward';

  const iconColor =
    trend === 'RISING' ? Colors.secondary :
    trend === 'FALLING' ? Colors.danger :
    Colors.textSecondary;

  const accessibilityText =
    trend === 'RISING' ? 'Pressure rising' :
    trend === 'FALLING' ? 'Pressure falling' :
    'Pressure steady';

  return (
    <View
      style={styles.container}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityText}
    >
      <Ionicons name={iconName} size={30} color={iconColor} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minWidth: 54,
    minHeight: 44,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
