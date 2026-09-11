function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
function angularDistance(a, b) { let d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); }

export function trackRotationAcrossScans(scans, { maxAzimuthDeltaDeg = 4, maxRangeDeltaKm = 5, minPersistentScans = 3 } = {}) {
  if (!Array.isArray(scans)) throw new Error('scans must be an array');
  const ordered = [...scans]
    .filter(s => finite(s?.timestamp) && Array.isArray(s?.couplets))
    .sort((a, b) => a.timestamp - b.timestamp);

  const tracks = [];
  for (const scan of ordered) {
    for (const c of scan.couplets) {
      if (!finite(c?.azimuthDeg) || !finite(c?.rangeKm) || !finite(c?.deltaVKt)) continue;
      let best = null;
      let bestMetric = Infinity;
      for (const track of tracks) {
        const last = track.samples.at(-1);
        if (!last || last.timestamp >= scan.timestamp) continue;
        const ad = angularDistance(last.azimuthDeg, c.azimuthDeg);
        const rd = Math.abs(last.rangeKm - c.rangeKm);
        if (ad <= maxAzimuthDeltaDeg && rd <= maxRangeDeltaKm) {
          const metric = ad / maxAzimuthDeltaDeg + rd / maxRangeDeltaKm;
          if (metric < bestMetric) { bestMetric = metric; best = track; }
        }
      }
      const sample = { timestamp: scan.timestamp, azimuthDeg: c.azimuthDeg, rangeKm: c.rangeKm, deltaVKt: c.deltaVKt, rotationalVelocityKt: c.rotationalVelocityKt ?? c.deltaVKt / 2, strength: c.strength ?? null };
      if (best) best.samples.push(sample);
      else tracks.push({ samples: [sample] });
    }
  }

  return tracks.map((track, index) => {
    const first = track.samples[0];
    const last = track.samples.at(-1);
    const delta = last.deltaVKt - first.deltaVKt;
    const ratio = first.deltaVKt > 0 ? last.deltaVKt / first.deltaVKt : 1;
    const trend = track.samples.length < 2 ? 'UNKNOWN'
      : ratio >= 1.5 ? 'RAPIDLY_INTENSIFYING'
      : ratio >= 1.15 ? 'STRENGTHENING'
      : ratio <= 0.6 ? 'WEAKENING'
      : 'PERSISTENT';
    return {
      id: index + 1,
      scanCount: track.samples.length,
      persistent: track.samples.length >= minPersistentScans,
      trend,
      deltaVChangeKt: delta,
      latest: last,
      samples: track.samples,
    };
  }).sort((a, b) => b.scanCount - a.scanCount || b.latest.deltaVKt - a.latest.deltaVKt);
}
