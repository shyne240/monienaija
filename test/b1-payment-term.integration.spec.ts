import { createHash, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

import { AuthorizationService } from '../src/authorization/authorization.service';
import { PrivilegedActionApproval } from '../src/authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { SecurityEventHistory } from '../src/customer-authentication/security-event-history.entity';
import { B1BillingDocument } from '../src/policy/b1-billing-engine.entity';
import { B1BillingEngineRepository } from '../src/policy/b1-billing-engine.repository';
import { B1BillingEngineService } from '../src/policy/b1-billing-engine.service';
import type { B1InvoiceRequestV1 } from '../src/policy/b1-billing-engine.types';
import { B1CommercialDecision } from '../src/policy/b1-fee-engine.entity';
import { B1PaymentTermService } from '../src/policy/b1-payment-term.service';
import type { B1PaymentTermViewV1 } from '../src/policy/b1-payment-term.types';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import { IdempotencyRecord } from '../src/operations/idempotency-record.entity';
import { IdempotencyService } from '../src/operations/idempotency.service';
import { MetricsService } from '../src/operations/metrics.service';
import { OutboxEvent } from '../src/operations/outbox-event.entity';
import { OutboxService } from '../src/operations/outbox.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  truncateAllTables,
} from './support/pg-harness';

/**
 * B2F07-PRE-CONV.B1 — operational B1T12 payment-term and invoice-due-date convergence
 * against real PostgreSQL.
 *
 * This suite operationalizes the already-implemented B1T12 runtime through its real
 * production paths only (B1PaymentTermService + the canonical B1T05 invoice generator +
 * the real A2 approval service + Operations idempotency/audit/outbox), so that the B2F07
 * renewed-entry gate's B1 conditions become TRUE as repository evidence:
 *
 *   - one compatible ACTIVE B1 payment term exists;
 *   - one canonical invoice is bound to it with deterministic due-date evidence;
 *   - the B1-PAYMENT-TERM read port serves that evidence read-only.
 *
 * The term used here — reference MONIENAJA-B2F07-CONVERGENCE v1, ELAPSED_DAYS 0 — is an
 * INTERNAL CONVERGENCE/EVIDENCE TERM authorized for this task only. It is not a production
 * commercial policy, not a CBN term, not a customer-facing pricing decision, and not an
 * industry default (Net 7/15/30). No second term is introduced: the only additional
 * definition rows created anywhere in this suite are version-2 rows of this same reference
 * used solely to prove the repository's overlap/exactly-one-ACTIVE guards, and they are
 * never activated.
 *
 * B2F07 itself is not implemented or activated anywhere; the Architecture GO remains
 * PENDING. The A5/B2F03 convergence state is asserted untouched at the end.
 */
