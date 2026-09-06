import AsyncStorage from '@react-native-async-storage/async-storage';
import { endStormEvent, getActiveAutomaticStormEvent } from '../../database/stormEvents';
import type { NormalizedNwsAlert } from '../nws/alerts';
import { isEligibleNwsWarning } from './processNwsWarning';
import { notifyAutomaticStormStopReview } from '../notifications';
import type { RecentLightningProximity } from '../lightning/lightningSummaries';
import {
  AUTO_STOP_REVIEW_GRACE_MS,
  KEEP_RECORDING_SUPPRESS_MS,
  LIGHTNING_CLEAR_LOOKBACK_MS,
  NWS_SNAPSHOT_MAX_AGE_MS,
  classifyAutomaticStormEvidence,
  isLightningStillRelevant,
  isStopReviewGraceExpired,
  kmToMiles,
} from './automaticStormPolicy';

export { AUTO_STOP_REVIEW_GRACE_MS, LIGHTNING_CLEAR_LOOKBACK_MS } from './automaticStormPolicy';

const PENDING_REVIEW_KEY = 'automatic_storm_stop_review';
const KEEP_UNTIL_KEY = 'automatic_storm_keep_until';
const NWS_TRIGGER_SNAPSHOT_KEY = 'automatic_storm_nws_trigger_snapshot';

export type AutomaticStormStopReason = 'nws_clear' | 'lightning_clear' | 'all_clear';

export type AutomaticStormStopReview = {
  eventId: number;
  reason: AutomaticStormStopReason;
  requestedAtMs: number;
  nearestLightningMiles: number | null;
};

type NwsTriggerSnapshot = {
  capturedAtMs: number;
  active: boolean;
};

function parseReview(value: string | null): AutomaticStormStopReview | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as AutomaticStormStopReview;
    if (!Number.isFinite(parsed.eventId) || !Number.isFinite(parsed.requestedAtMs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hasActiveAutomaticNwsTrigger(alerts: NormalizedNwsAlert[]): boolean {
  return alerts.some((alert) => {
    if (!isEligibleNwsWarning(alert)) return false;
    if (alert.status != null && alert.status !== 'Actual') return false;
    const messageType = (alert.messageType ?? 'Alert').toUpperCase();
    return messageType !== 'CANCEL';
  });
}

export async function recordAutomaticNwsTriggerSnapshot(
  alerts: NormalizedNwsAlert[],
  capturedAtMs: number = Date.now(),
): Promise<void> {
  const snapshot: NwsTriggerSnapshot = {
    capturedAtMs,
    active: hasActiveAutomaticNwsTrigger(alerts),
  };
  await AsyncStorage.setItem(NWS_TRIGGER_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

async function readAutomaticNwsTriggerSnapshot(nowMs: number): Promise<{
  active: boolean;
  fresh: boolean;
}> {
  const raw = await AsyncStorage.getItem(NWS_TRIGGER_SNAPSHOT_KEY);
  if (!raw) return { active: false, fresh: false };
  try {
    const parsed = JSON.parse(raw) as NwsTriggerSnapshot;
    if (!Number.isFinite(parsed.capturedAtMs)) return { active: false, fresh: false };
    return {
      active: parsed.active === true,
      fresh: Math.max(0, nowMs - parsed.capturedAtMs) <= NWS_SNAPSHOT_MAX_AGE_MS,
    };
  } catch {
    return { active: false, fresh: false };
  }
}

export async function getPendingAutomaticStormStopReview(): Promise<AutomaticStormStopReview | null> {
  return parseReview(await AsyncStorage.getItem(PENDING_REVIEW_KEY));
}

async function clearReviewState(): Promise<void> {
  await AsyncStorage.multiRemove([PENDING_REVIEW_KEY, KEEP_UNTIL_KEY]);
}

export async function clearAutomaticStormStopReview(): Promise<void> {
  await clearReviewState();
}

export async function requestAutomaticStormStopReview(input: {
  eventId: number;
  reason: AutomaticStormStopReason;
  nowMs: number;
  nearestLightningKm: number | null;
}): Promise<boolean> {
  const existing = await getPendingAutomaticStormStopReview();
  if (existing?.eventId === input.eventId) return false;

  const keepUntilRaw = await AsyncStorage.getItem(KEEP_UNTIL_KEY);
  const keepUntil = keepUntilRaw ? Number(keepUntilRaw) : 0;
  if (Number.isFinite(keepUntil) && keepUntil > input.nowMs) return false;

  const review: AutomaticStormStopReview = {
    eventId: input.eventId,
    reason: input.reason,
    requestedAtMs: input.nowMs,
    nearestLightningMiles: kmToMiles(input.nearestLightningKm),
  };
  await AsyncStorage.setItem(PENDING_REVIEW_KEY, JSON.stringify(review));
  await notifyAutomaticStormStopReview(review);
  return true;
}

export async function keepAutomaticStormRecording(eventId: number): Promise<boolean> {
  const pending = await getPendingAutomaticStormStopReview();
  if (!pending || pending.eventId !== eventId) return false;
  await AsyncStorage.removeItem(PENDING_REVIEW_KEY);
  await AsyncStorage.setItem(KEEP_UNTIL_KEY, String(Date.now() + KEEP_RECORDING_SUPPRESS_MS));
  return true;
}

export async function stopAutomaticStormRecording(
  eventId: number,
  location?: { latitude: number; longitude: number } | null,
): Promise<boolean> {
  const active = await getActiveAutomaticStormEvent();
  if (!active || active.id !== eventId) {
    await clearReviewState();
    return false;
  }
  await endStormEvent(eventId, location?.latitude ?? null, location?.longitude ?? null);
  await clearReviewState();
  return true;
}

export async function handleAutomaticStormStopAction(
  action: 'KEEP_RECORDING' | 'STOP_RECORDING',
  eventId: number,
): Promise<void> {
  if (action === 'KEEP_RECORDING') {
    await keepAutomaticStormRecording(eventId);
    return;
  }
  await stopAutomaticStormRecording(eventId);
}

export async function evaluateAutomaticStormStop(input: {
  lightning: RecentLightningProximity;
  lightningFresh: boolean;
  nowMs: number;
}): Promise<'no_event' | 'active' | 'review_pending' | 'review_queued' | 'auto_stopped'> {
  const event = await getActiveAutomaticStormEvent();
  if (!event) {
    await clearReviewState();
    return 'no_event';
  }

  const nws = await readAutomaticNwsTriggerSnapshot(input.nowMs);
  const evidence = classifyAutomaticStormEvidence({
    nwsFresh: nws.fresh,
    nwsActive: nws.active,
    lightningFresh: input.lightningFresh,
    lightningRelevant: isLightningStillRelevant(input.lightning),
  });

  if (evidence === 'active') {
    await clearReviewState();
    return 'active';
  }
  if (evidence === 'unknown') return 'active';

  const pending = await getPendingAutomaticStormStopReview();
  if (pending?.eventId === event.id) {
    if (isStopReviewGraceExpired(pending.requestedAtMs, input.nowMs)) {
      await stopAutomaticStormRecording(event.id);
      return 'auto_stopped';
    }
    return 'review_pending';
  }

  const reason: AutomaticStormStopReason = event.triggerSource === 'LIGHTNING_PROXIMITY'
    ? 'lightning_clear'
    : 'all_clear';
  const queued = await requestAutomaticStormStopReview({
    eventId: event.id,
    reason,
    nowMs: input.nowMs,
    nearestLightningKm: input.lightning.nearestDistanceKm,
  });
  return queued ? 'review_queued' : 'review_pending';
}
