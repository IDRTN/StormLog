import Level2Radar from 'nexrad-level-2-data';
import { detectVelocityCouplets } from './couplet-detector.mjs';

const MIN_RAYS = 240;
const MIN_AZIMUTH_COVERAGE_DEG = 320;
const MAX_CHUNKS_PER_SWEEP = 32;
const MAX_SWEEP_BYTES = 8 * 1024 * 1024;
const MAX_FULL_VOLUME_BYTES = 12 * 1024 * 1024;

function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
function asArray(value) { return Array.isArray(value) ? value : value ? [value] : []; }
function toRad(v) { return v * Math.PI / 180; }
function toDeg(v) { return v * 180 / Math.PI; }
function angularDistance(a, b) { let d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); }

function destinationPoint(latitude, longitude, bearingDeg, distanceKm) {
  const r = 6371;
  const delta = distanceKm / r;
  const theta = toRad(bearingDeg);
  const phi1 = toRad(latitude);
  const lambda1 = toRad(longitude);
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lambda2 = lambda1 + Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
  return { latitude: toDeg(phi2), longitude: ((toDeg(lambda2) + 540) % 360) - 180 };
}

function countFinite(values) {
  if (!Array.isArray(values)) return 0;
  let count = 0;
  for (const value of values) if (finite(value)) count += 1;
  return count;
}

function azimuthCoverage(headers) {
  const values = headers.map(h => h?.azimuth).filter(finite).map(v => ((v % 360) + 360) % 360).sort((a, b) => a - b);
  if (values.length < 2) return 0;
  let maxGap = 0;
  for (let i = 1; i < values.length; i += 1) maxGap = Math.max(maxGap, values[i] - values[i - 1]);
  maxGap = Math.max(maxGap, 360 - values.at(-1) + values[0]);
  return 360 - maxGap;
}

function getLowestUsableTilt(radar, getterName, requireCompleteSweep = false) {
  const elevations = radar.listElevations().filter(finite).sort((a, b) => a - b);
  for (const elevation of elevations) {
    radar.setElevation(elevation);
    let moments;
    let headers;
    try {
      moments = asArray(radar[getterName]());
      headers = asArray(radar.getHeader());
    } catch {
      continue;
    }
    const usableMoments = [];
    const usableHeaders = [];
    const angles = [];
    for (let i = 0; i < moments.length; i += 1) {
      const moment = moments[i];
      const header = headers[i] ?? headers[0] ?? null;
      if (!header || !finite(header.azimuth) || countFinite(moment?.moment_data) < 2) continue;
      usableMoments.push(moment);
      usableHeaders.push(header);
      if (finite(header.elevation_angle)) angles.push(header.elevation_angle);
    }
    if (usableMoments.length < (requireCompleteSweep ? MIN_RAYS : 30)) continue;
    if (requireCompleteSweep && azimuthCoverage(usableHeaders) < MIN_AZIMUTH_COVERAGE_DEG) continue;
    angles.sort((a, b) => a - b);
    return {
      elevation,
      elevationAngle: angles.length ? angles[Math.floor(angles.length / 2)] : elevation,
      moments: usableMoments,
      headers: usableHeaders,
    };
  }
  return null;
}

function hasCompleteLowSweep(radar) {
  return Boolean(
    getLowestUsableTilt(radar, 'getHighresReflectivity', true)
    && getLowestUsableTilt(radar, 'getHighresVelocity', true)
  );
}

function maxMomentValue(tilt) {
  if (!tilt) return null;
  let max = -Infinity;
  for (const moment of tilt.moments) {
    if (!Array.isArray(moment?.moment_data)) continue;
    for (const value of moment.moment_data) if (finite(value) && value > max) max = value;
  }
  return Number.isFinite(max) ? max : null;
}

