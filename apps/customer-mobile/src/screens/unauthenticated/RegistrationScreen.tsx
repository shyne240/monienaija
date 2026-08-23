import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { ApiClient } from '../../services/api-client';
import { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Registration'>;

export const RegistrationScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [registeredUser, setRegisteredUser] = useState<{ id: string; reference: string } | null>(null);
  const [error, setError] = useState('');

  const handleRegister = async () => {
    if (!phone.trim()) {
      setError('Phone number is required');
      return;
    }
    if (!name.trim()) {
      setError('Full Name is required');
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      // Calls actual NestJS customer endpoint: POST /customers
      const result = await ApiClient.post<{ id: string; reference: string }>('/customers', {
        reference: `MN-${phone.trim()}`,
        type: 'INDIVIDUAL',
        status: 'ACTIVE',
        actor: name.trim(),
      });

      setRegisteredUser(result);
    } catch (err: any) {
      setError(err?.message || 'Onboarding registration failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (registeredUser) {
    return (
      <View style={styles.successContainer}>
        <View style={styles.successContent}>
          <Text style={styles.successIcon}>🎉</Text>
          <Text style={styles.successTitle}>Wallet Created Successfully!</Text>
          <Text style={styles.successDescription}>
            Your MoneyNaija wallet has been provisioned under the sandbox environment.
          </Text>

          <View style={styles.detailsCard}>
            <Text style={styles.detailLabel}>CUSTOMER REFERENCE</Text>
            <Text style={styles.detailValue}>{registeredUser.reference}</Text>

            <Text style={[styles.detailLabel, { marginTop: theme.spacing.md }]}>CUSTOMER ID (UUID)</Text>
            <Text style={styles.detailValueSelectable}>{registeredUser.id}</Text>
          </View>

          <Text style={styles.copyWarning}>
            Copy the Customer ID above. You will use it as your Username to Log In.
          </Text>
        </View>

        <Button
          label="Proceed to Log In"
          style={styles.button}
          onPress={() => navigation.navigate('Login')}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Create Wallet</Text>
          <Text style={styles.subtitle}>Get started with a secure individual mobile money wallet</Text>
        </View>

        {!!error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.form}>
          <Input
            keyboardType="phone-pad"
            label="Phone Number"
            placeholder="e.g. 08012345678"
            value={phone}
            onChangeText={(text) => {
              setPhone(text);
              if (error) setError('');
            }}
          />

          <Input
            label="Full Name"
            placeholder="e.g. Babajide Alao"
            value={name}
            onChangeText={(text) => {
              setName(text);
              if (error) setError('');
            }}
          />

          <Button
            loading={isLoading}
            label="Register Account"
            style={styles.button}
            onPress={handleRegister}
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
    justifyContent: 'center',
  },
  header: {
    marginBottom: theme.spacing.xxl,
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
  successContainer: {
    flex: 1,
    backgroundColor: theme.colors.neutral.offWhite,
    padding: theme.spacing.xl,
    justifyContent: 'space-between',
  },
  successContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  successIcon: {
    fontSize: 64,
    marginBottom: theme.spacing.lg,
  },
  successTitle: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  successDescription: {
    fontSize: theme.typography.sizes.base,
    color: theme.colors.neutral.slate,
    textAlign: 'center',
    marginBottom: theme.spacing.xl,
  },
  detailsCard: {
    backgroundColor: theme.colors.neutral.white,
    padding: theme.spacing.lg,
    borderRadius: 12,
    width: '100%',
    borderWidth: 1,
    borderColor: theme.colors.neutral.lightGray,
    marginBottom: theme.spacing.md,
  },
  detailLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    fontWeight: theme.typography.weights.semibold,
  },
  detailValue: {
    fontSize: theme.typography.sizes.base,
    color: theme.colors.neutral.charcoal,
    fontWeight: theme.typography.weights.bold,
    marginTop: theme.spacing.xs,
  },
  detailValueSelectable: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.primary.main,
    fontWeight: theme.typography.weights.bold,
    marginTop: theme.spacing.xs,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  copyWarning: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.feedback.warning,
    textAlign: 'center',
    fontWeight: theme.typography.weights.semibold,
  },
});
