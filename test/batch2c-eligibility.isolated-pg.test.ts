// Mobile client uses these native adapters; requests below are bridged to the real Fastify app.
jest.mock('react-native', () => ({ Platform: { OS: 'test' } }), { virtual: true });
jest.mock('expo-secure-store', () => ({}), { virtual: true });
import { CashOutInstitutionResolver } from '../src/agent/cash-out-institution.resolver';
import { CustomerFinancialEligibilityService } from '../src/kyc-verification/customer-financial-eligibility.service';
import type { TierEvidenceSnapshot } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { CustomerService } from '../src/customer/customer.service';
import { CustomerWalletService } from '../src/customer-wallet/customer-wallet.service';
import { CustomerWalletType } from '../src/customer-wallet/customer-wallet.enums';
import { CustomerStatus } from '../src/customer/customer.enums';
import { WalletService } from '../src/wallet/wallet.service';
import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';

const socket = process.env.KYC_ISOLATED_TEST_SOCKET ?? '';
if (!/^\/home\/user\/m25c-isolated-pgsocket\/kyc-batch1-[A-Za-z0-9]+$/.test(socket))
  throw new Error('Disposable KYC socket required');
const name = `kyc_batch2_${randomUUID().replace(/-/g, '')}`;
const admin = new DataSource({
  type: 'postgres',
  host: socket,
  port: 55461,
  username: 'kyc_synthetic',
  database: 'postgres',
  synchronize: false,
  migrationsRun: false,
  entities: [],
  migrations: [],
});
let created = false;
let db: DataSource;
let app: NestFastifyApplication;
const sms = new TestNotificationProvider();
// This adapter is strictly local to this test module; no real provider is called.
const snapshots = new Map<string, TierEvidenceSnapshot>();

