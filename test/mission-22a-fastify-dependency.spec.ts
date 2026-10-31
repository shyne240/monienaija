import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';

interface UriApi {
  parse(value: string): { error?: string; host?: string; scheme?: string };
  serialize(components: Record<string, unknown>): string;
  normalize(value: string): string;
}

const consumers = [
  { name: '@fastify/ajv-compiler', major: 3, minimum: [1, 9] },
  { name: 'ajv', major: 3, minimum: [1, 9] },
  { name: 'fast-json-stringify', major: 4, minimum: [2, 3] },
] as const;

describe.each(consumers)('Mission 22A — fast-uri loaded by $name', ({ name, major, minimum }) => {
  const fromConsumer = createRequire(require.resolve(`${name}/package.json`));
  const uri = fromConsumer('fast-uri') as UriApi;
  const version = (fromConsumer('fast-uri/package.json') as { version: string }).version;

  it('uses a compatible version outside the known vulnerable ranges', () => {
    const [actualMajor, minor, patch] = version.split('.').map(Number);
    expect(actualMajor).toBe(major);
    expect(Number.isInteger(minor) && Number.isInteger(patch)).toBe(true);
    expect(minor! > minimum[0] || (minor === minimum[0] && patch! >= minimum[1])).toBe(true);
  });

  it('rejects authority injection through a non-numeric port', () => {
    expect(() => uri.serialize({
      scheme: 'http', host: 'trusted.example', port: '@127.0.0.1:8124', path: '/app',
    })).toThrow('URI port is malformed.');
  });

  it('reports an unclosed bracket host instead of accepting an ambiguous authority', () => {
    expect(uri.parse('http://user@[@127.0.0.1:8123/admin').error).toBe('URI host is malformed.');
  });

  it('does not normalize an encoded scheme into an executable scheme', () => {
    const input = '%6Aavascript:alert(1)';
    expect(uri.parse(input).error).toBe('URI scheme is malformed.');
    expect(uri.normalize(input)).toBe(input);
  });

  it('rejects a multiple-at authority and keeps valid URI processing intact', () => {
    expect(uri.parse('http://a@b@evil.example/').error).toBe('URI host is malformed.');
    expect(uri.serialize({ scheme: 'https', host: 'example.test', port: 8443, path: '/health' }))
      .toBe('https://example.test:8443/health');
    const ipv6 = uri.parse('http://[::1]:8080/health');
    expect(ipv6.host).toBe('::1');
    expect(ipv6.error).toBeUndefined();
  });
});

describe('Mission 22A — Fastify real TCP schema validation and response serialization', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.addSchema({
      $id: 'https://schemas.example.test/mission-22a.json',
      type: 'object',
      required: ['name', 'amount'],
      additionalProperties: false,
      properties: { name: { type: 'string', minLength: 1 }, amount: { type: 'integer', minimum: 1 } },
    });
    app.post<{ Body: { name: string; amount: number } }>('/schema-check', {
      schema: {
        body: { $ref: 'https://schemas.example.test/mission-22a.json#' },
        response: {
          200: {
            type: 'object', required: ['status', 'payload'], additionalProperties: false,
            properties: {
              status: { type: 'string' },
              payload: { $ref: 'https://schemas.example.test/mission-22a.json#' },
            },
          },
        },
      },
    }, (request) => Promise.resolve({ status: 'ok', payload: request.body, notInResponseSchema: 'omitted' }));
    await app.listen({ host: '0.0.0.0', port: 0 });
    baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => { if (app) await app.close(); });

  it('starts and validates/serializes a valid request through external $ref schemas', async () => {
    const response = await fetch(`${baseUrl}/schema-check`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Synthetic Agent', amount: 25 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', payload: { name: 'Synthetic Agent', amount: 25 } });
  });

  it('rejects invalid schema input with 400', async () => {
    const response = await fetch(`${baseUrl}/schema-check`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Synthetic Agent', amount: -1 }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects malformed JSON with 400', async () => {
    const response = await fetch(`${baseUrl}/schema-check`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{broken',
    });
    expect(response.status).toBe(400);
  });
});
