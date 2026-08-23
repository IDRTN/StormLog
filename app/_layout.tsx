import React, { useEffect, useRef } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import type { EventSubscription } from 'expo-modules-core';
import { Colors } from '../src/constants/theme';
import { ensureNotificationChannels, requestNotificationPermission } from '../src/services/notifications';

export default function RootLayout() {
  const notificationListener = useRef<EventSubscription | null>(null);
  const responseListener = useRef<EventSubscription | null>(null);

  useEffect(() => {
    (async () => {
      await ensureNotificationChannels();
      await requestNotificationPermission();
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