describe('B2F07-PRE-CONV.B1 B1T12 payment-term convergence (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let terms: B1PaymentTermService;
  let approvals: PrivilegedActionApprovalService;

  const TERM_REFERENCE = 'MONIENAJA-B2F07-CONVERGENCE';
  const TERM_SCOPE = 'commercial.virtual-account.inbound-funding';
  const ACTIVATE_ACTION = 'B1_PAYMENT_TERM_ACTIVATE';
  const TERM_RESOURCE = 'B1_PAYMENT_TERM';
  const EFFECTIVE_TO = '2036-12-31T00:00:00.000Z';
  const SHA256 = /^[a-f0-9]{64}$/;

  const maker = {
    type: 'PRIVILEGED' as const,
    principalId: 'b1-commercial-maker',
    roles: ['B1_COMMERCIAL_PREPARER'],
    scopes: ['privileged:request'],
    customerAccess: 'NONE' as const,
    assuranceLevel: 'MFA' as const,
  };
  const checker = {
    type: 'PRIVILEGED' as const,
    principalId: 'b1-commercial-checker',
    roles: ['B1_COMMERCIAL_APPROVER'],
    scopes: ['privileged:execute', 'privileged:approve'],
    customerAccess: 'NONE' as const,
    assuranceLevel: 'MFA' as const,
  };
  const ctx = () => ({
    requestId: randomUUID(),
    correlationId: randomUUID(),
    traceId: randomUUID(),
  });

  /**
   * The authorized internal convergence/evidence definition (from the task charter):
   * ELAPSED_DAYS 0 — the invoice is due at issuance. Applicability is the canonical v1
   * tuple with every dimension explicitly null (no invented commercial constraint);
   * currency/unit/scope remain locked to the first bounded scope by the runtime itself.
   */
  function termCommand(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      paymentTermReference: TERM_REFERENCE,
      paymentTermVersion: 1,
      termBasis: 'ELAPSED_DAYS',
      termValue: 0,
      effectiveFrom: new Date().toISOString(),
      effectiveTo: EFFECTIVE_TO,
      currency: 'NGN' as const,
      accountingUnit: 'CUSTOMER_FUNDS' as const,
      applicability: {
        capability: null,
        plan: null,
        subscription: null,
        product: null,
        customer: null,
        merchant: null,
        partner: null,
      },
      idempotencyKey: randomUUID(),
      principal: maker,
      requestContext: ctx(),
      ...overrides,
    };
  }

  function lifecycleCommand(
    view: B1PaymentTermViewV1,
    reason: string,
    now: Date,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      paymentTermReference: view.paymentTermReference,
      paymentTermVersion: view.paymentTermVersion,
      expectedRecordVersion: view.recordVersion,
      idempotencyKey: randomUUID(),
      principal: view.status === 'DRAFT' ? maker : checker,
      requestContext: ctx(),
      reason,
      now,
      ...overrides,
    };
  }

  /**
   * Requests and approves a real A2 approval for B1_PAYMENT_TERM_ACTIVATE carrying the
   * exact lifecycle fingerprint computed with the same command (including `now`).
   */
  async function approvedActivation(
    pending: B1PaymentTermViewV1,
    activateCommand: Record<string, unknown>,
  ): Promise<string> {
    const fingerprint = terms.computeLifecycleFingerprint(
      pending,
      activateCommand as never,
      ACTIVATE_ACTION,
    );
    const requested = await approvals.request({
      principal: maker,
      policy: {
        action: ACTIVATE_ACTION,
        resourceType: TERM_RESOURCE,
        requiredScopes: ['privileged:request'],
        requiredRoles: ['B1_COMMERCIAL_PREPARER'],
        minimumAssurance: 'MFA',
      } as never,
      resource: {
        type: TERM_RESOURCE,
        id: `${pending.paymentTermReference}/v${pending.paymentTermVersion}`,
      } as never,
      actionFingerprint: fingerprint,
      reason: 'Activate the internal convergence payment term',
    });
    await approvals.approve({ principal: checker, approvalId: requested.approval!.id });
    return requested.approval!.id;
  }

  /** Runs the real DRAFT → PENDING_APPROVAL → ACTIVE lifecycle and returns the views. */
  async function createSubmitActivate(overrides: Record<string, unknown> = {}) {
    const created = await terms.create(termCommand(overrides) as never);
    expect(created.outcome).toBe('CREATED');
    const draft = created.term!;
    const submitted = await terms.submitForApproval(
      lifecycleCommand(draft, 'Submit convergence term for approval', new Date()) as never,
    );
    expect(submitted.outcome).toBe('UPDATED');
    const pending = submitted.term!;
    expect(pending.status).toBe('PENDING_APPROVAL');
    const activateCommand = lifecycleCommand(
      pending,
      'Activate the internal convergence payment term',
      new Date(),
      { principal: checker },
    );
    const approvalId = await approvedActivation(pending, activateCommand);
    const activated = await terms.activate({
      ...activateCommand,
      approvalId,
    } as never);
    expect(activated.outcome).toBe('UPDATED');
    return { draft, pending, active: activated.term!, approvalId };
  }

  /**
   * A canonical B1T05 invoice request for the first bounded scope. `issuedAt` is assigned
   * by the real generator's execution clock; the suite never supplies or calculates it.
   */
  function invoiceRequest(): B1InvoiceRequestV1 {
    return {
      contractName: 'B1-BILLING-ENGINE',
      contractVersion: 1,
      invoiceRequestId: `b2f07-conv-invoice-request-${randomUUID()}`,
      invoiceRequestVersion: 1,
      scopeKey: TERM_SCOPE,
      scopeVersion: 1,
      expectedCurrency: 'NGN',
      expectedAccountingUnit: 'CUSTOMER_FUNDS',
      customerId: 'b2f07-conv-customer',
      merchantId: 'b2f07-conv-merchant',
      partnerId: 'b2f07-conv-partner',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: 'commercial.virtual-account.inbound-funding.fee',
      capabilityVersion: 1,
      planKey: 'b2f07-conv-plan',
      planVersion: 1,
      subscriptionKey: 'b2f07-conv-subscription',
      subscriptionVersion: 1,
      packageKey: 'b2f07-conv-package',
      packageVersion: 1,
      bundleKey: 'b2f07-conv-bundle',
      bundleVersion: 1,
      productEntitlementKey: 'b2f07-conv-entitlement',
      productEntitlementVersion: 1,
      customerTierKey: 'b2f07-conv-customer-tier',
      customerTierVersion: 1,
      merchantTierKey: 'b2f07-conv-merchant-tier',
      merchantTierVersion: 1,
      partnerTierKey: 'b2f07-conv-partner-tier',
      partnerTierVersion: 1,
      billingRecordReferences: [],
      commercialDecisionReferences: ['b2f07-conv-commercial-decision'],
      commercialDecisionIdempotencyKeys: ['b2f07-conv-commercial-decision-key'],
      idempotencyKey: createHash('sha256')
        .update(`b2f07.conv.invoice.${randomUUID()}`)
        .digest('hex'),
      requestContext: ctx(),
      causationId: null,
    } as B1InvoiceRequestV1;
  }

  /** Issues the canonical invoice through the real B1T05/B1T12 path and binds the term. */
  async function issueBoundInvoice(
    active: B1PaymentTermViewV1,
    idempotencyKey = randomUUID(),
    request = invoiceRequest(),
  ) {
    const command = {
      invoiceRequest: request,
      paymentTermReference: active.paymentTermReference,
      paymentTermVersion: active.paymentTermVersion,
      idempotencyKey,
      principal: maker,
      requestContext: ctx(),
    };
    return terms.issueInvoiceWithPaymentTerm(command as never);
  }

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('b1paymentterm');

    const audit = new AuditService(dataSource.getRepository(AuditEvent));
    const idempotency = new IdempotencyService(dataSource.getRepository(IdempotencyRecord));
    const outbox = new OutboxService(dataSource.getRepository(OutboxEvent));
    const metrics = new MetricsService(dataSource);
    approvals = new PrivilegedActionApprovalService(
      dataSource.getRepository(PrivilegedActionApproval),
      dataSource.getRepository(SecurityEventHistory),
      dataSource,
      audit,
      new AuthorizationService(dataSource, audit),
    );
    // The real B1T05 repository. Its catalog/fee collaborators are provably unused by any
    // method on the invoice-generation path exercised here (they are referenced nowhere in
    // the class body outside persistence methods this suite never calls); the generator,
    // hashing, and validation are the real production code — nothing is substituted.
    const billingRepository = new B1BillingEngineRepository(
      dataSource,
      dataSource.getRepository(B1BillingDocument),
      dataSource.getRepository(B1CommercialDecision),
      undefined as never,
      undefined as never,
      audit,
      outbox,
      idempotency,
      metrics,
    );
    const billing = new B1BillingEngineService(billingRepository);
    terms = new B1PaymentTermService(
      dataSource,
      billing,
      idempotency,
      approvals,
      audit,
      outbox,
      metrics,
    );
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  }, 60000);

  it('creates the internal convergence term definition with its immutable definition hash', async () => {
    const result = await terms.create(termCommand() as never);

    expect(result.outcome).toBe('CREATED');
    const term = result.term!;
    expect(term.paymentTermReference).toBe(TERM_REFERENCE);
    expect(term.paymentTermVersion).toBe(1);
    expect(term.termBasis).toBe('ELAPSED_DAYS');
    expect(term.termValue).toBe(0);
    expect(term.definitionHash).toMatch(SHA256);
    expect(term.currency).toBe('NGN');
    expect(term.accountingUnit).toBe('CUSTOMER_FUNDS');
    expect(term.commercialScopeKey).toBe(TERM_SCOPE);
    expect(term.status).toBe('DRAFT');
    expect(term.recordVersion).toBe(1);
    expect(term.idempotencyScope).toBe('b1.payment-term.definition.idempotency.v1');
    expect(term.applicability).toEqual({
      capability: null,
      plan: null,
      subscription: null,
      product: null,
      customer: null,
      merchant: null,
      partner: null,
    });
    expect(new Date(term.effectiveTo!).getTime()).toBeGreaterThan(
      new Date(term.effectiveFrom).getTime(),
    );

    const rows: Array<{ id: string; definition_hash: string; status: string }> =
      await dataSource.query(
        'SELECT id, definition_hash, status FROM b1_payment_terms WHERE payment_term_reference = $1',
        [TERM_REFERENCE],
      );
    const stored = firstRow(rows, 'term row');
    expect(stored.id).toBe(term.id);
    expect(stored.definition_hash).toBe(term.definitionHash);
    expect(stored.status).toBe('DRAFT');
  });

  it('submits the term for approval through the real lifecycle', async () => {
    const created = await terms.create(termCommand() as never);
    const draft = created.term!;
    const submitted = await terms.submitForApproval(
      lifecycleCommand(draft, 'Submit convergence term for approval', new Date()) as never,
    );

    expect(submitted.outcome).toBe('UPDATED');
    expect(submitted.term!.status).toBe('PENDING_APPROVAL');
    expect(submitted.term!.recordVersion).toBe(2);
  });

  it('activates the term by consuming a real A2 approval inside the lifecycle transaction', async () => {
    const { active, approvalId } = await createSubmitActivate();

    expect(active.status).toBe('ACTIVE');
    expect(active.persistedStatus).toBe('ACTIVE');
    expect(active.approvedBy).toBe(checker.principalId);
    expect(active.approvalId).toBe(approvalId);
    expect(active.recordVersion).toBe(3);

    const approvalRows: Array<{ status: string }> = await dataSource.query(
      'SELECT status FROM privileged_action_approvals WHERE id = $1',
      [approvalId],
    );
    expect(firstRow(approvalRows, 'approval status').status).toBe('CONSUMED');

    const activeRows: Array<{ payment_term_reference: string }> = await dataSource.query(
      `SELECT payment_term_reference FROM b1_payment_terms WHERE status = 'ACTIVE'`,
    );
    expect(activeRows).toHaveLength(1);
    expect(firstRow(activeRows, 'active term').payment_term_reference).toBe(TERM_REFERENCE);
  });

  it('refuses activation without an A2 approval', async () => {
    const created = await terms.create(termCommand() as never);
    const submitted = await terms.submitForApproval(
      lifecycleCommand(created.term!, 'Submit convergence term for approval', new Date()) as never,
    );
    const pending = submitted.term!;

    const result = await terms.activate(
      lifecycleCommand(pending, 'Activate without approval', new Date(), {
        principal: checker,
      }) as never,
    );
    expect(result.outcome).toBe('REJECTED');
    expect(result.failure?.code).toBe('APPROVAL_REQUIRED');

    const rows: Array<{ status: string }> = await dataSource.query(
      'SELECT status FROM b1_payment_terms WHERE payment_term_reference = $1',
      [TERM_REFERENCE],
    );
    expect(firstRow(rows, 'term status').status).toBe('PENDING_APPROVAL');
  });

  it('refuses a record-version-stale activation and leaves the approval unconsumed', async () => {
    const created = await terms.create(termCommand() as never);
    const submitted = await terms.submitForApproval(
      lifecycleCommand(created.term!, 'Submit convergence term for approval', new Date()) as never,
    );
    const pending = submitted.term!;
    const activateCommand = lifecycleCommand(
      pending,
      'Activate the internal convergence payment term',
      new Date(),
      { principal: checker },
    );
    const approvalId = await approvedActivation(pending, activateCommand);

    const result = await terms.activate({
      ...activateCommand,
      expectedRecordVersion: pending.recordVersion + 5,
      approvalId,
    } as never);
    expect(result.outcome).toBe('REJECTED');
    expect(result.failure?.code).toBe('INVALID_STATE_OR_VERSION');

    // Failure safety: the state guard fires before approval consumption, so nothing was
    // burned and no unsafe partial state exists.
    const approvalRows: Array<{ status: string }> = await dataSource.query(
      'SELECT status FROM privileged_action_approvals WHERE id = $1',
      [approvalId],
    );
    expect(firstRow(approvalRows, 'approval status').status).toBe('APPROVED');
    const termRows: Array<{ status: string }> = await dataSource.query(
      'SELECT status FROM b1_payment_terms WHERE payment_term_reference = $1',
      [TERM_REFERENCE],
    );
    expect(firstRow(termRows, 'term status').status).toBe('PENDING_APPROVAL');
    const activations: Array<Record<string, unknown>> = await dataSource.query(
      `SELECT id FROM audit_events WHERE entity_type = 'B1_PAYMENT_TERM' AND action = 'B1_PAYMENT_TERM_ACTIVE'`,
    );
    expect(activations).toHaveLength(0);
  });

  it('refuses an overlapping ACTIVE term for the exact applicability tuple', async () => {
    const { active } = await createSubmitActivate();
    expect(active.status).toBe('ACTIVE');

    // Same reference, next version, identical applicability tuple: the repository's own
    // overlap guard must refuse a second ACTIVE definition. (This is a version row of the
    // same convergence reference, never activated — no other term is introduced.)
    const createdV2 = await terms.create(termCommand({ paymentTermVersion: 2 }) as never);
    expect(createdV2.outcome).toBe('CREATED');
    const submittedV2 = await terms.submitForApproval(
      lifecycleCommand(
        createdV2.term!,
        'Submit v2 for the overlap guard check',
        new Date(),
      ) as never,
    );
    const pendingV2 = submittedV2.term!;
    const activateV2 = lifecycleCommand(
      pendingV2,
      'Attempt to activate an overlapping ACTIVE term',
      new Date(),
      { principal: checker },
    );
    const approvalV2 = await approvedActivation(pendingV2, activateV2);

    const result = await terms.activate({ ...activateV2, approvalId: approvalV2 } as never);
    expect(result.outcome).toBe('REJECTED');
    expect(result.failure?.code).toBe('ACTIVE_EFFECTIVE_OVERLAP');

    // The overlap guard fires before approval consumption.
    const approvalRows: Array<{ status: string }> = await dataSource.query(
      'SELECT status FROM privileged_action_approvals WHERE id = $1',
      [approvalV2],
    );
    expect(firstRow(approvalRows, 'v2 approval status').status).toBe('APPROVED');
    const activeRows: Array<{ payment_term_version: number }> = await dataSource.query(
      `SELECT payment_term_version FROM b1_payment_terms WHERE status = 'ACTIVE'`,
    );
    expect(activeRows).toHaveLength(1);
    expect(Number(firstRow(activeRows, 'active term').payment_term_version)).toBe(1);
    const v2Rows: Array<{ status: string }> = await dataSource.query(
      'SELECT status FROM b1_payment_terms WHERE payment_term_version = 2',
    );
    expect(firstRow(v2Rows, 'v2 status').status).toBe('PENDING_APPROVAL');
  });

  it('issues a canonical invoice and binds the convergence term with deterministic due-date evidence', async () => {
    const { active } = await createSubmitActivate();
    const bound = await issueBoundInvoice(active);
    expect(bound.outcome).toBe('BOUND');
    const binding = bound.binding!;

    expect(binding.paymentTermReference).toBe(TERM_REFERENCE);
    expect(binding.paymentTermVersion).toBe(1);
    expect(binding.paymentTermDefinitionHash).toBe(active.definitionHash);
    expect(binding.termBasis).toBe('ELAPSED_DAYS');
    expect(binding.termValue).toBe(0);
    expect(binding.bindingHash).toMatch(SHA256);
    expect(binding.invoiceHash).toMatch(SHA256);
    expect(binding.dueDateCalculationHash).toMatch(SHA256);
    expect(binding.currency).toBe('NGN');
    expect(binding.accountingUnit).toBe('CUSTOMER_FUNDS');
    expect(binding.effectiveAt).toBe(binding.issuedAt);
    // ELAPSED_DAYS = 0 ⇒ the service derives dueAt from issuedAt with zero elapsed days;
    // the suite compares the service's own outputs and never computes a due date itself.
    expect(binding.dueAt).toBe(binding.issuedAt);
    expect(binding.invoice.invoiceId).toBeTruthy();
    expect(binding.invoiceReference).toBe(binding.invoice.invoiceNumber);

    const documents: Array<{ id: string; document_reference: string }> = await dataSource.query(
      `SELECT id, document_reference FROM b1_billing_documents WHERE document_kind = 'INVOICE'`,
    );
    expect(documents).toHaveLength(1);
    expect(firstRow(documents, 'billing document').id).toBe(binding.invoice.invoiceId);
    const bindings: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM b1_invoice_payment_term_bindings',
    );
    expect(bindings).toHaveLength(1);
  });

  it('exposes canonical B1-PAYMENT-TERM read-port evidence for B2F07', async () => {
    const { active } = await createSubmitActivate();
    const bound = await issueBoundInvoice(active);
    const binding = bound.binding!;

    const evidence = await terms.getInvoicePaymentTermEvidence(binding.invoiceReference, 1);
    expect(evidence).not.toBeNull();
    expect(evidence!.contractName).toBe('B1-PAYMENT-TERM');
    expect(evidence!.contractVersion).toBe(1);
    expect(evidence!.readOnly).toBe(true);
    expect(evidence!.term.paymentTermReference).toBe(TERM_REFERENCE);
    expect(evidence!.term.paymentTermVersion).toBe(1);
    expect(evidence!.term.definitionHash).toBe(active.definitionHash);
    expect(evidence!.term.termBasis).toBe('ELAPSED_DAYS');
    expect(evidence!.term.termValue).toBe(0);
    expect(evidence!.term.status).toBe('ACTIVE');
    expect(evidence!.term.currency).toBe('NGN');
    expect(evidence!.term.accountingUnit).toBe('CUSTOMER_FUNDS');
    expect(evidence!.term.commercialScopeKey).toBe(TERM_SCOPE);
    expect(evidence!.invoice.issuedAt).toBe(binding.issuedAt);
    expect(evidence!.binding.dueAt).toBe(binding.dueAt);
    expect(evidence!.binding.dueDateCalculationHash).toBe(binding.dueDateCalculationHash);
    expect(evidence!.amendments).toEqual([]);
    expect(evidence!.effectiveEvidenceReference).toBe(binding.bindingReference);
    expect(evidence!.effectiveEvidenceHash).toBe(binding.bindingHash);
    expect(evidence!.effectiveDueAt).toBe(binding.dueAt);
    expect(evidence!.supersessionStatus).toBe('ORIGINAL');
    expect(new Date(evidence!.term.effectiveTo!).getTime()).toBeGreaterThan(
      new Date(evidence!.verifiedAt).getTime(),
    );
  });

  it('detects evidence drift instead of serving stale reads', async () => {
    const { active } = await createSubmitActivate();
    const bound = await issueBoundInvoice(active);
    const binding = bound.binding!;

    // Simulated drift on the test row: the canonical read must fail loud, never serve
    // stale evidence.
    await dataSource.query(`UPDATE b1_payment_terms SET definition_hash = $1 WHERE id = $2`, [
      '0'.repeat(64),
      active.id,
    ]);
    try {
      await expect(
        terms.getInvoicePaymentTermEvidence(binding.invoiceReference, 1),
      ).rejects.toBeTruthy();
    } finally {
      await dataSource.query(`UPDATE b1_payment_terms SET definition_hash = $1 WHERE id = $2`, [
        active.definitionHash,
        active.id,
      ]);
    }
    const restored = await terms.getInvoicePaymentTermEvidence(binding.invoiceReference, 1);
    expect(restored).not.toBeNull();
  });

  it('replays term creation, activation and invoice binding without duplicating any state', async () => {
    const createCmd = termCommand();
    const created = await terms.create(createCmd as never);
    const createdReplay = await terms.create(createCmd as never);
    expect(created.outcome).toBe('CREATED');
    expect(createdReplay.outcome).toBe('REPLAYED');
    expect(createdReplay.term!.definitionHash).toBe(created.term!.definitionHash);

    const draft = created.term!;
    const submitCmd = lifecycleCommand(draft, 'Submit convergence term for approval', new Date());
    const submitted = await terms.submitForApproval(submitCmd as never);
    const submittedReplay = await terms.submitForApproval(submitCmd as never);
    expect(submitted.outcome).toBe('UPDATED');
    expect(submittedReplay.outcome).toBe('REPLAYED');

    const pending = submitted.term!;
    const activateCmd = lifecycleCommand(
      pending,
      'Activate the internal convergence payment term',
      new Date(),
      { principal: checker },
    );
    const approvalId = await approvedActivation(pending, activateCmd);
    const activateWithApproval = { ...activateCmd, approvalId };
    const activated = await terms.activate(activateWithApproval as never);
    const activatedReplay = await terms.activate(activateWithApproval as never);
    expect(activated.outcome).toBe('UPDATED');
    expect(activatedReplay.outcome).toBe('REPLAYED');
    expect(activatedReplay.term!.status).toBe('ACTIVE');
    expect(activatedReplay.term!.definitionHash).toBe(activated.term!.definitionHash);

    const active = activated.term!;
    const request = invoiceRequest();
    const bindingKey = randomUUID();
    const bound = await issueBoundInvoice(active, bindingKey, request);
    const boundReplay = await issueBoundInvoice(active, bindingKey, request);
    expect(bound.outcome).toBe('BOUND');
    expect(boundReplay.outcome).toBe('REPLAYED');
    expect(boundReplay.binding!.bindingHash).toBe(bound.binding!.bindingHash);
    expect(boundReplay.binding!.dueDateCalculationHash).toBe(bound.binding!.dueDateCalculationHash);

    const termRows: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM b1_payment_terms',
    );
    expect(termRows).toHaveLength(1);
    const activeRows: Array<Record<string, unknown>> = await dataSource.query(
      `SELECT id FROM b1_payment_terms WHERE status = 'ACTIVE'`,
    );
    expect(activeRows).toHaveLength(1);
    const documents: Array<Record<string, unknown>> = await dataSource.query(
      `SELECT id FROM b1_billing_documents WHERE document_kind = 'INVOICE'`,
    );
    expect(documents).toHaveLength(1);
    const bindings: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM b1_invoice_payment_term_bindings',
    );
    expect(bindings).toHaveLength(1);
  });

  it('rejects the same definition idempotency key carrying different semantics', async () => {
    const key = randomUUID();
    await terms.create(termCommand({ idempotencyKey: key }) as never);
    await expect(
      terms.create(termCommand({ idempotencyKey: key, termValue: 1 }) as never),
    ).rejects.toBeTruthy();

    const rows: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM b1_payment_terms',
    );
    expect(rows).toHaveLength(1);
  });

  it('writes audit and outbox evidence for the complete convergence', async () => {
    const { active } = await createSubmitActivate();
    const bound = await issueBoundInvoice(active);
    expect(bound.outcome).toBe('BOUND');

    const audits: Array<{ action: string }> = await dataSource.query(
      `SELECT action FROM audit_events WHERE entity_type IN ('B1_PAYMENT_TERM','B1_INVOICE_PAYMENT_TERM_BINDING') ORDER BY occurred_at, action`,
    );
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('B1_PAYMENT_TERM_CREATED');
    expect(actions).toContain('B1_PAYMENT_TERM_PENDING_APPROVAL');
    expect(actions).toContain('B1_PAYMENT_TERM_ACTIVE');
    expect(actions).toContain('B1_INVOICE_PAYMENT_TERM_BOUND');

    const outbox: Array<{ event_type: string; payload: Record<string, unknown> }> =
      await dataSource.query(
        `SELECT event_type, payload FROM outbox_events WHERE event_type LIKE 'B1%'`,
      );
    const eventTypes = outbox.map((e) => e.event_type).sort();
    // Lifecycle transitions emit audit/metrics only by design; durable outbox evidence
    // exists for the immutable definition and the immutable binding.
    expect(eventTypes).toEqual(['B1InvoicePaymentTermBound', 'B1PaymentTermCreated']);
    const createdEvent = outbox.find((e) => e.event_type === 'B1PaymentTermCreated')!;
    expect(createdEvent.payload['paymentTermReference']).toBe(TERM_REFERENCE);
    const boundEvent = outbox.find((e) => e.event_type === 'B1InvoicePaymentTermBound')!;
    expect(boundEvent.payload['dueAt']).toBe(bound.binding!.dueAt);
    expect(boundEvent.payload['dueDateCalculationHash']).toBe(
      bound.binding!.dueDateCalculationHash,
    );
  });

  it('leaves A5/B2F Finance state untouched and B2F07 unactivated', async () => {
    const { active } = await createSubmitActivate();
    const bound = await issueBoundInvoice(active);
    expect(active.status).toBe('ACTIVE');
    expect(bound.outcome).toBe('BOUND');

    // No A5 ledger account, mapping, control decision, or B2 Finance state may be
    // created or modified by the B1 convergence.
    const ledgerAccounts: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM ledger_accounts',
    );
    expect(ledgerAccounts).toHaveLength(0);
    const mappings: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM b2f_finance_account_mappings',
    );
    expect(mappings).toHaveLength(0);
    const decisions: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM b2f_finance_control_decisions',
    );
    expect(decisions).toHaveLength(0);

    // The B1 side holds exactly the expected evidence.
    const activeTerms: Array<Record<string, unknown>> = await dataSource.query(
      `SELECT id FROM b1_payment_terms WHERE status = 'ACTIVE' AND payment_term_reference = $1`,
      [TERM_REFERENCE],
    );
    expect(activeTerms).toHaveLength(1);
    const bindings: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM b1_invoice_payment_term_bindings',
    );
    expect(bindings).toHaveLength(1);
  });
});
