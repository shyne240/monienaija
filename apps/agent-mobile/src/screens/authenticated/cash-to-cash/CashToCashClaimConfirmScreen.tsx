import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { theme } from '../../../theme';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { Input } from '../../../components/Input';
import { MfaChallengeCard } from '../../../components/MfaChallengeCard';
import {
  agentCashToCashClaim,
  agentCashToCashClaimByNumber,
  describeApiError,
  describeCashToCashClaimError,
  getAgentCashToCashClaim,
  recoverAgentCashToCashClaimByNumber,
  type AgentCashToCashClaimResult,
  type AgentMfaChallenge,
} from '../../../services/agent-api';
import { isChallengeExpired } from '../../../services/mfa-challenge';
import {
  clearPendingCashToCashLocatorClaim,
  loadPendingCashToCashLocatorClaim,
  matchesPendingCashToCashLocatorClaim,
  savePendingCashToCashLocatorClaim,
} from '../../../services/pending-operation';
import { newIdempotencyKey } from '../../../utils/format';
import { useAuthStore } from '../../../store/auth-store';
import type { RootStackParamList } from '../../../navigation/types';

/**
 * Cash→Cash Claim Assist — Step 2: Confirm & Multi-party Verification
 * (V1-AGENT-MOBILE-09 + ARENA 1 Approved Six-Digit Redemption Contract).
 *
 * Primary flow (`senderPhone` + exact 6-digit `transferNumber`):
 * - Submits to `POST /api/v1/agents/cash-to-cash/claim-by-number` (NEVER sending `transferId`).
 * - Recovers uncertain outcomes via `POST /api/v1/agents/cash-to-cash/claims/recover-by-number`
 *   with `{ senderPhone, transferNumber, idempotencyKey }` using the ORIGINAL idempotencyKey.
 * - Never speculatively calls `recover-by-number` on fresh mounts when no persisted attempt exists,
 *   preserving the shared 60-second locator rate budget.
 * - Never rotates `idempotencyKey` after an ambiguous/potentially committed outcome.
 *
 * Compatibility flow (`transferId` UUID):
 * - Preserves internal compatibility with `POST /api/v1/agents/cash-to-cash/claim` and
 *   `GET /api/v1/agents/cash-to-cash/claims/:transferId` without ever passing a 6-digit
 *   `transferNumber` into `transferId`.
 */
export const CashToCashClaimConfirmScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CashToCashClaimConfirm'>>();
  const params = route.params;
  const { customer, beneficiaryPhone } = params;
  const isLocatorMode =
    'senderPhone' in params &&
    typeof params.senderPhone === 'string' &&
    'transferNumber' in params &&
    typeof params.transferNumber === 'string';
  const senderPhone = isLocatorMode ? params.senderPhone : undefined;
  const transferNumber = isLocatorMode ? params.transferNumber : undefined;
  const legacyTransferId = !isLocatorMode && 'transferId' in params ? params.transferId : undefined;

  const { agentId } = useAuthStore();
  const queryClient = useQueryClient();

  const [challenge, setChallenge] = useState<AgentMfaChallenge | null>(null);
  const [mfaInvalidatedRevision, setMfaInvalidatedRevision] = useState(0);
  const [transferCode, setTransferCode] = useState('');
  const [otp, setOtp] = useState('');
  const [redemptionMethod, setRedemptionMethod] = useState<'CUSTOMER_WALLET' | 'AGENT_CASH'>(
    'CUSTOMER_WALLET',
  );
  const [lockedRedemptionMethod, setLockedRedemptionMethod] = useState<
    'CUSTOMER_WALLET' | 'AGENT_CASH' | null
  >(null);
  const [hasAmbiguousHistory, setHasAmbiguousHistory] = useState(false);
  const [rollbackRetryReady, setRollbackRetryReady] = useState(false);
  const [agentPin, setAgentPin] = useState('');
  const [clientError, setClientError] = useState('');
  const [recoveryStatus, setRecoveryStatus] = useState<'CHECKING' | 'READY' | 'ERROR'>('CHECKING');
  const [recoveryError, setRecoveryError] = useState('');
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const [postSubmitRecoveryUnknown, setPostSubmitRecoveryUnknown] = useState(false);
  const [postSubmitRecoveryNoticeError, setPostSubmitRecoveryNoticeError] = useState('');
  const [postSubmitChecking, setPostSubmitChecking] = useState(false);
  const submitInFlightRef = useRef(false);

  // Exactly ONE idempotency key per attempt (survives navigation + retries).
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey('c2c-claim'));

  const completeClaimSuccess = async (result: AgentCashToCashClaimResult) => {
    setTransferCode('');
    setOtp('');
    setAgentPin('');
    setPostSubmitRecoveryUnknown(false);
    setPostSubmitRecoveryNoticeError('');
    if (isLocatorMode && agentId) {
      await clearPendingCashToCashLocatorClaim(agentId);
    }
    void queryClient.invalidateQueries({ queryKey: ['agent-financial-position', agentId] });
    void queryClient.invalidateQueries({ queryKey: ['agent-transactions', agentId] });
    void queryClient.invalidateQueries({ queryKey: ['agent-history', agentId] });
    navigation.reset({
      index: 0,
      routes: [
        {
          name: 'CashToCashClaimSuccess',
          params: {
            result,
            customerDisplay: customer.display,
            customerReceivingNumber: customer.receivingNumber,
          },
        },
      ],
    });
  };

  const checkPostSubmitClaimRecovery = async (triggerError?: unknown) => {
    if (!agentId) return;
    setPostSubmitChecking(true);
    setPostSubmitRecoveryNoticeError('');
    try {
      const recovered = isLocatorMode
        ? await recoverAgentCashToCashClaimByNumber({
            senderPhone: senderPhone!,
            transferNumber: transferNumber!,
            idempotencyKey: idempotencyKeyRef.current,
          })
        : await getAgentCashToCashClaim(legacyTransferId!);
      setRollbackRetryReady(false);
      await completeClaimSuccess(recovered);
    } catch (lookupError: unknown) {
      if (isApiNotFound(lookupError)) {
        if (isLocatorMode && triggerError && isAmbiguousLocatorClaimError(triggerError)) {
          // Per ARENA 1 §2.C: on locator claims, an immediate 404 right after a lost/503 response is
          // NOT proof an in-flight transaction cannot still commit. Hold in recovery mode until the
          // Agent explicitly re-checks status, and NEVER rotate idempotencyKey.
          setPostSubmitRecoveryUnknown(true);
          setRollbackRetryReady(false);
        } else {
          // Confirmed not committed (either legacy UUID 404 or explicit manual re-check on locator):
          // allow retry ONLY with the SAME idempotencyKey + locked redemptionMethod + fresh OTP.
          setPostSubmitRecoveryUnknown(false);
          setRollbackRetryReady(true);
          if (isLocatorMode) {
            setChallenge(null);
            setMfaInvalidatedRevision((rev) => rev + 1);
          }
        }
      } else {
        setPostSubmitRecoveryUnknown(true);
        setRollbackRetryReady(false);
        setPostSubmitRecoveryNoticeError(describeCashToCashClaimError(lookupError));
      }
    } finally {
      setPostSubmitChecking(false);
    }
  };

  const claimMutation = useMutation<AgentCashToCashClaimResult, unknown, void>({
    mutationFn: async () => {
      if (!challenge) {
        throw new Error('Beneficiary verification challenge missing');
      }
      if (isLocatorMode) {
        if (agentId) {
          await savePendingCashToCashLocatorClaim({
            agentId,
            senderPhone: senderPhone!,
            transferNumber: transferNumber!,
            beneficiaryPhone,
            customerId: customer.customerId,
            redemptionMethod,
            idempotencyKey: idempotencyKeyRef.current,
            createdAt: new Date().toISOString(),
          });
        }
        return agentCashToCashClaimByNumber({
          senderPhone: senderPhone!,
          transferNumber: transferNumber!,
          beneficiaryPhone,
          transferCode: transferCode.trim(),
          customerId: customer.customerId,
          mfaChallengeId: challenge.challengeId,
          otp: otp.trim(),
          idempotencyKey: idempotencyKeyRef.current,
          redemptionMethod,
          ...(redemptionMethod === 'AGENT_CASH' ? { agentPin } : {}),
        });
      }
      return agentCashToCashClaim({
        transferId: legacyTransferId!,
        beneficiaryPhone,
        transferCode: transferCode.trim(),
        customerId: customer.customerId,
        mfaChallengeId: challenge.challengeId,
        otp: otp.trim(),
        idempotencyKey: idempotencyKeyRef.current,
        redemptionMethod,
        ...(redemptionMethod === 'AGENT_CASH' ? { agentPin } : {}),
      });
    },
    onSuccess: async (result) => {
      await completeClaimSuccess(result);
    },
    onError: async (err) => {
      setTransferCode('');
      setOtp('');
      setAgentPin('');

      if (isLocatorMode) {
        if (isLocatorRateLimitedError(err)) {
          // Rejected by LocatorRateLimiter before transaction execution — do not burn extra
          // locator budget or force OTP resends.
          if (agentId && !hasAmbiguousHistory) {
            await clearPendingCashToCashLocatorClaim(agentId);
          }
          return;
        }
        if (isAmbiguousLocatorClaimError(err)) {
          setHasAmbiguousHistory(true);
          setLockedRedemptionMethod(redemptionMethod);
          await checkPostSubmitClaimRecovery(err);
          return;
        }
        // Definitive < 500 failure (including uniform 404 C2C_CLAIM_NOT_AVAILABLE, 400, 401, 403):
        // Retain same idempotencyKey + locked method per ARENA 1 §3 ("retry unchanged financial parameters/key"),
        // and invalidate MFA challenge when 404 C2C_CLAIM_NOT_AVAILABLE or consumed/expired OTP occurred.
        if (isLocatorNotAvailableError(err) || isOtpChallengeInvalidatedError(err)) {
          setLockedRedemptionMethod(redemptionMethod);
          setRollbackRetryReady(true);
          setChallenge(null);
          setMfaInvalidatedRevision((rev) => rev + 1);
        }
        if (agentId && !hasAmbiguousHistory) {
          await clearPendingCashToCashLocatorClaim(agentId);
        }
        return;
      }

      if (isOtpChallengeInvalidatedError(err)) {
        setChallenge(null);
        setMfaInvalidatedRevision((rev) => rev + 1);
      }
      if (shouldRecoverAfterLegacyClaimError(err)) {
        if (isAmbiguousLegacyClaimError(err)) {
          setHasAmbiguousHistory(true);
        }
        setLockedRedemptionMethod(redemptionMethod);
        await checkPostSubmitClaimRecovery(err);
      }
    },
  });

  // Mount recovery check:
  // - Locator mode: recover ONLY when a matching persisted pending attempt exists for this Agent,
  //   avoiding speculative rate-budget consumption on fresh claim attempts.
  // - Legacy UUID mode: check `GET /agents/cash-to-cash/claims/:transferId` as before.
  useEffect(() => {
    let active = true;
    setRecoveryStatus('CHECKING');
    setRecoveryError('');

    if (!agentId) {
      setRecoveryStatus('ERROR');
      setRecoveryError('Agent session is unavailable. Sign in again before processing a claim.');
      return () => {
        active = false;
      };
    }

    if (isLocatorMode) {
      void (async () => {
        const existing = await loadPendingCashToCashLocatorClaim(agentId);
        if (!active) return;
        const matches =
          existing &&
          matchesPendingCashToCashLocatorClaim(existing, {
            senderPhone: senderPhone!,
            transferNumber: transferNumber!,
            beneficiaryPhone,
            customerId: customer.customerId,
          });
        if (!matches || !existing) {
          setRecoveryStatus('READY');
          return;
        }

        // Restore exact persisted idempotency key and payout method before recovering.
        idempotencyKeyRef.current = existing.idempotencyKey;
        setRedemptionMethod(existing.redemptionMethod);
        setLockedRedemptionMethod(existing.redemptionMethod);
        setHasAmbiguousHistory(true);

        try {
          const recovered = await recoverAgentCashToCashClaimByNumber({
            senderPhone: existing.senderPhone,
            transferNumber: existing.transferNumber,
            idempotencyKey: existing.idempotencyKey,
          });
          if (!active) return;
          await completeClaimSuccess(recovered);
        } catch (error: unknown) {
          if (!active) return;
          if (isApiNotFound(error)) {
            setRollbackRetryReady(true);
            setRecoveryStatus('READY');
            return;
          }
          setRecoveryStatus('ERROR');
          setRecoveryError(
            `${describeCashToCashClaimError(error)} Confirm the previous claim status before submitting; do not start a replacement while the outcome is unknown.`,
          );
        }
      })();

      return () => {
        active = false;
      };
    }

    void getAgentCashToCashClaim(legacyTransferId!)
      .then((result) => {
        if (!active) return;
        void completeClaimSuccess(result);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (isApiNotFound(error)) {
          setRecoveryStatus('READY');
          return;
        }
        setRecoveryStatus('ERROR');
        setRecoveryError(
          `${describeApiError(error)} Confirm the previous claim status before submitting; do not start a replacement while the outcome is unknown.`,
        );
      });

    return () => {
      active = false;
    };
  }, [
    agentId,
    beneficiaryPhone,
    customer,
    isLocatorMode,
    legacyTransferId,
    navigation,
    queryClient,
    recoveryAttempt,
    senderPhone,
    transferNumber,
  ]);

  // Safety: shed sensitive credentials when screen unmounts.
  useEffect(
    () => () => {
      setTransferCode('');
      setOtp('');
      setAgentPin('');
    },
    [],
  );

  const handleSubmit = () => {
    if (postSubmitRecoveryUnknown) {
      setClientError('Confirm whether the previous claim attempt completed before submitting again.');
      return;
    }
    if (!challenge) {
      setClientError('Send beneficiary verification code first');
      return;
    }
    if (isChallengeExpired(challenge)) {
      setClientError('Customer verification code has expired. Request a new code.');
      return;
    }
    if (!transferCode.trim()) {
      setClientError('Enter the secret transfer code');
      return;
    }
    if (!/^\d{8,20}$/.test(transferCode.trim())) {
      setClientError('Transfer code must contain 8 to 20 numeric digits');
      return;
    }
    if (!otp.trim()) {
      setClientError('Enter the customer one-time verification code');
      return;
    }
    if (redemptionMethod === 'AGENT_CASH') {
      if (!agentPin.trim()) {
        setClientError('Enter your Agent transaction PIN for cash payout');
        return;
      }
      if (!/^\d{4,12}$/.test(agentPin)) {
        setClientError('Agent transaction PIN must be 4 to 12 numeric digits');
        return;
      }
    }
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setClientError('');
    claimMutation.mutate(undefined, {
      onSettled: () => {
        submitInFlightRef.current = false;
      },
    });
  };

  const failureText = clientError
    ? clientError
    : claimMutation.isError
      ? describeCashToCashClaimError(claimMutation.error)
      : '';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Confirm Cash→Cash Claim</Text>

        <Card style={styles.card} testID="c2c-claim-summary-card">
          <SummaryRow label="Beneficiary" value={customer.display} testID="c2c-claim-summary-customer" />
          <SummaryRow label="Beneficiary Phone" value={customer.receivingNumber} testID="c2c-claim-summary-phone" />
          {isLocatorMode ? (
            <>
              <SummaryRow
                label="Sender Phone"
                value={senderPhone!}
                testID="c2c-claim-summary-sender-phone"
              />
              <SummaryRow
                label="6-Digit Transfer Number"
                value={transferNumber!}
                testID="c2c-claim-summary-transfer-number"
              />
            </>
          ) : (
            <SummaryRow
              label="Transfer ID"
              value={legacyTransferId!}
              testID="c2c-claim-summary-transfer-id"
            />
          )}
          <Text style={styles.note} testID="c2c-redemption-method-intro">
            Select how this claim will settle below. Cash payout requires a current approved Customer
            KYC assessment and your Agent transaction PIN.
          </Text>
        </Card>

        <Card style={styles.card} testID="c2c-claim-redemption-method-card">
          <Text style={styles.methodTitle}>Beneficiary payout method</Text>
          <View style={styles.methodOptions}>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{
                checked: redemptionMethod === 'CUSTOMER_WALLET',
                disabled:
                  claimMutation.isPending ||
                  postSubmitChecking ||
                  postSubmitRecoveryUnknown ||
                  (lockedRedemptionMethod !== null && lockedRedemptionMethod !== 'CUSTOMER_WALLET'),
              }}
              style={[
                styles.methodOption,
                redemptionMethod === 'CUSTOMER_WALLET' && styles.methodOptionSelected,
              ]}
              onPress={() => {
                if (
                  claimMutation.isPending ||
                  postSubmitChecking ||
                  postSubmitRecoveryUnknown ||
                  (lockedRedemptionMethod !== null && lockedRedemptionMethod !== 'CUSTOMER_WALLET')
                ) {
                  return;
                }
                setRedemptionMethod('CUSTOMER_WALLET');
                setAgentPin('');
                setClientError('');
              }}
              testID="c2c-claim-method-wallet"
            >
              <Text style={styles.methodOptionTitle}>Customer wallet</Text>
              <Text style={styles.methodOptionText}>Credit the beneficiary&apos;s NGN wallet.</Text>
            </Pressable>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{
                checked: redemptionMethod === 'AGENT_CASH',
                disabled:
                  claimMutation.isPending ||
                  postSubmitChecking ||
                  postSubmitRecoveryUnknown ||
                  (lockedRedemptionMethod !== null && lockedRedemptionMethod !== 'AGENT_CASH'),
              }}
              style={[
                styles.methodOption,
                redemptionMethod === 'AGENT_CASH' && styles.methodOptionSelected,
              ]}
              onPress={() => {
                if (
                  claimMutation.isPending ||
                  postSubmitChecking ||
                  postSubmitRecoveryUnknown ||
                  (lockedRedemptionMethod !== null && lockedRedemptionMethod !== 'AGENT_CASH')
                ) {
                  return;
                }
                setRedemptionMethod('AGENT_CASH');
                setClientError('');
              }}
              testID="c2c-claim-method-cash"
            >
              <Text style={styles.methodOptionTitle}>Agent cash payout</Text>
              <Text style={styles.methodOptionText}>Credit this Agent&apos;s NGN float; cash handover is separate.</Text>
            </Pressable>
          </View>
          <Text style={styles.methodNotice} testID="c2c-claim-method-notice">
            {redemptionMethod === 'AGENT_CASH'
              ? 'Cash payout requires a current approved Customer KYC assessment. A stored identity-document row without a recorded review is not proof of verified identity. Physical cash handover is operationally separate from this ledger settlement.'
              : 'Wallet redemption credits the beneficiary Customer wallet. No physical cash is paid as part of this settlement.'}
          </Text>
          {lockedRedemptionMethod !== null && (
            <View style={{ marginTop: theme.spacing.sm, gap: theme.spacing.xs }}>
              <Text style={styles.methodNotice} testID="c2c-claim-method-locked-notice">
                Payout method ({lockedRedemptionMethod === 'AGENT_CASH' ? 'Agent cash payout' : 'Customer wallet'}) and idempotency key are locked to protect retry safety after an interrupted or rolled-back attempt.
              </Text>
              {rollbackRetryReady && !postSubmitRecoveryUnknown && !postSubmitChecking && !claimMutation.isPending && (
                <>
                  <Text style={styles.helper} testID="c2c-claim-rollback-retry-notice">
                    Request a fresh customer OTP code if the previous code was already used, then retry with the same payout method and unchanged idempotency key.
                  </Text>
                  {!hasAmbiguousHistory && (
                    <Button
                      label="Change payout method (new attempt)"
                      variant="outline"
                      onPress={() => {
                        setLockedRedemptionMethod(null);
                        setRollbackRetryReady(false);
                        idempotencyKeyRef.current = newIdempotencyKey('c2c-claim');
                        setClientError('');
                      }}
                      testID="c2c-claim-unlock-method-button"
                    />
                  )}
                </>
              )}
            </View>
          )}
        </Card>

        {recoveryStatus === 'CHECKING' && (
          <Text style={styles.helper} testID="c2c-claim-recovery-checking">
            Checking whether this Agent already completed the claim…
          </Text>
        )}
        {recoveryStatus === 'ERROR' && (
          <Card style={styles.card} testID="c2c-claim-recovery-error-card">
            <Text style={styles.errorText} testID="c2c-claim-recovery-error">{recoveryError}</Text>
            <Button
              label="Check claim status again"
              variant="outline"
              onPress={() => setRecoveryAttempt((attempt) => attempt + 1)}
              testID="c2c-claim-recovery-retry"
            />
          </Card>
        )}

        {recoveryStatus === 'READY' && (
          <>
            <Text style={styles.helper} testID="c2c-claim-method-note">
              {redemptionMethod === 'AGENT_CASH'
                ? 'Cash payout requires a current approved Customer KYC assessment and your transaction PIN. Physical cash handover is separate from the Agent-float ledger credit.'
                : 'Wallet credit only. No physical cash is paid as part of this settlement.'}
            </Text>

            {/* Step 2A: Customer OTP Challenge */}
            <MfaChallengeCard
              customerId={customer.customerId}
              purpose="CASH_TO_CASH_CLAIM"
              invalidatedRevision={mfaInvalidatedRevision}
              disabled={postSubmitRecoveryUnknown || postSubmitChecking || claimMutation.isPending}
              onChallengeReady={(issued) => {
                setChallenge(issued);
                setClientError('');
              }}
              onChallengeInvalidated={() => {
                setChallenge(null);
                setOtp('');
              }}
              testID="c2c-claim-mfa-card"
            />

            {/* Step 2B: Credentials & Authorization */}
            <Card style={styles.card}>
              <Input
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="number-pad"
                secureTextEntry
                label="Secret Transfer Code"
                placeholder="••••••••"
                value={transferCode}
                maxLength={20}
                testID="c2c-claim-code-input"
                onChangeText={(text) => {
                  setTransferCode(text);
                  setClientError('');
                }}
              />
              <Text style={styles.helper}>
                Ask the beneficiary for the secret transfer code given to them privately by the sender
                (distinct from the 6-digit transfer number).
              </Text>

              {redemptionMethod === 'AGENT_CASH' && (
                <>
                  <Input
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="number-pad"
                    secureTextEntry
                    label="Agent transaction PIN"
                    placeholder="••••"
                    value={agentPin}
                    maxLength={12}
                    testID="c2c-claim-agent-pin-input"
                    onChangeText={(text) => {
                      setAgentPin(text);
                      setClientError('');
                    }}
                  />
                  <Text style={styles.helper} testID="c2c-claim-agent-pin-note">
                    Required to authorize cash redemption. It is sent securely for verification and is never included in the receipt.
                  </Text>
                </>
              )}

              <Input
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="number-pad"
                label="Beneficiary verification code (OTP)"
                placeholder="e.g. 123456"
                value={otp}
                maxLength={10}
                testID="c2c-claim-otp-input"
                onChangeText={(text) => {
                  setOtp(text);
                  setClientError('');
                }}
              />
              <Text style={styles.helper}>
                Ask the beneficiary for the verification code sent to their registered phone number.
              </Text>

              {!!failureText && (
                <Text style={styles.errorText} testID="c2c-claim-confirm-error">{failureText}</Text>
              )}

              {postSubmitRecoveryUnknown && (
                <View style={styles.recoveryNoticeBox} testID="c2c-claim-post-submit-recovery-card">
                  <Text style={styles.recoveryNoticeText} testID="c2c-claim-post-submit-recovery-text">
                    The previous submission response was lost or indeterminate and claim status could not be
                    confirmed yet. Check claim status before requesting a new OTP or submitting again.
                  </Text>
                  {!!postSubmitRecoveryNoticeError && (
                    <Text style={styles.errorText} testID="c2c-claim-post-submit-recovery-error">
                      {postSubmitRecoveryNoticeError}
                    </Text>
                  )}
                  <Button
                    label={postSubmitChecking ? 'Checking…' : 'Check claim status'}
                    loading={postSubmitChecking}
                    variant="outline"
                    onPress={() => void checkPostSubmitClaimRecovery()}
                    testID="c2c-claim-post-submit-recovery-button"
                  />
                </View>
              )}

              <Button
                loading={claimMutation.isPending}
                disabled={postSubmitRecoveryUnknown || postSubmitChecking}
                label={claimMutation.isPending ? 'Processing Claim…' : 'Execute Claim'}
                onPress={handleSubmit}
                testID="c2c-claim-submit"
                style={styles.button}
              />
            </Card>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

function isApiNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'ApiError' &&
    (error as Error & { status?: number }).status === 404
  );
}

