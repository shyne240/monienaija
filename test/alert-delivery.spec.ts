import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { NoneAlertChannel } from '../src/operations/alerting.service';
import type { Alert } from '../src/operations/alerting.types';
import {
  DEFAULT_TIMEOUT_MS,
  WebhookAlertChannel,
  createAlertChannel,
  resolveWebhookConfig,
  signAlertBody,
  validateWebhookUrl,
  verifyAlertSignature,
} from '../src/operations/alert-webhook.channel';

function readSource(file: string): string {
  return readFileSync(join(__dirname, '..', file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * ARENA 3D Group 38 — actual alert delivery.
 *
 * Group 19 built alert evaluation with a delivery seam whose only implementation reported
 * `delivered: false`. That was the honest default, and it meant that until this group **no alert had
 * ever left the process**.
 *
 * These tests deliver over a **real socket** to a real HTTP receiver on loopback: a genuine request,
 * genuine headers, a genuine HMAC over the genuine bytes, and a genuine status code. What is not real
 * is the destination — no paging provider, no on-call system, no external channel was contacted, and
 * no assertion here claims one was.
 */

const SECRET = 'test-webhook-secret-not-a-credential';

const ALERT: Alert = {
  dedupeKey: 'outbox.backlog',
  ruleId: 'outbox.backlog',
  severity: 'CRITICAL',
  urgency: 'IMMEDIATE',
  summary: 'Outbox backlog is 812 events',
  observedAt: '2026-11-18T00:00:00.000Z',
  context: {},
} satisfies Alert;

interface Received {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

function startReceiver(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ server: Server; url: string; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    request.on('end', () => {
      received.push({
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        body,
      });
      handler(request, response);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${String(port)}/alerts`, received });
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

describe('alert delivery — a real receiver', () => {
  it('delivers over the socket and the receiver verifies the signature', async () => {
    const { server, url, received } = await startReceiver((_request, response) => {
      response.writeHead(204).end();
    });

    try {
      const config = resolveWebhookConfig({
        ALERT_WEBHOOK_URL: url,
        ALERT_WEBHOOK_SECRET: SECRET,
        NODE_ENV: 'test',
      });
      expect(config).not.toBeNull();
      const channel = new WebhookAlertChannel(config!, undefined, () => 1_700_000_000_000);

      const result = await channel.deliver(ALERT);
      expect(result).toEqual({ delivered: true });

      expect(received).toHaveLength(1);
      const request = received[0]!;
      expect(request.method).toBe('POST');
      expect(request.headers['content-type']).toBe('application/json');

      const timestamp = String(request.headers['x-monienaija-timestamp']);
      const signature = String(request.headers['x-monienaija-signature']);
      expect(timestamp).toBe('1700000000000');
      expect(signature.startsWith('sha256=')).toBe(true);

      // The receiver checks exactly what the sender signed: the raw body, not a re-serialisation.
      const verification = verifyAlertSignature({
        secret: SECRET,
        timestamp,
        body: request.body,
        signature,
        nowMs: 1_700_000_000_000,
      });
      expect(verification).toEqual({ valid: true });

      // …and the alert that arrived is the alert that was evaluated.
      expect(JSON.parse(request.body)).toMatchObject({ dedupeKey: ALERT.dedupeKey });
    } finally {
      await close(server);
    }
  });

  it('rejects a tampered body, a wrong secret and a replayed timestamp', () => {
    const body = JSON.stringify(ALERT);
    const timestamp = '1700000000000';
    const signature = `sha256=${signAlertBody(SECRET, timestamp, body)}`;

    expect(
      verifyAlertSignature({ secret: SECRET, timestamp, body, signature, nowMs: 1_700_000_000_000 })
        .valid,
    ).toBe(true);

    const tampered = verifyAlertSignature({
      secret: SECRET,
      timestamp,
      body: body.replace('812', '1'),
      signature,
      nowMs: 1_700_000_000_000,
    });
    expect(tampered).toEqual({ valid: false, reason: 'signature mismatch' });

    const wrongSecret = verifyAlertSignature({
      secret: 'another-secret',
      timestamp,
      body,
      signature,
      nowMs: 1_700_000_000_000,
    });
    expect(wrongSecret.valid).toBe(false);

    const replayed = verifyAlertSignature({
      secret: SECRET,
      timestamp,
      body,
      signature,
      nowMs: 1_700_000_000_000 + 600_000,
    });
    expect(replayed.valid).toBe(false);
    expect(replayed.reason).toMatch(/outside the 300000ms window/);
  });

  it('reports a non-2xx as NOT delivered, with the status', async () => {
    const { server, url } = await startReceiver((_request, response) => {
      response.writeHead(503).end();
    });

    try {
      const channel = new WebhookAlertChannel({
        url,
        secret: SECRET,
        timeoutMs: 2_000,
      });
      const result = await channel.deliver(ALERT);
      expect(result).toEqual({ delivered: false, reason: 'receiver answered HTTP 503' });
    } finally {
      await close(server);
    }
  });

  it('reports a timeout as NOT delivered, rather than waiting forever', async () => {
    const { server, url } = await startReceiver(() => {
      // Deliberately never responds.
    });

    try {
      const channel = new WebhookAlertChannel({ url, secret: SECRET, timeoutMs: 50 });
      const result = await channel.deliver(ALERT);
      expect(result.delivered).toBe(false);
      expect(result.reason).toMatch(/timed out after 50ms/);
    } finally {
      await close(server);
    }
  });

  it('reports an unreachable receiver as NOT delivered', async () => {
    // Port 1 on loopback: reserved, so nothing is listening.
    const channel = new WebhookAlertChannel({
      url: 'http://127.0.0.1:1/alerts',
      secret: SECRET,
      timeoutMs: 2_000,
    });
    const result = await channel.deliver(ALERT);
    expect(result.delivered).toBe(false);
    expect(result.reason).toMatch(/delivery failed/);
  });
});

describe('alert delivery — configuration', () => {
  it('is dark unless both settings are present', () => {
    expect(resolveWebhookConfig({})).toBeNull();
    expect(createAlertChannel({})).toBeInstanceOf(NoneAlertChannel);
  });

  it('refuses a half-configured webhook instead of silently running dark', () => {
    expect(() =>
      resolveWebhookConfig({ ALERT_WEBHOOK_URL: 'https://alerts.example/hook' }),
    ).toThrow(/ALERT_WEBHOOK_SECRET is not/);
    expect(() => resolveWebhookConfig({ ALERT_WEBHOOK_SECRET: SECRET })).toThrow(
      /ALERT_WEBHOOK_URL is not/,
    );
  });

  it('refuses cleartext to a remote host, and in production even to loopback', () => {
    expect(() => validateWebhookUrl('http://alerts.example/hook', 'staging')).toThrow(
      /must be https/,
    );
    expect(() => validateWebhookUrl('http://127.0.0.1:9000/hook', 'production')).toThrow(
      /must be https/,
    );
    // The loopback exception exists for a local receiver, and only outside production.
    expect(validateWebhookUrl('http://127.0.0.1:9000/hook', 'development')).toBe(
      'http://127.0.0.1:9000/hook',
    );
    expect(validateWebhookUrl('https://alerts.example/hook', 'production')).toBe(
      'https://alerts.example/hook',
    );
  });

  it('rejects a nonsense timeout rather than defaulting it', () => {
    expect(() =>
      resolveWebhookConfig({
        ALERT_WEBHOOK_URL: 'https://alerts.example/hook',
        ALERT_WEBHOOK_SECRET: SECRET,
        ALERT_WEBHOOK_TIMEOUT_MS: 'soon',
      }),
    ).toThrow(/positive number of milliseconds/);
    expect(
      resolveWebhookConfig({
        ALERT_WEBHOOK_URL: 'https://alerts.example/hook',
        ALERT_WEBHOOK_SECRET: SECRET,
      })?.timeoutMs,
    ).toBe(DEFAULT_TIMEOUT_MS);
  });

  it('builds a configured webhook channel when asked', () => {
    const channel = createAlertChannel({
      ALERT_WEBHOOK_URL: 'https://alerts.example/hook',
      ALERT_WEBHOOK_SECRET: SECRET,
    });
    expect(channel).toBeInstanceOf(WebhookAlertChannel);
    expect(channel.name).toBe('webhook');
    expect(channel.configured).toBe(true);
  });
});

describe('alert delivery — what the seam never claimed', () => {
  it('has no retry, dead-letter or escalation logic', () => {
    // Named gaps, not implied ones: a failed delivery is reported and then forgotten (Group 19).
    const source = readSource('src/operations/alert-webhook.channel.ts');
    expect(source).not.toMatch(/retry|backoff|attempt/i);
    expect(source).not.toMatch(/page|oncall|on-call|roster/i);
    expect(source).not.toMatch(/queue|deadLetter|dead-letter/);
  });

  it('holds no credential and logs no secret', () => {
    const source = readSource('src/operations/alert-webhook.channel.ts');
    // The secret is only ever used as an HMAC key, never written into a body, a header or a message.
    expect(source).not.toMatch(/reason:\s*[^;]*secret/i);
    expect(source).not.toMatch(/console\.log/);
  });
});
