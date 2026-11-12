import { EventEmitter } from 'node:events';

import {
  createMonnifyHttpsTransport,
  type MonnifyPath,
  type MonnifyTransport,
} from '../src/identity-verification/monnify-transport';
import {
  MonnifyVerificationProvider,
  monnifyOptionsFromEnvironment,
} from '../src/identity-verification/monnify-verification.provider';

const bvn = {
  bvn: '00000000000',
  name: 'Synthetic Person',
  dateOfBirth: '29-Feb-2000',
  mobileNo: '00000000000',
};
const success = (body: unknown) => ({
  status: 200,
  body: { requestSuccessful: true, responseCode: '0', responseBody: body },
});
const auth = success({ accessToken: 'synthetic-token' });
const config = {
  enabled: true,
  apiKey: 'synthetic-key',
  secretKey: 'synthetic-secret',
  timeoutMs: 100,
};

describe('isolated Monnify verification provider', () => {
  it('is disabled by default, with no transport calls', async () => {
    const transport = jest.fn();
    await expect(
      new MonnifyVerificationProvider({ transport }).matchBvnDetails(bvn),
    ).rejects.toMatchObject({ code: 'DISABLED' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('only loads secret values from an explicitly provided environment snapshot when enabled', () => {
    expect(monnifyOptionsFromEnvironment({ MONNIFY_API_KEY: 'secret' })).toEqual({});
    expect(
      monnifyOptionsFromEnvironment({
        MONNIFY_VERIFICATION_ENABLED: 'true',
        MONNIFY_API_KEY: 'key',
        MONNIFY_SECRET_KEY: 'secret',
      }),
    ).toEqual({ enabled: true, apiKey: 'key', secretKey: 'secret' });
    expect(() => monnifyOptionsFromEnvironment({ MONNIFY_VERIFICATION_ENABLED: 'TRUE' })).toThrow(
      'CONFIGURATION',
    );
  });
  it('authenticates with Basic then posts only expected BVN detail fields using Bearer', async () => {
    const transport = jest
      .fn<ReturnType<MonnifyTransport>, Parameters<MonnifyTransport>>()
      .mockResolvedValueOnce(auth)
      .mockResolvedValueOnce(success({ bvnInformationMatch: false, bvn: bvn.bvn }));
    const provider = new MonnifyVerificationProvider({ ...config, transport });
    await expect(
      provider.matchBvnDetails({ ...bvn, extra: 'not sent' } as typeof bvn),
    ).resolves.toEqual({ match: false });
    expect(transport.mock.calls[0]![0]).toBe('/api/v1/auth/login');
    expect(transport.mock.calls[0]![1].authorization).toBe(
      `Basic ${Buffer.from('synthetic-key:synthetic-secret').toString('base64')}`,
    );
    expect(transport.mock.calls[1]![0]).toBe('/api/v1/vas/bvn-details-match');
    expect(transport.mock.calls[1]![1].authorization).toBe('Bearer synthetic-token');
    expect(JSON.parse(transport.mock.calls[1]![1].body!)).toEqual(bvn);
  });
  it('supports account match and NIN details without treating a provider response as customer ownership', async () => {
    const transport = jest
      .fn<ReturnType<MonnifyTransport>, Parameters<MonnifyTransport>>()
      .mockResolvedValueOnce(auth)
      .mockResolvedValueOnce(success({ bvnAccountNameMatch: true, accountNumber: '0000000000' }))
      .mockResolvedValueOnce(auth)
      .mockResolvedValueOnce(
        success({
          firstName: 'Synthetic',
          lastName: 'Person',
          dateOfBirth: '01-Jan-2000',
          nin: '00000000000',
          ninInformationMatch: true,
        }),
      );
    const provider = new MonnifyVerificationProvider({ ...config, transport });
    await expect(
      provider.matchBvnAccount({
        bvn: bvn.bvn,
        bankCode: '000',
        accountNumber: '0000000000',
        name: bvn.name,
      }),
    ).resolves.toEqual({ match: true });
    await expect(provider.getNinDetails('00000000000')).resolves.toEqual({
      firstName: 'Synthetic',
      lastName: 'Person',
      dateOfBirth: '01-Jan-2000',
      ninInformationMatch: true,
    });
    expect(transport.mock.calls.map((c) => c[0])).toEqual([
      '/api/v1/auth/login',
      '/api/v1/vas/bvn-account-match',
      '/api/v1/auth/login',
      '/api/v1/vas/nin-details',
    ]);
    expect(JSON.parse(transport.mock.calls[3]![1].body!)).toEqual({ nin: '00000000000' });
  });
  it('rejects malformed inputs and invalid configuration before network', async () => {
    const transport = jest.fn();
    const provider = new MonnifyVerificationProvider({ ...config, transport });
    for (const input of [
      { ...bvn, bvn: 'x' },
      { ...bvn, dateOfBirth: '29-Feb-2001' },
      { ...bvn, name: '\n' },
      { ...bvn, mobileNo: 'abc' },
    ]) {
      await expect(provider.matchBvnDetails(input)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    }
    await expect(
      provider.matchBvnAccount({
        bvn: bvn.bvn,
        bankCode: 'https://x',
        accountNumber: '0',
        name: bvn.name,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(provider.getNinDetails('000')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      new MonnifyVerificationProvider({ ...config, apiKey: '', transport }).getNinDetails(bvn.bvn),
    ).rejects.toMatchObject({ code: 'CONFIGURATION' });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([401, 429, 500, 302])(
    'does not dispatch verification on auth HTTP %s',
    async (status) => {
      const transport = jest
        .fn()
        .mockResolvedValue({ status, body: { responseMessage: 'sensitive data' } });
      await expect(
        new MonnifyVerificationProvider({ ...config, transport }).getNinDetails(bvn.bvn),
      ).rejects.toMatchObject({
        code: 'AUTH_FAILED',
        message: 'Monnify verification: AUTH_FAILED',
      });
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { status: 500, body: {} },
    { status: 429, body: {} },
    { status: 302, body: {} },
    { status: 200, body: { requestSuccessful: false, responseMessage: 'private' } },
    success({ bvnInformationMatch: 'true' }),
    success({ name: { matchStatus: 'FULL_MATCH' }, dateOfBirth: 'FULL_MATCH' }),
  ])('does not retry unrecognized/failed billable responses %#', async (response) => {
    const transport = jest.fn().mockResolvedValueOnce(auth).mockResolvedValueOnce(response);
    await expect(
      new MonnifyVerificationProvider({ ...config, transport }).matchBvnDetails(bvn),
    ).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
      message: 'Monnify verification: OUTCOME_UNKNOWN',
    });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('bounds a hung request, aborts and never retries a billable request', async () => {
    let signal: AbortSignal | undefined;
    const transport: MonnifyTransport = jest.fn(async (path, init) => {
      if (path === '/api/v1/auth/login') return auth;
      signal = init.signal;
      return new Promise(() => undefined);
    });
    await expect(
      new MonnifyVerificationProvider({ ...config, transport }).getNinDetails(bvn.bvn),
    ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(signal?.aborted).toBe(true);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('does not leak arbitrary thrown errors', async () => {
    const transport = jest
      .fn<ReturnType<MonnifyTransport>, Parameters<MonnifyTransport>>()
      .mockResolvedValueOnce(auth)
      .mockRejectedValueOnce(new Error('synthetic identity and secrets'));
    const e = await new MonnifyVerificationProvider({ ...config, transport })
      .getNinDetails(bvn.bvn)
      .catch((error: unknown) => error);
    expect(String(e)).toBe('MonnifyVerificationError: Monnify verification: OUTCOME_UNKNOWN');
    expect(JSON.stringify(e)).not.toContain('synthetic');
  });
});

describe('Monnify pinned transport guard (no sockets)', () => {
  it.each(['127.0.0.1', '169.254.169.254', '::1', '10.2.3.4'])(
    'rejects non-public DNS %s',
    async (address) => {
      const request = jest.fn();
      const transport = createMonnifyHttpsTransport({
        lookup: () => Promise.resolve([{ address, family: address.includes(':') ? 6 : 4 }]),
        request: request as never,
      });
      await expect(
        transport('/api/v1/auth/login', {
          authorization: 'Basic synthetic',
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow();
      expect(request).not.toHaveBeenCalled();
    },
  );
  it('rejects unlisted paths before DNS, and prevents DNS-rebinding to a private address', async () => {
    const lookup = jest.fn().mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    const request = jest.fn();
    const transport = createMonnifyHttpsTransport({ lookup, request: request as never });
    const options = { authorization: 'synthetic', signal: new AbortController().signal };
    await expect(
      transport('/api/v1/vas/nin-details?redirect=evil' as MonnifyPath, options),
    ).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
    await expect(transport('/api/v1/auth/login', options)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it('pins the public IP with fixed TLS hostname and refuses to follow redirects', async () => {
    const req = new EventEmitter() as EventEmitter & {
      write: jest.Mock;
      end: jest.Mock;
      destroy: jest.Mock;
    };
    req.write = jest.fn();
    req.destroy = jest.fn();
    const response = new EventEmitter() as EventEmitter & { statusCode: number; resume: jest.Mock };
    response.statusCode = 302;
    response.resume = jest.fn();
    req.end = jest.fn(() => {
      callback(response);
      req.emit('close');
    });
    let callback: (value: typeof response) => void = () => undefined;
    const request = jest.fn((opts: unknown, cb: (value: typeof response) => void) => {
      callback = cb;
      return req;
    });
    const lookup = jest.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    const transport = createMonnifyHttpsTransport({ lookup, request: request as never });
    const result = await transport('/api/v1/auth/login', {
      authorization: 'Basic synthetic',
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ status: 302, body: null });
    expect(response.resume).toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    const options = request.mock.calls[0]![0] as {
      hostname: string;
      servername: string;
      path: string;
      lookup: (host: string, opts: { all: boolean }, cb: (...args: unknown[]) => void) => void;
    };
    expect(options.hostname).toBe('api.monnify.com');
    expect(options.servername).toBe('api.monnify.com');
    expect(options.path).toBe('/api/v1/auth/login');
    const done = jest.fn();
    options.lookup('api.monnify.com', { all: true }, done);
    expect(done).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);
  });
  it('does not open a socket if the deadline elapses while resolving DNS', async () => {
    let release!: (v: Array<{ address: string; family: number }>) => void;
    const lookup = () =>
      new Promise<Array<{ address: string; family: number }>>((resolve) => {
        release = resolve;
      });
    const request = jest.fn();
    const controller = new AbortController();
    const transport = createMonnifyHttpsTransport({ lookup, request: request as never });
    const result = transport('/api/v1/auth/login', {
      authorization: 'synthetic',
      signal: controller.signal,
    });
    controller.abort();
    release([{ address: '8.8.8.8', family: 4 }]);
    await expect(result).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
