import * as dns from 'node:dns';
import * as https from 'node:https';

import { isForbiddenOutboundIp } from '../notification/provider-security';

export type DojahEnvironment = 'production' | 'sandbox';
export type DojahPath = '/api/v1/kyc/bvn' | '/api/v1/kyc/nin/advance' | '/api/v1/kyc/address';
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

/**
 * Address verification is a separate documented surface: `POST /api/v1/kyc/address` submits, and
 * `GET /api/v1/kyc/address?reference_id=…` polls. It is therefore a distinct transport rather than
 * an overload of the read-only `DojahTransport`, so no existing adapter can accidentally start
 * issuing a billable POST. Only documented body fields are accepted, in canonical form.
 */
export type DojahAddressSubmission = {
  firstName: string;
  lastName: string;
  middleName?: string;
  dob?: string;
  gender?: string;
  mobile: string;
  street: string;
  landmark?: string;
  lga: string;
  state: string;
};
export type DojahAddressTransport = {
  submit(
    body: DojahAddressSubmission,
    options: {
      environment: DojahEnvironment;
      authorization: string;
      appId: string;
      signal: AbortSignal;
    },
  ): Promise<{ status: number; body: unknown }>;
  poll(
    referenceId: string,
    options: {
      environment: DojahEnvironment;
      authorization: string;
      appId: string;
      signal: AbortSignal;
    },
  ): Promise<{ status: number; body: unknown }>;
};

type Address = { address: string; family: number };
const HOSTS: Record<DojahEnvironment, string> = {
  production: 'api.dojah.io',
  sandbox: 'sandbox.dojah.io',
};
/** Query keys permitted per read-only path. `address` has its own transport (submit/poll). */
const pathQueries: Record<Exclude<DojahPath, '/api/v1/kyc/address'>, readonly string[]> = {
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
    const allowedKeys = pathQueries[path as Exclude<DojahPath, '/api/v1/kyc/address'>];
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

// ---------------------------------------------------------------------------------------------
// Address verification transport (documented `POST`/`GET /api/v1/kyc/address`).
// ---------------------------------------------------------------------------------------------

const ADDRESS_REFERENCE = /^[A-Za-z0-9_-]{8,128}$/;
const ADDRESS_NAME = /^[A-Za-z][A-Za-z' -]{0,99}$/;
const ADDRESS_OPTIONAL_TEXT = /^[A-Za-z0-9][A-Za-z0-9' .,#/-]{0,199}$/;
const ADDRESS_MOBILE = /^[0-9+][0-9]{6,19}$/;
const ADDRESS_DOB = /^\d{4}-\d{2}-\d{2}$/;

/** Only the documented body fields, each validated against its documented shape. */
function addressBody(input: DojahAddressSubmission): Record<string, string> {
  const required: Array<[string, string, RegExp]> = [
    ['first_name', input.firstName, ADDRESS_NAME],
    ['last_name', input.lastName, ADDRESS_NAME],
    ['mobile', input.mobile, ADDRESS_MOBILE],
    ['street', input.street, ADDRESS_OPTIONAL_TEXT],
    ['lga', input.lga, ADDRESS_OPTIONAL_TEXT],
    ['state', input.state, ADDRESS_OPTIONAL_TEXT],
  ];
  const body: Record<string, string> = {};
  for (const [key, value, pattern] of required) {
    if (typeof value !== 'string' || !pattern.test(value)) throw new Error('Blocked');
    body[key] = value;
  }
  const optional: Array<[string, string | undefined, RegExp]> = [
    ['middle_name', input.middleName, ADDRESS_NAME],
    ['dob', input.dob, ADDRESS_DOB],
    ['gender', input.gender, /^[A-Za-z]{4,10}$/],
    ['landmark', input.landmark, ADDRESS_OPTIONAL_TEXT],
  ];
  for (const [key, value, pattern] of optional) {
    if (value === undefined) continue;
    if (typeof value !== 'string' || !pattern.test(value)) throw new Error('Blocked');
    body[key] = value;
  }
  return body;
}

/**
 * Fixed origin, pinned DNS, verified TLS hostname, bounded body, no redirects and no automatic
 * retries. Redirects are treated as failures rather than followed, so a compromised or
 * misconfigured origin cannot move a billable call to another host.
 */
export function createDojahAddressHttpsTransport(
  deps: {
    lookup?: (hostname: string) => Promise<Address[]>;
    request?: typeof https.request;
  } = {},
): DojahAddressTransport {
  const lookup =
    deps.lookup ??
    ((hostname: string) => dns.promises.lookup(hostname, { all: true, verbatim: true }));
  const request = deps.request ?? https.request;

  const call = async (
    method: 'POST' | 'GET',
    path: string,
    payload: string | null,
    options: {
      environment: DojahEnvironment;
      authorization: string;
      appId: string;
      signal: AbortSignal;
    },
  ) => {
    const hostname = HOSTS[options.environment];
    if (!hostname || options.signal.aborted) throw new Error('Blocked');
    const addresses = await lookup(hostname);
    if (
      options.signal.aborted ||
      !addresses.length ||
      addresses.some((address) => isForbiddenOutboundIp(address.address))
    )
      throw new Error('Blocked');
    const pinned = addresses[0]!;

    return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
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
          path,
          method,
          agent: false,
          headers: {
            authorization: options.authorization,
            AppId: options.appId,
            accept: 'application/json',
            ...(payload
              ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
              : {}),
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
              reject(new Error('Redirect refused'));
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
      req.end(payload ?? undefined);
    });
  };

  return {
    async submit(body, options) {
      const payload = JSON.stringify(addressBody(body));
      return call('POST', '/api/v1/kyc/address', payload, options);
    },
    async poll(referenceId, options) {
      if (typeof referenceId !== 'string' || !ADDRESS_REFERENCE.test(referenceId))
        throw new Error('Blocked');
      const search = new URLSearchParams({ reference_id: referenceId });
      return call('GET', `/api/v1/kyc/address?${search.toString()}`, null, options);
    },
  };
}

export const dojahAddressHttpsTransport = createDojahAddressHttpsTransport();
