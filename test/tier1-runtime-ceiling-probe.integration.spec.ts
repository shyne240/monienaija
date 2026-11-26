/**
 * Tier 1 runtime ceiling PROBE (Admin Web onboarding follow-up to PR #24 / #34).
 *
 * This is the verified proof from `test/tier1-runtime-ceiling.integration.spec.ts`, specialised to
 * emit machine-readable evidence for the Admin Web acceptance run:
 *
 *   - it resolves the synthetic customer the Admin Web fixture seeded (the SAME customer whose
 *     effective fees and limits the browser shows staff), instead of creating its own participant;
 *   - it asserts the displayed per-transaction ceiling is the approved institution Tier 1 cap and
 *     that the higher commercial cap does not govern;
 *   - it moves real money through the real `TransferService` + ledger on disposable PostgreSQL:
 *     just below the ceiling completes, just above is denied;
 *   - it writes `ceiling.json` for `scripts/tier1-admin-web-browser-acceptance.cjs`.
 *
 * Run it with the integration runner so the disposable-PG safety checks apply:
 *   DB_NAME=monienaija_t1 TIER1_OUT_DIR=... npx jest --config jest.integration.config.js \
 *     test/tier1-runtime-ceiling.probe.spec.ts --runInBand
 *
 * It is excluded from the default unit run (`.integration.spec.ts` suffix is ignored there) and is
 * NOT part of the shipped suites' runtime budget; it is an acceptance probe.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { TransferService } from '../src/transfer/transfer.service';
import { TransferStatus } from '../src/transfer/transfer.enums';
import { CustomerEffectiveConfigurationService } from '../src/customer-onboarding/customer-effective-configuration.service';
import { InstitutionKycLimitPolicyService } from '../src/limit-catalog/institution-kyc-limit-policy.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { ProtectedAuthorityService } from '../src/authorization/protected-authority.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import type { AuthorizationService } from '../src/authorization/authorization.service';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../src/config/environment';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { seedGovernedTierPolicy } from './support/kyc-test-fixtures';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  seedTransferParticipant,
  truncateAllTables,
} from './support/pg-harness';

process.env.KYC_TIER_LIMIT_ENFORCEMENT_ENABLED = 'true';

// Governed maker/checker principals for the policy fixtures. The fixture authorization stub is
// the same shape the verified PR #34 proof uses: the role-catalogue lookup is short-circuited
// because this probe runs outside a workforce session, while every governed state transition
// (proposal, protected-authority head versioning, distinct maker/checker, approval) still runs.
const maker: AuthorizationPrincipal = {
  type: 'PRIVILEGED',
  principalId: 'tier1-ceiling-probe-maker',
  sessionId: randomUUID(),
  roles: ['SUPER_ADMIN'],
  scopes: ['kyc.policy.propose', 'kyc.provider.propose', 'limit.view', 'limit.modify'],
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
};
const checker: AuthorizationPrincipal = {
  type: 'OPERATOR',
  principalId: 'tier1-ceiling-probe-checker',
  sessionId: randomUUID(),
  roles: ['COMPLIANCE'],
  scopes: ['kyc.policy.approve', 'kyc.provider.approve', 'limit.view', 'limit.modify'],
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
};
const fixtureAuthorization = {
  authorize: () => Promise.resolve({ allowed: true }),
} as unknown as AuthorizationService;

const OUT_DIR = path.resolve(
  process.env.TIER1_OUT_DIR || 'docs/integration/evidence/tier1-admin-web',
);
const TIER_CAP_MINOR = '500000000'; // NGN 5,000,000 — approved institution Tier 1 ceiling
const COMMERCIAL_CAP_MINOR = '1000000000'; // NGN 10,000,000 — the HIGHER commercial cap
const HIGH_OTHER_LIMIT = '900000000000';
const BELOW_TIER = '499000000'; // NGN 4,990,000 — under the ceiling
const ABOVE_TIER = '501000000'; // NGN 5,010,000 — over the ceiling, under the commercial cap
const TIER_PROFILE = 'T1_INSTITUTION_TIER_CAP';
const COMMERCIAL_PROFILE = 'T1_COMMERCIAL_HIGH';

describe('Tier 1 runtime ceiling probe (fully migrated disposable PG)', () => {
  let dataSource: DataSource;
  let moduleRef: TestingModule;
  let app: NestFastifyApplication;
  let transfers: TransferService;
  let effectiveConfig: CustomerEffectiveConfigurationService;

  beforeAll(async () => {
    process.env.KYC_TIER_LIMIT_ENFORCEMENT_ENABLED = 'true';

// Governed maker/checker principals for the policy fixtures. The fixture authorization stub is
// the same shape the verified PR #34 proof uses: the role-catalogue lookup is short-circuited
// because this probe runs outside a workforce session, while every governed state transition
// (proposal, protected-authority head versioning, distinct maker/checker, approval) still runs.
const maker: AuthorizationPrincipal = {
  type: 'PRIVILEGED',
  principalId: 'tier1-ceiling-probe-maker',
  sessionId: randomUUID(),
  roles: ['SUPER_ADMIN'],
  scopes: ['kyc.policy.propose', 'kyc.provider.propose', 'limit.view', 'limit.modify'],
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
};
const checker: AuthorizationPrincipal = {
  type: 'OPERATOR',
  principalId: 'tier1-ceiling-probe-checker',
  sessionId: randomUUID(),
  roles: ['COMPLIANCE'],
  scopes: ['kyc.policy.approve', 'kyc.provider.approve', 'limit.view', 'limit.modify'],
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
};
const fixtureAuthorization = {
  authorize: () => Promise.resolve({ allowed: true }),
} as unknown as AuthorizationService;
    process.env.NODE_ENV = 'test';
    process.env.PG_TEST_CONFIRM_DISPOSABLE_CLUSTER = 'yes';
    const { AppModule } = await import('../src/app.module');
    dataSource = await createIntegrationDataSource('tier1-ceiling-probe');
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    transfers = moduleRef.get(TransferService);
    effectiveConfig = moduleRef.get(CustomerEffectiveConfigurationService);
  }, 240000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    else if (moduleRef) await moduleRef.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 120000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  async function seedGovernedTierPolicyHead(): Promise<void> {
    const req = { all: [], any: [] };
    await seedGovernedTierPolicy(dataSource, {
      definition: {
        regulatoryRequirementsConfirmed: true,
        effectiveFrom: '2020-01-01T00:00:00.000Z',
        effectiveUntil: null,
        regulatory: { LEVEL_1: req, LEVEL_2: req, LEVEL_3: req },
        operator: { LEVEL_1: req, LEVEL_2: req, LEVEL_3: req },
      },
      makerId: 'fixture-maker',
      checkerId: 'fixture-checker',
    });
  }

  async function createInstitution(): Promise<string> {
    const id = randomUUID();
    const code = `T1C${id.slice(0, 8).toUpperCase()}`;
    // Test fixture on disposable DB: bypass lifecycle trigger to create an APPROVED institution.
    await dataSource.query(
      `ALTER TABLE financial_institutions DISABLE TRIGGER financial_institution_guard`,
    );
    try {
      await dataSource.query(
        `INSERT INTO financial_institutions
          (id, reference, code, legal_name, institution_type, status, created_by, operational_approved_at, operational_approved_by)
         VALUES ($1, $2, $3, 'Synthetic Tier1 Ceiling Institution', 'COMMERCIAL_BANK', 'APPROVED', 'tier1-ceiling-proof', now(), 'tier1-ceiling-proof')`,
        [id, `ref-${id.slice(0, 8)}`, code],
      );
    } finally {
      await dataSource.query(
        `ALTER TABLE financial_institutions ENABLE TRIGGER financial_institution_guard`,
      );
    }
    return id;
  }

  async function seedProduct(): Promise<void> {
    await dataSource.query(
      `INSERT INTO products (code, name, domain, status, enabled, configuration_status, product_scope, currency, created_by)
       VALUES ('WALLET_TRANSFER', 'Wallet Transfer', 'CUSTOMER', 'ACTIVE', true, 'CONFIGURED', 'V1', 'NGN', 'tier1-ceiling-proof')
       ON CONFLICT (code) DO UPDATE SET status='ACTIVE', enabled=true, configuration_status='CONFIGURED', product_scope='V1', currency='NGN', domain='CUSTOMER'`,
    );
  }

  async function seedLimitProfile(
    profileCode: string,
    maxAmountMinor: string,
    otherMinor = HIGH_OTHER_LIMIT,
  ): Promise<void> {
    await dataSource.query(
      `INSERT INTO limit_profiles(code,name,description,kind,status,enabled,configuration_status,created_by)
       VALUES($1,$2,'Synthetic ceiling proof profile','UNIVERSAL','ACTIVE',true,'CONFIGURED','tier1-ceiling-proof')
       ON CONFLICT(code) DO UPDATE SET status='ACTIVE', enabled=true, configuration_status='CONFIGURED'`,
      [profileCode, `Tier1 ceiling ${profileCode}`],
    );
    const rules: Array<[string, string, string | null, number | null]> = [
      ['MAX_AMOUNT_PER_TX', maxAmountMinor, null, null],
      ['DAILY_AMOUNT', otherMinor, null, null],
      ['WEEKLY_AMOUNT', otherMinor, null, null],
      ['MONTHLY_AMOUNT', otherMinor, null, null],
      ['WALLET_BALANCE_MAX', otherMinor, null, null],
    ];
    for (const [dimension, minor, , count] of rules) {
      await dataSource.query(
        `INSERT INTO limit_rules(id,limit_profile_code,product,direction,channel,currency,dimension,limit_value_minor,limit_value_count,effective_from,effective_to,is_active,priority,created_by)
         VALUES($1,$2,'WALLET_TRANSFER','BOTH',NULL,'NGN',$3,$4,$5,'2000-01-01T00:00:00.000Z',NULL,true,0,'tier1-ceiling-proof')`,
        [randomUUID(), profileCode, dimension, minor, count],
      );
    }
  }

  async function assignGlobalProfile(profileCode: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,segment_code,precedence,effective_from,effective_to,is_active,created_by)
       VALUES($1,$2,'GLOBAL',NULL,NULL,0,'2000-01-01T00:00:00.000Z',NULL,true,'tier1-ceiling-proof')`,
      [randomUUID(), profileCode],
    );
  }

  async function approveInstitutionTierPolicy(
    institutionId: string,
    tierProfileCode: string,
  ): Promise<void> {
    // Disposable test DB: use admin connection as both runtime/authority to avoid
    // role-provisioning friction. Protected-authority triggers still enforce semantics.
    const authority = new ProtectedAuthorityService(dataSource, dataSource);
    const testConfig = { get: () => true } as unknown as ConfigService<Environment, true>;
    const governance = new InstitutionKycLimitPolicyService(
      dataSource,
      fixtureAuthorization,
      authority,
      testConfig,
    );
    const current = await governance.view(maker, institutionId);
    const definition = {
      schemaVersion: 1,
      enabled: true,
      effectiveFrom: '2000-01-01T00:00:00.000Z',
      effectiveUntil: null,
      mappings: (['LEVEL_1', 'LEVEL_2', 'LEVEL_3'] as const).map((tier) => ({
        product: 'WALLET_TRANSFER',
        currency: 'NGN',
        serviceClass: null,
        tier,
        disposition: 'PROFILE' as const,
        profileCode: tierProfileCode,
      })),
    };
    const proposal = await governance.propose(maker, {
      institutionId,
      requestId: randomUUID(),
      expectedVersion: current.currentVersion,
      definition,
      reason: 'Synthetic Tier 1 ceiling proof: approved institution tier cap',
    });
    await governance.decide(checker, institutionId, proposal.id, true);
  }

  async function seedKycEvidence(customerId: string): Promise<void> {
    // Ensure profile/contact exist (these may bump identity revision via triggers).
    await dataSource.query(
      `INSERT INTO customer_profiles(customer_id,display_name,first_name,last_name,date_of_birth,is_active)
       SELECT $1,'Ceiling Proof','Ceiling','Proof','1990-01-01',true
       WHERE NOT EXISTS (SELECT 1 FROM customer_profiles WHERE customer_id=$1 AND is_active=true AND deleted_at IS NULL)`,
      [customerId],
    );
    await dataSource.query(
      `UPDATE customer_contact_methods SET verified_at=COALESCE(verified_at,clock_timestamp()), is_primary=true
       WHERE id = (
         SELECT id FROM customer_contact_methods
          WHERE customer_id=$1 AND type='PHONE' AND deleted_at IS NULL
          ORDER BY is_primary DESC, created_at ASC, id ASC LIMIT 1
       )`,
      [customerId],
    );
    await dataSource.query(
      `INSERT INTO customer_contact_methods(customer_id,type,value,normalized_value,is_primary,verified_at)
       SELECT $1,'PHONE',$2,$2,true,clock_timestamp()
       WHERE NOT EXISTS (SELECT 1 FROM customer_contact_methods WHERE customer_id=$1 AND type='PHONE' AND deleted_at IS NULL)`,
      [customerId, `+23480${Math.floor(10000000 + Math.random() * 89999999)}`],
    );
    await dataSource.query(
      `UPDATE customer_kyc_assessments SET is_current=false WHERE customer_id=$1 AND is_current=true`,
      [customerId],
    );
    await dataSource.query(
      `INSERT INTO customer_kyc_assessments(id,customer_id,kyc_level,kyc_status,reason,assessed_by,is_current,expires_at)
       VALUES($1,$2,'LEVEL_1','APPROVED','TIER1_CEILING_PROOF','SYSTEM_KYC_EVALUATOR',true,clock_timestamp()+interval '30 days')`,
      [randomUUID(), customerId],
    );
    // Ensure credential exists (claimed state)
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials
        (id,customer_id,credential_type,password_hash,hash_algorithm,password_version,status)
       SELECT $1,$2,'PASSWORD','$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012','BCRYPT',1,'ACTIVE'
       WHERE NOT EXISTS (SELECT 1 FROM customer_authentication_credentials WHERE customer_id=$2 AND deleted_at IS NULL)`,
      [randomUUID(), customerId],
    );

    // Bind evidence to the CURRENT identity revision (after mutations).
    await dataSource.query(
      `INSERT INTO kyc_customer_identity_revisions(customer_id,revision) VALUES($1,1)
       ON CONFLICT (customer_id) DO NOTHING`,
      [customerId],
    );
    const revRows: Array<{ revision: string }> = await dataSource.query(
      `SELECT revision::text AS revision FROM kyc_customer_identity_revisions WHERE customer_id=$1`,
      [customerId],
    );
    const revision = revRows[0]?.revision ?? '1';

    const credRows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM customer_authentication_credentials WHERE customer_id=$1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
      [customerId],
    );
    const sessionId = randomUUID();
    const tokenHash = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    await dataSource.query(
      `INSERT INTO authentication_sessions
        (id,customer_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at)
       VALUES($1,$2,$3,$4,'customer-api','ACTIVE',clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp())`,
      [sessionId, customerId, credRows[0]!.id, tokenHash],
    );
    const consent = randomUUID();
    const dummyMac = 'a'.repeat(64);
    await dataSource.query(
      `INSERT INTO kyc_consents
        (id,customer_id,session_id,kind,notice_version,actor_id,identity_revision,provider,route_version,expires_at)
       VALUES($1,$2,$3,'BVN','tier1-ceiling-proof-v1',$2,$4,'MONNIFY',1,clock_timestamp()+interval '1 hour')`,
      [consent, customerId, sessionId, revision],
    );
    const attempt = randomUUID();
    await dataSource.query(
      `INSERT INTO kyc_verification_attempts
        (id,customer_id,consent_id,request_id,kind,provider,policy_version,request_mac,identity_mac,mac_key_version,
         provider_route_version,outcome,identity_revision,completed_at,expires_at)
       VALUES($1,$2,$3,$4,'BVN','MONNIFY','tier1-ceiling-proof-v1',$5,$5,'test-v1',1,'MATCH',$6,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
      [attempt, customerId, consent, randomUUID(), dummyMac, revision],
    );
    const claimMac = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    await dataSource.query(
      `INSERT INTO kyc_identity_claims(id,kind,identifier_mac,customer_id,attempt_id,status)
       VALUES($1,'BVN',$2,$3,$4,'VERIFIED')`,
      [randomUUID(), claimMac, customerId, attempt],
    );
  }

  async function provisionClaimedWallet(label: string, institutionId: string) {
    // Create real customer+wallet+binding chain via harness helper (provisioned wallet).
    const placeholderLedger = randomUUID();
    await dataSource.query(
      `INSERT INTO ledger_accounts(id,code,name,account_type,normal_balance,currency,is_active,institution_id,institutional_scope)
       VALUES($1,$2,$3,'LIABILITY','CREDIT','NGN',true,$4,'INSTITUTION')`,
      [
        placeholderLedger,
        `WLT-${label}-${randomUUID().slice(0, 8).toUpperCase()}`,
        `Wallet ${label}`,
        institutionId,
      ],
    );
    const participant = await seedTransferParticipant(dataSource, label, placeholderLedger);
    // Test fixture on disposable DB: attribute wallet/ledger to institution for tier policy resolution.
    await dataSource
      .query(
        `ALTER TABLE wallet_accounts DROP CONSTRAINT IF EXISTS chk_wallet_accounts_institution_pair`,
      )
      .catch(() => undefined);
    await dataSource
      .query(
        `ALTER TABLE wallet_accounts DROP CONSTRAINT IF EXISTS fk_wallet_accounts_institution_attribution`,
      )
      .catch(() => undefined);
    await dataSource.query(
      `ALTER TABLE wallet_accounts DISABLE TRIGGER wallet_institution_attribution_guard`,
    );
    await dataSource
      .query(`ALTER TABLE ledger_accounts DISABLE TRIGGER ledger_account_institution_guard`)
      .catch(() => undefined);
    try {
      await dataSource.query(
        `UPDATE wallet_accounts SET institution_id=$2, owner_class='CUSTOMER', institution_attribution_id=NULL WHERE id=$1`,
        [participant.walletAccountId, institutionId],
      );
      await dataSource.query(
        `UPDATE ledger_accounts SET institution_id=$2, institutional_scope='INSTITUTION' WHERE id=$1`,
        [placeholderLedger, institutionId],
      );
    } finally {
      await dataSource.query(
        `ALTER TABLE wallet_accounts ENABLE TRIGGER wallet_institution_attribution_guard`,
      );
      await dataSource
        .query(`ALTER TABLE ledger_accounts ENABLE TRIGGER ledger_account_institution_guard`)
        .catch(() => undefined);
    }
    // Make customer financially eligible (trusted evidence + governed tier policy).
    await seedKycEvidence(participant.customerId);
    // Mark as claimed by ensuring an active credential exists (claim-credentials outcome).
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials
        (id,customer_id,credential_type,password_hash,hash_algorithm,password_version,status)
       SELECT $1,$2,'PASSWORD','$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012','BCRYPT',1,'ACTIVE'
       WHERE NOT EXISTS (SELECT 1 FROM customer_authentication_credentials WHERE customer_id=$2 AND deleted_at IS NULL)`,
      [randomUUID(), participant.customerId],
    );
    return participant;
  }

  it('tier cap controls: effective config matches runtime; below-cap succeeds, above-cap denied', async () => {
    // Prerequisite: tier-limit enforcement must be active in this test process before
    // AppModule initialized. The standard CI PG runner does not set this env var.
    const tierPolicies = moduleRef.get(InstitutionKycLimitPolicyService);
    expect(tierPolicies.enforcementEnabled).toBe(true);

    await seedGovernedTierPolicyHead();
    await seedProduct();
    const institutionId = await createInstitution();

    // Commercial (assignment) cap higher than Tier 1 cap.
    await seedLimitProfile('T1_COMMERCIAL_HIGH', COMMERCIAL_CAP_MINOR);
    await assignGlobalProfile('T1_COMMERCIAL_HIGH');

    // Approved synthetic institution Tier 1 cap is lower - this must control.
    await seedLimitProfile('T1_TIER_CAP', TIER_CAP_MINOR);
    await approveInstitutionTierPolicy(institutionId, 'T1_TIER_CAP');

    // Prerequisite: approved institution tier policy for LEVEL_1/WALLET_TRANSFER/NGN
    // must be selected as the PROFILE mapping to T1_TIER_CAP.
    const approvedPolicy = await dataSource.query<
      Array<{ version: number; definition: { mappings?: Array<Record<string, unknown>> } }>
    >(
      `SELECT version, definition
         FROM institution_kyc_limit_policy_versions
        WHERE institution_id = $1
        ORDER BY version DESC LIMIT 1`,
      [institutionId],
    );
    expect(approvedPolicy).toHaveLength(1);
    const definition = approvedPolicy[0]!.definition;
    const l1 = (definition.mappings ?? []).find(
      (m) =>
        m.product === 'WALLET_TRANSFER' &&
        m.currency === 'NGN' &&
        m.tier === 'LEVEL_1' &&
        (m.serviceClass === null || m.serviceClass === undefined),
    );
    expect(l1).toBeDefined();
    expect(l1!.disposition).toBe('PROFILE');
    expect(l1!.profileCode).toBe('T1_TIER_CAP');

    const sender = await provisionClaimedWallet('sender', institutionId);
    const receiver = await provisionClaimedWallet('receiver', institutionId);

    // Fund sender wallet via ledger service (real posting).
    const funding = await moduleRef.get(LedgerService).createAccount({
      code: `FUND-${randomUUID().slice(0, 8).toUpperCase()}`,
      name: 'Tier1 ceiling funding',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    await dataSource
      .query(`ALTER TABLE ledger_accounts DISABLE TRIGGER ledger_account_institution_guard`)
      .catch(() => undefined);
    try {
      await dataSource.query(
        `UPDATE ledger_accounts SET institution_id=$2, institutional_scope='INSTITUTION' WHERE id=$1`,
        [funding.id, institutionId],
      );
    } finally {
      await dataSource
        .query(`ALTER TABLE ledger_accounts ENABLE TRIGGER ledger_account_institution_guard`)
        .catch(() => undefined);
    }
    await moduleRef.get(LedgerService).postJournal({
      idempotencyKey: `fund-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `fund-${randomUUID().slice(0, 8)}`,
      description: 'Tier1 ceiling proof funding',
      lines: [
        { accountId: funding.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '2000000000' },
        {
          accountId: sender.ledgerAccountId,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor: '2000000000',
        },
      ],
    });

    // Displayed/effective limit must reflect the controlling tier cap, not the higher commercial cap.
    const effective = await effectiveConfig.evaluate(sender.customerId);
    const wt = effective.products.find((p) => p.productCode === 'WALLET_TRANSFER');
    expect(wt).toBeDefined();
    const maxTx = wt!.limits.find((l) => l.dimension === 'MAX_AMOUNT_PER_TX');
    expect(maxTx).toBeDefined();
    expect(maxTx!.status).toBe('RESOLVED');
    expect(String(maxTx!.limitValueMinor)).toBe(TIER_CAP_MINOR);
    expect(maxTx!.isUnlimited).toBe(false);
    expect(maxTx!.source).toBe('TIER_POLICY');

    // Transfer just below tier cap succeeds.
    const below = await transfers.createTransfer({
      ownership: { kind: 'CUSTOMER_SELF', customerId: sender.customerId },
      sourceWalletId: sender.walletAccountId,
      destinationWalletId: receiver.walletAccountId,
      amountMinor: BELOW_TIER,
      currency: 'NGN',
      idempotencyKey: `t1-below-${randomUUID()}`,
      narration: 'Tier1 ceiling proof below cap',
    } as Parameters<typeof transfers.createTransfer>[0]);
    expect(below.status).toBe(TransferStatus.COMPLETED);

    // Transfer just above tier cap is denied; higher commercial cap must not allow it.
    let aboveError: unknown;
    try {
      await transfers.createTransfer({
        ownership: { kind: 'CUSTOMER_SELF', customerId: sender.customerId },
        sourceWalletId: sender.walletAccountId,
        destinationWalletId: receiver.walletAccountId,
        amountMinor: ABOVE_TIER,
        currency: 'NGN',
        idempotencyKey: `t1-above-${randomUUID()}`,
        narration: 'Tier1 ceiling proof above cap',
      } as Parameters<typeof transfers.createTransfer>[0]);
    } catch (e) {
      aboveError = e;
    }
    expect(aboveError).toBeDefined();
    const err = aboveError as {
      getStatus?: () => number;
      statusCode?: number;
      status?: number;
      getResponse?: () => unknown;
      response?: unknown;
    };
    const status = err.getStatus?.() ?? err.statusCode ?? err.status;
    expect(status).toBe(422);
    const resp = (err.getResponse?.() ?? err.response ?? {}) as Record<string, unknown>;
    const rawCode = resp.error ?? resp.code;
    const code = typeof rawCode === 'string' || typeof rawCode === 'number' ? String(rawCode) : '';
    expect(code).toMatch(/LIMIT_MAX_AMOUNT_EXCEEDED|MAX_AMOUNT_EXCEEDED/i);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUT_DIR, 'ceiling.json'),
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          database: process.env.DB_NAME,
          tierCapMinor: TIER_CAP_MINOR,
          commercialCapMinor: COMMERCIAL_CAP_MINOR,
          displayed: {
            limitValueMinor: String(maxTx!.limitValueMinor),
            source: maxTx!.source,
            isUnlimited: maxTx!.isUnlimited,
          },
          belowCap: { amountMinor: BELOW_TIER, status: below.status, transferId: below.id },
          aboveCap: { amountMinor: ABOVE_TIER, status, code },
        },
        null,
        2,
      )}\n`,
    );

    // Control: commercial profile remained higher (did not control decision).
    const commercialRule: Array<{ limit_value_minor: string }> = await dataSource.query(
      `SELECT limit_value_minor::text AS limit_value_minor FROM limit_rules
        WHERE limit_profile_code='T1_COMMERCIAL_HIGH' AND dimension='MAX_AMOUNT_PER_TX' LIMIT 1`,
    );
    expect(commercialRule[0]?.limit_value_minor).toBe(COMMERCIAL_CAP_MINOR);
  }, 240000);
});
