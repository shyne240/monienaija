import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NotificationManagementScreen } from '../src/screens/authenticated/NotificationManagementScreen';
import { NotificationManagementApi } from '../src/services/notification-management-api';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn() }, ApiError: class extends Error { status = 503; } }));
const id = '550e8400-e29b-41d4-a716-446655440001';
const other = '550e8400-e29b-41d4-a716-446655440002';
const row = (approvalId = id) => ({ id: approvalId, approvalId, changeType: 'TEMPLATE_CREATE' as const, eventType: 'transfer.completed', channel: 'SMS' as const, summary: 'A proposed template', status: 'PENDING_APPROVAL' as const, requestedBy: 'maker', requestedAt: '2026-11-01T00:00:00Z' });
const live = (data: any) => ({ status: 'LIVE' as const, data });
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => {
  jest.restoreAllMocks();
  (ApiClient.get as jest.Mock).mockReset().mockRejectedValue(new Error('Synthetic unavailable'));
  (ApiClient.post as jest.Mock).mockReset();
  useAuthStore.setState({ principal: { type: 'OPERATOR', principalId: 'checker', sessionId: 'session', audience: 'workforce-admin', roles: ['FINANCE_CONTROLLER'], scopes: ['privileged:approve', 'audit.view'], customerAccess: 'NONE', assuranceLevel: 'MFA' } });
});

test.each([
  { approved: false, reason: 'SELF_APPROVAL_FORBIDDEN', approval: { id, status: 'REQUESTED' } },
  { approved: true, reason: 'APPROVED', approval: { id: other, status: 'APPROVED' } },
  { approved: true, reason: 'APPROVED' },
])('unconfirmed workforce decision never executes the frozen proposal: %p', async receipt => {
  (ApiClient.post as jest.Mock).mockResolvedValue(receipt);
  await expect(NotificationManagementApi.decideNotificationChangeRequest(id, 'approve', '')).rejects.toThrow(/not confirmed/i);
  expect(ApiClient.post).toHaveBeenCalledTimes(1);
  await expect(NotificationManagementApi.decideWorkforceApproval(id, 'approve')).rejects.toThrow(/not confirmed/i);
});

test('a matching rejection is distinct from an approval denial and never executes', async () => {
  (ApiClient.post as jest.Mock).mockResolvedValue({ approved: false, reason: 'REJECTED', approval: { id, status: 'REJECTED' } });
  const result = await NotificationManagementApi.decideNotificationChangeRequest(id, 'reject', 'Reviewed');
  expect(result.status === 'LIVE' && result.data.status).toBe('REJECTED');
  expect(ApiClient.post).toHaveBeenCalledTimes(1);
});

test.each([{ approvalId: other, type: 'TEMPLATE' }, { approvalId: id }, { approvalId: id, type: 'WRONG' }])('mismatched execution receipt is not presented as applied: %p', async execution => {
  (ApiClient.post as jest.Mock).mockResolvedValueOnce({ approved: true, reason: 'APPROVED', approval: { id, status: 'APPROVED' } }).mockResolvedValueOnce(execution);
  const result = await NotificationManagementApi.decideNotificationChangeRequest(id, 'approve', '');
  expect(result.status === 'LIVE' && result.data.status).toBe('APPROVED');
  expect(result.status === 'LIVE' && result.data.message).toMatch(/execution could not be confirmed/i);
  (ApiClient.post as jest.Mock).mockResolvedValueOnce(execution);
  await expect(NotificationManagementApi.executeApprovedNotificationChange(id)).rejects.toThrow(/not confirmed/i);
});

test('invalid queue and audit payloads are not treated as empty successful reads', async () => {
  (ApiClient.get as jest.Mock).mockResolvedValue({ unexpected: [] });
  await expect(NotificationManagementApi.listChangeRequests()).rejects.toThrow(/could not be verified/i);
  const audit = await NotificationManagementApi.listNotificationGovernanceAudit();
  expect(audit.rows).toEqual([]); expect(audit.failedCategories).toHaveLength(4);
});

test('partial audit reads preserve available results and identify failed categories', async () => {
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => path.includes('NOTIFICATION_CHANGE') ? Promise.reject(new Error('unavailable')) : Promise.resolve([{ id: path, actor: 'synthetic', action: 'READ', occurredAt: '2026-01-01T00:00:00Z' }]));
  const audit = await NotificationManagementApi.listNotificationGovernanceAudit();
  expect(audit.failedCategories).toEqual(['NOTIFICATION_CHANGE']); expect(audit.rows).toHaveLength(3);
});

