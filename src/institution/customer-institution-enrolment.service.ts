import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { PrivilegedActionApproval } from '../authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalStatus } from '../authorization/privileged-action-approval.enums';
import { PrivilegedActionApprovalService } from '../authorization/privileged-action-approval.service';
import {
  governedAction,
  governedChangeFingerprint,
} from '../authorization/governed-action.registry';
import { governedChangeConsumptionError } from '../authorization/commercial-rule-governance.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { CustomerKycLevel, CustomerKycStatus } from '../customer/customer.enums';
import { AuditService } from '../operations/audit.service';
import {
  CUSTOMER_INSTITUTION_ENROLMENT_CHANGE_ACTION,
  CustomerInstitutionEnrolmentStatus,
  ENROLMENT_RESOURCE,
  ENROLMENT_TRANSITIONS,
  FinancialInstitutionStatus,
  InstitutionFinancialEligibility,
} from './institution.enums';
import type {
  CustomerInstitutionEnrolmentView,
  ExecuteEnrolmentCommand,
  RequestEnrolmentCommand,
} from './institution.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION = CUSTOMER_INSTITUTION_ENROLMENT_CHANGE_ACTION;
const RESOURCE = ENROLMENT_RESOURCE;

interface EnrolmentRow {
  id: string;
  reference: string;
  customer_id: string;
  institution_id: string;
  status: CustomerInstitutionEnrolmentStatus;
  status_reason: string | null;
  financial_eligibility: InstitutionFinancialEligibility;
  kyc_reuse_authorized: boolean;
  consent_reference: string | null;
  policy_reference: string | null;
  approval_id: string;
  effective_from: Date;
  effective_to: Date | null;
  version: number;
}

interface NormalizedEnrolmentChange {
  customerId: string;
  institutionId: string;
  reference: string;
  targetStatus: CustomerInstitutionEnrolmentStatus;
  financialEligibility: InstitutionFinancialEligibility;
  statusReason: string;
  kycReuse: {
    evidenceReference: string;
    consentReference: string;
    policyReference: string;
  } | null;
}

/** Deterministic binding of an enrolment request to the exact state the checker will act on. */
export function customerEnrolmentFingerprint(
  input: NormalizedEnrolmentChange & {
    currentStatus: CustomerInstitutionEnrolmentStatus | null;
    currentEligibility: InstitutionFinancialEligibility | null;
  },
): string {
  return governedChangeFingerprint(ACTION, RESOURCE, input.customerId, {
    institutionId: input.institutionId,
    reference: input.reference,
    targetStatus: input.targetStatus,
    financialEligibility: input.financialEligibility,
    statusReason: input.statusReason,
    kycReuseEvidence: input.kycReuse?.evidenceReference ?? null,
    consentReference: input.kycReuse?.consentReference ?? null,
    policyReference: input.kycReuse?.policyReference ?? null,
    currentStatus: input.currentStatus,
    currentEligibility: input.currentEligibility,
  });
}

/**
 * Customer institution enrolment — the authoritative per-institution financial relationship.
 *
 * One customer identity (`customers.id`) is preserved: enrolments add institution-scoped
 * relationships, never duplicate identities. A globally KYC-verified customer is **not**
 * automatically financially eligible at any institution: that requires an ACTIVE enrolment whose
 * `financialEligibility` is `ELIGIBLE`. Reusing existing KYC evidence requires the full
 * authorization triad (evidence + consent + applicable policy) and is validated both here and by a
 * database CHECK constraint.
 *
 * Every write is governed (`CUSTOMER_INSTITUTION_ENROLMENT_CHANGE`, resource `CUSTOMER`) through the
 * existing maker-checker stack: AGENT_NETWORK_MANAGER prepares, an independent FINANCE_CONTROLLER
 * checks and executes. Rows are never deleted; closed enrolments are terminal.
 */
