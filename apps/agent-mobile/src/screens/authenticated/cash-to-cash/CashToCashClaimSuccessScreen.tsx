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
 * Cash→Cash wallet or Agent-cash redemption — success and receipt.
 *
 * Wallet mode credits the beneficiary Customer. Cash mode debits unclaimed liability and credits
 * the authenticated Agent's NGN float; physical handover remains separate from this ledger event.
 * The shared receipt contains no transfer code, OTP, Agent PIN, internal journal ID, or customer UUID.
 */
export const CashToCashClaimSuccessScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CashToCashClaimSuccess'>>();
  const { result, customerDisplay, customerReceivingNumber } = route.params;

  const replayed = result.replayed === true || result.status === 'REPLAYED';
  const cashPayout = result.redemptionMethod === 'AGENT_CASH';
  const receipt = receiptFromCashToCashClaimResult(result, customerDisplay, customerReceivingNumber);
  const amountMinor = result.principalMinor || result.amountMinor;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.checkMark}>✓</Text>
        <Text style={styles.heroTitle} testID="c2c-claim-success-title">
          {cashPayout
            ? replayed ? 'Cash payout settlement already recorded' : 'Agent float credited'
            : replayed ? 'Wallet claim already recorded' : 'Customer wallet credited'}
        </Text>
        <Text style={styles.heroSubtitle}>
          {cashPayout
            ? replayed
              ? 'This receipt confirms only the ledger settlement; it does not record whether physical cash was handed over.'
              : 'The unclaimed liability was debited and your Agent NGN float credited. Physical cash handover is separate from this ledger settlement.'
            : replayed
              ? 'This is a recovered or repeated receipt. No new Customer wallet credit was created.'
              : 'The transfer principal was credited to the beneficiary Customer wallet. This transaction did not pay physical cash.'}
        </Text>
      </View>

      <Card
        style={styles.walletCreditCard}
        testID={cashPayout ? 'c2c-claim-agent-float-card' : 'c2c-claim-wallet-credit-card'}
      >
        <Text style={styles.walletCreditTitle}>
          {cashPayout ? 'Amount credited to Agent float' : 'Amount credited to Customer wallet'}
        </Text>
        <Text
          style={styles.walletCreditAmount}
          testID={cashPayout ? 'c2c-claim-agent-float-amount' : 'c2c-claim-wallet-credit-amount'}
        >
          {`${formatNairaFromMinor(amountMinor)} NGN`}
        </Text>
        <Text style={styles.walletCreditNote}>
          {cashPayout
            ? 'Physical cash handover is separate from this ledger settlement.'
            : 'No physical cash handout is included in this wallet redemption.'}
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
        label="New Cash-to-Cash claim"
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
  walletCreditCard: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderWidth: 1.5,
    alignItems: 'center',
    paddingVertical: theme.spacing.lg,
  },
  walletCreditTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.slate,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  walletCreditAmount: {
    fontSize: 28,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.feedback.success,
    marginVertical: theme.spacing.xs,
  },
  walletCreditNote: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    textAlign: 'center',
  },
});
