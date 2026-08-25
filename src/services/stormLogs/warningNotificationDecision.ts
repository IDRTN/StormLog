import type { NormalizedNwsAlert } from '../nws/alerts';
import { WarningNotificationPermissionDeniedError } from './warningNotificationContent';
import type { ProcessNwsWarningResult } from './processNwsWarning';

export type WarningNotificationAction =
  | 'created'
  | 'updated_event'
  | 'canceled_event'
  | 'skipped';

export type WarningNotificationStatus =
  | 'sent'
  | 'permission_denied'
  | 'not_applicable'
  | 'failed';

export interface WarningNotificationDispatch {
  action: WarningNotificationAction;
  status: WarningNotificationStatus;
  notified: boolean;
  reason?: string;
  error?: unknown;
}

export interface WarningNotificationInput {
  eventType: string;
  areaDescription?: string | null;
  expiresAt?: number | null;
  eventId: number;
}

export interface WarningNotifier {
  created: (input: WarningNotificationInput) => Promise<void>;
  updated: (input: WarningNotificationInput) => Promise<void>;
  canceled: (input: WarningNotificationInput) => Promise<void>;
}

const defaultWarningNotifier: WarningNotifier = {
  created: async input => (await import('../notifications')).notifyWarningCreated(input),
  updated: async input => (await import('../notifications')).notifyWarningUpdated(input),
  canceled: async input => (await import('../notifications')).notifyWarningCanceled(input),
};

function skipped(reason: string): WarningNotificationDispatch {
  return { action: 'skipped', status: 'not_applicable', notified: false, reason };
}

export async function dispatchWarningNotification(
  alert: NormalizedNwsAlert,
  result: ProcessNwsWarningResult,
  notifier: WarningNotifier = defaultWarningNotifier
): Promise<WarningNotificationDispatch> {
  if (
    result.outcome !== 'created'
    && result.outcome !== 'updated_event'
    && result.outcome !== 'canceled_event'
  ) {
    return skipped(result.outcome);
  }

  const input = {
    eventType: alert.event,
    areaDescription: alert.areaDesc ?? null,
    expiresAt: alert.ends ?? null,
    eventId: result.eventId,
  };

  try {
    if (result.outcome === 'created') await notifier.created(input);
    if (result.outcome === 'updated_event') await notifier.updated(input);
    if (result.outcome === 'canceled_event') await notifier.canceled(input);

    return { action: result.outcome, status: 'sent', notified: true };
  } catch (error) {
    const permissionDenied = error instanceof WarningNotificationPermissionDeniedError;
    if (!permissionDenied) {
      console.error('[WARNING-NOTIF] Delivery failed without affecting warning processing:', error);
    }
    return {
      action: result.outcome,
      status: permissionDenied ? 'permission_denied' : 'failed',
      notified: false,
      error,
    };
  }
}