@Injectable()
export class CustomerInstitutionEnrolmentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly approvals: PrivilegedActionApprovalService,
    private readonly auditService: AuditService,
  ) {}

  async requestChange(
    command: RequestEnrolmentCommand,
  ): Promise<{ approvalId: string; status: string; actionFingerprint: string; expiresAt: string }> {
    const normalized = this.normalize(command);
    const manager = this.dataSource.manager;
    const current = await this.findEnrolment(
      manager,
      normalized.customerId,
      normalized.institutionId,
    );
    await this.assertChangeIsValid(manager, normalized, current);
    await this.assertKycReuseIsAuthorized(manager, normalized);

    const definition = governedAction(ACTION)!;
    const fingerprint = customerEnrolmentFingerprint({
      ...normalized,
      currentStatus: current?.status ?? null,
      currentEligibility: current?.financial_eligibility ?? null,
    });
    const decision = await this.approvals.request({
      principal: command.principal,
      policy: {
        resourceType: definition.resourceType,
        action: definition.action,
        allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
        requiredRoles: definition.initiatingRoles,
        requiredFunctions: definition.initiatingFunctionCodes,
        minimumAssurance: definition.minimumAssurance,
        customerAccess: 'NONE',
      },
      resource: { type: RESOURCE, id: normalized.customerId },
      actionFingerprint: fingerprint,
      reason: normalized.statusReason,
      approvalScope: definition.approvalScope,
      requestDetails: {
        customerId: normalized.customerId,
        institutionId: normalized.institutionId,
        reference: normalized.reference,
        targetStatus: normalized.targetStatus,
        financialEligibility: normalized.financialEligibility,
        currentStatus: current?.status ?? null,
        currentEnrolmentId: current?.id ?? null,
        kycReuseAuthorized: normalized.kycReuse !== null,
      },
      expiresInSeconds: command.expiresInSeconds,
      now: command.now,
    });
    if (!decision.approval) {
      throw new ForbiddenException(
        `Customer institution enrolment request denied: ${decision.reason ?? 'UNAUTHORIZED'}`,
      );
    }
    return {
      approvalId: decision.approval.id,
      status: decision.approval.status,
      actionFingerprint: decision.approval.actionFingerprint,
      expiresAt: decision.approval.expiresAt.toISOString(),
    };
  }

  async executeChange(command: ExecuteEnrolmentCommand): Promise<CustomerInstitutionEnrolmentView> {
    this.assertExecuteEntitled(command.principal);
    const normalized = this.normalize(command);
    const approvalId = this.uuid(command.approvalId, 'approvalId');

    return this.dataSource.transaction(async (manager) => {
      const approval = await manager.getRepository(PrivilegedActionApproval).findOne({
        where: { id: approvalId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!approval) throw new NotFoundException('Approval not found');
      if (approval.actionType !== ACTION || approval.resourceType !== RESOURCE) {
        throw new ForbiddenException('Approval does not govern a customer institution enrolment');
      }
      if ((approval.resourceId ?? '').toLowerCase() !== normalized.customerId) {
        throw new ForbiddenException('Approval does not govern this customer');
      }
      if (approval.customerId !== null && approval.customerId !== normalized.customerId) {
        throw governedChangeConsumptionError('FINGERPRINT_MISMATCH');
      }
      if (
        approval.requesterPrincipalId === command.principal.principalId ||
        (approval.approvedBy !== command.principal.principalId &&
          !command.principal.scopes.includes('privileged:execute'))
      ) {
        throw governedChangeConsumptionError('APPROVAL_SCOPE_MISSING');
      }

      if (approval.status === PrivilegedActionApprovalStatus.CONSUMED) {
        const replay = await this.findByApproval(manager, approvalId);
        if (!replay) throw new ConflictException('Approval has already been consumed');
        return this.toView(replay);
      }

      // Serialises enrolment changes for this customer identity.
      const customers: Array<{ id: string }> = await manager.query(
        `SELECT id FROM customers WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [normalized.customerId],
      );
      if (customers.length === 0) throw new NotFoundException('Customer not found');

      const current = await this.findEnrolment(
        manager,
        normalized.customerId,
        normalized.institutionId,
        true,
      );
      await this.assertChangeIsValid(manager, normalized, current);
      await this.assertKycReuseIsAuthorized(manager, normalized);

      const fingerprint = customerEnrolmentFingerprint({
        ...normalized,
        currentStatus: current?.status ?? null,
        currentEligibility: current?.financial_eligibility ?? null,
      });
      if (approval.actionFingerprint !== fingerprint) {
        throw governedChangeConsumptionError('FINGERPRINT_MISMATCH');
      }

      const consumed = await this.approvals.consumeInTransaction(manager, {
        principal: command.principal,
        approvalId,
        actionType: ACTION,
        resource: { type: RESOURCE, id: normalized.customerId },
        actionFingerprint: fingerprint,
        now: command.now,
      });
      if (!consumed.approved) {
        throw governedChangeConsumptionError(consumed.reason, consumed.approval?.status);
      }

      const actor = command.principal.principalId;
      const row = current
        ? await this.transition(manager, current, normalized, approvalId, actor)
        : await this.insert(manager, normalized, approvalId, actor);

      await this.auditService.record(manager, {
        entityType: 'CUSTOMER_INSTITUTION_ENROLMENT',
        entityId: row.id,
        action: current
          ? 'CUSTOMER_INSTITUTION_ENROLMENT_CHANGED'
          : 'CUSTOMER_INSTITUTION_ENROLLED',
        actor,
        previousValues: current
          ? {
              status: current.status,
              financialEligibility: current.financial_eligibility,
              institutionId: current.institution_id,
            }
          : { status: null, financialEligibility: null, institutionId: null },
        newValues: {
          customerId: normalized.customerId,
          institutionId: normalized.institutionId,
          status: row.status,
          financialEligibility: row.financial_eligibility,
          kycReuseAuthorized: row.kyc_reuse_authorized,
          consentReference: row.consent_reference,
          policyReference: row.policy_reference,
          approvalId,
          statusReason: normalized.statusReason,
        },
      });
      return this.toView(row);
    });
  }

  async getForInstitution(institutionId: string): Promise<CustomerInstitutionEnrolmentView[]> {
    const rows: EnrolmentRow[] = await this.dataSource.query(
      `SELECT * FROM customer_institution_enrolments
        WHERE institution_id = $1 ORDER BY created_at ASC`,
      [this.uuid(institutionId, 'institutionId')],
    );
    return rows.map((row) => this.toView(row));
  }

  async listForCustomer(customerId: string): Promise<CustomerInstitutionEnrolmentView[]> {
    const rows: EnrolmentRow[] = await this.dataSource.query(
      `SELECT * FROM customer_institution_enrolments
        WHERE customer_id = $1 ORDER BY created_at ASC`,
      [this.uuid(customerId, 'customerId')],
    );
    return rows.map((row) => this.toView(row));
  }

  // ------------------------------------------------------------------ internals

  private async insert(
    manager: EntityManager,
    change: NormalizedEnrolmentChange,
    approvalId: string,
    actor: string,
  ): Promise<EnrolmentRow> {
    const rows: EnrolmentRow[] = await manager.query(
      `INSERT INTO customer_institution_enrolments
         (reference, customer_id, institution_id, status, status_reason, financial_eligibility,
          kyc_reuse_authorized, kyc_reuse_evidence_reference, consent_reference, policy_reference,
          approval_id, effective_from, effective_to, created_by, updated_by)
       VALUES ($1::varchar,$2::uuid,$3::uuid,$4::varchar,$5::varchar,$6::varchar,
               $7::boolean,$8::varchar,$9::varchar,$10::varchar,$11::uuid,clock_timestamp(),
               CASE WHEN $4::varchar = 'CLOSED' THEN clock_timestamp() ELSE NULL END,
               $12::varchar,$12::varchar)
       RETURNING *`,
      [
        change.reference,
        change.customerId,
        change.institutionId,
        change.targetStatus,
        change.statusReason,
        change.financialEligibility,
        change.kycReuse !== null,
        change.kycReuse?.evidenceReference ?? null,
        change.kycReuse?.consentReference ?? null,
        change.kycReuse?.policyReference ?? null,
        approvalId,
        actor,
      ],
    );
    return rows[0]!;
  }

  private async transition(
    manager: EntityManager,
    current: EnrolmentRow,
    change: NormalizedEnrolmentChange,
    approvalId: string,
    actor: string,
  ): Promise<EnrolmentRow> {
    const rows: EnrolmentRow[] = await manager.query(
      `WITH changed AS (
         UPDATE customer_institution_enrolments
            SET status = $2::varchar,
                status_reason = $3::varchar,
                financial_eligibility = $4::varchar,
                approval_id = $5::uuid,
                effective_to = CASE WHEN $2::varchar = 'CLOSED' THEN clock_timestamp() ELSE NULL END,
                updated_by = $6::varchar
          WHERE id = $1::uuid AND status <> 'CLOSED'
          RETURNING *
       ) SELECT * FROM changed`,
      [
        current.id,
        change.targetStatus,
        change.statusReason,
        change.financialEligibility,
        approvalId,
        actor,
      ],
    );
    if (rows.length !== 1) {
      throw new ConflictException('Enrolment changed while the request was pending');
    }
    return rows[0]!;
  }

  private async assertChangeIsValid(
    manager: EntityManager,
    change: NormalizedEnrolmentChange,
    current: EnrolmentRow | null,
  ): Promise<void> {
    const institution = await this.loadInstitution(manager, change.institutionId);
    if (institution.status === FinancialInstitutionStatus.CLOSED) {
      throw new ConflictException('A closed institution cannot hold customer enrolments');
    }
    if (change.targetStatus === CustomerInstitutionEnrolmentStatus.ACTIVE) {
      if (institution.status !== FinancialInstitutionStatus.APPROVED) {
        throw new ConflictException(
          `Institution is ${institution.status} and cannot activate customer enrolments`,
        );
      }
    }
    if (change.financialEligibility === InstitutionFinancialEligibility.ELIGIBLE) {
      if (change.targetStatus !== CustomerInstitutionEnrolmentStatus.ACTIVE) {
        throw new BadRequestException(
          'Financial eligibility can only be ELIGIBLE for an ACTIVE enrolment',
        );
      }
    }

    if (!current) {
      if (
        change.targetStatus !== CustomerInstitutionEnrolmentStatus.PENDING &&
        change.targetStatus !== CustomerInstitutionEnrolmentStatus.ACTIVE
      ) {
        throw new ConflictException('A new enrolment must start PENDING or ACTIVE');
      }
      return;
    }

    if (!ENROLMENT_TRANSITIONS[current.status].includes(change.targetStatus)) {
      throw new ConflictException(
        `Enrolment transition ${current.status} -> ${change.targetStatus} is not allowed`,
      );
    }
  }

  /**
   * KYC reuse is never implicit. Claiming it requires the recorded triad, and the customer must
   * actually hold reusable evidence; otherwise the enrolment stays PENDING_KYC.
   */
  private async assertKycReuseIsAuthorized(
    manager: EntityManager,
    change: NormalizedEnrolmentChange,
  ): Promise<void> {
    if (!change.kycReuse) return;
    const customers: Array<{
      kyc_status: CustomerKycStatus;
      kyc_level: CustomerKycLevel;
    }> = await manager.query(`SELECT kyc_status, kyc_level FROM customers WHERE id = $1`, [
      change.customerId,
    ]);
    const customer = customers[0];
    if (!customer) throw new NotFoundException('Customer not found');
    // Reuse requires APPROVED KYC at a real level; a NOT_STARTED/PENDING/REJECTED or LEVEL_0
    // (NONE) customer has nothing reusable, so the claim is refused rather than assumed.
    const hasEvidence =
      customer.kyc_status === CustomerKycStatus.APPROVED &&
      customer.kyc_level !== CustomerKycLevel.NONE;
    if (!hasEvidence) {
      throw new ConflictException(
        'No reusable KYC evidence exists for this customer; the enrolment must remain PENDING_KYC',
      );
    }
  }

  private async loadInstitution(
    manager: EntityManager,
    institutionId: string,
  ): Promise<{ id: string; status: FinancialInstitutionStatus }> {
    const rows: Array<{ id: string; status: FinancialInstitutionStatus }> = await manager.query(
      `SELECT id, status FROM financial_institutions WHERE id = $1`,
      [institutionId],
    );
    if (rows.length === 0) throw new NotFoundException('Institution not found');
    return rows[0]!;
  }

  private async findEnrolment(
    manager: EntityManager,
    customerId: string,
    institutionId: string,
    lock = false,
  ): Promise<EnrolmentRow | null> {
    const rows: EnrolmentRow[] = await manager.query(
      `SELECT * FROM customer_institution_enrolments
        WHERE customer_id = $1 AND institution_id = $2
        LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [customerId, institutionId],
    );
    return rows[0] ?? null;
  }

  private async findByApproval(
    manager: EntityManager,
    approvalId: string,
  ): Promise<EnrolmentRow | null> {
    const rows: EnrolmentRow[] = await manager.query(
      `SELECT * FROM customer_institution_enrolments WHERE approval_id = $1 LIMIT 1`,
      [approvalId],
    );
    return rows[0] ?? null;
  }

  private toView(row: EnrolmentRow): CustomerInstitutionEnrolmentView {
    return {
      id: row.id,
      reference: row.reference,
      customerId: row.customer_id,
      institutionId: row.institution_id,
      status: row.status,
      statusReason: row.status_reason,
      financialEligibility: row.financial_eligibility,
      kycReuseAuthorized: row.kyc_reuse_authorized,
      consentReference: row.consent_reference,
      policyReference: row.policy_reference,
      approvalId: row.approval_id,
      effectiveFrom: row.effective_from.toISOString(),
      effectiveTo: row.effective_to?.toISOString() ?? null,
      version: row.version,
    };
  }

  private assertExecuteEntitled(principal: AuthorizationPrincipal): void {
    if (
      !['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type) ||
      principal.assuranceLevel !== 'MFA' ||
      principal.readOnlyPrincipal === true
    ) {
      throw new ForbiddenException(
        'Customer institution enrolment execution requires an MFA workforce principal',
      );
    }
  }

  private normalize(
    command: RequestEnrolmentCommand | ExecuteEnrolmentCommand,
  ): NormalizedEnrolmentChange {
    const customerId = this.uuid(command.customerId, 'customerId');
    const institutionId = this.uuid(command.institutionId, 'institutionId');
    const reference = this.requiredText(command.reference, 'reference', 80);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(reference)) {
      throw new BadRequestException('reference must be alphanumeric with . _ - separators');
    }
    if (!Object.values(CustomerInstitutionEnrolmentStatus).includes(command.targetStatus)) {
      throw new BadRequestException('targetStatus is not a registered enrolment status');
    }
    // The caller states the target state explicitly. Omitted eligibility means PENDING_KYC: a
    // transition never silently upgrades eligibility, and the database refuses ELIGIBLE unless the
    // target status is ACTIVE, so a suspension must restate its (restricted) eligibility.
    const eligibility = command.financialEligibility ?? InstitutionFinancialEligibility.PENDING_KYC;
    if (!Object.values(InstitutionFinancialEligibility).includes(eligibility)) {
      throw new BadRequestException('financialEligibility is not registered');
    }
    const statusReason = this.requiredText(command.statusReason, 'statusReason', 500);
    if (statusReason.length < 10) {
      throw new BadRequestException('statusReason must be at least 10 characters');
    }

    let kycReuse: NormalizedEnrolmentChange['kycReuse'] = null;
    if (command.kycReuse) {
      kycReuse = {
        evidenceReference: this.requiredText(
          command.kycReuse.evidenceReference,
          'kycReuse.evidenceReference',
          160,
        ),
        consentReference: this.requiredText(
          command.kycReuse.consentReference,
          'kycReuse.consentReference',
          160,
        ),
        policyReference: this.requiredText(
          command.kycReuse.policyReference,
          'kycReuse.policyReference',
          160,
        ),
      };
    }

    return {
      customerId,
      institutionId,
      reference,
      targetStatus: command.targetStatus,
      financialEligibility: eligibility,
      statusReason,
      kycReuse,
    };
  }

  private uuid(value: string, field: string): string {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || !UUID_PATTERN.test(normalized)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
    return normalized;
  }

  private requiredText(value: string | undefined | null, field: string, max: number): string {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed || trimmed.length > max) {
      throw new BadRequestException(`${field} is required and must be at most ${max} characters`);
    }
    return trimmed;
  }
}
