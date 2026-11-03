import * as dns from 'node:dns';
import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import * as https from 'node:https';
import type { AddressInfo, LookupFunction } from 'node:net';
import { join } from 'node:path';
import { createSecureContext } from 'node:tls';

import {
  createPinnedProviderHttpFetch,
  deriveSafeVendorProviderRef,
  ProviderEgressBlockedError,
  type DnsResolvedAddress,
} from '../src/notification/provider-security';
import type { NotificationSendRequest } from '../src/notification/notification.types';
import type { RobaseNotificationProvider } from '../src/notification/robase-notification-provider';

const ROBASE_URL = 'https://api.robase.dev/v1/sms/send';
const PINNED_V4 = { address: '8.8.8.8', family: 4 } as const;
const PINNED_V6 = { address: '2606:4700:4700::1111', family: 6 } as const;
const TEST_API_KEY = `robe_${'a'.repeat(64)}`;
const TEST_PROVIDER_ID = 'synthetic-message-id';

function init() {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: new AbortController().signal,
    redirect: 'error' as const,
  };
}

describe('pinned provider HTTPS DNS callback', () => {
  it.each([
    ['IPv4', PINNED_V4, PINNED_V6],
    ['IPv6', PINNED_V6, PINNED_V4],
  ])(
    'returns only the selected %s address in both Node lookup formats',
    async (_label, pinned, other) => {
      let requestOptions: https.RequestOptions | undefined;
      const stopBeforeNetwork = new Error('captured request before opening a socket');
      const requestImpl = ((options: https.RequestOptions) => {
        requestOptions = options;
        throw stopBeforeNetwork;
      }) as unknown as typeof https.request;
      const lookupImpl = jest.fn(
        (): Promise<DnsResolvedAddress[]> => Promise.resolve([pinned, other]),
      );
      const fetch = createPinnedProviderHttpFetch({ lookupImpl, requestImpl });

      await expect(fetch(ROBASE_URL, init())).rejects.toBe(stopBeforeNetwork);
      expect(lookupImpl).toHaveBeenCalledTimes(1);
      expect(lookupImpl).toHaveBeenCalledWith('api.robase.dev');
      expect(requestOptions).toMatchObject({
        protocol: 'https:',
        hostname: 'api.robase.dev',
        port: 443,
        servername: 'api.robase.dev',
        path: '/v1/sms/send',
        agent: false,
      });
      expect(requestOptions?.rejectUnauthorized).not.toBe(false);
      expect(requestOptions?.checkServerIdentity).toBeUndefined();

      const lookup = requestOptions?.lookup;
      if (!lookup) throw new Error('Expected the request to use its pinned lookup');
      const callback = jest.fn();
      lookup('api.robase.dev', { all: true }, callback);
      expect(callback.mock.calls).toEqual([[null, [{ ...pinned }]]]);
      callback.mockClear();
      lookup('api.robase.dev', { all: false }, callback);
      expect(callback.mock.calls).toEqual([[null, pinned.address, pinned.family]]);
      callback.mockClear();
      lookup('api.robase.dev', {}, callback);
      expect(callback.mock.calls).toEqual([[null, pinned.address, pinned.family]]);
      // Socket lookup never performs another DNS resolution or returns the second candidate.
      expect(lookupImpl).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    'http://api.robase.dev/v1/sms/send',
    'https://api.robase.dev:444/v1/sms/send',
    'https://user@api.robase.dev/v1/sms/send',
    'https://api.robase.dev.attacker.example/v1/sms/send',
    'https://127.0.0.1/v1/sms/send',
  ])('rejects an unapproved origin before DNS or any request: %s', async (url) => {
    const lookupImpl = jest.fn((): Promise<DnsResolvedAddress[]> => Promise.resolve([PINNED_V4]));
    const requestImpl = jest.fn() as unknown as typeof https.request;
    const fetch = createPinnedProviderHttpFetch({ lookupImpl, requestImpl });

    await expect(fetch(url, init())).rejects.toBeInstanceOf(ProviderEgressBlockedError);
    expect(lookupImpl).not.toHaveBeenCalled();
    expect(requestImpl).not.toHaveBeenCalled();
  });

  it.each([
    [{ address: '127.0.0.1', family: 4 as const }],
    [PINNED_V4, { address: '169.254.169.254', family: 4 as const }],
    [PINNED_V4, { address: '::1', family: 6 as const }],
  ])('rejects any forbidden DNS candidate before opening a socket', async (...addresses) => {
    const requestImpl = jest.fn() as unknown as typeof https.request;
    const fetch = createPinnedProviderHttpFetch({
      lookupImpl: () => Promise.resolve(addresses),
      requestImpl,
    });

    await expect(fetch(ROBASE_URL, init())).rejects.toBeInstanceOf(ProviderEgressBlockedError);
    expect(requestImpl).not.toHaveBeenCalled();
  });
});

