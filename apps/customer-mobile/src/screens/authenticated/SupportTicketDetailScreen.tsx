import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { RouteProp, useFocusEffect, useRoute } from '@react-navigation/native';

import { theme } from '../../theme';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { ApiClient, ApiError } from '../../services/api-client';
import { RootStackParamList } from '../../navigation/types';

interface SupportTicket {
  id: string;
  reference: string;
  subject: string;
  category: string;
  description: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  priority: string;
  fundingRequestId: string | null;
  relatedTransferId: string | null;
  createdAt: string;
}

interface SupportTicketMessage {
  id: string;
  authorType: string;
  body: string;
  createdAt: string;
}

/**
 * V1-CUSTOMER-09 — Support ticket detail and reply.
 *
 * Reads/replies via the real, authenticated, ownership-scoped
 *   GET  /customers/me/support/tickets/:id
 *   GET  /customers/me/support/tickets/:id/messages
 *   POST /customers/me/support/tickets/:id/messages  (Idempotency-Key header)
 *
 * The backend already enforces that a customer can only ever see/reply to
 * their own ticket (any other ticket id 404s), that internal/staff-only
 * notes are filtered out before they ever reach this screen, and that a
 * closed or resolved ticket rejects new customer replies — this screen
 * reflects that server-decided state rather than re-implementing it.
 */
export const SupportTicketDetailScreen: React.FC = () => {
  const route = useRoute<RouteProp<RootStackParamList, 'SupportTicketDetail'>>();
  const { ticketId } = route.params;

  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportTicketMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [replyText, setReplyText] = useState('');
  const [replyError, setReplyError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [replyIdempotencyKey, setReplyIdempotencyKey] = useState('');

  const generateReplyKey = () => {
    const key = `support-reply-${ticketId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setReplyIdempotencyKey(key);
  };

  useEffect(() => {
    generateReplyKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  const load = useCallback(async () => {
    try {
      setLoadError('');
      const [ticketRes, messagesRes] = await Promise.all([
        ApiClient.get<SupportTicket>(`/customers/me/support/tickets/${ticketId}`),
        ApiClient.get<SupportTicketMessage[]>(`/customers/me/support/tickets/${ticketId}/messages`),
      ]);
      setTicket(ticketRes);
      setMessages(messagesRes || []);
    } catch (err: any) {
      setLoadError(
        err instanceof ApiError ? err.message || 'Failed to load this ticket.' : 'Failed to load this ticket.',
      );
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [ticketId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handleSendReply = async () => {
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
    setIsSending(true);
    try {
      await ApiClient.post(
        `/customers/me/support/tickets/${ticketId}/messages`,
        { body: trimmed },
        { idempotencyKey: replyIdempotencyKey },
      );
      setReplyText('');
      generateReplyKey();
      await load();
    } catch (err: any) {
      setReplyError(
        err instanceof ApiError ? err.message || 'Failed to send your reply.' : 'Failed to send your reply.',
      );
    } finally {
      setIsSending(false);
    }
  };

  if (isLoading) {
    return <LoadingState message="Loading ticket..." />;
  }

  if (loadError || !ticket) {
    return (
      <ErrorState
        title="Could Not Load Ticket"
        message={loadError || 'This ticket could not be found.'}
        onRetry={load}
      />
    );
  }

  const canReply = ticket.status !== 'CLOSED' && ticket.status !== 'RESOLVED';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
      <SafeAreaView style={styles.flex}>
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[theme.colors.primary.main]} />
          }
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.headerBlock}>
              <Card variant="flat" style={styles.card} testID="support-detail-header-card">
                <View style={styles.topRow}>
                  <Text style={styles.reference}>{ticket.reference}</Text>
                  <Text style={[styles.statusBadge, statusStyle(ticket.status)]}>{ticket.status}</Text>
                </View>
                <Text style={styles.subject} testID="support-detail-subject">
                  {ticket.subject}
                </Text>
                <Text style={styles.meta}>{ticket.category.replace(/_/g, ' ')} · {ticket.priority}</Text>
              </Card>

              <Card variant="flat" style={styles.card}>
                <Text style={styles.sectionTitle}>Description</Text>
                <Text style={styles.description} testID="support-detail-description">
                  {ticket.description}
                </Text>
              </Card>

              <Text style={styles.sectionTitle}>Conversation</Text>
            </View>
          }
          renderItem={({ item }) => {
            const isCustomer = item.authorType === 'CUSTOMER';
            return (
              <View
                style={[styles.bubble, isCustomer ? styles.bubbleCustomer : styles.bubbleSupport]}
                testID={`support-message-${item.id}`}
              >
                <Text style={styles.bubbleAuthor}>{isCustomer ? 'You' : 'Support Team'}</Text>
                <Text style={styles.bubbleBody}>{item.body}</Text>
              </View>
            );
          }}
          ListEmptyComponent={
            <Card variant="flat" style={styles.card}>
              <Text style={styles.muted}>No messages yet. Send one below if you need to add more detail.</Text>
            </Card>
          }
          ListFooterComponent={
            <View style={styles.footerBlock}>
              {canReply ? (
                <Card variant="flat" style={styles.card}>
                  <Text style={styles.sectionTitle}>Reply</Text>
                  <Input
                    placeholder="Type your message..."
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
                    loading={isSending}
                    label="Send Reply"
                    onPress={handleSendReply}
                    style={styles.sendButton}
                    testID="support-reply-button"
                  />
                </Card>
              ) : (
                <Card variant="flat" style={styles.card}>
                  <Text style={styles.muted}>
                    This ticket is {ticket.status.toLowerCase()}. If you need further help, please create a new
                    support ticket.
                  </Text>
                </Card>
              )}
            </View>
          }
        />
      </SafeAreaView>
    </KeyboardAvoidingView>
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
  flex: { flex: 1, backgroundColor: theme.colors.neutral.offWhite },
  listContent: {
    padding: theme.spacing.lg,
  },
  headerBlock: {
    gap: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  footerBlock: {
    marginTop: theme.spacing.sm,
  },
  card: {
    marginBottom: theme.spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
  },
  reference: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.slate,
  },
  statusBadge: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
  },
  subject: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.charcoal,
    marginBottom: theme.spacing.xxs,
  },
  meta: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.charcoal,
    marginBottom: theme.spacing.xs,
  },
  description: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.charcoal,
    lineHeight: 20,
  },
  bubble: {
    borderRadius: 12,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  bubbleCustomer: {
    backgroundColor: '#EBF5FF',
    marginLeft: theme.spacing.xl,
  },
  bubbleSupport: {
    backgroundColor: theme.colors.neutral.white,
    marginRight: theme.spacing.xl,
    borderWidth: 1,
    borderColor: theme.colors.neutral.lightGray,
  },
  bubbleAuthor: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
    marginBottom: theme.spacing.xxs,
  },
  bubbleBody: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.charcoal,
  },
  muted: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    textAlign: 'center',
  },
  replyInput: {
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: theme.spacing.sm,
  },
  sendButton: {
    marginTop: theme.spacing.xs,
  },
  errorText: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.xs,
    marginBottom: theme.spacing.xs,
  },
});
