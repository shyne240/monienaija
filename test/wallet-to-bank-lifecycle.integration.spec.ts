/**
 * Wallet → Bank (Monnify interim) lifecycle evidence on real disposable PostgreSQL.
 *
 * The suite drives the shared controls, not a mock of them: the authorized financial commitment
 * creates its ledger reservation and dispatch intent atomically; BankingOutboundService owns the
 * reference and the "never resubmit an uncertain operation" rule; the A6 settlement service posts
 * or releases only after an independent outcome verification. The provider is a deterministic
 * in-memory transport with call counters, so "no second transfer" is an assertion on call count.
 *
 * No live provider, credential, sandbox money movement or device is involved.
 */
import { createHash, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';

import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentAuthenticationService } from '../src/agent-authentication/agent-authentication.service';
import { AgentPasswordHashAlgorithm } from '../src/agent-authentication/agent-authentication.enums';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentService } from '../src/agent/agent-service.enum';
import { AgentTransactionAuthorizationService } from '../src/agent/agent-transaction-authorization.service';
import { BankingCommitmentBridgeService } from '../src/banking/banking-commitment-bridge.service';
import { BankingFeeBindingService } from '../src/banking/banking-fee-binding.service';
import { BankingOutboundService } from '../src/banking/banking-outbound.service';
import { BankingProviderRegistry, capabilitiesOf } from '../src/banking/banking-provider.registry';
import type { BankingProvider, TransferStatusResult } from '../src/banking/banking-provider.types';
import { AuthenticationExecutionService } from '../src/customer-authentication/authentication-execution.service';
import { AuthenticationSessionService } from '../src/customer-authentication/authentication-session.service';
import { PasswordHashVerificationService } from '../src/customer-authentication/password-hash-verification.service';
import { CustomerBeneficiaryService } from '../src/customer-beneficiary/customer-beneficiary.service';
import {
  CustomerBeneficiaryStatus,
  CustomerBeneficiaryType,
} from '../src/customer-beneficiary/customer-beneficiary.enums';
import { CustomerTransactionPinService } from '../src/customer/customer-transaction-pin.service';
import { FinancialCommitmentRepository } from '../src/financial-commitment/financial-commitment.repository';
import { FinancialCommitmentService } from '../src/financial-commitment/financial-commitment.service';
import { WITHDRAWAL_EXECUTION_AUTHORITY } from '../src/financial-commitment/withdrawal-execution-authority';
import {
  KycTierEvidenceReader,
  type TierEvidenceSnapshot,
} from '../src/kyc-verification/kyc-tier-evidence.reader';
import { KycTierWorker } from '../src/kyc-verification/kyc-tier-worker.service';
import { FinancialInstitutionService } from '../src/institution/financial-institution.service';
import { FinancialInstitutionType } from '../src/institution/institution.enums';
import { LedgerEntryDirection } from '../src/ledger/ledger.enums';
import { LedgerService } from '../src/ledger/ledger.service';
import { LimitEnforcementService } from '../src/limit-catalog/limit-enforcement.service';
import { LimitUsageService } from '../src/limit-catalog/limit-usage.service';
import { AuditService } from '../src/operations/audit.service';
import { IdempotencyService } from '../src/operations/idempotency.service';
import { OutboxService } from '../src/operations/outbox.service';
import { ExternalOperationLifecycleState } from '../src/partner/external-operation-lifecycle.enums';
import { ExternalOperationLifecycleService } from '../src/partner/external-operation-lifecycle.service';
import { ExternalOperationReferenceType } from '../src/partner/external-operation.enums';
import { ExternalOperationReferenceSource } from '../src/partner/external-operation.enums';
import { ExternalOperationService } from '../src/partner/external-operation.service';
import { ExternalSettlement } from '../src/partner/external-settlement.entity';
import { ExternalSettlementDecision } from '../src/partner/external-settlement.enums';
import { ExternalSettlementService } from '../src/partner/external-settlement.service';
import { ExternalSuspenseEntry } from '../src/partner/external-suspense-entry.entity';
import { LedgerReversalGovernanceService } from '../src/ledger/ledger-reversal-governance.service';
import { SettlementAccountService } from '../src/payment/settlement-account.service';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import { WalletFinancialBoundaryService } from '../src/wallet/wallet-financial-boundary.service';
import { WalletService } from '../src/wallet/wallet.service';
import { WithdrawalService } from '../src/withdrawal/withdrawal.service';
import { seedGovernedTierPolicy } from './support/kyc-test-fixtures';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  seedTransferParticipant,
} from './support/pg-harness';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const hashPin = (pin: string): string => {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(pin, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
};

const context = {
  requestId: 'w2b-lifecycle-request',
  correlationId: 'w2b-lifecycle-correlation',
  traceId: 'w2b-lifecycle-trace',
};

type SubmissionMode = 'timeout' | 'accepted' | 'rejected' | 'reversed';
type VerificationState = 'VERIFIED_SETTLED' | 'VERIFIED_REJECTED' | 'UNKNOWN' | 'UNAVAILABLE';

describe('Wallet → Bank lifecycle (real PostgreSQL, deterministic Monnify transport)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let commitments: FinancialCommitmentService;
  let outbound: BankingOutboundService;
  let lifecycle: ExternalOperationLifecycleService;
  let operationsService: ExternalOperationService;
  let settlement: ExternalSettlementService;
  let ledger: LedgerService;
  let registry: BankingProviderRegistry;
  let institutionId: string;
  let assetAccountId: string;
  let submissionMode: SubmissionMode;
  let statusOutcome: TransferStatusResult['outcome'];
  let verificationState: VerificationState;
  let submittedReferences: string[];
  let enquiries: string[];
  let nameEnquiries: number;
  const snapshots = new Map<string, TierEvidenceSnapshot>();
  const agentSessions = new Map<string, string>();
  let approvals: PrivilegedActionApprovalService;
  let institutions: FinancialInstitutionService;
  let institutionMaker: AuthorizationPrincipal;
  let attributionChecker: AuthorizationPrincipal;
  let agentClassService: AgentClassService;
  let agentApplicationService: AgentApplicationService;
  let agentLifecycleService: AgentLifecycleService;
  let agentPinService: AgentAuthenticationService;
  let walletService: WalletService;

  const provider: BankingProvider = {
    descriptor: {
      key: 'MONNIFY',
      displayName: 'Monnify (deterministic test transport)',
      environment: 'sandbox',
      capabilities: capabilitiesOf({
        OUTBOUND_TRANSFER_SUBMIT: true,
        TRANSFER_STATUS_ENQUIRY: true,
        ACCOUNT_NAME_ENQUIRY: true,
      }),
      descriptors: [],
    },
    enquireAccountName: (request) => {
      nameEnquiries += 1;
      return Promise.resolve({
        ok: true,
        value: {
          outcome: 'RESOLVED' as const,
          providerBankCode: request.providerBankCode,
          accountNumber: request.accountNumber,
          accountName: 'VERIFIED BENEFICIARY',
          establishesAccountOwnership: false as const,
          correlationId: context.correlationId,
        },
      });
    },
    submitOutboundTransfer: (request) => {
      submittedReferences.push(request.operationReference);
      if (submissionMode === 'timeout') return Promise.reject(new Error('deterministic timeout'));
      if (submissionMode === 'rejected')
        return Promise.resolve({
          ok: false,
          error: {
            category: 'PROVIDER_REJECTED',
            code: 'MONNIFY_REJECTED',
            detail: 'Documented provider refusal',
          },
        });
      return Promise.resolve({
        ok: true,
        value: {
          outcome: submissionMode === 'accepted' ? ('ACCEPTED' as const) : ('PENDING' as const),
          operationReference: request.operationReference,
          providerReference: `MNFY|LIFECYCLE|${request.operationReference}`,
          correlationId: context.correlationId,
        },
      });
    },
    getTransferStatus: (reference) => {
      enquiries.push(reference);
      const result: TransferStatusResult = {
        outcome: statusOutcome,
        operationReference: reference,
        providerReference: `MNFY|LIFECYCLE|${reference}`,
        providerStatus: statusOutcome.toUpperCase(),
        amountMinor: '1000',
        currency: 'NGN',
        correlationId: context.correlationId,
      };
      return Promise.resolve({ ok: true, value: result });
    },
  };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('w2blifecycle');
    registry = new BankingProviderRegistry();
    registry.register(provider);
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(BankingProviderRegistry)
      .useValue(registry)
      .overrideProvider(WITHDRAWAL_EXECUTION_AUTHORITY)
      .useValue({
        authorize: () =>
          Promise.resolve({
            outcome: 'AUTHORIZED' as const,
            providerKey: 'MONNIFY',
            environment: 'sandbox' as const,
          }),
      })
      .overrideProvider(KycTierEvidenceReader)
      .useValue({ read: (_m: unknown, id: string) => Promise.resolve(snapshots.get(id) ?? null) })
      .overrideProvider(KycTierWorker)
      .useValue({})
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
      .useValue(new TestNotificationProvider())
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();

    ledger = app.get(LedgerService);
    outbound = app.get(BankingOutboundService);
    lifecycle = app.get(ExternalOperationLifecycleService);
    operationsService = app.get(ExternalOperationService);
    approvals = app.get(PrivilegedActionApprovalService);
    institutions = app.get(FinancialInstitutionService);
    institutionMaker = {
      type: 'OPERATOR',
      principalId: 'w2b-institution-maker',
      sessionId: randomUUID(),
      roles: ['OPERATIONS'],
      scopes: ['institution.lifecycle.prepare'],
      customerAccess: 'NONE',
      agentAccess: 'NONE',
      assuranceLevel: 'MFA',
    } as AuthorizationPrincipal;
    attributionChecker = {
      type: 'OPERATOR',
      principalId: 'w2b-attribution-checker',
      sessionId: randomUUID(),
      roles: ['FINANCE_CONTROLLER'],
      scopes: [
        'institution.affiliation.approve',
        'institution.attribution.approve',
        'institution.lifecycle.approve',
        'privileged:approve',
        'privileged:execute',
      ],
      customerAccess: 'NONE',
      agentAccess: 'NONE',
      assuranceLevel: 'MFA',
    } as AuthorizationPrincipal;
    agentClassService = app.get(AgentClassService);
    agentApplicationService = app.get(AgentApplicationService);
    agentLifecycleService = app.get(AgentLifecycleService);
    agentPinService = app.get(AgentAuthenticationService);
    walletService = app.get(WalletService);

    commitments = new FinancialCommitmentService(
      dataSource,
      app.get(AuthenticationSessionService),
      app.get(CustomerTransactionPinService),
      app.get(PasswordHashVerificationService),
      app.get(WalletFinancialBoundaryService),
      app.get(LimitEnforcementService),
      app.get(WithdrawalService),
      operationsService,
      ledger,
      new FinancialCommitmentRepository(),
      {
        authorize: () =>
          Promise.resolve({
            outcome: 'AUTHORIZED' as const,
            providerKey: 'MONNIFY',
            environment: 'sandbox' as const,
          }),
      },
      // The lifecycle suite isolates provider dispatch/settlement. Institutional attribution is a
      // separate governed control proven by the attribution suites; here the bridge seam is given
      // the synthetic institution id so that the unattributed ledger accounts remain in one scope.
      {
        createDispatchIntentInTransaction: (manager: never, input: never) =>
          app.get(BankingCommitmentBridgeService).createDispatchIntentInTransaction(manager, {
            ...(input as { institutionId: string }),
            institutionId,
          } as never),
        recordObservation: (manager: never, input: never) =>
          app.get(BankingCommitmentBridgeService).recordObservation(manager, input),
      } as never,
      app.get(BankingFeeBindingService),
      app.get(AgentTransactionAuthorizationService),
    );

    settlement = new ExternalSettlementService(
      dataSource.getRepository(ExternalSettlement),
      dataSource.getRepository(ExternalSuspenseEntry),
      dataSource,
      ledger,
      app.get(SettlementAccountService),
      operationsService,
      app.get(IdempotencyService),
      app.get(AuditService),
      { getProfile: () => ({ enabled: true }) } as never,
      app.get(OutboxService),
      {
        verify: ({ operation }) => {
          const reference = operation.providerReferences.find(
            (r) => r.source === ExternalOperationReferenceSource.STATUS_QUERY,
          )?.referenceValue;
          return Promise.resolve({
            state: verificationState,
            providerStatus: statusOutcome.toUpperCase(),
            providerReferenceHash: reference ? sha256(reference) : null,
            observedAt: new Date().toISOString(),
            reasonCode: verificationState === 'UNKNOWN' ? 'PROVIDER_REVERSED' : null,
          });
        },
      },
      app.get(LimitUsageService),
    );
    // Institution registration, evidence and activation run through the governed service and the
    // same maker/checker approval stack as production. Nothing here bypasses a protected trigger.
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const registered = await institutions.register({
      reference: `W2B-${suffix}`,
      code: `W2B_${suffix}`,
      legalName: 'Lifecycle fixture institution',
      institutionType: FinancialInstitutionType.PARTNER,
      principal: institutionMaker,
    });
    institutionId = registered.id;
    await institutions.recordRegulatoryEvidence({
      institutionId,
      evidenceReference: `W2B-EVIDENCE-${suffix}`,
      regulatorName: 'Central Bank',
      licenceReference: `W2B-LIC-${suffix}`,
      principal: institutionMaker,
    });
    const lifecycleReason = 'Controlled test institution approved for synthetic wallet transfers';
    const lifecycleRequest = await institutions.requestLifecycleChange({
      institutionId,
      targetStatus: 'APPROVED' as never,
      reason: lifecycleReason,
      principal: institutionMaker,
    });
    const lifecycleDecision = await approvals.approve({
      principal: attributionChecker,
      approvalId: lifecycleRequest.approvalId,
      comment: 'Independently checked institution activation',
    });
    if (!lifecycleDecision.approved)
      throw new Error(`Institution activation approval failed: ${lifecycleDecision.reason}`);
    await institutions.executeLifecycleChange({
      institutionId,
      targetStatus: 'APPROVED' as never,
      reason: lifecycleReason,
      approvalId: lifecycleRequest.approvalId,
      principal: attributionChecker,
    });
    await seedGovernedTierPolicy(dataSource, {
      definition: {
        regulatoryRequirementsConfirmed: true,
        effectiveFrom: '2020-01-01T00:00:00.000Z',
        effectiveUntil: null,
        regulatory: {
          LEVEL_1: { all: [], any: [] },
          LEVEL_2: { all: [], any: [] },
          LEVEL_3: { all: [], any: [] },
        },
        operator: {
          LEVEL_1: { all: [], any: [] },
          LEVEL_2: { all: [], any: [] },
          LEVEL_3: { all: [], any: [] },
        },
      },
      makerId: 'w2b-fixture-maker',
      checkerId: 'w2b-fixture-checker',
    });
    const seeded = async (code: string): Promise<string> => {
      const rows: Array<{ id: string }> = await dataSource.query(
        `SELECT id FROM ledger_accounts WHERE code=$1 LIMIT 1`,
        [code],
      );
      if (!rows[0]) throw new Error(`Migration-seeded ledger account ${code} is missing`);
      return rows[0].id;
    };
    await seeded('PAYMENT-WITHDRAWAL_RESERVE-NGN');
    assetAccountId = await seeded('PAYMENT-SETTLEMENT_ASSET-NGN');
    await seeded('PAYMENT-SETTLEMENT_CLEARING-NGN');
    await seeded('PAYMENT-SYSTEM_SUSPENSE-NGN');
    await dataSource.query(
      `INSERT INTO banks(id,bank_code,bank_name,short_name,nip_supported,status)
       VALUES($1,'W2BBANK','Lifecycle Test Bank','W2B',true,'ACTIVE') ON CONFLICT DO NOTHING`,
      [randomUUID()],
    );
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close();
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60_000);

  beforeEach(() => {
    submissionMode = 'accepted';
    statusOutcome = 'SUCCESSFUL';
    verificationState = 'VERIFIED_SETTLED';
    submittedReferences = [];
    enquiries = [];
    nameEnquiries = 0;
  });

  async function createCustomerCommitment(amountMinor = '1000') {
    const suffix = randomUUID().slice(0, 8);
    const ledgerAccount = await ledger.createAccount({
      code: `W2B-CUST-${suffix}`,
      name: 'Customer funds',
      accountType: 'LIABILITY' as never,
      normalBalance: 'CREDIT' as never,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: false,
    });
    const participant = await seedTransferParticipant(dataSource, `w2b${suffix}`, ledgerAccount.id);
    await dataSource.query(
      `INSERT INTO customer_contact_methods(customer_id,type,value,normalized_value,is_primary,verified_at)
       VALUES($1,'PHONE',$2,$2,true,clock_timestamp())`,
      [participant.customerId, `phone-${suffix}`],
    );
    await dataSource.query(
      `INSERT INTO customer_kyc_assessments(customer_id,kyc_level,kyc_status,assessed_by,expires_at)
       VALUES($1,'LEVEL_1','APPROVED','fixture',clock_timestamp()+interval '1 hour')`,
      [participant.customerId],
    );
    snapshots.set(participant.customerId, {
      identityRevision: 'fixture',
      evidence: [
        {
          id: randomUUID(),
          customerId: participant.customerId,
          identityRevision: 'fixture',
          type: 'BVN',
          status: 'VERIFIED',
          provenance: 'VERIFIED_PROVIDER',
          verifiedAt: new Date(Date.now() - 10_000),
          expiresAt: new Date(Date.now() + 1_800_000),
        },
      ],
    });
    await ledger.postJournal({
      idempotencyKey: `w2b-fund-${suffix}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `w2b-fund-${suffix}`,
      lines: [
        { accountId: assetAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '10000' },
        {
          accountId: ledgerAccount.id,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor: '10000',
        },
      ],
    });
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials(id,customer_id,password_hash,hash_algorithm,password_version,status,mobile_otp_required)
       VALUES($1,$2,$3,'PBKDF2',1,'ACTIVE',false)`,
      [randomUUID(), participant.customerId, hashPin('password-123')],
    );
    await app.get(CustomerTransactionPinService).setTransactionPin(participant.customerId, {
      pinHash: hashPin('1234'),
      hashAlgorithm: 'PBKDF2',
      pinVersion: 1,
      actor: participant.customerId,
    });
    const authentication = await app.get(AuthenticationExecutionService).authenticate({
      customerId: participant.customerId,
      password: 'password-123',
      actor: participant.customerId,
    });
    if (!authentication.authenticated) throw new Error('Customer fixture authentication failed');
    const session = await app
      .get(AuthenticationSessionService)
      .issue({ authentication, actor: participant.customerId });
    const beneficiary = await app
      .get(CustomerBeneficiaryService)
      .createBeneficiary(participant.customerId, {
        type: CustomerBeneficiaryType.BANK_ACCOUNT,
        displayName: 'Lifecycle beneficiary',
        reference: `w2b-${suffix}`,
        destinationIdentifier: '0123456789',
        destinationInstitution: 'W2BBANK',
        actor: participant.customerId,
      });
    const beneficiaries = app.get(CustomerBeneficiaryService);
    await beneficiaries.verifyBeneficiary(participant.customerId, beneficiary.id, {
      verifiedBy: 'fixture',
      verificationMethod: 'controlled-test',
    });
    await beneficiaries.updateBeneficiary(participant.customerId, beneficiary.id, {
      status: CustomerBeneficiaryStatus.ACTIVE,
      actor: participant.customerId,
    });
    const initiated = await commitments.initiate({
      token: session.accessToken,
      pin: '1234',
      walletAccountId: participant.walletAccountId,
      beneficiaryId: beneficiary.id,
      amountMinor,
      currency: 'NGN',
      idempotencyKey: `w2b-${suffix}-${randomUUID()}`,
    });
    return initiated.commitment;
  }

  async function createAgentCommitment(amountMinor = '1000') {
    const cls = await agentClassService.create({
      reference: `cls-w2b-${randomUUID().slice(0, 6)}`,
      code: `W2B-${randomUUID().slice(0, 6).toUpperCase()}`,
      name: 'Lifecycle agent class',
      isActive: true,
      applicableServices: [AgentService.EXTERNAL_BANK_TRANSFER],
      actor: 'fixture',
    });
    const application = await agentApplicationService.create({
      agentClassId: cls.id,
      applicantReference: `w2b-${randomUUID()}`,
      businessName: `Lifecycle ${randomUUID().slice(0, 4)}`,
      contactEmail: `w2b-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'fixture',
    });
    await agentApplicationService.submit(application.id, 'fixture');
    await dataSource.query(
      `UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`,
      [application.id],
    );
    const agent = await agentLifecycleService.activateFromApplication(application.id, 'fixture');
    await agentPinService.setTransactionPin(agent.id, {
      pinHash: hashPin('1234'),
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      pinVersion: 1,
      actor: agent.id,
    });
    const wallet = await walletService.createWallet({
      customerId: agent.id,
      currency: 'NGN',
      idempotencyKey: `w2b-agent-wallet-${randomUUID()}`,
    });
    const walletRows: Array<{ ledger_account_id: string }> = await dataSource.query(
      `SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`,
      [wallet.id],
    );
    await ledger.postJournal({
      idempotencyKey: `w2b-agent-fund-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: assetAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '10000' },
        {
          accountId: walletRows[0]!.ledger_account_id,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor: '10000',
        },
      ],
    });
    const beneficiaryId = randomUUID();
    await dataSource.query(
      `INSERT INTO customer_beneficiaries
        (id,agent_id,beneficiary_type,display_name,reference,destination_identifier,
         normalized_destination_identifier,destination_name,destination_institution,status,verified,version)
       VALUES($1,$2,'BANK_ACCOUNT','Agent beneficiary',$3,'0123456789','0123456789',
              'VERIFIED BENEFICIARY','W2BBANK','ACTIVE',true,1)`,
      [beneficiaryId, agent.id, `w2b-agent-${randomUUID()}`],
    );
    await dataSource.query(
      `INSERT INTO beneficiary_ownerships(id,beneficiary_id,agent_id,version)
       VALUES($1,$2,$3,1)`,
      [randomUUID(), beneficiaryId, agent.id],
    );
    const profile = `W2BAG_${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    await dataSource.query(
      `INSERT INTO limit_profiles(code,name,kind,status,enabled,configuration_status,created_by)
       VALUES($1,'Agent lifecycle','AGENT','ACTIVE',true,'CONFIGURED','fixture')`,
      [profile],
    );
    await dataSource.query(
      `INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,effective_from,is_active,created_by)
       VALUES($1,$2,'AGENT',$3,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile, agent.id],
    );
    await dataSource.query(
      `INSERT INTO limit_rules(id,limit_profile_code,product,direction,currency,dimension,limit_value_minor,effective_from,is_active,created_by)
       VALUES($1,$2,'EXTERNAL_BANK_TRANSFER','OUTGOING','NGN','DAILY_AMOUNT',10000,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile],
    );
    const credentialRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_authentication_credentials
        (agent_id,password_hash,hash_algorithm,password_version,password_changed_at,status)
       VALUES($1,$2,'PBKDF2',1,clock_timestamp(),'ACTIVE') RETURNING id`,
      [agent.id, hashPin('login-password')],
    );
    const sessionRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_authentication_sessions
        (agent_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at)
       VALUES($1,$2,$3,'agent-api','ACTIVE',clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp())
       RETURNING id`,
      [agent.id, credentialRows[0]!.id, randomBytes(32).toString('hex')],
    );
    agentSessions.set(agent.id, sessionRows[0]!.id);
    const initiated = await commitments.initiateForAgent({
      agentId: agent.id,
      agentSessionId: sessionRows[0]!.id,
      principal: {
        type: 'AGENT',
        sessionId: sessionRows[0]!.id,
        agentId: agent.id,
        principalId: agent.id,
        roles: [],
        scopes: [],
        customerAccess: 'NONE',
        agentAccess: 'SELF',
      },
      pin: '1234',
      amountMinor,
      currency: 'NGN',
      beneficiaryId,
      idempotencyKey: `w2b-agent-${randomUUID()}`,
    });
    return initiated.commitment;
  }

  async function dispatchIntent(commitmentId: string) {
    const rows: Array<{
      id: string;
      operation_reference: string;
      amount_minor: string;
      destination_bank_code: string;
      destination_account_number: string;
      institution_id: string;
      wallet_id: string;
    }> = await dataSource.query(
      `SELECT id,operation_reference,amount_minor::text AS amount_minor,
              destination_bank_code,destination_account_number,institution_id,wallet_id
         FROM banking_outbound_operations WHERE external_operation_id=$1`,
      [commitmentId],
    );
    if (!rows[0]) throw new Error('No atomic banking dispatch intent was created');
    return rows[0];
  }

  function commandFor(intent: Awaited<ReturnType<typeof dispatchIntent>>) {
    return {
      institutionId: intent.institution_id,
      walletId: intent.wallet_id,
      providerKey: 'MONNIFY',
      environment: 'sandbox' as const,
      currency: 'NGN',
      amountMinor: intent.amount_minor,
      destinationBankCode: intent.destination_bank_code,
      destinationAccountNumber: intent.destination_account_number,
      // The commitment intentionally binds no display name; outbound resolves it from name enquiry.
      destinationAccountName: '',
      narration: `Outbound transfer ${intent.operation_reference}`,
      correlationId: context.correlationId,
    };
  }

  async function prepareForVerification(operationId: string, providerReference: string) {
    const attempt = await lifecycle.beginAttempt(operationId, `attempt-${randomUUID()}`, context);
    await operationsService.recordProviderReference({
      externalOperationId: operationId,
      partnerKey: 'NIBSS_NIP',
      referenceType: ExternalOperationReferenceType.TRANSACTION,
      referenceValue: providerReference,
      namespace: 'nibss.nip',
      source: ExternalOperationReferenceSource.STATUS_QUERY,
      requestContext: context,
    });
    return lifecycle.transition({
      externalOperationId: operationId,
      expectedVersion: attempt.version,
      nextState: ExternalOperationLifecycleState.PENDING_VERIFICATION,
      idempotencyKey: `pending-${randomUUID()}`,
      requestContext: context,
    });
  }

  async function settle(
    operationId: string,
    providerReference: string,
    prepared?: Awaited<ReturnType<typeof prepareForVerification>>,
  ) {
    const pending = prepared ?? (await prepareForVerification(operationId, providerReference));
    return settlement.settleVerifiedOutcome({
      externalOperationId: operationId,
      expectedVersion: pending.version,
      decision: ExternalSettlementDecision.SETTLE,
      evidence: {
        referenceType: 'TRANSACTION',
        referenceValue: providerReference,
        namespace: 'nibss.nip',
        source: ExternalOperationReferenceSource.STATUS_QUERY,
        observedAt: new Date(),
      },
      requestContext: context,
    });
  }

  async function bankRecord(commitmentId: string) {
    const rows: Array<{
      operation_reference: string;
      state: string;
      provider_status: string | null;
      provider_transaction_reference: string | null;
      destination_account_name: string | null;
      attempts: number;
    }> = await dataSource.query(
      `SELECT operation_reference,state,provider_status,provider_transaction_reference,
              destination_account_name,attempts
         FROM banking_outbound_operations WHERE external_operation_id=$1`,
      [commitmentId],
    );
    return rows[0]!;
  }

  it('customer transfer: timeout prompts one status lookup, retries cannot resend, and one journal posts', async () => {
    const commitment = await createCustomerCommitment();
    const intent = await dispatchIntent(commitment.external_operation_id);
    const command = commandFor(intent);

    submissionMode = 'timeout';
    const uncertain = await outbound.dispatch(intent.id, command);
    expect(uncertain.state).toBe('UNKNOWN');
    expect(submittedReferences).toEqual([intent.operation_reference]);

    // A second dispatch of the same prepared record must not reach the provider: an uncertain
    // submission is resolved by enquiry, never by sending the same commitment again.
    const retry = await outbound.dispatch(intent.id, command);
    expect(retry.state).toBe('UNKNOWN');
    expect(submittedReferences).toEqual([intent.operation_reference]);

    statusOutcome = 'SUCCESSFUL';
    const resolved = await outbound.enquire(intent.id, context.correlationId);
    expect(resolved.state).toBe('SUCCESSFUL');
    expect(resolved.operation_reference).toBe(intent.operation_reference);
    expect(enquiries).toEqual([intent.operation_reference]);
    expect(submittedReferences).toEqual([intent.operation_reference]);

    const record = await bankRecord(commitment.external_operation_id);
    expect(record.destination_account_name).toBe('VERIFIED BENEFICIARY');
    expect(nameEnquiries).toBe(1);
    expect(record.provider_transaction_reference).toBe(
      `MNFY|LIFECYCLE|${intent.operation_reference}`,
    );

    const providerReference = `MNFY|LIFECYCLE|${intent.operation_reference}`;
    const pending = await prepareForVerification(
      commitment.external_operation_id,
      providerReference,
    );
    const first = await settle(commitment.external_operation_id, providerReference, pending);
    expect(first.decision).toBe(ExternalSettlementDecision.SETTLE);
    expect(first.settlement?.journalId).toBeTruthy();
    const replay = await settle(commitment.external_operation_id, providerReference, pending);
    expect(replay.replayed).toBe(true);
    expect(replay.settlement?.journalId).toBe(first.settlement?.journalId);

    const journals: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM ledger_journals WHERE metadata->>'externalOperationId'=$1`,
      [commitment.external_operation_id],
    );
    // One reservation + one settlement journal, and no second settlement on replay.
    expect(journals).toHaveLength(2);
    const state: Array<{ state: string; withdrawal_status: string }> = await dataSource.query(
      `SELECT fc.state, w.status AS withdrawal_status FROM financial_commitments fc
       JOIN withdrawals w ON w.id=fc.withdrawal_id WHERE fc.external_operation_id=$1`,
      [commitment.external_operation_id],
    );
    expect(state[0]).toMatchObject({ state: 'SETTLED', withdrawal_status: 'COMPLETED' });
  });

  it('provider-reported FAILED releases the reservation without posting a settlement', async () => {
    const commitment = await createCustomerCommitment();
    const intent = await dispatchIntent(commitment.external_operation_id);
    submissionMode = 'accepted';
    statusOutcome = 'FAILED';
    await outbound.dispatch(intent.id, commandFor(intent));
    const resolved = await outbound.enquire(intent.id, context.correlationId);
    expect(resolved.state).toBe('FAILED');
    expect(resolved.provider_status).toBe('FAILED');
    expect(resolved.operation_reference).toBe(intent.operation_reference);

    const providerReference = `MNFY|LIFECYCLE|${intent.operation_reference}`;
    const pending = await prepareForVerification(
      commitment.external_operation_id,
      providerReference,
    );
    verificationState = 'VERIFIED_REJECTED';
    const released = await settlement.releaseReservedWithdrawal({
      externalOperationId: commitment.external_operation_id,
      expectedVersion: pending.version,
      requestContext: context,
    });
    expect(released.replayed).toBe(false);
    const settlements: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM external_settlements WHERE external_operation_id=$1`,
      [commitment.external_operation_id],
    );
    expect(settlements).toHaveLength(0);
    const state: Array<{ state: string }> = await dataSource.query(
      `SELECT state FROM financial_commitments WHERE external_operation_id=$1`,
      [commitment.external_operation_id],
    );
    expect(state[0]?.state).toBe('RELEASED');
  });

  it('provider REVERSED stays distinct from FAILED and cannot release or settle the reservation', async () => {
    const commitment = await createCustomerCommitment();
    const intent = await dispatchIntent(commitment.external_operation_id);
    submissionMode = 'accepted';
    statusOutcome = 'REVERSED';
    await outbound.dispatch(intent.id, commandFor(intent));
    const resolved = await outbound.enquire(intent.id, context.correlationId);
    expect(resolved.state).toBe('REVERSED');
    expect(resolved.provider_status).toBe('REVERSED');
    expect(resolved.operation_reference).toBe(intent.operation_reference);

    const providerReference = `MNFY|LIFECYCLE|${intent.operation_reference}`;
    const pending = await prepareForVerification(
      commitment.external_operation_id,
      providerReference,
    );
    verificationState = 'UNKNOWN';
    await expect(
      settlement.releaseReservedWithdrawal({
        externalOperationId: commitment.external_operation_id,
        expectedVersion: pending.version,
        requestContext: context,
      }),
    ).rejects.toThrow('Provider rejection is not verified');
    await expect(settle(commitment.external_operation_id, providerReference)).rejects.toThrow(
      'Provider settlement outcome is not verified',
    );
    const state: Array<{ state: string }> = await dataSource.query(
      `SELECT state FROM financial_commitments WHERE external_operation_id=$1`,
      [commitment.external_operation_id],
    );
    expect(state[0]?.state).toBe('RESERVED');
  });

  it('agent transfer uses the same atomic reservation, verified status and single posting controls', async () => {
    const commitment = await createAgentCommitment();
    const intent = await dispatchIntent(commitment.external_operation_id);
    const command = commandFor(intent);
    submissionMode = 'accepted';
    statusOutcome = 'SUCCESSFUL';
    const submitted = await outbound.dispatch(intent.id, command);
    expect(submitted.state).toBe('PENDING_PROVIDER');
    expect(submittedReferences).toEqual([intent.operation_reference]);
    const resolved = await outbound.enquire(intent.id, context.correlationId);
    expect(resolved.state).toBe('SUCCESSFUL');

    const owner: Array<{ owner_class: string }> = await dataSource.query(
      `SELECT owner_class FROM wallet_accounts WHERE id=$1`,
      [intent.wallet_id],
    );
    expect(owner[0]?.owner_class).toBe('AGENT');
    const providerReference = `MNFY|LIFECYCLE|${intent.operation_reference}`;
    const pending = await prepareForVerification(
      commitment.external_operation_id,
      providerReference,
    );
    const result = await settle(commitment.external_operation_id, providerReference, pending);
    expect(result.settlement?.journalId).toBeTruthy();
    const replay = await settle(commitment.external_operation_id, providerReference, pending);
    expect(replay.replayed).toBe(true);
    expect(submittedReferences).toEqual([intent.operation_reference]);
  });

  it('a generic reversal cannot unwind a confirmed provider settlement journal', async () => {
    const commitment = await createCustomerCommitment();
    const intent = await dispatchIntent(commitment.external_operation_id);
    submissionMode = 'accepted';
    statusOutcome = 'SUCCESSFUL';
    await outbound.dispatch(intent.id, commandFor(intent));
    await outbound.enquire(intent.id, context.correlationId);
    const result = await settle(
      commitment.external_operation_id,
      `MNFY|LIFECYCLE|${intent.operation_reference}`,
    );
    const governance = app.get(LedgerReversalGovernanceService);
    await expect(
      governance.requestReversal({
        principal: {
          principalId: 'fixture-preparer',
          type: 'OPERATOR',
          roles: ['FINANCE_PREPARER'],
          scopes: [],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
        } as never,
        journalId: result.settlement.journalId!,
        reason: 'Generic admin correction attempt',
      }),
    ).rejects.toThrow('governed provider recovery');
  });
});
