import { handleLightningProxy, type ProxyEnv } from './handler';

function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) throw new Error(message ?? `Expected ${String(expected)}, received ${String(actual)}`);
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function run(): Promise<void> {
  let upstreamUrl = '';
  let upstreamOrigin = '';
  const env: ProxyEnv = {
    XWEATHER_CLIENT_ID: 'server-id',
    XWEATHER_CLIENT_SECRET: 'server-secret',
    STORMLOG_CLIENT_TOKEN: 'app-token',
    XWEATHER_NAMESPACE_ORIGIN: 'https://stormlog.example',
  };

  const unauthorized = await handleLightningProxy(
    new Request('https://proxy.example/events?latitude=40&longitude=-82&radiusKm=40'),
    env,
  );
  assertEqual(unauthorized.status, 401);

  const response = await handleLightningProxy(
    new Request('https://proxy.example/events?latitude=40&longitude=-82&radiusKm=100&sinceMs=1&untilMs=9999999999999', {
      headers: { 'x-stormlog-client-token': 'app-token' },
    }),
    env,
    async (input, init) => {
      upstreamUrl = String(input);
      upstreamOrigin = new Headers(init?.headers).get('origin') ?? '';
      return new Response(JSON.stringify({
        success: true,
        error: null,
        response: [{
          id: 'strike-1',
          loc: { lat: 40.1, long: -82.2 },
          ob: {
            timestamp: 1_756_956_000,
            timestampMS: 1_756_956_000_125,
            pulse: { type: 'cg', peakamp: -7000, numSensors: 5 },
          },
        }],
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-cost-tokens': '10',
          'x-ratelimit-limit-period': '15000',
          'x-ratelimit-remaining-period': '14990',
          'x-ratelimit-reset-period': '12345',
          'x-ratelimit-limit-period-type': 'month',
        },
      });
    },
  );

  assertEqual(response.status, 200);
  const called = new URL(upstreamUrl);
  assertEqual(called.origin, 'https://data.api.xweather.com');
  assertEqual(called.pathname, '/lightning/closest');
  assertEqual(called.searchParams.get('client_id'), 'server-id');
  assertEqual(called.searchParams.get('client_secret'), 'server-secret');
  assertEqual(called.searchParams.get('from'), '-5minutes');
  assertEqual(called.searchParams.get('to'), 'now');
  assertEqual(upstreamOrigin, 'https://stormlog.example');
  assert(Number(called.searchParams.get('radius')!.replace('km', '')) <= 40.234, 'radius must be hard-capped to 25 miles');
  assertEqual(called.searchParams.has('sinceMs'), false);
  assertEqual(called.searchParams.has('untilMs'), false);

  const payload = await response.json() as { events: Array<Record<string, unknown>> };
  assertEqual(payload.events.length, 1);
  assertEqual(payload.events[0].providerEventId, 'strike-1');
  assertEqual(payload.events[0].classification, 'CG');
  assertEqual(payload.events[0].polarity, 'negative');
  assertEqual(response.headers.get('x-cost-tokens'), '10');
  assertEqual(response.headers.get('x-ratelimit-remaining-period'), '14990');
  assertEqual(JSON.stringify(payload).includes('server-secret'), false, 'provider secret must never be returned to the phone');

  let stored = JSON.stringify({ remaining: 1500 });
  const protectedEnv: ProxyEnv = {
    ...env,
    LIGHTNING_USAGE_KV: {
      get: async () => stored,
      put: async (_key, value) => { stored = value; },
    },
  };
  let upstreamCalled = false;
  const protectedResponse = await handleLightningProxy(
    new Request('https://proxy.example/events?latitude=40&longitude=-82&radiusKm=40', {
      headers: { 'x-stormlog-client-token': 'app-token' },
    }),
    protectedEnv,
    async () => {
      upstreamCalled = true;
      return new Response('{}');
    },
  );
  assertEqual(protectedResponse.status, 429);
  assertEqual(upstreamCalled, false, 'reserve protection must stop the Xweather request before it spends accesses');

  console.log('lightning proxy runtime test: PASS');
}

void run();
