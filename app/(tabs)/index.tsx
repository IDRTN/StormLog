import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, SPACING, BORDER_RADIUS } from '../../src/constants/theme';
import { WeatherCard } from '../../src/components/WeatherCard';
import { TornadoAnalysisCard } from '../../src/components/TornadoAnalysisCard';
import { ActiveNwsAlertsBanner } from '../../src/components/ActiveNwsAlertsBanner';
import { useLocation } from '../../src/hooks/useLocation';
import { useStormLogger } from '../../src/hooks/useStormLogger';
import { useDailyMonitor } from '../../src/hooks/useDailyMonitor';
import { useTornadoAnalysis } from '../../src/hooks/useTornadoAnalysis';
import { useLightningSummary } from '../../src/hooks/useLightningSummary';
import { LightningActivityCard } from '../../src/components/LightningActivityCard';
import { fetchWeather } from '../../src/services/weather';
import { getRecentObservations } from '../../src/database/observations';
import { getDailyRecordsForDate } from '../../src/database/dailyWeather';
import { getActiveAlertTypes } from '../../src/services/nws/alerts';
import { getWarningEventDisplay } from '../../src/services/stormLogs/warningDisplay';
import type { WeatherData } from '../../src/models/types';
import type { AnalysisInput } from '../../src/services/analysis/types';

