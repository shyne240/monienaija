import React, { useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../../theme';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import {
  AgentReceipt,
  buildPublicCashToCashLocatorShareText,
  receiptFromCashToCashResult,
} from '../../../components/AgentReceipt';
import {
  clearPendingTransferCode,
  consumePendingTransferCode,
} from '../../../services/agent-api';
import type { RootStackParamList } from '../../../navigation/types';

/**
 * Cash→Cash — Step 4: Display-Once Result & Receipt (V1-AGENT-MOBILE-07 / C2C-5 / C2C-8 + ARENA 1 Locator).
 *
 * CRITICAL SECURITY DISCIPLINE:
 * - transferCode is consumed once from in-memory handover and held only in
 *   ephemeral component state during this render.
 * - transferCode is NEVER placed in navigation params, NEVER in Zustand, NEVER in
 *   TanStack Query, NEVER in SecureStore, NEVER in logs, NEVER in AgentReceipt,
 *   and NEVER in public locator copy/share text or receipt share text.
 * - Six-digit transferNumber is rendered strictly as text preserving leading zeros
 *   (e.g. "000042") alongside normalized senderPhone, clearly separated from the
 *   secret one-time transferCode.
 * - On component unmount / screen exit, all transferCode references are cleared.
 */
export const CashToCashSuccessScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CashToCashSuccess'>>();
  const { result } = route.params;

  // Single-use retrieval from ephemeral in-memory handover.
  const [transferCode, setTransferCode] = useState<string | null>(() => consumePendingTransferCode());
  const [copyFeedback, setCopyFeedback] = useState('');

  // Strict cleanup on exit/unmount
  useEffect(() => {
    return () => {
      setTransferCode(null);
      clearPendingTransferCode();
    };
  }, []);

  const replayed = result.replayed === true || result.status === 'REPLAYED';
  const receipt = receiptFromCashToCashResult(result);
  const publicLocatorShareText = buildPublicCashToCashLocatorShareText(result);

  const handleShareLocator = () => {
    if (!publicLocatorShareText) return;
    void Share.share({ message: publicLocatorShareText });
  };

  const handleCopyLocator = async () => {
    if (!publicLocatorShareText) return;
    const clipboard = (
      globalThis as unknown as {
        navigator?: { clipboard?: { writeText?: (text: string) => Promise<void> } };
      }
    ).navigator?.clipboard;
    if (clipboard?.writeText) {
      try {
        await clipboard.writeText(publicLocatorShareText);
        setCopyFeedback('Claim locator copied (secret code excluded).');
        return;
      } catch {
        // Fall through to React Native Share sheet if browser/runtime clipboard is unavailable.
      }
    }
    await Share.share({ message: publicLocatorShareText });
    setCopyFeedback('Claim locator ready to share (secret code excluded).');
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.checkMark}>✓</Text>
        <Text style={styles.heroTitle} testID="c2c-success-title">
          {replayed ? 'Already recorded' : 'Cash transfer initiated'}
        </Text>
        <Text style={styles.heroSubtitle}>
          {replayed
            ? 'This submission matched an earlier one (idempotent replay) — no new transfer was created.'
            : 'Funds are reserved. An eligible claim can credit the beneficiary Customer wallet or the claiming Agent’s NGN float for cash payout. Physical cash handover is separate from this ledger settlement.'}
        </Text>
      </View>

      {/* Public Claim Locator Card (safe to copy/share — NEVER includes transferCode) */}
      {publicLocatorShareText && result.transferNumber && result.senderPhone && (
        <Card style={styles.locatorCard} testID="c2c-public-locator-card">
          <Text style={styles.locatorHeader}>Public Claim Locator (Safe to Share)</Text>
          <Text style={styles.locatorLabel}>6-Digit Transfer Number</Text>
          <Text selectable style={styles.transferNumber} testID="c2c-transfer-number">
            {result.transferNumber}
          </Text>
          <View style={styles.locatorRow}>
            <Text style={styles.locatorRowLabel}>Sender Phone (Normalized)</Text>
            <Text selectable style={styles.locatorRowValue} testID="c2c-sender-phone">
              {result.senderPhone}
            </Text>
          </View>
          <Text style={styles.locatorNote} testID="c2c-locator-instructions">
            Provide BOTH this 6-digit transfer number (keeping all leading zeros) and the normalized
            sender phone to locate the transfer at a claiming Agent. This public locator is NOT the
            secret transfer code.
          </Text>
          <View style={styles.locatorActions}>
            <Button
              label="Copy claim locator"
              variant="outline"
              onPress={() => {
                void handleCopyLocator();
              }}
              testID="c2c-copy-locator-button"
              style={styles.locatorActionButton}
            />
            <Button
              label="Share claim locator"
              variant="outline"
              onPress={handleShareLocator}
              testID="c2c-share-locator-button"
              style={styles.locatorActionButton}
            />
          </View>
          {!!copyFeedback && (
            <Text style={styles.copyFeedback} testID="c2c-locator-copied-feedback">
              {copyFeedback}
            </Text>
          )}
        </Card>
      )}

      {/* Prominent Display-Once Secret Transfer Code Card (strictly separated from public locator) */}
      {transferCode ? (
        <Card style={styles.codeCard} testID="c2c-transfer-code-card">
          <Text style={styles.codeCardHeader}>One-Time Secret Transfer Code</Text>
          <Text selectable style={styles.transferCode} testID="c2c-transfer-code">
            {transferCode}
          </Text>
          <View style={styles.warningBox}>
            <Text style={styles.warningText}>
              DISPLAY-ONCE CODE: Share this secret code PRIVATELY ONLY with the named beneficiary (
              {result.beneficiaryPhone}). Do NOT include this secret code in any public notification or
              ordinary share message. Redemption requires the public locator above PLUS this secret code
              and beneficiary OTP verification. Agent-cash mode also requires the claiming Agent&apos;s
              CASH_TO_CASH capability and transaction PIN. The code alone does not authorize physical cash
              handover and cannot be viewed again after leaving this screen.
            </Text>
          </View>
        </Card>
      ) : (
        <Card style={styles.card} testID="c2c-replay-card">
          <Text style={styles.muted} testID="c2c-replay-note">
            Transfer code was issued during initial creation and is not shown on replay or subsequent views.
          </Text>
        </Card>
      )}

      {/* Shared Receipt Component (transferCode is strictly excluded by design) */}
      <AgentReceipt receipt={receipt} testID="c2c-receipt" />

      <Button
        label="View transaction history"
        variant="outline"
        onPress={() =>
          navigation.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Transactions' }] })
        }
        testID="c2c-success-history"
      />
      <Button
        label="New Cash→Cash"
        variant="outline"
        onPress={() => navigation.reset({ index: 0, routes: [{ name: 'CashToCash' }] })}
        testID="c2c-success-new"
      />
      <Button
        label="Done"
        onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Home' }] })}
        testID="c2c-success-done"
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: theme.spacing.xl,
    paddingBottom: theme.spacing.xxl,
    backgroundColor: theme.colors.neutral.offWhite,
    gap: theme.spacing.sm,
  },
  hero: { alignItems: 'center', marginBottom: theme.spacing.sm },
  checkMark: {
    fontSize: 48,
    color: theme.colors.feedback.success,
    marginBottom: theme.spacing.xs,
  },
  heroTitle: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    textAlign: 'center',
    marginTop: theme.spacing.xs,
    lineHeight: 20,
  },
  card: {
    marginBottom: theme.spacing.xs,
  },
  locatorCard: {
    backgroundColor: theme.colors.neutral.white,
    borderColor: theme.colors.primary.main,
    borderWidth: 1.5,
    paddingVertical: theme.spacing.md,
    marginBottom: theme.spacing.xs,
    gap: theme.spacing.xs,
  },
  locatorHeader: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1.2,
    color: theme.colors.primary.main,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  locatorLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    textAlign: 'center',
    marginTop: theme.spacing.xs,
  },
  transferNumber: {
    fontSize: 28,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 6,
    color: theme.colors.neutral.charcoal,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    marginVertical: theme.spacing.xs,
  },
  locatorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  locatorRowLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
  },
  locatorRowValue: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.charcoal,
    fontVariant: ['tabular-nums'],
  },
  locatorNote: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    lineHeight: 17,
  },
  locatorActions: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    marginTop: theme.spacing.xs,
  },
  locatorActionButton: {
    flex: 1,
  },
  copyFeedback: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.feedback.success,
    textAlign: 'center',
    marginTop: theme.spacing.xs,
  },
  codeCard: {
    backgroundColor: theme.colors.neutral.white,
    borderColor: theme.colors.secondary.main,
    borderWidth: 2,
    alignItems: 'center',
    paddingVertical: theme.spacing.lg,
    marginBottom: theme.spacing.xs,
  },
  codeCardHeader: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1.5,
    color: theme.colors.secondary.dark,
    textTransform: 'uppercase',
    marginBottom: theme.spacing.xs,
  },
  transferCode: {
    fontSize: 32,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 4,
    color: theme.colors.primary.main,
    fontVariant: ['tabular-nums'],
    marginVertical: theme.spacing.sm,
    textAlign: 'center',
  },
  warningBox: {
    backgroundColor: theme.colors.feedback.warningLight,
    borderRadius: 8,
    padding: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  warningText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.feedback.warning,
    fontWeight: theme.typography.weights.semibold,
    lineHeight: 16,
    textAlign: 'center',
  },
  muted: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    textAlign: 'center',
  },
});
