import React, { act } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AgentBankWithdrawalScreen } from '../src/screens/authenticated/BankWithdrawalScreen';
import { ApiError } from '../src/services/api-client';
import { clearPendingAgentBankWithdrawalIntent, loadPendingAgentBankWithdrawalIntent, savePendingAgentBankWithdrawalIntent } from '../src/services/pending-bank-withdrawal';
import { SecureStorage } from '../src/services/secure-storage';

jest.setTimeout(30000);
jest.mock('../src/services/api-client', () => ({
  ApiClient: { get: jest.fn(), post: jest.fn() },
  ApiError: class extends Error { status: number; constructor(m: string, s: number){ super(m); this.status=s; } }
}));
jest.mock('../src/services/bank-directory', () => ({ BankDirectoryApi: { enquire: jest.fn().mockResolvedValue({ outcome: 'RESOLVED', accountName: 'Test', bankCode: '058', accountNumber: '0123456789' }) } }));
jest.mock('../src/services/bank-withdrawal', () => ({
  AgentBankWithdrawalApi: {
    listBankBeneficiaries: jest.fn().mockResolvedValue([{ id: 'b1', nickname: 'GTB', displayName: 'GTB', bankCode: '058', receivingNumber: '0123456789', isVerified: true, isActive: true }]),
    createBankBeneficiary: jest.fn().mockResolvedValue({ id: 'b1' }),
    initiate: jest.fn(),
  }
}));
jest.mock('../src/services/bank-transfer-pricing', () => ({ AgentBankTransferPricingApi: { preview: jest.fn().mockResolvedValue({ feeMinor: '0', vatMinor: '0', totalDebitMinor: '10000', pricingSource: 'NO_FEE_RULE' }) } }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../src/services/api-client', () => ({ ApiClient: { get: jest.fn().mockResolvedValue([{ id: 'wallet-1' }]) } }), { virtual: true });

async function renderScreen(){ const u=render(<AgentBankWithdrawalScreen />); await act(async()=>{}); return u; }

function mockAgentGets(serverTransactions?: { items: Array<{ type: string; status: string }> }) {
  const { ApiClient } = require('../src/services/api-client');
  const history = serverTransactions ?? { items: [] };
  ApiClient.get.mockImplementation((url: string) => {
    if (url.includes('/agents/me/wallets')) return Promise.resolve([{ id: 'wallet-1' }]);
    if (url.startsWith('/agents/me/transactions')) return Promise.resolve(history);
    return Promise.resolve([]);
  });
}

describe('Agent BankWithdrawal recovery', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearPendingAgentBankWithdrawalIntent('agent');
    await clearPendingAgentBankWithdrawalIntent('other-agent');
    const { AgentBankWithdrawalApi } = require('../src/services/bank-withdrawal');
    if (AgentBankWithdrawalApi.initiate?.mockReset) AgentBankWithdrawalApi.initiate.mockReset();
    if (AgentBankWithdrawalApi.initiate?.mockResolvedValue) AgentBankWithdrawalApi.initiate.mockResolvedValue({ commitmentId: 'c1', operationReference: 'OP1', state: 'RESERVED' });
    mockAgentGets({ items: [] });
  });
  test('if durable persistence fails, block submission', async () => {
    const spy=jest.spyOn(SecureStorage,'setDurable').mockRejectedValueOnce(new Error('disk full'));
    const { getByTestId, getByText } = await renderScreen();
    await waitFor(() => expect(getByTestId('beneficiary-b1')).toBeTruthy());
    fireEvent.press(getByTestId('beneficiary-b1'));
    fireEvent.changeText(getByTestId('bank-amount'), '100');
    fireEvent.changeText(getByTestId('bank-pin'), '1234');
    fireEvent.press(getByTestId('bank-submit'));
    await waitFor(()=> expect(getByText(/Could not save recovery information/i)).toBeTruthy());
    const { AgentBankWithdrawalApi } = require('../src/services/bank-withdrawal');
    expect(AgentBankWithdrawalApi.initiate).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  test('stale intent can be resumed with same key', async () => {
    const staleAt=new Date(Date.now()-25*60*60*1000).toISOString();
    await savePendingAgentBankWithdrawalIntent({ agentId: 'agent', walletAccountId: 'wallet-1', beneficiaryId: 'b1', amountMinor: '10000', currency: 'NGN', idempotencyKey: 'stale-agent-key', createdAt: staleAt });
    const { getByTestId } = await renderScreen();
    await waitFor(()=> expect(getByTestId('stale-recovery-banner')).toBeTruthy());
    fireEvent.press(getByTestId('beneficiary-b1'));
    fireEvent.changeText(getByTestId('bank-amount'), '100');
    fireEvent.changeText(getByTestId('bank-pin'), '1234');
    const { AgentBankWithdrawalApi } = require('../src/services/bank-withdrawal');
    AgentBankWithdrawalApi.initiate.mockResolvedValue({ commitmentId: 'c1', operationReference: 'OP1', state: 'RESERVED', replayed: true });
    fireEvent.press(getByTestId('bank-submit'));
    await waitFor(()=> expect(AgentBankWithdrawalApi.initiate).toHaveBeenCalled());
    expect(AgentBankWithdrawalApi.initiate).toHaveBeenCalledWith(expect.anything(), 'stale-agent-key');
  });
  test('stale banner clear allows new', async () => {
    const staleAt=new Date(Date.now()-25*60*60*1000).toISOString();
    await savePendingAgentBankWithdrawalIntent({ agentId: 'agent', beneficiaryId: 'b1', amountMinor: '10000', currency: 'NGN', idempotencyKey: 'k2', createdAt: staleAt });
    const { getByTestId, queryByTestId } = await renderScreen();
    await waitFor(()=> expect(getByTestId('stale-recovery-banner')).toBeTruthy());
    fireEvent.press(getByTestId('stale-clear'));
    await waitFor(()=> expect(queryByTestId('stale-recovery-banner')).toBeNull());
    expect(await loadPendingAgentBankWithdrawalIntent('agent')).toBeNull();
  });
  test('owner switching isolation', async () => {
    await savePendingAgentBankWithdrawalIntent({ agentId: 'agent', beneficiaryId: 'b1', amountMinor: '10000', currency: 'NGN', idempotencyKey: 'kA', createdAt: new Date().toISOString() });
    expect(await loadPendingAgentBankWithdrawalIntent('agent')).not.toBeNull();
    expect(await loadPendingAgentBankWithdrawalIntent('other-agent')).toBeNull();
  });
  test('Clear blocked when server shows unresolved', async () => {
    const staleAt=new Date(Date.now()-25*60*60*1000).toISOString();
    await savePendingAgentBankWithdrawalIntent({ agentId: 'agent', beneficiaryId: 'b1', amountMinor: '10000', currency: 'NGN', idempotencyKey: 'k-clear-block', createdAt: staleAt });
    mockAgentGets({ items: [{ type: 'EXTERNAL_BANK_TRANSFER', status: 'PENDING' }] });
    const { getByTestId, getByText, queryByTestId } = await renderScreen();
    await waitFor(()=> expect(getByTestId('stale-recovery-banner')).toBeTruthy());
    fireEvent.press(getByTestId('stale-clear'));
    await waitFor(()=> expect(getByText(/still pending confirmation on the server/i)).toBeTruthy());
    expect(queryByTestId('stale-recovery-banner')).toBeTruthy();
    expect(await loadPendingAgentBankWithdrawalIntent('agent')).not.toBeNull();
  });
  test('Different withdrawal blocked when prior unresolved', async () => {
    const staleAt=new Date(Date.now()-25*60*60*1000).toISOString();
    await savePendingAgentBankWithdrawalIntent({ agentId: 'agent', beneficiaryId: 'b1', amountMinor: '10000', currency: 'NGN', idempotencyKey: 'k-block-new', createdAt: staleAt });
    mockAgentGets({ items: [{ type: 'EXTERNAL_BANK_TRANSFER', status: 'PENDING' }] });
    const { getByTestId, getByText } = await renderScreen();
    await waitFor(()=> expect(getByTestId('stale-recovery-banner')).toBeTruthy());
    fireEvent.press(getByTestId('beneficiary-b1'));
    fireEvent.changeText(getByTestId('bank-amount'), '999');
    fireEvent.changeText(getByTestId('bank-pin'), '1234');
    const { AgentBankWithdrawalApi } = require('../src/services/bank-withdrawal');
    AgentBankWithdrawalApi.initiate.mockResolvedValue({ commitmentId: 'c2', operationReference: 'OP2', state: 'RESERVED' });
    fireEvent.press(getByTestId('bank-submit'));
    await waitFor(()=> expect(getByText(/previous withdrawal is still pending/i)).toBeTruthy());
    expect(AgentBankWithdrawalApi.initiate).not.toHaveBeenCalled();
  });
});
