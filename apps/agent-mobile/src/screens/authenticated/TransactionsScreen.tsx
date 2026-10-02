import React, { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { TransactionRow } from '../../components/TransactionRow';
import {
  describeApiError,
  getAgentTransactions,
  type AgentHistoryItem,
  type AgentHistoryType,
} from '../../services/agent-api';
import { useAuthStore } from '../../store/auth-store';
import type { RootStackParamList } from '../../navigation/types';

/**
 * Unified Agent transaction history (V1-AGENT-MOBILE-06).
 * GET /agents/me/transactions is the SOLE source (no second history system,
 * no invented detail endpoint, no polling — pull-to-refresh + load-more only).
 * Bounded honesty: renders exactly what the server page returns.
 */

const PAGE_LIMIT = 20;

const FILTERS: ReadonlyArray<{ label: string; type: AgentHistoryType | undefined }> = [
  { label: 'All', type: undefined },
  { label: 'Cash→Wallet', type: 'CASH_IN' },
  { label: 'Wallet→Cash', type: 'CASH_OUT' },
  { label: 'Cash→Cash', type: 'CASH_TO_CASH' },
  { label: 'Funding', type: 'AGENT_FUNDING' },
  { label: 'Defunding', type: 'AGENT_DEFUNDING' },
];

export const TransactionsScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { agentId } = useAuthStore();
  const [activeType, setActiveType] = useState<AgentHistoryType | undefined>(undefined);
  const [pageLimit, setPageLimit] = useState(PAGE_LIMIT);

  const historyQuery = useQuery({
    queryKey: ['agent-transactions', agentId, activeType ?? 'ALL', pageLimit],
    queryFn: () =>
      getAgentTransactions({ page: 1, limit: pageLimit, type: activeType }),
    enabled: !!agentId,
    staleTime: 30_000,
  });

  const items = useMemo(() => historyQuery.data?.items ?? [], [historyQuery.data]);
  const pagination = historyQuery.data?.pagination;

  const loadMore = () => {
    if (pagination?.hasNextPage) {
      setPageLimit((n) => n + PAGE_LIMIT);
    }
  };

  const selectFilter = (type: AgentHistoryType | undefined) => {
    setActiveType(type);
    setPageLimit(PAGE_LIMIT);
  };

  const openReceipt = (item: AgentHistoryItem) => {
    navigation.navigate('TransactionReceipt', { itemId: item.id, filter: activeType });
  };

  const listHeader = (
    <View>
      <Text style={styles.title}>Transaction History</Text>
      <Text style={styles.helper}>
        Server-recorded entries across all your Agent services. Pull to refresh.
      </Text>
      <View style={styles.filters} testID="history-filters">
        {FILTERS.map((filter) => {
          const active = activeType === filter.type;
          return (
            <TouchableOpacity
              key={filter.label}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => selectFilter(filter.type)}
              accessibilityRole="button"
              testID={`filter-${filter.type ?? 'ALL'}`.toLowerCase()}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>{filter.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  if (historyQuery.isLoading) {
    return <LoadingState message="Loading Agent transaction history..." />;
  }

  if (historyQuery.isError) {
    return (
      <ErrorState
        title="Could not load transaction history"
        message={describeApiError(historyQuery.error)}
        onRetry={() => historyQuery.refetch()}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList<AgentHistoryItem>
        data={items}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={listHeader}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <TransactionRow item={item} onPress={() => openReceipt(item)} />}
        refreshControl={
          <RefreshControl refreshing={historyQuery.isRefetching} onRefresh={() => historyQuery.refetch()} />
        }
        ListEmptyComponent={
          <View style={styles.empty} testID="history-empty">
            <Text style={styles.emptyTitle}>No transactions yet</Text>
            <Text style={styles.emptyText}>
              {activeType
                ? 'No transactions of this type yet. Try a different filter.'
                : 'Your executed Agent transactions will appear here.'}
            </Text>
          </View>
        }
        ListFooterComponent={
          pagination?.hasNextPage ? (
            <Button label="Load more" variant="outline" onPress={loadMore} testID="history-load-more" />
          ) : null
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.neutral.offWhite },
  list: {
    padding: theme.spacing.xl,
    paddingBottom: theme.spacing.xxl,
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
    marginTop: 4,
    marginBottom: theme.spacing.md,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  filterChip: {
    borderRadius: 14,
    paddingVertical: 4,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.neutral.lightGray,
  },
  filterChipActive: {
    backgroundColor: theme.colors.primary.main,
  },
  filterText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.charcoal,
  },
  filterTextActive: {
    color: theme.colors.neutral.white,
  },
  empty: { alignItems: 'center', marginTop: theme.spacing.xxl },
  emptyTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.primary.main,
    marginBottom: theme.spacing.xs,
  },
  emptyText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    textAlign: 'center',
    lineHeight: 20,
  },
});
