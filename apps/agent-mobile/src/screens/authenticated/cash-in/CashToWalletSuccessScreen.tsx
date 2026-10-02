import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../../theme';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { formatNairaFromMinor } from '../../../utils/format';
import type { RootStackParamList } from '../../../navigation/types';

/**
 * Cash→Wallet — Step 4: success (V1-AGENT-MOBILE-04).
 *
 * Renders ONLY server-returned authoritative values (status, reference,
 * amount, createdAt). Internal ledger/journal/customer identifiers are
 * never displayed. `REPLAYED` (idempotent replay) is communicated honestly
 * as "already recorded". The reusable receipt renderer that turns these
 * authoritative fields into a shareable export is the dedicated next V1
 * task — nothing here contradicts it.
 */
export const CashToWalletSuccessScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CashToWalletSuccess'>>();
  const { result, amountMinor } = route.params;

  const replayed = result.replayed === true || result.status === 'REPLAYED';

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

      <Card style={styles.card} testID="success-summary-card">
        <SummaryRow label="Status" value={result.status} testID="success-status" />
        <SummaryRow
          label="Amount credited"
          value={`${formatNairaFromMinor(result.amountMinor ?? amountMinor)} NGN`}
          testID="success-amount"
        />
        <SummaryRow
          label="Recipient wallet"
          value={result.recipientReceivingNumber}
          testID="success-recipient"
        />
        {result.reference && (
          <SummaryRow label="Transaction reference" value={result.reference} testID="success-reference" />
        )}
        {result.createdAt && (
          <SummaryRow
            label="Time"
            value={new Date(result.createdAt).toLocaleString('en-NG')}
            testID="success-time"
          />
        )}
      </Card>

      <Text style={styles.helper}>
        Transaction details become visible in Agent history as soon as the server records them.
        Keep the physical cash receipt conventions agreed with MoneyNaija.
      </Text>

      <Button
        label="Done"
        onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Home' }] })}
        testID="success-done"
      />
      <Button
        label="New Cash→Wallet"
        variant="outline"
        onPress={() => navigation.reset({ index: 0, routes: [{ name: 'CashToWallet' }] })}
        testID="success-new"
      />
    </ScrollView>
  );
};

const SummaryRow: React.FC<{ label: string; value: string; testID?: string }> = ({
  label,
  value,
  testID,
}) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue} selectable testID={testID}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: theme.spacing.xl,
    paddingBottom: theme.spacing.xxl,
    backgroundColor: theme.colors.neutral.offWhite,
    gap: theme.spacing.md,
  },
  hero: { alignItems: 'center', marginBottom: theme.spacing.lg },
  checkMark: {
    fontSize: 48,
    color: theme.colors.feedback.success,
    marginBottom: theme.spacing.sm,
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
  card: {},
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  rowLabel: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
  },
  rowValue: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.charcoal,
    flexShrink: 1,
    textAlign: 'right',
  },
  helper: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.gray,
    lineHeight: 17,
  },
});
