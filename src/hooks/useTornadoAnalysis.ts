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
  const generationRef = useRef(0);

  const analyze = useCallback(async (input: AnalysisInput): Promise<StormAnalysisResult> => {
    if (inFlightRef.current) {
      console.log('[TornadoAnalysis] duplicate analysis skipped; reusing in-flight promise');
      return inFlightRef.current;
    }

    const generation = ++generationRef.current;
    const promise = (async () => {
      setLoading(true);
      try {
        const hrrrPromise = input.advancedEnvironment
          ? null
          : fetchHrrrAdvancedEnvironment(input.latitude, input.longitude)
              .then((hrrr) => ({ success: true as const, advancedEnvironment: hrrr.environment }))
              .catch((error) => ({ success: false as const, error }));

        const radarResult = await getRadarData(input.latitude, input.longitude)
          .then((nexradResult) => ({ success: true as const, nexradResult }))
          .catch((error) => ({ success: false as const, error }));

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
