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
import { DataSource, type EntityManager } from 'typeorm';
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
  await expect(check()).rejects.toMatchObject({ status: 503 });
  snapshots.set(id, snapshot);
  snapshot.evidence[0]!.provenance = 'SYNTHETIC';
  await expect(check()).rejects.toThrow();
  snapshot.evidence[0]!.provenance = 'VERIFIED_PROVIDER';
  snapshot.evidence[0]!.status = 'REVIEW';
  await expect(check()).rejects.toMatchObject({ status: 409 });
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
    const saved = snapshots.get(id)!;
    snapshots.delete(id);
    try {
      await expect(sessionService.validate({ token: session.accessToken })).rejects.toMatchObject({
        status: 503,
      });
    } finally {
      snapshots.set(id, saved);
    }
    expect((await sessionService.validate({ token: session.accessToken })).valid).toBe(true);
    const outageToken = randomBytes(32).toString('base64url');
    const outageRegistration = randomUUID();
    await db.query(
      `INSERT INTO kyc_registration_sessions(id,phone,authorization_hash,status,verified_at,expires_at) VALUES($1,$2,$3,'VERIFIED',clock_timestamp(),clock_timestamp()+interval '10 minutes')`,
      [outageRegistration, phone, createHash('sha256').update(outageToken).digest('hex')],
    );
    const reader = app.get(KycTierEvidenceReader);
    const failQuery = jest
      .spyOn(reader, 'read')
      .mockImplementationOnce(async (m: EntityManager) => {
        await m.query('SELECT * FROM deliberately_missing_evidence_table');
        return null;
      });
    try {
      const outageSession = await app
        .get(MobileOnboardingAuthService)
        .login(outageRegistration, outageToken, '112233');
      expect(outageSession.audience).toBe('customer-onboarding');
      expect((await sessionService.validate({ token: outageSession.accessToken })).valid).toBe(
        false,
      );
    } finally {
      failQuery.mockRestore();
    }
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
    snapshots.get(id)!.evidence.forEach((e) => {
      e.provenance = 'VERIFIED_PROVIDER';
    });
    const thirdToken = randomBytes(32).toString('base64url');
    const thirdRegistration = randomUUID();
    await db.query(
      `INSERT INTO kyc_registration_sessions(id,phone,authorization_hash,status,verified_at,expires_at) VALUES($1,$2,$3,'VERIFIED',clock_timestamp(),clock_timestamp()+interval '10 minutes')`,
      [thirdRegistration, phone, createHash('sha256').update(thirdToken).digest('hex')],
    );
    const head = await db.query<Array<{ version: number }>>(
      'WITH deleted AS (DELETE FROM kyc_tier_policy_head WHERE singleton=true RETURNING version) SELECT version FROM deleted',
    );
    try {
      const noPolicy = await app
        .get(MobileOnboardingAuthService)
        .login(thirdRegistration, thirdToken, '112233');
      expect(noPolicy.audience).toBe('customer-onboarding');
      expect((await sessionService.validate({ token: noPolicy.accessToken })).valid).toBe(false);
    } finally {
      await db.query('INSERT INTO kyc_tier_policy_head(singleton,version) VALUES(true,$1)', [
        head[0]!.version,
      ]);
    }
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
  const legacyAgent = randomUUID();
  await db.query(`INSERT INTO agents(id,reference,status) VALUES($1,$2,'ACTIVE')`, [
    legacyAgent,
    `agent-${legacyAgent}`,
  ]);
  const legacyLedger = await ledger.createAccount({
    code: `legacy-${randomUUID()}`,
    name: 'legacy agent wallet',
    currency: 'NGN',
    accountType: LedgerAccountType.LIABILITY,
  });
  await db.query(
    `INSERT INTO wallet_accounts(id,customer_id,currency,status,ledger_account_id) VALUES($1,$2,'NGN','ACTIVE',$3)`,
    [randomUUID(), legacyAgent.toUpperCase(), legacyLedger.id],
  );
  await expect(
    app.get(WalletService).createWallet({
      customerId: legacyAgent,
      currency: 'NGN',
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toThrow('A wallet already exists');
  const raceAgent = randomUUID();
  await db.query(`INSERT INTO agents(id,reference,status) VALUES($1,$2,'ACTIVE')`, [
    raceAgent,
    `agent-${raceAgent}`,
  ]);
  const provisioningRace = await Promise.allSettled(
    [raceAgent, raceAgent.toUpperCase()].map((customerId) =>
      app
        .get(WalletService)
        .createWallet({ customerId, currency: 'NGN', idempotencyKey: randomUUID() }),
    ),
  );
  expect(provisioningRace.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(provisioningRace.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect(
    await db.query(
      `SELECT count(*)::int AS count FROM wallet_accounts WHERE lower(customer_id)=$1`,
      [raceAgent],
    ),
  ).toEqual([{ count: 1 }]);
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
  await expect(
    app.get(WalletService).createWallet({
      customerId: customer.toUpperCase(),
      currency: 'NGN',
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toThrow('A wallet already exists');
  await db.query(`UPDATE agents SET status='SUSPENDED' WHERE id=$1`, [agent]);
  await expect(tryPosting(agentWallet.ledgerAccountId)).rejects.toThrow(
    'Agent wallet owner is not active',
  );
  await db.query(`UPDATE agents SET status='ACTIVE', deleted_at=now() WHERE id=$1`, [agent]);
  await expect(tryPosting(agentWallet.ledgerAccountId)).rejects.toThrow(
    'Agent wallet owner is not active',
  );
  await db.query(`UPDATE agents SET deleted_at=NULL WHERE id=$1`, [agent]);
  const inactiveAgent = randomUUID();
  await db.query(`INSERT INTO agents(id,reference,status) VALUES($1,$2,'PENDING')`, [
    inactiveAgent,
    `agent-${inactiveAgent}`,
  ]);
  await expect(
    app.get(WalletService).createWallet({
      customerId: inactiveAgent,
      currency: 'NGN',
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toThrow('Agent wallet owner is not active');
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
  const validCommand = {
    ...operationCommand,
    resourceId: withdrawal,
    walletAccountId: wallet.id,
    ledgerAccountId: wallet.ledgerAccountId,
  };
  await expect(
    app.get(ExternalOperationService).create({ ...validCommand, amountMinor: '2' }),
  ).rejects.toThrow('Withdrawal obligation does not match external operation');
  await expect(
    app.get(ExternalOperationService).create({ ...validCommand, resourceId: randomUUID() }),
  ).rejects.toThrow('Withdrawal obligation does not match external operation');
  const raceWithdrawal = randomUUID();
  await db.query(
    `INSERT INTO withdrawals(id,wallet_id,payment_reference,amount_minor,currency,status,idempotency_key,request_hash) VALUES($1,$2,$3,1,'NGN','PENDING',$4,$5)`,
    [raceWithdrawal, wallet.id, `R${randomUUID().replace(/-/g, '')}`, randomUUID(), 'b'.repeat(64)],
  );
  const race = await Promise.allSettled(
    [0, 1].map(() =>
      app.get(ExternalOperationService).create({
        ...validCommand,
        resourceId: raceWithdrawal,
        internalCommandId: randomUUID(),
        idempotencyKey: randomUUID(),
      }),
    ),
  );
  expect(race.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(race.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect(
    await db.query(`SELECT count(*)::int AS count FROM external_operations WHERE resource_id=$1`, [
      raceWithdrawal,
    ]),
  ).toEqual([{ count: 1 }]);
  const operation = await app.get(ExternalOperationService).create(validCommand);
  const { A7ProductFinancialEffectRepository } = await import(
    '../src/policy/a7-product-financial-effect.repository'
  );
  const resolved = await app
    .get(A7ProductFinancialEffectRepository)
    .getConsumerPorts()
    .a6ExternalOperationLookup(operation.externalOperationReference);
  expect(resolved).toMatchObject({
    externalOperationId: operation.externalOperationId,
    version: operation.version,
  });
  expect(
    await app
      .get(A7ProductFinancialEffectRepository)
      .getConsumerPorts()
      .a6ExternalOperationLookup(`external-operation:v1:${'0'.repeat(64)}`),
  ).toBeNull();
  await expect(
    app.get(ExternalOperationService).create({
      ...validCommand,
      idempotencyKey: randomUUID(),
      internalCommandId: randomUUID(),
    }),
  ).rejects.toThrow('Withdrawal already has an external operation');
  const { ExternalOperationLifecycleService } = await import(
    '../src/partner/external-operation-lifecycle.service'
  );
  await db.query(`UPDATE withdrawals SET amount_minor=2 WHERE id=$1`, [withdrawal]);
  await expect(
    app
      .get(ExternalOperationLifecycleService)
      .beginAttempt(operation.externalOperationId, randomUUID(), operationCommand.requestContext),
  ).rejects.toThrow('Withdrawal obligation does not match external operation');
  await db.query(`UPDATE withdrawals SET amount_minor=1, status='CANCELLED' WHERE id=$1`, [
    withdrawal,
  ]);
  await expect(
    app
      .get(ExternalOperationLifecycleService)
      .beginAttempt(operation.externalOperationId, randomUUID(), operationCommand.requestContext),
  ).rejects.toThrow('Withdrawal obligation does not match external operation');
  await db.query(`UPDATE withdrawals SET status='PENDING' WHERE id=$1`, [withdrawal]);
  snapshots.get(customer)!.evidence[0]!.status = 'REVOKED';
  await expect(app.get(ExternalOperationService).create(validCommand)).resolves.toMatchObject({
    externalOperationId: operation.externalOperationId,
    replayed: true,
  });
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

test('committed replay and exact reversal survive suspension; altered reversal and new spending fail', async () => {
  const { LedgerService } = await import('../src/ledger/ledger.service');
  const { LedgerAccountType, LedgerEntryDirection } = await import('../src/ledger/ledger.enums');
  const customer = await subject('LEVEL_1', ['BVN']);
  await db.query(`UPDATE customers SET status='ACTIVE' WHERE id=$1`, [customer]);
  const wallet = await app
    .get(WalletService)
    .createWallet({ customerId: customer, currency: 'NGN', idempotencyKey: randomUUID() });
  const ledger = app.get(LedgerService);
  const control = await ledger.createAccount({
    code: `reversal-control-${randomUUID()}`,
    name: 'Test funding',
    currency: 'NGN',
    accountType: LedgerAccountType.ASSET,
    allowNegativeBalance: true,
  });
  const original = {
    idempotencyKey: randomUUID(),
    currency: 'NGN',
    lines: [
      { accountId: control.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '100' },
      {
        accountId: wallet.ledgerAccountId,
        direction: LedgerEntryDirection.CREDIT,
        amountMinor: '100',
      },
    ],
  };
  const journal = await ledger.postJournal(original);
  expect((await ledger.getAccountBalance(wallet.ledgerAccountId)).balanceMinor).toBe('100');
  const payment = await ledger.postJournal({
    idempotencyKey: randomUUID(),
    currency: 'NGN',
    lines: [
      {
        accountId: wallet.ledgerAccountId,
        direction: LedgerEntryDirection.DEBIT,
        amountMinor: '40',
      },
      { accountId: control.id, direction: LedgerEntryDirection.CREDIT, amountMinor: '40' },
    ],
  });
  expect((await ledger.getAccountBalance(wallet.ledgerAccountId)).balanceMinor).toBe('60');
  await db.query(`UPDATE customers SET status='SUSPENDED' WHERE id=$1`, [customer]);
  expect((await ledger.postJournal(original)).id).toBe(journal.id);
  await expect(ledger.postJournal({ ...original, idempotencyKey: randomUUID() })).rejects.toThrow();
  await expect(
    ledger.postJournal({
      idempotencyKey: randomUUID(),
      currency: 'NGN',
      reversalOfJournalId: journal.id,
      lines: [
        {
          accountId: wallet.ledgerAccountId,
          direction: LedgerEntryDirection.DEBIT,
          amountMinor: '50',
        },
        { accountId: control.id, direction: LedgerEntryDirection.CREDIT, amountMinor: '50' },
      ],
    }),
  ).rejects.toThrow('Reversal must exactly invert the original journal');
  await expect(
    db.transaction((manager) =>
      ledger.postReversalInTransaction(manager, {
        idempotencyKey: randomUUID(),
        currency: 'NGN',
        reversalOfJournalId: journal.id,
        lines: [
          {
            accountId: wallet.ledgerAccountId,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: '50',
          },
          { accountId: control.id, direction: LedgerEntryDirection.CREDIT, amountMinor: '50' },
        ],
      }),
    ),
  ).rejects.toThrow('Reversal must exactly invert the original journal');
  // Supplying an exact reversal payload to ordinary posting does not itself grant
  // the recovery authority used by governed reversals and settlement compensation.
  await expect(
    ledger.postJournal({
      idempotencyKey: randomUUID(),
      currency: 'NGN',
      reversalOfJournalId: journal.id,
      lines: [
        {
          accountId: wallet.ledgerAccountId,
          direction: LedgerEntryDirection.DEBIT,
          amountMinor: '100',
        },
        { accountId: control.id, direction: LedgerEntryDirection.CREDIT, amountMinor: '100' },
      ],
    }),
  ).rejects.toThrow('Customer is not eligible for financial access');
  await db.query(
    `INSERT INTO kyc_tier_manual_holds(customer_id,actor,reason) VALUES($1,'test','MANUAL_REVIEW')`,
    [customer],
  );
  await expect(
    ledger.reverseJournal(payment.id, randomUUID(), 'Controlled correction'),
  ).rejects.toThrow('restricted pending compliance review');
  expect((await ledger.getAccountBalance(wallet.ledgerAccountId)).balanceMinor).toBe('60');
  await db.query(`DELETE FROM kyc_tier_manual_holds WHERE customer_id=$1`, [customer]);
  const refund = await ledger.reverseJournal(payment.id, randomUUID(), 'Controlled refund');
  expect(refund.reversalOfJournalId).toBe(payment.id);
  expect((await ledger.getAccountBalance(wallet.ledgerAccountId)).balanceMinor).toBe('100');
  const key = randomUUID();
  const reversed = await ledger.reverseJournal(journal.id, key, 'Controlled test correction');
  expect(reversed.reversalOfJournalId).toBe(journal.id);
  expect((await ledger.reverseJournal(journal.id, key, 'Controlled test correction')).id).toBe(
    reversed.id,
  );
  expect((await ledger.getAccountBalance(wallet.ledgerAccountId)).balanceMinor).toBe('0');
  await expect(ledger.reverseJournal(journal.id, randomUUID(), 'duplicate')).rejects.toThrow();
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

test('temporary KYC reader unavailability does not permanently fail a withdrawal and the same operation can retry', async () => {
  const { LedgerService } = await import('../src/ledger/ledger.service');
  const { WithdrawalService } = await import('../src/withdrawal/withdrawal.service');
  const { LedgerEntryDirection } = await import('../src/ledger/ledger.enums');
  const customer = await subject('LEVEL_1', ['BVN']);
  await db.query(`UPDATE customers SET status='ACTIVE' WHERE id=$1`, [customer]);
  const wallet = await app
    .get(WalletService)
    .createWallet({ customerId: customer, currency: 'NGN', idempotencyKey: randomUUID() });
  const ledger = app.get(LedgerService);
  const [asset] = await db.query<Array<{ id: string }>>(
    `SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN'`,
  );
  await ledger.postJournal({
    idempotencyKey: randomUUID(),
    currency: 'NGN',
    lines: [
      { accountId: asset!.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '50' },
      {
        accountId: wallet.ledgerAccountId,
        direction: LedgerEntryDirection.CREDIT,
        amountMinor: '50',
      },
    ],
  });
  const withdrawal = randomUUID();
  await db.query(
    `INSERT INTO withdrawals(id,wallet_id,payment_reference,amount_minor,currency,status,idempotency_key,request_hash) VALUES($1,$2,$3,25,'NGN','PROCESSING',$4,$5)`,
    [withdrawal, wallet.id, `R${randomUUID().replace(/-/g, '')}`, randomUUID(), 'c'.repeat(64)],
  );
  const snapshot = snapshots.get(customer)!;
  snapshots.delete(customer);
  try {
    await expect(app.get(WithdrawalService).completeWithdrawal(withdrawal)).rejects.toMatchObject({
      status: 503,
    });
    expect(
      await db.query(`SELECT status,journal_id,failure_code FROM withdrawals WHERE id=$1`, [
        withdrawal,
      ]),
    ).toEqual([{ status: 'PROCESSING', journal_id: null, failure_code: null }]);
    expect((await ledger.getAccountBalance(wallet.ledgerAccountId)).balanceMinor).toBe('50');
  } finally {
    snapshots.set(customer, snapshot);
  }
  await expect(app.get(WithdrawalService).completeWithdrawal(withdrawal)).resolves.toMatchObject({
    status: 'COMPLETED',
  });
  expect((await ledger.getAccountBalance(wallet.ledgerAccountId)).balanceMinor).toBe('25');
});

test('fully migrated AppModule does not claim financial readiness without production dependencies', async () => {
  const { ProductionReadinessService } = await import(
    '../src/production/production-readiness.service'
  );
  const readiness = await app.get(ProductionReadinessService).getReadiness();
  expect(readiness.migrations.compatible).toBe(true);
  expect(readiness.status).toBe('error');
  expect(readiness.financialDependencies.blockers).toContain(
    'trusted_kyc_evidence_reader_unavailable',
  );
  await expect(app.get(ProductionReadinessService).verifyStartup()).rejects.toThrow();
});
