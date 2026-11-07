import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DashboardSettingsScreen } from '../src/screens/authenticated/DashboardSettingsScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => {
  class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
  return { ApiClient: { get: jest.fn(), put: jest.fn() }, ApiError };
});
const templates = ['ONE', 'TWO'].map(templateKey => ({ id: templateKey, templateKey, displayName: `Template ${templateKey}`, description: '', operationalArea: 'SYNTHETIC', isActive: true, layout: { widgets: [] }, createdAt: '2026-01-01', updatedAt: '2026-01-01' }));
const assignments = ['ROLE_A', 'ROLE_B'].map(roleKey => ({ id: roleKey, roleKey, templateKey: 'ONE', assignedBy: 'seed', assignedAt: '2026-01-01T00:00:00Z' }));
const receipt = (roleKey = 'ROLE_A', templateKey = 'TWO') => ({ id: roleKey, roleKey, templateKey, assignedBy: 'operator', assignedAt: '2026-01-01T00:00:00Z' });
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { promise, resolve }; };
function principal(sessionId = 'session-a', scopes = ['workforce.dashboard.view', 'workforce.dashboard.assign']) {
  useAuthStore.setState({ principal: { type:'OPERATOR', principalId:'operator', sessionId, audience:'workforce-admin', roles:['SYNTHETIC'], scopes, customerAccess:'NONE', assuranceLevel:'MFA' } });
}
function setupReads() {
  (ApiClient.get as jest.Mock).mockImplementation((url: string) => Promise.resolve(url.endsWith('/templates') ? templates : url.endsWith('/assignments') ? assignments : []));
}
async function choose(role = 'ROLE_A') { fireEvent.change(await screen.findByLabelText(`Dashboard template for ${role}`), { target: { value: 'TWO' } }); }
function save(role = 'ROLE_A') { return within(screen.getByText(role).closest('tr')!).getByRole('button', { name: `Save dashboard assignment for ${role}` }); }
beforeEach(() => { jest.resetAllMocks(); principal(); setupReads(); });

test('malformed configuration is unavailable rather than an empty list', async () => {
  (ApiClient.get as jest.Mock).mockImplementation((url: string) => Promise.resolve(url.endsWith('/templates') ? {} : url.endsWith('/assignments') ? assignments : []));
  render(<DashboardSettingsScreen />); expect(await screen.findByText(/Invalid dashboard configuration response/)).toBeTruthy(); expect(screen.queryByText('Dashboard Templates (0)')).toBeNull();
});
test('rejects unrelated receipts, preserves draft, and requires reload before retry', async () => {
  (ApiClient.put as jest.Mock).mockResolvedValue(receipt('ROLE_B'));
  render(<DashboardSettingsScreen />); await choose(); fireEvent.change(screen.getByLabelText('Reason for ROLE_A dashboard change'), { target: { value: 'Synthetic review' } }); fireEvent.click(save());
  expect(await screen.findByText(/outcome could not be confirmed/)).toBeTruthy(); expect(screen.queryByText(/Dashboard for ROLE_A is now/)).toBeNull(); expect((save() as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reload configuration' })); expect(await screen.findByLabelText('Reason for ROLE_A dashboard change')).toHaveProperty('value', 'Synthetic review'); expect((save() as HTMLButtonElement).disabled).toBe(false);
});
test('confirms a matching receipt and clears the submitted reason', async () => {
  (ApiClient.put as jest.Mock).mockResolvedValue(receipt()); render(<DashboardSettingsScreen />); await choose(); fireEvent.change(screen.getByLabelText('Reason for ROLE_A dashboard change'), { target: { value:'Review' } }); fireEvent.click(save());
  expect(await screen.findByText('Dashboard for ROLE_A is now TWO.')).toBeTruthy(); expect(screen.getByLabelText('Reason for ROLE_A dashboard change')).toHaveProperty('value', ''); expect((save() as HTMLButtonElement).disabled).toBe(true);
});
test('only one role assignment can be submitted at a time', async () => {
  const pending = deferred(); (ApiClient.put as jest.Mock).mockReturnValue(pending.promise); render(<DashboardSettingsScreen />); await choose(); await choose('ROLE_B'); fireEvent.click(save()); expect((save('ROLE_B') as HTMLButtonElement).disabled).toBe(true); expect((screen.getByRole('button', { name:'Reload configuration' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { pending.resolve(receipt()); await pending.promise; }); expect(ApiClient.put).toHaveBeenCalledTimes(1);
});
test('session change discards drafts and ignores late assignment responses', async () => {
  const pending = deferred(); (ApiClient.put as jest.Mock).mockReturnValue(pending.promise); render(<DashboardSettingsScreen />); await choose(); fireEvent.click(save()); act(() => principal('session-b')); await screen.findByLabelText('Dashboard template for ROLE_A'); await act(async () => { pending.resolve(receipt()); await pending.promise; });
  expect(screen.queryByText('Dashboard for ROLE_A is now TWO.')).toBeNull(); expect(screen.getByLabelText('Dashboard template for ROLE_A')).toHaveProperty('value', 'ONE');
});
test('late configuration from an older session cannot replace the current session', async () => {
  const pending = deferred(); let calls = 0; (ApiClient.get as jest.Mock).mockImplementation((url:string) => {
    if (url.endsWith('/templates')) return ++calls === 1 ? pending.promise : Promise.resolve(templates);
    return Promise.resolve(url.endsWith('/assignments') ? assignments : []);
  });
  render(<DashboardSettingsScreen />); act(() => principal('session-b')); await screen.findByText('Template ONE'); await act(async () => { pending.resolve([{ ...templates[0], displayName:'OLD SESSION' }]); await pending.promise; }); expect(screen.queryByText('OLD SESSION')).toBeNull(); expect(screen.getByText('Template ONE')).toBeTruthy();
});
test('read-only principals cannot edit or send assignments', async () => {
  principal('read-only', ['workforce.dashboard.view']); render(<DashboardSettingsScreen />); await screen.findByText('ROLE_A'); expect(screen.queryByLabelText('Dashboard template for ROLE_A')).toBeNull(); expect(ApiClient.put).not.toHaveBeenCalled();
});
test('missing view permission does not call configuration endpoints', async () => {
  principal('restricted', ['workforce.dashboard.assign']); render(<DashboardSettingsScreen />); expect(await screen.findByText(/do not have permission to view dashboard configuration/)).toBeTruthy(); expect(ApiClient.get).not.toHaveBeenCalled();
});
