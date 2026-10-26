import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { AmountInput } from '../../components/AmountInput';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { ApiClient, ApiError, NetworkError } from '../../services/api-client';
import { RootStackParamList } from '../../navigation/types';
import { useAuthStore } from '../../store/auth-store';
import {
  clearPendingTransferIntent,
  loadPendingTransferIntent,
  matchesPendingIntent,
  savePendingTransferIntent,
} from '../../services/pending-transfer';

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
 *
 * V1-MOBILE-IDEMPOTENCY-RECOVERY-01 — an ambiguous outcome (network error, timeout, or a 5xx —
 * i.e. we received no definitive answer from the backend) must never be treated the same as a
 * definitive rejection (PIN error, validation, limit, 404, 409). A definitive rejection proves
 * this Idempotency-Key produced no financial effect, so it is safe to mint a fresh one for the
 * next attempt. An ambiguous outcome proves nothing either way — the backend may already have
 * committed the transfer — so the SAME Idempotency-Key (and the exact same request body) must
 * be reused on retry, letting the backend's own idempotent-replay behavior
 * (`TransferService.createTransfer`) resolve it safely instead of the client silently creating
 * a second, genuinely-new logical transfer. The pending intent is persisted via SecureStorage
 * (`pending-transfer.ts`, reusing the same abstraction as session storage) so this also survives
 * an app restart/process kill between send and an ambiguous response. See
 * docs/V1/V1-MOBILE-IDEMPOTENCY-RECOVERY-AUDIT-01.md.
 */
export const SendMoneyScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const customerId = useAuthStore((s) => s.customerId);

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

  // Idempotency key for the current attempt. Regenerated only after a DEFINITIVE outcome
  // (success or a definitive rejection) so a user never reuses a key for a logically new
  // transfer; preserved (and restored from the persisted pending intent, see
  // handleConfirmTransfer) across an AMBIGUOUS outcome so a retry safely replays the same
  // logical operation instead of creating a new one. See V1-MOBILE-IDEMPOTENCY-RECOVERY-01.
  const [idempotencyKey, setIdempotencyKey] = useState('');
  // V1-MOBILE-IDEMPOTENCY-RECOVERY-01 PART 4 — a synchronous, non-React-render-cycle guard
  // against a rapid double-tap on the Confirm button. The `isLoading`-disabled button is
  // declarative and only takes effect after a re-render; two taps landing in the same tick
  // would otherwise both reach this handler before either re-render disables it. The in-flight
  // ref is checked and set synchronously as the very first statement, independent of React's
  // render cycle. (Even without this, the backend's own idempotency guarantee — proven in
  // test/v1-w2w-recovery-audit-01.integration.spec.ts — would still collapse the two identical
  // concurrent requests into one financial effect; this guard simply avoids the redundant
  // network call and duplicate PIN verification in the first place.)
  const transferInFlightRef = useRef(false);

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
    if (transferInFlightRef.current) return;
    transferInFlightRef.current = true;

    setShowConfirm(false);
    setIsLoading(true);
    setError('');

    const pinToSend = pin.trim();
    const candidateParams = {
      sourceWalletId: primaryWallet!.id,
      destinationWalletId: destinationWalletId.trim(),
      amountMinor: String(amountMinor),
      currency: 'NGN',
      narration: narration.trim() || 'Wallet Transfer',
    };

    // If a still-pending, same-customer, same-logical-transfer intent already exists (e.g. the
    // previous attempt for this exact transfer ended ambiguously), reuse its Idempotency-Key
    // instead of the freshly-minted one — this is what makes a retry after an ambiguous
    // network failure exactly-once-safe rather than a brand-new logical operation.
    let effectiveKey = idempotencyKey;
    if (customerId) {
      const existing = await loadPendingTransferIntent(customerId);
      if (existing && matchesPendingIntent(existing, candidateParams)) {
        effectiveKey = existing.idempotencyKey;
      }
    }

    // Persisted BEFORE the network call so an app kill immediately after send is still covered.
    if (customerId) {
      await savePendingTransferIntent({
        customerId,
        idempotencyKey: effectiveKey,
        ...candidateParams,
        createdAt: new Date().toISOString(),
      });
    }

    try {
      await ApiClient.post(
        '/customers/me/transfers',
        {
          ...candidateParams,
          reference: effectiveKey,
          pin: pinToSend,
        },
        { idempotencyKey: effectiveKey },
      );

      // Definitive success: the pending intent is resolved and must not be reused again.
      if (customerId) await clearPendingTransferIntent(customerId);
      // PIN is never retained after submission, success or failure.
      setPin('');
      navigation.navigate('Home');
    } catch (err: any) {
      setPin('');
      setIdempotencyKey(effectiveKey);

      if (isAmbiguousTransferOutcome(err)) {
        // We do NOT know whether the backend already committed this transfer. Do not claim it
        // failed, and do not abandon this Idempotency-Key — the pending intent saved above is
        // deliberately left in place so a retry (this session or after an app restart) safely
        // replays the same logical operation instead of creating a new one.
        setError(
          "We couldn't confirm whether this transfer went through. Please check your Transaction History before trying again — if you do retry, you will not be charged twice for the same transfer.",
        );
      } else {
        // A definitive rejection (PIN error, validation, limit, not-found, idempotency conflict)
        // proves this Idempotency-Key produced no financial effect, so it is safe to retire it
        // and issue a new one for the next, logically-fresh attempt.
        if (customerId) await clearPendingTransferIntent(customerId);
        setError(describeTransferError(err));
        generateNewIdempotencyKey();
      }
    } finally {
      setIsLoading(false);
      transferInFlightRef.current = false;
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
 * V1-MOBILE-IDEMPOTENCY-RECOVERY-01 — true if `err` means we genuinely do not know whether the
 * backend already executed this transfer: a `NetworkError` (no HTTP response was ever received —
 * covers both "request never left the device" and "response was lost in transit", which cannot
 * be distinguished from a plain `fetch` call, so both are conservatively treated as ambiguous),
 * or a 5xx response (the server answered, but with an error — NestJS only returns 5xx for an
 * unexpected failure, which `TransferService.createTransfer`'s own ambiguous-outcome handling
 * does not guarantee always means "nothing was committed"). Any 4xx `ApiError` is a definitive,
 * understood rejection (PIN error, validation, limit, not-found, idempotency conflict) and is
 * NOT ambiguous.
 */
function isAmbiguousTransferOutcome(err: unknown): boolean {
  if (err instanceof NetworkError) return true;
  if (err instanceof ApiError) return err.status >= 500;
  // Any other/unknown throw shape (should not normally happen) is treated conservatively as
  // ambiguous rather than assumed to be a safe-to-discard definitive failure.
  return true;
}

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
