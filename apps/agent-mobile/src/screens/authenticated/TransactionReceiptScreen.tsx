import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { AgentReceipt, receiptFromHistoryItem } from '../../components/AgentReceipt';
import {
  describeApiError,
  getAgentTransactions,
  type AgentHistoryItem,
  type AgentUnifiedHistoryResponse,
} from '../../services/agent-api';
import { useAuthStore } from '../../store/auth-store';
import type { RootStackParamList } from '../../navigation/types';

/**
 * History-derived receipt (V1-AGENT-MOBILE-06, RCP-5).
 *
 * NO detail endpoint exists by design (A21 audit) — the receipt renders from
 * the authoritative history row already served to the history list. The row
 * is looked up in the TanStack query cache by its small id (navigation params
 * carry only {itemId, filter}; never payloads/secrets). If the row isn't in
 * cache (e.g. deep link or evicted cache), an honest state explains the path
 * and lets the Agent reload the authoritative history list from the server.
 */
export const TransactionReceiptScreen: React.FC = () => {
  const route = useRoute<RouteProp<RootStackParamList, 'TransactionReceipt'>>();
  const { itemId, filter } = route.params;
  const queryClient = useQueryClient();
  const { agentId } = useAuthStore();
  const [reloadedItem, setReloadedItem] = useState<AgentHistoryItem | null>(null);
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState('');

  // Search all cached 'agent-transactions' pages (any filter) for this row.
  const cached = reloadedItem ?? findCachedHistoryItem(queryClient, agentId, itemId);

  const handleReload = async () => {
    if (!agentId || reloading) return;
    setReloading(true);
    setReloadError('');
    try {
      const MAX_RELOAD_PAGES = 5;
      const PAGE_LIMIT = 100;
      let hit: AgentHistoryItem | undefined;

      for (let page = 1; page <= MAX_RELOAD_PAGES; page += 1) {
        const response = await getAgentTransactions({ page, limit: PAGE_LIMIT, type: filter });
        queryClient.setQueryData(
          page === 1
            ? ['agent-transactions', agentId, filter ?? 'ALL', PAGE_LIMIT]
            : ['agent-transactions', agentId, filter ?? 'ALL', PAGE_LIMIT, page],
          response,
        );
        hit = response.items.find((item) => item.id === itemId);
        if (hit || !response.pagination.hasNextPage) {
          break;
        }
      }

      if (hit) {
        setReloadedItem(hit);
      } else {
        setReloadError('This transaction was not found in your recent history.');
      }
    } catch (err) {
      setReloadError(describeApiError(err));
    } finally {
      setReloading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {cached ? (
        <AgentReceipt receipt={receiptFromHistoryItem(cached)} testID="history-receipt" />
      ) : (
        <View style={styles.missingContainer}>
          <Text style={styles.missing} testID="history-receipt-missing">
            This receipt is not loaded. Open it from your transaction history.
          </Text>
          {!!reloadError && (
            <Text style={styles.errorText} testID="history-receipt-reload-error">
              {reloadError}
            </Text>
          )}
          {!!agentId && (
            <Button
              label={reloading ? 'Reloading…' : 'Reload from transaction history'}
              loading={reloading}
              variant="outline"
              onPress={() => void handleReload()}
              testID="history-receipt-reload"
            />
          )}
        </View>
      )}
    </ScrollView>
  );
};

function findCachedHistoryItem(
  queryClient: ReturnType<typeof useQueryClient>,
  agentId: string | null,
  itemId: string,
): AgentHistoryItem | undefined {
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
  missingContainer: {
    alignItems: 'center',
    gap: theme.spacing.md,
    marginTop: theme.spacing.xxl,
  },
  missing: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.feedback.error,
    textAlign: 'center',
  },
});
