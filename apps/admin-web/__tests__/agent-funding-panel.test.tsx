import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
import { AgentFundingPanel } from '../src/screens/authenticated/AgentFundingPanel';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const REQUEST_ID = 'request-1';
const APPROVAL_ID = 'approval-1';
const IDEMPOTENCY_KEY = 'funding-idempotency-1';
const JOURNAL_ID = 'journal-1';

function fundingRequest(approvalStatus: string, status = 'PENDING') {
  return {
    id: REQUEST_ID,
    approvalId: APPROVAL_ID,
    direction: 'FUND',
    agentId: 'agent-1',
    aggregatorId: null,
    amountMinor: '12500',
    currency: 'NGN',
    idempotencyKey: IDEMPOTENCY_KEY,
    reference: 'FUND-001',
    requestHash: 'request-hash',
    approvalFingerprint: 'approval-fingerprint',
    status,
    approvalStatus,
    approvalExpiresAt: '2026-10-26T10:00:00.000Z',
    approvalApprovedBy: ['APPROVED', 'CONSUMED'].includes(approvalStatus) ? 'checker-1' : null,
    reason: 'Liquidity allocation',
    actionType: 'AGENT_FUND',
    requesterPrincipalId: 'maker-1',
    checkerPrincipalId: ['APPROVED', 'CONSUMED'].includes(approvalStatus) ? 'checker-1' : null,
    journalId: approvalStatus === 'CONSUMED' ? JOURNAL_ID : null,
    policy: { requestDetails: { reason: 'Liquidity allocation' } },
  };
}

