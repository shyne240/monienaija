import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DashboardSettingsScreen } from '../src/screens/authenticated/DashboardSettingsScreen';
import { ApiClient, ApiError } from '../src/services/api-client';
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
function submit(role='ROLE_A') { fireEvent.click(save(role)); fireEvent.click(screen.getByRole('button',{name:'Confirm assignment'})); }
beforeEach(() => { jest.resetAllMocks(); principal(); setupReads(); });

test('malformed configuration is unavailable rather than an empty list', async () => {
  (ApiClient.get as jest.Mock).mockImplementation((url: string) => Promise.resolve(url.endsWith('/templates') ? {} : url.endsWith('/assignments') ? assignments : []));
  render(<DashboardSettingsScreen />); expect(await screen.findByText(/Invalid dashboard configuration response/)).toBeTruthy(); expect(screen.queryByText('Dashboard Templates (0)')).toBeNull();
});
test('rejects unrelated receipts, preserves draft, and requires reload before retry', async () => {
  (ApiClient.put as jest.Mock).mockResolvedValue(receipt('ROLE_B'));
  render(<DashboardSettingsScreen />); await choose(); fireEvent.change(screen.getByLabelText('Reason for ROLE_A dashboard change'), { target: { value: 'Synthetic review' } }); submit();
  expect(await screen.findByText(/outcome could not be confirmed/)).toBeTruthy(); expect(screen.queryByText(/Dashboard for ROLE_A is now/)).toBeNull(); expect((save() as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reload configuration' })); expect(await screen.findByLabelText('Reason for ROLE_A dashboard change')).toHaveProperty('value', 'Synthetic review'); expect((save() as HTMLButtonElement).disabled).toBe(true); fireEvent.click(screen.getByRole('button',{name:'I reviewed ROLE_A'})); expect((save() as HTMLButtonElement).disabled).toBe(false);
});
test('confirms a matching receipt and clears the submitted reason', async () => {
  (ApiClient.put as jest.Mock).mockResolvedValue(receipt()); render(<DashboardSettingsScreen />); await choose(); fireEvent.change(screen.getByLabelText('Reason for ROLE_A dashboard change'), { target: { value:'Review' } }); submit();
  expect(await screen.findByText('Dashboard for ROLE_A is now TWO.')).toBeTruthy(); expect(screen.getByLabelText('Reason for ROLE_A dashboard change')).toHaveProperty('value', ''); expect((save() as HTMLButtonElement).disabled).toBe(true);
});
test('only one role assignment can be submitted at a time', async () => {
  const pending = deferred(); (ApiClient.put as jest.Mock).mockReturnValue(pending.promise); render(<DashboardSettingsScreen />); await choose(); await choose('ROLE_B'); submit(); expect((save('ROLE_B') as HTMLButtonElement).disabled).toBe(true); expect((screen.getByRole('button', { name:'Reload configuration' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { pending.resolve(receipt()); await pending.promise; }); expect(ApiClient.put).toHaveBeenCalledTimes(1);
});
test('session change discards drafts and ignores late assignment responses', async () => {
  const pending = deferred(); (ApiClient.put as jest.Mock).mockReturnValue(pending.promise); render(<DashboardSettingsScreen />); await choose(); submit(); act(() => principal('session-b')); await screen.findByLabelText('Dashboard template for ROLE_A'); await act(async () => { pending.resolve(receipt()); await pending.promise; });
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
  principal('read-only'); act(() => useAuthStore.setState(state => ({principal: state.principal ? {...state.principal, readOnlyPrincipal: true} : null}))); render(<DashboardSettingsScreen />); await screen.findByText('ROLE_A'); expect(screen.queryByLabelText('Dashboard template for ROLE_A')).toBeNull(); expect(ApiClient.put).not.toHaveBeenCalled();
});
test('missing view permission does not call configuration endpoints', async () => {
  principal('restricted', ['workforce.dashboard.assign']); render(<DashboardSettingsScreen />); expect(await screen.findByText(/do not have permission to view dashboard configuration/)).toBeTruthy(); expect(ApiClient.get).not.toHaveBeenCalled();
});
test('reload retains local drafts but requires explicit review and confirmation focuses safely',async()=>{
 render(<DashboardSettingsScreen/>);await choose();fireEvent.click(screen.getByRole('button',{name:'Reload configuration'}));await screen.findByRole('button',{name:'I reviewed ROLE_A'});expect((save() as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'I reviewed ROLE_A'}));fireEvent.click(save());expect(document.activeElement).toBe(screen.getByRole('button',{name:'Keep editing'}));fireEvent.click(screen.getByRole('button',{name:'Keep editing'}));expect(document.activeElement).toBe(save());expect(ApiClient.put).not.toHaveBeenCalled();
});
test('a change to the store session id also resets drafts for the same principal',async()=>{
 render(<DashboardSettingsScreen/>);await choose();act(()=>useAuthStore.setState({sessionId:'different-store-session'}));await screen.findByLabelText('Dashboard template for ROLE_A');expect(screen.getByLabelText('Dashboard template for ROLE_A')).toHaveProperty('value','ONE');
});

test('a conflict requires fresh configuration and explicit review, not immediate retry',async()=>{
 (ApiClient.put as jest.Mock).mockRejectedValue(new ApiError('conflict',409));render(<DashboardSettingsScreen/>);await choose();submit();await screen.findByText(/outcome could not be confirmed/);expect((save() as HTMLButtonElement).disabled).toBe(true);expect(screen.queryByRole('button',{name:'I reviewed ROLE_A'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Reload configuration'}));await screen.findByRole('button',{name:'I reviewed ROLE_A'});expect(screen.getByText(/fresh read does not exclude a late commit/)).toBeTruthy();expect((save() as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'I reviewed ROLE_A'}));expect((save() as HTMLButtonElement).disabled).toBe(false);
});

test('a missing role cannot silently discard an uncertain outcome',async()=>{
 const confirm=jest.spyOn(window,'confirm').mockReturnValue(false);const report=jest.fn();(ApiClient.put as jest.Mock).mockRejectedValue(new Error('network lost'));render(<DashboardSettingsScreen onDashboardGuardChange={report}/>);await choose();submit();await screen.findByText(/outcome could not be confirmed/);(ApiClient.get as jest.Mock).mockImplementation((url:string)=>Promise.resolve(url.endsWith('/templates')?templates:url.endsWith('/assignments')?assignments.filter(a=>a.roleKey!=='ROLE_A'):[]));fireEvent.click(screen.getByRole('button',{name:'Reload configuration'}));await screen.findByRole('button',{name:'I reviewed ROLE_A and discard draft'});fireEvent.click(screen.getByRole('button',{name:'I reviewed ROLE_A and discard draft'}));expect(report).toHaveBeenLastCalledWith(true,false);confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'I reviewed ROLE_A and discard draft'}));await waitFor(()=>expect(report).toHaveBeenLastCalledWith(false,false));confirm.mockRestore();
});

test('dashboard assignment drafts and pending writes guard browser unload',async()=>{
 const report=jest.fn();const pending=deferred();(ApiClient.put as jest.Mock).mockReturnValue(pending.promise);render(<DashboardSettingsScreen onDashboardGuardChange={report}/>);await choose();expect(report).toHaveBeenLastCalledWith(true,false);const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);submit();expect(report).toHaveBeenLastCalledWith(true,true);await act(async()=>{pending.resolve(receipt());await pending.promise;});await waitFor(()=>expect(report).toHaveBeenLastCalledWith(false,false));
});

test('shell navigation protects dashboard assignment drafts',async()=>{
 const {Layout}=await import('../src/screens/authenticated/Layout');useAuthStore.setState(state=>({isAuthenticated:true,principal:state.principal?{...state.principal,roles:['SUPER_ADMIN']}:null}));const view=render(<Layout/>);fireEvent.click(view.getByTestId('nav-dashboardSettings'));await choose();fireEvent.click(view.getByTestId('nav-dashboard'));expect(view.getByRole('dialog',{name:'Leave dashboard settings?'})).toBeTruthy();fireEvent.click(view.getByRole('button',{name:'Keep working'}));expect(view.getByLabelText('Dashboard template for ROLE_A')).toHaveProperty('value','TWO');fireEvent.click(view.getByTestId('nav-dashboard'));fireEvent.click(view.getByRole('button',{name:'Discard and leave'}));expect(view.queryByLabelText('Dashboard template for ROLE_A')).toBeNull();
});
