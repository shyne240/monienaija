import {
  ApiClient,
  ApiError,
  getBaseUrl,
  onCustomerSessionExpired,
  resolveCustomerApiUrl,
  setBaseUrl,
} from '../src/services/api-client';
import { SecureStorage } from '../src/services/secure-storage';

jest.mock('../src/services/secure-storage', () => ({
  SecureStorage: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
}));

describe('ApiClient tests', () => {
  let globalFetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    globalFetchMock = jest.fn();
    global.fetch = globalFetchMock;
  });

  afterEach(() => {
    // Reset fetch
    (global as any).fetch = undefined;
  });

  test('refuses to send requests when a production build has no configured base URL', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    jest.resetModules();

    try {
      // Fresh module instance: the config module reads NODE_ENV when it is first loaded.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const client = require('../src/services/api-client') as typeof import('../src/services/api-client');

      expect(client.getBaseUrl()).toBe('');
      await expect(client.ApiClient.get('/wallets')).rejects.toBeInstanceOf(client.NetworkError);
      expect(globalFetchMock).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      jest.resetModules();
    }
  });

  test('should set and get Base URL correctly', () => {
    setBaseUrl('https://api.moneynaija.ng/');
    expect(getBaseUrl()).toBe('https://api.moneynaija.ng');
  });

  test('should inject Authorization token dynamically', async () => {
    (SecureStorage.get as jest.Mock).mockResolvedValue('test-access-token');
    globalFetchMock.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ status: 'success' }),
    });

    const res = await ApiClient.get('/wallets');

    expect(res).toEqual({ status: 'success' });
    expect(globalFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/wallets'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-access-token',
        }),
      }),
    );
  });

  test('should inject logical Idempotency-Key correctly on write operations', async () => {
    (SecureStorage.get as jest.Mock).mockResolvedValue(null);
    globalFetchMock.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ id: 'tx-123' }),
    });

    const payload = { amountMinor: '500' };
    const res = await ApiClient.post('/transfers', payload, {
      idempotencyKey: 'idemp-key-unique-789',
    });

    expect(res).toEqual({ id: 'tx-123' });
    expect(globalFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/transfers'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'idempotency-key': 'idemp-key-unique-789',
        }),
        body: JSON.stringify(payload),
      }),
    );
  });

  test('should parse and throw normalised ApiError on failure status codes', async () => {
    globalFetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      headers: { get: () => 'application/json' },
      json: async () => ({
        message: 'Invalid destination wallet format',
        code: 'VALIDATION_FAILED',
      }),
    });

    await expect(ApiClient.get('/some-route')).rejects.toThrow(ApiError);
    await expect(ApiClient.get('/some-route')).rejects.toEqual(
      expect.objectContaining({
        status: 400,
        code: 'VALIDATION_FAILED',
        message: 'Invalid destination wallet format',
      }),
    );
  });

  test('normalizes /api/v1 prefix across bare origins and pre-prefixed base URLs without double-prefixing', () => {
    expect(resolveCustomerApiUrl('http://10.0.2.2:3000', '/customers/sessions')).toBe(
      'http://10.0.2.2:3000/api/v1/customers/sessions',
    );
    expect(resolveCustomerApiUrl('https://api.moneynaija.ng/', '/customers/me/wallets')).toBe(
      'https://api.moneynaija.ng/api/v1/customers/me/wallets',
    );
    expect(resolveCustomerApiUrl('https://api.moneynaija.ng/api/v1/', '/customers/me/wallets')).toBe(
      'https://api.moneynaija.ng/api/v1/customers/me/wallets',
    );
    expect(resolveCustomerApiUrl('https://api.moneynaija.ng/api/v1', '/api/v1/customers/me')).toBe(
      'https://api.moneynaija.ng/api/v1/customers/me',
    );
  });

  test('omits Content-Type header on bodyless POST requests such as /customers/sessions/logout so Fastify does not reject empty JSON bodies', async () => {
    setBaseUrl('https://api.moneynaija.ng');
    (SecureStorage.get as jest.Mock).mockResolvedValue('active-customer-token');
    globalFetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ revoked: true }),
    });

    await ApiClient.post('/customers/sessions/logout');

    const [, requestInit] = globalFetchMock.mock.calls[0];
    expect(requestInit.method).toBe('POST');
    expect(requestInit.headers.Authorization).toBe('Bearer active-customer-token');
    expect(requestInit.headers['Content-Type']).toBeUndefined();
  });

  test('preserves active customer bearer session on 401 step-up PIN and password rejections', async () => {
    setBaseUrl('https://api.moneynaija.ng');
    (SecureStorage.get as jest.Mock).mockResolvedValue('active-customer-token');
    const expiredListener = jest.fn();
    const unsubscribe = onCustomerSessionExpired(expiredListener);

    try {
      for (const pinOrPasswordMessage of [
        'Invalid PIN',
        'Customer PIN is locked',
        'Current PIN is incorrect',
        'Current password is incorrect',
      ]) {
        globalFetchMock.mockResolvedValueOnce({
          ok: false,
          status: 401,
          headers: { get: () => 'application/json' },
          json: async () => ({ message: pinOrPasswordMessage }),
        });

        await expect(
          ApiClient.post('/customers/me/transfers', { amountMinor: '1000', pin: '0000' }),
        ).rejects.toThrow(ApiError);
      }

      expect(SecureStorage.remove).not.toHaveBeenCalled();
      expect(expiredListener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  test('purges customer session storage and notifies listeners on 401 bearer-session expiry while preserving pending transfer intent', async () => {
    setBaseUrl('https://api.moneynaija.ng');
    (SecureStorage.get as jest.Mock).mockResolvedValue('expired-customer-token');
    const expiredListener = jest.fn();
    const unsubscribe = onCustomerSessionExpired(expiredListener);

    try {
      globalFetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'Authentication required' }),
      });

      await expect(ApiClient.get('/customers/me/wallets')).rejects.toThrow(ApiError);

      expect(SecureStorage.remove).toHaveBeenCalledWith('auth_session_token');
      expect(SecureStorage.remove).toHaveBeenCalledWith('auth_customer_id');
      expect(SecureStorage.remove).toHaveBeenCalledWith('auth_session_data');
      expect(SecureStorage.remove).not.toHaveBeenCalledWith(
        expect.stringMatching(/^pending_wallet_transfer_intent:/),
      );
      expect(expiredListener).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });
});
