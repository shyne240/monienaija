import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation } from '@tanstack/react-query';

import { theme } from '../../../theme';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { Input } from '../../../components/Input';
import {
  describeApiError,
  resolveAgentRecipient,
  type ResolvedRecipientView,
} from '../../../services/agent-api';
import type { RootStackParamList } from '../../../navigation/types';

/**
 * Normalizes any Nigerian phone number or receiving number to 10-digit canonical form.
 * Matches backend AgentReceivingNumberService.canonicalizeTo10.
 */
export function canonicalizePhoneNumber(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  let digits = input.replace(/[\s()+-]/g, '').trim();
  if (digits.startsWith('234')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;
  if (!/^[789]\d{9}$/.test(digits)) return null;
  return digits;
}

/**
 * Cash→Cash — Step 1: Beneficiary Phone (V1-AGENT-MOBILE-07 / C2C-1).
 *
 * The agent enters the beneficiary's Nigerian phone number.
 * The sender's cash is collected while the transfer principal is reserved for an eligible Customer's claim.
 * If verified via the resolver, AGENT recipients are strictly blocked (backend rule).
 * Unregistered recipients remain valid initiation targets but must register before a claim can be completed.
 * Never exposes internal database or customer IDs.
 */
export const CashToCashRecipientScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [senderPhoneInput, setSenderPhoneInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [clientError, setClientError] = useState('');
  const [resolvedView, setResolvedView] = useState<ResolvedRecipientView | null>(null);
  const [isUnregistered, setIsUnregistered] = useState(false);

  const resolveMutation = useMutation({
    mutationFn: (canonical: string) => resolveAgentRecipient(canonical),
    onSuccess: (view) => {
      setResolvedView(view);
      setIsUnregistered(false);
      if (view.ownerType === 'AGENT') {
        setClientError('Agent recipients cannot receive Cash→Cash.');
      } else {
        setClientError('');
      }
    },
    onError: (err: any) => {
      // 404 from resolver means unregistered beneficiary — the standard target for Cash→Cash!
      if (err?.status === 404 || err?.message?.includes('not found')) {
        setIsUnregistered(true);
        setResolvedView(null);
        setClientError('');
      } else {
        setClientError(describeApiError(err));
      }
    },
  });

  const getCanonicalOrSetError = (): string | null => {
    const canonical = canonicalizePhoneNumber(phoneInput);
    if (!canonical) {
      setClientError('Enter a valid 10-digit Nigerian phone number (e.g. 08012345678)');
      return null;
    }
    return canonical;
  };

  const handleVerify = () => {
    const canonical = getCanonicalOrSetError();
    if (!canonical) return;
    setClientError('');
    resolveMutation.mutate(canonical);
  };

  const handleContinue = () => {
    const canonical = getCanonicalOrSetError();
    if (!canonical) return;
    const canonicalSender = canonicalizePhoneNumber(senderPhoneInput);
    if (!canonicalSender) {
      setClientError('Enter a valid 10-digit Nigerian sender phone number (e.g. 08031234567)');
      return;
    }
    if (resolvedView?.ownerType === 'AGENT') {
      setClientError('Agent recipients cannot receive Cash→Cash.');
      return;
    }
    setClientError('');
    navigation.navigate('CashToCashAmount', {
      senderPhone: canonicalSender,
      beneficiaryPhone: canonical,
    });
  };

  const isAgent = resolvedView?.ownerType === 'AGENT';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Send cash to beneficiary</Text>
        <Text style={styles.helper} testID="c2c-settlement-method-notice">
          Collect the sender&apos;s physical cash and enter the sending customer&apos;s phone number and
          the recipient&apos;s phone number. At claim, settlement can credit the beneficiary Customer
          wallet or the claiming Agent&apos;s NGN float for cash payout. Physical cash handover is separate
          from this ledger settlement.
        </Text>

        <Card style={styles.card}>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="phone-pad"
            label="Sender phone number"
            placeholder="e.g. 08031234567"
            value={senderPhoneInput}
            maxLength={20}
            testID="sender-phone-input"
            onChangeText={(text) => {
              setSenderPhoneInput(text);
              setClientError('');
            }}
          />
          <Text style={styles.helper} testID="sender-phone-notice">
            Enter the sending customer&apos;s Nigerian phone number (never your Agent login phone). Confirm
            it carefully before sending — the issued sender phone and 6-digit transfer number cannot be
            edited later.
          </Text>

          <Input
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="phone-pad"
            label="Beneficiary phone number"
            placeholder="e.g. 08012345678"
            value={phoneInput}
            maxLength={18}
            testID="beneficiary-phone-input"
            onChangeText={(text) => {
              setPhoneInput(text);
              setClientError('');
              setResolvedView(null);
              setIsUnregistered(false);
              resolveMutation.reset();
            }}
          />
          <View style={styles.buttonRow}>
            <Button
              loading={resolveMutation.isPending}
              label="Verify phone (optional)"
              variant="outline"
              onPress={handleVerify}
              testID="beneficiary-verify-button"
            />
          </View>
        </Card>

        {(!!clientError || (resolveMutation.isError && !isUnregistered)) && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText} testID="beneficiary-error">
              {clientError || describeApiError(resolveMutation.error)}
            </Text>
          </View>
        )}

        {resolveMutation.isPending && (
          <Text style={styles.muted} testID="beneficiary-resolving">Verifying phone number…</Text>
        )}

        {isUnregistered && (
          <Card style={styles.card} testID="beneficiary-unregistered-card">
            <Text style={styles.sectionTitle}>Unregistered Beneficiary</Text>
            <Text style={styles.infoText}>
              This phone is unregistered. The recipient must register and become eligible before a claim
              can be completed. An eligible claim can credit the Customer wallet or the claiming Agent's
              NGN float for cash payout; physical handover is separate from ledger settlement.
            </Text>
          </Card>
        )}

        {resolvedView && (
          <Card style={styles.card} testID="beneficiary-resolved-card">
            <Text style={styles.sectionTitle}>
              {resolvedView.ownerType === 'CUSTOMER' ? 'Registered Customer' : 'Agent Account'}
            </Text>
            <Text style={styles.displayName} testID="beneficiary-display">{resolvedView.display}</Text>
            <Text selectable style={styles.receivingNumber} testID="beneficiary-number">
              {resolvedView.receivingNumber}
            </Text>
            {isAgent && (
              <Text style={styles.errorText} testID="beneficiary-agent-ineligible">
                Agent accounts cannot receive Cash→Cash transfers.
              </Text>
            )}
          </Card>
        )}

        {!isAgent && (
          <Button label="Continue to Amount" onPress={handleContinue} testID="beneficiary-continue" />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

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
  helper: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    lineHeight: 20,
  },
  card: {},
  buttonRow: {
    marginTop: theme.spacing.xs,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.primary.main,
    marginBottom: theme.spacing.xs,
  },
  displayName: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.charcoal,
  },
  receivingNumber: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1.5,
    color: theme.colors.neutral.charcoal,
    fontVariant: ['tabular-nums'],
    marginVertical: theme.spacing.xs,
  },
  infoText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    lineHeight: 18,
  },
  muted: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
  },
  errorBanner: {
    backgroundColor: theme.colors.feedback.errorLight,
    borderRadius: 8,
    padding: theme.spacing.md,
  },
  errorText: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
  },
});
