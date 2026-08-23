import React from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { theme } from '../theme';

interface AmountInputProps {
  label?: string;
  value: string; // The decimal value as a string (e.g. "1500.50")
  onChangeValue: (value: string, amountMinor: number) => void;
  error?: string;
  currencySymbol?: string;
}

export const AmountInput: React.FC<AmountInputProps> = ({
  label = 'Amount',
  value,
  onChangeValue,
  error,
  currencySymbol = '₦',
}) => {
  const [isFocused, setIsFocused] = React.useState(false);

  const handleChangeText = (text: string) => {
    // Only allow digits and a single decimal point
    const sanitized = text.replace(/[^0-9.]/g, '');
    const parts = sanitized.split('.');
    
    // Prevent multiple decimals
    let finalValue = sanitized;
    if (parts.length > 2) {
      finalValue = `${parts[0]}.${parts.slice(1).join('')}`;
    }

    // Limit decimal places to 2 (kobo)
    if (parts[1] && parts[1].length > 2) {
      finalValue = `${parts[0]}.${parts[1].slice(0, 2)}`;
    }

    // Calculate minor units (kobo)
    const floatVal = parseFloat(finalValue);
    const amountMinor = isNaN(floatVal) ? 0 : Math.round(floatVal * 100);

    onChangeValue(finalValue, amountMinor);
  };

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View
        style={[
          styles.inputContainer,
          isFocused && styles.focused,
          !!error && styles.errorInput,
        ]}
      >
        <Text style={styles.currencySymbol}>{currencySymbol}</Text>
        <TextInput
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={theme.colors.neutral.gray}
          style={styles.input}
          value={value}
          onChangeText={handleChangeText}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: theme.spacing.lg,
    width: '100%',
  },
  label: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.neutral.charcoal,
    marginBottom: theme.spacing.xs,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.neutral.lightGray,
    borderRadius: 8,
    backgroundColor: theme.colors.neutral.white,
    paddingHorizontal: theme.spacing.md,
    height: 56,
  },
  currencySymbol: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
    marginRight: theme.spacing.sm,
  },
  input: {
    flex: 1,
    height: '100%',
    color: theme.colors.neutral.black,
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.semibold,
    padding: 0,
  },
  focused: {
    borderColor: theme.colors.primary.main,
  },
  errorInput: {
    borderColor: theme.colors.feedback.error,
  },
  errorText: {
    color: theme.colors.feedback.error,
    fontSize: theme.typography.sizes.xs,
    marginTop: theme.spacing.xs,
  },
});