function medianMomentValue(tilt) {
  if (!tilt) return null;
  const values = [];
  outer: for (const moment of tilt.moments) {
    if (!Array.isArray(moment?.moment_data)) continue;
    for (const value of moment.moment_data) {
      if (finite(value)) values.push(value);
      if (values.length >= 4000) break outer;
    }
  }
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function valueAtPolar(tilt, azimuthDeg, rangeKm) {
  if (!tilt || !finite(azimuthDeg) || !finite(rangeKm)) return null;
  let bestIndex = -1, bestAz = Infinity;
  for (let i = 0; i < tilt.headers.length; i += 1) {
    const az = tilt.headers[i]?.azimuth;
    if (!finite(az)) continue;
    const d = angularDistance(az, azimuthDeg);
    if (d < bestAz) { bestAz = d; bestIndex = i; }
  }
  if (bestIndex < 0 || bestAz > 2) return null;
  const moment = tilt.moments[bestIndex];
  const firstGate = Number(moment?.first_gate);
  const gateSize = Number(moment?.gate_size);
  if (!finite(firstGate) || !finite(gateSize) || gateSize <= 0 || !Array.isArray(moment?.moment_data)) return null;
  const gate = Math.round((rangeKm - firstGate) / gateSize);
  if (gate < 0 || gate >= moment.moment_data.length) return null;
  const value = moment.moment_data[gate];
  return finite(value) ? value : null;
}

function sampleVelocityPoints(tilt, site, maxPoints = 240) {
  if (!tilt) return [];
  const points = [];
  const rayStep = Math.max(1, Math.floor(tilt.moments.length / 60));
  for (let ray = 0; ray < tilt.moments.length && points.length < maxPoints; ray += rayStep) {
    const moment = tilt.moments[ray];
    const azimuth = tilt.headers[ray]?.azimuth;
    const gateSize = Number(moment?.gate_size), firstGate = Number(moment?.first_gate);
    if (!finite(azimuth) || !finite(gateSize) || gateSize <= 0 || !finite(firstGate) || !Array.isArray(moment?.moment_data)) continue;
    const gateStep = Math.max(1, Math.floor(moment.moment_data.length / 6));
    for (let gate = 0; gate < moment.moment_data.length && points.length < maxPoints; gate += gateStep) {
      const velocity = moment.moment_data[gate];
      if (!finite(velocity)) continue;
      const rangeKm = firstGate + gate * gateSize;
      if (rangeKm < 1 || rangeKm > 230) continue;
      const p = destinationPoint(site.latitude, site.longitude, azimuth, rangeKm);
      points.push({ ...p, velocity, stormRelativeVelocity: velocity, reflectivity: 0, altitude: 0 });
    }
  }
  return points;
}

async function fetchBytes(url, label, minimumBytes = 100) {
  const response = await fetch(url, { headers: { 'User-Agent': 'StormLog-Radar/1.0' } });
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < minimumBytes) throw new Error(`${label} unexpectedly small: ${bytes.byteLength}`);
  return bytes;
}

async function buildLowestSweep(chunks, site) {
  let combined = null;
  let usedChunks = 0;
  let totalBytes = 0;
  for (const chunk of chunks) {
    if (usedChunks >= MAX_CHUNKS_PER_SWEEP) break;
    const bytes = await fetchBytes(chunk.url, 'Level II chunk');
    if (totalBytes + bytes.byteLength > MAX_SWEEP_BYTES) {
      throw new Error(`Low-level sweep exceeded ${MAX_SWEEP_BYTES} byte safety ceiling before completion`);
    }
    totalBytes += bytes.byteLength;
    const parsed = new Level2Radar(bytes, { logger: false });
    if (parsed.header?.ICAO && parsed.header.ICAO !== site.id) {
      throw new Error(`Radar ICAO mismatch: expected ${site.id}, got ${parsed.header.ICAO}`);
    }
    combined = combined ? Level2Radar.combineData(combined, parsed) : parsed;
    usedChunks += 1;
    if (hasCompleteLowSweep(combined)) return { radar: combined, usedChunks, totalBytes, sourceKind: 'chunks' };
  }
  throw new Error(`No complete low-level sweep after ${usedChunks} chunks (${totalBytes} bytes)`);
}