test('filters the loaded queue and returns focus from the inspector even if its row is filtered out', async () => {
  jest.spyOn(NotificationManagementApi, 'listChangeRequests').mockResolvedValue(live([row(), row(other)]));
  render(<NotificationManagementScreen initialTab="approvals" />);
  const trigger = await screen.findByRole('button', { name: `Inspect change ${id}` });
  fireEvent.click(trigger); expect(document.activeElement).toBe(screen.getByTestId('notification-change-inspector'));
  fireEvent.click(screen.getByRole('button', { name: 'Close inspection' })); expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger); fireEvent.change(screen.getByLabelText('Search loaded notification changes'), { target: { value: other } });
  expect(screen.queryByTestId(`change-request-row-${id}`)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close inspection' }));
  expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Notification change requests queue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reset queue filters' })); expect(screen.getByTestId(`change-request-row-${id}`)).toBeTruthy();
  expect(ApiClient.post).not.toHaveBeenCalled();
});

test('stale or refreshing queue rows cannot be actioned', async () => {
  const pending = deferred();
  jest.spyOn(NotificationManagementApi, 'listChangeRequests').mockResolvedValueOnce(live([row()])).mockReturnValueOnce(pending.promise);
  render(<NotificationManagementScreen initialTab="approvals" />);
  const approve = await screen.findByRole('button', { name: `Approve change ${id}` });
  await waitFor(() => expect((approve as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Console' }));
  expect((approve as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { pending.resolve(Promise.reject(new Error('Queue failed'))); try { await pending.promise; } catch {} });
  expect(screen.getByText(/Current queue is unavailable/)).toBeTruthy(); expect((approve as HTMLButtonElement).disabled).toBe(true);
  expect(ApiClient.post).not.toHaveBeenCalled();
});

test('denial is not success and blocks further queue actions until a successful refresh', async () => {
  jest.spyOn(NotificationManagementApi, 'listChangeRequests').mockResolvedValue(live([row()]));
  (ApiClient.post as jest.Mock).mockResolvedValue({ approved: false, reason: 'ROLE_MISSING', approval: { id, status: 'REQUESTED' } });
  render(<NotificationManagementScreen initialTab="approvals" />);
  const approve = await screen.findByRole('button', { name: `Approve change ${id}` });
  await waitFor(() => expect((approve as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(approve);
  expect((await screen.findByTestId('checker-feedback-error')).textContent).toMatch(/not confirmed/i);
  expect(screen.queryByTestId('checker-feedback-success')).toBeNull(); expect((approve as HTMLButtonElement).disabled).toBe(true);
  expect(ApiClient.post).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Console' }));
  await waitFor(() => expect((approve as HTMLButtonElement).disabled).toBe(false));
});

test('a pending checker decision prevents a second direct or queue mutation', async () => {
  const pending = deferred();
  jest.spyOn(NotificationManagementApi, 'listChangeRequests').mockResolvedValue(live([row(), row(other)]));
  (ApiClient.post as jest.Mock).mockReturnValue(pending.promise);
  render(<NotificationManagementScreen initialTab="approvals" />);
  const approve = await screen.findByRole('button', { name: `Approve change ${id}` });
  await waitFor(() => expect((approve as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Pending approval ID'), { target: { value: other } });
  fireEvent.click(approve);
  expect((screen.getByRole('button', { name: `Approve change ${other}` }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByTestId('direct-workforce-approve-btn') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByTestId('direct-workforce-approve-btn'));
  expect(ApiClient.post).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve({ approved: false, reason: 'ROLE_MISSING' }); await pending.promise; });
});

test('partial audit failure is visibly distinguished from a complete empty sample', async () => {
  jest.spyOn(NotificationManagementApi, 'listChangeRequests').mockResolvedValue(live([]));
  jest.spyOn(NotificationManagementApi, 'listNotificationGovernanceAudit').mockResolvedValue({ rows: [], failedCategories: ['NOTIFICATION_CHANGE'] });
  render(<NotificationManagementScreen initialTab="approvals" />);
  const section = screen.getByTestId('notification-governance-audit-section');
  expect(await within(section).findByText(/Results are partial/)).toBeTruthy();
  expect(within(section).getByText(/No audit events returned in the loaded sample/)).toBeTruthy();
});

test('a refresh started before an uncertain decision cannot clear its required-refresh guard', async () => {
  const decision = deferred(); const earlyQueue = deferred();
  jest.spyOn(NotificationManagementApi, 'listChangeRequests').mockResolvedValueOnce(live([row()])).mockReturnValueOnce(earlyQueue.promise).mockResolvedValue(live([row()]));
  (ApiClient.post as jest.Mock).mockReturnValue(decision.promise);
  render(<NotificationManagementScreen initialTab="approvals" />);
  const approve = await screen.findByRole('button', { name: `Approve change ${id}` });
  await waitFor(() => expect((approve as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(approve); fireEvent.click(screen.getByRole('button', { name: 'Refresh Console' }));
  await act(async () => { decision.resolve({ approved: false, reason: 'ROLE_MISSING' }); await decision.promise; });
  await act(async () => { earlyQueue.resolve(live([row()])); await earlyQueue.promise; });
  expect((approve as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Refresh the queue before acting on its entries/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Console' }));
  await waitFor(() => expect((approve as HTMLButtonElement).disabled).toBe(false));
});
