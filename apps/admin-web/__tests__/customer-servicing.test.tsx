import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import App from '../src/App';
import { useAuthStore } from '../src/store/auth-store';
import { ApiClient } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

describe('Admin Web Portal W2 Customer & Wallet Servicing Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      token: 'operator-bearer',
      sessionId: 'operator-sess',
      principal: {
        type: 'OPERATOR',
        principalId: 'iss:back-office-operator',
        sessionId: 'operator-sess',
        audience: 'workforce-admin',
        roles: ['FINANCE_PREPARER'], // Maker-eligible
        scopes: ['finance:prepare'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      },
    });
  });

  test('should load and render customer listing cleanly', async () => {
    const mockCustomers = [
      {
        id: 'cust-uuid-w2-1',
        reference: 'MN-08098765432',
        type: 'INDIVIDUAL',
        status: 'ACTIVE',
        actor: 'Femi Cole',
        createdAt: new Date().toISOString(),
      },
    ];

    (ApiClient.get as jest.Mock).mockResolvedValue(mockCustomers);

    const { getByText, findByText, findAllByText } = render(<App />);

    // Navigate to Customer directory
    fireEvent.click(getByText('👥 Customer & KYC Servicing'));

    expect(ApiClient.get).toHaveBeenCalledWith('/customers');
    expect(await findByText('MN-08098765432')).toBeTruthy();
    expect((await findAllByText('INDIVIDUAL')).length).toBeGreaterThan(0);
    expect((await findAllByText('ACTIVE')).length).toBeGreaterThan(0);
  });

  test('should submit customer registration payload on form submit', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue([]);
    (ApiClient.post as jest.Mock).mockResolvedValue({
      id: 'new-cust-id',
      reference: 'MN-08011112222',
    });

    const { getByText, getByPlaceholderText } = render(<App />);

    fireEvent.click(getByText('👥 Customer & KYC Servicing'));

    // Open create form
    fireEvent.click(getByText('➕ Register Customer'));

    // Fill form
    fireEvent.change(getByPlaceholderText('e.g. MN-08012345678'), { target: { value: 'MN-08011112222' } });

    // Submit
    fireEvent.click(getByText('Register Profile'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/customers', {
        reference: 'MN-08011112222',
        type: 'INDIVIDUAL',
        status: 'ACTIVE',
        actor: 'iss:back-office-operator',
      });
      expect(getByText('Customer created successfully! ID: new-cust-id')).toBeTruthy();
    });
  });

  test('should load details, submit KYC assessment, and provision an NGN kobo wallet on detail screen', async () => {
    const mockCustomer = {
      id: 'cust-w2-details',
      reference: 'MN-08011112222',
      type: 'INDIVIDUAL',
      status: 'ACTIVE',
      actor: 'Femi Cole',
      createdAt: new Date().toISOString(),
    };

    const mockWallets = [
      {
        id: 'wallet-w2-id',
        customerId: 'cust-w2-details',
        type: 'PRIMARY',
        currency: 'NGN',
        status: 'ACTIVE',
        balanceMinor: 350050, // 3500.50 Naira
      },
    ];

    const mockKyc = {
      id: 'kyc-w2-id',
      level: 'LEVEL_1',
      status: 'APPROVED',
      assessedBy: 'iss:back-office-operator',
      createdAt: new Date().toISOString(),
    };

    (ApiClient.get as jest.Mock)
      .mockResolvedValueOnce([mockCustomer]) // list customers
      .mockResolvedValueOnce(mockWallets)    // load wallets
      .mockResolvedValueOnce(mockKyc);       // load KYC

    const { getByText, findByText, getByPlaceholderText, getAllByText } = render(<App />);

    fireEvent.click(getByText('👥 Customer & KYC Servicing'));

    // View details
    expect(await findByText('View & Service')).toBeTruthy();
    fireEvent.click(getByText('View & Service'));

    // Verify wallets balance formats properly (₦3,500.50)
    expect(await findByText('₦3,500.50')).toBeTruthy();
    expect(await findByText('ID: wallet-w2-id')).toBeTruthy();

    // Verify KYC displays
    expect(await findByText('LEVEL_1')).toBeTruthy();

    // Submit a KYC assessment update
    (ApiClient.post as jest.Mock).mockResolvedValue({
      id: 'kyc-new-id',
      level: 'LEVEL_2',
      status: 'APPROVED',
      assessedBy: 'iss:back-office-operator',
    });

    fireEvent.change(getByPlaceholderText('e.g. Identity documents successfully verified'), {
      target: { value: 'Level 2 documents verified' },
    });

    fireEvent.click(getAllByText('Submit KYC Assessment')[1]);

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/customers/cust-w2-details/kyc-assessment', {
        level: 'LEVEL_1',
        status: 'APPROVED',
        reason: 'Level 2 documents verified',
        assessedBy: 'iss:back-office-operator',
      });
      expect(getByText('KYC Assessment verified successfully!')).toBeTruthy();
    });

    // Provision NGN wallet
    (ApiClient.post as jest.Mock).mockResolvedValue({ id: 'new-wallet-id' });
    (ApiClient.get as jest.Mock).mockResolvedValue(mockWallets); // reload wallets on success

    fireEvent.click(getByText('Provision Wallet'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/customers/cust-w2-details/wallets', {
        type: 'PRIMARY',
        currency: 'NGN',
        status: 'ACTIVE',
        actor: 'iss:back-office-operator',
      });
      expect(getByText('NGN Wallet provisioned successfully!')).toBeTruthy();
    });
  });

  test('should submit status lock updates when suspend button is clicked', async () => {
    const mockCustomer = {
      id: 'cust-w2-details',
      reference: 'MN-08011112222',
      type: 'INDIVIDUAL',
      status: 'ACTIVE',
      actor: 'Femi Cole',
      createdAt: new Date().toISOString(),
    };

    (ApiClient.get as jest.Mock)
      .mockResolvedValueOnce([mockCustomer]) // list customers
      .mockResolvedValueOnce([])             // load wallets
      .mockResolvedValueOnce(null);          // load kyc

    const { getByText, findByText } = render(<App />);

    fireEvent.click(getByText('👥 Customer & KYC Servicing'));

    expect(await findByText('View & Service')).toBeTruthy();
    fireEvent.click(getByText('View & Service'));

    // Trigger status update
    (ApiClient.patch as jest.Mock).mockResolvedValue({
      ...mockCustomer,
      status: 'SUSPENDED',
    });

    fireEvent.click(getByText('SUSPEND'));

    await waitFor(() => {
      expect(ApiClient.patch).toHaveBeenCalledWith('/customers/cust-w2-details', {
        status: 'SUSPENDED',
        actor: 'iss:back-office-operator',
      });
      expect(getByText('Customer status locked to SUSPENDED successfully.')).toBeTruthy();
    });
  });
});
