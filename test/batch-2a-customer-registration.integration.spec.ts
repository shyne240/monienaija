/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
// @ts-nocheck
/** Batch 2A: real PostgreSQL + authenticated HTTP proof for Admin customer registration and corrections. */
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
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  postgresAdminConfig,
  truncateAllTables,
} from './support/pg-harness';

const postgresConfig = postgresAdminConfig();
process.env.DB_HOST ??= postgresConfig.host;
process.env.DB_NAME ??= postgresConfig.adminDatabase;
process.env.DB_USER ??= postgresConfig.username;
process.env.DB_PASSWORD ??= postgresConfig.password;
const { AppModule } = require('../src/app.module');

const workforceConfig: A2WorkforceConfigurationV1 = {
  enabled: true,
  environment: 'test',
  oidcIssuer: 'https://workforce.batch2a.test.invalid',
  oidcJwksUri: 'https://workforce.batch2a.test.invalid/jwks',
  oidcAudience: 'workforce',
  oidcClientId: 'batch2a-test-client',
  internalAudience: 'workforce-admin',
  sessionTtlSeconds: 900,
  mfaFreshnessSeconds: 900,
  oidcJwksCacheSeconds: 60,
  oidcJwksMaxStalenessSeconds: 300,
  bootstrapEnabled: false,
  bootstrapIssuer: 'https://workforce.batch2a.test.invalid',
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

describe('Batch 2A Admin customer registration (real PostgreSQL + authenticated HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let sessionService: A2WorkforceSessionService;
  const notifications = new TestNotificationProvider();
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('batch2acustomer');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
      .useValue(notifications)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessionService = moduleRef.get(A2WorkforceSessionService);
  }, 180_000);

  afterAll(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      await destroyIntegrationDataSource(dataSource).catch(() => dataSource.destroy().catch(() => undefined));
    }
  }, 60_000);

  async function createRoleSession(roleKey: string) {
    const principalId = `batch2a:${roleKey}:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `batch2a:${roleKey}:${randomUUID()}`,
      assignmentVersion: 1,
      principalId,
      roleKey,
      scopes: [],
      status: 'ACTIVE',
      initiatedScope: 'SUPER_ADMIN_SCOPE',
      interim: true,
      effectiveFrom: new Date(now.getTime() - 60_000),
      effectiveTo: new Date(now.getTime() + 3_600_000),
      assignedBy: 'synthetic-batch2a-test',
      assignedAt: now,
      revokedBy: null,
      revokedAt: null,
      bootstrapReference: null,
      approvalIds: [],
      auditReferences: [],
    });
    const session = await sessionService.establish({
      issuer: 'https://workforce.batch2a.test.invalid',
      subject: principalId,
      principalId,
      audience: ['workforce-admin'],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
      authenticatedAt: now.toISOString(),
      assuranceLevel: 'MFA',
      amr: ['pwd', 'otp'],
      acr: null,
      signingKeyId: 'synthetic-batch2a-harness',
    });
    return { token: session.accessToken, principalId };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('persists a DRAFT registration, supports authorized corrections and phone proof, masks PII, and denies restricted workforce reads', async () => {
    await truncateAllTables(dataSource);
    notifications.clear();
    const [superAdmin, administrator] = await Promise.all([
      createRoleSession('SUPER_ADMIN'),
      createRoleSession('ADMINISTRATOR'),
    ]);
    const phone = '+2348012340001';
    const secondaryPhone = '+2348012340002';
    const syntheticIdentityNumber = 'SYNTHETIC-NIN-2A-0001';
    const syntheticSecondIdentityNumber = 'SYNTHETIC-NIN-2A-0002';

    const created = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set(auth(superAdmin.token))
      .send({ type: 'INDIVIDUAL' })
      .expect(201);
    const customerId = created.body.id as string;
    expect(created.body.status).toBe('DRAFT');
    expect(created.body.reference).toMatch(/^mn-cus-[a-f0-9]{24}$/);

    const profile = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/profile`)
      .set(auth(superAdmin.token))
      .send({
        displayName: 'Synthetic Batch 2A Customer',
        firstName: 'Synthetic',
        middleName: 'Batch',
        lastName: 'Customer',
        dateOfBirth: '1990-06-12',
        nationality: 'NG',
      })
      .expect(201);
    expect(profile.body).toMatchObject({
      displayName: 'Synthetic Batch 2A Customer',
      firstName: 'Synthetic',
      middleName: 'Batch',
      lastName: 'Customer',
      legalName: 'Synthetic Batch Customer',
      nationality: 'NG',
    });

    const address = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/address`)
      .set(auth(superAdmin.token))
      .send({
        type: 'RESIDENTIAL',
        lineOne: '1 Synthetic Crescent',
        lineTwo: 'Test District',
        city: 'Abuja',
        state: 'FCT',
        country: 'NG',
        postalCode: '00000',
        isPrimary: true,
      })
      .expect(201);

    const contact = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/contact-method`)
      .set(auth(superAdmin.token))
      .send({ type: 'PHONE', value: phone, isPrimary: true })
      .expect(201);
    expect(contact.body).toMatchObject({ type: 'PHONE', isPrimary: true, verifiedAt: null });
    expect(contact.body.maskedValue).toContain('0001');
    expect(JSON.stringify(contact.body)).not.toContain(phone);

    const identity = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/identity-document`)
      .set(auth(superAdmin.token))
      .send({
        type: 'NIN',
        documentNumber: syntheticIdentityNumber,
        issuingCountry: 'NG',
        issuedAt: '2015-06-12',
        expiresAt: '2035-06-12',
      })
      .expect(201);
    expect(identity.body).toMatchObject({ type: 'NIN', issuingCountry: 'NG', issuedAt: null, expiresAt: null });
    expect(JSON.stringify(identity.body)).not.toContain(syntheticIdentityNumber);

    const secondIdentity = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/identity-document`)
      .set(auth(superAdmin.token))
      .send({ type: 'NIN', documentNumber: syntheticSecondIdentityNumber, issuingCountry: 'NG' })
      .expect(201);
    expect(secondIdentity.body.id).not.toBe(identity.body.id);
    const duplicateIdentity = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/identity-document`)
      .set(auth(superAdmin.token))
      .send({ type: 'NIN', documentNumber: syntheticIdentityNumber.toLowerCase(), issuingCountry: 'NG' })
      .expect(409);
    expect(JSON.stringify(duplicateIdentity.body)).not.toContain(syntheticIdentityNumber);

    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set(auth(superAdmin.token))
      .send({ status: 'ACTIVE' })
      .expect(400);
    const stillDraft = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}`)
      .set(auth(superAdmin.token))
      .expect(200);
    expect(stillDraft.body).toMatchObject({ status: 'DRAFT', kycLevel: 'NONE', kycStatus: 'NOT_STARTED' });

    const walletCountBefore = await dataSource.query(
      'SELECT COUNT(*)::int AS count FROM wallet_accounts WHERE customer_id = $1',
      [customerId],
    );
    expect(walletCountBefore[0].count).toBe(0);

    await request(app.getHttpServer())
      .post('/api/v1/customers/registration/otp')
      .send({ phone })
      .expect(200);
    const deliveredMessage = notifications.sent.at(-1)?.message ?? '';
    const otpCode = deliveredMessage.match(/code is (\d{6})/)?.[1];
    expect(otpCode).toBeTruthy();
    const verification = await request(app.getHttpServer())
      .post('/api/v1/customers/registration/otp/verify')
      .send({ phone, code: otpCode })
      .expect(200);
    expect(verification.body.status).toBe('PHONE_VERIFIED');

    const verifiedContact = await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}/contact-methods/${contact.body.id}`)
      .set(auth(superAdmin.token))
      .send({ verificationToken: verification.body.verificationToken })
      .expect(200);
    expect(verifiedContact.body.isPrimary).toBe(true);
    expect(verifiedContact.body.verifiedAt).toBeTruthy();
    expect(JSON.stringify(verifiedContact.body)).not.toContain(verification.body.verificationToken);

    // No auto-activation or wallet provisioning occurs after phone proof.
    const stillDraftAfterVerification = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}`)
      .set(auth(superAdmin.token))
      .expect(200);
    expect(stillDraftAfterVerification.body).toMatchObject({
      status: 'DRAFT',
      kycLevel: 'NONE',
      kycStatus: 'NOT_STARTED',
    });
    const walletCountAfter = await dataSource.query(
      'SELECT COUNT(*)::int AS count FROM wallet_accounts WHERE customer_id = $1',
      [customerId],
    );
    expect(walletCountAfter[0].count).toBe(0);

    const alternateContact = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/contact-method`)
      .set(auth(superAdmin.token))
      .send({ type: 'PHONE', value: secondaryPhone, isPrimary: false })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}/contact-methods/${alternateContact.body.id}`)
      .set(auth(superAdmin.token))
      .send({ isPrimary: true })
      .expect(200);

    const updatedProfile = await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}/profile`)
      .set(auth(superAdmin.token))
      .send({ displayName: 'Synthetic Batch 2A Revised', firstName: 'Revised', legalName: 'Synthetic Revised Customer' })
      .expect(200);
    expect(updatedProfile.body).toMatchObject({
      displayName: 'Synthetic Batch 2A Revised',
      firstName: 'Revised',
      legalName: 'Synthetic Revised Customer',
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}/addresses/${address.body.id}`)
      .set(auth(superAdmin.token))
      .send({ lineOne: '2 Synthetic Crescent', isPrimary: true })
      .expect(200);
    const secondAddress = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/address`)
      .set(auth(superAdmin.token))
      .send({ type: 'MAILING', lineOne: '3 Synthetic Crescent', city: 'Abuja', state: 'FCT', country: 'NG', isPrimary: true })
      .expect(201);

    const updatedIdentity = await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}/identity-documents/${identity.body.id}`)
      .set(auth(superAdmin.token))
      .send({
        documentNumber: 'SYNTHETIC-NIN-2A-0003',
        issuingCountry: 'NG',
        expiresAt: '2030-01-01',
      })
      .expect(200);
    expect(updatedIdentity.body.maskedDocumentNumber).toContain('0003');
    expect(updatedIdentity.body.expiresAt).toBeNull();
    expect(JSON.stringify(updatedIdentity.body)).not.toContain('SYNTHETIC-NIN-2A-0003');
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}/identity-documents/${identity.body.id}`)
      .set(auth(superAdmin.token))
      .send({ documentNumber: syntheticSecondIdentityNumber })
      .expect(409);

    const storedProfile = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/profile`)
      .set(auth(superAdmin.token))
      .expect(200);
    expect(storedProfile.body.displayName).toBe('Synthetic Batch 2A Revised');

    const storedAddresses = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/addresses`)
      .set(auth(superAdmin.token))
      .expect(200);
    expect(storedAddresses.body.find((item: any) => item.id === address.body.id).lineOne).toBe('2 Synthetic Crescent');
    expect(storedAddresses.body.find((item: any) => item.id === address.body.id).isPrimary).toBe(false);
    expect(storedAddresses.body.find((item: any) => item.id === secondAddress.body.id).isPrimary).toBe(true);

    const storedContacts = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/contact-methods`)
      .set(auth(superAdmin.token))
      .expect(200);
    expect(storedContacts.body.find((item: any) => item.id === contact.body.id).isPrimary).toBe(false);
    expect(storedContacts.body.find((item: any) => item.id === alternateContact.body.id).isPrimary).toBe(true);

    const storedIdentity = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/identity-documents`)
      .set(auth(superAdmin.token))
      .expect(200);
    expect(storedIdentity.body).toHaveLength(2);
    expect(storedIdentity.body.find((item: any) => item.id === identity.body.id).maskedDocumentNumber).toContain('0003');
    expect(storedIdentity.body.find((item: any) => item.id === secondIdentity.body.id).maskedDocumentNumber).toContain('0002');
    expect(JSON.stringify(storedIdentity.body)).not.toContain('SYNTHETIC-NIN-2A-0003');
    expect(JSON.stringify(storedIdentity.body)).not.toContain('SYNTHETIC-NIN-2A-0002');

    const directory = await request(app.getHttpServer())
      .get('/api/v1/internal/customers?search=Synthetic%20Batch%202A%20Revised')
      .set(auth(superAdmin.token))
      .expect(200);
    expect(directory.body.data[0]).toMatchObject({
      id: customerId,
      status: 'DRAFT',
      displayName: 'Synthetic Batch 2A Revised',
      primaryContact: { maskedValue: '+234*****0002', isVerified: false },
    });
    expect(JSON.stringify(directory.body)).not.toContain(phone);
    expect(JSON.stringify(directory.body)).not.toContain(secondaryPhone);
    expect(JSON.stringify(directory.body)).not.toContain(syntheticIdentityNumber);

    const internalDetail = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}`)
      .set(auth(superAdmin.token))
      .expect(200);
    expect(internalDetail.body.displayName).toBe('Synthetic Batch 2A Revised');

    await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/identity-documents`)
      .set(auth(administrator.token))
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}/identity-documents/${identity.body.id}`)
      .set(auth(administrator.token))
      .send({ issuingCountry: 'NG' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}/profile`)
      .set(auth(administrator.token))
      .send({ displayName: 'Unauthorized correction' })
      .expect(403);

    const auditRows = await dataSource.query(
      `SELECT entity_type, actor, new_values
       FROM audit_events
       WHERE entity_id IN ($1, $2, $3, $4)
         AND entity_type IN ('CUSTOMER_PROFILE','CUSTOMER_ADDRESS','CUSTOMER_CONTACT_METHOD','CUSTOMER_IDENTITY_DOCUMENT')`,
      [profile.body.id, address.body.id, contact.body.id, identity.body.id],
    );
    expect(auditRows.some((row: any) => row.actor === superAdmin.principalId)).toBe(true);
    expect(JSON.stringify(auditRows)).not.toContain('Synthetic Batch 2A Revised');
    expect(JSON.stringify(auditRows)).not.toContain('2 Synthetic Crescent');
    expect(JSON.stringify(auditRows)).not.toContain('SYNTHETIC-NIN-2A-0002');
    expect(JSON.stringify(auditRows)).not.toContain(phone);
  }, 120_000);

  it('enforces type-aware registration names and returns the saved name in fresh directory projections', async () => {
    await truncateAllTables(dataSource);
    const [superAdmin, administrator] = await Promise.all([
      createRoleSession('SUPER_ADMIN'),
      createRoleSession('ADMINISTRATOR'),
    ]);

    const individual = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set(auth(superAdmin.token))
      .send({ type: 'INDIVIDUAL' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${individual.body.id}/registration-profile`)
      .set(auth(superAdmin.token))
      .send({ firstName: 'Synthetic' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${individual.body.id}/registration-profile`)
      .set(auth(superAdmin.token))
      .send({ lastName: 'Individual' })
      .expect(400);

    const individualProfile = await request(app.getHttpServer())
      .post(`/api/v1/customers/${individual.body.id}/registration-profile`)
      .set(auth(superAdmin.token))
      .send({ firstName: 'Synthetic', lastName: 'Individual' })
      .expect(201);
    expect(individualProfile.body).toMatchObject({
      firstName: 'Synthetic',
      middleName: null,
      lastName: 'Individual',
      displayName: 'Synthetic Individual',
      legalName: 'Synthetic Individual',
    });

    const business = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set(auth(superAdmin.token))
      .send({ type: 'BUSINESS' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${business.body.id}/registration-profile`)
      .set(auth(superAdmin.token))
      .send({ firstName: 'Not', lastName: 'A Business Name' })
      .expect(400);
    const businessProfile = await request(app.getHttpServer())
      .post(`/api/v1/customers/${business.body.id}/registration-profile`)
      .set(auth(superAdmin.token))
      .send({ businessName: 'Synthetic Example Operations Ltd' })
      .expect(201);
    expect(businessProfile.body).toMatchObject({
      displayName: 'Synthetic Example Operations Ltd',
      legalName: 'Synthetic Example Operations Ltd',
      firstName: null,
      middleName: null,
      lastName: null,
    });
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${business.body.id}/registration-profile`)
      .set(auth(administrator.token))
      .send({ businessName: 'Unauthorized Update' })
      .expect(403);

    for (let refresh = 0; refresh < 2; refresh += 1) {
      const directory = await request(app.getHttpServer())
        .get('/api/v1/internal/customers?search=Synthetic%20Individual')
        .set(auth(superAdmin.token))
        .expect(200);
      expect(directory.body.data.find((item: any) => item.id === individual.body.id)).toMatchObject({
        status: 'DRAFT',
        displayName: 'Synthetic Individual',
        legalName: 'Synthetic Individual',
      });
    }

    const businessDirectory = await request(app.getHttpServer())
      .get('/api/v1/internal/customers?search=Synthetic%20Example%20Operations')
      .set(auth(superAdmin.token))
      .expect(200);
    expect(businessDirectory.body.data[0]).toMatchObject({
      id: business.body.id,
      type: 'BUSINESS',
      displayName: 'Synthetic Example Operations Ltd',
    });
  }, 120_000);
});
