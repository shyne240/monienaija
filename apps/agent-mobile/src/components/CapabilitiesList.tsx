import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';
import type { AgentCapabilities, AgentCanonicalService } from '../services/agent-api';

/**
 * Backend-authoritative capability presentation (spec §3/§4, task §4).
 *
 * FAIL-CLOSED: a service is rendered "Enabled" only when the backend
 * evaluation says `allowed === true`. Absent/unassigned capabilities are
 * shown as unavailable with the backend-provided reason — the UI never
 * derives authorization itself and never exposes an action as available
 * without a positive backend signal.
 */

const PRESENTED_SERVICES: ReadonlyArray<{ canonical: AgentCanonicalService; label: string }> = [
  { canonical: 'CASH_IN', label: 'Cash → Wallet' },
  { canonical: 'CASH_OUT', label: 'Wallet → Cash' },
  { canonical: 'CASH_TO_CASH', label: 'Cash → Cash' },
];

interface CapabilitiesListProps {
  capabilities: AgentCapabilities;
  testID?: string;
}

export const CapabilitiesList: React.FC<CapabilitiesListProps> = ({ capabilities, testID }) => {
  return (
    <View testID={testID}>
      {PRESENTED_SERVICES.map(({ canonical, label }) => {
        const evaluation = capabilities.evaluations.find(
          (e) => e.canonicalService === canonical,
        );
        const enabled = evaluation?.allowed === true;
        return (
          <View key={canonical} style={styles.row} testID={`capability-${canonical.toLowerCase().replaceAll('_', '-')}`}>
            <View style={styles.rowText}>
              <Text style={styles.serviceLabel}>{label}</Text>
              {!enabled && (
                <Text style={styles.reason} testID={`capability-reason-${canonical.toLowerCase().replaceAll('_', '-')}`}>
                  {evaluation?.reason ?? 'Unavailable for your account'}
                </Text>
              )}
            </View>
            <View style={[styles.pill, enabled ? styles.pillEnabled : styles.pillDisabled]}>
              <Text
                style={[styles.pillText, enabled ? styles.pillTextEnabled : styles.pillTextDisabled]}
                testID={`capability-state-${canonical.toLowerCase().replaceAll('_', '-')}`}
              >
                {enabled ? 'Enabled' : 'Unavailable'}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.neutral.lightGray,
  },
  rowText: {
    flex: 1,
    paddingRight: theme.spacing.md,
  },
  serviceLabel: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.neutral.charcoal,
  },
  reason: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    marginTop: 2,
  },
  pill: {
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: theme.spacing.sm,
  },
  pillEnabled: {
    backgroundColor: theme.colors.feedback.successLight,
  },
  pillDisabled: {
    backgroundColor: theme.colors.feedback.warningLight,
  },
  pillText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
  },
  pillTextEnabled: {
    color: theme.colors.primary.main,
  },
  pillTextDisabled: {
    color: theme.colors.secondary.dark,
  },
});
