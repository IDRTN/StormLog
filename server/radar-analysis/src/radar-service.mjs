import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { trackRotationAcrossScans } from './scan-tracker.mjs';
import { evaluateDualPolEvidence } from './dual-pol-evidence.mjs';

const execFileAsync = promisify(execFile);
const WORKER_PATH = fileURLToPath(new URL('./radar-scan-worker.mjs', import.meta.url));
const NOMADS_ROOT = 'https://nomads.ncep.noaa.gov/pub/data/nccf/radar/nexrad_level2';

const RADAR_SITES = [
  { id: 'KILN', latitude: 39.4203, longitude: -83.8217 },
  { id: 'KCLE', latitude: 41.4132, longitude: -81.8597 },
  { id: 'KDTX', latitude: 42.6999, longitude: -83.4717 },
  { id: 'KIWX', latitude: 41.3587, longitude: -85.7000 },
  { id: 'KPBZ', latitude: 40.5317, longitude: -80.2179 },
  { id: 'KRLX', latitude: 38.3111, longitude: -81.7233 },
];

const CACHE_MS = 60_000;
const MAX_CANDIDATE_VOLUMES = 4;
const MAX_SCAN_AGE_MS = 20 * 60_000;
const MAX_SITE_FALLBACKS = 1;
const LIST_TIMEOUT_MS = 10_000;
const WORKER_TIMEOUT_MS = 85_000;
const REQUEST_BUDGET_MS = 110_000;
const MAX_TRACKED_SCANS = 3;
const cache = new Map();
const scanHistory = new Map();

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

export function radarSitesByDistance(latitude, longitude, maxDistanceKm = 350) {
  if (!finite(latitude) || !finite(longitude)) return [];
  return RADAR_SITES
    .map(site => ({ ...site, distanceKm: haversineKm(latitude, longitude, site.latitude, site.longitude) }))
    .filter(site => site.distanceKm <= maxDistanceKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

export function nearestRadarSite(latitude, longitude, maxDistanceKm = 350) {
  return radarSitesByDistance(latitude, longitude, maxDistanceKm)[0] ?? null;
}

function parseNomadsTime(name) {
  const m = name.match(/_(\d{8})_(\d{6})\.bz2$/);
  if (!m) return null;
  const d = m[1], t = m[2];
  return Date.UTC(
    Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)),
    Number(t.slice(0, 2)), Number(t.slice(2, 4)), Number(t.slice(4, 6)),
  );
}

