import React, { useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { theme } from '../../../theme';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { Input } from '../../../components/Input';
import { LoadingState } from '../../../components/LoadingState';
import { ErrorState } from '../../../components/ErrorState';
import {
  createAgentSupportTicketMessage,
  describeSupportError,
  getAgentSupportTicket,
  getAgentSupportTicketMessages,
  type AgentSupportTicket,
  type AgentSupportTicketMessage,
} from '../../../services/agent-api';
import type { RootStackParamList } from '../../../navigation/types';

/**
 * Agent Support Ticket Detail & Messaging Screen (V1-AGENT-MOBILE-11).
 *
 * Displays ticket metadata, description, chronological message thread,
 * and allows sending replies to the support team.
 */
export const SupportTicketDetailScreen: React.FC = () => {
  const route = useRoute<RouteProp<RootStackParamList, 'SupportTicketDetail'>>();
  const ticketId = route.params.ticketId;
  const queryClient = useQueryClient();

  const [replyText, setReplyText] = useState('');
  const [replyError, setReplyError] = useState('');

  const ticketQuery = useQuery<AgentSupportTicket, unknown>({
    queryKey: ['agent-support-ticket', ticketId],
    queryFn: () => getAgentSupportTicket(ticketId),
    staleTime: 15_000,
  });

  const messagesQuery = useQuery<AgentSupportTicketMessage[], unknown>({
    queryKey: ['agent-support-ticket-messages', ticketId],
    queryFn: () => getAgentSupportTicketMessages(ticketId),
    staleTime: 10_000,
  });

  const replyMutation = useMutation<AgentSupportTicketMessage, unknown, string>({
    mutationFn: (body) => createAgentSupportTicketMessage(ticketId, body),
    onSuccess: () => {
      setReplyText('');
      setReplyError('');
      void queryClient.invalidateQueries({
        queryKey: ['agent-support-ticket-messages', ticketId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['agent-support-ticket', ticketId],
      });
    },
    onError: (err) => {
      setReplyError(describeSupportError(err));
    },
  });

  const isRefreshing = ticketQuery.isRefetching || messagesQuery.isRefetching;

  const handleRefresh = () => {
    void ticketQuery.refetch();
    void messagesQuery.refetch();
  };

  const handleSendReply = () => {
    setReplyError('');
    const trimmed = replyText.trim();
    if (!trimmed) {
      setReplyError('Enter a message to reply.');
      return;
    }
    if (trimmed.length > 4000) {
      setReplyError('Message cannot exceed 4000 characters.');
      return;
    }
    replyMutation.mutate(trimmed);
  };

  const ticket = ticketQuery.data;
  const messages = messagesQuery.data ?? [];

  if (ticketQuery.isLoading) {
    return <LoadingState message="Loading ticket details…" testID="support-detail-loading" />;
  }

  if (ticketQuery.isError || !ticket) {
    return (
      <ErrorState
        title="Could Not Load Ticket"
        message={describeSupportError(ticketQuery.error)}
        onRetry={handleRefresh}
        retryLabel="Retry"
      />
    );
  }

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

  const renderHeader = () => (
    <View style={styles.headerBlock}>
      <Card style={styles.card} testID="support-detail-header-card">
        <View style={styles.topRow}>
          <Text style={styles.referenceText} testID="support-detail-reference">
            {ticket.reference}
          </Text>
          {renderStatusBadge(ticket.status)}
        </View>

        <Text style={styles.subjectText} testID="support-detail-subject">
          {ticket.subject}
        </Text>

        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Category:</Text>
          <Text style={styles.metaValue}>{ticket.category.replace('_', ' ')}</Text>
          <Text style={styles.metaLabel}>Priority:</Text>
          <Text style={styles.metaValue}>{ticket.priority}</Text>
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Created:</Text>
          <Text style={styles.metaValue}>{formatDate(ticket.createdAt)}</Text>
        </View>

        {ticket.relatedTransferId && (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Transfer ID:</Text>
            <Text style={styles.metaValue}>{ticket.relatedTransferId}</Text>
          </View>
        )}

        {ticket.fundingRequestId && (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Funding ID:</Text>
            <Text style={styles.metaValue}>{ticket.fundingRequestId}</Text>
          </View>
        )}
      </Card>

      <Card style={styles.card} testID="support-detail-desc-card">
        <Text style={styles.sectionSubtitle}>Description</Text>
        <Text style={styles.descriptionBody} testID="support-detail-description">
          {ticket.description}
        </Text>
      </Card>

      <Text style={styles.conversationTitle}>Conversation</Text>
    </View>
  );

  const renderMessageItem = ({ item }: { item: AgentSupportTicketMessage }) => {
    const isAgent = item.authorType === 'AGENT';
    return (
      <View
        style={[styles.messageBubble, isAgent ? styles.messageAgent : styles.messageSupport]}
        testID={`support-message-${item.id}`}
      >
        <View style={styles.messageHeader}>
          <Text style={[styles.messageAuthor, isAgent ? styles.authorAgent : styles.authorSupport]}>
            {isAgent ? 'You' : 'Support Team'}
          </Text>
          <Text style={styles.messageDate}>{formatDate(item.createdAt)}</Text>
        </View>
        <Text style={styles.messageBody}>{item.body}</Text>
      </View>
    );
  };

  const renderEmptyMessages = () => {
    if (messagesQuery.isLoading) {
      return <Text style={styles.muted}>Loading messages…</Text>;
    }
    return (
      <Card style={styles.emptyMessagesCard}>
        <Text style={styles.muted}>
          No additional messages yet. Send a message below to provide updates or ask questions.
        </Text>
      </Card>
    );
  };

  const renderFooter = () => (
    <View style={styles.footerBlock}>
      {ticket.status === 'CLOSED' ? (
        <Card style={styles.closedCard}>
          <Text style={styles.closedText}>
            This support ticket is closed. If you need further assistance, please create a new support
            request.
          </Text>
        </Card>
      ) : (
        <Card style={styles.replyCard}>
          <Text style={styles.sectionSubtitle}>Reply to Support</Text>
          <Input
            placeholder="Type your message here..."
            value={replyText}
            multiline
            numberOfLines={3}
            maxLength={4000}
            style={styles.replyInput}
            testID="support-reply-input"
            onChangeText={(text) => {
              setReplyText(text);
              setReplyError('');
            }}
          />

          {!!replyError && (
            <Text style={styles.errorText} testID="support-reply-error">
              {replyError}
            </Text>
          )}

          <Button
            loading={replyMutation.isPending}
            label={replyMutation.isPending ? 'Sending…' : 'Send Reply'}
            onPress={handleSendReply}
            testID="support-reply-button"
            style={styles.sendButton}
          />
        </Card>
      )}
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.flex}
    >
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessageItem}
        ListHeaderComponent={renderHeader}
        ListFooterComponent={renderFooter}
        ListEmptyComponent={renderEmptyMessages}
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
        testID="support-detail-view"
      />
    </KeyboardAvoidingView>
  );
};

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
  flex: { flex: 1, backgroundColor: theme.colors.neutral.offWhite },
  container: {
    flexGrow: 1,
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    backgroundColor: theme.colors.neutral.offWhite,
    gap: theme.spacing.md,
  },
  headerBlock: {
    gap: theme.spacing.md,
    marginBottom: theme.spacing.xs,
  },
  footerBlock: {
    marginTop: theme.spacing.sm,
  },
  card: {
    gap: theme.spacing.xs,
    backgroundColor: theme.colors.neutral.white,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
  },
  referenceText: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.light,
  },
  subjectText: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.charcoal,
    marginBottom: theme.spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    flexWrap: 'wrap',
  },
  metaLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
  },
  metaValue: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.charcoal,
    marginRight: theme.spacing.sm,
  },
  sectionSubtitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.charcoal,
    marginBottom: theme.spacing.xs,
  },
  descriptionBody: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.charcoal,
    lineHeight: 20,
  },
  conversationTitle: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.charcoal,
    marginTop: theme.spacing.xs,
    paddingHorizontal: theme.spacing.xs,
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
  messageBubble: {
    borderRadius: 12,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  messageAgent: {
    backgroundColor: '#EBF5FF',
    marginLeft: theme.spacing.xl,
    borderBottomRightRadius: 2,
  },
  messageSupport: {
    backgroundColor: theme.colors.neutral.white,
    marginRight: theme.spacing.xl,
    borderBottomLeftRadius: 2,
    borderWidth: 1,
    borderColor: theme.colors.neutral.lightGray,
  },
  messageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  messageAuthor: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
  },
  authorAgent: {
    color: theme.colors.primary.light,
  },
  authorSupport: {
    color: theme.colors.primary.main,
  },
  messageDate: {
    fontSize: 10,
    color: theme.colors.neutral.slate,
  },
  messageBody: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.charcoal,
    lineHeight: 18,
  },
  emptyMessagesCard: {
    padding: theme.spacing.md,
    alignItems: 'center',
    backgroundColor: theme.colors.neutral.white,
  },
  muted: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    textAlign: 'center',
  },
  replyCard: {
    gap: theme.spacing.xs,
    backgroundColor: theme.colors.neutral.white,
  },
  replyInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  sendButton: {
    marginTop: theme.spacing.xs,
  },
  errorText: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
  },
  closedCard: {
    backgroundColor: theme.colors.neutral.lightGray,
    padding: theme.spacing.md,
    alignItems: 'center',
  },
  closedText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    textAlign: 'center',
    lineHeight: 18,
  },
});
