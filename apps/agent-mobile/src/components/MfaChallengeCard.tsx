import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';

import { theme } from '../theme';
import { Card } from './Card';
import { Button } from './Button';
import {
  describeApiError,
  requestAgentMfaChallenge,
  type AgentMfaChallenge,
  type MfaChallengePurpose,
} from '../services/agent-api';
import {
  formatChallengeCountdown,
  isChallengeExpired,
  remainingChallengeSeconds,
  type MfaChallengeState,
} from '../services/mfa-challenge';

/**
 * Reusable customer-MFA challenge card (V1-AGENT-MOBILE-03).
 *
 * - Requests a challenge from POST /agents/me/mfa-challenges ONLY (backend is
 *   the sole authority for issuance, delivery, ttl and masking).
 * - The OTP is for the CUSTOMER (customer-factor ownership): the code goes to
 *   the customer's verified phone; the app displays the server's masked
 *   destination and never resolves/holds any phone number or OTP.
 * - NO OTP input is rendered: the backend exposes no standalone Agent-facing
 *   verification endpoint (V1-AGENT-MFA-API-01 is issue-only). The OTP is
 *   supplied later to the transaction-execution endpoints; that UI belongs
 *   to the transaction phase. challengeId (server-issued identity) is
 *   surfaced to the caller via onChallengeReady for that later flow.
 * - Expiry uses the server's expiresAt/ttlSeconds only — never hard-coded,
 *   never polled over the network.
 */

export interface MfaChallengeCardProps {
  /** UUID of the customer involved in the transaction (from the future flow). */
  customerId: string;
  purpose: MfaChallengePurpose;
  /** Optional override — forwarded only because the caller supplied it. */
  ttlSeconds?: number;
  /**
   * Called with the server-issued challenge once delivered. The future
   * transaction flow uses this (challengeId) for its execution request.
   */
  onChallengeReady?: (challenge: AgentMfaChallenge) => void;
  testID?: string;
}

const PURPOSE_COPY: Record<MfaChallengePurpose, { title: string; summary: string }> = {
  WALLET_TO_CASH: {
    title: 'Customer Verification',
    summary:
      'To complete this cash-out, the customer must confirm a one-time code sent to their phone.',
  },
  CASH_TO_CASH_CLAIM: {
    title: 'Recipient Verification',
    summary:
      'To release this cash-to-cash claim, the customer must confirm a one-time code sent to their phone.',
  },
};

export const MfaChallengeCard: React.FC<MfaChallengeCardProps> = ({
  customerId,
  purpose,
  ttlSeconds,
  onChallengeReady,
  testID,
}) => {
  const [challenge, setChallenge] = useState<AgentMfaChallenge | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const requestMutation = useMutation({
    mutationFn: () => requestAgentMfaChallenge(customerId, purpose, ttlSeconds),
    onSuccess: (issued) => {
      setChallenge(issued);
      setNow(Date.now());
      onChallengeReady?.(issued);
    },
  });

  useEffect(() => {
    if (!challenge || isChallengeExpired(challenge, now)) return;
    const timeout = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(timeout);
  }, [challenge, now]);

  const state: MfaChallengeState = useMemo(() => {
    if (requestMutation.isPending) {
      return { status: 'requesting', challenge: null, failureMessage: null };
    }
    if (requestMutation.isError) {
      return {
        status: 'failed',
        challenge: null,
        failureMessage: describeApiError(requestMutation.error),
      };
    }
    if (!challenge) {
      return { status: 'idle', challenge: null, failureMessage: null };
    }
    if (isChallengeExpired(challenge, now)) {
      return { status: 'expired', challenge, failureMessage: null };
    }
    return { status: 'ready', challenge, failureMessage: null };
  }, [requestMutation.isPending, requestMutation.isError, requestMutation.error, challenge, now]);

  const request = useCallback(() => {
    // Duplicate-request guard: one in-flight request at a time, always.
    if (requestMutation.isPending) return;
    setChallenge(null);
    requestMutation.mutate();
  }, [requestMutation]);

  const copy = PURPOSE_COPY[purpose];
  const challengeState = challenge ? state.status : null;

  return (
    <Card style={styles.card} testID={testID ?? 'mfa-challenge-card'}>
      <Text style={styles.title}>{copy.title}</Text>

      {state.status === 'idle' && (
        <>
          <Text style={styles.body}>{copy.summary}</Text>
          <Button label="Send verification code" onPress={request} testID="mfa-request-button" />
        </>
      )}

      {state.status === 'requesting' && (
        <>
          <Text style={styles.body} testID="mfa-requesting">
            Sending verification code to the customer's phone...
          </Text>
          <Button loading label="Sending…" onPress={request} disabled testID="mfa-requesting-button" />
        </>
      )}

      {state.status === 'failed' && (
        <>
          <Text style={styles.errorText} testID="mfa-failure">{state.failureMessage}</Text>
          <Button label="Try again" variant="outline" onPress={request} testID="mfa-retry-button" />
        </>
      )}

      {state.status === 'ready' && state.challenge && (
        <>
          <Text style={styles.successTitle} testID="mfa-ready-title">Verification code sent</Text>
          <Text style={styles.body}>
            One-time code sent by {state.challenge.deliveryChannel} to the customer at{' '}
            <Text style={styles.masked} testID="mfa-destination-masked">
              {state.challenge.destinationMasked}
            </Text>
          </Text>
          <Text style={styles.countdown} testID="mfa-countdown">
            Code expires in{' '}
            {formatChallengeCountdown(remainingChallengeSeconds(state.challenge, now))}
          </Text>
          <Text style={styles.bodySmall}>
            Ask the customer to read you the code. The code goes only to the customer's phone —
            MoneyNaija staff will never ask you for it.
          </Text>
          {challengeState === 'ready' && (
            <Button
              label="Request a new code"
              variant="outline"
              onPress={request}
              testID="mfa-resend-button"
            />
          )}
        </>
      )}

      {state.status === 'expired' && (
        <>
          <Text style={styles.expiredText} testID="mfa-expired">
            The verification code has expired.
          </Text>
          <Button label="Request a new code" variant="outline" onPress={request} testID="mfa-expired-resend" />
        </>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: theme.spacing.md,
  },
  title: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.primary.main,
    marginBottom: theme.spacing.sm,
  },
  successTitle: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.feedback.success,
    marginBottom: theme.spacing.sm,
  },
  body: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    lineHeight: 20,
    marginBottom: theme.spacing.md,
  },
  bodySmall: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.gray,
    lineHeight: 17,
    marginBottom: theme.spacing.md,
  },
  masked: {
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.charcoal,
    letterSpacing: 1,
  },
  countdown: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.secondary.dark,
    marginBottom: theme.spacing.sm,
  },
  errorText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.feedback.error,
    fontWeight: theme.typography.weights.medium,
    marginBottom: theme.spacing.sm,
  },
  expiredText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.feedback.warning,
    fontWeight: theme.typography.weights.semibold,
    marginBottom: theme.spacing.sm,
  },
});