type LookupArgs = Parameters<Parameters<LookupFunction>[2]>;
type TransportObservations = {
  requests: https.RequestOptions[];
  lookups: Array<{ options: dns.LookupOptions; args: LookupArgs }>;
};
type ServerRequest = {
  method: string | undefined;
  path: string | undefined;
  headers: IncomingMessage['headers'];
  body: string;
};

// Public, synthetic test-only certificate and key. They are not provider credentials.
// The certificate has only api.robase.dev in its subjectAltName, so the local test
// also checks that certificate trust and hostname verification remain enforced.
const fixtureDir = join(__dirname, 'fixtures', 'notification-pinned-https');
const testCert = readFileSync(join(fixtureDir, 'synthetic-cert.crt'));
const testKey = readFileSync(join(fixtureDir, 'synthetic-key.test-only'));
const nativeHttpsRequest = https.request;

/**
 * Exercise Node's real HTTPS/net lookup machinery without any external connection.
 * The production request options and the pinned callback's exact result are captured
 * unchanged. Only AFTER that callback returns do we translate its IP to loopback and
 * route to the test TLS server; an invalid callback shape stays invalid for Node.
 */
function loopbackRequestImpl(
  port: number,
  autoSelectFamily: boolean,
  trustTestCert: boolean,
  observations: TransportObservations,
): typeof https.request {
  return ((options: https.RequestOptions, onResponse: (res: IncomingMessage) => void) => {
    observations.requests.push(options);
    const pinnedLookup = options.lookup;
    if (!pinnedLookup) throw new Error('Expected a pinned lookup');

    return nativeHttpsRequest(
      {
        ...options,
        // The real destination is strictly local. Keep the original servername so
        // TLS still verifies the approved provider hostname against the test cert.
        hostname: 'localhost',
        host: 'localhost',
        port,
        autoSelectFamily,
        ca: trustTestCert ? testCert : undefined,
        lookup: (hostname, lookupOptions, callback) => {
          pinnedLookup(hostname, lookupOptions, (...args) => {
            observations.lookups.push({ options: { ...lookupOptions }, args });
            const [error, addresses] = args;
            if (error) {
              callback(error, '', 0);
            } else if (Array.isArray(addresses)) {
              callback(
                null,
                addresses.map(() => ({ address: '127.0.0.1', family: 4 })),
              );
            } else {
              callback(null, '127.0.0.1', 4);
            }
          });
        },
      } as https.RequestOptions,
      onResponse,
    );
  }) as unknown as typeof https.request;
}

