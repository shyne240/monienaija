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
  fireEvent.click(views()[0]); expect(screen.getByRole('group', { name: 'Discard ticket changes' })).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Discard changes' })); await act(async () => { await Promise.resolve(); });
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

test('unconfirmed message retains a single idempotency key across reload and retry', async () => {
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => path.includes('?') ? Promise.resolve({ items: [ticket('A')], pagination: { total: 1 } }) : path.endsWith('/messages') ? Promise.resolve([]) : Promise.resolve(ticket('A')));
  (ApiClient.post as jest.Mock).mockRejectedValueOnce(new Error('Network lost')).mockResolvedValueOnce({ ...message('A'), body: 'Customer reply', isInternal: false });
  render(<SupportTicketsScreen />); await screen.findByText('T-A'); fireEvent.click(views()[0]); await screen.findByText('No messages on this ticket.');
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Customer reply' } }); fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByText(/Network lost/); const first = (ApiClient.post as jest.Mock).mock.calls[0][2].idempotencyKey; expect(first).toMatch(/^[0-9a-f]{48}$/);
  fireEvent.click(screen.getByRole('button', { name: 'Reload ticket and inspect' })); await waitFor(() => expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false));
  expect((screen.getByLabelText('Message') as HTMLInputElement).value).toBe('Customer reply'); expect((screen.getByLabelText('Message') as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); expect(await screen.findByText('Customer-visible message added.')).toBeTruthy(); expect((ApiClient.post as jest.Mock).mock.calls[1][2].idempotencyKey).toBe(first);
});

test('failed history reload does not unlock an uncertain message retry', async () => {
  let historyReads = 0;
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => path.includes('?') ? Promise.resolve({ items: [ticket('A')], pagination: { total: 1 } }) : path.endsWith('/messages') ? (++historyReads === 1 ? Promise.resolve([]) : Promise.reject(new Error('History unavailable'))) : Promise.resolve(ticket('A')));
  (ApiClient.post as jest.Mock).mockRejectedValue(new Error('Network lost'));
  render(<SupportTicketsScreen />); await screen.findByText('T-A'); fireEvent.click(views()[0]); await screen.findByText('No messages on this ticket.'); fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Customer reply' } }); fireEvent.click(screen.getByRole('button', { name: 'Send' })); await screen.findByText(/Network lost/);
  fireEvent.click(screen.getByRole('button', { name: 'Reload ticket and inspect' })); await screen.findByText('History unavailable'); expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true); expect(screen.getByRole('button', { name: 'Reload ticket and inspect' })).toBeTruthy(); expect(ApiClient.post).toHaveBeenCalledTimes(1);
});

test('read-only session cannot perform ticket mutations even with a support scope', async () => {
  act(() => useAuthStore.setState(state => ({ principal: state.principal ? { ...state.principal, readOnlyPrincipal: true } : null })));
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => path.includes('?') ? Promise.resolve({ items: [ticket('A')], pagination: { total: 1 } }) : path.endsWith('/messages') ? Promise.resolve([]) : Promise.resolve(ticket('A')));
  render(<SupportTicketsScreen />); await screen.findByText('T-A'); fireEvent.click(views()[0]); await screen.findByText('No messages on this ticket.'); expect((screen.getByRole('button', { name: 'Resolve' }) as HTMLButtonElement).disabled).toBe(true); expect((screen.getByLabelText('Message') as HTMLInputElement).disabled).toBe(true); expect(ApiClient.post).not.toHaveBeenCalled();
});

test('expired message retry key is not reused after its retention window', async () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1000000);
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => path.includes('?') ? Promise.resolve({ items: [ticket('A')], pagination: { total: 1 } }) : path.endsWith('/messages') ? Promise.resolve([]) : Promise.resolve(ticket('A')));
  (ApiClient.post as jest.Mock).mockRejectedValue(new Error('Network lost'));
  render(<SupportTicketsScreen />); await screen.findByText('T-A'); fireEvent.click(views()[0]); await screen.findByText('No messages on this ticket.'); fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Reply' } }); fireEvent.click(screen.getByRole('button', { name: 'Send' })); await screen.findByText(/Network lost/);
  fireEvent.click(screen.getByRole('button', { name: 'Reload ticket and inspect' })); await waitFor(() => expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false)); clock.mockReturnValue(1000000 + 24 * 60 * 60 * 1000);
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); expect(screen.getByText(/previous message attempt cannot be safely retried/)).toBeTruthy(); expect(ApiClient.post).toHaveBeenCalledTimes(1); clock.mockRestore();
});

test('dirty ticket close retains the draft and restores focus when kept', async () => {
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => path.includes('?') ? Promise.resolve({ items: [ticket('A')], pagination: { total: 1 } }) : path.endsWith('/messages') ? Promise.resolve([]) : Promise.resolve(ticket('A')));
  render(<SupportTicketsScreen />); await screen.findByText('T-A'); views()[0].focus(); fireEvent.click(views()[0]); await screen.findByText('No messages on this ticket.');
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Ticket T-A' })); fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Draft reply' } }); const close = screen.getAllByRole('button', { name: 'Close' })[0]; close.focus(); fireEvent.click(close);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep editing' })); fireEvent.click(screen.getByRole('button', { name: 'Keep editing' })); expect(document.activeElement).toBe(close); expect((screen.getByLabelText('Message') as HTMLInputElement).value).toBe('Draft reply'); expect(ApiClient.post).not.toHaveBeenCalled();
});
