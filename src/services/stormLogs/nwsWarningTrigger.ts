import type { NormalizedNwsAlert } from '../nws/alerts';
import {
  processNwsWarningForStormEvent,
  type ProcessNwsWarningResult,
} from './processNwsWarning';

export type NwsWarningProcessor = (
  alert: NormalizedNwsAlert
) => Promise<ProcessNwsWarningResult>;

export interface NwsAlertProcessingFailure {
  alertId: string | null;
  error: unknown;
}

export interface NwsAlertBatchResult {
  results: Array<{
    alertId: string | null;
    result: ProcessNwsWarningResult;
    notification?: unknown;
  }>;
  failures: NwsAlertProcessingFailure[];
}

export interface CollectionResult {
  success: boolean;
  error?: string;
}

function describeProcessingError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function processNwsAlertsForStormEvents(
  alerts: NormalizedNwsAlert[],
  processor: NwsWarningProcessor = processNwsWarningForStormEvent,
  options?: {
    notifyWarning?: (
      alert: NormalizedNwsAlert,
      result: ProcessNwsWarningResult
    ) => Promise<unknown>;
  }
): Promise<NwsAlertBatchResult> {
  const results: NwsAlertBatchResult['results'] = [];
  const failures: NwsAlertProcessingFailure[] = [];

  for (const alert of alerts) {
    try {
      const result = await processor(alert);
      let notification: unknown;
      if (options?.notifyWarning) {
        try {
          notification = await options.notifyWarning(alert, result);
        } catch (notificationError) {
          notification = {
            status: 'failed',
            notified: false,
            error: notificationError,
          };
        }
      }
      results.push({
        alertId: typeof alert?.id === 'string' ? alert.id : null,
        result,
        notification,
      });
    } catch (error) {
      failures.push({
        alertId: typeof alert?.id === 'string' ? alert.id : null,
        error,
      });
    }
  }

  return { results, failures };
}

export function withNwsAlertProcessingFailures(
  result: CollectionResult,
  failures: NwsAlertProcessingFailure[]
): CollectionResult {
  if (!failures.length) return result;

  const details = failures
    .map(({ alertId, error }) => `${alertId ?? '<missing-id>'}: ${describeProcessingError(error)}`)
    .join('; ');

  return {
    success: false,
    error: `NWS warning processing failed — ${details}`,
  };
}
