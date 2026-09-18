import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';

export type BadgeStatus = 'SUCCESS' | 'FAILED' | 'PENDING' | 'REVERSED' | 'CANCELLED' | 'ACTIVE' | 'SUSPENDED';

interface StatusBadgeProps {
  status: BadgeStatus;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const normStatus = status.toUpperCase();

  const getStyles = () => {
    switch (normStatus) {
      case 'SUCCESS':
      case 'ACTIVE':
        return {
          bg: theme.colors.feedback.successLight,
          text: theme.colors.feedback.success,
        };
      case 'FAILED':
      case 'CANCELLED':
      case 'SUSPENDED':
        return {
          bg: theme.colors.feedback.errorLight,
          text: theme.colors.feedback.error,
        };
      case 'PENDING':
        return {
          bg: theme.colors.feedback.warningLight,
          text: theme.colors.feedback.warning,
        };
      default:
        return {
          bg: theme.colors.neutral.lightGray,
          text: theme.colors.neutral.slate,
        };
    }
  };

  const colors = getStyles();

  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.text, { color: colors.text }]}>{status}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingVertical: theme.spacing.xxs,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    textTransform: 'uppercase',
  },
});
