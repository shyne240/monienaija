import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { RegistrationScreen } from '../src/screens/unauthenticated/RegistrationScreen';
import { ApiClient, ApiError } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    post: jest.fn(),
  },
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

describe('Onboarding Registration Screen Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should show validation error when phone or name is empty', async () => {
    const { getByText } = render(<RegistrationScreen />);
    
    // Tap register without typing anything
    fireEvent.press(getByText('Register Account'));
    
    expect(getByText('Phone number is required')).toBeTruthy();
  });

  test('should register successfully and display generated Customer ID', async () => {
    const mockApiResponse = {
      id: 'cust-uuid-1111-2222',
      reference: 'MN-08012345678',
    };

    (ApiClient.post as jest.Mock).mockResolvedValue(mockApiResponse);

    const { getByPlaceholderText, getByText } = render(<RegistrationScreen />);

    fireEvent.changeText(getByPlaceholderText('e.g. 08012345678'), '08012345678');
    fireEvent.changeText(getByPlaceholderText('e.g. Babajide Alao'), 'Babajide Alao');

    fireEvent.press(getByText('Register Account'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/customers', {
        reference: 'MN-08012345678',
        type: 'INDIVIDUAL',
        status: 'ACTIVE',
        actor: 'Babajide Alao',
      });
      expect(getByText('Wallet Created Successfully!')).toBeTruthy();
      expect(getByText('cust-uuid-1111-2222')).toBeTruthy();
    });

    // Tap navigate to login
    fireEvent.press(getByText('Proceed to Log In'));
    expect(mockNavigate).toHaveBeenCalledWith('Login');
  });

  test('should handle duplicate customer reference / 409 conflict correctly', async () => {
    (ApiClient.post as jest.Mock).mockRejectedValue(
      new ApiError('Customer with reference already exists', 409)
    );

    const { getByPlaceholderText, getByText } = render(<RegistrationScreen />);

    fireEvent.changeText(getByPlaceholderText('e.g. 08012345678'), '08012345678');
    fireEvent.changeText(getByPlaceholderText('e.g. Babajide Alao'), 'Babajide Alao');

    fireEvent.press(getByText('Register Account'));

    await waitFor(() => {
      expect(getByText('Customer with reference already exists')).toBeTruthy();
    });
  });
});
