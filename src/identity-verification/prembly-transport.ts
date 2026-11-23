import * as dns from 'node:dns';
import * as https from 'node:https';

import { isForbiddenOutboundIp } from '../notification/provider-security';

export type PremblyVerificationPath = '/verification/bvn_validation' | '/verification/vnin-basic';

export type PremblyTransport = (
  path: PremblyVerificationPath,
  options: {
    apiKey: string;
    number: string;
    timeoutMs: number;
    signal: AbortSignal;
  },
) => Promise<{ status: number; body: unknown }>;

type Address = { address: string; family: number };

const PREMBLY_HOST = 'api.prembly.com';
const MAX_RESPONSE_BYTES = 512 * 1024;
const IDENTITY_NUMBER = /^\d{11}$/;
// eslint-disable-next-line no-control-regex -- Control bytes are forbidden in provider credentials.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Fixed-host Prembly BVN/NIN Basic transport. Requests use the documented x-api-key header only;
 * there is no redirect following, retry, arbitrary URL, response logging or error-body forwarding.
 */
export function createPremblyHttpsTransport(
  deps: {
    lookup?: (hostname: string) => Promise<Address[]>;
    request?: typeof https.request;
  } = {},
): PremblyTransport {
  const lookup =
    deps.lookup ??
    ((hostname: string) => dns.promises.lookup(hostname, { all: true, verbatim: true }));
  const request = deps.request ?? https.request;

  return async (path, options) => {
    if (
      !['/verification/bvn_validation', '/verification/vnin-basic'].includes(path) ||
      typeof options.apiKey !== 'string' ||
      options.apiKey.trim().length < 16 ||
      options.apiKey.length > 512 ||
      CONTROL_CHARACTERS.test(options.apiKey) ||
      !IDENTITY_NUMBER.test(options.number) ||
      !Number.isSafeInteger(options.timeoutMs) ||
      options.timeoutMs < 1000 ||
      options.timeoutMs > 30000 ||
      options.signal.aborted
    ) {
      throw new Error('Prembly transport blocked');
    }

    const addresses = await lookup(PREMBLY_HOST);
    if (
      options.signal.aborted ||
      !addresses.length ||
      addresses.some((address) => isForbiddenOutboundIp(address.address))
    ) {
      throw new Error('Prembly transport blocked');
    }
    const pinned = addresses[0]!;
    const body = JSON.stringify({ number: options.number });

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = () => {
        if (!settled) {
          settled = true;
          reject(new Error('Prembly transport failure'));
        }
      };
      const req = request(
        {
          protocol: 'https:',
          hostname: PREMBLY_HOST,
          port: 443,
          servername: PREMBLY_HOST,
          path,
          method: 'POST',
          agent: false,
          headers: {
            'x-api-key': options.apiKey,
            accept: 'application/json',
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
          lookup: (_hostname, lookupOptions, callback) => {
            if (lookupOptions.all) {
              callback(null, [{ address: pinned.address, family: pinned.family }]);
            } else {
              callback(null, pinned.address, pinned.family);
            }
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
            if (size > MAX_RESPONSE_BYTES) {
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
              const responseBody: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              settled = true;
              resolve({ status, body: responseBody });
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
      req.setTimeout(options.timeoutMs, () => {
        req.destroy();
        fail();
      });
      options.signal.addEventListener('abort', abort, { once: true });
      req.on('error', fail);
      req.on('close', () => options.signal.removeEventListener('abort', abort));
      if (options.signal.aborted) {
        abort();
        return;
      }
      req.end(body);
    });
  };
}

export const premblyHttpsTransport = createPremblyHttpsTransport();
