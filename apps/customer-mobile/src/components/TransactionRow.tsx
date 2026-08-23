import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';
import { StatusBadge } from './StatusBadge';

interface TransactionRowProps {
  id: string;
  narration: string;
  reference: string;
  amountMinor: number;
  currency: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER_IN' | 'TRANSFER_OUT';
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'REVERSED' | 'CANCELLED';
  createdAt: string;
}

export const TransactionRow: React.FC<TransactionRowProps> = ({
  narration,
  reference,
  amountMinor,
  type,
  status,
  createdAt,
}) => {
  const isIncoming = type === 'DEPOSIT' || type === 'TRANSFER_IN';
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

  return (
    <View style={styles.container}>
      <View style={styles.leftContainer}>
        <Text numberOfLines={1} style={styles.narration}>
          {narration || (type === 'DEPOSIT' ? 'Deposit Funding' : type === 'WITHDRAWAL' ? 'Withdrawal Outflow' : 'Wallet Transfer')}
        </Text>
        <Text style={styles.reference}>Ref: {reference}</Text>
        <Text style={styles.date}>{formattedDate}</Text>
      </View>

      <View style={styles.rightContainer}>
        <Text
          style={[
            styles.amount,
            isIncoming ? styles.incoming : styles.outgoing,
          ]}
        >
          {isIncoming ? '+' : '-'}₦{displayAmount}
        </Text>
        <View style={styles.badgeWrapper}>
          <StatusBadge status={status} />
        </View>
      </View>
    </View>
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
  badgeWrapper: {
    marginTop: 2,
  },
});
