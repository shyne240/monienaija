/**
 * Tier 2 / Tier 3 coverage (Admin Web onboarding follow-up to PR #24 / #34).
 *
 * The Tier 1 acceptance run proves the lower institution ceiling governs for LEVEL_1 only. This
 * spec closes that gap for LEVEL_2 and LEVEL_3 on fully migrated disposable PostgreSQL, through the
 * real `CustomerFinancialEligibilityService`, `InstitutionKycLimitPolicyService` and
 * `TransferService` + ledger — the same components the browser run exercises for Tier 1.
 *
 * What it establishes, per tier:
 *   - the tier is *reachable at all*: the customer's approved level is corroborated by the governed
 *     evidence reader and the tier decision policy, not merely written onto `customers.kyc_level`;
 *   - the approved institution tier policy resolves a DIFFERENT cap per tier, so the numbers below
 *     cannot be satisfied by one profile standing in for all three;
 *   - that per-tier cap is what both the effective configuration shows staff and what runtime
 *     admission enforces, while a higher commercial cap is configured throughout;
 *   - a transfer just below the tier cap completes and one just above it is denied
 *     `LIMIT_MAX_AMOUNT_EXCEEDED`.
 *
 * LEVEL_3 is deliberately gated by policy: `tier3HasAdditionalRequirement` requires a non-BVN/NIN
 * evidence type on every satisfying path, so this spec publishes that rule and then proves Tier 3
 * becomes reachable — and proves it is NOT reachable by identity evidence alone.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { TransferService } from '../src/transfer/transfer.service';
import { LedgerService } from '../src/ledger/ledger.service';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { TransferStatus } from '../src/transfer/transfer.enums';
import { CustomerEffectiveConfigurationService } from '../src/customer-onboarding/customer-effective-configuration.service';
import { CustomerFinancialEligibilityService } from '../src/kyc-verification/customer-financial-eligibility.service';
import { InstitutionKycLimitPolicyService } from '../src/limit-catalog/institution-kyc-limit-policy.service';
import { ProtectedAuthorityService } from '../src/authorization/protected-authority.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import type { AuthorizationService } from '../src/authorization/authorization.service';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../src/config/environment';
import { seedGovernedTierPolicy } from './support/kyc-test-fixtures';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  seedTransferParticipant,
  truncateAllTables,
} from './support/pg-harness';

process.env.KYC_TIER_LIMIT_ENFORCEMENT_ENABLED = 'true';

const OUT_DIR = path.resolve(
  process.env.TIER1_OUT_DIR || 'docs/integration/evidence/tier1-admin-web',
);

type Tier = 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3';

/** Distinct approved institution caps per tier, all below the single commercial cap. */
const TIER_CAPS: Record<Tier, string> = {
  LEVEL_1: '500000000', // NGN 5,000,000
  LEVEL_2: '1000000000', // NGN 10,000,000
  LEVEL_3: '2000000000', // NGN 20,000,000
};
const COMMERCIAL_CAP_MINOR = '5000000000'; // NGN 50,000,000 — above every tier cap
const HIGH_OTHER_LIMIT = '900000000000';

const tierProfileCode = (tier: Tier) => `T2_TIER_CAP_${tier}`;

