import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useCallback, useRef } from 'react';
import type { AnalysisInput, StormAnalysisResult } from '../services/analysis/types';
import { analyzeStorm } from '../services/analysis/tornadoAnalysis';
import { getRadarData } from '../services/analysis/radar';
import { fetchHrrrAdvancedEnvironment } from '../services/analysis/hrrrEnvironment';

const VERIFIED_LEVEL2_CACHE_KEY = '@stormlog/tornado/verified-level2-assessment-v1';
const VERIFIED_LEVEL2_CACHE_MAX_AGE_MS = 15 * 60 * 1000;
const VERIFIED_LEVEL2_CACHE_MAX_DISTANCE_KM = 10;

type VerifiedLevel2AssessmentCache = {
  savedAtMs: number;
  latitude: number;
  longitude: number;
  stationId: string | null;
  radarStatus: string;
  result: StormAnalysisResult;
};

function toRad(value: number): number {
  return value * Math.PI / 180;
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.sqrt(a));
}

function getUsableCachedAssessment(
  cached: VerifiedLevel2AssessmentCache | null,
  input: AnalysisInput,
): { result: StormAnalysisResult; status: string } | null {
  if (!cached?.result || !Number.isFinite(cached.savedAtMs)) return null;

  const elapsedMs = Math.max(0, Date.now() - cached.savedAtMs);
  if (elapsedMs > VERIFIED_LEVEL2_CACHE_MAX_AGE_MS) return null;
  if (distanceKm(cached.latitude, cached.longitude, input.latitude, input.longitude) > VERIFIED_LEVEL2_CACHE_MAX_DISTANCE_KM) {
    return null;
  }
  if (!cached.result.stormStructure?.radarAvailable || !cached.result.rotation?.velocityDataAvailable) return null;

  const originalRadarAgeMinutes = cached.result.dataFreshness?.radarAgeMinutes;
  if (originalRadarAgeMinutes == null || !Number.isFinite(originalRadarAgeMinutes)) return null;
  const effectiveRadarAgeMinutes = originalRadarAgeMinutes + elapsedMs / 60_000;
  if (effectiveRadarAgeMinutes * 60_000 > VERIFIED_LEVEL2_CACHE_MAX_AGE_MS) return null;

  const displayAge = Math.max(0, Math.ceil(effectiveRadarAgeMinutes));
  const result: StormAnalysisResult = {
    ...cached.result,
    dataFreshness: {
      ...cached.result.dataFreshness,
      radarAgeMinutes: effectiveRadarAgeMinutes,
      isStale: false,
      description: `Cached verified Level II snapshot · about ${displayAge} min old · refreshing live radar`,
    },
  };
  const station = cached.stationId ?? cached.result.stormStructure?.radarStationId ?? null;
  return {
    result,
    status: `Level II cached${station ? ` (${station})` : ''} · ${displayAge} min old · refreshing`,
  };
}