function setPrincipal(role: 'AGENT_NETWORK_MANAGER' | 'FINANCE_CONTROLLER', principalId: string, scopes: string[]) {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'test-token',
    sessionId: 'test-session',
    principal: {
      type: 'OPERATOR',
      principalId,
      sessionId: 'test-session',
      audience: 'workforce-admin',
      roles: [role],
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
}

describe('Agent funding maker-checker panel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (ApiClient.get as jest.Mock).mockResolvedValue([]);
    (ApiClient.post as jest.Mock).mockResolvedValue({});
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      value: () => IDEMPOTENCY_KEY,
    });
  });

  test('maker persists an idempotency key before requesting independent approval', async () => {
    setPrincipal('AGENT_NETWORK_MANAGER', 'maker-1', ['agent.fund', 'agent.defund']);
    (ApiClient.post as jest.Mock).mockResolvedValue(fundingRequest('REQUESTED'));
    const view = render(<AgentFundingPanel agentId="agent-1" />);

    fireEvent.change(view.getByLabelText('Funding amount in kobo'), { target: { value: '12500' } });
    fireEvent.change(view.getByLabelText('Funding reason'), { target: { value: 'Liquidity allocation' } });
    fireEvent.click(view.getByRole('button', { name: 'Request independent approval' }));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/internal/agents/agent-1/fund-request', {
        amountMinor: '12500',
        currency: 'NGN',
        idempotencyKey: IDEMPOTENCY_KEY,
        reason: 'Liquidity allocation',
      });
      expect(view.getByRole('status').textContent).toContain('Await an independent checker');
    });
    const saved = JSON.parse(localStorage.getItem('monienaija.agent-funding.v1:maker-1:agent-1') ?? 'null');
    expect(saved.idempotencyKey).toBe(IDEMPOTENCY_KEY);
    expect(saved.amountMinor).toBe('12500');
  });

  test('checker requires a review, executes only the approved request, and recovers the same journal after uncertainty', async () => {
    setPrincipal('FINANCE_CONTROLLER', 'checker-1', ['agent.fund']);
    (ApiClient.get as jest.Mock)
      .mockResolvedValueOnce([fundingRequest('REQUESTED')])
      .mockResolvedValueOnce([fundingRequest('APPROVED')])
      .mockResolvedValueOnce([fundingRequest('CONSUMED', 'EXECUTED')])
      .mockResolvedValueOnce([fundingRequest('CONSUMED', 'EXECUTED')]);
    let executionCount = 0;
    (ApiClient.post as jest.Mock).mockImplementation((path: string) => {
      if (path.endsWith('/approve')) return Promise.resolve({ approved: true, reason: 'APPROVED', approval: {id: APPROVAL_ID, status:'APPROVED'} });
      if (path.endsWith('/execute')) {
        executionCount += 1;
        return Promise.resolve({ status: executionCount === 1 ? 'COMPLETED' : 'REPLAYED', journalId: JOURNAL_ID, agentId:'agent-1', amountMinor:'12500', currency:'NGN', idempotencyKey:IDEMPOTENCY_KEY, requestHash:'request-hash' });
      }
      return Promise.resolve({});
    });

    const view = render(<AgentFundingPanel agentId="agent-1" />);
    fireEvent.click(view.getByRole('button', { name: 'Load funding instructions' }));
    const pendingRow = await view.findByRole('button', { name: new RegExp(`${REQUEST_ID}.*REQUESTED`) });
    fireEvent.click(pendingRow);
    await view.findByText('Business reason: Liquidity allocation');
    const review = view.getByLabelText('I reviewed this Agent, amount, direction and business reason');
    expect((view.getByRole('button', { name: 'Approve funding instruction' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(review);
    fireEvent.click(view.getByRole('button', { name: 'Approve funding instruction' }));

    await waitFor(() => expect(ApiClient.post).toHaveBeenCalledWith(
      `/internal/a2/workforce/approvals/${APPROVAL_ID}/approve`,
      { comment: 'Reviewed Agent, amount, direction and business reason in funding workflow' },
    ));
    await view.findByRole('button', { name: 'Execute approved instruction' });
    fireEvent.click(view.getByLabelText('I reviewed this Agent, amount, direction and business reason'));
    fireEvent.click(view.getByRole('button', { name: 'Execute approved instruction' }));

    await waitFor(() => expect(ApiClient.post).toHaveBeenCalledWith(
      `/internal/agents/funding-requests/${REQUEST_ID}/execute`,
      {},
    ));
    await view.findByRole('button', { name: 'Recover posted result' });
    expect(view.getByText(`Journal reference: ${JOURNAL_ID}`)).toBeTruthy();
    const recoveryReview = view.getByLabelText('I reviewed this Agent, amount, direction and business reason');
    await waitFor(() => expect((recoveryReview as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(recoveryReview);
    await waitFor(() =>
      expect((view.getByRole('button', { name: 'Recover posted result' }) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(view.getByRole('button', { name: 'Recover posted result' }));

    await waitFor(() => {
      expect(executionCount).toBe(2);
      expect(view.getByRole('status').textContent).toContain(`REPLAYED: journal ${JOURNAL_ID}`);
    });
  });

  test('checker rejects through the atomic funding-request route with a required reason', async () => {
    setPrincipal('FINANCE_CONTROLLER', 'checker-2', ['agent.fund']);
    const rejected = fundingRequest('REJECTED', 'REJECTED');
    (ApiClient.get as jest.Mock)
      .mockResolvedValueOnce([fundingRequest('REQUESTED')])
      .mockResolvedValueOnce([rejected]);
    (ApiClient.post as jest.Mock).mockImplementation((path: string) =>
      path === `/internal/agents/funding-requests/${REQUEST_ID}/reject`
        ? Promise.resolve(rejected)
        : Promise.resolve({}),
    );

    const view = render(<AgentFundingPanel agentId="agent-1" />);
    fireEvent.click(view.getByRole('button', { name: 'Load funding instructions' }));
    fireEvent.click(await view.findByRole('button', { name: new RegExp(`${REQUEST_ID}.*REQUESTED`) }));
    fireEvent.click(view.getByLabelText('I reviewed this Agent, amount, direction and business reason'));

    const reject = view.getByRole('button', { name: 'Reject funding instruction' }) as HTMLButtonElement;
    expect(reject.disabled).toBe(true);
    fireEvent.change(view.getByLabelText('Funding rejection reason'), {
      target: { value: 'Duplicate funding instruction' },
    });
    fireEvent.click(reject);

    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(
        `/internal/agents/funding-requests/${REQUEST_ID}/reject`,
        { reason: 'Duplicate funding instruction' },
      ),
    );
    expect(ApiClient.post).not.toHaveBeenCalledWith(
      `/internal/a2/workforce/approvals/${APPROVAL_ID}/reject`,
      expect.anything(),
    );
    await waitFor(() => expect(view.getByRole('status').textContent).toContain('Decision confirmed: REJECTED'));
  });

  test('non-entitled roles and non-MFA sessions do not see funding actions', () => {
    setPrincipal('FINANCE_CONTROLLER', 'checker-2', ['ledger.view']);
    const denied = render(<AgentFundingPanel agentId="agent-1" />);
    expect(denied.queryByLabelText('Agent funding workflow')).toBeNull();
    denied.unmount();

    setPrincipal('FINANCE_CONTROLLER', 'checker-1', ['agent.fund']);
    useAuthStore.setState((state) => ({ ...state, principal: state.principal ? { ...state.principal, assuranceLevel: 'PASSWORD' } : null }));
    const noMfa = render(<AgentFundingPanel agentId="agent-1" />);
    expect(noMfa.getByRole('alert').textContent).toMatch(/MFA/i);
    expect((noMfa.getByRole('button', { name: 'Load funding instructions' }) as HTMLButtonElement).disabled).toBe(true);
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('blocks self-approval when checker matches maker and handles EXPIRED approval status cleanly', async () => {
    // Same principalId as requesterPrincipalId ('maker-1') -> self-approval blocked
    setPrincipal('FINANCE_CONTROLLER', 'maker-1', ['agent.fund']);
    (ApiClient.get as jest.Mock).mockResolvedValueOnce([fundingRequest('REQUESTED')]);

    const selfCheck = render(<AgentFundingPanel agentId="agent-1" />);
    fireEvent.click(selfCheck.getByRole('button', { name: 'Load funding instructions' }));
    fireEvent.click(await selfCheck.findByRole('button', { name: new RegExp(`${REQUEST_ID}.*REQUESTED`) }));
    expect(await selfCheck.findByText(/Self-approval blocked/i)).toBeTruthy();
    expect(selfCheck.queryByRole('button', { name: 'Approve funding instruction' })).toBeNull();
    selfCheck.unmount();

    // EXPIRED approval -> cannot approve or execute, surfaces expiry notice
    setPrincipal('FINANCE_CONTROLLER', 'checker-2', ['agent.fund']);
    (ApiClient.get as jest.Mock).mockResolvedValueOnce([fundingRequest('EXPIRED', 'PENDING')]);
    const expiredView = render(<AgentFundingPanel agentId="agent-1" />);
    fireEvent.click(expiredView.getByRole('button', { name: 'Load funding instructions' }));
    fireEvent.click(await expiredView.findByRole('button', { name: new RegExp(`${REQUEST_ID}.*EXPIRED`) }));
    expect(await expiredView.findByText(/Approval window expired/i)).toBeTruthy();
    expect(expiredView.queryByRole('button', { name: 'Approve funding instruction' })).toBeNull();
    expect(expiredView.queryByRole('button', { name: 'Execute approved instruction' })).toBeNull();
  });

  test('malformed or wrong-Agent rows do not expose checker actions', async () => {
    setPrincipal('FINANCE_CONTROLLER', 'checker-1', ['agent.fund']);
    (ApiClient.get as jest.Mock).mockResolvedValue([{...fundingRequest('REQUESTED'), agentId:'other-agent'}]);
    const view=render(<AgentFundingPanel agentId="agent-1" />);
    fireEvent.click(view.getByRole('button',{name:'Load funding instructions'}));
    expect(await view.findByText(/Invalid funding instruction response/)).toBeTruthy();
    expect(view.queryByRole('button',{name:'Approve funding instruction'})).toBeNull();
  });

  test('a handoff never silently selects a different request', async () => {
    setPrincipal('FINANCE_CONTROLLER', 'checker-1', ['agent.fund']);
    (ApiClient.get as jest.Mock).mockResolvedValue([fundingRequest('REQUESTED')]);
    const view=render(<AgentFundingPanel selectedInboxTarget={{agentId:'agent-1',requestId:'missing-request',revision:1}} />);
    expect(await view.findByText(/selected instruction was not returned/)).toBeTruthy();
    expect(view.queryByRole('button',{name:'Approve funding instruction'})).toBeNull();
  });

  test('checker does not confirm an approval for a different approval ID', async () => {
    setPrincipal('FINANCE_CONTROLLER', 'checker-1', ['agent.fund']);
    (ApiClient.get as jest.Mock).mockResolvedValue([fundingRequest('REQUESTED')]);
    (ApiClient.post as jest.Mock).mockResolvedValue({approved:true,reason:'APPROVED',approval:{id:'other',status:'APPROVED'}});
    const outcome=jest.fn();const view=render(<AgentFundingPanel agentId="agent-1" onCheckerOutcome={outcome}/>);
    fireEvent.click(view.getByRole('button',{name:'Load funding instructions'}));
    fireEvent.click(await view.findByLabelText('I reviewed this Agent, amount, direction and business reason'));
    fireEvent.click(view.getByRole('button',{name:'Approve funding instruction'}));
    expect(await view.findByText(/Outcome may be uncertain/)).toBeTruthy();
    expect(view.queryByText(/Decision confirmed/)).toBeNull();expect(outcome).not.toHaveBeenCalled();
  });

  test('confirmed posting stays confirmed when subsequent refresh fails', async () => {
    setPrincipal('FINANCE_CONTROLLER', 'checker-1', ['agent.fund']);
    (ApiClient.get as jest.Mock).mockResolvedValueOnce([fundingRequest('APPROVED')]).mockRejectedValueOnce(new Error('offline'));
    (ApiClient.post as jest.Mock).mockResolvedValue({status:'COMPLETED',journalId:JOURNAL_ID,agentId:'agent-1',amountMinor:'12500',currency:'NGN',idempotencyKey:IDEMPOTENCY_KEY,requestHash:'request-hash'});
    const outcome=jest.fn();const view=render(<AgentFundingPanel agentId="agent-1" onCheckerOutcome={outcome}/>);
    fireEvent.click(view.getByRole('button',{name:'Load funding instructions'}));fireEvent.click(await view.findByLabelText('I reviewed this Agent, amount, direction and business reason'));fireEvent.click(view.getByRole('button',{name:'Execute approved instruction'}));
    expect(await view.findByText(/Posting confirmed.*Refresh failed/)).toBeTruthy();expect(outcome).toHaveBeenCalledWith({action:'EXECUTED',requestId:REQUEST_ID,agentId:'agent-1'});expect(view.queryByRole('button',{name:'Execute approved instruction'})).toBeNull();
  });

  test('retained DEFUND instruction can be retried after remount without changing its recovery key', async () => {
    setPrincipal('AGENT_NETWORK_MANAGER', 'maker-1', ['agent.defund']);
    localStorage.setItem('monienaija.agent-funding.v1:maker-1:agent-1', JSON.stringify({agentId:'agent-1', direction:'DEFUND', amountMinor:'12500', currency:'NGN', idempotencyKey:IDEMPOTENCY_KEY,reason:'Liquidity allocation'}));
    (ApiClient.post as jest.Mock).mockResolvedValue({...fundingRequest('REQUESTED'),direction:'DEFUND'});
    const view=render(<AgentFundingPanel agentId="agent-1" />);
    fireEvent.click(view.getByRole('button',{name:'Retry original approval request'}));
    await waitFor(()=>expect(ApiClient.post).toHaveBeenCalledWith('/internal/agents/agent-1/defund-request',expect.objectContaining({idempotencyKey:IDEMPOTENCY_KEY,amountMinor:'12500'})));
    expect(await view.findByText(/Await an independent checker/)).toBeTruthy();
  });

  test('unreadable retained recovery data prevents creating a replacement instruction', () => {
    setPrincipal('AGENT_NETWORK_MANAGER', 'maker-1', ['agent.fund']);
    localStorage.setItem('monienaija.agent-funding.v1:maker-1:agent-1','{invalid');
    const view=render(<AgentFundingPanel agentId="agent-1" />);
    expect(view.getByText(/Recovery storage is unreadable/)).toBeTruthy();
    expect((view.getByRole('button',{name:'Request independent approval'}) as HTMLButtonElement).disabled).toBe(true);
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('a late request result cannot cross a session change', async () => {
    setPrincipal('FINANCE_CONTROLLER', 'checker-1', ['agent.fund']);let resolve!: (rows:any)=>void;
    const pending=new Promise<any>(r=>resolve=r);(ApiClient.get as jest.Mock).mockReturnValue(pending);
    const view=render(<AgentFundingPanel agentId="agent-1" />);fireEvent.click(view.getByRole('button',{name:'Load funding instructions'}));
    act(()=>useAuthStore.setState(state=>({principal:{...state.principal!,sessionId:'new-session'}})));
    await act(async()=>{resolve([fundingRequest('REQUESTED')]);await pending;});
    expect(view.queryByRole('button',{name:new RegExp(`${REQUEST_ID}.*REQUESTED`)})).toBeNull();
  });


  test('a mismatched posting receipt is not confirmed and does not refresh the inbox', async () => {
    setPrincipal('FINANCE_CONTROLLER', 'checker-1', ['agent.fund']);(ApiClient.get as jest.Mock).mockResolvedValue([fundingRequest('APPROVED')]);
    (ApiClient.post as jest.Mock).mockResolvedValue({status:'COMPLETED',journalId:JOURNAL_ID,agentId:'agent-1',amountMinor:'999',currency:'NGN',idempotencyKey:IDEMPOTENCY_KEY,requestHash:'request-hash'});
    const outcome=jest.fn();const view=render(<AgentFundingPanel agentId="agent-1" onCheckerOutcome={outcome}/>);
    fireEvent.click(view.getByRole('button',{name:'Load funding instructions'}));fireEvent.click(await view.findByLabelText('I reviewed this Agent, amount, direction and business reason'));fireEvent.click(view.getByRole('button',{name:'Execute approved instruction'}));
    expect(await view.findByText(/Posting is not confirmed/)).toBeTruthy();expect(view.queryByText(/Posting confirmed/)).toBeNull();expect(outcome).not.toHaveBeenCalled();
  });

  test('a mismatched maker receipt retains the original recovery key rather than claiming success', async () => {
    setPrincipal('AGENT_NETWORK_MANAGER','maker-1',['agent.fund']);(ApiClient.post as jest.Mock).mockResolvedValue({...fundingRequest('REQUESTED'),amountMinor:'999'});
    const view=render(<AgentFundingPanel agentId="agent-1"/>);fireEvent.change(view.getByLabelText('Funding amount in kobo'),{target:{value:'12500'}});fireEvent.change(view.getByLabelText('Funding reason'),{target:{value:'Liquidity allocation'}});fireEvent.click(view.getByRole('button',{name:'Request independent approval'}));
    expect(await view.findByText(/Funding request receipt is not confirmed/)).toBeTruthy();expect(view.queryByText(/Await an independent checker/)).toBeNull();expect(JSON.parse(localStorage.getItem('monienaija.agent-funding.v1:maker-1:agent-1')!).idempotencyKey).toBe(IDEMPOTENCY_KEY);
  });


test('read-only checker can load instructions but cannot decide or execute', async () => {
 setPrincipal('FINANCE_CONTROLLER','checker-2',['agent.fund']);
 useAuthStore.setState(state=>({principal:{...state.principal!,readOnlyPrincipal:true}}));
 (ApiClient.get as jest.Mock).mockResolvedValue([fundingRequest('REQUESTED')]);
 const view=render(<AgentFundingPanel agentId="agent-1" />);
 fireEvent.click(view.getByRole('button',{name:'Load funding instructions'}));
 fireEvent.click(await view.findByRole('button',{name:new RegExp(`${REQUEST_ID}.*REQUESTED`)}));
 fireEvent.click(view.getByLabelText('I reviewed this Agent, amount, direction and business reason'));
 expect(view.queryByRole('button',{name:'Approve funding instruction'})).toBeNull();
 expect(view.queryByRole('button',{name:'Reject funding instruction'})).toBeNull();
 expect(ApiClient.post).not.toHaveBeenCalled();
});

test('unconfirmed funding decision requires a fresh instruction load and new review',async()=>{
 setPrincipal('FINANCE_CONTROLLER','checker-2',['agent.fund']);
 (ApiClient.get as jest.Mock).mockResolvedValue([fundingRequest('REQUESTED')]);
 (ApiClient.post as jest.Mock).mockRejectedValue(new Error('network lost'));
 const view=render(<AgentFundingPanel agentId="agent-1" />);
 fireEvent.click(view.getByRole('button',{name:'Load funding instructions'}));fireEvent.click(await view.findByRole('button',{name:new RegExp(`${REQUEST_ID}.*REQUESTED`)}));
 fireEvent.click(view.getByLabelText('I reviewed this Agent, amount, direction and business reason'));fireEvent.click(view.getByRole('button',{name:'Approve funding instruction'}));
 expect(await view.findByText(/Outcome may be uncertain/)).toBeTruthy();expect(view.queryByRole('button',{name:'Approve funding instruction'})).toBeNull();
 fireEvent.click(view.getByRole('button',{name:'Load funding instructions'}));fireEvent.click(await view.findByRole('button',{name:new RegExp(`${REQUEST_ID}.*REQUESTED`)}));
 expect((view.getByRole('button',{name:'Approve funding instruction'}) as HTMLButtonElement).disabled).toBe(true);expect(ApiClient.post).toHaveBeenCalledTimes(1);
});

test('read-only maker cannot submit a funding request',()=>{
 setPrincipal('AGENT_NETWORK_MANAGER','maker-1',['agent.fund']);useAuthStore.setState(state=>({principal:{...state.principal!,readOnlyPrincipal:true}}));
 const view=render(<AgentFundingPanel agentId="agent-1" />);fireEvent.change(view.getByLabelText('Funding amount in kobo'),{target:{value:'100'}});fireEvent.change(view.getByLabelText('Funding reason'),{target:{value:'review'}});
 expect((view.getByRole('button',{name:'Request independent approval'}) as HTMLButtonElement).disabled).toBe(true);expect(ApiClient.post).not.toHaveBeenCalled();
});

});
