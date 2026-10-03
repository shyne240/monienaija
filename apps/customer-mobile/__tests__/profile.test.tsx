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

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
  }),
}));

/**
 * V1-CUSTOMER-02 — rewritten against the REAL, authenticated
 * `GET /customers/me` + `GET /customers/me/profile` endpoints. The previous
 * version of this test asserted the legacy unauthenticated
 * `GET /customers/:id` route.
 */
describe('Profile Screen Account Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should load and display customer identity information correctly', async () => {
    const mockIdentity = {
      id: 'cust-uuid-888',
      reference: 'MN-08012345678',
      type: 'INDIVIDUAL',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };
    const mockProfileDetail = {
      profile: { displayName: 'Femi Kuti', legalName: 'Olufemi Anikulapo Kuti' },
    };

    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/customers/me') return Promise.resolve(mockIdentity);
      if (url === '/customers/me/profile') return Promise.resolve(mockProfileDetail);
      return Promise.reject(new Error('unexpected url'));
    });

    const { getByText } = render(<ProfileScreen />);

    await waitFor(() => {
      expect(ApiClient.get).toHaveBeenCalledWith('/customers/me');
      expect(ApiClient.get).toHaveBeenCalledWith('/customers/me/profile');
      expect(getByText('Femi Kuti')).toBeTruthy();
      expect(getByText('Ref: MN-08012345678')).toBeTruthy();
      expect(getByText('cust-uuid-888')).toBeTruthy();
      expect(getByText('INDIVIDUAL')).toBeTruthy();
    });
  });

  test('should render error banner when the identity API call fails', async () => {
    (ApiClient.get as jest.Mock).mockRejectedValue(
      new ApiError('Failed to establish contact connection', 500),
    );

    const { getByText } = render(<ProfileScreen />);

    await waitFor(() => {
      expect(getByText('Failed to load profile details.')).toBeTruthy();
    });
  });
});
