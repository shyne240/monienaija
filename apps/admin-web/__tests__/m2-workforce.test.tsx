import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { WorkforceAdminScreen } from '../src/screens/authenticated/WorkforceAdminScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn(), post: jest.fn() } }));
const principal = (id: string, scopes: string[]) => useAuthStore.setState({principal:{ type:'OPERATOR',principalId:id,sessionId:id,audience:'workforce-admin',roles:['ADMINISTRATOR'],scopes,customerAccess:'NONE',assuranceLevel:'MFA' }});
function deferred() { let resolve!: (value: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return {promise,resolve}; }
beforeEach(() => jest.resetAllMocks());

test('failed or malformed refresh never shows a stale workforce overview as current', async () => {
  principal('one',['workforce.dashboard.view']);
  (ApiClient.get as jest.Mock).mockResolvedValueOnce({activeWorkforceHeadcount:9,activeSessionCount:4,roleDistribution:[{roleKey:'SYNTHETIC',count:2}]}).mockResolvedValueOnce({activeWorkforceHeadcount:9,roleDistribution:{}});
  render(<WorkforceAdminScreen />); await screen.findByText('SYNTHETIC');
  fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
  expect(await screen.findByText('Invalid workforce overview response.')).toBeTruthy();
  expect(screen.queryByText('SYNTHETIC')).toBeNull();
  expect(screen.queryByText('No active role assignments were returned.')).toBeNull();
});

test('late one-time credential never crosses principal or scope changes', async () => {
  principal('one',['workforce.user.create']);const previous=deferred();(ApiClient.post as jest.Mock).mockReturnValue(previous.promise);
  render(<WorkforceAdminScreen />);
  fireEvent.change(screen.getByLabelText('Support username or email'),{target:{value:'synthetic'}});
  fireEvent.click(screen.getByRole('button',{name:'Create SUPPORT User'}));
  expect((screen.getByRole('button',{name:'Creating…'}) as HTMLButtonElement).disabled).toBe(true);
  act(() => principal('two',['workforce.user.create']));
  await act(async () => { previous.resolve({username:'synthetic',supportUserId:'old',temporaryPassword:'synthetic-secret',passwordExpiresAt:'2027-01-01'});await previous.promise; });
  expect(screen.queryByText(/synthetic-secret/)).toBeNull();
  expect((screen.getByLabelText('Support username or email') as HTMLInputElement).value).toBe('');
  act(() => principal('two',[]));
  expect(screen.queryByRole('button',{name:'Create SUPPORT User'})).toBeNull();
});

test('incomplete provisioning response is not presented as a valid one-time credential', async () => {
  principal('one',['workforce.user.create']);(ApiClient.post as jest.Mock).mockResolvedValue({username:'synthetic',supportUserId:'id'});
  render(<WorkforceAdminScreen />);fireEvent.change(screen.getByLabelText('Support username or email'),{target:{value:'synthetic'}});fireEvent.click(screen.getByRole('button',{name:'Create SUPPORT User'}));
  expect(await screen.findByText(/provisioning response was incomplete/i)).toBeTruthy();
  expect(screen.queryByText(/One-time temporary password:/)).toBeNull();
});

test('disable confirms the requested identity and DISABLED status, not just HTTP success', async () => {
  principal('one',['workforce.user.suspend']);(ApiClient.post as jest.Mock).mockResolvedValueOnce({id:'other',status:'DISABLED'}).mockResolvedValueOnce({id:'user-1',status:'DISABLED'});
  render(<WorkforceAdminScreen />);fireEvent.change(screen.getByPlaceholderText('SUPPORT user ID'),{target:{value:'user-1'}});fireEvent.click(screen.getByRole('button',{name:'Disable SUPPORT User'}));fireEvent.click(screen.getByRole('button',{name:'Confirm disable'}));
  expect(await screen.findByText(/Disable outcome not confirmed/)).toBeTruthy();expect(screen.queryByText('Support user user-1 disabled.')).toBeNull();
  expect((screen.getByRole('button',{name:'Disable SUPPORT User'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'I reviewed workforce and audit records'}));fireEvent.click(screen.getByRole('button',{name:'Disable SUPPORT User'}));fireEvent.click(screen.getByRole('button',{name:'Confirm disable'}));expect(await screen.findByText('Support user user-1 disabled.')).toBeTruthy();
});

test('a new session for the same operator clears one-time credentials', async () => {
  principal('one',['workforce.user.create']);(ApiClient.post as jest.Mock).mockResolvedValue({username:'synthetic',supportUserId:'one-id',temporaryPassword:'synthetic-secret',passwordExpiresAt:'2027-01-01'});
  render(<WorkforceAdminScreen />);fireEvent.change(screen.getByLabelText('Support username or email'),{target:{value:'synthetic'}});fireEvent.click(screen.getByRole('button',{name:'Create SUPPORT User'}));await screen.findByText(/synthetic-secret/);
  act(()=>useAuthStore.setState(state=>({principal:{...state.principal!,sessionId:'new-session'}})));expect(screen.queryByText(/synthetic-secret/)).toBeNull();
});


test('disable review captures identity and reason, traps focus and allows escape without a write', () => {
  principal('one',['workforce.user.suspend']);render(<WorkforceAdminScreen />);
  fireEvent.change(screen.getByLabelText('Support user ID'),{target:{value:' user/1 '}});
  fireEvent.change(screen.getByLabelText('Reason (optional)'),{target:{value:' review '}});
  const trigger=screen.getByRole('button',{name:'Disable SUPPORT User'});fireEvent.click(trigger);
  const dialog=screen.getByRole('dialog',{name:'Disable SUPPORT user?'});
  expect(dialog.textContent).toContain('user/1');expect(dialog.textContent).toContain('review');
  expect(document.activeElement).toBe(screen.getByRole('button',{name:'Cancel'}));
  fireEvent.keyDown(document,{key:'Tab',shiftKey:true});expect(document.activeElement).toBe(screen.getByRole('button',{name:'Confirm disable'}));
  fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(trigger);expect(ApiClient.post).not.toHaveBeenCalled();
});

test('disable is single flight and session changes remove the review and ignore late results', async () => {
  principal('one',['workforce.user.suspend']);const previous=deferred();(ApiClient.post as jest.Mock).mockReturnValue(previous.promise);
  render(<WorkforceAdminScreen />);fireEvent.change(screen.getByLabelText('Support user ID'),{target:{value:'user/1'}});fireEvent.change(screen.getByLabelText('Reason (optional)'),{target:{value:' review '}});
  fireEvent.click(screen.getByRole('button',{name:'Disable SUPPORT User'}));fireEvent.click(screen.getByRole('button',{name:'Confirm disable'}));
  expect(ApiClient.post).toHaveBeenCalledWith('/internal/admin/support/workforce-users/user%2F1/disable',{reason:'review'});
  expect(screen.getAllByRole('button',{name:'Disabling…'}).every(button => (button as HTMLButtonElement).disabled)).toBe(true);expect(document.activeElement).toBe(screen.getByRole('dialog'));
  fireEvent.keyDown(document,{key:'Escape'});expect(screen.getByRole('dialog')).toBeTruthy();expect(ApiClient.post).toHaveBeenCalledTimes(1);
  act(()=>principal('two',['workforce.user.suspend']));expect(screen.queryByRole('dialog')).toBeNull();
  await act(async()=>{previous.resolve({id:'user/1',status:'DISABLED'});await previous.promise;});expect(screen.queryByText('Support user user/1 disabled.')).toBeNull();
});

test('read-only workforce sessions cannot provision or disable even with mutation scopes',()=>{
 principal('one',['workforce.user.create','workforce.user.suspend']);act(()=>useAuthStore.setState(state=>({principal:{...state.principal!,readOnlyPrincipal:true}})));render(<WorkforceAdminScreen/>);expect(screen.queryByRole('button',{name:'Create SUPPORT User'})).toBeNull();expect(screen.queryByRole('button',{name:'Disable SUPPORT User'})).toBeNull();expect(ApiClient.post).not.toHaveBeenCalled();
});

test('provisioning is single-flight, mutually exclusive, and locks on mismatched username',async()=>{
 principal('one',['workforce.user.create','workforce.user.suspend']);const previous=deferred();(ApiClient.post as jest.Mock).mockReturnValue(previous.promise);render(<WorkforceAdminScreen/>);fireEvent.change(screen.getByLabelText('Support username or email'),{target:{value:'USER'}});const form=screen.getByRole('button',{name:'Create SUPPORT User'}).closest('form')!;fireEvent.submit(form);fireEvent.submit(form);expect(ApiClient.post).toHaveBeenCalledTimes(1);expect((screen.getByRole('button',{name:'Disable SUPPORT User'}) as HTMLButtonElement).disabled).toBe(true);await act(async()=>{previous.resolve({username:'other',supportUserId:'id',temporaryPassword:'synthetic-secret',passwordExpiresAt:'2027-01-01'});await previous.promise;});expect(screen.queryByText(/synthetic-secret/)).toBeNull();expect(await screen.findByText(/provisioning response was incomplete/i)).toBeTruthy();expect((screen.getByRole('button',{name:'Create SUPPORT User'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByText(/fresh read cannot exclude a late commit/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'I reviewed workforce and audit records'}));expect((screen.getByRole('button',{name:'Create SUPPORT User'}) as HTMLButtonElement).disabled).toBe(false);expect(screen.getByLabelText('Support username or email')).toHaveProperty('value','USER');
});

test('a visible one-time credential cannot be replaced or dismissed without confirmation',async()=>{
 principal('one',['workforce.user.create']);const report=jest.fn();const confirm=jest.spyOn(window,'confirm').mockReturnValue(false);(ApiClient.post as jest.Mock).mockResolvedValue({username:'user',supportUserId:'id',temporaryPassword:'synthetic-secret',passwordExpiresAt:'2027-01-01'});render(<WorkforceAdminScreen onWorkforceGuardChange={report}/>);fireEvent.change(screen.getByLabelText('Support username or email'),{target:{value:'USER'}});fireEvent.click(screen.getByRole('button',{name:'Create SUPPORT User'}));await screen.findByText(/synthetic-secret/);expect(report).toHaveBeenLastCalledWith(true,false);const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);expect((screen.getByRole('button',{name:'Create SUPPORT User'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Dismiss credential'}));expect(screen.getByText(/synthetic-secret/)).toBeTruthy();confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Dismiss credential'}));expect(screen.queryByText(/synthetic-secret/)).toBeNull();expect(report).toHaveBeenLastCalledWith(false,false);confirm.mockRestore();
});

test('shell navigation warns before losing a visible one-time credential',async()=>{
 const {Layout}=await import('../src/screens/authenticated/Layout');principal('one',['workforce.user.create']);useAuthStore.setState({isAuthenticated:true});(ApiClient.post as jest.Mock).mockResolvedValue({username:'user',supportUserId:'id',temporaryPassword:'synthetic-secret',passwordExpiresAt:'2027-01-01'});const view=render(<Layout/>);fireEvent.click(view.getByTestId('nav-workforceAccess'));fireEvent.change(view.getByLabelText('Support username or email'),{target:{value:'user'}});fireEvent.click(view.getByRole('button',{name:'Create SUPPORT User'}));await view.findByText(/synthetic-secret/);fireEvent.click(view.getByTestId('nav-dashboard'));expect(view.getByRole('dialog',{name:'Leave workforce access review?'})).toBeTruthy();fireEvent.click(view.getByRole('button',{name:'Keep working'}));expect(view.getByText(/synthetic-secret/)).toBeTruthy();fireEvent.click(view.getByTestId('nav-dashboard'));fireEvent.click(view.getByRole('button',{name:'Discard and leave'}));expect(view.queryByText(/synthetic-secret/)).toBeNull();
});
