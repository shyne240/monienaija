import { EventEmitter } from 'node:events';

import {
  createDojahHttpsTransport,
  type DojahTransport,
} from '../src/identity-verification/dojah-transport';
import {
  DojahVerificationProvider,
  dojahOptionsFromEnvironment,
} from '../src/identity-verification/dojah-verification.provider';
import { DojahKycProvider } from '../src/kyc-verification/dojah-kyc.provider';

const identity = {
  firstName: 'Synthetic',
  lastName: 'Person',
  dateOfBirth: '2000-01-01',
  phone: '+2348012345678',
};
const config = {
  enabled: true,
  environment: 'sandbox' as const,
  secretKey: 'synthetic-secret',
  appId: 'synthetic-app',
  timeoutMs: 100,
};
const response = (body: unknown, status = 200) => ({ status, body });
const entityWithMatch = {
  bvn: { value: '2*****89012', status: true },
  first_name: { confidence_value: 100, status: true },
  last_name: { confidence_value: 100, status: true },
  dob: { status: true },
};

describe('Dojah documented verification adapter (mock transport only)', () => {
  it('is disabled by default and does not issue a transport request', async () => {
    const transport = jest.fn();
    await expect(
      new DojahVerificationProvider({ transport }).getNinAdvanced('00000000000'),
    ).rejects.toMatchObject({ code: 'DISABLED' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('requires an explicit environment when credentials are enabled', () => {
    expect(dojahOptionsFromEnvironment({ DOJAH_SECRET_KEY: 'synthetic-secret' })).toEqual({});
    expect(() => dojahOptionsFromEnvironment({ DOJAH_VERIFICATION_ENABLED: 'true' })).toThrow(
      'Dojah verification: CONFIGURATION',
    );
    expect(
      dojahOptionsFromEnvironment({
        DOJAH_VERIFICATION_ENABLED: 'true',
        DOJAH_VERIFICATION_ENV: 'sandbox',
        DOJAH_SECRET_KEY: 'synthetic-secret',
        DOJAH_APP_ID: 'synthetic-app',
      }),
    ).toEqual({
      enabled: true,
      environment: 'sandbox',
      secretKey: 'synthetic-secret',
      appId: 'synthetic-app',
    });
    expect(() =>
      dojahOptionsFromEnvironment({
        DOJAH_VERIFICATION_ENABLED: 'TRUE',
        DOJAH_VERIFICATION_ENV: 'sandbox',
      }),
    ).toThrow('Dojah verification: CONFIGURATION');
  });

  it('sends only documented BVN Validate fields and requires every supplied field status', async () => {
    const transport = jest
      .fn<ReturnType<DojahTransport>, Parameters<DojahTransport>>()
      .mockResolvedValue(response({ entity: entityWithMatch }));
    const provider = new DojahVerificationProvider({ ...config, transport });
    await expect(
      provider.validateBvn(
        {
          bvn: '22222222222',
          firstName: identity.firstName,
          lastName: identity.lastName,
          dateOfBirth: identity.dateOfBirth,
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ match: true });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]![0]).toBe('/api/v1/kyc/bvn');
    expect(transport.mock.calls[0]![1]).toMatchObject({
      environment: 'sandbox',
      authorization: 'synthetic-secret',
      appId: 'synthetic-app',
      query: {
        bvn: '22222222222',
        first_name: identity.firstName,
        last_name: identity.lastName,
        dob: identity.dateOfBirth,
      },
    });
  });

  it('treats a missing DOB match status as unknown, not a positive match', async () => {
    const transport = jest.fn().mockResolvedValue(
      response({
        entity: {
          bvn: { value: '2*****89012', status: true },
          first_name: { confidence_value: 100, status: true },
          last_name: { confidence_value: 100, status: true },
        },
      }),
    );
    await expect(
      new DojahVerificationProvider({ ...config, transport }).validateBvn({
        bvn: '22222222222',
        firstName: identity.firstName,
        lastName: identity.lastName,
        dateOfBirth: identity.dateOfBirth,
      }),
    ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('maps a documented not-found response to review and never retries', async () => {
    const transport = jest.fn().mockResolvedValue(response({ error: 'BVN not found' }, 400));
    await expect(
      new DojahVerificationProvider({ ...config, transport }).validateBvn({
        bvn: '22222222222',
        firstName: identity.firstName,
        lastName: identity.lastName,
        dateOfBirth: identity.dateOfBirth,
      }),
    ).resolves.toEqual({ match: false });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('returns only the documented identity fields from Advanced NIN, discarding photo and extras', async () => {
    const transport = jest
      .fn<ReturnType<DojahTransport>, Parameters<DojahTransport>>()
      .mockResolvedValue(
        response({
          entity: {
            nin: '70123456789',
            first_name: 'SYNTHETIC',
            last_name: 'PERSON',
            date_of_birth: '2000-01-01',
            photo: 'never-return-or-persist-this',
            tax_id: 'not-requested',
          },
        }),
      );
    await expect(
      new DojahVerificationProvider({ ...config, transport }).getNinAdvanced('70123456789'),
    ).resolves.toEqual({
      nin: '70123456789',
      firstName: 'SYNTHETIC',
      lastName: 'PERSON',
      dateOfBirth: '2000-01-01',
    });
    expect(transport.mock.calls[0]![0]).toBe('/api/v1/kyc/nin/advance');
    expect(transport.mock.calls[0]![1].query).toEqual({ nin: '70123456789' });
  });

  it('matches NIN locally using exact normalized names and birth date, and rejects another identifier', async () => {
    const transport = jest.fn().mockResolvedValue(
      response({
        entity: {
          nin: '70123456789',
          first_name: ' SYNTHETIC ',
          last_name: 'PERSON',
          date_of_birth: '2000-01-01',
          photo: 'discarded',
        },
      }),
    );
    const provider = new DojahKycProvider(new DojahVerificationProvider({ ...config, transport }));
    await expect(
      provider.verify(
        { kind: 'NIN', identifier: '70123456789', identity },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ outcome: 'MATCH' });
    const mismatch = new DojahKycProvider(
      new DojahVerificationProvider({
        ...config,
        transport: jest.fn().mockResolvedValue(
          response({
            entity: {
              nin: '70123456780',
              first_name: 'SYNTHETIC',
              last_name: 'PERSON',
              date_of_birth: '2000-01-01',
            },
          }),
        ),
      }),
    );
    await expect(
      mismatch.verify(
        { kind: 'NIN', identifier: '70123456789', identity },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  });

  it('rejects malformed input and failed responses without leaking raw provider data or retrying', async () => {
    const transport = jest
      .fn()
      .mockResolvedValue(response({ error: 'private response body' }, 402));
    const provider = new DojahVerificationProvider({ ...config, transport });
    await expect(provider.getNinAdvanced('invalid')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    const error = await provider.getNinAdvanced('70123456789').catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(String(error)).toBe('DojahVerificationError: Dojah verification: OUTCOME_UNKNOWN');
    expect(JSON.stringify(error)).not.toContain('private response body');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('bounds a hung request, aborts it and never retries', async () => {
    let signal: AbortSignal | undefined;
    const transport: DojahTransport = jest.fn(async (_path, init) => {
      signal = init.signal;
      return new Promise(() => undefined);
    });
    await expect(
      new DojahVerificationProvider({ ...config, transport }).getNinAdvanced('70123456789'),
    ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(signal?.aborted).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe('Dojah pinned transport guard (no external calls)', () => {
  it.each(['127.0.0.1', '169.254.169.254', '::1', '10.2.3.4'])(
    'rejects non-public DNS %s',
    async (address) => {
      const request = jest.fn();
      const transport = createDojahHttpsTransport({
        lookup: () => Promise.resolve([{ address, family: address.includes(':') ? 6 : 4 }]),
        request: request as never,
      });
      await expect(
        transport('/api/v1/kyc/nin/advance', {
          environment: 'sandbox',
          authorization: 'synthetic',
          appId: 'synthetic-app',
          query: { nin: '70123456789' },
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow();
      expect(request).not.toHaveBeenCalled();
    },
  );

  it('rejects unexpected paths/query parameters before DNS and rejects mixed public/private DNS', async () => {
    const lookup = jest.fn().mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    const request = jest.fn();
    const transport = createDojahHttpsTransport({ lookup, request: request as never });
    const options = {
      environment: 'sandbox' as const,
      authorization: 'synthetic',
      appId: 'synthetic-app',
      query: { nin: '70123456789' },
      signal: new AbortController().signal,
    };
    await expect(
      transport('/api/v1/kyc/nin/advance?redirect=evil' as never, options),
    ).rejects.toThrow();
    await expect(
      transport('/api/v1/kyc/nin/advance', { ...options, query: { ...options.query, extra: 'x' } }),
    ).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
    await expect(transport('/api/v1/kyc/nin/advance', options)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('pins DNS to a fixed TLS hostname, sends documented headers and refuses redirects', async () => {
    const req = new EventEmitter() as EventEmitter & {
      end: jest.Mock;
      destroy: jest.Mock;
      on: jest.Mock;
    };
    req.end = jest.fn(() => {
      callback(responseObject);
      req.emit('close');
    });
    req.destroy = jest.fn();
    const responseObject = new EventEmitter() as EventEmitter & {
      statusCode: number;
      resume: jest.Mock;
    };
    responseObject.statusCode = 302;
    responseObject.resume = jest.fn();
    let callback: (response: typeof responseObject) => void = () => undefined;
    const request = jest.fn((options: unknown, cb: (response: typeof responseObject) => void) => {
      callback = cb;
      return req;
    });
    const transport = createDojahHttpsTransport({
      lookup: () => Promise.resolve([{ address: '8.8.8.8', family: 4 }]),
      request: request as never,
    });
    const result = await transport('/api/v1/kyc/nin/advance', {
      environment: 'sandbox',
      authorization: 'synthetic-secret',
      appId: 'synthetic-app',
      query: { nin: '70123456789' },
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ status: 302, body: null });
    expect(responseObject.resume).toHaveBeenCalled();
    const options = request.mock.calls[0]![0] as {
      hostname: string;
      servername: string;
      path: string;
      method: string;
      headers: Record<string, string>;
    };
    expect(options).toMatchObject({
      hostname: 'sandbox.dojah.io',
      servername: 'sandbox.dojah.io',
      path: '/api/v1/kyc/nin/advance?nin=70123456789',
      method: 'GET',
      headers: {
        authorization: 'synthetic-secret',
        AppId: 'synthetic-app',
        accept: 'application/json',
      },
    });
    const done = jest.fn();
    const resolver = request.mock.calls[0]![0] as {
      lookup: (
        host: string,
        options: { all: boolean },
        callback: (...args: unknown[]) => void,
      ) => void;
    };
    resolver.lookup('sandbox.dojah.io', { all: true }, done);
    expect(done).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);
  });
});
