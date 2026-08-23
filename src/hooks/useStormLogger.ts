import { useState, useEffect, useRef, useCallback } from 'react';
import { createStormEvent, endStormEvent, getActiveStormEvent } from '../database/stormEvents';
import { insertObservation } from '../database/observations';
import { fetchWeather } from '../services/weather';
import { notifyStormLogStarted, notifyStormLogStopped, notifyCollectionFailed } from '../services/notifications';
import type { LocationData } from '../models/types';
import * as Location from 'expo-location';

export interface StormLoggerState {
  isLogging: boolean;
  activeEventId: number | null;
  lastObservationTime: number | null;
  observationCount: number;
  error: string | null;
  intervalMinutes: number;
}

export function useStormLogger() {
  const [state, setState] = useState<StormLoggerState>({
    isLogging: false,
    activeEventId: null,
    lastObservationTime: null,
    observationCount: 0,
    error: null,
    intervalMinutes: 5,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventIdRef = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      const active = await getActiveStormEvent();
      if (active) {
        setState(s => ({ ...s, isLogging: true, activeEventId: active.id }));
        eventIdRef.current = active.id;
        startPeriodicFetch(active.id, state.intervalMinutes);
      }
    })();
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const doWeatherFetch = useCallback(async (eventId: number) => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const result = await fetchWeather(loc.coords.latitude, loc.coords.longitude);

      if (result.success) {
        await insertObservation({
          timestamp: Date.now(),
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          temperature: result.data.temperature,
          humidity: result.data.humidity,
          pressure: result.data.pressure,
          windSpeed: result.data.windSpeed,
          windDirection: result.data.windDirection,
          windGust: result.data.windGust,
          dewPoint: result.data.dewPoint,
          precipitation: result.data.precipitation,
          weatherCondition: result.data.weatherCondition,
          stormEventId: eventId,
        });
        setState(s => ({ ...s, lastObservationTime: Date.now(), observationCount: s.observationCount + 1 }));
      }
    } catch (err: any) {
      const msg = err?.message || 'Unknown error';
      setState(s => ({ ...s, error: `Observation failed: ${msg}` }));
      await notifyCollectionFailed(`Storm log: ${msg}`);
    }
  }, []);

  const startPeriodicFetch = useCallback((eventId: number, intervalMinutes: number) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const ms = intervalMinutes * 60 * 1000;
    intervalRef.current = setInterval(() => doWeatherFetch(eventId), ms);
  }, [doWeatherFetch]);

  const startStormLog = useCallback(async (location: LocationData | null) => {
    const lat = location?.latitude ?? 0;
    const lon = location?.longitude ?? 0;
    const eventId = await createStormEvent(lat, lon);
    eventIdRef.current = eventId;

    setState(s => ({ ...s, isLogging: true, activeEventId: eventId, observationCount: 0, error: null }));

    // Immediate first observation
    await doWeatherFetch(eventId);
    startPeriodicFetch(eventId, state.intervalMinutes);

    // Notify user
    await notifyStormLogStarted();
  }, [doWeatherFetch, startPeriodicFetch, state.intervalMinutes]);

  const stopStormLog = useCallback(async () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }

    const eventId = eventIdRef.current;
    const obsCount = state.observationCount;
    if (eventId) {
      let endLat: number | null = null;
      let endLon: number | null = null;
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          endLat = loc.coords.latitude;
          endLon = loc.coords.longitude;
        }
      } catch {}
      await endStormEvent(eventId, endLat, endLon);
    }

    eventIdRef.current = null;
    setState(s => ({ ...s, isLogging: false, activeEventId: null, lastObservationTime: null, error: null }));

    await notifyStormLogStopped(obsCount);
  }, [state.observationCount]);

  const setIntervalMinutes = useCallback((minutes: number) => {
    setState(s => ({ ...s, intervalMinutes: minutes }));
    if (state.isLogging && eventIdRef.current) startPeriodicFetch(eventIdRef.current, minutes);
  }, [state.isLogging, startPeriodicFetch]);

  return { ...state, startStormLog, stopStormLog, setIntervalMinutes, doWeatherFetch };
}
