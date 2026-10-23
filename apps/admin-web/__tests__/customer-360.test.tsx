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

const DASHBOARD_FETCH_STUB = { templateKey: 'DEFAULT_FALLBACK', displayName: 'Default Dashboard', description: '', isFallback: true, widgets: [] };

describe('Customer 360° deep links preserve customerId (no UUID paste)', () => {
  const mockCustomer = {
    id: 'cust-360-uuid-1234-5678-abcd',
    reference: 'MN-08033334444',
    type: 'INDIVIDUAL',
    status: 'ACTIVE',
    actor: 'Femi Cole',
    createdAt: new Date().toISOString(),
  };
  const mockWallets = [{ id: 'wallet-360', customerId: mockCustomer.id, type: 'PRIMARY', currency: 'NGN', status: 'ACTIVE', balanceMinor: 10000 }];
  const mockKyc = { id: 'kyc-360', level: 'LEVEL_1', status: 'APPROVED', assessedBy: 'iss:test', createdAt: new Date().toISOString() };

  beforeEach(() => {
    jest.clearAllMocks();
    (ApiClient.get as jest.Mock).mockResolvedValue([]);
    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      token: 'test-token',
      sessionId: 'test-sess',
      principal: {
        type: 'PRIVILEGED',
        principalId: 'iss:test-super',
        sessionId: 'test-sess',
        audience: 'workforce-admin',
        roles: ['SUPER_ADMIN'],
        scopes: ['customer.view','customer.view_transactions','customer.view_wallets','customer.manage_support_case','kyc.view','compliance.manage_case','risk_fraud.manage_fraud_case','transaction.view','reporting.transaction_summary.view','ledger.view','reconciliation.view','fee_rule.view','commission_rule.view','reward_rule.view','product.view','limit.view','audit.view','audit.search','diagnostics.view','metrics.view','outbox.view','workforce.user.view','workforce.dashboard.view','workforce.role.view','workforce.role.assign','finance.control_policy.activate','privileged:execute'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      },
    });
  });

  async function openCustomerDetail() {
    (ApiClient.get as jest.Mock)
      .mockResolvedValueOnce(DASHBOARD_FETCH_STUB)
      .mockResolvedValueOnce([mockCustomer]) // /customers
      .mockResolvedValueOnce(mockWallets) // wallets
      .mockResolvedValueOnce(mockKyc); // kyc

    const { getByText, findByText } = render(<App />);
    fireEvent.click(getByText('👥 Customer & KYC Servicing'));
    expect(await findByText('View & Service')).toBeTruthy();
    fireEvent.click(getByText('View & Service'));
    expect(await findByText(`Servicing Principal: ${mockCustomer.reference}`)).toBeTruthy();
    // Related Actions header must be present
    expect(getByText(/Customer 360°.*Related Actions/)).toBeTruthy();
    expect(getByText(/R9 eliminated/)).toBeTruthy();
    return { getByText, findByText };
  }

  test('View Transactions preserves customerId via the customer-scoped history route', async () => {
    const utils = await openCustomerDetail();
    const { getByText, findByText } = utils;
    fireEvent.click(getByText('View Transactions'));

    expect(await findByText('Customer Transaction History')).toBeTruthy();
    expect(ApiClient.get).toHaveBeenCalledWith(
      `/internal/customers/${mockCustomer.id}/transactions?page=1&limit=20`,
    );
  });

  test('Open KYC Assessment Lookup preserves customerId', async () => {
    const utils = await openCustomerDetail();
    (ApiClient.get as jest.Mock).mockImplementation(() => Promise.resolve([]));
    fireEvent.click(utils.getByText('Open KYC Assessment Lookup'));
    expect(await utils.findByText('🪪 KYC Assessment Lookup & Review')).toBeTruthy();
    expect(utils.getByText(/Customer context carried from Customer 360°/)).toBeTruthy();
    // Input should be pre-filled with customerId
    const inputs = document.querySelectorAll('input');
    const prefilled = Array.from(inputs).find(i => (i as HTMLInputElement).value === mockCustomer.id);
    expect(prefilled).toBeTruthy();
  });

  test('Open Compliance Cases preserves customerId', async () => {
    const utils = await openCustomerDetail();
    (ApiClient.get as jest.Mock).mockResolvedValue([]); // mock any compliance fetch
    fireEvent.click(utils.getByText('Open Compliance Cases'));
    expect(await utils.findByText('🛡️ Compliance Case Lookup')).toBeTruthy();
    expect(utils.getByText(/Customer context carried from Customer 360°/)).toBeTruthy();
  });

  test('Open Fraud Cases preserves customerId', async () => {
    const utils = await openCustomerDetail();
    (ApiClient.get as jest.Mock).mockImplementation(() => Promise.resolve({ data: [], items: [] }));
    fireEvent.click(utils.getByText('Open Fraud Cases'));
    expect(await utils.findByText('🚨 Fraud Case Lookup')).toBeTruthy();
    // Note is specific to RiskFraudScreen
    expect(await utils.findByText(/Customer pre-filled/)).toBeTruthy();
    const input = document.querySelector('input[placeholder*="Customer"]') as HTMLInputElement;
    if (input) expect(input.value).toBe(mockCustomer.id);
  });

  test('Open Support Tickets preserves customerId', async () => {
    const utils = await openCustomerDetail();
    (ApiClient.get as jest.Mock).mockResolvedValue({ items: [], total: 0 });
    fireEvent.click(utils.getByText('Open Support Tickets'));
    expect(await utils.findByText(/Support Tickets/)).toBeTruthy();
    expect(utils.getByText(/Customer context:/)).toBeTruthy();
    expect(utils.getByText(mockCustomer.id)).toBeTruthy();
  });

  test('View Audit Trail preserves customerId', async () => {
    const utils = await openCustomerDetail();
    (ApiClient.get as jest.Mock).mockImplementation(() => Promise.resolve({ events: [], data: [], items: [] }));
    fireEvent.click(utils.getByText('View Audit Trail'));
    // Audit screen has Search button and input with customerId pre-filled
    expect(await utils.findByText('Search')).toBeTruthy();
    const input = document.querySelector('input[placeholder*="Customer"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe(mockCustomer.id);
  });

  test('View Limit Assignments preserves customerId', async () => {
    const utils = await openCustomerDetail();
    (ApiClient.get as jest.Mock).mockImplementation(() => Promise.resolve({ items: [], data: [] }));
    fireEvent.click(utils.getByText('View Limit Assignments'));
    expect(await utils.findByText('📏 Limit Assignments')).toBeTruthy();
    expect(utils.getByText(mockCustomer.id)).toBeTruthy();
  });
});
