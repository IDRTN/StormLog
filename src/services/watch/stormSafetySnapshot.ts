export const STORM_SAFETY_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type WatchTornadoAssessment =
  | 'INSUFFICIENT_DATA'
  | 'LOW'
  | 'MARGINAL'
  | 'MODERATE'
  | 'HIGH';

export type WatchConfidence = 'LOW' | 'MODERATE' | 'HIGH';

export type WatchRotation = 'NONE' | 'WEAK' | 'MODERATE' | 'STRONG' | 'UNKNOWN';

export interface StormSafetySnapshot {
  schemaVersion: typeof STORM_SAFETY_SNAPSHOT_SCHEMA_VERSION;
  generatedAt: string;
  tornado: {
    assessment: WatchTornadoAssessment;
    confidence: WatchConfidence;
    rotation: WatchRotation;
    gateToGateShearKt: number | null;
  };
  radar: {
    source: 'LEVEL_II' | 'COMPOSITE' | 'UNAVAILABLE';
    stationId: string | null;
    observedAt: string | null;
    ageMinutes: number | null;
    quantitativeReflectivityAvailable: boolean;
    dopplerVelocityAvailable: boolean;
    dualPolAvailable: boolean;
  };
  lightning: {
    status: 'CLEAR' | 'NEARBY' | 'UNKNOWN';
    nearestStrikeMiles: number | null;
    observedAt: string | null;
    ageMinutes: number | null;
  };
  nws: {
    hasOfficialWarning: boolean;
    event: string | null;
    alertId: string | null;
    expiresAt: string | null;
  };
}

export function isStormSafetySnapshot(value: unknown): value is StormSafetySnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<StormSafetySnapshot>;
  return (
    snapshot.schemaVersion === STORM_SAFETY_SNAPSHOT_SCHEMA_VERSION &&
    typeof snapshot.generatedAt === 'string' &&
    !!snapshot.tornado &&
    !!snapshot.radar &&
    !!snapshot.lightning &&
    !!snapshot.nws
  );
}
