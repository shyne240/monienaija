import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { ProfileScreen } from '../src/screens/authenticated/ProfileScreen';
import { ApiClient, ApiError } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
  },
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

jest.mock('../src/store/auth-store', () => ({
  useAuthStore: () => ({
    customerId: 'cust-uuid-888',
    logout: jest.fn(),
  }),
}));

describe('Profile Screen Account Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should load and display customer profiles information correctly', async () => {
    const mockProfile = {
      id: 'cust-uuid-888',
      reference: 'MN-08012345678',
      type: 'INDIVIDUAL',
      status: 'ACTIVE',
      actor: 'Femi Kuti',
      createdAt: new Date().toISOString(),
    };

    (ApiClient.get as jest.Mock).mockResolvedValue(mockProfile);

    const { getByText } = render(<ProfileScreen />);

    await waitFor(() => {
      expect(ApiClient.get).toHaveBeenCalledWith('/customers/cust-uuid-888');
      expect(getByText('Femi Kuti')).toBeTruthy();
      expect(getByText('Ref: MN-08012345678')).toBeTruthy();
      expect(getByText('cust-uuid-888')).toBeTruthy();
      expect(getByText('INDIVIDUAL')).toBeTruthy();
    });
  });

  test('should render error banner when profile API call fails', async () => {
    (ApiClient.get as jest.Mock).mockRejectedValue(
      new ApiError('Failed to establish contact connection', 500)
    );

    const { getByText } = render(<ProfileScreen />);

    await waitFor(() => {
      expect(getByText('Failed to load profile details.')).toBeTruthy();
    });
  });
});
