import type { StormEventWithWarningMetadata } from '../../database/stormEvents';

export type WarningLifecycleTone = 'active' | 'canceled' | 'ended' | 'neutral';

export interface WarningEventDisplay {
  sourceLabel: string | null;
  warningType: string | null;
  lifecycleLabel: string | null;
  lifecycleTone: WarningLifecycleTone;
  warningEndsAt: number | null;
}

type DisplayStormEvent = Pick<
  StormEventWithWarningMetadata,
  | 'eventName'
  | 'endTime'
  | 'isAutomatic'
  | 'triggerSource'
  | 'nwsAlertId'
  | 'currentNwsAlertId'
  | 'warningStatus'
  | 'warningEndsAt'
>;

function getWarningType(eventName: string): string {
  return eventName.replace(/^Automatic\s+/, '');
}

export function getWarningEventDisplay(
  event: DisplayStormEvent
): WarningEventDisplay {
  if (event.isAutomatic !== true) {
    return {
      sourceLabel: null,
      warningType: null,
      lifecycleLabel: null,
      lifecycleTone: 'neutral',
      warningEndsAt: null,
    };
  }

  let lifecycleLabel: string;
  let lifecycleTone: WarningLifecycleTone;

  if (event.warningStatus === 'CANCELED') {
    lifecycleLabel = 'CANCELED';
    lifecycleTone = 'canceled';
  } else if (event.warningStatus === 'EXPIRED') {
    lifecycleLabel = 'EXPIRED';
    lifecycleTone = 'ended';
  } else if (event.endTime != null) {
    lifecycleLabel = 'ENDED';
    lifecycleTone = 'ended';
  } else {
    lifecycleLabel = 'ACTIVE WARNING';
    lifecycleTone = 'active';
  }

  return {
    sourceLabel: event.triggerSource === 'NWS_WARNING' ? 'NWS · AUTOMATIC' : 'AUTOMATIC',
    warningType: getWarningType(event.eventName),
    lifecycleLabel,
    lifecycleTone,
    warningEndsAt: typeof event.warningEndsAt === 'number' && Number.isFinite(event.warningEndsAt)
      ? event.warningEndsAt
      : null,
  };
}
