import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';

import { theme } from '../../theme';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { getAgentMe } from '../../services/agent-api';
import { useAuthStore } from '../../store/auth-store';

/**
 * Agent Home foundation (spec §8/§9): fetches GET /agents/me to establish the
 * authenticated Agent context (identity/reference/status) used by later phases.
 * Financial position, capabilities, receiving number and all money actions are
 * intentionally NOT wired here — later phases populate them.
 */
export const HomeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { agentId, logout } = useAuthStore();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['agent-me', agentId],
    queryFn: getAgentMe,
    enabled: !!agentId,
  });

  const goTo = useCallback(
    (route: string) => () => navigation.navigate(route),
    [navigation],
  );

  if (isLoading) {
    return <LoadingState message="Loading your Agent profile..." />;
  }

  if (isError) {
    return (
      <ErrorState
        title="Could not load Agent profile"
        message={error instanceof Error ? error.message : 'Please try again'}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card style={styles.identityCard} testID="agent-identity-card">
        <Text style={styles.sectionTitle}>Agent Profile</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Reference</Text>
          <Text style={styles.rowValue} testID="agent-reference">{data?.reference ?? '—'}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Status</Text>
          <View
            style={[
              styles.statusBadge,
              data?.status === 'ACTIVE' ? styles.statusActive : styles.statusInactive,
            ]}
          >
            <Text style={styles.statusText} testID="agent-status">{data?.status ?? '—'}</Text>
          </View>
        </View>
      </Card>

      <Card style={styles.card} testID="foundation-notice-card">
        <Text style={styles.sectionTitle}>Agent Mobile — Foundation</Text>
        <Text style={styles.bodyText}>
          This build contains the Agent foundation: secure sign-in, mandatory password rotation
          and your Agent identity. Balance, agent services (Cash→Wallet, Wallet→Cash,
          Cash→Cash), history, outlets and terminals unlock in later phases.
        </Text>
      </Card>

      <View style={styles.shortcuts}>
        <Button
          label="Transactions (upcoming)"
          variant="outline"
          onPress={goTo('Transactions')}
          testID="nav-transactions"
        />
        <Button
          label="History (upcoming)"
          variant="outline"
          onPress={goTo('History')}
          testID="nav-history"
        />
        <Button
          label="Agent Account"
          variant="secondary"
          onPress={goTo('Account')}
          testID="nav-account"
        />
      </View>

      <Button label="Log Out" variant="text" onPress={logout} testID="logout-button" />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: theme.spacing.xl,
    backgroundColor: theme.colors.neutral.offWhite,
  },
  identityCard: {
    marginBottom: theme.spacing.lg,
  },
  card: {
    marginBottom: theme.spacing.lg,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.primary.main,
    marginBottom: theme.spacing.md,
  },
  bodyText: {
    fontSize: theme.typography.sizes.base,
    color: theme.colors.neutral.slate,
    lineHeight: 22,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
  },
  rowLabel: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
  },
  rowValue: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.neutral.charcoal,
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
  shortcuts: {
    gap: theme.spacing.md,
    marginBottom: theme.spacing.xl,
  },
});
