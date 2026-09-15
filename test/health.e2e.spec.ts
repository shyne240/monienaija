import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
// Supertest uses CommonJS callable exports.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { DataSource } from 'typeorm';

import { HealthController } from '../src/health/health.controller';
import { HealthService } from '../src/health/health.service';
import { DiagnosticsService } from '../src/operations/diagnostics.service';

interface HealthResponse {
  status: string;
  timestamp: string;
}

describe('health endpoints', () => {
  let app: NestFastifyApplication;
  const dataSource = { query: jest.fn<Promise<unknown>, [string]>() };

  beforeEach(async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [HealthService, { provide: DataSource, useValue: dataSource }],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns liveness from GET /api/v1/health', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    const body = response.body as HealthResponse;
    expect(body).toMatchObject({ status: 'ok' });
    expect(new Date(body.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('returns readiness after verifying PostgreSQL connectivity', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);

    const body = response.body as HealthResponse;
    expect(body).toMatchObject({ status: 'ok' });
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
  });
});

describe('public readiness information disclosure', () => {
  let app: NestFastifyApplication;
  const dataSource = { query: jest.fn<Promise<unknown>, [string]>() };
  const diagnosticsService = { getDiagnostics: jest.fn<Promise<unknown>, []>() };

  const buildApp = async (): Promise<void> => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: DataSource, useValue: dataSource },
        { provide: DiagnosticsService, useValue: diagnosticsService },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
  });

  afterEach(async () => {
    await app?.close();
  });

  it('never returns operational diagnostics to an anonymous caller when ready', async () => {
    diagnosticsService.getDiagnostics.mockResolvedValue({
      status: 'ok',
      version: '0.1.0',
      database: { status: 'ok' },
      migrations: { status: 'ok', appliedCount: 53 },
      reconciliation: { status: 'PASS' },
      pendingOutbox: 0,
      timestamp: new Date().toISOString(),
    });
    await buildApp();

    const response = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);

    const serialized = JSON.stringify(response.body);
    expect(response.body).toMatchObject({ status: 'ok' });
    expect(response.body).not.toHaveProperty('diagnostics');
    for (const fragment of [
      'appliedCount',
      'migrations',
      'reconciliation',
      'pendingOutbox',
      'version',
    ]) {
      expect(serialized).not.toContain(fragment);
    }
  });

  it('reports degraded readiness as 503 without exposing diagnostics detail', async () => {
    diagnosticsService.getDiagnostics.mockResolvedValue({
      status: 'degraded',
      version: '0.1.0',
      database: { status: 'degraded' },
      migrations: { status: 'ok', appliedCount: 53 },
      reconciliation: { status: 'ERROR' },
      pendingOutbox: 7,
      timestamp: new Date().toISOString(),
    });
    await buildApp();

    const response = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);

    const serialized = JSON.stringify(response.body);
    expect(serialized).toContain('Service dependencies are degraded');
    for (const fragment of [
      'appliedCount',
      'migrations',
      'reconciliation',
      'pendingOutbox',
      'diagnostics',
    ]) {
      expect(serialized).not.toContain(fragment);
    }
  });
});