async function listRecentNomadsVolumes(siteId) {
  const base = `${NOMADS_ROOT}/${siteId}`;
  const response = await fetch(`${base}/dir.list`, {
    headers: { Accept: 'text/plain', 'User-Agent': 'StormLog-Radar/1.0' },
    signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${siteId}: NOMADS dir.list HTTP ${response.status}`);
  const text = await response.text();
  const pattern = new RegExp(`(${siteId}_\\d{8}_\\d{6}\\.bz2)`, 'g');
  const names = [...new Set([...text.matchAll(pattern)].map(match => match[1]))];
  const volumes = names
    .map(name => ({
      id: name,
      siteId,
      timestamp: parseNomadsTime(name),
      url: `${base}/${name}`,
      source: 'NOAA/NCEP NOMADS NEXRAD Level II',
    }))
    .filter(volume => finite(volume.timestamp))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_CANDIDATE_VOLUMES);
  if (!volumes.length) throw new Error(`${siteId}: no recent NOMADS Level II volumes listed`);
  return volumes;
}

async function runScanWorker(volume, site, includeDetail) {
  const encoded = Buffer.from(JSON.stringify({ volume, site, includeDetail }), 'utf8').toString('base64url');
  const { stdout } = await execFileAsync(process.execPath, ['--max-old-space-size=180', WORKER_PATH, encoded], {
    timeout: WORKER_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: '', RADAR_ALLOW_FULL_VOLUME_DECODE: '1' },
  });
  const result = JSON.parse(stdout);
  if (!result || !Array.isArray(result.rawCouplets)) throw new Error(`${volume.id}: invalid worker result`);
  return result;
}

function coupletPayload(candidate, site, scan, scanCount = 1) {
  const p = destinationPoint(site.latitude, site.longitude, candidate.azimuthDeg, candidate.rangeKm);
  const gateSizeKm = Number(scan.gateSizeKm);
  const diameterKm = finite(gateSizeKm) && gateSizeKm > 0 ? Math.max(0.5, gateSizeKm * 2) : 0.5;
  const elevationAngle = finite(scan.elevationAngle) ? scan.elevationAngle : 0.5;
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
  if (!c) return null;
  let best = null;
  let metric = Infinity;
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

function rememberScan(siteId, scan, volumeCount) {
  const now = Date.now();
  const previous = scanHistory.get(siteId) ?? [];
  const merged = [...previous.filter(item => now - item.timestamp <= MAX_SCAN_AGE_MS), {
    timestamp: scan.timestamp,
    couplets: scan.rawCouplets,
  }];
  const byTimestamp = new Map();
  for (const item of merged) byTimestamp.set(item.timestamp, item);
  const keep = [...byTimestamp.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-Math.max(1, Math.min(MAX_TRACKED_SCANS, volumeCount)));
  scanHistory.set(siteId, keep);
  return keep;
}

async function analyzeVolumeSeries(site, volumes, volumeCount, deadline) {
  const failures = [];
  let latest = null;

  for (const volume of volumes) {
    if (Date.now() >= deadline) break;
    if (!finite(volume.timestamp) || Date.now() - volume.timestamp > MAX_SCAN_AGE_MS) continue;
    try {
      const scan = await runScanWorker(volume, site, true);
      if (!finite(scan.timestamp) || Date.now() - scan.timestamp > MAX_SCAN_AGE_MS) {
        throw new Error(`${volume.id}: decoded scan is stale`);
      }
      if (!finite(scan.maxReflectivityDbz)) throw new Error(`${volume.id}: reflectivity missing`);
      if (!Array.isArray(scan.velocityPoints) || scan.velocityPoints.length === 0) throw new Error(`${volume.id}: velocity missing`);
      latest = scan;
      break;
    } catch (error) {
      failures.push(`${volume.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!latest) {
    throw new Error(failures.join(' | ') || `${site.id}: no fresh complete NOMADS Level II volume decoded`);
  }

  // Persistence is built from independent live refreshes instead of decoding
  // several historical full volumes inside one request. This keeps the live
  // path bounded and prevents one request from exhausting Render's CPU budget.
  const trackingScans = rememberScan(site.id, latest, volumeCount);
  const tracks = trackRotationAcrossScans(trackingScans);
  const couplets = latest.rawCouplets.map(c => {
    const track = matchingTrack(c, tracks);
    return coupletPayload(c, site, latest, track?.scanCount ?? 1);
  });

  const strongestRaw = [...latest.rawCouplets].sort((a, b) => b.deltaVKt - a.deltaVKt)[0] ?? null;
  const strongestTrack = matchingTrack(strongestRaw, tracks);
  const strongestCouplet = strongestRaw ? coupletPayload(strongestRaw, site, latest, strongestTrack?.scanCount ?? 1) : null;
  const bestTrack = strongestTrack ?? tracks[0] ?? null;

  const cc = finite(latest.correlationCoefficient) ? latest.correlationCoefficient : null;
  const zdr = finite(latest.differentialReflectivity) ? latest.differentialReflectivity : null;
  const colocatedReflectivity = finite(latest.colocatedReflectivity) ? latest.colocatedReflectivity : null;
  const dualPol = evaluateDualPolEvidence({
    correlationCoefficient: cc,
    differentialReflectivity: zdr,
    reflectivityDbz: colocatedReflectivity,
    hasVelocityCouplet: Boolean(strongestCouplet),
    lowLevel: strongestCouplet?.lowLevel === true,
    scanCount: strongestCouplet?.scanCount ?? 0,
  });

  return {
    available: true,
    stationId: site.id,
    nearestSiteId: site.id,
    radarDistanceKm: site.distanceKm,
    latestFrameTime: latest.timestamp,
    hasPrecipitation: latest.maxReflectivityDbz >= 5,
    maxReflectivityDbz: latest.maxReflectivityDbz,
    velocityPoints: latest.velocityPoints,
    couplets: couplets.map(({ _azimuthDeg, _rangeKm, ...c }) => c),
    stormCells: [],
    correlationCoefficient: cc,
    differentialReflectivity: zdr,
    scanCount: trackingScans.length,
    trend: bestTrack?.trend ?? 'UNKNOWN',
    dualPolEvidence: dualPol,
    source: 'NOAA/NCEP NOMADS NEXRAD Level II',
    sourceKind: latest.sourceKind ?? 'full-volume',
    usedChunks: 0,
    failedScans: failures.length,
  };
}

async function analyzeSiteRadar(site, volumeCount, deadline) {
  const volumes = await listRecentNomadsVolumes(site.id);
  const newest = volumes[0]?.timestamp;
  if (!finite(newest) || Date.now() - newest > MAX_SCAN_AGE_MS) {
    throw new Error(`${site.id}: newest NOMADS Level II volume is stale`);
  }
  return analyzeVolumeSeries(site, volumes, volumeCount, deadline);
}

export async function analyzeRadar(latitude, longitude, { volumeCount = 3 } = {}) {
  const sites = radarSitesByDistance(latitude, longitude);
  if (!sites.length) return unavailable(null, 'No supported NEXRAD Level II site within 350 km');

  const cacheKey = `${latitude.toFixed(2)}:${longitude.toFixed(2)}:${volumeCount}`;
  const existing = cache.get(cacheKey);
  if (existing && Date.now() - existing.at < CACHE_MS) return existing.value;

  const deadline = Date.now() + REQUEST_BUDGET_MS;
  const failures = [];
  for (const site of sites.slice(0, MAX_SITE_FALLBACKS)) {
    try {
      const result = await analyzeSiteRadar(site, volumeCount, deadline);
      cache.set(cacheKey, { at: Date.now(), value: result });
      return result;
    } catch (error) {
      failures.push(`${site.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const reason = failures.join(' | ') || 'Nearest Level II radar unavailable within request budget';
  console.error(`[radar-service] unavailable: ${reason}`);
  return unavailable(sites[0].id, reason);
}

function unavailable(stationId, reason) {
  return {
    available: false,
    stationId,
    nearestSiteId: stationId,
    latestFrameTime: null,
    hasPrecipitation: false,
    maxReflectivityDbz: null,
    velocityPoints: [],
    couplets: [],
    stormCells: [],
    correlationCoefficient: null,
    differentialReflectivity: null,
    scanCount: 0,
    trend: null,
    dualPolEvidence: {
      available: false,
      debrisCandidate: false,
      debrisSignature: false,
      confidence: null,
      scanCount: 0,
      reason: 'Radar unavailable',
    },
    unavailableReason: reason,
  };
}

export function createRadarServer({ port = Number(process.env.PORT || 8788) } = {}) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (!req.url) { res.statusCode = 400; res.end(JSON.stringify({ error: 'missing URL' })); return; }
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/health') {
      res.end(JSON.stringify({ ok: true, service: 'stormlog-radar-analysis', mode: 'nomads-live-history-worker' }));
      return;
    }
    if (url.pathname !== '/radar') {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    if (!finite(lat) || !finite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'valid lat/lon required' }));
      return;
    }

    try {
      const result = await analyzeRadar(lat, lon);
      res.statusCode = result.available ? 200 : 503;
      res.end(JSON.stringify(result));
    } catch (error) {
      console.error('[radar-service] request failed:', error);
      res.statusCode = 502;
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  server.requestTimeout = REQUEST_BUDGET_MS + 10_000;
  return new Promise(resolve => server.listen(port, () => resolve(server)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await createRadarServer();
  console.log(`StormLog radar service listening on ${server.address().port}`);
}
