import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PrivilegedActionApprovalService } from '../authorization/privileged-action-approval.service';
import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { MetricsService } from '../operations/metrics.service';
import { OutboxService } from '../operations/outbox.service';
import { B1BillingDocument } from './b1-billing-engine.entity';
import { B1BillingEngineService } from './b1-billing-engine.service';
import type { B1InvoiceV1 } from './b1-billing-engine.types';
import {
  B1DueDateAmendment,
  B1InvoicePaymentTermBinding,
  B1PaymentTerm,
} from './b1-payment-term.entity';
import type {
  B1DueDateAmendmentCommandV1,
  B1DueDateAmendmentResultV1,
  B1DueDateAmendmentViewV1,
  B1InvoicePaymentTermBindingCommandV1,
  B1InvoicePaymentTermBindingResultV1,
  B1InvoicePaymentTermBindingViewV1,
  B1InvoicePaymentTermEvidenceV1,
  B1PaymentTermApplicabilityV1,
  B1PaymentTermConsumerPortsV1,
  B1PaymentTermCreateCommandV1,
  B1PaymentTermLifecycleCommandV1,
  B1PaymentTermResultV1,
  B1PaymentTermViewV1,
} from './b1-payment-term.types';
import { runSerializableWithRetry } from '../common/serializable-transaction';

const DEFINITION_SCOPE = 'b1.payment-term.definition.idempotency.v1' as const;
const BINDING_SCOPE = 'b1.payment-term.invoice-binding.idempotency.v1' as const;
const AMENDMENT_SCOPE = 'b1.payment-term.due-date-amendment.idempotency.v1' as const;
const RETENTION_SECONDS = 86_400;
const SECONDS_PER_DAY = 86_400;
const MILLISECONDS_PER_DAY = SECONDS_PER_DAY * 1000;
const SAFE_REFERENCE = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,179}$/;
const SHA256 = /^[a-f0-9]{64}$/;

type Failure = Readonly<{ code: string; message: string }>;

export function b1CanonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new BadRequestException('Non-finite numbers are not canonical JSON');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => b1CanonicalJson(item)).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${b1CanonicalJson(object[key])}`)
    .join(',')}}`;
}
export function b1Hash(value: unknown): string {
  return createHash('sha256').update(b1CanonicalJson(value), 'utf8').digest('hex');
}
export function b1CanonicalInstant(value: string | Date, field = 'timestamp'): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new BadRequestException(`${field} must be a valid instant`);
  return date.toISOString();
}
export function b1CalculateDueAt(issuedAt: string, termValue: number): string {
  if (!Number.isSafeInteger(termValue) || termValue < 0 || termValue > 3660)
    throw new BadRequestException('termValue must be an integer from 0 through 3660');
  const issued = new Date(b1CanonicalInstant(issuedAt, 'issuedAt')).getTime();
  const increment = termValue * MILLISECONDS_PER_DAY;
  if (!Number.isSafeInteger(increment))
    throw new BadRequestException('due-date arithmetic lost precision');
  const result = issued + increment;
  if (!Number.isSafeInteger(result) || !Number.isFinite(result))
    throw new BadRequestException('due-date arithmetic overflowed');
  const due = new Date(result);
  if (!Number.isFinite(due.getTime())) throw new BadRequestException('dueAt is invalid');
  return due.toISOString();
}

