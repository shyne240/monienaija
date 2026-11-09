import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SuperAdminRecoveryScreen } from '../src/screens/authenticated/SuperAdminRecoveryScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({ ApiClient: { post: jest.fn() } }));
function principal(id: string, scopes = ['workforce.super_admin.recover']) {
  useAuthStore.setState({ principal: { type:'OPERATOR', principalId:id, sessionId:id, audience:'workforce-admin', roles:['ADMINISTRATOR'], scopes, customerAccess:'NONE', assuranceLevel:'MFA' } });
}
const fakeStatement = `e30.${btoa(JSON.stringify({operation:'REVOKE_SUPER_ADMIN',targetPrincipalId:'target',targetAssignmentReference:'assignment',reason:'test reason'})).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}.signature`;
beforeEach(() => { jest.resetAllMocks(); principal('synthetic-1'); });

test('malformed response does not claim recovery was executed and clears the submitted statement', async () => {
  (ApiClient.post as jest.Mock).mockResolvedValue({});
  render(<SuperAdminRecoveryScreen />);
  fireEvent.change(screen.getByLabelText('Recovery statement (JWT)'), {target:{value:fakeStatement}});
  fireEvent.click(screen.getByRole('button', {name:'Execute Recovery'}));
  fireEvent.click(screen.getByRole('button', {name:'Confirm recovery'}));
  expect(await screen.findByText(/outcome is unconfirmed/)).toBeTruthy();
  expect(screen.queryByText('Recovery executed')).toBeNull();
  expect((screen.getByLabelText('Recovery statement (JWT)') as HTMLTextAreaElement).value).toBe('');
  expect(ApiClient.post).toHaveBeenCalledWith('/internal/a2/workforce/super-admin/recovery', {statement:fakeStatement});
});

test('a recovery result and statement cannot cross principal or permission changes', async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise<unknown>(r => { resolve = r; });
  (ApiClient.post as jest.Mock).mockReturnValue(pending);
  render(<SuperAdminRecoveryScreen />);
  fireEvent.change(screen.getByLabelText('Recovery statement (JWT)'), {target:{value:fakeStatement}});
  fireEvent.click(screen.getByRole('button', {name:'Execute Recovery'}));
  fireEvent.click(screen.getByRole('button', {name:'Confirm recovery'}));
  act(() => principal('synthetic-2'));
  await act(async () => { resolve({operation:'REVOKE_SUPER_ADMIN', recoveryReference:'old-reference', targetPrincipalId:'old-target', auditReference:'old-audit', revokedSessionCount:1}); await pending; });
  expect(screen.queryByText('old-reference')).toBeNull();
  expect((screen.getByLabelText('Recovery statement (JWT)') as HTMLTextAreaElement).value).toBe('');
  act(() => principal('synthetic-2', []));
  expect(screen.getByText('Access restricted')).toBeTruthy();
  expect(screen.queryByRole('button', {name:'Execute Recovery'})).toBeNull();
});

test('a new session for the same operator clears a recovery statement', () => {
  render(<SuperAdminRecoveryScreen />);fireEvent.change(screen.getByLabelText('Recovery statement (JWT)'),{target:{value:fakeStatement}});
  act(()=>useAuthStore.setState(state=>({principal:{...state.principal!,sessionId:'new-session'}})));
  expect((screen.getByLabelText('Recovery statement (JWT)') as HTMLTextAreaElement).value).toBe('');
});

test('invalid compact statement is rejected locally without implying a server outcome',()=>{
 render(<SuperAdminRecoveryScreen/>);fireEvent.change(screen.getByLabelText('Recovery statement (JWT)'),{target:{value:'not-a-jwt'}});fireEvent.click(screen.getByRole('button',{name:'Execute Recovery'}));expect(screen.getByText(/no request was sent/)).toBeTruthy();expect(ApiClient.post).not.toHaveBeenCalled();expect(screen.getByLabelText('Recovery statement (JWT)')).toHaveProperty('value','not-a-jwt');
});

test('read-only or non-MFA sessions cannot execute recovery even with the scope',()=>{
 act(()=>useAuthStore.setState(state=>({principal:{...state.principal!,readOnlyPrincipal:true}})));render(<SuperAdminRecoveryScreen/>);expect(screen.getByText('Recovery action unavailable')).toBeTruthy();expect((screen.getByRole('button',{name:'Execute Recovery'}) as HTMLButtonElement).disabled).toBe(true);expect(ApiClient.post).not.toHaveBeenCalled();
});

