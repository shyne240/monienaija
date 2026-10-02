import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { theme } from '../theme';
import type { AgentHistoryItem } from '../services/agent-api';
import { formatNairaFromMinor } from '../utils/format';

/**
 * Reusable transaction presentation (V1-AGENT-MOBILE-06).
 * Renders ONLY the backend's safe history projection:
 *  - type/direction per contract semantics (never inferred from strings)
 *  - status badge (server truth)
 *  - amount in NGN display (pure unit conversion, no client math)
 *  - safe reference + safe counterparty label
 * Never renders internal ids (row `id`, ledger/journal/workforce identifiers).
 */

const TYPE_LABEL: Record<string, string> = {
  CASH_IN: 'Cash→Wallet',
  CASH_OUT: 'Wallet→Cash',
  CASH_TO_CASH: 'Cash→Cash',
  AGENT_FUNDING: 'Agent Funding',
  AGENT_DEFUNDING: 'Agent Defunding',
};

function counterpartyLabel(item: AgentHistoryItem): string | null {
  const cp = item.counterparty;
  if (!cp) return null;
  if (cp.type === 'CUSTOMER') {
    return cp.beneficiaryPhone ? `Customer · beneficiary ${cp.beneficiaryPhone}` : 'Customer wallet';
  }
  if (cp.type === 'AGGREGATOR') return 'Aggregator';
  if (cp.type === 'WORKFORCE') return 'MoneyNaija Workforce';
  return null;
}

export function historyDirectionSign(direction: string): '+' | '−' | '' {
  if (direction === 'CREDIT') return '+';
  if (direction === 'DEBIT') return '−';
  return '';
}

export function formatHistoryTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-NG');
}

interface TransactionRowProps {
  item: AgentHistoryItem;
  onPress?: () => void;
  testID?: string;
}

export const TransactionRow: React.FC<TransactionRowProps> = ({ item, onPress, testID }) => {
  const typeLabel = TYPE_LABEL[item.type] ?? item.type;
  const sign = historyDirectionSign(item.direction);
  const amountText = `${sign}${formatNairaFromMinor(item.amountMinor)}`;
  const hasFee = item.feeMinor !== undefined && item.feeMinor !== null && item.feeMinor !== '0';
  const counterpartyText = counterpartyLabel(item);

  const body = (
    <View style={styles.row} testID={testID ?? `transaction-row-${item.id}`}>
      <View style={styles.left}>
        <Text style={styles.type} testID="tx-type">{typeLabel}</Text>
        <Text style={styles.meta} testID="tx-time">{formatHistoryTimestamp(item.createdAt)}</Text>
        {counterpartyText && <Text style={styles.meta} testID="tx-counterparty">{counterpartyText}</Text>}
        {item.reference && (
          <Text style={styles.meta} numberOfLines={1} testID="tx-reference">
            Ref: {item.reference}
          </Text>
        )}
      </View>
      <View style={styles.right}>
        <Text
          style={[styles.amount, item.direction === 'DEBIT' ? styles.amountDebit : styles.amountCredit]}
          testID="tx-amount"
        >
          {amountText}
        </Text>
        <View style={styles.statusPill} testID="tx-status">
          <Text style={styles.statusText}>{item.status}</Text>
        </View>
        {hasFee && (
          <Text style={styles.fee} testID="tx-fee">Fee {formatNairaFromMinor(item.feeMinor)}</Text>
        )}
        {item.commission && (
          <Text style={styles.fee} testID="tx-commission">
            Commission {formatNairaFromMinor(item.commission.commissionMinor)}
          </Text>
        )}
      </View>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} accessibilityRole="button" accessibilityLabel={`${typeLabel} ${item.status}`}>
        {body}
      </TouchableOpacity>
    );
  }
  return body;
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.neutral.lightGray,
  },
  left: { flex: 1 },
  right: { alignItems: 'flex-end', flexShrink: 0 },
  type: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.charcoal,
  },
  meta: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    marginTop: 2,
  },
  amount: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.bold,
    fontVariant: ['tabular-nums'],
  },
  amountDebit: { color: theme.colors.secondary.dark },
  amountCredit: { color: theme.colors.primary.main },
  statusPill: {
    marginTop: 4,
    borderRadius: 10,
    paddingVertical: 2,
    paddingHorizontal: theme.spacing.sm,
    backgroundColor: theme.colors.feedback.infoLight,
  },
  statusText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
  },
  fee: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.gray,
    marginTop: 2,
  },
});
