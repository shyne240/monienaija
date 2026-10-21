import React, { useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';

import { theme } from '../../../theme';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { LoadingState } from '../../../components/LoadingState';
import { ErrorState } from '../../../components/ErrorState';
import {
  describeSupportError,
  getAgentSupportTickets,
  type AgentSupportTicket,
  type AgentSupportTicketListResponse,
} from '../../../services/agent-api';
import { useAuthStore } from '../../../store/auth-store';
import type { RootStackParamList } from '../../../navigation/types';

/**
 * Agent Support Screen (V1-AGENT-MOBILE-11).
 *
 * Displays support overview, support request history, and direct entry points
 * for creating new support requests. Strictly reflects the backend agent support contract.
 */
export const SupportScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { agentId } = useAuthStore();
  const [page, setPage] = useState(1);

  const ticketsQuery = useQuery<AgentSupportTicketListResponse, unknown>({
    queryKey: ['agent-support-tickets', agentId, page],
    queryFn: () => getAgentSupportTickets(page, 20),
    enabled: !!agentId,
    staleTime: 15_000,
  });

  const tickets = ticketsQuery.data?.items ?? [];
  const pagination = ticketsQuery.data?.pagination;
  const isRefreshing = ticketsQuery.isRefetching;

  const handleRefresh = () => {
    void ticketsQuery.refetch();
  };

  const renderStatusBadge = (status: string) => {
    let badgeStyle = styles.badgeOpen;
    let textStyle = styles.badgeTextOpen;

    if (status === 'IN_PROGRESS') {
      badgeStyle = styles.badgeInProgress;
      textStyle = styles.badgeTextInProgress;
    } else if (status === 'RESOLVED') {
      badgeStyle = styles.badgeResolved;
      textStyle = styles.badgeTextResolved;
    } else if (status === 'CLOSED') {
      badgeStyle = styles.badgeClosed;
      textStyle = styles.badgeTextClosed;
    }

    return (
      <View style={[styles.badge, badgeStyle]}>
        <Text style={[styles.badgeText, textStyle]}>{status.replace('_', ' ')}</Text>
      </View>
    );
  };

  const renderTicketItem = ({ item }: { item: AgentSupportTicket }) => (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => navigation.navigate('SupportTicketDetail', { ticketId: item.id })}
      testID={`support-ticket-item-${item.id}`}
    >
      <Card style={styles.ticketCard}>
        <View style={styles.ticketHeader}>
          <Text style={styles.ticketReference} testID={`support-ticket-ref-${item.id}`}>
            {item.reference}
          </Text>
          {renderStatusBadge(item.status)}
        </View>

        <Text style={styles.ticketSubject} numberOfLines={1}>
          {item.subject}
        </Text>

        <Text style={styles.ticketDescription} numberOfLines={2}>
          {item.description}
        </Text>

        <View style={styles.ticketFooter}>
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryBadgeText}>{formatCategory(item.category)}</Text>
          </View>
          <Text style={styles.ticketDate}>{formatDate(item.createdAt)}</Text>
        </View>
      </Card>
    </TouchableOpacity>
  );

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <Card style={styles.introCard} testID="support-intro-card">
        <Text style={styles.title}>Agent Support</Text>
        <Text style={styles.description}>
          Need help with your account, transaction authorizations, terminal devices, or wallet
          funding? Create a support request below and our operations team will assist you.
        </Text>
        <Button
          label="New Support Request"
          onPress={() => navigation.navigate('CreateSupportTicket')}
          testID="support-new-ticket-button"
          style={styles.newTicketButton}
        />
      </Card>

      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>Your Support Requests</Text>
        {pagination && pagination.total > 0 && (
          <Text style={styles.ticketCountText} testID="support-ticket-count">
            {pagination.total} {pagination.total === 1 ? 'request' : 'requests'}
          </Text>
        )}
      </View>
    </View>
  );

  const renderFooter = () => {
    if (!pagination || pagination.totalPages <= 1) return null;

    return (
      <View style={styles.paginationRow}>
        <Button
          label="Previous"
          variant="outline"
          disabled={page <= 1}
          onPress={() => setPage((p) => Math.max(1, p - 1))}
          style={styles.pageButton}
        />
        <Text style={styles.pageIndicator}>
          Page {pagination.page} of {pagination.totalPages}
        </Text>
        <Button
          label="Next"
          variant="outline"
          disabled={!pagination.hasNextPage}
          onPress={() => setPage((p) => p + 1)}
          style={styles.pageButton}
        />
      </View>
    );
  };

  const renderEmpty = () => {
    if (ticketsQuery.isLoading) return null;

    return (
      <Card style={styles.emptyCard} testID="support-empty-card">
        <Text style={styles.emptyIcon}>💬</Text>
        <Text style={styles.emptyTitle}>No Support Requests</Text>
        <Text style={styles.emptyText}>
          You have not submitted any support requests yet. If you encounter any issues, tap &quot;New
          Support Request&quot; above to reach out.
        </Text>
      </Card>
    );
  };

  if (ticketsQuery.isLoading && !ticketsQuery.isRefetching) {
    return <LoadingState message="Loading support requests…" testID="support-loading" />;
  }

  if (ticketsQuery.isError && !tickets.length) {
    return (
      <ErrorState
        title="Could Not Load Support"
        message={describeSupportError(ticketsQuery.error)}
        onRetry={handleRefresh}
        retryLabel="Retry"
      />
    );
  }

  return (
    <FlatList
      data={tickets}
      keyExtractor={(item) => item.id}
      renderItem={renderTicketItem}
      ListHeaderComponent={renderHeader}
      ListFooterComponent={renderFooter}
      ListEmptyComponent={renderEmpty}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
      testID="support-ticket-list"
    />
  );
};

