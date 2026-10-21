import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../../theme';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { AgentReceipt, receiptFromCashToCashResult } from '../../../components/AgentReceipt';
import {
  clearPendingTransferCode,
  consumePendingTransferCode,
} from '../../../services/agent-api';
import type { RootStackParamList } from '../../../navigation/types';

/**
 * Cash→Cash — Step 4: Display-Once Result & Receipt (V1-AGENT-MOBILE-07 / C2C-5 / C2C-8).
 *
 * CRITICAL SECURITY DISCIPLINE:
 * - transferCode is consumed once from in-memory handover and held only in
 *   ephemeral component state during this render.
 * - transferCode is NEVER placed in navigation params, NEVER in Zustand, NEVER in
 *   TanStack Query, NEVER in SecureStore, NEVER in logs, NEVER in AgentReceipt,
 *   and NEVER in share text.
 * - On component unmount / screen exit, all transferCode references are cleared.
 * - Replay responses honestly show that the transfer was already recorded and
 *   that the transfer code was issued only on initial creation.
 */
export const CashToCashSuccessScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CashToCashSuccess'>>();
  const { result } = route.params;

  // Single-use retrieval from ephemeral in-memory handover.
  const [transferCode, setTransferCode] = useState<string | null>(() => consumePendingTransferCode());

  // Strict cleanup on exit/unmount
  useEffect(() => {
    return () => {
      setTransferCode(null);
      clearPendingTransferCode();
    };
  }, []);

  const replayed = result.replayed === true || result.status === 'REPLAYED';
  const receipt = receiptFromCashToCashResult(result);

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
            : 'Funds have been reserved. Provide the transfer code below to the beneficiary to claim physical cash.'}
        </Text>
      </View>

      {/* Prominent Display-Once Transfer Code Card */}
      {transferCode ? (
        <Card style={styles.codeCard} testID="c2c-transfer-code-card">
          <Text style={styles.codeCardHeader}>One-Time Transfer Code</Text>
          <Text selectable style={styles.transferCode} testID="c2c-transfer-code">
            {transferCode}
          </Text>
          <View style={styles.warningBox}>
            <Text style={styles.warningText}>
              DISPLAY-ONCE CODE: Share this code ONLY with the beneficiary ({result.beneficiaryPhone}).
              They must present this code to claim physical cash at an agent outlet.
              This code is never stored and cannot be viewed again after leaving this screen.
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
