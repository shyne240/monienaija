/*
 * The ambient declaration is referenced rather than imported because it declares global module shims for the
 * React Native packages this suite reaches into; an `import` would give it module scope and the shims would not
 * apply.
 */
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./support/mobile-native-module-shims.d.ts" />
import type * as MobilePending from '../apps/agent-mobile/src/services/pending-operation';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import { workforceConfiguration } from '../src/authorization/workforce-configuration';
import { CashToCashWorkforceScope } from '../src/agent/cash-to-cash-workforce-scope';
import { NotFoundException } from '@nestjs/common';
// Mobile client uses these native adapters; requests below are bridged to the real Fastify app.
jest.mock('react-native', () => ({ Platform: { OS: 'test' } }), { virtual: true });
jest.mock('expo-secure-store', () => ({}), { virtual: true });
import { CashOutInstitutionResolver } from '../src/agent/cash-out-institution.resolver';
import { FinancialInstitutionStatus } from '../src/institution/institution.enums';
import {
  CashToCashFundingAuthority,
  type CashToCashFundingAuthorizationRequest,
} from '../src/agent/agent-cash-to-cash.service';
import { ServiceUnavailableException } from '@nestjs/common';
import { CashToCashClaimFinancialContext } from '../src/agent/cash-to-cash-claim-authorization';
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
import { assertIsolatedKycCluster, isolatedKycCluster } from './support/kyc-isolated-cluster';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import {
  createControlledFundingPolicy,
  overrideCashToCashFundingPolicy,
} from './support/controlled-funding-policy';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import {
  approveIsolatedInstitutionKycTierLimitPolicy,
  approveIsolatedKycTierPolicy,
} from './support/kyc-governance-fixtures';