function formatCategory(category: string): string {
  switch (category) {
    case 'CASH_IN':
      return 'Cash→Wallet';
    case 'CASH_OUT':
      return 'Wallet→Cash';
    case 'CASH_TO_CASH':
      return 'Cash→Cash';
    case 'AGENT_FUNDING':
      return 'Agent Funding';
    case 'OUTLET':
      return 'Outlet';
    case 'TERMINAL':
      return 'Terminal';
    case 'PIN':
      return 'Transaction PIN';
    case 'AUTHENTICATION':
      return 'Auth & Login';
    case 'FUNDING':
      return 'Funding';
    case 'TRANSFER':
      return 'Transfer';
    case 'WALLET':
      return 'Wallet';
    case 'PROFILE':
      return 'Profile';
    default:
      return 'General';
  }
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-NG', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    backgroundColor: theme.colors.neutral.offWhite,
    gap: theme.spacing.md,
  },
  headerContainer: {
    gap: theme.spacing.md,
    marginBottom: theme.spacing.xs,
  },
  introCard: {
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.neutral.white,
  },
  title: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
  },
  description: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    lineHeight: 20,
  },
  newTicketButton: {
    marginTop: theme.spacing.xs,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xs,
    marginTop: theme.spacing.xs,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.charcoal,
  },
  ticketCountText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
  },
  ticketCard: {
    gap: theme.spacing.xs,
    backgroundColor: theme.colors.neutral.white,
    marginBottom: theme.spacing.sm,
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ticketReference: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.primary.light,
  },
  badge: {
    borderRadius: 10,
    paddingVertical: 2,
    paddingHorizontal: theme.spacing.sm,
  },
  badgeOpen: {
    backgroundColor: theme.colors.feedback.warningLight,
  },
  badgeInProgress: {
    backgroundColor: '#EBF5FF',
  },
  badgeResolved: {
    backgroundColor: theme.colors.feedback.successLight,
  },
  badgeClosed: {
    backgroundColor: theme.colors.neutral.lightGray,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
  },
  badgeTextOpen: {
    color: theme.colors.feedback.warning,
  },
  badgeTextInProgress: {
    color: theme.colors.primary.light,
  },
  badgeTextResolved: {
    color: theme.colors.feedback.success,
  },
  badgeTextClosed: {
    color: theme.colors.neutral.slate,
  },
  ticketSubject: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.charcoal,
  },
  ticketDescription: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    lineHeight: 18,
  },
  ticketFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: theme.spacing.xs,
  },
  categoryBadge: {
    backgroundColor: theme.colors.neutral.offWhite,
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: theme.spacing.xs,
  },
  categoryBadgeText: {
    fontSize: 10,
    color: theme.colors.neutral.charcoal,
    fontWeight: theme.typography.weights.medium,
  },
  ticketDate: {
    fontSize: 10,
    color: theme.colors.neutral.slate,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: theme.spacing.xl,
    gap: theme.spacing.xs,
    backgroundColor: theme.colors.neutral.white,
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: theme.spacing.xs,
  },
  emptyTitle: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.charcoal,
  },
  emptyText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: theme.spacing.lg,
  },
  paginationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: theme.spacing.md,
  },
  pageButton: {
    minWidth: 100,
  },
  pageIndicator: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
  },
});
