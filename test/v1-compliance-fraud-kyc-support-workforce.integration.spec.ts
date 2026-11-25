/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request = require('supertest');
import { DataSource } from 'typeorm';

import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AppModule } from '../src/app.module';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { SupportTicketCategory, SupportTicketPriority } from '../src/support/support.enums';
import { GovernedFinancialFixture } from './support/governed-financial-fixture';
import { createTestEvidenceReader } from './support/kyc-test-evidence-reader';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const kycEvidence = createTestEvidenceReader({ mode: 'ELIGIBLE' });

describe('V1 Compliance, Fraud, KYC Review, and Support Workforce Integration (real PG + HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let sessions: A2WorkforceSessionService;
  let agentClasses: AgentClassService;
  let agentApps: AgentApplicationService;
  let agentLifecycle: AgentLifecycleService;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('v1cfksworkforce');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(KycTierEvidenceReader)
      .useValue(kycEvidence.reader)
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = module.get(A2WorkforceSessionService);
    agentClasses = module.get(AgentClassService);
    agentApps = module.get(AgentApplicationService);
    agentLifecycle = module.get(AgentLifecycleService);
  }, 180_000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    if (app) await app.close();
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60_000);

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function seedRolePrincipal(...roles: string[]): Promise<{ token: string; principalId: string }> {
    const principalId = `cfks:${roles.join('+')}:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    for (const roleKey of roles) {
      await dataSource.getRepository(A2FinanceRoleAssignment).save({
        id: randomUUID(),
        assignmentReference: `cfks:${randomUUID()}`,
        assignmentVersion: 1,
        principalId,
        roleKey,
        scopes: [],
        status: 'ACTIVE',
        initiatedScope: 'SUPER_ADMIN_SCOPE',
        interim: true,
        effectiveFrom: new Date(now.getTime() - 60_000),
        effectiveTo: new Date(now.getTime() + 3_600_000),
        assignedBy: 'cfks-test-harness',
        assignedAt: now,
        revokedBy: null,
        revokedAt: null,
        bootstrapReference: null,
        approvalIds: [],
        auditReferences: [],
      } as unknown as A2FinanceRoleAssignment);
    }
    const established = await sessions.establish({
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
      signingKeyId: 'cfks-test-key',
    });
    return { token: established.accessToken, principalId };
  }

  async function createCustomerWithEvidence(label: string, suffixDigits: string): Promise<string> {
    const customerId = randomUUID();
    await dataSource.query(
      `INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status, is_synthetic)
       VALUES ($1::uuid, $2, 'INDIVIDUAL', 'ACTIVE', 'NONE', 'PENDING', FALSE)`,
      [customerId, `cust-${label}-${randomUUID().slice(0, 8)}`],
    );
    await dataSource.query(
      `INSERT INTO customer_profiles (id, customer_id, display_name, legal_name, is_active)
       VALUES ($1::uuid, $2::uuid, $3, $3, TRUE)`,
      [randomUUID(), customerId, `Synthetic ${label}`],
    );
    await dataSource.query(
      `INSERT INTO customer_contact_methods (id, customer_id, type, value, normalized_value, is_primary, verified_at)
       VALUES ($1::uuid, $2::uuid, 'PHONE', $3, $3, TRUE, NOW())`,
      [randomUUID(), customerId, `+234800000${suffixDigits}`],
    );
    const addrId = randomUUID();
    await dataSource.query(
      `INSERT INTO customer_addresses (id, customer_id, type, line_one, city, state, country, is_primary)
       VALUES ($1::uuid, $2::uuid, 'RESIDENTIAL', '10 Synthetic Road', 'Kano', 'Kano State', 'NG', TRUE)`,
      [addrId, customerId],
    );
    await dataSource.query(
      `INSERT INTO customer_identity_documents (id, customer_id, type, document_number, issuing_country)
       VALUES ($1::uuid, $2::uuid, 'NIN', $3, 'NG')`,
      [randomUUID(), customerId, `7000000${suffixDigits}`],
    );
    await dataSource.query(
      `INSERT INTO customer_proof_of_address_submissions (
         id, submission_group_id, revision_number, customer_id, residential_address_id,
         category, document_type, review_status, document_status,
         created_by_principal_id, created_by_role_key
       )
       VALUES (
         $1::uuid, $2::uuid, 1, $3::uuid, $4::uuid,
         'UTILITY', 'ELECTRICITY_BILL', 'PENDING', 'QUARANTINED',
         'operations@monienaija.local', 'OPERATIONS'
       )`,
      [randomUUID(), randomUUID(), customerId, addrId],
    );
    return customerId;
  }

  async function createActiveAgent(label: string): Promise<string> {
    const cls = await agentClasses.create({
      reference: `cls-${label}-${randomUUID().slice(0, 8)}`,
      code: `CFKS-${randomUUID().slice(0, 6)}`,
      name: `CFKS Class ${label}`,
      isActive: true,
      applicableServices: [],
      actor: 'cfks-test-actor',
    });
    const appEntity = await agentApps.create({
      agentClassId: cls.id,
      applicantReference: `app-${label}-${randomUUID().slice(0, 8)}`,
      businessName: `Synthetic Agent ${label}`,
      contactEmail: `agent-${label}-${randomUUID().slice(0, 6)}@example.test`,
      actor: 'cfks-applicant',
    });
    await agentApps.submit(appEntity.id, 'cfks-applicant');
    await dataSource.query(
      `UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`,
      [appEntity.id],
    );
    const agent = await agentLifecycle.activateFromApplication(appEntity.id, 'cfks-test-actor');
    return agent.id;
  }

  it('enforces multi-institution isolation across KYC reviews, compliance cases, fraud cases, and customer/agent support tickets', async () => {
    const fixture = new GovernedFinancialFixture({ app, dataSource, label: 'cfksiso' });
    const instA = await fixture.createInstitution();
    const instB = await fixture.createInstitution();

    const customerA = await createCustomerWithEvidence('alpha', '1101');
    const customerB = await createCustomerWithEvidence('beta', '2202');
    await fixture.enrolCustomer(customerA, instA.id, {
      withKycReuse: false,
      financialEligibility: 'PENDING_KYC',
    });
    await fixture.enrolCustomer(customerB, instB.id, {
      withKycReuse: false,
      financialEligibility: 'PENDING_KYC',
    });

    const agentA = await createActiveAgent('alpha');
    const agentB = await createActiveAgent('beta');
    await fixture.affiliateAgent(agentA, instA.id);
    await fixture.affiliateAgent(agentB, instB.id);

    const operationsRole = await seedRolePrincipal('OPERATIONS');
    const instScopedRoleRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO authorization_roles (role_key, display_name, description, is_active, is_system_seeded)
       VALUES ('CFKS_INST_REVIEWER', 'Institution KYC & Compliance Reviewer', 'Test institution-scoped KYC & compliance reviewer without platform marker', true, false)
       RETURNING id`,
    );
    for (const [fn, access] of [
      ['kyc.view', 'VIEW'],
      ['kyc.review', 'EXECUTE'],
      ['compliance.manage_case', 'EXECUTE'],
    ] as const) {
      await dataSource.query(
        `INSERT INTO authorization_role_functions (role_id, function_code, access_type, is_active, assigned_by)
         VALUES ($1,$2,$3,true,'cfks-test-harness')`,
        [instScopedRoleRows[0]!.id, fn, access],
      );
    }
    const instReviewerA = await seedRolePrincipal('CFKS_INST_REVIEWER');
    const compliancePlatform = await seedRolePrincipal('COMPLIANCE');
    const fraudA = await seedRolePrincipal('RISK_FRAUD');
    const fraudB = await seedRolePrincipal('RISK_FRAUD');
    const supportA = await seedRolePrincipal('CUSTOMER_SERVICE');
    const superAdmin = await seedRolePrincipal('SUPER_ADMIN');

    await fixture.grantWorkforceScope(instA.id, instReviewerA.principalId);
    await fixture.grantWorkforceScope(instA.id, fraudA.principalId);
    await fixture.grantWorkforceScope(instB.id, fraudB.principalId);
    await fixture.grantWorkforceScope(instA.id, supportA.principalId);

    // Seed non-FRAUD cases via platform SUPER_ADMIN and FRAUD cases via institution-scoped RISK_FRAUD
    const createCaseA = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerA}/compliance-cases`)
      .set(auth(superAdmin.token))
      .send({ caseNumber: 'aml-inst-a-001', category: 'AML', severity: 'HIGH' });
    expect(createCaseA.status).toBe(201);

    const createCaseB = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerB}/compliance-cases`)
      .set(auth(superAdmin.token))
      .send({ caseNumber: 'aml-inst-b-001', category: 'AML', severity: 'HIGH' });
    expect(createCaseB.status).toBe(201);

    const createFraudA = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerA}/compliance-cases`)
      .set(auth(fraudA.token))
      .send({ caseNumber: 'frd-inst-a-001', category: 'FRAUD', severity: 'CRITICAL' });
    expect(createFraudA.status).toBe(201);

    const createFraudB = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerB}/compliance-cases`)
      .set(auth(fraudB.token))
      .send({ caseNumber: 'frd-inst-b-001', category: 'FRAUD', severity: 'CRITICAL' });
    expect(createFraudB.status).toBe(201);

    // OPERATIONS has no KYC function grant -> 403
    const kycQueueOpsDenied = await request(app.getHttpServer())
      .get('/api/v1/internal/kyc/review-workspace/queue')
      .set(auth(operationsRole.token));
    expect(kycQueueOpsDenied.status).toBe(403);

    // 1. KYC review queue, dossier, and assessment isolation for institution-scoped reviewer (instA)
    const kycQueueInstRes = await request(app.getHttpServer())
      .get('/api/v1/internal/kyc/review-workspace/queue')
      .set(auth(instReviewerA.token));
    expect(kycQueueInstRes.status).toBe(200);
    expect(kycQueueInstRes.body.scopeMode).toBe('ASSIGNED_INSTITUTIONS');
    const instKycCustomerIds = kycQueueInstRes.body.items.map((item: any) => item.customerId);
    expect(instKycCustomerIds).toContain(customerA);
    expect(instKycCustomerIds).not.toContain(customerB);

    const dossierBInstRes = await request(app.getHttpServer())
      .get(`/api/v1/internal/kyc/review-workspace/customers/${customerB}`)
      .set(auth(instReviewerA.token));
    expect(dossierBInstRes.status).toBe(404);

    const assessAInstRes = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerA}/kyc-assessment`)
      .set(auth(instReviewerA.token))
      .send({
        level: 'NONE',
        status: 'PENDING',
        reason: 'MANUAL_REVIEW',
        assessedBy: instReviewerA.principalId,
      });
    expect(assessAInstRes.status).toBe(201);

    const assessBInstRes = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerB}/kyc-assessment`)
      .set(auth(instReviewerA.token))
      .send({
        level: 'NONE',
        status: 'PENDING',
        reason: 'MANUAL_REVIEW',
        assessedBy: instReviewerA.principalId,
      });
    expect(assessBInstRes.status).toBe(404);

    const kycQueueFilteredCompliance = await request(app.getHttpServer())
      .get(`/api/v1/internal/kyc/review-workspace/queue?institutionId=${instA.id}`)
      .set(auth(compliancePlatform.token));
    expect(kycQueueFilteredCompliance.status).toBe(200);
    expect(kycQueueFilteredCompliance.body.scopeMode).toBe('EXPLICIT_INSTITUTION');
    const filteredKycCustomerIds = kycQueueFilteredCompliance.body.items.map(
      (item: any) => item.customerId,
    );
    expect(filteredKycCustomerIds).toContain(customerA);
    expect(filteredKycCustomerIds).not.toContain(customerB);

    const dossierARes = await request(app.getHttpServer())
      .get(`/api/v1/internal/kyc/review-workspace/customers/${customerA}`)
      .set(auth(compliancePlatform.token));
    expect(dossierARes.status).toBe(200);
    expect(dossierARes.body.evidenceStatus.identityDocuments.access).toBe('GRANTED');
    expect(dossierARes.body.evidenceStatus.identityDocuments.items[0].maskedDocumentNumber).toBe(
      '••••1101',
    );
    expect(dossierARes.body.evidenceStatus.proofOfAddress.access).toBe('GRANTED');

    // 2. Non-FRAUD compliance queue & detail isolation (ASSIGNED_INSTITUTIONS + EXPLICIT_INSTITUTION)
    const compQueueInstRes = await request(app.getHttpServer())
      .get('/api/v1/internal/compliance-cases?scope=COMPLIANCE')
      .set(auth(instReviewerA.token));
    expect(compQueueInstRes.status).toBe(200);
    expect(compQueueInstRes.body.items.map((c: any) => c.caseNumber)).toEqual(['aml-inst-a-001']);

    const crossInstCaseDetail = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerB}/compliance-cases/${createCaseB.body.id}`)
      .set(auth(instReviewerA.token));
    expect(crossInstCaseDetail.status).toBe(404);

    const compQueueRes = await request(app.getHttpServer())
      .get(`/api/v1/internal/compliance-cases?scope=COMPLIANCE&institutionId=${instA.id}`)
      .set(auth(compliancePlatform.token));
    expect(compQueueRes.status).toBe(200);
    const compCaseNumbers = compQueueRes.body.items.map((c: any) => c.caseNumber);
    expect(compCaseNumbers).toContain('aml-inst-a-001');
    expect(compCaseNumbers).not.toContain('aml-inst-b-001');
    expect(compCaseNumbers).not.toContain('frd-inst-a-001');

    // 3. FRAUD queue & detail isolation for RISK_FRAUD scoped to instA
    const fraudQueueRes = await request(app.getHttpServer())
      .get('/api/v1/internal/compliance-cases?scope=FRAUD')
      .set(auth(fraudA.token));
    expect(fraudQueueRes.status).toBe(200);
    const fraudCaseNumbers = fraudQueueRes.body.items.map((c: any) => c.caseNumber);
    expect(fraudCaseNumbers).toContain('frd-inst-a-001');
    expect(fraudCaseNumbers).not.toContain('frd-inst-b-001');
    expect(fraudCaseNumbers).not.toContain('aml-inst-a-001');

    const crossInstFraudDetail = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerB}/compliance-cases/${createFraudB.body.id}`)
      .set(auth(fraudA.token));
    expect(crossInstFraudDetail.status).toBe(404);

    // 4. Support Inbox customer + agent institution scoping for CUSTOMER_SERVICE scoped to instA
    const createCustTicketA = await request(app.getHttpServer())
      .post('/api/v1/internal/support/tickets')
      .set(auth(supportA.token))
      .set('Idempotency-Key', `cfks-cust-a-${randomUUID()}`)
      .send({
        subject: 'Alpha customer inquiry',
        category: SupportTicketCategory.PROFILE,
        priority: SupportTicketPriority.HIGH,
        description: 'Synthetic customer support request in Institution Alpha.',
        targetCustomerId: customerA,
      });
    expect(createCustTicketA.status).toBe(201);

    const createAgentTicketA = await request(app.getHttpServer())
      .post('/api/v1/internal/support/tickets')
      .set(auth(supportA.token))
      .set('Idempotency-Key', `cfks-agent-a-${randomUUID()}`)
      .send({
        subject: 'Alpha agent settlement inquiry',
        category: SupportTicketCategory.WALLET,
        priority: SupportTicketPriority.MEDIUM,
        description: 'Synthetic agent support request in Institution Alpha.',
        targetAgentId: agentA,
      });
    expect(createAgentTicketA.status).toBe(201);

    const createCustTicketBDenied = await request(app.getHttpServer())
      .post('/api/v1/internal/support/tickets')
      .set(auth(supportA.token))
      .set('Idempotency-Key', `cfks-cust-b-${randomUUID()}`)
      .send({
        subject: 'Beta customer inquiry should fail',
        category: SupportTicketCategory.PROFILE,
        priority: SupportTicketPriority.LOW,
        description: 'Cross-institution customer ticket attempt.',
        targetCustomerId: customerB,
      });
    expect(createCustTicketBDenied.status).toBe(404);

    const createAgentTicketBBySuper = await request(app.getHttpServer())
      .post('/api/v1/internal/support/tickets')
      .set(auth(superAdmin.token))
      .set('Idempotency-Key', `cfks-agent-b-${randomUUID()}`)
      .send({
        subject: 'Beta agent ticket',
        category: SupportTicketCategory.WALLET,
        priority: SupportTicketPriority.HIGH,
        description: 'Seeded by platform super-admin for Institution Beta.',
        targetAgentId: agentB,
      });
    expect(createAgentTicketBBySuper.status).toBe(201);

    const supportQueueRes = await request(app.getHttpServer())
      .get('/api/v1/internal/support/tickets?page=1&limit=20')
      .set(auth(supportA.token));
    expect(supportQueueRes.status).toBe(200);
    const supportIds = supportQueueRes.body.items.map((t: any) => t.id);
    expect(supportIds).toContain(createCustTicketA.body.id);
    expect(supportIds).toContain(createAgentTicketA.body.id);
    expect(supportIds).not.toContain(createAgentTicketBBySuper.body.id);
    expect(supportQueueRes.body.counts.total).toBe(2);

    const crossInstTicketGet = await request(app.getHttpServer())
      .get(`/api/v1/internal/support/tickets/${createAgentTicketBBySuper.body.id}`)
      .set(auth(supportA.token));
    expect(crossInstTicketGet.status).toBe(404);
  });

  it('enforces strict non-FRAUD vs FRAUD case boundaries and restricted-role sensitive evidence redaction', async () => {
    const customerId = await createCustomerWithEvidence('direct', '9909');

    const compliance = await seedRolePrincipal('COMPLIANCE');
    const riskFraud = await seedRolePrincipal('RISK_FRAUD');
    const financeAuditor = await seedRolePrincipal('FINANCE_AUDITOR');
    const customerService = await seedRolePrincipal('CUSTOMER_SERVICE');

    // COMPLIANCE opens non-FRAUD KYC case and completes comment + evidence + assignment + status lifecycle
    const kycCaseRes = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/compliance-cases`)
      .set(auth(compliance.token))
      .send({ caseNumber: 'kyc-boundary-001', category: 'KYC', severity: 'MEDIUM' });
    expect(kycCaseRes.status).toBe(201);

    const commentRes = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/compliance-cases/${kycCaseRes.body.id}/comment`)
      .set(auth(compliance.token))
      .send({ comment: 'Verified synthetic address metadata.' });
    expect(commentRes.status).toBe(201);

    const assignRes = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/compliance-cases/${kycCaseRes.body.id}/assignment`)
      .set(auth(compliance.token))
      .send({ assignedTo: compliance.principalId });
    expect(assignRes.status).toBe(201);

    // COMPLIANCE cannot open FRAUD cases or read FRAUD queue
    const complianceCreateFraud = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/compliance-cases`)
      .set(auth(compliance.token))
      .send({ caseNumber: 'frd-forbidden-001', category: 'FRAUD', severity: 'HIGH' });
    expect(complianceCreateFraud.status).toBe(403);

    const complianceFraudQueue = await request(app.getHttpServer())
      .get('/api/v1/internal/compliance-cases?scope=FRAUD')
      .set(auth(compliance.token));
    expect(complianceFraudQueue.status).toBe(403);

    // RISK_FRAUD opens FRAUD case, cannot access non-FRAUD cases or KYC review queue
    const fraudCaseRes = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/compliance-cases`)
      .set(auth(riskFraud.token))
      .send({ caseNumber: 'frd-boundary-001', category: 'FRAUD', severity: 'CRITICAL' });
    expect(fraudCaseRes.status).toBe(201);

    const fraudReadNonFraud = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/compliance-cases/${kycCaseRes.body.id}`)
      .set(auth(riskFraud.token));
    expect(fraudReadNonFraud.status).toBe(404);

    const complianceReadFraud = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/compliance-cases/${fraudCaseRes.body.id}`)
      .set(auth(compliance.token));
    expect(complianceReadFraud.status).toBe(404);

    const fraudCompQueue = await request(app.getHttpServer())
      .get('/api/v1/internal/compliance-cases?scope=COMPLIANCE')
      .set(auth(riskFraud.token));
    expect(fraudCompQueue.status).toBe(403);

    const fraudKycQueue = await request(app.getHttpServer())
      .get('/api/v1/internal/kyc/review-workspace/queue')
      .set(auth(riskFraud.token));
    expect(fraudKycQueue.status).toBe(403);

    // FINANCE_AUDITOR can read KYC dossier in read-only mode with sensitive identity & PoA & provider routing redacted
    const auditorDossier = await request(app.getHttpServer())
      .get(`/api/v1/internal/kyc/review-workspace/customers/${customerId}`)
      .set(auth(financeAuditor.token));
    expect(auditorDossier.status).toBe(200);
    expect(auditorDossier.body.supportedDecisions.readOnlyPrincipal).toBe(true);
    expect(auditorDossier.body.supportedDecisions.canPlaceHoldPending).toBe(false);
    expect(auditorDossier.body.supportedDecisions.canApprove).toBe(false);
    expect(auditorDossier.body.supportedDecisions.canReject).toBe(false);
    expect(auditorDossier.body.evidenceStatus.identityDocuments).toEqual({
      access: 'RESTRICTED',
      requiredScope: 'customer.view_identity_documents',
      items: null,
    });
    expect(auditorDossier.body.evidenceStatus.proofOfAddress).toEqual({
      access: 'RESTRICTED',
      requiredScope: 'customer.view_proof_of_address_metadata',
      items: null,
    });
    expect(auditorDossier.body.governance.providerRouting.access).toBe('RESTRICTED');
    expect(auditorDossier.body.governance.tierPolicy.access).toBe('SUMMARY_ONLY');

    const auditorMutateKyc = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/kyc-assessment`)
      .set(auth(financeAuditor.token))
      .send({ level: 'LEVEL_1', status: 'APPROVED', assessedBy: financeAuditor.principalId });
    expect(auditorMutateKyc.status).toBe(403);

    const auditorCases = await request(app.getHttpServer())
      .get('/api/v1/internal/compliance-cases?scope=COMPLIANCE')
      .set(auth(financeAuditor.token));
    expect(auditorCases.status).toBe(403);

    const auditorSupport = await request(app.getHttpServer())
      .get('/api/v1/internal/support/tickets')
      .set(auth(financeAuditor.token));
    expect(auditorSupport.status).toBe(403);

    // CUSTOMER_SERVICE cannot read KYC review queue or Compliance cases
    const csKyc = await request(app.getHttpServer())
      .get('/api/v1/internal/kyc/review-workspace/queue')
      .set(auth(customerService.token));
    expect(csKyc.status).toBe(403);

    const csComp = await request(app.getHttpServer())
      .get('/api/v1/internal/compliance-cases?scope=COMPLIANCE')
      .set(auth(customerService.token));
    expect(csComp.status).toBe(403);
  });
});
