import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createEmptyLightningUsageSnapshot,
  normalizeUsageSnapshotForTime,
  type LightningUsageSnapshot,
} from './lightningUsageGuard';

const LIGHTNING_USAGE_KEY = 'stormlog_lightning_usage_v1';

export async function readLightningUsageSnapshot(nowMs: number = Date.now()): Promise<LightningUsageSnapshot> {
  try {
    const raw = await AsyncStorage.getItem(LIGHTNING_USAGE_KEY);
    if (!raw) return createEmptyLightningUsageSnapshot();
    const parsed = JSON.parse(raw) as Partial<LightningUsageSnapshot>;
    const snapshot: LightningUsageSnapshot = {
      ...createEmptyLightningUsageSnapshot(),
      ...parsed,
    };
    const normalized = normalizeUsageSnapshotForTime(snapshot, nowMs);
    if (normalized !== snapshot) {
      await writeLightningUsageSnapshot(normalized);
    }
    return normalized;
  } catch {
    return createEmptyLightningUsageSnapshot();
  }
}

export async function writeLightningUsageSnapshot(snapshot: LightningUsageSnapshot): Promise<void> {
  await AsyncStorage.setItem(LIGHTNING_USAGE_KEY, JSON.stringify(snapshot));
}

export async function clearLightningUsageSnapshot(): Promise<void> {
  await AsyncStorage.removeItem(LIGHTNING_USAGE_KEY);
}
