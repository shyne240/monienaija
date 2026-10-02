import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';

import { theme } from '../../theme';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { CapabilitiesList } from '../../components/CapabilitiesList';
import {
  describeApiError,
  getAgentCapabilities,
  getAgentFinancialPosition,
  getAgentProfile,
  getAgentReceivingNumber,
} from '../../services/agent-api';
import { formatNairaFromMinor, formatUpdatedAt } from '../../utils/format';
import { useAuthStore } from '../../store/auth-store';

/**
 * Agent Home (V1-AGENT-MOBILE-02): real operating context served by the
 * backend read surface (spec §3/§8). All money comes from server-provided
 * minor units; the client formats but never computes. Financial position and
 * capabilities are independent queries with their own loading/error states so
 * one failing surface never blocks the rest. Pull-to-refresh re-reads the
 * server (the client is never the authority for agent state; §8).
 */
export const HomeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { agentId } = useAuthStore();

  const profileQuery = useQuery({
    queryKey: ['agent-profile', agentId],
    queryFn: getAgentProfile,
    enabled: !!agentId,
    staleTime: 30_000,
  });
  const financialQuery = useQuery({
    queryKey: ['agent-financial-position', agentId],
    queryFn: getAgentFinancialPosition,
    enabled: !!agentId,
    staleTime: 30_000,
  });
  const capabilitiesQuery = useQuery({
    queryKey: ['agent-capabilities', agentId],
    queryFn: getAgentCapabilities,
    enabled: !!agentId,
    staleTime: 30_000,
  });
  const receivingQuery = useQuery({
    queryKey: ['agent-receiving-number', agentId],
    queryFn: getAgentReceivingNumber,
    enabled: !!agentId,
    staleTime: 30_000,
  });

  const profile = profileQuery.data;
  const financial = financialQuery.data;
  const receiving = receivingQuery.data;

  const isRefreshing =
    profileQuery.isRefetching ||
    financialQuery.isRefetching ||
    capabilitiesQuery.isRefetching ||
    receivingQuery.isRefetching;

  const refreshAll = () => {
    void profileQuery.refetch();
    void financialQuery.refetch();
    void capabilitiesQuery.refetch();
    void receivingQuery.refetch();
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refreshAll} />}
    >
      {/* Identity + class (GET /agents/me/profile) */}
      <Card style={styles.card} testID="agent-identity-card">
        {profileQuery.isLoading ? (
          <Text style={styles.muted} testID="identity-loading">Loading Agent profile...</Text>
        ) : profileQuery.isError ? (
          <View>
            <Text style={styles.errorText} testID="identity-error">
              {describeApiError(profileQuery.error)}
            </Text>
            <Button label="Retry" variant="outline" onPress={() => profileQuery.refetch()} testID="identity-retry" />
          </View>
        ) : (
          <>
            <View style={styles.headerRow}>
              <View style={styles.headerText}>
                <Text style={styles.sectionTitle}>Agent</Text>
                <Text style={styles.reference} testID="agent-reference">{profile?.reference}</Text>
                {profile?.agentClass && (
                  <Text style={styles.classText} testID="agent-class">
                    {profile.agentClass.name} · Class {profile.agentClass.code}
                  </Text>
                )}
              </View>
              <View
                style={[styles.statusBadge, profile?.status === 'ACTIVE' ? styles.statusActive : styles.statusInactive]}
              >
                <Text style={styles.statusText} testID="agent-status">{profile?.status ?? '—'}</Text>
              </View>
            </View>
          </>
        )}
      </Card>

      {/* Financial position (GET /agents/me/financial-position) */}
      <Card style={styles.card} testID="financial-position-card">
        <Text style={styles.sectionTitle}>Available Balance</Text>
        {financialQuery.isLoading ? (
          <Text style={styles.muted} testID="financial-loading">Loading balance...</Text>
        ) : financialQuery.isError ? (
          <View>
            <Text style={styles.errorText} testID="financial-error">
              {describeApiError(financialQuery.error)}
            </Text>
            <Button label="Retry" variant="outline" onPress={() => financialQuery.refetch()} testID="financial-retry" />
          </View>
        ) : financial && !financial.walletExists ? (
          <View testID="financial-no-wallet">
            <Text style={styles.balanceAmount}>No wallet yet</Text>
            <Text style={styles.muted}>Your electronic float wallet has not been provisioned.</Text>
          </View>
        ) : financial ? (
          <View>
            <Text style={styles.balanceAmount} testID="financial-balance">
              {formatNairaFromMinor(financial.balanceMinor)}
            </Text>
            <Text style={styles.balanceMeta} testID="financial-meta">
              {financial.currency}
              {financial.status ? ` — wallet ${financial.status}` : ''}
              {'  ·  '}
              Updated {formatUpdatedAt(financialQuery.dataUpdatedAt)}
            </Text>
          </View>
        ) : null}
      </Card>

      {/* Receiving number (GET /agents/me/receiving-number) */}
      <Card style={styles.card} testID="receiving-number-card">
        <Text style={styles.sectionTitle}>Your Receiving Number</Text>
        {receivingQuery.isLoading ? (
          <Text style={styles.muted} testID="receiving-loading">Loading receiving number...</Text>
        ) : receivingQuery.isError ? (
          <View>
            <Text style={styles.errorText} testID="receiving-error">
              {describeApiError(receivingQuery.error)}
            </Text>
            <Button label="Retry" variant="outline" onPress={() => receivingQuery.refetch()} testID="receiving-retry" />
          </View>
        ) : receiving ? (
          <View>
            <Text selectable style={styles.receivingNumber} testID="receiving-number">
              {receiving.receivingNumber}
            </Text>
            <Text style={styles.muted}>
              Long-press to copy. Customers use this number to send money to you.
            </Text>
          </View>
        ) : (
          <Text style={styles.muted} testID="receiving-none">
            No receiving number is assigned to this agent yet.
          </Text>
        )}
      </Card>

      {/* Capabilities (GET /agents/me/capabilities) — backend-authoritative */}
      <Card style={styles.card} testID="capabilities-card">
        <Text style={styles.sectionTitle}>Agent Services</Text>
        {capabilitiesQuery.isLoading ? (
          <Text style={styles.muted} testID="capabilities-loading">Loading services...</Text>
        ) : capabilitiesQuery.isError ? (
          <View>
            <Text style={styles.errorText} testID="capabilities-error">
              {describeApiError(capabilitiesQuery.error)}
            </Text>
            <Button label="Retry" variant="outline" onPress={() => capabilitiesQuery.refetch()} testID="capabilities-retry" />
          </View>
        ) : capabilitiesQuery.data ? (
          <CapabilitiesList capabilities={capabilitiesQuery.data} testID="capabilities-list" />
        ) : null}
        <Text style={styles.helper}>
          Transaction execution for enabled services unlocks in a later phase of this app build.
        </Text>
      </Card>

      <Button
        label="Agent Account & Outlets"
        variant="secondary"
        onPress={() => navigation.navigate('Account')}
        testID="nav-account"
      />
      <Button
        label="Transactions & History (upcoming)"
        variant="outline"
        onPress={() => navigation.navigate('Transactions')}
        testID="nav-transactions"
      />
      {/* Fail-closed: visible ONLY while the backend permits CASH_IN */}
      {capabilitiesQuery.data?.evaluations.find((e) => e.canonicalService === 'CASH_IN')?.allowed ===
        true && (
        <Button
          label="Cash→Wallet — credit a customer wallet"
          onPress={() => navigation.navigate('CashToWallet')}
          testID="nav-cash-to-wallet"
        />
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: theme.spacing.xl,
    paddingBottom: theme.spacing.xxl,
    backgroundColor: theme.colors.neutral.offWhite,
    gap: theme.spacing.md,
  },
  card: {
    marginBottom: theme.spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
    paddingRight: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.primary.main,
    marginBottom: theme.spacing.sm,
  },
  reference: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.charcoal,
  },
  classText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    marginTop: 2,
  },
  statusBadge: {
    borderRadius: 12,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
  },
  statusActive: {
    backgroundColor: theme.colors.feedback.successLight,
  },
  statusInactive: {
    backgroundColor: theme.colors.feedback.warningLight,
  },
  statusText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
  },
  balanceAmount: {
    fontSize: theme.typography.sizes.xxl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
  },
  balanceMeta: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    marginTop: 4,
  },
  receivingNumber: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 2,
    color: theme.colors.neutral.charcoal,
    fontVariant: ['tabular-nums'],
    marginBottom: theme.spacing.sm,
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
  helper: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.gray,
    marginTop: theme.spacing.sm,
  },
});
