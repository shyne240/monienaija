import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { theme } from '../../../theme';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { Input } from '../../../components/Input';
import {
  createAgentSupportTicket,
  describeSupportError,
  type AgentSupportTicket,
  type CreateAgentSupportTicketInput,
  type SupportTicketCategory,
  type SupportTicketPriority,
} from '../../../services/agent-api';
import { useAuthStore } from '../../../store/auth-store';
import type { RootStackParamList } from '../../../navigation/types';

const CATEGORIES: Array<{ key: SupportTicketCategory; label: string }> = [
  { key: 'CASH_IN', label: 'Cash→Wallet' },
  { key: 'CASH_OUT', label: 'Wallet→Cash' },
  { key: 'CASH_TO_CASH', label: 'Cash→Cash' },
  { key: 'PIN', label: 'Transaction PIN' },
  { key: 'TERMINAL', label: 'Terminal / POS' },
  { key: 'AGENT_FUNDING', label: 'Agent Funding' },
  { key: 'OUTLET', label: 'Outlet' },
  { key: 'AUTHENTICATION', label: 'Login & Access' },
  { key: 'OTHER', label: 'Other Issue' },
];

const PRIORITIES: Array<{ key: SupportTicketPriority; label: string }> = [
  { key: 'LOW', label: 'Low' },
  { key: 'MEDIUM', label: 'Medium' },
  { key: 'HIGH', label: 'High' },
  { key: 'CRITICAL', label: 'Critical' },
];

/**
 * Agent Create Support Request Screen (V1-AGENT-MOBILE-11).
 *
 * Implements ticket creation conforming to POST /agents/me/support/tickets.
 * Enforces client-side validation, generates idempotency keys, and provides safe error feedback.
 */
