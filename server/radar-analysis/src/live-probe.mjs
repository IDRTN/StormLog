import Level2Radar from 'nexrad-level-2-data';

const site = (process.env.RADAR_SITE || 'KILN').toUpperCase().replace(/^([^K])/, 'K$1');
const base = `https://nomads.ncep.noaa.gov/pub/data/nccf/radar/nexrad_level2/${site}`;
const MAX_CANDIDATES = 8;
const MAX_AGE_MS = 20 * 60 * 1000;

function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
function values(moment) { return Array.isArray(moment?.moment_data) ? moment.moment_data.filter(finite) : []; }
function asArray(v) { return Array.isArray(v) ? v : v ? [v] : []; }

function parseTime(name) {
  const m = name.match(/_(\d{8})_(\d{6})\.bz2$/);
  if (!m) return null;
  const d = m[1], t = m[2];
  return Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));
}

async function recentVolumes() {
  const response = await fetch(`${base}/dir.list`, { headers: { Accept: 'text/plain', 'User-Agent': 'StormLog-Radar-Validation/1.0' } });
  if (!response.ok) throw new Error(`NOMADS dir.list HTTP ${response.status}`);
  const text = await response.text();
  const names = [...new Set([...text.matchAll(/(K[A-Z0-9]{3}_\d{8}_\d{6}\.bz2)/g)].map(m => m[1]))].sort().reverse();
  if (!names.length) throw new Error(`No Level II volumes listed for ${site}`);
  return names.slice(0, MAX_CANDIDATES).map(name => ({ name, timestamp: parseTime(name), url: `${base}/${name}` }));
}

function lowestUsable(radar, getterName) {
  const candidates = [];
  for (const elevation of radar.listElevations().filter(finite).sort((a, b) => a - b)) {
    radar.setElevation(elevation);
    const moments = asArray(radar[getterName]());
    const headers = asArray(radar.getHeader());
    for (let i = 0; i < moments.length; i += 1) {
      const moment = moments[i];
      const header = headers[i] ?? headers[0] ?? null;
      const sampleCount = values(moment).length;
      if (!header || !finite(header.azimuth) || sampleCount < 100) continue;
      candidates.push({ elevation, elevationAngle: finite(header.elevation_angle) ? header.elevation_angle : elevation, moment, sampleCount });
    }
  }
  return candidates.sort((a, b) => a.elevationAngle - b.elevationAngle || a.elevation - b.elevation)[0] ?? null;
}

function summary(candidate) {
  if (!candidate) return null;
  const v = values(candidate.moment);
  return {
    elevation: candidate.elevation,
    elevationAngle: candidate.elevationAngle,
    sampleCount: candidate.sampleCount,
    min: v.length ? Math.min(...v) : null,
    max: v.length ? Math.max(...v) : null,
  };
}

async function decode(entry) {
  const response = await fetch(entry.url, { headers: { 'User-Agent': 'StormLog-Radar-Validation/1.0' } });
  if (!response.ok) throw new Error(`${entry.name} HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 100000) throw new Error(`${entry.name} too small (${bytes.byteLength} bytes)`);
  const radar = new Level2Radar(bytes, { logger: false });
  if (radar.isTruncated) throw new Error(`${entry.name} decoded as truncated`);
  if (radar.header?.ICAO !== site) throw new Error(`${entry.name} ICAO mismatch: ${radar.header?.ICAO}`);

  const reflectivity = lowestUsable(radar, 'getHighresReflectivity');
  const velocity = lowestUsable(radar, 'getHighresVelocity');
  const zdr = lowestUsable(radar, 'getHighresDiffReflectivity');
  const rho = lowestUsable(radar, 'getHighresCorrelationCoefficient');
  if (!reflectivity) throw new Error(`${entry.name} missing quantitative reflectivity`);
  if (!velocity) throw new Error(`${entry.name} missing quantitative velocity`);
  if (!zdr) throw new Error(`${entry.name} missing differential reflectivity`);
  if (!rho) throw new Error(`${entry.name} missing correlation coefficient`);

  if (finite(reflectivity.elevationAngle) && finite(velocity.elevationAngle)) {
    const delta = Math.abs(reflectivity.elevationAngle - velocity.elevationAngle);
    if (delta > 1.0) throw new Error(`${entry.name} low-level REF/VEL tilt mismatch (${delta.toFixed(2)} deg)`);
  }

  const ref = summary(reflectivity);
  const vel = summary(velocity);
  if (ref.min < -40 || ref.max > 100) throw new Error(`${entry.name} reflectivity outside plausible range ${ref.min}..${ref.max}`);
  if (vel.min < -250 || vel.max > 250) throw new Error(`${entry.name} velocity outside plausible range ${vel.min}..${vel.max}`);

  return { entry, bytes: bytes.byteLength, radar, reflectivity, velocity, zdr, rho };
}

const candidates = await recentVolumes();
const failures = [];
let selected = null;
for (const entry of candidates) {
  try {
    selected = await decode(entry);
    break;
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
}

if (!selected) throw new Error(`No complete usable Level II volume among ${candidates.length} recent files: ${failures.join(' | ')}`);
if (!finite(selected.entry.timestamp) || Date.now() - selected.entry.timestamp > MAX_AGE_MS) {
  throw new Error(`Newest complete Level II volume is stale: ${selected.entry.name}`);
}

console.log(JSON.stringify({
  source: 'NOAA/NCEP NOMADS NEXRAD Level II',
  site,
  file: selected.entry.name,
  ageSeconds: Math.round((Date.now() - selected.entry.timestamp) / 1000),
  bytes: selected.bytes,
  hasGaps: Boolean(selected.radar.hasGaps),
  reflectivity: summary(selected.reflectivity),
  velocity: summary(selected.velocity),
  differentialReflectivity: summary(selected.zdr),
  correlationCoefficient: summary(selected.rho),
  rejectedNewerVolumes: failures,
}, null, 2));

console.log('LIVE_LEVEL2_COMPLETE_VOLUME_PROBE_PASS');
