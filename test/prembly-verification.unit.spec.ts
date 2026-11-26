import { EventEmitter } from 'node:events';

import {
  createDeterministicPremblyTransport,
  createPremblyHttpsTransport,
  deterministicPremblyTransportFromEnvironment,
  type PremblyTransport,
} from '../src/identity-verification/prembly-transport';
import {
  PremblyVerificationError,
  PremblyVerificationProvider,
} from '../src/identity-verification/prembly-verification.provider';
import { PremblyKycProvider } from '../src/kyc-verification/prembly-kyc.provider';
import type { VerificationInput } from '../src/kyc-verification/kyc.types';

const input: VerificationInput = {
  kind: 'BVN',
  identifier: '12345678901',
  identity: {
    firstName: 'Synthetic',
    lastName: 'Customer',
    dateOfBirth: '02-Jan-1990',
    phone: '08000000000',
  },
};
const success = (data: unknown) => ({
  status: 200,
  body: { status: true, response_code: '00', data },
});
const credentialResolver = { getApiKey: jest.fn().mockResolvedValue('synthetic-prem-bly-key-01') };

describe('Prembly BVN/NIN Basic verification adapter', () => {
  beforeEach(() => credentialResolver.getApiKey.mockResolvedValue('synthetic-prem-bly-key-01'));

  it.each([
    ['BVN', '/verification/bvn_validation'],
    ['NIN', '/verification/vnin-basic'],
  ] as const)(
    'sends only the identity number to the fixed %s Basic endpoint',
    async (kind, path) => {
      const transport = jest.fn<ReturnType<PremblyTransport>, Parameters<PremblyTransport>>();
      transport.mockResolvedValueOnce(
        success({
          ...(kind === 'BVN' ? { bvn: input.identifier } : { nin: input.identifier }),
          firstName: 'Synthetic',
          lastName: 'Customer',
          dateOfBirth: '02-Jan-1990',
          phoneNumber: 'must-not-be-returned',
          photo: 'must-not-be-returned',
          address: 'must-not-be-returned',
          providerReference: 'must-not-be-returned',
        }),
      );
      const provider = new PremblyVerificationProvider({ credentialResolver, transport });

      await expect(
        provider.verify({ ...input, kind }, new AbortController().signal),
      ).resolves.toEqual({
        identifier: input.identifier,
        firstName: 'Synthetic',
        lastName: 'Customer',
        dateOfBirth: '02-Jan-1990',
      });
      expect(transport).toHaveBeenCalledTimes(1);
      expect(transport.mock.calls[0]?.[0]).toBe(path);
      expect(transport.mock.calls[0]?.[1]).toMatchObject({
        apiKey: 'synthetic-prem-bly-key-01',
        number: input.identifier,
        timeoutMs: 8000,
      });
      expect(JSON.stringify(transport.mock.calls[0]?.[1])).not.toContain('phoneNumber');
      expect(JSON.stringify(transport.mock.calls[0]?.[1])).not.toContain('must-not-be-returned');
    },
  );

  it('only accepts the documented success envelope and fails closed on provider errors', async () => {
    const transport = jest
      .fn<ReturnType<PremblyTransport>, Parameters<PremblyTransport>>()
      .mockResolvedValue({
        status: 200,
        body: {
          status: true,
          response_code: '01',
          response_message: 'private provider response',
          data: { firstName: 'Synthetic', lastName: 'Customer', dateOfBirth: '02-Jan-1990' },
        },
      });
    const provider = new PremblyVerificationProvider({ credentialResolver, transport });
    const error = await provider
      .verify(input, new AbortController().signal)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PremblyVerificationError);
    expect(error).toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(String(error)).not.toContain('private provider response');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: 401, body: { status: false, response_code: '01' } },
    { status: 403, body: { status: false, response_code: '01' } },
    { status: 500, body: { status: false, response_code: '99' } },
    { status: 302, body: null },
    { status: 200, body: { status: false, response_code: '00' } },
    { status: 200, body: { status: true, response_code: '00', data: null } },
  ])('does not promote a non-success response to identity evidence: %#', async (response) => {
    const transport = jest.fn().mockResolvedValue(response);
    await expect(
      new PremblyVerificationProvider({ credentialResolver, transport }).verify(
        input,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: response.status === 401 || response.status === 403 ? 'AUTH_FAILED' : 'OUTCOME_UNKNOWN',
    });
  });

  it('rejects an identifier-bound mismatch and records only minimum identity details in memory', async () => {
    const transport = jest.fn().mockResolvedValue(
      success({
        bvn: '10987654321',
        firstName: 'Synthetic',
        lastName: 'Customer',
        dateOfBirth: '02-Jan-1990',
      }),
    );
    await expect(
      new PremblyVerificationProvider({ credentialResolver, transport }).verify(
        input,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  });

  it('does not make a request for invalid numbers, aborted requests, or unavailable credentials', async () => {
    const transport = jest.fn();
    const provider = new PremblyVerificationProvider({ credentialResolver, transport });
    await expect(
      provider.verify({ ...input, identifier: '123' }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const aborted = new AbortController();
    aborted.abort();
    await expect(provider.verify(input, aborted.signal)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    credentialResolver.getApiKey.mockResolvedValueOnce(null);
    await expect(provider.verify(input, new AbortController().signal)).rejects.toMatchObject({
      code: 'CONFIGURATION',
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('test probe uses only the documented BVN test record and returns a minimized result', async () => {
    const transport = jest
      .fn<ReturnType<PremblyTransport>, Parameters<PremblyTransport>>()
      .mockResolvedValue(success({ bvn: '54651333604' }));
    const provider = new PremblyVerificationProvider({ credentialResolver, transport });
    await expect(
      provider.testSandboxConnection('synthetic-prem-bly-key-01', new AbortController().signal),
    ).resolves.toEqual({ httpStatus: 200, responseCode: '00', providerStatus: true });
    expect(transport.mock.calls[0]?.[0]).toBe('/verification/bvn_validation');
    expect(transport.mock.calls[0]?.[1].number).toBe('54651333604');
  });

  it('maps a matching response to MATCH and any name/date mismatch to REVIEW without references', async () => {
    const transport = jest
      .fn()
      .mockResolvedValueOnce(
        success({
          bvn: input.identifier,
          firstName: 'Synthetic',
          lastName: 'Customer',
          dateOfBirth: '02-Jan-1990',
        }),
      )
      .mockResolvedValueOnce(
        success({
          bvn: input.identifier,
          firstName: 'Different',
          lastName: 'Customer',
          dateOfBirth: '02-Jan-1990',
        }),
      );
    const kycProvider = new PremblyKycProvider(
      new PremblyVerificationProvider({ credentialResolver, transport }),
    );
    await expect(kycProvider.verify(input, new AbortController().signal)).resolves.toEqual({
      outcome: 'MATCH',
    });
    await expect(kycProvider.verify(input, new AbortController().signal)).resolves.toEqual({
      outcome: 'REVIEW',
    });
  });
});

describe('Prembly fixed-host HTTPS transport guard', () => {
  const options = {
    apiKey: 'synthetic-prem-bly-key-01',
    number: input.identifier,
    timeoutMs: 8000,
    signal: new AbortController().signal,
  };

  it.each(['127.0.0.1', '169.254.169.254', '::1', '10.2.3.4'])(
    'rejects non-public DNS result %s before opening a socket',
    async (address) => {
      const request = jest.fn();
      const transport = createPremblyHttpsTransport({
        lookup: () => Promise.resolve([{ address, family: address.includes(':') ? 6 : 4 }]),
        request: request as never,
      });
      await expect(transport('/verification/bvn_validation', options)).rejects.toThrow();
      expect(request).not.toHaveBeenCalled();
    },
  );

  it('rejects an unlisted path before DNS and blocks DNS rebinding to a private address', async () => {
    const lookup = jest.fn().mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    const request = jest.fn();
    const transport = createPremblyHttpsTransport({ lookup, request: request as never });
    await expect(
      transport('/verification/bvn_validation?redirect=elsewhere' as never, options),
    ).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
    await expect(transport('/verification/vnin-basic', options)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('pins the provider host and TLS name and refuses redirects', async () => {
    const req = new EventEmitter() as EventEmitter & {
      end: jest.Mock;
      destroy: jest.Mock;
      setTimeout: jest.Mock;
    };
    req.end = jest.fn(() => {
      callback(response);
      req.emit('close');
    });
    req.destroy = jest.fn();
    req.setTimeout = jest.fn();
    const response = new EventEmitter() as EventEmitter & { statusCode: number; resume: jest.Mock };
    response.statusCode = 302;
    response.resume = jest.fn();
    let callback: (value: typeof response) => void = () => undefined;
    const request = jest.fn((requestOptions: unknown, cb: (value: typeof response) => void) => {
      callback = cb;
      return req;
    });
    const lookup = jest.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    const transport = createPremblyHttpsTransport({ lookup, request: request as never });

    await expect(transport('/verification/bvn_validation', options)).resolves.toEqual({
      status: 302,
      body: null,
    });
    expect(response.resume).toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    const requestOptions = request.mock.calls[0]?.[0] as {
      hostname: string;
      servername: string;
      path: string;
      headers: Record<string, string | number>;
      lookup: (
        host: string,
        opts: { all: boolean },
        callback: (...args: unknown[]) => void,
      ) => void;
    };
    expect(requestOptions.hostname).toBe('api.prembly.com');
    expect(requestOptions.servername).toBe('api.prembly.com');
    expect(requestOptions.path).toBe('/verification/bvn_validation');
    expect(requestOptions.headers['x-api-key']).toBe(options.apiKey);
    expect(req.end).toHaveBeenCalledWith(JSON.stringify({ number: input.identifier }));
    const pinned = jest.fn();
    requestOptions.lookup('api.prembly.com', { all: true }, pinned);
    expect(pinned).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);
  });
});

describe('deterministic Prembly acceptance adapter', () => {
  const registry = new Map([
    ['12345678901', { firstName: 'Synthetic', lastName: 'Customer', dateOfBirth: '1990-01-02' }],
  ]);
  const options = {
    apiKey: 'synthetic-api-key-value',
    number: '12345678901',
    timeoutMs: 5000,
    signal: new AbortController().signal,
  };

  it('returns the declared synthetic record only for a governed path and known identifier', async () => {
    const transport = createDeterministicPremblyTransport(registry);
    const result = await transport('/verification/bvn_validation', options);
    expect(result.status).toBe(200);
    expect((result.body as { data: unknown }).data).toMatchObject({
      bvn: '12345678901',
      firstName: 'Synthetic',
      lastName: 'Customer',
    });
    const nin = await transport('/verification/vnin-basic', options);
    expect((nin.body as { data: unknown }).data).toMatchObject({ nin: '12345678901' });
  });

  it('fails closed: an undeclared identifier yields no record instead of invented evidence', async () => {
    const transport = createDeterministicPremblyTransport(registry);
    const result = await transport('/verification/bvn_validation', {
      ...options,
      number: '99999999999',
    });
    expect((result.body as { data: unknown }).data).toBeNull();
  });

  it('applies the same input validation as the HTTPS transport', async () => {
    const transport = createDeterministicPremblyTransport(registry);
    await expect(
      transport('/verification/bvn_validation', { ...options, number: '12345' }),
    ).rejects.toThrow('Prembly transport blocked');
    await expect(
      transport('/verification/bvn_validation', {
        ...options,
        apiKey: 'short',
        number: '12345678901',
      }),
    ).rejects.toThrow('Prembly transport blocked');
  });

  it('refuses to activate in production and never publishes a registry without one', () => {
    const original = process.env.PREMBLY_DETERMINISTIC_FIXTURES;
    const originalNodeEnv = process.env.NODE_ENV;
    try {
      delete process.env.PREMBLY_DETERMINISTIC_FIXTURES;
      expect(deterministicPremblyTransportFromEnvironment()).toBeUndefined();
      process.env.PREMBLY_DETERMINISTIC_FIXTURES = '/tmp/does-not-matter.json';
      process.env.NODE_ENV = 'production';
      expect(deterministicPremblyTransportFromEnvironment()).toBeUndefined();
    } finally {
      if (original === undefined) delete process.env.PREMBLY_DETERMINISTIC_FIXTURES;
      else process.env.PREMBLY_DETERMINISTIC_FIXTURES = original;
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