function isLocatorNotAvailableError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== 'ApiError') return false;
  const { status, code } = error as Error & { status?: number; code?: string };
  return code === 'C2C_CLAIM_NOT_AVAILABLE' || status === 404;
}

function isLocatorRateLimitedError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== 'ApiError') return false;
  const { status, code } = error as Error & { status?: number; code?: string };
  return code === 'C2C_LOCATOR_RATE_LIMITED' || status === 429;
}

function isAmbiguousLocatorClaimError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  if (error.name === 'NetworkError') return true;
  if (error.name === 'ApiError') {
    const { status = 0, code } = error as Error & { status?: number; code?: string };
    return code === 'C2C_RETRY_REQUIRED' || status >= 500 || status === 408;
  }
  return true;
}

function isAmbiguousLegacyClaimError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  if (error.name === 'NetworkError') return true;
  if (error.name === 'ApiError') {
    const status = (error as Error & { status?: number }).status ?? 0;
    return status >= 500 || status === 408 || status === 429;
  }
  return true;
}

function isOtpChallengeInvalidatedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'ApiError' &&
    (error as Error & { status?: number }).status === 400 &&
    /OTP already used|OTP expired|Invalid OTP challenge/i.test(error.message)
  );
}

function shouldRecoverAfterLegacyClaimError(error: unknown): boolean {
  if (isAmbiguousLegacyClaimError(error)) return true;
  if (error instanceof Error && error.name === 'ApiError') {
    const status = (error as Error & { status?: number }).status;
    if (
      status === 409 &&
      /already claimed|concurrent retries|TRANSACTION_CONTENTION_RETRY_EXHAUSTED/i.test(error.message)
    ) {
      return true;
    }
    if (status === 400 && /OTP already used|REPLAYED/i.test(error.message)) {
      return true;
    }
  }
  return false;
}

