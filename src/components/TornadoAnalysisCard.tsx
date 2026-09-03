// ============================================================
// TornadoAnalysisCard — Progressive Storm Development Display
// ============================================================

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, SPACING, BORDER_RADIUS } from '../constants/theme';
import type { StormAnalysisResult, AssessmentLevel } from '../services/analysis/types';

interface Props {
  result: StormAnalysisResult | null;
  loading?: boolean;
  radarStatus?: string;
}

function getLevelEmoji(level: AssessmentLevel): string {
  switch (level) {
    case 'VERY_HIGH': return '🔴';
    case 'HIGH': return '🟠';
    case 'MODERATE':
    case 'MARGINAL': return '🟡';
    case 'LOW':
    case 'VERY_LOW': return '🟢';
    case 'UNKNOWN': return '⚪';
  }
}

function getLevelColor(level: AssessmentLevel): string {
  switch (level) {
    case 'VERY_HIGH': return '#DC2626';
    case 'HIGH': return '#F85149';
    case 'MODERATE': return '#F0883E';
    case 'MARGINAL': return '#F0C000';
    case 'LOW': return '#3FB950';
    case 'VERY_LOW': return '#238636';
    case 'UNKNOWN': return '#8B949E';
  }
}

function getLevelLabel(level: AssessmentLevel): string {
  return level.replace('_', ' ');
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function FactorList({ factors }: { factors: string[] }) {
  if (!factors?.length) return null;
  return (
    <View style={s.factorsBox}>
      {factors.map((factor, index) => (
        <Text key={`${index}-${factor}`} style={s.factorItem}>• {factor}</Text>
      ))}
    </View>
  );
}

function CapabilityRow({ label, available, reason }: { label: string; available: boolean; reason?: string }) {
  return (
    <View style={s.radarCapsItem}>
      <View style={s.radarCapsRow}>
        <Text style={s.radarCapsLabel}>{label}</Text>
        <Text style={[s.radarCapsValue, { color: available ? '#3FB950' : '#F0C000' }]}>
          {available ? 'AVAILABLE' : 'UNAVAILABLE'}
        </Text>
      </View>
      {!available && reason ? <Text style={s.capabilityReason}>{reason}</Text> : null}
    </View>
  );
}

export function TornadoAnalysisCard({ result, loading, radarStatus }: Props) {
  const [showWhy, setShowWhy] = useState(false);

  if (loading) {
    return (
      <View style={s.card}>
        <Text style={s.header}>🌪️ TORNADO DEVELOPMENT</Text>
        <Text style={s.loading}>Analyzing conditions...</Text>
      </View>
    );
  }

  if (!result) {
    return (
      <View style={s.card}>
        <Text style={s.header}>🌪️ TORNADO DEVELOPMENT</Text>
        <Text style={s.noData}>INSUFFICIENT DATA</Text>
        <Text style={s.subtext}>Weather observations needed for analysis</Text>
      </View>
    );
  }

  const color = getLevelColor(result.overallAssessment);
  const emoji = getLevelEmoji(result.overallAssessment);
  const label = getLevelLabel(result.overallAssessment);
  const motion = result.stormMotion;
  const heatIndex = result.environment.heatIndexF;
  const heatIndexCategory = result.environment.heatIndexCategory;
  const heatIndexRisk = heatIndexCategory ? heatIndexCategory.replace('_', ' ') : 'NONE';
  const heatIndexColor = heatIndexCategory === 'DANGER' || heatIndexCategory === 'EXTREME_DANGER'
    ? '#DC2626'
    : heatIndexCategory === 'EXTREME_CAUTION'
      ? '#F0883E'
      : heatIndexCategory === 'CAUTION'
        ? '#F0C000'
        : '#3FB950';

  const quantitativeDbzAvailable = result.stormStructure.maxReflectivity != null;
  const velocityAvailable = result.rotation.velocityDataAvailable;
  const dualPolAvailable = result.tornadicEvidence.dualPolAvailable;
  const radarConnected = result.stormStructure.radarAvailable;

  return (
    <View style={s.card}>
      <Text style={s.header}>🌪️ TORNADO DEVELOPMENT</Text>
      {radarStatus ? <Text style={s.radarStatus}>Radar: {radarStatus}</Text> : null}

      <View style={s.radarCaps}>
        <Text style={s.radarCapsTitle}>RADAR CAPABILITIES</Text>
        <CapabilityRow
          label="Connection"
          available={radarConnected}
          reason="No radar feed is currently connected for this location."
        />
        <CapabilityRow
          label="Reflectivity imagery"
          available={radarConnected}
          reason="Radar imagery cannot be displayed without a connected radar feed."
        />
        <CapabilityRow
          label="Quantitative dBZ"
          available={quantitativeDbzAvailable}
          reason="The current radar path supplies imagery only; calibrated reflectivity values are not being decoded yet."
        />
        <CapabilityRow
          label="Doppler velocity"
          available={velocityAvailable}
          reason="Base velocity data is not connected to the current radar-processing path yet."
        />
        <CapabilityRow
          label="Dual-pol"
          available={dualPolAvailable}
          reason="Correlation coefficient and other dual-pol products are not connected to the current radar-processing path yet."
        />
      </View>

      <View style={[s.banner, { borderLeftColor: color }]}>
        <Text style={s.bannerEmoji}>{emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.bannerCaption}>OVERALL STORMLOG TORNADO ASSESSMENT</Text>
          <Text style={[s.bannerLevel, { color }]}>{label}</Text>
          <Text style={s.confidence}>Confidence: {result.dataQuality.level}</Text>
        </View>
      </View>

      <Section title="SURFACE INSTABILITY & MOISTURE">
        <Row
          label="Surface Favorability"
          value={getLevelLabel(result.surfaceEnvironment?.level ?? 'UNKNOWN')}
          valueColor={getLevelColor(result.surfaceEnvironment?.level ?? 'UNKNOWN')}
        />
        <Text style={s.contextNote}>
          Surface favorability is environmental context only. A high value does not mean a tornado is occurring or imminent.
        </Text>
        {result.surfaceEnvironment?.capeAvailable && result.environment.cape != null ? (
          <Row label="CAPE" value={`${result.environment.cape.toLocaleString()} J/kg`} />
        ) : null}
        {result.environment.pressureTrend !== 'STABLE' ? (
          <Row label="Pressure Trend" value={result.environment.pressureTrend} />
        ) : null}
        <Row
          label="Heat Index"
          value={heatIndex != null ? `${heatIndex.toFixed(1)}°F` : 'Not applicable'}
          valueColor={heatIndex != null ? heatIndexColor : '#8B949E'}
        />
        <Row
          label="Heat Risk"
          value={heatIndexCategory ? heatIndexRisk : 'NONE'}
          valueColor={heatIndexColor}
        />
        {heatIndex == null && result.environment.heatIndexDescription ? (
          <Text style={s.metricReason}>{result.environment.heatIndexDescription}</Text>
        ) : null}
      </Section>

      <Section title="ATMOSPHERIC TORNADO ENVIRONMENT">
        <Text style={s.blockStatusLabel}>STATUS</Text>
        <Text style={s.blockStatusValue}>
          {result.atmosphericEnvironment?.description ?? 'Data unavailable'}
        </Text>
      </Section>

      <Section title="STORM">
        <Row
          label="Structure"
          value={result.stormStructure.stormOrganization}
          valueColor={result.stormStructure.radarAvailable ? Colors.text : Colors.textSecondary}
        />
        <Row
          label="Quantitative dBZ"
          value={quantitativeDbzAvailable && result.stormStructure.maxReflectivity != null
            ? `${result.stormStructure.maxReflectivity.toFixed(0)} dBZ`
            : 'Unavailable'}
          valueColor={quantitativeDbzAvailable ? undefined : '#8B949E'}
        />
        {!quantitativeDbzAvailable ? (
          <Text style={s.metricReason}>Calibrated dBZ values are unavailable because the current radar provider only supplies imagery.</Text>
        ) : null}
        {motion?.distanceMiles != null ? <Row label="Distance" value={`${motion.distanceMiles.toFixed(1)} mi`} /> : null}
        {motion ? (
          <Row
            label="Motion"
            value={[
              motion.description,
              motion.speedMph != null ? `${motion.speedMph.toFixed(0)} mph` : null,
            ].filter(Boolean).join(' · ')}
          />
        ) : (
          <Text style={s.metricReason}>Storm motion is unavailable until a validated storm-cell motion source is connected.</Text>
        )}
        {!result.stormStructure.radarAvailable ? <Row label="Radar" value="Not connected" valueColor="#8B949E" /> : null}
      </Section>

      <Section title="ROTATION">
        {!velocityAvailable ? (
          <>
            <Row label="Status" value="Radar rotation unavailable" valueColor="#F0C000" />
            <Text style={s.unavailableNote}>
              Doppler velocity is not available from the current radar processing path. Surface observations are shown below but cannot replace Doppler rotation data.
            </Text>
          </>
        ) : (
          <>
            <Row label="Couplet" value={result.rotation.hasCouplet ? `${result.rotation.coupletStrength}` : 'None detected'} />
            {result.rotation.gateToGateShear != null ? (
              <Row label="Gate-to-Gate Shear" value={`${result.rotation.gateToGateShear.toFixed(0)} kt`} />
            ) : null}
            <Row label="Low-Level Rotation" value={result.rotation.lowLevelRotation ? 'Yes' : 'No'} />
            <Row label="Vertical Continuity" value={result.rotation.verticalContinuity > 0 ? `${result.rotation.verticalContinuity} scans` : 'N/A'} />
          </>
        )}

        <Row
          label="Trend"
          value={result.rotation.trend === 'RAPIDLY_INTENSIFYING' ? 'Rapidly Intensifying'
            : result.rotation.trend === 'STRENGTHENING' ? 'Strengthening'
              : result.rotation.trend === 'WEAKENING' ? 'Weakening'
                : result.rotation.trend === 'PERSISTENT' ? 'Persistent'
                  : result.rotation.trend === 'NEWLY_DEVELOPING' ? 'Newly Developing'
                    : 'Unknown'}
          valueColor={result.rotation.trend === 'RAPIDLY_INTENSIFYING' || result.rotation.trend === 'STRENGTHENING'
            ? '#F85149'
            : result.rotation.trend === 'WEAKENING' ? '#3FB950' : undefined}
        />

        {result.rotation.surfaceWindPattern ? (
          <>
            <Row label="Convergence" value={result.rotation.surfaceWindPattern.convergenceLevel} />
            <Row label="Surface Wind Pattern" value={result.rotation.surfaceWindPattern.rotationSignal} />
            {result.rotation.surfaceWindPattern.windShiftDegrees != null ? (
              <Row
                label="Wind Shift"
                value={`${result.rotation.surfaceWindPattern.windShiftDegrees}° / ${result.rotation.surfaceWindPattern.windShiftMinutes ?? '?'} min`}
              />
            ) : null}
          </>
        ) : null}
      </Section>

      <Section title="TORNADIC EVIDENCE">
        <Row
          label="Assessment"
          value={result.tornadicEvidence.level === 'UNKNOWN'
            ? 'Cannot assess without radar velocity'
            : getLevelLabel(result.tornadicEvidence.level)}
          valueColor={getLevelColor(result.tornadicEvidence.level)}
        />
        <Row
          label="Debris Signature"
          value={!dualPolAvailable
            ? 'Not available (no dual-pol)'
            : result.tornadicEvidence.debrisSignature ? 'Detected' : 'Not detected'}
        />
        {!dualPolAvailable ? (
          <Text style={s.metricReason}>A debris signature cannot be evaluated until dual-pol correlation-coefficient data is available.</Text>
        ) : null}
        {result.tornadicEvidence.correlationCoefficient != null ? (
          <Row label="CC" value={result.tornadicEvidence.correlationCoefficient.toFixed(2)} />
        ) : null}
      </Section>

      {result.dataFreshness ? (
        <Section title="DATA FRESHNESS">
          <Row
            label="Radar Data"
            value={result.dataFreshness.description}
            valueColor={result.dataFreshness.isStale ? '#F0C000' : undefined}
          />
        </Section>
      ) : null}

      <Section title="NWS">
        <View style={[
          s.nwsBox,
          result.nwsStatus.tornadoWarning ? s.nwsDanger
            : result.nwsStatus.tornadoWatch ? s.nwsWatch
              : result.nwsStatus.severeWarning ? s.nwsWarn : s.nwsClear,
        ]}>
          <Text style={[
            s.nwsText,
            result.nwsStatus.tornadoWarning ? s.nwsDangerText
              : result.nwsStatus.tornadoWatch ? s.nwsWatchText
                : result.nwsStatus.severeWarning ? s.nwsWarnText : s.nwsClearText,
          ]}>
            {result.nwsStatus.tornadoWarning ? '⚠️ TORNADO WARNING — NWS'
              : result.nwsStatus.tornadoWatch ? 'Tornado Watch — NWS'
                : result.nwsStatus.severeWarning ? 'Severe Thunderstorm Warning — NWS'
                  : result.nwsStatus.severeWatch ? 'Severe Thunderstorm Watch — NWS'
                    : 'No active watch/warning'}
          </Text>
        </View>
      </Section>

      {result.whatWouldIncreaseConcern?.length > 0 ? (
        <Section title="WHAT WOULD INCREASE CONCERN">
          <FactorList factors={result.whatWouldIncreaseConcern} />
        </Section>
      ) : null}

      <TouchableOpacity style={s.whyBtn} onPress={() => setShowWhy(true)}>
        <Ionicons name="help-circle" size={16} color={Colors.primary} />
        <Text style={s.whyBtnText}>WHY?</Text>
      </TouchableOpacity>

      <Text style={s.disclaimer}>
        Analytical estimate — NOT an official tornado warning. Use official NWS warnings and radar for life-safety decisions.
      </Text>

      <Modal visible={showWhy} animationType="slide" transparent>
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>WHY: {label}</Text>
              <TouchableOpacity onPress={() => setShowWhy(false)}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={s.modalScroll}>
              <Text style={s.whyText}>{result.whyExplanation}</Text>
              <Text style={s.modalSectionTitle}>Environment</Text>
              <FactorList factors={result.environment.factors} />
              <Text style={s.modalSectionTitle}>Storm Structure</Text>
              <FactorList factors={result.stormStructure.factors} />
              <Text style={s.modalSectionTitle}>Rotation</Text>
              <FactorList factors={result.rotation.factors} />
              <Text style={s.modalSectionTitle}>Tornadic Evidence</Text>
              <FactorList factors={result.tornadicEvidence.factors} />
              <Text style={s.modalSectionTitle}>Data Limitations</Text>
              <FactorList factors={result.dataQuality.limitations} />
              <Text style={s.modalSafety}>
                This feature estimates environmental and wind-field signals that can be associated with rotating storms. It cannot detect or confirm a tornado. Use official NWS warnings and radar information for life-safety decisions.
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: '#30363D' },
  header: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: SPACING.sm },
  loading: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', paddingVertical: 20 },
  noData: { color: Colors.warning, fontSize: 15, fontWeight: '600', textAlign: 'center', marginTop: 8 },
  subtext: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 4 },
  banner: { flexDirection: 'row', alignItems: 'center', borderLeftWidth: 4, paddingLeft: 12, paddingVertical: 10, marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 8 },
  bannerEmoji: { fontSize: 28, marginRight: 12 },
  bannerCaption: { fontSize: 9, color: Colors.textSecondary, fontWeight: '700', letterSpacing: 0.6, marginBottom: 2 },
  bannerLevel: { fontSize: 22, fontWeight: '800', letterSpacing: 0.5 },
  confidence: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: Colors.primary, letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 3, minHeight: 20 },
  rowLabel: { fontSize: 13, color: Colors.textSecondary, flexBasis: '38%', flexShrink: 0 },
  rowValue: { fontSize: 13, color: Colors.text, fontWeight: '500', textAlign: 'right', flex: 1, marginLeft: 8 },
  contextNote: { fontSize: 10, color: Colors.textSecondary, lineHeight: 14, marginBottom: 5, fontStyle: 'italic' },
  metricReason: { fontSize: 10, color: Colors.textSecondary, lineHeight: 14, marginTop: 2, marginBottom: 5, fontStyle: 'italic' },
  blockStatusLabel: { fontSize: 10, color: Colors.textSecondary, fontWeight: '700', marginBottom: 3 },
  blockStatusValue: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  unavailableNote: { fontSize: 11, color: '#F0C000', fontStyle: 'italic', marginTop: 4, lineHeight: 16 },
  nwsBox: { padding: 10, borderRadius: 8, borderWidth: 1 },
  nwsDanger: { backgroundColor: 'rgba(220,38,38,0.15)', borderColor: '#DC2626' },
  nwsWatch: { backgroundColor: 'rgba(240,136,62,0.15)', borderColor: '#F0883E' },
  nwsWarn: { backgroundColor: 'rgba(240,200,0,0.15)', borderColor: '#F0C000' },
  nwsClear: { backgroundColor: 'rgba(63,185,80,0.1)', borderColor: '#238636' },
  nwsText: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  nwsDangerText: { color: '#DC2626' },
  nwsWatchText: { color: '#F0883E' },
  nwsWarnText: { color: '#F0C000' },
  nwsClearText: { color: '#3FB950' },
  whyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, marginTop: 8, gap: 6, borderWidth: 1, borderColor: '#30363D', borderRadius: 8 },
  whyBtnText: { color: Colors.primary, fontSize: 13, fontWeight: '600' },
  disclaimer: { fontSize: 10, color: Colors.textSecondary, textAlign: 'center', marginTop: 8, fontStyle: 'italic', lineHeight: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: Colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%', paddingBottom: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#30363D' },
  modalTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  modalScroll: { paddingHorizontal: 16 },
  whyText: { fontSize: 14, color: Colors.text, lineHeight: 21, marginVertical: 12 },
  modalSectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.primary, marginTop: 14, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  factorsBox: { marginBottom: 8 },
  factorItem: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 3 },
  modalSafety: { fontSize: 12, color: Colors.warning, marginTop: 16, padding: 12, backgroundColor: 'rgba(240,200,0,0.08)', borderRadius: 8, lineHeight: 18, fontStyle: 'italic' },
  radarStatus: { fontSize: 11, color: Colors.textSecondary, marginBottom: 8, fontStyle: 'italic' },
  radarCaps: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 8, marginBottom: 10 },
  radarCapsTitle: { fontSize: 10, fontWeight: '700', color: '#8B949E', letterSpacing: 1, marginBottom: 4 },
  radarCapsItem: { marginBottom: 4 },
  radarCapsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  radarCapsLabel: { fontSize: 11, color: '#8B949E' },
  radarCapsValue: { fontSize: 11, fontWeight: '600' },
  capabilityReason: { fontSize: 9, color: '#8B949E', lineHeight: 13, paddingRight: 6 },
});
