import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { AmountInput } from '../../components/AmountInput';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { useAuthStore } from '../../store/auth-store';
import { ApiClient } from '../../services/api-client';
import { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'SendMoney'>;

interface Wallet {
  id: string;
  type: string;
  currency: string;
  balanceMinor: number;
}

export const SendMoneyScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { customerId } = useAuthStore();

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [destinationWalletId, setDestinationWalletId] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [amountMinor, setAmountMinor] = useState(0);
  const [narration, setNarration] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  // Logical operation persistent idempotency key
  const [idempotencyKey, setIdempotencyKey] = useState('');

  // Generate an idempotency key once per transaction form session
  useEffect(() => {
    generateNewIdempotencyKey();
  }, []);

  const generateNewIdempotencyKey = () => {
    // Generate a fresh key for a brand new transfer
    const key = `tx-transfer-${customerId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setIdempotencyKey(key);
  };

  useEffect(() => {
    const fetchWallets = async () => {
      if (!customerId) return;
      try {
        const walletList = await ApiClient.get<Wallet[]>(`/customers/${customerId}/wallets`);
        setWallets(walletList);
      } catch (err: any) {
        setError('Failed to load your source wallets.');
      }
    };
    fetchWallets();
  }, [customerId]);

  const primaryWallet = wallets.find((w) => w.type === 'PRIMARY') || wallets[0];

  const handleValidateForm = () => {
    if (!primaryWallet) {
      setValidationError('You do not have a wallet to send money from.');
      return;
    }
    if (!destinationWalletId.trim()) {
      setValidationError('Destination Wallet ID is required.');
      return;
    }
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(destinationWalletId.trim())) {
      setValidationError('Destination Wallet ID must be a valid UUID.');
      return;
    }
    if (amountMinor <= 0) {
      setValidationError('Amount must be greater than zero.');
      return;
    }
    if (primaryWallet.balanceMinor < amountMinor) {
      setValidationError('Insufficient wallet balance.');
      return;
    }

    setValidationError('');
    setShowConfirm(true);
  };

  const handleConfirmTransfer = async () => {
    setShowConfirm(false);
    setIsLoading(true);
    setError('');

    try {
      // Must submit amountMinor as a positive integer string to bypass matches/regex checking in NestJS
      const payload = {
        sourceWalletId: primaryWallet!.id,
        destinationWalletId: destinationWalletId.trim(),
        amountMinor: String(amountMinor),
        currency: 'NGN',
        reference: idempotencyKey,
        narration: narration.trim() || 'Wallet Transfer',
      };

      await ApiClient.post('/transfers', payload, {
        idempotencyKey, // logical persistent key passed down to the network headers
      });

      // Navigate back to Home on success
      navigation.navigate('Home');
    } catch (err: any) {
      // Keep same idempotencyKey for potential retries (satisfying the persistent retry constraints)
      setError(err?.message || 'Transfer failed. Check connection or try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Send Money</Text>
          <Text style={styles.subtitle}>Instantly transfer funds to another MoneyNaija wallet</Text>
        </View>

        {(!!validationError || !!error) && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{validationError || error}</Text>
            {!validationError && (
              <Button
                label="Regenerate Transaction Key"
                size="small"
                style={{ marginTop: theme.spacing.sm }}
                variant="outline"
                onPress={generateNewIdempotencyKey}
              />
            )}
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
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            label="Recipient Wallet ID (UUID)"
            placeholder="e.g. 5e6f7g8h-..."
            value={destinationWalletId}
            onChangeText={(text) => {
              setDestinationWalletId(text);
              if (validationError) setValidationError('');
            }}
          />

          <AmountInput
            error={amountMinor > 0 && primaryWallet && primaryWallet.balanceMinor < amountMinor ? 'Insufficient funds' : undefined}
            label="Amount (NGN)"
            value={amountStr}
            onChangeValue={(str, minor) => {
              setAmountStr(str);
              setAmountMinor(minor);
              if (validationError) setValidationError('');
            }}
          />

          <Input
            label="Narration"
            placeholder="What is this transfer for?"
            value={narration}
            onChangeText={setNarration}
          />

          <Button
            loading={isLoading}
            label="Send Funds"
            style={styles.button}
            onPress={handleValidateForm}
          />
        </View>

        <ConfirmationDialog
          isLoading={isLoading}
          message={`Are you sure you want to transfer ₦${parseFloat(amountStr || '0').toLocaleString('en-NG', { minimumFractionDigits: 2 })} to wallet ${destinationWalletId}?`}
          title="Confirm Money Transfer"
          visible={showConfirm}
          onCancel={() => setShowConfirm(false)}
          onConfirm={handleConfirmTransfer}
        />
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
});
