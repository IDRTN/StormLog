// ============================================================
// Analysis Test Screen — 4-Layer Storm Analysis Test Scenarios
// ============================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, SPACING, BORDER_RADIUS } from '../src/constants/theme';
import { TornadoAnalysisCard } from '../src/components/TornadoAnalysisCard';
import { useTornadoAnalysis } from '../src/hooks/useTornadoAnalysis';
import type { AnalysisInput } from '../src/services/analysis/types';

// ============================================================
// Test Scenarios — simulated weather observations
// ============================================================

interface TestScenario {
  name: string;
  description: string;
  input: AnalysisInput;
}

const BASE: { latitude: number; longitude: number } = {
  latitude: 35.0,
  longitude: -97.0,
};

// Helper to create nearby station vectors
function stations(
  vectors: { speed: number; dir: number; latOff: number; lonOff: number }[],
) {
  return vectors.map((v, i) => ({
    speed: v.speed,
    direction: v.dir,
    latitude: BASE.latitude + v.latOff,
    longitude: BASE.longitude + v.lonOff,
    stationId: `STN-${i + 1}`,
  }));
}

// Helper for recent observations
function recentObs(
  entries: {
    minsAgo: number;
    temp: number | null;
    hum: number | null;
    pres: number | null;
    spd: number | null;
    dir: number | null;
    gust: number | null;
    dp: number | null;
  }[],
) {
  return entries.map((e) => ({
    timestamp: Date.now() - e.minsAgo * 60_000,
    temperature: e.temp,
    humidity: e.hum,
    pressure: e.pres,
    windSpeed: e.spd,
    windDirection: e.dir,
    windGust: e.gust,
    dewPoint: e.dp,
    latitude: BASE.latitude,
    longitude: BASE.longitude,
  }));
}

// ============================================================
// Scenario 1: Favorable environment, no radar rotation
// ============================================================
const SCENAR1: TestScenario = {
  name: '1. Favorable Environment, No Radar',
  description:
    'High CAPE, moist air, falling pressure — but no radar data available.',
  input: {
    temperature: 84,
    humidity: 78,
    pressure: 29.88,
    windSpeed: 22,
    windDirection: 190,
    windGust: 32,
    dewPoint: 68,
    cape: 2500,
    latitude: BASE.latitude,
    longitude: BASE.longitude,
    recentObservations: recentObs([
      { minsAgo: 30, temp: 85, hum: 75, pres: 29.96, spd: 18, dir: 185, gust: 24, dp: 67 },
      { minsAgo: 15, temp: 84, hum: 77, pres: 29.92, spd: 20, dir: 188, gust: 28, dp: 68 },
    ]),
    nearbyStations: stations([
      { speed: 25, dir: 210, latOff: 0.06, lonOff: 0.06 },
      { speed: 20, dir: 170, latOff: 0.06, lonOff: -0.06 },
      { speed: 18, dir: 240, latOff: -0.06, lonOff: 0.06 },
      { speed: 22, dir: 150, latOff: -0.06, lonOff: -0.06 },
    ]),
    nwsAlerts: [],
  },
};

// ============================================================
// Scenario 2: Strong radar rotation, unfavorable environment
// ============================================================
const SCENAR2: TestScenario = {
  name: '2. Strong Radar Rotation, Unfavorable Env',
  description:
    'Dry, low-CAPE atmosphere — but radar shows a strong mesocyclone.',
  input: {
    temperature: 62,
    humidity: 28,
    pressure: 30.10,
    windSpeed: 12,
    windDirection: 310,
    windGust: 15,
    dewPoint: 28,
    cape: 400,
    latitude: BASE.latitude,
    longitude: BASE.longitude,
    recentObservations: [],
    nearbyStations: stations([
      { speed: 10, dir: 300, latOff: 0.05, lonOff: 0.05 },
      { speed: 8, dir: 320, latOff: 0.05, lonOff: -0.05 },
      { speed: 14, dir: 290, latOff: -0.05, lonOff: 0.05 },
      { speed: 11, dir: 315, latOff: -0.05, lonOff: -0.05 },
    ]),
    nwsAlerts: [],
    radarData: {
      velocityPoints: [
        {
          latitude: BASE.latitude + 0.02,
          longitude: BASE.longitude + 0.02,
          velocity: -45,
          stormRelativeVelocity: -35,
          reflectivity: 62,
          altitude: 1500,
        },
        {
          latitude: BASE.latitude - 0.02,
          longitude: BASE.longitude - 0.02,
          velocity: 38,
          stormRelativeVelocity: 28,
          reflectivity: 58,
          altitude: 1500,
        },
        {
          latitude: BASE.latitude + 0.01,
          longitude: BASE.longitude - 0.03,
          velocity: -40,
          stormRelativeVelocity: -30,
          reflectivity: 55,
          altitude: 1200,
        },
        {
          latitude: BASE.latitude - 0.01,
          longitude: BASE.longitude + 0.03,
          velocity: 35,
          stormRelativeVelocity: 25,
          reflectivity: 60,
          altitude: 1800,
        },
      ],
      couplets: [
        {
          latitude: BASE.latitude + 0.015,
          longitude: BASE.longitude + 0.015,
          shear: 85,
          strength: 'STRONG',
          distanceKm: 8.2,
          headingTowardUser: false,
        },
      ],
      stormCells: [
        {
          id: 'CELL-001',
          latitude: BASE.latitude + 0.03,
          longitude: BASE.longitude - 0.02,
          maxReflectivity: 65,
          top: 14,
          movement: 230,
          speed: 30,
        },
      ],
    },
  },
};

