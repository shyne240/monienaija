import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SupportTicketsScreen } from '../src/screens/authenticated/SupportTicketsScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn(), post: jest.fn() } }));
const ticket = (id: string) => ({ id, reference: `T-${id}`, status: 'OPEN', assignedTo: null, version: 1, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' });
const message = (id: string) => ({ id: `m-${id}`, ticketId: id, authorType: 'OPERATOR', authorId: 'operator', body: `private-${id}`, isInternal: true, createdAt: '2026-11-01T00:00:00Z' });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function session(id: string) { useAuthStore.setState({ principal: { type: 'OPERATOR', principalId: 'operator', sessionId: id, audience: 'workforce-admin', roles: ['SUPPORT'], scopes: ['customer.manage_support_case'], customerAccess: 'NONE', assuranceLevel: 'MFA' }, sessionId: id, token: id, isAuthenticated: true }); }
beforeEach(() => { jest.clearAllMocks(); session('one'); });
function views() { return screen.getAllByRole('button', { name: 'View' }); }

test('out-of-order detail and messages never cross ticket selection; draft clears', async () => {
  const detailA = deferred<any>(); const messagesA = deferred<any>();
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path.includes('?')) return Promise.resolve({ items: [ticket('A'), ticket('B')], pagination: { total: 2 } });
    if (path.endsWith('/A/messages')) return messagesA.promise;
    if (path.endsWith('/B/messages')) return Promise.resolve([message('B')]);
    if (path.endsWith('/A')) return detailA.promise;
    return Promise.resolve(ticket('B'));
  });
  render(<SupportTicketsScreen />); await screen.findByText('T-A');
  fireEvent.click(views()[0]); fireEvent.click(views()[1]);
  await screen.findByText('private-B');
  await act(async () => { detailA.resolve(ticket('A')); await detailA.promise; });
  expect(screen.getByText('private-B')).toBeTruthy(); expect(screen.queryByText('Ticket T-A')).toBeNull();
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'draft for B' } });
  fireEvent.click(views()[0]); await act(async () => { await Promise.resolve(); });
  expect((screen.getByLabelText('Message') as HTMLInputElement).value).toBe('');
  fireEvent.click(views()[1]); await screen.findByText('private-B');
  await act(async () => { messagesA.resolve([message('A')]); await messagesA.promise; });
  expect(screen.queryByText('private-A')).toBeNull();
});

test('session change clears selected data and ignores late message reads', async () => {
  const late = deferred<any>();
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => path.includes('?') ? Promise.resolve({ items: [ticket('A')], pagination: { total: 1 } }) : path.endsWith('/messages') ? late.promise : Promise.resolve(ticket('A')));
  render(<SupportTicketsScreen />); await screen.findByText('T-A'); fireEvent.click(views()[0]); await screen.findByLabelText('Message');
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'secret draft' } });
  act(() => session('two'));
  await act(async () => { late.resolve([message('A')]); await late.promise; });
  expect(screen.queryByText('private-A')).toBeNull(); expect(screen.queryByDisplayValue('secret draft')).toBeNull();
});

test('mismatched message receipt is uncertain, single-flight and requires reload', async () => {
  const pending = deferred<any>();
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => path.includes('?') ? Promise.resolve({ items: [ticket('A')], pagination: { total: 1 } }) : path.endsWith('/messages') ? Promise.resolve([]) : Promise.resolve(ticket('A')));
  (ApiClient.post as jest.Mock).mockReturnValue(pending.promise);
  render(<SupportTicketsScreen />); await screen.findByText('T-A'); fireEvent.click(views()[0]); await screen.findByLabelText('Message');
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Customer reply' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(ApiClient.post).toHaveBeenCalledTimes(1); expect((views()[0] as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { pending.resolve({ ...message('other'), body: 'Customer reply', isInternal: false }); await pending.promise; });
  expect(await screen.findByText(/Message receipt did not match/)).toBeTruthy();
  expect(screen.queryByText('Customer-visible message added.')).toBeNull(); expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reload ticket and inspect' }));
  await waitFor(() => expect(screen.queryByText(/Message receipt did not match/)).toBeNull());
});

test('invalid detail or cross-ticket messages are rejected rather than showing stale records', async () => {
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => path.includes('?') ? Promise.resolve({ items: [ticket('A')], pagination: { total: 1 } }) : path.endsWith('/messages') ? Promise.resolve([message('B')]) : Promise.resolve(ticket('B')));
  render(<SupportTicketsScreen />); await screen.findByText('T-A'); fireEvent.click(views()[0]);
  await screen.findByText('Ticket detail returned an invalid response.');
  expect(screen.queryByLabelText('Message')).toBeNull();
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => path.includes('?') ? Promise.resolve({ items: [ticket('A')], pagination: { total: 1 } }) : path.endsWith('/messages') ? Promise.resolve([message('B')]) : Promise.resolve(ticket('A')));
  fireEvent.click(views()[0]); await screen.findByText('Ticket messages returned an invalid response.'); expect(screen.queryByText('private-B')).toBeNull();
});

test('status updates require a matching newer version before confirmation', async () => {
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => path.includes('?') ? Promise.resolve({ items: [ticket('A')], pagination: { total: 1 } }) : path.endsWith('/messages') ? Promise.resolve([]) : Promise.resolve(ticket('A')));
  (ApiClient.post as jest.Mock).mockResolvedValueOnce({ ...ticket('A'), status: 'CLOSED', version: 2 }).mockResolvedValueOnce({ ...ticket('A'), status: 'RESOLVED', version: 2 });
  render(<SupportTicketsScreen />); await screen.findByText('T-A'); fireEvent.click(views()[0]); await screen.findByLabelText('Message');
  fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
  await screen.findByText(/Status receipt did not match/); expect(screen.queryByText('Status → RESOLVED')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Reload ticket and inspect' }));
  await screen.findByLabelText('Message'); fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
  expect(await screen.findByText('Status → RESOLVED')).toBeTruthy();
  expect(ApiClient.post).toHaveBeenLastCalledWith('/internal/support/tickets/A/status', { status: 'RESOLVED', version: 1 });
});

test('late mutation receipt after a session change cannot confirm or refresh old ticket', async () => {
  const pending = deferred<any>();
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => path.includes('?') ? Promise.resolve({ items: [ticket('A')], pagination: { total: 1 } }) : path.endsWith('/messages') ? Promise.resolve([]) : Promise.resolve(ticket('A')));
  (ApiClient.post as jest.Mock).mockReturnValue(pending.promise);
  render(<SupportTicketsScreen />); await screen.findByText('T-A'); fireEvent.click(views()[0]); await screen.findByLabelText('Message');
  fireEvent.click(screen.getByRole('button', { name: 'Resolve' })); act(() => session('two'));
  await act(async () => { pending.resolve({ ...ticket('A'), status: 'RESOLVED', version: 2 }); await pending.promise; });
  expect(screen.queryByText('Status → RESOLVED')).toBeNull(); expect(screen.queryByLabelText('Message')).toBeNull();
});
