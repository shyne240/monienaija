import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { AmountInput } from '../../components/AmountInput';
import { Card } from '../../components/Card';
import { useAuthStore } from '../../store/auth-store';
import { ApiClient } from '../../services/api-client';
import { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Withdraw'>;

interface Wallet {
  id: string;
  status: string;
  currency: string;
  balanceMinor: number;
}

export const WithdrawScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { customerId } = useAuthStore();

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [amountStr, setAmountStr] = useState('');
  const [amountMinor, setAmountMinor] = useState(0);
  const [bankDetails, setBankDetails] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState('');

  useEffect(() => {
    if (customerId) {
      setIdempotencyKey(`withdraw-${customerId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    }
  }, [customerId]);

  useEffect(() => {
    const fetchWallets = async () => {
      if (!customerId) return;
      try {
        // Customer-scoped wallet listing: the backend only ever returns the caller's own wallets.
        const walletList = await ApiClient.get<Wallet[]>('/wallets');
        setWallets(walletList);
      } catch (err: any) {
        setError('Failed to load your wallet information.');
      }
    };
    fetchWallets();
  }, [customerId]);

  const primaryWallet = wallets.find((w) => w.status === 'ACTIVE') || wallets[0];

  const handleWithdraw = async () => {
    if (!primaryWallet) {
      setError('No active primary wallet found to withdraw from.');
      return;
    }
    if (amountMinor <= 0) {
      setError('Amount must be greater than zero.');
      return;
    }
    if (primaryWallet.balanceMinor < amountMinor) {
      setError('Insufficient funds in wallet.');
      return;
    }
    if (!bankDetails.trim()) {
      setError('Bank Account details are required.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // Step 1: Create the withdrawal request: POST /withdrawals
      const withdrawalResult = await ApiClient.post<{ id: string }>('/withdrawals', {
        walletId: primaryWallet.id,
        amountMinor: String(amountMinor),
        currency: 'NGN',
        reference: idempotencyKey,
        narration: `Withdraw to ${bankDetails.trim()}`,
      }, {
        idempotencyKey,
      });

      // No client-side fulfilment step exists: processing and completion are operational
      // transitions owned by the settlement workflow, so the request stays PENDING.
      if (!withdrawalResult || !withdrawalResult.id) {
        throw new Error('The withdrawal request could not be created.');
      }

      setSuccess(true);
    } catch (err: any) {
      setError(err?.message || 'Withdrawal failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <View style={styles.successContainer}>
        <View style={styles.successContent}>
          <Text style={styles.successIcon}>💸</Text>
          <Text style={styles.successTitle}>Withdrawal Initiated!</Text>
          <Text style={styles.successDescription}>
            ₦
            {parseFloat(amountStr || '0').toLocaleString('en-NG', { minimumFractionDigits: 2 })} is
            being processed for payout to {bankDetails}.
          </Text>
        </View>
        <Button label="Back to Home" style={styles.button} onPress={() => navigation.navigate('Home')} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Withdraw</Text>
          <Text style={styles.subtitle}>Withdraw funds from your MoneyNaija wallet to your bank account</Text>
        </View>

        <Card variant="flat" style={styles.sandboxCard}>
          <Text style={styles.sandboxTitle}>ℹ️ Payout processing</Text>
          <Text style={styles.sandboxText}>
            A withdrawal request is reviewed and processed by MoneyNaija operations before payout. No bank transfer is initiated from this screen.
          </Text>
        </Card>

        {!!error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {primaryWallet && (
          <View style={styles.balanceContainer}>
            <Text style={styles.balanceLabel}>AVAILABLE BALANCE</Text>
            <Text style={styles.balanceValue}>
              ₦{(primaryWallet.balanceMinor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}
            </Text>
          </View>
        )}

        <View style={styles.form}>
          <AmountInput
            error={amountMinor > 0 && primaryWallet && primaryWallet.balanceMinor < amountMinor ? 'Insufficient funds' : undefined}
            label="Amount to Withdraw"
            value={amountStr}
            onChangeValue={(str, minor) => {
              setAmountStr(str);
              setAmountMinor(minor);
              if (error) setError('');
            }}
          />

          <Input
            label="Bank Details (Bank & Account Number)"
            placeholder="e.g. Zenith Bank - 1012345678"
            value={bankDetails}
            onChangeText={(text) => {
              setBankDetails(text);
              if (error) setError('');
            }}
          />

          <Button
            loading={isLoading}
            label="Confirm Withdrawal"
            style={styles.button}
            onPress={handleWithdraw}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.neutral.offWhite,
  },
  scrollContent: {
    flexGrow: 1,
    padding: theme.spacing.xl,
  },
  header: {
    marginBottom: theme.spacing.xl,
  },
  title: {
    fontSize: theme.typography.sizes.xxl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
    marginBottom: theme.spacing.sm,
  },
  subtitle: {
    fontSize: theme.typography.sizes.base,
    color: theme.colors.neutral.slate,
  },
  balanceContainer: {
    backgroundColor: theme.colors.neutral.white,
    padding: theme.spacing.md,
    borderRadius: 8,
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.neutral.lightGray,
  },
  balanceLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    fontWeight: theme.typography.weights.semibold,
  },
  balanceValue: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
    marginTop: 2,
  },
  form: {
    width: '100%',
  },
  button: {
    marginTop: theme.spacing.md,
  },
  errorBanner: {
    backgroundColor: theme.colors.feedback.errorLight,
    padding: theme.spacing.md,
    borderRadius: 8,
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.feedback.error,
  },
  errorText: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
  },
  successContainer: {
    flex: 1,
    backgroundColor: theme.colors.neutral.offWhite,
    padding: theme.spacing.xl,
    justifyContent: 'space-between',
  },
  successContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  successIcon: {
    fontSize: 64,
    marginBottom: theme.spacing.lg,
  },
  successTitle: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  successDescription: {
    fontSize: theme.typography.sizes.base,
    color: theme.colors.neutral.slate,
    textAlign: 'center',
    marginBottom: theme.spacing.xl,
  },
  sandboxCard: {
    backgroundColor: theme.colors.secondary.lightest,
    borderColor: theme.colors.secondary.main,
    borderWidth: 1,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  sandboxTitle: {
    color: theme.colors.secondary.dark,
    fontWeight: theme.typography.weights.bold,
    fontSize: theme.typography.sizes.sm,
    marginBottom: 4,
  },
  sandboxText: {
    color: theme.colors.neutral.slate,
    fontSize: theme.typography.sizes.xs,
    lineHeight: 16,
  },
});
