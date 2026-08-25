import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, SPACING, BORDER_RADIUS } from '../../src/constants/theme';
import { WeatherDataRow } from '../../src/components/WeatherDataRow';
import { getStormEventById } from '../../src/database/stormEvents';
import { getObservationsByEvent } from '../../src/database/observations';
import { getAnalysisSnapshotsByEvent } from '../../src/database/analysisSnapshots';
import type { WeatherObservation, AnalysisSnapshot } from '../../src/models/types';
import type { StormEventWithWarningMetadata } from '../../src/database/stormEvents';
import { getWarningEventDisplay } from '../../src/services/stormLogs/warningDisplay';
import { getAssessmentColor as getLevelColor, getAssessmentEmoji as getLevelEmoji } from '../../src/services/analysis/tornadoAnalysis';

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [event, setEvent] = useState<StormEventWithWarningMetadata | null>(null);
  const [observations, setObservations] = useState<WeatherObservation[]>([]);
  const [snapshots, setSnapshots] = useState<AnalysisSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!id) return;
      const eventId = Number(id);
      const ev = await getStormEventById(eventId);
      const obs = await getObservationsByEvent(eventId);
      const snaps = await getAnalysisSnapshotsByEvent(eventId);
      setEvent(ev);
      setObservations(obs);
      setSnapshots(snaps);
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!event) {
    return (
      <View style={styles.center}>
        <Text style={{ color: Colors.text }}>Event not found</Text>
      </View>
    );
  }

  const formatDateTime = (ts: number) =>
    new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const warningDisplay = event ? getWarningEventDisplay(event) : null;

  // Compute min/max for key metrics
  const temps = observations.map((o) => o.temperature).filter((v): v is number => v != null);
  const pressures = observations.map((o) => o.pressure).filter((v): v is number => v != null);
  const humidities = observations.map((o) => o.humidity).filter((v): v is number => v != null);
  const winds = observations.map((o) => o.windSpeed).filter((v): v is number => v != null);

  const renderGraph = (title: string, values: number[], color: string, unit: string) => {
    if (values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;

    return (
      <View style={styles.graphCard}>
        <Text style={[styles.graphTitle, { color }]}>{title}</Text>
        <View style={styles.graphMinMax}>
          <Text style={styles.graphStat}>Min: {min.toFixed(1)}{unit}</Text>
          <Text style={styles.graphStat}>Avg: {avg.toFixed(1)}{unit}</Text>
          <Text style={styles.graphStat}>Max: {max.toFixed(1)}{unit}</Text>
        </View>
        <SimpleBarGraph values={values} color={color} />
      </View>
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Event Header */}
      <Text style={styles.eventName}>{event.eventName}</Text>

      {warningDisplay?.sourceLabel != null && (
        <View
          style={warningStyles.warningCard}
          accessible
          accessibilityLabel={`${warningDisplay.sourceLabel}. ${warningDisplay.warningType}. ${warningDisplay.lifecycleLabel}`}
        >
          <View style={warningStyles.warningHeader}>
            <Ionicons name="warning" size={16} color={Colors.warning} />
            <Text style={warningStyles.warningSource}>{warningDisplay.sourceLabel}</Text>
          </View>
          <Text style={warningStyles.warningType}>{warningDisplay.warningType}</Text>
          <Text
            style={[
              warningStyles.warningStatus,
              { color: warningDisplay.lifecycleTone === 'active' ? Colors.loggingActive : Colors.textSecondary },
            ]}
          >
            ● {warningDisplay.lifecycleLabel}
          </Text>
          {warningDisplay.warningEndsAt != null && (
            <Text style={warningStyles.warningExpiration}>
              Warning ends: {formatDateTime(warningDisplay.warningEndsAt)}
            </Text>
          )}
        </View>
      )}

      <View style={styles.card}>
        <View style={styles.infoRow}>
          <Ionicons name="time" size={16} color={Colors.primary} />
          <View style={{ marginLeft: SPACING.sm }}>
            <Text style={styles.infoLabel}>Start: {formatDateTime(event.startTime)}</Text>
            <Text style={styles.infoLabel}>
              End: {event.endTime ? formatDateTime(event.endTime) : 'Active'}
            </Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <Ionicons name="location" size={16} color={Colors.primary} />
          <Text style={[styles.infoLabel, { marginLeft: SPACING.sm }]}>
            {event.startLatitude.toFixed(3)}°N, {Math.abs(event.startLongitude).toFixed(3)}°W
          </Text>
        </View>

        <Text style={styles.obsCount}>{observations.length} observations</Text>
      </View>

      {/* Summary Stats */}
      {observations.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Summary</Text>
          <View style={styles.card}>
            {temps.length > 0 && (
              <WeatherDataRow label="Temperature" value={`${Math.min(...temps).toFixed(1)}°F — ${Math.max(...temps).toFixed(1)}°F`} color={Colors.temperature} />
            )}
            {pressures.length > 0 && (
              <WeatherDataRow label="Pressure" value={`${Math.min(...pressures).toFixed(2)}" — ${Math.max(...pressures).toFixed(2)}"`} color={Colors.pressure} />
            )}
            {humidities.length > 0 && (
              <WeatherDataRow label="Humidity" value={`${Math.min(...humidities).toFixed(0)}% — ${Math.max(...humidities).toFixed(0)}%`} color={Colors.humidity} />
            )}
            {winds.length > 0 && (
              <WeatherDataRow label="Wind Speed" value={`${Math.min(...winds).toFixed(1)} — ${Math.max(...winds).toFixed(1)} mph`} color={Colors.wind} />
            )}
          </View>
        </>
      )}

      {/* Tornado Possibility Timeline */}
      {snapshots.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Tornado Possibility</Text>
          {snapshots.map((snap, i) => {
            const color = getLevelColor(snap.tornadoPossibilityLevel as any);
            const emoji = getLevelEmoji(snap.tornadoPossibilityLevel as any);
            return (
              <View key={snap.id} style={styles.snapshotCard}>
                <View style={styles.snapshotHeader}>
                  <Text style={styles.snapshotTime}>{formatTime(snap.timestamp)}</Text>
                  <Text style={[styles.snapshotLevel, { color }]}>{emoji} {snap.tornadoPossibilityLevel}</Text>
                  <Text style={styles.snapshotConf}>Conf: {snap.confidence}%</Text>
                </View>
                <View style={styles.snapshotDetails}>
                  <Text style={styles.snapshotDetail}>Rotation: {snap.rotationSignal}</Text>
                  <Text style={styles.snapshotDetail}>Convergence: {snap.convergence}</Text>
                  <Text style={styles.snapshotDetail}>Shear: {snap.windShear}</Text>
                  <Text style={styles.snapshotDetail}>Pressure: {snap.pressureTrend}</Text>
                  {snap.windDirectionChange != null && (
                    <Text style={styles.snapshotDetail}>Shift: {snap.windDirectionChange}°</Text>
                  )}
                </View>
              </View>
            );
          })}

          {/* Tornado Possibility Level Graph */}
          {snapshots.length >= 2 && (
            <View style={styles.graphCard}>
              <Text style={[styles.graphTitle, { color: Colors.warning }]}>Tornado Possibility Over Time</Text>
              <View style={styles.levelGraph}>
                {snapshots.map((snap, i) => {
                  const color = getLevelColor(snap.tornadoPossibilityLevel as any);
                  const levelHeight =
                    snap.tornadoPossibilityLevel === 'HIGH' ? 80 :
                    snap.tornadoPossibilityLevel === 'MODERATE' ? 60 :
                    snap.tornadoPossibilityLevel === 'ELEVATED' ? 40 : 20;
                  const barWidth = Math.max(3, Math.floor(280 / snapshots.length) - 2);
                  return (
                    <View key={snap.id} style={styles.levelBar}>
                      <View style={[styles.levelBarFill, { height: levelHeight, width: barWidth, backgroundColor: color }]} />
                      <Text style={styles.levelBarTime}>
                        {new Date(snap.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Pressure Trend Graph from snapshots */}
          {snapshots.filter(s => s.windDirectionChange != null).length >= 2 && (
            <View style={styles.graphCard}>
              <Text style={[styles.graphTitle, { color: Colors.pressure }]}>Pressure Trend</Text>
              <View style={styles.trendRow}>
                {snapshots.map((snap) => (
                  <View key={snap.id} style={styles.trendItem}>
                    <Ionicons
                      name={
                        snap.pressureTrend === 'FALLING' ? 'arrow-down' :
                        snap.pressureTrend === 'RISING' ? 'arrow-up' : 'remove'
                      }
                      size={14}
                      color={
                        snap.pressureTrend === 'FALLING' ? Colors.danger :
                        snap.pressureTrend === 'RISING' ? Colors.secondary : Colors.textSecondary
                      }
                    />
                    <Text style={styles.trendText}>{snap.pressureTrend}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </>
      )}

      {/* Graphs */}
      {observations.length >= 2 && (
        <>
          <Text style={styles.sectionTitle}>Graphs</Text>
          {renderGraph('Temperature (°F)', temps, Colors.temperature, '°F')}
          {renderGraph('Pressure (inHg)', pressures, Colors.pressure, '"')}
          {renderGraph('Humidity (%)', humidities, Colors.humidity, '%')}
          {renderGraph('Wind Speed (mph)', winds, Colors.wind, ' mph')}
        </>
      )}

      {/* Observations List */}
      {observations.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Observations</Text>
          {observations.map((obs) => (
            <View key={obs.id} style={styles.obsCard}>
              <Text style={styles.obsTime}>{formatTime(obs.timestamp)}</Text>
              <View style={styles.obsData}>
                <Text style={[styles.obsValue, { color: Colors.temperature }]}>
                  {obs.temperature != null ? `${Math.round(obs.temperature)}°F` : '--'}
                </Text>
                <Text style={[styles.obsValue, { color: Colors.wind }]}>
                  {obs.windSpeed != null ? `${Math.round(obs.windSpeed)} mph` : '--'}
                </Text>
                <Text style={[styles.obsValue, { color: Colors.humidity }]}>
                  {obs.humidity != null ? `${Math.round(obs.humidity)}%` : '--'}
                </Text>
                <Text style={[styles.obsValue, { color: Colors.textSecondary }]}>
                  {obs.weatherCondition ?? '--'}
                </Text>
              </View>
            </View>
          ))}
        </>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// Simple bar graph component using View elements
function SimpleBarGraph({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(max - min, 0.01);
  const barWidth = Math.max(2, Math.floor(280 / values.length) - 1);

  return (
    <View style={barStyles.container}>
      {values.map((val, i) => {
        const height = Math.max(4, ((val - min) / range) * 80);
        return (
          <View
            key={i}
            style={[
              barStyles.bar,
              {
                height,
                width: barWidth,
                backgroundColor: color,
                opacity: 0.7 + (val - min) / range * 0.3,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const barStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 84,
    paddingHorizontal: SPACING.xs,
    gap: 1,
  },
  bar: {
    borderRadius: 1,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: SPACING.lg,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  eventName: {
    color: Colors.white,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: SPACING.lg,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.sm,
  },
  infoLabel: {
    color: Colors.text,
    fontSize: 14,
  },
  obsCount: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginTop: SPACING.sm,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: SPACING.md,
    marginTop: SPACING.sm,
  },
  graphCard: {
    backgroundColor: Colors.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  graphTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: SPACING.sm,
  },
  graphMinMax: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.sm,
  },
  graphStat: {
    color: Colors.textSecondary,
    fontSize: 11,
  },
  obsCard: {
    backgroundColor: Colors.surface,
    borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  obsTime: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: SPACING.xs,
  },
  obsData: {
    flexDirection: 'row',
    gap: SPACING.md,
    flexWrap: 'wrap',
  },
  obsValue: {
    fontSize: 12,
    fontWeight: '500',
  },
  // Analysis snapshot styles
  snapshotCard: {
    backgroundColor: Colors.surface,
    borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },
  snapshotHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.xs,
  },
  snapshotTime: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  snapshotLevel: {
    fontSize: 14,
    fontWeight: '800',
    flex: 1,
  },
  snapshotConf: {
    color: Colors.textSecondary,
    fontSize: 11,
  },
  snapshotDetails: {
    flexDirection: 'row',
    gap: SPACING.md,
    flexWrap: 'wrap',
  },
  snapshotDetail: {
    color: Colors.textSecondary,
    fontSize: 11,
  },
  levelGraph: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 100,
    gap: 2,
    paddingTop: SPACING.sm,
  },
  levelBar: {
    alignItems: 'center',
    flex: 1,
  },
  levelBarFill: {
    borderRadius: 2,
    minWidth: 3,
  },
  levelBarTime: {
    color: Colors.textSecondary,
    fontSize: 8,
    marginTop: 2,
    transform: [{ rotate: '-45deg' }],
  },
  trendRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    flexWrap: 'wrap',
  },
  trendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trendText: {
    color: Colors.textSecondary,
    fontSize: 11,
  },
});

const warningStyles = StyleSheet.create({
  warningCard: {
    backgroundColor: Colors.surface,
    borderColor: Colors.warning,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  warningHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  warningSource: { color: Colors.warning, fontSize: 11, fontWeight: '700' },
  warningType: { color: Colors.white, fontSize: 18, fontWeight: '700', marginTop: SPACING.sm },
  warningStatus: { fontSize: 12, fontWeight: '700', marginTop: SPACING.xs },
  warningExpiration: { color: Colors.textSecondary, fontSize: 12, marginTop: SPACING.xs },
});
