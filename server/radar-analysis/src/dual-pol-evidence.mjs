function finite(v) { return typeof v === 'number' && Number.isFinite(v); }

export function evaluateDualPolEvidence({
  correlationCoefficient,
  differentialReflectivity = null,
  reflectivityDbz = null,
  hasVelocityCouplet = false,
  lowLevel = false,
  scanCount = 1,
}) {
  if (!finite(correlationCoefficient)) {
    return {
      available: false,
      debrisCandidate: false,
      debrisSignature: false,
      confidence: null,
      scanCount: 0,
      reason: 'Correlation coefficient unavailable',
    };
  }

  const cc = correlationCoefficient;
  const zdr = finite(differentialReflectivity) ? differentialReflectivity : null;
  const ref = finite(reflectivityDbz) ? reflectivityDbz : null;
  const validatedScanCount = Number.isInteger(scanCount) && scanCount >= 1 ? scanCount : 1;

  // A TDS-style debris claim is intentionally conservative. Low CC alone is
  // not sufficient: the low CC must be colocated with measured reflectivity
  // and a confirmed low-level velocity couplet. We also require persistence
  // across more than one independently tracked scan before declaring debris.
  const lowCc = cc <= 0.80;
  const supportiveReflectivity = ref != null && ref >= 20;
  const velocitySupported = hasVelocityCouplet === true && lowLevel === true;
  const debrisCandidate = lowCc && supportiveReflectivity && velocitySupported;
  const persistent = validatedScanCount >= 2;
  const debrisSignature = debrisCandidate && persistent;

  let confidence = null;
  if (debrisCandidate) {
    let score = Math.min(1, Math.max(0, (0.80 - cc) / 0.20));
    if (zdr != null && Math.abs(zdr) <= 3.0) score = Math.min(1, score + 0.1);
    score = Math.min(1, score + 0.1); // colocated reflectivity requirement satisfied
    if (persistent) score = Math.min(1, score + 0.1);
    confidence = Math.round(score * 100);
  }

  const reasons = [];
  reasons.push(lowCc ? `low CC ${cc.toFixed(2)}` : `CC ${cc.toFixed(2)} not below debris threshold`);
  if (!hasVelocityCouplet) reasons.push('no supporting velocity couplet');
  else if (!lowLevel) reasons.push('couplet not confirmed low-level');
  else reasons.push('low-level velocity couplet present');
  if (ref == null) reasons.push('colocated reflectivity unavailable');
  else if (!supportiveReflectivity) reasons.push('colocated reflectivity too weak for debris assessment');
  else reasons.push('colocated reflectivity supports debris assessment');
  if (zdr != null && Math.abs(zdr) <= 3.0) reasons.push('ZDR is supportive');
  if (debrisCandidate && !persistent) reasons.push(`candidate seen on only ${validatedScanCount} scan; persistence required`);
  if (debrisSignature) reasons.push(`validated across ${validatedScanCount} scans`);

  return {
    available: true,
    debrisCandidate,
    debrisSignature,
    confidence,
    scanCount: validatedScanCount,
    cc,
    zdr,
    reflectivityDbz: ref,
    reason: reasons.join('; '),
  };
}