export const CreateSupportTicketScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CreateSupportTicket'>>();
  const { agentId } = useAuthStore();
  const queryClient = useQueryClient();

  const [category, setCategory] = useState<SupportTicketCategory>(
    route.params?.prefillCategory ?? 'CASH_IN',
  );
  const [priority, setPriority] = useState<SupportTicketPriority>('MEDIUM');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [relatedTransferId, setRelatedTransferId] = useState(
    route.params?.relatedTransferId ?? '',
  );
  const [clientError, setClientError] = useState('');
  const [createdTicket, setCreatedTicket] = useState<AgentSupportTicket | null>(null);

  const createMutation = useMutation<AgentSupportTicket, unknown, CreateAgentSupportTicketInput>({
    mutationFn: (input) => createAgentSupportTicket(input),
    onSuccess: (data) => {
      setCreatedTicket(data);
      void queryClient.invalidateQueries({ queryKey: ['agent-support-tickets', agentId] });
    },
  });

  const handleSubmit = () => {
    setClientError('');

    const trimmedSubject = subject.trim();
    const trimmedDesc = description.trim();

    if (!trimmedSubject || trimmedSubject.length < 3) {
      setClientError('Subject must be at least 3 characters.');
      return;
    }
    if (trimmedSubject.length > 200) {
      setClientError('Subject must be at most 200 characters.');
      return;
    }

    if (!trimmedDesc || trimmedDesc.length < 3) {
      setClientError('Description must be at least 3 characters.');
      return;
    }
    if (trimmedDesc.length > 4000) {
      setClientError('Description must be at most 4000 characters.');
      return;
    }

    const payload: CreateAgentSupportTicketInput = {
      subject: trimmedSubject,
      category,
      description: trimmedDesc,
      priority,
      idempotencyKey: `sup-ticket-${agentId || 'agent'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };

    if (relatedTransferId.trim()) {
      payload.relatedTransferId = relatedTransferId.trim();
    }
    if (route.params?.fundingRequestId) {
      payload.fundingRequestId = route.params.fundingRequestId;
    }

    createMutation.mutate(payload);
  };

  const errorMessage = clientError
    ? clientError
    : createMutation.isError
      ? describeSupportError(createMutation.error)
      : '';

  if (createdTicket) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Card style={styles.successCard} testID="support-success-card">
          <Text style={styles.checkMark}>✓</Text>
          <Text style={styles.successTitle} testID="support-success-title">
            Support Request Submitted
          </Text>
          <Text style={styles.successReference} testID="support-success-reference">
            Reference: {createdTicket.reference}
          </Text>
          <Text style={styles.successMessage}>
            Your request has been routed to our operations support team. You will be able to follow
            up and receive updates directly in the app.
          </Text>

          <View style={styles.successActions}>
            <Button
              label="View Request"
              onPress={() => {
                navigation.replace('SupportTicketDetail', { ticketId: createdTicket.id });
              }}
              testID="support-view-ticket-button"
            />
            <Button
              label="Back to Support"
              variant="outline"
              onPress={() => navigation.navigate('Support')}
              testID="support-back-to-list-button"
            />
          </View>
        </Card>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.flex}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>New Support Request</Text>
        <Text style={styles.helper}>
          Describe the issue you are experiencing. Our support team will investigate and reply
          promptly.
        </Text>

        <Card style={styles.card}>
          {/* Category Selector */}
          <Text style={styles.fieldLabel}>Category</Text>
          <View style={styles.chipGrid} testID="category-selector">
            {CATEGORIES.map((cat) => {
              const selected = category === cat.key;
              return (
                <TouchableOpacity
                  key={cat.key}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => {
                    setCategory(cat.key);
                    setClientError('');
                  }}
                  testID={`category-chip-${cat.key}`}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Priority Selector */}
          <Text style={styles.fieldLabel}>Priority</Text>
          <View style={styles.priorityRow} testID="priority-selector">
            {PRIORITIES.map((p) => {
              const selected = priority === p.key;
              return (
                <TouchableOpacity
                  key={p.key}
                  style={[styles.priorityChip, selected && styles.priorityChipSelected]}
                  onPress={() => setPriority(p.key)}
                  testID={`priority-chip-${p.key}`}
                >
                  <Text style={[styles.priorityText, selected && styles.priorityTextSelected]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Subject */}
          <Input
            label="Subject"
            placeholder="e.g. Cash→Wallet transaction delayed"
            value={subject}
            maxLength={200}
            testID="support-input-subject"
            onChangeText={(text) => {
              setSubject(text);
              setClientError('');
            }}
          />

          {/* Description */}
          <Input
            label="Description"
            placeholder="Provide details about the issue (amount, customer, reference numbers, or terminal ID)..."
            value={description}
            multiline
            numberOfLines={4}
            maxLength={4000}
            style={styles.textArea}
            testID="support-input-description"
            onChangeText={(text) => {
              setDescription(text);
              setClientError('');
            }}
          />

          {/* Optional Related Transfer ID */}
          <Input
            label="Related Transfer ID (Optional)"
            placeholder="e.g. transfer UUID if applicable"
            value={relatedTransferId}
            testID="support-input-transfer-id"
            onChangeText={(text) => {
              setRelatedTransferId(text);
              setClientError('');
            }}
          />

          {!!errorMessage && (
            <Text style={styles.errorText} testID="support-form-error">
              {errorMessage}
            </Text>
          )}

          <Button
            loading={createMutation.isPending}
            label={createMutation.isPending ? 'Submitting…' : 'Submit Support Request'}
            onPress={handleSubmit}
            testID="support-submit-button"
            style={styles.submitButton}
          />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.neutral.offWhite },
  container: {
    flexGrow: 1,
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    backgroundColor: theme.colors.neutral.offWhite,
    gap: theme.spacing.md,
  },
  title: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
  },
  helper: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    lineHeight: 20,
  },
  card: {
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.neutral.white,
  },
  fieldLabel: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.charcoal,
    marginTop: theme.spacing.xs,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
  },
  chip: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.neutral.lightGray,
    backgroundColor: theme.colors.neutral.white,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
  },
  chipSelected: {
    borderColor: theme.colors.primary.main,
    backgroundColor: theme.colors.primary.main,
  },
  chipText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.charcoal,
  },
  chipTextSelected: {
    color: theme.colors.neutral.white,
    fontWeight: theme.typography.weights.semibold,
  },
  priorityRow: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
  },
  priorityChip: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.neutral.lightGray,
    paddingVertical: theme.spacing.xs,
    backgroundColor: theme.colors.neutral.white,
  },
  priorityChipSelected: {
    borderColor: theme.colors.primary.light,
    backgroundColor: theme.colors.neutral.offWhite,
  },
  priorityText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
  },
  priorityTextSelected: {
    color: theme.colors.primary.light,
    fontWeight: theme.typography.weights.bold,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  errorText: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    marginVertical: theme.spacing.xs,
  },
  submitButton: {
    marginTop: theme.spacing.xs,
  },
  successCard: {
    alignItems: 'center',
    paddingVertical: theme.spacing.xl,
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.neutral.white,
  },
  checkMark: {
    fontSize: 48,
    color: theme.colors.feedback.success,
    marginBottom: theme.spacing.xs,
  },
  successTitle: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
    textAlign: 'center',
  },
  successReference: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.primary.light,
  },
  successMessage: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    textAlign: 'center',
    lineHeight: 20,
    marginHorizontal: theme.spacing.md,
  },
  successActions: {
    width: '100%',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
});
