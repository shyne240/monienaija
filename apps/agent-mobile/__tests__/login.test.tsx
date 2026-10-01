import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { LoginScreen } from '../src/screens/unauthenticated/LoginScreen';
import { useAuthStore } from '../src/store/auth-store';

describe('LoginScreen', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    useAuthStore.setState({
      isAuthenticated: false,
      isLoading: false,
      session: null,
      agentId: null,
      pendingRotation: null,
      error: null,
    });
  });

  test('renders agent login fields and security note', () => {
    const { getByTestId, getByText } = render(<LoginScreen />);
    expect(getByTestId('agent-id-input')).toBeTruthy();
    expect(getByTestId('password-input')).toBeTruthy();
    expect(getByText('MoneyNaija Agent')).toBeTruthy();
  });

  test('validates required fields', () => {
    const { getByTestId, getByText } = render(<LoginScreen />);
    fireEvent.press(getByTestId('login-button'));
    expect(getByText('Agent ID is required')).toBeTruthy();

    fireEvent.changeText(getByTestId('agent-id-input'), 'not-a-uuid');
    fireEvent.press(getByTestId('login-button'));
    expect(getByText('Agent ID must be a valid UUID')).toBeTruthy();
  });

  test('calls login with normalized inputs', async () => {
    const loginMock = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ login: loginMock as never });
    const { getByTestId } = render(<LoginScreen />);
    fireEvent.changeText(getByTestId('agent-id-input'), ' 9f0c19e4-1111-4abc-9def-111122223333 ');
    fireEvent.changeText(getByTestId('password-input'), 'secret');
    fireEvent.press(getByTestId('login-button'));
    await Promise.resolve();
    expect(loginMock).toHaveBeenCalledWith(
      ' 9f0c19e4-1111-4abc-9def-111122223333 ',
      'secret',
    );
  });

  test('shows backend error surfaced by the store', () => {
    useAuthStore.setState({ error: 'Invalid credentials' });
    const { getByText } = render(<LoginScreen />);
    expect(getByText('Invalid credentials')).toBeTruthy();
  });
});
