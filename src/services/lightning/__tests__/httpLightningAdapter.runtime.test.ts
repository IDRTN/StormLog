import { HttpLightningAdapter } from '../providers/httpLightningAdapter';

function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) throw new Error(message ?? `Expected ${String(expected)}, received ${String(actual)}`);
}

async function run(): Promise<void> {
  let requestedUrl = '';
  const fakeFetch = (async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      fetchedAt: 1234,
      events: [{
        id: 'evt-1',
        timestamp: 1000,
        latitude: 40.1,
        longitude: -82.2,
        providerTerminology: 'strike',
        classification: 'CG',
        polarity: 'negative',
        peakCurrentAmperes: -25000,
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const adapter = new HttpLightningAdapter('https://proxy.example/', fakeFetch);
  const result = await adapter.fetchEventsNearPoint(40, -82, 50, 500, 1500);

  assertEqual(result.fetchedAt, 1234);
  assertEqual(result.events.length, 1);
  assertEqual(result.events[0].providerEventId, 'evt-1');
  assertEqual(result.events[0].classification, 'CG');
  if (!requestedUrl.startsWith('https://proxy.example/events?')) {
    throw new Error(`Unexpected proxy URL: ${requestedUrl}`);
  }
  if (!requestedUrl.includes('radiusKm=50')) throw new Error('radiusKm was not forwarded');
  if (!requestedUrl.includes('sinceMs=500')) throw new Error('sinceMs was not forwarded');
  if (!requestedUrl.includes('untilMs=1500')) throw new Error('untilMs was not forwarded');

  const rateLimitedFetch = (async () => new Response('', {
    status: 429,
    headers: { 'retry-after': '30' },
  })) as typeof fetch;
  const rateLimitedAdapter = new HttpLightningAdapter('https://proxy.example', rateLimitedFetch);

  try {
    await rateLimitedAdapter.fetchEventsNearPoint(40, -82, 50, 500, 1500);
    throw new Error('Expected 429 request to fail');
  } catch (error: any) {
    assertEqual(error?.status, 429);
    assertEqual(error?.retryAfterMs, 30_000);
  }

  console.log('httpLightningAdapter.runtime.test passed');
}

run().catch((error) => {
  console.error(error);
  throw error;
});
