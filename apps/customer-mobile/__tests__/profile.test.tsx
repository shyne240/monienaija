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

  // V1-CUSTOMER-08
  test('renders KYC level/status from the authoritative backend response (previously fetched but never displayed)', async () => {
    const mockIdentity = {
      id: 'cust-uuid-888',
      reference: 'MN-08012345678',
      type: 'INDIVIDUAL',
      status: 'ACTIVE',
      kycLevel: 'LEVEL_2',
      kycStatus: 'APPROVED',
      createdAt: new Date().toISOString(),
    };
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/customers/me') return Promise.resolve(mockIdentity);
      if (url === '/customers/me/profile') return Promise.resolve({ profile: { displayName: 'Femi Kuti' } });
      if (url === '/customers/me/limits') return Promise.resolve({ products: [] });
      return Promise.reject(new Error('unexpected url'));
    });

    const { getByText } = render(<ProfileScreen />);

    await waitFor(() => {
      expect(getByText('LEVEL_2')).toBeTruthy();
      expect(getByText('APPROVED')).toBeTruthy();
      expect(getByText('ACTIVE')).toBeTruthy();
    });
  });

  // V1-CUSTOMER-08
  test('a SUSPENDED status is shown verbatim (never overridden to ACTIVE) with a support-contact explanation', async () => {
    const mockIdentity = {
      id: 'cust-uuid-888',
      reference: 'MN-08012345678',
      type: 'INDIVIDUAL',
      status: 'SUSPENDED',
      kycLevel: 'LEVEL_1',
      kycStatus: 'APPROVED',
      createdAt: new Date().toISOString(),
    };
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/customers/me') return Promise.resolve(mockIdentity);
      if (url === '/customers/me/profile') return Promise.resolve({ profile: { displayName: 'Femi Kuti' } });
      if (url === '/customers/me/limits') return Promise.resolve({ products: [] });
      return Promise.reject(new Error('unexpected url'));
    });

    const { getByText } = render(<ProfileScreen />);

    await waitFor(() => {
      expect(getByText('SUSPENDED')).toBeTruthy();
      expect(getByText(/account is suspended/i)).toBeTruthy();
    });
  });

  // V1-CUSTOMER-08
  test('renders only configured transaction limits, using customer-safe labels (no raw profile/rule ids ever shown)', async () => {
    const mockIdentity = {
      id: 'cust-uuid-888',
      reference: 'MN-08012345678',
      type: 'INDIVIDUAL',
      status: 'ACTIVE',
      kycLevel: 'LEVEL_1',
      kycStatus: 'APPROVED',
      createdAt: new Date().toISOString(),
    };
    const mockLimits = {
      products: [
        {
          product: 'WALLET_TRANSFER',
          direction: 'OUTGOING',
          configured: true,
          perTransactionMinMinor: null,
          perTransactionMaxMinor: '500000',
          windows: [
            {
              dimension: 'DAILY_AMOUNT',
              period: 'DAILY',
              kind: 'AMOUNT',
              limitMinor: '1000000',
              limitCount: null,
              remainingMinor: '700000',
              remainingCount: null,
            },
          ],
        },
        {
          product: 'CASH_TO_WALLET',
          direction: 'INCOMING',
          configured: false,
          perTransactionMinMinor: null,
          perTransactionMaxMinor: null,
          windows: [],
        },
      ],
    };
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/customers/me') return Promise.resolve(mockIdentity);
      if (url === '/customers/me/profile') return Promise.resolve({ profile: { displayName: 'Femi Kuti' } });
      if (url === '/customers/me/limits') return Promise.resolve(mockLimits);
      return Promise.reject(new Error('unexpected url'));
    });

    const { getByText, queryByText } = render(<ProfileScreen />);

    await waitFor(() => {
      expect(getByText('Transaction Limits')).toBeTruthy();
      expect(getByText('Send to Wallet')).toBeTruthy();
      expect(getByText(/Max ₦5,000.00/)).toBeTruthy();
      expect(getByText(/₦7,000.00 of ₦10,000.00/)).toBeTruthy();
      // Unconfigured product never rendered
      expect(queryByText('Cash-In via Agent')).toBeNull();
    });
  });

  // V1-CUSTOMER-08
  test('omits the Transaction Limits card entirely when nothing is configured (never fabricates a limit)', async () => {
    const mockIdentity = {
      id: 'cust-uuid-888',
      reference: 'MN-08012345678',
      type: 'INDIVIDUAL',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/customers/me') return Promise.resolve(mockIdentity);
      if (url === '/customers/me/profile') return Promise.resolve({ profile: { displayName: 'Femi Kuti' } });
      if (url === '/customers/me/limits') return Promise.resolve({ products: [{ product: 'WALLET_TRANSFER', direction: 'OUTGOING', configured: false, perTransactionMinMinor: null, perTransactionMaxMinor: null, windows: [] }] });
      return Promise.reject(new Error('unexpected url'));
    });

    const { queryByText, getByText } = render(<ProfileScreen />);

    await waitFor(() => {
      expect(getByText('cust-uuid-888')).toBeTruthy();
    });
    expect(queryByText('Transaction Limits')).toBeNull();
  });
});
