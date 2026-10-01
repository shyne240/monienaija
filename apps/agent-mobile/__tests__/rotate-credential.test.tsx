import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { RotateCredentialScreen } from '../src/screens/unauthenticated/RotateCredentialScreen';
import { useAuthStore } from '../src/store/auth-store';

describe('RotateCredentialScreen (mandatory first-login rotation)', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    useAuthStore.setState({
      isAuthenticated: false,
      isLoading: false,
      session: null,
      agentId: null,
      pendingRotation: { agentId: 'a1' },
      error: null,
    });
  });

  test('renders temporary/new/confirm password inputs', () => {
    const { getByTestId } = render(<RotateCredentialScreen />);
    expect(getByTestId('current-password-input')).toBeTruthy();
    expect(getByTestId('new-password-input')).toBeTruthy();
    expect(getByTestId('confirm-password-input')).toBeTruthy();
  });

  test('validates minimum length, confirmation mismatch and same-as-temporary rules', () => {
    const { getByTestId, getByText } = render(<RotateCredentialScreen />);

    fireEvent.changeText(getByTestId('current-password-input'), 'temporary-1');
    fireEvent.changeText(getByTestId('new-password-input'), 'short');
    fireEvent.changeText(getByTestId('confirm-password-input'), 'short');
    fireEvent.press(getByTestId('rotate-button'));
    expect(getByText('New password must be at least 8 characters')).toBeTruthy();

    fireEvent.changeText(getByTestId('new-password-input'), 'new-secret-9');
    fireEvent.changeText(getByTestId('confirm-password-input'), 'different-9');
    fireEvent.press(getByTestId('rotate-button'));
    expect(getByText('New password and confirmation do not match')).toBeTruthy();

    fireEvent.changeText(getByTestId('new-password-input'), 'temporary-1');
    fireEvent.changeText(getByTestId('confirm-password-input'), 'temporary-1');
    fireEvent.press(getByTestId('rotate-button'));
    expect(getByText('New password must differ from the temporary password')).toBeTruthy();
  });

  test('invokes rotateCredentials when inputs are valid', async () => {
    const rotateMock = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ rotateCredentials: rotateMock as never });
    const { getByTestId } = render(<RotateCredentialScreen />);
    fireEvent.changeText(getByTestId('current-password-input'), 'temporary-1');
    fireEvent.changeText(getByTestId('new-password-input'), 'new-secret-9');
    fireEvent.changeText(getByTestId('confirm-password-input'), 'new-secret-9');
    fireEvent.press(getByTestId('rotate-button'));
    await Promise.resolve();
    expect(rotateMock).toHaveBeenCalledWith('temporary-1', 'new-secret-9');
  });

  test('surfaces backend rotation errors (e.g. 403 not pending)', () => {
    useAuthStore.setState({ error: 'Credential rotation is not pending' });
    const { getByText } = render(<RotateCredentialScreen />);
    expect(getByText('Credential rotation is not pending')).toBeTruthy();
  });
});
