import React, { useEffect, useRef } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import type { EventSubscription } from 'expo-modules-core';
import { Colors } from '../src/constants/theme';
import {
  AUTOMATIC_STORM_STOP_CATEGORY,
  KEEP_RECORDING_ACTION,
  STOP_RECORDING_ACTION,
  ensureNotificationChannels,
  requestNotificationPermission,
} from '../src/services/notifications';
import { handleAutomaticStormStopAction } from '../src/services/stormLogs/automaticStormLifecycle';
import { initializeDailyMonitorCoordinator } from '../src/services/background/dailyMonitor';

import '../src/services/background/dailyMonitor';

function eventIdFromNotification(data: Record<string, unknown> | undefined): number | null {
  const value = Number(data?.stormEventId);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export default function RootLayout() {
  const notificationListener = useRef<EventSubscription | null>(null);
  const responseListener = useRef<EventSubscription | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        await ensureNotificationChannels();
        await requestNotificationPermission();
      } catch (error) {
        console.warn('[ROOT] Notification setup failed:', error);
      }

      try {
        await initializeDailyMonitorCoordinator();
        console.log('[ROOT] Daily Monitor runtime initialized');
      } catch (error) {
        console.error('[ROOT] Daily Monitor runtime initialization failed:', error);
      }
    })();

    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('[ROOT] Notification received:', notification.request.content.title);
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      console.log('[ROOT] Notification response:', response.notification.request.content.title, response.actionIdentifier);
      if (data?.category !== AUTOMATIC_STORM_STOP_CATEGORY) return;
      const eventId = eventIdFromNotification(data);
      if (eventId == null) return;
      if (response.actionIdentifier !== KEEP_RECORDING_ACTION && response.actionIdentifier !== STOP_RECORDING_ACTION) {
        return;
      }
      void handleAutomaticStormStopAction(response.actionIdentifier, eventId).catch((error) => {
        console.error('[ROOT] Automatic storm decision failed:', error);
      });
    });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
      notificationListener.current = null;
      responseListener.current = null;
    };
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
          contentStyle: { backgroundColor: Colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="event/[id]" options={{ title: 'Storm Event Details', headerBackTitle: 'Back' }} />
        <Stack.Screen name="daily/[date]" options={{ title: 'Daily Details', headerBackTitle: 'Back' }} />
        <Stack.Screen name="analysis-test" options={{ title: 'Analysis Test', headerBackTitle: 'Back' }} />
      </Stack>
    </>
  );
}
