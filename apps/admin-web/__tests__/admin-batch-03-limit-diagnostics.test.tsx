import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
import { LimitAssignmentScreen } from '../src/screens/authenticated/LimitAssignmentScreen';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

function setPrincipal(roles: string[], scopes: string[]) {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'test-token',
    sessionId: 'test-session',
    principal: {
      type: 'OPERATOR',
      principalId: `issuer:${roles[0] ?? 'test'}`,
      sessionId: 'test-session',
      audience: 'workforce-admin',
      roles,
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
}

describe('Admin Web batch 03: limit read-only diagnostics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ApiClient.get as jest.Mock).mockResolvedValue({ items: [] });
    (ApiClient.post as jest.Mock).mockResolvedValue({});
  });

  test('usage and reservation panels query existing filtered, paginated read endpoints and render structured rows', async () => {
    setPrincipal(['FINANCE_AUDITOR'], ['limit.view']);
    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path === '/internal/limit-assignments') return Promise.resolve({ items: [] });
      if (path.startsWith('/internal/limit-usages?')) {
        return Promise.resolve({ page: 1, limit: 20, total: 21, totalPages: 2, data: [{ id: '32f243d5-b746-45aa-94fd-3ff7b06d211d', principalType: 'AGENT', principalId: '66c608d8-e71e-48a9-a217-83034c6b724d', limitProfileCode: 'AGENT_STANDARD', product: 'CASH_IN', dimension: 'DAILY_AMOUNT', currency: 'NGN', windowType: 'DAILY', windowKey:'2026-10-23', windowStart: '2026-10-23T00:00:00.000Z', windowEnd:'2026-10-24T00:00:00.000Z', usedAmountMinor: '250000', usedCount: 2, reservedAmountMinor: '50000', reservedCount: 1 }] });
      }
      if (path.startsWith('/internal/limit-reservations?')) {
        return Promise.resolve({ page: 1, limit: 20, total: 1, totalPages: 1, staleThresholdMinutes: 30, data: [{ id: '8cd8c00d-f4d8-4b6c-9ff8-81e6ee75c022', status: 'RESERVED', principalType: 'AGENT', principalId: '66c608d8-e71e-48a9-a217-83034c6b724d', limitProfileCode: 'AGENT_STANDARD', product: 'CASH_IN', dimension:'DAILY_AMOUNT', windowType:'DAILY', windowKey:'2026-10-23', windowStart:'2026-10-23T00:00:00.000Z', windowEnd:'2026-10-24T00:00:00.000Z', idempotencyKey:'sample-key', amountMinor: '50000', count:null, version:1, currency: 'NGN', reservedAt: '2026-10-23T09:00:00.000Z', ageSeconds: 3600, stale: true, correlationId: 'corr-1' }] });
      }
      return Promise.resolve({ items: [] });
    });

    const view = render(<LimitAssignmentScreen />);
    await waitFor(() => expect(ApiClient.get).toHaveBeenCalledWith('/internal/limit-assignments'));
    expect(ApiClient.get).not.toHaveBeenCalledWith(expect.stringContaining('/internal/limit-usages'));
    expect(ApiClient.get).not.toHaveBeenCalledWith(expect.stringContaining('/internal/limit-reservations'));

    fireEvent.change(view.getAllByPlaceholderText('Profile code')[0], { target: { value: 'AGENT_STANDARD' } });
    fireEvent.change(view.getAllByPlaceholderText('Product')[0], { target: { value: 'CASH_IN' } });
    fireEvent.click(view.getByRole('button', { name: 'Search usage' }));
    expect((await view.findAllByText('250000')).length).toBeGreaterThan(0);
    expect(view.getByText('Total 21 · Page 1 of 2')).toBeTruthy();
    expect(ApiClient.get).toHaveBeenCalledWith('/internal/limit-usages?page=1&limit=20&limitProfileCode=AGENT_STANDARD&product=CASH_IN');
    fireEvent.click(view.getByRole('button', { name: 'Next usage page' }));
    await waitFor(() => expect(ApiClient.get).toHaveBeenCalledWith('/internal/limit-usages?page=2&limit=20&limitProfileCode=AGENT_STANDARD&product=CASH_IN'));

    fireEvent.change(view.getByLabelText('Stale only'), { target: { value: 'true' } });
    fireEvent.click(view.getByRole('button', { name: 'Search reservations' }));
    expect(await view.findByText(/Stale threshold 30 min/)).toBeTruthy();
    expect((await view.findAllByText('3,600')).length).toBeGreaterThan(0);
    expect(view.getByText(/Total 1 · Page 1 of 1/)).toBeTruthy();
    expect(ApiClient.get).toHaveBeenCalledWith('/internal/limit-reservations?page=1&limit=20&stale=true');
    expect(view.container.querySelector('pre')).toBeNull();
    expect(view.queryByText('requestHash')).toBeNull();
  });

  test('assignment-only principals do not issue assignment list or diagnostics GET requests without limit.view', async () => {
    setPrincipal(['AGENT_NETWORK_MANAGER'], ['agent.assign_limit']);
    const view = render(<LimitAssignmentScreen />);
    expect(view.getByTestId('limit-view-required-notice')).toBeTruthy();
    expect(view.getByText(/shown only to principals with/)).toBeTruthy();
    expect(ApiClient.get).not.toHaveBeenCalled();
    expect(ApiClient.get).not.toHaveBeenCalledWith(expect.stringContaining('/internal/limit-usages'));
    expect(ApiClient.get).not.toHaveBeenCalledWith(expect.stringContaining('/internal/limit-reservations'));
  });
});

