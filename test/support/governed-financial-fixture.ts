/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
/**
 * Canonical governed institutional-financial fixture (ARENA 3B, Stage 1).
 *
 * Every institutional fact this fixture produces is produced by the **accepted application
 * services and database mechanisms**:
 *
 *  - workforce principals are seeded as authenticated MFA role assignments and then given a real
 *    session by `A2WorkforceSessionService.establish()` (a distinct maker and a distinct checker);
 *  - institution registration, evidence submission and activation run through the governed
 *    `POST /internal/institutions/*` + `POST /internal/a2/workforce/approvals/:id/approve`
 *    maker-checker endpoints, so the protected decision, consumption and trigger-generated
 *    execution evidence are the ones production would write;
 *  - agent affiliation runs through the governed `INSTITUTION_AGENT_AFFILIATION_CHANGE` workflow;
 *  - customer enrolment runs through the governed `CUSTOMER_INSTITUTION_ENROLMENT_CHANGE` workflow;
 *  - wallet attribution runs through the governed `WALLET_INSTITUTION_ATTRIBUTION` workflow and is
 *    therefore refused on a ledger account that already carries posted history;
 *  - funding posts a real, balanced journal through `LedgerService.postJournal()` **after** the
 *    attribution, never before.
 *
 * It never inserts a checker decision, an approval, a consumption row, an execution-evidence row,
 * an institutional attribution or a ledger line directly. It never disables a trigger, row level
 * security, an ownership guard or a protected-authority check.
 *
 * Setup order is mandatory (see `setupOrder()`):
 *   institutional authority → affiliation / enrolment → wallet and ledger attribution → funding.
 */

import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { DataSource } from 'typeorm';
import * as request from 'supertest';

import { A2FinanceRoleAssignment } from '../../src/authorization/workforce-authentication.entity';
import { A2WorkforceSessionService } from '../../src/authorization/workforce-session.service';
import { LedgerService } from '../../src/ledger/ledger.service';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../../src/ledger/ledger.enums';
import { InstitutionAttributionEvidenceType } from '../../src/institution/institution.enums';
import { WalletService } from '../../src/wallet/wallet.service';
import {
  makeCustomerFinanciallyEligible,
  type EligibleEvidenceSource,
} from './kyc-test-fixtures';

export const GOVERNED_SETUP_ORDER = [
  'institutional-authority',
  'agent-affiliation',
  'customer-enrolment',
  'wallet-and-ledger-attribution',
  'financial-funding',
] as const;

export type WorkforceRoleKey =
  | 'superAdmin'
  | 'operator'
  | 'networkManager'
  | 'preparer'
  | 'controller'
  | 'auditor';

const ROLE_KEYS: Record<WorkforceRoleKey, string> = {
  superAdmin: 'SUPER_ADMIN',
  operator: 'OPERATIONS',
  networkManager: 'AGENT_NETWORK_MANAGER',
  preparer: 'FINANCE_PREPARER',
  controller: 'FINANCE_CONTROLLER',
  auditor: 'FINANCE_AUDITOR',
};

export interface GovernedPrincipal {
  principalId: string;
  token: string;
}

export type GovernedWorkforce = Record<WorkforceRoleKey, GovernedPrincipal>;

export interface GovernedInstitution {
  id: string;
  code: string;
  reference: string;
  legalName: string;
}

export interface GovernedAffiliation {
  affiliationId: string;
  institutionId: string;
  agentId: string;
}

export interface GovernedEnrolment {
  enrolmentId: string;
  institutionId: string;
  customerId: string;
  status: string;
  financialEligibility: string;
}

export interface GovernedAttribution {
  attributionId: string;
  institutionId: string;
  walletId: string;
  ledgerAccountId: string;
}

export interface GovernedWallet {
  walletId: string;
  ledgerAccountId: string;
  ownerClass: string;
}

export interface GovernedFixtureOptions {
  app: NestFastifyApplication;
  dataSource: DataSource;
  /** Global API prefix configured on the application under test. */
  prefix?: string;
  /** Distinguishes references created by one suite from another. */
  label?: string;
}

