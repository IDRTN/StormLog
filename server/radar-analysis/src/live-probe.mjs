import nexradLevel3Data from 'nexrad-level-3-data';

const S3 = 'https://unidata-nexrad-level3.s3.amazonaws.com';
const site = (process.env.RADAR_SITE || 'ILN').toUpperCase().replace(/^K/, '');
const products = (process.env.RADAR_PRODUCTS || 'N0S,N0Q').split(',').map(v => v.trim().toUpperCase()).filter(Boolean);

function utcDateParts(date = new Date()) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return { yyyy, mm, dd };
}

async function listLatestKey(product) {
  const now = new Date();
  const days = [0, 1].map(offset => new Date(now.getTime() - offset * 86400000));
  for (const day of days) {
    const { yyyy, mm, dd } = utcDateParts(day);
    const prefix = `${site}_${product}_${yyyy}_${mm}_${dd}_`;
    const url = `${S3}/?list-type=2&prefix=${encodeURIComponent(prefix)}`;
    const response = await fetch(url, { headers: { Accept: 'application/xml' } });
    if (!response.ok) throw new Error(`S3 list ${product} HTTP ${response.status}`);
    const xml = await response.text();
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
    if (keys.length) return keys.sort().at(-1);
  }
  throw new Error(`No recent ${site} ${product} object found`);
}

function summarizeObject(value, depth = 0) {
  if (depth > 3 || value == null) return value;
  if (Array.isArray(value)) {
    return { type: 'array', length: value.length, sample: value.length ? summarizeObject(value[0], depth + 1) : null };
  }
  if (typeof value !== 'object') return typeof value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (key.toLowerCase().includes('data') && Array.isArray(child)) out[key] = { type: 'array', length: child.length };
    else out[key] = summarizeObject(child, depth + 1);
  }
  return out;
}

function collectNumericArrays(value, path = '$', out = [], seen = new Set()) {
  if (value == null || typeof value !== 'object' || seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length && value.every(v => typeof v === 'number' && Number.isFinite(v))) {
      const min = Math.min(...value);
      const max = Math.max(...value);
      out.push({ path, length: value.length, min, max });
      return out;
    }
    value.slice(0, 10).forEach((child, i) => collectNumericArrays(child, `${path}[${i}]`, out, seen));
    return out;
  }
  for (const [key, child] of Object.entries(value)) collectNumericArrays(child, `${path}.${key}`, out, seen);
  return out;
}

for (const product of products) {
  const key = await listLatestKey(product);
  const response = await fetch(`${S3}/${encodeURIComponent(key).replaceAll('%2F', '/')}`);
  if (!response.ok) throw new Error(`S3 object ${key} HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 100) throw new Error(`${key} unexpectedly small (${buffer.length} bytes)`);

  const parsed = nexradLevel3Data(buffer, { logger: false });
  if (!parsed || typeof parsed !== 'object') throw new Error(`${product} parser returned no object`);

  const productCode = parsed?.productDescription?.productCode ?? parsed?.messageHeader?.messageCode ?? null;
  const numericArrays = collectNumericArrays(parsed).filter(item => item.length >= 8).slice(0, 30);

  console.log(JSON.stringify({
    site,
    product,
    key,
    bytes: buffer.length,
    productCode,
    topLevelKeys: Object.keys(parsed),
    shape: summarizeObject(parsed),
    numericArrays,
  }, null, 2));

  if (!numericArrays.length) {
    throw new Error(`${product} parsed but no usable numeric radial/bin arrays were discovered`);
  }
}

console.log('LIVE_LEVEL3_PROBE_PASS');
