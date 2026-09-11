function finite(v) { return typeof v === 'number' && Number.isFinite(v); }

export function evaluateDualPolEvidence({ correlationCoefficient, differentialReflectivity = null, reflectivityDbz = null, hasVelocityCouplet = false, lowLevel = false }) {
  if (!finite(correlationCoefficient)) {
    return { available: false, debrisSignature: false, confidence: null, reason: 'Correlation coefficient unavailable' };
  }
  const cc = correlationCoefficient;
  const zdr = finite(differentialReflectivity) ? differentialReflectivity : null;
  const ref = finite(reflectivityDbz) ? reflectivityDbz : null;

  const lowCc = cc < 0.85;
  const supportiveZdr = zdr == null ? null : Math.abs(zdr) <= 3.0;
  const supportiveReflectivity = ref == null ? null : ref >= 20;
  const velocitySupported = hasVelocityCouplet === true && lowLevel === true;

  const debrisSignature = lowCc && velocitySupported && supportiveReflectivity !== false;
  let confidence = null;
  if (debrisSignature) {
    let score = Math.min(1, Math.max(0, (0.85 - cc) / 0.25));
    if (supportiveZdr === true) score = Math.min(1, score + 0.1);
    if (supportiveReflectivity === true) score = Math.min(1, score + 0.1);
    confidence = Math.round(score * 100);
  }

  const reasons = [];
  if (lowCc) reasons.push(`low CC ${cc.toFixed(2)}`); else reasons.push(`CC ${cc.toFixed(2)} not low`);
  if (!hasVelocityCouplet) reasons.push('no supporting velocity couplet');
  else if (!lowLevel) reasons.push('couplet not confirmed low-level');
  else reasons.push('low-level velocity couplet present');
  if (supportiveReflectivity === false) reasons.push('reflectivity too weak for debris confidence');
  if (supportiveReflectivity === true) reasons.push('reflectivity supports debris assessment');
  if (supportiveZdr === true) reasons.push('ZDR is supportive');

  return { available: true, debrisSignature, confidence, cc, zdr, reflectivityDbz: ref, reason: reasons.join('; ') };
}
