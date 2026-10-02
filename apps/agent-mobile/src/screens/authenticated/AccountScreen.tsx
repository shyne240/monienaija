import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';

import { theme } from '../../theme';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { CapabilitiesList } from '../../components/CapabilitiesList';
import {
  describeApiError,
  getAgentCapabilities,
  getAgentOutlets,
  getAgentProfile,
  getAgentReceivingNumber,
  getAgentTerminals,
  getAgentTransactionPinStatus,
  type AgentOutlet,
  type AgentTerminal,
} from '../../services/agent-api';
import { useAuthStore } from '../../store/auth-store';
import type { RootStackParamList } from '../../navigation/types';

/**
 * Agent Account (V1-AGENT-MOBILE-02 / V1-AGENT-MOBILE-10 / V1-AGENT-MOBILE-11):
 * profile, class, receiving number, transaction PIN status & management,
 * support access, and outlets/terminals.
 * No raw credentials, secrets, or PIN values are ever displayed.
 */
export const AccountScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { agentId, logout, isLoading: isLoggingOut } = useAuthStore();

  const profileQuery = useQuery({
    queryKey: ['agent-profile', agentId],
    queryFn: getAgentProfile,
    enabled: !!agentId,
    staleTime: 30_000,
  });
  const pinStatusQuery = useQuery({
    queryKey: ['agent-transaction-pin-status', agentId],
    queryFn: getAgentTransactionPinStatus,
    enabled: !!agentId,
    staleTime: 10_000,
  });
  const receivingQuery = useQuery({
    queryKey: ['agent-receiving-number', agentId],
    queryFn: getAgentReceivingNumber,
    enabled: !!agentId,
    staleTime: 30_000,
  });
  const capabilitiesQuery = useQuery({
    queryKey: ['agent-capabilities', agentId],
    queryFn: getAgentCapabilities,
    enabled: !!agentId,
    staleTime: 30_000,
  });
  const outletsQuery = useQuery({
    queryKey: ['agent-outlets', agentId],
    queryFn: getAgentOutlets,
    enabled: !!agentId,
    staleTime: 60_000,
  });
  const terminalsQuery = useQuery({
    queryKey: ['agent-terminals', agentId],
    queryFn: getAgentTerminals,
    enabled: !!agentId,
    staleTime: 60_000,
  });

  const profile = profileQuery.data;
  const pinStatus = pinStatusQuery.data;
  const receiving = receivingQuery.data;

  const outletLabelById = React.useMemo(() => {
    const map = new Map<string, string>();
    outletsQuery.data?.forEach((o) => map.set(o.id, o.displayName || o.name));
    return map;
  }, [outletsQuery.data]);

  const isRefreshing =
    profileQuery.isRefetching ||
    pinStatusQuery.isRefetching ||
    receivingQuery.isRefetching ||
    capabilitiesQuery.isRefetching ||
    outletsQuery.isRefetching ||
    terminalsQuery.isRefetching;

  const refreshAll = () => {
    void profileQuery.refetch();
    void pinStatusQuery.refetch();
    void receivingQuery.refetch();
    void capabilitiesQuery.refetch();
    void outletsQuery.refetch();
    void terminalsQuery.refetch();
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refreshAll} />}
    >
      {/* Agent profile */}
      <Card style={styles.card} testID="account-profile-card">
        <Text style={styles.sectionTitle}>Agent Profile</Text>
        {profileQuery.isLoading ? (
          <Text style={styles.muted} testID="account-profile-loading">Loading profile...</Text>
        ) : profileQuery.isError ? (
          <View>
            <Text style={styles.errorText} testID="account-profile-error">
              {describeApiError(profileQuery.error)}
            </Text>
            <Button label="Retry" variant="outline" onPress={() => profileQuery.refetch()} testID="account-profile-retry" />
          </View>
        ) : (
          <>
            <InfoRow label="Agent ID" value={agentId ?? '—'} selectable />
            <InfoRow label="Reference" value={profile?.reference ?? '—'} testID="account-reference" />
            <InfoRow label="Status" value={profile?.status ?? '—'} testID="account-status" />
            {profile?.agentClass && (
              <InfoRow
                label="Agent class"
                value={`${profile.agentClass.name} (${profile.agentClass.code})`}
                testID="account-class"
              />
            )}
            <InfoRow label="Agent since" value={formatDate(profile?.createdAt)} />
          </>
        )}
      </Card>

      {/* Transaction PIN (V1-AGENT-MOBILE-10) */}
      <Card style={styles.card} testID="account-pin-card">
        <Text style={styles.sectionTitle}>Agent Transaction PIN</Text>
        {pinStatusQuery.isLoading ? (
          <Text style={styles.muted} testID="account-pin-loading">Loading PIN status...</Text>
        ) : pinStatusQuery.isError ? (
          <View>
            <Text style={styles.errorText} testID="account-pin-error">
              {describeApiError(pinStatusQuery.error)}
            </Text>
            <Button label="Retry" variant="outline" onPress={() => pinStatusQuery.refetch()} testID="account-pin-retry" />
          </View>
        ) : (
          <>
            <View style={styles.pinStatusRow}>
              <Text style={styles.infoLabel}>PIN Status</Text>
              <View
                style={[
                  styles.pinBadge,
                  pinStatus?.status === 'ACTIVE'
                    ? styles.pinBadgeActive
                    : pinStatus?.status === 'LOCKED'
                      ? styles.pinBadgeLocked
                      : styles.pinBadgeNotSet,
                ]}
              >
                <Text style={styles.pinBadgeText} testID="account-pin-status">
                  {pinStatus?.status ?? 'NOT_SET'}
                </Text>
              </View>
            </View>
            <Text style={styles.helper}>
              Required to authorize Cash→Wallet and Cash→Cash transactions.
            </Text>
            <Button
              label="Manage Transaction PIN"
              variant="outline"
              onPress={() => navigation.navigate('TransactionPinManage')}
              testID="nav-transaction-pin"
            />
          </>
        )}
      </Card>

      {/* Help & Support (V1-AGENT-MOBILE-11) */}
      <Card style={styles.card} testID="account-support-card">
        <Text style={styles.sectionTitle}>Help & Support</Text>
        <Text style={styles.helper}>
          Have an issue with your account, terminals, or transactions? Contact MonieNaija operations support.
        </Text>
        <Button
          label="Contact Support"
          variant="outline"
          onPress={() => navigation.navigate('Support')}
          testID="nav-support"
        />
      </Card>

      {/* Receiving number */}
      <Card style={styles.card} testID="account-receiving-card">
        <Text style={styles.sectionTitle}>Receiving Number</Text>
        {receivingQuery.isLoading ? (
          <Text style={styles.muted}>Loading receiving number...</Text>
        ) : receivingQuery.isError ? (
          <View>
            <Text style={styles.errorText}>{describeApiError(receivingQuery.error)}</Text>
            <Button label="Retry" variant="outline" onPress={() => receivingQuery.refetch()} testID="account-receiving-retry" />
          </View>
        ) : receiving ? (
          <View>
            <Text selectable style={styles.receivingNumber} testID="account-receiving-number">
              {receiving.receivingNumber}
            </Text>
            <Text style={styles.muted}>
              Status: {receiving.status} · assigned {formatDate(receiving.assignedAt)}. Long-press to copy.
            </Text>
          </View>
        ) : (
          <Text style={styles.muted} testID="account-receiving-none">
            No receiving number is assigned to this agent yet.
          </Text>
        )}
      </Card>

      {/* Capabilities summary (fail-closed; backend authoritative) */}
      <Card style={styles.card} testID="account-capabilities-card">
        <Text style={styles.sectionTitle}>Enabled Services</Text>
        {capabilitiesQuery.isLoading ? (
          <Text style={styles.muted}>Loading services...</Text>
        ) : capabilitiesQuery.isError ? (
          <View>
            <Text style={styles.errorText}>{describeApiError(capabilitiesQuery.error)}</Text>
            <Button label="Retry" variant="outline" onPress={() => capabilitiesQuery.refetch()} testID="account-capabilities-retry" />
          </View>
        ) : capabilitiesQuery.data ? (
          <CapabilitiesList capabilities={capabilitiesQuery.data} testID="account-capabilities-list" />
        ) : null}
      </Card>

      {/* Outlets (read-only list; no management operations exist) */}
      <Card style={styles.card} testID="account-outlets-card">
        <Text style={styles.sectionTitle}>Outlets</Text>
        {outletsQuery.isLoading ? (
          <Text style={styles.muted}>Loading outlets...</Text>
        ) : outletsQuery.isError ? (
          <View>
            <Text style={styles.errorText}>{describeApiError(outletsQuery.error)}</Text>
            <Button label="Retry" variant="outline" onPress={() => outletsQuery.refetch()} testID="account-outlets-retry" />
          </View>
        ) : !outletsQuery.data || outletsQuery.data.length === 0 ? (
          <Text style={styles.muted} testID="account-outlets-empty">No outlets registered for this agent.</Text>
        ) : (
          outletsQuery.data.map((outlet, idx) => (
            <OutletRow key={outlet.id} outlet={outlet} last={idx === outletsQuery.data!.length - 1} />
          ))
        )}
      </Card>

      {/* Terminals (read-only list; no management operations exist) */}
      <Card style={styles.card} testID="account-terminals-card">
        <Text style={styles.sectionTitle}>Terminals</Text>
        {terminalsQuery.isLoading ? (
          <Text style={styles.muted}>Loading terminals...</Text>
        ) : terminalsQuery.isError ? (
          <View>
            <Text style={styles.errorText}>{describeApiError(terminalsQuery.error)}</Text>
            <Button label="Retry" variant="outline" onPress={() => terminalsQuery.refetch()} testID="account-terminals-retry" />
          </View>
        ) : !terminalsQuery.data || terminalsQuery.data.length === 0 ? (
          <Text style={styles.muted} testID="account-terminals-empty">No terminals registered for this agent.</Text>
        ) : (
          terminalsQuery.data.map((terminal, idx) => (
            <TerminalRow
              key={terminal.id}
              terminal={terminal}
              outletName={terminal.outletId ? outletLabelById.get(terminal.outletId) ?? null : null}
              last={idx === terminalsQuery.data!.length - 1}
            />
          ))
        )}
      </Card>

      <Button
        loading={isLoggingOut}
        label="Log Out"
        variant="outline"
        onPress={logout}
        testID="account-logout"
      />
    </ScrollView>
  );
};

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' });
}

