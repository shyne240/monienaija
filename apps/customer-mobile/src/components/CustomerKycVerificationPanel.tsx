import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type ViewProps } from 'react-native';
import * as Crypto from 'expo-crypto';

import { Button } from './Button';
import { Input } from './Input';
import { ApiError } from '../services/api-client';
import type {
  CustomerKycAvailability,
  CustomerKycKind,
  CustomerKycWorkflowClient,
  CustomerKycWorkflowStatus,
} from '../services/customer-kyc-verification';
import { statusLabel } from '../services/presentation';
import { theme } from '../theme';

interface Props {
  api: CustomerKycWorkflowClient;
  workflow: CustomerKycWorkflowStatus | null;
  onRefresh: () => Promise<void> | void;
  onLayout?: ViewProps['onLayout'];
}

async function newRequestId(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function providerLabel(provider: CustomerKycAvailability['provider']): string {
  if (provider === 'PREMBLY') return 'Prembly';
  if (provider === 'DOJAH') return 'Dojah';
  if (provider === 'MONNIFY') return 'Monnify';
  return 'Unavailable';
}

function workflowLock(workflow: CustomerKycWorkflowStatus | null, kind: CustomerKycKind) {
  const latest = workflow?.history.find((item) => item.kind === kind);
  if (!latest) return { latest: null, reason: null as string | null };
  if (['DISPATCHING', 'UNKNOWN', 'CONSENT_WITHDRAWN'].includes(latest.status)) {
    return {
      latest,
      reason:
        'A prior request has no safe final outcome yet. Do not create another request; refresh this status or contact MonieNaija support for review.',
    };
  }
  if (latest.status === 'MATCH' && latest.expiresAt && Date.parse(latest.expiresAt) > Date.now()) {
    return {
      latest,
      reason:
        'A current identity result is already on record. No duplicate verification request is needed.',
    };
  }
  return { latest, reason: null };
}

/**
 * Customer-initiated KYC with explicit, versioned consent and durable request IDs. The identity
 * number stays only in component memory; the component never writes it to local storage or logs.
 */
export const CustomerKycVerificationPanel: React.FC<Props> = ({
  api,
  workflow,
  onRefresh,
  onLayout,
}) => {
  const [kind, setKind] = useState<CustomerKycKind>('BVN');
  const [identifier, setIdentifier] = useState('');
  const [availability, setAvailability] = useState<CustomerKycAvailability | null>(null);
  const [consent, setConsent] = useState<{ id: string; expiresAt: string } | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [consentRequestId, setConsentRequestId] = useState<string | null>(null);
  const [verificationRequestId, setVerificationRequestId] = useState<string | null>(null);
  const [submittedIdentifier, setSubmittedIdentifier] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  const locked = useMemo(() => workflowLock(workflow, kind), [workflow, kind]);
  const recoverableConsent = useMemo(
    () => workflow?.consents?.find((item) => item.kind === kind) ?? null,
    [workflow, kind],
  );
  const uncertainRetryAvailable = verificationRequestId !== null && submittedIdentifier !== null;

  const selectKind = (next: CustomerKycKind) => {
    if (busy || busyRef.current || next === kind) return;
    setKind(next);
    setAvailability(null);
    setConsent(null);
    setAccepted(false);
    setConsentRequestId(null);
    setVerificationRequestId(null);
    setSubmittedIdentifier(null);
    setIdentifier('');
    setError('');
    setResult('');
  };

  const checkAvailability = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setResult('');
    setAvailability(null);
    setConsent(null);
    setAccepted(false);
    try {
      const current = await api.availability(kind);
      setAvailability(current);
      if (current.status !== 'AVAILABLE' || !current.provider || !current.routeVersion) {
        setError(
          'Identity verification is not configured for this request. No identity number was sent.',
        );
      }
    } catch {
      setError(
        'Identity verification availability could not be confirmed. No identity number was sent.',
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const resumeConsent = async () => {
    if (!recoverableConsent || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setResult('');
    try {
      const current = await api.availability(kind);
      if (
        current.status !== 'AVAILABLE' ||
        current.provider !== recoverableConsent.provider ||
        current.routeVersion !== recoverableConsent.routeVersion
      ) {
        setAvailability(null);
        setConsent(null);
        setError(
          'The saved consent no longer matches the approved verification route. Refresh status before continuing.',
        );
        return;
      }
      setAvailability(current);
      setConsent({ id: recoverableConsent.id, expiresAt: recoverableConsent.expiresAt });
      setAccepted(true);
      setResult('Your active consent was recovered. Enter your identity number to continue.');
    } catch {
      setError(
        'The active consent could not be confirmed. Refresh verification status to continue.',
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const recordConsent = async () => {
    const notice = availability?.consentNotice;
    if (
      !availability ||
      availability.status !== 'AVAILABLE' ||
      !availability.provider ||
      !availability.routeVersion ||
      !notice ||
      !accepted
    )
      return;
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setResult('');
    try {
      const requestId = consentRequestId ?? (await newRequestId());
      setConsentRequestId(requestId);
      const recorded = await api.grantConsent({
        requestId,
        kind,
        accepted: true,
        noticeVersion: notice.version,
        expectedProvider: availability.provider,
        expectedRouteVersion: availability.routeVersion,
      });
      setConsent({ id: recorded.id, expiresAt: recorded.expiresAt });
      setConsentRequestId(null);
      setResult('Consent recorded. No identity number has been sent yet.');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setAvailability(null);
        setConsent(null);
        setAccepted(false);
        setConsentRequestId(null);
        setError(
          'The approved verification route changed. Check availability and review the notice again.',
        );
      } else {
        setError(
          'Consent could not be confirmed. You can retry without creating a duplicate consent.',
        );
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const withdrawConsent = async () => {
    if (!consent || verificationRequestId || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setResult('');
    try {
      await api.withdrawConsent(consent.id);
      setConsent(null);
      setAccepted(false);
      setAvailability(null);
      setResult('Consent withdrawn. No identity number was sent.');
      await onRefresh();
    } catch {
      setError(
        'Consent withdrawal could not be confirmed. Refresh the verification status before continuing.',
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const verify = async () => {
    if (
      !consent ||
      !/^\d{11}$/.test(identifier) ||
      (locked.reason !== null && !uncertainRetryAvailable)
    )
      return;
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setResult('');
    try {
      const requestId = verificationRequestId ?? (await newRequestId());
      const submitted = submittedIdentifier ?? identifier;
      if (submitted !== identifier) {
        setError('Retry with the same identifier used for the original request.');
        return;
      }
      setVerificationRequestId(requestId);
      setSubmittedIdentifier(submitted);
      const response = await api.verify({
        requestId,
        consentId: consent.id,
        kind,
        identifier: submitted,
      });
      if (response.status === 'DISPATCHING') {
        setResult(
          'Verification is still processing. Refresh or check the same request; do not start another one.',
        );
      } else if (response.status === 'UNKNOWN' || response.status === 'CONSENT_WITHDRAWN') {
        setResult(
          'The provider outcome is not confirmed. Do not submit again; the request needs safe review.',
        );
        setIdentifier('');
        setVerificationRequestId(null);
        setSubmittedIdentifier(null);
        setConsent(null);
        setAvailability(null);
      } else if (response.status === 'MATCH') {
        setResult(
          'The identity check completed. Your current tier and financial eligibility change only after the governed assessment is applied.',
        );
        setIdentifier('');
        setVerificationRequestId(null);
        setSubmittedIdentifier(null);
        setConsent(null);
        setAvailability(null);
      } else {
        setResult(
          'The identity check needs review. Your current tier and limits remain unchanged while it is reviewed.',
        );
        setIdentifier('');
        setVerificationRequestId(null);
        setSubmittedIdentifier(null);
        setConsent(null);
        setAvailability(null);
      }
      await onRefresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setError(
          'The customer identity or approved provider route changed. Refresh status before continuing.',
        );
      } else if (caught instanceof ApiError && caught.status === 400) {
        setVerificationRequestId(null);
        setSubmittedIdentifier(null);
        setError(
          'The verification request was rejected before processing. Check the number and consent details.',
        );
      } else if (caught instanceof ApiError && caught.status === 401) {
        setError(
          'Your session needs to be refreshed. The identity number has not been saved on this device.',
        );
      } else {
        setError(
          'The response was not confirmed. Retry only with the same number and request; the server prevents a duplicate provider call.',
        );
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <View style={styles.card} onLayout={onLayout}>
      <Text style={styles.title}>Identity verification</Text>
      <Text style={styles.body}>
        Verification is optional until you choose to continue. The approved policy and backend
        decide any tier change; this screen never changes your tier or limits.
      </Text>
      {!workflow ? (
        <Text style={styles.note}>
          Verification status is unavailable. Retry before submitting any information.
        </Text>
      ) : !workflow.verificationEnabled ? (
        <Text style={styles.note}>
          Identity verification is not currently enabled. No identity number will be collected or
          sent.
        </Text>
      ) : (
        <>
          <View style={styles.kindButtons}>
            <Button
              label={kind === 'BVN' ? 'Selected: BVN' : 'Use BVN'}
              variant={kind === 'BVN' ? 'primary' : 'outline'}
              size="small"
              disabled={busy || uncertainRetryAvailable}
              onPress={() => selectKind('BVN')}
            />
            <Button
              label={kind === 'NIN' ? 'Selected: NIN' : 'Use NIN'}
              variant={kind === 'NIN' ? 'primary' : 'outline'}
              size="small"
              disabled={busy || uncertainRetryAvailable}
              onPress={() => selectKind('NIN')}
            />
          </View>
          {locked.latest ? (
            <Text style={styles.note}>
              Latest {kind} check: {statusLabel(locked.latest.status)}.
              {locked.latest.completedAt
                ? ` Completed ${new Date(locked.latest.completedAt).toLocaleString('en-NG')}.`
                : ''}
            </Text>
          ) : null}
          {locked.reason && !uncertainRetryAvailable ? (
            <Text style={styles.alert}>{locked.reason}</Text>
          ) : null}
          {locked.reason && uncertainRetryAvailable ? (
            <Text style={styles.note}>
              This is a retry of the same request. The number remains only in memory until the
              request is confirmed.
            </Text>
          ) : null}
          {!locked.reason && !availability ? (
            <>
              <Button
                label={`Check ${kind} verification availability`}
                variant="outline"
                loading={busy}
                disabled={busy}
                onPress={() => void checkAvailability()}
              />
              {recoverableConsent ? (
                <Button
                  label={`Resume active ${kind} consent`}
                  variant="text"
                  size="small"
                  disabled={busy}
                  onPress={() => void resumeConsent()}
                />
              ) : null}
            </>
          ) : null}
          {availability?.status === 'AVAILABLE' && (!locked.reason || uncertainRetryAvailable) ? (
            <>
              <Text style={styles.note}>
                Verification provider: {providerLabel(availability.provider)}.
              </Text>
              {availability.consentNotice ? (
                <View style={styles.notice}>
                  <Text style={styles.noticeTitle}>
                    Verification consent · {availability.consentNotice.version}
                  </Text>
                  <Text style={styles.body}>{availability.consentNotice.text}</Text>
                </View>
              ) : (
                <Text style={styles.alert}>
                  An approved consent notice is not available; verification cannot continue.
                </Text>
              )}
              {!consent ? (
                <>
                  <Button
                    label={accepted ? 'Consent accepted' : 'I have read and accept this notice'}
                    variant={accepted ? 'secondary' : 'outline'}
                    size="small"
                    disabled={busy || !availability.consentNotice}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: accepted }}
                    onPress={() => setAccepted((value) => !value)}
                  />
                  <Button
                    label="Record consent"
                    loading={busy}
                    disabled={
                      busy || locked.reason !== null || !accepted || !availability.consentNotice
                    }
                    onPress={() => void recordConsent()}
                  />
                </>
              ) : (
                <>
                  <Text style={styles.note}>
                    Consent is active until {new Date(consent.expiresAt).toLocaleString('en-NG')}.
                  </Text>
                  <Input
                    label={`${kind} number`}
                    value={identifier}
                    onChangeText={setIdentifier}
                    keyboardType="number-pad"
                    maxLength={11}
                    secureTextEntry
                    editable={!busy && verificationRequestId === null}
                    autoComplete="off"
                    textContentType="none"
                    accessibilityLabel={`${kind} number, secure entry`}
                  />
                  <Button
                    label={
                      verificationRequestId ? 'Check the same request' : 'Submit for verification'
                    }
                    loading={busy}
                    disabled={
                      busy ||
                      (locked.reason !== null && !uncertainRetryAvailable) ||
                      !/^\d{11}$/.test(identifier)
                    }
                    onPress={() => void verify()}
                  />
                  {!verificationRequestId ? (
                    <Button
                      label="Withdraw consent"
                      variant="text"
                      size="small"
                      disabled={busy}
                      onPress={() => void withdrawConsent()}
                    />
                  ) : null}
                </>
              )}
            </>
          ) : availability?.status === 'CONFIGURATION_INCOMPLETE' ? (
            <Text style={styles.alert}>
              Verification is not available under the current approved configuration.
            </Text>
          ) : null}
        </>
      )}
      {error ? (
        <Text style={styles.alert} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {result ? (
        <Text style={styles.note} accessibilityLiveRegion="polite">
          {result}
        </Text>
      ) : null}
      <Button
        label="Refresh verification status"
        variant="text"
        size="small"
        disabled={busy}
        onPress={() => void onRefresh()}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.surface.hairline,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  title: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.dark,
    marginBottom: theme.spacing.xs,
  },
  body: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.charcoal,
    lineHeight: 20,
    marginBottom: theme.spacing.sm,
  },
  note: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    lineHeight: 18,
    marginVertical: theme.spacing.sm,
  },
  alert: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.feedback.error,
    lineHeight: 18,
    marginVertical: theme.spacing.sm,
  },
  kindButtons: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginVertical: theme.spacing.sm,
  },
  notice: {
    backgroundColor: theme.colors.surface.cream,
    borderRadius: 10,
    padding: theme.spacing.md,
    marginVertical: theme.spacing.sm,
  },
  noticeTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.primary.dark,
    marginBottom: theme.spacing.xs,
  },
});
