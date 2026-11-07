import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SuperAdminRecoveryScreen } from '../src/screens/authenticated/SuperAdminRecoveryScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({ ApiClient: { post: jest.fn() } }));
function principal(id: string, scopes = ['workforce.super_admin.recover']) {
  useAuthStore.setState({ principal: { type:'OPERATOR', principalId:id, sessionId:id, audience:'workforce-admin', roles:['ADMINISTRATOR'], scopes, customerAccess:'NONE', assuranceLevel:'MFA' } });
}
beforeEach(() => { jest.resetAllMocks(); principal('synthetic-1'); });

test('malformed response does not claim recovery was executed and clears the submitted statement', async () => {
  (ApiClient.post as jest.Mock).mockResolvedValue({});
  render(<SuperAdminRecoveryScreen />);
  fireEvent.change(screen.getByLabelText('Recovery statement (JWT)'), {target:{value:'synthetic.signed.statement'}});
  fireEvent.click(screen.getByRole('button', {name:'Execute Recovery'}));
  expect(await screen.findByText(/outcome is unconfirmed/)).toBeTruthy();
  expect(screen.queryByText('Recovery executed')).toBeNull();
  expect((screen.getByLabelText('Recovery statement (JWT)') as HTMLTextAreaElement).value).toBe('');
  expect(ApiClient.post).toHaveBeenCalledWith('/internal/a2/workforce/super-admin/recovery', {statement:'synthetic.signed.statement'});
});

test('a recovery result and statement cannot cross principal or permission changes', async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise<unknown>(r => { resolve = r; });
  (ApiClient.post as jest.Mock).mockReturnValue(pending);
  render(<SuperAdminRecoveryScreen />);
  fireEvent.change(screen.getByLabelText('Recovery statement (JWT)'), {target:{value:'synthetic.signed.statement'}});
  fireEvent.click(screen.getByRole('button', {name:'Execute Recovery'}));
  act(() => principal('synthetic-2'));
  await act(async () => { resolve({operation:'REVOKE_SUPER_ADMIN', recoveryReference:'old-reference', targetPrincipalId:'old-target', auditReference:'old-audit', revokedSessionCount:1}); await pending; });
  expect(screen.queryByText('old-reference')).toBeNull();
  expect((screen.getByLabelText('Recovery statement (JWT)') as HTMLTextAreaElement).value).toBe('');
  act(() => principal('synthetic-2', []));
  expect(screen.getByText('Access restricted')).toBeTruthy();
  expect(screen.queryByRole('button', {name:'Execute Recovery'})).toBeNull();
});

test('a new session for the same operator clears a recovery statement', () => {
  render(<SuperAdminRecoveryScreen />);fireEvent.change(screen.getByLabelText('Recovery statement (JWT)'),{target:{value:'synthetic.signed.statement'}});
  act(()=>useAuthStore.setState(state=>({principal:{...state.principal!,sessionId:'new-session'}})));
  expect((screen.getByLabelText('Recovery statement (JWT)') as HTMLTextAreaElement).value).toBe('');
});
