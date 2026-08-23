import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Colors, SPACING, BORDER_RADIUS } from '../../src/constants/theme';
import { useStormLogger } from '../../src/hooks/useStormLogger';
import { useDailyMonitor } from '../../src/hooks/useDailyMonitor';
import { performDailyCollection } from '../../src/services/background/dailyMonitor';
import { requestNotificationPermission, sendNotification } from '../../src/services/notifications';
import { deleteAllDailyRecords, getDailyRecordCount } from '../../src/database/dailyWeather';

const STORM_INTERVALS = [
  { value: 1, label: '1 minute' },
  { value: 5, label: '5 minutes (default)' },
  { value: 10, label: '10 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
];

const DAILY_INTERVALS = [
  { value: 5, label: '5 minutes' },
  { value: 10, label: '10 minutes' },
  { value: 15, label: '15 minutes (default)' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '60 minutes' },
];

export default function SettingsScreen() {
  const { intervalMinutes: stormInterval, isLogging } = useStormLogger();
  const daily = useDailyMonitor();
  const router = useRouter();

  const [locationPermission, setLocationPermission] = useState<boolean | null>(null);
  const [notifPermission, setNotifPermission] = useState<boolean | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [notifTestResult, setNotifTestResult] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const loc = await Location.getForegroundPermissionsAsync();
      setLocationPermission(loc.status === 'granted');
      const notif = await Notifications.getPermissionsAsync();
      setNotifPermission(notif.status === 'granted');
    })();
  }, []);

  const requestLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    setLocationPermission(status === 'granted');
  };

  const requestNotifications = async () => {
    const granted = await requestNotificationPermission();
    setNotifPermission(granted);
  };

  const handleTestNotification = async () => {
    setNotifTestResult('Sending...');
    try {
      await sendNotification(
        '🔔 Test Notification',
        `Storm Log notifications are working! Sent at ${new Date().toLocaleTimeString()}`
      );
      setNotifTestResult('✅ Notification sent! Check your notification shade.\n\nIf you don\'t see it, check:\n1. Battery optimization (see below)\n2. Notification channel is enabled\n3. Device Do Not Disturb is off');
    } catch (err: any) {
      setNotifTestResult(`❌ Failed: ${err?.message}`);
    }
    setTimeout(() => setNotifTestResult(null), 10000);
  };

  const handleRunNow = async () => {
    setTestLoading(true);
    setTestResult(null);
    const result = await performDailyCollection();
    if (result.success) {
      setTestResult({ ok: true, msg: 'SUCCESS: Weather observation saved + notification sent.' });
    } else {
      setTestResult({ ok: false, msg: `FAILED: ${result.error}` });
    }
    daily.refreshStatus();
    setTestLoading(false);
  };

  const handleDeleteAll = async () => {
    const count = await getDailyRecordCount();
    Alert.alert('Delete All Daily History', `Delete ALL ${count} observations? Storm events are NOT affected.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete All', style: 'destructive', onPress: async () => { await deleteAllDailyRecords(); Alert.alert('Done', 'All daily observations removed.'); } },
    ]);
  };

  const formatTs = (ts: number | null) => ts ? new Date(ts).toLocaleString() : 'Never';

  const openBatterySettings = async () => {
    try {
      if (Platform.OS === 'android') {
        await Linking.openURL('package:com.stormlog.app');
      }
    } catch {
      try {
        await Linking.openSettings();
      } catch {
        Alert.alert('Settings', 'Open Android Settings > Apps > Storm Log > Battery > Unrestricted');
      }
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Section title="📊 Database Status">
        <StatusRow label="Daily Monitoring" value={daily.isActive ? 'ACTIVE' : 'INACTIVE'} color={daily.isActive ? Colors.loggingActive : Colors.danger} />
        <StatusRow label="Total Observations" value={String(daily.totalRecords)} />
        <StatusRow label="Last Collection" value={formatTs(daily.lastCollectionTime)} />
        <StatusRow label="Last Error" value={daily.lastError || 'None'} color={daily.lastError ? Colors.danger : Colors.secondary} />
        <StatusRow label="Interval" value={`${daily.intervalMinutes} min`} />
      </Section>

      <Section title="🔔 Notifications">
        <Text style={styles.hint}>Send a test notification to verify notifications are working</Text>
        <TouchableOpacity style={[styles.toggleBtn, { backgroundColor: Colors.primary }]} onPress={handleTestNotification}>
          <Text style={styles.toggleBtnText}>Send Test Notification</Text>
        </TouchableOpacity>
        {notifTestResult && (
          <View style={[styles.resultBox, { backgroundColor: Colors.primary + '20' }]}>
            <Text style={{ color: Colors.text, fontSize: 13, lineHeight: 18 }}>{notifTestResult}</Text>
          </View>
        )}

        <View style={{ marginTop: SPACING.md }}>
          <PermRow label="Notification Permission" granted={notifPermission} onReq={requestNotifications} />
        </View>
      </Section>

      <Section title="🔋 Samsung Battery Optimization">
        <Text style={[styles.hint, { color: Colors.warning, lineHeight: 18 }]}>
          ⚠️ Samsung devices aggressively kill background apps. This is the #1 cause of missing notifications and stopped weather collection.
        </Text>
        <Text style={styles.hint}>
          {'\n'}To fix notifications and monitoring:
        </Text>
        <Text style={styles.hint}>
          {'1. '}Open Android Settings → Apps → Storm Log{'\n'}
          {'2. '}Tap Battery → Select "Unrestricted"{'\n'}
          {'3. '}Open Android Settings → Battery → Background usage limits{'\n'}
          {'4. '}Remove Storm Log from "Sleeping apps" and "Deep sleeping apps"{'\n'}
          {'5. '}Ensure "Auto optimize" is OFF for Storm Log
        </Text>
        <TouchableOpacity style={[styles.toggleBtn, { backgroundColor: Colors.warning }]} onPress={openBatterySettings}>
          <Text style={styles.toggleBtnText}>Open App Settings</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>
          {'\n'}Also check: Settings → Notifications → Storm Log → Make sure all channels are ON and set to "Alert" (not Silent)
        </Text>
      </Section>

      <Section title="⚙️ Daily Monitor Settings">
        <Text style={styles.hint}>Select weather collection interval</Text>
        {DAILY_INTERVALS.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            style={[styles.optionRow, daily.intervalMinutes === opt.value && styles.optionRowActive]}
            onPress={() => daily.setIntervalMinutes(opt.value)}
          >
            <View style={[styles.radio, daily.intervalMinutes === opt.value && styles.radioActive]}>
              {daily.intervalMinutes === opt.value && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary }} />}
            </View>
            <Text style={[styles.optionText, daily.intervalMinutes === opt.value && styles.optionTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </Section>

      <Section title="⚙️ Storm Log Settings">
        <Text style={styles.hint}>Storm log observation interval</Text>
        {STORM_INTERVALS.map((opt) => (
          <View key={opt.value} style={styles.optionRow}>
            <View style={[styles.radio, stormInterval === opt.value && styles.radioActive]}>
              {stormInterval === opt.value && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary }} />}
            </View>
            <Text style={[styles.optionText, stormInterval === opt.value && styles.optionTextActive]}>{opt.label}</Text>
          </View>
        ))}
      </Section>

      <Section title="🧪 Developer Tools">
        <Text style={styles.hint}>Manually trigger one weather collection cycle</Text>
        <TouchableOpacity
          style={[styles.toggleBtn, { backgroundColor: Colors.primary }]}
          onPress={handleRunNow}
          disabled={testLoading}
        >
          <Text style={styles.toggleBtnText}>{testLoading ? 'Collecting...' : 'Run Weather Collection Now'}</Text>
        </TouchableOpacity>
        {testResult && (
          <View style={[styles.resultBox, { backgroundColor: testResult.ok ? Colors.loggingActive + '20' : Colors.danger + '20' }]}>
            <Text style={{ color: testResult.ok ? Colors.loggingActive : Colors.danger, fontSize: 13, fontWeight: '600' }}>{testResult.msg}</Text>
          </View>
        )}

        <Text style={[styles.hint, { marginTop: SPACING.md }]}>Test Tornado Possibility analysis engine</Text>
        <TouchableOpacity
          style={[styles.toggleBtn, { backgroundColor: Colors.warning }]}
          onPress={() => router.push('/analysis-test')}
        >
          <Text style={styles.toggleBtnText}>Tornado Analysis Test</Text>
        </TouchableOpacity>
      </Section>

      <Section title="🗑️ Delete Data">
        <TouchableOpacity style={[styles.toggleBtn, { backgroundColor: Colors.danger }]} onPress={handleDeleteAll}>
          <Text style={styles.toggleBtnText}>Delete All Daily History</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>Storm events are NOT affected</Text>
      </Section>

      <Section title="Permissions">
        <PermRow label="Location" granted={locationPermission} onReq={requestLocation} />
        <PermRow label="Notifications" granted={notifPermission} onReq={requestNotifications} note="Check battery optimization if not working" />
      </Section>

      <Section title="About">
        <Text style={styles.aboutTitle}>Storm Log v2.6.0</Text>
        <Text style={styles.aboutText}>Daily weather monitoring with storm logging, push notifications, and tornado possibility analysis.</Text>
        <Text style={[styles.aboutText, { marginTop: SPACING.sm }]}>Device: {Device.modelName || 'Unknown'}</Text>
      </Section>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>;
}

function StatusRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusLabel}>{label}:</Text>
      <Text style={[styles.statusValue, color ? { color } : undefined]}>{value}</Text>
    </View>
  );
}

function PermRow({ label, granted, onReq, note }: { label: string; granted: boolean | null; onReq: () => void; note?: string }) {
  return (
    <View style={{ marginBottom: SPACING.sm }}>
      <View style={styles.permRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
          <Ionicons name={granted ? 'checkmark-circle' : 'alert-circle'} size={18} color={granted ? Colors.secondary : Colors.warning} />
          <Text style={styles.permLabel}>{label}</Text>
        </View>
        <Text style={{ color: granted ? Colors.secondary : Colors.warning, fontSize: 13 }}>{granted === null ? 'Checking...' : granted ? 'Granted' : 'Not Granted'}</Text>
      </View>
      {!granted && granted !== null && (
        <TouchableOpacity style={{ marginLeft: 26 }} onPress={onReq}>
          <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '500' }}>Request Permission</Text>
        </TouchableOpacity>
      )}
      {note && <Text style={{ color: Colors.textSecondary, fontSize: 11, marginLeft: 26, marginTop: 2 }}>{note}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: SPACING.lg, gap: SPACING.lg },
  section: { backgroundColor: Colors.surface, borderRadius: BORDER_RADIUS.md, padding: SPACING.lg },
  sectionTitle: { color: Colors.primary, fontSize: 14, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SPACING.md },
  hint: { color: Colors.textSecondary, fontSize: 12, marginBottom: SPACING.md },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.sm, borderRadius: BORDER_RADIUS.sm, marginBottom: SPACING.xs },
  optionRowActive: { backgroundColor: Colors.primary + '15' },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: Colors.primary, justifyContent: 'center', alignItems: 'center' },
  radioActive: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
  optionText: { color: Colors.text, fontSize: 14 },
  optionTextActive: { color: Colors.primary, fontWeight: '600' },
  toggleBtn: { paddingVertical: SPACING.md, borderRadius: BORDER_RADIUS.sm, alignItems: 'center', marginTop: SPACING.sm },
  toggleBtnText: { color: Colors.white, fontSize: 14, fontWeight: '600' },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.xs },
  statusLabel: { color: Colors.textSecondary, fontSize: 13 },
  statusValue: { color: Colors.text, fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right' },
  permRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  permLabel: { color: Colors.text, fontSize: 14 },
  resultBox: { marginTop: SPACING.sm, padding: SPACING.md, borderRadius: BORDER_RADIUS.sm },
  aboutTitle: { color: Colors.text, fontSize: 16, fontWeight: '700', marginBottom: SPACING.sm },
  aboutText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
});