describe('pinned provider HTTPS through Node and a loopback TLS server', () => {
  let server: https.Server;
  let port: number;
  let serverRequests: ServerRequest[];
  let serverNames: string[];
  let status: number;

  beforeAll(async () => {
    const secureContext = createSecureContext({ key: testKey, cert: testCert });
    server = https.createServer(
      {
        key: testKey,
        cert: testCert,
        SNICallback: (servername, callback) => {
          serverNames.push(servername);
          callback(null, secureContext);
        },
      },
      (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          serverRequests.push({
            method: req.method,
            path: req.url,
            headers: req.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
          if (status >= 300 && status < 400) {
            res.writeHead(status, { Location: `https://127.0.0.1:${port}/stolen` });
            res.end();
          } else {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: TEST_PROVIDER_ID }));
          }
        });
      },
    );
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    port = (server.address() as AddressInfo).port;
  });

  beforeEach(() => {
    serverRequests = [];
    serverNames = [];
    status = 200;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it.each([true, false])('completes real Node HTTPS with autoSelectFamily=%s', async (all) => {
    const observations: TransportObservations = { requests: [], lookups: [] };
    const lookupImpl = jest.fn(
      (): Promise<DnsResolvedAddress[]> => Promise.resolve([PINNED_V4, PINNED_V6]),
    );
    const fetch = createPinnedProviderHttpFetch({
      lookupImpl,
      requestImpl: loopbackRequestImpl(port, all, true, observations),
    });

    const response = await fetch(ROBASE_URL, init());
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ id: TEST_PROVIDER_ID });
    expect(serverRequests).toHaveLength(1);
    expect(lookupImpl).toHaveBeenCalledTimes(1);
    expect(observations.lookups).toHaveLength(1);
    expect(Boolean(observations.lookups[0]!.options.all)).toBe(all);
    expect(observations.lookups[0]!.args).toEqual(
      all ? [null, [PINNED_V4]] : [null, PINNED_V4.address, PINNED_V4.family],
    );
  });

  it('uses the corrected pinned transport by default for the unchanged Robase contract', async () => {
    const observations: TransportObservations = { requests: [], lookups: [] };
    const dnsSpy = jest
      .spyOn(dns.promises, 'lookup')
      .mockImplementation((() =>
        Promise.resolve([PINNED_V4, PINNED_V6])) as unknown as typeof dns.promises.lookup);
    const requestSpy = jest
      .spyOn(https, 'request')
      .mockImplementation(loopbackRequestImpl(port, true, true, observations));
    try {
      // DEFAULT_ROBASE_FETCH is captured at module load, so import the provider only
      // after installing the safe DNS and request wrappers; do not inject a fetch.
      let Provider!: typeof RobaseNotificationProvider;
      await jest.isolateModulesAsync(async () => {
        ({ RobaseNotificationProvider: Provider } = await import(
          '../src/notification/robase-notification-provider'
        ));
      });
      const provider = new Provider({
        baseUrl: 'https://api.robase.dev',
        apiKey: TEST_API_KEY,
        requestTimeoutMs: 5000,
      });
      const request: NotificationSendRequest = {
        channel: 'SMS',
        destination: '2348012345678',
        message: 'Synthetic local transport test',
        payload: {},
        correlationId: 'local-correlation',
        eventType: 'transfer.completed',
        eventKey: 'transfer.completed:local-test',
        recipientType: 'CUSTOMER',
        recipientId: 'local-recipient',
      };

      expect(await provider.send(request)).toEqual({
        success: true,
        providerRef: deriveSafeVendorProviderRef('robase', TEST_PROVIDER_ID, TEST_API_KEY),
      });
      expect(dnsSpy).toHaveBeenCalledTimes(1);
      expect(dnsSpy).toHaveBeenCalledWith('api.robase.dev', { all: true, verbatim: true });
      expect(observations.requests).toHaveLength(1);
      expect(observations.requests[0]).toMatchObject({
        protocol: 'https:',
        hostname: 'api.robase.dev',
        port: 443,
        servername: 'api.robase.dev',
        path: '/v1/sms/send',
        method: 'POST',
        agent: false,
      });
      expect(observations.requests[0]!.rejectUnauthorized).not.toBe(false);
      expect(observations.requests[0]!.checkServerIdentity).toBeUndefined();
      expect(observations.lookups[0]!.options.all).toBe(true);
      expect(observations.lookups[0]!.args).toEqual([null, [PINNED_V4]]);
      expect(serverRequests).toHaveLength(1);
      expect(serverRequests[0]).toMatchObject({ method: 'POST', path: '/v1/sms/send' });
      expect(serverNames).toEqual(['api.robase.dev']);
      expect(serverRequests[0]!.headers['authorization']).toBe(`Bearer ${TEST_API_KEY}`);
      expect(serverRequests[0]!.headers['content-type']).toBe('application/json');
      expect(serverRequests[0]!.headers['idempotency-key']).toBe(
        'transfer.completed:local-test:local-recipient:SMS',
      );
      expect(JSON.parse(serverRequests[0]!.body)).toEqual({
        phone_number: '+2348012345678',
        message: 'Synthetic local transport test',
        metadata: { event_type: 'transfer.completed' },
      });

      status = 302;
      expect(await provider.send(request)).toEqual({
        success: false,
        error: 'ROBASE_EGRESS_BLOCKED',
      });
      // One second request received the redirect; no request was sent to /stolen.
      expect(serverRequests).toHaveLength(2);
      expect(serverRequests.map((entry) => entry.path)).toEqual(['/v1/sms/send', '/v1/sms/send']);
      expect(requestSpy).toHaveBeenCalledTimes(2);
    } finally {
      requestSpy.mockRestore();
      dnsSpy.mockRestore();
    }
  });

  it('rejects an untrusted TLS certificate without sending the request', async () => {
    const observations: TransportObservations = { requests: [], lookups: [] };
    const fetch = createPinnedProviderHttpFetch({
      lookupImpl: () => Promise.resolve([PINNED_V4]),
      requestImpl: loopbackRequestImpl(port, true, false, observations),
    });

    await expect(fetch(ROBASE_URL, init())).rejects.toMatchObject({
      code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    });
    expect(serverRequests).toHaveLength(0);
  });

  it('rejects a trusted certificate for a different approved provider hostname', async () => {
    const observations: TransportObservations = { requests: [], lookups: [] };
    const fetch = createPinnedProviderHttpFetch({
      lookupImpl: () => Promise.resolve([PINNED_V4]),
      requestImpl: loopbackRequestImpl(port, true, true, observations),
    });

    await expect(fetch('https://api.brevo.com/v3/smtp/email', init())).rejects.toMatchObject({
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    });
    expect(observations.requests[0]!.servername).toBe('api.brevo.com');
    expect(serverNames).toEqual(['api.brevo.com']);
    expect(serverRequests).toHaveLength(0);
  });
});
