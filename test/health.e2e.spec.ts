import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
// Supertest uses CommonJS callable exports.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { DataSource } from 'typeorm';

import { HealthController } from '../src/health/health.controller';
import { HealthService } from '../src/health/health.service';

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