// ============================================================
// Scenario 3: Favorable environment + strong low-level rotation
// ============================================================
const SCENAR3: TestScenario = {
  name: '3. Favorable Env + Strong Rotation',
  description:
    'High CAPE, moist, falling pressure with confirmed radar rotation.',
  input: {
    temperature: 86,
    humidity: 82,
    pressure: 29.75,
    windSpeed: 28,
    windDirection: 200,
    windGust: 42,
    dewPoint: 72,
    cape: 3200,
    latitude: BASE.latitude,
    longitude: BASE.longitude,
    recentObservations: recentObs([
      { minsAgo: 45, temp: 87, hum: 79, pres: 29.88, spd: 20, dir: 180, gust: 30, dp: 71 },
      { minsAgo: 30, temp: 86, hum: 80, pres: 29.82, spd: 24, dir: 190, gust: 36, dp: 71.5 },
      { minsAgo: 15, temp: 86, hum: 81, pres: 29.78, spd: 26, dir: 195, gust: 38, dp: 72 },
    ]),
    nearbyStations: stations([
      { speed: 32, dir: 220, latOff: 0.07, lonOff: 0.07 },
      { speed: 28, dir: 175, latOff: 0.07, lonOff: -0.07 },
      { speed: 25, dir: 250, latOff: -0.07, lonOff: 0.07 },
      { speed: 30, dir: 155, latOff: -0.07, lonOff: -0.07 },
      { speed: 26, dir: 200, latOff: 0.1, lonOff: 0 },
      { speed: 22, dir: 210, latOff: 0, lonOff: 0.1 },
    ]),
    nwsAlerts: [{ event: 'Severe Thunderstorm Warning', severity: 'Severe', headline: null }],
    radarData: {
      velocityPoints: [
        {
          latitude: BASE.latitude + 0.018,
          longitude: BASE.longitude + 0.018,
          velocity: -52,
          stormRelativeVelocity: -42,
          reflectivity: 68,
          altitude: 1200,
        },
        {
          latitude: BASE.latitude - 0.018,
          longitude: BASE.longitude - 0.018,
          velocity: 48,
          stormRelativeVelocity: 38,
          reflectivity: 64,
          altitude: 1200,
        },
        {
          latitude: BASE.latitude + 0.01,
          longitude: BASE.longitude - 0.025,
          velocity: -50,
          stormRelativeVelocity: -40,
          reflectivity: 60,
          altitude: 1000,
        },
        {
          latitude: BASE.latitude - 0.01,
          longitude: BASE.longitude + 0.025,
          velocity: 44,
          stormRelativeVelocity: 34,
          reflectivity: 62,
          altitude: 1400,
        },
      ],
      couplets: [
        {
          latitude: BASE.latitude + 0.012,
          longitude: BASE.longitude + 0.012,
          shear: 95,
          strength: 'STRONG',
          distanceKm: 5.1,
          headingTowardUser: true,
        },
      ],
      stormCells: [
        {
          id: 'CELL-002',
          latitude: BASE.latitude + 0.025,
          longitude: BASE.longitude - 0.015,
          maxReflectivity: 72,
          top: 16,
          movement: 210,
          speed: 35,
        },
      ],
    },
  },
};