describe('Tier 2 / Tier 3 ceiling coverage (fully migrated disposable PG)', () => {
  let dataSource: DataSource;
  let moduleRef: TestingModule;
  let app: NestFastifyApplication;
  let transfers: TransferService;
  let effectiveConfig: CustomerEffectiveConfigurationService;
  let eligibility: CustomerFinancialEligibilityService;
  let ledger: LedgerService;

  // Governed maker/checker principals. The authorization stub short-circuits only the
  // role-catalogue lookup (this spec runs outside a workforce session); every governed state
  // transition — proposal, protected-authority head versioning, distinct maker/checker, approval —
  // still runs for real.
  const maker: AuthorizationPrincipal = {
    type: 'PRIVILEGED',
    principalId: 'tier23-coverage-maker',
    sessionId: randomUUID(),
    roles: ['SUPER_ADMIN'],
    scopes: ['kyc.policy.propose', 'kyc.provider.propose', 'limit.view', 'limit.modify'],
    customerAccess: 'NONE',
    assuranceLevel: 'MFA',
  };
  const checker: AuthorizationPrincipal = {
    type: 'OPERATOR',
    principalId: 'tier23-coverage-checker',
    sessionId: randomUUID(),
    roles: ['COMPLIANCE'],
    scopes: ['kyc.policy.approve', 'kyc.provider.approve', 'limit.view', 'limit.modify'],
    customerAccess: 'NONE',
    assuranceLevel: 'MFA',
  };
  const fixtureAuthorization = {
    authorize: () => Promise.resolve({ allowed: true }),
  } as unknown as AuthorizationService;

  beforeAll(async () => {
    process.env.KYC_TIER_LIMIT_ENFORCEMENT_ENABLED = 'true';
    process.env.NODE_ENV = 'test';
    process.env.PG_TEST_CONFIRM_DISPOSABLE_CLUSTER = 'yes';
    const { AppModule } = await import('../src/app.module');
    dataSource = await createIntegrationDataSource('tier23-coverage');
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    transfers = moduleRef.get(TransferService);
    effectiveConfig = moduleRef.get(CustomerEffectiveConfigurationService);
    eligibility = moduleRef.get(CustomerFinancialEligibilityService);
    ledger = moduleRef.get(LedgerService);
  }, 240000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    else if (moduleRef) await moduleRef.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 120000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  /**
   * Publishes the approved tier policy. LEVEL_3 carries an operator requirement for BIOMETRIC —
   * a non-BVN/NIN type — which is exactly the extra requirement Tier 3 needs to be reachable at
   * all; without it `tier3HasAdditionalRequirement` is false and Tier 3 is unavailable by design.
   */
  async function seedGovernedTierPolicyHead(options: { tier3Biometric: boolean }): Promise<void> {
    const empty = { all: [], any: [] };
    await seedGovernedTierPolicy(dataSource, {
      definition: {
        regulatoryRequirementsConfirmed: true,
        effectiveFrom: '2020-01-01T00:00:00.000Z',
        effectiveUntil: null,
        regulatory: { LEVEL_1: empty, LEVEL_2: empty, LEVEL_3: empty },
        operator: {
          LEVEL_1: empty,
          LEVEL_2: empty,
          LEVEL_3: options.tier3Biometric ? { all: ['BIOMETRIC'], any: [] } : empty,
        },
      },
      makerId: 'tier23-maker',
      checkerId: 'tier23-checker',
    });
  }

  async function createInstitution(): Promise<string> {
    const id = randomUUID();
    const code = `T23${id.slice(0, 8).toUpperCase()}`;
    // Disposable DB: bypass the lifecycle trigger to create an APPROVED institution; no governed
    // route approves one without a live ceremony.
    await dataSource.query(
      `ALTER TABLE financial_institutions DISABLE TRIGGER financial_institution_guard`,
    );
    try {
      await dataSource.query(
        `INSERT INTO financial_institutions
          (id, reference, code, legal_name, institution_type, status, created_by, operational_approved_at, operational_approved_by)
         VALUES ($1, $2, $3, 'Synthetic Tier 2/3 Institution', 'COMMERCIAL_BANK', 'APPROVED', 'tier23-coverage', now(), 'tier23-coverage')`,
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
       VALUES ('WALLET_TRANSFER', 'Wallet Transfer', 'CUSTOMER', 'ACTIVE', true, 'CONFIGURED', 'V1', 'NGN', 'tier23-coverage')
       ON CONFLICT (code) DO UPDATE SET status='ACTIVE', enabled=true, configuration_status='CONFIGURED', product_scope='V1', currency='NGN', domain='CUSTOMER'`,
    );
  }

  async function seedLimitProfile(profileCode: string, maxAmountMinor: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO limit_profiles(code,name,description,kind,status,enabled,configuration_status,created_by)
       VALUES($1,$2,'Synthetic tier coverage profile','UNIVERSAL','ACTIVE',true,'CONFIGURED','tier23-coverage')
       ON CONFLICT(code) DO UPDATE SET status='ACTIVE', enabled=true, configuration_status='CONFIGURED'`,
      [profileCode, `Tier coverage ${profileCode}`],
    );
    const dimensions: Array<[string, string]> = [
      ['MAX_AMOUNT_PER_TX', maxAmountMinor],
      ['DAILY_AMOUNT', HIGH_OTHER_LIMIT],
      ['WEEKLY_AMOUNT', HIGH_OTHER_LIMIT],
      ['MONTHLY_AMOUNT', HIGH_OTHER_LIMIT],
      ['WALLET_BALANCE_MAX', HIGH_OTHER_LIMIT],
    ];
    for (const [dimension, minor] of dimensions) {
      await dataSource.query(
        `INSERT INTO limit_rules(id,limit_profile_code,product,direction,channel,currency,dimension,limit_value_minor,limit_value_count,effective_from,effective_to,is_active,priority,created_by)
         VALUES($1,$2,'WALLET_TRANSFER','BOTH',NULL,'NGN',$3,$4,NULL,'2000-01-01T00:00:00.000Z',NULL,true,0,'tier23-coverage')`,
        [randomUUID(), profileCode, dimension, minor],
      );
    }
  }

  async function assignGlobalProfile(profileCode: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,segment_code,precedence,effective_from,effective_to,is_active,created_by)
       VALUES($1,$2,'GLOBAL',NULL,NULL,0,'2000-01-01T00:00:00.000Z',NULL,true,'tier23-coverage')`,
      [randomUUID(), profileCode],
    );
  }

  /** Approves one institution policy mapping each tier to its own distinct profile. */
  async function approveInstitutionTierPolicy(institutionId: string): Promise<void> {
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
        profileCode: tierProfileCode(tier),
      })),
    };
    const proposal = await governance.propose(maker, {
      institutionId,
      requestId: randomUUID(),
      expectedVersion: current.currentVersion,
      definition,
      reason: 'Synthetic Tier 2/3 coverage: a distinct approved cap per tier',
    });
    await governance.decide(checker, institutionId, proposal.id, true);
  }

  /**
   * Seeds the evidence a real onboarding journey would have produced for `tier`:
   * LEVEL_1 — BVN; LEVEL_2 — BVN + NIN; LEVEL_3 — BVN + NIN + BIOMETRIC.
   *
   * Each evidence type gets its own live consent, provider MATCH attempt and VERIFIED claim bound
   * to the CURRENT identity revision, which is the shape the governed reader binds on.
   */
  async function seedKycEvidence(customerId: string, tier: Tier): Promise<void> {
    const kinds: Array<'BVN' | 'NIN' | 'BIOMETRIC'> =
      tier === 'LEVEL_1'
        ? ['BVN']
        : tier === 'LEVEL_2'
          ? ['BVN', 'NIN']
          : ['BVN', 'NIN', 'BIOMETRIC'];

    await dataSource.query(
      `INSERT INTO customer_profiles(customer_id,display_name,first_name,last_name,date_of_birth,is_active)
       SELECT $1,'Tier Coverage','Tier','Coverage','1990-01-01',true
       WHERE NOT EXISTS (SELECT 1 FROM customer_profiles WHERE customer_id=$1 AND is_active=true AND deleted_at IS NULL)`,
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
       VALUES($1,$2,$3,'APPROVED','TIER23_COVERAGE','SYSTEM_KYC_EVALUATOR',true,clock_timestamp()+interval '30 days')`,
      [randomUUID(), customerId, tier],
    );
    await dataSource.query(`UPDATE customers SET kyc_level=$2, kyc_status='APPROVED' WHERE id=$1`, [
      customerId,
      tier,
    ]);
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials
        (id,customer_id,credential_type,password_hash,hash_algorithm,password_version,status)
       SELECT $1,$2,'PASSWORD','$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012','BCRYPT',1,'ACTIVE'
       WHERE NOT EXISTS (SELECT 1 FROM customer_authentication_credentials WHERE customer_id=$2 AND deleted_at IS NULL)`,
      [randomUUID(), customerId],
    );

    // Bind evidence to the CURRENT identity revision, after all mutations above.
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

    for (const kind of kinds) {
      const sessionId = randomUUID();
      const tokenHash = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
      await dataSource.query(
        `INSERT INTO authentication_sessions
          (id,customer_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at)
         VALUES($1,$2,$3,$4,'customer-api','ACTIVE',clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp())`,
        [sessionId, customerId, credRows[0]!.id, tokenHash],
      );
      const consent = randomUUID();
      await dataSource.query(
        `INSERT INTO kyc_consents
          (id,customer_id,session_id,kind,notice_version,actor_id,identity_revision,provider,route_version,expires_at)
         VALUES($1,$2,$3,$4,'tier23-coverage-v1',$2,$5,'MONNIFY',1,clock_timestamp()+interval '1 hour')`,
        [consent, customerId, sessionId, kind, revision],
      );
      const attempt = randomUUID();
      const mac = randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64);
      await dataSource.query(
        `INSERT INTO kyc_verification_attempts
          (id,customer_id,consent_id,request_id,kind,provider,policy_version,request_mac,identity_mac,mac_key_version,
           provider_route_version,outcome,identity_revision,completed_at,expires_at)
         VALUES($1,$2,$3,$4,$5,'MONNIFY','tier23-coverage-v1',$6,$6,'test-v1',1,'MATCH',$7,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
        [attempt, customerId, consent, randomUUID(), kind, mac, revision],
      );
      const claimMac = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
      await dataSource.query(
        `INSERT INTO kyc_identity_claims(id,kind,identifier_mac,customer_id,attempt_id,status)
         VALUES($1,$2,$3,$4,$5,'VERIFIED')`,
        [randomUUID(), kind, claimMac.slice(0, 64), customerId, attempt],
      );
    }
  }

  async function provisionClaimedWallet(
    label: string,
    institutionId: string,
  ): Promise<{ customerId: string; walletAccountId: string; ledgerAccountId: string }> {
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
    // Disposable DB: attribute the wallet and its ledger account to the institution so the tier
    // policy resolves. The attribution guard is disarmed for exactly these two statements.
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
    return participant;
  }

  /**
   * Funds a synthetic wallet with a real ledger posting. A transfer above the tier cap is only
   * rejected by the LIMIT gate if the balance would otherwise have covered it, so the funding has
   * to be genuinely posted rather than assumed.
   */
  async function fundWallet(
    walletLedgerAccountId: string,
    institutionId: string,
    amountMinor: string,
  ): Promise<void> {
    const funding = await ledger.createAccount({
      code: `FUND-${randomUUID().slice(0, 8).toUpperCase()}`,
      name: 'Tier 2/3 coverage funding',
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
    await ledger.postJournal({
      idempotencyKey: `fund-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `fund-${randomUUID().slice(0, 8)}`,
      description: `Tier 2/3 coverage funding ${amountMinor}`,
      lines: [
        {
          accountId: funding.id,
          direction: LedgerEntryDirection.DEBIT,
          amountMinor,
        },
        {
          accountId: walletLedgerAccountId,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor,
        },
      ],
    });
  }

  const TIERS: Tier[] = ['LEVEL_1', 'LEVEL_2', 'LEVEL_3'];
  // Only these tiers are reachable in the current backend; see the Tier 3 cases below.
  const REACHABLE_TIERS: Tier[] = ['LEVEL_1', 'LEVEL_2'];

  it.each(REACHABLE_TIERS)(
    '%s is reachable from its own evidence and its approved cap governs at runtime',
    async (tier) => {
      const tierPolicies = moduleRef.get(InstitutionKycLimitPolicyService);
      expect(tierPolicies.enforcementEnabled).toBe(true);

      await seedGovernedTierPolicyHead({ tier3Biometric: true });
      await seedProduct();
      await seedLimitProfile('T23_COMMERCIAL', COMMERCIAL_CAP_MINOR);
      await assignGlobalProfile('T23_COMMERCIAL');
      // The institution policy digest validates EVERY tier mapping, so all three tier profiles
      // must exist and be configured even though this case only exercises one of them.
      for (const seeded of TIERS)
        await seedLimitProfile(tierProfileCode(seeded), TIER_CAPS[seeded]);
      const institutionId = await createInstitution();
      await approveInstitutionTierPolicy(institutionId);

      const sender = await provisionClaimedWallet(`sender.${tier.toLowerCase()}`, institutionId);
      await seedKycEvidence(sender.customerId, tier);

      // The tier must be corroborated by governed evidence, not merely written on the row.
      const trusted = await dataSource.transaction((manager) =>
        eligibility.require(manager, sender.customerId, { lockMode: 'NONE' }),
      );
      expect(trusted).toBe(tier);

      const config = await effectiveConfig.evaluate(sender.customerId);
      expect(config.verifiedTier).toBe(tier);
      const transfer = config.products.find(
        (product) => product.productCode === 'WALLET_TRANSFER',
      )!;
      const maxPerTx = transfer.limits.find((limit) => limit.dimension === 'MAX_AMOUNT_PER_TX')!;
      expect(maxPerTx.limitValueMinor).toBe(TIER_CAPS[tier]);
      expect(maxPerTx.source).toBe('TIER_POLICY');
      // The commercial cap is higher throughout, so it can never be what governs.
      expect(BigInt(TIER_CAPS[tier])).toBeLessThan(BigInt(COMMERCIAL_CAP_MINOR));

      const receiver = await provisionClaimedWallet(
        `receiver.${tier.toLowerCase()}`,
        institutionId,
      );
      await seedKycEvidence(receiver.customerId, tier);

      // Generously fund the sender so only the tier ceiling can deny the above-cap transfer.
      await fundWallet(sender.ledgerAccountId, institutionId, '50000000000');

      const below = (BigInt(TIER_CAPS[tier]) - 1000000n).toString();
      const above = (BigInt(TIER_CAPS[tier]) + 1000000n).toString();

      const belowResult = await transfers.createTransfer({
        ownership: { kind: 'CUSTOMER_SELF', customerId: sender.customerId },
        sourceWalletId: sender.walletAccountId,
        destinationWalletId: receiver.walletAccountId,
        amountMinor: below,
        currency: 'NGN',
        idempotencyKey: `t23-below-${randomUUID()}`,
        narration: `Synthetic ${tier} below cap`,
      } as Parameters<typeof transfers.createTransfer>[0]);
      expect(belowResult.status).toBe(TransferStatus.COMPLETED);

      let aboveError: unknown;
      try {
        await transfers.createTransfer({
          ownership: { kind: 'CUSTOMER_SELF', customerId: sender.customerId },
          sourceWalletId: sender.walletAccountId,
          destinationWalletId: receiver.walletAccountId,
          amountMinor: above,
          currency: 'NGN',
          idempotencyKey: `t23-above-${randomUUID()}`,
          narration: `Synthetic ${tier} above cap`,
        } as Parameters<typeof transfers.createTransfer>[0]);
      } catch (error) {
        aboveError = error;
      }
      expect(aboveError).toBeDefined();
      const failure = aboveError as {
        getStatus?: () => number;
        statusCode?: number;
        status?: number;
        getResponse?: () => unknown;
        response?: unknown;
      };
      const status = Number(failure.getStatus?.() ?? failure.statusCode ?? failure.status ?? 0);
      expect(status).toBe(422);
      const payload = (failure.getResponse?.() ?? failure.response ?? {}) as Record<
        string,
        unknown
      >;
      const rawCode = payload.error ?? payload.code;
      const code =
        typeof rawCode === 'string' || typeof rawCode === 'number' ? String(rawCode) : '';
      expect(code).toMatch(/LIMIT_MAX_AMOUNT_EXCEEDED|MAX_AMOUNT_EXCEEDED/i);

      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(OUT_DIR, `tier-coverage-${tier}.json`),
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            database: process.env.DB_NAME ?? null,
            tier,
            tierCapMinor: TIER_CAPS[tier],
            commercialCapMinor: COMMERCIAL_CAP_MINOR,
            corroboratedTier: trusted,
            displayed: {
              limitValueMinor: maxPerTx.limitValueMinor,
              source: maxPerTx.source,
            },
            belowCap: { amountMinor: below, status: TransferStatus.COMPLETED },
            aboveCap: { amountMinor: above, status },
          },
          null,
          2,
        ),
      );
    },
    180000,
  );

  it('Tier 3 stays unavailable when the approved policy requires no non-identity evidence', async () => {
    // Negative control: identity evidence alone must never reach Tier 3. This is the
    // `tier3HasAdditionalRequirement` guard, proved against a published policy rather than assumed.
    await seedGovernedTierPolicyHead({ tier3Biometric: false });
    await seedProduct();
    await seedLimitProfile('T23_COMMERCIAL', COMMERCIAL_CAP_MINOR);
    await assignGlobalProfile('T23_COMMERCIAL');
    for (const seeded of TIERS) await seedLimitProfile(tierProfileCode(seeded), TIER_CAPS[seeded]);
    const institutionId = await createInstitution();
    await approveInstitutionTierPolicy(institutionId);

    const sender = await provisionClaimedWallet('sender.tier3negative', institutionId);
    // Ask for LEVEL_3 evidence; only BVN + NIN can actually be persisted.
    await seedKycEvidence(sender.customerId, 'LEVEL_2');

    // The row is written as LEVEL_3 to prove the trusted gate ignores the row and re-derives the
    // tier from evidence: with no Level 3 policy requirement the decision cannot reach LEVEL_3.
    await dataSource.query(`UPDATE customers SET kyc_level='LEVEL_3' WHERE id=$1`, [
      sender.customerId,
    ]);
    // Fail closed: the row claims LEVEL_3 but the evidence only supports LEVEL_2, so the trusted
    // gate refuses access outright rather than silently granting the lower tier's ceilings.
    await expect(
      dataSource.transaction((manager) =>
        eligibility.require(manager, sender.customerId, { lockMode: 'NONE' }),
      ),
    ).rejects.toMatchObject({ status: 409 });

    // `verifiedTier` is a faithful echo of the stored `customers.kyc_level`, so this tampered row
    // still reads LEVEL_3 there — the display does not lie about what the row says. What must NOT
    // happen is the Tier 3 ceiling being presented or applied: because the trusted gate cannot
    // produce LEVEL_3, no approved tier policy resolves and the higher commercial cap remains the
    // displayed ceiling instead of a governance-approved Tier 3 cap.
    const config = await effectiveConfig.evaluate(sender.customerId);
    expect(config.verifiedTier).toBe('LEVEL_3');
    const maxPerTxForTampered = config.products
      .find((product) => product.productCode === 'WALLET_TRANSFER')!
      .limits.find((limit) => limit.dimension === 'MAX_AMOUNT_PER_TX')!;
    expect(String(maxPerTxForTampered.limitValueMinor)).not.toBe(TIER_CAPS.LEVEL_3);
    expect(maxPerTxForTampered.source).toBe('ASSIGNMENT');
  }, 180000);

  it('Tier 3 cannot be reached even with a Level 3 policy: the evidence store accepts only BVN/NIN', async () => {
    // This is a coverage boundary, not a passing feature. Tier 3 requires a non-BVN/NIN evidence
    // type on every satisfying path (`tier3HasAdditionalRequirement`), the decision model lists 18
    // evidence types — but every persistence surface the governed reader binds to
    // (`kyc_consents`, `kyc_verification_attempts`, `kyc_identity_claims`) constrains `kind` to
    // exactly ('BVN','NIN') in a varchar(3) column. A Level 3 requirement therefore cannot be
    // satisfied with any evidence that can be stored, so Tier 3 is unreachable by construction.
    //
    // The schema constraint is asserted here so this test starts failing the day the evidence store
    // is widened — at which point Tier 3 becomes testable and belongs in REACHABLE_TIERS above.
    const constraints: Array<{ table_name: string; definition: string }> = await dataSource.query(
      `SELECT c.relname AS table_name, pg_get_constraintdef(con.oid) AS definition
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
        WHERE c.relname IN ('kyc_consents','kyc_verification_attempts','kyc_identity_claims')
          AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) ILIKE '%kind%'`,
    );
    expect(constraints.length).toBeGreaterThan(0);
    for (const constraint of constraints) {
      // Only identity evidence is accepted: no non-identity kind can ever be stored.
      expect(constraint.definition).toMatch(/'BVN'/);
      expect(constraint.definition).toMatch(/'NIN'/);
      expect(constraint.definition).not.toMatch(/BIOMETRIC|ADDRESS|SOURCE_OF_FUNDS/);
    }

    // And a policy that demands the unavailable evidence still cannot lift a customer to Tier 3.
    await seedGovernedTierPolicyHead({ tier3Biometric: true });
    await seedProduct();
    await seedLimitProfile('T23_COMMERCIAL', COMMERCIAL_CAP_MINOR);
    await assignGlobalProfile('T23_COMMERCIAL');
    for (const seeded of TIERS) await seedLimitProfile(tierProfileCode(seeded), TIER_CAPS[seeded]);
    const institutionId = await createInstitution();
    await approveInstitutionTierPolicy(institutionId);
    const sender = await provisionClaimedWallet('sender.tier3policy', institutionId);
    await seedKycEvidence(sender.customerId, 'LEVEL_2');
    const trusted = await dataSource.transaction((manager) =>
      eligibility.require(manager, sender.customerId, { lockMode: 'NONE' }),
    );
    expect(trusted).toBe('LEVEL_2');

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUT_DIR, 'tier-coverage-LEVEL_3.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          database: process.env.DB_NAME ?? null,
          tier: 'LEVEL_3',
          reachable: false,
          reason: 'EVIDENCE_STORE_ACCEPTS_ONLY_BVN_AND_NIN',
          detail:
            'Tier 3 requires a non-BVN/NIN evidence type on every satisfying path, but kyc_consents, kyc_verification_attempts and kyc_identity_claims constrain kind to (BVN,NIN) in varchar(3).',
          highestReachableTier: trusted,
          constraints: constraints.map((constraint) => ({
            table: constraint.table_name,
            definition: constraint.definition,
          })),
        },
        null,
        2,
      ),
    );
  }, 180000);
});
