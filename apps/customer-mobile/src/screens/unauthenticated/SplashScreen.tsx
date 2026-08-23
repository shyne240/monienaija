import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../theme';
import { useAuthStore } from '../../store/auth-store';

export const SplashScreen: React.FC = () => {
  const restoreSession = useAuthStore((state) => state.restoreSession);

  useEffect(() => {
    // Delay slightly for brand exposure, then restore session
    const timer = setTimeout(() => {
      restoreSession();
    }, 1500);

    return () => clearTimeout(timer);
  }, [restoreSession]);

  return (
    <View style={styles.container}>
      <View style={styles.branding}>
        <Text style={styles.logoText}>₦</Text>
        <Text style={styles.appName}>MoneyNaija</Text>
        <Text style={styles.tagline}>Safe. Fast. Reliable Mobile Money</Text>
      </View>
      <ActivityIndicator size="small" color={theme.colors.secondary.main} style={styles.loader} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.primary.main,
    justifyContent: 'center',
    alignItems: 'center',
  },
  branding: {
    alignItems: 'center',
  },
  logoText: {
    fontSize: 72,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.secondary.main,
    marginBottom: theme.spacing.md,
  },
  appName: {
    fontSize: theme.typography.sizes.xxl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.white,
    letterSpacing: 1.5,
  },
  tagline: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.secondary.light,
    marginTop: theme.spacing.xs,
  },
  loader: {
    position: 'absolute',
    bottom: 80,
  },
});
