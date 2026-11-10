jest.mock('../src/config', () => ({
  API_BASE_URL: '',
  DEV_AUTH_MOCK: false,
  DEFAULT_INTERNAL_AUDIENCE: 'workforce-admin',
}));

import { ApiClient, NetworkError } from '../src/services/api-client';

describe('Admin Web API client configuration safety', () => {
  beforeEach(() => {
    Object.defineProperty(global, 'localStorage', {
      value: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
        clear: () => undefined,
      },
      writable: true,
    });
  });

  it('refuses to send requests when the build did not configure an API base URL', async () => {
    const fetchSpy = jest.fn();
    Object.defineProperty(global, 'fetch', { value: fetchSpy, writable: true });

    await expect(ApiClient.get('/internal/readiness')).rejects.toBeInstanceOf(NetworkError);
    await expect(
      ApiClient.postForm('/customers/customer-1/proof-of-address', new FormData()),
    ).rejects.toThrow('Admin API base URL is not configured');
    await expect(
      ApiClient.getBlob('/customers/customer-1/proof-of-address/document-1/content'),
    ).rejects.toThrow('Admin API base URL is not configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
