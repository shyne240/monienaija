import * as dns from 'node:dns';
import * as https from 'node:https';

import { isForbiddenOutboundIp } from '../notification/provider-security';

// Closed paths and origin: no redirects, dynamic URLs, query strings or configurable host.
export type MonnifyPath =
  | '/api/v1/auth/login'
  | '/api/v1/vas/bvn-details-match'
  | '/api/v1/vas/bvn-account-match'
  | '/api/v1/vas/nin-details';
export type MonnifyTransport = (
  path: MonnifyPath,
  options: {
    authorization: string;
    body?: string;
    signal: AbortSignal;
  },
) => Promise<{ status: number; body: unknown }>;

const paths = new Set<string>([
  '/api/v1/auth/login',
  '/api/v1/vas/bvn-details-match',
  '/api/v1/vas/bvn-account-match',
  '/api/v1/vas/nin-details',
]);
const MAX_BYTES = 256 * 1024;

/** No fetch/redirect handling; resolve once, reject non-public addresses, pin IP and verify TLS hostname. */
export function createMonnifyHttpsTransport(
  deps: {
    lookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
    request?: typeof https.request;
  } = {},
): MonnifyTransport {
  const lookup =
    deps.lookup ??
    ((hostname: string) => dns.promises.lookup(hostname, { all: true, verbatim: true }));
  const request = deps.request ?? https.request;
  return async (path, options) => {
    if (!paths.has(path) || options.signal.aborted) throw new Error('Blocked');
    const hostname = 'api.monnify.com';
    const addresses = await lookup(hostname);
    if (
      options.signal.aborted ||
      !addresses.length ||
      addresses.some((a) => isForbiddenOutboundIp(a.address))
    ) {
      throw new Error('Blocked');
    }
    const pinned = addresses[0]!;
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
          path,
          method: 'POST',
          agent: false,
          headers: { authorization: options.authorization, 'content-type': 'application/json' },
          lookup: (_host, opts, callback) => {
            if (opts.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
            else callback(null, pinned.address, pinned.family);
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            res.resume();
            if (!settled) {
              settled = true;
              resolve({ status, body: null });
            }
            return;
          }
          let size = 0;
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BYTES) {
              req.destroy();
              fail();
              return;
            }
            chunks.push(chunk);
          });
          res.on('error', fail);
          res.on('aborted', fail);
          res.on('end', () => {
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
      if (options.body !== undefined) req.write(options.body);
      req.end();
    });
  };
}

export const monnifyHttpsTransport = createMonnifyHttpsTransport();
