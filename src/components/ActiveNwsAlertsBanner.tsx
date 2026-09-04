import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, SPACING, BORDER_RADIUS } from '../constants/theme';
import { getActiveAlertTypes } from '../services/nws/alerts';
import { sortAlertTypes, type AlertDisplayTone } from '../services/nws/alertDisplay';
import { LightningSafetyBanner } from './LightningSafetyBanner';

type Props = {
  latitude: number | null;
  longitude: number | null;
};

function toneColor(tone: AlertDisplayTone): string {
  if (tone === 'critical') return Colors.danger;
  if (tone === 'warning') return Colors.warning;
  if (tone === 'watch') return Colors.warning;
  return Colors.textSecondary;
}

export function ActiveNwsAlertsBanner({ latitude, longitude }: Props) {
  const [alertTypes, setAlertTypes] = useState<string[]>([]);
  const [lookupAvailable, setLookupAvailable] = useState(true);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (latitude == null || longitude == null) return;
    setLoading(true);
    try {
      const active = await getActiveAlertTypes(latitude, longitude);
      setAlertTypes(active);
      setLookupAvailable(true);
    } catch (error) {
      console.warn('[NWS-HOME] Active alert lookup failed:', error);
      setLookupAvailable(false);
    } finally {
      setLoading(false);
    }
  }, [latitude, longitude]);

  useEffect(() => {
    if (latitude == null || longitude == null) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(timer);
  }, [latitude, longitude, refresh]);

  let nwsContent: React.ReactNode = null;

  if (latitude != null && longitude != null) {
    if (!lookupAvailable) {
      nwsContent = (
        <View style={[styles.statusBanner, styles.unavailableBanner]}>
          <Ionicons name="warning-outline" size={15} color={Colors.warning} />
          <Text style={[styles.statusText, { color: Colors.warning }]}>NWS alerts unavailable</Text>
        </View>
      );
    } else {
      const alerts = sortAlertTypes(alertTypes);
      if (alerts.length === 0) {
        nwsContent = (
          <View style={[styles.statusBanner, styles.clearBanner]}>
            <Ionicons name="shield-checkmark-outline" size={15} color={Colors.loggingActive} />
            <Text style={[styles.statusText, { color: Colors.loggingActive }]}>
              {loading ? 'Checking NWS alerts…' : 'No active NWS alerts'}
            </Text>
          </View>
        );
      } else {
        const highestColor = toneColor(alerts[0].tone);
        nwsContent = (
          <View style={[styles.alertCard, { borderColor: highestColor }]}>
            <View style={styles.headerRow}>
              <Ionicons name="warning" size={17} color={highestColor} />
              <Text style={[styles.headerText, { color: highestColor }]}>ACTIVE NWS ALERTS</Text>
            </View>
            {alerts.map((alert) => {
              const color = toneColor(alert.tone);
              return (
                <View key={alert.event} style={styles.alertRow}>
                  <View style={[styles.alertDot, { backgroundColor: color }]} />
                  <Text style={[styles.alertText, { color }]}>{alert.event}</Text>
                </View>
              );
            })}
          </View>
        );
      }
    }
  }

  return (
    <>
      {nwsContent}
      <LightningSafetyBanner />
    </>
  );
}

const styles = StyleSheet.create({
  statusBanner: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.sm,
    marginBottom: SPACING.lg,
  },
  clearBanner: { backgroundColor: Colors.loggingActive + '12' },
  unavailableBanner: { backgroundColor: Colors.warning + '12' },
  statusText: { fontSize: 11, fontWeight: '600' },
  alertCard: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginBottom: SPACING.sm },
  headerText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 3 },
  alertDot: { width: 7, height: 7, borderRadius: 4 },
  alertText: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
});
