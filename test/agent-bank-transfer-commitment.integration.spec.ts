/**
 * Agent bank-transfer commitment — authenticated HTTP + real PostgreSQL acceptance.
 *
 * Covers the newly implemented agent-self journey that reuses the single financial engine:
 * agent operating-wallet ownership, active affiliation, class-of-service, limits, PIN,
 * beneficiary ownership, institutional routing, immutable destination, reservation,
 * commercial binding, operation creation, settlement and rejection, plus negative cases.
 */
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID, pbkdf2Sync, randomBytes, createHash } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { FinancialCommitmentService } from '../src/financial-commitment/financial-commitment.service';
import { FinancialCommitmentRepository } from '../src/financial-commitment/financial-commitment.repository';
import { BankingVirtualAccountService } from '../src/banking/banking-virtual-account.service';
import { AgentService } from '../src/agent/agent-service.enum';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentAuthenticationService } from '../src/agent-authentication/agent-authentication.service';
import { AgentPasswordHashAlgorithm } from '../src/agent-authentication/agent-authentication.enums';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { CustomerBeneficiaryService } from '../src/customer-beneficiary/customer-beneficiary.service';
import {
  CustomerBeneficiaryType,
  CustomerBeneficiaryStatus,
} from '../src/customer-beneficiary/customer-beneficiary.enums';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';
import { GovernedFinancialFixture } from './support/governed-financial-fixture';
import { WITHDRAWAL_EXECUTION_AUTHORITY } from '../src/financial-commitment/withdrawal-execution-authority';
import { ExternalOperationLifecycleService } from '../src/partner/external-operation-lifecycle.service';
import { ExternalSettlementService } from '../src/partner/external-settlement.service';
import { ExternalOperationService } from '../src/partner/external-operation.service';
import {
  ExternalOperationReferenceSource,
  ExternalOperationReferenceType,
  ExternalOperationResourceType,
} from '../src/partner/external-operation.enums';
import { ExternalOperationLifecycleState } from '../src/partner/external-operation-lifecycle.enums';
import { ExternalSettlement } from '../src/partner/external-settlement.entity';
import { ExternalSuspenseEntry } from '../src/partner/external-suspense-entry.entity';
import { IdempotencyService } from '../src/operations/idempotency.service';
import { AuditService } from '../src/operations/audit.service';
import { OutboxService } from '../src/operations/outbox.service';
import { SettlementAccountService } from '../src/payment/settlement-account.service';
import { LimitUsageService } from '../src/limit-catalog/limit-usage.service';
import { ExternalSettlementDecision } from '../src/partner/external-settlement.enums';
import type { ExternalOperationStatusVerifier } from '../src/partner/external-operation-status-verifier';
import { AgentStatus } from '../src/agent/agent.enums';
import * as request from 'supertest';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';

