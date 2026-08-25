import type { StormLogDatabase, WarningStormEventResult } from '../../database/warningEvents';
import type { NormalizedNwsAlert } from '../nws/alerts';
import { createAutomaticStormEvent } from './createStormLogEvent';

const ELIGIBLE_WARNING_EVENTS = new Set([
  'Tornado Warning',
  'Severe Thunderstorm Warning',
  'Flash Flood Warning',
]);

export type ProcessNwsWarningResult =
  | { outcome: 'skipped_invalid_alert'; reason: 'invalid_alert' | 'missing_id' }
  | {
      outcome: 'skipped_ineligible_alert';
      reason:
        | 'unsupported_event'
        | 'unsupported_severity'
        | 'unsupported_status'
        | 'unsupported_message_type';
    }
  | WarningStormEventResult;

export function isEligibleNwsWarning(
  alert: Pick<NormalizedNwsAlert, 'id' | 'event' | 'severity'>
): boolean {
  return (
    typeof alert.id === 'string'
    && alert.id.trim().length > 0
    && ELIGIBLE_WARNING_EVENTS.has(alert.event)
    && (alert.severity === 'Extreme' || alert.severity === 'Severe')
  );
}

export async function processNwsWarningForStormEvent(
  alert: NormalizedNwsAlert,
  database?: StormLogDatabase
): Promise<ProcessNwsWarningResult> {
  if (!alert || typeof alert !== 'object') {
    return { outcome: 'skipped_invalid_alert', reason: 'invalid_alert' };
  }
  if (typeof alert.id !== 'string' || alert.id.trim().length === 0) {
    return { outcome: 'skipped_invalid_alert', reason: 'missing_id' };
  }
  if (!ELIGIBLE_WARNING_EVENTS.has(alert.event)) {
    return { outcome: 'skipped_ineligible_alert', reason: 'unsupported_event' };
  }
  if (alert.status != null && alert.status !== 'Actual') {
    return { outcome: 'skipped_ineligible_alert', reason: 'unsupported_status' };
  }

  const messageType = (alert.messageType ?? 'Alert').toUpperCase();
  if (messageType !== 'ALERT' && messageType !== 'UPDATE' && messageType !== 'CANCEL') {
    return { outcome: 'skipped_ineligible_alert', reason: 'unsupported_message_type' };
  }

  if (
    messageType !== 'CANCEL'
    && alert.severity !== 'Extreme'
    && alert.severity !== 'Severe'
  ) {
    return { outcome: 'skipped_ineligible_alert', reason: 'unsupported_severity' };
  }

  return createAutomaticStormEvent({
    location: alert.representativePoint ?? null,
    alert: {
      id: alert.id,
      event: alert.event,
    },
    lifecycle: {
      status: alert.status ?? null,
      messageType,
      references: alert.references ?? [],
      endsAt: alert.ends ?? null,
    },
    database,
  });
}
