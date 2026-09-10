import { Level2Radar } from 'nexrad-level-2-data';

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
    gateSizeMeters: moment.gate_size,
    firstGateMeters: moment.first_gate,
    sampleCount: values.length,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    scale: moment.scale,
    offset: moment.offset,
  };
}

function firstUsable(values) {
  if (!Array.isArray(values)) return values ?? null;
  return values.find(v => v && finiteValues(v).length) ?? null;
}

const { name, url } = await latestVolumeUrl();
const response = await fetch(url);
if (!response.ok) throw new Error(`NOMADS Level II ${name} HTTP ${response.status}`);
const bytes = new Uint8Array(await response.arrayBuffer());
if (bytes.byteLength < 100000) throw new Error(`Level II volume unexpectedly small: ${bytes.byteLength} bytes`);

const radar = await new Level2Radar(bytes, { logger: false });
const elevations = radar.listElevations().filter(v => Number.isFinite(v));
if (!elevations.length) throw new Error('Decoded Level II volume has no elevations');

const lowest = Math.min(...elevations);
radar.setElevation(lowest);

const azimuths = radar.getAzimuth();
const reflectivity = firstUsable(radar.getHighresReflectivity());
const velocity = firstUsable(radar.getHighresVelocity());
const zdr = firstUsable(radar.getHighresDiffReflectivity());
const rho = firstUsable(radar.getHighresCorrelationCoefficient());

const refSummary = summarizeMoment(reflectivity);
const velSummary = summarizeMoment(velocity);
const zdrSummary = summarizeMoment(zdr);
const rhoSummary = summarizeMoment(rho);

const result = {
  source: 'NOAA/NCEP NOMADS NEXRAD Level II',
  site,
  file: name,
  bytes: bytes.byteLength,
  headerIcao: radar.header?.ICAO ?? null,
  hasGaps: Boolean(radar.hasGaps),
  isTruncated: Boolean(radar.isTruncated),
  elevations,
  selectedElevation: lowest,
  azimuthCount: Array.isArray(azimuths) ? azimuths.length : 1,
  reflectivity: refSummary,
  velocity: velSummary,
  differentialReflectivity: zdrSummary,
  correlationCoefficient: rhoSummary,
};

console.log(JSON.stringify(result, null, 2));

if (radar.header?.ICAO !== site) throw new Error(`Radar ICAO mismatch: expected ${site}, got ${radar.header?.ICAO}`);
if (radar.isTruncated) throw new Error('Latest Level II volume decoded as truncated');
if (!refSummary || refSummary.sampleCount < 100) throw new Error('Quantitative reflectivity missing from lowest elevation');
if (!velSummary || velSummary.sampleCount < 100) throw new Error('Quantitative velocity missing from lowest elevation');
if (refSummary.min < -40 || refSummary.max > 100) throw new Error(`Reflectivity outside plausible dBZ range: ${refSummary.min}..${refSummary.max}`);
if (velSummary.min < -250 || velSummary.max > 250) throw new Error(`Velocity outside plausible knot range: ${velSummary.min}..${velSummary.max}`);

console.log('LIVE_LEVEL2_QUANTITATIVE_PROBE_PASS');