async function readVerifiedLevel2Cache(): Promise<VerifiedLevel2AssessmentCache | null> {
  try {
    const raw = await AsyncStorage.getItem(VERIFIED_LEVEL2_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VerifiedLevel2AssessmentCache;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (error) {
    console.warn('[TornadoAnalysis] failed to read verified Level II cache:', error);
    return null;
  }
}

async function writeVerifiedLevel2Cache(cache: VerifiedLevel2AssessmentCache): Promise<void> {
  try {
    await AsyncStorage.setItem(VERIFIED_LEVEL2_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn('[TornadoAnalysis] failed to persist verified Level II cache:', error);
  }
}

export function useTornadoAnalysis() {
  const [result, setResult] = useState<StormAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [radarStatus, setRadarStatus] = useState<string>('Not checked');
  const previousAnalysesRef = useRef<StormAnalysisResult[]>([]);
  const inFlightRef = useRef<Promise<StormAnalysisResult> | null>(null);
  const generationRef = useRef(0);
  const cacheRef = useRef<VerifiedLevel2AssessmentCache | null>(null);
  const cacheLoadedRef = useRef(false);

  const analyze = useCallback(async (input: AnalysisInput): Promise<StormAnalysisResult> => {
    if (inFlightRef.current) {
      console.log('[TornadoAnalysis] duplicate analysis skipped; reusing in-flight promise');
      return inFlightRef.current;
    }

    const generation = ++generationRef.current;
    const promise = (async () => {
      setLoading(true);
      try {
        if (!cacheLoadedRef.current) {
          cacheRef.current = await readVerifiedLevel2Cache();
          cacheLoadedRef.current = true;
        }

        const cached = getUsableCachedAssessment(cacheRef.current, input);
        if (cached && generation === generationRef.current) {
          setResult(cached.result);
          setRadarStatus(cached.status);
        }

        const hrrrPromise = input.advancedEnvironment
          ? null
          : fetchHrrrAdvancedEnvironment(input.latitude, input.longitude)
              .then((hrrr) => ({ success: true as const, advancedEnvironment: hrrr.environment }))
              .catch((error) => ({ success: false as const, error }));

        const radarResult = await getRadarData(input.latitude, input.longitude)
          .then((nexradResult) => ({ success: true as const, nexradResult }))
          .catch((error) => ({ success: false as const, error }));

        let radarInput = input.radarData;
        let resolvedRadarStatus = 'Radar fetch failed';
        let verifiedLevel2 = false;
        let verifiedStationId: string | null = null;

        if (radarResult.success) {
          const nexradResult = radarResult.nexradResult;
          verifiedLevel2 = nexradResult.available && nexradResult.source === 'QUANTITATIVE_LEVEL2';
          verifiedStationId = nexradResult.stationId ?? null;
          resolvedRadarStatus = nexradResult.available
            ? `${nexradResult.source === 'QUANTITATIVE_LEVEL2' ? 'Level II' : 'Composite'} connected${nexradResult.stationId ? ` (${nexradResult.stationId})` : ''}`
            : nexradResult.unavailableReason ?? 'Unavailable';
          setRadarStatus(resolvedRadarStatus);
          radarInput = {
            available: nexradResult.available,
            stationId: nexradResult.stationId,
            latestFrameTime: nexradResult.latestFrameTime,
            hasPrecipitation: nexradResult.hasPrecipitation,
            maxReflectivityDbz: nexradResult.maxReflectivityDbz,
            unavailableReason: nexradResult.unavailableReason,
            velocityPoints: nexradResult.velocityPoints,
            couplets: nexradResult.couplets,
            stormCells: nexradResult.cells,
            correlationCoefficient: nexradResult.correlationCoefficient,
            differentialReflectivity: nexradResult.differentialReflectivity,
            dualPolEvidence: nexradResult.dualPolEvidence,
            scanCount: nexradResult.scanCount,
            radarSource: nexradResult.source,
          } as any;
        } else {
          console.warn('[TornadoAnalysis] radar fetch failed:', radarResult.error);
          setRadarStatus('Radar fetch failed');
          radarInput = {
            available: false,
            unavailableReason: 'Failed to connect to radar service',
            velocityPoints: [],
            couplets: [],
            stormCells: [],
          };
        }

        const baseInput: AnalysisInput = {
          ...input,
          radarData: radarInput,
          advancedEnvironment: input.advancedEnvironment ?? null,
        };
        const baseResult = analyzeStorm(baseInput, previousAnalysesRef.current);

        if (generation === generationRef.current) {
          setResult(baseResult);
          previousAnalysesRef.current = [
            ...previousAnalysesRef.current.slice(-19),
            baseResult,
          ];
        }

        if (verifiedLevel2 && baseResult.rotation.velocityDataAvailable) {
          const cachedAssessment: VerifiedLevel2AssessmentCache = {
            savedAtMs: Date.now(),
            latitude: input.latitude,
            longitude: input.longitude,
            stationId: verifiedStationId,
            radarStatus: resolvedRadarStatus,
            result: baseResult,
          };
          cacheRef.current = cachedAssessment;
          void writeVerifiedLevel2Cache(cachedAssessment);
        }

        // Radar is the safety-critical gating input. Do not keep the whole card
        // blocked on the slower HRRR request. Render the radar-backed assessment
        // immediately, then enrich the same analysis in place if HRRR arrives.
        if (hrrrPromise) {
          void hrrrPromise.then((hrrrResult) => {
            if (generation !== generationRef.current) return;
            if (!hrrrResult.success) {
              console.warn('[TornadoAnalysis] HRRR upper-air fetch failed:', hrrrResult.error);
              return;
            }
            const enriched = analyzeStorm({
              ...input,
              radarData: radarInput,
              advancedEnvironment: hrrrResult.advancedEnvironment,
            }, previousAnalysesRef.current.slice(0, -1));
            setResult(enriched);
            previousAnalysesRef.current = [
              ...previousAnalysesRef.current.slice(0, -1),
              enriched,
            ].slice(-20);

            if (verifiedLevel2 && enriched.rotation.velocityDataAvailable) {
              const cachedAssessment: VerifiedLevel2AssessmentCache = {
                savedAtMs: Date.now(),
                latitude: input.latitude,
                longitude: input.longitude,
                stationId: verifiedStationId,
                radarStatus: resolvedRadarStatus,
                result: enriched,
              };
              cacheRef.current = cachedAssessment;
              void writeVerifiedLevel2Cache(cachedAssessment);
            }
          });
        }

        return baseResult;
      } finally {
        setLoading(false);
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = promise;
    return promise;
  }, []);

  return { result, analyze, loading, radarStatus };
}

export type { StormAnalysisResult };
