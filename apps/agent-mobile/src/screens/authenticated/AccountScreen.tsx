import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { theme } from '../../theme';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { useAuthStore } from '../../store/auth-store';

/**
 * Agent Account foundation placeholder (spec §8): session identity + logout.
 * Agent class, PIN management and credential surfaces arrive in later phases.
 */
export const AccountScreen: React.FC = () => {
  const { agentId, logout, isLoading } = useAuthStore();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Signed-in Agent</Text>
        <Text style={styles.value} testID="account-agent-id">{agentId ?? '—'}</Text>
        <Text style={styles.helper}>
          Agent class, security settings (transaction PIN) and credential management will be
          available here in a later phase.
        </Text>
      </Card>

      <Button
        loading={isLoading}
        label="Log Out"
        variant="outline"
        onPress={logout}
        testID="account-logout"
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: theme.spacing.xl,
    backgroundColor: theme.colors.neutral.offWhite,
  },
  card: {
    marginBottom: theme.spacing.xl,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.primary.main,
    marginBottom: theme.spacing.sm,
  },
  value: {
    fontSize: theme.typography.sizes.sm,
    fontFamily: 'monospace' as never,
    color: theme.colors.neutral.charcoal,
    marginBottom: theme.spacing.md,
  },
  helper: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    lineHeight: 20,
  },
});
