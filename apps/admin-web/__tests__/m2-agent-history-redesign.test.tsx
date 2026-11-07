import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { AgentUnifiedHistoryPanel, AdminAgentUnifiedHistoryResponse } from '../src/components/AgentUnifiedHistoryPanel';
import { useAuthStore } from '../src/store/auth-store';
const item = { id:'tx-1', type:'CASH_IN', status:'FAILED', direction:'DEBIT', amountMinor:'900719925474099301', currency:'NGN', createdAt:'2026-11-01T00:00:00Z', reference:'TX-1', feeMinor:'0', counterparty:null, commission:null };
function session(id: string) { useAuthStore.setState({isAuthenticated:true, token:id, sessionId:id, principal:{type:'OPERATOR',principalId:'operator',sessionId:id,audience:'workforce-admin',roles:['AGENT_NETWORK_MANAGER'],scopes:['agent.view'],customerAccess:'NONE',assuranceLevel:'MFA'}}); }
function deferred<T>() { let resolve!: (value:T) => void; const promise=new Promise<T>(r=>{resolve=r;}); return {promise,resolve}; }
beforeEach(() => session('one'));

test('redesigned activity cards preserve exact amount, status and reference; empty later page can navigate back', async () => {
  const load=jest.fn().mockResolvedValueOnce({items:[item],pagination:{page:1,limit:20,total:21,totalPages:2,hasNextPage:true}}).mockResolvedValueOnce({items:[],pagination:{page:2,limit:20,total:1,totalPages:1,hasNextPage:false}}).mockResolvedValueOnce({items:[item],pagination:{page:1,limit:20,total:1,totalPages:1,hasNextPage:false}});
  render(<AgentUnifiedHistoryPanel agentId="agent" canViewAgent loadTransactions={load} />);
  expect(screen.getByText(/This view does not initiate transactions/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Load unified stream'}));
  expect(await screen.findByText('NGN 9,007,199,254,740,993.01')).toBeTruthy(); expect(screen.getByText('FAILED')).toBeTruthy(); expect(screen.getByText('TX-1')).toBeTruthy();
  fireEvent.click(within(screen.getByTestId('agent-unified-history-pager')).getByRole('button',{name:'Next'}));
  expect(await screen.findByText('No unified Agent history entries found on this page.')).toBeTruthy();
  expect(screen.getByText(/beyond last page/)).toBeTruthy();
  fireEvent.click(within(screen.getByTestId('agent-unified-history-pager')).getByRole('button',{name:'Previous'}));
  expect(await screen.findByText('TX-1')).toBeTruthy();
});

test('filters issue page one requests and malformed counterparty data is rejected', async () => {
  const load=jest.fn().mockResolvedValueOnce({items:[item],pagination:{page:1,limit:20,total:1,totalPages:1,hasNextPage:false}}).mockResolvedValueOnce({items:[{...item,counterparty:{ownerType:'CUSTOMER',display:42,identifierMasked:null}}],pagination:{page:1,limit:20,total:1,totalPages:1,hasNextPage:false}});
  render(<AgentUnifiedHistoryPanel agentId="agent" canViewAgent loadTransactions={load} />);
  fireEvent.click(screen.getByRole('button',{name:'Load unified stream'})); await screen.findByText('TX-1');
  fireEvent.change(screen.getByLabelText('Unified history service filter'),{target:{value:'CASH_OUT'}});
  expect(await screen.findByText('Invalid Agent transaction history response.')).toBeTruthy();
  expect(screen.queryByText('TX-1')).toBeNull();
  expect(load).toHaveBeenLastCalledWith('agent',{page:1,limit:20,type:'CASH_OUT'});
});

test('session change hides old stream and ignores late results', async () => {
  const late=deferred<AdminAgentUnifiedHistoryResponse>();const load=jest.fn().mockReturnValue(late.promise);
  render(<AgentUnifiedHistoryPanel agentId="agent" canViewAgent loadTransactions={load} />);
  fireEvent.click(screen.getByRole('button',{name:'Load unified stream'})); act(()=>session('two'));
  await act(async()=>{late.resolve({items:[item],pagination:{page:1,limit:20,total:1,totalPages:1,hasNextPage:false}});await late.promise;});
  expect(screen.queryByText('TX-1')).toBeNull(); expect(screen.getByRole('button',{name:'Load unified stream'})).toBeTruthy();
});
