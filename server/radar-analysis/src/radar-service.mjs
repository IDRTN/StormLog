import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { trackRotationAcrossScans } from './scan-tracker.mjs';
import { evaluateDualPolEvidence } from './dual-pol-evidence.mjs';

const execFileAsync = promisify(execFile);
const WORKER_PATH = fileURLToPath(new URL('./radar-scan-worker.mjs', import.meta.url));

const RADAR_SITES = [
  { id: 'KILN', latitude: 39.4203, longitude: -83.8217 },
  { id: 'KCLE', latitude: 41.4132, longitude: -81.8597 },
  { id: 'KDTX', latitude: 42.6999, longitude: -83.4717 },
  { id: 'KIWX', latitude: 41.3587, longitude: -85.7000 },
  { id: 'KPBZ', latitude: 40.5317, longitude: -80.2179 },
  { id: 'KRLX', latitude: 38.3111, longitude: -81.7233 },
];

const CACHE_MS = 60_000;
const MAX_CANDIDATE_VOLUMES = 8;
const MAX_SCAN_AGE_MS = 20 * 60_000;
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

function parseVolumeTime(name) {
  const m = name.match(/_(\d{8})_(\d{6})\.bz2$/);
  if (!m) return null;
  const d = m[1], t = m[2];
  return Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));
}

async function listLatestVolumeUrls(siteId, count = MAX_CANDIDATE_VOLUMES) {
  const base = `https://nomads.ncep.noaa.gov/pub/data/nccf/radar/nexrad_level2/${siteId}`;
  const response = await fetch(`${base}/dir.list`, { headers: { Accept: 'text/plain', 'User-Agent': 'StormLog-Radar/1.0' } });
  if (!response.ok) throw new Error(`NOMADS dir.list HTTP ${response.status}`);
  const text = await response.text();
  const names = [...text.matchAll(/(K[A-Z0-9]{3}_\d{8}_\d{6}\.bz2)/g)].map(m => m[1]);
  const unique = [...new Set(names)].sort();
  if (!unique.length) throw new Error(`No Level II volumes listed for ${siteId}`);
  return unique.slice(-Math.max(1, count)).map(name => ({ name, url: `${base}/${name}`, timestamp: parseVolumeTime(name) }));
}

async function runScanWorker(entry, site, includeDetail) {
  const encoded = Buffer.from(JSON.stringify({ entry, site, includeDetail }), 'utf8').toString('base64url');
  const { stdout } = await execFileAsync(process.execPath, ['--max-old-space-size=320', WORKER_PATH, encoded], {
    timeout: 75_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  const result = JSON.parse(stdout);
  if (!result || !Array.isArray(result.rawCouplets)) throw new Error(`${entry.name}: invalid worker result`);
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

export async function analyzeRadar(latitude, longitude, { volumeCount = 3 } = {}) {
  const site = nearestRadarSite(latitude, longitude);
  if (!site) return unavailable(null, 'No supported NEXRAD Level II site within 350 km');

  const cacheKey = `${site.id}:${latitude.toFixed(2)}:${longitude.toFixed(2)}:${volumeCount}`;
  const existing = cache.get(cacheKey);
  if (existing && Date.now() - existing.at < CACHE_MS) return existing.value;

  let entries;
  try { entries = await listLatestVolumeUrls(site.id, MAX_CANDIDATE_VOLUMES); }
  catch (error) { return unavailable(site.id, error instanceof Error ? error.message : String(error)); }

  const newestFirst = [...entries].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  const failures = [];
  let latest = null;
  let latestIndex = -1;

  for (let i = 0; i < newestFirst.length; i += 1) {
    try {
      const scan = await runScanWorker(newestFirst[i], site, true);
      if (!finite(scan.timestamp) || Date.now() - scan.timestamp > MAX_SCAN_AGE_MS) {
        throw new Error(`${newestFirst[i].name}: newest complete scan is stale`);
      }
      if (!finite(scan.maxReflectivityDbz)) throw new Error(`${newestFirst[i].name}: reflectivity missing`);
      if (!Array.isArray(scan.velocityPoints) || scan.velocityPoints.length === 0) throw new Error(`${newestFirst[i].name}: velocity missing`);
      latest = scan;
      latestIndex = i;
      break;
    } catch (error) {
      failures.push(`${newestFirst[i].name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!latest) return unavailable(site.id, failures.join(' | ') || 'No complete Level II scan decoded');

  const trackingScans = [{ timestamp: latest.timestamp, couplets: latest.rawCouplets }];
  for (let i = latestIndex + 1; i < newestFirst.length && trackingScans.length < Math.max(1, volumeCount); i += 1) {
    try {
      const scan = await runScanWorker(newestFirst[i], site, false);
      trackingScans.push({ timestamp: scan.timestamp, couplets: scan.rawCouplets });
    } catch (error) {
      failures.push(`${newestFirst[i].name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  trackingScans.sort((a, b) => a.timestamp - b.timestamp);
  const tracks = trackRotationAcrossScans(trackingScans);
  const couplets = latest.rawCouplets.map(c => {
    const track = matchingTrack(c, tracks);
    return coupletPayload(c, site, latest, track?.scanCount ?? 1);
  });

  const strongestRaw = [...latest.rawCouplets].sort((a, b) => b.deltaVKt - a.deltaVKt)[0] ?? null;
  const bestTrack = tracks.find(t => strongestRaw && angularDistance(t.latest.azimuthDeg, strongestRaw.azimuthDeg) <= 4 && Math.abs(t.latest.rangeKm - strongestRaw.rangeKm) <= 5) ?? tracks[0] ?? null;
  const strongestCouplet = couplets[0] ?? null;
  const cc = finite(latest.correlationCoefficient) ? latest.correlationCoefficient : null;
  const zdr = finite(latest.differentialReflectivity) ? latest.differentialReflectivity : null;
  const colocatedReflectivity = finite(latest.colocatedReflectivity) ? latest.colocatedReflectivity : latest.maxReflectivityDbz;
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
    failedScans: failures.length,
  };

  cache.set(cacheKey, { at: Date.now(), value: result });
  return result;
}

function unavailable(stationId, reason) {
  return {
    available: false,
    stationId,
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
      res.end(JSON.stringify({ ok: true, service: 'stormlog-radar-analysis' }));
      return;
    }
    if (url.pathname !== '/radar') { res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' })); return; }

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
  return new Promise(resolve => server.listen(port, () => resolve(server)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await createRadarServer();
  console.log(`StormLog radar service listening on ${server.address().port}`);
}