// ============================================================
// Scenario 4: Strong rotation strengthening rapidly
// ============================================================
const SCENAR4: TestScenario = {
  name: '4. Strong Rotation Strengthening',
  description:
    'Rapidly intensifying couplet heading toward user with high shear.',
  input: {
    temperature: 83,
    humidity: 76,
    pressure: 29.80,
    windSpeed: 25,
    windDirection: 195,
    windGust: 38,
    dewPoint: 70,
    cape: 2800,
    latitude: BASE.latitude,
    longitude: BASE.longitude,
    recentObservations: recentObs([
      { minsAgo: 30, temp: 84, hum: 73, pres: 29.90, spd: 18, dir: 180, gust: 26, dp: 69 },
      { minsAgo: 15, temp: 83, hum: 75, pres: 29.85, spd: 22, dir: 190, gust: 34, dp: 70 },
    ]),
    nearbyStations: stations([
      { speed: 30, dir: 215, latOff: 0.06, lonOff: 0.06 },
      { speed: 25, dir: 170, latOff: 0.06, lonOff: -0.06 },
      { speed: 22, dir: 250, latOff: -0.06, lonOff: 0.06 },
      { speed: 28, dir: 150, latOff: -0.06, lonOff: -0.06 },
      { speed: 34, dir: 225, latOff: 0.09, lonOff: 0.09 },
      { speed: 32, dir: 200, latOff: 0.09, lonOff: -0.09 },
    ]),
    nwsAlerts: [
      { event: 'Tornado Watch', severity: 'Moderate', headline: null },
    ],
    radarData: {
      velocityPoints: [
        {
          latitude: BASE.latitude + 0.022,
          longitude: BASE.longitude + 0.022,
          velocity: -58,
          stormRelativeVelocity: -48,
          reflectivity: 70,
          altitude: 1000,
        },
        {
          latitude: BASE.latitude - 0.022,
          longitude: BASE.longitude - 0.022,
          velocity: 52,
          stormRelativeVelocity: 42,
          reflectivity: 66,
          altitude: 1000,
        },
        {
          latitude: BASE.latitude + 0.015,
          longitude: BASE.longitude - 0.03,
          velocity: -55,
          stormRelativeVelocity: -45,
          reflectivity: 64,
          altitude: 800,
        },
        {
          latitude: BASE.latitude - 0.015,
          longitude: BASE.longitude + 0.03,
          velocity: 50,
          stormRelativeVelocity: 40,
          reflectivity: 68,
          altitude: 1200,
        },
      ],
      couplets: [
        {
          latitude: BASE.latitude + 0.018,
          longitude: BASE.longitude + 0.018,
          shear: 110,
          strength: 'EXTREME',
          distanceKm: 3.8,
          headingTowardUser: true,
        },
      ],
      stormCells: [
        {
          id: 'CELL-003',
          latitude: BASE.latitude + 0.03,
          longitude: BASE.longitude - 0.01,
          maxReflectivity: 75,
          top: 17,
          movement: 200,
          speed: 40,
        },
      ],
    },
  },
};

// ============================================================
// Scenario 5: Strong rotation weakening
// ============================================================
const SCENAR5: TestScenario = {
  name: '5. Strong Rotation Weakening',
  description:
    'Previously strong couplet is now weakening, moving away.',
  input: {
    temperature: 79,
    humidity: 70,
    pressure: 29.95,
    windSpeed: 18,
    windDirection: 210,
    windGust: 25,
    dewPoint: 65,
    cape: 1600,
    latitude: BASE.latitude,
    longitude: BASE.longitude,
    recentObservations: recentObs([
      { minsAgo: 45, temp: 80, hum: 74, pres: 29.88, spd: 22, dir: 200, gust: 35, dp: 66 },
      { minsAgo: 30, temp: 80, hum: 72, pres: 29.90, spd: 20, dir: 205, gust: 30, dp: 65.5 },
      { minsAgo: 15, temp: 79, hum: 71, pres: 29.93, spd: 18, dir: 208, gust: 26, dp: 65 },
    ]),
    nearbyStations: stations([
      { speed: 20, dir: 220, latOff: 0.06, lonOff: 0.06 },
      { speed: 18, dir: 195, latOff: 0.06, lonOff: -0.06 },
      { speed: 16, dir: 240, latOff: -0.06, lonOff: 0.06 },
      { speed: 19, dir: 185, latOff: -0.06, lonOff: -0.06 },
    ]),
    nwsAlerts: [],
    radarData: {
      velocityPoints: [
        {
          latitude: BASE.latitude + 0.04,
          longitude: BASE.longitude + 0.04,
          velocity: -30,
          stormRelativeVelocity: -22,
          reflectivity: 52,
          altitude: 1500,
        },
        {
          latitude: BASE.latitude - 0.04,
          longitude: BASE.longitude - 0.04,
          velocity: 28,
          stormRelativeVelocity: 20,
          reflectivity: 48,
          altitude: 1500,
        },
      ],
      couplets: [
        {
          latitude: BASE.latitude + 0.035,
          longitude: BASE.longitude + 0.035,
          shear: 42,
          strength: 'WEAK',
          distanceKm: 15.2,
          headingTowardUser: false,
        },
      ],
      stormCells: [
        {
          id: 'CELL-004',
          latitude: BASE.latitude + 0.05,
          longitude: BASE.longitude + 0.03,
          maxReflectivity: 55,
          top: 12,
          movement: 240,
          speed: 25,
        },
      ],
    },
  },
};

