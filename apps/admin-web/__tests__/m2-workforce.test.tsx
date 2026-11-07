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
  render(<WorkforceAdminScreen />);fireEvent.change(screen.getByPlaceholderText('SUPPORT user ID'),{target:{value:'user-1'}});fireEvent.click(screen.getByRole('button',{name:'Disable SUPPORT User'}));
  expect(await screen.findByText(/Disable outcome not confirmed/)).toBeTruthy();expect(screen.queryByText('Support user user-1 disabled.')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Disable SUPPORT User'}));expect(await screen.findByText('Support user user-1 disabled.')).toBeTruthy();
});

test('a new session for the same operator clears one-time credentials', async () => {
  principal('one',['workforce.user.create']);(ApiClient.post as jest.Mock).mockResolvedValue({username:'synthetic',supportUserId:'one-id',temporaryPassword:'synthetic-secret',passwordExpiresAt:'2027-01-01'});
  render(<WorkforceAdminScreen />);fireEvent.change(screen.getByLabelText('Support username or email'),{target:{value:'synthetic'}});fireEvent.click(screen.getByRole('button',{name:'Create SUPPORT User'}));await screen.findByText(/synthetic-secret/);
  act(()=>useAuthStore.setState(state=>({principal:{...state.principal!,sessionId:'new-session'}})));expect(screen.queryByText(/synthetic-secret/)).toBeNull();
});
