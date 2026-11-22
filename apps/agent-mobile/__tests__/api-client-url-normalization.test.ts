/**
 * Agent Mobile API URL normalization against the backend global prefix `api/v1`.
 *
 * Regression lock for the external-bank-transfer journey: the banking services
 * (`bank-withdrawal.ts`, `bank-directory.ts`, `bank-transfer-pricing.ts`) and the inline
 * BankWithdrawalScreen status lookup pass bare `/agents/me/...` endpoints, while the rest of
 * the app spells `api/v1/...` explicitly. Against a real backend (NestJS
 * `app.setGlobalPrefix('api/v1')`) every bare call used to 404 — the withdrawal journey was
 * unreachable end-to-end even though each side passed its own mocked tests.
 *
 * `resolveAgentApiUrl` mirrors the established `resolveCustomerApiUrl` convention from
 * apps/customer-mobile: bare endpoints gain the prefix; `api/v1`-prefixed endpoints and
 * pre-prefixed base URLs never double-prefix.
 */
import { ApiClient, resolveAgentApiUrl, setBaseUrl } from '../src/services/api-client';
import { AgentBankWithdrawalApi } from '../src/services/bank-withdrawal';
import { BankDirectoryApi } from '../src/services/bank-directory';
import { AgentBankTransferPricingApi } from '../src/services/bank-transfer-pricing';
import { AgentBankingApi } from '../src/services/agent-banking';

describe('resolveAgentApiUrl', () => {
  test('bare endpoints gain the api/v1 global prefix', () => {
    expect(resolveAgentApiUrl('https://api.example.com', '/agents/me/banking/banks')).toBe(
      'https://api.example.com/api/v1/agents/me/banking/banks',
    );
    expect(resolveAgentApiUrl('http://10.0.2.2:3000', 'agents/me/banking/beneficiaries')).toBe(
      'http://10.0.2.2:3000/api/v1/agents/me/banking/beneficiaries',
    );
  });

  test('explicit api/v1 endpoints are never double-prefixed', () => {
    expect(resolveAgentApiUrl('https://api.example.com', 'api/v1/agents/me')).toBe(
      'https://api.example.com/api/v1/agents/me',
    );
    expect(resolveAgentApiUrl('https://api.example.com', '/api/v1/agents/cash-in')).toBe(
      'https://api.example.com/api/v1/agents/cash-in',
    );
  });

  test('a pre-prefixed base URL is honored exactly once', () => {
    expect(resolveAgentApiUrl('https://api.example.com/api/v1', '/agents/me/banking/banks')).toBe(
      'https://api.example.com/api/v1/agents/me/banking/banks',
    );
    expect(
      resolveAgentApiUrl('https://api.example.com/api/v1/', 'api/v1/agents/me/profile'),
    ).toBe('https://api.example.com/api/v1/agents/me/profile');
    expect(resolveAgentApiUrl('https://api.example.com/api/v1', 'api/v1')).toBe(
      'https://api.example.com/api/v1',
    );
  });

  test('query strings survive normalization', () => {
    expect(
      resolveAgentApiUrl('https://api.example.com', '/agents/me/banking/banks?search=bank'),
    ).toBe('https://api.example.com/api/v1/agents/me/banking/banks?search=bank');
  });
});

describe('banking services reach real backend routes through the shared client', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ items: [] }),
      text: async () => '{"items":[]}',
    });
    global.fetch = fetchMock as never;
    setBaseUrl('https://api.example.com');
  });

  const requestedUrls = (): string[] => fetchMock.mock.calls.map((call) => call[0] as string);

  test('every agent banking call targets an /api/v1/agents/me/banking route', async () => {
    await AgentBankWithdrawalApi.listBankBeneficiaries();
    await AgentBankWithdrawalApi.createBankBeneficiary({
      bankCode: 'BANKA',
      accountNumber: '1234567890',
    });
    await BankDirectoryApi.list();
    await BankDirectoryApi.enquire({ bankCode: 'BANKA', accountNumber: '1234567890' });
    await AgentBankTransferPricingApi.preview({
      beneficiaryId: 'b1',
      amountMinor: '1000',
    });
    await AgentBankingApi.fundingAccount('w1');

    const urls = requestedUrls();
    expect(urls).toHaveLength(6);
    for (const url of urls) {
      expect(url.startsWith('https://api.example.com/api/v1/agents/me/banking/')).toBe(true);
      expect(url).not.toContain('/api/v1/api/v1/');
    }
    expect(urls[0]).toBe('https://api.example.com/api/v1/agents/me/banking/beneficiaries');
    expect(urls[1]).toBe(
      'https://api.example.com/api/v1/agents/me/banking/beneficiaries/bank-accounts',
    );
    expect(urls[4]).toContain(
      'https://api.example.com/api/v1/agents/me/banking/bank-transfer-preview?',
    );
  });

  test('the transfer initiation posts to the commitment route with its idempotency key', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      headers: { get: () => 'application/json' },
      json: async () => ({
        commitmentId: 'c1',
        withdrawalId: 'w1',
        externalOperationId: 'e1',
        state: 'RESERVED',
        replayed: false,
        operationReference: null,
      }),
      text: async () => '{}',
    });
    await AgentBankWithdrawalApi.initiate(
      { beneficiaryId: 'b1', amountMinor: '500', pin: '1234' },
      'agent-bank-key-1',
    );
    const [url, config] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/api/v1/agents/me/banking/bank-transfers');
    expect((config.headers as Record<string, string>)['idempotency-key']).toBe('agent-bank-key-1');
    expect(config.method).toBe('POST');
  });

  test('explicit api/v1 services keep working unchanged through the same client', async () => {
    await ApiClient.get('api/v1/agents/me/profile');
    expect(requestedUrls()[0]).toBe('https://api.example.com/api/v1/agents/me/profile');
  });
});
