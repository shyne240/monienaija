import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../../theme';
import { Button } from '../../../components/Button';
import { AgentReceipt, receiptFromCashInResult } from '../../../components/AgentReceipt';
import type { RootStackParamList } from '../../../navigation/types';

/**
 * Cash→Wallet — Step 4: success + receipt (V1-AGENT-MOBILE-06 refactor).
 *
 * The receipt body is produced by the SHARED receipt renderer fed with the
 * authoritative backend result (status/REPLAYED honesty, amount, recipient,
 * server reference, time). Internal ledger/journal/customer identifiers are
 * never displayed. History-derived receipts come from the same renderer, so
 * this presentation is consistent before and after app restarts.
 */
export const CashToWalletSuccessScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CashToWalletSuccess'>>();
  const { result } = route.params;

  const replayed = result.replayed === true || result.status === 'REPLAYED';
  const receipt = receiptFromCashInResult(result);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.checkMark}>✓</Text>
        <Text style={styles.heroTitle} testID="success-title">
          {replayed ? 'Already recorded' : 'Wallet credited'}
        </Text>
        <Text style={styles.heroSubtitle}>
          {replayed
            ? 'This submission matched an earlier one (idempotent replay) — no new credit was created.'
            : 'The server has credited the recipient wallet.'}
        </Text>
      </View>

      <AgentReceipt receipt={receipt} testID="c2w-receipt" />

      <Button
        label="View transaction history"
        variant="outline"
        onPress={() =>
          navigation.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Transactions' }] })
        }
        testID="success-history"
      />
      <Button
        label="New Cash→Wallet"
        variant="outline"
        onPress={() => navigation.reset({ index: 0, routes: [{ name: 'CashToWallet' }] })}
        testID="success-new"
      />
      <Button
        label="Done"
        onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Home' }] })}
        testID="success-done"
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
  },
  heroSubtitle: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    textAlign: 'center',
    marginTop: theme.spacing.xs,
    lineHeight: 20,
  },
});
