import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { FundingAccountScreen } from '../src/screens/authenticated/FundingAccountScreen';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }));

jest.mock('../src/services/agent-api', () => ({
  getAgentFinancialPosition: jest.fn(),
}));

jest.mock('../src/services/agent-banking', () => ({
  AgentBankingApi: {
    fundingAccount: jest.fn(),
    requestFundingAccount: jest.fn(),
    deposits: jest.fn(),
  },
}));

const agentApi = jest.requireMock('../src/services/agent-api') as {
  getAgentFinancialPosition: jest.Mock;
};
const banking = jest.requireMock('../src/services/agent-banking') as {
  AgentBankingApi: {
    fundingAccount: jest.Mock;
    requestFundingAccount: jest.Mock;
    deposits: jest.Mock;
  };
};

function position(walletId: string | undefined) {
  return {
    agentId: 'agent-1',
    currency: 'NGN',
    balanceMinor: '0',
    availableBalanceMinor: '0',
    walletExists: !!walletId,
    ...(walletId ? { walletId } : {}),
  };
}

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FundingAccountScreen />
    </QueryClientProvider>,
  );
}

/**
 * Agent funding account.
 *
 * The assertions are about what the screen refuses to say. An agent who reads a fabricated account
 * number sends float to a stranger; an agent who reads 'credited' before the float is posted concludes
 * the platform took their money. Both are worse than showing nothing.
 */
describe('FundingAccountScreen — float arrives only into a real, bound account', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    banking.AgentBankingApi.deposits.mockResolvedValue([]);
  });

  test('shows no account and offers a request when none has been issued', async () => {
    agentApi.getAgentFinancialPosition.mockResolvedValue(position('wallet-1'));
    banking.AgentBankingApi.fundingAccount.mockResolvedValue({
      state: 'NOT_PROVISIONED',
      accountNumber: null,
      bankName: null,
      accountName: null,
      agentId: 'agent-1',
      institutionId: 'inst-1',
      walletId: 'wallet-1',
      providerKey: 'monnify',
      currency: 'NGN',
      purpose: 'AGENT_FLOAT_FUNDING',
    });

    const { getByText } = renderScreen();
    await waitFor(() => expect(getByText('Get my funding account')).toBeTruthy());
    // The wallet id is resolved from the financial position, not guessed.
    expect(banking.AgentBankingApi.fundingAccount).toHaveBeenCalledWith('wallet-1');
  });

  test('shows the real account number once the bank issued one', async () => {
    agentApi.getAgentFinancialPosition.mockResolvedValue(position('wallet-1'));
    banking.AgentBankingApi.fundingAccount.mockResolvedValue({
      state: 'PROVISIONED',
      accountNumber: '9012345678',
      bankName: 'Wema Bank',
      accountName: 'MONIENAija / agent-1',
      agentId: 'agent-1',
      institutionId: 'inst-1',
      walletId: 'wallet-1',
      providerKey: 'monnify',
      currency: 'NGN',
      purpose: 'AGENT_FLOAT_FUNDING',
    });

    const { getByText } = renderScreen();
    await waitFor(() => expect(getByText('9012345678')).toBeTruthy());
    expect(getByText('Wema Bank')).toBeTruthy();
    expect(getByText(/never ask you to send float to a different account/)).toBeTruthy();
  });

  test('forbids a second request while the first is unconfirmed', async () => {
    agentApi.getAgentFinancialPosition.mockResolvedValue(position('wallet-1'));
    banking.AgentBankingApi.fundingAccount.mockResolvedValue({
      state: 'UNKNOWN',
      accountNumber: null,
      bankName: null,
      accountName: null,
      agentId: 'agent-1',
      institutionId: 'inst-1',
      walletId: 'wallet-1',
      providerKey: 'monnify',
      currency: 'NGN',
      purpose: 'AGENT_FLOAT_FUNDING',
    });

    const { getByText, queryByText } = renderScreen();
    await waitFor(() => expect(getByText('Still confirming your account')).toBeTruthy());
    expect(getByText(/Do not request another account/)).toBeTruthy();
    // No control that would create a second real account.
    expect(queryByText('Get my funding account')).toBeNull();
  });

  test('reports received float as pending credit until it is actually posted', async () => {
    agentApi.getAgentFinancialPosition.mockResolvedValue(position('wallet-1'));
    banking.AgentBankingApi.fundingAccount.mockResolvedValue({
      state: 'PROVISIONED',
      accountNumber: '9012345678',
      bankName: 'Wema Bank',
      accountName: 'MONIENAija',
      agentId: 'agent-1',
      institutionId: 'inst-1',
      walletId: 'wallet-1',
      providerKey: 'monnify',
      currency: 'NGN',
      purpose: 'AGENT_FLOAT_FUNDING',
    });
    banking.AgentBankingApi.deposits.mockResolvedValue([
      {
        id: 'd1',
        reference: 'prov-1',
        amountMinor: '500000',
        currency: 'NGN',
        receivedAt: new Date().toISOString(),
        state: 'VERIFIED_AWAITING_FLOAT_CREDIT',
      },
    ]);

    const { getByText, queryByText } = renderScreen();
    await waitFor(() => expect(getByText('Received — credit pending')).toBeTruthy());
    // The distinction that prevents a support escalation: not yet credited.
    expect(queryByText('Credited to float')).toBeNull();
  });

  test('explains a float wallet that does not exist instead of offering to fund nothing', async () => {
    agentApi.getAgentFinancialPosition.mockResolvedValue(position(undefined));
    const { getByText } = renderScreen();
    await waitFor(() => expect(getByText('No agent wallet yet')).toBeTruthy());
    // With no wallet there is nothing to ask the server about.
    expect(banking.AgentBankingApi.fundingAccount).not.toHaveBeenCalled();
  });

  test('a failed read does not claim anything changed on the float', async () => {
    agentApi.getAgentFinancialPosition.mockResolvedValue(position('wallet-1'));
    banking.AgentBankingApi.fundingAccount.mockRejectedValue(new Error('network'));
    const { getByText } = renderScreen();
    await waitFor(() => expect(getByText('Funding details unavailable')).toBeTruthy());
    expect(getByText(/float balance and existing\s+transactions are unaffected/)).toBeTruthy();
  });

  test('warns against a duplicate when a request comes back unconfirmed', async () => {
    agentApi.getAgentFinancialPosition.mockResolvedValue(position('wallet-1'));
    banking.AgentBankingApi.fundingAccount.mockResolvedValue({
      state: 'NOT_PROVISIONED',
      accountNumber: null,
      bankName: null,
      accountName: null,
      agentId: 'agent-1',
      institutionId: 'inst-1',
      walletId: 'wallet-1',
      providerKey: 'monnify',
      currency: 'NGN',
      purpose: 'AGENT_FLOAT_FUNDING',
    });
    banking.AgentBankingApi.requestFundingAccount.mockResolvedValue({
      state: 'UNKNOWN',
      accountNumber: null,
      bankName: null,
      accountName: null,
      agentId: 'agent-1',
      institutionId: 'inst-1',
      walletId: 'wallet-1',
      providerKey: 'monnify',
      currency: 'NGN',
      purpose: 'AGENT_FLOAT_FUNDING',
    });

    const { getByText } = renderScreen();
    await waitFor(() => expect(getByText('Get my funding account')).toBeTruthy());
    fireEvent.press(getByText('Get my funding account'));
    await waitFor(() =>
      expect(getByText(/Do not request another — it may create a duplicate account/)).toBeTruthy(),
    );
  });
});
