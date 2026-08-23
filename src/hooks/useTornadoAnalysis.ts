import { useState, useCallback, useRef } from 'react';
import type { AnalysisInput, StormAnalysisResult } from '../services/analysis/types';
import { analyzeStorm } from '../services/analysis/tornadoAnalysis';
import { getRadarData } from '../services/analysis/radar';

export function useTornadoAnalysis() {
  const [result, setResult] = useState<StormAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [radarStatus, setRadarStatus] = useState<string>('Not checked');
  const previousAnalysesRef = useRef<StormAnalysisResult[]>([]);

  const analyze = useCallback(async (input: AnalysisInput): Promise<StormAnalysisResult> => {
    setLoading(true);
    try {
      // Fetch real NEXRAD data
      let radarInput = input.radarData;
      try {
        const nexradResult = await getRadarData(input.latitude, input.longitude);
        setRadarStatus(
          nexradResult.available
            ? `Connected${nexradResult.stationId ? ` (${nexradResult.stationId})` : ''}`
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
        };
      } catch (radarError) {
        console.warn('[TornadoAnalysis] NEXRAD fetch failed:', radarError);
        setRadarStatus('Radar fetch failed');
        radarInput = {
          available: false,
          unavailableReason: 'Failed to connect to radar service',
          velocityPoints: [],
          couplets: [],
          stormCells: [],
        };
      }

      // Run analysis with real radar data
      const enrichedInput: AnalysisInput = { ...input, radarData: radarInput };
      const r = analyzeStorm(enrichedInput, previousAnalysesRef.current);

      setResult(r);
      previousAnalysesRef.current = [
        ...previousAnalysesRef.current.slice(-19),
        r,
      ];

      return r;
    } finally {
      setLoading(false);
    }
  }, []);

  return { result, analyze, loading, radarStatus };
}

export type { StormAnalysisResult };