test('customer-context diagnostics remain scoped to that customer', async () => {
  setPrincipal(['FINANCE_AUDITOR'], ['limit.view']);
  const customer='66c608d8-e71e-48a9-a217-83034c6b724d';
  (ApiClient.get as jest.Mock).mockImplementation((path:string)=>path.includes('/customer/')?Promise.resolve({data:[]}):Promise.resolve({page:1,limit:20,total:0,totalPages:1,data:[],staleThresholdMinutes:30}));
  const view=render(<LimitAssignmentScreen initialCustomerId={customer}/>);
  expect(view.getByText(/Diagnostics are scoped to customer/)).toBeTruthy();
  for (const input of view.getAllByPlaceholderText('Principal ID') as HTMLInputElement[]) { expect(input.value).toBe(customer); expect(input.disabled).toBe(true); }
  for (const input of view.getAllByPlaceholderText('Principal type') as HTMLInputElement[]) { expect(input.value).toBe('CUSTOMER'); expect(input.disabled).toBe(true); }
  fireEvent.click(view.getByRole('button',{name:'Search usage'}));
  fireEvent.click(view.getByRole('button',{name:'Search reservations'}));
  await waitFor(()=>expect(ApiClient.get).toHaveBeenCalledWith(`/internal/limit-usages?page=1&limit=20&principalType=CUSTOMER&principalId=${customer}`));
  await waitFor(()=>expect(ApiClient.get).toHaveBeenCalledWith(`/internal/limit-reservations?page=1&limit=20&principalType=CUSTOMER&principalId=${customer}`));
});

test('mismatched diagnostic rows produce an error rather than a false empty or unrelated result',async()=>{
  setPrincipal(['FINANCE_AUDITOR'],['limit.view']);
  const customer='66c608d8-e71e-48a9-a217-83034c6b724d';
  const row={id:'32f243d5-b746-45aa-94fd-3ff7b06d211d',principalType:'CUSTOMER',principalId:'66c608d8-e71e-48a9-a217-83034c6b724e',limitProfileCode:'STANDARD',product:'TRANSFER',dimension:'DAILY_AMOUNT',currency:'NGN',windowType:'DAILY',windowKey:'2026-11-06',windowStart:'2026-11-06T00:00:00Z',windowEnd:'2026-11-07T00:00:00Z',usedAmountMinor:'300',reservedAmountMinor:'0',usedCount:1,reservedCount:0};
  (ApiClient.get as jest.Mock).mockImplementation((path:string)=>path.includes('/customer/')?Promise.resolve({data:[]}):Promise.resolve({page:1,limit:20,total:1,totalPages:1,data:[row]}));
  const view=render(<LimitAssignmentScreen initialCustomerId={customer}/>);fireEvent.click(view.getByRole('button',{name:'Search usage'}));
  expect(await view.findByText('Diagnostics returned an invalid or mismatched page.')).toBeTruthy();expect(view.queryByText('300')).toBeNull();expect(view.queryByText('No usage rows match these filters.')).toBeNull();
});
