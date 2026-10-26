import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../../theme';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { AgentReceipt, receiptFromCashToCashClaimResult } from '../../../components/AgentReceipt';
import { formatNairaFromMinor } from '../../../utils/format';
import type { RootStackParamList } from '../../../navigation/types';

/**
 * Cash→Cash Claim Assist — Step 3: Success, Physical Cash Handover & Receipt (V1-AGENT-MOBILE-09 / CLM-6).
 *
 * Prominently presents physical cash handover instructions to the agent.
 * The electronic ledger claim (debit unclaimed, credit beneficiary wallet) is complete.
 * The shared receipt uses `receiptFromCashToCashClaimResult` with zero internal secrets or UUIDs.
 */
export const CashToCashClaimSuccessScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CashToCashClaimSuccess'>>();
  const { result, customerDisplay, customerReceivingNumber } = route.params;

  const replayed = result.replayed === true || result.status === 'REPLAYED';
  const receipt = receiptFromCashToCashClaimResult(result, customerDisplay, customerReceivingNumber);
  const amountMinor = result.principalMinor || result.amountMinor;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.checkMark}>✓</Text>
        <Text style={styles.heroTitle} testID="c2c-claim-success-title">
          {replayed ? 'Already recorded' : 'Claim Completed — Hand Over Cash'}
        </Text>
        <Text style={styles.heroSubtitle}>
          {replayed
            ? 'This claim was already completed (idempotent replay). Verify physical cash was already handed over.'
            : 'The transfer has been claimed to the customer wallet. Hand over physical cash to the customer now.'}
        </Text>
      </View>

      {/* Prominent Physical Cash Handover Guidance */}
      <Card style={styles.handoverCard} testID="c2c-claim-handover-card">
        <Text style={styles.handoverTitle}>Physical Cash to Hand Over</Text>
        <Text style={styles.handoverAmount} testID="c2c-claim-handover-amount">
          {`${formatNairaFromMinor(amountMinor)} NGN`}
        </Text>
        <Text style={styles.handoverNote}>
          Pay the beneficiary the exact amount above in physical banknotes.
        </Text>
      </Card>

      <AgentReceipt receipt={receipt} testID="c2c-claim-receipt" />

      <Button
        label="View transaction history"
        variant="outline"
        onPress={() =>
          navigation.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Transactions' }] })
        }
        testID="c2c-claim-success-history"
      />
      <Button
        label="New Cash→Cash Claim"
        variant="outline"
        onPress={() => navigation.reset({ index: 0, routes: [{ name: 'CashToCashClaim' }] })}
        testID="c2c-claim-success-new"
      />
      <Button
        label="Done"
        onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Home' }] })}
        testID="c2c-claim-success-done"
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
  handoverCard: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderWidth: 1.5,
    alignItems: 'center',
    paddingVertical: theme.spacing.lg,
  },
  handoverTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.slate,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  handoverAmount: {
    fontSize: 28,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.feedback.success,
    marginVertical: theme.spacing.xs,
  },
  handoverNote: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    textAlign: 'center',
  },
});
