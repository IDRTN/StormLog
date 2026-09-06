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
const NWS_SNAPSHOT_MAX_AGE_MS = 20 * 60_000;

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

/** Persist the whole-cycle NWS result so lightning/lifecycle work can consume it without a second network request. */
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
 * Evaluate stop eligibility using only fresh evidence. If NWS or lightning data
 * is stale/failed we deliberately keep recording; missing data is never treated
 * as proof that a storm has ended.
 */
export async function evaluateAutomaticStormStop(input: {
  lightning: RecentLightningProximity;
  lightningFresh: boolean;
  nowMs: number;
}): Promise<'no_event' | 'active' | 'review_pending' | 'review_queued'> {
  const event = await getActiveAutomaticStormEvent();
  if (!event) {
    await clearReviewState();
    return 'no_event';
  }

  const nws = await readAutomaticNwsTriggerSnapshot(input.nowMs);
  const lightningActive = input.lightningFresh && isLightningStillRelevant(input.lightning);

  if ((nws.fresh && nws.active) || lightningActive) {
    await clearReviewState();
    return 'active';
  }

  // Both evidence streams must be fresh before asking to stop.
  if (!nws.fresh || !input.lightningFresh) return 'active';

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
