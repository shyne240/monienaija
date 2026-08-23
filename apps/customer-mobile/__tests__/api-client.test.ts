import { ApiClient, ApiError, getBaseUrl, setBaseUrl } from '../src/services/api-client';
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
});
