import type {
  LightningProviderAdapter,
  LightningProviderEvent,
  LightningProviderResult,
} from '../lightningProviderAdapter';
import { parseXweatherReset } from '../lightningUsageGuard';

type FetchLike = typeof fetch;

type ProxyEvent = Partial<LightningProviderEvent> & {
  id?: string | number | null;
};

type ProxyResponse = {
  events?: ProxyEvent[];
  fetchedAt?: number;
};

function numberHeader(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (value == null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function compactErrorBody(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, 180) : null;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const parts = [record.error, record.code, record.description]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .map((part) => part.trim());
    if (parts.length > 0) return parts.join(': ').slice(0, 180);
    try {
      return JSON.stringify(value).slice(0, 180);
    } catch {
      return null;
    }
  }
  return String(value).slice(0, 180);
}

export class HttpLightningAdapter implements LightningProviderAdapter {
  readonly providerName = 'StormLog Lightning Proxy';

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly clientToken: string | null = null,
  ) {}

  async fetchEventsNearPoint(
    latitude: number,
    longitude: number,
    radiusKm: number,
    sinceMs: number,
    untilMs: number,
  ): Promise<LightningProviderResult> {
    const base = this.baseUrl.replace(/\/+$/, '');
    const query = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      radiusKm: String(radiusKm),
      sinceMs: String(sinceMs),
      untilMs: String(untilMs),
    });
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.clientToken) headers['x-stormlog-client-token'] = this.clientToken;

    const response = await this.fetchImpl(`${base}/events?${query.toString()}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      let responseDetail: string | null = null;
      try {
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          responseDetail = compactErrorBody(await response.json());
        } else {
          responseDetail = compactErrorBody(await response.text());
        }
      } catch {
        responseDetail = null;
      }

      const suffix = responseDetail ? ` — ${responseDetail}` : '';
      const error = new Error(`Lightning provider HTTP ${response.status}${suffix}`) as Error & {
        status?: number;
        retryAfterMs?: number;
      };
      error.status = response.status;
      const retryAfter = Number(response.headers.get('retry-after'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        error.retryAfterMs = retryAfter * 1000;
      }
      throw error;
    }

    const payload = await response.json() as ProxyResponse;
    const events = Array.isArray(payload.events) ? payload.events : [];
    const nowMs = Date.now();

    return {
      fetchedAt: typeof payload.fetchedAt === 'number' ? payload.fetchedAt : nowMs,
      usage: {
        costTokens: numberHeader(response.headers, 'x-cost-tokens'),
        periodLimit: numberHeader(response.headers, 'x-ratelimit-limit-period'),
        periodRemaining: numberHeader(response.headers, 'x-ratelimit-remaining-period'),
        periodResetAtMs: parseXweatherReset(response.headers.get('x-ratelimit-reset-period'), nowMs),
        periodType: response.headers.get('x-ratelimit-limit-period-type'),
      },
      events: events.map((event) => ({
        providerEventId: event.providerEventId ?? (event.id != null ? String(event.id) : null),
        timestamp: Number(event.timestamp),
        latitude: Number(event.latitude),
        longitude: Number(event.longitude),
        providerTerminology: event.providerTerminology ?? 'strike',
        classification: event.classification ?? null,
        polarity: event.polarity ?? null,
        peakCurrentAmperes: event.peakCurrentAmperes ?? null,
        multiplicity: event.multiplicity ?? null,
        sensorCount: event.sensorCount ?? null,
        accuracyKm: event.accuracyKm ?? null,
        rawPayload: event.rawPayload ?? event,
      })),
    };
  }
}
