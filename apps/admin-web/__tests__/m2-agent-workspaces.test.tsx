import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AgentUnifiedHistoryPanel, AdminAgentUnifiedHistoryResponse } from '../src/components/AgentUnifiedHistoryPanel';
import { AgentTransactionPinSupportPanel, AgentAdminPinStatus } from '../src/components/AgentTransactionPinSupportPanel';
import { AgentCredentialPanel } from '../src/screens/authenticated/AgentCredentialPanel';
import { AgentNetworkScreen } from '../src/screens/authenticated/AgentNetworkScreen';
import { useAuthStore } from '../src/store/auth-store';
import { ApiClient } from '../src/services/api-client';
import { revokeAgentActiveSessions } from '../src/services/ordinary-agent-admin-api';

jest.mock('../src/services/api-client', () => ({ ApiClient: { post: jest.fn(), get: jest.fn() } }));
jest.mock('../src/services/ordinary-agent-admin-api', () => ({ ...jest.requireActual('../src/services/ordinary-agent-admin-api'), revokeAgentActiveSessions: jest.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const empty: AdminAgentUnifiedHistoryResponse = { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false } };

beforeEach(() => jest.resetAllMocks());

test('history response from a prior Agent does not appear for the newly selected Agent', async () => {
  const previous = deferred<AdminAgentUnifiedHistoryResponse>();
  const load = jest.fn().mockReturnValueOnce(previous.promise).mockResolvedValueOnce(empty);
  const view = render(<AgentUnifiedHistoryPanel agentId="old" canViewAgent loadTransactions={load} />);
  fireEvent.click(screen.getByRole('button', { name: 'Load unified stream' }));
  expect((screen.getByLabelText('Unified history service filter') as HTMLSelectElement).disabled).toBe(true);
  view.rerender(<AgentUnifiedHistoryPanel agentId="new" canViewAgent loadTransactions={load} />);
  fireEvent.click(screen.getByRole('button', { name: 'Load unified stream' }));
  expect(await screen.findByText('No unified Agent history entries found.')).toBeTruthy();
  await act(async () => { previous.resolve({ ...empty, pagination: { ...empty.pagination, total: 42 } }); await previous.promise; });
  expect(screen.queryByText(/42 total/)).toBeNull();
});

test('invalid history data is reported as an error rather than empty results', async () => {
  const load = jest.fn().mockResolvedValue({});
  render(<AgentUnifiedHistoryPanel agentId="agent" canViewAgent loadTransactions={load} />);
  fireEvent.click(screen.getByRole('button', { name: 'Load unified stream' }));
  expect(await screen.findByText('Invalid Agent transaction history response.')).toBeTruthy();
  expect(screen.queryByText('No unified Agent history entries found.')).toBeNull();
});

test('PIN state cannot leak between agents or remain current after a failed refresh', async () => {
  const previous = deferred<AgentAdminPinStatus>();
  const load = jest.fn().mockReturnValueOnce(previous.promise).mockResolvedValueOnce({ agentId: 'new', status: 'ACTIVE' }).mockRejectedValueOnce(new Error('PIN status unavailable'));
  const view = render(<AgentTransactionPinSupportPanel agentId="old" canManageSupport loadPinStatus={load} />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect PIN state' }));
  view.rerender(<AgentTransactionPinSupportPanel agentId="new" canManageSupport loadPinStatus={load} />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect PIN state' }));
  expect(await screen.findByText('ACTIVE')).toBeTruthy();
  await act(async () => { previous.resolve({ agentId: 'old', status: 'LOCKED' }); await previous.promise; });
  expect(screen.queryByText('LOCKED')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh PIN state' }));
  expect(await screen.findByText('PIN status unavailable')).toBeTruthy();
  expect(screen.queryByText('ACTIVE')).toBeNull();
});

test('a late one-time credential is not displayed under a different Agent', async () => {
  const previous = deferred<unknown>();
  (ApiClient.post as jest.Mock).mockReturnValueOnce(previous.promise);
  const view = render(<AgentCredentialPanel agentId="old" agentStatus="ACTIVE" canManage />);
  fireEvent.click(screen.getByRole('button', { name: 'Issue initial credential' }));
  view.rerender(<AgentCredentialPanel agentId="new" agentStatus="ACTIVE" canManage />);
  await act(async () => {
    previous.resolve({ agentId: 'old', credentialId: 'old-credential', temporaryPassword: 'synthetic-secret', rotationRequired: true, passwordExpiresAt: null, deliveryNotice: 'test' });
    await previous.promise;
  });
  expect(screen.queryByText('synthetic-secret')).toBeNull();
  expect(screen.queryByText('Initial temporary credential issued.')).toBeNull();
  expect((screen.getByRole('button', { name: 'Issue initial credential' }) as HTMLButtonElement).disabled).toBe(false);
});

test('credential result is not presented as issued when the receipt is incomplete', async () => {
  (ApiClient.post as jest.Mock).mockResolvedValueOnce({ agentId: 'agent', credentialId: 'id' });
  render(<AgentCredentialPanel agentId="agent" agentStatus="ACTIVE" canManage />);
  fireEvent.click(screen.getByRole('button', { name: 'Issue initial credential' }));
  expect(await screen.findByText(/Credential response could not be confirmed/)).toBeTruthy();
  expect(screen.queryByText('Initial temporary credential issued.')).toBeNull();
  expect(screen.queryByTestId('temporary-agent-password')).toBeNull();
});

test('session revocation requires a matching Agent and a non-negative integer count', async () => {
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  (revokeAgentActiveSessions as jest.Mock)
    .mockResolvedValueOnce({ status: 'LIVE', data: { agentId: 'other', revokedCount: 2 } })
    .mockResolvedValueOnce({ status: 'LIVE', data: { agentId: 'agent', revokedCount: -1 } })
    .mockResolvedValueOnce({ status: 'LIVE', data: { agentId: 'agent', revokedCount: 0 } });
  render(<AgentCredentialPanel agentId="agent" agentStatus="ACTIVE" canManage />);
  const button = screen.getByRole('button', { name: 'Invalidate active sessions' });
  fireEvent.click(button);
  expect(await screen.findByText(/Session revocation response could not be confirmed/)).toBeTruthy();
  expect(screen.queryByText(/Active Agent sessions invalidated/)).toBeNull();
  fireEvent.click(button);
  expect(await screen.findByText(/Session revocation response could not be confirmed/)).toBeTruthy();
  fireEvent.click(button);
  expect(await screen.findByText('Active Agent sessions invalidated (0 sessions revoked).')).toBeTruthy();
  jest.restoreAllMocks();
});

test('a credential response from a previous session is discarded even for the same Agent and grants', async () => {
  const principal = { type: 'OPERATOR' as const, principalId: 'old-user', sessionId: 'old-session', audience: 'workforce-admin' as const, roles: ['AGENT_NETWORK_MANAGER'], scopes: ['agent.manage_credentials'], customerAccess: 'NONE' as const, assuranceLevel: 'MFA' as const };
  useAuthStore.setState({ principal, sessionId: 'old-session' });
  const pending = deferred<unknown>();
  (ApiClient.post as jest.Mock).mockReturnValueOnce(pending.promise);
  render(<AgentCredentialPanel agentId="agent" agentStatus="ACTIVE" canManage />);
  fireEvent.click(screen.getByRole('button', { name: 'Issue initial credential' }));
  act(() => useAuthStore.setState({ principal: { ...principal, principalId: 'new-user', sessionId: 'new-session' }, sessionId: 'new-session' }));
  await act(async () => { pending.resolve({ agentId: 'agent', credentialId: 'id', temporaryPassword: 'synthetic-secret', rotationRequired: true, passwordExpiresAt: null, deliveryNotice: 'test' }); await pending.promise; });
  expect(screen.queryByText('synthetic-secret')).toBeNull();
  expect(screen.queryByText('Initial temporary credential issued.')).toBeNull();
});

test('funding inbox discards obsolete refreshes and never treats failed reads as empty', async () => {
  const { PendingFundingApprovalsQueue } = require('../src/components/PendingFundingApprovalsQueue');
  const old = deferred<unknown>();
  const current = deferred<unknown>();
  const loader = jest.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise).mockRejectedValueOnce(new Error('Funding inbox unavailable'));
  const view = render(<PendingFundingApprovalsQueue canReviewFunding loadInboxPage={loader} onSelectRequest={() => {}} />);
  view.rerender(<PendingFundingApprovalsQueue canReviewFunding loadInboxPage={loader} onSelectRequest={() => {}} refreshTrigger={1} />);
  await act(async () => { current.resolve({ items: [], page: 1, limit: 20, total: 0 }); await current.promise; });
  expect(await screen.findByTestId('funding-inbox-empty')).toBeTruthy();
  await act(async () => { old.resolve({ items: [{ id: 'stale', agentId: 'old' }], page: 1, limit: 20, total: 1 }); await old.promise; });
  expect(screen.queryByText('stale')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh inbox' }));
  expect(await screen.findByText('Funding inbox unavailable')).toBeTruthy();
  expect(screen.queryByTestId('funding-inbox-empty')).toBeNull();
  expect(screen.queryByTestId('funding-inbox-pagination')).toBeNull();
});

test('malformed funding inbox data is reported as unavailable, not as zero instructions', async () => {
  const { PendingFundingApprovalsQueue } = require('../src/components/PendingFundingApprovalsQueue');
  render(<PendingFundingApprovalsQueue canReviewFunding loadInboxPage={jest.fn().mockResolvedValue({})} onSelectRequest={() => {}} />);
  expect(await screen.findByText('Invalid funding inbox response.')).toBeTruthy();
  expect(screen.queryByTestId('funding-inbox-empty')).toBeNull();
});


test('late financial position from another Agent never replaces the selected Agent position', async () => {
  useAuthStore.setState({ principal: { type: 'OPERATOR', principalId: 'synthetic', sessionId: 'synthetic', audience: 'workforce-admin', roles: [], scopes: ['agent.view'], customerAccess: 'NONE', assuranceLevel: 'MFA' } });
  const old = deferred<unknown>();
  const agent = (id: string) => ({ id, reference: `AG-${id}`, status: 'ACTIVE', agentClassId: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/internal/agents?')) return Promise.resolve({ data: [agent('old'), agent('new')], total: 2 });
    if (path.includes('/old/financial-position')) return old.promise;
    if (path.includes('/new/financial-position')) return Promise.resolve({ agentId: 'new', balanceMinor: '12345', currency: 'USD', walletExists: true, walletId: 'new-wallet' });
    return Promise.resolve([]);
  });
  render(<AgentNetworkScreen />);
  await screen.findByText('AG-old');
  const views = screen.getAllByRole('button', { name: 'View' });
  fireEvent.click(views[0]);
  fireEvent.click(views[1]);
  expect(await screen.findByText('USD 12,345 minor units')).toBeTruthy();
  await act(async () => { old.resolve({ agentId: 'old', balanceMinor: '999999', currency: 'NGN', walletExists: true, walletId: 'old-wallet' }); await old.promise; });
  expect(screen.queryByText('old-wallet')).toBeNull();
  expect(screen.getByText('USD 12,345 minor units')).toBeTruthy();
});

test('Agent list discards a late response from the previous filter', async () => {
  useAuthStore.setState({ principal: { type:'OPERATOR', principalId:'synthetic', sessionId:'synthetic', audience:'workforce-admin', roles:[], scopes:['agent.view'], customerAccess:'NONE', assuranceLevel:'MFA' } });
  const old = deferred<unknown>(); const current = deferred<unknown>();
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => path.startsWith('/internal/agents?') ? (path.includes('status=ACTIVE') ? current.promise : old.promise) : Promise.resolve([]));
  render(<AgentNetworkScreen />);
  fireEvent.change(screen.getByLabelText('Agent status filter'), { target:{ value:'ACTIVE' } });
  const row = (id: string) => ({ id, reference:`REF-${id}`, status:'ACTIVE', agentClassId:null, createdAt:'2026-01-01', updatedAt:'2026-01-01' });
  await act(async () => { current.resolve({ data:[row('current')], total:1 }); await current.promise; });
  expect(screen.getByText('REF-current')).toBeTruthy();
  await act(async () => { old.resolve({ data:[row('old')], total:1 }); await old.promise; });
  expect(screen.queryByText('REF-old')).toBeNull();
  expect(screen.getByText('REF-current')).toBeTruthy();
});

test('Cash-to-Cash list discards an older search response', async () => {
  const { CashToCashOperationsScreen } = require('../src/screens/authenticated/CashToCashOperationsScreen');
  useAuthStore.setState({ principal: { type:'OPERATOR', principalId:'synthetic', sessionId:'synthetic', audience:'workforce-admin', roles:[], scopes:['transaction.view'], customerAccess:'NONE', assuranceLevel:'MFA' } });
  const old = deferred<unknown>(); const current = deferred<unknown>();
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => path.includes('/cash-to-cash/transfers?') ? (path.includes('reference=current') ? current.promise : old.promise) : Promise.reject(new Error('synthetic unavailable')));
  render(<CashToCashOperationsScreen />);
  fireEvent.change(screen.getByLabelText('Reference'), { target:{ value:'current' } });
  fireEvent.submit(screen.getByRole('form', { name:'Cash-to-Cash filters' }));
  const row = (id: string) => ({ id, reference:id, agentId:'a', agentReference:null, beneficiaryPhoneMasked:'***', status:'UNCLAIMED', principalMinor:'1200', feeMinor:'0', vatMinor:'0', totalMinor:'1200', currency:'USD', redemptionMethod:null, expiresAt:'2026-01-01', claimedAt:null, createdAt:'2026-01-01' });
  await act(async () => { current.resolve({ data:[row('current')], total:1, page:1, limit:20, totalPages:1 }); await current.promise; });
  expect(screen.getByText('current')).toBeTruthy();
  expect(screen.getByText('USD 1,200 minor units')).toBeTruthy();
  await act(async () => { old.resolve({ data:[row('old')], total:1, page:1, limit:20, totalPages:1 }); await old.promise; });
  expect(screen.queryByText('old')).toBeNull();
  expect(screen.getByText('current')).toBeTruthy();
});


test('late Agent reclassification completion does not change the new Agent workspace', async () => {
  const { AgentClassAssignmentPanel } = require('../src/components/AgentClassAssignmentPanel');
  const old = deferred<void>();
  const reclassify = jest.fn().mockReturnValue(old.promise);
  const classes = [{id:'one',code:'ONE',name:'One',isActive:true},{id:'two',code:'TWO',name:'Two',isActive:true}];
  const view = render(<AgentClassAssignmentPanel agentId="old" currentClassId="one" availableClasses={classes} canManageClasses onReclassify={reclassify} />);
  fireEvent.change(screen.getByLabelText('Target Agent class'), {target:{value:'two'}});
  fireEvent.change(screen.getByLabelText('Class change reason'), {target:{value:'Synthetic reason'}});
  fireEvent.click(screen.getByRole('button', {name:'Reclassify Agent'}));
  expect(reclassify).toHaveBeenCalledWith('old', 'two', 'Synthetic reason');
  view.rerender(<AgentClassAssignmentPanel agentId="new" currentClassId="one" availableClasses={classes} canManageClasses onReclassify={reclassify} />);
  await act(async () => { old.resolve(); await old.promise; });
  expect(screen.queryByText('Agent class updated.')).toBeNull();
  expect((screen.getByLabelText('Class change reason') as HTMLInputElement).value).toBe('');
});

test('read-only Agent detail keeps permitted reads and hides lifecycle and credential writes',async()=>{
 const scopes=['agent.view','agent.suspend','agent.terminate','agent.reactivate','agent.activate','agent.manage_credentials','agent.manage_outlets_terminals','agent.assign_limit','agent.manage_classes','limit.view'];
 useAuthStore.setState({principal:{type:'OPERATOR',principalId:'reader',sessionId:'reader',audience:'workforce-admin',roles:[],scopes,customerAccess:'NONE',assuranceLevel:'MFA',readOnlyPrincipal:true}});
 const agent={id:'agent',reference:'AG-READ',status:'ACTIVE',agentClassId:null,createdAt:'2026-01-01',updatedAt:'2026-01-01'};
 (ApiClient.get as jest.Mock).mockImplementation((path:string)=>path.startsWith('/internal/agents?')?Promise.resolve({data:[agent],total:1}):Promise.resolve([]));
 render(<AgentNetworkScreen/>);await screen.findByText('AG-READ');fireEvent.click(screen.getByRole('button',{name:'View'}));
 expect(screen.queryByRole('button',{name:'Suspend'})).toBeNull();expect(screen.queryByRole('button',{name:'Terminate'})).toBeNull();expect(screen.queryByRole('button',{name:'Issue initial credential'})).toBeNull();
 expect(screen.getByLabelText('Agent outlets and terminals')).toBeTruthy();expect(ApiClient.post).not.toHaveBeenCalled();
});

test('credential component independently blocks read-only principals even when passed canManage',()=>{
 useAuthStore.setState({principal:{type:'OPERATOR',principalId:'reader',sessionId:'reader',audience:'workforce-admin',roles:[],scopes:['agent.manage_credentials'],customerAccess:'NONE',assuranceLevel:'MFA',readOnlyPrincipal:true}});
 render(<AgentCredentialPanel agentId="agent" agentStatus="ACTIVE" canManage/>);expect(screen.queryByRole('button',{name:'Issue initial credential'})).toBeNull();expect(ApiClient.post).not.toHaveBeenCalled();
});
