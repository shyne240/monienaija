import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentNetworkScreen } from '../src/screens/authenticated/AgentNetworkScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
const app = { id: 'app-1', reference: 'APP-1', agentClassId: 'class-1', applicantReference: 'AG-1', status: 'SUBMITTED', version: 1, agentId: null, createdAt: '2026-11-01' };
function session(id = 'session-1', scopes = ['agent.view', 'agent.review_application', 'agent.activate'], extra: Record<string, unknown> = {}) {
  act(() => useAuthStore.setState({ isAuthenticated: true, isLoading: false, token: id, sessionId: id, principal: { type: 'OPERATOR', principalId: id, sessionId: id, audience: 'workforce-admin', roles: ['AGENT_NETWORK_MANAGER'], scopes, customerAccess: 'ANY', assuranceLevel: 'MFA', ...extra } as any }));
}
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => {
  jest.resetAllMocks(); session();
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/internal/agents?')) return Promise.resolve({ data: [], total: 0 });
    if (path === '/internal/agents/classes') return Promise.resolve([{ id: 'class-1', name: 'Standard', code: 'STD', isActive: true }]);
    if (path === '/internal/agents/applications') return Promise.resolve([app]);
    return Promise.resolve({});
  });
});
async function loadQueue() { fireEvent.click(screen.getByRole('button', { name: 'Load applications' })); await screen.findByText('APP-1'); }

test('local onboarding changes require confirmation to discard and keep editing preserves input', async () => {
  render(<AgentNetworkScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'New Agent Application' }));
  fireEvent.change(screen.getByLabelText('Applicant reference'), { target: { value: 'SYNTHETIC-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('group', { name: 'Discard application changes' })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep editing' }));
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect((screen.getByLabelText('Applicant reference') as HTMLInputElement).value).toBe('SYNTHETIC-1');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(screen.queryByLabelText('Applicant reference')).toBeNull();
  expect(ApiClient.post).not.toHaveBeenCalled();
});

test('unmatched decision receipts remain unconfirmed and block writes until a fresh queue', async () => {
  (ApiClient.post as jest.Mock).mockResolvedValue({ ...app, id: 'other', status: 'UNDER_REVIEW' });
  render(<AgentNetworkScreen />); await loadQueue();
  fireEvent.click(screen.getByRole('button', { name: 'Mark under review' }));
  expect(await screen.findByText(/outcome not confirmed/)).toBeTruthy();
  expect(screen.queryByText(/marked under review\./)).toBeNull();
  expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh applications' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(false));
});

test('one in-flight action blocks competing actions and a session change suppresses the old result', async () => {
  const pending = deferred<unknown>(); (ApiClient.post as jest.Mock).mockReturnValue(pending.promise);
  render(<AgentNetworkScreen />); await loadQueue();
  fireEvent.click(screen.getByRole('button', { name: 'Mark under review' }));
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  expect(ApiClient.post).toHaveBeenCalledTimes(1);
  session('session-2');
  await act(async () => { pending.resolve({ ...app, status: 'UNDER_REVIEW' }); await pending.promise; });
  expect(screen.queryByText(/marked under review\./)).toBeNull();
  expect(screen.queryByText('APP-1')).toBeNull();
});

test('read-only and missing activation grants cannot perform application mutations', async () => {
  session('read-only', ['agent.view', 'agent.review_application', 'agent.activate'], { readOnlyPrincipal: true });
  const view = render(<AgentNetworkScreen />); await loadQueue();
  expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'New Agent Application' }) as HTMLButtonElement).disabled).toBe(true);
  session('no-activation', ['agent.view', 'agent.review_application']);
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => path === '/internal/agents/applications' ? Promise.resolve([{ ...app, status: 'APPROVED' }]) : Promise.resolve(path.startsWith('/internal/agents?') ? { data: [], total: 0 } : []));
  await loadQueue();
  expect(screen.queryByRole('button', { name: 'Activate agent' })).toBeNull();
  expect(ApiClient.post).not.toHaveBeenCalled(); view.unmount();
});

test('malformed draft creation receipt cannot advance to submission or display success', async () => {
  (ApiClient.post as jest.Mock).mockResolvedValue({ ...app, status: 'DRAFT', applicantReference: 'WRONG' });
  render(<AgentNetworkScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'New Agent Application' }));
  fireEvent.change(screen.getByLabelText('Applicant reference'), { target: { value: 'AG-NEW' } });
  await waitFor(() => expect((screen.getByLabelText('Application Agent class') as HTMLSelectElement).value).toBe('class-1'));
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  expect(await screen.findByText(/Draft outcome not confirmed/)).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Submit application' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText(/saved \(v/)).toBeNull();
  expect(ApiClient.post).toHaveBeenCalledTimes(1);
});

test('a queue read started before an uncertain decision cannot clear the retry lock', async () => {
  const staleRead = deferred<unknown>(); const decision = deferred<unknown>();
  let reads = 0;
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path === '/internal/agents/applications') return ++reads === 1 ? Promise.resolve([app]) : staleRead.promise;
    return Promise.resolve(path.startsWith('/internal/agents?') ? { data: [], total: 0 } : []);
  });
  (ApiClient.post as jest.Mock).mockReturnValue(decision.promise);
  render(<AgentNetworkScreen />); await loadQueue();
  fireEvent.click(screen.getByRole('button', { name: 'Mark under review' }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh applications' }));
  await act(async () => { decision.resolve({ id: 'wrong', status: 'UNDER_REVIEW' }); await decision.promise; });
  await act(async () => { staleRead.resolve([app]); await staleRead.promise; });
  expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/last outcome is unconfirmed/)).toBeTruthy();
});

test('a session change after creating a draft stops the chained submit', async () => {
  const pending = deferred<unknown>(); (ApiClient.post as jest.Mock).mockReturnValue(pending.promise);
  render(<AgentNetworkScreen />); fireEvent.click(screen.getByRole('button', { name: 'New Agent Application' }));
  await waitFor(() => expect((screen.getByLabelText('Application Agent class') as HTMLSelectElement).value).toBe('class-1'));
  for (const [label, value] of [['Applicant reference','AG-NEW'], ['Business / trading name','Business'], ['Contact email','contact@example.com'], ['Principal contact name','Synthetic'], ['Contact phone','08000000000'], ['Operating address','Abuja'], ['Primary evidence reference','EVIDENCE']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Submit application' }));
  await waitFor(() => expect(ApiClient.post).toHaveBeenCalledTimes(1));
  session('another-session');
  await act(async () => { pending.resolve({ ...app, applicantReference: 'AG-NEW', status: 'DRAFT' }); await pending.promise; });
  expect(ApiClient.post).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/submitted for review/)).toBeNull();
});
