import * as dns from 'node:dns';
import * as https from 'node:https';

import { isForbiddenOutboundIp } from '../notification/provider-security';

export type DojahEnvironment = 'production' | 'sandbox';
export type DojahPath = '/api/v1/kyc/bvn' | '/api/v1/kyc/nin/advance';
export type DojahQuery = Readonly<Record<string, string>>;
export type DojahTransport = (
  path: DojahPath,
  options: {
    environment: DojahEnvironment;
    authorization: string;
    appId: string;
    query: DojahQuery;
    signal: AbortSignal;
  },
) => Promise<{ status: number; body: unknown }>;

type Address = { address: string; family: number };
const HOSTS: Record<DojahEnvironment, string> = {
  production: 'api.dojah.io',
  sandbox: 'sandbox.dojah.io',
};
const pathQueries: Record<DojahPath, readonly string[]> = {
  '/api/v1/kyc/bvn': ['bvn', 'first_name', 'last_name', 'dob'],
  '/api/v1/kyc/nin/advance': ['nin'],
};
const MAX_BYTES = 2 * 1024 * 1024;

/** Fixed Dojah origins and paths, pinned DNS, verified TLS hostname, no redirects or retries. */
export function createDojahHttpsTransport(
  deps: {
    lookup?: (hostname: string) => Promise<Address[]>;
    request?: typeof https.request;
  } = {},
): DojahTransport {
  const lookup =
    deps.lookup ??
    ((hostname: string) => dns.promises.lookup(hostname, { all: true, verbatim: true }));
  const request = deps.request ?? https.request;
  return async (path, options) => {
    const hostname = HOSTS[options.environment];
    const allowedKeys = pathQueries[path];
    const queryKeys = Object.keys(options.query ?? {}).sort();
    if (
      !hostname ||
      !allowedKeys ||
      options.signal.aborted ||
      queryKeys.length !== allowedKeys.length ||
      queryKeys.some((key) => !allowedKeys.includes(key)) ||
      Object.values(options.query).some(
        (value) =>
          typeof value !== 'string' ||
          value.length < 1 ||
          value.length > 256 ||
          [...value].some((character) => {
            const code = character.charCodeAt(0);
            return code < 32 || code === 127;
          }),
      )
    )
      throw new Error('Blocked');

    const addresses = await lookup(hostname);
    if (
      options.signal.aborted ||
      !addresses.length ||
      addresses.some((address) => isForbiddenOutboundIp(address.address))
    )
      throw new Error('Blocked');
    const pinned = addresses[0]!;
    const search = new URLSearchParams();
    for (const key of allowedKeys) search.set(key, options.query[key]!);
    const requestPath = `${path}?${search.toString()}`;

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = () => {
        if (!settled) {
          settled = true;
          reject(new Error('Transport failure'));
        }
      };
      const req = request(
        {
          protocol: 'https:',
          hostname,
          port: 443,
          servername: hostname,
          path: requestPath,
          method: 'GET',
          agent: false,
          headers: {
            authorization: options.authorization,
            AppId: options.appId,
            accept: 'application/json',
          },
          lookup: (_host, lookupOptions, callback) => {
            if (lookupOptions.all)
              callback(null, [{ address: pinned.address, family: pinned.family }]);
            else callback(null, pinned.address, pinned.family);
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            response.resume();
            if (!settled) {
              settled = true;
              resolve({ status, body: null });
            }
            return;
          }
          let size = 0;
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BYTES) {
              req.destroy();
              fail();
              return;
            }
            chunks.push(chunk);
          });
          response.on('error', fail);
          response.on('aborted', fail);
          response.on('end', () => {
            if (settled) return;
            try {
              const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              settled = true;
              resolve({ status, body });
            } catch {
              fail();
            }
          });
        },
      );
      const abort = () => {
        req.destroy();
        fail();
      };
      options.signal.addEventListener('abort', abort, { once: true });
      req.on('error', fail);
      req.on('close', () => options.signal.removeEventListener('abort', abort));
      if (options.signal.aborted) {
        abort();
        return;
      }
      req.end();
    });
  };
}

export const dojahHttpsTransport = createDojahHttpsTransport();
