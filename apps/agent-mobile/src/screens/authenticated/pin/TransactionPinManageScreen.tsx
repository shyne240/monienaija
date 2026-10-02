import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';

import { theme } from '../../../theme';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import {
  describeApiError,
  getAgentTransactionPinStatus,
  type AgentTransactionPinStatus,
} from '../../../services/agent-api';
import { useAuthStore } from '../../../store/auth-store';
import type { RootStackParamList } from '../../../navigation/types';

/**
 * Agent Transaction PIN Management Screen (V1-AGENT-MOBILE-10 / PIN-1..6).
 *
 * Displays the authoritative PIN status from GET /agents/me/transaction-pin.
 * Provides entry points for setting a new PIN, rotating an existing PIN, or recovering
 * from a locked PIN state.
 *
 * Ephemeral credential rule: Raw PIN values and hashes are never stored or displayed.
 */
export const TransactionPinManageScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { agentId } = useAuthStore();

  const statusQuery = useQuery<AgentTransactionPinStatus, unknown>({
    queryKey: ['agent-transaction-pin-status', agentId],
    queryFn: getAgentTransactionPinStatus,
    enabled: !!agentId,
    staleTime: 10_000,
  });

  const pinStatus = statusQuery.data;
  const isRefreshing = statusQuery.isRefetching;

  const handleRefresh = () => {
    void statusQuery.refetch();
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
    >
      <Text style={styles.title}>Agent Transaction PIN</Text>
      <Text style={styles.helper}>
        Your Transaction PIN is a dedicated financial authorization credential used to secure
        agent operations such as Cash→Wallet and Cash→Cash.
      </Text>

      {statusQuery.isLoading ? (
        <Card style={styles.card}>
          <Text style={styles.muted} testID="pin-status-loading">Loading PIN status…</Text>
        </Card>
      ) : statusQuery.isError ? (
        <Card style={styles.card}>
          <Text style={styles.errorText} testID="pin-status-error">
            {describeApiError(statusQuery.error)}
          </Text>
          <Button label="Retry" variant="outline" onPress={handleRefresh} testID="pin-status-retry" />
        </Card>
      ) : pinStatus ? (
        <>
          <Card style={styles.card} testID="pin-status-card">
            <View style={styles.statusRow}>
              <Text style={styles.label}>PIN Status</Text>
              <View
                style={[
                  styles.badge,
                  pinStatus.status === 'ACTIVE'
                    ? styles.badgeActive
                    : pinStatus.status === 'LOCKED'
                      ? styles.badgeLocked
                      : styles.badgeNotSet,
                ]}
              >
                <Text style={styles.badgeText} testID="pin-status-badge">
                  {pinStatus.status}
                </Text>
              </View>
            </View>

            {pinStatus.status === 'ACTIVE' && (
              <>
                {pinStatus.pinVersion != null && (
                  <View style={styles.infoRow}>
                    <Text style={styles.label}>Version</Text>
                    <Text style={styles.value} testID="pin-version">
                      {pinStatus.pinVersion}
                    </Text>
                  </View>
                )}
                {pinStatus.lastChangedAt && (
                  <View style={styles.infoRow}>
                    <Text style={styles.label}>Last updated</Text>
                    <Text style={styles.value} testID="pin-last-changed">
                      {formatDate(pinStatus.lastChangedAt)}
                    </Text>
                  </View>
                )}
                <Text style={styles.explanation}>
                  Your Transaction PIN is active and protecting your account. You will be prompted
                  for this PIN when authorizing transactions.
                </Text>
              </>
            )}

            {pinStatus.status === 'NOT_SET' && (
              <Text style={styles.explanation}>
                No Transaction PIN is currently configured. You must set a Transaction PIN before
                you can perform Cash→Wallet or Cash→Cash transactions.
              </Text>
            )}

            {pinStatus.status === 'LOCKED' && (
              <View style={styles.lockedContainer} testID="pin-locked-card">
                <Text style={styles.lockedTitle}>Transaction PIN is Locked</Text>
                <Text style={styles.lockedNote}>
                  {pinStatus.lockReason || 'Maximum failed PIN attempts reached (5 attempts).'}
                </Text>
                <Text style={styles.lockedInstruction}>
                  To restore transaction authorization, set a new Transaction PIN below or contact
                  your administrator support.
                </Text>
              </View>
            )}
          </Card>

          {/* Action Buttons based on authoritative server status */}
          {pinStatus.status === 'NOT_SET' && (
            <Button
              label="Set Transaction PIN"
              onPress={() => navigation.navigate('SetTransactionPin', { mode: 'CREATE' })}
              testID="pin-action-create"
            />
          )}

          {pinStatus.status === 'ACTIVE' && (
            <Button
              label="Change Transaction PIN"
              variant="outline"
              onPress={() => navigation.navigate('SetTransactionPin', { mode: 'ROTATE' })}
              testID="pin-action-rotate"
            />
          )}

          {pinStatus.status === 'LOCKED' && (
            <Button
              label="Reset Transaction PIN"
              onPress={() => navigation.navigate('SetTransactionPin', { mode: 'CREATE' })}
              testID="pin-action-reset"
            />
          )}
        </>
      ) : null}
    </ScrollView>
  );
};

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: theme.spacing.xl,
    paddingBottom: theme.spacing.xxl,
    backgroundColor: theme.colors.neutral.offWhite,
    gap: theme.spacing.md,
  },
  title: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
  },
  helper: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    lineHeight: 20,
  },
  card: {
    gap: theme.spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
  },
  label: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
  },
  value: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.charcoal,
  },
  badge: {
    borderRadius: 12,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
  },
  badgeActive: {
    backgroundColor: theme.colors.feedback.successLight,
  },
  badgeNotSet: {
    backgroundColor: theme.colors.feedback.warningLight,
  },
  badgeLocked: {
    backgroundColor: theme.colors.feedback.errorLight,
  },
  badgeText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
  },
  explanation: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.charcoal,
    lineHeight: 20,
    marginTop: theme.spacing.xs,
  },
  lockedContainer: {
    backgroundColor: theme.colors.feedback.errorLight,
    borderRadius: 8,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  lockedTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.feedback.error,
  },
  lockedNote: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.charcoal,
    lineHeight: 18,
  },
  lockedInstruction: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    lineHeight: 18,
  },
  muted: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
  },
  errorText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.feedback.error,
    fontWeight: theme.typography.weights.medium,
    marginBottom: theme.spacing.sm,
  },
});
