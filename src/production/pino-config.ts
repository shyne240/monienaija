import type { FastifyRequest } from 'fastify';
import type { Options as PinoHttpOptions } from 'pino-http';

import {
  redactRequestUrl,
  redactSensitiveData,
  sanitizeDiagnosticParams,
} from '../common/sensitive-data-redaction';
import { getRequestContext } from './request-context';

/**
 * Report 25 boundary extraction: the pino-http wiring previously inlined in
 * `AppModule`. It is exported so the production logging configuration can be
 * exercised end-to-end (real request logs through the production redaction and
 * context properties) from tests without bootstrapping `main.ts`. The module
 * still consumes it verbatim via `LoggerModule.forRoot({ pinoHttp: ... })`.
 */
export function buildPinoHttpOptions(): PinoHttpOptions {
  return {
    level: process.env.LOG_LEVEL ?? 'info',
    /**
     * Group 16: object-level redaction for **every** log record, not only HTTP ones.
     *
     * The `redact.paths` list below is path-based and covers `req.*` / `res.*` only. That left service and
     * worker logs — which carry provider payloads, PINs and DB coordinates — entirely unredacted. Measured,
     * not assumed: a plain pino instance with these paths wrote
     * `{ providerApiKey, customerPin, nested: { dbPassword } }` to the stream verbatim.
     *
     * `formatters.log` runs for every record from every logger, so it is the only place that can cover both
     * HTTP and non-HTTP sinks. The redactor is the existing, already-adversarially-tested one; this hook only
     * decides *where* it applies.
     *
     * Ordering matters: this runs **before** the `redact` paths, so `req`/`res` objects are already handled
     * here, and the path-based list remains as defence in depth for shapes this walker might skip.
     */
    formatters: {
      log: (object) => {
        const redacted = redactSensitiveData(object);
        // Fail closed. If the redactor ever returns a non-object (it returns `[REDACTED]` on budget
        // exhaustion or an unexpected shape), emitting the original object would defeat the hook entirely.
        return redacted !== null && typeof redacted === 'object' && !Array.isArray(redacted)
          ? (redacted as Record<string, unknown>)
          : { redactionFailure: true };
      },
    },
    genReqId: (request) => getRequestContext(request as unknown as FastifyRequest).requestId,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-api-key',
        // Report 25: pino-http logs `req.headers` wholesale into every request
        // log, so the client-controlled identity headers (also echoed into
        // responses and persisted context) and proxy credentials are censored
        // at the logging boundary too. Their values are additionally sanitized
        // at creation — see `safeIdentifier` in `request-context.ts`.
        'req.headers.x-request-id',
        'req.headers.x-correlation-id',
        'req.headers.x-trace-id',
        'req.headers.proxy-authorization',
        // Report 25 fail-safe: the custom `req` serializer below no longer
        // emits the parsed query object, but this path permanently censors it
        // should any future serializer change reintroduce it.
        'req.query',
        'req.body.password',
        'req.body.passcode',
        'req.body.passcodeConfirmation',
        'req.body.pinConfirmation',
        'req.body.currentPassword',
        'req.body.newPassword',
        'req.body.temporaryPassword',
        'req.body.passwordHash',
        'req.body.pin',
        'req.body.customerPin',
        'req.body.agentPin',
        'req.body.otp',
        'req.body.pinHash',
        'req.body.token',
        'req.body.tokenHash',
        'req.body.accessToken',
        'req.body.applicantAccessToken',
        'req.body.refreshToken',
        'req.body.secret',
        'req.body.apiKey',
        'req.body.code',
        'req.body.identifier',
        'req.body.bvn',
        'req.body.nin',
        'req.body.codeHash',
        'req.body.challengeHash',
        'req.body.transferCode',
        'req.body.transferCodeHash',
        'req.body.providedHash',
        'req.body.deviceFingerprintHash',
        'req.body.fingerprintHash',
        'res.headers.set-cookie',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      // Report 25: the pino-http default request serializer emits the raw
      // `url` (query string included) and the parsed `query` object into every
      // request log — a credential-carrier sink equivalent to the exception
      // payloads fixed in report 19. The production serializer therefore drops
      // `query` entirely, normalizes `url` through the shared request-URL
      // boundary (query/fragment excluded, percent-decoded, redacted) and
      // sanitizes route `params` values. `headers` passes through by reference
      // so the fast-redact paths above (authorization/cookie/x-api-key and the
      // identity headers) still apply.
      req: (request) => {
        const source = request as Record<string, unknown>;
        const output: Record<string, unknown> = {
          id: source.id,
          method: source.method,
          url: redactRequestUrl(source.url),
          headers: source.headers,
          remoteAddress: source.remoteAddress,
          remotePort: source.remotePort,
        };
        const params = sanitizeDiagnosticParams(source.params);
        if (Object.keys(params).length > 0) {
          output.params = params;
        }
        return output;
      },
    },
    customProps: (request) => getRequestContext(request as unknown as FastifyRequest),
  };
}
