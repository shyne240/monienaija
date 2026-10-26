import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';

import { theme } from '../../theme';
import { AgentReceipt, receiptFromHistoryItem } from '../../components/AgentReceipt';
import type { AgentUnifiedHistoryResponse } from '../../services/agent-api';
import { useAuthStore } from '../../store/auth-store';
import type { RootStackParamList } from '../../navigation/types';

/**
 * History-derived receipt (V1-AGENT-MOBILE-06, RCP-5).
 *
 * NO detail endpoint exists by design (A21 audit) — the receipt renders from
 * the authoritative history row already served to the history list. The row
 * is looked up in the TanStack query cache by its small id (navigation params
 * carry only {itemId, filter}; never payloads/secrets). If the row isn't in
 * cache (e.g. deep link), an honest state explains the path.
 */
export const TransactionReceiptScreen: React.FC = () => {
  const route = useRoute<RouteProp<RootStackParamList, 'TransactionReceipt'>>();
  const { itemId } = route.params;
  const queryClient = useQueryClient();
  const { agentId } = useAuthStore();

  // Search all cached 'agent-transactions' pages (any filter) for this row.
  const cached = findCachedHistoryItem(queryClient, agentId, itemId);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {cached ? (
        <AgentReceipt receipt={receiptFromHistoryItem(cached)} testID="history-receipt" />
      ) : (
        <Text style={styles.missing} testID="history-receipt-missing">
          This receipt is not loaded. Open it from your transaction history.
        </Text>
      )}
    </ScrollView>
  );
};

function findCachedHistoryItem(
  queryClient: ReturnType<typeof useQueryClient>,
  agentId: string | null,
  itemId: string,
): import('../../services/agent-api').AgentHistoryItem | undefined {
  const matches = queryClient.getQueriesData<AgentUnifiedHistoryResponse>({
    queryKey: ['agent-transactions', agentId],
  });
  for (const [, data] of matches) {
    const hit = data?.items.find((i) => i.id === itemId);
    if (hit) return hit;
  }
  return undefined;
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: theme.spacing.xl,
    backgroundColor: theme.colors.neutral.offWhite,
  },
  missing: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: theme.spacing.xxl,
  },
});
