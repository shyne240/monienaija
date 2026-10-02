import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  type AgentOutlet,
  type AgentTerminal,
} from '../../services/agent-api';
import { useAuthStore } from '../../store/auth-store';

/**
 * Agent Account (V1-AGENT-MOBILE-02): profile, class, receiving number, and
 * the minimal V1 outlets/terminals presentation supported by the backend
 * read surface (spec §3). No internal security material, no credentials, no
 * PIN. Outlets/terminals belong here (not a dedicated operational screen)
 * because the backend exposes read-only lists only — no management
 * operations exist to warrant an operations surface (task §6).
 */
export const AccountScreen: React.FC = () => {
  const { agentId, logout, isLoading: isLoggingOut } = useAuthStore();

  const profileQuery = useQuery({
    queryKey: ['agent-profile', agentId],
    queryFn: getAgentProfile,
    enabled: !!agentId,
    staleTime: 30_000,
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
  const receiving = receivingQuery.data;

  const outletLabelById = React.useMemo(() => {
    const map = new Map<string, string>();
    outletsQuery.data?.forEach((o) => map.set(o.id, o.displayName || o.name));
    return map;
  }, [outletsQuery.data]);

  const isRefreshing =
    profileQuery.isRefetching ||
    receivingQuery.isRefetching ||
    capabilitiesQuery.isRefetching ||
    outletsQuery.isRefetching ||
    terminalsQuery.isRefetching;

  const refreshAll = () => {
    void profileQuery.refetch();
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

const TerminalRow: React.FC<TerminalRowProps> = ({ terminal, outletName, last }) => (
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
