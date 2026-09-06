import AsyncStorage from '@react-native-async-storage/async-storage';
import { endStormEvent, getActiveAutomaticStormEvent } from '../../database/stormEvents';
import type { NormalizedNwsAlert } from '../nws/alerts';
import { isEligibleNwsWarning } from './processNwsWarning';
import { notifyAutomaticStormStopReview } from '../notifications';
import type { RecentLightningProximity } from '../lightning/lightningSummaries';

const KM_PER_MILE = 1.609344;
export const LIGHTNING_AUTO_STOP_RADIUS_MILES = 30;
export const LIGHTNING_AUTO_STOP_RADIUS_KM = LIGHTNING_AUTO_STOP_RADIUS_MILES * KM_PER_MILE;
export const LIGHTNING_CLEAR_LOOKBACK_MS = 30 * 60_000;
const KEEP_RECORDING_SUPPRESS_MS = 60 * 60_000;

const PENDING_REVIEW_KEY = 'automatic_storm_stop_review';
const KEEP_UNTIL_KEY = 'automatic_storm_keep_until';

export type AutomaticStormStopReason = 'nws_clear' | 'lightning_clear' | 'all_clear';

export type AutomaticStormStopReview = {
  eventId: number;
  reason: AutomaticStormStopReason;
  requestedAtMs: number;
  nearestLightningMiles: number | null;
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

export function isLightningStillRelevant(proximity: RecentLightningProximity): boolean {
  return proximity.count > 0
    && proximity.nearestDistanceKm != null
    && proximity.nearestDistanceKm <= LIGHTNING_AUTO_STOP_RADIUS_KM;
}

export async function getPendingAutomaticStormStopReview(): Promise<AutomaticStormStopReview | null> {
  return parseReview(await AsyncStorage.getItem(PENDING_REVIEW_KEY));
}

async function clearReviewState(): Promise<void> {
  await AsyncStorage.multiRemove([PENDING_REVIEW_KEY, KEEP_UNTIL_KEY]);
}

/** Called whenever a live watch/warning or nearby lightning becomes active again. */
export async function clearAutomaticStormStopReview(): Promise<void> {
  await clearReviewState();
}

/**
 * Queue one decision request instead of silently ending an automatic storm log.
 * A user choosing Keep Recording suppresses repeat prompts for one hour unless a
 * real trigger becomes active again (which clears the suppression immediately).
 */
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
    nearestLightningMiles: input.nearestLightningKm == null
      ? null
      : input.nearestLightningKm / KM_PER_MILE,
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

/**
 * Decide whether an active automatic event is still justified. We fail safe:
 * stale/failed lightning data is represented by `lightningFresh=false` and can
 * never be used as an all-clear. The caller supplies the current NWS alert set.
 */
export async function evaluateAutomaticStormStop(input: {
  alerts: NormalizedNwsAlert[];
  lightning: RecentLightningProximity;
  lightningFresh: boolean;
  nowMs: number;
}): Promise<'no_event' | 'active' | 'review_pending' | 'review_queued'> {
  const event = await getActiveAutomaticStormEvent();
  if (!event) {
    await clearReviewState();
    return 'no_event';
  }

  const nwsActive = hasActiveAutomaticNwsTrigger(input.alerts);
  const lightningActive = input.lightningFresh && isLightningStillRelevant(input.lightning);

  if (nwsActive || lightningActive) {
    await clearReviewState();
    return 'active';
  }

  // Never infer a storm has cleared from missing/stale lightning data.
  if (!input.lightningFresh) return 'active';

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
