import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { AmountInput } from '../../components/AmountInput';
import { TransactionPinDialog } from '../../components/TransactionPinDialog';
import { useAuthStore } from '../../store/auth-store';
import { ApiClient } from '../../services/api-client';
import { classifyPinError } from '../../services/transaction-pin';
import {
  balanceForCustomerWallet,
  fetchFinancialAccounts,
  MONIENAIJA_NUMBER_PATTERN,
  resolveRecipient,
  type CustomerRecipientView,
  type RecipientMode,
} from '../../services/financial-accounts';
import { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'SendMoney'>;

interface Wallet {
  id: string;
  type: string;
  currency: string;
}

export const SendMoneyScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { customerId } = useAuthStore();

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [availableBalanceMinor, setAvailableBalanceMinor] = useState(0);
  const [recipientMode, setRecipientMode] = useState<RecipientMode>('MONIENAIJA_NUMBER');
  const [recipientInput, setRecipientInput] = useState('');
  const [recipient, setRecipient] = useState<CustomerRecipientView | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [amountStr, setAmountStr] = useState('');
  const [amountMinor, setAmountMinor] = useState(0);
  const [narration, setNarration] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  // The transaction PIN lives ONLY here, is sent with the transfer payload,
  // and is cleared after every submission attempt. Never persisted anywhere.
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');

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
        const primary = walletList.find((w) => w.type === 'PRIMARY') || walletList[0];
        if (primary?.id) {
          try {
            const accounts = await fetchFinancialAccounts(customerId);
            setAvailableBalanceMinor(balanceForCustomerWallet(accounts, primary.id));
          } catch {
            setAvailableBalanceMinor(0);
          }
        }
      } catch (err: any) {
        setError('Failed to load your source wallets.');
      }
    };
    fetchWallets();
  }, [customerId]);

  const primaryWallet = wallets.find((w) => w.type === 'PRIMARY') || wallets[0];

  const handleValidateForm = async () => {
    if (!primaryWallet || !customerId) {
      setValidationError('You do not have a wallet to send money from.');
      return;
    }
    const trimmed = recipientInput.trim();
    if (!trimmed) {
      setValidationError(
        recipientMode === 'MONIENAIJA_NUMBER'
          ? "Recipient's MonieNaija number is required."
          : "Recipient's phone number is required.",
      );
      return;
    }
    if (recipientMode === 'MONIENAIJA_NUMBER' && !MONIENAIJA_NUMBER_PATTERN.test(trimmed)) {
      setValidationError('A MonieNaija receiving number is exactly 10 digits.');
      return;
    }
    if (amountMinor <= 0) {
      setValidationError('Amount must be greater than zero.');
      return;
    }
    if (availableBalanceMinor < amountMinor) {
      setValidationError('Insufficient wallet balance.');
      return;
    }

    setValidationError('');
    setIsResolving(true);
    try {
      // Server-authoritative recipient confirmation before any money moves.
      const resolved = await resolveRecipient(customerId, recipientMode, trimmed);
      setRecipient(resolved);
      setShowConfirm(true);
    } catch (err: any) {
      setRecipient(null);
      setValidationError(err?.message || 'Recipient could not be found.');
    } finally {
      setIsResolving(false);
    }
  };

  const handleAuthorizeTransfer = async () => {
    setIsLoading(true);
    setError('');
    setPinError('');

    try {
      // The source WalletAccount is resolved server-side through the
      // authenticated customer's financial binding; the destination is the
      // typed recipient identifier the customer already confirmed. The server
      // re-resolves it authoritatively; no UUID is ever entered by hand. The
      // transaction PIN is the step-up authorization factor for this transfer.
      const payload = {
        destination: {
          type: recipientMode,
          value: recipientInput.trim(),
        },
        amountMinor: String(amountMinor),
        currency: 'NGN',
        transactionPin: pin,
        reference: idempotencyKey,
        narration: narration.trim() || 'Wallet Transfer',
      };

      await ApiClient.post(`/customers/${customerId}/transfers`, payload, {
        idempotencyKey, // logical persistent key passed down to the network headers
      });

      setShowConfirm(false);
      // Navigate back to Home on success
      navigation.navigate('Home');
    } catch (err: any) {
      const classified = classifyPinError(err);
      if (classified.kind !== 'UNKNOWN') {
        // PIN-specific failures stay in the authorization dialog.
        setPinError(classified.message);
      } else {
        setShowConfirm(false);
        // Keep same idempotencyKey for potential retries (satisfying the persistent retry constraints)
        setError(err?.message || 'Transfer failed. Check connection or try again.');
      }
    } finally {
      // The plaintext PIN never survives a submission attempt.
      setPin('');
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
          <Text style={styles.subtitle}>Instantly transfer funds to another MonieNaija customer</Text>
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
              ₦{(availableBalanceMinor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}
            </Text>
          </View>
        )}

        <View style={styles.form}>
          <View style={styles.modeRow}>
            <Button
              label="MonieNaija Number"
              size="small"
              style={styles.modeButton}
              variant={recipientMode === 'MONIENAIJA_NUMBER' ? 'primary' : 'outline'}
              onPress={() => {
                setRecipientMode('MONIENAIJA_NUMBER');
                setRecipient(null);
                setValidationError('');
              }}
            />
            <Button
              label="Phone Number"
              size="small"
              style={styles.modeButton}
              variant={recipientMode === 'PHONE' ? 'primary' : 'outline'}
              onPress={() => {
                setRecipientMode('PHONE');
                setRecipient(null);
                setValidationError('');
              }}
            />
          </View>

          <Input
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={recipientMode === 'MONIENAIJA_NUMBER' ? 'number-pad' : 'phone-pad'}
            label={
              recipientMode === 'MONIENAIJA_NUMBER'
                ? "Recipient's MonieNaija Number (10 digits)"
                : "Recipient's Phone Number"
            }
            placeholder={
              recipientMode === 'MONIENAIJA_NUMBER' ? 'e.g. 7065111760' : 'e.g. 07065111760'
            }
            value={recipientInput}
            onChangeText={(text) => {
              setRecipientInput(text);
              setRecipient(null);
              if (validationError) setValidationError('');
            }}
          />

          <AmountInput
            error={amountMinor > 0 && primaryWallet && availableBalanceMinor < amountMinor ? 'Insufficient funds' : undefined}
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
            loading={isLoading || isResolving}
            label="Send Funds"
            style={styles.button}
            onPress={handleValidateForm}
          />
        </View>

        <TransactionPinDialog
          errorMessage={pinError}
          isLoading={isLoading}
          message={
            recipient
              ? `Send ₦${parseFloat(amountStr || '0').toLocaleString('en-NG', { minimumFractionDigits: 2 })} to ${recipient.displayName}${
                  recipient.receivingNumber ? ` (MonieNaija Number: ${recipient.receivingNumber})` : ''
                }?`
              : `Send ₦${parseFloat(amountStr || '0').toLocaleString('en-NG', { minimumFractionDigits: 2 })} to ${recipientInput.trim()}?`
          }
          pin={pin}
          title="Confirm Money Transfer"
          visible={showConfirm}
          onAuthorize={handleAuthorizeTransfer}
          onCancel={() => {
            setRecipient(null);
            setShowConfirm(false);
            setPin('');
            setPinError('');
          }}
          onPinChange={(next) => {
            setPin(next);
            if (pinError) setPinError('');
          }}
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
  modeRow: {
    flexDirection: 'row',
    marginBottom: theme.spacing.md,
  },
  modeButton: {
    flex: 1,
    marginRight: theme.spacing.sm,
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
