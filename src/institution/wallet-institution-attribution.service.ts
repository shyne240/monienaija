import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { PrivilegedActionApproval } from '../authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalStatus } from '../authorization/privileged-action-approval.enums';
import { PrivilegedActionApprovalService } from '../authorization/privileged-action-approval.service';
import { ProtectedAuthorityService } from '../authorization/protected-authority.service';
import {
  governedAction,
  governedChangeFingerprint,
} from '../authorization/governed-action.registry';
import { governedChangeConsumptionError } from '../authorization/commercial-rule-governance.service';
import { canonical, sha256 } from '../authorization/workforce-crypto';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AuditService } from '../operations/audit.service';
import {
  AGENT_INSTITUTION_RESOLVER,
  type AgentInstitutionResolver,
} from './agent-institution-resolver';
import {
  CustomerInstitutionEnrolmentStatus,
  FinancialInstitutionStatus,
  INSTITUTION_ATTRIBUTION_EVIDENCE_TYPES,
  InstitutionAttributionEvidenceType,
  InstitutionFinancialEligibility,
  WALLET_ATTRIBUTION_RESOURCE,
  WALLET_INSTITUTION_ATTRIBUTION_ACTION,
} from './institution.enums';
import type {
  ExecuteWalletAttributionCommand,
  RequestWalletAttributionCommand,
  WalletInstitutionAttributionView,
} from './institution.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION = WALLET_INSTITUTION_ATTRIBUTION_ACTION;
const RESOURCE = WALLET_ATTRIBUTION_RESOURCE;

interface WalletRow {
  id: string;
  customer_id: string;
  owner_class: string;
  currency: string;
  status: string;
  ledger_account_id: string;
  institution_id: string | null;
  institution_attribution_id: string | null;
}

interface ReceiptRow {
  id: string;
  approval_id: string;
  wallet_id: string;
  ledger_account_id: string;
  institution_id: string;
  previous_institution_id: string | null;
  owner_class: string;
  owner_reference: string;
  evidence_type: string;
  evidence_reference: string;
  evidence_digest: string;
  reason: string;
  executed_by: string;
  executed_at: Date;
}

interface NormalizedAttribution {
  walletId: string;
  institutionId: string;
  evidenceType: InstitutionAttributionEvidenceType;
  evidenceReference: string;
  reason: string;
}

/** Deterministic binding of an attribution request to the wallet state it acts on. */
export function walletAttributionFingerprint(
  input: NormalizedAttribution & {
    ledgerAccountId: string;
    ownerClass: string;
    ownerReference: string;
    currentInstitutionId: string | null;
  },
): string {
  return governedChangeFingerprint(ACTION, RESOURCE, input.walletId, {
    institutionId: input.institutionId,
    evidenceType: input.evidenceType,
    evidenceReference: input.evidenceReference,
    reason: input.reason,
    ledgerAccountId: input.ledgerAccountId,
    ownerClass: input.ownerClass,
    ownerReference: input.ownerReference,
    currentInstitutionId: input.currentInstitutionId,
  });
}

/**
 * Governed institutional attribution of a wallet and its ledger account.
 *
 * Ownership classification (`owner_class`) is untouched: a wallet keeps being a CUSTOMER, AGENT,
 * SYSTEM or REVIEW wallet and *additionally* acquires exactly one institutional owner. An agent's
 * institutional affiliation never re-assigns wallets by itself — attribution always requires its own
 * independently approved `WALLET_INSTITUTION_ATTRIBUTION` request bound to the exact wallet, ledger
 * account and institution, with evidence.
 *
 * Fail-closed rules (nothing is ever moved):
 *  - only CUSTOMER / AGENT wallets can be attributed; SYSTEM custody and REVIEW wallets cannot;
 *  - the institution must be operationally APPROVED;
 *  - a CUSTOMER wallet requires an ACTIVE, ELIGIBLE enrolment at that institution, and an AGENT
 *    wallet requires the agent's authoritative affiliation to resolve to that institution;
 *  - a ledger account with any posted financial history cannot be attributed (that would fabricate
 *    historical institutional attribution) — the documented remediation is a governed cut-over in a
 *    later phase;
 *  - attribution is immutable once set.
 */
