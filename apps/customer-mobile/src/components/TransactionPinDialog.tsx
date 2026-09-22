import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';
import { Button } from './Button';
import { PinInput } from './PinInput';

interface TransactionPinDialogProps {
  visible: boolean;
  title: string;
  message: string;
  pin: string;
  onPinChange: (pin: string) => void;
  onAuthorize: () => void;
  onCancel: () => void;
  isLoading?: boolean;
  errorMessage?: string;
}

/**
 * Transaction step-up authorization dialog. The dialog never owns the PIN:
 * the parent holds it in component state and clears it after every
 * submission, so no plaintext PIN survives a completed or cancelled
 * authorization attempt.
 */
export const TransactionPinDialog: React.FC<TransactionPinDialogProps> = ({
  visible,
  title,
  message,
  pin,
  onPinChange,
  onAuthorize,
  onCancel,
  isLoading = false,
  errorMessage,
}) => {
  const pinTooShort = pin.length < 4;

  return (
    <Modal animationType="fade" transparent={true} visible={visible} onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.dialogContainer}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <Text style={styles.authorizationNote}>
            Authorize this transaction with your Transaction PIN.
          </Text>
          <PinInput
            label="Transaction PIN"
            value={pin}
            onChange={onPinChange}
            error={errorMessage}
          />
          <View style={styles.buttonContainer}>
            <Button
              disabled={isLoading}
              label="Cancel"
              style={styles.button}
              variant="outline"
              onPress={onCancel}
            />
            <Button
              disabled={pinTooShort}
              loading={isLoading}
              label="Authorize"
              style={[styles.button, styles.authorizeButton]}
              variant="primary"
              onPress={onAuthorize}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.lg,
  },
  dialogContainer: {
    width: '100%',
    backgroundColor: theme.colors.neutral.white,
    borderRadius: 12,
    padding: theme.spacing.lg,
  },
  title: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.neutral.black,
    marginBottom: theme.spacing.sm,
  },
  message: {
    fontSize: theme.typography.sizes.base,
    color: theme.colors.neutral.slate,
    marginBottom: theme.spacing.sm,
  },
  authorizationNote: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.gray,
    marginBottom: theme.spacing.md,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing.sm,
  },
  button: {
    flex: 1,
  },
  authorizeButton: {
    marginLeft: theme.spacing.sm,
  },
});

export default TransactionPinDialog;