function getWeatherLocalDateString(timestampMs: number, utcOffsetSeconds?: number): string {
  if (utcOffsetSeconds == null) {
    const d = new Date(timestampMs);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const local = new Date(timestampMs + utcOffsetSeconds * 1000);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function HomeScreen() {
  const { location, permission, error: locationError, getCurrentLocation } = useLocation();
  const {
    isLogging,
    activeEvent,
    activeEventId,
    observationCount,
    error: loggerError,
    startStormLog,
    stopStormLog,
    refreshActiveStormEvent,
  } = useStormLogger();
  const automaticWarning = activeEvent?.isAutomatic === true ? activeEvent : null;
  const automaticWarningDisplay = automaticWarning ? getWarningEventDisplay(automaticWarning) : null;
  const dailyMonitor = useDailyMonitor();
  const { result: analysisResult, analyze, loading: analysisLoading, radarStatus } = useTornadoAnalysis();
  const lightningSummary = useLightningSummary(activeEventId);

  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState('');
  const [now, setNow] = useState(new Date());
  const analysisTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analysisInFlightRef = useRef(false);
  const lightningSummaryRef = useRef(lightningSummary.summary);

  useEffect(() => {
    lightningSummaryRef.current = lightningSummary.summary;
  }, [lightningSummary.summary]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadWeather = useCallback(async () => {
    setWeatherLoading(true);
    setWeatherError(null);
    let loc = location;
    if (!loc) loc = await getCurrentLocation();
    if (!loc) {
      setWeatherError('Location unavailable');
      setWeatherLoading(false);
      return;
    }

    const result = await fetchWeather(loc.latitude, loc.longitude);
    if (result.success) {
      setWeather(result.data);
      setLastUpdated(new Date().toLocaleTimeString());
    } else {
      setWeatherError(result.error);
    }
    await refreshActiveStormEvent();
    setWeatherLoading(false);
  }, [location, getCurrentLocation, refreshActiveStormEvent]);

  const runAnalysis = useCallback(async () => {
    if (!weather || !location || analysisInFlightRef.current) return;
    analysisInFlightRef.current = true;

    try {
      const observationMap = new Map<number, AnalysisInput['recentObservations'][number]>();

      if (activeEventId) {
        try {
          const obs = await getRecentObservations(activeEventId, 120);
          for (const o of obs) {
            observationMap.set(o.timestamp, {
              timestamp: o.timestamp,
              temperature: o.temperature,
              humidity: o.humidity,
              pressure: o.pressure,
              windSpeed: o.windSpeed,
              windDirection: o.windDirection,
              windGust: o.windGust,
              dewPoint: o.dewPoint,
              latitude: o.latitude,
              longitude: o.longitude,
            });
          }
        } catch (error) {
          console.warn('[HOME] Storm observation history unavailable:', error);
        }
      }

      try {
        const dateString = getWeatherLocalDateString(Date.now(), weather.utcOffsetSeconds);
        const dailyRecords = await getDailyRecordsForDate(dateString, weather.utcOffsetSeconds);
        for (const o of dailyRecords.slice(-120)) {
          observationMap.set(o.timestamp, {
            timestamp: o.timestamp,
            temperature: o.temperature,
            humidity: o.humidity,
            pressure: o.pressure,
            windSpeed: o.windSpeed,
            windDirection: o.windDirection,
            windGust: o.windGust,
            dewPoint: o.dewPoint,
            latitude: o.latitude,
            longitude: o.longitude,
          });
        }
      } catch (error) {
        console.warn('[HOME] Daily Monitor history unavailable for analysis:', error);
      }

      const recentObs = Array.from(observationMap.values())
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-120);

      let nwsAlerts: { event: string; severity: string | null; headline: string | null }[] = [];
      try {
        const alertTypes = await getActiveAlertTypes(location.latitude, location.longitude);
        nwsAlerts = alertTypes.map((event) => ({ event, severity: null, headline: null }));
      } catch (error) {
        console.warn('[HOME] NWS alert lookup failed:', error);
      }

      const lightning = lightningSummaryRef.current;
      const input: AnalysisInput = {
        temperature: weather.temperature,
        humidity: weather.humidity,
        pressure: weather.pressure,
        windSpeed: weather.windSpeed,
        windDirection: weather.windDirection,
        windGust: weather.windGust,
        dewPoint: weather.dewPoint,
        cape: weather.cape ?? null,
        latitude: location.latitude,
        longitude: location.longitude,
        recentObservations: recentObs,
        nearbyStations: [],
        nwsAlerts,
        lightning: lightning
          ? {
              totalCount: lightning.totalCount,
              recentCount5Min: lightning.recentCount5Min,
              nearestDistanceKm: lightning.nearestDistanceKm,
              ratePerMinute: lightning.ratePerMinute,
              trend: lightning.trend,
              cgCount: lightning.cgCount,
              icCount: lightning.icCount,
            }
          : undefined,
      };

      await analyze(input);
    } catch (error) {
      console.error('[HOME] Analysis failed:', error);
    } finally {
      analysisInFlightRef.current = false;
    }
  }, [weather, location, activeEventId, analyze]);

  useEffect(() => {
    if (weather && location) runAnalysis();
  }, [weather, location, runAnalysis]);

  useEffect(() => {
    if (isLogging && activeEventId) {
      analysisTimerRef.current = setInterval(() => {
        if (weather && location) runAnalysis();
      }, 5 * 60 * 1000);
    }
    return () => {
      if (analysisTimerRef.current) {
        clearInterval(analysisTimerRef.current);
        analysisTimerRef.current = null;
      }
    };
  }, [isLogging, activeEventId, weather, location, runAnalysis]);

  useEffect(() => {
    if (permission) loadWeather();
  }, [permission, loadWeather]);

  const handleStartStop = () => {
    if (isLogging) {
      Alert.alert('Stop Storm Log', 'Stop recording this storm event?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Stop', onPress: () => stopStormLog() },
      ]);
    } else {
      startStormLog(location);
    }
  };

  const formatDate = (d: Date) => d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
  });
  const formatTime = (d: Date) => d.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  const pressureTrend = analysisResult?.environment.pressureTrend ?? null;
  const pressureChange60 = analysisResult?.environment.pressureChange60Min ?? null;
  const pressureTrendDetail = pressureChange60 != null
    ? `${pressureChange60 >= 0 ? '+' : ''}${pressureChange60.toFixed(2)}\" / 1h`
    : 'History building';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={[styles.monitorBanner, dailyMonitor.isActive ? styles.monitorActive : styles.monitorPaused]}>
        <Ionicons
          name={dailyMonitor.isActive ? 'radio' : 'radio-outline'}
          size={14}
          color={dailyMonitor.isActive ? Colors.loggingActive : Colors.danger}
        />
        <Text style={[styles.monitorText, { color: dailyMonitor.isActive ? Colors.loggingActive : Colors.danger }]}>
          {dailyMonitor.isActive
            ? `Monitor Active — every ${dailyMonitor.intervalMinutes}m (${dailyMonitor.totalRecords} obs)`
            : 'Monitor Not Running'}
        </Text>
      </View>

      <Text style={styles.dateText}>{formatDate(now)}</Text>
      <Text style={styles.timeText}>{formatTime(now)}</Text>

      <View style={styles.locationRow}>
        <Ionicons name="location" size={14} color={Colors.primary} />
        <Text style={styles.locationText}>
          {location ? `${location.latitude.toFixed(4)}°N, ${Math.abs(location.longitude).toFixed(4)}°W` : 'Location unavailable'}
        </Text>
      </View>

      {lastUpdated ? <Text style={styles.updatedText}>Updated: {lastUpdated}</Text> : null}
      <Text style={styles.conditionText}>{weather?.weatherCondition ?? 'Loading...'}</Text>

      <ActiveNwsAlertsBanner
        latitude={location?.latitude ?? null}
        longitude={location?.longitude ?? null}
      />

      {weatherError ? (
        <View style={[styles.errorBanner, { backgroundColor: Colors.danger + '20' }]}>
          <Ionicons name="warning" size={16} color={Colors.danger} />
          <Text style={[styles.errorText, { color: Colors.danger }]}>{weatherError}</Text>
        </View>
      ) : null}
      {locationError && !permission ? (
        <View style={[styles.errorBanner, { backgroundColor: Colors.warning + '20' }]}>
          <Ionicons name="location" size={16} color={Colors.warning} />
          <Text style={[styles.errorText, { color: Colors.warning }]}>{locationError}</Text>
        </View>
      ) : null}
      {loggerError ? (
        <View style={[styles.errorBanner, { backgroundColor: Colors.danger + '20' }]}>
          <Ionicons name="warning" size={16} color={Colors.danger} />
          <Text style={[styles.errorText, { color: Colors.danger }]}>{loggerError}</Text>
        </View>
      ) : null}

      {weatherLoading ? <ActivityIndicator size="large" color={Colors.primary} style={{ marginVertical: SPACING.lg }} /> : null}

      {weather && !weatherLoading ? (
        <View style={{ width: '100%' }}>
          <View style={styles.cardRow}>
            <WeatherCard label="Temp" value={weather.temperature != null ? `${Math.round(weather.temperature)}°F` : '--°F'} icon="🌡️" color={Colors.temperature} />
            <WeatherCard label="Humidity" value={weather.humidity != null ? `${Math.round(weather.humidity)}%` : '--%'} icon="💧" color={Colors.humidity} />
          </View>
          <View style={styles.cardRow}>
            <WeatherCard
              label="Pressure"
              value={weather.pressure != null ? `${weather.pressure.toFixed(2)}\"` : '--\"'}
              icon="📊"
              color={Colors.pressure}
              trend={pressureTrend}
              trendDetail={pressureTrendDetail}
            />
            <WeatherCard label="Wind" value={weather.windSpeed != null ? `${Math.round(weather.windSpeed)} mph` : '-- mph'} icon="💨" color={Colors.wind} />
          </View>
          <View style={styles.cardRow}>
            <WeatherCard label="Gust" value={weather.windGust != null ? `${Math.round(weather.windGust)} mph` : '-- mph'} icon="🌪️" color={Colors.warning} />
            <WeatherCard label="Wind Dir" value={weather.windDirection != null ? `${Math.round(weather.windDirection)}°` : '--°'} icon="🧭" color={Colors.primary} />
          </View>
          <View style={styles.cardRow}>
            <WeatherCard label="Dew Point" value={weather.dewPoint != null ? `${Math.round(weather.dewPoint)}°F` : '--°F'} icon="🌡️" color={Colors.dewPoint} />
            <WeatherCard
              label={weather.observedDailyPrecipitationIsComplete === false ? 'Precipitation (Partial)' : 'Precipitation Today'}
              value={weather.observedDailyPrecipitation != null ? `${weather.observedDailyPrecipitation.toFixed(2)}\"` : '--\"'}
              icon="🌧️"
              color={Colors.precipitation}
            />
          </View>

          <TouchableOpacity style={styles.refreshBtn} onPress={loadWeather} disabled={weatherLoading}>
            <Ionicons name="refresh" size={18} color={Colors.primary} />
            <Text style={styles.refreshBtnText}>Refresh Weather</Text>
          </TouchableOpacity>

          <View style={styles.sourceDiagnostics}>
            <Text style={styles.sourceDiagnosticText}>
              Temp: {weather.currentConditionsSource?.stationId ?? weather.currentConditionsSource?.provider ?? 'Unavailable'} · {' '}
              Pressure: {weather.pressureSource?.stationId ?? weather.pressureSource?.provider ?? 'Unavailable'} · {' '}
              Precip: {weather.precipitationSource?.provider === 'NOAA_MRMS' ? 'MRMS QPE' : weather.precipitationSource?.provider ?? 'Unavailable'} · {' '}
              Rate: {weather.rainRateSource?.provider === 'NOAA_MRMS' ? 'MRMS PrecipRate' : 'Unavailable'} · {' '}
              Forecast: {weather.forecastSource?.gridId ?? weather.forecastSource?.provider ?? 'Unavailable'} · {' '}
              CAPE: {weather.capeSource?.provider ?? 'Unavailable'}
            </Text>
          </View>
        </View>
      ) : null}

      {!weather && !weatherLoading ? (
        <TouchableOpacity style={styles.loadBtn} onPress={loadWeather}>
          <Ionicons name="cloud-download" size={20} color={Colors.white} />
          <Text style={styles.loadBtnText}>Load Weather Data</Text>
        </TouchableOpacity>
      ) : null}

      <View style={{ width: '100%', marginTop: SPACING.md }}>
        <TornadoAnalysisCard result={analysisResult} loading={analysisLoading} radarStatus={radarStatus} />
      </View>

      {isLogging && activeEventId && lightningSummary.summary ? (
        <View style={{ width: '100%', marginTop: SPACING.md }}>
          <LightningActivityCard
            totalCount={lightningSummary.summary.totalCount}
            flashCount={lightningSummary.summary.flashCount}
            strikeCount={lightningSummary.summary.strikeCount}
            cgCount={lightningSummary.summary.cgCount}
            icCount={lightningSummary.summary.icCount}
            nearbyCount={lightningSummary.summary.nearbyCount}
            nearestDistanceKm={lightningSummary.summary.nearestDistanceKm}
            recentCount1Min={lightningSummary.summary.recentCount1Min}
            recentCount5Min={lightningSummary.summary.recentCount5Min}
            ratePerMinute={lightningSummary.summary.ratePerMinute}
            trend={lightningSummary.summary.trend}
            isCollecting={lightningSummary.loading}
            error={lightningSummary.error}
          />
        </View>
      ) : null}

      {automaticWarning && automaticWarningDisplay ? (
        <View
          style={styles.warningEventBanner}
          accessible
          accessibilityLabel={`${automaticWarningDisplay.sourceLabel}. ${automaticWarningDisplay.warningType}. ${automaticWarningDisplay.lifecycleLabel}`}
        >
          <Ionicons name="warning" size={20} color={Colors.warning} />
          <View style={styles.warningEventContent}>
            <Text style={styles.warningEventSource}>{automaticWarningDisplay.sourceLabel}</Text>
            <Text style={styles.warningEventType}>{automaticWarningDisplay.warningType}</Text>
            <Text style={[
              styles.warningEventStatus,
              { color: automaticWarningDisplay.lifecycleTone === 'active' ? Colors.loggingActive : Colors.textSecondary },
            ]}>
              ● {automaticWarningDisplay.lifecycleLabel}
            </Text>
            {automaticWarningDisplay.warningEndsAt != null ? (
              <Text style={styles.warningEventExpiration}>
                Warning ends {new Date(automaticWarningDisplay.warningEndsAt).toLocaleString('en-US', {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </Text>
            ) : null}
          </View>
        </View>
      ) : (
        <>
          <TouchableOpacity
            style={[styles.logBtn, isLogging ? styles.logBtnActive : styles.logBtnInactive]}
            onPress={handleStartStop}
            activeOpacity={0.8}
          >
            {isLogging ? <View style={styles.pulseDot} /> : null}
            <Text style={styles.logBtnText}>{isLogging ? 'STOP STORM LOG' : 'START STORM LOG'}</Text>
          </TouchableOpacity>

          {isLogging ? (
            <View style={styles.loggingInfo}>
              <View style={styles.loggingDot} />
              <Text style={styles.loggingText}>STORM LOG ACTIVE</Text>
              {observationCount > 0 ? <Text style={styles.loggingSubText}>{observationCount} observations recorded</Text> : null}
            </View>
          ) : null}
        </>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: SPACING.lg, alignItems: 'center' },
  monitorBanner: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, borderRadius: BORDER_RADIUS.sm, width: '100%', marginBottom: SPACING.md },
  monitorActive: { backgroundColor: Colors.loggingActive + '15' },
  monitorPaused: { backgroundColor: Colors.danger + '15' },
  monitorText: { fontSize: 12, fontWeight: '500' },
  dateText: { color: Colors.textSecondary, fontSize: 14, marginBottom: SPACING.xs },
  timeText: { color: Colors.white, fontSize: 36, fontWeight: '700', marginBottom: SPACING.sm },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: SPACING.xs },
  locationText: { color: Colors.textSecondary, fontSize: 13 },
  updatedText: { color: Colors.textSecondary, fontSize: 11, marginBottom: SPACING.sm },
  conditionText: { color: Colors.white, fontSize: 22, fontWeight: '600', marginBottom: SPACING.md },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, width: '100%', marginBottom: SPACING.sm },
  errorText: { fontSize: 13, flex: 1 },
  cardRow: { flexDirection: 'row', gap: SPACING.sm, width: '100%', marginBottom: SPACING.sm },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, borderWidth: 1, borderColor: Colors.primary, borderRadius: BORDER_RADIUS.md, paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg, width: '100%', marginTop: SPACING.sm },
  refreshBtnText: { color: Colors.primary, fontSize: 14, fontWeight: '600' },
  loadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, backgroundColor: Colors.primary, borderRadius: BORDER_RADIUS.md, paddingVertical: SPACING.lg, width: '100%', marginTop: SPACING.lg },
  loadBtnText: { color: Colors.white, fontSize: 16, fontWeight: '700' },
  logBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, borderRadius: BORDER_RADIUS.lg, paddingVertical: 20, width: '100%', marginTop: SPACING.xl },
  logBtnActive: { backgroundColor: Colors.danger },
  logBtnInactive: { backgroundColor: Colors.loggingActive },
  logBtnText: { color: Colors.white, fontSize: 18, fontWeight: '800', letterSpacing: 1 },
  pulseDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: Colors.white, opacity: 0.8 },
  loggingInfo: { flexDirection: 'column', alignItems: 'center', gap: SPACING.xs, marginTop: SPACING.md },
  sourceDiagnostics: { width: '100%', marginTop: SPACING.sm },
  sourceDiagnosticText: { color: Colors.textSecondary, fontSize: 10, lineHeight: 14, textAlign: 'center' },
  warningEventBanner: { flexDirection: 'row', width: '100%', marginTop: SPACING.lg, padding: SPACING.lg, gap: SPACING.md, backgroundColor: Colors.surface, borderColor: Colors.warning, borderWidth: 1, borderRadius: BORDER_RADIUS.md },
  warningEventContent: { flex: 1 },
  warningEventSource: { color: Colors.warning, fontSize: 11, fontWeight: '700' },
  warningEventType: { color: Colors.white, fontSize: 17, fontWeight: '700', marginTop: SPACING.xs },
  warningEventStatus: { fontSize: 12, fontWeight: '700', marginTop: SPACING.xs },
  warningEventExpiration: { color: Colors.textSecondary, fontSize: 12, marginTop: SPACING.xs },
  loggingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.loggingActive },
  loggingText: { color: Colors.loggingActive, fontSize: 14, fontWeight: '700' },
  loggingSubText: { color: Colors.textSecondary, fontSize: 12 },
});