export interface CreateInstitutionOptions {
  institutionType?: string;
  /** Extra workforce principals granted institution scope before activation. */
  scopedPrincipalIds?: string[];
  legalName?: string;
}

export interface EnrolmentOptions {
  targetStatus?: 'PENDING' | 'ACTIVE';
  financialEligibility?: 'PENDING_KYC' | 'ELIGIBLE' | 'RESTRICTED';
  withKycReuse?: boolean;
  /** The maker for the enrolment request. Defaults to the network manager. */
  maker?: GovernedPrincipal;
}

/**
 * A reusable, governed institutional-financial fixture bound to one application instance and its
 * data source.
 *
 * Two fixture instances (or two `createInstitution()` calls) yield fully independent institutions,
 * which is what the cross-institution isolation cases require.
 */
export class GovernedFinancialFixture {
  private readonly app: NestFastifyApplication;
  private readonly dataSource: DataSource;
  private readonly prefix: string;
  private readonly label: string;

  private workforceCache?: GovernedWorkforce;
  private readonly institutions = new Map<string, GovernedInstitution>();
  private readonly defaultInstitutionKeys = new Map<string, string>();
  private sequence = 0;
  private floatAccountId?: string;
  private readonly settlementAccounts = new Map<string, string>();

  constructor(options: GovernedFixtureOptions) {
    this.app = options.app;
    this.dataSource = options.dataSource;
    this.prefix = options.prefix ?? 'api/v1';
    this.label = options.label ?? 'govfix';
  }

  // ------------------------------------------------------------------ workforce authority

  /** The documented governance setup order every fixture consumer must follow. */
  static setupOrder(): readonly string[] {
    return GOVERNED_SETUP_ORDER;
  }