interface SummaryRowProps {
  label: string;
  value: string;
  testID?: string;
}

const SummaryRow: React.FC<SummaryRowProps> = ({ label, value, testID }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue} testID={testID}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.neutral.offWhite },
  container: {
    flexGrow: 1,
    padding: theme.spacing.xl,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.md,
  },
  title: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
  },
  card: {},
  methodTitle: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.charcoal,
    marginBottom: theme.spacing.sm,
  },
  methodOptions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  methodOption: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    padding: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  methodOptionSelected: {
    borderColor: theme.colors.primary.main,
    backgroundColor: '#eff6ff',
  },
  methodOptionTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.charcoal,
  },
  methodOptionText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    lineHeight: 16,
  },
  methodNotice: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    lineHeight: 17,
    marginTop: theme.spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
  },
  rowLabel: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
  },
  rowValue: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.charcoal,
    flexShrink: 1,
    textAlign: 'right',
  },
  note: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.gray,
    lineHeight: 17,
    marginTop: theme.spacing.sm,
  },
  helper: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    lineHeight: 17,
    marginBottom: theme.spacing.sm,
  },
  errorText: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    marginBottom: theme.spacing.sm,
  },
  recoveryNoticeBox: {
    backgroundColor: theme.colors.feedback.warningLight,
    borderRadius: 8,
    padding: theme.spacing.sm,
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  recoveryNoticeText: {
    color: theme.colors.neutral.charcoal,
    fontSize: theme.typography.sizes.xs,
    lineHeight: 17,
  },
  button: { marginTop: theme.spacing.xs },
});
