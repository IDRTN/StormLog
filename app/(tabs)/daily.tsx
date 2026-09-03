import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Share,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, SPACING, BORDER_RADIUS } from '../../src/constants/theme';
import { useDailyMonitor } from '../../src/hooks/useDailyMonitor';
import {
  getAllDailyRecords,
  getDailySummary,
  getDailyRecordCount,
  getWeatherLocalDayReferences,
  deleteDailyRecordsForDate,
} from '../../src/database/dailyWeather';
import { serializeDailyWeatherBackup } from '../../src/services/export/dailyWeatherBackup';
import type { DailySummary } from '../../src/models/types';

export default function DailyScreen() {
  const router = useRouter();
  const monitor = useDailyMonitor();
  const [dates, setDates] = useState<string[]>([]);
  const [summaries, setSummaries] = useState<Map<string, DailySummary>>(new Map());
  const [dayOffsets, setDayOffsets] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await monitor.refreshStatus();
      const dayReferences = await getWeatherLocalDayReferences();
      const offsets = new Map(
        dayReferences.map(({ dateString, utcOffsetSeconds }) => [dateString, utcOffsetSeconds])
      );
      const availDates = dayReferences.map(({ dateString }) => dateString);
      setDates(availDates);
      setDayOffsets(offsets);
      const summaryMap = new Map<string, DailySummary>();
      for (const d of availDates) {
        summaryMap.set(d, await getDailySummary(d, offsets.get(d)));
      }
      setSummaries(summaryMap);
    } catch (e) {
      console.error('Failed to load daily data:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleExportBackup = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const records = await getAllDailyRecords();
      if (records.length === 0) {
        Alert.alert('Nothing to Back Up', 'There are no Daily Monitor observations to export yet.');
        return;
      }

      const payload = serializeDailyWeatherBackup(records);
      await Share.share({
        title: `StormLog Daily Monitor Backup (${records.length} observations)`,
        message: payload,
      });
    } catch (error: any) {
      console.error('Failed to export Daily Monitor backup:', error);
      Alert.alert('Backup Failed', error?.message ?? 'Unable to export Daily Monitor observations.');
    } finally {
      setExporting(false);
    }
  }, [exporting]);

  const handleDeleteDay = (dateStr: string) => {
    const formatted = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
    Alert.alert('Delete Day', `Delete all weather history for ${formatted}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const utcOffsetSeconds = dayOffsets.get(dateStr);
          if (utcOffsetSeconds == null) return;
          const deleted = await deleteDailyRecordsForDate(dateStr, utcOffsetSeconds);
          Alert.alert('Deleted', `${deleted} observation(s) removed.`);
          loadData();
        },
      },
    ]);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
  };

  const formatTs = (ts: number | null) =>
    ts ? new Date(ts).toLocaleString() : 'Never';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={loadData} tintColor={Colors.primary} />}
    >
      {/* Monitor Status Card */}
      <View style={styles.statusCard}>
        <View style={styles.statusHeader}>
          <Ionicons
            name={monitor.isActive ? 'radio' : 'radio-outline'}
            size={20}
            color={monitor.isActive ? Colors.loggingActive : Colors.danger}
          />
          <Text style={[styles.statusTitle, { color: monitor.isActive ? Colors.loggingActive : Colors.danger }]}>
            {monitor.isActive ? 'MONITORING ACTIVE' : 'MONITORING NOT RUNNING'}
          </Text>
        </View>

        <View style={styles.statusDetail}>
          <Text style={styles.statusLabel}>Interval:</Text>
          <Text style={styles.statusValue}>{monitor.intervalMinutes} minutes</Text>
        </View>
        <View style={styles.statusDetail}>
          <Text style={styles.statusLabel}>Total Observations:</Text>
          <Text style={styles.statusValue}>{monitor.totalRecords}</Text>
        </View>
        <View style={styles.statusDetail}>
          <Text style={styles.statusLabel}>Last Collection:</Text>
          <Text style={styles.statusValue}>{formatTs(monitor.lastCollectionTime)}</Text>
        </View>
        {monitor.lastError && (
          <View style={styles.statusDetail}>
            <Text style={[styles.statusLabel, { color: Colors.danger }]}>Last Error:</Text>
            <Text style={[styles.statusValue, { color: Colors.danger, flex: 1 }]} numberOfLines={2}>
              {monitor.lastError}
            </Text>
          </View>
        )}

        <View style={styles.statusActions}>
          {monitor.isActive ? (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: Colors.danger }]}
              onPress={monitor.stopMonitor}
            >
              <Text style={styles.actionBtnText}>Stop Monitor</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: Colors.loggingActive }]}
              onPress={() => monitor.startMonitor()}
            >
              <Text style={styles.actionBtnText}>Start Monitor</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: Colors.primary }]}
            onPress={async () => {
              const result = await monitor.collectNow();
              Alert.alert(
                result.success ? 'SUCCESS' : 'FAILED',
                result.success
                  ? 'Weather observation saved.'
                  : `Failed: ${result.error}`
              );
              loadData();
            }}
          >
            <Text style={styles.actionBtnText}>Collect Now</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.backupBtn, exporting && styles.backupBtnDisabled]}
          onPress={handleExportBackup}
          disabled={exporting}
        >
          <Ionicons name="cloud-upload-outline" size={18} color={Colors.primary} />
          <View style={styles.backupTextWrap}>
            <Text style={styles.backupTitle}>{exporting ? 'Preparing Backup…' : 'Export Daily Backup'}</Text>
            <Text style={styles.backupSubtitle}>Share a versioned copy of all Daily Monitor observations</Text>
          </View>
        </TouchableOpacity>

        {monitor.error && (
          <Text style={styles.errorText}>{monitor.error}</Text>
        )}
      </View>

      {/* Date list */}
      <Text style={styles.sectionTitle}>Daily History</Text>

      {dates.length === 0 && !loading ? (
        <View style={styles.empty}>
          <Ionicons name="cloud-outline" size={40} color={Colors.surfaceVariant} />
          <Text style={styles.emptyText}>No daily data yet</Text>
          <Text style={styles.emptySubtext}>Tap "Collect Now" or start monitoring</Text>
        </View>
      ) : (
        dates.map((dateStr) => {
          const s = summaries.get(dateStr);
          return (
            <TouchableOpacity
              key={dateStr}
              style={styles.dayCard}
              onPress={() => router.push(`/daily/${dateStr}`)}
              activeOpacity={0.7}
            >
              <View style={styles.dayHeader}>
                <Text style={styles.dayDate}>{formatDate(dateStr)}</Text>
                <TouchableOpacity
                  onPress={(e) => { e.stopPropagation?.(); handleDeleteDay(dateStr); }}
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={18} color={Colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <View style={styles.dayGrid}>
                {s?.highTemp != null && <DayStat label="High" value={`${Math.round(s.highTemp)}°F`} color={Colors.temperature} />}
                {s?.lowTemp != null && <DayStat label="Low" value={`${Math.round(s.lowTemp)}°F`} color={Colors.primary} />}
                {s?.avgTemp != null && <DayStat label="Avg" value={`${Math.round(s.avgTemp)}°F`} color={Colors.textSecondary} />}
                {s?.maxWind != null && <DayStat label="Wind" value={`${Math.round(s.maxWind)} mph`} color={Colors.wind} />}
                {s?.maxGust != null && <DayStat label="Gust" value={`${Math.round(s.maxGust)} mph`} color={Colors.warning} />}
                {s?.avgHumidity != null && <DayStat label="Humidity" value={`${s.avgHumidity}%`} color={Colors.humidity} />}
              </View>

              {s?.totalPrecip != null && (
                <View style={styles.dayRow}>
                  <Ionicons name="rainy" size={14} color={Colors.precipitation} />
                  <Text style={styles.dayRowText}>Rain: {s.totalPrecip.toFixed(2)}"</Text>
                </View>
              )}

              {s?.minPressure != null && s?.maxPressure != null && (
                <View style={styles.dayRow}>
                  <Ionicons name="speedometer" size={14} color={Colors.pressure} />
                  <Text style={styles.dayRowText}>
                    Pressure: {s.maxPressure.toFixed(2)} → {s.minPressure.toFixed(2)}"
                  </Text>
                </View>
              )}

              {s?.alertCount != null && s.alertCount > 0 && (
                <View style={styles.dayRow}>
                  <Ionicons name="warning" size={14} color={Colors.warning} />
                  <Text style={[styles.dayRowText, { color: Colors.warning }]}>
                    Alerts: {s.alertCount}{s.alertTypes.length > 0 ? ` (${s.alertTypes.join(', ')})` : ''}
                  </Text>
                </View>
              )}

              <View style={styles.dayRow}>
                <Ionicons name="analytics" size={14} color={Colors.textSecondary} />
                <Text style={styles.dayRowText}>{s?.observationCount ?? 0} observations</Text>
              </View>
            </TouchableOpacity>
          );
        })
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function DayStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={{ color: Colors.textSecondary, fontSize: 10, textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ fontSize: 14, fontWeight: '700', color }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: SPACING.lg },
  statusCard: {
    backgroundColor: Colors.surface, borderRadius: BORDER_RADIUS.md,
    padding: SPACING.lg, marginBottom: SPACING.xl,
  },
  statusHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md },
  statusTitle: { fontSize: 16, fontWeight: '700' },
  statusDetail: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.xs },
  statusLabel: { color: Colors.textSecondary, fontSize: 13 },
  statusValue: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  statusActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  actionBtn: { flex: 1, paddingVertical: SPACING.sm, borderRadius: BORDER_RADIUS.sm, alignItems: 'center' },
  actionBtnText: { color: Colors.white, fontSize: 13, fontWeight: '600' },
  backupBtn: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: BORDER_RADIUS.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  backupBtnDisabled: { opacity: 0.6 },
  backupTextWrap: { flex: 1 },
  backupTitle: { color: Colors.primary, fontSize: 13, fontWeight: '700' },
  backupSubtitle: { color: Colors.textSecondary, fontSize: 11, marginTop: 2 },
  errorText: { color: Colors.danger, fontSize: 12, marginTop: SPACING.sm },
  sectionTitle: { color: Colors.text, fontSize: 18, fontWeight: '700', marginBottom: SPACING.md },
  dayCard: {
    backgroundColor: Colors.surface, borderRadius: BORDER_RADIUS.md,
    padding: SPACING.lg, marginBottom: SPACING.sm,
  },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  dayDate: { color: Colors.white, fontSize: 16, fontWeight: '600' },
  dayGrid: { flexDirection: 'row', marginBottom: SPACING.sm },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginBottom: 2 },
  dayRowText: { color: Colors.textSecondary, fontSize: 12 },
  empty: { alignItems: 'center', paddingVertical: SPACING.xxl, gap: SPACING.sm },
  emptyText: { color: Colors.text, fontSize: 16, fontWeight: '600' },
  emptySubtext: { color: Colors.textSecondary, fontSize: 13 },
});