interface InfoRowProps {
  label: string;
  value: string;
  selectable?: boolean;
  testID?: string;
}

const InfoRow: React.FC<InfoRowProps> = ({ label, value, selectable, testID }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text selectable={selectable} style={styles.infoValue} testID={testID}>
      {value}
    </Text>
  </View>
);

const OutletRow: React.FC<{ outlet: AgentOutlet; last: boolean }> = ({ outlet, last }) => (
  <View style={[styles.listRow, last && styles.listRowLast]} testID={`outlet-${outlet.id}`}>
    <View style={styles.listRowText}>
      <Text style={styles.listRowTitle}>{outlet.displayName || outlet.name}</Text>
      <Text style={styles.listRowMeta}>
        {outlet.code}
        {outlet.addressLine ? ` · ${outlet.addressLine}` : ''}
        {outlet.city ? `, ${outlet.city}` : ''}
        {outlet.state ? `, ${outlet.state}` : ''}
      </Text>
    </View>
    <Text style={styles.listRowStatus}>{outlet.status}</Text>
  </View>
);

interface TerminalRowProps {
  terminal: AgentTerminal;
  outletName: string | null;
  last: boolean;
}

const TerminalRow: React.FC<{ terminal: AgentTerminal; outletName: string | null; last: boolean }> = ({
  terminal,
  outletName,
  last,
}) => (
  <View style={[styles.listRow, last && styles.listRowLast]} testID={`terminal-${terminal.id}`}>
    <View style={styles.listRowText}>
      <Text style={styles.listRowTitle}>{terminal.label || terminal.code}</Text>
      <Text style={styles.listRowMeta}>
        {terminal.code}
        {outletName ? ` · ${outletName}` : ''}
        {terminal.serialNumber ? `\nS/N ${terminal.serialNumber}` : ''}
      </Text>
    </View>
    <Text style={styles.listRowStatus}>{terminal.status}</Text>
  </View>
);

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
  sectionTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.primary.main,
    marginBottom: theme.spacing.sm,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
  },
  infoLabel: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
  },
  infoValue: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.neutral.charcoal,
    flexShrink: 1,
    textAlign: 'right',
  },
  pinStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
  },
  pinBadge: {
    borderRadius: 12,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
  },
  pinBadgeActive: {
    backgroundColor: theme.colors.feedback.successLight,
  },
  pinBadgeNotSet: {
    backgroundColor: theme.colors.feedback.warningLight,
  },
  pinBadgeLocked: {
    backgroundColor: theme.colors.feedback.errorLight,
  },
  pinBadgeText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
  },
  helper: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    marginVertical: theme.spacing.xs,
  },
  receivingNumber: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 2,
    color: theme.colors.neutral.charcoal,
    fontVariant: ['tabular-nums'],
    marginBottom: theme.spacing.sm,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.neutral.lightGray,
  },
  listRowLast: {
    borderBottomWidth: 0,
  },
  listRowText: {
    flex: 1,
    paddingRight: theme.spacing.md,
  },
  listRowTitle: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.neutral.charcoal,
  },
  listRowMeta: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    marginTop: 2,
  },
  listRowStatus: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
    backgroundColor: theme.colors.feedback.successLight,
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: theme.spacing.sm,
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
