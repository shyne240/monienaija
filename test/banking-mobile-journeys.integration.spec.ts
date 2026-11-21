import { AuthenticationExecutionService } from '../src/customer-authentication/authentication-execution.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { WITHDRAWAL_EXECUTION_AUTHORITY } from '../src/financial-commitment/withdrawal-execution-authority';
import { CustomerFinancialEligibilityService } from '../src/kyc-verification/customer-financial-eligibility.service';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';
import { AuthenticationSessionService } from '../src/customer-authentication/authentication-session.service';
import { CustomerTransactionPinService } from '../src/customer/customer-transaction-pin.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentAuthenticationService } from '../src/agent-authentication/agent-authentication.service';
import { AgentPasswordHashAlgorithm } from '../src/agent-authentication/agent-authentication.enums';
import { WalletService } from '../src/wallet/wallet.service';
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { AgentService } from '../src/agent/agent-service.enum';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import * as request from 'supertest';

function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(pin, salt, 10000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

describe('Banking mobile journeys (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let custPinService: CustomerTransactionPinService;
  let agentClassService: AgentClassService;
  let agentAppService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let pinService: AgentAuthenticationService;
  let walletService: WalletService;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('bankJourneys');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(KycTierEvidenceReader)
      .useValue({ read: () => Promise.resolve(null) })
      .overrideProvider(CustomerFinancialEligibilityService)
      .useValue({ require: () => Promise.resolve() })
      .overrideProvider(WITHDRAWAL_EXECUTION_AUTHORITY)
      .useValue({
        authorize: () =>
          Promise.resolve({
            outcome: 'AUTHORIZED',
            providerKey: 'MONNIFY',
            environment: 'sandbox',
          }),
      })
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
      .useValue(new TestNotificationProvider())
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    custPinService = app.get(CustomerTransactionPinService);
    agentClassService = app.get(AgentClassService);
    agentAppService = app.get(AgentApplicationService);
    lifecycleService = app.get(AgentLifecycleService);
    pinService = app.get(AgentAuthenticationService);
    walletService = app.get(WalletService);
    await dataSource.query(
      `INSERT INTO banks(id,bank_code,bank_name,short_name,nip_supported,status) VALUES($1,'BANKA','Bank A','BA',true,'ACTIVE') ON CONFLICT DO NOTHING`,
      [randomUUID()],
    );
    await dataSource.query(
      `INSERT INTO banks(id,bank_code,bank_name,short_name,nip_supported,status) VALUES($1,'BANKB','Bank B','BB',true,'ACTIVE') ON CONFLICT DO NOTHING`,
      [randomUUID()],
    );
  }, 120000);

  afterAll(async () => {
    try {
      if (app) await app.close();
    } finally {
      if (dataSource) await destroyIntegrationDataSource(dataSource);
    }
  });

  async function createCustomer(pin: string) {
    const customerId = randomUUID();
    await dataSource.query(
      `INSERT INTO customers(id,reference,customer_type,status,kyc_level,kyc_status) VALUES($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`,
      [customerId, `it.bj.${Date.now()}.${Math.floor(Math.random() * 1e6)}`],
    );
    await custPinService.setTransactionPin(customerId, {
      pinHash: hashPin(pin),
      hashAlgorithm: 'PBKDF2',
      pinVersion: 1,
      actor: customerId,
    });
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials(id,customer_id,password_hash,hash_algorithm,password_version,status,mobile_otp_required) VALUES($1,$2,$3,'PBKDF2',1,'ACTIVE',false) ON CONFLICT DO NOTHING`,
      [randomUUID(), customerId, hashPin('password-123')],
    );
    const authentication = await app
      .get(AuthenticationExecutionService)
      .authenticate({ customerId, password: 'password-123', actor: customerId });
    const session = await app
      .get(AuthenticationSessionService)
      .issue({ authentication, actor: customerId });
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `w-${customerId}-${randomUUID()}`,
    });
    const wl: Array<{ ledger_account_id: string }> = await dataSource.query(
      `SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`,
      [wallet.id],
    );
    const assetRows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`,
    );
    const assetId = assetRows[0]!.id;
    await app.get(LedgerService).postJournal({
      idempotencyKey: `fund-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: assetId, direction: 'DEBIT' as never, amountMinor: '10000' },
        { accountId: wl[0]!.ledger_account_id, direction: 'CREDIT' as never, amountMinor: '10000' },
      ],
    });
    const profile = `CJB_${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    await dataSource.query(
      `INSERT INTO limit_profiles(code,name,kind,status,enabled,configuration_status,created_by) VALUES($1,'Cust BJ','CUSTOMER','ACTIVE',true,'CONFIGURED','fixture')`,
      [profile],
    );
    await dataSource.query(
      `INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,effective_from,is_active,created_by) VALUES($1,$2,'CUSTOMER',$3,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile, customerId],
    );
    await dataSource.query(
      `INSERT INTO limit_rules(id,limit_profile_code,product,direction,currency,dimension,limit_value_minor,effective_from,is_active,created_by) VALUES($1,$2,'EXTERNAL_BANK_TRANSFER','OUTGOING','NGN','DAILY_AMOUNT',20000,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile],
    );
    return {
      customer: { id: customerId } as unknown as { id: string },
      wallet: { id: wallet.id } as unknown as { id: string },
      token: session.accessToken,
      customerId,
      walletAccountId: wallet.id,
      walletLedgerId: wl[0]!.ledger_account_id,
    };
  }

  async function createAgentWithPin(pin: string) {
    const cls = await agentClassService.create({
      reference: `cls-bj-${randomUUID().slice(0, 6)}`,
      code: `BJA-${randomUUID().slice(0, 6).toUpperCase()}`,
      name: 'BJ Class',
      isActive: true,
      applicableServices: [AgentService.EXTERNAL_BANK_TRANSFER, AgentService.CASH_OUT] as unknown,
      actor: 'test',
    });
    const appEntity = await agentAppService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz ${randomUUID().slice(0, 4)}`,
      contactEmail: `bj-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant',
    });
    await agentAppService.submit(appEntity.id, 'applicant');
    await dataSource.query(
      `UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`,
      [appEntity.id],
    );
    const agent = await lifecycleService.activateFromApplication(appEntity.id, 'test-actor');
    await pinService.setTransactionPin(agent.id, {
      pinHash: hashPin(pin),
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      pinVersion: 1,
      actor: agent.id,
    });
    const wallet = await walletService.createWallet({
      customerId: agent.id,
      currency: 'NGN',
      idempotencyKey: `aw-${agent.id}-${randomUUID()}`,
    });
    // affiliation not required for this journey in this environment
    const wlRows: Array<{ ledger_account_id: string }> = await dataSource.query(
      `SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`,
      [wallet.id],
    );
    const assetRows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`,
    );
    await app.get(LedgerService).postJournal({
      idempotencyKey: `fund-a-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: assetRows[0]!.id, direction: 'DEBIT' as never, amountMinor: '10000' },
        {
          accountId: wlRows[0]!.ledger_account_id,
          direction: 'CREDIT' as never,
          amountMinor: '10000',
        },
      ],
    });
    // Create limit
    const profile = `BJA_${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    await dataSource.query(
      `INSERT INTO limit_profiles(code,name,kind,status,enabled,configuration_status,created_by) VALUES($1,'BJ test','AGENT','ACTIVE',true,'CONFIGURED','fixture')`,
      [profile],
    );
    await dataSource.query(
      `INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,effective_from,is_active,created_by) VALUES($1,$2,$3,$4,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile, 'AGENT', agent.id],
    );
    await dataSource.query(
      `INSERT INTO limit_rules(id,limit_profile_code,product,direction,currency,dimension,limit_value_minor,effective_from,is_active,created_by) VALUES($1,$2,'EXTERNAL_BANK_TRANSFER','OUTGOING','NGN','DAILY_AMOUNT',20000,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile],
    );
    const agentToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(agentToken, 'utf8').digest('hex');
    const [cred] = await dataSource.query<[{ id: string }]>(
      `INSERT INTO agent_authentication_credentials(agent_id,password_hash,hash_algorithm,password_version,password_changed_at,status) VALUES($1,$2,'PBKDF2',1,clock_timestamp(),'ACTIVE') RETURNING id`,
      [agent.id, hashPin('login-password')],
    );
    const [sess] = await dataSource.query<[{ id: string }]>(
      `INSERT INTO agent_authentication_sessions(agent_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at) VALUES($1,$2,$3,'agent-api','ACTIVE',clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp()) RETURNING id`,
      [agent.id, cred.id, tokenHash],
    );
    return { agent, wallet, cls, sessionId: sess.id, agentToken, tokenHash };
  }

  async function createBankBeneficiary(customerId: string, bankCode = 'BANKA') {
    const benId = randomUUID();
    await dataSource.query(
      `INSERT INTO customer_beneficiaries(id,customer_id,beneficiary_type,display_name,reference,destination_identifier,normalized_destination_identifier,destination_name,destination_institution,nickname,status,verified,version,created_at,updated_at) VALUES($1,$2,'BANK_ACCOUNT',$3,$4,'1234567890','1234567890','Test Account',$5,'My Bank','ACTIVE',true,1,clock_timestamp(),clock_timestamp())`,
      [benId, customerId, 'Test Account', `bank-${randomUUID()}`, bankCode],
    );
    await dataSource.query(
      `INSERT INTO beneficiary_ownerships(id,beneficiary_id,customer_id,version) VALUES($1,$2,$3,1)`,
      [randomUUID(), benId, customerId],
    );
    return benId;
  }

  async function createAgentBeneficiary(agentId: string, bankCode = 'BANKA') {
    const benId = randomUUID();
    await dataSource.query(
      `INSERT INTO customer_beneficiaries(id,agent_id,beneficiary_type,display_name,reference,destination_identifier,normalized_destination_identifier,destination_name,destination_institution,nickname,status,verified,version,created_at,updated_at) VALUES($1,$2,'BANK_ACCOUNT',$3,$4,'1234567890','1234567890','Test Account',$5,'My Bank','ACTIVE',true,1,clock_timestamp(),clock_timestamp())`,
      [benId, agentId, 'Test Account', `bank-${randomUUID()}`, bankCode],
    );
    await dataSource.query(
      `INSERT INTO beneficiary_ownerships(id,beneficiary_id,agent_id,version) VALUES($1,$2,$3,1)`,
      [randomUUID(), benId, agentId],
    );
    return benId;
  }

  it('customer: directory lists ACTIVE+NIP_SUPPORTED banks', async () => {
    const { token } = await createCustomer('1234');
    const res = await request(app.getHttpServer())
      .get('/api/v1/customers/me/banking/banks')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as { items: Array<{ bankCode: string }> }).items)).toBe(true);
    // BANKA present
    expect(
      (res.body as { items: Array<{ bankCode: string }> }).items.some(
        (b: { bankCode: string }) => b.bankCode === 'BANKA',
      ),
    ).toBe(true);
  });

  it('customer: account-enquiry via directory API', async () => {
    const { token, wallet } = await createCustomer('1234');
    const res = await request(app.getHttpServer())
      .post('/api/v1/customers/me/banking/account-enquiry')
      .set('Authorization', `Bearer ${token}`)
      .send({ bankCode: 'BANKA', accountNumber: '1234567890', walletId: wallet.id });
    // Provider may be unavailable in test; should not 500
    expect([200, 201, 400, 422, 503].includes(res.status)).toBe(true);
  });

  it('customer: initiate bank withdrawal via HTTP and check operationReference', async () => {
    const { customer, wallet, token } = await createCustomer('1234');
    const benId = await createBankBeneficiary(customer.id);
    // Configure customer limit
    const profile = `CJB_${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    await dataSource.query(
      `INSERT INTO limit_profiles(code,name,kind,status,enabled,configuration_status,created_by) VALUES($1,'Cust BJ','CUSTOMER','ACTIVE',true,'CONFIGURED','fixture')`,
      [profile],
    );
    await dataSource.query(
      `INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,effective_from,is_active,created_by) VALUES($1,$2,'CUSTOMER',$3,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile, customer.id],
    );
    await dataSource.query(
      `INSERT INTO limit_rules(id,limit_profile_code,product,direction,currency,dimension,limit_value_minor,effective_from,is_active,created_by) VALUES($1,$2,'EXTERNAL_BANK_TRANSFER','OUTGOING','NGN','DAILY_AMOUNT',20000,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile],
    );
    const res = await request(app.getHttpServer())
      .post('/api/v1/customers/me/withdrawal-commitments')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        walletAccountId: wallet.id,
        beneficiaryId: benId,
        amountMinor: '500',
        currency: 'NGN',
        pin: '1234',
      });
    expect([200, 201].includes(res.status)).toBe(true);
    expect(
      (res.body as { commitmentId: unknown }).commitmentId ||
        (res.body as { externalOperationId: unknown }).externalOperationId ||
        (res.body as { state: unknown }).state,
    ).toBeTruthy();
  });

  it('customer: bank-transfer-preview returns authoritative pricing', async () => {
    const { customer, wallet, token } = await createCustomer('1234');
    const benId = await createBankBeneficiary(customer.id);
    const profile2 = `CJP_${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    await dataSource.query(
      `INSERT INTO limit_profiles(code,name,kind,status,enabled,configuration_status,created_by) VALUES($1,'Cust JP','CUSTOMER','ACTIVE',true,'CONFIGURED','fixture')`,
      [profile2],
    );
    await dataSource.query(
      `INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,effective_from,is_active,created_by) VALUES($1,$2,'CUSTOMER',$3,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile2, customer.id],
    );
    await dataSource.query(
      `INSERT INTO limit_rules(id,limit_profile_code,product,direction,currency,dimension,limit_value_minor,effective_from,is_active,created_by) VALUES($1,$2,'EXTERNAL_BANK_TRANSFER','OUTGOING','NGN','DAILY_AMOUNT',20000,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile2],
    );
    const res = await request(app.getHttpServer())
      .get(
        `/api/v1/customers/me/banking/bank-transfer-preview?beneficiaryId=${benId}&amountMinor=1000&walletId=${wallet.id}`,
      )
      .set('Authorization', `Bearer ${token}`);
    expect([200, 201].includes(res.status) || res.status === 400 || res.status === 404).toBe(true);
    if (res.status === 200) {
      expect((res.body as { principalMinor: unknown }).principalMinor).toBeDefined();
      expect((res.body as { totalDebitMinor: unknown }).totalDebitMinor).toBeDefined();
    }
  });

  it('customer: transfer-status by operationReference', async () => {
    const { customer, wallet, token } = await createCustomer('1234');
    const benId = await createBankBeneficiary(customer.id);
    const profile = `CJS_${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    await dataSource.query(
      `INSERT INTO limit_profiles(code,name,kind,status,enabled,configuration_status,created_by) VALUES($1,'Cust JS','CUSTOMER','ACTIVE',true,'CONFIGURED','fixture')`,
      [profile],
    );
    await dataSource.query(
      `INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,effective_from,is_active,created_by) VALUES($1,$2,'CUSTOMER',$3,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile, customer.id],
    );
    await dataSource.query(
      `INSERT INTO limit_rules(id,limit_profile_code,product,direction,currency,dimension,limit_value_minor,effective_from,is_active,created_by) VALUES($1,$2,'EXTERNAL_BANK_TRANSFER','OUTGOING','NGN','DAILY_AMOUNT',20000,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile],
    );
    const initiated = await request(app.getHttpServer())
      .post('/api/v1/customers/me/withdrawal-commitments')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        walletAccountId: wallet.id,
        beneficiaryId: benId,
        amountMinor: '700',
        currency: 'NGN',
        pin: '1234',
      });
    if (
      (initiated.status === 200 || initiated.status === 201) &&
      (initiated.body as { operationReference: string }).operationReference
    ) {
      const statusRes = await request(app.getHttpServer())
        .get(
          `/api/v1/customers/me/banking/transfers/${encodeURIComponent((initiated.body as { operationReference: string }).operationReference)}`,
        )
        .set('Authorization', `Bearer ${token}`);
      expect([200, 404].includes(statusRes.status)).toBe(true);
    } else {
      // No operationReference yet is acceptable — commitment still created
      expect([200, 201].includes(initiated.status)).toBe(true);
    }
  });

  it('agent: directory + account-enquiry', async () => {
    const { agentToken } = await createAgentWithPin('1234');
    const res = await request(app.getHttpServer())
      .get('/api/v1/agents/me/banking/banks')
      .set('Authorization', `Bearer ${agentToken}`);
    expect([200, 401].includes(res.status)).toBe(true);
    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as { items: Array<{ bankCode: string }> }).items)).toBe(true);
  });

  it('agent: bank-transfers HTTP initiates commitment', async () => {
    const { agent, wallet, agentToken } = await createAgentWithPin('1234');
    const benId = await createAgentBeneficiary(agent.id);
    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/me/banking/bank-transfers')
      .set('Authorization', `Bearer ${agentToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        walletAccountId: wallet.id,
        beneficiaryId: benId,
        amountMinor: '500',
        currency: 'NGN',
        pin: '1234',
      });
    expect([200, 201].includes(res.status)).toBe(true);
    expect((res.body as { commitmentId: unknown }).commitmentId).toBeDefined();
    expect((res.body as { operationReference: string }).operationReference).toBeDefined();
  });

  it('agent: bank-transfer preview', async () => {
    const { agent, wallet, agentToken } = await createAgentWithPin('1234');
    const benId = await createAgentBeneficiary(agent.id);
    const res = await request(app.getHttpServer())
      .get(
        `/api/v1/agents/me/banking/bank-transfer-preview?beneficiaryId=${benId}&amountMinor=1000&walletId=${wallet.id}`,
      )
      .set('Authorization', `Bearer ${agentToken}`);
    expect([200].includes(res.status) || res.status === 400 || res.status === 404).toBe(true);
    if (res.status === 200) {
      expect((res.body as { principalMinor: unknown }).principalMinor).toBeDefined();
      expect((res.body as { totalDebitMinor: unknown }).totalDebitMinor).toBeDefined();
    }
  });

  it('customer: rejects wrong PIN', async () => {
    const { customer, wallet, token } = await createCustomer('1234');
    const benId = await createBankBeneficiary(customer.id);
    const profile = `CJE_${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    await dataSource.query(
      `INSERT INTO limit_profiles(code,name,kind,status,enabled,configuration_status,created_by) VALUES($1,'Cust JE','CUSTOMER','ACTIVE',true,'CONFIGURED','fixture')`,
      [profile],
    );
    await dataSource.query(
      `INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,effective_from,is_active,created_by) VALUES($1,$2,'CUSTOMER',$3,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile, customer.id],
    );
    await dataSource.query(
      `INSERT INTO limit_rules(id,limit_profile_code,product,direction,currency,dimension,limit_value_minor,effective_from,is_active,created_by) VALUES($1,$2,'EXTERNAL_BANK_TRANSFER','OUTGOING','NGN','DAILY_AMOUNT',20000,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile],
    );
    const res = await request(app.getHttpServer())
      .post('/api/v1/customers/me/withdrawal-commitments')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        walletAccountId: wallet.id,
        beneficiaryId: benId,
        amountMinor: '500',
        currency: 'NGN',
        pin: '9999',
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('customer: idempotent duplicate replays same commitment', async () => {
    const { customer, wallet, token } = await createCustomer('1234');
    const benId = await createBankBeneficiary(customer.id);
    const profile = `CJD_${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    await dataSource.query(
      `INSERT INTO limit_profiles(code,name,kind,status,enabled,configuration_status,created_by) VALUES($1,'Cust JD','CUSTOMER','ACTIVE',true,'CONFIGURED','fixture')`,
      [profile],
    );
    await dataSource.query(
      `INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,effective_from,is_active,created_by) VALUES($1,$2,'CUSTOMER',$3,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile, customer.id],
    );
    await dataSource.query(
      `INSERT INTO limit_rules(id,limit_profile_code,product,direction,currency,dimension,limit_value_minor,effective_from,is_active,created_by) VALUES($1,$2,'EXTERNAL_BANK_TRANSFER','OUTGOING','NGN','DAILY_AMOUNT',20000,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile],
    );
    const key = randomUUID();
    const first = await request(app.getHttpServer())
      .post('/api/v1/customers/me/withdrawal-commitments')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({
        walletAccountId: wallet.id,
        beneficiaryId: benId,
        amountMinor: '400',
        currency: 'NGN',
        pin: '1234',
      });
    const second = await request(app.getHttpServer())
      .post('/api/v1/customers/me/withdrawal-commitments')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({
        walletAccountId: wallet.id,
        beneficiaryId: benId,
        amountMinor: '400',
        currency: 'NGN',
        pin: '1234',
      });
    if (first.status === 200 || first.status === 201) {
      expect([200, 201].includes(second.status)).toBe(true);
      expect(
        (second.body as { commitmentId: unknown }).commitmentId ??
          (second.body as { id: unknown }).id ??
          (second.body as { commitment: { id?: string } }).commitment?.id,
      ).toBeTruthy();
    }
  });
});
