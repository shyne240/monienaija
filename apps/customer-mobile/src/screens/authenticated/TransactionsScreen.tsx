import React, { useEffect, useState } from 'react';
import { FlatList, RefreshControl, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../theme';
import { TransactionRow } from '../../components/TransactionRow';
import { LoadingState } from '../../components/LoadingState';
import { Button } from '../../components/Button';
import { ApiClient } from '../../services/api-client';
import {
  buildSupportContextForTransaction,
  mapTransactionToRow,
  type TransferListItem,
} from '../../services/transfer-view';
import { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Transactions'>;

/**
 * V1-CUSTOMER-07 — reads from the unified, authenticated, ownership-scoped
 * `GET /customers/me/transactions` projection, which merges all V1
 * customer-visible flows (Wallet→Wallet, Wallet→Cash, Cash→Wallet,
 * Cash→Cash, and wallet funding) from the authoritative ledger/transfer/
 * funding/cash-to-cash tables. The previous version of this screen only
 * called the Wallet→Wallet-only `GET /customers/me/transfers` endpoint, so
 * Cash→Wallet, Wallet→Cash, Cash→Cash, and funding activity never
 * appeared here even though the backend already supported them.
 */
export const TransactionsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const [transactions, setTransactions] = useState<TransferListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const fetchTransactions = async (pageNum: number, reset = false) => {
    try {
      const result = await ApiClient.get<{ items: TransferListItem[] }>(
        `/customers/me/transactions?page=${pageNum}&limit=15`,
      );
      const items = result.items || [];
      if (reset) {
        setTransactions(items);
      } else {
        setTransactions((prev) => [...prev, ...items]);
      }
      setHasMore(items.length === 15);
      setPage(pageNum);
      setError('');
    } catch {
      setError('Failed to load transactions.');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchTransactions(1, true);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchTransactions(1, true);
  };

  const handleLoadMore = () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    fetchTransactions(page + 1);
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
        keyExtractor={(item) => item.id ?? item.transferId}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[theme.colors.primary.main]} />
        }
        renderItem={({ item }) => {
          const row = mapTransactionToRow(item);
          return (
            <TransactionRow
              amountMinor={row.amountMinor}
              createdAt={row.createdAt}
              currency={row.currency}
              id={row.id}
              narration={row.narration}
              reference={row.reference}
              sign={row.sign}
              status={row.status}
              onGetHelp={() => {
                const context = buildSupportContextForTransaction(item);
                navigation.navigate('CreateSupportTicket', context);
              }}
            />
          );
        }}
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
