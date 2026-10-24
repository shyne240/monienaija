/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
// @ts-nocheck
/**
 * Batch 1 customer servicing proof: real Nest HTTP + isolated PostgreSQL + synthetic records.
 * No authorization provider, repository, API response, or customer record is mocked.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import request = require('supertest');

import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { WalletService } from '../src/wallet/wallet.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  postgresAdminConfig,
  truncateAllTables,
} from './support/pg-harness';

// ConfigModule validates the root DB settings while AppModule is loaded. The test DataSource
// itself is an isolated, run-namespaced database from pg-harness; these values only satisfy
// AppModule's eagerly evaluated config before its DataSource provider is overridden.
const postgresConfig = postgresAdminConfig();
process.env.DB_HOST ??= postgresConfig.host;
process.env.DB_NAME ??= postgresConfig.adminDatabase;
process.env.DB_USER ??= postgresConfig.username;
process.env.DB_PASSWORD ??= postgresConfig.password;
const { AppModule } = require('../src/app.module');

const workforceConfig: A2WorkforceConfigurationV1 = {
  enabled: true,
  environment: 'test',
  oidcIssuer: 'https://workforce.batch1.test.invalid',
  oidcJwksUri: 'https://workforce.batch1.test.invalid/jwks',
  oidcAudience: 'workforce',
  oidcClientId: 'batch1-test-client',
  internalAudience: 'workforce-admin',
  sessionTtlSeconds: 900,
  mfaFreshnessSeconds: 900,
  oidcJwksCacheSeconds: 60,
  oidcJwksMaxStalenessSeconds: 300,
  bootstrapEnabled: false,
  bootstrapIssuer: 'https://workforce.batch1.test.invalid',
  bootstrapAudience: 'workforce-admin-bootstrap',
  bootstrapKeys: [],
  bootstrapFinanceAdminScopes: [],
  recoveryEnabled: false,
  recoveryAudience: 'workforce-admin-recovery',
  recoveryKeys: [],
  roles: [],
  makerCheckerRules: [],
  rateLimits: [],
  trustedProxyAddresses: ['127.0.0.1'],
} as A2WorkforceConfigurationV1;

const syntheticPhone = (suffix: string) => `+234000000${suffix}`;

describe('Batch 1 customer servicing (real PostgreSQL + authenticated HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let sessionService: A2WorkforceSessionService;
  let walletService: WalletService;
  let superAdmin: { token: string; principalId: string };
  let administrator: { token: string; principalId: string };
  let financePreparer: { token: string; principalId: string };
  let customers: Record<string, any>;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('batch01customers');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessionService = moduleRef.get(A2WorkforceSessionService);
    walletService = moduleRef.get(WalletService);
  }, 180_000);

  afterAll(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      await destroyIntegrationDataSource(dataSource).catch(() =>
        dataSource.destroy().catch(() => undefined),
      );
    }
  }, 60_000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    [superAdmin, administrator, financePreparer] = await Promise.all([
      createRoleSession('SUPER_ADMIN'),
      createRoleSession('ADMINISTRATOR'),
      createRoleSession('FINANCE_PREPARER'),
    ]);
    customers = {
      alpha: await seedCustomer({
        reference: 'mn-0000001234',
        type: 'INDIVIDUAL',
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
        kycStatus: 'APPROVED',
        displayName: 'Batch One Alpha',
        legalName: 'Batch One Alpha Legal',
        createdAt: new Date('2026-10-20T12:00:00.000Z'),
        phone: syntheticPhone('1234'),
        normalizedPhone: '0000001234',
        phonePrimary: true,
        phoneVerified: true,
        dateOfBirth: '1992-01-02',
        nationality: 'NG',
      }),
      beta: await seedCustomer({
        reference: 'mn-0000005678',
        type: 'BUSINESS',
        status: 'ACTIVE',
        kycLevel: 'LEVEL_2',
        kycStatus: 'PENDING',
        displayName: 'Batch One Beta',
        legalName: 'Batch One Beta Legal',
        createdAt: new Date('2026-10-21T12:00:00.000Z'),
        phone: syntheticPhone('5678'),
        normalizedPhone: '0000005678',
        phonePrimary: true,
        phoneVerified: false,
      }),
      gamma: await seedCustomer({
        reference: 'synthetic-no-primary-contact',
        type: 'INDIVIDUAL',
        status: 'SUSPENDED',
        kycLevel: 'NONE',
        kycStatus: 'NOT_STARTED',
        legalName: 'Batch One Gamma Legal',
        createdAt: new Date('2026-10-22T12:00:00.000Z'),
        phone: syntheticPhone('8888'),
        normalizedPhone: '0000008888',
        phonePrimary: false,
        phoneVerified: false,
      }),
      closed: await seedCustomer({
        reference: 'mn-0000009999',
        type: 'INDIVIDUAL',
        status: 'CLOSED',
        kycLevel: 'LEVEL_1',
        kycStatus: 'REJECTED',
        displayName: 'Batch One Closed',
        legalName: 'Batch One Closed Legal',
        createdAt: new Date('2026-10-19T12:00:00.000Z'),
        deletedAt: new Date('2026-10-23T12:00:00.000Z'),
      }),
      hiddenDeleted: await seedCustomer({
        reference: 'synthetic-deleted-active',
        type: 'INDIVIDUAL',
        status: 'ACTIVE',
        kycLevel: 'NONE',
        kycStatus: 'NOT_STARTED',
        displayName: 'Batch One Hidden Deleted',
        createdAt: new Date('2026-10-24T12:00:00.000Z'),
        deletedAt: new Date('2026-10-24T12:30:00.000Z'),
      }),
    };
  }, 60_000);

  async function createRoleSession(roleKey: string) {
    const principalId = `batch01:${roleKey}:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `batch01:${roleKey}:${randomUUID()}`,
      assignmentVersion: 1,
      principalId,
      roleKey,
      scopes: [],
      status: 'ACTIVE',
      initiatedScope: 'SUPER_ADMIN_SCOPE',
      interim: true,
      effectiveFrom: new Date(now.getTime() - 60_000),
      effectiveTo: new Date(now.getTime() + 3_600_000),
      assignedBy: 'synthetic-test-harness',
      assignedAt: now,
      revokedBy: null,
      revokedAt: null,
      bootstrapReference: null,
      approvalIds: [],
      auditReferences: [],
    });
    const session = await sessionService.establish({
      issuer: 'https://workforce.batch1.test.invalid',
      subject: principalId,
      principalId,
      audience: ['workforce-admin'],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
      authenticatedAt: now.toISOString(),
      assuranceLevel: 'MFA',
      amr: ['pwd', 'otp'],
      acr: null,
      signingKeyId: 'synthetic-batch01-harness',
    });
    return { token: session.accessToken, principalId };
  }

  async function seedCustomer(input: {
    reference: string;
    type: string;
    status: string;
    kycLevel: string;
    kycStatus: string;
    displayName?: string;
    legalName?: string;
    createdAt: Date;
    deletedAt?: Date;
    phone?: string;
    normalizedPhone?: string;
    phonePrimary?: boolean;
    phoneVerified?: boolean;
    dateOfBirth?: string;
    nationality?: string;
  }) {
    const [customer] = await dataSource.query(
      `INSERT INTO customers
         (reference, customer_type, status, kyc_level, kyc_status, created_at, updated_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7)
       RETURNING id::text AS id, reference, customer_type AS type, status, kyc_level AS "kycLevel",
                 kyc_status AS "kycStatus", created_at AS "createdAt"`,
      [
        input.reference,
        input.type,
        input.status,
        input.kycLevel,
        input.kycStatus,
        input.createdAt,
        input.deletedAt ?? null,
      ],
    );
    if (input.displayName || input.legalName || input.dateOfBirth || input.nationality) {
      await dataSource.query(
        `INSERT INTO customer_profiles
           (customer_id, display_name, legal_name, date_of_birth, nationality, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,true,$6,$6)`,
        [
          customer.id,
          input.displayName ?? input.legalName ?? 'Synthetic profile name',
          input.legalName ?? null,
          input.dateOfBirth ?? null,
          input.nationality ?? null,
          input.createdAt,
        ],
      );
    }
    if (input.phone) {
      await dataSource.query(
        `INSERT INTO customer_contact_methods
           (customer_id, type, value, normalized_value, is_primary, verified_at, created_at, updated_at)
         VALUES ($1,'PHONE',$2,$3,$4,$5,$6,$6)`,
        [
          customer.id,
          input.phone,
          input.normalizedPhone ?? input.phone,
          input.phonePrimary ?? false,
          input.phoneVerified ? input.createdAt : null,
          input.createdAt,
        ],
      );
    }
    return customer;
  }

  async function seedAddress(customerId: string) {
    await dataSource.query(
      `INSERT INTO customer_addresses
         (customer_id, type, line_one, line_two, city, state, country, postal_code, is_primary)
       VALUES ($1,'RESIDENTIAL','1 Synthetic Avenue',NULL,'Abuja','FCT','NG',NULL,true)`,
      [customerId],
    );
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createDraft(token: string, reference = `batch01-draft-${randomUUID()}`) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set(auth(token))
      .send({ reference, type: 'INDIVIDUAL', status: 'ACTIVE', actor: 'spoofed-client-actor' })
      .expect(201);
    return response.body;
  }

  it('lists, searches, filters and paginates a safely scoped directory with masked fields', async () => {
    const firstPage = await request(app.getHttpServer())
      .get('/api/v1/internal/customers?page=1&limit=2')
      .set(auth(superAdmin.token))
      .expect(200);
    expect(firstPage.body).toMatchObject({ total: 4, page: 1, limit: 2, totalPages: 2, hasNextPage: true });
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.data.map((item: any) => item.id)).not.toContain(customers.hiddenDeleted.id);

    const secondPage = await request(app.getHttpServer())
      .get('/api/v1/internal/customers?page=2&limit=2')
      .set(auth(superAdmin.token))
      .expect(200);
    expect(secondPage.body).toMatchObject({ total: 4, page: 2, limit: 2, totalPages: 2, hasPreviousPage: true });
    expect(secondPage.body.data).toHaveLength(2);
    expect(
      new Set([
        ...firstPage.body.data.map((item: any) => item.id),
        ...secondPage.body.data.map((item: any) => item.id),
      ]).size,
    ).toBe(4);

    const alpha = await request(app.getHttpServer())
      .get('/api/v1/internal/customers?search=Alpha')
      .set(auth(superAdmin.token))
      .expect(200);
    expect(alpha.body.data).toHaveLength(1);
    expect(alpha.body.data[0]).toMatchObject({
      id: customers.alpha.id,
      reference: 'mn-••••1234',
      type: 'INDIVIDUAL',
      status: 'ACTIVE',
      kycLevel: 'LEVEL_1',
      kycStatus: 'APPROVED',
      displayName: 'Batch One Alpha',
      legalName: 'Batch One Alpha Legal',
      primaryContact: { type: 'PHONE', maskedValue: '******1234', isVerified: true },
    });
    expect(new Date(alpha.body.data[0].createdAt).toISOString()).toBe('2026-10-20T12:00:00.000Z');
    expect(JSON.stringify(alpha.body)).not.toContain(syntheticPhone('1234'));

    const contactSearch = await request(app.getHttpServer())
      .get('/api/v1/internal/customers?search=0000001234')
      .set(auth(superAdmin.token))
      .expect(200);
    expect(contactSearch.body.data.map((item: any) => item.id)).toContain(customers.alpha.id);

    const filtered = await request(app.getHttpServer())
      .get('/api/v1/internal/customers?status=ACTIVE&type=BUSINESS&kycLevel=LEVEL_2&kycStatus=PENDING')
      .set(auth(superAdmin.token))
      .expect(200);
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.data[0]).toMatchObject({ id: customers.beta.id, displayName: 'Batch One Beta' });

    const closed = await request(app.getHttpServer())
      .get('/api/v1/internal/customers?status=CLOSED')
      .set(auth(superAdmin.token))
      .expect(200);
    expect(closed.body.total).toBe(1);
    expect(closed.body.data[0].id).toBe(customers.closed.id);

    const gamma = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers?search=${encodeURIComponent('Batch One Gamma Legal')}`)
      .set(auth(superAdmin.token))
      .expect(200);
    expect(gamma.body.data[0]).toMatchObject({ id: customers.gamma.id, displayName: 'Batch One Gamma Legal', primaryContact: null });

    const limitedContact = await request(app.getHttpServer())
      .get('/api/v1/internal/customers?page=1&limit=20')
      .set(auth(administrator.token))
      .expect(200);
    expect(limitedContact.body.data.find((item: any) => item.id === customers.alpha.id).primaryContact).toBeNull();
    const hiddenPhoneSearch = await request(app.getHttpServer())
      .get('/api/v1/internal/customers?search=0000001234')
      .set(auth(administrator.token))
      .expect(200);
    expect(hiddenPhoneSearch.body.data).toHaveLength(0);

    await request(app.getHttpServer()).get('/api/v1/internal/customers').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/internal/customers')
      .set(auth(financePreparer.token))
      .expect(403);
  });

  it('serves customer profile, authorized contact/address data and masked workforce phone views', async () => {
    await seedAddress(customers.alpha.id);
    const profile = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customers.alpha.id}/profile`)
      .set(auth(superAdmin.token))
      .expect(200);
    expect(profile.body).toMatchObject({
      displayName: 'Batch One Alpha',
      legalName: 'Batch One Alpha Legal',
      nationality: 'NG',
    });
    expect(String(profile.body.dateOfBirth)).toContain('1992-01-02');

    const addresses = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customers.alpha.id}/addresses`)
      .set(auth(superAdmin.token))
      .expect(200);
    expect(addresses.body).toHaveLength(1);
    expect(addresses.body[0]).toMatchObject({ lineOne: '1 Synthetic Avenue', city: 'Abuja', state: 'FCT', isPrimary: true });

    const contacts = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customers.alpha.id}/contact-methods`)
      .set(auth(superAdmin.token))
      .expect(200);
    expect(contacts.body).toHaveLength(1);
    expect(contacts.body[0]).toMatchObject({ value: syntheticPhone('1234'), isPrimary: true });

    const phoneVerification = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customers.alpha.id}/phone-verification`)
      .set(auth(superAdmin.token))
      .expect(200);
    expect(phoneVerification.body.phones[0]).toMatchObject({ isPrimary: true, maskedValue: '******1234' });
    expect(JSON.stringify(phoneVerification.body)).not.toContain(syntheticPhone('1234'));

    const safeCustomer = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customers.alpha.id}`)
      .set(auth(superAdmin.token))
      .expect(200);
    expect(safeCustomer.body).toMatchObject({ displayName: 'Batch One Alpha', legalName: 'Batch One Alpha Legal', reference: 'mn-••••1234' });
    expect(JSON.stringify(safeCustomer.body)).not.toContain('mn-0000001234');

    await request(app.getHttpServer())
      .get(`/api/v1/customers/${customers.alpha.id}/addresses`)
      .set(auth(administrator.token))
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/customers/${customers.alpha.id}/contact-methods`)
      .set(auth(administrator.token))
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/customers/${customers.alpha.id}/profile`)
      .set(auth(financePreparer.token))
      .expect(403);

    const hiddenCustomer = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customers.hiddenDeleted.id}`)
      .set(auth(superAdmin.token));
    expect(hiddenCustomer.status).toBe(404);
  });

  it('returns customer-scoped wallets and transactions without raw counterparty contact data', async () => {
    const otherCustomer = await seedCustomer({
      reference: 'synthetic-counterparty-customer',
      type: 'INDIVIDUAL',
      status: 'ACTIVE',
      kycLevel: 'LEVEL_1',
      kycStatus: 'APPROVED',
      displayName: 'Synthetic Counterparty',
      createdAt: new Date('2026-10-18T12:00:00.000Z'),
      phone: syntheticPhone('4321'),
      normalizedPhone: '0000004321',
      phonePrimary: true,
      phoneVerified: false,
    });
    const wallet = await walletService.createWallet({
      customerId: customers.alpha.id,
      currency: 'NGN',
      idempotencyKey: `batch01-wallet-${randomUUID()}`,
    });
    const counterpartyWallet = await walletService.createWallet({
      customerId: otherCustomer.id,
      currency: 'NGN',
      idempotencyKey: `batch01-counterparty-wallet-${randomUUID()}`,
    });
    await dataSource.query(
      `INSERT INTO transfers
         (id, source_wallet_id, destination_wallet_id, amount_minor, currency, status,
          idempotency_key, request_hash, created_at, updated_at)
       VALUES ($1,$2,$3,'12345','NGN','FAILED',$4,$5,now(),now())`,
      [randomUUID(), wallet.id, counterpartyWallet.id, `batch01-transfer-${randomUUID()}`, 'a'.repeat(64)],
    );

    const walletList = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customers.alpha.id}/wallets`)
      .set(auth(superAdmin.token))
      .expect(200);
    expect(walletList.body).toMatchObject({ total: 1, data: [{ id: wallet.id, customerId: customers.alpha.id, currency: 'NGN' }] });
    const balance = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customers.alpha.id}/wallets/${wallet.id}/balance`)
      .set(auth(superAdmin.token))
      .expect(200);
    expect(balance.body).toMatchObject({ walletId: wallet.id, customerId: customers.alpha.id, currency: 'NGN' });
    expect(balance.body.balanceMinor).toBeDefined();

    const transactions = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customers.alpha.id}/transactions?page=1&limit=5`)
      .set(auth(superAdmin.token))
      .expect(200);
    expect(transactions.body.items).toHaveLength(1);
    expect(transactions.body.items[0].counterparty.maskedContact).toBe('******4321');
    expect(JSON.stringify(transactions.body)).not.toContain(syntheticPhone('4321'));
    expect(JSON.stringify(transactions.body)).not.toContain('0000004321');
    await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customers.alpha.id}/transactions`)
      .set(auth(administrator.token))
      .expect(403);
  });

  it('creates only DRAFT customers, attributes actors from the session, and enforces lifecycle/write functions', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set(auth(administrator.token))
      .send({ reference: 'batch01-denied-create', type: 'INDIVIDUAL' })
      .expect(403);

    const draft = await createDraft(superAdmin.token, 'batch01-manual-draft');
    expect(draft.status).toBe('DRAFT');
    expect(draft.reference).toBe('batch01-manual-draft');

    const createdAudit = await dataSource.query(
      `SELECT actor, new_values FROM audit_events
       WHERE entity_type = 'CUSTOMER' AND entity_id = $1 AND action = 'CREATED'
       ORDER BY occurred_at DESC LIMIT 1`,
      [draft.id],
    );
    expect(createdAudit[0].actor).toBe(superAdmin.principalId);
    expect(JSON.stringify(createdAudit[0].new_values)).not.toContain('spoofed-client-actor');

    await request(app.getHttpServer())
      .post(`/api/v1/customers/${draft.id}/profile`)
      .set(auth(administrator.token))
      .send({ displayName: 'Should Be Denied', actor: 'spoofed-client-actor' })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/customers/${draft.id}/profile`)
      .set(auth(superAdmin.token))
      .send({
        displayName: 'Batch One Created Profile',
        legalName: 'Batch One Created Profile Legal',
        dateOfBirth: '1991-04-05',
        nationality: 'NG',
        actor: 'spoofed-client-actor',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${draft.id}/address`)
      .set(auth(superAdmin.token))
      .send({
        type: 'RESIDENTIAL',
        lineOne: '2 Synthetic Road',
        city: 'Abuja',
        state: 'FCT',
        country: 'NG',
        isPrimary: true,
        actor: 'spoofed-client-actor',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${draft.id}/contact-method`)
      .set(auth(superAdmin.token))
      .send({
        type: 'PHONE',
        value: syntheticPhone('1111'),
        isPrimary: true,
        actor: 'spoofed-client-actor',
      })
      .expect(201);

    const deniedActivation = await request(app.getHttpServer())
      .patch(`/api/v1/customers/${draft.id}`)
      .set(auth(administrator.token))
      .send({ status: 'ACTIVE' })
      .expect(403);
    expect(deniedActivation.body.status).not.toBe('ACTIVE');
    const blockedWithoutVerifiedPhone = await request(app.getHttpServer())
      .patch(`/api/v1/customers/${draft.id}`)
      .set(auth(superAdmin.token))
      .send({ status: 'ACTIVE', actor: 'spoofed-client-actor' })
      .expect(400);
    expect(String(blockedWithoutVerifiedPhone.body.message)).toContain('verified primary phone');

    await dataSource.query(
      `UPDATE customer_contact_methods SET verified_at = now()
       WHERE customer_id = $1 AND type = 'PHONE' AND is_primary = TRUE AND deleted_at IS NULL`,
      [draft.id],
    );
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${draft.id}`)
      .set(auth(superAdmin.token))
      .send({ status: 'ACTIVE', actor: 'spoofed-client-actor' })
      .expect(200);

    const updatedAudit = await dataSource.query(
      `SELECT actor, new_values FROM audit_events
       WHERE entity_type = 'CUSTOMER' AND entity_id = $1 AND action = 'STATUS_UPDATED'
       ORDER BY occurred_at DESC LIMIT 1`,
      [draft.id],
    );
    expect(updatedAudit[0].actor).toBe(superAdmin.principalId);
    expect(JSON.stringify(updatedAudit[0].new_values)).not.toContain('spoofed-client-actor');
  });
});
