import Level2Radar from 'nexrad-level-2-data';

const site = (process.env.RADAR_SITE || 'KILN').toUpperCase().replace(/^([^K])/, 'K$1');
const base = `https://nomads.ncep.noaa.gov/pub/data/nccf/radar/nexrad_level2/${site}`;

async function latestVolumeUrl() {
  const response = await fetch(`${base}/dir.list`, { headers: { Accept: 'text/plain' } });
  if (!response.ok) throw new Error(`NOMADS dir.list HTTP ${response.status}`);
  const text = await response.text();
  const files = [...text.matchAll(/(K[A-Z0-9]{3}_\d{8}_\d{6}\.bz2)/g)].map(m => m[1]);
  if (!files.length) throw new Error(`No Level II volumes listed for ${site}`);
  const name = files.sort().at(-1);
  return { name, url: `${base}/${name}` };
}

function finiteValues(moment) {
  if (!moment || !Array.isArray(moment.moment_data)) return [];
  return moment.moment_data.filter(v => typeof v === 'number' && Number.isFinite(v));
}

function summarizeMoment(moment) {
  if (!moment) return null;
  const values = finiteValues(moment);
  return {
    name: moment.name,
    gateCount: moment.gate_count,
    gateSizeKm: moment.gate_size,
    firstGateKm: moment.first_gate,
    sampleCount: values.length,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    scale: moment.scale,
    offset: moment.offset,
  };
}

function collectMomentCandidates(radar, elevations, getterName) {
  const candidates = [];
  for (const elevation of elevations) {
    radar.setElevation(elevation);
    const headers = radar.getHeader();
    const moments = radar[getterName]();
    const list = Array.isArray(moments) ? moments : [moments];
    for (let scan = 0; scan < list.length; scan += 1) {
      const moment = list[scan];
      const values = finiteValues(moment);
      if (!moment || values.length < 1) continue;
      const header = Array.isArray(headers) ? headers[scan] : headers;
      candidates.push({
        elevation,
        scan,
        elevationAngle: Number.isFinite(header?.elevation_angle) ? header.elevation_angle : null,
        azimuth: Number.isFinite(header?.azimuth) ? header.azimuth : null,
        moment,
        sampleCount: values.length,
      });
    }
  }
  return candidates;
}

function chooseLowestUsable(candidates) {
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => {
    const aa = Number.isFinite(a.elevationAngle) ? a.elevationAngle : Number.POSITIVE_INFINITY;
    const ba = Number.isFinite(b.elevationAngle) ? b.elevationAngle : Number.POSITIVE_INFINITY;
    if (aa !== ba) return aa - ba;
    if (a.elevation !== b.elevation) return a.elevation - b.elevation;
    return a.scan - b.scan;
  })[0];
}

function summarizeCandidate(candidate) {
  if (!candidate) return null;
  return {
    elevation: candidate.elevation,
    scan: candidate.scan,
    elevationAngle: candidate.elevationAngle,
    azimuth: candidate.azimuth,
    ...summarizeMoment(candidate.moment),
  };
}

const { name, url } = await latestVolumeUrl();
const response = await fetch(url);
if (!response.ok) throw new Error(`NOMADS Level II ${name} HTTP ${response.status}`);
const bytes = new Uint8Array(await response.arrayBuffer());
if (bytes.byteLength < 100000) throw new Error(`Level II volume unexpectedly small: ${bytes.byteLength} bytes`);

const radar = new Level2Radar(bytes, { logger: false });
const elevations = radar.listElevations().filter(v => Number.isFinite(v)).sort((a, b) => a - b);
if (!elevations.length) throw new Error('Decoded Level II volume has no elevations');

// NEXRAD split-cut VCPs can place reflectivity and velocity on different
// elevation numbers even when they represent nearly the same low-level tilt.
// Search the entire volume for the lowest usable occurrence of each moment
// instead of assuming every moment exists on elevation number 1.
const refCandidates = collectMomentCandidates(radar, elevations, 'getHighresReflectivity');
const velCandidates = collectMomentCandidates(radar, elevations, 'getHighresVelocity');
const zdrCandidates = collectMomentCandidates(radar, elevations, 'getHighresDiffReflectivity');
const rhoCandidates = collectMomentCandidates(radar, elevations, 'getHighresCorrelationCoefficient');

const reflectivity = chooseLowestUsable(refCandidates);
const velocity = chooseLowestUsable(velCandidates);
const zdr = chooseLowestUsable(zdrCandidates);
const rho = chooseLowestUsable(rhoCandidates);

const result = {
  source: 'NOAA/NCEP NOMADS NEXRAD Level II',
  site,
  file: name,
  bytes: bytes.byteLength,
  headerIcao: radar.header?.ICAO ?? null,
  hasGaps: Boolean(radar.hasGaps),
  isTruncated: Boolean(radar.isTruncated),
  elevations,
  candidateCounts: {
    reflectivity: refCandidates.length,
    velocity: velCandidates.length,
    differentialReflectivity: zdrCandidates.length,
    correlationCoefficient: rhoCandidates.length,
  },
  reflectivity: summarizeCandidate(reflectivity),
  velocity: summarizeCandidate(velocity),
  differentialReflectivity: summarizeCandidate(zdr),
  correlationCoefficient: summarizeCandidate(rho),
};

console.log(JSON.stringify(result, null, 2));

if (radar.header?.ICAO !== site) throw new Error(`Radar ICAO mismatch: expected ${site}, got ${radar.header?.ICAO}`);
if (radar.isTruncated) throw new Error('Latest Level II volume decoded as truncated');
if (!reflectivity || reflectivity.sampleCount < 100) throw new Error('Quantitative reflectivity missing from decoded Level II volume');
if (!velocity || velocity.sampleCount < 100) throw new Error('Quantitative velocity missing from decoded Level II volume');

const refSummary = summarizeMoment(reflectivity.moment);
const velSummary = summarizeMoment(velocity.moment);
if (refSummary.min < -40 || refSummary.max > 100) throw new Error(`Reflectivity outside plausible dBZ range: ${refSummary.min}..${refSummary.max}`);
if (velSummary.min < -250 || velSummary.max > 250) throw new Error(`Velocity outside plausible range: ${velSummary.min}..${velSummary.max}`);

// When both low-level tilts expose physical elevation angles, ensure we did not
// accidentally pair a low-level reflectivity scan with a high-altitude velocity scan.
if (Number.isFinite(reflectivity.elevationAngle) && Number.isFinite(velocity.elevationAngle)) {
  const angleDelta = Math.abs(reflectivity.elevationAngle - velocity.elevationAngle);
  if (angleDelta > 1.0) {
    throw new Error(`Lowest usable reflectivity/velocity tilts are not colocated enough: Δ=${angleDelta.toFixed(2)}°`);
  }
}

console.log('LIVE_LEVEL2_QUANTITATIVE_PROBE_PASS');
