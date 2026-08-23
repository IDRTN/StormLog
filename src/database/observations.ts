import { getDatabase } from './database';
import type { WeatherObservation } from '../models/types';

export async function insertObservation(
  observation: Omit<WeatherObservation, 'id'>
): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    `INSERT INTO weather_observations 
     (timestamp, latitude, longitude, temperature, humidity, pressure, 
      windSpeed, windDirection, windGust, dewPoint, precipitation, 
      weatherCondition, stormEventId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      observation.timestamp,
      observation.latitude,
      observation.longitude,
      observation.temperature,
      observation.humidity,
      observation.pressure,
      observation.windSpeed,
      observation.windDirection,
      observation.windGust,
      observation.dewPoint,
      observation.precipitation,
      observation.weatherCondition,
      observation.stormEventId,
    ]
  );
  return result.lastInsertRowId;
}

export async function getObservationsByEvent(
  eventId: number
): Promise<WeatherObservation[]> {
  const db = await getDatabase();
  return await db.getAllAsync<WeatherObservation>(
    'SELECT * FROM weather_observations WHERE stormEventId = ? ORDER BY timestamp ASC',
    [eventId]
  );
}

export async function getRecentObservations(
  eventId: number,
  withinMinutes: number = 60
): Promise<WeatherObservation[]> {
  const db = await getDatabase();
  const cutoff = Date.now() - withinMinutes * 60 * 1000;
  return await db.getAllAsync<WeatherObservation>(
    'SELECT * FROM weather_observations WHERE stormEventId = ? AND timestamp >= ? ORDER BY timestamp ASC',
    [eventId, cutoff]
  );
}

export async function getObservationCount(eventId: number): Promise<number> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM weather_observations WHERE stormEventId = ?',
    [eventId]
  );
  return result?.count ?? 0;
}
