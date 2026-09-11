import http from 'node:http';
import { pathToFileURL } from 'node:url';
import Level2Radar from 'nexrad-level-2-data';
import { detectVelocityCouplets } from './couplet-detector.mjs';
import { trackRotationAcrossScans } from './scan-tracker.mjs';
import { evaluateDualPolEvidence } from './dual-pol-evidence.mjs';

const RADAR_SITES = [
  { id: 'KILN', latitude: 39.4203, longitude: -83.8217 },
  { id: 'KCLE', latitude: 41.4132, longitude: -81.8597 },
  { id: 'KDTX', latitude: 42.6999, longitude: -83.4717 },
  { id: 'KIWX', latitude: 41.3587, longitude: -85.7000 },
  { id: 'KPBZ', latitude: 40.5317, longitude: -80.2179 },
  { id: 'KRLX', latitude: 38.3111, longitude: -81.7233 },
];

const CACHE_MS = 60_000;
const cache = new Map();

function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
function toRad(v) { return v * Math.PI / 180; }
function toDeg(v) { return v * 180 / Math.PI; }
function angularDistance(a, b) { let d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); }

export function haversineKm(lat1, lon1, lat2, lon2) {
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

export function destinationPoint(latitude, longitude, bearingDeg, distanceKm) {
  const r = 6371;
  const delta = distanceKm / r;
  const theta = toRad(bearingDeg);
  const phi1 = toRad(latitude);
  const lambda1 = toRad(longitude);
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lambda2 = lambda1 + Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
  return { latitude: toDeg(phi2), longitude: ((toDeg(lambda2) + 540) % 360) - 180 };
}

export function nearestRadarSite(latitude, longitude, maxDistanceKm = 350) {
  if (!finite(latitude) || !finite(longitude)) return null;
  let best = null;
  for (const site of RADAR_SITES) {
    const distanceKm = haversineKm(latitude, longitude, site.latitude, site.longitude);
    if (!best || distanceKm < best.distanceKm) best = { ...site, distanceKm };
  }
  return best && best.distanceKm <= maxDistanceKm ? best : null;
}

async function listLatestVolumeUrls(siteId, count) {
  const base = `https://nomads.ncep.noaa.gov/pub/data/nccf/radar/nexrad_level2/${siteId}`;
  const response = await fetch(`${base}/dir.list`, { headers: { Accept: 'text/plain', 'User-Agent': 'StormLog-Radar/1.0' } });
  if (!response.ok) throw new Error(`NOMADS dir.list HTTP ${response.status}`);
  const text = await response.text();
  const names = [...text.matchAll(/(K[A-Z0-9]{3}_\d{8}_\d{6}\.bz2)/g)].map(m => m[1]);
  const unique = [...new Set(names)].sort();
  if (!unique.length) throw new Error(`No Level II volumes listed for ${siteId}`);
  return unique.slice(-Math.max(1, count)).map(name => ({ name, url: `${base}/${name}`, timestamp: parseVolumeTime(name) }));
}

function parseVolumeTime(name) {
  const m = name.match(/_(\d{8})_(\d{6})\.bz2$/);
  if (!m) return null;
  const d = m[1], t = m[2];
  return Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));
}