// ============================================================
// Scenario 6: Radar unavailable
// ============================================================
const SCENAR6: TestScenario = {
  name: '6. Radar Unavailable',
  description:
    'Environment data available but radar is down — rotation assessment limited.',
  input: {
    temperature: 81,
    humidity: 72,
    pressure: 29.82,
    windSpeed: 20,
    windDirection: 195,
    windGust: 30,
    dewPoint: 68,
    cape: 2100,
    latitude: BASE.latitude,
    longitude: BASE.longitude,
    recentObservations: recentObs([
      { minsAgo: 30, temp: 82, hum: 70, pres: 29.88, spd: 16, dir: 188, gust: 22, dp: 67 },
      { minsAgo: 15, temp: 81, hum: 71, pres: 29.85, spd: 18, dir: 192, gust: 26, dp: 67.5 },
    ]),
    nearbyStations: stations([
      { speed: 22, dir: 210, latOff: 0.05, lonOff: 0.05 },
      { speed: 18, dir: 175, latOff: 0.05, lonOff: -0.05 },
      { speed: 16, dir: 240, latOff: -0.05, lonOff: 0.05 },
      { speed: 20, dir: 160, latOff: -0.05, lonOff: -0.05 },
    ]),
    nwsAlerts: [],
  },
};

// ============================================================
// Scenario 7: Missing environmental parameters
// ============================================================
const SCENAR7: TestScenario = {
  name: '7. Missing Environmental Params',
  description:
    'Sparse data — no CAPE, no dewpoint, limited stations. Low confidence expected.',
  input: {
    temperature: 78,
    humidity: null,
    pressure: 30.05,
    windSpeed: 14,
    windDirection: 200,
    windGust: 18,
    dewPoint: null,
    cape: null,
    latitude: BASE.latitude,
    longitude: BASE.longitude,
    recentObservations: [],
    nearbyStations: stations([
      { speed: 14, dir: 200, latOff: 0.03, lonOff: 0.03 },
    ]),
    nwsAlerts: [],
  },
};

// ============================================================
// Scenario 8: Tornado Warning active
// ============================================================
const SCENAR8: TestScenario = {
  name: '8. Tornado Warning Active',
  description:
    'Official NWS Tornado Warning — should elevate the assessment significantly.',
  input: {
    temperature: 82,
    humidity: 80,
    pressure: 29.55,
    windSpeed: 30,
    windDirection: 195,
    windGust: 45,
    dewPoint: 73,
    cape: 3000,
    latitude: BASE.latitude,
    longitude: BASE.longitude,
    recentObservations: recentObs([
      { minsAgo: 20, temp: 83, hum: 78, pres: 29.68, spd: 22, dir: 185, gust: 32, dp: 72 },
      { minsAgo: 10, temp: 82, hum: 79, pres: 29.60, spd: 26, dir: 190, gust: 38, dp: 72.5 },
    ]),
    nearbyStations: stations([
      { speed: 35, dir: 215, latOff: 0.06, lonOff: 0.06 },
      { speed: 30, dir: 175, latOff: 0.06, lonOff: -0.06 },
      { speed: 28, dir: 245, latOff: -0.06, lonOff: 0.06 },
      { speed: 32, dir: 155, latOff: -0.06, lonOff: -0.06 },
    ]),
    nwsAlerts: [
      { event: 'Tornado Warning', severity: 'Extreme', headline: null },
    ],
    radarData: {
      velocityPoints: [
        {
          latitude: BASE.latitude + 0.02,
          longitude: BASE.longitude + 0.02,
          velocity: -62,
          stormRelativeVelocity: -52,
          reflectivity: 72,
          altitude: 1000,
        },
        {
          latitude: BASE.latitude - 0.02,
          longitude: BASE.longitude - 0.02,
          velocity: 55,
          stormRelativeVelocity: 45,
          reflectivity: 68,
          altitude: 1000,
        },
      ],
      couplets: [
        {
          latitude: BASE.latitude + 0.015,
          longitude: BASE.longitude + 0.015,
          shear: 115,
          strength: 'EXTREME',
          distanceKm: 2.4,
          headingTowardUser: true,
        },
      ],
      stormCells: [
        {
          id: 'CELL-005',
          latitude: BASE.latitude + 0.02,
          longitude: BASE.longitude - 0.01,
          maxReflectivity: 78,
          top: 18,
          movement: 200,
          speed: 35,
        },
      ],
    },
  },
};

