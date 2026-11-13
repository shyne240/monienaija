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
  const { pbkdf2Sync, randomBytes } = await import('node:crypto');
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
});

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
