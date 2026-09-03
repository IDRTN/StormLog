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
import {
  getDailySummary,
  getDailyRecordsForDate,
  getLatestUtcOffsetForWeatherLocalDay,
} from '../../src/database/dailyWeather';
import { parseStoredAlertTypes, sortAlertTypes, type AlertDisplayTone } from '../../src/services/nws/alertDisplay';
import type { DailySummary, DailyWeatherRecord } from '../../src/models/types';

function alertToneColor(tone: AlertDisplayTone): string {
  if (tone === 'critical') return Colors.danger;
  if (tone === 'warning') return Colors.warning;
  if (tone === 'watch') return Colors.warning;
  return Colors.textSecondary;
}

export default function DailyDetailScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [records, setRecords] = useState<DailyWeatherRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!date) return;
      const utcOffsetSeconds = await getLatestUtcOffsetForWeatherLocalDay(date);
      const s = await getDailySummary(date, utcOffsetSeconds);
      const r = await getDailyRecordsForDate(date, utcOffsetSeconds);
      setSummary(s);
      setRecords(r);
      setLoading(false);
    })();
  }, [date]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!summary) {
    return (
      <View style={styles.center}>
        <Text style={{ color: Colors.text }}>No data for this date</Text>
      </View>
    );
  }

  const formatDate = (d: string) =>
    new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const temps = records.map((r) => r.temperature).filter((v): v is number => v != null);
  const pressures = records.map((r) => r.pressure).filter((v): v is number => v != null);
  const humidities = records.map((r) => r.humidity).filter((v): v is number => v != null);
  const winds = records.map((r) => r.windSpeed).filter((v): v is number => v != null);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.dateTitle}>{formatDate(date || '')}</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Daily Summary</Text>

        <View style={styles.summaryGrid}>
          {summary.highTemp != null && (
            <View style={styles.summaryItem}>
              <Ionicons name="arrow-up" size={14} color={Colors.danger} />
              <Text style={styles.summaryLabel}>High</Text>
              <Text style={[styles.summaryValue, { color: Colors.temperature }]}>{Math.round(summary.highTemp)}°F</Text>
            </View>
          )}
          {summary.lowTemp != null && (
            <View style={styles.summaryItem}>
              <Ionicons name="arrow-down" size={14} color={Colors.primary} />
              <Text style={styles.summaryLabel}>Low</Text>
              <Text style={[styles.summaryValue, { color: Colors.primary }]}>{Math.round(summary.lowTemp)}°F</Text>
            </View>
          )}
          {summary.avgTemp != null && (
            <View style={styles.summaryItem}>
              <Ionicons name="remove" size={14} color={Colors.textSecondary} />
              <Text style={styles.summaryLabel}>Average</Text>
              <Text style={[styles.summaryValue, { color: Colors.textSecondary }]}>{Math.round(summary.avgTemp)}°F</Text>
            </View>
          )}
        </View>

        <View style={styles.summaryGrid}>
          {summary.maxWind != null && (
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Max Wind</Text>
              <Text style={[styles.summaryValue, { color: Colors.wind }]}>{Math.round(summary.maxWind)} mph</Text>
            </View>
          )}
          {summary.maxGust != null && (
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Max Gust</Text>
              <Text style={[styles.summaryValue, { color: Colors.warning }]}>{Math.round(summary.maxGust)} mph</Text>
            </View>
          )}
          {summary.avgHumidity != null && (
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Avg Humidity</Text>
              <Text style={[styles.summaryValue, { color: Colors.humidity }]}>{summary.avgHumidity}%</Text>
            </View>
          )}
        </View>

        {summary.minPressure != null && summary.maxPressure != null && (
          <View style={styles.pressureRow}>
            <Text style={styles.summaryLabel}>Pressure</Text>
            <Text style={[styles.summaryValue, { color: Colors.pressure }]}>{summary.maxPressure.toFixed(2)} → {summary.minPressure.toFixed(2)}"</Text>
          </View>
        )}

        {summary.totalPrecip != null && summary.totalPrecip > 0 && (
          <View style={styles.pressureRow}>
            <Text style={styles.summaryLabel}>Total Precipitation</Text>
            <Text style={[styles.summaryValue, { color: Colors.precipitation }]}>{summary.totalPrecip.toFixed(2)}"</Text>
          </View>
        )}

        {summary.alertCount > 0 && (
          <View style={styles.alertSection}>
            <Ionicons name="warning" size={16} color={Colors.warning} />
            <View style={styles.alertSummaryContent}>
              <Text style={[styles.summaryLabel, { color: Colors.warning }]}>
                {summary.alertCount} Weather Alert{summary.alertCount > 1 ? 's' : ''}
              </Text>
              {summary.alertTypes.length > 0 && <Text style={styles.alertTypes}>{summary.alertTypes.join(' • ')}</Text>}
            </View>
          </View>
        )}

        <Text style={styles.obsCount}>{summary.observationCount} observations</Text>
      </View>

      {records.length >= 2 && (
        <>
          <Text style={styles.sectionTitle}>Graphs</Text>
          {temps.length >= 2 && <SimpleGraph title="Temperature (°F)" values={temps} color={Colors.temperature} unit="°F" />}
          {pressures.length >= 2 && <SimpleGraph title="Pressure (inHg)" values={pressures} color={Colors.pressure} unit='"' />}
          {humidities.length >= 2 && <SimpleGraph title="Humidity (%)" values={humidities} color={Colors.humidity} unit="%" />}
          {winds.length >= 2 && <SimpleGraph title="Wind Speed (mph)" values={winds} color={Colors.wind} unit=" mph" />}
        </>
      )}

      {records.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Observations</Text>
          {records.map((obs) => {
            const historicalAlerts = sortAlertTypes(parseStoredAlertTypes(obs.nwsAlerts));
            return (
              <View key={obs.id} style={styles.obsCard}>
                <Text style={styles.obsTime}>{formatTime(obs.timestamp)}</Text>
                <View style={styles.obsData}>
                  <Text style={[styles.obsValue, { color: Colors.temperature }]}>{obs.temperature != null ? `${Math.round(obs.temperature)}°F` : '--'}</Text>
                  <Text style={[styles.obsValue, { color: Colors.wind }]}>{obs.windSpeed != null ? `${Math.round(obs.windSpeed)} mph` : '--'}</Text>
                  <Text style={[styles.obsValue, { color: Colors.humidity }]}>{obs.humidity != null ? `${Math.round(obs.humidity)}%` : '--'}</Text>
                  <Text style={[styles.obsValue, { color: Colors.textSecondary }]}>{obs.weatherCondition ?? '--'}</Text>
                </View>
                {historicalAlerts.length > 0 && (
                  <View style={styles.obsAlerts}>
                    {historicalAlerts.map((alert) => (
                      <View key={alert.event} style={styles.obsAlertRow}>
                        <Ionicons name="warning" size={11} color={alertToneColor(alert.tone)} />
                        <Text style={[styles.obsAlertText, { color: alertToneColor(alert.tone) }]}>{alert.event}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function SimpleGraph({ title, values, color, unit }: { title: string; values: number[]; color: string; unit: string }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 0.01);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const barWidth = Math.max(2, Math.floor(280 / values.length) - 1);

  return (
    <View style={graphStyles.container}>
      <Text style={[graphStyles.title, { color }]}>{title}</Text>
      <View style={graphStyles.stats}>
        <Text style={graphStyles.stat}>Min: {min.toFixed(1)}{unit}</Text>
        <Text style={graphStyles.stat}>Avg: {avg.toFixed(1)}{unit}</Text>
        <Text style={graphStyles.stat}>Max: {max.toFixed(1)}{unit}</Text>
      </View>
      <View style={graphStyles.bars}>
        {values.map((val, i) => {
          const height = Math.max(4, ((val - min) / range) * 80);
          return <View key={i} style={[graphStyles.bar, { height, width: barWidth, backgroundColor: color, opacity: 0.5 + (val - min) / range * 0.5 }]} />;
        })}
      </View>
    </View>
  );
}

const graphStyles = StyleSheet.create({
  container: { backgroundColor: Colors.surface, borderRadius: BORDER_RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md },
  title: { fontSize: 14, fontWeight: '700', marginBottom: SPACING.xs },
  stats: { flexDirection: 'row', gap: SPACING.md, marginBottom: SPACING.sm },
  stat: { color: Colors.textSecondary, fontSize: 11 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 84, gap: 1 },
  bar: { borderRadius: 1 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: SPACING.lg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  dateTitle: { color: Colors.white, fontSize: 20, fontWeight: '700', marginBottom: SPACING.lg },
  card: { backgroundColor: Colors.surface, borderRadius: BORDER_RADIUS.md, padding: SPACING.lg, marginBottom: SPACING.md },
  cardTitle: { color: Colors.primary, fontSize: 14, fontWeight: '700', marginBottom: SPACING.md, textTransform: 'uppercase' },
  summaryGrid: { flexDirection: 'row', gap: SPACING.md, marginBottom: SPACING.md },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryLabel: { color: Colors.textSecondary, fontSize: 11, textTransform: 'uppercase', marginBottom: 2 },
  summaryValue: { fontSize: 16, fontWeight: '700' },
  pressureRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  alertSection: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, marginTop: SPACING.sm, padding: SPACING.sm, backgroundColor: Colors.warning + '15', borderRadius: BORDER_RADIUS.sm },
  alertSummaryContent: { flex: 1 },
  alertTypes: { color: Colors.warning, fontSize: 11, lineHeight: 16 },
  obsCount: { color: Colors.textSecondary, fontSize: 12, marginTop: SPACING.sm },
  sectionTitle: { color: Colors.text, fontSize: 18, fontWeight: '700', marginBottom: SPACING.md, marginTop: SPACING.sm },
  obsCard: { backgroundColor: Colors.surface, borderRadius: BORDER_RADIUS.sm, padding: SPACING.md, marginBottom: SPACING.sm },
  obsTime: { color: Colors.primary, fontSize: 13, fontWeight: '600', marginBottom: SPACING.xs },
  obsData: { flexDirection: 'row', gap: SPACING.md, flexWrap: 'wrap' },
  obsValue: { fontSize: 12, fontWeight: '500' },
  obsAlerts: { marginTop: SPACING.xs, gap: 3 },
  obsAlertRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  obsAlertText: { fontSize: 10, fontWeight: '600', flexShrink: 1 },
});