async function fetchRadarVolume(entry) {
  const response = await fetch(entry.url, { headers: { 'User-Agent': 'StormLog-Radar/1.0' } });
  if (!response.ok) throw new Error(`NOMADS Level II ${entry.name} HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 100_000) throw new Error(`Level II volume unexpectedly small: ${bytes.byteLength}`);
  const radar = new Level2Radar(bytes, { logger: false });
  if (radar.isTruncated) throw new Error(`${entry.name} decoded as truncated`);
  return radar;
}

function asArray(value) { return Array.isArray(value) ? value : value ? [value] : []; }

function hasMinimumFiniteValues(moment, minimum = 2) {
  if (!Array.isArray(moment?.moment_data)) return false;
  let count = 0;
  for (const value of moment.moment_data) {
    if (finite(value) && ++count >= minimum) return true;
  }
  return false;
}

function getLowestUsableTilt(radar, getterName) {
  const elevations = radar.listElevations().filter(finite).sort((a, b) => a - b);
  for (const elevation of elevations) {
    radar.setElevation(elevation);
    const moments = asArray(radar[getterName]());
    const headers = asArray(radar.getHeader());
    const usableMoments = [];
    const usableHeaders = [];
    const angles = [];
    for (let i = 0; i < moments.length; i += 1) {
      const moment = moments[i];
      const header = headers[i] ?? headers[0] ?? null;
      if (!header || !finite(header.azimuth) || !hasMinimumFiniteValues(moment, 2)) continue;
      usableMoments.push(moment);
      usableHeaders.push(header);
      if (finite(header.elevation_angle)) angles.push(header.elevation_angle);
    }
    if (usableMoments.length < 30) continue;
    angles.sort((a, b) => a - b);
    const elevationAngle = angles.length ? angles[Math.floor(angles.length / 2)] : elevation;
    return { elevation, elevationAngle, moments: usableMoments, headers: usableHeaders };
  }
  return null;
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
  for (const moment of tilt.moments) {
    if (!Array.isArray(moment?.moment_data)) continue;
    for (const value of moment.moment_data) {
      if (finite(value)) values.push(value);
      if (values.length >= 20_000) break;
    }
    if (values.length >= 20_000) break;
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
  if (bestIndex < 0 || bestAz > 2.0) return null;
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

function coupletPayload(candidate, site, velocityTilt, scanCount = 1) {
  const p = destinationPoint(site.latitude, site.longitude, candidate.azimuthDeg, candidate.rangeKm);
  const gateSizeKm = Number(velocityTilt?.moments?.[0]?.gate_size);
  const diameterKm = finite(gateSizeKm) && gateSizeKm > 0 ? Math.max(0.5, gateSizeKm * 2) : 0.5;
  const elevationAngle = finite(velocityTilt?.elevationAngle) ? velocityTilt.elevationAngle : 0.5;
  const beamHeightKm = candidate.rangeKm * Math.tan(toRad(Math.max(0, elevationAngle)));
  return {
    latitude: p.latitude,
    longitude: p.longitude,
    shear: candidate.deltaVKt,
    strength: candidate.strength,
    distanceKm: diameterKm / 2,
    headingTowardUser: false,
    azimuthalShear: candidate.deltaVKt / diameterKm,
    altitude: beamHeightKm * 1000,
    lowLevel: beamHeightKm < 3,
    scanCount,
    _azimuthDeg: candidate.azimuthDeg,
    _rangeKm: candidate.rangeKm,
  };
}

function matchingTrack(c, tracks) {
  let best = null, metric = Infinity;
  for (const track of tracks) {
    const latest = track.latest;
    if (!latest) continue;
    const ad = angularDistance(latest.azimuthDeg, c.azimuthDeg);
    const rd = Math.abs(latest.rangeKm - c.rangeKm);
    const m = ad / 4 + rd / 5;
    if (ad <= 4 && rd <= 5 && m < metric) { best = track; metric = m; }
  }
  return best;
}

function detectCoupletsFromVelocityTilt(velocityTilt) {
  const azimuths = velocityTilt.headers.map(h => h.azimuth);
  return detectVelocityCouplets({ azimuths, velocityMoments: velocityTilt.moments, maxCandidates: 40 });
}

async function decodeDetailedScan(entry, site) {
  const radar = await fetchRadarVolume(entry);
  if (radar.header?.ICAO && radar.header.ICAO !== site.id) throw new Error(`Radar ICAO mismatch: expected ${site.id}, got ${radar.header.ICAO}`);
  const reflectivityTilt = getLowestUsableTilt(radar, 'getHighresReflectivity');
  const velocityTilt = getLowestUsableTilt(radar, 'getHighresVelocity');
  if (!reflectivityTilt) throw new Error(`${entry.name}: quantitative reflectivity unavailable`);
  if (!velocityTilt) throw new Error(`${entry.name}: Doppler velocity unavailable`);
  const rawCouplets = detectCoupletsFromVelocityTilt(velocityTilt);
  const ccTilt = getLowestUsableTilt(radar, 'getHighresCorrelationCoefficient');
  const zdrTilt = getLowestUsableTilt(radar, 'getHighresDiffReflectivity');
  return {
    timestamp: entry.timestamp ?? Date.now(),
    name: entry.name,
    reflectivityTilt,
    velocityTilt,
    ccTilt,
    zdrTilt,
    maxReflectivityDbz: maxMomentValue(reflectivityTilt),
    rawCouplets,
  };
}

async function decodeTrackingScan(entry, site) {
  const radar = await fetchRadarVolume(entry);
  if (radar.header?.ICAO && radar.header.ICAO !== site.id) throw new Error(`Radar ICAO mismatch: expected ${site.id}, got ${radar.header?.ICAO}`);
  const velocityTilt = getLowestUsableTilt(radar, 'getHighresVelocity');
  if (!velocityTilt) throw new Error(`${entry.name}: Doppler velocity unavailable`);
  return {
    timestamp: entry.timestamp ?? Date.now(),
    name: entry.name,
    rawCouplets: detectCoupletsFromVelocityTilt(velocityTilt),
  };
}

export async function analyzeRadar(latitude, longitude, { volumeCount = 3 } = {}) {
  const site = nearestRadarSite(latitude, longitude);
  if (!site) return unavailable(null, 'No supported NEXRAD Level II site within 350 km');
  const cacheKey = `${site.id}:${latitude.toFixed(2)}:${longitude.toFixed(2)}:${volumeCount}`;
  const existing = cache.get(cacheKey);
  if (existing && Date.now() - existing.at < CACHE_MS) return existing.value;

  let entries;
  try { entries = await listLatestVolumeUrls(site.id, Math.max(volumeCount, 3)); }
  catch (error) { return unavailable(site.id, error instanceof Error ? error.message : String(error)); }

  const failures = [];
  const newestFirst = [...entries].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  let latest = null;
  let latestIndex = -1;
  for (let i = 0; i < newestFirst.length; i += 1) {
    try {
      latest = await decodeDetailedScan(newestFirst[i], site);
      latestIndex = i;
      break;
    } catch (error) {
      failures.push(`${newestFirst[i].name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!latest) return unavailable(site.id, failures.join(' | ') || 'No Level II scans decoded');

  const trackingScans = [{ timestamp: latest.timestamp, rawCouplets: latest.rawCouplets }];
  for (let i = latestIndex + 1; i < newestFirst.length && trackingScans.length < volumeCount; i += 1) {
    try {
      const summary = await decodeTrackingScan(newestFirst[i], site);
      trackingScans.push(summary);
    } catch (error) {
      failures.push(`${newestFirst[i].name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  trackingScans.sort((a, b) => a.timestamp - b.timestamp);
  const trackInput = trackingScans.map(s => ({ timestamp: s.timestamp, couplets: s.rawCouplets }));
  const tracks = trackRotationAcrossScans(trackInput);
  const couplets = latest.rawCouplets.map(c => {
    const track = matchingTrack(c, tracks);
    return coupletPayload(c, site, latest.velocityTilt, track?.scanCount ?? 1);
  });
  const strongestRaw = [...latest.rawCouplets].sort((a, b) => b.deltaVKt - a.deltaVKt)[0] ?? null;
  const bestTrack = tracks.find(t => strongestRaw && angularDistance(t.latest.azimuthDeg, strongestRaw.azimuthDeg) <= 4 && Math.abs(t.latest.rangeKm - strongestRaw.rangeKm) <= 5) ?? tracks[0] ?? null;

  const cc = strongestRaw ? valueAtPolar(latest.ccTilt, strongestRaw.azimuthDeg, strongestRaw.rangeKm) : medianMomentValue(latest.ccTilt);
  const zdr = strongestRaw ? valueAtPolar(latest.zdrTilt, strongestRaw.azimuthDeg, strongestRaw.rangeKm) : medianMomentValue(latest.zdrTilt);
  const colocatedReflectivity = strongestRaw ? valueAtPolar(latest.reflectivityTilt, strongestRaw.azimuthDeg, strongestRaw.rangeKm) : latest.maxReflectivityDbz;
  const strongestCouplet = couplets[0] ?? null;
  const dualPol = evaluateDualPolEvidence({
    correlationCoefficient: cc,
    differentialReflectivity: zdr,
    reflectivityDbz: colocatedReflectivity,
    hasVelocityCouplet: Boolean(strongestCouplet),
    lowLevel: strongestCouplet?.lowLevel === true,
  });

  const result = {
    available: true,
    stationId: site.id,
    latestFrameTime: latest.timestamp,
    hasPrecipitation: finite(latest.maxReflectivityDbz) && latest.maxReflectivityDbz >= 5,
    maxReflectivityDbz: latest.maxReflectivityDbz,
    velocityPoints: sampleVelocityPoints(latest.velocityTilt, site),
    couplets: couplets.map(({ _azimuthDeg, _rangeKm, ...c }) => c),
    stormCells: [],
    correlationCoefficient: finite(cc) ? cc : null,
    differentialReflectivity: finite(zdr) ? zdr : null,
    scanCount: trackingScans.length,
    trend: bestTrack?.trend ?? 'UNKNOWN',
    dualPolEvidence: dualPol,
    source: 'NOAA/NCEP NOMADS NEXRAD Level II',
    failedScans: failures.length,
  };
  cache.set(cacheKey, { at: Date.now(), value: result });
  return result;
}

function unavailable(stationId, reason) {
  return {
    available: false, stationId, latestFrameTime: null, hasPrecipitation: false, maxReflectivityDbz: null,
    velocityPoints: [], couplets: [], stormCells: [], correlationCoefficient: null, differentialReflectivity: null,
    scanCount: 0, trend: null, unavailableReason: reason,
  };
}

export function createRadarServer({ port = Number(process.env.PORT || 8788) } = {}) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (!req.url) { res.statusCode = 400; res.end(JSON.stringify({ error: 'missing URL' })); return; }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') {
      res.end(JSON.stringify({ ok: true, service: 'stormlog-radar-analysis' }));
      return;
    }
    if (url.pathname !== '/radar') { res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' })); return; }
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    if (!finite(lat) || !finite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      res.statusCode = 400; res.end(JSON.stringify({ error: 'valid lat/lon required' })); return;
    }
    try {
      const result = await analyzeRadar(lat, lon);
      res.statusCode = result.available ? 200 : 503;
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  return new Promise(resolve => server.listen(port, () => resolve(server)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await createRadarServer();
  console.log(`StormLog radar service listening on ${server.address().port}`);
}