beforeAll(async () => {
  await admin.initialize();
  const [location] = await admin.query<Array<{ data_directory: string }>>('SHOW data_directory');
  const [listen] = await admin.query<Array<{ listen_addresses: string }>>('SHOW listen_addresses');
  const [version] = await admin.query<Array<{ server_version: string }>>('SHOW server_version');
  if (
    !/^\/home\/user\/kyc-batch1-pg-[A-Za-z0-9]+$/.test(location?.data_directory ?? '') ||
    listen?.listen_addresses !== '' ||
    !version?.server_version.startsWith('16.')
  )
    throw new Error('Not an independently isolated PostgreSQL 16 cluster');
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  db = new DataSource({
    type: 'postgres',
    host: socket,
    port: 55461,
    username: 'kyc_synthetic',
    database: name,
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: 'typeorm_migrations',
    entities: [`${__dirname}/../src/**/*.entity.ts`],
    migrations: [`${__dirname}/../src/migrations/*.ts`],
  });
  await db.initialize();
  await db.runMigrations({ transaction: 'all' });
  const { AppModule } = await import('../src/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(db)
    .overrideProvider(CashOutInstitutionResolver)
    .useValue({
      resolve: (_manager: unknown, agentId: string) =>
        Promise.resolve({
          outcome: 'RESOLVED',
          agentId,
          institutionId: 'MONIENAIJA',
          affiliationId: 'test-affiliation',
          institutionStatus: 'APPROVED',
          resolvedAt: new Date().toISOString(),
          evidenceFingerprint: 'fixture',
        }),
    })
    .overrideProvider(KycTierEvidenceReader)
    .useValue({ read: (_m: unknown, id: string) => Promise.resolve(snapshots.get(id) ?? null) })
    .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
    .useValue(sms)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 180_000);
afterAll(async () => {
  if (app) await app.close();
  if (db?.isInitialized) await db.destroy();
  if (admin.isInitialized) {
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.destroy();
  }
});

async function setPolicy() {
  const proposal = randomUUID();
  const req = { all: [], any: [] };
  const definition = {
    regulatoryRequirementsConfirmed: true,
    effectiveFrom: '2020-01-01T00:00:00.000Z',
    effectiveUntil: null,
    regulatory: { LEVEL_1: req, LEVEL_2: req },
    operator: { LEVEL_1: req, LEVEL_2: req },
  };
  await db.query(
    `INSERT INTO kyc_tier_policy_proposals(id,request_id,expected_version,definition,fingerprint,maker_id,maker_session_id,checker_id,checker_session_id,state) VALUES($1,$2,0,$3,$4,'maker',$5,'checker',$6,'APPROVED')`,
    [
      proposal,
      randomUUID(),
      JSON.stringify(definition),
      'a'.repeat(64),
      randomUUID(),
      randomUUID(),
    ],
  );
  await db.query(
    `INSERT INTO kyc_tier_policy_versions(version,proposal_id,definition,maker_id,checker_id) VALUES(1,$1,$2,'maker','checker')`,
    [proposal, JSON.stringify(definition)],
  );
  await db.query('UPDATE kyc_tier_policy_head SET version=1');
}
async function subject(
  level: 'LEVEL_1' | 'LEVEL_2',
  types: Array<'BVN' | 'NIN'>,
  synthetic = false,
) {
  const id = randomUUID();
  const phone = `${Math.floor(1000000000 + Math.random() * 8999999999)}`;
  await db.query(
    `INSERT INTO customers(id,reference,customer_type,status,kyc_level,kyc_status,is_synthetic) VALUES($1,$2,'INDIVIDUAL','DRAFT',CASE WHEN $4 THEN 'NONE' ELSE $3 END,CASE WHEN $4 THEN 'NOT_STARTED' ELSE 'APPROVED' END,$4)`,
    [id, id, level, synthetic],
  );
  await db.query(
    `INSERT INTO customer_contact_methods(customer_id,type,value,normalized_value,is_primary,verified_at) VALUES($1,'PHONE',$2,$2,true,clock_timestamp())`,
    [id, phone],
  );
  await db.query(
    `INSERT INTO customer_kyc_assessments(customer_id,kyc_level,kyc_status,assessed_by,expires_at) VALUES($1,$2,'APPROVED','fixture',clock_timestamp()+interval '1 hour')`,
    [id, level],
  );
  snapshots.set(id, {
    identityRevision: 'fixture',
    evidence: types.map((type) => ({
      id: randomUUID(),
      customerId: id,
      identityRevision: 'fixture',
      type,
      status: 'VERIFIED',
      provenance: 'VERIFIED_PROVIDER',
      verifiedAt: new Date(Date.now() - 10000),
      expiresAt: new Date(Date.now() + 1800000),
    })),
  });
  return id;
}

test('controlled evidence gates activation and customer wallet creation, without credentials', async () => {
  await setPolicy();
  const customers = app.get(CustomerService),
    wallets = app.get(WalletService),
    customerWallets = app.get(CustomerWalletService);
  const one = await subject('LEVEL_1', ['BVN']);
  const two = await subject('LEVEL_2', ['BVN', 'NIN']);
  const incomplete = await subject('LEVEL_2', ['BVN']);
  const synthetic = await subject('LEVEL_1', ['BVN'], true);
  await expect(
    customers.updateStatus(incomplete, { status: CustomerStatus.ACTIVE, actor: 'fixture' }),
  ).rejects.toThrow();
  await expect(
    customers.updateStatus(synthetic, { status: CustomerStatus.ACTIVE, actor: 'fixture' }),
  ).rejects.toThrow();
  await expect(
    customers.updateStatus(one, { status: CustomerStatus.ACTIVE, actor: 'fixture' }),
  ).resolves.toMatchObject({ status: 'ACTIVE' });
  await expect(
    customers.updateStatus(two, { status: CustomerStatus.ACTIVE, actor: 'fixture' }),
  ).resolves.toMatchObject({ status: 'ACTIVE' });
  await expect(
    wallets.createWallet({ customerId: incomplete, currency: 'NGN', idempotencyKey: 'denied' }),
  ).rejects.toThrow();
  await expect(
    customerWallets.createWallet(incomplete, {
      type: CustomerWalletType.PRIMARY,
      currency: 'NGN',
      actor: 'fixture',
    }),
  ).rejects.toThrow();
  const results = await Promise.allSettled(
    [1, 2].map((n) =>
      wallets.createWallet({ customerId: one, currency: 'NGN', idempotencyKey: `parallel-${n}` }),
    ),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(
    await db.query('SELECT count(*)::int AS n FROM wallet_accounts WHERE customer_id=$1', [one]),
  ).toEqual([{ n: 1 }]);
  const gate = app.get(CustomerFinancialEligibilityService);
  await expect(db.transaction((m) => gate.require(m, two))).resolves.toBeUndefined();
  snapshots.get(two)!.evidence[0]!.status = 'REVOKED';
  await expect(db.transaction((m) => gate.require(m, two))).rejects.toThrow();
  await expect(
    wallets.createWallet({ customerId: two, currency: 'NGN', idempotencyKey: 'revoked' }),
  ).rejects.toThrow();
  await db.query(`UPDATE customers SET status='SUSPENDED' WHERE id=$1`, [one]);
  await expect(db.transaction((m) => gate.require(m, one))).rejects.toThrow();
});

test('unavailable, synthetic, conflicting and expired evidence or holds fail closed', async () => {
  const gate = app.get(CustomerFinancialEligibilityService);
  const id = await subject('LEVEL_1', ['NIN']);
  await db.query(`UPDATE customers SET status='ACTIVE' WHERE id=$1`, [id]);
  const check = () => db.transaction((m) => gate.require(m, id));
  await expect(check()).resolves.toBeUndefined();
  const snapshot = snapshots.get(id)!;
  snapshots.delete(id);
  await expect(check()).rejects.toThrow('Trusted KYC evidence is unavailable');
  snapshots.set(id, snapshot);
  snapshot.evidence[0]!.provenance = 'SYNTHETIC';
  await expect(check()).rejects.toThrow();
  snapshot.evidence[0]!.provenance = 'VERIFIED_PROVIDER';
  snapshot.evidence[0]!.status = 'REVIEW';
  await expect(check()).rejects.toThrow();
  snapshot.evidence[0]!.status = 'VERIFIED';
  await db.query(
    `INSERT INTO kyc_tier_manual_holds(customer_id,actor,reason) VALUES($1,'test','MANUAL_REVIEW')`,
    [id],
  );
  await expect(check()).rejects.toThrow();
  await db.query(`DELETE FROM kyc_tier_manual_holds WHERE customer_id=$1`, [id]);
  await db.query(
    `UPDATE customer_kyc_assessments SET expires_at=clock_timestamp()-interval '1 minute' WHERE customer_id=$1`,
    [id],
  );
  await expect(check()).rejects.toThrow();
});

test.each([
  ['LEVEL_1', ['BVN']],
  ['LEVEL_2', ['BVN', 'NIN']],
] as const)(
  'mobile %s scoped session is restricted immediately on KYC withdrawal',
  async (level, types) => {
    const { pbkdf2Sync, createHash, randomBytes } = await import('node:crypto');
    const { MobileOnboardingAuthService } = await import(
      '../src/customer-registration/mobile-onboarding-auth.service'
    );
    const { AuthenticationSessionService } = await import(
      '../src/customer-authentication/authentication-session.service'
    );
    const id = await subject(level, [...types]);
    await db.query(`UPDATE customers SET status='ACTIVE' WHERE id=$1`, [id]);
    const phones = await db.query<Array<{ normalized_value: string }>>(
      `SELECT normalized_value FROM customer_contact_methods WHERE customer_id=$1`,
      [id],
    );
    const phone = phones[0]!.normalized_value;
    const salt = randomBytes(16);
    const hash = `PBKDF2$sha256$10000$${salt.toString('base64url')}$${pbkdf2Sync('112233', salt, 10000, 32, 'sha256').toString('base64url')}`;
    const credential = randomUUID();
    await db.query(
      `INSERT INTO customer_authentication_credentials(id,customer_id,password_hash,hash_algorithm,password_version,status,mobile_otp_required) VALUES($1,$2,$3,'PBKDF2',1,'ACTIVE',true)`,
      [credential, id, hash],
    );
    const token = randomBytes(32).toString('base64url');
    const registration = randomUUID();
    await db.query(
      `INSERT INTO kyc_registration_sessions(id,phone,authorization_hash,status,verified_at,expires_at) VALUES($1,$2,$3,'VERIFIED',clock_timestamp(),clock_timestamp()+interval '10 minutes')`,
      [registration, phone, createHash('sha256').update(token).digest('hex')],
    );
    const session = await app.get(MobileOnboardingAuthService).login(registration, token, '112233');
    expect(session.audience).toBe('customer-api');
    const sessionService = app.get(AuthenticationSessionService);
    expect((await sessionService.validate({ token: session.accessToken })).valid).toBe(true);
    snapshots.get(id)!.evidence[0]!.status = 'REVOKED';
    expect((await sessionService.validate({ token: session.accessToken })).valid).toBe(false);
    snapshots.get(id)!.evidence[0]!.status = 'VERIFIED';
    await db.query(
      `UPDATE customer_authentication_credentials SET password_version=2 WHERE id=$1`,
      [credential],
    );
    expect((await sessionService.validate({ token: session.accessToken })).valid).toBe(false);
    const secondToken = randomBytes(32).toString('base64url');
    const secondRegistration = randomUUID();
    await db.query(
      `INSERT INTO kyc_registration_sessions(id,phone,authorization_hash,status,verified_at,expires_at) VALUES($1,$2,$3,'VERIFIED',clock_timestamp(),clock_timestamp()+interval '10 minutes')`,
      [secondRegistration, phone, createHash('sha256').update(secondToken).digest('hex')],
    );
    snapshots.get(id)!.evidence.forEach((e) => {
      e.provenance = 'SYNTHETIC';
    });
    const restricted = await app
      .get(MobileOnboardingAuthService)
      .login(secondRegistration, secondToken, '112233');
    expect(restricted.audience).toBe('customer-onboarding');
    expect((await sessionService.validate({ token: restricted.accessToken })).valid).toBe(false);
  },
);

test('ledger posting gates existing customer wallets and separates agent and review owners', async () => {
  const { LedgerService } = await import('../src/ledger/ledger.service');
  const { LedgerAccountType, LedgerEntryDirection } = await import('../src/ledger/ledger.enums');
  const customer = await subject('LEVEL_1', ['BVN']);
  await db.query(`UPDATE customers SET status='ACTIVE' WHERE id=$1`, [customer]);
  const wallet = await app
    .get(WalletService)
    .createWallet({ customerId: customer, currency: 'NGN', idempotencyKey: randomUUID() });
  const agent = randomUUID();
  await db.query(`INSERT INTO agents(id,reference,status) VALUES($1,$2,'ACTIVE')`, [
    agent,
    `agent-${agent}`,
  ]);
  const agentWallet = await app
    .get(WalletService)
    .createWallet({ customerId: agent, currency: 'NGN', idempotencyKey: randomUUID() });
  expect(
    await db.query(`SELECT owner_class FROM wallet_accounts WHERE id=$1`, [wallet.id]),
  ).toEqual([{ owner_class: 'CUSTOMER' }]);
  expect(
    await db.query(`SELECT owner_class FROM wallet_accounts WHERE id=$1`, [agentWallet.id]),
  ).toEqual([{ owner_class: 'AGENT' }]);
  await expect(
    db.query(`UPDATE wallet_accounts SET owner_class='AGENT' WHERE id=$1`, [wallet.id]),
  ).rejects.toThrow();
  await expect(
    app
      .get(WalletService)
      .createWallet({ customerId: randomUUID(), currency: 'NGN', idempotencyKey: randomUUID() }),
  ).rejects.toThrow();
  const ledger = app.get(LedgerService);
  const system = await ledger.createAccount({
    code: `system-${randomUUID()}`,
    name: 'isolated operational',
    currency: 'NGN',
    accountType: LedgerAccountType.ASSET,
    allowNegativeBalance: true,
  });
  const tryPosting = async (accountId: string) => {
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      return await ledger.postJournalInTransaction(runner.manager, {
        idempotencyKey: randomUUID(),
        currency: 'NGN',
        lines: [
          { accountId: system.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '1' },
          { accountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '1' },
        ],
      });
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  };
  await expect(tryPosting(wallet.ledgerAccountId)).resolves.toBeDefined();
  await expect(tryPosting(agentWallet.ledgerAccountId)).resolves.toBeDefined();
  const { ExternalOperationService } = await import('../src/partner/external-operation.service');
  const { ExternalOperationResourceType } = await import('../src/partner/external-operation.enums');
  const operationCommand = {
    partnerKey: 'NIBSS_NIP' as const,
    capabilityKey: 'external.wallet.withdrawal.settlement' as const,
    operationType: 'OUTBOUND_BANK_SETTLEMENT' as const,
    resourceType: ExternalOperationResourceType.WITHDRAWAL,
    resourceId: randomUUID(),
    internalCommandId: randomUUID(),
    customerId: customer,
    walletAccountId: agentWallet.id,
    ledgerAccountId: agentWallet.ledgerAccountId,
    targetMappingReference: `a6-target:${'a'.repeat(64)}`,
    amountMinor: '1',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS' as const,
    idempotencyKey: randomUUID(),
    requestContext: { requestId: 'request', correlationId: 'correlation', traceId: 'trace' },
  };
  await expect(app.get(ExternalOperationService).create(operationCommand)).rejects.toThrow(
    'Customer wallet ownership requires review',
  );
  const withdrawal = randomUUID();
  await db.query(
    `INSERT INTO withdrawals(id,wallet_id,payment_reference,amount_minor,currency,status,idempotency_key,request_hash) VALUES($1,$2,$3,1,'NGN','PENDING',$4,$5)`,
    [
      withdrawal,
      wallet.id,
      `MN${Math.floor(1000000000 + Math.random() * 8000000000)}`,
      randomUUID(),
      'a'.repeat(64),
    ],
  );
  const operation = await app.get(ExternalOperationService).create({
    ...operationCommand,
    resourceId: withdrawal,
    walletAccountId: wallet.id,
    ledgerAccountId: wallet.ledgerAccountId,
  });
  const { ExternalOperationLifecycleService } = await import(
    '../src/partner/external-operation-lifecycle.service'
  );
  snapshots.get(customer)!.evidence[0]!.status = 'REVOKED';
  await expect(
    app
      .get(ExternalOperationLifecycleService)
      .beginAttempt(operation.externalOperationId, randomUUID(), operationCommand.requestContext),
  ).rejects.toThrow();
  expect(
    await db.query(`SELECT lifecycle_state FROM external_operations WHERE id=$1`, [
      operation.externalOperationId,
    ]),
  ).toEqual([{ lifecycle_state: 'CREATED' }]);
  await expect(
    app.get(ExternalOperationService).create({
      ...operationCommand,
      walletAccountId: wallet.id,
      ledgerAccountId: wallet.ledgerAccountId,
    }),
  ).rejects.toThrow();
  await expect(tryPosting(wallet.ledgerAccountId)).rejects.toThrow();
  await expect(tryPosting(agentWallet.ledgerAccountId)).resolves.toBeDefined();
  expect(
    await db.query(`SELECT count(*)::int AS n FROM ledger_lines WHERE ledger_account_id=$1`, [
      wallet.ledgerAccountId,
    ]),
  ).toEqual([{ n: 0 }]);
});

test('legacy classification preserves rows and leaves unknown or colliding references in review', async () => {
  const { WalletOwnerClassification1785753600116 } = await import(
    '../src/migrations/1785753600116-WalletOwnerClassification'
  );
  const runner = db.createQueryRunner();
  const schema = `ownership_${randomUUID().replace(/-/g, '')}`;
  await runner.connect();
  try {
    await runner.query(`CREATE SCHEMA ${schema}`);
    await runner.query(`SET search_path TO ${schema}`);
    await runner.query(
      `CREATE TABLE customers(id uuid PRIMARY KEY,reference text NOT NULL); CREATE TABLE agents(id uuid PRIMARY KEY,reference text NOT NULL); CREATE TABLE wallet_accounts(id uuid PRIMARY KEY, customer_id text NOT NULL,ledger_account_id uuid NOT NULL); CREATE TABLE historical_journals(id uuid PRIMARY KEY, amount bigint NOT NULL)`,
    );
    const customer = randomUUID(),
      agent = randomUUID(),
      unknown = randomUUID(),
      collision = randomUUID();
    await runner.query(
      `INSERT INTO customers VALUES($1,'customer-ref'),($2,'collision-customer')`,
      [customer, collision],
    );
    await runner.query(`INSERT INTO agents VALUES($1,'agent-ref'),($2,'collision-agent')`, [
      agent,
      collision,
    ]);
    for (const owner of [customer, agent, unknown, collision])
      await runner.query(`INSERT INTO wallet_accounts VALUES($1,$2,$3)`, [
        randomUUID(),
        owner,
        randomUUID(),
      ]);
    const journal = randomUUID();
    await runner.query(`INSERT INTO historical_journals VALUES($1,123)`, [journal]);
    await new WalletOwnerClassification1785753600116().up(runner);
    expect(
      await runner.query(
        `SELECT customer_id,owner_class FROM wallet_accounts ORDER BY customer_id`,
      ),
    ).toEqual(
      expect.arrayContaining([
        { customer_id: customer, owner_class: 'CUSTOMER' },
        { customer_id: agent, owner_class: 'AGENT' },
        { customer_id: unknown, owner_class: 'REVIEW' },
        { customer_id: collision, owner_class: 'REVIEW' },
      ]),
    );
    expect(await runner.query(`SELECT id,amount::int AS amount FROM historical_journals`)).toEqual([
      { id: journal, amount: 123 },
    ]);
    await expect(
      runner.query(`UPDATE wallet_accounts SET owner_class='AGENT' WHERE customer_id=$1`, [
        customer,
      ]),
    ).rejects.toThrow();
  } finally {
    await runner.query('SET search_path TO public');
    await runner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await runner.release();
  }
});

test('desk OTP preflight denies withdrawn and unavailable evidence before challenge or delivery', async () => {
  const { AgentDeskOtpService } = await import('../src/agent/agent-desk-otp.service');
  const customerId = await subject('LEVEL_1', ['BVN']);
  await db.query(`UPDATE customers SET status='ACTIVE' WHERE id=$1`, [customerId]);
  await db.query(
    `INSERT INTO customer_authentication_credentials(id, customer_id, password_hash, hash_algorithm, password_version, status) VALUES($1,$2,'fixture-hash','PBKDF2',1,'ACTIVE')`,
    [randomUUID(), customerId],
  );
  const otp = app.get(AgentDeskOtpService);
  const command = { agentId: randomUUID(), customerId, purpose: 'CASH_TO_CASH_CLAIM' as const };
  sms.clear();
  snapshots.get(customerId)!.evidence[0]!.status = 'REVOKED';
  await expect(otp.issue(command)).rejects.toThrow();
  expect(sms.sent).toHaveLength(0);
  expect(
    await db.query(`SELECT id FROM mfa_challenges WHERE customer_id=$1`, [customerId]),
  ).toEqual([]);
  const snapshot = snapshots.get(customerId)!;
  snapshot.evidence[0]!.status = 'VERIFIED';
  snapshots.delete(customerId);
  await expect(otp.issue(command)).rejects.toThrow('Trusted KYC evidence is unavailable');
  expect(sms.sent).toHaveLength(0);
  expect(
    await db.query(`SELECT id FROM mfa_challenges WHERE customer_id=$1`, [customerId]),
  ).toEqual([]);
  snapshots.set(customerId, snapshot);
  await expect(otp.issue(command)).resolves.toMatchObject({ customerId, delivered: true });
  expect(sms.sent).toHaveLength(1);
});

test('MFA transaction primitive rolls back with its caller and serializes concurrent verification', async () => {
  const { AgentDeskOtpService } = await import('../src/agent/agent-desk-otp.service');
  const { MfaExecutionService } = await import(
    '../src/customer-authentication/mfa-execution.service'
  );
  const customerId = await subject('LEVEL_1', ['BVN']);
  await db.query(`UPDATE customers SET status='ACTIVE' WHERE id=$1`, [customerId]);
  const credentialId = randomUUID();
  await db.query(
    `INSERT INTO customer_authentication_credentials(id,customer_id,password_hash,hash_algorithm,password_version,status) VALUES($1,$2,'fixture-hash','PBKDF2',1,'ACTIVE')`,
    [credentialId, customerId],
  );
  sms.clear();
  const issued = await app.get(AgentDeskOtpService).issue({
    agentId: randomUUID(),
    customerId,
    purpose: 'CASH_TO_CASH_CLAIM',
  });
  const code = sms.sent[0]!.message.match(/code is (\d{6})/)![1]!;
  const [row] = await db.query<Array<{ session_id: string }>>(
    `SELECT session_id FROM mfa_challenges WHERE id=$1`,
    [issued.challengeId],
  );
  const command = {
    principal: {
      principalType: 'CUSTOMER' as const,
      customerId,
      credentialId,
      sessionId: row!.session_id,
      audience: 'customer-api',
      authenticatedAt: new Date(),
      expiresAt: issued.expiresAt,
    },
    challengeId: issued.challengeId,
    providedHash: code,
    actor: customerId,
    expectedPurpose: 'CASH_TO_CASH_CLAIM',
  };
  const mfa = app.get(MfaExecutionService);
  await expect(
    db.transaction(async (manager) => {
      expect((await mfa.verifyChallengeInManager(manager, command)).verified).toBe(true);
      throw new Error('synthetic transaction failure');
    }),
  ).rejects.toThrow('synthetic transaction failure');
  expect(
    await db.query(`SELECT status FROM mfa_challenges WHERE id=$1`, [issued.challengeId]),
  ).toEqual([{ status: 'ACTIVE' }]);
  const results = await Promise.all([mfa.verifyChallenge(command), mfa.verifyChallenge(command)]);
  expect(results.filter((result) => result.verified)).toHaveLength(1);
  expect(results.filter((result) => result.failureReason === 'REPLAYED')).toHaveLength(1);
  expect(
    await db.query(`SELECT status FROM mfa_challenges WHERE id=$1`, [issued.challengeId]),
  ).toEqual([{ status: 'VERIFIED' }]);
});

test('concurrent incorrect desk OTPs persist a challenge attempt limit', async () => {
  const { AgentDeskOtpService } = await import('../src/agent/agent-desk-otp.service');
  const { MfaExecutionService } = await import(
    '../src/customer-authentication/mfa-execution.service'
  );
  const customerId = await subject('LEVEL_1', ['BVN']);
  await db.query(`UPDATE customers SET status='ACTIVE' WHERE id=$1`, [customerId]);
  const credentialId = randomUUID();
  await db.query(
    `INSERT INTO customer_authentication_credentials(id,customer_id,password_hash,hash_algorithm,password_version,status) VALUES($1,$2,'fixture-hash','PBKDF2',1,'ACTIVE')`,
    [credentialId, customerId],
  );
  sms.clear();
  const issued = await app
    .get(AgentDeskOtpService)
    .issue({ agentId: randomUUID(), customerId, purpose: 'CASH_TO_CASH_CLAIM' });
  const code = sms.sent[0]!.message.match(/code is (\d{6})/)![1]!;
  const incorrect = code === '000000' ? '000001' : '000000';
  const [row] = await db.query<Array<{ session_id: string }>>(
    `SELECT session_id FROM mfa_challenges WHERE id=$1`,
    [issued.challengeId],
  );
  const command = {
    principal: {
      principalType: 'CUSTOMER' as const,
      customerId,
      credentialId,
      sessionId: row!.session_id,
      audience: 'customer-api',
      authenticatedAt: new Date(),
      expiresAt: issued.expiresAt,
    },
    challengeId: issued.challengeId,
    providedHash: incorrect,
    actor: customerId,
    expectedPurpose: 'CASH_TO_CASH_CLAIM',
  };
  const mfa = app.get(MfaExecutionService);
  const results = await Promise.all(Array.from({ length: 5 }, () => mfa.verifyChallenge(command)));
  expect(results.every((result) => !result.verified && result.failureReason === 'MISMATCH')).toBe(
    true,
  );
  expect(
    await db.query(
      `SELECT failed_attempts,status,revoked_at IS NOT NULL AS revoked FROM mfa_challenges WHERE id=$1`,
      [issued.challengeId],
    ),
  ).toEqual([{ failed_attempts: 5, status: 'REVOKED', revoked: true }]);
  await expect(mfa.verifyChallenge({ ...command, providedHash: code })).resolves.toMatchObject({
    verified: false,
    failureReason: 'MFA_UNAVAILABLE',
  });
});

test('cash-out rolls back OTP on ledger failure and retries through the real financial boundary', async () => {
  const { pbkdf2Sync, randomBytes, createHash } = await import('node:crypto');
  const { AgentDeskOtpService } = await import('../src/agent/agent-desk-otp.service');
  const { AgentCashOutService } = await import('../src/agent/agent-cash-out.service');
  const { AgentClassService } = await import('../src/agent/agent-class.service');
  const { AgentApplicationService } = await import('../src/agent/agent-application.service');
  const { AgentLifecycleService } = await import('../src/agent/agent-lifecycle.service');
  const { AgentAuthenticationService } = await import(
    '../src/agent-authentication/agent-authentication.service'
  );
  const { CustomerTransactionPinService } = await import(
    '../src/customer/customer-transaction-pin.service'
  );
  const { AgentService } = await import('../src/agent/agent-service.enum');
  const { AgentPasswordHashAlgorithm } = await import(
    '../src/agent-authentication/agent-authentication.enums'
  );
  const { LedgerService } = await import('../src/ledger/ledger.service');
  const { LedgerAccountType, LedgerEntryDirection, LedgerNormalBalance } = await import(
    '../src/ledger/ledger.enums'
  );
  const hash = (pin: string) => {
    const salt = randomBytes(16);
    return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${pbkdf2Sync(pin, salt, 10000, 32, 'sha256').toString('base64url')}`;
  };
  const customerId = await subject('LEVEL_1', ['BVN']);
  await db.query(`UPDATE customers SET status='ACTIVE' WHERE id=$1`, [customerId]);
  await db.query(
    `INSERT INTO customer_authentication_credentials(id,customer_id,password_hash,hash_algorithm,password_version,status) VALUES($1,$2,'fixture-hash','PBKDF2',1,'ACTIVE')`,
    [randomUUID(), customerId],
  );
  await app.get(CustomerTransactionPinService).setTransactionPin(customerId, {
    pinHash: hash('1234'),
    hashAlgorithm: 'PBKDF2',
    pinVersion: 1,
    actor: customerId,
  });
  const classes = app.get(AgentClassService);
  const cls = await classes.create({
    reference: randomUUID(),
    code: `T${randomUUID().slice(0, 8)}`,
    name: 'Test class',
    isActive: true,
    applicableServices: [AgentService.CASH_OUT],
    actor: 'fixture',
  });
  const applications = app.get(AgentApplicationService);
  const application = await applications.create({
    agentClassId: cls.id,
    applicantReference: randomUUID(),
    businessName: 'Cashout fixture',
    contactEmail: `${randomUUID()}@test.invalid`,
    actor: 'fixture',
  });
  await applications.submit(application.id, 'fixture');
  await db.query(
    `UPDATE agent_applications SET status='APPROVED',reviewed_at=NOW(),approved_at=NOW() WHERE id=$1`,
    [application.id],
  );
  const agent = await app
    .get(AgentLifecycleService)
    .activateFromApplication(application.id, 'fixture');
  await app.get(AgentAuthenticationService).setTransactionPin(agent.id, {
    pinHash: hash('1234'),
    hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
    pinVersion: 1,
    actor: agent.id,
  });
  const wallets = app.get(WalletService);
  const customerWallet = await wallets.createWallet({
    customerId,
    currency: 'NGN',
    idempotencyKey: randomUUID(),
  });
  const agentWallet = await wallets.createWallet({
    customerId: agent.id,
    currency: 'NGN',
    idempotencyKey: randomUUID(),
  });
  const deskSession = randomUUID();
  const agentCredential = randomUUID();
  await db.query(
    `INSERT INTO agent_authentication_credentials(id,agent_id,password_hash,hash_algorithm,password_version,status,password_changed_at) VALUES($1,$2,'fixture-hash','PBKDF2',1,'ACTIVE',clock_timestamp()-interval '1 minute')`,
    [agentCredential, agent.id],
  );
  await db.query(
    `INSERT INTO agent_authentication_sessions(id,agent_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at) VALUES($1,$2,$3,$4,'agent-api','ACTIVE',clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp())`,
    [deskSession, agent.id, agentCredential, randomBytes(32).toString('hex')],
  );
  const operationKey = randomUUID();
  const issueForKey = (key: string) =>
    app.get(AgentDeskOtpService).issue({
      agentId: agent.id,
      agentSessionId: deskSession,
      customerId,
      purpose: 'WALLET_TO_CASH',
      amountMinor: '1000',
      currency: 'NGN',
      operationKey: key,
    });
  sms.clear();
  const challenge = await issueForKey(operationKey);
  const code = sms.sent[0]!.message.match(/code is (\d{6})/)![1]!;
  const input = {
    agentId: agent.id,
    agentPrincipal: {
      type: 'AGENT' as const,
      agentId: agent.id,
      principalId: agent.id,
      sessionId: deskSession,
      roles: [],
      scopes: [],
      customerAccess: 'NONE' as const,
      agentAccess: 'SELF' as const,
    },
    customerId,
    customerPin: '1234',
    agentPin: '1234',
    mfaChallengeId: challenge.challengeId,
    otp: code,
    amountMinor: '1000',
    currency: 'NGN',
    idempotencyKey: operationKey,
  };
  const service = app.get(AgentCashOutService);
  const intentRows = await db.query<Array<{ cash_out_intent_id: string }>>(
    `SELECT cash_out_intent_id FROM mfa_challenges WHERE id=$1`,
    [challenge.challengeId],
  );
  const intentId = intentRows[0]!.cash_out_intent_id;
  expect(
    await db.query(
      `SELECT status,customer_id,source_wallet_id,amount_minor,currency,agent_id,agent_session_id,institution_scope,operation_key FROM cash_out_intents WHERE id=$1`,
      [intentId],
    ),
  ).toEqual([
    {
      status: 'ACTIVE',
      customer_id: customerId,
      source_wallet_id: customerWallet.id,
      amount_minor: '1000',
      currency: 'NGN',
      agent_id: agent.id,
      agent_session_id: deskSession,
      institution_scope: 'MONIENAIJA',
      operation_key: operationKey,
    },
  ]);
  const { AuthenticationSessionService } = await import(
    '../src/customer-authentication/authentication-session.service'
  );
  expect((await app.get(AuthenticationSessionService).validate({ token: intentId })).valid).toBe(
    false,
  );
  const intentTokenResponse = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'GET',
      url: `/api/v1/customers/${customerId}/profile`,
      headers: { authorization: `Bearer ${intentId}` },
    });
  expect([401, 403]).toContain(intentTokenResponse.statusCode);
  expect(await db.query(`SELECT id FROM authentication_sessions WHERE id=$1`, [intentId])).toEqual(
    [],
  );
  await expect(
    db.query(`UPDATE cash_out_intents SET amount_minor=999 WHERE id=$1`, [intentId]),
  ).rejects.toThrow('immutable');
  await expect(service.execute({ ...input, amountMinor: '999' })).rejects.toThrow(
    'intent unavailable',
  );
  await expect(service.execute({ ...input, idempotencyKey: randomUUID() })).rejects.toThrow(
    'intent unavailable',
  );
  await expect(
    service.execute({
      ...input,
      agentPrincipal: { ...input.agentPrincipal, sessionId: randomUUID() },
    }),
  ).rejects.toThrow('Agent session unavailable');
  expect(
    await db.query(`SELECT status FROM mfa_challenges WHERE id=$1`, [challenge.challengeId]),
  ).toEqual([{ status: 'ACTIVE' }]);
  await expect(service.execute({ ...input, currency: 'USD' })).rejects.toThrow();
  await expect(service.execute({ ...input, customerId: randomUUID() })).rejects.toThrow();
  const scopeSpy = jest.spyOn(app.get(CashOutInstitutionResolver), 'resolve');
  scopeSpy.mockResolvedValueOnce({
    outcome: 'RESOLVED',
    agentId: agent.id,
    institutionId: randomUUID(),
    affiliationId: randomUUID(),
    institutionStatus: 'APPROVED',
    resolvedAt: new Date().toISOString(),
    evidenceFingerprint: 'fixture',
  });
  await expect(service.execute(input)).rejects.toThrow('Institution');
  scopeSpy.mockRejectedValueOnce(new Error('Institution suspended'));
  await expect(service.execute(input)).rejects.toThrow('suspended');
  scopeSpy.mockRestore();
  // Build expired and mismatched-wallet synthetic intents directly; issuance must
  // never make either context usable, even if presented with a matching challenge.
  for (const mode of ['expired', 'wallet'] as const) {
    const forgedId = randomUUID();
    const forgedKey = randomUUID();
    await db.query(
      `INSERT INTO cash_out_intents(id,customer_id,credential_id,credential_version,source_wallet_id,source_ledger_id,agent_id,agent_session_id,institution_scope,operation_key,amount_minor,currency,purpose,status,expires_at) SELECT $2,customer_id,credential_id,credential_version,CASE WHEN $4='wallet' THEN $5::uuid ELSE source_wallet_id END, CASE WHEN $4='wallet' THEN $6::uuid ELSE source_ledger_id END,agent_id,agent_session_id,institution_scope,$3,amount_minor,currency,purpose,'ACTIVE',CASE WHEN $4='expired' THEN clock_timestamp()-interval '1 minute' ELSE expires_at END FROM cash_out_intents WHERE id=$1`,
      [intentId, forgedId, forgedKey, mode, agentWallet.id, agentWallet.ledgerAccountId],
    );
    await db.query(`UPDATE mfa_challenges SET cash_out_intent_id=$2 WHERE id=$1`, [
      challenge.challengeId,
      forgedId,
    ]);
    await expect(service.execute({ ...input, idempotencyKey: forgedKey })).rejects.toThrow(
      'intent unavailable',
    );
    await db.query(`UPDATE mfa_challenges SET cash_out_intent_id=$2 WHERE id=$1`, [
      challenge.challengeId,
      intentId,
    ]);
  }
  const snapshot = snapshots.get(customerId)!;
  snapshots.delete(customerId);
  await expect(service.execute(input)).rejects.toThrow('Trusted KYC evidence is unavailable');
  snapshots.set(customerId, snapshot);
  snapshot.evidence[0]!.status = 'REVOKED';
  await expect(service.execute(input)).rejects.toThrow();
  snapshot.evidence[0]!.status = 'VERIFIED';
  const wrong = code === '000000' ? '000001' : '000000';
  await expect(service.execute({ ...input, otp: wrong })).rejects.toThrow('OTP invalid');
  expect(
    await db.query(`SELECT status,failed_attempts FROM mfa_challenges WHERE id=$1`, [
      challenge.challengeId,
    ]),
  ).toEqual([{ status: 'ACTIVE', failed_attempts: 1 }]);
  expect(
    await db.query(`SELECT id FROM idempotency_records WHERE scope=$1 AND idempotency_key=$2`, [
      `agent-financial.v1:${agent.id}`,
      input.idempotencyKey,
    ]),
  ).toEqual([]);
  await expect(service.execute(input)).rejects.toThrow();
  expect(
    await db.query(`SELECT status FROM mfa_challenges WHERE id=$1`, [challenge.challengeId]),
  ).toEqual([{ status: 'ACTIVE' }]);
  const ledger = app.get(LedgerService);
  const source = await ledger.createAccount({
    code: `SYS-${randomUUID()}`,
    name: 'Synthetic source',
    accountType: LedgerAccountType.ASSET,
    normalBalance: LedgerNormalBalance.DEBIT,
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    allowNegativeBalance: true,
  });
  await ledger.postJournal({
    idempotencyKey: randomUUID(),
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    lines: [
      { accountId: source.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000' },
      {
        accountId: customerWallet.ledgerAccountId,
        direction: LedgerEntryDirection.CREDIT,
        amountMinor: '1000',
      },
    ],
  });
  const attempts = await Promise.allSettled([service.execute(input), service.execute(input)]);
  const completed = attempts.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  expect(completed.some((result) => result.status === 'COMPLETED')).toBe(true);
  const result = completed.find((r) => r.status === 'COMPLETED')!;
  expect(new Set(completed.map((r) => r.journalId))).toEqual(new Set([result.journalId]));
  expect(
    await db.query(`SELECT status FROM mfa_challenges WHERE id=$1`, [challenge.challengeId]),
  ).toEqual([{ status: 'VERIFIED' }]);
  expect(await db.query(`SELECT status FROM cash_out_intents WHERE id=$1`, [intentId])).toEqual([
    { status: 'COMPLETED' },
  ]);
  expect((await ledger.getAccountBalance(customerWallet.ledgerAccountId)).balanceMinor).toBe('0');
  expect((await ledger.getAccountBalance(agentWallet.ledgerAccountId)).balanceMinor).toBe('1000');
  await expect(
    app
      .get(AgentDeskOtpService)
      .issue({
        agentId: agent.id,
        agentSessionId: deskSession,
        customerId,
        purpose: 'WALLET_TO_CASH',
        amountMinor: '2000',
        currency: 'NGN',
        operationKey: randomUUID(),
        supersedesOperationKey: operationKey,
      }),
  ).rejects.toThrow('Superseded cash-out unavailable');
  expect(await db.query(`SELECT status FROM cash_out_intents WHERE id=$1`, [intentId])).toEqual([
    { status: 'COMPLETED' },
  ]);
  const replay = await service.execute(input);
  expect(replay).toMatchObject({ status: 'REPLAYED', journalId: result.journalId });
  expect(
    await db.query(
      `SELECT customer_id,challenge_id,journal_id FROM cash_out_execution_records WHERE agent_id=$1 AND idempotency_key=$2`,
      [agent.id, input.idempotencyKey],
    ),
  ).toEqual([
    { customer_id: customerId, challenge_id: challenge.challengeId, journal_id: result.journalId },
  ]);
  await db.query(`DELETE FROM idempotency_records WHERE scope=$1 AND idempotency_key=$2`, [
    `agent-financial.v1:${agent.id}`,
    input.idempotencyKey,
  ]);
  const newSession = randomUUID();
  const newSessionToken = randomBytes(32).toString('hex');
  await db.query(
    `INSERT INTO agent_authentication_sessions(id,agent_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at) VALUES($1,$2,$3,$4,'agent-api','ACTIVE',clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp())`,
    [
      newSession,
      agent.id,
      agentCredential,
      createHash('sha256').update(newSessionToken).digest('hex'),
    ],
  );
  const http = app.getHttpAdapter().getInstance();
  const route = '/api/v1/agents/cash-out/recover';
  const anonymous = await http.inject({
    method: 'POST',
    url: route,
    payload: { idempotencyKey: operationKey },
  });
  expect([401, 403]).toContain(anonymous.statusCode);
  const recoveredHttp = await http.inject({
    method: 'POST',
    url: route,
    headers: { authorization: `Bearer ${newSessionToken}` },
    payload: { idempotencyKey: operationKey },
  });
  expect(recoveredHttp.statusCode).toBe(200);
  expect(recoveredHttp.json()).toMatchObject({
    journalId: result.journalId,
    agentId: agent.id,
    customerId,
  });
  const resolver = app.get(CashOutInstitutionResolver);
  const resolverSpy = jest.spyOn(resolver, 'resolve');
  resolverSpy.mockResolvedValueOnce({
    outcome: 'RESOLVED',
    agentId: agent.id,
    institutionId: randomUUID(),
    affiliationId: randomUUID(),
    institutionStatus: 'APPROVED',
    resolvedAt: new Date().toISOString(),
    evidenceFingerprint: 'fixture',
  });
  await expect(
    service.recoverReceipt({ ...input.agentPrincipal, sessionId: newSession }, operationKey),
  ).rejects.toThrow('Institution');
  resolverSpy.mockRejectedValueOnce(new Error('Affiliation unresolved'));
  await expect(
    service.recoverReceipt({ ...input.agentPrincipal, sessionId: newSession }, operationKey),
  ).rejects.toThrow('unresolved');
  resolverSpy.mockRejectedValueOnce(new Error('Institution suspended'));
  await expect(
    service.recoverReceipt({ ...input.agentPrincipal, sessionId: newSession }, operationKey),
  ).rejects.toThrow('suspended');
  resolverSpy.mockRestore();
  const recovered = await service.recoverReceipt(
    { ...input.agentPrincipal, sessionId: newSession },
    input.idempotencyKey,
  );
  expect(recovered).toMatchObject({
    journalId: result.journalId,
    customerId,
    agentId: agent.id,
    amountMinor: '1000',
    currency: 'NGN',
  });
  await expect(
    service.recoverReceipt(
      { ...input.agentPrincipal, agentId: randomUUID() },
      input.idempotencyKey,
    ),
  ).rejects.toThrow();
  await expect(
    service.recoverReceipt(
      { ...input.agentPrincipal, sessionId: randomUUID() },
      input.idempotencyKey,
    ),
  ).rejects.toThrow();
  await expect(
    service.recoverReceipt({ ...input.agentPrincipal, sessionId: newSession }, randomUUID()),
  ).rejects.toThrow();
  expect((await ledger.getAccountBalance(agentWallet.ledgerAccountId)).balanceMinor).toBe('1000');
  // Simulate a pre-intent execution using the existing authoritative execution/journal
  // and a historical customer session, without creating an intent for that receipt.
  const legacySession = randomUUID();
  const customerToken = randomBytes(32).toString('hex');
  const credential = await db.query<Array<{ id: string }>>(
    `SELECT id FROM customer_authentication_credentials WHERE customer_id=$1`,
    [customerId],
  );
  await db.query(
    `INSERT INTO authentication_sessions(id,customer_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at,onboarding_password_version) VALUES($1,$2,$3,$4,'customer-api','ACTIVE',clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp(),1)`,
    [
      legacySession,
      customerId,
      credential[0]!.id,
      createHash('sha256').update(customerToken).digest('hex'),
    ],
  );
  expect(
    (await app.get(AuthenticationSessionService).validate({ token: customerToken })).valid,
  ).toBe(true);
  const customerRecovery = await http.inject({
    method: 'POST',
    url: route,
    headers: { authorization: `Bearer ${customerToken}` },
    payload: { idempotencyKey: operationKey },
  });
  expect([401, 403]).toContain(customerRecovery.statusCode);
  await db.query(
    `UPDATE mfa_challenges SET cash_out_intent_id=NULL,session_id=$2,status='REVOKED',revoked_at=clock_timestamp() WHERE id=$1`,
    [challenge.challengeId, legacySession],
  );
  expect(
    await service.recoverReceipt({ ...input.agentPrincipal, sessionId: newSession }, operationKey),
  ).toMatchObject({ journalId: result.journalId });
  await db.query(
    `UPDATE mfa_challenges SET cash_out_intent_id=$2,session_id=NULL,status='VERIFIED',revoked_at=NULL WHERE id=$1`,
    [challenge.challengeId, intentId],
  );
  expect((await ledger.getAccountBalance(agentWallet.ledgerAccountId)).balanceMinor).toBe('1000');
  await expect(
    service.cancelPending({ ...input.agentPrincipal, sessionId: newSession }, operationKey),
  ).rejects.toThrow('completed');
  const durableReplay = await service.execute(input);
  expect(durableReplay).toMatchObject({ status: 'REPLAYED', journalId: result.journalId });
  await expect(service.execute({ ...input, idempotencyKey: randomUUID() })).rejects.toThrow(
    'Cash-out intent unavailable or mismatched',
  );
  await expect(
    service.execute({
      ...input,
      agentPrincipal: { ...input.agentPrincipal, agentId: randomUUID() },
    }),
  ).rejects.toThrow();

  await expect(service.execute({ ...input, amountMinor: '999' })).rejects.toThrow();
  snapshot.evidence[0]!.status = 'REVOKED';
  await expect(service.execute(input)).rejects.toThrow();
  snapshot.evidence[0]!.status = 'VERIFIED';
  expect(
    await db.query(`SELECT count(*)::int AS n FROM ledger_lines WHERE journal_id=$1`, [
      result.journalId,
    ]),
  ).toEqual([{ n: 2 }]);
  expect((await ledger.getAccountBalance(agentWallet.ledgerAccountId)).balanceMinor).toBe('1000');

  await db.query(
    `UPDATE cash_out_otp_budgets SET window_started_at=clock_timestamp()-interval '16 minutes' WHERE budget_key=$1`,
    [`customer:${customerId}`],
  );
  await db.query(
    `UPDATE cash_out_otp_budgets SET window_started_at=clock_timestamp()-interval '16 minutes' WHERE budget_key LIKE 'destination:%'`,
  );
  sms.clear();
  const anotherKey = randomUUID();
  const another = await issueForKey(anotherKey);
  const anotherCode = sms.sent[0]!.message.match(/code is (\d{6})/)![1]!;
  const badCode = anotherCode === '000000' ? '000001' : '000000';
  const anotherInput = {
    ...input,
    mfaChallengeId: another.challengeId,
    idempotencyKey: anotherKey,
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    await expect(service.execute({ ...anotherInput, otp: badCode })).rejects.toThrow('OTP invalid');
  }
  expect(
    await db.query(`SELECT status,failed_attempts FROM mfa_challenges WHERE id=$1`, [
      another.challengeId,
    ]),
  ).toEqual([{ status: 'REVOKED', failed_attempts: 5 }]);
  await expect(service.execute({ ...anotherInput, otp: anotherCode })).rejects.toThrow();
  await expect(
    app.get(AgentDeskOtpService).issue({
      agentId: agent.id,
      agentSessionId: deskSession,
      customerId,
      purpose: 'WALLET_TO_CASH',
      amountMinor: '2000',
      currency: 'NGN',
      operationKey: randomUUID(),
      supersedesOperationKey: anotherKey,
    }),
  ).rejects.toThrow('temporarily unavailable');
  expect(
    await db.query(`SELECT status FROM cash_out_intents WHERE agent_id=$1 AND operation_key=$2`, [
      agent.id,
      anotherKey,
    ]),
  ).toEqual([{ status: 'ACTIVE' }]);
  await expect(issueForKey(randomUUID())).rejects.toThrow('temporarily unavailable');
  await db.query(
    `UPDATE cash_out_otp_budgets SET window_started_at=clock_timestamp()-interval '16 minutes' WHERE budget_key=$1`,
    [`customer:${customerId}`],
  );
  await db.query(
    `UPDATE cash_out_otp_budgets SET window_started_at=clock_timestamp()-interval '16 minutes' WHERE budget_key LIKE 'destination:%'`,
  );
  sms.clear();
  const expiredKey = randomUUID();
  const expired = await issueForKey(expiredKey);
  const expiredCode = sms.sent[0]!.message.match(/code is (\d{6})/)![1]!;
  await db.query(
    `UPDATE mfa_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,
    [expired.challengeId],
  );
  await expect(
    service.execute({
      ...input,
      mfaChallengeId: expired.challengeId,
      idempotencyKey: expiredKey,
      otp: expiredCode,
    }),
  ).rejects.toThrow('OTP expired');
  expect(
    await db.query(`SELECT status FROM mfa_challenges WHERE id=$1`, [expired.challengeId]),
  ).toEqual([{ status: 'EXPIRED' }]);
  expect((await ledger.getAccountBalance(agentWallet.ledgerAccountId)).balanceMinor).toBe('1000');
  sms.clear();
  const firstKey = randomUUID();
  const first = await issueForKey(firstKey);
  const firstCode = sms.sent[0]!.message.match(/code is (\d{6})/)![1]!;
  sms.clear();
  const secondKey = firstKey;
  const second = await issueForKey(secondKey);
  const secondCode = sms.sent[0]!.message.match(/code is (\d{6})/)![1]!;
  for (const [challengeId, code, count, key] of [
    [first.challengeId, firstCode, 3, firstKey],
    [second.challengeId, secondCode, 2, secondKey],
  ] as const) {
    const bad = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < count; i++) {
      await expect(
        service.execute({
          ...input,
          mfaChallengeId: challengeId,
          idempotencyKey: key,
          otp: bad,
        }),
      ).rejects.toThrow('OTP invalid');
    }
  }
  expect(
    await db.query(`SELECT failed_attempts FROM cash_out_otp_budgets WHERE budget_key=$1`, [
      `customer:${customerId}`,
    ]),
  ).toEqual([{ failed_attempts: 5 }]);
  const firstIntent = await db.query<Array<{ cash_out_intent_id: string }>>(
    `SELECT cash_out_intent_id FROM mfa_challenges WHERE id=$1`,
    [first.challengeId],
  );
  expect(
    await db.query(
      `SELECT failed_attempts,issuance_count FROM cash_out_otp_budgets WHERE budget_key=$1`,
      [`operation:${firstIntent[0]!.cash_out_intent_id}`],
    ),
  ).toEqual([{ failed_attempts: 5, issuance_count: 2 }]);
  await expect(
    service.execute({
      ...input,
      mfaChallengeId: second.challengeId,
      idempotencyKey: secondKey,
      otp: secondCode,
    }),
  ).rejects.toThrow('temporarily unavailable');
  await expect(issueForKey(randomUUID())).rejects.toThrow('temporarily unavailable');

  // A replacement carries forward all budget counters, revokes old challenges,
  // and concurrent replacements may commit at most one cancellation.
  await db.query(
    `UPDATE cash_out_otp_budgets SET window_started_at=clock_timestamp()-interval '16 minutes' WHERE budget_key=$1 OR budget_key LIKE 'destination:%'`,
    [`customer:${customerId}`],
  );
  sms.clear();
  const oldKey = randomUUID();
  const oldChallenge = await issueForKey(oldKey);
  const oldCode = sms.sent[0]!.message.match(/code is (\d{6})/)![1]!;
  const replace = (newKey: string) =>
    app.get(AgentDeskOtpService).issue({
      agentId: agent.id,
      agentSessionId: deskSession,
      customerId,
      purpose: 'WALLET_TO_CASH',
      amountMinor: '2000',
      currency: 'NGN',
      operationKey: newKey,
      supersedesOperationKey: oldKey,
    });
  await expect(
    app.get(AgentDeskOtpService).issue({
      agentId: agent.id,
      agentSessionId: randomUUID(),
      customerId,
      purpose: 'WALLET_TO_CASH',
      amountMinor: '2000',
      currency: 'NGN',
      operationKey: randomUUID(),
      supersedesOperationKey: oldKey,
    }),
  ).rejects.toThrow();
  const otherApplication = await applications.create({
    agentClassId: cls.id,
    applicantReference: randomUUID(),
    businessName: 'Other fixture',
    contactEmail: `${randomUUID()}@test.invalid`,
    actor: 'fixture',
  });
  await applications.submit(otherApplication.id, 'fixture');
  await db.query(
    `UPDATE agent_applications SET status='APPROVED',reviewed_at=NOW(),approved_at=NOW() WHERE id=$1`,
    [otherApplication.id],
  );
  const otherAgent = await app
    .get(AgentLifecycleService)
    .activateFromApplication(otherApplication.id, 'fixture');
  const otherCredential = randomUUID(),
    otherSession = randomUUID();
  await db.query(
    `INSERT INTO agent_authentication_credentials(id,agent_id,password_hash,hash_algorithm,password_version,status,password_changed_at) VALUES($1,$2,'fixture-hash','PBKDF2',1,'ACTIVE',clock_timestamp()-interval '1 minute')`,
    [otherCredential, otherAgent.id],
  );
  await db.query(
    `INSERT INTO agent_authentication_sessions(id,agent_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at) VALUES($1,$2,$3,$4,'agent-api','ACTIVE',clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp())`,
    [otherSession, otherAgent.id, otherCredential, randomBytes(32).toString('hex')],
  );
  await expect(
    app.get(AgentDeskOtpService).issue({
      agentId: otherAgent.id,
      agentSessionId: otherSession,
      customerId,
      purpose: 'WALLET_TO_CASH',
      amountMinor: '2000',
      currency: 'NGN',
      operationKey: randomUUID(),
      supersedesOperationKey: oldKey,
    }),
  ).rejects.toThrow();
  await expect(
    service.cancelPending(
      {
        ...input.agentPrincipal,
        agentId: otherAgent.id,
        principalId: otherAgent.id,
        sessionId: otherSession,
      },
      oldKey,
    ),
  ).rejects.toThrow();
  await expect(
    service.recoverReceipt(
      {
        ...input.agentPrincipal,
        agentId: otherAgent.id,
        principalId: otherAgent.id,
        sessionId: otherSession,
      },
      operationKey,
    ),
  ).rejects.toThrow();
  expect(
    await db.query(`SELECT status FROM mfa_challenges WHERE id=$1`, [oldChallenge.challengeId]),
  ).toEqual([{ status: 'ACTIVE' }]);
  const replacementKeys = [randomUUID(), randomUUID()];
  const replacements = await Promise.allSettled(replacementKeys.map(replace));
  expect(replacements.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const winner = replacements.findIndex((r) => r.status === 'fulfilled');
  const replacement = replacements[winner];
  if (!replacement || replacement.status !== 'fulfilled') throw new Error('No replacement');
  expect(
    await db.query(`SELECT status FROM cash_out_intents WHERE agent_id=$1 AND operation_key=$2`, [
      agent.id,
      oldKey,
    ]),
  ).toEqual([{ status: 'CANCELLED' }]);
  expect(
    await db.query(`SELECT status FROM mfa_challenges WHERE id=$1`, [oldChallenge.challengeId]),
  ).toEqual([{ status: 'REVOKED' }]);
  await expect(
    service.execute({
      ...input,
      mfaChallengeId: oldChallenge.challengeId,
      idempotencyKey: oldKey,
      otp: oldCode,
    }),
  ).rejects.toThrow();
  const oldIntent = await db.query<Array<{ cash_out_intent_id: string }>>(
    `SELECT cash_out_intent_id FROM mfa_challenges WHERE id=$1`,
    [oldChallenge.challengeId],
  );
  expect(
    await service.replacementStatus(input.agentPrincipal, oldKey, replacementKeys[winner]!),
  ).toMatchObject({ status: 'REPLACED', replacementStatus: 'ACTIVE' });
  await expect(
    service.replacementStatus(input.agentPrincipal, oldKey, randomUUID()),
  ).rejects.toThrow();
  await expect(
    service.replacementStatus(
      { ...input.agentPrincipal, sessionId: randomUUID() },
      oldKey,
      replacementKeys[winner]!,
    ),
  ).rejects.toThrow();
  const { CashOutReconciliationService } = await import(
    '../src/agent/cash-out-reconciliation.service'
  );
  const reconciliation = app.get(CashOutReconciliationService);
  const handoff = await reconciliation.handoff(input.agentPrincipal, {
    idempotencyKey: oldKey,
    reason: 'REPLACEMENT_UNKNOWN',
  });
  expect(
    await reconciliation.handoff(input.agentPrincipal, {
      idempotencyKey: oldKey,
      reason: 'UNKNOWN_OUTCOME',
    }),
  ).toEqual(handoff);
  expect(
    await db.query(
      `SELECT count(*)::int AS n FROM cash_out_reconciliation_handoffs WHERE agent_id=$1 AND operation_key=$2`,
      [agent.id, oldKey],
    ),
  ).toEqual([{ n: 1 }]);
  expect(await reconciliation.lookup(agent.id, oldKey)).toMatchObject({
    id: handoff.id,
    agent_id: agent.id,
    customer_id: customerId,
    current_intent_status: 'CANCELLED',
  });
  const { CashOutReconciliationController } = await import(
    '../src/agent/cash-out-reconciliation.controller'
  );
  const workforce = {
    type: 'OPERATOR' as const,
    principalId: randomUUID(),
    roles: [],
    scopes: ['reconciliation.view'],
    customerAccess: 'NONE' as const,
  };
  const controller = app.get(CashOutReconciliationController);
  expect(
    await controller.lookup({ authorizationPrincipal: workforce }, agent.id, oldKey),
  ).toMatchObject({ id: handoff.id });
  await expect(
    controller.lookup({ authorizationPrincipal: { ...workforce, scopes: [] } }, agent.id, oldKey),
  ).rejects.toThrow();
  const forbiddenHandoffRead = await http.inject({
    method: 'GET',
    url: `/api/v1/internal/reconciliation/cash-out/${agent.id}/${oldKey}`,
    headers: { authorization: `Bearer ${newSessionToken}` },
  });
  expect([401, 403]).toContain(forbiddenHandoffRead.statusCode);
  await expect(
    reconciliation.handoff(
      { ...input.agentPrincipal, sessionId: randomUUID() },
      { idempotencyKey: oldKey, reason: 'UNKNOWN_OUTCOME' },
    ),
  ).rejects.toThrow();
  const newIntent = await db.query<Array<{ cash_out_intent_id: string }>>(
    `SELECT cash_out_intent_id FROM mfa_challenges WHERE id=$1`,
    [replacement.value.challengeId],
  );
  expect(
    await db.query(`SELECT issuance_count FROM cash_out_otp_budgets WHERE budget_key=$1`, [
      `operation:${newIntent[0]!.cash_out_intent_id}`,
    ]),
  ).toEqual([{ issuance_count: 2 }]);
  expect(
    await db.query(`SELECT action FROM audit_events WHERE entity_id=$1 AND action='SUPERSEDED'`, [
      oldIntent[0]!.cash_out_intent_id,
    ]),
  ).toEqual([{ action: 'SUPERSEDED' }]);
  await expect(
    service.cancelPending(
      { ...input.agentPrincipal, sessionId: randomUUID() },
      replacementKeys[winner]!,
    ),
  ).rejects.toThrow();
  expect(await service.cancelPending(input.agentPrincipal, replacementKeys[winner]!)).toEqual({
    status: 'CANCELLED',
  });
  expect(await service.cancelPending(input.agentPrincipal, replacementKeys[winner]!)).toEqual({
    status: 'CANCELLED',
  });
  expect(
    await db.query(`SELECT status FROM mfa_challenges WHERE id=$1`, [
      replacement.value.challengeId,
    ]),
  ).toEqual([{ status: 'REVOKED' }]);
  expect((await ledger.getAccountBalance(agentWallet.ledgerAccountId)).balanceMinor).toBe('1000');

  await db.query(
    `UPDATE cash_out_otp_budgets SET window_started_at=clock_timestamp()-interval '16 minutes' WHERE budget_key=$1 OR budget_key LIKE 'destination:%'`,
    [`customer:${customerId}`],
  );
  await ledger.postJournal({
    idempotencyKey: randomUUID(),
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    lines: [
      { accountId: source.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000' },
      {
        accountId: customerWallet.ledgerAccountId,
        direction: LedgerEntryDirection.CREDIT,
        amountMinor: '1000',
      },
    ],
  });
  sms.clear();
  const raceKey = randomUUID();
  const raceChallenge = await issueForKey(raceKey);
  const raceCode = sms.sent[0]!.message.match(/code is (\d{6})/)![1]!;
  const race = await Promise.allSettled([
    service.execute({
      ...input,
      idempotencyKey: raceKey,
      mfaChallengeId: raceChallenge.challengeId,
      otp: raceCode,
    }),
    service.cancelPending(input.agentPrincipal, raceKey),
  ]);
  expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const [intentState] = await db.query<Array<{ status: string }>>(
    `SELECT status FROM cash_out_intents WHERE agent_id=$1 AND operation_key=$2`,
    [agent.id, raceKey],
  );
  const records = await db.query<Array<{ journal_id: string }>>(
    `SELECT journal_id FROM cash_out_execution_records WHERE agent_id=$1 AND idempotency_key=$2`,
    [agent.id, raceKey],
  );
  if (intentState!.status === 'COMPLETED') {
    expect(race[0].status).toBe('fulfilled');
    expect(records).toHaveLength(1);
    expect((await ledger.getAccountBalance(agentWallet.ledgerAccountId)).balanceMinor).toBe('2000');
  } else {
    expect(intentState!.status).toBe('CANCELLED');
    expect(race[1].status).toBe('fulfilled');
    expect(records).toHaveLength(0);
    expect((await ledger.getAccountBalance(agentWallet.ledgerAccountId)).balanceMinor).toBe('1000');
  }
  // A material replacement and the old execution contend on the same intent row.
  await db.query(
    `UPDATE cash_out_otp_budgets SET window_started_at=clock_timestamp()-interval '16 minutes' WHERE budget_key=$1 OR budget_key LIKE 'destination:%'`,
    [`customer:${customerId}`],
  );
  await ledger.postJournal({
    idempotencyKey: randomUUID(),
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    lines: [
      { accountId: source.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000' },
      {
        accountId: customerWallet.ledgerAccountId,
        direction: LedgerEntryDirection.CREDIT,
        amountMinor: '1000',
      },
    ],
  });
  sms.clear();
  const replaceRaceKey = randomUUID();
  const replaceRaceChallenge = await issueForKey(replaceRaceKey);
  const replaceRaceCode = sms.sent[0]!.message.match(/code is (\d{6})/)![1]!;
  const replacementRace = await Promise.allSettled([
    service.execute({
      ...input,
      idempotencyKey: replaceRaceKey,
      mfaChallengeId: replaceRaceChallenge.challengeId,
      otp: replaceRaceCode,
    }),
    app.get(AgentDeskOtpService).issue({
      agentId: agent.id,
      agentSessionId: deskSession,
      customerId,
      purpose: 'WALLET_TO_CASH',
      amountMinor: '2000',
      currency: 'NGN',
      operationKey: randomUUID(),
      supersedesOperationKey: replaceRaceKey,
    }),
  ]);
  expect(replacementRace.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const [replaceRaceIntent] = await db.query<Array<{ status: string }>>(
    `SELECT status FROM cash_out_intents WHERE agent_id=$1 AND operation_key=$2`,
    [agent.id, replaceRaceKey],
  );
  const replaceRaceRecords = await db.query<Array<{ journal_id: string }>>(
    `SELECT journal_id FROM cash_out_execution_records WHERE agent_id=$1 AND idempotency_key=$2`,
    [agent.id, replaceRaceKey],
  );
  if (replaceRaceIntent!.status === 'COMPLETED') {
    expect(replacementRace[0].status).toBe('fulfilled');
    expect(replaceRaceRecords).toHaveLength(1);
  } else {
    expect(replaceRaceIntent!.status).toBe('CANCELLED');
    expect(replacementRace[1].status).toBe('fulfilled');
    expect(replaceRaceRecords).toHaveLength(0);
  }
  // Exercise the actual mobile API client and pending-operation logic against the
  // real Fastify application. Only transport is bridged in-process; no API mock.
  const mobile = await import('../apps/agent-mobile/src/services/agent-api');
  const mobileClient = await import('../apps/agent-mobile/src/services/api-client');
  const mobileStorage = await import('../apps/agent-mobile/src/services/secure-storage');
  const mobilePending = await import('../apps/agent-mobile/src/services/pending-operation');
  await db.query(`UPDATE agent_authentication_credentials SET password_hash=$2 WHERE id=$1`, [
    agentCredential,
    hash('1234'),
  ]);
  await db.query(
    `UPDATE cash_out_otp_budgets SET window_started_at=clock_timestamp()-interval '16 minutes' WHERE budget_key=$1 OR budget_key LIKE 'destination:%'`,
    [`customer:${customerId}`],
  );
  await ledger.postJournal({
    idempotencyKey: randomUUID(),
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    lines: [
      { accountId: source.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000' },
      {
        accountId: customerWallet.ledgerAccountId,
        direction: LedgerEntryDirection.CREDIT,
        amountMinor: '1000',
      },
    ],
  });
  const oldFetch = global.fetch;
  let dropExecutionResponse = false;
  global.fetch = async (url, init) => {
    const path = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url)
      .pathname;
    const headers = Object.fromEntries(
      Object.entries(init?.headers ?? {}).map(([key, value]) => [key, String(value)]),
    );
    const response = await http.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'POST',
      url: path,
      headers,
      payload: typeof init?.body === 'string' ? init.body : undefined,
    });
    if (path === '/api/v1/agents/cash-out' && dropExecutionResponse) {
      dropExecutionResponse = false;
      expect(response.statusCode).toBe(201);
      throw new Error('Synthetic lost response');
    }
    return new Response(response.body, {
      status: response.statusCode,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    mobileClient.setBaseUrl('http://mobile-contract.invalid');
    const login = await mobile.agentLogin(agent.id, '1234');
    if (!('accessToken' in login)) throw new Error('Agent session not issued');
    await mobileStorage.SecureStorage.set(mobileClient.AGENT_SESSION_KEYS.token, login.accessToken);
    const mobileKey = randomUUID();
    sms.clear();
    const mobileChallenge = await mobile.requestAgentMfaChallenge(
      customerId,
      'WALLET_TO_CASH',
      undefined,
      { amountMinor: '1000', currency: 'NGN', operationKey: mobileKey },
    );
    const mobileCode = sms.sent[0]!.message.match(/code is (\d{6})/)![1]!;
    await mobilePending.savePendingAgentOperation({
      agentId: agent.id,
      operationType: 'CASH_OUT',
      idempotencyKey: mobileKey,
      counterpartyId: customerId,
      amountMinor: '1000',
      currency: 'NGN',
      createdAt: new Date().toISOString(),
    });
    dropExecutionResponse = true;
    await expect(
      mobile.agentCashOut({
        customerId,
        customerPin: '1234',
        agentPin: '1234',
        mfaChallengeId: mobileChallenge.challengeId,
        otp: mobileCode,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: mobileKey,
      }),
    ).rejects.toMatchObject({ name: 'NetworkError' });
    const pendingAfterRestart = await mobilePending.loadPendingAgentOperation(agent.id, 'CASH_OUT');
    expect(pendingAfterRestart?.idempotencyKey).toBe(mobileKey);
    await mobile.agentLogout();
    await mobileClient.purgeAgentSessionFromStorage();
    const loginAgain = await mobile.agentLogin(agent.id, '1234');
    if (!('accessToken' in loginAgain)) throw new Error('Agent session not issued');
    expect(loginAgain.sessionId).not.toBe(login.sessionId);
    await mobileStorage.SecureStorage.set(
      mobileClient.AGENT_SESSION_KEYS.token,
      loginAgain.accessToken,
    );
    expect(
      await db.query(`SELECT status FROM agent_authentication_sessions WHERE id=$1`, [
        login.sessionId,
      ]),
    ).toEqual([{ status: 'REVOKED' }]);
    const handoffMobile = await mobile.handoffCashOutReconciliation(mobileKey, 'UNKNOWN_OUTCOME');
    expect(await mobile.handoffCashOutReconciliation(mobileKey, 'UNKNOWN_OUTCOME')).toEqual(
      handoffMobile,
    );
    const receipt = await mobile.recoverAgentCashOut(pendingAfterRestart!.idempotencyKey);
    expect(receipt).toMatchObject({
      customerId,
      agentId: agent.id,
      amountMinor: '1000',
      idempotencyKey: mobileKey,
    });
    expect(
      await db.query(
        `SELECT count(*)::int AS n FROM cash_out_execution_records WHERE agent_id=$1 AND idempotency_key=$2`,
        [agent.id, mobileKey],
      ),
    ).toEqual([{ n: 1 }]);
    expect(
      await db.query(`SELECT count(*)::int AS n FROM ledger_lines WHERE journal_id=$1`, [
        receipt.journalId,
      ]),
    ).toEqual([{ n: 2 }]);
    await mobilePending.clearPendingAgentOperation(agent.id, 'CASH_OUT');
    expect(await mobilePending.loadPendingAgentOperation(agent.id, 'CASH_OUT')).toBeNull();
    sms.clear();
    const nextKey = randomUUID();
    await mobile.requestAgentMfaChallenge(customerId, 'WALLET_TO_CASH', undefined, {
      amountMinor: '1000',
      currency: 'NGN',
      operationKey: nextKey,
    });
    expect(await mobile.cancelPendingAgentCashOut(nextKey)).toEqual({ status: 'CANCELLED' });
  } finally {
    global.fetch = oldFetch;
  }
}, 30000);

test('concurrent cash-out challenge issuance cannot reset the persisted issuance budget', async () => {
  const { AgentDeskOtpService } = await import('../src/agent/agent-desk-otp.service');
  const customerId = await subject('LEVEL_1', ['BVN']);
  await db.query(`UPDATE customers SET status='ACTIVE' WHERE id=$1`, [customerId]);
  await db.query(
    `INSERT INTO customer_authentication_credentials(id,customer_id,password_hash,hash_algorithm,password_version,status) VALUES($1,$2,'fixture-hash','PBKDF2',1,'ACTIVE')`,
    [randomUUID(), customerId],
  );
  const agentId = randomUUID();
  await db.query(`INSERT INTO agents(id,reference,status) VALUES($1,$2,'ACTIVE')`, [
    agentId,
    agentId,
  ]);
  const { AgentClassService } = await import('../src/agent/agent-class.service');
  const { AgentService } = await import('../src/agent/agent-service.enum');
  const cls = await app.get(AgentClassService).create({
    reference: randomUUID(),
    code: `C${randomUUID().slice(0, 8)}`,
    name: 'Concurrency fixture',
    isActive: true,
    applicableServices: [AgentService.CASH_OUT],
    actor: 'fixture',
  });
  await db.query(`UPDATE agents SET agent_class_id=$1 WHERE id=$2`, [cls.id, agentId]);
  const deskSession = randomUUID(),
    credential = randomUUID();
  await db.query(
    `INSERT INTO agent_authentication_credentials(id,agent_id,password_hash,hash_algorithm,password_version,status,password_changed_at) VALUES($1,$2,'fixture-hash','PBKDF2',1,'ACTIVE',clock_timestamp()-interval '1 minute')`,
    [credential, agentId],
  );
  await db.query(
    `INSERT INTO agent_authentication_sessions(id,agent_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at) VALUES($1,$2,$3,$4,'agent-api','ACTIVE',clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp())`,
    [deskSession, agentId, credential, randomUUID().replace(/-/g, '').repeat(2)],
  );
  await app
    .get(WalletService)
    .createWallet({ customerId, currency: 'NGN', idempotencyKey: randomUUID() });
  const service = app.get(AgentDeskOtpService);
  const command = {
    agentId,
    agentSessionId: deskSession,
    customerId,
    purpose: 'WALLET_TO_CASH' as const,
    amountMinor: '1000',
    currency: 'NGN',
    operationKey: randomUUID(),
  };
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => service.issue(command)));
  expect(results.filter((result) => result.status === 'fulfilled').length).toBeLessThanOrEqual(3);
  expect(
    await db.query(
      `SELECT issuance_count,failed_attempts FROM cash_out_otp_budgets WHERE budget_key=$1`,
      [`customer:${customerId}`],
    ),
  ).toEqual([{ issuance_count: 3, failed_attempts: 0 }]);
  await expect(service.issue(command)).rejects.toThrow('temporarily unavailable');
});

test('contained claim wiring rolls back OTP with a failed posting and serializes funded claims', async () => {
  const { AgentCashToCashClaimService } = await import(
    '../src/agent/agent-cash-to-cash-claim.service'
  );
  const { AgentDeskOtpService } = await import('../src/agent/agent-desk-otp.service');
  const { LedgerService } = await import('../src/ledger/ledger.service');
  const { LedgerAccountType, LedgerEntryDirection } = await import('../src/ledger/ledger.enums');
  const { randomBytes, pbkdf2Sync } = await import('node:crypto');
  const customerId = await subject('LEVEL_1', ['BVN']);
  await db.query(`UPDATE customers SET status='ACTIVE' WHERE id=$1`, [customerId]);
  const phone = `8${randomUUID().replace(/\D/g, '').padEnd(9, '1').slice(0, 9)}`;
  await db.query(
    `UPDATE customer_contact_methods SET value=$2,normalized_value=$2 WHERE customer_id=$1`,
    [customerId, phone],
  );
  await db.query(
    `INSERT INTO customer_authentication_credentials(id,customer_id,password_hash,hash_algorithm,password_version,status) VALUES($1,$2,'fixture-hash','PBKDF2',1,'ACTIVE')`,
    [randomUUID(), customerId],
  );
  await app
    .get(WalletService)
    .createWallet({ customerId, currency: 'NGN', idempotencyKey: randomUUID() });
  const agentId = randomUUID();
  await db.query(`INSERT INTO agents(id,reference,status) VALUES($1,$2,'ACTIVE')`, [
    agentId,
    agentId,
  ]);
  const ledger = app.get(LedgerService);
  const source = await ledger.createAccount({
    code: `claim-source-${randomUUID()}`,
    name: 'fixture source',
    currency: 'NGN',
    accountType: LedgerAccountType.ASSET,
    allowNegativeBalance: true,
  });
  let unclaimed = await db.query<Array<{ id: string }>>(
    `SELECT id FROM ledger_accounts WHERE code='CASH_TO_CASH-UNCLAIMED-NGN'`,
  );
  if (!unclaimed.length) {
    const account = await ledger.createAccount({
      code: 'CASH_TO_CASH-UNCLAIMED-NGN',
      name: 'fixture unclaimed',
      currency: 'NGN',
      accountType: LedgerAccountType.LIABILITY,
      allowNegativeBalance: false,
    });
    unclaimed = [{ id: account.id }];
  }
  const funding = await ledger.postJournal({
    idempotencyKey: randomUUID(),
    currency: 'NGN',
    lines: [
      { accountId: source.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '100' },
      { accountId: unclaimed[0]!.id, direction: LedgerEntryDirection.CREDIT, amountMinor: '100' },
    ],
  });
  const transferId = randomUUID();
  const transferCode = '12345678';
  const salt = randomBytes(16);
  const codeHash = `PBKDF2$sha256$10000$${salt.toString('base64url')}$${pbkdf2Sync(transferCode, salt, 10000, 32, 'sha256').toString('base64url')}`;
  await db.query(
    `INSERT INTO cash_to_cash_transfers(id,agent_id,beneficiary_phone,principal_minor,total_minor,currency,status,transfer_code_hash,hash_algorithm,journal_id,idempotency_key,expires_at) VALUES($1,$2,$3,100,100,'NGN','UNCLAIMED',$4,'PBKDF2',$5,$6,clock_timestamp()+interval '1 hour')`,
    [transferId, agentId, phone, codeHash, funding.id, randomUUID()],
  );
  sms.clear();
  const challenge = await app
    .get(AgentDeskOtpService)
    .issue({ agentId, customerId, purpose: 'CASH_TO_CASH_CLAIM' });
  const otp = sms.sent[0]!.message.match(/code is (\d{6})/)![1]!;
  const claim = app.get(AgentCashToCashClaimService);
  // The bypass is confined to this fixture. Production remains disabled until bound challenges exist.
  const bypass = jest
    .spyOn(claim as never, 'requireSafeClaimExecution' as never)
    .mockImplementation(() => undefined as never);
  const postJournal = ledger.postJournalInTransaction.bind(ledger);
  const ledgerSpy = jest.spyOn(ledger, 'postJournalInTransaction');
  const input = {
    transferId,
    beneficiaryPhone: phone,
    transferCode,
    customerId,
    mfaChallengeId: challenge.challengeId,
    otp,
    idempotencyKey: randomUUID(),
    redemptionMethod: 'CUSTOMER_WALLET' as const,
  };
  try {
    const wrong = otp === '000000' ? '000001' : '000000';
    await expect(claim.execute({ ...input, otp: wrong })).rejects.toThrow('MISMATCH');
    expect(
      await db.query(`SELECT status,failed_attempts FROM mfa_challenges WHERE id=$1`, [
        challenge.challengeId,
      ]),
    ).toEqual([{ status: 'ACTIVE', failed_attempts: 1 }]);
    ledgerSpy.mockImplementationOnce(async (manager, command) => {
      await postJournal(manager, command);
      throw new Error('injected settlement failure after journal');
    });
    await expect(claim.execute(input)).rejects.toThrow('injected settlement failure after journal');
    expect(
      await db.query(`SELECT count(*)::int AS n FROM ledger_journals WHERE idempotency_key=$1`, [
        `claim:${transferId}:${input.idempotencyKey}`,
      ]),
    ).toEqual([{ n: 0 }]);
    expect(
      await db.query(`SELECT status FROM mfa_challenges WHERE id=$1`, [challenge.challengeId]),
    ).toEqual([{ status: 'ACTIVE' }]);
    expect(
      await db.query(`SELECT status,claim_journal_id FROM cash_to_cash_transfers WHERE id=$1`, [
        transferId,
      ]),
    ).toEqual([{ status: 'UNCLAIMED', claim_journal_id: null }]);
    const results = await Promise.allSettled([claim.execute(input), claim.execute(input)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await db.query(`SELECT status FROM mfa_challenges WHERE id=$1`, [challenge.challengeId]),
    ).toEqual([{ status: 'VERIFIED' }]);
    const rows = await db.query<Array<{ status: string; claim_journal_id: string }>>(
      `SELECT status,claim_journal_id FROM cash_to_cash_transfers WHERE id=$1`,
      [transferId],
    );
    expect(rows[0]?.status).toBe('CLAIMED');
    expect(
      await db.query(`SELECT count(*)::int AS n FROM ledger_lines WHERE journal_id=$1`, [
        rows[0]!.claim_journal_id,
      ]),
    ).toEqual([{ n: 2 }]);
  } finally {
    ledgerSpy.mockRestore();
    bypass.mockRestore();
  }
}, 120_000);
