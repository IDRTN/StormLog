import { useState, useCallback, useRef } from 'react';
import type { AnalysisInput, StormAnalysisResult } from '../services/analysis/types';
import { analyzeStorm } from '../services/analysis/tornadoAnalysis';
import { getRadarData } from '../services/analysis/radar';
import { fetchHrrrAdvancedEnvironment } from '../services/analysis/hrrrEnvironment';

export function useTornadoAnalysis() {
  const [result, setResult] = useState<StormAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [radarStatus, setRadarStatus] = useState<string>('Not checked');
  const previousAnalysesRef = useRef<StormAnalysisResult[]>([]);
  const inFlightRef = useRef<Promise<StormAnalysisResult> | null>(null);

  const analyze = useCallback(async (input: AnalysisInput): Promise<StormAnalysisResult> => {
    if (inFlightRef.current) {
      console.log('[TornadoAnalysis] duplicate analysis skipped; reusing in-flight promise');
      return inFlightRef.current;
    }

    const promise = (async () => {
      setLoading(true);
      try {
        const radarPromise = getRadarData(input.latitude, input.longitude)
          .then((nexradResult) => ({ success: true as const, nexradResult }))
          .catch((error) => ({ success: false as const, error }));

        const hrrrPromise = input.advancedEnvironment
          ? Promise.resolve({ success: true as const, advancedEnvironment: input.advancedEnvironment })
          : fetchHrrrAdvancedEnvironment(input.latitude, input.longitude)
              .then((hrrr) => ({ success: true as const, advancedEnvironment: hrrr.environment }))
              .catch((error) => ({ success: false as const, error }));

        const [radarResult, hrrrResult] = await Promise.all([radarPromise, hrrrPromise]);

        let radarInput = input.radarData;
        if (radarResult.success) {
          const nexradResult = radarResult.nexradResult;
          setRadarStatus(
            nexradResult.available
              ? `${nexradResult.source === 'QUANTITATIVE_LEVEL2' ? 'Level II' : 'Composite'} connected${nexradResult.stationId ? ` (${nexradResult.stationId})` : ''}`
              : nexradResult.unavailableReason ?? 'Unavailable'
          );
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
            // Tornadic evidence intentionally consumes these only when the
            // quantitative backend actually supplies them. Composite fallback
            // leaves them null/undefined and cannot create a debris claim.
            correlationCoefficient: nexradResult.correlationCoefficient,
            differentialReflectivity: nexradResult.differentialReflectivity,
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

        let advancedEnvironment = input.advancedEnvironment ?? null;
        if (!advancedEnvironment && hrrrResult.success) {
          advancedEnvironment = hrrrResult.advancedEnvironment;
        } else if (!advancedEnvironment && !hrrrResult.success) {
          console.warn('[TornadoAnalysis] HRRR upper-air fetch failed:', hrrrResult.error);
        }

        const enrichedInput: AnalysisInput = {
          ...input,
          radarData: radarInput,
          advancedEnvironment,
        };
        const r = analyzeStorm(enrichedInput, previousAnalysesRef.current);

        setResult(r);
        previousAnalysesRef.current = [
          ...previousAnalysesRef.current.slice(-19),
          r,
        ];

        return r;
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