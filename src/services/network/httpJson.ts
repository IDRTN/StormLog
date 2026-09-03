type JsonResponseLike = Response;

function normalizeSnippet(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * Parse an HTTP response as JSON without leaking the platform's raw JSON.parse
 * exception into the weather pipeline. Some upstream services/proxies return
 * plain text or HTML error bodies, occasionally even with a 2xx status.
 *
 * Production Response objects are cloned and read as text first so we can
 * validate the payload ourselves. Minimal test doubles that only implement
 * json() remain supported through the fallback path.
 */
export async function readJsonResponse<T = any>(
  response: JsonResponseLike,
  service: string,
): Promise<T> {
  const contentType = response.headers?.get?.('content-type') ?? null;

  try {
    if (typeof response.clone === 'function') {
      const clone = response.clone();
      if (typeof clone.text === 'function') {
        const body = await clone.text();
        try {
          return JSON.parse(body) as T;
        } catch {
          const snippet = normalizeSnippet(body);
          const typeText = contentType ? ` (${contentType})` : '';
          throw new Error(
            `${service} returned a non-JSON response${typeText}${snippet ? `: ${snippet}` : ''}`,
          );
        }
      }
    }

    return await response.json() as T;
  } catch (error: any) {
    const message = error?.message ?? String(error);
    if (message.startsWith(`${service} returned a non-JSON response`)) throw error;
    throw new Error(`${service} returned invalid JSON`);
  }
}