// Portable provenance: see test/support/kyc-isolated-cluster.ts. No absolute path from any one
// developer's machine is embedded here; the runner (scripts/run-isolated-kyc-tests.js) creates
// the disposable cluster and exports KYC_ISOLATED_TEST_SOCKET.
const cluster = isolatedKycCluster();
const socket = cluster.socketDirectory;
const name = `kyc_batch2_${randomUUID().replace(/-/g, '')}`;
const admin = new DataSource({
  type: 'postgres',
  host: socket,
  port: cluster.port,
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
// Only explicitly provisioned synthetic subjects are authorized. Client inputs are lookup
// values; these server-side fixtures represent independently verified policy and identity.
const workforceInstitutions = new Map<string, string>();
// The isolated module's Cash-Out resolver double returns the real governed institution provisioned
// by each financial fixture. Its initial value only supports tests that exercise OTP preflight
// without creating the full institutional context.
let cashOutInstitutionId = '11111111-1111-4111-8111-111111111111';
// ARENA 3B: Cash-to-Cash now resolves the *funding institution's* own suspense obligation. The
// controlled funding-authority double below answers with the institution the governed fixture
// actually provisioned (registered, activated, agent affiliated, wallet attributed).
let c2cInstitutionId = '11111111-1111-4111-8111-111111111111';
const fundingSubjects = new Map<string, { senderPhone: string; recipient: string }>();

beforeAll(async () => {
  await admin.initialize();
  // Cluster provenance is asserted by the shared helper (marker + manifest + socket-only +
  // minimum server version). It used to be re-implemented here against a hardcoded path.
  await assertIsolatedKycCluster(admin, cluster);
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  db = new DataSource({
    type: 'postgres',
    host: socket,
    port: cluster.port,
    username: 'kyc_synthetic',
    database: name,
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: 'typeorm_migrations',
    entities: [`${__dirname}/../src/**/*.entity.ts`],
    migrations: [`${__dirname}/../src/migrations/*.ts`],
  });
  await db.initialize();
  await assertIsolatedKycCluster(db, cluster);
  await db.runMigrations({ transaction: 'all' });
  const { AppModule } = await import('../src/app.module');
  // ARENA 3B: Cash-to-Cash funding admission requires an explicitly declared approved policy.
  // The production binding stays fail-closed (`UnavailableCashToCashFundingPolicyAuthority`); this
  // declares the exact policy the run relies on without weakening any institutional check.
  const fundingPolicy = createControlledFundingPolicy();
  const appWorkforceConfiguration = workforceConfiguration(process.env);
  const testOnlyWorkforceConfiguration = {
    ...appWorkforceConfiguration,
    enabled: true,
    roles: [
      ...appWorkforceConfiguration.roles.filter((role) => role.roleKey !== 'FINANCE_CONTROLLER'),
      {
        roleKey: 'FINANCE_CONTROLLER',
        displayName: 'Synthetic finance controller',
        description: 'Disposable acceptance-only checker role.',
        enabled: true,
        scopes: ['privileged:approve', 'privileged:execute'],
        applicableActions: [],
        mfaRequired: true,
        approvalCapability: true,
        makerEligible: false,
        checkerEligible: true,
        administrativeCapability: false,
      },
    ],
    rateLimits: [
      ...appWorkforceConfiguration.rateLimits.filter(
        (rule) => rule.category !== 'privileged-approval',
      ),
      { category: 'privileged-approval', capacity: 100, refillRatePerSecond: 100, enabled: true },
    ],
  };
  const moduleRef = await overrideCashToCashFundingPolicy(
    Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(db),
    fundingPolicy,
  )
    .overrideProvider(A2_WORKFORCE_CONFIG)
    // The explicit FINANCE_CONTROLLER legacy execution scope and high-capacity rate budget are
    // disposable acceptance-only policies. Neither changes the production catalogue or thresholds.
    .useValue(testOnlyWorkforceConfiguration)
    .overrideProvider(CashOutInstitutionResolver)
    .useValue({
      resolve: (_manager: unknown, agentId: string) =>
        Promise.resolve({
          outcome: 'RESOLVED',
          agentId,
          institutionId: cashOutInstitutionId,
          affiliationId: 'test-affiliation',
          institutionStatus: FinancialInstitutionStatus.APPROVED,
          resolvedAt: new Date().toISOString(),
          evidenceFingerprint: 'fixture',
        }),
    })
    .overrideProvider(CashToCashFundingAuthority)
    .useValue({
      require: async (manager: EntityManager, request: CashToCashFundingAuthorizationRequest) => {
        const subject = fundingSubjects.get(request.agentId);
        if (
          !subject ||
          request.senderPhone !== subject.senderPhone ||
          request.beneficiaryPhone !== subject.recipient ||
          request.purpose !== 'fixture-purpose'
        )
          throw new ServiceUnavailableException('fixture funding evidence unavailable');
        const wallets: Array<{ id: string }> = await manager.query(
          `SELECT id FROM wallet_accounts WHERE id=$1 AND customer_id=$2 AND owner_class='AGENT' AND status='ACTIVE' AND ledger_account_id=$3 FOR SHARE`,
          [request.fundingWalletId, request.agentId, request.fundingLedgerAccountId],
        );
        if (wallets.length !== 1)
          throw new ServiceUnavailableException('fixture wallet unavailable');
        return {
          institutionId: c2cInstitutionId,
          senderIdentityFingerprint: 'a'.repeat(64),
          senderPolicyFingerprint: 'b'.repeat(64),
          fundingAuthorizationFingerprint: 'c'.repeat(64),
          institutionEvidenceFingerprint: 'd'.repeat(64),
        };
      },
    })
    .overrideProvider(CashToCashWorkforceScope)
    .useValue({
      assertCanAccessInstitution: (
        principal: { principalId: string; scopes: string[] },
        institutionId: string,
      ) => {
        if (principal.scopes.includes('institution.attribution.view')) return Promise.resolve();
        if (workforceInstitutions.get(principal.principalId) !== institutionId)
          throw new NotFoundException('Institution not found');
        return Promise.resolve();
      },
    })
    .overrideProvider(CashToCashClaimFinancialContext)
    .useValue({
      resolve: () =>
        Promise.resolve({
          institutionId: c2cInstitutionId,
          evidenceFingerprint: 'a'.repeat(64),
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
  await seedActivationConfig();
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
  const req = { all: [], any: [] };
  const definition = {
    regulatoryRequirementsConfirmed: true,
    effectiveFrom: '2020-01-01T00:00:00.000Z',
    effectiveUntil: null,
    regulatory: { LEVEL_1: req, LEVEL_2: req },
    operator: { LEVEL_1: req, LEVEL_2: req },
  };
  await approveIsolatedKycTierPolicy(db, cluster, definition);
}

async function seedActivationConfig() {
  const classId = randomUUID();
  const classCode = 'B2C_TEST_DEFAULT';
  await db.query(
    `INSERT INTO customer_classes(id,reference,code,name,kind,status,enabled,configuration_status,is_default,created_by,version,created_at,updated_at)
     VALUES($1,$2,$3,'B2C Test Default','CUSTOMER','ACTIVE',true,'CONFIGURED',false,'fixture',1,clock_timestamp(),clock_timestamp())
     ON CONFLICT (id) DO NOTHING`,
    [classId, `cc-${classId.slice(0, 8)}`, classCode],
  );
  for (const tier of ['LEVEL_1', 'LEVEL_2', 'LEVEL_3']) {
    await db.query(
      `INSERT INTO customer_tier_default_classes(tier,class_id,status,approved_at,approved_by,reason,created_by,updated_by,version,created_at,updated_at)
       VALUES($1,$2,'APPROVED',clock_timestamp(),'fixture','test seed','fixture','fixture',1,clock_timestamp(),clock_timestamp())
       ON CONFLICT (tier) DO UPDATE SET class_id=EXCLUDED.class_id,status='APPROVED',approved_at=clock_timestamp(),approved_by='fixture',updated_at=clock_timestamp()`,
      [tier, classId],
    );
  }
  const productCode = 'B2C_TEST_PRODUCT';
  await db.query(
    `INSERT INTO products(code,name,domain,currency,product_scope,status,enabled,configuration_status,created_by,version,created_at,updated_at)
     VALUES($1,'B2C Test Product','CUSTOMER','NGN','V1','ACTIVE',true,'CONFIGURED','fixture',1,clock_timestamp(),clock_timestamp())
     ON CONFLICT (code) DO UPDATE SET status='ACTIVE',enabled=true,configuration_status='CONFIGURED',updated_at=clock_timestamp()`,
    [productCode],
  );
  await db.query(
    `INSERT INTO fee_rules(id,product_code,currency,flat_fee_minor,percentage_bps,minimum_fee_minor,maximum_fee_minor,vat_bps,effective_from,effective_to,priority,is_active,created_by,version,created_at,updated_at,customer_class_code)
     VALUES($1,$2,'NGN',0,0,0,0,0,clock_timestamp()-interval '1 day',NULL,100,true,'fixture',1,clock_timestamp(),clock_timestamp(),$3)`,
    [randomUUID(), productCode, classCode],
  );
  const profileCode = 'B2C_TEST_PROFILE';
  await db.query(
    `INSERT INTO limit_profiles(code,name,kind,status,enabled,configuration_status,created_by,version,created_at,updated_at)
     VALUES($1,'B2C Test Profile','CUSTOMER','ACTIVE',true,'CONFIGURED','fixture',1,clock_timestamp(),clock_timestamp())
     ON CONFLICT (code) DO UPDATE SET status='ACTIVE',enabled=true,configuration_status='CONFIGURED',updated_at=clock_timestamp()`,
    [profileCode],
  );
  for (const dim of [
    'MAX_AMOUNT_PER_TX',
    'DAILY_AMOUNT',
    'WEEKLY_AMOUNT',
    'MONTHLY_AMOUNT',
    'WALLET_BALANCE_MAX',
  ]) {
    await db.query(
      `INSERT INTO limit_rules(id,limit_profile_code,product,direction,channel,currency,dimension,limit_value_minor,limit_value_count,version,effective_from,effective_to,is_active,priority,created_by,created_at,updated_at,is_unlimited)
       VALUES($1,$2,$3,NULL,NULL,'NGN',$4,100000000,NULL,1,clock_timestamp()-interval '1 day',NULL,true,100,'fixture',clock_timestamp(),clock_timestamp(),false)`,
      [randomUUID(), profileCode, productCode, dim],
    );
  }
  await db.query(
    `INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,segment_code,precedence,effective_from,effective_to,is_active,created_by,version,created_at,updated_at)
     VALUES($1,$2,'SEGMENT',NULL,$3,100,clock_timestamp()-interval '1 day',NULL,true,'fixture',1,clock_timestamp(),clock_timestamp())`,
    [randomUUID(), profileCode, classCode],
  );
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
  await expect(db.transaction((m) => gate.require(m, two))).resolves.toBe('LEVEL_2');
  snapshots.get(two)!.evidence[0]!.status = 'REVOKED';
  await expect(db.transaction((m) => gate.require(m, two))).rejects.toThrow();
  await expect(
    wallets.createWallet({ customerId: two, currency: 'NGN', idempotencyKey: 'revoked' }),
  ).rejects.toThrow();
  await db.query(`UPDATE customers SET status='SUSPENDED' WHERE id=$1`, [one]);
  await expect(db.transaction((m) => gate.require(m, one))).rejects.toThrow();
});

test('misconfigured deployment (zero configured products, no usable class) blocks initial DRAFT->ACTIVE activation and explains why', async () => {
  const customers = app.get(CustomerService);
  const id = await subject('LEVEL_1', ['BVN']);
  const savedDefaults = await db.query(`SELECT * FROM customer_tier_default_classes ORDER BY tier`);
  const savedClass = await db.query(
    `SELECT code, status, enabled, configuration_status, is_default FROM customer_classes WHERE code='B2C_TEST_DEFAULT'`,
  );
  try {
    await db.query(`DELETE FROM customer_tier_default_classes`);
    await db.query(
      `UPDATE products SET enabled=false, configuration_status='NOT_CONFIGURED' WHERE domain='CUSTOMER'`,
    );
    await db.query(
      `UPDATE customer_classes SET enabled=false, status='DISABLED', configuration_status='NOT_CONFIGURED' WHERE code='B2C_TEST_DEFAULT'`,
    );
    let err: any;
    try {
      await customers.updateStatus(id, { status: CustomerStatus.ACTIVE, actor: 'fixture' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    const response = err?.response ?? err?.getResponse?.() ?? {};
    expect(String(response.code ?? err?.code ?? '')).toBe('ACTIVATION_CONFIGURATION_INCOMPLETE');
    expect(Array.isArray(response.issues)).toBe(true);
    const codes = response.issues.map((i: any) => i.code);
    expect(codes).toContain('NO_ENABLED_PRODUCTS');
    // No usable class: no approved tier default resolves and no usable manual class exists.
    expect(
      codes.some((c: string) =>
        ['TIER_DEFAULT_MISSING', 'TIER_DEFAULT_NOT_APPROVED', 'TIER_DEFAULT_CLASS_UNUSABLE', 'MANUAL_CLASS_UNUSABLE'].includes(c),
      ),
    ).toBe(true);
    expect(response.issues.every((i: any) => typeof i.message === 'string' && i.message.length > 0)).toBe(true);
  } finally {
    await db.query(
      `UPDATE products SET enabled=true, configuration_status='CONFIGURED' WHERE domain='CUSTOMER'`,
    );
    for (const row of savedClass) {
      await db.query(
        `UPDATE customer_classes SET status=$2, enabled=$3, configuration_status=$4, is_default=$5, updated_at=clock_timestamp() WHERE code=$1`,
        [row.code, row.status, row.enabled, row.configuration_status, row.is_default],
      );
    }
    await db.query(`DELETE FROM customer_tier_default_classes`);
    for (const row of savedDefaults) {
      await db.query(
        `INSERT INTO customer_tier_default_classes(tier,class_id,status,approved_at,approved_by,reason,created_by,updated_by,version,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (tier) DO UPDATE SET class_id=EXCLUDED.class_id,status=EXCLUDED.status,approved_at=EXCLUDED.approved_at,approved_by=EXCLUDED.approved_by,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp()`,
        [
          row.tier,
          row.class_id,
          row.status,
          row.approved_at,
          row.approved_by,
          row.reason,
          row.created_by,
          row.updated_by,
          row.version,
          row.created_at,
          row.updated_at,
        ],
      );
    }
  }
});

test('unavailable, synthetic, conflicting and expired evidence or holds fail closed', async () => {
  const gate = app.get(CustomerFinancialEligibilityService);
  const id = await subject('LEVEL_1', ['NIN']);
  await db.query(`UPDATE customers SET status='ACTIVE' WHERE id=$1`, [id]);
  const check = () => db.transaction((m) => gate.require(m, id));
  await expect(check()).resolves.toBe('LEVEL_1');
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
    const [head] = await db.query<Array<{ version: number; last_proposal_id: string }>>(
      'SELECT version,last_proposal_id FROM kyc_tier_policy_head WHERE singleton=true',
    );
    // Inject a missing-head corruption case only inside this disposable superuser test database;
    // normal runtime and protected-authority credentials cannot delete or forge the policy head.
    await db.query(
      'ALTER TABLE kyc_tier_policy_head DISABLE TRIGGER kyc_tier_head_authority_guard',
    );
    try {
      await db.query('DELETE FROM kyc_tier_policy_head WHERE singleton=true');
      const noPolicy = await app
        .get(MobileOnboardingAuthService)
        .login(thirdRegistration, thirdToken, '112233');
      expect(noPolicy.audience).toBe('customer-onboarding');
      expect((await sessionService.validate({ token: noPolicy.accessToken })).valid).toBe(false);
    } finally {
      try {
        await db.query(
          `INSERT INTO kyc_tier_policy_head(singleton,version,last_proposal_id) VALUES(true,$1,$2)
           ON CONFLICT(singleton) DO UPDATE SET version=excluded.version,last_proposal_id=excluded.last_proposal_id`,
          [head!.version, head!.last_proposal_id],
        );
      } finally {
        await db.query(
          'ALTER TABLE kyc_tier_policy_head ENABLE TRIGGER kyc_tier_head_authority_guard',
        );
      }
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

async function claimOtpFixture(customerId: string) {
  const { AgentClassService } = await import('../src/agent/agent-class.service');
  const { AgentService } = await import('../src/agent/agent-service.enum');
  const { LedgerService } = await import('../src/ledger/ledger.service');
  const { LedgerAccountType, LedgerEntryDirection } = await import('../src/ledger/ledger.enums');
  const phone = `8${randomUUID().replace(/\D/g, '').padEnd(9, '1').slice(0, 9)}`;
  await db.query(
    `UPDATE customer_contact_methods SET value=$2,normalized_value=$2 WHERE customer_id=$1`,
    [customerId, phone],
  );
  await app
    .get(WalletService)
    .createWallet({ customerId, currency: 'NGN', idempotencyKey: randomUUID() });
  const agentId = randomUUID(),
    agentSessionId = randomUUID(),
    credential = randomUUID();
  const cls = await app.get(AgentClassService).create({
    reference: randomUUID(),
    code: `F${randomUUID().slice(0, 8)}`,
    name: 'claim fixture',
    isActive: true,
    applicableServices: [AgentService.CASH_TO_CASH],
    actor: 'fixture',
  });
  await db.query(
    `INSERT INTO agents(id,reference,status,agent_class_id) VALUES($1,$3,'ACTIVE',$2)`,
    [agentId, cls.id, agentId],
  );
  await db.query(
    `INSERT INTO agent_authentication_credentials(id,agent_id,password_hash,hash_algorithm,password_version,status,password_changed_at) VALUES($1,$2,'fixture-hash','PBKDF2',1,'ACTIVE',clock_timestamp()-interval '1 minute')`,
    [credential, agentId],
  );
  await db.query(
    `INSERT INTO agent_authentication_sessions(id,agent_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at) VALUES($1,$2,$3,$4,'agent-api','ACTIVE',clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp())`,
    [agentSessionId, agentId, credential, randomUUID().replace(/-/g, '').repeat(2)],
  );
  const ledger = app.get(LedgerService);
  const source = await ledger.createAccount({
    code: `claim-fixture-${randomUUID()}`,
    name: 'fixture',
    currency: 'NGN',
    accountType: LedgerAccountType.ASSET,
    allowNegativeBalance: true,
  });
  let accounts = await db.query<Array<{ id: string }>>(
    `SELECT id FROM ledger_accounts WHERE code='CASH_TO_CASH-UNCLAIMED-NGN'`,
  );
  if (!accounts.length) {
    const account = await ledger.createAccount({
      code: 'CASH_TO_CASH-UNCLAIMED-NGN',
      name: 'unclaimed',
      currency: 'NGN',
      accountType: LedgerAccountType.LIABILITY,
      allowNegativeBalance: false,
    });
    accounts = [{ id: account.id }];
  }
  const journal = await ledger.postJournal({
    idempotencyKey: randomUUID(),
    currency: 'NGN',
    lines: [
      { accountId: source.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '100' },
      { accountId: accounts[0]!.id, direction: LedgerEntryDirection.CREDIT, amountMinor: '100' },
    ],
  });
  const transferId = randomUUID();
  const { randomBytes, pbkdf2Sync } = await import('node:crypto');
  const salt = randomBytes(16);
  const transferCode = '12345678';
  const transferCodeHash = `PBKDF2$sha256$10000$${salt.toString('base64url')}$${pbkdf2Sync(transferCode, salt, 10000, 32, 'sha256').toString('base64url')}`;
  await db.query(
    `INSERT INTO cash_to_cash_transfers(id,agent_id,beneficiary_phone,principal_minor,total_minor,currency,status,transfer_code_hash,hash_algorithm,journal_id,idempotency_key,expires_at) VALUES($1,$2,$3,100,100,'NGN','UNCLAIMED',$6,'PBKDF2',$4,$5,clock_timestamp()+interval '1 hour')`,
    [transferId, agentId, phone, journal.id, randomUUID(), transferCodeHash],
  );
  return {
    agentId,
    phone,
    transferCode,
    agentSessionId,
    customerId,
    transferId,
    redemptionMethod: 'CUSTOMER_WALLET' as const,
    purpose: 'CASH_TO_CASH_CLAIM' as const,
  };
}

test('desk OTP preflight denies withdrawn and unavailable evidence before challenge or delivery', async () => {
  const { AgentDeskOtpService } = await import('../src/agent/agent-desk-otp.service');
  const customerId = await subject('LEVEL_1', ['BVN']);
  await db.query(`UPDATE customers SET status='ACTIVE' WHERE id=$1`, [customerId]);
  await db.query(
    `INSERT INTO customer_authentication_credentials(id, customer_id, password_hash, hash_algorithm, password_version, status) VALUES($1,$2,'fixture-hash','PBKDF2',1,'ACTIVE')`,
    [randomUUID(), customerId],
  );
  const otp = app.get(AgentDeskOtpService);
  const command = await claimOtpFixture(customerId);
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
  const claimContext = await claimOtpFixture(customerId);
  sms.clear();
  const issued = await app.get(AgentDeskOtpService).issue(claimContext);
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
  const claimContext = await claimOtpFixture(customerId);
  sms.clear();
  const issued = await app.get(AgentDeskOtpService).issue(claimContext);
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
  const { LedgerEntryDirection } = await import('../src/ledger/ledger.enums');
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
  // Bind the customer wallet, cash-out intent and approved tier-limit policy to one real,
  // governed institution. The generous rule is isolated synthetic acceptance data; production
  // enforcement and profile-digest checks remain active.
  const { GovernedFinancialFixture } = await import('./support/governed-financial-fixture');
  const governed = new GovernedFinancialFixture({ app, dataSource: db, label: 'b2c-cashout' });
  cashOutInstitutionId = await governed.institution();
  await governed.enrolCustomer(customerId, cashOutInstitutionId);
  await approveIsolatedInstitutionKycTierLimitPolicy(
    db,
    cluster,
    cashOutInstitutionId,
    'WALLET_TO_CASH',
  );
  await governed.affiliateAgent(agent.id, cashOutInstitutionId);
  const wallets = app.get(WalletService);
  const customerWallet = await wallets.createWallet({
    customerId,
    currency: 'NGN',
    idempotencyKey: randomUUID(),
  });
  await governed.attributeWallet(customerWallet.id, cashOutInstitutionId);
  const agentWallet = await wallets.createWallet({
    customerId: agent.id,
    currency: 'NGN',
    idempotencyKey: randomUUID(),
  });
  await governed.attributeWallet(agentWallet.id, cashOutInstitutionId);
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
      institution_scope: cashOutInstitutionId,
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
    institutionStatus: FinancialInstitutionStatus.APPROVED,
    resolvedAt: new Date().toISOString(),
    evidenceFingerprint: 'fixture',
  });
  // A resolver that now returns a *different* institution can never execute the stored intent:
  // the intent-scope predicate rejects it as a mismatch rather than posting against a new scope.
  await expect(service.execute(input)).rejects.toThrow('Cash-out intent unavailable or mismatched');
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
  // Use an institution-owned settlement asset as the funding counterparty for both wallets.
  const source = { id: await governed.openInstitutionSettlementAccount(cashOutInstitutionId) };
  await governed.fundLedgerAccount(customerWallet.ledgerAccountId, '1000', {
    institutionId: cashOutInstitutionId,
  });
  const attempts = await Promise.allSettled([service.execute(input), service.execute(input)]);
  const completed = attempts.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  if (!completed.some((result) => result.status === 'COMPLETED')) {
    console.error(
      'Cash-out acceptance outcomes:',
      attempts.map((attempt) =>
        attempt.status === 'rejected' ? String(attempt.reason) : attempt.value,
      ),
    );
  }
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
    app.get(AgentDeskOtpService).issue({
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
    institutionStatus: FinancialInstitutionStatus.APPROVED,
    resolvedAt: new Date().toISOString(),
    evidenceFingerprint: 'fixture',
  });
  // The receipt is bound to the institution recorded on its intent; a resolver that now answers
  // with a different institution makes the receipt unavailable rather than movable.
  await expect(
    service.recoverReceipt({ ...input.agentPrincipal, sessionId: newSession }, operationKey),
  ).rejects.toThrow('Cash-out receipt unavailable');
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

test('bound wallet-redemption claim wiring rolls back OTP with a failed posting and serializes funded claims', async () => {
  const { AgentCashToCashClaimService } = await import(
    '../src/agent/agent-cash-to-cash-claim.service'
  );
  const { AgentDeskOtpService } = await import('../src/agent/agent-desk-otp.service');
  const { LedgerService } = await import('../src/ledger/ledger.service');
  const { LedgerEntryDirection } = await import('../src/ledger/ledger.enums');
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
  const claimWallet = await app
    .get(WalletService)
    .createWallet({ customerId, currency: 'NGN', idempotencyKey: randomUUID() });
  // A CUSTOMER claim settles into a real wallet, so it is admitted under the same tier-bound
  // contract as every other customer financial boundary: the wallet needs an institutional
  // attribution and that institution needs an approved tier->limit mapping. Provisioning both
  // through the governed workflows is what makes this test exercise the wiring instead of the
  // fail-closed guard.
  const { GovernedFinancialFixture: ClaimGovernedFixture } = await import(
    './support/governed-financial-fixture'
  );
  const claimGoverned = new ClaimGovernedFixture({
    app,
    dataSource: db,
    label: 'b2c-claim',
  });
  const claimInstitutionId = await claimGoverned.institution('claim');
  await claimGoverned.enrolCustomer(customerId, claimInstitutionId);
  await approveIsolatedInstitutionKycTierLimitPolicy(
    db,
    cluster,
    claimInstitutionId,
    'CASH_TO_CASH',
  );
  await claimGoverned.attributeWallet(claimWallet.id, claimInstitutionId);
  const agentId = randomUUID();
  await db.query(`INSERT INTO agents(id,reference,status) VALUES($1,$2,'ACTIVE')`, [
    agentId,
    agentId,
  ]);
  const { AgentClassService } = await import('../src/agent/agent-class.service');
  const { AgentService } = await import('../src/agent/agent-service.enum');
  const cls = await app.get(AgentClassService).create({
    reference: randomUUID(),
    code: `W${randomUUID().slice(0, 8)}`,
    name: 'claim fixture',
    isActive: true,
    applicableServices: [AgentService.CASH_TO_CASH],
    actor: 'fixture',
  });
  await db.query(`UPDATE agents SET agent_class_id=$2 WHERE id=$1`, [agentId, cls.id]);
  const agentSessionId = randomUUID(),
    agentCredential = randomUUID();
  await db.query(
    `INSERT INTO agent_authentication_credentials(id,agent_id,password_hash,hash_algorithm,password_version,status,password_changed_at) VALUES($1,$2,'fixture-hash','PBKDF2',1,'ACTIVE',clock_timestamp()-interval '1 minute')`,
    [agentCredential, agentId],
  );
  await db.query(
    `INSERT INTO agent_authentication_sessions(id,agent_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at) VALUES($1,$2,$3,$4,'agent-api','ACTIVE',clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp())`,
    [agentSessionId, agentId, agentCredential, randomBytes(32).toString('hex')],
  );
  const principal = {
    type: 'AGENT' as const,
    agentId,
    principalId: agentId,
    sessionId: agentSessionId,
    roles: [],
    scopes: [],
    customerAccess: 'NONE' as const,
    agentAccess: 'SELF' as const,
  };
  const ledger = app.get(LedgerService);
  // The funding leg is institution-attributed too. A journal may not mix an UNATTRIBUTED platform
  // account with an institution-attributed one — the ledger's institutional-context resolver
  // refuses exactly that, because such a posting has no single owner. Real Cash→Cash funding debits
  // the funding institution's own settlement asset, so the fixture does the same.
  const source = {
    id: await claimGoverned.openInstitutionSettlementAccount(claimInstitutionId, {
      code: `claim-source-${randomUUID().slice(0, 8).toUpperCase()}`,
      name: 'fixture source',
    }),
  };
  // The obligation account is the FUNDING INSTITUTION's own suspense liability, resolved from the
  // transfer's funding evidence — not a shared platform account. Recording that evidence is what
  // makes this a genuinely institutionalised transfer rather than a legacy one.
  const suspenseAccountId =
    await claimGoverned.openInstitutionCashToCashSuspenseAccount(claimInstitutionId);
  // NOTE ordering: attribution is executed BEFORE this wallet's ledger account carries any posted
  // history. The governed attribution workflow deliberately refuses a wallet whose ledger account
  // already has journal lines, because attributing it afterwards would fabricate historical
  // attribution. Seeding in the other order is exactly the mistake this comment prevents.
  const funding = await ledger.postJournal({
    idempotencyKey: randomUUID(),
    currency: 'NGN',
    lines: [
      { accountId: source.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '100' },
      { accountId: suspenseAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '100' },
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
  // Bind the transfer to its funding institution: this is the evidence the claim reads to decide
  // WHICH obligation account the money sits in, and it is what makes the settlement journal and
  // the destination wallet agree on one institution.
  const claimAgentWallet = await app
    .get(WalletService)
    .createWallet({ customerId: agentId, currency: 'NGN', idempotencyKey: randomUUID() });
  await db.query(
    `INSERT INTO cash_to_cash_funding_evidence
       (transfer_id,funding_agent_id,funding_wallet_id,funding_ledger_account_id,
        unclaimed_ledger_account_id,funding_journal_id,institution_id,request_hash,
        sender_identity_fingerprint,sender_policy_fingerprint,
        funding_authorization_fingerprint,institution_evidence_fingerprint)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      transferId,
      agentId,
      claimAgentWallet.id,
      claimAgentWallet.ledgerAccountId,
      suspenseAccountId,
      funding.id,
      claimInstitutionId,
      'a'.repeat(64),
      'b'.repeat(64),
      'c'.repeat(64),
      'd'.repeat(64),
      'e'.repeat(64),
    ],
  );
  sms.clear();
  const challenge = await app.get(AgentDeskOtpService).issue({
    agentId,
    agentSessionId,
    customerId,
    transferId,
    redemptionMethod: 'CUSTOMER_WALLET',
    purpose: 'CASH_TO_CASH_CLAIM',
  });
  const otp = sms.sent[0]!.message.match(/code is (\d{6})/)![1]!;
  const claim = app.get(AgentCashToCashClaimService);
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
    claimantPrincipal: principal,
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
  }
}, 120_000);

test('bound agent-cash claim keeps authorization atomic and recovers the original receipt', async () => {
  const head = await db.query<Array<{ version: number }>>(
    `SELECT version FROM kyc_tier_policy_head`,
  );
  if (!head[0]?.version) await setPolicy();
  const { AgentCashToCashClaimService } = await import(
    '../src/agent/agent-cash-to-cash-claim.service'
  );
  const { AgentDeskOtpService } = await import('../src/agent/agent-desk-otp.service');
  const { LedgerService } = await import('../src/ledger/ledger.service');
  const { LedgerAccountType, LedgerEntryDirection } = await import('../src/ledger/ledger.enums');
  const { randomBytes, pbkdf2Sync, createHash } = await import('node:crypto');
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
  // ARENA 3B: the unclaimed Cash-to-Cash obligation is now the FUNDING INSTITUTION's own suspense
  // liability, so the whole institutional context is provisioned through the governed workflows:
  // institution registration/activation, customer enrolment, wallet attribution and the suspense
  // account itself. No row is inserted directly and no approval is fabricated.
  const { GovernedFinancialFixture } = await import('./support/governed-financial-fixture');
  const governed = new GovernedFinancialFixture({ app, dataSource: db, label: 'b2c-c2c' });
  c2cInstitutionId = await governed.institution();
  await governed.enrolCustomer(customerId, c2cInstitutionId);
  // Cash-to-Cash funding and claim use the configured product limit profile. This synthetic rule
  // is test-only; the institution tier mapping itself still receives a protected maker/checker
  // approval and binds the profile digest used by strict admission.
  await approveIsolatedInstitutionKycTierLimitPolicy(db, cluster, c2cInstitutionId, 'CASH_TO_CASH');
  await governed.openInstitutionCashToCashSuspenseAccount(c2cInstitutionId);
  const [customerWalletRow] = await db.query<Array<{ id: string }>>(
    `SELECT id FROM wallet_accounts WHERE customer_id=$1 AND currency='NGN'`,
    [customerId],
  );
  await governed.attributeWallet(customerWalletRow!.id, c2cInstitutionId);
  const agentId = randomUUID();
  await db.query(`INSERT INTO agents(id,reference,status) VALUES($1,$2,'ACTIVE')`, [
    agentId,
    agentId,
  ]);
  const { AgentClassService } = await import('../src/agent/agent-class.service');
  const { AgentService } = await import('../src/agent/agent-service.enum');
  const { AgentAuthenticationService } = await import(
    '../src/agent-authentication/agent-authentication.service'
  );
  const { AgentPasswordHashAlgorithm } = await import(
    '../src/agent-authentication/agent-authentication.enums'
  );
  const cls = await app.get(AgentClassService).create({
    reference: randomUUID(),
    code: `C${randomUUID().slice(0, 8)}`,
    name: 'claim agent',
    isActive: true,
    applicableServices: [AgentService.CASH_TO_CASH],
    actor: 'fixture',
  });
  await db.query(`UPDATE agents SET agent_class_id=$2 WHERE id=$1`, [agentId, cls.id]);
  const pinSalt = randomBytes(16);
  const pinHash = `PBKDF2$sha256$10000$${pinSalt.toString('base64url')}$${pbkdf2Sync('1234', pinSalt, 10000, 32, 'sha256').toString('base64url')}`;
  await app.get(AgentAuthenticationService).setTransactionPin(agentId, {
    pinHash,
    hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
    pinVersion: 1,
    actor: agentId,
  });
  // Governed affiliation + wallet + attribution + institutionally funded float.
  const agentFunding = await governed.prepareAgentFundingWallet(agentId, {
    institutionId: c2cInstitutionId,
    fundAmountMinor: '1000',
  });
  expect(agentFunding.attribution.ledgerAccountId).toBeTruthy();
  const agentCredential = randomUUID(),
    deskSession = randomUUID();
  await db.query(
    `INSERT INTO agent_authentication_credentials(id,agent_id,password_hash,hash_algorithm,password_version,status,password_changed_at) VALUES($1,$2,'fixture-hash','PBKDF2',1,'ACTIVE',clock_timestamp()-interval '1 minute')`,
    [agentCredential, agentId],
  );
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO agent_authentication_sessions(id,agent_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at) VALUES($1,$2,$3,$4,'agent-api','ACTIVE',clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp())`,
    [deskSession, agentId, agentCredential, createHash('sha256').update(token).digest('hex')],
  );
  const principal = {
    type: 'AGENT' as const,
    agentId,
    principalId: agentId,
    sessionId: deskSession,
    roles: [],
    scopes: [],
    customerAccess: 'NONE' as const,
    agentAccess: 'SELF' as const,
  };
  const ledger = app.get(LedgerService);
  const suspenseAccountId =
    await governed.openInstitutionCashToCashSuspenseAccount(c2cInstitutionId);
  // Historical scenario in this test: a transfer with NO funding evidence must remain bound to the
  // legacy platform obligation account, exactly as the accepted historical-compatibility contract
  // requires. It is a platform account created through the ledger service, not an attribution.
  const legacySource = await ledger.createAccount({
    code: `legacy-source-${randomUUID()}`,
    name: 'legacy fixture source',
    currency: 'NGN',
    accountType: LedgerAccountType.ASSET,
    allowNegativeBalance: true,
  });
  let legacyUnclaimed = await db.query<Array<{ id: string }>>(
    `SELECT id FROM ledger_accounts WHERE code='CASH_TO_CASH-UNCLAIMED-NGN'`,
  );
  if (!legacyUnclaimed.length) {
    const account = await ledger.createAccount({
      code: 'CASH_TO_CASH-UNCLAIMED-NGN',
      name: 'legacy unclaimed fixture',
      currency: 'NGN',
      accountType: LedgerAccountType.LIABILITY,
      allowNegativeBalance: false,
    });
    legacyUnclaimed = [{ id: account.id }];
  }
  const server = app.getHttpAdapter().getInstance();
  fundingSubjects.set(agentId, { senderPhone: '8011111111', recipient: phone });
  const fundingPayload = {
    senderPhone: '8011111111',
    beneficiaryPhone: phone,
    amountMinor: '100',
    currency: 'NGN',
    idempotencyKey: randomUUID(),
    agentPin: '1234',
    purpose: 'fixture-purpose',
  };
  const unauthFunding = await server.inject({
    method: 'POST',
    url: '/api/v1/agents/cash-to-cash',
    payload: fundingPayload,
  });
  expect(unauthFunding.statusCode).toBe(401);
  const initiated = await server.inject({
    method: 'POST',
    url: '/api/v1/agents/cash-to-cash',
    headers: { authorization: `Bearer ${token}` },
    payload: fundingPayload,
  });
  if (initiated.statusCode !== 201) {
    console.error('Cash-to-Cash fixture initiation response:', initiated.body);
  }
  expect({ status: initiated.statusCode, body: initiated.body }).toMatchObject({ status: 201 });
  const funding = initiated.json<{ transferId: string; journalId: string; transferCode: string }>();
  const transferId = funding.transferId;
  const transferCode = funding.transferCode;
  const recoverUrl = '/api/v1/agents/cash-to-cash/recover-funding';
  expect(
    (
      await server.inject({
        method: 'POST',
        url: recoverUrl,
        payload: { idempotencyKey: fundingPayload.idempotencyKey },
      })
    ).statusCode,
  ).toBe(401);
  const resolver = app.get(CashOutInstitutionResolver);
  const recoveryResolver = jest.spyOn(resolver, 'resolve');
  // The authoritative resolver is genuinely wired in this fixture, so an unavailable authority
  // has to be simulated explicitly before asserting the fail-closed path.
  recoveryResolver.mockRejectedValueOnce(new Error('Institution authority unavailable'));
  const unavailableRecovery = await server.inject({
    method: 'POST',
    url: recoverUrl,
    headers: { authorization: `Bearer ${token}` },
    payload: { idempotencyKey: fundingPayload.idempotencyKey },
  });
  expect(unavailableRecovery.statusCode).toBe(503);
  const affiliation = {
    outcome: 'RESOLVED' as const,
    agentId,
    institutionId: c2cInstitutionId,
    affiliationId: randomUUID(),
    institutionStatus: FinancialInstitutionStatus.APPROVED,
    resolvedAt: new Date().toISOString(),
    evidenceFingerprint: 'a'.repeat(64),
  };
  recoveryResolver.mockResolvedValue(affiliation);
  const recoveredFunding = await server.inject({
    method: 'POST',
    url: recoverUrl,
    headers: { authorization: `Bearer ${token}` },
    payload: { idempotencyKey: fundingPayload.idempotencyKey },
  });
  expect(recoveredFunding.statusCode).toBe(200);
  expect(recoveredFunding.json()).toMatchObject({
    status: 'FOUND',
    transferId,
    journalId: funding.journalId,
    lifecycleStatus: 'UNCLAIMED',
    principalMinor: '100',
  });
  expect(recoveredFunding.json()).not.toHaveProperty('transferCode');
  const unknownFunding = await server.inject({
    method: 'POST',
    url: recoverUrl,
    headers: { authorization: `Bearer ${token}` },
    payload: { idempotencyKey: randomUUID() },
  });
  expect(unknownFunding.json()).toEqual({ status: 'UNKNOWN' });
  recoveryResolver.mockResolvedValueOnce({ ...affiliation, institutionId: randomUUID() });
  expect(
    (
      await server.inject({
        method: 'POST',
        url: recoverUrl,
        headers: { authorization: `Bearer ${token}` },
        payload: { idempotencyKey: fundingPayload.idempotencyKey },
      })
    ).statusCode,
  ).toBe(409);
  const otherAgent = randomUUID(),
    otherCredential = randomUUID(),
    otherSession = randomUUID(),
    otherToken = randomBytes(32).toString('base64url');
  await db.query(`INSERT INTO agents(id,reference,status) VALUES($1,$2,'ACTIVE')`, [
    otherAgent,
    otherAgent,
  ]);
  await db.query(
    `INSERT INTO agent_authentication_credentials(id,agent_id,password_hash,hash_algorithm,password_version,status,password_changed_at) VALUES($1,$2,'fixture-hash','PBKDF2',1,'ACTIVE',clock_timestamp()-interval '1 minute')`,
    [otherCredential, otherAgent],
  );
  await db.query(
    `INSERT INTO agent_authentication_sessions(id,agent_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at) VALUES($1,$2,$3,$4,'agent-api','ACTIVE',clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp())`,
    [
      otherSession,
      otherAgent,
      otherCredential,
      createHash('sha256').update(otherToken).digest('hex'),
    ],
  );
  recoveryResolver.mockResolvedValueOnce({ ...affiliation, agentId: otherAgent });
  const crossAgent = await server.inject({
    method: 'POST',
    url: recoverUrl,
    headers: { authorization: `Bearer ${otherToken}` },
    payload: { idempotencyKey: fundingPayload.idempotencyKey },
  });
  expect(crossAgent.statusCode).toBe(200);
  expect(crossAgent.json()).toEqual({ status: 'UNKNOWN' });
  const operationHandoffUrl = '/api/v1/agents/cash-to-cash/operation-handoff';
  const absentKey = randomUUID();
  const absentPayload = { idempotencyKey: absentKey, reason: 'UNKNOWN_OUTCOME' };
  expect(
    (await server.inject({ method: 'POST', url: operationHandoffUrl, payload: absentPayload }))
      .statusCode,
  ).toBe(401);
  const beforeJournals = await db.query<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM ledger_journals`,
  );
  const pendingHandoffs = await Promise.all(
    [1, 2].map(() =>
      server.inject({
        method: 'POST',
        url: operationHandoffUrl,
        headers: { authorization: `Bearer ${token}` },
        payload: absentPayload,
      }),
    ),
  );
  expect(pendingHandoffs.map((r) => r.statusCode)).toEqual([201, 201]);
  const pendingId = pendingHandoffs[0]!.json<{ id: string }>().id;
  expect(pendingHandoffs[1]!.json()).toEqual({ id: pendingId, status: 'UNRESOLVED' });
  expect(
    await db.query(`SELECT evidence,reason FROM cash_to_cash_operation_handoffs WHERE id=$1`, [
      pendingId,
    ]),
  ).toEqual([{ evidence: { status: 'UNKNOWN' }, reason: 'UNKNOWN_OUTCOME' }]);
  const lostCode = await server.inject({
    method: 'POST',
    url: operationHandoffUrl,
    headers: { authorization: `Bearer ${token}` },
    payload: { idempotencyKey: fundingPayload.idempotencyKey, reason: 'LOST_TRANSFER_CODE' },
  });
  expect(lostCode.statusCode).toBe(201);
  const lostId = lostCode.json<{ id: string }>().id;
  const lostRecord = await db.query<Array<{ evidence: Record<string, unknown> }>>(
    `SELECT evidence FROM cash_to_cash_operation_handoffs WHERE id=$1`,
    [lostId],
  );
  expect(lostRecord[0]!.evidence).toMatchObject({
    status: 'FOUND',
    transferId,
    journalId: funding.journalId,
    lifecycleStatus: 'UNCLAIMED',
  });
  expect(JSON.stringify(lostRecord)).not.toContain(transferCode);
  await expect(
    db.query(`DELETE FROM cash_to_cash_operation_handoffs WHERE id=$1`, [pendingId]),
  ).rejects.toThrow('immutable');
  expect(await db.query(`SELECT count(*)::int AS n FROM ledger_journals`)).toEqual(beforeJournals);
  recoveryResolver.mockResolvedValueOnce({ ...affiliation, institutionId: randomUUID() });
  expect(
    (
      await server.inject({
        method: 'POST',
        url: operationHandoffUrl,
        headers: { authorization: `Bearer ${token}` },
        payload: { idempotencyKey: fundingPayload.idempotencyKey, reason: 'LOST_TRANSFER_CODE' },
      })
    ).statusCode,
  ).toBe(409);
  // A real persisted workforce session and catalogue role; only the institution assignment is controlled.
  const { A2WorkforceSessionService } = await import(
    '../src/authorization/workforce-session.service'
  );
  const { A2FinanceRoleAssignment } = await import(
    '../src/authorization/workforce-authentication.entity'
  );
  const workforceId = `reconciliation-${randomUUID()}`;
  const now = new Date();
  await db.getRepository(A2FinanceRoleAssignment).save({
    id: randomUUID(),
    assignmentReference: workforceId,
    assignmentVersion: 1,
    principalId: workforceId,
    roleKey: 'TREASURY',
    scopes: [],
    status: 'ACTIVE',
    interim: true,
    effectiveFrom: new Date(now.getTime() - 60000),
    effectiveTo: new Date(now.getTime() + 86400000),
    assignedBy: 'fixture',
    assignedAt: now,
    revokedBy: null,
    revokedAt: null,
    bootstrapReference: null,
    approvalIds: [],
    auditReferences: [],
  } as never);
  const workforceSession = await app.get(A2WorkforceSessionService).establish({
    issuer: 'https://local-dev-identity.monienaija.invalid',
    subject: workforceId,
    principalId: workforceId,
    audience: ['workforce-admin'],
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 3600000).toISOString(),
    authenticatedAt: now.toISOString(),
    assuranceLevel: 'MFA',
    amr: ['pwd', 'otp'],
    acr: null,
    signingKeyId: 'fixture',
  });
  workforceInstitutions.set(workforceId, affiliation.institutionId);
  const createOtherWorkforceSession = async (roleKey: string) => {
    const id = `reconciliation-${randomUUID()}`;
    await db.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: id,
      assignmentVersion: 1,
      principalId: id,
      roleKey,
      scopes: [],
      status: 'ACTIVE',
      interim: true,
      effectiveFrom: new Date(now.getTime() - 60000),
      effectiveTo: new Date(now.getTime() + 86400000),
      assignedBy: 'fixture',
      assignedAt: now,
      revokedBy: null,
      revokedAt: null,
      bootstrapReference: null,
      approvalIds: [],
      auditReferences: [],
    } as never);
    return app.get(A2WorkforceSessionService).establish({
      issuer: 'https://local-dev-identity.monienaija.invalid',
      subject: id,
      principalId: id,
      audience: ['workforce-admin'],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3600000).toISOString(),
      authenticatedAt: now.toISOString(),
      assuranceLevel: 'MFA',
      amr: ['pwd', 'otp'],
      acr: null,
      signingKeyId: 'fixture',
    });
  };
  const platformSession = await createOtherWorkforceSession('FINANCE_AUDITOR');
  const noFunctionSession = await createOtherWorkforceSession('CUSTOMER_SERVICE');
  const operationLookupUrl = `/api/v1/internal/reconciliation/cash-to-cash/operation/${pendingId}`;
  expect((await server.inject({ method: 'GET', url: operationLookupUrl })).statusCode).toBe(401);
  const authorizedLookup = await server.inject({
    method: 'GET',
    url: operationLookupUrl,
    headers: { authorization: `Bearer ${workforceSession.accessToken}` },
  });
  expect(authorizedLookup.statusCode).toBe(200);
  expect(authorizedLookup.json()).toMatchObject({
    id: pendingId,
    status: 'UNRESOLVED',
    evidence: { status: 'UNKNOWN' },
  });
  workforceInstitutions.set(workforceId, randomUUID());
  expect(
    (
      await server.inject({
        method: 'GET',
        url: operationLookupUrl,
        headers: { authorization: `Bearer ${workforceSession.accessToken}` },
      })
    ).statusCode,
  ).toBe(404);
  workforceInstitutions.set(workforceId, affiliation.institutionId);
  expect(
    (
      await server.inject({
        method: 'GET',
        url: operationLookupUrl,
        headers: { authorization: `Bearer ${platformSession.accessToken}` },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await server.inject({
        method: 'GET',
        url: operationLookupUrl,
        headers: { authorization: `Bearer ${noFunctionSession.accessToken}` },
      })
    ).statusCode,
  ).toBe(403);
  expect(await db.query(`SELECT count(*)::int AS n FROM ledger_journals`)).toEqual(beforeJournals);
  recoveryResolver.mockRestore();
  const duplicateFunding = await server.inject({
    method: 'POST',
    url: '/api/v1/agents/cash-to-cash',
    headers: { authorization: `Bearer ${token}` },
    payload: fundingPayload,
  });
  expect(duplicateFunding.statusCode).toBe(201);
  expect(duplicateFunding.json()).toMatchObject({
    status: 'REPLAYED',
    transferId,
    journalId: funding.journalId,
  });
  const conflictingFunding = await server.inject({
    method: 'POST',
    url: '/api/v1/agents/cash-to-cash',
    headers: { authorization: `Bearer ${token}` },
    payload: { ...fundingPayload, amountMinor: '101' },
  });
  expect(conflictingFunding.statusCode).toBe(409);
  expect(
    await db.query(
      `SELECT funding_agent_id,funding_wallet_id,funding_journal_id FROM cash_to_cash_funding_evidence WHERE transfer_id=$1`,
      [transferId],
    ),
  ).toEqual([
    {
      funding_agent_id: agentId,
      funding_wallet_id: agentFunding.wallet.walletId,
      funding_journal_id: funding.journalId,
    },
  ]);
  expect(
    await db.query(
      `SELECT direction,amount_minor::text FROM ledger_lines WHERE journal_id=$1 AND ledger_account_id=$2`,
      [funding.journalId, agentFunding.wallet.ledgerAccountId],
    ),
  ).toEqual([{ direction: 'DEBIT', amount_minor: '100' }]);
  const deniedSender = await server.inject({
    method: 'POST',
    url: '/api/v1/agents/cash-to-cash',
    headers: { authorization: `Bearer ${token}` },
    payload: { ...fundingPayload, idempotencyKey: randomUUID(), senderPhone: '8022222222' },
  });
  expect(deniedSender.statusCode).toBe(503);
  const insufficientKey = randomUUID();
  const insufficient = await server.inject({
    method: 'POST',
    url: '/api/v1/agents/cash-to-cash',
    headers: { authorization: `Bearer ${token}` },
    payload: { ...fundingPayload, idempotencyKey: insufficientKey, amountMinor: '901' },
  });
  expect(insufficient.statusCode).toBeGreaterThanOrEqual(400);
  expect(
    await db.query(
      `SELECT count(*)::int AS n FROM cash_to_cash_transfers WHERE idempotency_key=$1`,
      [insufficientKey],
    ),
  ).toEqual([{ n: 0 }]);
  const concurrentKeys = [randomUUID(), randomUUID()];
  const concurrent = await Promise.all(
    concurrentKeys.map((idempotencyKey) =>
      server.inject({
        method: 'POST',
        url: '/api/v1/agents/cash-to-cash',
        headers: { authorization: `Bearer ${token}` },
        payload: { ...fundingPayload, idempotencyKey, amountMinor: '600' },
      }),
    ),
  );
  expect(concurrent.filter((r) => r.statusCode === 201)).toHaveLength(1);
  const cancelledId = concurrent
    .find((r) => r.statusCode === 201)!
    .json<{ transferId: string }>().transferId;
  const cancellationUrl = `/api/v1/agents/cash-to-cash/${cancelledId}/cancel`;
  expect(
    (await server.inject({ method: 'POST', url: cancellationUrl, payload: { agentPin: '1234' } }))
      .statusCode,
  ).toBe(401);
  const cancellations = await Promise.all(
    [1, 2].map(() =>
      server.inject({
        method: 'POST',
        url: cancellationUrl,
        headers: { authorization: `Bearer ${token}` },
        payload: { agentPin: '1234' },
      }),
    ),
  );
  expect(cancellations.map((r) => r.statusCode)).toEqual([200, 200]);
  expect(cancellations.map((r) => r.json<{ replayed: boolean }>().replayed).sort()).toEqual([
    false,
    true,
  ]);
  expect(
    await db.query(`SELECT status,claim_journal_id FROM cash_to_cash_transfers WHERE id=$1`, [
      cancelledId,
    ]),
  ).toEqual([{ status: 'CANCELLED', claim_journal_id: null }]);
  expect(
    await db.query(
      `SELECT count(*)::int AS n FROM cash_to_cash_cancellations WHERE transfer_id=$1`,
      [cancelledId],
    ),
  ).toEqual([{ n: 1 }]);
  await expect(
    db.query(`DELETE FROM cash_to_cash_cancellations WHERE transfer_id=$1`, [cancelledId]),
  ).rejects.toThrow('immutable');
  const handoffUrl = '/api/v1/agents/cash-to-cash/reconciliation-handoff';
  const handoffRequest = { transferId: cancelledId, reason: 'DISPOSITION_PENDING' };
  expect(
    (await server.inject({ method: 'POST', url: handoffUrl, payload: handoffRequest })).statusCode,
  ).toBe(401);
  const handoff = await server.inject({
    method: 'POST',
    url: handoffUrl,
    headers: { authorization: `Bearer ${token}` },
    payload: handoffRequest,
  });
  expect(handoff.statusCode).toBe(201);
  const handoffId = handoff.json<{ id: string }>().id;
  const handoffReplay = await server.inject({
    method: 'POST',
    url: handoffUrl,
    headers: { authorization: `Bearer ${token}` },
    payload: handoffRequest,
  });
  expect(handoffReplay.json()).toEqual({ id: handoffId });
  expect(
    (
      await server.inject({
        method: 'GET',
        url: `/api/v1/internal/reconciliation/cash-to-cash/${handoffId}`,
      })
    ).statusCode,
  ).toBe(401);
  const workforceTransferUrl = `/api/v1/internal/reconciliation/cash-to-cash/${handoffId}`;
  const visibleTransfer = await server.inject({
    method: 'GET',
    url: workforceTransferUrl,
    headers: { authorization: `Bearer ${workforceSession.accessToken}` },
  });
  expect(visibleTransfer.statusCode).toBe(200);
  expect(visibleTransfer.json()).toMatchObject({
    current: { classification: 'CANCELLED_DISPOSITION_PENDING', outstandingLiabilityMinor: '600' },
  });
  workforceInstitutions.set(workforceId, randomUUID());
  expect(
    (
      await server.inject({
        method: 'GET',
        url: workforceTransferUrl,
        headers: { authorization: `Bearer ${workforceSession.accessToken}` },
      })
    ).statusCode,
  ).toBe(404);
  workforceInstitutions.set(workforceId, affiliation.institutionId);
  expect(
    (
      await server.inject({
        method: 'GET',
        url: workforceTransferUrl,
        headers: { authorization: `Bearer ${platformSession.accessToken}` },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await server.inject({
        method: 'GET',
        url: workforceTransferUrl,
        headers: { authorization: `Bearer ${noFunctionSession.accessToken}` },
      })
    ).statusCode,
  ).toBe(403);
  const unavailableScope = jest
    .spyOn(app.get(CashToCashWorkforceScope), 'assertCanAccessInstitution')
    .mockRejectedValue(new ServiceUnavailableException('Authority unavailable'));
  try {
    for (const url of [operationLookupUrl, workforceTransferUrl])
      expect(
        (
          await server.inject({
            method: 'GET',
            url,
            headers: { authorization: `Bearer ${platformSession.accessToken}` },
          })
        ).statusCode,
      ).toBe(503);
  } finally {
    unavailableScope.mockRestore();
  }
  const { CashToCashReconciliationService } = await import(
    '../src/agent/cash-to-cash-reconciliation.service'
  );
  const reconciliation = app.get(CashToCashReconciliationService);
  expect(await reconciliation.lookup(handoffId)).toMatchObject({
    current: { classification: 'CANCELLED_DISPOSITION_PENDING', outstandingLiabilityMinor: '600' },
  });
  await expect(
    db.query(`DELETE FROM cash_to_cash_reconciliation_handoffs WHERE id=$1`, [handoffId]),
  ).rejects.toThrow('immutable');
  const outstandingHandoff = await server.inject({
    method: 'POST',
    url: handoffUrl,
    headers: { authorization: `Bearer ${token}` },
    payload: { transferId, reason: 'UNKNOWN_OUTCOME' },
  });
  expect(outstandingHandoff.statusCode).toBe(201);
  expect(await reconciliation.lookup(outstandingHandoff.json<{ id: string }>().id)).toMatchObject({
    current: { classification: 'OUTSTANDING_FUNDED', outstandingLiabilityMinor: '100' },
  });
  const { AgentCashToCashExpiryService } = await import(
    '../src/agent/agent-cash-to-cash-expiry.service'
  );
  expect(
    await app
      .get(AgentCashToCashExpiryService)
      .expireOne(cancelledId, new Date(Date.now() + 86400000)),
  ).toBe(false);

  expect(
    await db.query(
      `SELECT count(*)::int AS n FROM cash_to_cash_transfers WHERE idempotency_key=ANY($1::text[])`,
      [concurrentKeys],
    ),
  ).toEqual([{ n: 1 }]);
  const { AgentCashToCashService } = await import('../src/agent/agent-cash-to-cash.service');
  const rollbackKey = randomUUID();
  await expect(
    app.get(AgentCashToCashService).execute({
      ...fundingPayload,
      idempotencyKey: rollbackKey,
      amountMinor: '50',
      agentId,
      agentPrincipal: principal,
      _simulateFailureAfterJournal: true,
    }),
  ).rejects.toThrow('Simulated failure after journal');
  expect(
    await db.query(
      `SELECT count(*)::int AS n FROM cash_to_cash_transfers WHERE idempotency_key=$1`,
      [rollbackKey],
    ),
  ).toEqual([{ n: 0 }]);
  expect(
    await db.query(`SELECT count(*)::int AS n FROM ledger_journals WHERE idempotency_key=$1`, [
      `agent:${agentId}:${rollbackKey}`,
    ]),
  ).toEqual([{ n: 0 }]);
  const salt = randomBytes(16);
  const codeHash = `PBKDF2$sha256$10000$${salt.toString('base64url')}$${pbkdf2Sync(transferCode, salt, 10000, 32, 'sha256').toString('base64url')}`;
  sms.clear();
  const issuePayload = {
    customerId,
    transferId,
    redemptionMethod: 'AGENT_CASH',
    purpose: 'CASH_TO_CASH_CLAIM',
  };
  const unauthIssue = await server.inject({
    method: 'POST',
    url: '/api/v1/agents/me/mfa-challenges',
    payload: issuePayload,
  });
  expect([401, 403]).toContain(unauthIssue.statusCode);
  const issued = await server.inject({
    method: 'POST',
    url: '/api/v1/agents/me/mfa-challenges',
    headers: { authorization: `Bearer ${token}` },
    payload: issuePayload,
  });
  expect(issued.statusCode).toBe(201);
  let challenge: { challengeId: string } = issued.json();
  let otp = sms.sent[0]!.message.match(/code is (\d{6})/)![1]!;
  const claim = app.get(AgentCashToCashClaimService);
  // Only the institutional authority is controlled; claim guards remain active.
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
    redemptionMethod: 'AGENT_CASH' as const,
    claimantPrincipal: principal,
    agentPin: '1234',
  };
  try {
    const fundingOther = await ledger.postJournal({
      idempotencyKey: randomUUID(),
      currency: 'NGN',
      lines: [
        { accountId: legacySource.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '100' },
        {
          accountId: legacyUnclaimed[0]!.id,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor: '100',
        },
      ],
    });
    const otherTransferId = randomUUID();
    await db.query(
      `INSERT INTO cash_to_cash_transfers(id,agent_id,beneficiary_phone,principal_minor,total_minor,currency,status,transfer_code_hash,hash_algorithm,journal_id,idempotency_key,expires_at) VALUES($1,$2,$3,100,100,'NGN','UNCLAIMED',$4,'PBKDF2',$5,$6,clock_timestamp()+interval '1 hour')`,
      [otherTransferId, agentId, phone, codeHash, fundingOther.id, randomUUID()],
    );
    const legacyHandoff = await server.inject({
      method: 'POST',
      url: handoffUrl,
      headers: { authorization: `Bearer ${token}` },
      payload: { transferId: otherTransferId, reason: 'EVIDENCE_REVIEW' },
    });
    expect(legacyHandoff.statusCode).toBe(201);
    expect(await reconciliation.lookup(legacyHandoff.json<{ id: string }>().id)).toMatchObject({
      current: {
        classification: 'INCOMPLETE_OR_CONFLICTING',
        outstandingLiabilityMinor: null,
        modern_evidence: false,
      },
    });
    await expect(claim.execute({ ...input, transferId: otherTransferId })).rejects.toThrow(
      'authorization context',
    );
    expect(
      await db.query(`SELECT status FROM mfa_challenges WHERE id=$1`, [challenge.challengeId]),
    ).toEqual([{ status: 'ACTIVE' }]);
    const institution = app.get(CashToCashClaimFinancialContext);
    const contextSpy = jest.spyOn(institution, 'resolve');
    contextSpy.mockResolvedValueOnce({
      institutionId: randomUUID(),
      evidenceFingerprint: 'b'.repeat(64),
    });
    await expect(claim.execute(input)).rejects.toThrow('authorization context');
    contextSpy.mockRejectedValueOnce(new Error('institution suspended'));
    await expect(claim.execute(input)).rejects.toThrow('institution suspended');
    contextSpy.mockRestore();
    const snapshot = snapshots.get(customerId)!;
    snapshot.evidence[0]!.status = 'REVOKED';
    await expect(claim.execute(input)).rejects.toThrow();
    snapshot.evidence[0]!.status = 'VERIFIED';
    await db.query(
      `INSERT INTO kyc_tier_manual_holds(customer_id,actor,reason) VALUES($1,'fixture','MANUAL_REVIEW')`,
      [customerId],
    );
    const { claimantPrincipal: ignoredPrincipal, ...holdRequest } = input;
    void ignoredPrincipal;
    const held = await server.inject({
      method: 'POST',
      url: '/api/v1/agents/cash-to-cash/claim',
      headers: { authorization: `Bearer ${token}` },
      payload: holdRequest,
    });
    expect(held.statusCode).toBeGreaterThanOrEqual(400);
    await db.query(`DELETE FROM kyc_tier_manual_holds WHERE customer_id=$1`, [customerId]);
    expect(
      await db.query(`SELECT status FROM mfa_challenges WHERE id=$1`, [challenge.challengeId]),
    ).toEqual([{ status: 'ACTIVE' }]);
    const wrong = otp === '000000' ? '000001' : '000000';
    await expect(claim.execute({ ...input, otp: wrong })).rejects.toThrow('MISMATCH');
    expect(
      await db.query(`SELECT status,failed_attempts FROM mfa_challenges WHERE id=$1`, [
        challenge.challengeId,
      ]),
    ).toEqual([{ status: 'ACTIVE', failed_attempts: 1 }]);
    const previousChallengeId = challenge.challengeId;
    sms.clear();
    challenge = await app.get(AgentDeskOtpService).issue({
      agentId,
      agentSessionId: deskSession,
      customerId,
      transferId,
      redemptionMethod: 'AGENT_CASH',
      purpose: 'CASH_TO_CASH_CLAIM',
    });
    otp = sms.sent[0]!.message.match(/code is (\d{6})/)![1]!;
    input.mfaChallengeId = challenge.challengeId;
    input.otp = otp;
    expect(
      await db.query(`SELECT status FROM mfa_challenges WHERE id=$1`, [previousChallengeId]),
    ).toEqual([{ status: 'REVOKED' }]);
    expect(
      await db.query(
        `SELECT issuance_count,failed_attempts FROM cash_out_otp_budgets WHERE budget_key=$1`,
        [`customer:${customerId}`],
      ),
    ).toEqual([{ issuance_count: 2, failed_attempts: 1 }]);
    await expect(
      claim.execute({ ...input, mfaChallengeId: previousChallengeId }),
    ).rejects.toThrow();
    await db.query(
      `UPDATE mfa_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,
      [challenge.challengeId],
    );
    await expect(claim.execute(input)).rejects.toThrow('EXPIRED');
    sms.clear();
    challenge = await app.get(AgentDeskOtpService).issue({
      agentId,
      agentSessionId: deskSession,
      customerId,
      transferId,
      redemptionMethod: 'AGENT_CASH',
      purpose: 'CASH_TO_CASH_CLAIM',
    });
    otp = sms.sent[0]!.message.match(/code is (\d{6})/)![1]!;
    input.mfaChallengeId = challenge.challengeId;
    input.otp = otp;
    sms.clear();
    await expect(
      app.get(AgentDeskOtpService).issue({
        agentId,
        agentSessionId: deskSession,
        customerId,
        transferId,
        redemptionMethod: 'AGENT_CASH',
        purpose: 'CASH_TO_CASH_CLAIM',
      }),
    ).rejects.toThrow('temporarily unavailable');
    expect(sms.sent).toHaveLength(0);
    expect(
      await db.query(
        `SELECT issuance_count,failed_attempts FROM cash_out_otp_budgets WHERE budget_key=$1`,
        [`customer:${customerId}`],
      ),
    ).toEqual([{ issuance_count: 3, failed_attempts: 1 }]);

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
    const { claimantPrincipal: _principal, ...httpClaim } = input;
    void _principal;
    const unauthClaim = await server.inject({
      method: 'POST',
      url: '/api/v1/agents/cash-to-cash/claim',
      payload: httpClaim,
    });
    expect([401, 403]).toContain(unauthClaim.statusCode);
    const results = await Promise.all(
      [1, 2].map(() =>
        server.inject({
          method: 'POST',
          url: '/api/v1/agents/cash-to-cash/claim',
          headers: { authorization: `Bearer ${token}` },
          payload: httpClaim,
        }),
      ),
    );
    const successes = results.filter((r) => r.statusCode === 200);
    expect(
      successes.filter((r) => r.json<{ status: string }>().status === 'COMPLETED'),
    ).toHaveLength(1);
    expect(results.every((r) => r.statusCode === 200 || r.statusCode === 409)).toBe(true);
    const duplicate = await server.inject({
      method: 'POST',
      url: '/api/v1/agents/cash-to-cash/claim',
      headers: { authorization: `Bearer ${token}` },
      payload: httpClaim,
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({
      status: 'REPLAYED',
      journalId: successes
        .find((r) => r.json<{ status: string }>().status === 'COMPLETED')!
        .json<{ journalId: string }>().journalId,
    });
    const altered = await server.inject({
      method: 'POST',
      url: '/api/v1/agents/cash-to-cash/claim',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...httpClaim, metadata: { changed: true } },
    });
    expect(altered.statusCode).toBe(409);
    expect(
      await db.query(`SELECT status FROM mfa_challenges WHERE id=$1`, [challenge.challengeId]),
    ).toEqual([{ status: 'VERIFIED' }]);
    const rows = await db.query<Array<{ status: string; claim_journal_id: string }>>(
      `SELECT status,claim_journal_id FROM cash_to_cash_transfers WHERE id=$1`,
      [transferId],
    );
    expect(rows[0]?.status).toBe('CLAIMED');
    expect(
      await db.query(
        `SELECT direction,amount_minor::text FROM ledger_lines WHERE journal_id=$1 AND ledger_account_id=$2`,
        [rows[0]!.claim_journal_id, suspenseAccountId],
      ),
    ).toEqual([{ direction: 'DEBIT', amount_minor: '100' }]);
    expect(
      await db.query(
        `SELECT count(*)::int AS n FROM cash_to_cash_funding_evidence WHERE transfer_id=$1`,
        [transferId],
      ),
    ).toEqual([{ n: 1 }]);
    // A second recipient has independent OTP budget, allowing a genuine claim/cancel race.
    const raceCustomer = await subject('LEVEL_1', ['BVN']);
    await db.query(`UPDATE customers SET status='ACTIVE' WHERE id=$1`, [raceCustomer]);
    const racePhone = `9${randomUUID().replace(/\D/g, '').padEnd(9, '1').slice(0, 9)}`;
    await db.query(
      `UPDATE customer_contact_methods SET value=$2,normalized_value=$2 WHERE customer_id=$1`,
      [raceCustomer, racePhone],
    );
    await db.query(
      `INSERT INTO customer_authentication_credentials(id,customer_id,password_hash,hash_algorithm,password_version,status) VALUES($1,$2,'fixture-hash','PBKDF2',1,'ACTIVE')`,
      [randomUUID(), raceCustomer],
    );
    fundingSubjects.set(agentId, { senderPhone: '8011111111', recipient: racePhone });
    const raceFunding = await server.inject({
      method: 'POST',
      url: '/api/v1/agents/cash-to-cash',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...fundingPayload,
        beneficiaryPhone: racePhone,
        amountMinor: '50',
        idempotencyKey: randomUUID(),
      },
    });
    expect(raceFunding.statusCode).toBe(201);
    const raceTransfer = raceFunding.json<{ transferId: string; transferCode: string }>();
    sms.clear();
    const raceIssue = await server.inject({
      method: 'POST',
      url: '/api/v1/agents/me/mfa-challenges',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        customerId: raceCustomer,
        transferId: raceTransfer.transferId,
        redemptionMethod: 'AGENT_CASH',
        purpose: 'CASH_TO_CASH_CLAIM',
      },
    });
    expect(raceIssue.statusCode).toBe(201);
    const raceOtp = sms.sent[0]!.message.match(/code is (\d{6})/)![1]!;
    const raceChallenge = raceIssue.json<{ challengeId: string }>();
    const [raceClaim, raceCancel] = await Promise.all([
      server.inject({
        method: 'POST',
        url: '/api/v1/agents/cash-to-cash/claim',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          transferId: raceTransfer.transferId,
          beneficiaryPhone: racePhone,
          transferCode: raceTransfer.transferCode,
          customerId: raceCustomer,
          mfaChallengeId: raceChallenge.challengeId,
          otp: raceOtp,
          idempotencyKey: randomUUID(),
          redemptionMethod: 'AGENT_CASH',
          agentPin: '1234',
        },
      }),
      server.inject({
        method: 'POST',
        url: `/api/v1/agents/cash-to-cash/${raceTransfer.transferId}/cancel`,
        headers: { authorization: `Bearer ${token}` },
        payload: { agentPin: '1234' },
      }),
    ]);
    expect(
      [raceClaim.statusCode, raceCancel.statusCode].filter((status) => status === 200),
    ).toHaveLength(1);
    const raced = await db.query<Array<{ status: string; claim_journal_id: string | null }>>(
      `SELECT status,claim_journal_id FROM cash_to_cash_transfers WHERE id=$1`,
      [raceTransfer.transferId],
    );
    expect(['CLAIMED', 'CANCELLED']).toContain(raced[0]!.status);
    expect(raced[0]!.claim_journal_id !== null).toBe(raced[0]!.status === 'CLAIMED');
    expect(
      await db.query(
        `SELECT count(*)::int AS n FROM cash_to_cash_cancellations WHERE transfer_id=$1`,
        [raceTransfer.transferId],
      ),
    ).toEqual([{ n: raced[0]!.status === 'CANCELLED' ? 1 : 0 }]);
    const expiredFunding = await server.inject({
      method: 'POST',
      url: '/api/v1/agents/cash-to-cash',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...fundingPayload,
        beneficiaryPhone: racePhone,
        amountMinor: '25',
        idempotencyKey: randomUUID(),
      },
    });
    expect(expiredFunding.statusCode).toBe(201);
    const expiredId = expiredFunding.json<{ transferId: string }>().transferId;
    const future = new Date(Date.now() + 40 * 86400000);
    expect(await app.get(AgentCashToCashExpiryService).expireOne(expiredId, future)).toBe(true);
    expect(await app.get(AgentCashToCashExpiryService).expireOne(expiredId, future)).toBe(false);
    const expiredHandoff = await server.inject({
      method: 'POST',
      url: handoffUrl,
      headers: { authorization: `Bearer ${token}` },
      payload: { transferId: expiredId, reason: 'DISPOSITION_PENDING' },
    });
    expect(expiredHandoff.statusCode).toBe(201);
    expect(await reconciliation.lookup(expiredHandoff.json<{ id: string }>().id)).toMatchObject({
      current: { classification: 'EXPIRED_DISPOSITION_PENDING', outstandingLiabilityMinor: '25' },
    });
    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/api/v1/agents/cash-to-cash/${expiredId}/cancel`,
          headers: { authorization: `Bearer ${token}` },
          payload: { agentPin: '1234' },
        })
      ).statusCode,
    ).toBe(409);
    const expiryRaceFunding = await server.inject({
      method: 'POST',
      url: '/api/v1/agents/cash-to-cash',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...fundingPayload,
        beneficiaryPhone: racePhone,
        amountMinor: '25',
        idempotencyKey: randomUUID(),
      },
    });
    expect(expiryRaceFunding.statusCode).toBe(201);
    const expiryRaceTransfer = expiryRaceFunding.json<{
      transferId: string;
      transferCode: string;
    }>();
    sms.clear();
    const expiryRaceIssue = await server.inject({
      method: 'POST',
      url: '/api/v1/agents/me/mfa-challenges',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        customerId: raceCustomer,
        transferId: expiryRaceTransfer.transferId,
        redemptionMethod: 'AGENT_CASH',
        purpose: 'CASH_TO_CASH_CLAIM',
      },
    });
    expect(expiryRaceIssue.statusCode).toBe(201);
    const expiryRaceOtp = sms.sent[0]!.message.match(/code is (\d{6})/)![1]!;
    const expiryRaceChallenge = expiryRaceIssue.json<{ challengeId: string }>();
    const [expiryRaceClaim, expiryResult] = await Promise.all([
      server.inject({
        method: 'POST',
        url: '/api/v1/agents/cash-to-cash/claim',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          transferId: expiryRaceTransfer.transferId,
          beneficiaryPhone: racePhone,
          transferCode: expiryRaceTransfer.transferCode,
          customerId: raceCustomer,
          mfaChallengeId: expiryRaceChallenge.challengeId,
          otp: expiryRaceOtp,
          idempotencyKey: randomUUID(),
          redemptionMethod: 'AGENT_CASH',
          agentPin: '1234',
        },
      }),
      app.get(AgentCashToCashExpiryService).expireOne(expiryRaceTransfer.transferId, future),
    ]);
    const expiryRaceRow = await db.query<
      Array<{ status: string; claim_journal_id: string | null }>
    >(`SELECT status,claim_journal_id FROM cash_to_cash_transfers WHERE id=$1`, [
      expiryRaceTransfer.transferId,
    ]);
    expect(['CLAIMED', 'EXPIRED']).toContain(expiryRaceRow[0]!.status);
    expect(expiryResult).toBe(expiryRaceRow[0]!.status === 'EXPIRED');
    expect(expiryRaceClaim.statusCode === 200).toBe(expiryRaceRow[0]!.status === 'CLAIMED');
    expect(expiryRaceRow[0]!.claim_journal_id !== null).toBe(
      expiryRaceRow[0]!.status === 'CLAIMED',
    );
    expect(
      await app.get(AgentCashToCashExpiryService).expireOne(expiryRaceTransfer.transferId, future),
    ).toBe(false);
    const completedHandoff = await server.inject({
      method: 'POST',
      url: handoffUrl,
      headers: { authorization: `Bearer ${token}` },
      payload: { transferId, reason: 'RECEIPT_UNAVAILABLE' },
    });
    expect(completedHandoff.statusCode).toBe(201);
    expect(await reconciliation.lookup(completedHandoff.json<{ id: string }>().id)).toMatchObject({
      current: {
        classification: 'COMPLETED_WITH_EXECUTION_EVIDENCE',
        outstandingLiabilityMinor: '0',
      },
    });
    expect(
      await app
        .get(AgentCashToCashExpiryService)
        .expireOne(transferId, new Date(Date.now() + 86400000)),
    ).toBe(false);
    const cancelClaimed = await server.inject({
      method: 'POST',
      url: `/api/v1/agents/cash-to-cash/${transferId}/cancel`,
      headers: { authorization: `Bearer ${token}` },
      payload: { agentPin: '1234' },
    });
    expect(cancelClaimed.statusCode).toBe(409);
    const httpReceipt = await server.inject({
      method: 'GET',
      url: `/api/v1/agents/cash-to-cash/claims/${transferId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(httpReceipt.statusCode).toBe(200);
    expect(httpReceipt.json()).toMatchObject({
      journalId: rows[0]!.claim_journal_id,
      redemptionMethod: 'AGENT_CASH',
    });
    const receipt = await claim.recoverClaimForAgent(transferId, principal);
    expect(receipt).toMatchObject({
      journalId: rows[0]!.claim_journal_id,
      redemptionMethod: 'AGENT_CASH',
      replayed: true,
    });
    await expect(
      claim.recoverClaimForAgent(transferId, { ...principal, agentId: randomUUID() }),
    ).rejects.toThrow();
    // The actual mobile client uses the protected locator for both challenge and claim.
    // Fastify is real; only network transport and the native storage adapter are simulated.
    const mobile = await import('../apps/agent-mobile/src/services/agent-api');
    const mobileClient = await import('../apps/agent-mobile/src/services/api-client');
    const mobileStorage = await import('../apps/agent-mobile/src/services/secure-storage');
    const mobilePending = await import('../apps/agent-mobile/src/services/pending-operation');
    const mobileCustomer = await subject('LEVEL_1', ['BVN']);
    await db.query(`UPDATE customers SET status='ACTIVE' WHERE id=$1`, [mobileCustomer]);
    const mobilePhone = `7${randomUUID().replace(/\D/g, '').padEnd(9, '1').slice(0, 9)}`;
    await db.query(
      `UPDATE customer_contact_methods SET value=$2,normalized_value=$2 WHERE customer_id=$1`,
      [mobileCustomer, mobilePhone],
    );
    await db.query(
      `INSERT INTO customer_authentication_credentials(id,customer_id,password_hash,hash_algorithm,password_version,status) VALUES($1,$2,'fixture-hash','PBKDF2',1,'ACTIVE')`,
      [randomUUID(), mobileCustomer],
    );
    await db.query(`UPDATE agent_authentication_credentials SET password_hash=$2 WHERE id=$1`, [
      agentCredential,
      pinHash,
    ]);
    fundingSubjects.set(agentId, { senderPhone: '8011111111', recipient: mobilePhone });
    await ledger.postJournal({
      idempotencyKey: randomUUID(),
      currency: 'NGN',
      lines: [
        {
          accountId: await governed.openInstitutionSettlementAccount(c2cInstitutionId),
          direction: LedgerEntryDirection.DEBIT,
          amountMinor: '200',
        },
        {
          accountId: agentFunding.wallet.ledgerAccountId,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor: '200',
        },
      ],
    });
    const mobileFunding = await server.inject({
      method: 'POST',
      url: '/api/v1/agents/cash-to-cash',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...fundingPayload,
        beneficiaryPhone: mobilePhone,
        amountMinor: '100',
        idempotencyKey: randomUUID(),
      },
    });
    expect(mobileFunding.statusCode).toBe(201);
    const mobileTransfer = mobileFunding.json<{
      transferId: string;
      transferCode: string;
      transferNumber: string;
    }>();
    const nativeStore = new Map<string, string>();
    const nativeAdapter = jest.requireMock<{
      getItemAsync: (key: string) => Promise<string | null>;
      setItemAsync: (key: string, value: string) => Promise<void>;
      deleteItemAsync: (key: string) => Promise<void>;
    }>('expo-secure-store');
    nativeAdapter.getItemAsync = (key) => Promise.resolve(nativeStore.get(key) ?? null);
    nativeAdapter.setItemAsync = (key, value) => {
      nativeStore.set(key, value);
      return Promise.resolve();
    };
    nativeAdapter.deleteItemAsync = (key) => {
      nativeStore.delete(key);
      return Promise.resolve();
    };
    const nativePlatform = jest.requireMock<{ Platform: { OS: string } }>('react-native');
    const oldPlatform = nativePlatform.Platform.OS;
    const oldNodeEnv = process.env.NODE_ENV;
    nativePlatform.Platform.OS = 'ios';
    process.env.NODE_ENV = 'production';
    const oldFetch = global.fetch;
    let dropClaim = false;
    let claimPosts = 0;
    let deliveredJournal = '';
    global.fetch = async (url, init) => {
      const path = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url)
        .pathname;
      const headers = Object.fromEntries(
        Object.entries(init?.headers ?? {}).map(([key, value]) => [key, String(value)]),
      );
      const response = await server.inject({
        method: (init?.method ?? 'GET') as 'GET' | 'POST',
        url: path,
        headers,
        payload: typeof init?.body === 'string' ? init.body : undefined,
      });
      if (path === '/api/v1/agents/cash-to-cash/claim-by-number') {
        claimPosts++;
        if (dropClaim) {
          expect(response.statusCode).toBe(200);
          deliveredJournal = response.json<{ journalId: string }>().journalId;
          dropClaim = false;
          throw new Error('Synthetic lost claim response');
        }
      }
      return new Response(response.body, {
        status: response.statusCode,
        headers: { 'content-type': 'application/json' },
      });
    };
    try {
      mobileClient.setBaseUrl('http://mobile-contract.invalid');
      const login = await mobile.agentLogin(agentId, '1234');
      if (!('accessToken' in login)) throw new Error('Agent session not issued');
      await mobileStorage.SecureStorage.set(
        mobileClient.AGENT_SESSION_KEYS.token,
        login.accessToken,
      );
      sms.clear();
      const locator = { senderPhone: '8011111111', transferNumber: mobileTransfer.transferNumber };
      const mobileChallenge = await mobile.requestAgentMfaChallenge(
        mobileCustomer,
        'CASH_TO_CASH_CLAIM',
        undefined,
        { ...locator, redemptionMethod: 'AGENT_CASH' },
      );
      const mobileOtp = sms.sent[0]!.message.match(/code is (\d{6})/)![1]!;
      const identity = {
        agentId,
        ...locator,
        beneficiaryPhone: mobilePhone,
        customerId: mobileCustomer,
        redemptionMethod: 'AGENT_CASH' as const,
        idempotencyKey: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      await mobilePending.savePendingCashToCashLocatorClaim(identity);
      dropClaim = true;
      await expect(
        mobile.agentCashToCashClaimByNumber({
          ...locator,
          beneficiaryPhone: mobilePhone,
          transferCode: mobileTransfer.transferCode,
          customerId: mobileCustomer,
          mfaChallengeId: mobileChallenge.challengeId,
          otp: mobileOtp,
          idempotencyKey: identity.idempotencyKey,
          redemptionMethod: 'AGENT_CASH',
          agentPin: '1234',
        }),
      ).rejects.toMatchObject({ name: 'NetworkError' });
      const rawPending = nativeStore.get(`pending_c2c_locator_claim.${agentId}`)!;
      expect(JSON.parse(rawPending)).toEqual(identity);
      expect(rawPending).not.toContain(mobileTransfer.transferCode);
      expect(rawPending).not.toContain(mobileOtp);
      expect(JSON.parse(rawPending)).not.toHaveProperty('agentPin');
      expect(JSON.parse(rawPending)).not.toHaveProperty('otp');
      expect(JSON.parse(rawPending)).not.toHaveProperty('transferCode');
      let restarted: typeof MobilePending | undefined;
      jest.isolateModules(() => {
        restarted = jest.requireActual<typeof MobilePending>(
          '../apps/agent-mobile/src/services/pending-operation',
        );
      });
      if (!restarted) throw new Error('Mobile restart failed');
      const afterRestart = await restarted.loadPendingCashToCashLocatorClaim(agentId);
      expect(afterRestart).toEqual(identity);
      await mobile.agentLogout();
      await mobileClient.purgeAgentSessionFromStorage();
      const loginAgain = await mobile.agentLogin(agentId, '1234');
      if (!('accessToken' in loginAgain)) throw new Error('Agent session not issued');
      expect(loginAgain.sessionId).not.toBe(login.sessionId);
      await mobileStorage.SecureStorage.set(
        mobileClient.AGENT_SESSION_KEYS.token,
        loginAgain.accessToken,
      );
      await mobileStorage.SecureStorage.set(mobileClient.AGENT_SESSION_KEYS.token, otherToken);
      await expect(
        mobile.recoverAgentCashToCashClaimByNumber({
          ...locator,
          idempotencyKey: afterRestart!.idempotencyKey,
        }),
      ).rejects.toMatchObject({ status: 404 });
      await mobileStorage.SecureStorage.set(
        mobileClient.AGENT_SESSION_KEYS.token,
        loginAgain.accessToken,
      );
      const recovered = await mobile.recoverAgentCashToCashClaimByNumber({
        ...locator,
        idempotencyKey: afterRestart!.idempotencyKey,
      });
      expect(recovered).toMatchObject({
        transferId: mobileTransfer.transferId,
        journalId: deliveredJournal,
        idempotencyKey: identity.idempotencyKey,
        redemptionMethod: 'AGENT_CASH',
      });
      expect(claimPosts).toBe(1);
      expect(sms.sent).toHaveLength(1);
      expect(
        await db.query(`SELECT count(*)::int AS n FROM ledger_journals WHERE id=$1`, [
          deliveredJournal,
        ]),
      ).toEqual([{ n: 1 }]);
      expect(await mobilePending.loadPendingCashToCashLocatorClaim(randomUUID())).toBeNull();
      await mobilePending.clearPendingCashToCashLocatorClaim(agentId);
    } finally {
      global.fetch = oldFetch;
      nativePlatform.Platform.OS = oldPlatform;
      process.env.NODE_ENV = oldNodeEnv;
    }
    await db.query(
      `UPDATE agent_authentication_sessions SET status='REVOKED',revoked_at=clock_timestamp() WHERE id=$1`,
      [deskSession],
    );
    await expect(claim.recoverClaimForAgent(transferId, principal)).rejects.toThrow('revoked');
    const replacementSession = randomUUID();
    await db.query(
      `INSERT INTO agent_authentication_sessions(id,agent_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at) VALUES($1,$2,$3,$4,'agent-api','ACTIVE',clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp())`,
      [replacementSession, agentId, agentCredential, randomBytes(32).toString('hex')],
    );
    expect(
      await claim.recoverClaimForAgent(transferId, { ...principal, sessionId: replacementSession }),
    ).toMatchObject({ journalId: receipt.journalId, requestHash: receipt.requestHash });
    expect(
      await db.query(`SELECT count(*)::int AS n FROM ledger_lines WHERE journal_id=$1`, [
        rows[0]!.claim_journal_id,
      ]),
    ).toEqual([{ n: 2 }]);
  } finally {
    ledgerSpy.mockRestore();
  }
}, 120_000);

test('claim failures remain budgeted across replacement challenges', async () => {
  const { AgentDeskOtpService } = await import('../src/agent/agent-desk-otp.service');
  const { AgentCashToCashClaimService } = await import(
    '../src/agent/agent-cash-to-cash-claim.service'
  );
  const customerId = await subject('LEVEL_1', ['BVN']);
  await db.query(`UPDATE customers SET status='ACTIVE' WHERE id=$1`, [customerId]);
  await db.query(
    `INSERT INTO customer_authentication_credentials(id,customer_id,password_hash,hash_algorithm,password_version,status) VALUES($1,$2,'fixture-hash','PBKDF2',1,'ACTIVE')`,
    [randomUUID(), customerId],
  );
  const context = await claimOtpFixture(customerId);
  const principal = {
    type: 'AGENT' as const,
    agentId: context.agentId,
    principalId: context.agentId,
    sessionId: context.agentSessionId,
    roles: [],
    scopes: [],
    customerAccess: 'NONE' as const,
    agentAccess: 'SELF' as const,
  };
  const issuer = app.get(AgentDeskOtpService),
    claim = app.get(AgentCashToCashClaimService);
  let lastChallenge = '',
    lastCode = '';
  for (const count of [2, 2, 1]) {
    sms.clear();
    const challenge = await issuer.issue(context);
    const code = sms.sent[0]!.message.match(/code is (\d{6})/)![1]!;
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < count; i++) {
      await expect(
        claim.execute({
          transferId: context.transferId,
          beneficiaryPhone: context.phone,
          transferCode: context.transferCode,
          customerId,
          mfaChallengeId: challenge.challengeId,
          otp: wrong,
          idempotencyKey: randomUUID(),
          redemptionMethod: 'CUSTOMER_WALLET',
          claimantPrincipal: principal,
        }),
      ).rejects.toThrow('MISMATCH');
    }
    lastChallenge = challenge.challengeId;
    lastCode = code;
  }
  expect(
    await db.query(
      `SELECT issuance_count,failed_attempts FROM cash_out_otp_budgets WHERE budget_key=$1`,
      [`customer:${customerId}`],
    ),
  ).toEqual([{ issuance_count: 3, failed_attempts: 5 }]);
  await expect(
    claim.execute({
      transferId: context.transferId,
      beneficiaryPhone: context.phone,
      transferCode: context.transferCode,
      customerId,
      mfaChallengeId: lastChallenge,
      otp: lastCode,
      idempotencyKey: randomUUID(),
      redemptionMethod: 'CUSTOMER_WALLET',
      claimantPrincipal: principal,
    }),
  ).rejects.toThrow('temporarily unavailable');
  await expect(issuer.issue(context)).rejects.toThrow('temporarily unavailable');
  expect(
    await db.query(`SELECT status,claim_journal_id FROM cash_to_cash_transfers WHERE id=$1`, [
      context.transferId,
    ]),
  ).toEqual([{ status: 'UNCLAIMED', claim_journal_id: null }]);
});

test('historical 0201 to 0205 upgrades preserve funded, claim, cancellation and handoff evidence', async () => {
  const { readdirSync } = await import('node:fs');
  const path = await import('node:path');
  const historicalName = `kyc_upgrade_${randomUUID().replace(/-/g, '')}`;
  await admin.query(`CREATE DATABASE "${historicalName}"`);
  let historical: DataSource | undefined;
  const migrationFiles = readdirSync(path.join(__dirname, '../src/migrations'))
    .filter((file) => /^1785753600\d{3}-.*\.ts$/.test(file))
    .sort();
  const openAt = async (last: string) => {
    if (historical?.isInitialized) await historical.destroy();
    historical = new DataSource({
      type: 'postgres',
      host: socket,
      port: cluster.port,
      username: 'kyc_synthetic',
      database: historicalName,
      synchronize: false,
      migrationsRun: false,
      migrationsTableName: 'typeorm_migrations',
      entities: [],
      migrations: migrationFiles
        .filter((file) => file.slice(0, 13) <= last)
        .map((file) => path.join(__dirname, '../src/migrations', file)),
    });
    await historical.initialize();
    return historical;
  };
  try {
    let h = await openAt('1785753600201');
    await h.runMigrations({ transaction: 'all' });
    const agent = randomUUID(),
      customer = randomUUID(),
      credential = randomUUID(),
      session = randomUUID();
    const outstanding = randomUUID(),
      claimed = randomUUID(),
      funding1 = randomUUID(),
      funding2 = randomUUID(),
      claimJournal = randomUUID();
    await h.query(`INSERT INTO agents(id,reference,status) VALUES($1,$2,'ACTIVE')`, [agent, agent]);
    await h.query(
      `INSERT INTO customers(id,reference,customer_type,status,kyc_level,kyc_status) VALUES($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`,
      [customer, customer],
    );
    await h.query(
      `INSERT INTO agent_authentication_credentials(id,agent_id,password_hash,hash_algorithm,password_version,status) VALUES($1,$2,'fixture','PBKDF2',1,'ACTIVE')`,
      [credential, agent],
    );
    await h.query(
      `INSERT INTO agent_authentication_sessions(id,agent_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at) VALUES($1,$2,$3,$4,'agent-api','ACTIVE',clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp())`,
      [session, agent, credential, 'a'.repeat(64)],
    );
    const liability = (
      await h.query<Array<{ id: string }>>(
        `SELECT id FROM ledger_accounts WHERE code='CASH_TO_CASH-UNCLAIMED-NGN'`,
      )
    )[0]!.id;
    const asset = randomUUID();
    await h.query(
      `INSERT INTO ledger_accounts(id,code,name,account_type,normal_balance,currency,allow_negative_balance) VALUES($1,$2,'historical fixture','ASSET','DEBIT','NGN',true)`,
      [asset, asset],
    );
    await h.transaction(async (manager) => {
      for (const id of [funding1, funding2, claimJournal]) {
        await manager.query(
          `INSERT INTO ledger_journals(id,idempotency_key,request_hash,currency,total_minor) VALUES($1,$2,$3,'NGN',100)`,
          [id, id, 'a'.repeat(64)],
        );
        const claimedLine = id === claimJournal;
        await manager.query(
          `INSERT INTO ledger_lines(id,journal_id,ledger_account_id,line_number,direction,amount_minor,currency,accounting_unit) VALUES($1,$2,$3,1,$4,100,'NGN','CUSTOMER_FUNDS'),($5,$2,$6,2,$7,100,'NGN','CUSTOMER_FUNDS')`,
          [
            randomUUID(),
            id,
            liability,
            claimedLine ? 'DEBIT' : 'CREDIT',
            randomUUID(),
            asset,
            claimedLine ? 'CREDIT' : 'DEBIT',
          ],
        );
      }
    });
    await h.query(
      `INSERT INTO cash_to_cash_transfers(id,agent_id,beneficiary_phone,principal_minor,total_minor,currency,status,transfer_code_hash,hash_algorithm,journal_id,idempotency_key,expires_at) VALUES($1,$2,'8011111111',100,100,'NGN','UNCLAIMED','historical-hash','PBKDF2',$3,$4,clock_timestamp()+interval '1 day')`,
      [outstanding, agent, funding1, randomUUID()],
    );
    await h.query(
      `INSERT INTO cash_to_cash_transfers(id,agent_id,beneficiary_phone,principal_minor,total_minor,currency,status,transfer_code_hash,hash_algorithm,journal_id,idempotency_key,expires_at,claimed_at,claimant_customer_id,claim_journal_id,claim_idempotency_key) VALUES($1,$2,'8011111111',100,100,'NGN','CLAIMED','historical-hash','PBKDF2',$3,$4,clock_timestamp()+interval '1 day',clock_timestamp(),$5,$6,$7)`,
      [claimed, agent, funding2, randomUUID(), customer, claimJournal, randomUUID()],
    );
    await h.query(
      `INSERT INTO audit_events(entity_type,entity_id,action,actor,new_values) VALUES('AGENT_CASH_TO_CASH_CLAIM',$1,'CASH_TO_CASH_CLAIMED',$2,$3::jsonb)`,
      [
        claimJournal,
        agent,
        JSON.stringify({ redemptionMethod: 'CUSTOMER_WALLET', requestHash: 'historical' }),
      ],
    );
    const cashoutHandoff = randomUUID();
    await h.query(
      `INSERT INTO cash_out_reconciliation_handoffs(id,agent_id,operation_key,reason,evidence) VALUES($1,$2,$3,'UNKNOWN_OUTCOME','{"status":"UNKNOWN"}')`,
      [cashoutHandoff, agent, randomUUID()],
    );
    let originalTransfers = await h.query<Array<Record<string, unknown>>>(
      `SELECT * FROM cash_to_cash_transfers ORDER BY id`,
    );
    const originalJournals = await h.query<Array<Record<string, unknown>>>(
      `SELECT * FROM ledger_journals ORDER BY id`,
    );
    const originalLines = await h.query<Array<Record<string, unknown>>>(
      `SELECT * FROM ledger_lines ORDER BY id`,
    );
    const originalAudit = await h.query<Array<Record<string, unknown>>>(
      `SELECT * FROM audit_events WHERE entity_id=$1`,
      [claimJournal],
    );
    const originalCashout = await h.query<Array<Record<string, unknown>>>(
      `SELECT * FROM cash_out_reconciliation_handoffs WHERE id=$1`,
      [cashoutHandoff],
    );
    const { ProductionReadinessService } = await import(
      '../src/production/production-readiness.service'
    );
    const readiness = (source: DataSource) =>
      new ProductionReadinessService(source, {
        runReconciliation: () => Promise.resolve({ status: 'PASS' }),
      } as never);
    expect((await readiness(h).getReadiness()).migrations.compatible).toBe(false);
    let savedCancellation: Array<Record<string, unknown>> = [];
    let savedHandoff: Array<Record<string, unknown>> = [];
    for (const last of ['1785753600202', '1785753600203', '1785753600204', '1785753600205']) {
      h = await openAt(last);
      const applied = await h.runMigrations({ transaction: 'all' });
      expect(applied.map((item) => String(item.timestamp))).toEqual([last]);
      expect(
        await h.query<Array<Record<string, unknown>>>(
          `SELECT * FROM cash_to_cash_transfers ORDER BY id`,
        ),
      ).toEqual(originalTransfers);
      expect(
        await h.query<Array<Record<string, unknown>>>(`SELECT * FROM ledger_journals ORDER BY id`),
      ).toEqual(originalJournals);
      expect(
        await h.query<Array<Record<string, unknown>>>(`SELECT * FROM ledger_lines ORDER BY id`),
      ).toEqual(originalLines);
      expect(
        await h.query<Array<Record<string, unknown>>>(
          `SELECT * FROM audit_events WHERE entity_id=$1`,
          [claimJournal],
        ),
      ).toEqual(originalAudit);
      expect(
        await h.query(`SELECT * FROM cash_out_reconciliation_handoffs WHERE id=$1`, [
          cashoutHandoff,
        ]),
      ).toEqual(originalCashout);
      expect(await h.query(`SELECT count(*)::int AS n FROM cash_to_cash_funding_evidence`)).toEqual(
        [{ n: 0 }],
      );
      if (last === '1785753600203') {
        await h.transaction(async (manager) => {
          await manager.query(`UPDATE cash_to_cash_transfers SET status='CANCELLED' WHERE id=$1`, [
            outstanding,
          ]);
          await manager.query(
            `INSERT INTO cash_to_cash_cancellations(transfer_id,agent_id,session_id) VALUES($1,$2,$3)`,
            [outstanding, agent, session],
          );
        });
        originalTransfers = await h.query<Array<Record<string, unknown>>>(
          `SELECT * FROM cash_to_cash_transfers ORDER BY id`,
        );
        savedCancellation = await h.query<Array<Record<string, unknown>>>(
          `SELECT * FROM cash_to_cash_cancellations`,
        );
      }
      if (last === '1785753600204') {
        await h.query(
          `INSERT INTO cash_to_cash_reconciliation_handoffs(id,transfer_id,agent_id,reason,evidence) VALUES($1,$2,$3,'EVIDENCE_REVIEW','{"historical":true}')`,
          [randomUUID(), outstanding, agent],
        );
        savedHandoff = await h.query<Array<Record<string, unknown>>>(
          `SELECT * FROM cash_to_cash_reconciliation_handoffs`,
        );
      }
      if (last >= '1785753600204') {
        expect(
          await h.query<Array<Record<string, unknown>>>(`SELECT * FROM cash_to_cash_cancellations`),
        ).toEqual(savedCancellation);
      }
      if (last === '1785753600205')
        expect(
          await h.query<Array<Record<string, unknown>>>(
            `SELECT * FROM cash_to_cash_reconciliation_handoffs`,
          ),
        ).toEqual(savedHandoff);
      if (last >= '1785753600204')
        expect(
          await h.query(
            `SELECT count(*)::int AS n FROM cash_to_cash_cancellations WHERE transfer_id=$1`,
            [outstanding],
          ),
        ).toEqual([{ n: 1 }]);
      if (last === '1785753600205')
        expect(
          await h.query(
            `SELECT evidence FROM cash_to_cash_reconciliation_handoffs WHERE transfer_id=$1`,
            [outstanding],
          ),
        ).toEqual([{ evidence: { historical: true } }]);
    }
    expect(await h.showMigrations()).toBe(false);
    // Under the consolidated inventory a database migrated only to 0205 is *not* schema
    // compatible: the institutional and protected-authority migrations are still missing, and
    // readiness must say so rather than accept the old Arena 2 head as the target schema.
    const consolidated = (await readiness(h).getReadiness()).migrations;
    expect(consolidated).toMatchObject({
      compatible: false,
      latestTimestamp: '1785753600205',
      latestName: 'CashToCashOperationHandoffs1785753600205',
    });
    // This fixture builds its DataSource from the pre-institutional files only, so `missing` is
    // legitimately empty; incompatibility comes from the head not being the consolidated target.
    expect(consolidated.missing).toEqual([]);
    expect(
      await h.query(
        `SELECT timestamp::text,name FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 1`,
      ),
    ).toEqual([{ timestamp: '1785753600205', name: 'CashToCashOperationHandoffs1785753600205' }]);
  } finally {
    if (historical?.isInitialized) await historical.destroy();
    await admin.query(`DROP DATABASE "${historicalName}" WITH (FORCE)`);
  }
}, 120_000);
test('fully migrated AppModule does not claim financial readiness without production dependencies', async () => {
  const { ProductionReadinessService } = await import(
    '../src/production/production-readiness.service'
  );
  const readiness = await app.get(ProductionReadinessService).getReadiness();
  expect(readiness.migrations.compatible).toBe(true);
  expect(readiness.status).toBe('error');
  expect(readiness.financialDependencies.blockers).toContain(
    'trusted_kyc_provider_activation_unverified',
  );
  await expect(app.get(ProductionReadinessService).verifyStartup()).rejects.toThrow();
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