// ============================================================
// Scenario 9: Strong circulation far from user
// ============================================================
const SCENAR9: TestScenario = {
  name: '9. Strong Circulation Far Away',
  description:
    'Powerful mesocyclone detected but 50+ km away — low immediate threat.',
  input: {
    temperature: 82,
    humidity: 70,
    pressure: 29.92,
    windSpeed: 15,
    windDirection: 200,
    windGust: 22,
    dewPoint: 66,
    cape: 2200,
    latitude: BASE.latitude,
    longitude: BASE.longitude,
    recentObservations: recentObs([
      { minsAgo: 30, temp: 82, hum: 69, pres: 29.96, spd: 14, dir: 195, gust: 20, dp: 66 },
    ]),
    nearbyStations: stations([
      { speed: 16, dir: 210, latOff: 0.05, lonOff: 0.05 },
      { speed: 14, dir: 185, latOff: 0.05, lonOff: -0.05 },
      { speed: 12, dir: 235, latOff: -0.05, lonOff: 0.05 },
      { speed: 15, dir: 170, latOff: -0.05, lonOff: -0.05 },
    ]),
    nwsAlerts: [{ event: 'Tornado Watch', severity: 'Moderate', headline: null }],
    radarData: {
      velocityPoints: [
        {
          latitude: BASE.latitude + 0.35,
          longitude: BASE.longitude + 0.35,
          velocity: -55,
          stormRelativeVelocity: -45,
          reflectivity: 68,
          altitude: 1200,
        },
        {
          latitude: BASE.latitude + 0.30,
          longitude: BASE.longitude + 0.40,
          velocity: 50,
          stormRelativeVelocity: 40,
          reflectivity: 65,
          altitude: 1200,
        },
      ],
      couplets: [
        {
          latitude: BASE.latitude + 0.33,
          longitude: BASE.longitude + 0.37,
          shear: 105,
          strength: 'EXTREME',
          distanceKm: 52.3,
          headingTowardUser: true,
        },
      ],
      stormCells: [
        {
          id: 'CELL-006',
          latitude: BASE.latitude + 0.40,
          longitude: BASE.longitude + 0.35,
          maxReflectivity: 70,
          top: 16,
          movement: 220,
          speed: 30,
        },
      ],
    },
  },
};

