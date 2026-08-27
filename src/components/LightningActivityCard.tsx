// ============================================================
// LightningActivityCard — Lightning summary display component
//
// Phase 6: Pure presentation component.
// Receives typed data, owns no collection or scheduling logic.
// ============================================================

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, SPACING, BORDER_RADIUS } from '../constants/theme';
import { WeatherDataRow } from './WeatherDataRow';
import type { LightningTrend } from '../services/lightning/lightningTrend';

export type LightningCardProps = {
  totalCount: number;
  flashCount: number;
  strikeCount: number;
  cgCount: number;
  icCount: number;
  nearbyCount: number;
  nearestDistanceKm: number | null;
  recentCount1Min: number;
  recentCount5Min: number;
  ratePerMinute: number;
  trend: LightningTrend;
  isCollecting: boolean;
  error?: string | null;
};

function getTrendLabel(trend: LightningTrend): string {
  switch (trend) {
    case 'INCREASING': return '📈 Increasing';
    case 'DECREASING': return '📉 Decreasing';
    case 'STABLE': return '➡️ Stable';
    case 'NONE': return '— No activity';
  }
}

function getTrendColor(trend: LightningTrend): string {
  switch (trend) {
    case 'INCREASING': return Colors.warning;
    case 'DECREASING': return Colors.secondary;
    case 'STABLE': return Colors.text;
    case 'NONE': return Colors.textSecondary;
  }
}

function formatDistance(km: number | null): string {
  if (km == null) return '—';
  if (km < 1) return `${(km * 1000).toFixed(0)} m`;
  return `${km.toFixed(1)} km`;
}

export function LightningActivityCard({
  totalCount,
  flashCount,
  strikeCount,
  cgCount,
  icCount,
  nearbyCount,
  nearestDistanceKm,
  recentCount1Min,
  recentCount5Min,
  ratePerMinute,
  trend,
  isCollecting,
  error,
}: LightningCardProps) {
  const hasData = totalCount > 0;
  const trendColor = getTrendColor(trend);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.headerText}>⚡ LIGHTNING</Text>
        {isCollecting && <Text style={styles.collecting}>COLLECTING</Text>}
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!hasData && !error && (
        <Text style={styles.noData}>
          {isCollecting
            ? 'Waiting for lightning data...'
            : 'No detected lightning events in the current collection window.'}
        </Text>
      )}

      {hasData && (
        <View style={styles.body}>
          <WeatherDataRow label="Total Events" value={`${totalCount}`} color={Colors.primary} />
          <WeatherDataRow label="Rate" value={`${ratePerMinute.toFixed(1)}/min`} color={Colors.primary} />
          <WeatherDataRow label="Nearest" value={formatDistance(nearestDistanceKm)} color={Colors.warning} />
          <WeatherDataRow label="Nearby" value={`${nearbyCount}`} color={Colors.secondary} />
          <WeatherDataRow label="Last 1 min" value={`${recentCount1Min}`} />
          <WeatherDataRow label="Last 5 min" value={`${recentCount5Min}`} />
          <WeatherDataRow label="Trend" value={getTrendLabel(trend)} color={trendColor} />

          {/* Provider-specific terminology counts — only show when > 0 */}
          {flashCount > 0 && (
            <WeatherDataRow label="Flashes" value={`${flashCount}`} color={Colors.primary} />
          )}
          {strikeCount > 0 && (
            <WeatherDataRow label="Strikes" value={`${strikeCount}`} color={Colors.warning} />
          )}
          {cgCount > 0 && (
            <WeatherDataRow label="CG" value={`${cgCount}`} color={Colors.danger} />
          )}
          {icCount > 0 && (
            <WeatherDataRow label="IC" value={`${icCount}`} color={Colors.primaryDark} />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  headerText: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  collecting: {
    color: Colors.secondary,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  errorBox: {
    backgroundColor: 'rgba(248, 81, 73, 0.1)',
    borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  errorText: {
    color: Colors.danger,
    fontSize: 12,
  },
  noData: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontStyle: 'italic',
    paddingVertical: SPACING.sm,
  },
  body: {
    marginTop: SPACING.xs,
  },
});
