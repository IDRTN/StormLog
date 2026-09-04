import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, SPACING, BORDER_RADIUS } from '../constants/theme';
import { useLightningSafety } from '../hooks/useLightningSafety';
import type { LightningSafetyLevel } from '../services/lightning/lightningSafety';

function tone(level: LightningSafetyLevel): string {
  switch (level) {
    case 'VERY_CLOSE': return Colors.danger;
    case 'NEARBY': return Colors.warning;
    case 'IN_AREA': return '#F0C000';
    case 'CLEAR': return Colors.loggingActive;
    case 'STALE': return Colors.warning;
    case 'WAITING': return Colors.textSecondary;
    case 'UNAVAILABLE': return Colors.textSecondary;
  }
}

function icon(level: LightningSafetyLevel): keyof typeof Ionicons.glyphMap {
  switch (level) {
    case 'VERY_CLOSE': return 'warning';
    case 'NEARBY': return 'warning-outline';
    case 'IN_AREA': return 'flash';
    case 'CLEAR': return 'shield-checkmark-outline';
    case 'STALE': return 'cloud-offline-outline';
    case 'WAITING': return 'time-outline';
    case 'UNAVAILABLE': return 'cloud-offline-outline';
  }
}

export function LightningSafetyBanner() {
  const { safety, loading, error } = useLightningSafety();
  const color = tone(safety.level);
  const proximity = safety.nearestDistanceMiles != null
    ? `${safety.nearestDistanceMiles.toFixed(1)} mi${safety.direction ? ` ${safety.direction}` : ''}`
    : null;
  const ageMinutes = safety.dataAgeMs == null ? null : Math.round(safety.dataAgeMs / 60_000);

  return (
    <View
      style={[styles.container, { borderColor: color, backgroundColor: color + '12' }]}
      accessible
      accessibilityLabel={`Lightning safety. ${safety.title}. ${proximity ?? safety.detail}`}
    >
      <Ionicons name={icon(safety.level)} size={23} color={color} />
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color }]}>{safety.title}</Text>
          {loading ? <Text style={styles.refreshing}>REFRESHING</Text> : null}
        </View>
        {proximity ? <Text style={styles.proximity}>{proximity}</Text> : null}
        <Text style={styles.detail}>{error ? 'Lightning status could not be refreshed.' : safety.detail}</Text>
        {ageMinutes != null ? (
          <Text style={styles.age}>Lightning data age: {ageMinutes} min</Text>
        ) : null}
        <Text style={styles.disclaimer}>Safety aid only — use official warnings and move indoors when thunder is heard.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.md,
  },
  content: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm },
  title: { fontSize: 15, fontWeight: '800' },
  refreshing: { color: Colors.textSecondary, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  proximity: { color: Colors.white, fontSize: 19, fontWeight: '800', marginTop: 2 },
  detail: { color: Colors.text, fontSize: 12, marginTop: 2 },
  age: { color: Colors.textSecondary, fontSize: 10, marginTop: 4 },
  disclaimer: { color: Colors.textSecondary, fontSize: 9, marginTop: 5, lineHeight: 12 },
});
