import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../../theme';
import { Card } from '../../components/Card';

interface PlaceholderScreenProps {
  title: string;
  message: string;
}

/**
 * Clearly-labelled placeholder for surfaces gated to later phases (spec §8):
 * communicates "not functional yet" instead of exposing unfinished financial
 * actions as if they work (spec §14).
 */
export const PlaceholderScreen: React.FC<PlaceholderScreenProps> = ({ title, message }) => {
  return (
    <View style={styles.container}>
      <Card variant="flat" style={styles.card} testID="placeholder-card">
        <Text style={styles.icon} testID="placeholder-icon">🚧</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.phasePill}>COMING IN A LATER PHASE</Text>
        <Text style={styles.message}>{message}</Text>
      </Card>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: theme.spacing.xl,
    backgroundColor: theme.colors.neutral.offWhite,
  },
  card: {
    padding: theme.spacing.xxl,
    alignItems: 'center',
  },
  icon: {
    fontSize: 40,
    marginBottom: theme.spacing.md,
  },
  title: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  phasePill: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.secondary.dark,
    backgroundColor: theme.colors.secondary.lightest,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    borderRadius: 10,
    marginBottom: theme.spacing.md,
  },
  message: {
    fontSize: theme.typography.sizes.base,
    color: theme.colors.neutral.slate,
    textAlign: 'center',
    lineHeight: 21,
  },
});
