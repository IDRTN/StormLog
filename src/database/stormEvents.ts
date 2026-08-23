import { getDatabase } from './database';
import type { StormEvent } from '../models/types';

export async function createStormEvent(
  startLatitude: number,
  startLongitude: number,
  eventName?: string
): Promise<number> {
  const db = await getDatabase();
  const now = Date.now();
  const name = eventName || `Storm ${new Date(now).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  const result = await db.runAsync(
    'INSERT INTO storm_events (startTime, startLatitude, startLongitude, eventName) VALUES (?, ?, ?, ?)',
    [now, startLatitude, startLongitude, name]
  );
  return result.lastInsertRowId;
}

export async function endStormEvent(
  eventId: number,
  endLatitude: number | null,
  endLongitude: number | null
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE storm_events SET endTime = ?, endLatitude = ?, endLongitude = ? WHERE id = ?',
    [Date.now(), endLatitude, endLongitude, eventId]
  );
}

export async function getAllStormEvents(): Promise<StormEvent[]> {
  const db = await getDatabase();
  return await db.getAllAsync<StormEvent>(
    'SELECT * FROM storm_events ORDER BY startTime DESC'
  );
}

export async function getStormEventById(id: number): Promise<StormEvent | null> {
  const db = await getDatabase();
  const results = await db.getAllAsync<StormEvent>(
    'SELECT * FROM storm_events WHERE id = ?',
    [id]
  );
  return results.length > 0 ? results[0] : null;
}

export async function getActiveStormEvent(): Promise<StormEvent | null> {
  const db = await getDatabase();
  const results = await db.getAllAsync<StormEvent>(
    'SELECT * FROM storm_events WHERE endTime IS NULL ORDER BY startTime DESC LIMIT 1'
  );
  return results.length > 0 ? results[0] : null;
}

export async function deleteStormEvent(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM storm_events WHERE id = ?', [id]);
}
