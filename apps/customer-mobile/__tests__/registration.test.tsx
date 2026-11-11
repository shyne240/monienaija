import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { RegistrationScreen } from '../src/screens/unauthenticated/RegistrationScreen';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

test('explains registration is unavailable without requesting identity or credentials', () => {
  const { getByText, queryByPlaceholderText } = render(<RegistrationScreen />);
  expect(getByText('Registration is temporarily unavailable.')).toBeTruthy();
  expect(queryByPlaceholderText('e.g. 08012345678')).toBeNull();
  fireEvent.press(getByText('Back to Sign In'));
  expect(mockNavigate).toHaveBeenCalledWith('Login');
});
