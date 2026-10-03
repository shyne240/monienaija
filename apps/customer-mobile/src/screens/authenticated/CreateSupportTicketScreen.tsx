import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { ApiClient, ApiError } from '../../services/api-client';
import { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'CreateSupportTicket'>;

const CATEGORIES = [
  'TRANSFER',
  'WALLET',
  'PIN',
  'AUTHENTICATION',
  'PROFILE',
  'CASH_IN',
  'CASH_OUT',
  'CASH_TO_CASH',
  'FUNDING',
  'OTHER',
] as const;

/**
 * V1-CUSTOMER-02 — Create a support ticket against the real, authenticated
 * `POST /customers/me/support/tickets` route. No financial action (wallet
 * mutation, transfer, PIN change) is reachable from this screen or its
 * backend route — support stays architecturally separate from the
 * financial control plane. No SLA/response-time promise is made anywhere
 * in this UI because none exists in the backend.
 */
export const CreateSupportTicketScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('OTHER');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');
    if (subject.trim().length < 3) {
      setError('Subject must be at least 3 characters.');
      return;
    }
    if (description.trim().length < 3) {
      setError('Please describe your issue (at least 3 characters).');
      return;
    }

    setIsLoading(true);
    try {
      await ApiClient.post('/customers/me/support/tickets', {
        subject: subject.trim(),
        category,
        description: description.trim(),
      });
      navigation.goBack();
    } catch (err: any) {
      setError(
        err instanceof ApiError ? err.message || 'Failed to submit ticket.' : 'Failed to submit ticket.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>New Support Ticket</Text>
          <Text style={styles.subtitle}>
            Tell us what went wrong. We cannot make any wallet or transfer changes from this form —
            a support agent will review your ticket separately.
          </Text>
        </View>

        {!!error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.form}>
          <Input
            label="Subject"
            placeholder="Brief summary of the issue"
            value={subject}
            onChangeText={setSubject}
          />

          <Text style={styles.label}>Category</Text>
          <View style={styles.chipRow}>
            {CATEGORIES.map((cat) => (
              <Button
                key={cat}
                label={cat.replace(/_/g, ' ')}
                size="small"
                style={styles.chip}
                variant={category === cat ? 'primary' : 'outline'}
                onPress={() => setCategory(cat)}
              />
            ))}
          </View>

          <Input
            multiline
            numberOfLines={5}
            style={styles.textArea}
            label="Description"
            placeholder="Describe what happened, including dates/amounts if relevant"
            value={description}
            onChangeText={setDescription}
          />

          <Button
            loading={isLoading}
            label="Submit Ticket"
            style={styles.button}
            onPress={handleSubmit}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.neutral.offWhite,
  },
  scrollContent: {
    flexGrow: 1,
    padding: theme.spacing.xl,
  },
  header: {
    marginBottom: theme.spacing.xl,
  },
  title: {
    fontSize: theme.typography.sizes.xxl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
    marginBottom: theme.spacing.sm,
  },
  subtitle: {
    fontSize: theme.typography.sizes.base,
    color: theme.colors.neutral.slate,
  },
  form: {
    width: '100%',
  },
  label: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.neutral.charcoal,
    marginBottom: theme.spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.md,
  },
  chip: {
    marginBottom: theme.spacing.xs,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  button: {
    marginTop: theme.spacing.md,
  },
  errorBanner: {
    backgroundColor: theme.colors.feedback.errorLight,
    padding: theme.spacing.md,
    borderRadius: 8,
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.feedback.error,
  },
  errorText: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
  },
});
