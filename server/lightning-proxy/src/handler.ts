export type ProxyEnv = {
  XWEATHER_CLIENT_ID: string;
  XWEATHER_CLIENT_SECRET: string;
  STORMLOG_CLIENT_TOKEN?: string;
  LIGHTNING_USAGE_KV?: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  };
};

type FetchLike = typeof fetch;

type XweatherPulse = {
  id?: string;
  loc?: { lat?: number; long?: number };
  ob?: {
    timestamp?: number;
    timestampMS?: number;
    pulse?: { type?: string; peakamp?: number; numSensors?: number; chiSquare?: number | null };
  };
};

type XweatherResponse = {
  success?: boolean;
  error?: { code?: string; description?: string } | null;
  response?: XweatherPulse[];
};

const MAX_RADIUS_KM = 40.234; // 25 miles
const MAX_LIMIT = 250;
const RESERVE_TOKENS = 1_500;
const USAGE_KEY = 'xweather:lightning:usage';

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

function finiteNumber(value: string | null): number | null {
  if (value == null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function headerNumber(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readRemaining(env: ProxyEnv): Promise<number | null> {
  if (!env.LIGHTNING_USAGE_KV) return null;
  try {
    const raw = await env.LIGHTNING_USAGE_KV.get(USAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { remaining?: number };
    return Number.isFinite(parsed.remaining) ? Number(parsed.remaining) : null;
  } catch {
    return null;
  }
}

async function saveUsage(env: ProxyEnv, remaining: number | null, limit: number | null, cost: number | null): Promise<void> {
  if (!env.LIGHTNING_USAGE_KV || remaining == null) return;
  try {
    await env.LIGHTNING_USAGE_KV.put(USAGE_KEY, JSON.stringify({
      remaining,
      limit,
      cost,
      updatedAt: Date.now(),
    }), { expirationTtl: 45 * 24 * 60 * 60 });
  } catch {
    // Usage persistence must not turn a successful weather request into a failure.
  }
}

function clientAuthorized(request: Request, env: ProxyEnv): boolean {
  if (!env.STORMLOG_CLIENT_TOKEN) return true;
  const supplied = request.headers.get('x-stormlog-client-token') ?? '';
  return supplied.length > 0 && supplied === env.STORMLOG_CLIENT_TOKEN;
}

export async function handleLightningProxy(
  request: Request,
  env: ProxyEnv,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  if (request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
  }

  const url = new URL(request.url);
  if (url.pathname !== '/events') return json({ error: 'not_found' }, 404);
  if (!clientAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);

  if (!env.XWEATHER_CLIENT_ID || !env.XWEATHER_CLIENT_SECRET) {
    return json({ error: 'provider_not_configured' }, 503);
  }

  const latitude = finiteNumber(url.searchParams.get('latitude'));
  const longitude = finiteNumber(url.searchParams.get('longitude'));
  const requestedRadius = finiteNumber(url.searchParams.get('radiusKm'));

  if (latitude == null || latitude < -90 || latitude > 90 || longitude == null || longitude < -180 || longitude > 180) {
    return json({ error: 'invalid_location' }, 400);
  }
  if (requestedRadius == null || requestedRadius <= 0) return json({ error: 'invalid_radius' }, 400);

  const radiusKm = Math.min(requestedRadius, MAX_RADIUS_KM);
  const storedRemaining = await readRemaining(env);
  if (storedRemaining != null && storedRemaining <= RESERVE_TOKENS) {
    return json({
      error: 'usage_reserve_protected',
      remaining: storedRemaining,
      reserve: RESERVE_TOKENS,
    }, 429, {
      'x-stormlog-usage-remaining': String(storedRemaining),
      'x-stormlog-usage-reserve': String(RESERVE_TOKENS),
    });
  }

  const providerUrl = new URL('https://data.api.xweather.com/lightning/closest');
  providerUrl.searchParams.set('p', `${latitude},${longitude}`);
  providerUrl.searchParams.set('radius', `${radiusKm.toFixed(3)}km`);
  providerUrl.searchParams.set('from', '-5minutes');
  providerUrl.searchParams.set('to', 'now');
  providerUrl.searchParams.set('limit', String(MAX_LIMIT));
  providerUrl.searchParams.set('filter', 'all');
  providerUrl.searchParams.set('format', 'json');
  providerUrl.searchParams.set('client_id', env.XWEATHER_CLIENT_ID);
  providerUrl.searchParams.set('client_secret', env.XWEATHER_CLIENT_SECRET);

  let upstream: Response;
  try {
    upstream = await fetchImpl(providerUrl.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
  } catch {
    return json({ error: 'provider_network_error' }, 502);
  }

  const cost = headerNumber(upstream.headers, 'x-cost-tokens');
  const periodLimit = headerNumber(upstream.headers, 'x-ratelimit-period-limit')
    ?? headerNumber(upstream.headers, 'x-ratelimit-limit');
  const periodRemaining = headerNumber(upstream.headers, 'x-ratelimit-period-remaining')
    ?? headerNumber(upstream.headers, 'x-ratelimit-remaining');
  await saveUsage(env, periodRemaining, periodLimit, cost);

  const passthroughHeaders: Record<string, string> = {};
  const copyHeader = (source: string, target = source) => {
    const value = upstream.headers.get(source);
    if (value) passthroughHeaders[target] = value;
  };
  copyHeader('x-cost-tokens');
  copyHeader('x-ratelimit-period-limit');
  copyHeader('x-ratelimit-period-remaining');
  copyHeader('x-ratelimit-period-reset');
  copyHeader('x-ratelimit-period-type');
  copyHeader('retry-after');

  let payload: XweatherResponse;
  try {
    payload = await upstream.json() as XweatherResponse;
  } catch {
    return json({ error: 'provider_invalid_json' }, 502, passthroughHeaders);
  }

  if (!upstream.ok || payload.success === false) {
    return json({
      error: 'provider_error',
      status: upstream.status,
      code: payload.error?.code ?? null,
      description: payload.error?.description ?? null,
    }, upstream.status === 429 ? 429 : 502, passthroughHeaders);
  }

  const rows = Array.isArray(payload.response) ? payload.response : [];
  const events = rows.flatMap((row) => {
    const lat = row.loc?.lat;
    const lon = row.loc?.long;
    const timestamp = row.ob?.timestampMS ?? (row.ob?.timestamp != null ? row.ob.timestamp * 1000 : undefined);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(timestamp)) return [];

    const type = row.ob?.pulse?.type?.toUpperCase() ?? null;
    const peakamp = row.ob?.pulse?.peakamp;
    return [{
      providerEventId: row.id ?? null,
      timestamp: Number(timestamp),
      latitude: Number(lat),
      longitude: Number(lon),
      providerTerminology: type === 'CG' ? 'strike' : 'flash',
      classification: type,
      polarity: peakamp == null ? null : peakamp < 0 ? 'negative' : peakamp > 0 ? 'positive' : 'neutral',
      peakCurrentAmperes: peakamp ?? null,
      multiplicity: null,
      sensorCount: row.ob?.pulse?.numSensors ?? null,
      accuracyKm: null,
      rawPayload: row,
    }];
  });

  return json({ events, fetchedAt: Date.now() }, 200, passthroughHeaders);
}
