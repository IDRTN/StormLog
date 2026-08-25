import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, SPACING, BORDER_RADIUS } from '../../src/constants/theme';
import { getAllStormEvents, deleteStormEvent } from '../../src/database/stormEvents';
import { getObservationCount } from '../../src/database/observations';
import type { StormEventWithWarningMetadata } from '../../src/database/stormEvents';
import { getWarningEventDisplay } from '../../src/services/stormLogs/warningDisplay';

interface EventWithCount extends StormEventWithWarningMetadata {
  observationCount: number;
}

export default function HistoryScreen() {
  const router = useRouter();
  const [events, setEvents] = useState<EventWithCount[]>([]);

  const loadEvents = useCallback(async () => {
    const allEvents = await getAllStormEvents();
    const withCounts = await Promise.all(
      allEvents.map(async (event) => ({
        ...event,
        observationCount: await getObservationCount(event.id),
      }))
    );
    setEvents(withCounts);
  }, []);

  useFocusEffect(useCallback(() => {
    loadEvents();
  }, [loadEvents]));

  const handleDelete = (event: EventWithCount) => {
    Alert.alert('Delete Event', `Delete "${event.eventName}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteStormEvent(event.id);
          loadEvents();
        },
      },
    ]);
  };

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const formatDateTime = (ts: number) =>
    new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const renderItem = ({ item }: { item: EventWithCount }) => {
    const warningDisplay = getWarningEventDisplay(item);

    return (
    <TouchableOpacity
      style={styles.eventCard}
      onPress={() => router.push(`/event/${item.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.eventHeader}>
        <Text style={styles.eventName} numberOfLines={1}>{item.eventName}</Text>
        <TouchableOpacity onPress={() => handleDelete(item)} hitSlop={8}>
          <Ionicons name="trash-outline" size={18} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.eventRow}>
        <Ionicons name="calendar" size={14} color={Colors.primary} />
        <Text style={styles.eventDetail}>{formatDate(item.startTime)}</Text>
      </View>
      <View style={styles.eventRow}>
        <Ionicons name="time" size={14} color={Colors.primary} />
        <Text style={styles.eventDetail}>
          {formatTime(item.startTime)} - {item.endTime ? formatTime(item.endTime) : 'Active'}
        </Text>
      </View>
      <View style={styles.eventRow}>
        <Ionicons name="location" size={14} color={Colors.warning} />
        <Text style={styles.eventDetail}>
          {item.startLatitude.toFixed(3)}°N, {Math.abs(item.startLongitude).toFixed(3)}°W
        </Text>
      </View>
      <View style={styles.eventRow}>
        <Ionicons name="analytics" size={14} color={Colors.secondary} />
        <Text style={styles.eventDetail}>{item.observationCount} observations</Text>
      </View>

      {warningDisplay.sourceLabel == null && item.endTime === null && (
        <View style={styles.activeBadge}>
          <Text style={styles.activeBadgeText}>● ACTIVE</Text>
        </View>
      )}

      {warningDisplay.sourceLabel != null && (
        <View
          style={styles.warningBadge}
          accessible
          accessibilityLabel={`${warningDisplay.sourceLabel}. ${warningDisplay.warningType}. ${warningDisplay.lifecycleLabel}`}
        >
          <Text style={styles.warningSourceText}>{warningDisplay.sourceLabel}</Text>
          <Text style={styles.warningTypeText}>{warningDisplay.warningType}</Text>
          <Text
            style={[
              styles.warningStatusText,
              { color: warningDisplay.lifecycleTone === 'active' ? Colors.loggingActive : Colors.textSecondary },
            ]}
          >
            ● {warningDisplay.lifecycleLabel}
          </Text>
          {warningDisplay.warningEndsAt != null && (
            <Text style={styles.warningExpirationText}>Ends {formatDateTime(warningDisplay.warningEndsAt)}</Text>
          )}
        </View>
      )}
    </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {events.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="thunderstorm-outline" size={48} color={Colors.surfaceVariant} />
          <Text style={styles.emptyTitle}>No Storm Events</Text>
          <Text style={styles.emptySubtitle}>Press START STORM LOG from the Home screen</Text>
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  list: { padding: SPACING.lg, gap: SPACING.sm },
  eventCard: {
    backgroundColor: Colors.surface, borderRadius: BORDER_RADIUS.md, padding: SPACING.lg,
  },
  eventHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm,
  },
  eventName: { color: Colors.white, fontSize: 16, fontWeight: '600', flex: 1, marginRight: SPACING.sm },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.xs },
  eventDetail: { color: Colors.textSecondary, fontSize: 13 },
  activeBadge: { marginTop: SPACING.sm },
  activeBadgeText: { color: Colors.primary, fontSize: 12, fontWeight: '700' },
  warningBadge: { marginTop: SPACING.sm },
  warningSourceText: { color: Colors.warning, fontSize: 11, fontWeight: '700' },
  warningTypeText: { color: Colors.white, fontSize: 14, fontWeight: '600', marginTop: 2 },
  warningStatusText: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  warningExpirationText: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: SPACING.sm },
  emptyTitle: { color: Colors.text, fontSize: 18, fontWeight: '600' },
  emptySubtitle: { color: Colors.textSecondary, fontSize: 14 },
});
