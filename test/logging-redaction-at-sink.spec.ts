import pino from 'pino';

import { redactSensitiveData } from '../src/common/sensitive-data-redaction';
import { buildPinoHttpOptions } from '../src/production/pino-config';

/**
 * ARENA 3D Group 16 — structured logging redaction at the sink.
 *
 * ## What was wrong, and how it was found
 *
 * The pino configuration had an extensive `redact.paths` list, and it was easy to conclude logging was
 * covered. Writing one log line and reading it showed otherwise: the paths only cover `req.*` and `res.*`,
 * so a *service* or *worker* log — which carries provider payloads, PINs and database coordinates — went to
 * the stream verbatim.
 *
 * The shared object redactor also missed the compound names that this codebase actually uses: its key list
 * is an exact match (`apikey`, `password`, `pin`), so `providerApiKey`, `agentPin`, `customerPin` and
 * `dbPassword` all passed through unchanged. `agentPin` appears 32 times in `src/`.
 *
 * These tests emit real log lines through a real pino instance built from the production options and assert
 * on the serialized output. A test that inspected the options object would have passed against the broken
 * configuration — the options looked complete; the output did not.
 */

function captureLines(): { lines: string[]; logger: () => pino.Logger } {
  const lines: string[] = [];
  const stream = {
    write: (chunk: string) => {
      lines.push(chunk);
    },
  };
  const options = buildPinoHttpOptions() as Record<string, unknown>;
  const logger = pino(
    {
      level: 'info',
      formatters: options.formatters,
      redact: options.redact,
    } as pino.LoggerOptions,
    stream as unknown as pino.DestinationStream,
  );
  return { lines, logger: () => logger };
}

describe('Group 16 — log redaction at the sink', () => {
  describe('service and worker logs are redacted, not just HTTP logs', () => {
    it('redacts a provider API key written by a non-HTTP logger', () => {
      // The exact shape the pre-existing `redact.paths` could not reach.
      const { lines, logger } = captureLines();
      logger().info({ event: 'provider_call', providerApiKey: 'sk_live_ABC123' }, 'done');
      expect(lines.join('')).not.toContain('sk_live_ABC123');
      expect(lines.join('')).toContain('[REDACTED]');
    });

    it('redacts PIN fields, which the exact-match list missed', () => {
      const { lines, logger } = captureLines();
      logger().info({ event: 'pin_verify', agentPin: '1234', customerPin: '9876' }, 'checked');
      const output = lines.join('');
      expect(output).not.toContain('1234');
      expect(output).not.toContain('9876');
    });

    it('redacts secrets nested one level down', () => {
      const { lines, logger } = captureLines();
      logger().info({ event: 'connect', nested: { dbPassword: 'hunter2' } }, 'connecting');
      expect(lines.join('')).not.toContain('hunter2');
    });

    it('redacts secrets in an array of provider payloads', () => {
      const { lines, logger } = captureLines();
      logger().info(
        {
          event: 'batch',
          items: [{ providerApiKey: 'sk_live_ONE' }, { providerApiKey: 'sk_live_TWO' }],
        },
        'batched',
      );
      const output = lines.join('');
      expect(output).not.toContain('sk_live_ONE');
      expect(output).not.toContain('sk_live_TWO');
    });
  });

  describe('legitimate diagnostic data survives', () => {
    it('keeps non-secret fields, including ones that merely contain a secret word', () => {
      // A suffix rule would have swallowed these. The prefix rule over a named qualifier list does not.
      // This is the assertion that keeps the redactor from quietly destroying operational value.
      const { lines, logger } = captureLines();
      logger().info(
        {
          event: 'pin_attempts',
          pinAttemptCount: 3,
          tokenCount: 7,
          codeReviewStatus: 'approved',
          status: 'ok',
          eventId: 'evt_123',
        },
        'probe',
      );
      const output = lines.join('');
      expect(output).toContain('"pinAttemptCount":3');
      expect(output).toContain('"tokenCount":7');
      expect(output).toContain('"codeReviewStatus":"approved"');
      expect(output).toContain('"status":"ok"');
      expect(output).toContain('"eventId":"evt_123"');
    });

    it('keeps the message and level intact', () => {
      const { lines, logger } = captureLines();
      logger().warn({ event: 'slow_tick' }, 'tick exceeded budget');
      const output = lines.join('');
      expect(output).toContain('"level":40');
      expect(output).toContain('tick exceeded budget');
    });
  });

  describe('HTTP redaction still applies', () => {
    it('redacts authorization headers through the path list', () => {
      const { lines, logger } = captureLines();
      logger().info(
        { req: { headers: { authorization: 'Bearer TOPSECRET' } }, event: 'http' },
        'req',
      );
      const output = lines.join('');
      expect(output).not.toContain('TOPSECRET');
      expect(output).toContain('[REDACTED]');
    });
  });

  describe('the object redactor itself', () => {
    it('redacts the compound names that this codebase uses', () => {
      const redacted = redactSensitiveData({
        providerApiKey: 'a',
        agentPin: 'b',
        customerPin: 'c',
        dbPassword: 'd',
        aggregatorSecret: 'e',
        bankingApiKey: 'f',
        kycProviderEncryptionKeyringJson: 'g',
        notificationProviderEncryptionKeyringJson: 'h',
        poaEncryptionKeyringJson: 'i',
      }) as Record<string, string>;
      for (const key of [
        'providerApiKey',
        'agentPin',
        'customerPin',
        'dbPassword',
        'aggregatorSecret',
        'bankingApiKey',
        'kycProviderEncryptionKeyringJson',
        'notificationProviderEncryptionKeyringJson',
        'poaEncryptionKeyringJson',
      ]) {
        expect(redacted[key]).toBe('[REDACTED]');
      }
    });

    it('normalizes separators and case before matching', () => {
      // `AGENT_PIN`, `agent-pin` and `agentPin` must all match; provider payloads are not consistent.
      for (const key of ['AGENT_PIN', 'agent-pin', 'AgentPin', 'agentPin']) {
        const redacted = redactSensitiveData({ [key]: '1234' }) as Record<string, string>;
        expect(redacted[key]).toBe('[REDACTED]');
      }
    });

    it('does not redact a benign key that merely starts with a qualifier', () => {
      const redacted = redactSensitiveData({
        agentName: 'Ade',
        customerReference: 'ref-1',
        providerStatus: 'UP',
      }) as Record<string, string>;
      expect(redacted.agentName).toBe('Ade');
      expect(redacted.customerReference).toBe('ref-1');
      expect(redacted.providerStatus).toBe('UP');
    });
  });

  describe('fails closed', () => {
    it('replaces the record rather than leaking it if redaction returns a non-object', () => {
      // Simulates budget exhaustion: the redactor returns `[REDACTED]`. Emitting the original object at that
      // point would defeat the hook precisely when the input was too large or too deep to inspect.
      const { lines, logger } = captureLines();
      const deep: Record<string, unknown> = { event: 'deep' };
      let cursor = deep;
      for (let index = 0; index < 200; index += 1) {
        const next: Record<string, unknown> = {};
        cursor.nested = next;
        cursor = next;
      }
      logger().info(deep, 'too deep');
      const output = lines.join('');
      expect(output).toContain('redactionFailure');
      expect(output).not.toContain('"nested"');
    });
  });
});
