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
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

// Helper to mock all 10 detail API calls
function mockDetailCalls() {
  (ApiClient.get as jest.Mock)
    .mockResolvedValueOnce(null)           // profile
    .mockResolvedValueOnce([])             // contacts
    .mockResolvedValueOnce([])             // addresses
    .mockResolvedValueOnce([])             // identity docs
    .mockResolvedValueOnce(null)           // kyc
    .mockResolvedValueOnce([])             // wallets
    .mockResolvedValueOnce(null)           // onboarding
    .mockResolvedValueOnce(null)           // risk
    .mockResolvedValueOnce([])             // compliance
    .mockResolvedValueOnce(null);          // eligibility
}

describe('Admin Web Customer Management V1', () => {
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
        roles: ['FINANCE_PREPARER'],
        scopes: ['finance:prepare'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      },
    });
  });

  test('should load and render customer listing', async () => {
    const mockCustomers = [
      {
        id: 'cust-uuid-1',
        reference: 'mn-08098765432',
        type: 'INDIVIDUAL',
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
        kycStatus: 'APPROVED',
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    (ApiClient.get as jest.Mock).mockResolvedValue(mockCustomers);

    const { getByText, findByText } = render(<App />);

    fireEvent.click(getByText('👥 Customer & KYC Servicing'));

    expect(ApiClient.get).toHaveBeenCalledWith(expect.stringContaining('/customers'));
    expect(await findByText('mn-08098765432')).toBeTruthy();
    expect(await findByText('1 Customer')).toBeTruthy();
  });

  test('should open multi-step registration form and submit customer with profile', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue([]);
    (ApiClient.post as jest.Mock).mockResolvedValue({
      id: 'new-cust-id',
      reference: 'mn-08011112222',
      type: 'INDIVIDUAL',
      status: 'ACTIVE',
      kycLevel: 'NONE',
      kycStatus: 'NOT_STARTED',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const { getByText, getByPlaceholderText, findByText } = render(<App />);

    fireEvent.click(getByText('👥 Customer & KYC Servicing'));

    // Open create form
    fireEvent.click(getByText('+ New Customer'));

    // Step 1: Identity
    expect(await findByText('Register New Customer')).toBeTruthy();
    fireEvent.change(getByPlaceholderText('e.g. MN-08012345678'), { target: { value: 'MN-08011112222' } });
    fireEvent.change(getByPlaceholderText('e.g. Adaeze Okafor'), { target: { value: 'Adaeze Okafor' } });

    // Continue to Step 2
    fireEvent.click(getByText('Continue →'));

    // Step 2: Contact
    fireEvent.change(getByPlaceholderText('e.g. +2348012345678'), { target: { value: '+2348012345678' } });

    // Continue to Step 3
    fireEvent.click(getByText('Continue →'));

    // Step 3: Address (optional, skip)
    fireEvent.click(getByText('Create Customer Profile'));

    await waitFor(() => {
      // Verify customer creation call
      expect(ApiClient.post).toHaveBeenCalledWith('/customers', {
        reference: 'mn-08011112222',
        type: 'INDIVIDUAL',
        status: 'ACTIVE',
        actor: 'iss:back-office-operator',
      });

      // Verify profile creation call
      expect(ApiClient.post).toHaveBeenCalledWith(
        '/customers/new-cust-id/profile',
        expect.objectContaining({ displayName: 'Adaeze Okafor', actor: 'iss:back-office-operator' }),
      );

      // Verify phone contact creation
      expect(ApiClient.post).toHaveBeenCalledWith(
        '/customers/new-cust-id/contact-method',
        expect.objectContaining({ type: 'PHONE', value: '+2348012345678', isPrimary: true }),
      );

      // Verify success message
      expect(getByText(/mn-08011112222.*created with full profile/)).toBeTruthy();
    });
  });

  test('should load customer detail with profile information', async () => {
    const mockCustomer = {
      id: 'cust-detail-1',
      reference: 'mn-08011112222',
      type: 'INDIVIDUAL',
      status: 'ACTIVE',
      kycLevel: 'LEVEL_1',
      kycStatus: 'APPROVED',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockProfile = {
      id: 'profile-1',
      customerId: 'cust-detail-1',
      displayName: 'Adaeze Okafor',
      legalName: 'Adaeze Ngozi Okafor',
      dateOfBirth: '1990-05-15',
      nationality: 'NG',
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    const mockContacts = [
      { id: 'c1', type: 'PHONE', value: '+2348012345678', isPrimary: true, verifiedAt: null },
      { id: 'c2', type: 'EMAIL', value: 'adaeze@example.com', isPrimary: false, verifiedAt: null },
    ];

    (ApiClient.get as jest.Mock)
      .mockResolvedValueOnce([mockCustomer]) // list customers
      .mockResolvedValueOnce(mockProfile)    // profile
      .mockResolvedValueOnce(mockContacts)   // contacts
      .mockResolvedValueOnce([])             // addresses
      .mockResolvedValueOnce([])             // identity docs
      .mockResolvedValueOnce(null)           // kyc
      .mockResolvedValueOnce([])             // wallets
      .mockResolvedValueOnce(null)           // onboarding
      .mockResolvedValueOnce(null)           // risk
      .mockResolvedValueOnce([])             // compliance
      .mockResolvedValueOnce(null);          // eligibility

    const { getByText, findByText } = render(<App />);

    fireEvent.click(getByText('👥 Customer & KYC Servicing'));

    // Click on customer
    const custRow = await findByText('mn-08011112222');
    fireEvent.click(custRow);

    // Verify profile tab loads with detail data
    expect(await findByText('Adaeze Ngozi Okafor')).toBeTruthy();
    expect(await findByText('+2348012345678')).toBeTruthy();
    expect(await findByText('adaeze@example.com')).toBeTruthy();
  });

  test('should submit KYC assessment from identity tab', async () => {
    const mockCustomer = {
      id: 'cust-kyc-1',
      reference: 'mn-08011112222',
      type: 'INDIVIDUAL',
      status: 'ACTIVE',
      kycLevel: 'NONE',
      kycStatus: 'NOT_STARTED',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    (ApiClient.get as jest.Mock)
      .mockResolvedValueOnce([mockCustomer]) // list
      .mockResolvedValueOnce(null)           // profile
      .mockResolvedValueOnce([])             // contacts
      .mockResolvedValueOnce([])             // addresses
      .mockResolvedValueOnce([])             // identity docs
      .mockResolvedValueOnce(null)           // kyc
      .mockResolvedValueOnce([])             // wallets
      .mockResolvedValueOnce(null)           // onboarding
      .mockResolvedValueOnce(null)           // risk
      .mockResolvedValueOnce([])             // compliance
      .mockResolvedValueOnce(null);          // eligibility

    (ApiClient.post as jest.Mock).mockResolvedValue({
      id: 'kyc-new',
      level: 'LEVEL_1',
      status: 'APPROVED',
      assessedBy: 'iss:back-office-operator',
      createdAt: new Date().toISOString(),
    });

    const { getByText, findByText } = render(<App />);

    fireEvent.click(getByText('👥 Customer & KYC Servicing'));
    fireEvent.click(await findByText('mn-08011112222'));

    // Wait for detail panel to finish loading
    expect(await findByText(/Personal Information/)).toBeTruthy();

    // Switch to Identity tab
    fireEvent.click(getByText('🪪 Identity & KYC'));

    // Submit KYC
    fireEvent.click(getByText('Submit Assessment'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/customers/cust-kyc-1/kyc-assessment', {
        level: 'LEVEL_1',
        status: 'PENDING',
        assessedBy: 'iss:back-office-operator',
      });
      expect(getByText('KYC Assessment recorded')).toBeTruthy();
    });
  });

  test('should submit status lock updates when suspend button is clicked', async () => {
    const mockCustomer = {
      id: 'cust-status-1',
      reference: 'mn-08011112222',
      type: 'INDIVIDUAL',
      status: 'ACTIVE',
      kycLevel: 'NONE',
      kycStatus: 'NOT_STARTED',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    (ApiClient.get as jest.Mock)
      .mockResolvedValueOnce([mockCustomer]) // list
      .mockResolvedValueOnce(null)           // profile
      .mockResolvedValueOnce([])             // contacts
      .mockResolvedValueOnce([])             // addresses
      .mockResolvedValueOnce([])             // identity docs
      .mockResolvedValueOnce(null)           // kyc
      .mockResolvedValueOnce([])             // wallets
      .mockResolvedValueOnce(null)           // onboarding
      .mockResolvedValueOnce(null)           // risk
      .mockResolvedValueOnce([])             // compliance
      .mockResolvedValueOnce(null);          // eligibility

    const { getByText, findByText } = render(<App />);

    fireEvent.click(getByText('👥 Customer & KYC Servicing'));
    fireEvent.click(await findByText('mn-08011112222'));

    // Wait for detail panel to finish loading
    expect(await findByText(/Personal Information/)).toBeTruthy();

    // Switch to Status tab
    fireEvent.click(getByText('🔄 Status'));

    // Trigger status update
    (ApiClient.patch as jest.Mock).mockResolvedValue({
      ...mockCustomer,
      status: 'SUSPENDED',
    });

    fireEvent.click(getByText('⏸ SUSPEND'));

    await waitFor(() => {
      expect(ApiClient.patch).toHaveBeenCalledWith('/customers/cust-status-1', {
        status: 'SUSPENDED',
        actor: 'iss:back-office-operator',
      });
      expect(getByText('Status updated to SUSPENDED')).toBeTruthy();
    });
  });
});
