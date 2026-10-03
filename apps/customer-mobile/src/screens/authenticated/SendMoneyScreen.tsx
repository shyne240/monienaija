import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { AmountInput } from '../../components/AmountInput';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { ApiClient, ApiError } from '../../services/api-client';
import { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'SendMoney'>;

interface Wallet {
  id: string;
  currency: string;
  status: string;
  balanceMinor: string | number;
}

/**
 * V1-CUSTOMER-02 — Wallet-to-Wallet.
 *
 * Calls the real, authenticated, PIN-protected backend contract:
 *   GET  /customers/me/wallets                (ownership-scoped, ledger-derived)
 *   POST /customers/me/transfers              (Idempotency-Key header, Customer
 *                                               transaction PIN verified server-side
 *                                               before any ledger debit)
 *
 * This screen previously called the legacy, unauthenticated `/transfers` route with
 * no PIN and no ownership check at all. That was a critical authorization gap — see
 * docs/V1/V1-CUSTOMER-02-WALLET-TO-WALLET-AUTHORIZATION-COMPLETION-01.md.
 *
 * The Customer transaction PIN is held only in local component state, is cleared on
 * submit/success/error/unmount, is never logged, and is never written to
 * SecureStore, Zustand, or navigation params.
 */
export const SendMoneyScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [walletsError, setWalletsError] = useState('');
  const [destinationWalletId, setDestinationWalletId] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [amountMinor, setAmountMinor] = useState(0);
  const [narration, setNarration] = useState('');
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  // Idempotency key, fresh per transfer attempt session (regenerated after any
  // non-retryable outcome so a user never reuses a key for a logically new transfer).
  const [idempotencyKey, setIdempotencyKey] = useState('');

  useEffect(() => {
    generateNewIdempotencyKey();
    // Never persist the PIN across unmount.
    return () => setPin('');
  }, []);

  const generateNewIdempotencyKey = () => {
    const key = `tx-transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setIdempotencyKey(key);
  };

  useEffect(() => {
    const fetchWallets = async () => {
      try {
        const walletList = await ApiClient.get<Wallet[]>('/customers/me/wallets');
        setWallets(walletList);
      } catch (err: any) {
        setWalletsError('Failed to load your wallet. Pull to refresh or try again later.');
      }
    };
    fetchWallets();
  }, []);

  const primaryWallet = wallets.find((w) => w.currency === 'NGN') || wallets[0];
  const balanceMinor = primaryWallet ? Number(primaryWallet.balanceMinor) : 0;

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
    if (balanceMinor < amountMinor) {
      setValidationError('Insufficient wallet balance.');
      return;
    }
    if (!/^\d{4,12}$/.test(pin.trim())) {
      setValidationError('Enter your 4-12 digit Transaction PIN.');
      return;
    }

    setValidationError('');
    setShowConfirm(true);
  };

  const handleConfirmTransfer = async () => {
    setShowConfirm(false);
    setIsLoading(true);
    setError('');

    const pinToSend = pin.trim();

    try {
      await ApiClient.post(
        '/customers/me/transfers',
        {
          sourceWalletId: primaryWallet!.id,
          destinationWalletId: destinationWalletId.trim(),
          amountMinor: String(amountMinor),
          currency: 'NGN',
          reference: idempotencyKey,
          narration: narration.trim() || 'Wallet Transfer',
          pin: pinToSend,
        },
        { idempotencyKey },
      );

      // PIN is never retained after submission, success or failure.
      setPin('');
      navigation.navigate('Home');
    } catch (err: any) {
      setPin('');
      setError(describeTransferError(err));
      // A rejected attempt (PIN error, limit, validation) is not safely retryable
      // under the same Idempotency-Key semantics as a fresh attempt; issue a new key
      // for the next try so the user is not silently blocked from correcting input.
      generateNewIdempotencyKey();
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
          <Text style={styles.subtitle}>Instantly transfer funds to another MonieNaija wallet</Text>
        </View>

        {(!!validationError || !!error || !!walletsError) && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{validationError || error || walletsError}</Text>
          </View>
        )}

        {primaryWallet && (
          <View style={styles.balanceContainer}>
            <Text style={styles.balanceLabel}>AVAILABLE BALANCE</Text>
            <Text style={styles.balanceValue}>
              ₦{(balanceMinor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}
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
            error={amountMinor > 0 && primaryWallet && balanceMinor < amountMinor ? 'Insufficient funds' : undefined}
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

          <Input
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            label="Transaction PIN"
            placeholder="••••"
            maxLength={12}
            value={pin}
            onChangeText={(text) => {
              setPin(text);
              if (validationError) setValidationError('');
            }}
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

/**
 * Maps backend authorization/validation outcomes to plain-language messages.
 * Never exposes failure codes directly; never implies success on ambiguous errors.
 */
function describeTransferError(err: unknown): string {
  if (err instanceof ApiError) {
    const message = (err.message || '').toLowerCase();
    if (err.status === 401 && message.includes('pin is locked')) {
      return 'Your Transaction PIN is locked due to too many failed attempts. Contact support to continue.';
    }
    if (err.status === 401 && message.includes('pin not set')) {
      return 'You have not set a Transaction PIN yet. Set one from your Profile before sending money.';
    }
    if (err.status === 401 && message.includes('pin')) {
      return 'Incorrect Transaction PIN.';
    }
    if (err.status === 404) {
      return 'Recipient wallet was not found.';
    }
    if (err.status === 409) {
      return err.message || 'This transfer could not be completed because of a conflicting request.';
    }
    if (err.code && err.code.startsWith('LIMIT_')) {
      return 'This transfer exceeds an account transaction limit. Try a smaller amount or contact support.';
    }
    return err.message || 'Transfer failed. Check connection or try again.';
  }
  return 'Transfer failed. Check connection or try again.';
}

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
