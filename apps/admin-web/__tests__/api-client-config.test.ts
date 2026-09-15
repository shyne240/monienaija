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
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