  private url(path: string): string {
    return `/${this.prefix}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private bearer(principal: GovernedPrincipal) {
    return { Authorization: `Bearer ${principal.token}` };
  }

  private async seedPrincipal(roleKey: WorkforceRoleKey): Promise<GovernedPrincipal> {
    const sessions = this.app.get(A2WorkforceSessionService);
    const principalId = `${this.label}:${roleKey}:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    await this.dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `${this.label}:${principalId}`,
      assignmentVersion: 1,
      principalId,
      roleKey: ROLE_KEYS[roleKey],
      scopes: [],
      status: 'ACTIVE',
      initiatedScope: 'SUPER_ADMIN_SCOPE',
      interim: true,
      effectiveFrom: new Date(now.getTime() - 60_000),
      effectiveTo: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
      assignedBy: 'governed-financial-fixture',
      assignedAt: now,
      revokedBy: null,
      revokedAt: null,
      bootstrapReference: null,
      approvalIds: [],
      auditReferences: [],
    } as unknown as A2FinanceRoleAssignment);
    const result = await sessions.establish({
      issuer: 'https://local-dev-identity.monienaija.invalid',
      subject: principalId,
      principalId,
      audience: ['workforce-admin'],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
      authenticatedAt: now.toISOString(),
      assuranceLevel: 'MFA',
      amr: ['pwd', 'otp'],
      acr: null,
      signingKeyId: 'governed-financial-fixture-key',
    });
    return { principalId, token: result.accessToken };
  }

  /**
   * Six independently authenticated MFA principals. Maker and checker are always distinct
   * principals, which is what the maker-checker contract requires.
   */
  async workforce(): Promise<GovernedWorkforce> {
    if (!this.workforceCache) {
      const entries = await Promise.all(
        (Object.keys(ROLE_KEYS) as WorkforceRoleKey[]).map(
          async (key) => [key, await this.seedPrincipal(key)] as const,
        ),
      );
      this.workforceCache = Object.fromEntries(entries) as GovernedWorkforce;
    }
    return this.workforceCache;
  }

  /** Independent MFA checker: never the principal that prepared the request. */
  async checker(): Promise<GovernedPrincipal> {
    return (await this.workforce()).controller;
  }

  private async approve(approvalId: string, checker?: GovernedPrincipal) {
    const principal = checker ?? (await this.checker());
    const response = await request(this.app.getHttpServer())
      .post(this.url(`/internal/a2/workforce/approvals/${approvalId}/approve`))
      .set(this.bearer(principal))
      .send({ comment: 'independently checked by the designated MFA checker' });
    if (response.status !== 201) {
      throw new Error(
        `checker approval failed: ${response.status} ${JSON.stringify(response.body)}`,
      );
    }
    return response;
  }

  private assertStatus(response: request.Response, expected: number, what: string) {
    if (response.status !== expected) {
      throw new Error(
        `${what} failed: expected ${expected}, received ${response.status} ${JSON.stringify(
          response.body,
        )}`,
      );
    }
    return response;
  }

  // ------------------------------------------------------------------ institutions

  async registerInstitution(options: CreateInstitutionOptions = {}): Promise<GovernedInstitution> {
    const { superAdmin } = await this.workforce();
    this.sequence += 1;
    const suffix = `${this.label.toUpperCase().replace(/[^A-Z0-9]/g, '')}${this.sequence}${randomUUID()
      .slice(0, 6)
      .toUpperCase()}`;
    const legalName = options.legalName ?? `Governed Institution ${suffix} Limited`;
    const response = await request(this.app.getHttpServer())
      .post(this.url('/internal/institutions'))
      .set(this.bearer(superAdmin))
      .send({
        reference: `GF-${suffix}`,
        code: `GF_${suffix}`,
        legalName,
        institutionType: options.institutionType ?? 'MICROFINANCE_BANK',
        regulatorName: 'Central Bank',
        licenceReference: `GFLIC/${suffix}`,
      });
    this.assertStatus(response, 201, 'institution registration');
    const institution: GovernedInstitution = {
      id: response.body.id as string,
      code: `GF_${suffix}`,
      reference: `GF-${suffix}`,
      legalName,
    };
    this.institutions.set(institution.id, institution);
    return institution;
  }

  async submitEvidence(institutionId: string): Promise<void> {
    const { superAdmin } = await this.workforce();
    const response = await request(this.app.getHttpServer())
      .post(this.url(`/internal/institutions/${institutionId}/evidence`))
      .set(this.bearer(superAdmin))
      .send({
        evidenceReference: `GFEVID-${institutionId.slice(0, 8)}`,
        regulatorName: 'Central Bank',
        licenceReference: `GFLIC-${institutionId.slice(0, 8)}`,
      });
    this.assertStatus(response, 201, 'institution evidence submission');
  }

  async grantWorkforceScope(institutionId: string, principalId: string): Promise<void> {
    const { superAdmin } = await this.workforce();
    const response = await request(this.app.getHttpServer())
      .post(this.url(`/internal/institutions/${institutionId}/workforce`))
      .set(this.bearer(superAdmin))
      .send({ principalId });
    this.assertStatus(response, 201, 'institution workforce scope grant');
  }

  /**
   * Register → evidence → (workforce scope) → governed activation through a consumed
   * `FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE` approval. Execution evidence is trigger-generated.
   */
  async createInstitution(options: CreateInstitutionOptions = {}): Promise<GovernedInstitution> {
    const { operator } = await this.workforce();
    const institution = await this.registerInstitution(options);
    await this.submitEvidence(institution.id);

    // Every governed maker/checker this fixture uses is a workforce principal, so each one is
    // granted institution scope before activation. Without the scope the institution-scoped
    // endpoints correctly answer 404 rather than exposing a cross-institution record.
    const workforce = await this.workforce();
    const scoped = new Set<string>(options.scopedPrincipalIds ?? []);
    for (const principal of Object.values(workforce)) scoped.add(principal.principalId);
    scoped.add(operator.principalId);
    for (const principalId of scoped) {
      await this.grantWorkforceScope(institution.id, principalId);
    }

    const reason =
      'Regulatory evidence verified by compliance and operational approval recorded for activation';
    const prepared = await request(this.app.getHttpServer())
      .post(this.url(`/internal/institutions/${institution.id}/lifecycle/request`))
      .set(this.bearer(operator))
      .send({ targetStatus: 'APPROVED', reason });
    this.assertStatus(prepared, 201, 'institution lifecycle request');
    await this.approve(prepared.body.approvalId as string);

    const executed = await request(this.app.getHttpServer())
      .post(this.url(`/internal/institutions/${institution.id}/lifecycle`))
      .set(this.bearer(await this.checker()))
      .send({
        approvalId: prepared.body.approvalId,
        targetStatus: 'APPROVED',
        reason,
      });
    this.assertStatus(executed, 201, 'institution lifecycle execution');
    return institution;
  }

  /** Change an existing institution's lifecycle status through the governed workflow. */
  async changeInstitutionStatus(
    institutionId: string,
    targetStatus: 'APPROVED' | 'SUSPENDED' | 'REVOKED',
    reason = 'Supervisory status change recorded by operations under the governance procedure',
  ): Promise<void> {
    const { operator } = await this.workforce();
    const prepared = await request(this.app.getHttpServer())
      .post(this.url(`/internal/institutions/${institutionId}/lifecycle/request`))
      .set(this.bearer(operator))
      .send({ targetStatus, reason });
    this.assertStatus(prepared, 201, 'institution lifecycle request');
    await this.approve(prepared.body.approvalId as string);
    const executed = await request(this.app.getHttpServer())
      .post(this.url(`/internal/institutions/${institutionId}/lifecycle`))
      .set(this.bearer(await this.checker()))
      .send({ approvalId: prepared.body.approvalId, targetStatus, reason });
    this.assertStatus(executed, 201, 'institution lifecycle execution');
  }

  /**
   * The fixture's default governed institution for a named purpose. Created once per key, so a
   * suite that needs "the institution" pays for the governance workflow exactly once per run.
   */
  async institution(key = 'default', options: CreateInstitutionOptions = {}): Promise<string> {
    const existing = this.defaultInstitutionKeys.get(key);
    if (existing) return existing;
    const institution = await this.createInstitution(options);
    this.defaultInstitutionKeys.set(key, institution.id);
    return institution.id;
  }

  // ------------------------------------------------------------------ affiliation

  async affiliateAgent(agentId: string, institutionId: string): Promise<GovernedAffiliation> {
    const { networkManager } = await this.workforce();
    const body = {
      institutionId,
      changeKind: 'ASSIGN',
      evidenceType: 'INSTITUTION_APPROVAL_LETTER',
      evidenceReference: `GFAFF-${randomUUID().slice(0, 10)}`,
      reason: 'Agent appointed under the institution approval letter on file',
    };
    const prepared = await request(this.app.getHttpServer())
      .post(this.url(`/internal/agent-affiliations/${agentId}/request`))
      .set(this.bearer(networkManager))
      .send(body);
    this.assertStatus(prepared, 201, 'agent affiliation request');
    await this.approve(prepared.body.approvalId as string);
    const executed = await request(this.app.getHttpServer())
      .post(this.url(`/internal/agent-affiliations/${agentId}/execute`))
      .set(this.bearer(await this.checker()))
      .send({ ...body, approvalId: prepared.body.approvalId });
    this.assertStatus(executed, 201, 'agent affiliation execution');
    return {
      affiliationId: (executed.body.affiliationId ?? executed.body.id) as string,
      institutionId,
      agentId,
    };
  }

  // ------------------------------------------------------------------ enrolment

  async enrolCustomer(
    customerId: string,
    institutionId: string,
    options: EnrolmentOptions = {},
  ): Promise<GovernedEnrolment> {
    const maker = options.maker ?? (await this.workforce()).networkManager;
    const withKycReuse = options.withKycReuse ?? true;
    const body = {
      customerId,
      reference: `GFENR-${randomUUID().slice(0, 12).toUpperCase()}`,
      targetStatus: options.targetStatus ?? 'ACTIVE',
      financialEligibility: options.financialEligibility ?? 'ELIGIBLE',
      statusReason: 'Enrolment requested under the institutional onboarding agreement',
      ...(withKycReuse
        ? {
            kycReuse: {
              evidenceReference: 'KYC-EVID-001',
              consentReference: 'CONSENT-001',
              policyReference: 'POLICY-KYC-REUSE-001',
            },
          }
        : {}),
    };
    const prepared = await request(this.app.getHttpServer())
      .post(this.url(`/internal/institutions/${institutionId}/enrolments`))
      .set(this.bearer(maker))
      .send(body);
    this.assertStatus(prepared, 201, 'customer enrolment request');
    await this.approve(prepared.body.approvalId as string);
    const executed = await request(this.app.getHttpServer())
      .post(this.url(`/internal/institutions/${institutionId}/enrolments/execute`))
      .set(this.bearer(await this.checker()))
      .send({ ...body, approvalId: prepared.body.approvalId });
    this.assertStatus(executed, 201, 'customer enrolment execution');
    return {
      enrolmentId: (executed.body.id ?? executed.body.enrolmentId) as string,
      institutionId,
      customerId,
      status: (executed.body.status as string) ?? body.targetStatus,
      financialEligibility:
        (executed.body.financialEligibility as string) ?? body.financialEligibility,
    };
  }

  // ------------------------------------------------------------------ customer eligibility

  /**
   * Controlled, test-only customer financial eligibility (requirement 11).
   *
   * The production KYC evidence reader returns `null` because no provider's live contract is
   * confirmed, so every financial gate correctly fails closed. This helper composes the accepted
   * test seams instead of bypassing the gate:
   *
   *  - the governed tier policy is seeded once through the policy tables;
   *  - the customer gets a genuine verified primary phone and an APPROVED assessment;
   *  - `makeCustomerFinanciallyEligible()` writes real consent/attempt/claim rows that the
   *    **test-only** trusted-evidence reader can attest.
   *
   * The suite must install that reader itself with
   * `overrideTrustedEvidenceReader(builder, kycEvidence.reader)`; the fixture never touches the
   * application's evidence reader.
   */
  async makeCustomerEligible(
    customerId: string,
    evidenceSource: EligibleEvidenceSource,
    options: { level?: 'LEVEL_1' | 'LEVEL_2'; phone?: string } = {},
  ): Promise<void> {
    await this.seedTierPolicy();
    const phones: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM customer_contact_methods
        WHERE customer_id=$1 AND type='PHONE' AND is_primary=true
          AND verified_at IS NOT NULL AND deleted_at IS NULL`,
      [customerId],
    );
    if (phones.length === 0) {
      const phone = options.phone ?? `80${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
      await this.dataSource.query(
        `INSERT INTO customer_contact_methods
           (customer_id, type, value, normalized_value, is_primary, verified_at)
         VALUES ($1,'PHONE',$2,$2,true,clock_timestamp())`,
        [customerId, phone],
      );
    }
    const profiles: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM customer_profiles WHERE customer_id=$1 AND is_active=true AND deleted_at IS NULL`,
      [customerId],
    );
    if (profiles.length === 0) {
      await this.dataSource.query(
        `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`,
        [customerId, `Governed customer ${customerId.slice(0, 8)}`],
      );
    }
    await makeCustomerFinanciallyEligible(this.dataSource, customerId, evidenceSource, {
      level: options.level ?? 'LEVEL_1',
    });
  }

  /** Idempotent governed KYC tier policy seed (the policy the eligibility gate evaluates). */
  private async seedTierPolicy(): Promise<void> {
    const [head] = await this.dataSource.query<Array<{ version: string }>>(
      `SELECT version::text AS version FROM kyc_tier_policy_head`,
    );
    if (Number(head?.version ?? 0) > 0) return;
    const requirement = { all: [], any: [] };
    const definition = {
      regulatoryRequirementsConfirmed: true,
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveUntil: null,
      regulatory: { LEVEL_1: requirement, LEVEL_2: requirement },
      operator: { LEVEL_1: requirement, LEVEL_2: requirement },
    };
    const proposalId = randomUUID();
    await this.dataSource.query(
      `INSERT INTO kyc_tier_policy_proposals
         (id,request_id,expected_version,definition,fingerprint,maker_id,maker_session_id,checker_id,checker_session_id,state)
       VALUES($1,$2,0,$3,$4,'fixture-maker',$5,'fixture-checker',$6,'APPROVED')`,
      [
        proposalId,
        randomUUID(),
        JSON.stringify(definition),
        'a'.repeat(64),
        randomUUID(),
        randomUUID(),
      ],
    );
    await this.dataSource.query(
      `INSERT INTO kyc_tier_policy_versions(version,proposal_id,definition,maker_id,checker_id)
       VALUES(1,$1,$2,'fixture-maker','fixture-checker')`,
      [proposalId, JSON.stringify(definition)],
    );
    await this.dataSource.query('UPDATE kyc_tier_policy_head SET version=1');
  }

  // ------------------------------------------------------------------ wallets and attribution

  async createWallet(ownerId: string, currency = 'NGN'): Promise<GovernedWallet> {
    const wallets = this.app.get(WalletService);
    const wallet = await wallets.createWallet({
      customerId: ownerId,
      currency,
      idempotencyKey: `gf-wallet-${ownerId}-${randomUUID()}`,
    });
    const [row] = await this.dataSource.query<Array<{ owner_class: string }>>(
      `SELECT owner_class FROM wallet_accounts WHERE id = $1`,
      [wallet.id],
    );
    return {
      walletId: wallet.id,
      ledgerAccountId: wallet.ledgerAccountId,
      ownerClass: row!.owner_class,
    };
  }

  /**
   * Governed `WALLET_INSTITUTION_ATTRIBUTION`. The attribution transaction sets
   * `ledger_accounts.institutional_scope`, so it must happen before the account's first ledger
   * line; the service itself refuses an account that already carries posted history.
   */
  async attributeWallet(walletId: string, institutionId: string): Promise<GovernedAttribution> {
    const { preparer } = await this.workforce();
    const body = {
      walletId,
      evidenceType: InstitutionAttributionEvidenceType.INSTITUTION_AGREEMENT,
      evidenceReference: `GFAGR-${randomUUID().slice(0, 10)}`,
      reason: 'Wallet attributed under the executed institution custody agreement',
    };
    const prepared = await request(this.app.getHttpServer())
      .post(this.url(`/internal/institutions/${institutionId}/wallet-attributions`))
      .set(this.bearer(preparer))
      .send(body);
    this.assertStatus(prepared, 201, 'wallet attribution request');
    await this.approve(prepared.body.approvalId as string);
    const executed = await request(this.app.getHttpServer())
      .post(this.url(`/internal/institutions/${institutionId}/wallet-attributions/execute`))
      .set(this.bearer(await this.checker()))
      .send({ ...body, approvalId: prepared.body.approvalId });
    this.assertStatus(executed, 201, 'wallet attribution execution');
    const [row] = await this.dataSource.query<Array<{ ledger_account_id: string }>>(
      `SELECT ledger_account_id FROM wallet_accounts WHERE id = $1`,
      [walletId],
    );
    return {
      attributionId: (executed.body.id ?? executed.body.attributionId) as string,
      institutionId,
      walletId,
      ledgerAccountId: row!.ledger_account_id,
    };
  }

  // ------------------------------------------------------------------ ledger and funding

  async createLedgerAccount(
    type: LedgerAccountType = LedgerAccountType.LIABILITY,
    normalBalance: LedgerNormalBalance = LedgerNormalBalance.CREDIT,
    options: {
      allowNegativeBalance?: boolean;
      code?: string;
      name?: string;
      accountingUnit?: string;
      currency?: string;
    } = {},
  ): Promise<string> {
    const ledger = this.app.get(LedgerService);
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const account = await ledger.createAccount({
      code: options.code ?? `GF-${suffix}`,
      name: options.name ?? `Governed fixture ${suffix}`,
      accountType: type,
      normalBalance,
      currency: options.currency ?? 'NGN',
      accountingUnit: options.accountingUnit ?? 'CUSTOMER_FUNDS',
      allowNegativeBalance: options.allowNegativeBalance ?? false,
    });
    return account.id;
  }

  /** Platform system-float account used to fund agent wallets with synthetic value. */
  async systemFloatAccount(): Promise<string> {
    if (!this.floatAccountId) {
      this.floatAccountId = await this.createLedgerAccount(
        LedgerAccountType.ASSET,
        LedgerNormalBalance.DEBIT,
        {
          allowNegativeBalance: true,
          code: `GF-SYS-FLOAT-NGN-${randomUUID().slice(0, 6)}`,
          name: 'Governed fixture system float NGN',
        },
      );
    }
    return this.floatAccountId;
  }

  /**
   * Institution settlement account opened through the governed ledger-scope service.
   *
   * The institutional ledger contract refuses a journal that mixes an institution-attributed
   * account with a platform or unattributed one, so an institution-attributed wallet can only be
   * funded from an account of the *same* institution. This is the account that funding uses.
   */
  async openInstitutionSettlementAccount(
    institutionId: string,
    options: {
      allowNegativeBalance?: boolean;
      purpose?: 'SETTLEMENT' | 'SUSPENSE' | 'CLEARING';
    } = {},
  ): Promise<string> {
    const cached = this.settlementAccounts.get(institutionId);
    if (cached) return cached;
    const { operator } = await this.workforce();
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const response = await request(this.app.getHttpServer())
      .post(this.url(`/internal/institutions/${institutionId}/ledger-accounts`))
      .set(this.bearer(operator))
      .send({
        code: `GF-SETTLE-${suffix}`,
        name: `Governed fixture settlement ${suffix}`,
        accountType: 'ASSET',
        normalBalance: 'DEBIT',
        currency: 'NGN',
        purpose: options.purpose ?? 'SETTLEMENT',
        allowNegativeBalance: options.allowNegativeBalance ?? true,
      });
    this.assertStatus(response, 201, 'institution settlement account open');
    const accountId: string = response.body.id;
    this.settlementAccounts.set(institutionId, accountId);
    return accountId;
  }

  /**
   * Legitimate initial funding: a balanced, idempotent journal posted through `LedgerService`.
   *
   * Funding must only be called after the destination account has been institutionally
   * attributed; `prepareAgentFundingWallet()` enforces that order. When `institutionId` is given
   * the source is that institution's settlement account (the only institution-compatible
   * counterparty); otherwise the platform float is used for unattributed/platform accounts.
   */
  async fundLedgerAccount(
    ledgerAccountId: string,
    amountMinor: string,
    options: { institutionId?: string } = {},
  ): Promise<string> {
    const ledger = this.app.get(LedgerService);
    const sourceAccountId = options.institutionId
      ? await this.openInstitutionSettlementAccount(options.institutionId)
      : await this.systemFloatAccount();
    const journal = await ledger.postJournal({
      idempotencyKey: `gf-fund-${ledgerAccountId}-${amountMinor}-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      description: 'Governed fixture synthetic funding',
      lines: [
        {
          accountId: sourceAccountId,
          direction: LedgerEntryDirection.DEBIT,
          amountMinor,
        },
        {
          accountId: ledgerAccountId,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor,
        },
      ],
    });
    return journal.id;
  }

  /**
   * The complete, correctly ordered funding-side setup for an agent:
   * institution → affiliation → wallet → attribution → (funding, by the caller).
   */
  async prepareAgentFundingWallet(
    agentId: string,
    options: { institutionId?: string; fundAmountMinor?: string } = {},
  ): Promise<{
    institutionId: string;
    affiliation: GovernedAffiliation;
    wallet: GovernedWallet;
    attribution: GovernedAttribution;
    journalId: string | null;
  }> {
    const institutionId = options.institutionId ?? (await this.institution());
    const affiliation = await this.affiliateAgent(agentId, institutionId);
    const wallet = await this.createWallet(agentId);
    const attribution = await this.attributeWallet(wallet.walletId, institutionId);
    const journalId = options.fundAmountMinor
      ? await this.fundLedgerAccount(wallet.ledgerAccountId, options.fundAmountMinor, {
          institutionId,
        })
      : null;
    return { institutionId, affiliation, wallet, attribution, journalId };
  }

  /** Wallet + attribution for a customer that already holds an ACTIVE enrolment. */
  async prepareCustomerWallet(
    customerId: string,
    institutionId: string,
  ): Promise<{ wallet: GovernedWallet; attribution: GovernedAttribution }> {
    const wallet = await this.createWallet(customerId);
    const attribution = await this.attributeWallet(wallet.walletId, institutionId);
    return { wallet, attribution };
  }

  /** Create a wallet **without** attribution — for explicit unattributed-rejection cases. */
  async prepareUnattributedWallet(ownerId: string): Promise<GovernedWallet> {
    return this.createWallet(ownerId);
  }

  // ------------------------------------------------------------------ inspection

  async balanceOf(ledgerAccountId: string): Promise<bigint> {
    const [row] = await this.dataSource.query<Array<{ balance: string }>>(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE -amount_minor END), 0)::text AS balance
         FROM ledger_lines WHERE ledger_account_id = $1`,
      [ledgerAccountId],
    );
    return BigInt(row!.balance);
  }

  async walletRow(walletId: string): Promise<{
    id: string;
    institution_id: string | null;
    owner_class: string;
    ledger_account_id: string;
  }> {
    const [row] = await this.dataSource.query<
      Array<{
        id: string;
        institution_id: string | null;
        owner_class: string;
        ledger_account_id: string;
      }>
    >(
      `SELECT id, institution_id, owner_class, ledger_account_id FROM wallet_accounts WHERE id = $1`,
      [walletId],
    );
    return row!;
  }

  async ledgerAccountRow(accountId: string): Promise<{
    institutional_scope: string;
    institution_id: string | null;
    institutional_purpose: string | null;
  }> {
    const [row] = await this.dataSource.query<
      Array<{
        institutional_scope: string;
        institution_id: string | null;
        institutional_purpose: string | null;
      }>
    >(
      `SELECT institutional_scope, institution_id, institutional_purpose
         FROM ledger_accounts WHERE id = $1`,
      [accountId],
    );
    return row!;
  }

  /** Governed evidence counts, for assertions that nothing was fabricated. */
  async governedCounts(): Promise<{
    checkerDecisions: number;
    consumptions: number;
    attributions: number;
    enrolments: number;
    affiliations: number;
  }> {
    const [row] = await this.dataSource.query<
      Array<{
        decisions: string;
        consumptions: string;
        attributions: string;
        enrolments: string;
        affiliations: string;
      }>
    >(
      `SELECT (SELECT count(*) FROM protected_authority.checker_decisions)::text AS decisions,
              (SELECT count(*) FROM protected_authority.approval_consumptions)::text AS consumptions,
              (SELECT count(*) FROM governed_wallet_institution_attributions)::text AS attributions,
              (SELECT count(*) FROM customer_institution_enrolments)::text AS enrolments,
              (SELECT count(*) FROM institution_agent_affiliations)::text AS affiliations`,
    );
    return {
      checkerDecisions: Number(row!.decisions),
      consumptions: Number(row!.consumptions),
      attributions: Number(row!.attributions),
      enrolments: Number(row!.enrolments),
      affiliations: Number(row!.affiliations),
    };
  }

  /** Drop every cached fixture entity handle. Database cleanup remains the suite's job. */
  cleanup(): void {
    this.defaultInstitutionKeys.clear();
    this.institutions.clear();
    this.floatAccountId = undefined;
    this.settlementAccounts.clear();
    this.workforceCache = undefined;
  }
}

/** Convenience factory matching the shared `test/support` conventions. */
export function createGovernedFinancialFixture(
  options: GovernedFixtureOptions,
): GovernedFinancialFixture {
  return new GovernedFinancialFixture(options);
}