@Injectable()
export class B1PaymentTermService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly billing: B1BillingEngineService,
    private readonly idempotency: IdempotencyService,
    private readonly approvals: PrivilegedActionApprovalService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly metrics: MetricsService,
  ) {}

  getConsumerPorts(): B1PaymentTermConsumerPortsV1 {
    return {
      contractName: 'B1-PAYMENT-TERM',
      contractVersion: 1,
      getInvoicePaymentTermEvidence: (reference, version = 1, at = new Date()) =>
        this.getInvoicePaymentTermEvidence(reference, version, at),
    };
  }

  computeDefinitionHash(command: B1PaymentTermCreateCommandV1): string {
    const normalized = this.normalizeCreate(command);
    return b1Hash({
      paymentTermReference: normalized.paymentTermReference,
      paymentTermVersion: normalized.paymentTermVersion,
      termBasis: normalized.termBasis,
      termValue: normalized.termValue,
      effectiveFrom: normalized.effectiveFrom,
      effectiveTo: normalized.effectiveTo,
      currency: normalized.currency,
      accountingUnit: normalized.accountingUnit,
      commercialScopeProvenance: {
        commercialScopeKey: 'commercial.virtual-account.inbound-funding',
        commercialScopeVersion: 1,
        applicability: normalized.applicability,
      },
    });
  }

  async create(command: B1PaymentTermCreateCommandV1): Promise<B1PaymentTermResultV1> {
    const normalized = this.normalizeCreate(command);
    const definitionHash = this.computeDefinitionHash(command);
    const requestHash = b1Hash({ operation: 'CREATE', definitionHash });
    return runSerializableWithRetry(
      this.dataSource,
      'B1PaymentTermService.create',
      async (manager) => {
        const reservation = await this.idempotency.reserve(manager, {
          scope: DEFINITION_SCOPE,
          key: command.idempotencyKey,
          requestHash,
          retentionSeconds: RETENTION_SECONDS,
        });
        if (reservation.kind === 'REPLAY') return this.replayTerm(reservation.record.responseBody);
        const repository = manager.getRepository(B1PaymentTerm);
        const versions = await repository.find({
          where: { paymentTermReference: normalized.paymentTermReference },
          order: { paymentTermVersion: 'ASC' },
        });
        const expectedVersion =
          versions.length === 0 ? 1 : versions[versions.length - 1]!.paymentTermVersion + 1;
        if (normalized.paymentTermVersion !== expectedVersion)
          return this.rejectTerm(manager, reservation.record.id, {
            code: 'TERM_VERSION_INVALID',
            message: `paymentTermVersion must be ${expectedVersion}`,
          });
        if (versions.some((term) => term.paymentTermVersion === normalized.paymentTermVersion))
          return this.rejectTerm(manager, reservation.record.id, {
            code: 'TERM_VERSION_EXISTS',
            message: 'payment-term version already exists',
          });
        const now = command.now ?? new Date();
        const term = repository.create({
          id: randomUUID(),
          ...normalized,
          effectiveFrom: new Date(normalized.effectiveFrom),
          effectiveTo: normalized.effectiveTo ? new Date(normalized.effectiveTo) : null,
          definitionHash,
          commercialScopeKey: 'commercial.virtual-account.inbound-funding',
          commercialScopeVersion: 1,
          status: 'DRAFT',
          idempotencyScope: DEFINITION_SCOPE,
          idempotencyKey: command.idempotencyKey,
          createdBy: command.principal.principalId,
          approvedBy: null,
          approvalId: null,
          lastReason: null,
          correlationId: command.requestContext.correlationId,
          causationId: command.causationId ?? null,
          recordVersion: 1,
          createdAt: now,
          updatedAt: now,
        });
        const saved = await repository.save(term);
        await this.record(
          manager,
          'B1_PAYMENT_TERM',
          saved.id,
          'B1_PAYMENT_TERM_CREATED',
          command.principal.principalId,
          {
            paymentTermReference: saved.paymentTermReference,
            paymentTermVersion: saved.paymentTermVersion,
            definitionHash,
            status: 'DRAFT',
          },
          command,
        );
        await this.emit(
          manager,
          'B1PaymentTermCreated',
          'B1_PAYMENT_TERM',
          saved.id,
          definitionHash,
          this.termView(saved, now),
          command,
        );
        await this.metrics.increment(manager, 'b1.payment-term.created');
        const result: B1PaymentTermResultV1 = {
          outcome: 'CREATED',
          term: this.termView(saved, now),
          replayed: false,
          failure: null,
        };
        await this.idempotency.complete(manager, reservation.record.id, {
          statusCode: 201,
          responseBody: result as unknown as Record<string, unknown>,
          resourceType: 'B1_PAYMENT_TERM',
          resourceId: saved.id,
        });
        return result;
      },
    );
  }

  async submitForApproval(
    command: B1PaymentTermLifecycleCommandV1,
  ): Promise<B1PaymentTermResultV1> {
    return this.transition(command, 'ACTIVATE', 'DRAFT', 'PENDING_APPROVAL', false);
  }
  async activate(command: B1PaymentTermLifecycleCommandV1): Promise<B1PaymentTermResultV1> {
    return this.transition(command, 'ACTIVATE', 'PENDING_APPROVAL', 'ACTIVE', true);
  }
  async revoke(command: B1PaymentTermLifecycleCommandV1): Promise<B1PaymentTermResultV1> {
    return this.transition(command, 'REVOKE', 'ACTIVE', 'REVOKED', true);
  }

  computeLifecycleFingerprint(
    term: B1PaymentTermViewV1,
    command: B1PaymentTermLifecycleCommandV1,
    action: 'B1_PAYMENT_TERM_ACTIVATE' | 'B1_PAYMENT_TERM_REVOKE',
  ): string {
    const semanticRequestHash = b1Hash({
      operation: action.endsWith('ACTIVATE') ? 'ACTIVATE' : 'REVOKE',
      paymentTermReference: term.paymentTermReference,
      paymentTermVersion: term.paymentTermVersion,
      expectedRecordVersion: command.expectedRecordVersion,
      reason: command.reason.trim(),
      effectiveDate: b1CanonicalInstant(command.now ?? new Date()),
    });
    return b1Hash({
      operation: action,
      resourceType: 'B1_PAYMENT_TERM',
      resourceId: this.termResourceId(term.paymentTermReference, term.paymentTermVersion),
      semanticRequestHash,
      termHash: term.definitionHash,
      actorIdentity: command.principal.principalId,
      effectiveDate: b1CanonicalInstant(command.now ?? new Date()),
      expectedVersion: command.expectedRecordVersion,
    });
  }

  async issueInvoiceWithPaymentTerm(
    command: B1InvoicePaymentTermBindingCommandV1,
  ): Promise<B1InvoicePaymentTermBindingResultV1> {
    const requestHash = this.bindingRequestHash(command);
    return runSerializableWithRetry(
      this.dataSource,
      'B1PaymentTermService.issueInvoiceWithPaymentTerm',
      async (manager) => {
        const reservation = await this.idempotency.reserve(manager, {
          scope: BINDING_SCOPE,
          key: command.idempotencyKey,
          requestHash,
          retentionSeconds: RETENTION_SECONDS,
        });
        if (reservation.kind === 'REPLAY')
          return this.replayBinding(reservation.record.responseBody);
        const recovered = await manager
          .getRepository(B1InvoicePaymentTermBinding)
          .findOne({ where: { idempotencyKey: command.idempotencyKey, requestHash } });
        if (recovered)
          return this.completeRecoveredBinding(manager, reservation.record.id, recovered);
        const generated = this.billing.generateInvoice(command.invoiceRequest);
        if (generated.failure)
          return this.rejectBinding(manager, reservation.record.id, {
            code: 'CANONICAL_INVOICE_REJECTED',
            message: generated.failure.message,
          });
        const invoice = await this.persistOrReadCanonicalInvoice(manager, generated);
        const issuedAt = b1CanonicalInstant(invoice.issuedAt, 'invoice.issuedAt');
        const matches = await this.findApplicableTerms(manager, invoice, issuedAt);
        if (matches.length !== 1)
          return this.rejectBinding(manager, reservation.record.id, {
            code: matches.length === 0 ? 'NO_APPLICABLE_TERM' : 'AMBIGUOUS_APPLICABLE_TERMS',
            message: `expected exactly one applicable payment term; found ${matches.length}`,
          });
        const term = matches[0]!;
        if (
          term.paymentTermReference !== command.paymentTermReference ||
          term.paymentTermVersion !== command.paymentTermVersion
        )
          return this.rejectBinding(manager, reservation.record.id, {
            code: 'SELECTED_TERM_MISMATCH',
            message: 'selected payment term is not the sole applicable term',
          });
        if (invoice.currency !== term.currency || invoice.accountingUnit !== term.accountingUnit)
          return this.rejectBinding(manager, reservation.record.id, {
            code: 'TERM_INVOICE_UNIT_MISMATCH',
            message: 'term currency/accounting unit does not match invoice',
          });
        const dueAt = b1CalculateDueAt(issuedAt, term.termValue);
        const calculationHash = b1Hash({
          issuedAt,
          termBasis: term.termBasis,
          termValue: term.termValue,
          arithmeticRule: 'UTC_INSTANT_ELAPSED',
          secondsPerDay: SECONDS_PER_DAY,
          dueAt,
        });
        const bindingHash = b1Hash({
          invoiceReference: invoice.invoiceNumber,
          invoiceVersion: invoice.invoiceVersion,
          invoiceHash: invoice.invoiceHash,
          issuedAt,
          paymentTermReference: term.paymentTermReference,
          paymentTermVersion: term.paymentTermVersion,
          paymentTermDefinitionHash: term.definitionHash,
          termBasis: term.termBasis,
          termValue: term.termValue,
          dueAt,
          currency: invoice.currency,
          accountingUnit: invoice.accountingUnit,
        });
        const reference = `b1-invoice-term-${bindingHash.slice(0, 32)}`;
        const existing = await manager
          .getRepository(B1InvoicePaymentTermBinding)
          .findOne({ where: { invoiceReference: invoice.invoiceNumber, invoiceVersion: 1 } });
        if (existing) {
          if (existing.bindingHash === bindingHash)
            return this.completeRecoveredBinding(manager, reservation.record.id, existing);
          return this.rejectBinding(manager, reservation.record.id, {
            code: 'INVOICE_ALREADY_BOUND',
            message: 'invoice already has different immutable payment-term evidence',
          });
        }
        const now = command.now ?? new Date();
        const entity = manager.getRepository(B1InvoicePaymentTermBinding).create({
          id: randomUUID(),
          bindingReference: reference,
          bindingHash,
          requestHash,
          invoiceReference: invoice.invoiceNumber,
          invoiceVersion: 1,
          invoiceHash: invoice.invoiceHash,
          issuedAt: new Date(issuedAt),
          paymentTermReference: term.paymentTermReference,
          paymentTermVersion: term.paymentTermVersion,
          paymentTermDefinitionHash: term.definitionHash,
          termBasis: term.termBasis,
          termValue: term.termValue,
          dueAt: new Date(dueAt),
          dueDateCalculationHash: calculationHash,
          currency: invoice.currency,
          accountingUnit: invoice.accountingUnit,
          effectiveAt: new Date(issuedAt),
          applicability: term.applicability,
          invoiceRecord: invoice,
          idempotencyScope: BINDING_SCOPE,
          idempotencyKey: command.idempotencyKey,
          createdBy: command.principal.principalId,
          correlationId: command.requestContext.correlationId,
          causationId: command.causationId ?? null,
          createdAt: now,
        });
        const saved = await manager.getRepository(B1InvoicePaymentTermBinding).save(entity);
        await this.record(
          manager,
          'B1_INVOICE_PAYMENT_TERM_BINDING',
          saved.id,
          'B1_INVOICE_PAYMENT_TERM_BOUND',
          command.principal.principalId,
          { bindingReference: reference, bindingHash, dueAt, calculationHash },
          command,
        );
        await this.emit(
          manager,
          'B1InvoicePaymentTermBound',
          'B1_INVOICE_PAYMENT_TERM_BINDING',
          saved.id,
          bindingHash,
          this.bindingView(saved),
          command,
        );
        await this.metrics.increment(manager, 'b1.payment-term.invoice-bound');
        const result: B1InvoicePaymentTermBindingResultV1 = {
          outcome: 'BOUND',
          binding: this.bindingView(saved),
          replayed: false,
          failure: null,
        };
        await this.idempotency.complete(manager, reservation.record.id, {
          statusCode: 201,
          responseBody: result as unknown as Record<string, unknown>,
          resourceType: 'B1_INVOICE_PAYMENT_TERM_BINDING',
          resourceId: saved.id,
        });
        return result;
      },
    );
  }

  async computeAmendmentApprovalFingerprint(command: B1DueDateAmendmentCommandV1): Promise<string> {
    const evidence = await this.amendmentSemantic(command);
    return b1Hash({
      operation: 'B1_PAYMENT_TERM_DUE_DATE_AMEND',
      resourceType: 'B1_PAYMENT_TERM_DUE_DATE_AMENDMENT',
      resourceId: evidence.amendmentReference,
      semanticRequestHash: evidence.requestHash,
      amendmentHash: evidence.amendmentHash,
      actorIdentity: command.principal.principalId,
      effectiveDate: evidence.effectiveAt,
      expectedVersion: evidence.sequence,
    });
  }

  async amendDueDate(command: B1DueDateAmendmentCommandV1): Promise<B1DueDateAmendmentResultV1> {
    const semantic = await this.amendmentSemantic(command);
    return runSerializableWithRetry(
      this.dataSource,
      'B1PaymentTermService.amendDueDate',
      async (manager) => {
        const reservation = await this.idempotency.reserve(manager, {
          scope: AMENDMENT_SCOPE,
          key: command.idempotencyKey,
          requestHash: semantic.requestHash,
          retentionSeconds: RETENTION_SECONDS,
        });
        if (reservation.kind === 'REPLAY')
          return this.replayAmendment(reservation.record.responseBody);
        const binding = await this.lockBinding(manager, command.bindingReference);
        if (!binding)
          return this.rejectAmendment(manager, reservation.record.id, {
            code: 'BINDING_NOT_FOUND',
            message: 'binding not found',
          });
        const latest = await this.latestAmendment(manager, binding.bindingReference, true);
        const expectedReference = latest?.amendmentReference ?? binding.bindingReference;
        const expectedHash = latest?.amendmentHash ?? binding.bindingHash;
        if (
          command.supersedesEvidenceReference !== expectedReference ||
          command.expectedEvidenceHash !== expectedHash
        )
          return this.rejectAmendment(manager, reservation.record.id, {
            code: 'STALE_SUPERSESSION',
            message: 'amendment does not supersede current evidence',
          });
        if (
          semantic.originalBindingHash !== binding.bindingHash ||
          semantic.sequence !== (latest?.sequence ?? 0) + 1
        )
          return this.rejectAmendment(manager, reservation.record.id, {
            code: 'AMENDMENT_EVIDENCE_DRIFT',
            message: 'amendment evidence changed before persistence',
          });
        const fingerprint = await this.computeAmendmentApprovalFingerprint(command);
        const approval = await this.approvals.consumeInTransaction(manager, {
          principal: command.principal,
          approvalId: command.approvalId,
          actionType: 'B1_PAYMENT_TERM_DUE_DATE_AMEND',
          resource: { type: 'B1_PAYMENT_TERM_DUE_DATE_AMENDMENT', id: semantic.amendmentReference },
          actionFingerprint: fingerprint,
          now: command.now,
        });
        if (!approval.approved || !approval.approval)
          return this.rejectAmendment(manager, reservation.record.id, {
            code: 'APPROVAL_REJECTED',
            message: `A2 approval rejected: ${approval.reason ?? 'unknown'}`,
          });
        const entity = manager.getRepository(B1DueDateAmendment).create({
          id: randomUUID(),
          amendmentReference: semantic.amendmentReference,
          amendmentHash: semantic.amendmentHash,
          requestHash: semantic.requestHash,
          originalBindingReference: binding.bindingReference,
          originalBindingHash: binding.bindingHash,
          originalIssuedAt: binding.issuedAt,
          originalDueAt: binding.dueAt,
          replacementElapsedDays: command.replacementElapsedDays,
          replacementDueAt: new Date(semantic.replacementDueAt),
          reason: semantic.reason,
          effectiveAt: new Date(semantic.effectiveAt),
          supersedesEvidenceReference: command.supersedesEvidenceReference,
          supersedesEvidenceHash: command.expectedEvidenceHash,
          sequence: semantic.sequence,
          approvalId: command.approvalId,
          approvedBy: approval.approval.approvedBy ?? command.principal.principalId,
          idempotencyScope: AMENDMENT_SCOPE,
          idempotencyKey: command.idempotencyKey,
          createdBy: command.principal.principalId,
          correlationId: command.requestContext.correlationId,
          causationId: command.causationId ?? null,
          createdAt: command.now ?? new Date(),
        });
        const saved = await manager.getRepository(B1DueDateAmendment).save(entity);
        await this.record(
          manager,
          'B1_DUE_DATE_AMENDMENT',
          saved.id,
          'B1_PAYMENT_TERM_DUE_DATE_AMENDED',
          command.principal.principalId,
          {
            amendmentReference: saved.amendmentReference,
            amendmentHash: saved.amendmentHash,
            supersedesEvidenceReference: saved.supersedesEvidenceReference,
            replacementDueAt: semantic.replacementDueAt,
          },
          command,
        );
        await this.emit(
          manager,
          'B1PaymentTermDueDateAmended',
          'B1_DUE_DATE_AMENDMENT',
          saved.id,
          saved.amendmentHash,
          this.amendmentView(saved),
          command,
        );
        await this.metrics.increment(manager, 'b1.payment-term.due-date-amended');
        const result: B1DueDateAmendmentResultV1 = {
          outcome: 'AMENDED',
          amendment: this.amendmentView(saved),
          replayed: false,
          failure: null,
        };
        await this.idempotency.complete(manager, reservation.record.id, {
          statusCode: 201,
          responseBody: result as unknown as Record<string, unknown>,
          resourceType: 'B1_DUE_DATE_AMENDMENT',
          resourceId: saved.id,
        });
        return result;
      },
    );
  }

  async getByReference(
    reference: string,
    version: number,
    at = new Date(),
  ): Promise<B1PaymentTermViewV1 | null> {
    const term = await this.dataSource
      .getRepository(B1PaymentTerm)
      .findOne({ where: { paymentTermReference: reference, paymentTermVersion: version } });
    return term ? this.termView(term, at) : null;
  }

  async getInvoicePaymentTermEvidence(
    invoiceReference: string,
    invoiceVersion: 1 = 1,
    at = new Date(),
  ): Promise<B1InvoicePaymentTermEvidenceV1 | null> {
    if (invoiceVersion !== 1) return null;
    const binding = await this.dataSource
      .getRepository(B1InvoicePaymentTermBinding)
      .findOne({ where: { invoiceReference, invoiceVersion } });
    if (!binding) return null;
    const term = await this.dataSource.getRepository(B1PaymentTerm).findOne({
      where: {
        paymentTermReference: binding.paymentTermReference,
        paymentTermVersion: binding.paymentTermVersion,
      },
    });
    if (
      !term ||
      term.definitionHash !== binding.paymentTermDefinitionHash ||
      binding.invoiceRecord.invoiceHash !== binding.invoiceHash ||
      binding.invoiceRecord.issuedAt !== binding.issuedAt.toISOString()
    )
      throw new ConflictException('Canonical B1 payment-term evidence drifted');
    const amendments = await this.dataSource.getRepository(B1DueDateAmendment).find({
      where: { originalBindingReference: binding.bindingReference },
      order: { sequence: 'ASC' },
    });
    let reference = binding.bindingReference,
      hash = binding.bindingHash,
      dueAt = binding.dueAt.toISOString();
    for (const amendment of amendments)
      if (amendment.effectiveAt.getTime() <= at.getTime()) {
        reference = amendment.amendmentReference;
        hash = amendment.amendmentHash;
        dueAt = amendment.replacementDueAt.toISOString();
      }
    return {
      contractName: 'B1-PAYMENT-TERM',
      contractVersion: 1,
      readOnly: true,
      invoice: binding.invoiceRecord,
      term: this.termView(term, at),
      binding: this.bindingView(binding),
      amendments: amendments.map((item) => this.amendmentView(item)),
      effectiveEvidenceReference: reference,
      effectiveEvidenceHash: hash,
      effectiveDueAt: dueAt,
      supersessionStatus: reference === binding.bindingReference ? 'ORIGINAL' : 'AMENDED',
      verifiedAt: at.toISOString(),
    };
  }

  private async transition(
    command: B1PaymentTermLifecycleCommandV1,
    operation: 'ACTIVATE' | 'REVOKE',
    from: 'DRAFT' | 'PENDING_APPROVAL' | 'ACTIVE',
    to: 'PENDING_APPROVAL' | 'ACTIVE' | 'REVOKED',
    controlled: boolean,
  ): Promise<B1PaymentTermResultV1> {
    const reason = this.text(command.reason, 'reason', 500);
    const requestHash = b1Hash({
      operation,
      stage: to,
      paymentTermReference: command.paymentTermReference,
      paymentTermVersion: command.paymentTermVersion,
      expectedRecordVersion: command.expectedRecordVersion,
      reason,
      actorIdentity: command.principal.principalId,
    });
    return runSerializableWithRetry(
      this.dataSource,
      'B1PaymentTermService.transition',
      async (manager) => {
        const reservation = await this.idempotency.reserve(manager, {
          scope: DEFINITION_SCOPE,
          key: command.idempotencyKey,
          requestHash,
          retentionSeconds: RETENTION_SECONDS,
        });
        if (reservation.kind === 'REPLAY') return this.replayTerm(reservation.record.responseBody);
        const term = await this.lockTerm(
          manager,
          command.paymentTermReference,
          command.paymentTermVersion,
        );
        if (!term || term.status !== from || term.recordVersion !== command.expectedRecordVersion)
          return this.rejectTerm(
            manager,
            reservation.record.id,
            {
              code: 'INVALID_STATE_OR_VERSION',
              message: 'payment-term state/version is stale or invalid',
            },
            term ?? undefined,
          );
        if (
          to === 'ACTIVE' &&
          term.effectiveTo &&
          term.effectiveTo.getTime() <= (command.now ?? new Date()).getTime()
        )
          return this.rejectTerm(
            manager,
            reservation.record.id,
            { code: 'TERM_EXPIRED', message: 'expired term cannot be activated' },
            term,
          );
        let approvalId: string | null = null,
          approvedBy: string | null = null;
        if (controlled) {
          if (!command.approvalId)
            return this.rejectTerm(
              manager,
              reservation.record.id,
              { code: 'APPROVAL_REQUIRED', message: 'A2 approval is required' },
              term,
            );
          if (to === 'ACTIVE' && (await this.hasExactTupleOverlap(manager, term)))
            return this.rejectTerm(
              manager,
              reservation.record.id,
              {
                code: 'ACTIVE_EFFECTIVE_OVERLAP',
                message: 'another ACTIVE term overlaps this exact applicability tuple',
              },
              term,
            );
          const action =
            operation === 'ACTIVATE' ? 'B1_PAYMENT_TERM_ACTIVATE' : 'B1_PAYMENT_TERM_REVOKE';
          const approval = await this.approvals.consumeInTransaction(manager, {
            principal: command.principal,
            approvalId: command.approvalId,
            actionType: action,
            resource: {
              type: 'B1_PAYMENT_TERM',
              id: this.termResourceId(term.paymentTermReference, term.paymentTermVersion),
            },
            actionFingerprint: this.computeLifecycleFingerprint(
              this.termView(term, command.now ?? new Date()),
              command,
              action,
            ),
            now: command.now,
          });
          if (!approval.approved || !approval.approval)
            return this.rejectTerm(
              manager,
              reservation.record.id,
              {
                code: 'APPROVAL_REJECTED',
                message: `A2 approval rejected: ${approval.reason ?? 'unknown'}`,
              },
              term,
            );
          approvalId = command.approvalId;
          approvedBy = approval.approval.approvedBy ?? command.principal.principalId;
        }
        term.status = to;
        term.lastReason = reason;
        term.approvalId = approvalId ?? term.approvalId;
        term.approvedBy = approvedBy ?? term.approvedBy;
        const saved = await manager.getRepository(B1PaymentTerm).save(term);
        await this.record(
          manager,
          'B1_PAYMENT_TERM',
          saved.id,
          `B1_PAYMENT_TERM_${to}`,
          command.principal.principalId,
          { status: to, reason, approvalId },
          command,
        );
        await this.metrics.increment(manager, `b1.payment-term.${to.toLowerCase()}`);
        const result: B1PaymentTermResultV1 = {
          outcome: 'UPDATED',
          term: this.termView(saved, command.now ?? new Date()),
          replayed: false,
          failure: null,
        };
        await this.idempotency.complete(manager, reservation.record.id, {
          statusCode: 200,
          responseBody: result as unknown as Record<string, unknown>,
          resourceType: 'B1_PAYMENT_TERM',
          resourceId: saved.id,
        });
        return result;
      },
    );
  }

  private normalizeCreate(command: B1PaymentTermCreateCommandV1) {
    const paymentTermReference = this.reference(
      command.paymentTermReference,
      'paymentTermReference',
    );
    if (!Number.isSafeInteger(command.paymentTermVersion) || command.paymentTermVersion < 1)
      throw new BadRequestException('paymentTermVersion must be a positive integer');
    if (command.termBasis !== 'ELAPSED_DAYS')
      throw new BadRequestException('termBasis must be ELAPSED_DAYS');
    if (
      !Number.isSafeInteger(command.termValue) ||
      command.termValue < 0 ||
      command.termValue > 3660
    )
      throw new BadRequestException('termValue must be an integer from 0 through 3660');
    if (command.currency !== 'NGN' || command.accountingUnit !== 'CUSTOMER_FUNDS')
      throw new BadRequestException('payment-term currency/accounting unit is incompatible');
    const effectiveFrom = b1CanonicalInstant(command.effectiveFrom, 'effectiveFrom');
    const effectiveTo = command.effectiveTo
      ? b1CanonicalInstant(command.effectiveTo, 'effectiveTo')
      : null;
    if (effectiveTo && effectiveTo <= effectiveFrom)
      throw new BadRequestException('effectiveTo must be after effectiveFrom');
    const applicability = this.normalizeApplicability(command.applicability);
    this.key(command.idempotencyKey, 'idempotencyKey', 255);
    return {
      paymentTermReference,
      paymentTermVersion: command.paymentTermVersion,
      termBasis: command.termBasis,
      termValue: command.termValue,
      effectiveFrom,
      effectiveTo,
      currency: command.currency,
      accountingUnit: command.accountingUnit,
      applicability,
    };
  }

  private normalizeApplicability(
    value: B1PaymentTermApplicabilityV1,
  ): B1PaymentTermApplicabilityV1 {
    if (!value || typeof value !== 'object')
      throw new BadRequestException('applicability is required');
    const versioned = (item: B1PaymentTermApplicabilityV1['capability'], field: string) =>
      item === null
        ? null
        : {
            key: this.key(item.key, `${field}.key`, 180),
            version: this.positive(item.version, `${field}.version`),
          };
    const identifier = (item: string | null, field: string) =>
      item === null ? null : this.key(item, field, 160);
    return {
      capability: versioned(value.capability, 'capability'),
      plan: versioned(value.plan, 'plan'),
      subscription: versioned(value.subscription, 'subscription'),
      product: versioned(value.product, 'product'),
      customer: identifier(value.customer, 'customer'),
      merchant: identifier(value.merchant, 'merchant'),
      partner: identifier(value.partner, 'partner'),
    };
  }

  private async findApplicableTerms(
    manager: EntityManager,
    invoice: B1InvoiceV1,
    issuedAt: string,
  ): Promise<B1PaymentTerm[]> {
    const at = new Date(issuedAt);
    const candidates = await manager
      .getRepository(B1PaymentTerm)
      .createQueryBuilder('term')
      .where(
        "term.status = 'ACTIVE' AND term.effective_from <= :at AND (term.effective_to IS NULL OR term.effective_to > :at)",
        { at },
      )
      .setLock('pessimistic_read')
      .getMany();
    return candidates.filter(
      (term) =>
        term.currency === invoice.currency &&
        term.accountingUnit === invoice.accountingUnit &&
        this.matches(term.applicability, invoice),
    );
  }
  private matches(a: B1PaymentTermApplicabilityV1, i: B1InvoiceV1): boolean {
    const versioned = (
      d: B1PaymentTermApplicabilityV1['capability'],
      key: string,
      version: number,
    ) => d === null || (d.key === key && d.version === version);
    return (
      versioned(a.capability, i.capabilityKey, i.capabilityVersion) &&
      versioned(a.plan, i.planKey, i.planVersion) &&
      versioned(a.subscription, i.subscriptionKey, i.subscriptionVersion) &&
      versioned(a.product, i.productKey, i.productVersion) &&
      (a.customer === null || a.customer === i.customerId) &&
      (a.merchant === null || a.merchant === i.merchantId) &&
      (a.partner === null || a.partner === i.partnerId)
    );
  }

  private async hasExactTupleOverlap(
    manager: EntityManager,
    term: B1PaymentTerm,
  ): Promise<boolean> {
    const active = await manager
      .getRepository(B1PaymentTerm)
      .createQueryBuilder('term')
      .where("term.status = 'ACTIVE' AND term.id <> :id", { id: term.id })
      .setLock('pessimistic_write')
      .getMany();
    return active.some(
      (other) =>
        b1CanonicalJson(other.applicability) === b1CanonicalJson(term.applicability) &&
        other.effectiveFrom < (term.effectiveTo ?? new Date(8640000000000000)) &&
        term.effectiveFrom < (other.effectiveTo ?? new Date(8640000000000000)),
    );
  }

  private async persistOrReadCanonicalInvoice(
    manager: EntityManager,
    generated: B1InvoiceV1,
  ): Promise<B1InvoiceV1> {
    const repository = manager.getRepository(B1BillingDocument);
    const existing = await repository.findOne({
      where: { documentReference: generated.invoiceNumber, documentVersion: 1 },
      lock: { mode: 'pessimistic_write' },
    });
    if (existing) {
      if (existing.documentKind !== 'INVOICE' || existing.documentHash !== generated.invoiceHash)
        throw new ConflictException('Canonical invoice reference conflicts with existing evidence');
      return existing.record as B1InvoiceV1;
    }
    const row = repository.create({
      id: generated.invoiceId,
      documentReference: generated.invoiceNumber,
      documentVersion: 1,
      documentKind: 'INVOICE',
      documentHash: generated.invoiceHash,
      documentReplayHash: generated.invoiceReplayHash,
      idempotencyScope: generated.idempotencyScope,
      idempotencyKey: generated.idempotencyKey,
      scopeKey: generated.scopeKey,
      scopeVersion: 1,
      billingRecordReference: null,
      invoiceReference: generated.invoiceNumber,
      customerId: generated.customerId,
      merchantId: generated.merchantId,
      partnerId: generated.partnerId,
      productKey: generated.productKey,
      productVersion: 1,
      periodKey: generated.periodKey,
      periodVersion: 1,
      classificationLevel: 'CONFIDENTIAL',
      retentionDays: 365,
      effectiveFrom: new Date(generated.issuedAt),
      effectiveTo: null,
      correlationId: generated.correlationId,
      record: generated,
      createdAt: new Date(generated.issuedAt),
      updatedAt: new Date(generated.issuedAt),
    });
    await repository.save(row);
    return generated;
  }

  private bindingRequestHash(command: B1InvoicePaymentTermBindingCommandV1): string {
    const r = command.invoiceRequest;
    return b1Hash({
      operation: 'BIND',
      paymentTermReference: command.paymentTermReference,
      paymentTermVersion: command.paymentTermVersion,
      invoiceRequest: {
        contractName: r.contractName,
        contractVersion: r.contractVersion,
        scopeKey: r.scopeKey,
        scopeVersion: r.scopeVersion,
        expectedCurrency: r.expectedCurrency,
        expectedAccountingUnit: r.expectedAccountingUnit,
        customerId: r.customerId,
        merchantId: r.merchantId,
        partnerId: r.partnerId,
        productKey: r.productKey,
        productVersion: r.productVersion,
        capabilityKey: r.capabilityKey,
        capabilityVersion: r.capabilityVersion,
        planKey: r.planKey,
        planVersion: r.planVersion,
        subscriptionKey: r.subscriptionKey,
        subscriptionVersion: r.subscriptionVersion,
        packageKey: r.packageKey,
        packageVersion: r.packageVersion,
        bundleKey: r.bundleKey,
        bundleVersion: r.bundleVersion,
        productEntitlementKey: r.productEntitlementKey,
        productEntitlementVersion: r.productEntitlementVersion,
        customerTierKey: r.customerTierKey,
        customerTierVersion: r.customerTierVersion,
        merchantTierKey: r.merchantTierKey,
        merchantTierVersion: r.merchantTierVersion,
        partnerTierKey: r.partnerTierKey,
        partnerTierVersion: r.partnerTierVersion,
        billingRecordReferences: [...r.billingRecordReferences],
        commercialDecisionReferences: [...r.commercialDecisionReferences],
        commercialDecisionIdempotencyKeys: [...r.commercialDecisionIdempotencyKeys],
      },
    });
  }

  private async amendmentSemantic(command: B1DueDateAmendmentCommandV1) {
    this.reference(command.bindingReference, 'bindingReference');
    this.reference(command.supersedesEvidenceReference, 'supersedesEvidenceReference');
    if (!SHA256.test(command.expectedEvidenceHash))
      throw new BadRequestException('expectedEvidenceHash must be lowercase SHA-256');
    if (
      !Number.isSafeInteger(command.replacementElapsedDays) ||
      command.replacementElapsedDays < 0 ||
      command.replacementElapsedDays > 3660
    )
      throw new BadRequestException(
        'replacementElapsedDays must be an integer from 0 through 3660',
      );
    const reason = this.text(command.reason, 'reason', 500),
      effectiveAt = b1CanonicalInstant(command.effectiveAt, 'effectiveAt');
    const binding = await this.dataSource
      .getRepository(B1InvoicePaymentTermBinding)
      .findOne({ where: { bindingReference: command.bindingReference } });
    if (!binding) throw new NotFoundException('binding not found');
    const latest = await this.latestAmendment(
      this.dataSource.manager,
      binding.bindingReference,
      false,
    );
    const sequence = (latest?.sequence ?? 0) + 1;
    const replacementDueAt = b1CalculateDueAt(
      binding.issuedAt.toISOString(),
      command.replacementElapsedDays,
    );
    const amendmentHash = b1Hash({
      originalBindingReference: binding.bindingReference,
      originalBindingHash: binding.bindingHash,
      originalDueAt: binding.dueAt.toISOString(),
      replacementDueAt,
      reason,
      effectiveAt,
      supersedesEvidenceReference: command.supersedesEvidenceReference,
    });
    const requestHash = b1Hash({
      operation: 'AMEND',
      bindingReference: binding.bindingReference,
      expectedEvidenceHash: command.expectedEvidenceHash,
      replacementElapsedDays: command.replacementElapsedDays,
      reason,
      effectiveAt,
      supersedesEvidenceReference: command.supersedesEvidenceReference,
    });
    return {
      originalBindingHash: binding.bindingHash,
      replacementDueAt,
      amendmentHash,
      requestHash,
      amendmentReference: `b1-due-amend-${amendmentHash.slice(0, 32)}`,
      reason,
      effectiveAt,
      sequence,
    };
  }

  private async lockTerm(manager: EntityManager, reference: string, version: number) {
    return manager
      .getRepository(B1PaymentTerm)
      .createQueryBuilder('term')
      .where('term.payment_term_reference=:reference AND term.payment_term_version=:version', {
        reference,
        version,
      })
      .setLock('pessimistic_write')
      .getOne();
  }
  private async lockBinding(manager: EntityManager, reference: string) {
    return manager
      .getRepository(B1InvoicePaymentTermBinding)
      .createQueryBuilder('binding')
      .where('binding.binding_reference=:reference', { reference })
      .setLock('pessimistic_write')
      .getOne();
  }
  private async latestAmendment(manager: EntityManager, bindingReference: string, lock: boolean) {
    const q = manager
      .getRepository(B1DueDateAmendment)
      .createQueryBuilder('amendment')
      .where('amendment.original_binding_reference=:bindingReference', { bindingReference })
      .orderBy('amendment.sequence', 'DESC')
      .take(1);
    if (lock) q.setLock('pessimistic_write');
    return q.getOne();
  }
  private termResourceId(reference: string, version: number) {
    return `${reference}/v${version}`;
  }
  private reference(v: string, f: string) {
    const n = v?.trim();
    if (!n || !SAFE_REFERENCE.test(n)) throw new BadRequestException(`${f} is invalid`);
    return n;
  }
  private key(v: string, f: string, max: number) {
    const n = v?.trim();
    if (!n || n.length > max || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/.test(n))
      throw new BadRequestException(`${f} is invalid`);
    return n;
  }
  private text(v: string, f: string, max: number) {
    const n = v?.trim();
    if (!n || n.length > max) throw new BadRequestException(`${f} is invalid`);
    return n;
  }
  private positive(v: number, f: string) {
    if (!Number.isSafeInteger(v) || v < 1)
      throw new BadRequestException(`${f} must be a positive integer`);
    return v;
  }

  private termView(t: B1PaymentTerm, at = new Date()): B1PaymentTermViewV1 {
    const expired =
      t.status === 'ACTIVE' && t.effectiveTo !== null && t.effectiveTo.getTime() <= at.getTime();
    return {
      id: t.id,
      paymentTermReference: t.paymentTermReference,
      paymentTermVersion: t.paymentTermVersion,
      termBasis: t.termBasis,
      termValue: t.termValue,
      definitionHash: t.definitionHash,
      effectiveFrom: t.effectiveFrom.toISOString(),
      effectiveTo: t.effectiveTo?.toISOString() ?? null,
      currency: t.currency,
      accountingUnit: t.accountingUnit,
      commercialScopeKey: t.commercialScopeKey,
      commercialScopeVersion: 1,
      applicability: t.applicability,
      status: expired ? 'EXPIRED' : t.status,
      persistedStatus: t.status,
      idempotencyScope: DEFINITION_SCOPE,
      createdBy: t.createdBy,
      approvedBy: t.approvedBy,
      approvalId: t.approvalId,
      correlationId: t.correlationId,
      causationId: t.causationId,
      recordVersion: t.recordVersion,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }
  private bindingView(b: B1InvoicePaymentTermBinding): B1InvoicePaymentTermBindingViewV1 {
    return {
      id: b.id,
      bindingReference: b.bindingReference,
      bindingHash: b.bindingHash,
      requestHash: b.requestHash,
      invoiceReference: b.invoiceReference,
      invoiceVersion: 1,
      invoiceHash: b.invoiceHash,
      issuedAt: b.issuedAt.toISOString(),
      paymentTermReference: b.paymentTermReference,
      paymentTermVersion: b.paymentTermVersion,
      paymentTermDefinitionHash: b.paymentTermDefinitionHash,
      termBasis: b.termBasis,
      termValue: b.termValue,
      dueAt: b.dueAt.toISOString(),
      dueDateCalculationHash: b.dueDateCalculationHash,
      currency: b.currency,
      accountingUnit: b.accountingUnit,
      effectiveAt: b.effectiveAt.toISOString(),
      applicability: b.applicability,
      invoice: b.invoiceRecord,
      idempotencyScope: BINDING_SCOPE,
      idempotencyKey: b.idempotencyKey,
      createdBy: b.createdBy,
      correlationId: b.correlationId,
      causationId: b.causationId,
      createdAt: b.createdAt.toISOString(),
    };
  }
  private amendmentView(a: B1DueDateAmendment): B1DueDateAmendmentViewV1 {
    return {
      id: a.id,
      amendmentReference: a.amendmentReference,
      amendmentHash: a.amendmentHash,
      requestHash: a.requestHash,
      originalBindingReference: a.originalBindingReference,
      originalBindingHash: a.originalBindingHash,
      originalIssuedAt: a.originalIssuedAt.toISOString(),
      originalDueAt: a.originalDueAt.toISOString(),
      replacementElapsedDays: a.replacementElapsedDays,
      replacementDueAt: a.replacementDueAt.toISOString(),
      reason: a.reason,
      effectiveAt: a.effectiveAt.toISOString(),
      supersedesEvidenceReference: a.supersedesEvidenceReference,
      supersedesEvidenceHash: a.supersedesEvidenceHash,
      sequence: a.sequence,
      approvalId: a.approvalId,
      approvedBy: a.approvedBy,
      idempotencyScope: AMENDMENT_SCOPE,
      idempotencyKey: a.idempotencyKey,
      createdBy: a.createdBy,
      correlationId: a.correlationId,
      causationId: a.causationId,
      createdAt: a.createdAt.toISOString(),
    };
  }

  private replayTerm(body: unknown): B1PaymentTermResultV1 {
    const result = body as B1PaymentTermResultV1;
    return { ...result, outcome: result.failure ? 'REJECTED' : 'REPLAYED', replayed: true };
  }
  private replayBinding(body: unknown): B1InvoicePaymentTermBindingResultV1 {
    const result = body as B1InvoicePaymentTermBindingResultV1;
    return { ...result, outcome: result.failure ? 'REJECTED' : 'REPLAYED', replayed: true };
  }
  private replayAmendment(body: unknown): B1DueDateAmendmentResultV1 {
    const result = body as B1DueDateAmendmentResultV1;
    return { ...result, outcome: result.failure ? 'REJECTED' : 'REPLAYED', replayed: true };
  }
  private async completeRecoveredBinding(
    manager: EntityManager,
    recordId: string,
    b: B1InvoicePaymentTermBinding,
  ) {
    const result: B1InvoicePaymentTermBindingResultV1 = {
      outcome: 'REPLAYED',
      binding: this.bindingView(b),
      replayed: true,
      failure: null,
    };
    await this.idempotency.complete(manager, recordId, {
      statusCode: 200,
      responseBody: result as unknown as Record<string, unknown>,
      resourceType: 'B1_INVOICE_PAYMENT_TERM_BINDING',
      resourceId: b.id,
    });
    return result;
  }
  private async rejectTerm(
    manager: EntityManager,
    id: string,
    failure: Failure,
    term?: B1PaymentTerm,
  ) {
    const result: B1PaymentTermResultV1 = {
      outcome: 'REJECTED',
      term: term ? this.termView(term) : null,
      replayed: false,
      failure,
    };
    await this.idempotency.complete(manager, id, {
      statusCode: 422,
      responseBody: result as unknown as Record<string, unknown>,
      resourceType: 'B1_PAYMENT_TERM',
      resourceId: term?.id,
    });
    return result;
  }
  private async rejectBinding(manager: EntityManager, id: string, failure: Failure) {
    const result: B1InvoicePaymentTermBindingResultV1 = {
      outcome: 'REJECTED',
      binding: null,
      replayed: false,
      failure,
    };
    await this.idempotency.complete(manager, id, {
      statusCode: 422,
      responseBody: result as unknown as Record<string, unknown>,
    });
    return result;
  }
  private async rejectAmendment(manager: EntityManager, id: string, failure: Failure) {
    const result: B1DueDateAmendmentResultV1 = {
      outcome: 'REJECTED',
      amendment: null,
      replayed: false,
      failure,
    };
    await this.idempotency.complete(manager, id, {
      statusCode: 422,
      responseBody: result as unknown as Record<string, unknown>,
    });
    return result;
  }

  private async record(
    manager: EntityManager,
    entityType: string,
    entityId: string,
    action: string,
    actor: string,
    values: Record<string, unknown>,
    command: { requestContext: { requestId: string; correlationId: string } },
  ) {
    await this.audit.record(manager, {
      entityType,
      entityId,
      action,
      actor,
      requestId: command.requestContext.requestId,
      correlationId: command.requestContext.correlationId,
      newValues: values,
    });
  }
  private async emit(
    manager: EntityManager,
    eventType: string,
    aggregateType: string,
    aggregateId: string,
    eventKey: string,
    payload: unknown,
    command: { requestContext: { correlationId: string }; causationId?: string | null },
  ) {
    await this.outbox.enqueueOnce(manager, {
      eventType,
      aggregateType,
      aggregateId,
      eventKey: `${eventType}:${eventKey}`,
      schemaVersion: 1,
      classification: 'INTERNAL_OPERATIONS',
      retentionClass: 'OPERATIONS_DEFAULT',
      correlationId: command.requestContext.correlationId,
      ...(command.causationId ? { causationId: command.causationId } : {}),
      payload: payload as Record<string, unknown>,
    });
  }
}