// ============================================================
// Scenario 10: Strong circulation approaching user
// ============================================================
const SCENAR10: TestScenario = {
  name: '10. Strong Circulation Approaching',
  description:
    'Mesocyclone only 8 km away and heading directly toward user.',
  input: {
    temperature: 84,
    humidity: 78,
    pressure: 29.70,
    windSpeed: 28,
    windDirection: 195,
    windGust: 42,
    dewPoint: 71,
    cape: 2900,
    latitude: BASE.latitude,
    longitude: BASE.longitude,
    recentObservations: recentObs([
      { minsAgo: 20, temp: 84, hum: 76, pres: 29.80, spd: 22, dir: 190, gust: 32, dp: 70 },
      { minsAgo: 10, temp: 84, hum: 77, pres: 29.75, spd: 25, dir: 192, gust: 38, dp: 70.5 },
    ]),
    nearbyStations: stations([
      { speed: 30, dir: 220, latOff: 0.06, lonOff: 0.06 },
      { speed: 26, dir: 170, latOff: 0.06, lonOff: -0.06 },
      { speed: 24, dir: 250, latOff: -0.06, lonOff: 0.06 },
      { speed: 28, dir: 150, latOff: -0.06, lonOff: -0.06 },
      { speed: 32, dir: 210, latOff: 0.08, lonOff: 0.08 },
    ]),
    nwsAlerts: [
      { event: 'Tornado Watch', severity: 'Moderate', headline: null },
      { event: 'Severe Thunderstorm Warning', severity: 'Severe', headline: null },
    ],
    radarData: {
      velocityPoints: [
        {
          latitude: BASE.latitude + 0.05,
          longitude: BASE.longitude + 0.05,
          velocity: -58,
          stormRelativeVelocity: -48,
          reflectivity: 70,
          altitude: 1100,
        },
        {
          latitude: BASE.latitude + 0.04,
          longitude: BASE.longitude + 0.06,
          velocity: 52,
          stormRelativeVelocity: 42,
          reflectivity: 66,
          altitude: 1100,
        },
        {
          latitude: BASE.latitude + 0.06,
          longitude: BASE.longitude + 0.04,
          velocity: -56,
          stormRelativeVelocity: -46,
          reflectivity: 64,
          altitude: 900,
        },
      ],
      couplets: [
        {
          latitude: BASE.latitude + 0.045,
          longitude: BASE.longitude + 0.05,
          shear: 100,
          strength: 'STRONG',
          distanceKm: 7.8,
          headingTowardUser: true,
        },
      ],
      stormCells: [
        {
          id: 'CELL-007',
          latitude: BASE.latitude + 0.06,
          longitude: BASE.longitude + 0.04,
          maxReflectivity: 74,
          top: 16,
          movement: 205,
          speed: 35,
        },
      ],
    },
  },
};

// ============================================================
// Scenario 11: Debris signature present (simulated)
// ============================================================
const SCENAR11: TestScenario = {
  name: '11. Debris Signature Present',
  description:
    'Extremely strong couplet with high reflectivity aloft — debris lofted.',
  input: {
    temperature: 85,
    humidity: 80,
    pressure: 29.60,
    windSpeed: 32,
    windDirection: 190,
    windGust: 50,
    dewPoint: 72,
    cape: 3500,
    latitude: BASE.latitude,
    longitude: BASE.longitude,
    recentObservations: recentObs([
      { minsAgo: 30, temp: 85, hum: 78, pres: 29.72, spd: 25, dir: 180, gust: 36, dp: 71 },
      { minsAgo: 15, temp: 85, hum: 79, pres: 29.66, spd: 28, dir: 185, gust: 42, dp: 71.5 },
    ]),
    nearbyStations: stations([
      { speed: 35, dir: 215, latOff: 0.06, lonOff: 0.06 },
      { speed: 30, dir: 165, latOff: 0.06, lonOff: -0.06 },
      { speed: 28, dir: 250, latOff: -0.06, lonOff: 0.06 },
      { speed: 33, dir: 145, latOff: -0.06, lonOff: -0.06 },
      { speed: 38, dir: 200, latOff: 0.08, lonOff: 0.08 },
      { speed: 36, dir: 195, latOff: -0.08, lonOff: -0.08 },
    ]),
    nwsAlerts: [
      { event: 'Tornado Warning', severity: 'Extreme', headline: null },
    ],
    radarData: {
      velocityPoints: [
        {
          latitude: BASE.latitude + 0.012,
          longitude: BASE.longitude + 0.012,
          velocity: -72,
          stormRelativeVelocity: -62,
          reflectivity: 78,
          altitude: 800,
        },
        {
          latitude: BASE.latitude - 0.012,
          longitude: BASE.longitude - 0.012,
          velocity: 68,
          stormRelativeVelocity: 58,
          reflectivity: 75,
          altitude: 800,
        },
        {
          latitude: BASE.latitude + 0.008,
          longitude: BASE.longitude - 0.015,
          velocity: -70,
          stormRelativeVelocity: -60,
          reflectivity: 80,
          altitude: 600,
        },
        {
          latitude: BASE.latitude - 0.008,
          longitude: BASE.longitude + 0.015,
          velocity: 65,
          stormRelativeVelocity: 55,
          reflectivity: 76,
          altitude: 1000,
        },
        {
          latitude: BASE.latitude + 0.01,
          longitude: BASE.longitude + 0.01,
          velocity: -68,
          stormRelativeVelocity: -58,
          reflectivity: 82,
          altitude: 1200,
        },
      ],
      couplets: [
        {
          latitude: BASE.latitude + 0.01,
          longitude: BASE.longitude + 0.01,
          shear: 140,
          strength: 'EXTREME',
          distanceKm: 1.5,
          headingTowardUser: true,
        },
      ],
      stormCells: [
        {
          id: 'CELL-008',
          latitude: BASE.latitude + 0.015,
          longitude: BASE.longitude + 0.01,
          maxReflectivity: 82,
          top: 19,
          movement: 195,
          speed: 38,
        },
      ],
    },
  },
};

