import React, { useEffect, useState } from 'react';
import { FlatList, RefreshControl, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { TransactionRow } from '../../components/TransactionRow';
import { LoadingState } from '../../components/LoadingState';
import { useAuthStore } from '../../store/auth-store';
import { ApiClient } from '../../services/api-client';
import { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

interface Wallet {
  id: string;
  customerId: string;
  type: string;
  currency: string;
  status: string;
  balanceMinor: number;
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

export const HomeScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { customerId, logout } = useAuthStore();

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [error, setError] = useState('');

  const fetchData = async () => {
    if (!customerId) return;
    try {
      setError('');
      // Fetch user's wallets: GET /customers/:id/wallets
      const walletList = await ApiClient.get<Wallet[]>(`/customers/${customerId}/wallets`);
      setWallets(walletList);

      if (walletList.length > 0 && walletList[0]?.id) {
        // Fetch recent transactions for the primary wallet: GET /wallets/:walletId/transactions
        try {
          const txHistory = await ApiClient.get<{ items: Transaction[] }>(
            `/wallets/${walletList[0].id}/transactions?page=1&limit=5`,
          );
          setTransactions(txHistory.items || []);
        } catch {
          // If transaction history fails/empty, fallback gracefully
          setTransactions([]);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch wallet information.');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [customerId]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const handleProvisionWallet = async () => {
    if (!customerId) return;
    setIsProvisioning(true);
    setError('');
    try {
      // POST /customers/:id/wallets
      await ApiClient.post(`/customers/${customerId}/wallets`, {
        type: 'PRIMARY',
        currency: 'NGN',
        status: 'ACTIVE',
        actor: 'Customer Self-Onboarding',
      });
      await fetchData();
    } catch (err: any) {
      setError(err?.message || 'Wallet provisioning failed.');
    } finally {
      setIsProvisioning(false);
    }
  };

  if (isLoading) {
    return <LoadingState message="Fetching your MoneyNaija wallets..." />;
  }

  const primaryWallet = wallets.find((w) => w.type === 'PRIMARY') || wallets[0];
  const balance = primaryWallet ? primaryWallet.balanceMinor / 100 : 0;

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={transactions}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[theme.colors.primary.main]} />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.profileRow}>
              <View>
                <Text style={styles.welcomeText}>Hello,</Text>
                <Text style={styles.customerIdText}>{customerId}</Text>
              </View>
              <Button label="Logout" variant="text" size="small" onPress={logout} />
            </View>

            {!!error && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {!primaryWallet ? (
              <Card variant="flat" style={styles.noWalletCard}>
                <Text style={styles.noWalletTitle}>No Wallets Found</Text>
                <Text style={styles.noWalletDescription}>
                  You do not have an active NGN wallet. Provision a primary wallet to start transacting.
                </Text>
                <Button
                  loading={isProvisioning}
                  label="Provision Primary NGN Wallet"
                  onPress={handleProvisionWallet}
                />
              </Card>
            ) : (
              <Card variant="elevated" style={styles.balanceCard}>
                <Text style={styles.balanceLabel}>Primary NGN Balance</Text>
                <Text style={styles.balanceValue}>
                  ₦
                  {balance.toLocaleString('en-NG', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </Text>
                <Text style={styles.walletIdLabel}>Wallet ID: {primaryWallet.id}</Text>
              </Card>
            )}

            {primaryWallet && (
              <View style={styles.actionGrid}>
                <Button
                  label="Send Money"
                  style={styles.actionBtn}
                  variant="primary"
                  onPress={() => navigation.navigate('SendMoney')}
                />
                <Button
                  label="Fund Wallet"
                  style={styles.actionBtn}
                  variant="outline"
                  onPress={() => navigation.navigate('FundWallet')}
                />
                <Button
                  label="Withdraw"
                  style={styles.actionBtn}
                  variant="outline"
                  onPress={() => navigation.navigate('Withdraw')}
                />
              </View>
            )}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent Transactions</Text>
              <Button
                label="See All"
                variant="text"
                size="small"
                onPress={() => navigation.navigate('Transactions')}
              />
            </View>
          </View>
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
          primaryWallet ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No recent transactions found.</Text>
            </View>
          ) : null
        }
        contentContainerStyle={styles.scrollContent}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.neutral.offWhite,
  },
  scrollContent: {
    padding: theme.spacing.lg,
  },
  header: {
    marginBottom: theme.spacing.md,
  },
  profileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xl,
  },
  welcomeText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
  },
  customerIdText: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
  },
  balanceCard: {
    backgroundColor: theme.colors.primary.main,
    borderRadius: 16,
    padding: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
  },
  balanceLabel: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.secondary.light,
    fontWeight: theme.typography.weights.medium,
    marginBottom: theme.spacing.xs,
  },
  balanceValue: {
    fontSize: theme.typography.sizes.huge,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.white,
    marginBottom: theme.spacing.md,
  },
  walletIdLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.lightGray,
  },
  noWalletCard: {
    alignItems: 'center',
    padding: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
  },
  noWalletTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.charcoal,
    marginBottom: theme.spacing.xs,
  },
  noWalletDescription: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
  },
  actionGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xl,
  },
  actionBtn: {
    flex: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.charcoal,
  },
  emptyContainer: {
    padding: theme.spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.gray,
  },
  errorContainer: {
    backgroundColor: theme.colors.feedback.errorLight,
    padding: theme.spacing.md,
    borderRadius: 8,
    marginBottom: theme.spacing.md,
  },
  errorText: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.xs,
  },
});
