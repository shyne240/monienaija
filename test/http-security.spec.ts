import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
// Supertest uses CommonJS callable exports.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { DataSource } from 'typeorm';

import { validateEnvironment, type Environment } from '../src/config/environment';
import { HealthController } from '../src/health/health.controller';
import { HealthService } from '../src/health/health.service';
import {
  applyHttpSecurity,
  corsOriginsFromJson,
  fastifyAdapterOptions,
  securityHeaders,
} from '../src/production/http-security';

function environment(overrides: Record<string, string> = {}): Environment {
  return validateEnvironment({
    NODE_ENV: 'test',
    DB_HOST: 'localhost',
    DB_NAME: 'monienaija',
    DB_USER: 'monienaija',
    DB_PASSWORD: 'local-test-password',
    ...overrides,
  });
}

describe('http security configuration', () => {
  it('defaults to a 1 MiB body limit with proxy trust disabled', () => {
    const options = fastifyAdapterOptions(environment());

    expect(options).toEqual({ bodyLimit: 1_048_576, trustProxy: false });
  });

  it('accepts an explicit body limit and proxy trust setting', () => {
    const options = fastifyAdapterOptions(
      environment({ HTTP_BODY_LIMIT_BYTES: '2048', HTTP_TRUST_PROXY: 'true' }),
    );

    expect(options).toEqual({ bodyLimit: 2048, trustProxy: true });
  });

  it('rejects an out-of-range body limit at startup', () => {
    expect(() => environment({ HTTP_BODY_LIMIT_BYTES: '10' })).toThrow(/HTTP_BODY_LIMIT_BYTES/);
  });

  it('keeps CORS disabled when no origin is configured', () => {
    expect(corsOriginsFromJson(undefined)).toEqual({ origins: [], configured: false });
  });

  it.each([
    ['a wildcard origin', '["*"]'],
    ['a relative origin', '["/admin"]'],
    ['an origin with a path', '["https://admin.example.com/app"]'],
    ['a duplicate origin', '["https://admin.example.com","https://admin.example.com"]'],
    ['malformed JSON', '['],
  ])('rejects %s', (_label, value) => {
    expect(() => corsOriginsFromJson(value)).toThrow(/HTTP_CORS_ORIGINS_JSON/);
  });

  it('accepts explicit https origins and is validated at startup', () => {
    const configured = environment({
      HTTP_CORS_ORIGINS_JSON: '["https://admin.example.com","http://localhost:5173"]',
    });

    expect(corsOriginsFromJson(configured.HTTP_CORS_ORIGINS_JSON)).toEqual({
      origins: ['https://admin.example.com', 'http://localhost:5173'],
      configured: true,
    });
    expect(() => environment({ HTTP_CORS_ORIGINS_JSON: '["*"]' })).toThrow(
      /HTTP_CORS_ORIGINS_JSON/,
    );
  });

  it('emits HSTS only in the production profile', () => {
    expect(securityHeaders(environment())['strict-transport-security']).toBeUndefined();
    expect(
      securityHeaders(
        environment({ NODE_ENV: 'production', DB_PASSWORD: 'a-strong-unique-password-value' }),
      )['strict-transport-security'],
    ).toBe('max-age=31536000; includeSubDomains');
  });
});

describe('hardened http surface', () => {
  const dataSource = { query: jest.fn<Promise<unknown>, [string]>() };

  async function boot(overrides: Record<string, string> = {}) {
    const env = environment(overrides);
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [HealthService, { provide: DataSource, useValue: dataSource }],
    }).compile();

    const app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(fastifyAdapterOptions(env)),
    );
    app.setGlobalPrefix('api/v1');
    applyHttpSecurity(app, env);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return app;
  }

  beforeEach(() => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
  });

  it('sets defensive security headers on every response', async () => {
    const app = await boot();
    try {
      const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
      expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(response.headers['strict-transport-security']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('does not send CORS headers when no origin is configured', async () => {
    const app = await boot();
    try {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set({ origin: 'https://attacker.example.com' })
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('allows only the configured origin and never a wildcard', async () => {
    const app = await boot({ HTTP_CORS_ORIGINS_JSON: '["https://admin.example.com"]' });
    try {
      const allowed = await request(app.getHttpServer())
        .options('/api/v1/health')
        .set({ origin: 'https://admin.example.com', 'access-control-request-method': 'GET' })
        .expect(204);
      expect(allowed.headers['access-control-allow-origin']).toBe('https://admin.example.com');
      expect(allowed.headers.vary).toContain('Origin');

      const denied = await request(app.getHttpServer())
        .options('/api/v1/health')
        .set({ origin: 'https://attacker.example.com', 'access-control-request-method': 'GET' });
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('rejects a payload above the configured body limit with 413', async () => {
    const app = await boot({ HTTP_BODY_LIMIT_BYTES: '2048' });
    try {
      await request(app.getHttpServer())
        .post('/api/v1/health')
        .set('content-type', 'application/json')
        .send({ padding: 'x'.repeat(4096) })
        .expect(413);
    } finally {
      await app.close();
    }
  });
});
