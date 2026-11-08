import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DashboardScreen } from '../src/screens/authenticated/DashboardScreen';
import { formatMinor } from '../src/components/dashboard/types';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn() } }));
function setPrincipal(sessionId: string, scopes: string[] = []) {
  useAuthStore.setState({ principal: { type:'OPERATOR', principalId:'operator', sessionId, audience:'workforce-admin', roles:['SYNTHETIC'], scopes, customerAccess:'NONE', assuranceLevel:'MFA' } });
}
const dashboard = (displayName: string) => ({ templateKey:'SYNTHETIC', displayName, description:'Synthetic fixture', isFallback:false, widgets:[] });
function deferred() { let resolve!: (v:any) => void; const promise = new Promise<any>(r => { resolve = r; }); return {promise, resolve}; }
beforeEach(() => { jest.resetAllMocks(); setPrincipal('one'); });

test('session change reloads dashboard and ignores an old response', async () => {
  const old = deferred(); (ApiClient.get as jest.Mock).mockReturnValueOnce(old.promise).mockResolvedValueOnce(dashboard('New dashboard'));
  render(<DashboardScreen />); act(() => setPrincipal('two')); expect(await screen.findByText('New dashboard')).toBeTruthy();
  await act(async () => { old.resolve(dashboard('Old dashboard')); await old.promise; }); expect(screen.queryByText('Old dashboard')).toBeNull(); expect(ApiClient.get).toHaveBeenCalledTimes(2);
});
test('a malformed widget authorization cannot result in a data request or false empty state', async () => {
  (ApiClient.get as jest.Mock).mockResolvedValue({ ...dashboard('Synthetic'), widgets:[{widgetKey:'transaction-summary', order:1, displayName:'Transactions', description:'', fetchMode:'proxy', kind:'kpi-summary', authorized:'false'}] });
  render(<DashboardScreen />); expect(await screen.findByText(/Invalid dashboard response/)).toBeTruthy(); expect(ApiClient.get).toHaveBeenCalledTimes(1); expect(screen.queryByText(/No widgets are configured/)).toBeNull();
});
test('malformed fallback data produces an error rather than crashing', async () => {
  (ApiClient.get as jest.Mock).mockResolvedValue({ ...dashboard('Synthetic'), isFallback:true, fallbackReason:{unexpected:true} }); render(<DashboardScreen />); expect(await screen.findByText(/Invalid dashboard response/)).toBeTruthy();
});
test('dashboard amounts preserve exact units and do not assume missing currency or unsafe numbers', () => {
  expect(formatMinor('900719925474099301','NGN')).toBe('₦9,007,199,254,740,993.01');
  expect(formatMinor('12345','USD')).toBe('USD 12,345 minor units');
  expect(formatMinor(9007199254740992,'NGN')).toBe('Amount unavailable');
  expect(formatMinor('12.5','NGN')).toBe('Amount unavailable');
  expect(formatMinor('123')).toBe('Amount unavailable');
});

test('the session store id changes dashboard context even when principal details are unchanged', async () => {
  const old=deferred();(ApiClient.get as jest.Mock).mockReturnValueOnce(old.promise).mockResolvedValueOnce(dashboard('Current session dashboard'));render(<DashboardScreen/>);act(()=>useAuthStore.setState({sessionId:'another-session'}));expect(await screen.findByText('Current session dashboard')).toBeTruthy();await act(async()=>{old.resolve(dashboard('Stale dashboard'));await old.promise;});expect(screen.queryByText('Stale dashboard')).toBeNull();
});
test('dashboard configuration error offers a working retry',async()=>{
 (ApiClient.get as jest.Mock).mockRejectedValueOnce(new Error('Synthetic unavailable')).mockResolvedValueOnce(dashboard('Recovered dashboard'));render(<DashboardScreen/>);expect(await screen.findByText(/Synthetic unavailable/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Retry dashboard'}));expect(await screen.findByText('Recovered dashboard')).toBeTruthy();expect(ApiClient.get).toHaveBeenCalledTimes(2);
});
test('session scopes are available through a keyboard-operable disclosure',async()=>{
 setPrincipal('one',['test.scope']);(ApiClient.get as jest.Mock).mockResolvedValue(dashboard('Synthetic'));render(<DashboardScreen/>);await screen.findByText('Synthetic');const disclosure=screen.getByText('Allowed scopes (1)');expect(disclosure.parentElement?.hasAttribute('open')).toBe(false);fireEvent.click(disclosure);expect(disclosure.parentElement?.hasAttribute('open')).toBe(true);expect(screen.getByText('• test.scope')).toBeTruthy();
});
