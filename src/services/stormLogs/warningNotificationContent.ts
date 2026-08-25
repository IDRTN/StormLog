export class WarningNotificationPermissionDeniedError extends Error {
  constructor() {
    super('Android notification permission is denied');
    this.name = 'WarningNotificationPermissionDeniedError';
  }
}

export interface WarningNotificationContentInput {
  eventType: string;
  areaDescription?: string | null;
  expiresAt?: number | null;
  eventId?: number;
  lifecycle: 'created' | 'updated' | 'canceled';
}

function formatWarningExpiration(expiresAt?: number | null): string {
  if (expiresAt == null || !Number.isFinite(expiresAt)) return '';
  const expiration = new Date(expiresAt);
  if (Number.isNaN(expiration.getTime())) return '';

  return ` Expires ${expiration.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}.`;
}

export function warningNotificationText(input: WarningNotificationContentInput): {
  title: string;
  body: string;
} {
  const location = input.areaDescription?.trim() || 'your area';
  const expiration = formatWarningExpiration(input.expiresAt);

  if (input.lifecycle === 'updated') {
    return {
      title: `StormLog — ${input.eventType} Updated`,
      body: `Warning updated for ${location}.${expiration}`,
    };
  }

  if (input.lifecycle === 'canceled') {
    return {
      title: `StormLog — ${input.eventType} Canceled`,
      body: `The warning for ${location} has been canceled.`,
    };
  }

  return {
    title: `StormLog — ${input.eventType}`,
    body: `Warning issued for ${location}.${expiration}`,
  };
}