async function buildFullVolume(volume, site) {
  const bytes = await fetchBytes(volume.url, 'Level II full volume', 100000);
  if (bytes.byteLength > MAX_FULL_VOLUME_BYTES) {
    throw new Error(`Level II full volume exceeded ${MAX_FULL_VOLUME_BYTES} byte safety ceiling`);
  }
  const radar = new Level2Radar(bytes, { logger: false });
  if (radar.isTruncated) throw new Error(`${volume.id}: full volume decoded as truncated`);
  if (radar.header?.ICAO && radar.header.ICAO !== site.id) {
    throw new Error(`Radar ICAO mismatch: expected ${site.id}, got ${radar.header.ICAO}`);
  }
  if (!hasCompleteLowSweep(radar)) throw new Error(`${volume.id}: full volume has no complete low-level REF/VEL sweep`);
  return { radar, usedChunks: 0, totalBytes: bytes.byteLength, sourceKind: 'full-volume' };
}

async function buildRadar(volume, site) {
  if (typeof volume?.url === 'string' && volume.url.length > 0) {
    return buildFullVolume(volume, site);
  }
  if (Array.isArray(volume?.chunks) && volume.chunks.length > 0) {
    return buildLowestSweep(volume.chunks, site);
  }
  throw new Error('volume source required');
}

async function main() {
  const encoded = process.argv[2];
  if (!encoded) throw new Error('worker payload required');
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  const { volume, site, includeDetail } = payload;
  if (!volume || !site) throw new Error('volume and site required');

  const { radar, usedChunks, totalBytes, sourceKind } = await buildRadar(volume, site);
  const reflectivityTilt = getLowestUsableTilt(radar, 'getHighresReflectivity', true);
  const velocityTilt = getLowestUsableTilt(radar, 'getHighresVelocity', true);
  if (!reflectivityTilt) throw new Error(`${volume.id}: quantitative reflectivity unavailable`);
  if (!velocityTilt) throw new Error(`${volume.id}: Doppler velocity unavailable`);

  const maxReflectivityDbz = maxMomentValue(reflectivityTilt);
  const azimuths = velocityTilt.headers.map(h => h.azimuth);
  const rawCouplets = detectVelocityCouplets({ azimuths, velocityMoments: velocityTilt.moments, maxCandidates: 40 });
  const strongest = [...rawCouplets].sort((a, b) => b.deltaVKt - a.deltaVKt)[0] ?? null;
  const gateSizeKm = Number(velocityTilt?.moments?.[0]?.gate_size);
  const elevationAngle = finite(velocityTilt.elevationAngle) ? velocityTilt.elevationAngle : 0.5;
  const velocityPoints = includeDetail ? sampleVelocityPoints(velocityTilt, site) : [];

  let correlationCoefficient = null;
  let differentialReflectivity = null;
  const colocatedReflectivity = strongest ? valueAtPolar(reflectivityTilt, strongest.azimuthDeg, strongest.rangeKm) : null;

  if (includeDetail) {
    const ccTilt = getLowestUsableTilt(radar, 'getHighresCorrelationCoefficient', true);
    correlationCoefficient = strongest ? valueAtPolar(ccTilt, strongest.azimuthDeg, strongest.rangeKm) : medianMomentValue(ccTilt);
    const zdrTilt = getLowestUsableTilt(radar, 'getHighresDiffReflectivity', true);
    differentialReflectivity = strongest ? valueAtPolar(zdrTilt, strongest.azimuthDeg, strongest.rangeKm) : medianMomentValue(zdrTilt);
  }

  process.stdout.write(JSON.stringify({
    timestamp: volume.timestamp ?? Date.now(),
    name: volume.id,
    sourceKind,
    usedChunks,
    totalBytes,
    maxReflectivityDbz,
    rawCouplets,
    gateSizeKm: finite(gateSizeKm) ? gateSizeKm : null,
    elevationAngle,
    velocityPoints,
    correlationCoefficient: finite(correlationCoefficient) ? correlationCoefficient : null,
    differentialReflectivity: finite(differentialReflectivity) ? differentialReflectivity : null,
    colocatedReflectivity: finite(colocatedReflectivity) ? colocatedReflectivity : null,
  }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
