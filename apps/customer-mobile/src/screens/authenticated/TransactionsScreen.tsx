import React, { useEffect, useState } from 'react';
import { FlatList, RefreshControl, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../theme';
import { TransactionRow } from '../../components/TransactionRow';
import { LoadingState } from '../../components/LoadingState';
import { Button } from '../../components/Button';
import { useAuthStore } from '../../store/auth-store';
import { ApiClient } from '../../services/api-client';

interface Wallet {
  id: string;
  type: string;
}

interface Transaction {
  id: string;
  narration: string;
  reference: string;
  amountMinor: number;
  currency: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER_IN' | 'TRANSFER_OUT';
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'REVERSED' | 'CANCELLED';
  createdAt: string;
}

export const TransactionsScreen: React.FC = () => {
  const { customerId } = useAuthStore();
  const [walletId, setWalletId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const fetchWallet = async () => {
    if (!customerId) return;
    try {
      const wallets = await ApiClient.get<Wallet[]>(`/customers/${customerId}/wallets`);
      const primary = wallets.find((w) => w.type === 'PRIMARY') || wallets[0];
      if (primary) {
        setWalletId(primary.id);
        fetchTransactions(primary.id, 1, true);
      } else {
        setIsLoading(false);
      }
    } catch {
      setError('Failed to load wallet information.');
      setIsLoading(false);
    }
  };

  const fetchTransactions = async (wId: string, pageNum: number, reset = false) => {
    try {
      const result = await ApiClient.get<{ items: Transaction[] }>(
        `/wallets/${wId}/transactions?page=${pageNum}&limit=15`,
      );
      const items = result.items || [];
      if (reset) {
        setTransactions(items);
      } else {
        setTransactions((prev) => [...prev, ...items]);
      }
      setHasMore(items.length === 15);
      setPage(pageNum);
    } catch {
      setError('Failed to load transactions.');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchWallet();
  }, [customerId]);

  const handleRefresh = () => {
    if (!walletId) return;
    setRefreshing(true);
    fetchTransactions(walletId, 1, true);
  };

  const handleLoadMore = () => {
    if (!walletId || isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    fetchTransactions(walletId, page + 1);
  };

  if (isLoading) {
    return <LoadingState message="Fetching transaction history..." />;
  }

  return (
    <SafeAreaView style={styles.container}>
      {!!error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={transactions}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[theme.colors.primary.main]} />
        }
        renderItem={({ item }) => (
          <TransactionRow
            amountMinor={item.amountMinor}
            createdAt={item.createdAt}
            currency={item.currency}
            id={item.id}
            narration={item.narration}
            reference={item.reference}
            status={item.status}
            type={item.type}
          />
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No transaction records found.</Text>
          </View>
        }
        ListFooterComponent={
          hasMore && transactions.length > 0 ? (
            <Button
              loading={isLoadingMore}
              label="Load More Transactions"
              style={styles.loadMoreBtn}
              variant="outline"
              onPress={handleLoadMore}
            />
          ) : null
        }
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.neutral.offWhite,
  },
  listContent: {
    padding: theme.spacing.lg,
  },
  errorBanner: {
    backgroundColor: theme.colors.feedback.errorLight,
    padding: theme.spacing.md,
    margin: theme.spacing.lg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.feedback.error,
  },
  errorText: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.xs,
  },
  emptyContainer: {
    paddingVertical: theme.spacing.huge,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: theme.typography.sizes.base,
    color: theme.colors.neutral.gray,
  },
  loadMoreBtn: {
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.xl,
  },
});
