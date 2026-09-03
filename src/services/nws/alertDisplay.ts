export type AlertDisplayTone = 'critical' | 'warning' | 'watch' | 'advisory';

export type AlertDisplayItem = {
  event: string;
  tone: AlertDisplayTone;
  priority: number;
};

function normalizedEvent(event: string): string {
  return event.trim().replace(/\s+/g, ' ');
}

export function getAlertDisplayItem(event: string): AlertDisplayItem {
  const clean = normalizedEvent(event);
  const upper = clean.toUpperCase();

  if (upper === 'TORNADO WARNING') {
    return { event: clean, tone: 'critical', priority: 500 };
  }
  if (upper === 'SEVERE THUNDERSTORM WARNING' || upper === 'FLASH FLOOD WARNING') {
    return { event: clean, tone: 'warning', priority: 400 };
  }
  if (upper.endsWith('WARNING')) {
    return { event: clean, tone: 'warning', priority: 350 };
  }
  if (upper.includes('TORNADO WATCH') || upper.includes('SEVERE THUNDERSTORM WATCH')) {
    return { event: clean, tone: 'watch', priority: 300 };
  }
  if (upper.endsWith('WATCH')) {
    return { event: clean, tone: 'watch', priority: 250 };
  }
  if (upper.endsWith('ADVISORY')) {
    return { event: clean, tone: 'advisory', priority: 200 };
  }
  return { event: clean, tone: 'advisory', priority: 100 };
}

export function sortAlertTypes(events: string[]): AlertDisplayItem[] {
  const unique = [...new Set(events.map(normalizedEvent).filter(Boolean))];
  return unique
    .map(getAlertDisplayItem)
    .sort((a, b) => b.priority - a.priority || a.event.localeCompare(b.event));
}

export function parseStoredAlertTypes(value: string | null | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.filter((item): item is string => typeof item === 'string').map(normalizedEvent).filter(Boolean))];
    }
    if (typeof parsed === 'string' && parsed.trim()) return [normalizedEvent(parsed)];
  } catch {
    // Older or manually-created rows may contain plain text instead of JSON.
  }

  return [normalizedEvent(trimmed)];
}
