import {
  WARNING_TRIGGER_SOURCE,
  createStormEventForWarning,
  type WarningLifecycle,
  type StormLogDatabase,
  type WarningStormEventResult,
} from '../../database/warningEvents';

export interface AutomaticStormEventLocation {
  latitude: number | null;
  longitude: number | null;
}

export interface CreateAutomaticStormEventInput {
  location: AutomaticStormEventLocation | null;
  alert: { id: string; event: string };
  lifecycle?: WarningLifecycle;
  eventName?: string;
  nowMs?: number;
  database?: StormLogDatabase;
}

export async function createAutomaticStormEvent(
  input: CreateAutomaticStormEventInput
): Promise<WarningStormEventResult> {
  const latitude = input.location?.latitude ?? null;
  const longitude = input.location?.longitude ?? null;

  return createStormEventForWarning(
    {
      location: latitude != null && longitude != null
        ? { latitude, longitude }
        : null,
      warning: {
        nwsAlertId: input.alert.id,
        event: input.alert.event,
        triggerSource: WARNING_TRIGGER_SOURCE,
        status: input.lifecycle?.status ?? null,
        messageType: input.lifecycle?.messageType ?? null,
        references: input.lifecycle?.references ?? [],
        endsAt: input.lifecycle?.endsAt ?? null,
      },
      eventName: input.eventName,
      nowMs: input.nowMs,
    },
    input.database
  );
}
