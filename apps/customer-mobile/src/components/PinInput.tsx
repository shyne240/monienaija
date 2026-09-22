import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { theme } from '../theme';

interface PinInputProps {
  label: string;
  value: string;
  onChange: (pin: string) => void;
  error?: string;
  helperText?: string;
  autoFocus?: boolean;
  maxLength?: number;
  testID?: string;
}

/**
 * Numeric transaction PIN entry. The PIN is kept ONLY in the parent
 * component's React state: it is never written to secure storage, the global
 * store, logs, or analytics, and parents clear it after every submission.
 */
export const PinInput: React.FC<PinInputProps> = ({
  label,
  value,
  onChange,
  error,
  helperText,
  autoFocus = false,
  maxLength = 6,
  testID,
}) => {
  const handleChange = (text: string) => {
    // Numeric-only policy: silently drop any non-digit input.
    onChange(text.replace(/[^0-9]/g, '').slice(0, maxLength));
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrapper, !!error && styles.inputError]}>
        <TextInput
          accessibilityLabel={label}
          autoFocus={autoFocus}
          keyboardType="number-pad"
          maxLength={maxLength}
          placeholder="••••"
          placeholderTextColor={theme.colors.neutral.gray}
          secureTextEntry={true}
          style={styles.input}
          testID={testID}
          value={value}
          onChangeText={handleChange}
        />
      </View>
      {!!error ? <Text style={styles.error}>{error}</Text> : null}
      {!error && !!helperText ? <Text style={styles.helper}>{helperText}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: theme.spacing.md,
  },
  label: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.slate,
    marginBottom: theme.spacing.xs,
  },
  inputWrapper: {
    borderWidth: 1,
    borderColor: theme.colors.neutral.lightGray,
    borderRadius: 8,
    backgroundColor: theme.colors.neutral.white,
  },
  inputError: {
    borderColor: theme.colors.feedback.error,
  },
  input: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontSize: theme.typography.sizes.xxl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.black,
    textAlign: 'center',
    letterSpacing: 8,
  },
  error: {
    marginTop: theme.spacing.xs,
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.feedback.error,
  },
  helper: {
    marginTop: theme.spacing.xs,
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.gray,
  },
});

export default PinInput;