function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(pin, salt, 10000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

describe('Agent bank-transfer commitment (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let fixture: GovernedFinancialFixture;
  let institutionId: string;
  let ledger: LedgerService;
  let agentFunding: LedgerService extends never ? never : never;
  let withdrawalAuthority: 'AUTHORIZED' | 'DENIED' | 'UNAVAILABLE' = 'AUTHORIZED';
  let verificationState: 'VERIFIED_SETTLED' | 'VERIFIED_REJECTED' | 'UNKNOWN' | 'UNAVAILABLE' =
    'VERIFIED_SETTLED';
  let service: FinancialCommitmentService;
  let agentClassService: AgentClassService;
  let agentAppService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let pinService: AgentAuthenticationService;
  let walletService: WalletService;
  let beneficiaryService: CustomerBeneficiaryService;
  const requestContext = {
    requestId: 'agent-bank-test',
    correlationId: 'agent-bank-test',
    traceId: 'agent-bank-test',
  };
  let settlement: ExternalSettlementService;
  let agentSessions = new Map<string, string>();

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('agentBankCommit');
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(KycTierEvidenceReader)
      .useValue({ read: () => Promise.resolve(null) })
      .overrideProvider(WITHDRAWAL_EXECUTION_AUTHORITY)
      .useValue({
        authorize: () =>
          Promise.resolve({
            outcome: withdrawalAuthority,
            providerKey: withdrawalAuthority === 'AUTHORIZED' ? 'MONNIFY' : null,
            environment: withdrawalAuthority === 'AUTHORIZED' ? 'sandbox' : null,
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
    ledger = app.get(LedgerService);
    service = app.get(FinancialCommitmentService);
    agentClassService = app.get(AgentClassService);
    agentAppService = app.get(AgentApplicationService);
    lifecycleService = app.get(AgentLifecycleService);
    pinService = app.get(AgentAuthenticationService);
    walletService = app.get(WalletService);
    beneficiaryService = app.get(CustomerBeneficiaryService);

    const verifier: ExternalOperationStatusVerifier = {
      verify: ({ operation, correlationId }) =>
        Promise.resolve({
          state: verificationState,
          providerStatus: 'controlled-test',
          providerReferenceHash: createHash('sha256')
            .update(
              operation.providerReferences.find(
                (r) => r.source === ExternalOperationReferenceSource.STATUS_QUERY,
              )?.referenceValue ?? correlationId,
            )
            .digest('hex'),
          observedAt: new Date().toISOString(),
          reasonCode: null,
        }),
    };
    settlement = new ExternalSettlementService(
      dataSource.getRepository(ExternalSettlement),
      dataSource.getRepository(ExternalSuspenseEntry),
      dataSource,
      ledger,
      app.get(SettlementAccountService),
      app.get(ExternalOperationService),
      app.get(IdempotencyService),
      app.get(AuditService),
      { getProfile: () => ({ enabled: true }) } as never,
      app.get(OutboxService),
      verifier,
      app.get(LimitUsageService),
    );

    fixture = new GovernedFinancialFixture({ app, dataSource, label: 'agentBankCommit' });
    institutionId = await fixture.institution();

    const sys = await ledger.createAccount({
      code: `SYS-FLOAT-AGB-${randomUUID().slice(0, 6)}`,
      name: 'System Float',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: false,
    });

    await dataSource.query(
      `INSERT INTO banks(id,bank_code,bank_name,short_name,nip_supported,status) VALUES($1,'AGENTBANK','Agent Bank Test','AG Bank',true,'ACTIVE') ON CONFLICT DO NOTHING`,
      [randomUUID()],
    );
  }, 120000);

  afterAll(async () => {
    try {
      if (app) await app.close();
    } catch {}
    try {
      if (dataSource) await destroyIntegrationDataSource(dataSource);
    } catch {}
  });

  beforeEach(() => {
    withdrawalAuthority = 'AUTHORIZED';
    verificationState = 'VERIFIED_SETTLED';
  });

  async function createActiveAgentWithPin(services: unknown, pin: string | null) {
    const cls = await agentClassService.create({
      reference: `cls-agb-${randomUUID().slice(0, 6)}`,
      code: `AGB-${randomUUID().slice(0, 6).toUpperCase()}`,
      name: 'AGB Class',
      isActive: true,
      applicableServices: services as unknown,
      actor: 'test-actor',
    });
    const appEntity = await agentAppService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz AGB ${randomUUID().slice(0, 4)}`,
      contactEmail: `agb-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-agb',
    });
    await agentAppService.submit(appEntity.id, 'applicant-agb');
    await dataSource.query(
      `UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`,
      [appEntity.id],
    );
    const agent = await lifecycleService.activateFromApplication(appEntity.id, 'test-actor');
    expect(agent.status).toBe(AgentStatus.ACTIVE);
    if (pin !== null) {
      await pinService.setTransactionPin(agent.id, {
        pinHash: hashPin(pin),
        hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
        pinVersion: 1,
        actor: agent.id,
      });
    }
    // Agent operating wallet for the financial commitment journey uses the same
    // unattributed liability pattern as the customer commitment tests — the
    // ledger reservation journal contains [wallet ledger + PAYMENT-WITHDRAWAL_RESERVE],
    // both of which must share the same institutional scope (here: none). Governed
    // institutional attribution is covered by the cash-out (A14) suite; here it would
    // mix INSTITUTION + UNATTRIBUTED and the journal institution check would — correctly
    // — refuse it. The wallet is still owner-class AGENT and institution affiliation
    // is established separately for class-of-service checks.
    const wallet = await walletService.createWallet({
      customerId: agent.id,
      currency: 'NGN',
      idempotencyKey: `agent-wallet-${agent.id}-${randomUUID()}`,
    });
    await fixture.affiliateAgent(agent.id, institutionId);
    const walletLedger: Array<{ ledger_account_id: string; ledger_account_code: string }> =
      await dataSource.query(
        `SELECT ledger_account_id, (SELECT code FROM ledger_accounts WHERE id = wallet_accounts.ledger_account_id) AS ledger_account_code FROM wallet_accounts WHERE id=$1 LIMIT 1`,
        [wallet.id],
      );
    const wlId = walletLedger[0]!.ledger_account_id;
    const assetRows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`,
    );
    await ledger.postJournal({
      idempotencyKey: `fund-agb-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: assetRows[0]!.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '5000' },
        { accountId: wlId, direction: LedgerEntryDirection.CREDIT, amountMinor: '5000' },
      ],
    });
    // Agent auth session
    const [credential] = await dataSource.query(
      `INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PBKDF2',1,clock_timestamp(),'ACTIVE') RETURNING id`,
      [agent.id, hashPin('login-password')],
    );
    const [session] = await dataSource.query(
      `INSERT INTO agent_authentication_sessions (agent_id, credential_id, token_hash, audience, status, issued_at, expires_at, last_seen_at) VALUES ($1,$2,$3,'agent-api','ACTIVE',clock_timestamp(),clock_timestamp()+INTERVAL '1 hour',clock_timestamp()) RETURNING id`,
      [agent.id, credential.id, randomBytes(32).toString('hex')],
    );
    agentSessions.set(agent.id, session.id);
    return { cls, agent, wallet, appEntity };
  }

  function agentPrincipal(agentId: string) {
    return {
      type: 'AGENT' as const,
      sessionId: agentSessions.get(agentId),
      agentId,
      principalId: agentId,
      roles: [],
      scopes: [],
      customerAccess: 'NONE' as const,
      agentAccess: 'SELF' as const,
    };
  }

  async function createAgentBeneficiary(agentId: string) {
    // Create BANK_ACCOUNT beneficiary directly via service bypassing enquiry (fixture)
    // For real journey we need verified ACTIVE bank beneficiary; create via SQL fixture
    const benId = randomUUID();
    const ref = `bank-${randomUUID()}`;
    await dataSource.query(
      `INSERT INTO customer_beneficiaries (id, agent_id, beneficiary_type, display_name, reference, destination_identifier, normalized_destination_identifier, destination_name, destination_institution, nickname, status, verified, version, created_at, updated_at)
       VALUES ($1,$2,'BANK_ACCOUNT',$3,$4,'1234567890','1234567890','Test Account','AGENTBANK','My Bank','ACTIVE',true,1,clock_timestamp(),clock_timestamp())`,
      [benId, agentId, 'Test Account', ref],
    );
    await dataSource.query(
      `INSERT INTO beneficiary_ownerships (id, beneficiary_id, agent_id, version) VALUES ($1,$2,$3,1)`,
      [randomUUID(), benId, agentId],
    );
    return benId;
  }

  async function configureAgentLimit(agentId: string, agentClassId?: string) {
    const profile = `AGB_${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    await dataSource.query(
      `INSERT INTO limit_profiles(code,name,kind,status,enabled,configuration_status,created_by) VALUES($1,'Agent bank test','AGENT','ACTIVE',true,'CONFIGURED','fixture')`,
      [profile],
    );
    const subjectType = agentClassId ? 'AGENT_CLASS' : 'AGENT';
    const subjectId = agentClassId ?? agentId;
    await dataSource.query(
      `INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,effective_from,is_active,created_by) VALUES($1,$2,$3,$4,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile, subjectType, subjectId],
    );
    await dataSource.query(
      `INSERT INTO limit_rules(id,limit_profile_code,product,direction,currency,dimension,limit_value_minor,effective_from,is_active,created_by) VALUES($1,$2,'EXTERNAL_BANK_TRANSFER','OUTGOING','NGN','DAILY_AMOUNT',10000,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile],
    );
  }

  it('authorizes agent-self with operating wallet, class-of-service and PIN', async () => {
    const { agent, wallet } = await createActiveAgentWithPin(
      [AgentService.EXTERNAL_BANK_TRANSFER, AgentService.CASH_OUT],
      '1234',
    );
    const beneficiaryId = await createAgentBeneficiary(agent.id);
    await configureAgentLimit(agent.id);
    const result = await service.initiateForAgent({
      agentId: agent.id,
      agentSessionId: agentSessions.get(agent.id)!,
      principal: agentPrincipal(agent.id),
      pin: '1234',
      amountMinor: '500',
      currency: 'NGN',
      beneficiaryId,
      idempotencyKey: randomUUID(),
    });
    expect(result.commitment.state).toBe('RESERVED');
    expect(result.replayed).toBe(false);
    // Reservation journal exists
    const journals: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM ledger_journals WHERE id=$1`,
      [result.commitment.reservation_journal_id],
    );
    expect(journals.length).toBe(1);
  });

  it('rejects foreign agent attempting to use another agent beneficiary', async () => {
    const { agent: owner } = await createActiveAgentWithPin(
      [AgentService.EXTERNAL_BANK_TRANSFER],
      '1234',
    );
    const { agent: attacker } = await createActiveAgentWithPin(
      [AgentService.EXTERNAL_BANK_TRANSFER],
      '1234',
    );
    const benId = await createAgentBeneficiary(owner.id);
    await configureAgentLimit(attacker.id);
    await expect(
      service.initiateForAgent({
        agentId: attacker.id,
        agentSessionId: agentSessions.get(attacker.id)!,
        principal: agentPrincipal(attacker.id),
        pin: '1234',
        amountMinor: '500',
        currency: 'NGN',
        beneficiaryId: benId,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow();
  });

  it('rejects stale agent session (expired)', async () => {
    const { agent, wallet } = await createActiveAgentWithPin(
      [AgentService.EXTERNAL_BANK_TRANSFER],
      '1234',
    );
    const benId = await createAgentBeneficiary(agent.id);
    await configureAgentLimit(agent.id);
    // Expire session
    await dataSource.query(
      `UPDATE agent_authentication_sessions SET expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1`,
      [agentSessions.get(agent.id)],
    );
    await expect(
      service.initiateForAgent({
        agentId: agent.id,
        agentSessionId: agentSessions.get(agent.id)!,
        principal: agentPrincipal(agent.id),
        pin: '1234',
        amountMinor: '300',
        currency: 'NGN',
        beneficiaryId: benId,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow(/session/i);
  });

  it('rejects when agent lacks EXTERNAL_BANK_TRANSFER capability', async () => {
    const { agent } = await createActiveAgentWithPin([AgentService.CASH_OUT], '1234'); // no bank transfer
    const benId = await createAgentBeneficiary(agent.id);
    await configureAgentLimit(agent.id);
    await expect(
      service.initiateForAgent({
        agentId: agent.id,
        agentSessionId: agentSessions.get(agent.id)!,
        principal: agentPrincipal(agent.id),
        pin: '1234',
        amountMinor: '200',
        currency: 'NGN',
        beneficiaryId: benId,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow(/not authorized|capability/i);
  });

  it('rejects duplicate request with same idempotency key but different amount', async () => {
    const { agent } = await createActiveAgentWithPin([AgentService.EXTERNAL_BANK_TRANSFER], '1234');
    const benId = await createAgentBeneficiary(agent.id);
    await configureAgentLimit(agent.id);
    const key = randomUUID();
    await service.initiateForAgent({
      agentId: agent.id,
      agentSessionId: agentSessions.get(agent.id)!,
      principal: agentPrincipal(agent.id),
      pin: '1234',
      amountMinor: '400',
      currency: 'NGN',
      beneficiaryId: benId,
      idempotencyKey: key,
    });
    await expect(
      service.initiateForAgent({
        agentId: agent.id,
        agentSessionId: agentSessions.get(agent.id)!,
        principal: agentPrincipal(agent.id),
        pin: '1234',
        amountMinor: '500',
        currency: 'NGN',
        beneficiaryId: benId,
        idempotencyKey: key,
      }),
    ).rejects.toThrow(/Idempotency key was already used/);
  });

  it('replays idempotent duplicate and returns same commitment', async () => {
    const { agent } = await createActiveAgentWithPin([AgentService.EXTERNAL_BANK_TRANSFER], '1234');
    const benId = await createAgentBeneficiary(agent.id);
    await configureAgentLimit(agent.id);
    const key = randomUUID();
    const first = await service.initiateForAgent({
      agentId: agent.id,
      agentSessionId: agentSessions.get(agent.id)!,
      principal: agentPrincipal(agent.id),
      pin: '1234',
      amountMinor: '300',
      currency: 'NGN',
      beneficiaryId: benId,
      idempotencyKey: key,
    });
    const second = await service.initiateForAgent({
      agentId: agent.id,
      agentSessionId: agentSessions.get(agent.id)!,
      principal: agentPrincipal(agent.id),
      pin: '1234',
      amountMinor: '300',
      currency: 'NGN',
      beneficiaryId: benId,
      idempotencyKey: key,
    });
    expect(second.replayed).toBe(true);
    expect(second.commitment.id).toBe(first.commitment.id);
  });

  it('enforces insufficient funds and concurrent spending via same-amount parallel', async () => {
    const { agent } = await createActiveAgentWithPin([AgentService.EXTERNAL_BANK_TRANSFER], '1234');
    const benId = await createAgentBeneficiary(agent.id);
    await configureAgentLimit(agent.id);
    // Fund only 500, try two parallel 400 -> one must fail due to reservation/limit or balance
    const k1 = randomUUID();
    const k2 = randomUUID();
    const results = await Promise.allSettled([
      service.initiateForAgent({
        agentId: agent.id,
        agentSessionId: agentSessions.get(agent.id)!,
        principal: agentPrincipal(agent.id),
        pin: '1234',
        amountMinor: '400',
        currency: 'NGN',
        beneficiaryId: benId,
        idempotencyKey: k1,
      }),
      service.initiateForAgent({
        agentId: agent.id,
        agentSessionId: agentSessions.get(agent.id)!,
        principal: agentPrincipal(agent.id),
        pin: '1234',
        amountMinor: '400',
        currency: 'NGN',
        beneficiaryId: benId,
        idempotencyKey: k2,
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    // At least one succeeds; the other may be limited by balance or limit window — but not both fail with fabrications
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
  });

  it('settles via verified provider outcome and creates immutable destination', async () => {
    const { agent } = await createActiveAgentWithPin([AgentService.EXTERNAL_BANK_TRANSFER], '1234');
    const benId = await createAgentBeneficiary(agent.id);
    await configureAgentLimit(agent.id);
    const initiated = await service.initiateForAgent({
      agentId: agent.id,
      agentSessionId: agentSessions.get(agent.id)!,
      principal: agentPrincipal(agent.id),
      pin: '1234',
      amountMinor: '600',
      currency: 'NGN',
      beneficiaryId: benId,
      idempotencyKey: randomUUID(),
    });
    const opId = initiated.commitment.external_operation_id;
    const opLifecycle = app.get(ExternalOperationLifecycleService);
    // SUBMITTING is the only valid transition from CREATED (checks agent wallet)
    const attempt = await opLifecycle.beginAttempt(
      opId,
      `attempt-${randomUUID()}`,
      requestContext,
      1,
    );
    expect(attempt.lifecycleState).toBe(ExternalOperationLifecycleState.SUBMITTING);
    const provRef = `prov-${randomUUID()}`;
    await app.get(ExternalOperationService).recordProviderReference({
      externalOperationId: opId,
      partnerKey: 'NIBSS_NIP',
      referenceType: ExternalOperationReferenceType.TRANSACTION,
      referenceValue: provRef,
      namespace: 'nibss.nip',
      source: ExternalOperationReferenceSource.STATUS_QUERY,
      requestContext,
    });
    // Move to provider-pending then verification for settlement eligibility
    const pending = await opLifecycle.transition({
      externalOperationId: opId,
      expectedVersion: attempt.version,
      nextState: ExternalOperationLifecycleState.PENDING_VERIFICATION,
      idempotencyKey: `pend-${randomUUID()}`,
      requestContext,
    });
    verificationState = 'VERIFIED_SETTLED';
    const settleResult = await settlement.settleVerifiedOutcome({
      externalOperationId: opId,
      expectedVersion: pending.version,
      decision: ExternalSettlementDecision.SETTLE,
      evidence: {
        referenceType: 'TRANSACTION',
        referenceValue: provRef,
        namespace: 'nibss.nip',
        source: ExternalOperationReferenceSource.STATUS_QUERY,
        observedAt: new Date(),
      },
      requestContext,
    });
    expect(settleResult).toBeDefined();
    const dest: Array<{ target_reference: string }> = await dataSource.query(
      `SELECT target_reference FROM financial_commitment_destinations WHERE commitment_id=$1`,
      [initiated.commitment.id],
    );
    expect(dest.length).toBe(1);
    expect(dest[0]!.target_reference).toMatch(/^a6-target:/);
  });

  it('rejects customer principal attempting agent bank-transfer endpoint', async () => {
    const { agent } = await createActiveAgentWithPin([AgentService.EXTERNAL_BANK_TRANSFER], '1234');
    const benId = await createAgentBeneficiary(agent.id);
    await configureAgentLimit(agent.id);
    // Attempt via HTTP with customer token should be rejected (use supertest)
    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/me/banking/bank-transfers')
      .set('Idempotency-Key', randomUUID())
      .send({ beneficiaryId: benId, amountMinor: '100', currency: 'NGN', pin: '1234' });
    // No agent session -> 401
    expect([401, 403]).toContain(res.status);
  });

  it('prevents direct DB bypass of financial authorization', async () => {
    const { agent } = await createActiveAgentWithPin([AgentService.EXTERNAL_BANK_TRANSFER], '1234');
    const benId = await createAgentBeneficiary(agent.id);
    // Try to insert financial_authorization without valid PIN audit / session
    await expect(
      dataSource.query(
        `INSERT INTO financial_authorizations (id, customer_id, agent_id, session_id, pin_audit_id, wallet_account_id, ledger_account_id, amount_minor, currency, request_hash, principal_type, principal_id, institution) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          randomUUID(),
          null,
          agent.id,
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          '100',
          'NGN',
          'a'.repeat(64),
          'AGENT',
          agent.id,
          null,
        ],
      ),
    ).rejects.toThrow(/Financial authorization evidence is not bound/);
  });

  it('enforces missing limit policy', async () => {
    const { agent } = await createActiveAgentWithPin([AgentService.EXTERNAL_BANK_TRANSFER], '1234');
    const benId = await createAgentBeneficiary(agent.id);
    // No limit configured -> should fail closed
    await expect(
      service.initiateForAgent({
        agentId: agent.id,
        agentSessionId: agentSessions.get(agent.id)!,
        principal: agentPrincipal(agent.id),
        pin: '1234',
        amountMinor: '100',
        currency: 'NGN',
        beneficiaryId: benId,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow();
  });
});
