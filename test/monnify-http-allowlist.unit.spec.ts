/**
 * The path allowlist is a security control, so it is tested by attempted escape rather than by
 * confirming that a few good paths pass.
 */
import {
  basicAuthorization,
  createMonnifyHttpClient,
  isAllowedMonnifyPath,
} from '../src/banking/monnify/monnify.http';

describe('Monnify path allowlist', () => {
  it('allows the documented endpoints', () => {
    const allowed = [
      '/api/v1/auth/login',
      '/api/v1/sdk/transactions/banks',
      '/api/v1/banks',
      '/api/v2/bank-transfer/reserved-accounts',
      '/api/v2/disbursements/single',
      '/api/v2/disbursements/single/validate-otp',
      '/api/v1/settlements',
      '/api/v1/disbursements/account/validate?accountNumber=0123456789&bankCode=058',
      '/api/v2/bank-transfer/reserved-accounts/ACC-REF-1',
      '/api/v1/refunds/initiate-refund',
      '/api/v1/refunds/RF-2W-TEST-0001',
    ];
    for (const path of allowed) {
      expect(isAllowedMonnifyPath(path)).toBe(true);
    }
  });

  it('refuses an undocumented endpoint', () => {
    expect(isAllowedMonnifyPath('/api/v1/anything/else')).toBe(false);
    expect(isAllowedMonnifyPath('/api/v2/disbursements/bulk')).toBe(false);
  });

  it('refuses a traversal attempt even under an allowed prefix', () => {
    expect(isAllowedMonnifyPath('/api/v2/bank-transfer/reserved-accounts/../../admin')).toBe(false);
    expect(isAllowedMonnifyPath('/api/v2/bank-transfer/reserved-accounts/a b')).toBe(false);
    expect(isAllowedMonnifyPath('/api/v2/bank-transfer/reserved-accounts/a\\b')).toBe(false);
  });

  it('refuses a query string on an endpoint not documented to take one', () => {
    expect(isAllowedMonnifyPath('/api/v2/bank-transfer/reserved-accounts?x=1')).toBe(false);
    expect(isAllowedMonnifyPath('/api/v1/banks?evil=1')).toBe(false);
  });

  it('refuses a lookalike prefix that is not the documented path', () => {
    // Must not match merely because it starts with a documented string.
    expect(isAllowedMonnifyPath('/api/v1/disbursements/account/validateX')).toBe(false);
  });
});

describe('Monnify transport hardening', () => {
  it('refuses a forbidden outbound address instead of connecting', async () => {
    const client = createMonnifyHttpClient({
      environment: 'sandbox',
      // 169.254.169.254 is the cloud metadata endpoint: the classic SSRF target.
      lookup: () => Promise.resolve([{ address: '169.254.169.254', family: 4 }]),
      request: () => {
        throw new Error('must not be called');
      },
    });
    await expect(
      client.send(
        { method: 'GET', path: '/api/v1/banks', authorization: 'Bearer x' },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/blocked/i);
  });

  it('refuses an already-aborted request before resolving DNS', async () => {
    let looked = 0;
    const client = createMonnifyHttpClient({
      environment: 'sandbox',
      lookup: () => {
        looked += 1;
        return Promise.resolve([{ address: '93.184.216.34', family: 4 }]);
      },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.send(
        { method: 'GET', path: '/api/v1/banks', authorization: 'Bearer x' },
        controller.signal,
      ),
    ).rejects.toThrow(/blocked/i);
    expect(looked).toBe(0);
  });

  it('refuses a path outside the allowlist before any network activity', async () => {
    let looked = 0;
    const client = createMonnifyHttpClient({
      environment: 'sandbox',
      lookup: () => {
        looked += 1;
        return Promise.resolve([{ address: '93.184.216.34', family: 4 }]);
      },
    });
    await expect(
      client.send(
        { method: 'GET', path: '/api/v1/not-documented', authorization: 'Bearer x' },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/blocked/i);
    expect(looked).toBe(0);
  });
});

describe('Monnify credential header', () => {
  it('builds the documented Basic header without leaking either half verbatim', () => {
    const header = basicAuthorization('MK_TEST_APIKEY', 'SECRETVALUE');
    expect(header.startsWith('Basic ')).toBe(true);
    expect(header).not.toContain('SECRETVALUE');
    expect(Buffer.from(header.slice(6), 'base64').toString('utf8')).toBe(
      'MK_TEST_APIKEY:SECRETVALUE',
    );
  });
});
