// ============================================================
// Storm Analysis — Progressive 4-Layer Type System
// ============================================================

// ---- Severity/assessment categories ----
export type AssessmentLevel = 'VERY_LOW' | 'LOW' | 'MARGINAL' | 'MODERATE' | 'HIGH' | 'VERY_HIGH' | 'UNKNOWN';
export type DataAvailability = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
export type TrendDirection = 'STRENGTHENING' | 'WEAKENING' | 'PERSISTENT' | 'NEWLY_DEVELOPING' | 'RAPIDLY_INTENSIFYING' | 'UNKNOWN';
export type ConfidenceLevel = 'HIGH' | 'MODERATE' | 'LOW' | 'UNKNOWN';

// ---- Layer A: Environmental Tornado Potential ----
export interface EnvironmentalAssessment {
  level: AssessmentLevel;
  cape: number | null;
  cin: number | null;
  surfaceTempF: number | null;
  surfaceDewPointF: number | null;
  surfaceHumidity: number | null;
  surfaceWindSpeed: number | null;
  surfaceWindDirection: number | null;
  pressureTrend: PressureTrendDirection;
  pressureChange30Min: number | null;
  pressureChange60Min: number | null;
  lowLevelShear: number | null;
  deepLayerShear: number | null;
  srh: number | null;
  lclHeight: number | null;
  significantTornadoParam: number | null;
  supercellComposite: number | null;
  dataAvailability: {
    cape: DataAvailability;
    shear: DataAvailability;
    helicity: DataAvailability;
    compositeParams: DataAvailability;
  };
  description: string;
  factors: string[];
}

// ---- Layer B: Storm Structure ----
export interface StormStructureAssessment {
  level: AssessmentLevel;
  hasStrongReflectivity: boolean;
  hasSupercellStructure: boolean;
  hasHookEcho: boolean;
  hasBWER: boolean;
  stormOrganization: string;
  maxReflectivity: number | null;
  stormTop: number | null;
  radarAvailable: boolean;
  radarStationId: string | null;
  description: string;
  factors: string[];
}

// ---- Layer C: Rotation Analysis ----
export interface RotationAssessment {
  level: AssessmentLevel;
  radarAvailable: boolean;
  velocityDataAvailable: boolean;
  hasCouplet: boolean;
  coupletStrength: string;
  gateToGateShear: number | null;
  rotationalVelocity: number | null;
  coupletDiameter: number | null;
  azimuthalShear: number | null;
  lowLevelRotation: boolean;
  verticalContinuity: number;
  trend: TrendDirection;
  surfaceWindPattern: SurfaceRotationData | null;
  description: string;
  factors: string[];
}

export interface SurfaceRotationData {
  convergenceLevel: ConvergenceLevel;
  rotationSignal: RotationSignal;
  confidencePercent: number;
  stationCount: number;
  windShiftDegrees: number | null;
  windShiftMinutes: number | null;
}

// ---- Layer D: Tornadic Evidence ----
export interface TornadicEvidenceAssessment {
  level: AssessmentLevel;
  debrisSignature: boolean;
  debrisConfidence: number | null;
  strongCouplet: boolean;
  persistentRotation: boolean;
  intensifyingRotation: boolean;
  lowLevelMesocyclone: boolean;
  dualPolAvailable: boolean;
  correlationCoefficient: number | null;
  differentialReflectivity: number | null;
  description: string;
  factors: string[];
}

// ---- Storm Motion & Distance ----
export interface StormMotion {
  distanceMiles: number | null;
  bearingDegrees: number | null;
  speedMph: number | null;
  directionDegrees: number | null;
  approaching: boolean;
  description: string;
}

// ---- NWS Warnings (SEPARATE from analysis) ----
export interface NwsWarningStatus {
  tornadoWarning: boolean;
  tornadoWatch: boolean;
  severeWarning: boolean;
  severeWatch: boolean;
  activeAlerts: { event: string; severity: string | null; headline: string | null }[];
  description: string;
}

// ---- Data Quality / Confidence ----
export interface DataQuality {
  level: ConfidenceLevel;
  radarCoverage: DataAvailability;
  environmentalData: DataAvailability;
  surfaceStations: DataAvailability;
  velocityData: DataAvailability;
  description: string;
  limitations: string[];
}

// ---- Composite Result ----
export interface StormAnalysisResult {
  surfaceEnvironment: {
    level: AssessmentLevel;
    description: string;
    capeAvailable: boolean;
    pressureTrendAvailable: boolean;
    factors: string[];
  };
  atmosphericEnvironment: {
    level: AssessmentLevel;
    description: string;
    shearAvailable: boolean;
    srhAvailable: boolean;
    stpScpAvailable: boolean;
    factors: string[];
  };
  environment: EnvironmentalAssessment;
  stormStructure: StormStructureAssessment;
  rotation: RotationAssessment;
  tornadicEvidence: TornadicEvidenceAssessment;

