import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';

/**
 * ARENA 4 — the distinct verification states a customer must be able to tell apart.
 *
 * These map 1:1 onto outcomes the backend actually reports. `SUCCESS` is only ever rendered for a
 * backend-confirmed match: nothing in the client may promote a pending, unavailable or review
 * state into success.
 */
export type VerificationState =
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'MISMATCH'
  | 'UNAVAILABLE'
  | 'ADDITIONAL_INFO'
  | 'MANUAL_REVIEW';

interface VerificationNoticeProps {
  state: VerificationState;
  /** Optional backend-supplied detail. Rendered verbatim; never paraphrased into a success. */
  detail?: string | null;
  testID?: string;
}

interface NoticeCopy {
  title: string;
  body: string;
  tone: 'success' | 'warning' | 'error' | 'neutral';
}

export function verificationCopy(state: VerificationState): NoticeCopy {
  switch (state) {
    case 'SUCCESS':
      return {
        title: 'Verification successful',
        body: 'The backend matched your details. This confirms identity verification only — your account still needs every remaining onboarding requirement before financial services are available.',
        tone: 'success',
      };
    case 'PENDING':
      return {
        title: 'Verification pending',
        body: 'The request was recorded but no decision has been returned yet. Do not submit it again; this same request will resolve to a final status.',
        tone: 'warning',
      };
    case 'FAILED':
      return {
        title: 'Verification failed',
        body: 'The verification attempt was rejected. Nothing was recorded as verified.',
        tone: 'error',
      };
    case 'MISMATCH':
      return {
        title: 'Information mismatch',
        body: 'The details you gave do not match the records held for this identity. Check what you typed before trying again.',
        tone: 'error',
      };
    case 'UNAVAILABLE':
      return {
        title: 'Verification service unavailable',
        body: 'We could not reach the verification service, so nothing was verified and nothing was charged. Try again later.',
        tone: 'neutral',
      };
    case 'ADDITIONAL_INFO':
      return {
        title: 'More information needed',
        body: 'MonieNaija needs an additional detail before this can be verified. Review the request and supply what is missing.',
        tone: 'warning',
      };
    case 'MANUAL_REVIEW':
    default:
      return {
        title: 'Manual review required',
        body: 'This verification has been referred to a MonieNaija reviewer. You cannot complete it by resubmitting; support can tell you what happens next.',
        tone: 'warning',
      };
  }
}

export const VerificationNotice: React.FC<VerificationNoticeProps> = ({
  state,
  detail,
  testID = 'verification-notice',
}) => {
  const copy = verificationCopy(state);
  const palette = {
    success: {
      background: theme.colors.feedback.successLight,
      accent: theme.colors.feedback.success,
    },
    warning: {
      background: theme.colors.feedback.warningLight,
      accent: theme.colors.feedback.warning,
    },
    error: { background: theme.colors.feedback.errorLight, accent: theme.colors.feedback.error },
    neutral: { background: theme.colors.surface.mist, accent: theme.colors.primary.main },
  }[copy.tone];

  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={`${copy.title}. ${copy.body}`}
      testID={testID}
      style={[
        styles.container,
        { backgroundColor: palette.background, borderColor: palette.accent },
      ]}
    >
      <Text style={[styles.title, { color: palette.accent }]}>{copy.title}</Text>
      <Text style={styles.body}>{copy.body}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderLeftWidth: 3,
    borderRadius: 10,
    padding: theme.spacing.md,
    marginVertical: theme.spacing.md,
    gap: theme.spacing.xxs,
  },
  title: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
  },
  body: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.charcoal,
    lineHeight: 18,
  },
  detail: {
    fontSize: 10,
    letterSpacing: 0.4,
    color: theme.colors.neutral.slate,
  },
});