// ============================================================
// Scenario 12: Debris signature unavailable
// ============================================================
const SCENAR12: TestScenario = {
  name: '12. Debris Signature Unavailable',
  description:
    'Possible tornado environment but no radar to assess debris.',
  input: {
    temperature: 83,
    humidity: 75,
    pressure: 29.78,
    windSpeed: 24,
    windDirection: 200,
    windGust: 35,
    dewPoint: 69,
    cape: 2400,
    latitude: BASE.latitude,
    longitude: BASE.longitude,
    recentObservations: recentObs([
      { minsAgo: 25, temp: 83, hum: 74, pres: 29.84, spd: 20, dir: 195, gust: 28, dp: 68 },
      { minsAgo: 10, temp: 83, hum: 75, pres: 29.80, spd: 22, dir: 198, gust: 32, dp: 69 },
    ]),
    nearbyStations: stations([
      { speed: 26, dir: 215, latOff: 0.05, lonOff: 0.05 },
      { speed: 22, dir: 180, latOff: 0.05, lonOff: -0.05 },
      { speed: 20, dir: 245, latOff: -0.05, lonOff: 0.05 },
      { speed: 24, dir: 160, latOff: -0.05, lonOff: -0.05 },
    ]),
    nwsAlerts: [
      { event: 'Tornado Watch', severity: 'Moderate', headline: null },
    ],
  },
};

// ============================================================
// All scenarios
// ============================================================

const SCENARIOS: TestScenario[] = [
  SCENAR1,
  SCENAR2,
  SCENAR3,
  SCENAR4,
  SCENAR5,
  SCENAR6,
  SCENAR7,
  SCENAR8,
  SCENAR9,
  SCENAR10,
  SCENAR11,
  SCENAR12,
];

// ============================================================
// Screen Component
// ============================================================

export default function AnalysisTestScreen() {
  const { result, analyze } = useTornadoAnalysis();
  const [activeScenario, setActiveScenario] = useState<string | null>(null);

  const runScenario = async (scenario: TestScenario) => {
    setActiveScenario(scenario.name);
    analyze(scenario.input);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Ionicons name="flask" size={20} color={Colors.primary} />
        <Text style={styles.headerText}>
          STORM ANALYSIS — TEST SCENARIOS
        </Text>
      </View>

      <Text style={styles.warning}>
        Developer testing only. Each button runs the 4-layer analysis engine
        with simulated weather and radar data.
      </Text>

      {SCENARIOS.map((scenario) => (
        <TouchableOpacity
          key={scenario.name}
          style={[
            styles.scenarioBtn,
            activeScenario === scenario.name && styles.scenarioBtnActive,
          ]}
          onPress={() => runScenario(scenario)}
        >
          <Text style={styles.scenarioName}>{scenario.name}</Text>
          <Text style={styles.scenarioDesc}>{scenario.description}</Text>
        </TouchableOpacity>
      ))}

      {/* Results */}
      <View style={{ marginTop: SPACING.lg }}>
        <TornadoAnalysisCard result={result as any} />
      </View>

      {activeScenario ? (
        <Text style={styles.activeLabel}>Last run: {activeScenario}</Text>
      ) : null}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ============================================================
// Styles
// ============================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: SPACING.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  headerText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  warning: {
    color: Colors.warning,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: SPACING.lg,
    padding: SPACING.md,
    backgroundColor: Colors.warning + '15',
    borderRadius: BORDER_RADIUS.sm,
  },
  scenarioBtn: {
    backgroundColor: Colors.surface,
    borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },
  scenarioBtnActive: {
    borderLeftColor: Colors.secondary,
    backgroundColor: Colors.surfaceVariant,
  },
  scenarioName: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  scenarioDesc: {
    color: Colors.textSecondary,
    fontSize: 12,
  },
  activeLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
});