test('mismatched recovery receipt locks further execution until independent audit review',async()=>{
 (ApiClient.post as jest.Mock).mockResolvedValue({operation:'REVOKE_SUPER_ADMIN',recoveryReference:'ref',targetPrincipalId:'another',targetAssignmentReference:'assignment',reason:'test reason',consumedBy:'synthetic-1',consumedAt:'2026-10-23T00:00:00Z',auditReference:'audit',revokedSessionCount:1});const report=jest.fn();render(<SuperAdminRecoveryScreen onRecoveryGuardChange={report}/>);fireEvent.change(screen.getByLabelText('Recovery statement (JWT)'),{target:{value:fakeStatement}});fireEvent.click(screen.getByRole('button',{name:'Execute Recovery'}));expect(screen.getByRole('dialog',{name:'Confirm recovery request?'}).textContent).toContain('Unverified statement claims');fireEvent.click(screen.getByRole('button',{name:'Confirm recovery'}));await screen.findByText(/outcome is unconfirmed/);expect(screen.queryByText('Recovery executed')).toBeNull();expect((screen.getByRole('button',{name:'Execute Recovery'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByText(/fresh read cannot exclude a late commit/)).toBeTruthy();expect(report).toHaveBeenLastCalledWith(true,false);const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);fireEvent.click(screen.getByRole('button',{name:'I reviewed recovery and audit records'}));expect((screen.getByLabelText('Recovery statement (JWT)') as HTMLTextAreaElement).disabled).toBe(false);expect(ApiClient.post).toHaveBeenCalledTimes(1);
});

test('recovery confirmation is single-flight and protects the sensitive statement',async()=>{
 let resolve!:(v:any)=>void;const pending=new Promise<any>(r=>{resolve=r});(ApiClient.post as jest.Mock).mockReturnValue(pending);render(<SuperAdminRecoveryScreen/>);fireEvent.change(screen.getByLabelText('Recovery statement (JWT)'),{target:{value:fakeStatement}});fireEvent.click(screen.getByRole('button',{name:'Execute Recovery'}));const confirm=screen.getByRole('button',{name:'Confirm recovery'});fireEvent.click(confirm);fireEvent.click(confirm);expect(ApiClient.post).toHaveBeenCalledTimes(1);expect(screen.getByLabelText('Recovery statement (JWT)')).toHaveProperty('value','');fireEvent.keyDown(document,{key:'Escape'});expect(screen.getByRole('dialog')).toBeTruthy();await act(async()=>{resolve({});await pending;});
});

test('shell navigation protects an entered recovery statement',async()=>{
 const {Layout}=await import('../src/screens/authenticated/Layout');useAuthStore.setState({isAuthenticated:true});const view=render(<Layout/>);fireEvent.click(view.getByTestId('nav-superAdminRecovery'));fireEvent.change(view.getByLabelText('Recovery statement (JWT)'),{target:{value:fakeStatement}});fireEvent.click(view.getByTestId('nav-dashboard'));expect(view.getByRole('dialog',{name:'Leave recovery review?'})).toBeTruthy();fireEvent.click(view.getByRole('button',{name:'Keep working'}));expect(view.getByLabelText('Recovery statement (JWT)')).toHaveProperty('value',fakeStatement);fireEvent.click(view.getByTestId('nav-dashboard'));fireEvent.click(view.getByRole('button',{name:'Discard and leave'}));expect(view.queryByLabelText('Recovery statement (JWT)')).toBeNull();
});

test('recovery receipt receives focus and dismissal returns focus to the statement', async () => {
  (ApiClient.post as jest.Mock).mockResolvedValue({operation:'REVOKE_SUPER_ADMIN', recoveryReference:'ref', targetPrincipalId:'target', targetAssignmentReference:'assignment', reason:'test reason', consumedBy:'synthetic-1', consumedAt:'2026-10-23T00:00:00Z', auditReference:'audit', revokedSessionCount:1});
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
  try {
    render(<SuperAdminRecoveryScreen />);
    const statement = screen.getByLabelText('Recovery statement (JWT)');
    fireEvent.change(statement, {target:{value:fakeStatement}});
    fireEvent.click(screen.getByRole('button', {name:'Execute Recovery'}));
    fireEvent.click(screen.getByRole('button', {name:'Confirm recovery'}));
    const receipt = await screen.findByRole('status', {name:'Recovery executed'});
    expect(document.activeElement).toBe(receipt);
    fireEvent.click(screen.getByRole('button', {name:'Dismiss recovery receipt'}));
    expect(document.activeElement).toBe(statement);
  } finally { confirm.mockRestore(); }
});

test('uncertain recovery focuses independent review, then returns focus after acknowledgment', async () => {
  (ApiClient.post as jest.Mock).mockResolvedValue({});
  render(<SuperAdminRecoveryScreen />);
  const statement = screen.getByLabelText('Recovery statement (JWT)');
  fireEvent.change(statement, {target:{value:fakeStatement}});
  fireEvent.click(screen.getByRole('button', {name:'Execute Recovery'}));
  fireEvent.click(screen.getByRole('button', {name:'Confirm recovery'}));
  const acknowledge = await screen.findByRole('button', {name:'I reviewed recovery and audit records'});
  expect(document.activeElement).toBe(acknowledge.closest('.mn-recovery__review'));
  fireEvent.click(acknowledge);
  expect(document.activeElement).toBe(statement);
});
