import React from 'react';
import {
  StyleSheet,
  View,
  ViewProps,
} from 'react-native';

import { theme } from '../theme';

interface CardProps extends ViewProps {
  variant?: 'elevated' | 'outlined' | 'flat';
}

export const Card: React.FC<CardProps> = ({
  children,
  variant = 'elevated',
  style,
  ...props
}) => {
  return (
    <View style={[styles.card, styles[variant], style]} {...props}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.neutral.white,
  },
  elevated: {
    shadowColor: theme.colors.neutral.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  outlined: {
    borderWidth: 1,
    borderColor: theme.colors.neutral.lightGray,
  },
  flat: {
    backgroundColor: theme.colors.neutral.offWhite,
  },
});
