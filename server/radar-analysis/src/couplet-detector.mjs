export function classifyDeltaV(deltaV) {
  if (!Number.isFinite(deltaV) || deltaV < 30) return null;
  if (deltaV >= 80) return 'EXTREME';
  if (deltaV >= 60) return 'STRONG';
  if (deltaV >= 45) return 'MODERATE';
  return 'WEAK';
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function angularMidpoint(a, b) {
  const ar = a * Math.PI / 180;
  const br = b * Math.PI / 180;
  const x = Math.cos(ar) + Math.cos(br);
  const y = Math.sin(ar) + Math.sin(br);
  let deg = Math.atan2(y, x) * 180 / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

export function detectVelocityCouplets({
  azimuths,
  velocityMoments,
  minDeltaV = 30,
  minAbsVelocity = 10,
  maxRangeKm = 230,
  maxCandidates = 100,
}) {
  if (!Array.isArray(azimuths) || !Array.isArray(velocityMoments)) {
    throw new Error('azimuths and velocityMoments must be arrays');
  }
  if (azimuths.length !== velocityMoments.length) {
    throw new Error(`Azimuth/moment length mismatch: ${azimuths.length} vs ${velocityMoments.length}`);
  }

  const candidates = [];
  for (let ray = 0; ray < velocityMoments.length; ray += 1) {
    const nextRay = (ray + 1) % velocityMoments.length;
    const a = velocityMoments[ray];
    const b = velocityMoments[nextRay];
    if (!a || !b || !Array.isArray(a.moment_data) || !Array.isArray(b.moment_data)) continue;

    const gateSizeKm = Number(a.gate_size);
    const firstGateKm = Number(a.first_gate);
    if (!Number.isFinite(gateSizeKm) || gateSizeKm <= 0 || !Number.isFinite(firstGateKm)) continue;

    const gateCount = Math.min(a.moment_data.length, b.moment_data.length);
    for (let gate = 0; gate < gateCount; gate += 1) {
      const rangeKm = firstGateKm + gate * gateSizeKm;
      if (rangeKm < 0 || rangeKm > maxRangeKm) continue;

      for (const gateOffset of [-1, 0, 1]) {
        const otherGate = gate + gateOffset;
        if (otherGate < 0 || otherGate >= b.moment_data.length) continue;
        const va = a.moment_data[gate];
        const vb = b.moment_data[otherGate];
        if (!isFiniteNumber(va) || !isFiniteNumber(vb)) continue;
        if (Math.sign(va) === Math.sign(vb) || va === 0 || vb === 0) continue;
        if (Math.abs(va) < minAbsVelocity || Math.abs(vb) < minAbsVelocity) continue;

        const deltaV = Math.abs(va - vb);
        if (deltaV < minDeltaV) continue;
        const strength = classifyDeltaV(deltaV);
        if (!strength) continue;

        const azA = azimuths[ray];
        const azB = azimuths[nextRay];
        if (!isFiniteNumber(azA) || !isFiniteNumber(azB)) continue;

        candidates.push({
          rayA: ray,
          rayB: nextRay,
          gateA: gate,
          gateB: otherGate,
          azimuthDeg: angularMidpoint(azA, azB),
          rangeKm: firstGateKm + ((gate + otherGate) / 2) * gateSizeKm,
          inboundKt: Math.min(va, vb),
          outboundKt: Math.max(va, vb),
          deltaVKt: deltaV,
          rotationalVelocityKt: deltaV / 2,
          strength,
        });
      }
    }
  }

  candidates.sort((a, b) => b.deltaVKt - a.deltaVKt);

  const deduped = [];
  for (const candidate of candidates) {
    const duplicate = deduped.some(existing => {
      const gateDeltaKm = Math.abs(existing.rangeKm - candidate.rangeKm);
      let azDelta = Math.abs(existing.azimuthDeg - candidate.azimuthDeg);
      azDelta = Math.min(azDelta, 360 - azDelta);
      return gateDeltaKm <= 1.5 && azDelta <= 2.0;
    });
    if (!duplicate) deduped.push(candidate);
    if (deduped.length >= maxCandidates) break;
  }

  return deduped;
}