@Injectable()
export class WalletInstitutionAttributionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly approvals: PrivilegedActionApprovalService,
    private readonly auditService: AuditService,
    @Inject(AGENT_INSTITUTION_RESOLVER)
    private readonly affiliations: AgentInstitutionResolver,
    @Optional() private readonly protectedAuthority?: ProtectedAuthorityService,
  ) {}

  /**
   * Execution consumes a protected institutional approval and writes governed evidence. It runs on
   * the credential-separated authority connection so a forged runtime row cannot reach it and the
   * approval consumption, domain mutation, evidence and rollback stay atomic.
   */
  private get authoritySource(): DataSource {
    return this.protectedAuthority?.dataSource ?? this.dataSource;
  }

  async requestAttribution(
    command: RequestWalletAttributionCommand,
  ): Promise<{ approvalId: string; status: string; actionFingerprint: string; expiresAt: string }> {
    const normalized = this.normalize(command);
    const manager = this.dataSource.manager;
    const wallet = await this.loadWallet(manager, normalized.walletId);
    await this.assertAttributable(manager, wallet, normalized.institutionId);

    const definition = governedAction(ACTION)!;
    const fingerprint = walletAttributionFingerprint({
      ...normalized,
      ledgerAccountId: wallet.ledger_account_id,
      ownerClass: wallet.owner_class,
      ownerReference: wallet.customer_id,
      currentInstitutionId: wallet.institution_id,
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
      resource: { type: RESOURCE, id: normalized.walletId },
      actionFingerprint: fingerprint,
      reason: normalized.reason,
      approvalScope: definition.approvalScope,
      requestDetails: {
        walletId: normalized.walletId,
        ledgerAccountId: wallet.ledger_account_id,
        institutionId: normalized.institutionId,
        ownerClass: wallet.owner_class,
        ownerReference: wallet.customer_id,
        currentInstitutionId: wallet.institution_id,
        evidenceType: normalized.evidenceType,
        evidenceReference: normalized.evidenceReference,
      },
      expiresInSeconds: command.expiresInSeconds,
      now: command.now,
    });
    if (!decision.approval) {
      throw new ForbiddenException(
        `Wallet institution attribution request denied: ${decision.reason ?? 'UNAUTHORIZED'}`,
      );
    }
    return {
      approvalId: decision.approval.id,
      status: decision.approval.status,
      actionFingerprint: decision.approval.actionFingerprint,
      expiresAt: decision.approval.expiresAt.toISOString(),
    };
  }

  async executeAttribution(
    command: ExecuteWalletAttributionCommand,
  ): Promise<WalletInstitutionAttributionView> {
    this.assertExecuteEntitled(command.principal);
    const normalized = this.normalize(command);
    const approvalId = this.uuid(command.approvalId, 'approvalId');
    const evidenceDigest = sha256(
      canonical({
        walletId: normalized.walletId,
        institutionId: normalized.institutionId,
        evidenceType: normalized.evidenceType,
        evidenceReference: normalized.evidenceReference,
        reason: normalized.reason,
      }),
    );

    return this.authoritySource.transaction(async (manager) => {
      const approval = await manager.getRepository(PrivilegedActionApproval).findOne({
        where: { id: approvalId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!approval) throw new NotFoundException('Approval not found');
      if (approval.actionType !== ACTION || approval.resourceType !== RESOURCE) {
        throw new ForbiddenException('Approval does not govern a wallet institution attribution');
      }
      if ((approval.resourceId ?? '').toLowerCase() !== normalized.walletId) {
        throw new ForbiddenException('Approval does not govern this wallet');
      }
      if (approval.customerId !== null) {
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
        const replay = await this.findReceiptByApproval(manager, approvalId);
        if (!replay) throw new ConflictException('Approval has already been consumed');
        return this.toView(replay);
      }

      const wallet = await this.loadWallet(manager, normalized.walletId, true);
      await this.lockLedgerAccount(manager, wallet.ledger_account_id);
      await this.assertAttributable(manager, wallet, normalized.institutionId);

      const fingerprint = walletAttributionFingerprint({
        ...normalized,
        ledgerAccountId: wallet.ledger_account_id,
        ownerClass: wallet.owner_class,
        ownerReference: wallet.customer_id,
        currentInstitutionId: wallet.institution_id,
      });
      if (approval.actionFingerprint !== fingerprint) {
        throw governedChangeConsumptionError('FINGERPRINT_MISMATCH');
      }

      const consumed = await this.approvals.consumeInTransaction(manager, {
        principal: command.principal,
        approvalId,
        actionType: ACTION,
        resource: { type: RESOURCE, id: normalized.walletId },
        actionFingerprint: fingerprint,
        now: command.now,
      });
      if (!consumed.approved) {
        throw governedChangeConsumptionError(consumed.reason, consumed.approval?.status);
      }

      const actor = command.principal.principalId;
      const receiptId = await this.insertReceipt(manager, {
        approvalId,
        wallet,
        institutionId: normalized.institutionId,
        evidenceType: normalized.evidenceType,
        evidenceReference: normalized.evidenceReference,
        evidenceDigest,
        reason: normalized.reason,
        actor,
      });

      // Ledger account first (it owns the posting isolation), then the wallet reference.
      await manager.query(
        `WITH changed AS (
           UPDATE ledger_accounts
              SET institutional_scope = 'INSTITUTION',
                  institution_id = $2,
                  institutional_purpose = 'CUSTOMER_FUNDS',
                  updated_at = clock_timestamp()
            WHERE id = $1 AND institutional_scope = 'UNATTRIBUTED'
            RETURNING id
         ) SELECT id FROM changed`,
        [wallet.ledger_account_id, normalized.institutionId],
      );
      const updated: Array<{ id: string }> = await manager.query(
        `WITH changed AS (
           UPDATE wallet_accounts
              SET institution_id = $2, institution_attribution_id = $3, updated_at = clock_timestamp()
            WHERE id = $1 AND institution_id IS NULL
            RETURNING id
         ) SELECT id FROM changed`,
        [normalized.walletId, normalized.institutionId, receiptId],
      );
      if (updated.length !== 1) {
        throw new ConflictException('Wallet attribution changed while the request was pending');
      }

      if (command._simulateFailureAfterAttribution) {
        // TEST-ONLY: proves that consumption, receipt, ledger attribution and wallet attribution
        // roll back together. Never reachable from an HTTP route.
        throw new ConflictException('Simulated institutional attribution failure');
      }

      await this.auditService.record(manager, {
        entityType: 'WALLET_ACCOUNT',
        entityId: normalized.walletId,
        action: 'WALLET_INSTITUTION_ATTRIBUTED',
        actor,
        previousValues: {
          institutionId: wallet.institution_id,
          ownerClass: wallet.owner_class,
          ownerReference: wallet.customer_id,
          ledgerAccountId: wallet.ledger_account_id,
        },
        newValues: {
          institutionId: normalized.institutionId,
          attributionId: receiptId,
          ownerClass: wallet.owner_class,
          ownerReference: wallet.customer_id,
          evidenceType: normalized.evidenceType,
          evidenceReference: normalized.evidenceReference,
          evidenceDigest,
          approvalId,
          reason: normalized.reason,
        },
      });

      const receipt = await this.findReceiptByApproval(manager, approvalId);
      if (!receipt) throw new ConflictException('Attribution record is missing');
      return this.toView(receipt);
    });
  }

  async getForWallet(walletId: string): Promise<{
    walletId: string;
    institutionId: string | null;
    attributionId: string | null;
    ownerClass: string;
  }> {
    const wallet = await this.loadWallet(this.dataSource.manager, this.uuid(walletId, 'walletId'));
    return {
      walletId: wallet.id,
      institutionId: wallet.institution_id,
      attributionId: wallet.institution_attribution_id,
      ownerClass: wallet.owner_class,
    };
  }

  async listForInstitution(institutionId: string): Promise<WalletInstitutionAttributionView[]> {
    const rows: ReceiptRow[] = await this.dataSource.query(
      `SELECT * FROM governed_wallet_institution_attributions
        WHERE institution_id = $1 ORDER BY executed_at ASC`,
      [this.uuid(institutionId, 'institutionId')],
    );
    return rows.map((row) => this.toView(row));
  }

  // ------------------------------------------------------------------ internals

  private async assertAttributable(
    manager: EntityManager,
    wallet: WalletRow,
    institutionId: string,
  ): Promise<void> {
    if (wallet.institution_id !== null) {
      throw new ConflictException(
        'Wallet already carries an institutional attribution; re-attribution requires a governed migration',
      );
    }
    if (!['CUSTOMER', 'AGENT'].includes(wallet.owner_class)) {
      throw new ConflictException(
        `A ${wallet.owner_class} wallet cannot carry an institutional attribution`,
      );
    }
    if (wallet.status !== 'ACTIVE') {
      throw new ConflictException('Only an ACTIVE wallet can be institutionally attributed');
    }

    const institutions: Array<{ status: FinancialInstitutionStatus }> = await manager.query(
      `SELECT status FROM financial_institutions WHERE id = $1 AND deleted_at IS NULL`,
      [institutionId],
    );
    if (institutions.length === 0) throw new NotFoundException('Institution not found');
    if (institutions[0]!.status !== FinancialInstitutionStatus.APPROVED) {
      throw new ConflictException(
        `Institution is ${institutions[0]!.status} and cannot own financial accounts`,
      );
    }

    const lines: Array<{ count: string }> = await manager.query(
      `SELECT count(*)::text AS count FROM ledger_lines WHERE ledger_account_id = $1`,
      [wallet.ledger_account_id],
    );
    if (Number(lines[0]?.count ?? '0') > 0) {
      throw new ConflictException(
        'Wallet ledger account already has posted financial history; institutional attribution would fabricate historical attribution. ' +
          'A governed cut-over (close the wallet, open an institution-attributed wallet and migrate value through an explicit audited journal) is required.',
      );
    }

    const accounts: Array<{ institutional_scope: string; institution_id: string | null }> =
      await manager.query(
        `SELECT institutional_scope, institution_id FROM ledger_accounts WHERE id = $1`,
        [wallet.ledger_account_id],
      );
    if (accounts.length === 0) throw new NotFoundException('Wallet ledger account not found');
    if (accounts[0]!.institutional_scope !== 'UNATTRIBUTED') {
      throw new ConflictException('Wallet ledger account already carries an institutional scope');
    }

    if (wallet.owner_class === 'CUSTOMER') {
      const enrolments: Array<{
        status: CustomerInstitutionEnrolmentStatus;
        financial_eligibility: InstitutionFinancialEligibility;
      }> = await manager.query(
        `SELECT status, financial_eligibility FROM customer_institution_enrolments
          WHERE customer_id = $1 AND institution_id = $2`,
        [wallet.customer_id.toLowerCase(), institutionId],
      );
      const enrolment = enrolments[0];
      if (!enrolment) {
        throw new ConflictException(
          'Customer is not enrolled at this institution; a customer wallet cannot be attributed without an enrolment',
        );
      }
      if (enrolment.status !== CustomerInstitutionEnrolmentStatus.ACTIVE) {
        throw new ConflictException(
          `Customer enrolment is ${enrolment.status}; only an ACTIVE enrolment can back a wallet attribution`,
        );
      }
      if (enrolment.financial_eligibility !== InstitutionFinancialEligibility.ELIGIBLE) {
        throw new ConflictException('Customer is not financially eligible at this institution');
      }
    } else {
      const resolution = await this.affiliations.resolve(manager, wallet.customer_id);
      if (resolution.outcome !== 'RESOLVED' || resolution.institutionId !== institutionId) {
        throw new ConflictException(
          `Agent is not authoritatively affiliated with this institution (${resolution.outcome}${
            resolution.outcome === 'RESOLVED' ? '' : `/${resolution.reason}`
          })`,
        );
      }
    }
  }

  private async insertReceipt(
    manager: EntityManager,
    input: {
      approvalId: string;
      wallet: WalletRow;
      institutionId: string;
      evidenceType: InstitutionAttributionEvidenceType;
      evidenceReference: string;
      evidenceDigest: string;
      reason: string;
      actor: string;
    },
  ): Promise<string> {
    const rows: Array<{ id: string }> = await manager.query(
      `INSERT INTO governed_wallet_institution_attributions
         (approval_id, wallet_id, ledger_account_id, institution_id, previous_institution_id,
          owner_class, owner_reference, evidence_type, evidence_reference, evidence_digest,
          reason, executed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        input.approvalId,
        input.wallet.id,
        input.wallet.ledger_account_id,
        input.institutionId,
        input.wallet.institution_id,
        input.wallet.owner_class,
        input.wallet.customer_id,
        input.evidenceType,
        input.evidenceReference,
        input.evidenceDigest,
        input.reason,
        input.actor,
      ],
    );
    return rows[0]!.id;
  }

  private async loadWallet(
    manager: EntityManager,
    walletId: string,
    lock = false,
  ): Promise<WalletRow> {
    const rows: WalletRow[] = await manager.query(
      `SELECT * FROM wallet_accounts WHERE id = $1 LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [walletId],
    );
    if (rows.length === 0) throw new NotFoundException('Wallet not found');
    return rows[0]!;
  }

  private async lockLedgerAccount(manager: EntityManager, ledgerAccountId: string): Promise<void> {
    const rows: Array<{ id: string }> = await manager.query(
      `SELECT id FROM ledger_accounts WHERE id = $1 FOR UPDATE`,
      [ledgerAccountId],
    );
    if (rows.length === 0) throw new NotFoundException('Wallet ledger account not found');
  }

  private async findReceiptByApproval(
    manager: EntityManager,
    approvalId: string,
  ): Promise<ReceiptRow | null> {
    const rows: ReceiptRow[] = await manager.query(
      `SELECT * FROM governed_wallet_institution_attributions WHERE approval_id = $1 LIMIT 1`,
      [approvalId],
    );
    return rows[0] ?? null;
  }

  private toView(row: ReceiptRow): WalletInstitutionAttributionView {
    return {
      attributionId: row.id,
      approvalId: row.approval_id,
      walletId: row.wallet_id,
      ledgerAccountId: row.ledger_account_id,
      institutionId: row.institution_id,
      ownerClass: row.owner_class,
      ownerReference: row.owner_reference,
      evidenceType: row.evidence_type as InstitutionAttributionEvidenceType,
      evidenceReference: row.evidence_reference,
      executedBy: row.executed_by,
      executedAt: row.executed_at.toISOString(),
    };
  }

  private assertExecuteEntitled(principal: AuthorizationPrincipal): void {
    if (
      !['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type) ||
      principal.assuranceLevel !== 'MFA' ||
      principal.readOnlyPrincipal === true
    ) {
      throw new ForbiddenException(
        'Wallet institution attribution execution requires an MFA workforce principal',
      );
    }
  }

  private normalize(
    command: RequestWalletAttributionCommand | ExecuteWalletAttributionCommand,
  ): NormalizedAttribution {
    const walletId = this.uuid(command.walletId, 'walletId');
    const institutionId = this.uuid(command.institutionId, 'institutionId');
    if (!INSTITUTION_ATTRIBUTION_EVIDENCE_TYPES.includes(command.evidenceType)) {
      throw new BadRequestException('evidenceType is not registered for institutional attribution');
    }
    const evidenceReference = this.requiredText(
      command.evidenceReference,
      'evidenceReference',
      160,
    );
    const reason = this.requiredText(command.reason, 'reason', 500);
    if (reason.length < 10) {
      throw new BadRequestException('reason must be at least 10 characters');
    }
    return {
      walletId,
      institutionId,
      evidenceType: command.evidenceType,
      evidenceReference,
      reason,
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
