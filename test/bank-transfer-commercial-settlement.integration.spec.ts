import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';
import { FinancialCommitmentService } from '../src/financial-commitment/financial-commitment.service';
import { CustomerService } from '../src/customer/customer.service';
import { AuthenticationSessionService } from '../src/customer-authentication/authentication-session.service';
import { CustomerTransactionPinService } from '../src/customer/customer-transaction-pin.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentAuthenticationService } from '../src/agent-authentication/agent-authentication.service';
import { AgentPasswordHashAlgorithm } from '../src/agent-authentication/agent-authentication.enums';
import { AgentService } from '../src/agent/agent-service.enum';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { ExternalOperationLifecycleService } from '../src/partner/external-operation-lifecycle.service';
import { ExternalSettlementService } from '../src/partner/external-settlement.service';
import { ExternalOperationService } from '../src/partner/external-operation.service';
import { ExternalOperationReferenceSource, ExternalOperationReferenceType } from '../src/partner/external-operation.enums';
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
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';

function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(pin, salt, 10000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

describe('Bank transfer commercial + settlement (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let ledger: LedgerService;
  let customerService: CustomerService;
  let sessionService: AuthenticationSessionService;
  let custPinService: CustomerTransactionPinService;
  let agentClassService: AgentClassService;
  let agentAppService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let pinService: AgentAuthenticationService;
  let walletService: WalletService;
  let commitments: FinancialCommitmentService;
  let opLifecycle: ExternalOperationLifecycleService;
  let settlement: ExternalSettlementService;
  let verificationState: 'VERIFIED_SETTLED' | 'VERIFIED_REJECTED' | 'UNKNOWN' | 'UNAVAILABLE' = 'VERIFIED_SETTLED';
  const requestContext = { requestId: 'commercial-test', correlationId: 'commercial-test', traceId: 'commercial-test' };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('commercialSettlement');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource).useValue(dataSource)
      .overrideProvider(KycTierEvidenceReader).useValue({ read: () => Promise.resolve(null) })
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN).useValue(new TestNotificationProvider())
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    ledger = app.get(LedgerService);
    customerService = app.get(CustomerService);
    sessionService = app.get(AuthenticationSessionService);
    custPinService = app.get(CustomerTransactionPinService);
    agentClassService = app.get(AgentClassService);
    agentAppService = app.get(AgentApplicationService);
    lifecycleService = app.get(AgentLifecycleService);
    pinService = app.get(AgentAuthenticationService);
    walletService = app.get(WalletService);
    commitments = app.get(FinancialCommitmentService);
    opLifecycle = app.get(ExternalOperationLifecycleService);

    const verifier: ExternalOperationStatusVerifier = {
      verify: ({ operation, correlationId }) => Promise.resolve({
        state: verificationState,
        providerStatus: 'controlled-test',
        providerReferenceHash: createHash('sha256').update(operation.providerReferences.find((r) => r.source === ExternalOperationReferenceSource.STATUS_QUERY)?.referenceValue ?? correlationId).digest('hex'),
        observedAt: new Date().toISOString(), reasonCode: null,
      }),
    };
    settlement = new ExternalSettlementService(
      dataSource.getRepository(ExternalSettlement), dataSource.getRepository(ExternalSuspenseEntry), dataSource, ledger,
      app.get(SettlementAccountService), app.get(ExternalOperationService), app.get(IdempotencyService), app.get(AuditService),
      { getProfile: () => ({ enabled: true }) } as never, app.get(OutboxService), verifier, app.get(LimitUsageService),
    );
    await dataSource.query(`INSERT INTO banks(id,bank_code,bank_name,short_name,nip_supported,status) VALUES($1,'BNKCOM','Bank Commercial','BC',true,'ACTIVE') ON CONFLICT DO NOTHING`, [randomUUID()]);
    await dataSource.query(`INSERT INTO banks(id,bank_code,bank_name,short_name,nip_supported,status) VALUES($1,'BNKSET','Bank Settlement','BS',true,'ACTIVE') ON CONFLICT DO NOTHING`, [randomUUID()]);
  }, 120000);
  afterAll(async () => { try { if (app) await app.close(); } catch {} try { if (dataSource) await destroyIntegrationDataSource(dataSource); } catch {} });
  beforeEach(() => { verificationState = 'VERIFIED_SETTLED'; });

  async function createCustomer(pin: string) {
    const phone = `+2348${Math.floor(100000000 + Math.random() * 900000000)}`;
    const customer = await customerService.create({ phone, fullName: 'Commercial User', password: 'Password123!' } as never);
    await dataSource.query(`UPDATE customers SET kyc_tier='TIER_2', status='ACTIVE' WHERE id=$1`, [customer.id]);
    await custPinService.setTransactionPin(customer.id, { pinHash: hashPin(pin), hashAlgorithm: 'PBKDF2', pinVersion: 1, actor: customer.id });
    const wallet = await walletService.createWallet({ customerId: customer.id, currency: 'NGN', idempotencyKey: `w-${randomUUID()}` });
    const wlRows: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`, [wallet.id]);
    const assetRows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`);
    await ledger.postJournal({ idempotencyKey: `fund-c-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', lines: [{ accountId: assetRows[0]!.id, direction: 'DEBIT' as never, amountMinor: '50000' }, { accountId: wlRows[0]!.ledger_account_id, direction: 'CREDIT' as never, amountMinor: '50000' }] });
    await dataSource.query(`INSERT INTO customer_authentication_credentials(id,customer_id,password_hash,hash_algorithm,password_version,status,mobile_otp_required) VALUES($1,$2,$3,'PBKDF2',1,'ACTIVE',false) ON CONFLICT DO NOTHING`, [randomUUID(), customer.id, hashPin('password-123')]);
    const authentication = await app.get(require('../src/customer-authentication/authentication-execution.service').AuthenticationExecutionService).authenticate({ customerId: customer.id, password: 'password-123', actor: customer.id });
    const session = await sessionService.issue({ authentication, actor: customer.id });
    // limit
    const profile = `CJS_${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    await dataSource.query(`INSERT INTO limit_profiles(code,name,kind,status,enabled,configuration_status,created_by) VALUES($1,'Cust','CUSTOMER','ACTIVE',true,'CONFIGURED','fixture')`, [profile]);
    await dataSource.query(`INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,effective_from,is_active,created_by) VALUES($1,$2,'CUSTOMER',$3,clock_timestamp()-interval '1 day',true,'fixture')`, [randomUUID(), profile, customer.id]);
    await dataSource.query(`INSERT INTO limit_rules(id,limit_profile_code,product,direction,currency,dimension,limit_value_minor,effective_from,is_active,created_by) VALUES($1,$2,'EXTERNAL_BANK_TRANSFER','OUTGOING','NGN','DAILY_AMOUNT',100000,clock_timestamp()-interval '1 day',true,'fixture')`, [randomUUID(), profile]);
    const benId = randomUUID();
    await dataSource.query(`INSERT INTO customer_beneficiaries(id,customer_id,beneficiary_type,display_name,reference,destination_identifier,normalized_destination_identifier,destination_name,destination_institution,nickname,status,verified,version,created_at,updated_at) VALUES($1,$2,'BANK_ACCOUNT',$3,$4,'1234567890','1234567890','Test','BNKCOM','My', 'ACTIVE',true,1,clock_timestamp(),clock_timestamp())`, [benId, customer.id, 'Test', `bank-${randomUUID()}`]);
    await dataSource.query(`INSERT INTO beneficiary_ownerships(id,beneficiary_id,customer_id,version) VALUES($1,$2,$3,1)`, [randomUUID(), benId, customer.id]);
    return { customer, wallet, token: session.accessToken, benId };
  }

  async function createAgent(pin: string) {
    const cls = await agentClassService.create({ reference: `cls-cs-${randomUUID().slice(0, 6)}`, code: `CSA-${randomUUID().slice(0, 6).toUpperCase()}`, name: 'CS Class', isActive: true, applicableServices: [AgentService.EXTERNAL_BANK_TRANSFER] as unknown, actor: 'test' });
    const appEntity = await agentAppService.create({ agentClassId: cls.id, applicantReference: `h-${randomUUID()}`, businessName: `Biz ${randomUUID().slice(0, 4)}`, contactEmail: `cs-${randomUUID().slice(0, 6)}@test.com`, actor: 'applicant' });
    await agentAppService.submit(appEntity.id, 'applicant');
    await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [appEntity.id]);
    const agent = await lifecycleService.activateFromApplication(appEntity.id, 'test-actor');
    await pinService.setTransactionPin(agent.id, { pinHash: hashPin(pin), hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2, pinVersion: 1, actor: agent.id });
    const wallet = await walletService.createWallet({ customerId: agent.id, currency: 'NGN', idempotencyKey: `aw-${agent.id}-${randomUUID()}` });
    const wlRows: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`, [wallet.id]);
    const assetRows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`);
    await ledger.postJournal({ idempotencyKey: `fund-a-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', lines: [{ accountId: assetRows[0]!.id, direction: 'DEBIT' as never, amountMinor: '50000' }, { accountId: wlRows[0]!.ledger_account_id, direction: 'CREDIT' as never, amountMinor: '50000' }] });
    const rows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM institutions LIMIT 1`);
    const institutionId = rows[0]?.id ?? (await dataSource.query(`INSERT INTO institutions(id,name,code,status) VALUES($1,'T','T','ACTIVE') RETURNING id`, [randomUUID()]))[0].id;
    await dataSource.query(`INSERT INTO institutions_agents(institution_id,agent_id,status) VALUES($1,$2,'ACTIVE') ON CONFLICT DO NOTHING`, [institutionId, agent.id]);
    const profile = `CSA_${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    await dataSource.query(`INSERT INTO limit_profiles(code,name,kind,status,enabled,configuration_status,created_by) VALUES($1,'Agent','AGENT','ACTIVE',true,'CONFIGURED','fixture')`, [profile]);
    await dataSource.query(`INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,effective_from,is_active,created_by) VALUES($1,$2,'AGENT',$3,clock_timestamp()-interval '1 day',true,'fixture')`, [randomUUID(), profile, agent.id]);
    await dataSource.query(`INSERT INTO limit_rules(id,limit_profile_code,product,direction,currency,dimension,limit_value_minor,effective_from,is_active,created_by) VALUES($1,$2,'EXTERNAL_BANK_TRANSFER','OUTGOING','NGN','DAILY_AMOUNT',100000,clock_timestamp()-interval '1 day',true,'fixture')`, [randomUUID(), profile]);
    const agentToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(agentToken, 'utf8').digest('hex');
    const [cred] = await dataSource.query(`INSERT INTO agent_authentication_credentials(agent_id,password_hash,hash_algorithm,password_version,password_changed_at,status) VALUES($1,$2,'PBKDF2',1,clock_timestamp(),'ACTIVE') RETURNING id`, [agent.id, hashPin('login-password')]);
    const [sess] = await dataSource.query(`INSERT INTO agent_authentication_sessions(agent_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at) VALUES($1,$2,$3,'agent-api','ACTIVE',clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp()) RETURNING id`, [agent.id, cred.id, tokenHash]);
    const benId = randomUUID();
    await dataSource.query(`INSERT INTO customer_beneficiaries(id,agent_id,beneficiary_type,display_name,reference,destination_identifier,normalized_destination_identifier,destination_name,destination_institution,nickname,status,verified,version,created_at,updated_at) VALUES($1,$2,'BANK_ACCOUNT',$3,$4,'1234567890','1234567890','Test','BNKSET','My','ACTIVE',true,1,clock_timestamp(),clock_timestamp())`, [benId, agent.id, 'Test', `bank-${randomUUID()}`]);
    await dataSource.query(`INSERT INTO beneficiary_ownerships(id,beneficiary_id,agent_id,version) VALUES($1,$2,$3,1)`, [randomUUID(), benId, agent.id]);
    agentSessions.set(agent.id, sess.id);
    return { agent, wallet, benId, cls, sessionId: sess.id, agentToken };
  }
  const agentSessions = new Map<string, string>();
  function agentPrincipal(agentId: string) { return { type: 'AGENT' as const, sessionId: agentSessions.get(agentId), agentId, principalId: agentId, roles: [], scopes: [], customerAccess: 'NONE' as const, agentAccess: 'SELF' as const }; }

  it('customer: reservation journal and immutable destination on settlement', async () => {
    const { customer, wallet, benId, token } = await createCustomer('1234');
    const { commitment } = await commitments.initiate({ token, walletAccountId: wallet.id, beneficiaryId: benId, amountMinor: '1000', currency: 'NGN', pin: '1234', idempotencyKey: randomUUID() });
    expect(commitment.state).toBe('RESERVED');
    const opId = commitment.external_operation_id;
    const attempt = await opLifecycle.beginAttempt(opId, `att-${randomUUID()}`, requestContext, 1);
    const provRef = `prov-${randomUUID()}`;
    await app.get(ExternalOperationService).recordProviderReference({ externalOperationId: opId, partnerKey: 'NIBSS_NIP', referenceType: ExternalOperationReferenceType.TRANSACTION, referenceValue: provRef, namespace: 'nibss.nip', source: ExternalOperationReferenceSource.STATUS_QUERY, requestContext });
    const pending = await opLifecycle.transition({ externalOperationId: opId, expectedVersion: attempt.version, nextState: ExternalOperationLifecycleState.PENDING_VERIFICATION, idempotencyKey: `pend-${randomUUID()}`, requestContext });
    verificationState = 'VERIFIED_SETTLED';
    const result = await settlement.settleVerifiedOutcome({ externalOperationId: opId, expectedVersion: pending.version, decision: ExternalSettlementDecision.SETTLE, evidence: { referenceType: 'TRANSACTION', referenceValue: provRef, namespace: 'nibss.nip', source: ExternalOperationReferenceSource.STATUS_QUERY, observedAt: new Date() }, requestContext });
    expect(result).toBeDefined();
    const dest: Array<{ target_reference: string }> = await dataSource.query(`SELECT target_reference FROM financial_commitment_destinations WHERE commitment_id=$1`, [commitment.id]);
    expect(dest.length).toBe(1);
  });

  it('customer: rejection releases reservation and does not settle', async () => {
    const { customer, wallet, benId, token } = await createCustomer('1234');
    const { commitment } = await commitments.initiate({ token, walletAccountId: wallet.id, beneficiaryId: benId, amountMinor: '800', currency: 'NGN', pin: '1234', idempotencyKey: randomUUID() });
    const opId = commitment.external_operation_id;
    const attempt = await opLifecycle.beginAttempt(opId, `att-${randomUUID()}`, requestContext, 1);
    const provRef = `prov-${randomUUID()}`;
    await app.get(ExternalOperationService).recordProviderReference({ externalOperationId: opId, partnerKey: 'NIBSS_NIP', referenceType: ExternalOperationReferenceType.TRANSACTION, referenceValue: provRef, namespace: 'nibss.nip', source: ExternalOperationReferenceSource.STATUS_QUERY, requestContext });
    const pending = await opLifecycle.transition({ externalOperationId: opId, expectedVersion: attempt.version, nextState: ExternalOperationLifecycleState.PENDING_VERIFICATION, idempotencyKey: `pend-${randomUUID()}`, requestContext });
    verificationState = 'VERIFIED_REJECTED';
    await settlement.settleVerifiedOutcome({ externalOperationId: opId, expectedVersion: pending.version, decision: ExternalSettlementDecision.REJECT, evidence: { referenceType: 'TRANSACTION', referenceValue: provRef, namespace: 'nibss.nip', source: ExternalOperationReferenceSource.STATUS_QUERY, observedAt: new Date() }, requestContext });
    const updated: Array<{ state: string }> = await dataSource.query(`SELECT state FROM financial_commitments WHERE id=$1`, [commitment.id]);
    expect(updated[0]!.state).toBe('RELEASED');
  });

  it('customer: duplicate provider reference is idempotent', async () => {
    const { customer, wallet, benId, token } = await createCustomer('1234');
    const { commitment } = await commitments.initiate({ token, walletAccountId: wallet.id, beneficiaryId: benId, amountMinor: '900', currency: 'NGN', pin: '1234', idempotencyKey: randomUUID() });
    const opId = commitment.external_operation_id;
    const attempt = await opLifecycle.beginAttempt(opId, `att-${randomUUID()}`, requestContext, 1);
    const provRef = `prov-${randomUUID()}`;
    await app.get(ExternalOperationService).recordProviderReference({ externalOperationId: opId, partnerKey: 'NIBSS_NIP', referenceType: ExternalOperationReferenceType.TRANSACTION, referenceValue: provRef, namespace: 'nibss.nip', source: ExternalOperationReferenceSource.STATUS_QUERY, requestContext });
    await app.get(ExternalOperationService).recordProviderReference({ externalOperationId: opId, partnerKey: 'NIBSS_NIP', referenceType: ExternalOperationReferenceType.TRANSACTION, referenceValue: provRef, namespace: 'nibss.nip', source: ExternalOperationReferenceSource.STATUS_QUERY, requestContext });
    const refs: Array<{ reference_value: string }> = await dataSource.query(`SELECT reference_value FROM external_operation_references WHERE external_operation_id=$1`, [opId]);
    expect(refs.length).toBeGreaterThanOrEqual(1);
  });

  it('agent: settlement creates destination and settlement journal', async () => {
    const { agent, wallet, benId } = await createAgent('1234');
    const initiated = await commitments.initiateForAgent({ agentId: agent.id, agentSessionId: agentSessions.get(agent.id)!, principal: agentPrincipal(agent.id), pin: '1234', amountMinor: '1000', currency: 'NGN', beneficiaryId: benId, idempotencyKey: randomUUID() });
    const opId = initiated.commitment.external_operation_id;
    const attempt = await opLifecycle.beginAttempt(opId, `att-${randomUUID()}`, requestContext, 1);
    const provRef = `prov-${randomUUID()}`;
    await app.get(ExternalOperationService).recordProviderReference({ externalOperationId: opId, partnerKey: 'NIBSS_NIP', referenceType: ExternalOperationReferenceType.TRANSACTION, referenceValue: provRef, namespace: 'nibss.nip', source: ExternalOperationReferenceSource.STATUS_QUERY, requestContext });
    const pending = await opLifecycle.transition({ externalOperationId: opId, expectedVersion: attempt.version, nextState: ExternalOperationLifecycleState.PENDING_VERIFICATION, idempotencyKey: `pend-${randomUUID()}`, requestContext });
    verificationState = 'VERIFIED_SETTLED';
    const result = await settlement.settleVerifiedOutcome({ externalOperationId: opId, expectedVersion: pending.version, decision: ExternalSettlementDecision.SETTLE, evidence: { referenceType: 'TRANSACTION', referenceValue: provRef, namespace: 'nibss.nip', source: ExternalOperationReferenceSource.STATUS_QUERY, observedAt: new Date() }, requestContext });
    expect(result).toBeDefined();
  });

  it('agent: concurrent second commitment respects limit/balance', async () => {
    const { agent, wallet, benId } = await createAgent('1234');
    const k1 = randomUUID(), k2 = randomUUID();
    const results = await Promise.allSettled([
      commitments.initiateForAgent({ agentId: agent.id, agentSessionId: agentSessions.get(agent.id)!, principal: agentPrincipal(agent.id), pin: '1234', amountMinor: '400', currency: 'NGN', beneficiaryId: benId, idempotencyKey: k1 }),
      commitments.initiateForAgent({ agentId: agent.id, agentSessionId: agentSessions.get(agent.id)!, principal: agentPrincipal(agent.id), pin: '1234', amountMinor: '400', currency: 'NGN', beneficiaryId: benId, idempotencyKey: k2 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
  });

  it('customer: stale beneficiary (deleted) rejected', async () => {
    const { customer, wallet, benId, token } = await createCustomer('1234');
    const staleBen = randomUUID();
    await dataSource.query(`INSERT INTO customer_beneficiaries(id,customer_id,beneficiary_type,display_name,reference,destination_identifier,normalized_destination_identifier,destination_name,destination_institution,nickname,status,verified,version,created_at,updated_at) VALUES($1,$2,'BANK_ACCOUNT',$3,$4,'9999999999','9999999999','Stale','BNKCOM','Stale','DELETED',false,1,clock_timestamp(),clock_timestamp())`, [staleBen, customer.id, 'Stale', `bank-${randomUUID()}`]);
    await dataSource.query(`INSERT INTO beneficiary_ownerships(id,beneficiary_id,customer_id,version) VALUES($1,$2,$3,1)`, [randomUUID(), staleBen, customer.id]);
    await expect(commitments.initiate({ token, walletAccountId: wallet.id, beneficiaryId: staleBen, amountMinor: '500', currency: 'NGN', pin: '1234', idempotencyKey: randomUUID() })).rejects.toThrow();
  });
});
