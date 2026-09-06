import type { StormLogDatabase, WarningStormEventResult } from '../../database/warningEvents';
import type { NormalizedNwsAlert } from '../nws/alerts';
import { createAutomaticStormEvent } from './createStormLogEvent';
import {
  AUTOMATIC_NWS_TRIGGER_EVENTS,
  hasEligibleAutomaticNwsSeverity,
  isAutomaticNwsTrigger,
} from './automaticStormPolicy';

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
  return isAutomaticNwsTrigger({
    id: alert.id,
    event: alert.event,
    severity: alert.severity,
  });
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
  if (!AUTOMATIC_NWS_TRIGGER_EVENTS.has(alert.event)) {
    return { outcome: 'skipped_ineligible_alert', reason: 'unsupported_event' };
  }
  if (alert.status != null && alert.status !== 'Actual') {
    return { outcome: 'skipped_ineligible_alert', reason: 'unsupported_status' };
  }

  const messageType = (alert.messageType ?? 'Alert').toUpperCase();
  if (messageType !== 'ALERT' && messageType !== 'UPDATE' && messageType !== 'CANCEL') {
    return { outcome: 'skipped_ineligible_alert', reason: 'unsupported_message_type' };
  }

  if (messageType !== 'CANCEL' && !hasEligibleAutomaticNwsSeverity(alert.event, alert.severity)) {
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
