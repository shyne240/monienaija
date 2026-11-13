import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { theme } from '../theme';
import { StatusBadge, type BadgeStatus } from './StatusBadge';
import type { TransactionSign } from '../services/transfer-view';

function statusLabel(status: BadgeStatus): string {
  switch (status) {
    case 'SUCCESS':
      return 'Completed';
    case 'PENDING':
      return 'Pending';
    case 'FAILED':
      return 'Failed';
    case 'CANCELLED':
      return 'Cancelled';
    case 'EXPIRED':
      return 'Expired';
    case 'REVERSED':
      return 'Reversed';
    case 'SUSPENDED':
      return 'Suspended';
    case 'ACTIVE':
      return 'Active';
    default:
      return String(status);
  }
}

interface TransactionRowProps {
  id: string;
  narration: string;
  reference: string;
  amountMinor: number;
  currency: string;
  sign: TransactionSign;
  status: BadgeStatus;
  createdAt: string;
  /** V1-CUSTOMER-09 — optional "get help with this transaction" affordance. */
  onGetHelp?: () => void;
  /** ARENA 4 — opens the receipt/transaction detail. Renders the row as a button when present. */
  onPress?: () => void;
}

export const TransactionRow: React.FC<TransactionRowProps> = ({
  narration,
  reference,
  amountMinor,
  sign,
  status,
  createdAt,
  onGetHelp,
  onPress,
}) => {
  const displayAmount = (amountMinor / 100).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const formattedDate = React.useMemo(() => {
    try {
      const date = new Date(createdAt);
      return date.toLocaleDateString('en-NG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return createdAt;
    }
  }, [createdAt]);

  const amountStyle =
    sign === 'IN' ? styles.incoming : sign === 'OUT' ? styles.outgoing : styles.neutral;
  const amountPrefix = sign === 'IN' ? '+' : sign === 'OUT' ? '-' : '';

  const Container: React.ElementType = onPress ? TouchableOpacity : View;

  return (
    <Container
      style={styles.container}
      {...(onPress
        ? {
            onPress,
            accessibilityRole: 'button' as const,
            accessibilityLabel: `${narration} · ${statusLabel(status)} · ${formattedDate}`,
            activeOpacity: 0.7,
          }
        : {})}
    >
      <View style={styles.leftContainer}>
        <Text numberOfLines={1} style={styles.narration}>
          {narration}
        </Text>
        <Text style={styles.reference}>Ref: {reference}</Text>
        <Text style={styles.date}>{formattedDate}</Text>
      </View>

      <View style={styles.rightContainer}>
        <Text style={[styles.amount, amountStyle]}>
          {amountPrefix}₦{displayAmount}
        </Text>
        <View style={styles.badgeWrapper}>
          <StatusBadge status={status} />
        </View>
        {!!onGetHelp && (
          <TouchableOpacity onPress={onGetHelp} testID="transaction-row-get-help" hitSlop={8}>
            <Text style={styles.helpLink}>Get help</Text>
          </TouchableOpacity>
        )}
      </View>
    </Container>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderColor: theme.colors.neutral.lightGray,
    backgroundColor: theme.colors.neutral.white,
  },
  leftContainer: {
    flex: 1,
    paddingRight: theme.spacing.md,
  },
  rightContainer: {
    alignItems: 'flex-end',
  },
  narration: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.charcoal,
    marginBottom: 2,
  },
  reference: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    marginBottom: 2,
  },
  date: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.gray,
  },
  amount: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    marginBottom: theme.spacing.xs,
  },
  incoming: {
    color: theme.colors.feedback.success,
  },
  outgoing: {
    color: theme.colors.neutral.charcoal,
  },
  neutral: {
    color: theme.colors.neutral.slate,
  },
  badgeWrapper: {
    marginTop: 2,
  },
  helpLink: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.primary.main,
    fontWeight: theme.typography.weights.medium,
    marginTop: theme.spacing.xs,
    textDecorationLine: 'underline',
  },
});