  stormMotion: StormMotion | null;
  nwsStatus: NwsWarningStatus;
  dataQuality: DataQuality;

  overallAssessment: AssessmentLevel;
  assessmentText: string;
  whyExplanation: string;
  whatWouldIncreaseConcern: string[];

  dataFreshness: {
    weatherAgeMinutes: number | null;
    radarAgeMinutes: number | null;
    nwsAgeMinutes: number | null;
    isStale: boolean;
    description: string;
  };

  timestamp: number;
  latitude: number;
  longitude: number;
  lightningTrend: LightningTrend;
}

// ---- Input data ----
export interface AnalysisInput {
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  windGust: number | null;
  dewPoint: number | null;
  latitude: number;
  longitude: number;

  cape: number | null;

  recentObservations: {
    timestamp: number;
    temperature: number | null;
    humidity: number | null;
    pressure: number | null;
    windSpeed: number | null;
    windDirection: number | null;
    windGust: number | null;
    dewPoint: number | null;
    latitude: number;
    longitude: number;
  }[];

  nearbyStations: WindVector[];

  nwsAlerts: { event: string; severity: string | null; headline: string | null }[];

  radarData?: RadarAnalysisInput;

  lightning?: {
    totalCount: number;
    recentCount5Min: number;
    nearestDistanceKm: number | null;
    ratePerMinute: number;
    trend: LightningTrend;
    cgCount: number;
    icCount: number;
  };
}

export interface RadarAnalysisInput {
  available?: boolean;
  stationId?: string;
  latestFrameTime?: number;
  hasPrecipitation?: boolean;
  maxReflectivityDbz?: number | null;
  unavailableReason?: string;
  velocityPoints: any[];
  couplets: any[];
  stormCells: any[];
}

export type PressureTrendDirection = 'RISING' | 'STABLE' | 'FALLING';

// ---- AnalysisSnapshot for DB storage ----
export interface AnalysisSnapshotData {
  id: number;
  stormEventId: number;
  timestamp: number;
  tornadoPossibilityLevel: string;
  rotationSignal: string;
  convergence: string;
  windShear: string;
  pressureTrend: string;
  windDirectionChange: number | null;
  lightningTrend: string;
  availableObservationCount: number;
  confidence: number;
}

// ---- Backward-compatible types ----
export type PossibilityLevel = 'LOW' | 'ELEVATED' | 'MODERATE' | 'HIGH';
export type RotationSignal = 'NONE' | 'WEAK' | 'MODERATE' | 'STRONG';
export type ConvergenceLevel = 'LOW' | 'MODERATE' | 'HIGH';
export type WindShearLevel = 'NONE' | 'WEAK' | 'MODERATE' | 'STRONG';
export type LightningTrend = 'NONE' | 'DECREASING' | 'STABLE' | 'INCREASING';

export interface WindVector {
  speed: number;
  direction: number;
  latitude: number;
  longitude: number;
  stationId?: string;
  timestamp?: number;
}

export interface AnalysisFactor {
  name: string;
  score: number;
  available: boolean;
  description: string;
}

export interface AnalysisScores {
  windField: AnalysisFactor;
  convergence: AnalysisFactor;
  directionalShear: AnalysisFactor;
  pressureTendency: AnalysisFactor;
  windShift: AnalysisFactor;
  thermodynamic: AnalysisFactor;
  lightning: AnalysisFactor;
  nwsAlerts: AnalysisFactor;
}

export interface TornadoPossibilityResult {
  level: PossibilityLevel;
  confidence: number;
  rotationSignal: RotationSignal;
  convergenceLevel: ConvergenceLevel;
  windShear: WindShearLevel;
  pressureTrend: PressureTrendDirection;
  windShiftDegrees: number | null;
  windShiftDuration: number | null;
  lightningTrend: LightningTrend;
  activeNwsAlerts: string[];
  scores: AnalysisScores;
  factorsIncreasing: string[];
  factorsLimiting: string[];
  observationCount: number;
  timestamp: number;
}

export interface PressureRecord {
  timestamp: number;
  pressure: number;
}

export interface WindDirectionRecord {
  timestamp: number;
  direction: number;
  speed: number;
}

export interface AnalysisSnapshot {
  id: number;
  stormEventId: number;
  timestamp: number;
  tornadoPossibilityLevel: PossibilityLevel;
  rotationSignal: RotationSignal;
  convergence: ConvergenceLevel;
  windShear: WindShearLevel;
  pressureTrend: PressureTrendDirection;
  windDirectionChange: number | null;
  lightningTrend: LightningTrend;
  availableObservationCount: number;
  confidence: number;
}
