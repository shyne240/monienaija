import React, { useState } from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { ApiClient } from '../src/services/api-client';
import { GlobalSearch } from '../src/screens/authenticated/GlobalSearch';
import { ActionItems } from '../src/components/dashboard/ActionItems';

jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn() } }));
const mockGet = ApiClient.get as jest.Mock;
const item = { id: 'synthetic-customer', reference: 'local-reference', displayName: 'Synthetic Search Customer', legalName: null };
const result = { data: [item], page: 1, limit: 5, total: 1 };
function Search({ allowed = true, session = 'one', openCustomer = jest.fn() }: { allowed?: boolean; session?: string; openCustomer?: (id: string) => void }) {
  const [query, setQuery] = useState('');
  return <GlobalSearch query={query} onQuery={setQuery} canSearchCustomers={allowed} sessionKey={session} workspaces={[{ key:'dashboard', label:'Operational Dashboard' }]} onWorkspace={jest.fn()} onCustomer={openCustomer} />;
}
beforeEach(() => mockGet.mockReset());

test('search uses the authorized customer endpoint and opens the returned identity', async () => {
  mockGet.mockResolvedValue(result);
  const open = jest.fn(); const view = render(<Search openCustomer={open} />);
  fireEvent.change(view.getByRole('searchbox'), { target: { value: 'Synthetic Search' } });
  const option = await view.findByRole('button', { name: /Synthetic Search Customer/ });
  expect(mockGet).toHaveBeenCalledWith('/internal/customers?page=1&limit=5&search=Synthetic+Search');
  fireEvent.click(option);
  expect(open).toHaveBeenCalledWith('synthetic-customer');
});

test('customer search makes no request without authorization and clears results on session change', async () => {
  mockGet.mockResolvedValue(result);
  const view = render(<Search />);
  fireEvent.change(view.getByRole('searchbox'), { target: { value: 'Synthetic' } });
  await view.findByRole('button', { name: /Synthetic Search Customer/ });
  view.rerender(<Search allowed={false} session="two" />);
  expect(view.queryByRole('button', { name: /Synthetic Search Customer/ })).toBeNull();
  mockGet.mockClear();
  fireEvent.change(view.getByRole('searchbox'), { target: { value: 'another' } });
  await new Promise(resolve => setTimeout(resolve, 350));
  expect(mockGet).not.toHaveBeenCalled();
});

test('action queue only calls permitted sources and uses real support counts', async () => {
  mockGet.mockResolvedValue({ items: [{ status:'OPEN' }], pagination: { page:1, limit:1, total:12 } });
  const navigate = jest.fn(); const view = render(<ActionItems canKyc={false} canSupport canApprovals={false} onNavigate={navigate} />);
  const queue = view.getByRole('region', { name:'Action items' });
  await waitFor(() => expect(within(queue).getByText('12')).toBeTruthy());
  expect(mockGet).toHaveBeenCalledTimes(1);
  expect(mockGet).toHaveBeenCalledWith('/internal/support/tickets?page=1&limit=1&status=OPEN');
  fireEvent.click(within(queue).getByRole('button', { name:'Open support tickets' }));
  expect(navigate).toHaveBeenCalledWith('support');
});

test('invalid action count is unavailable, not zero', async () => {
  mockGet.mockResolvedValue({ items:[], pagination:{page:1,limit:1,total:-1} });
  const view = render(<ActionItems canKyc={false} canSupport canApprovals={false} onNavigate={jest.fn()} />);
  expect(await view.findByText('Unavailable')).toBeTruthy();
  expect(view.queryByText('0')).toBeNull();
});
