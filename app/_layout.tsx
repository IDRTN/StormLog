import React, { useEffect, useRef } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import type { EventSubscription } from 'expo-modules-core';
import { Colors } from '../src/constants/theme';
import { ensureNotificationChannels, requestNotificationPermission } from '../src/services/notifications';
// Keep background task definitions in the root module graph so Android can
// initialize them when a headless/background task starts without opening a route.
import '../src/services/background/dailyMonitor';
import { repairDailyMonitorAfterStartup } from '../src/services/background/dailyMonitorStartupRepair';

export default function RootLayout() {
  const notificationListener = useRef<EventSubscription | null>(null);
  const responseListener = useRef<EventSubscription | null>(null);

  useEffect(() => {
    (async () => {
      await ensureNotificationChannels();
      await requestNotificationPermission();

      // A fresh JS process can follow an Android package-update restore where
      // expo-location reports the persisted foreground task as running even
      // though its native foreground-service consumer is half-initialized.
      // Repair it once, while the app is definitely foregrounded. This keeps
      // background/headless execution owned by the Daily Monitor coordinator.
      try {
        await repairDailyMonitorAfterStartup();
      } catch (error) {
        console.warn('[ROOT] Daily Monitor startup repair failed:', error);
      }
    })();

    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('[ROOT] Notification received:', notification.request.content.title);
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('[ROOT] Notification tapped:', response.notification.request.content.title);
    });

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
        notificationListener.current = null;
      }
      if (responseListener.current) {
        responseListener.current.remove();
        responseListener.current = null;
      }
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
