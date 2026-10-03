import React, { useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { LoadingState } from '../../components/LoadingState';
import { useAuthStore } from '../../store/auth-store';
import { ApiClient } from '../../services/api-client';
import { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Profile'>;

interface CustomerIdentity {
  id: string;
  reference: string;
  type: string;
  status: string;
  kycLevel?: string;
  kycStatus?: string;
  createdAt: string;
}

interface CustomerProfileDetail {
  profile?: { displayName?: string | null; legalName?: string | null } | null;
}

/**
 * V1-CUSTOMER-02 — reads from the authenticated `GET /customers/me` and
 * `GET /customers/me/profile` routes instead of the legacy unauthenticated
 * `GET /customers/:id` route.
 */
export const ProfileScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { customerId, logout } = useAuthStore();
  const [identity, setIdentity] = useState<CustomerIdentity | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const me = await ApiClient.get<CustomerIdentity>('/customers/me');
        setIdentity(me);
        try {
          const detail = await ApiClient.get<CustomerProfileDetail>('/customers/me/profile');
          setDisplayName(detail.profile?.displayName ?? null);
        } catch {
          // Profile detail is optional; identity alone is enough to render the screen.
        }
      } catch (err: any) {
        setError('Failed to load profile details.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchProfile();
  }, []);

  if (isLoading) {
    return <LoadingState message="Fetching profile details..." />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(displayName || 'M').charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.name}>{displayName || 'MonieNaija Customer'}</Text>
          <Text style={styles.phone}>Ref: {identity?.reference || 'N/A'}</Text>
        </View>

        {!!error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Card variant="elevated" style={styles.detailsCard}>
          <Text style={styles.sectionTitle}>Account Information</Text>

          <View style={styles.row}>
            <Text style={styles.label}>Customer ID</Text>
            <Text style={styles.value}>{customerId}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>Account Type</Text>
            <Text style={styles.value}>{identity?.type || 'INDIVIDUAL'}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>Status</Text>
            <Text style={[styles.value, styles.activeStatus]}>
              {identity?.status || 'ACTIVE'}
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>Registered On</Text>
            <Text style={styles.value}>
              {identity?.createdAt ? new Date(identity.createdAt).toLocaleDateString('en-NG') : 'N/A'}
            </Text>
          </View>
        </Card>

        <View style={styles.actionsGroup}>
          <Button
            label="Transaction PIN"
            style={styles.actionBtn}
            variant="outline"
            onPress={() => navigation.navigate('TransactionPin')}
          />
          <Button
            label="Support"
            style={styles.actionBtn}
            variant="outline"
            onPress={() => navigation.navigate('Support')}
          />
        </View>

        <Button
          label="Log Out of Session"
          style={styles.logoutBtn}
          variant="outline"
          onPress={logout}
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.neutral.offWhite,
  },
  content: {
    flex: 1,
    padding: theme.spacing.xl,
    justifyContent: 'space-between',
  },
  header: {
    alignItems: 'center',
    marginVertical: theme.spacing.xl,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.primary.main,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  avatarText: {
    fontSize: theme.typography.sizes.xxl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.secondary.main,
  },
  name: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.charcoal,
    marginBottom: theme.spacing.xxs,
  },
  phone: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
  },
  detailsCard: {
    width: '100%',
    marginBottom: theme.spacing.xl,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.charcoal,
    marginBottom: theme.spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.sm,
  },
  label: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
  },
  value: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.neutral.charcoal,
  },
  activeStatus: {
    color: theme.colors.feedback.success,
    fontWeight: theme.typography.weights.bold,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.neutral.lightGray,
    marginVertical: theme.spacing.xs,
  },
  actionsGroup: {
    width: '100%',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  actionBtn: {
    width: '100%',
  },
  logoutBtn: {
    width: '100%',
    borderColor: theme.colors.feedback.error,
  },
  errorBanner: {
    backgroundColor: theme.colors.feedback.errorLight,
    padding: theme.spacing.md,
    borderRadius: 8,
    width: '100%',
    marginBottom: theme.spacing.md,
  },
  errorText: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.xs,
  },
});
