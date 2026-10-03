import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { LoadingState } from '../../components/LoadingState';
import { ApiClient } from '../../services/api-client';
import { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Support'>;

interface SupportTicket {
  id: string;
  reference: string;
  subject: string;
  category: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  createdAt: string;
}

/**
 * V1-CUSTOMER-02 — Customer support ticket list.
 *
 * Calls the real, authenticated, ownership-scoped
 * `GET /customers/me/support/tickets`. This is deliberately separate from
 * the financial control plane (no wallet/transfer mutation is possible from
 * this screen) and makes no SLA promises.
 */
export const SupportScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const fetchTickets = useCallback(async () => {
    try {
      setError('');
      const result = await ApiClient.get<{ items: SupportTicket[] }>(
        '/customers/me/support/tickets?page=1&limit=50',
      );
      setTickets(result.items || []);
    } catch (err: any) {
      setError('Failed to load support tickets.');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchTickets();
    }, [fetchTickets]),
  );

  const handleRefresh = () => {
    setRefreshing(true);
    fetchTickets();
  };

  if (isLoading) {
    return <LoadingState message="Loading your support tickets..." />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Support</Text>
        <Button
          label="New Ticket"
          size="small"
          onPress={() => navigation.navigate('CreateSupportTicket')}
        />
      </View>

      {!!error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={tickets}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[theme.colors.primary.main]} />
        }
        renderItem={({ item }) => (
          <Card variant="flat" style={styles.ticketCard}>
            <View style={styles.ticketRow}>
              <Text style={styles.ticketSubject}>{item.subject}</Text>
              <Text style={[styles.statusBadge, statusStyle(item.status)]}>{item.status}</Text>
            </View>
            <Text style={styles.ticketMeta}>
              {item.category} · {item.reference}
            </Text>
            <Text style={styles.ticketDate}>
              {new Date(item.createdAt).toLocaleDateString('en-NG')}
            </Text>
          </Card>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>You have not raised any support tickets yet.</Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
};

function statusStyle(status: SupportTicket['status']) {
  switch (status) {
    case 'RESOLVED':
    case 'CLOSED':
      return { color: theme.colors.feedback.success };
    case 'IN_PROGRESS':
      return { color: theme.colors.feedback.warning };
    default:
      return { color: theme.colors.primary.main };
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.neutral.offWhite,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing.lg,
  },
  title: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
  },
  listContent: {
    padding: theme.spacing.lg,
    paddingTop: 0,
  },
  ticketCard: {
    marginBottom: theme.spacing.sm,
  },
  ticketRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ticketSubject: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.charcoal,
    flexShrink: 1,
    marginRight: theme.spacing.sm,
  },
  statusBadge: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
  },
  ticketMeta: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    marginTop: theme.spacing.xxs,
  },
  ticketDate: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.gray,
    marginTop: theme.spacing.xxs,
  },
  emptyContainer: {
    paddingVertical: theme.spacing.huge,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: theme.typography.sizes.base,
    color: theme.colors.neutral.gray,
    textAlign: 'center',
  },
  errorBanner: {
    backgroundColor: theme.colors.feedback.errorLight,
    padding: theme.spacing.md,
    marginHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    borderRadius: 8,
  },
  errorText: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.xs,
  },
});
