/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { randomUUID } from 'node:crypto';
import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { CustomerService } from '../src/customer/customer.service';
import { CustomerType } from '../src/customer/customer.enums';
import { CustomerClassAssignmentService } from '../src/customer-class/customer-class-assignment.service';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

describe('customer class HTTP authorization (PostgreSQL)', () => {
  let db: DataSource;
  let app: NestFastifyApplication;
  const auth = (token: string) => `Bearer ${token}`;
  beforeAll(async () => {
    db = await createIntegrationDataSource('class-http');
    const sessions = {
      validate: (token: string, audience: string) =>
        Promise.resolve().then(() => {
          const scopes =
            token === 'manager' || token === 'readonly-manager'
              ? ['customer.view', 'customer.manage_classes']
              : token === 'viewer'
                ? ['customer.view']
                : token === 'none'
                  ? []
                  : null;
          if (!scopes) throw new UnauthorizedException('invalid');
          return {
            type: 'OPERATOR',
            principalId: `operator-${token}`,
            audience,
            roles: [],
            scopes,
            customerAccess: 'NONE',
            agentAccess: 'NONE',
            aggregatorAccess: 'NONE',
            readOnlyPrincipal: token === 'readonly-manager',
          };
        }),
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(db)
      .overrideProvider(A2WorkforceSessionService)
      .useValue(sessions)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue({
        enabled: true,
        internalAudience: 'workforce-admin',
        trustedProxies: ['127.0.0.1'],
      })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 180000);
  afterAll(async () => {
    if (app) await app.close();
    if (db) await destroyIntegrationDataSource(db);
  });

  it('enforces view and manage permissions separately for catalogue and assignment', async () => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO customers(id,reference,customer_type,status,kyc_level,kyc_status,is_synthetic) VALUES($1,$2,'INDIVIDUAL','DRAFT','NONE','NOT_STARTED',false)`,
      [id, `http-${id}`],
    );
    const root = '/api/v1/internal/customer-classes';
    const assignment = `/api/v1/internal/customers/${id}/class`;
    expect((await request(app.getHttpServer()).get(root)).status).toBe(401);
    expect(
      (await request(app.getHttpServer()).get(root).set('Authorization', auth('none'))).status,
    ).toBe(403);
    expect(
      (await request(app.getHttpServer()).get(root).set('Authorization', auth('viewer'))).status,
    ).toBe(200);
    expect(
      (
        await request(app.getHttpServer())
          .post(root)
          .set('Authorization', auth('viewer'))
          .send({ code: 'HTTP_TEST', name: 'Test' })
      ).status,
    ).toBe(403);
    const created = await request(app.getHttpServer())
      .post(root)
      .set('Authorization', auth('manager'))
      .send({ code: 'HTTP_TEST', name: 'Test' });
    expect(created.status).toBe(201);
    expect(
      (
        await request(app.getHttpServer())
          .patch(`${root}/${created.body.id}`)
          .set('Authorization', auth('viewer'))
          .send({ name: 'New', expectedVersion: 1 })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app.getHttpServer())
          .post(assignment)
          .set('Authorization', auth('viewer'))
          .send({ classCode: 'STANDARD', reason: 'Test assignment' })
      ).status,
    ).toBe(403);
    const assigned = await request(app.getHttpServer())
      .post(assignment)
      .set('Authorization', auth('manager'))
      .send({ classCode: 'STANDARD', reason: 'Test assignment' });
    expect(assigned.status).toBe(200);
    expect(
      (await request(app.getHttpServer()).get(assignment).set('Authorization', auth('viewer'))).body
        .classCode,
    ).toBe('STANDARD');
    expect(
      (
        await request(app.getHttpServer())
          .get(`${assignment}/history`)
          .set('Authorization', auth('viewer'))
      ).body,
    ).toHaveLength(1);
    expect(
      (
        await request(app.getHttpServer())
          .post(assignment)
          .set('Authorization', auth('manager'))
          .send({ classCode: 'PREMIUM', reason: 'Test switch', expectedVersion: 99 })
      ).status,
    ).toBe(409);

    // Invalid customer UUID returns 400 safely rather than a database cast error.
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/v1/internal/customers/not-a-uuid/class')
          .set('Authorization', auth('viewer'))
      ).status,
    ).toBe(400);

    // Read-only principal can view but is denied mutations.
    expect(
      (await request(app.getHttpServer()).get(root).set('Authorization', auth('readonly-manager')))
        .status,
    ).toBe(200);
    expect(
      (
        await request(app.getHttpServer())
          .post(root)
          .set('Authorization', auth('readonly-manager'))
          .send({ code: 'READONLY_BLOCK', name: 'Blocked' })
      ).status,
    ).toBe(403);

    // Denied workforce function requests record authorization audit events.
    const denialAudits = await db.query<Array<{ count: string }>>(
      `SELECT count(*)::text AS count
         FROM audit_events
        WHERE actor = 'operator-viewer'
          AND entity_type = 'AUTHORIZATION_DECISION'
          AND action = 'DENIED'`,
    );
    expect(Number(denialAudits[0]!.count)).toBeGreaterThan(0);
  });

  it('creates a draft with its default class in one transaction and rolls back if assignment fails', async () => {
    const customers = app.get(CustomerService);
    const assignments = app.get(CustomerClassAssignmentService);
    const created = await customers.create({
      type: CustomerType.INDIVIDUAL,
      actor: 'workforce-test',
    });
    const rows = await db.query<Array<{ code: string }>>(
      `SELECT c.code FROM customer_class_assignments a JOIN customer_classes c ON c.id=a.class_id WHERE a.customer_id=$1 AND a.is_active`,
      [created.id],
    );
    expect(rows).toEqual([{ code: 'STANDARD' }]);
    const reference = `atomic-${randomUUID()}`;
    const failing = jest
      .spyOn(assignments, 'assignDefaultOnRegistrationInManager')
      .mockRejectedValueOnce(new Error('class write failed'));
    try {
      await expect(
        customers.create({ type: CustomerType.INDIVIDUAL, actor: 'workforce-test', reference }),
      ).rejects.toThrow('class write failed');
      const count = await db.query<Array<{ count: string }>>(
        'SELECT count(*)::text AS count FROM customers WHERE reference=$1',
        [reference],
      );
      expect(count[0]!.count).toBe('0');
    } finally {
      failing.mockRestore();
    }
  });
});
