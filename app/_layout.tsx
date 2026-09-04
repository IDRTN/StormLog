import React, { useEffect, useRef } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import type { EventSubscription } from 'expo-modules-core';
import { Colors } from '../src/constants/theme';
import { ensureNotificationChannels, requestNotificationPermission } from '../src/services/notifications';
import { initializeDailyMonitorCoordinator } from '../src/services/background/dailyMonitor';

// Importing the module at root keeps TaskManager/headless definitions in the
// startup graph. Runtime repair is also explicitly initialized once below.
import '../src/services/background/dailyMonitor';

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
      console.log('[ROOT] Notification tapped:', response.notification.request.content.title);
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
