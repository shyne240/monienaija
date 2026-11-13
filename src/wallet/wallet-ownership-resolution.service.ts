import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';

import { PrivilegedActionApproval } from '../authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalStatus } from '../authorization/privileged-action-approval.enums';
import { PrivilegedActionApprovalService } from '../authorization/privileged-action-approval.service';
import { ProtectedAuthorityService } from '../authorization/protected-authority.service';
import {
  governedAction,
  governedChangeFingerprint,
  WALLET_OWNERSHIP_RESOLUTION_ACTION,
} from '../authorization/governed-action.registry';
import { governedChangeConsumptionError } from '../authorization/commercial-rule-governance.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { canonical, sha256 } from '../authorization/workforce-crypto';
import { AuditService } from '../operations/audit.service';
import {
  WalletOwnershipEvidenceType,
  WalletOwnershipResolutionClass,
  WALLET_OWNERSHIP_EVIDENCE_MATRIX,
} from './wallet-ownership-resolution.enums';
import type {
  ExecuteWalletOwnershipResolutionCommand,
  RequestWalletOwnershipResolutionCommand,
  WalletOwnershipEvidenceSummary,
  WalletOwnershipResolutionRequestView,
  WalletOwnershipResolutionView,
} from './wallet-ownership-resolution.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION = WALLET_OWNERSHIP_RESOLUTION_ACTION.action;
const RESOURCE_TYPE = WALLET_OWNERSHIP_RESOLUTION_ACTION.resourceType;
const SYSTEM_REFERENCE_PREFIX = 'SYSTEM:';
const MAX_REFERENCE_LENGTH = 160;
const MAX_REASON_LENGTH = 500;

interface WalletRow {
  id: string;
  customer_id: string;
  currency: string;
  status: string;
  owner_class: string;
  ledger_account_id: string;
}

interface NormalizedTarget {
  resolutionClass: WalletOwnershipResolutionClass;
  resolvedOwnerReference: string;
  targetOwnerId: string | null;
  systemOwnerCode: string | null;
}

interface NormalizedRequest {
  walletId: string;
  target: NormalizedTarget;
  evidenceType: WalletOwnershipEvidenceType;
  evidenceReference: string;
  reason: string;
}

interface EvidenceVerification {
  summary: WalletOwnershipEvidenceSummary;
  digest: string;
}

/**
 * Governed resolution of historical `REVIEW` wallet ownership.
 *
 * The classification from migration `1785753600116` is intentionally fail-closed: a wallet whose
 * historical owner reference is not an unambiguous canonical customer/agent UUID is `REVIEW`, and
 * `WalletFinancialBoundaryService` blocks every financial lane for it. Migration `1785753600118`
 * froze ownership so no code path could "fix" a wallet by quietly rewriting its owner. This service
 * is the single governed correction path, reusing the established governance stack rather than
 * inventing a parallel one:
 *
 *  - the registered governed action `WALLET_OWNERSHIP_RESOLUTION` on resource `WALLET_ACCOUNT`
 *    (`governed-action.registry.ts`), with the same FINANCE_PREPARER/FINANCE_CONTROLLER
 *    maker-checker shape, MFA requirement and self-approval prohibition as the other financial
 *    governed actions;
 *  - `PrivilegedActionApprovalService` for request/approve/consume and its audit trail;
 *  - a server-computed deterministic fingerprint (`governedChangeFingerprint`) over the ACTUAL
 *    resolution payload, so an approval issued for one (wallet, class, target, evidence, reason)
 *    tuple can never execute a different one;
 *  - `AuditService` for the immutable administrative trail.
 *
 * Evidence is never taken on trust. `requestResolution` verifies it so a maker cannot file an
 * unsupportable request, and `executeResolution` verifies it AGAIN inside the consuming
 * transaction, because the authoritative rows can change between approval and execution. A wallet
 * only leaves `REVIEW` when the approval is consumed, the evidence still holds, no ownership
 * collision exists, and the immutable resolution record exists in the same transaction — so a
 * failure at any step leaves the approval approved-but-unconsumed and the wallet `REVIEW`.
 *
 * Wallet identity, ledger account, balances and journal history are never modified: only the owner
 * reference/class columns change, and the previous reference is preserved in the resolution record
 * and the audit trail.
 */
@Injectable()
export class WalletOwnershipResolutionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly approvals: PrivilegedActionApprovalService,
    private readonly auditService: AuditService,
    @Optional() private readonly protectedAuthority?: ProtectedAuthorityService,
  ) {}

  /**
   * Wallet ownership resolution consumes a protected approval. The entire execution (decision
   * evidence, consumption, resolution record, wallet owner update) runs on the authority
   * credential so a forged runtime row can never reach it.
   */
  private get authoritySource(): DataSource {
    return this.protectedAuthority?.dataSource ?? this.dataSource;
  }

  /**
   * Maker side. Creates the pending maker-checker request. No wallet mutation occurs here; the
   * wallet stays `REVIEW` and financially restricted until an independent checker executes.
   */
  async requestResolution(
    command: RequestWalletOwnershipResolutionCommand,
  ): Promise<WalletOwnershipResolutionRequestView> {
    const normalized = this.normalize(command);
    const wallet = await this.loadWallet(this.dataSource.manager, normalized.walletId);
    this.assertResolvable(wallet);
    await this.verifyEvidence(this.dataSource.manager, wallet, normalized);
    await this.assertNoCollision(
      this.dataSource.manager,
      normalized.target.resolvedOwnerReference,
      wallet,
    );

    const definition = governedAction(ACTION)!;
    const fingerprint = walletOwnershipResolutionFingerprint(
      normalized.walletId,
      normalized.target.resolutionClass,
      normalized.target.resolvedOwnerReference,
      normalized.target.systemOwnerCode,
      normalized.evidenceType,
      normalized.evidenceReference,
      normalized.reason,
    );
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
      resource: { type: definition.resourceType, id: normalized.walletId },
      actionFingerprint: fingerprint,
      reason: normalized.reason,
      approvalScope: definition.approvalScope,
      requestDetails: {
        walletId: normalized.walletId,
        currency: wallet.currency,
        currentOwnerReference: wallet.customer_id,
        resolutionClass: normalized.target.resolutionClass,
        resolvedOwnerReference: normalized.target.resolvedOwnerReference,
        systemOwnerCode: normalized.target.systemOwnerCode,
        evidenceType: normalized.evidenceType,
        evidenceReference: normalized.evidenceReference,
      },
      expiresInSeconds: command.expiresInSeconds,
      now: command.now,
    });
    if (!decision.approval) {
      throw new ForbiddenException(
        `Wallet ownership resolution request denied: ${decision.reason ?? 'UNAUTHORIZED'}`,
      );
    }
    return {
      approvalId: decision.approval.id,
      status: decision.approval.status,
      actionType: decision.approval.actionType,
      resourceType: decision.approval.resourceType,
      resourceId: decision.approval.resourceId,
      actionFingerprint: decision.approval.actionFingerprint,
      requestedAt: decision.approval.requestedAt,
      expiresAt: decision.approval.expiresAt,
    };
  }

  /**
   * Checker side. Consumes the approved request and applies the ownership resolution atomically.
   *
   * Order inside the single transaction is deliberate: approval row lock -> payload/fingerprint
   * validation -> wallet row lock -> re-verification of evidence and collision -> approval
   * consumption -> immutable resolution record -> wallet owner update. The database guard accepts
   * the owner update only because the resolution record (bound to that consumed approval) already
   * exists, so the evidence and the approval can never drift apart.
   */
  async executeResolution(
    command: ExecuteWalletOwnershipResolutionCommand,
  ): Promise<WalletOwnershipResolutionView> {
    this.assertExecuteEntitled(command.principal);
    const normalized = this.normalize(command);
    const approvalId = this.normalizeApprovalId(command.approvalId);
    const fingerprint = walletOwnershipResolutionFingerprint(
      normalized.walletId,
      normalized.target.resolutionClass,
      normalized.target.resolvedOwnerReference,
      normalized.target.systemOwnerCode,
      normalized.evidenceType,
      normalized.evidenceReference,
      normalized.reason,
    );

    return this.authoritySource
      .transaction(async (manager) => {
        // Serialises consumption/replay of this approval.
        const approval = await manager.getRepository(PrivilegedActionApproval).findOne({
          where: { id: approvalId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!approval) throw new NotFoundException('Approval not found');
        if (approval.actionType !== ACTION || approval.resourceType !== RESOURCE_TYPE) {
          throw new ForbiddenException('Approval does not govern a wallet ownership resolution');
        }
        if ((approval.resourceId ?? '').toLowerCase() !== normalized.walletId) {
          throw new ForbiddenException('Approval does not govern this wallet');
        }
        if (approval.customerId !== null || approval.actionFingerprint !== fingerprint) {
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
          // Idempotent replay of the committed resolution; anything else is a duplicate execution.
          const replay = await this.findResolution(manager, approvalId, normalized.walletId);
          if (!replay) throw new ConflictException('Approval has already been consumed');
          const wallet = await this.loadWallet(manager, normalized.walletId);
          return this.toView(replay, wallet);
        }

        const wallet = await this.loadWallet(manager, normalized.walletId, true);
        this.assertResolvable(wallet);
        // The approved request is bound to the reference the checker saw; a wallet whose reference
        // moved in the meantime must go through a fresh request, never an older approval.
        const recordedReference = (
          approval.policy as { requestDetails?: { currentOwnerReference?: unknown } } | undefined
        )?.requestDetails?.currentOwnerReference;
        if (recordedReference !== wallet.customer_id) {
          throw new ConflictException('Wallet ownership changed while the request was pending');
        }
        const verified = await this.verifyEvidence(manager, wallet, normalized);
        await this.assertNoCollision(manager, normalized.target.resolvedOwnerReference, wallet);

        const consumed = await this.approvals.consumeInTransaction(manager, {
          principal: command.principal,
          approvalId,
          actionType: ACTION,
          resource: { type: RESOURCE_TYPE, id: normalized.walletId },
          actionFingerprint: fingerprint,
          now: command.now,
        });
        if (!consumed.approved) {
          throw governedChangeConsumptionError(consumed.reason, consumed.approval?.status);
        }

        await manager.query(
          `INSERT INTO governed_wallet_ownership_resolutions
           (approval_id, wallet_id, resolution_class, previous_owner_ref, resolved_owner_ref,
            system_owner_code, evidence_type, evidence_reference, evidence_digest,
            evidence_summary, reason, executed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`,
          [
            approvalId,
            normalized.walletId,
            normalized.target.resolutionClass,
            wallet.customer_id,
            normalized.target.resolvedOwnerReference,
            normalized.target.systemOwnerCode,
            normalized.evidenceType,
            normalized.evidenceReference,
            verified.digest,
            JSON.stringify(verified.summary),
            normalized.reason,
            command.principal.principalId,
          ],
        );

        // CTE form: a plain SELECT result, so the affected row count is unambiguous.
        const updated = await manager.query<Array<{ id: string }>>(
          `WITH changed AS (
             UPDATE wallet_accounts
                SET customer_id = $2, owner_class = $3, updated_at = clock_timestamp()
              WHERE id = $1 AND owner_class = 'REVIEW'
              RETURNING id
           )
           SELECT id FROM changed`,
          [
            normalized.walletId,
            normalized.target.resolvedOwnerReference,
            normalized.target.resolutionClass,
          ],
        );
        if (updated.length !== 1) {
          throw new ConflictException('Wallet ownership is already resolved');
        }

        await this.auditService.record(manager, {
          entityType: 'WALLET_ACCOUNT',
          entityId: normalized.walletId,
          action: 'WALLET_OWNERSHIP_RESOLVED',
          actor: command.principal.principalId,
          previousValues: {
            ownerClass: 'REVIEW',
            ownerReference: wallet.customer_id,
          },
          newValues: {
            ownerClass: normalized.target.resolutionClass,
            ownerReference: normalized.target.resolvedOwnerReference,
            systemOwnerCode: normalized.target.systemOwnerCode,
            evidenceType: normalized.evidenceType,
            evidenceReference: normalized.evidenceReference,
            approvalId,
            ledgerAccountId: wallet.ledger_account_id,
            currency: wallet.currency,
            reason: normalized.reason,
          },
        });

        const record = await this.findResolution(manager, approvalId, normalized.walletId);
        if (!record) throw new ConflictException('Wallet ownership resolution record is missing');
        return this.toView(record, {
          ...wallet,
          customer_id: normalized.target.resolvedOwnerReference,
          owner_class: normalized.target.resolutionClass,
        });
      })
      .catch((error: unknown) => {
        throw walletOwnershipGuardError(error);
      });
  }

  /**
   * Mirrors the executor-entitlement rule the established consume() control enforces (executor is
   * the approver or holds `privileged:execute`) as an explicit early gate, so a maker is rejected
   * before any consumption attempt, and read-only/MFA-less sessions can never execute.
   */
  assertExecuteEntitled(principal: AuthorizationPrincipal): void {
    const entitled =
      principal.roles.includes('FINANCE_CONTROLLER') ||
      principal.scopes.includes('privileged:execute');
    if (
      !entitled ||
      !['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type) ||
      principal.assuranceLevel !== 'MFA' ||
      principal.readOnlyPrincipal
    ) {
      throw new ForbiddenException(
        'Only the approving FINANCE_CONTROLLER or a privileged:execute principal may execute an approved wallet ownership resolution',
      );
    }
  }

  // ------------------------------------------------------------------ normalization

  private normalize(
    command: RequestWalletOwnershipResolutionCommand | ExecuteWalletOwnershipResolutionCommand,
  ): NormalizedRequest {
    const walletId = (command.walletId ?? '').trim().toLowerCase();
    if (!UUID_PATTERN.test(walletId)) {
      throw new BadRequestException('walletId must be a UUID');
    }
    const resolutionClass = command.resolutionClass;
    if (
      ![
        WalletOwnershipResolutionClass.CUSTOMER,
        WalletOwnershipResolutionClass.AGENT,
        WalletOwnershipResolutionClass.SYSTEM,
      ].includes(resolutionClass)
    ) {
      throw new BadRequestException(
        'resolutionClass must be CUSTOMER, AGENT or SYSTEM (REVIEW is never a resolution target)',
      );
    }
    const evidenceType = command.evidenceType;
    const supportedClasses = WALLET_OWNERSHIP_EVIDENCE_MATRIX[evidenceType];
    if (!supportedClasses) {
      throw new BadRequestException(`Unsupported ownership evidence type: ${String(evidenceType)}`);
    }
    if (!supportedClasses.includes(resolutionClass)) {
      throw new BadRequestException(
        `Evidence type ${evidenceType} cannot support a ${resolutionClass} resolution`,
      );
    }
    const evidenceReference = (command.evidenceReference ?? '').trim();
    if (!evidenceReference || evidenceReference.length > MAX_REFERENCE_LENGTH) {
      throw new BadRequestException(
        `evidenceReference must contain 1 to ${MAX_REFERENCE_LENGTH} characters`,
      );
    }
    const reason = (command.reason ?? '').trim();
    if (!reason || reason.length > MAX_REASON_LENGTH) {
      throw new BadRequestException(`reason must contain 1 to ${MAX_REASON_LENGTH} characters`);
    }

    let target: NormalizedTarget;
    if (resolutionClass === WalletOwnershipResolutionClass.SYSTEM) {
      if ((command.targetOwnerId ?? '').trim()) {
        throw new BadRequestException('A SYSTEM resolution cannot name a customer or agent owner');
      }
      const systemOwnerCode = (command.systemOwnerCode ?? '').trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9_]{2,39}$/.test(systemOwnerCode)) {
        throw new BadRequestException('systemOwnerCode must be a registered system owner code');
      }
      target = {
        resolutionClass,
        resolvedOwnerReference: `${SYSTEM_REFERENCE_PREFIX}${systemOwnerCode}`,
        targetOwnerId: null,
        systemOwnerCode,
      };
    } else {
      if ((command.systemOwnerCode ?? '').trim()) {
        throw new BadRequestException('systemOwnerCode is only valid for a SYSTEM resolution');
      }
      const targetOwnerId = (command.targetOwnerId ?? '').trim().toLowerCase();
      if (!UUID_PATTERN.test(targetOwnerId)) {
        throw new BadRequestException(
          `targetOwnerId must be the canonical UUID of the ${resolutionClass.toLowerCase()}`,
        );
      }
      target = {
        resolutionClass,
        resolvedOwnerReference: targetOwnerId,
        targetOwnerId,
        systemOwnerCode: null,
      };
    }

    return { walletId, target, evidenceType, evidenceReference, reason };
  }

  private normalizeApprovalId(approvalId: string): string {
    const normalized = (approvalId ?? '').trim().toLowerCase();
    if (!UUID_PATTERN.test(normalized)) {
      throw new BadRequestException('approvalId must be a UUID');
    }
    return normalized;
  }

  // ------------------------------------------------------------------ wallet state

  private async loadWallet(
    manager: EntityManager,
    walletId: string,
    lock = false,
  ): Promise<WalletRow> {
    const rows = await manager.query<WalletRow[]>(
      `SELECT id, customer_id, currency, status, owner_class, ledger_account_id
         FROM wallet_accounts WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [walletId],
    );
    const wallet = rows[0];
    if (!wallet) throw new NotFoundException(`Wallet ${walletId} was not found`);
    return wallet;
  }

  private assertResolvable(wallet: WalletRow): void {
    if (wallet.owner_class !== 'REVIEW') {
      throw new ConflictException('Wallet ownership is already resolved');
    }
  }

  /**
   * Ownership collision handling. A canonical owner may hold at most one wallet per currency
   * (`uq_wallet_accounts_canonical_uuid_owner_currency`); when the resolution target already owns a
   * wallet in this currency, the resolution is refused and the wallet stays `REVIEW` and
   * financially restricted. Nothing is merged, and no wallet/balance/history is deleted.
   */
  private async assertNoCollision(
    manager: EntityManager,
    resolvedOwnerReference: string,
    wallet: WalletRow,
  ): Promise<void> {
    if (resolvedOwnerReference.startsWith(SYSTEM_REFERENCE_PREFIX)) return;
    const rows = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM wallet_accounts
        WHERE lower(customer_id) = $1 AND currency = $2 AND id <> $3`,
      [resolvedOwnerReference, wallet.currency, wallet.id],
    );
    if (rows.length > 0) {
      throw new ConflictException(
        'Ownership target already owns a wallet in this currency; the collision must be reconciled before this wallet can be resolved',
      );
    }
  }

  // ------------------------------------------------------------------ evidence

  /**
   * Verifies the cited evidence against authoritative rows and returns the server-computed summary
   * and digest. The caller's `evidenceReference` is matched against the authoritative value, never
   * trusted as the fact itself.
   */
  private async verifyEvidence(
    manager: EntityManager,
    wallet: WalletRow,
    normalized: NormalizedRequest,
  ): Promise<EvidenceVerification> {
    const verifiedAt = (
      await manager.query<Array<{ now: Date }>>('SELECT clock_timestamp() AS now')
    )[0]!.now;
    const facts: Record<string, unknown> = {};

    switch (normalized.evidenceType) {
      case WalletOwnershipEvidenceType.CUSTOMER_RECORD_REFERENCE:
      case WalletOwnershipEvidenceType.CUSTOMER_FINANCIAL_ACCOUNT_BINDING: {
        const customer = await this.requireCustomer(
          manager,
          normalized.target.targetOwnerId!,
          normalized.target.resolutionClass,
        );
        facts.customerStatus = customer.status;
        facts.customerSynthetic = customer.is_synthetic;
        if (normalized.evidenceType === WalletOwnershipEvidenceType.CUSTOMER_RECORD_REFERENCE) {
          if (customer.reference.toLowerCase() !== normalized.evidenceReference.toLowerCase()) {
            throw new BadRequestException(
              'Evidence reference does not match the target customer record',
            );
          }
          facts.referenceMatched = true;
        } else {
          const bindings = await manager.query<
            Array<{
              id: string;
              customer_id: string;
              state: string;
              ledger_account_id: string;
              wallet_account_id: string;
            }>
          >(
            `SELECT id, customer_id, state, ledger_account_id, wallet_account_id
               FROM customer_financial_account_bindings
              WHERE wallet_account_id = $1`,
            [wallet.id],
          );
          const binding = bindings[0];
          if (!binding) {
            throw new BadRequestException(
              'No financial account binding evidence exists for this wallet',
            );
          }
          if (binding.id.toLowerCase() !== normalized.evidenceReference.toLowerCase()) {
            throw new BadRequestException(
              'Evidence reference does not match the wallet financial account binding',
            );
          }
          if (binding.ledger_account_id !== wallet.ledger_account_id) {
            throw new ConflictException(
              'Financial account binding evidence does not match the wallet ledger account',
            );
          }
          if (binding.customer_id !== normalized.target.targetOwnerId) {
            throw new ConflictException(
              'Financial account binding evidence names a different customer',
            );
          }
          if (binding.state !== 'ACTIVE') {
            throw new ConflictException('Financial account binding evidence is not active');
          }
          facts.bindingState = binding.state;
          facts.bindingId = binding.id;
        }
        break;
      }
      case WalletOwnershipEvidenceType.AGENT_RECORD_REFERENCE: {
        const agent = await this.requireAgent(manager, normalized.target.targetOwnerId!);
        if (agent.reference.toLowerCase() !== normalized.evidenceReference.toLowerCase()) {
          throw new BadRequestException(
            'Evidence reference does not match the target agent record',
          );
        }
        facts.agentStatus = agent.status;
        facts.referenceMatched = true;
        break;
      }
      case WalletOwnershipEvidenceType.ZERO_LEDGER_ACTIVITY: {
        await this.requireRegisteredSystemOwner(manager, normalized.target.systemOwnerCode!);
        const ledger = await this.requireLedgerAccountEvidence(
          manager,
          wallet,
          normalized.evidenceReference,
        );
        const [activity] = await manager.query<Array<{ count: number }>>(
          'SELECT count(*)::int AS count FROM ledger_lines WHERE ledger_account_id = $1',
          [wallet.ledger_account_id],
        );
        if ((activity?.count ?? 0) !== 0) {
          throw new ConflictException(
            'Wallet ledger account is not inactive; system custody requires zero posted activity',
          );
        }
        facts.ledgerAccountCode = ledger.code;
        facts.ledgerLineCount = 0;
        break;
      }
      case WalletOwnershipEvidenceType.ZERO_LEDGER_BALANCE: {
        await this.requireRegisteredSystemOwner(manager, normalized.target.systemOwnerCode!);
        const ledger = await this.requireLedgerAccountEvidence(
          manager,
          wallet,
          normalized.evidenceReference,
        );
        const [balance] = await manager.query<Array<{ balance: string; lines: number }>>(
          `SELECT COALESCE(SUM(CASE WHEN l.direction = a.normal_balance THEN l.amount_minor
                                   ELSE -l.amount_minor END), 0)::text AS balance,
                  count(l.id)::int AS lines
             FROM ledger_accounts a
             LEFT JOIN ledger_lines l ON l.ledger_account_id = a.id
            WHERE a.id = $1`,
          [wallet.ledger_account_id],
        );
        if (BigInt(balance?.balance ?? '0') !== 0n) {
          throw new ConflictException(
            'Wallet ledger account is not zero-balanced; system custody requires a settled balance',
          );
        }
        facts.ledgerAccountCode = ledger.code;
        facts.balanceMinor = balance?.balance ?? '0';
        facts.ledgerLineCount = balance?.lines ?? 0;
        break;
      }
      default:
        throw new BadRequestException('Unsupported ownership evidence type');
    }

    const summary: WalletOwnershipEvidenceSummary = {
      evidenceType: normalized.evidenceType,
      verifiedAt: new Date(verifiedAt).toISOString(),
      ...facts,
    };
    const digest = sha256(
      canonical({
        walletId: wallet.id,
        resolutionClass: normalized.target.resolutionClass,
        resolvedOwnerReference: normalized.target.resolvedOwnerReference,
        evidenceType: normalized.evidenceType,
        evidenceReference: normalized.evidenceReference,
        summary,
      }),
    );
    return { summary, digest };
  }

  /** SYSTEM ownership must target the authoritative registry; free-text owners are refused. */
  private async requireRegisteredSystemOwner(
    manager: EntityManager,
    systemOwnerCode: string,
  ): Promise<void> {
    const rows = await manager.query<Array<{ code: string }>>(
      'SELECT code FROM wallet_system_owners WHERE code = $1 AND is_active',
      [systemOwnerCode],
    );
    if (!rows[0]) {
      throw new ConflictException(
        `System owner ${systemOwnerCode} is not an active registered wallet system owner`,
      );
    }
  }

  private async requireCustomer(
    manager: EntityManager,
    customerId: string,
    resolutionClass: WalletOwnershipResolutionClass,
  ): Promise<{
    id: string;
    reference: string;
    status: string;
    is_synthetic: boolean;
    deleted_at: Date | null;
  }> {
    const rows = await manager.query<
      Array<{
        id: string;
        reference: string;
        status: string;
        is_synthetic: boolean;
        deleted_at: Date | null;
      }>
    >(
      `SELECT id, reference, status, is_synthetic, deleted_at
         FROM customers WHERE id = $1 FOR SHARE`,
      [customerId],
    );
    const customer = rows[0];
    if (!customer) throw new NotFoundException('Ownership target customer was not found');
    if (customer.deleted_at || customer.is_synthetic) {
      throw new ConflictException('Ownership target customer is not a supported wallet owner');
    }
    // Rejects a UUID that is simultaneously a customer and an agent: the DB guard derives
    // classification from both authoritative tables, so an ambiguous target can never resolve.
    const [classification] = await manager.query<Array<{ owner_class: string }>>(
      'SELECT wallet_owner_class($1) AS owner_class',
      [customerId],
    );
    if (classification?.owner_class !== resolutionClass) {
      throw new ConflictException('Ownership target is not an unambiguous customer record');
    }
    return customer;
  }

  private async requireAgent(
    manager: EntityManager,
    agentId: string,
  ): Promise<{ id: string; reference: string; status: string; deleted_at: Date | null }> {
    const rows = await manager.query<
      Array<{ id: string; reference: string; status: string; deleted_at: Date | null }>
    >('SELECT id, reference, status, deleted_at FROM agents WHERE id = $1 FOR SHARE', [agentId]);
    const agent = rows[0];
    if (!agent) throw new NotFoundException('Ownership target agent was not found');
    if (agent.deleted_at) {
      throw new ConflictException('Ownership target agent is not a supported wallet owner');
    }
    const [classification] = await manager.query<Array<{ owner_class: string }>>(
      'SELECT wallet_owner_class($1) AS owner_class',
      [agentId],
    );
    if (classification?.owner_class !== WalletOwnershipResolutionClass.AGENT) {
      throw new ConflictException('Ownership target is not an unambiguous agent record');
    }
    return agent;
  }

  /** The cited reference must be the wallet's own ledger account code (proof of identification). */
  private async requireLedgerAccountEvidence(
    manager: EntityManager,
    wallet: WalletRow,
    evidenceReference: string,
  ): Promise<{ code: string }> {
    const rows = await manager.query<Array<{ code: string }>>(
      'SELECT code FROM ledger_accounts WHERE id = $1',
      [wallet.ledger_account_id],
    );
    const ledger = rows[0];
    if (!ledger) throw new NotFoundException('Wallet ledger account was not found');
    if (ledger.code.toLowerCase() !== evidenceReference.toLowerCase()) {
      throw new BadRequestException(
        'Evidence reference does not match the wallet ledger account code',
      );
    }
    return ledger;
  }

  // ------------------------------------------------------------------ persistence

  private async findResolution(
    manager: EntityManager,
    approvalId: string,
    walletId: string,
  ): Promise<ResolutionRow | null> {
    const rows = await manager.query<ResolutionRow[]>(
      `SELECT approval_id, wallet_id, resolution_class, previous_owner_ref, resolved_owner_ref,
              system_owner_code, evidence_type, evidence_reference, evidence_digest,
              evidence_summary, reason, executed_by, executed_at
         FROM governed_wallet_ownership_resolutions
        WHERE approval_id = $1 AND wallet_id = $2`,
      [approvalId, walletId],
    );
    return rows[0] ?? null;
  }

  private toView(record: ResolutionRow, wallet: WalletRow): WalletOwnershipResolutionView {
    return {
      approvalId: record.approval_id,
      walletId: record.wallet_id,
      currency: wallet.currency,
      ledgerAccountId: wallet.ledger_account_id,
      resolutionClass: record.resolution_class as WalletOwnershipResolutionClass,
      previousOwnerReference: record.previous_owner_ref,
      resolvedOwnerReference: record.resolved_owner_ref,
      systemOwnerCode: record.system_owner_code,
      evidenceType: record.evidence_type as WalletOwnershipEvidenceType,
      evidenceReference: record.evidence_reference,
      evidenceDigest: record.evidence_digest,
      evidenceSummary: record.evidence_summary,
      reason: record.reason,
      executedBy: record.executed_by,
      executedAt: record.executed_at,
      ownerClass: wallet.owner_class as WalletOwnershipResolutionView['ownerClass'],
      financiallyRestricted: wallet.owner_class === 'REVIEW',
    };
  }
}

interface ResolutionRow {
  approval_id: string;
  wallet_id: string;
  resolution_class: string;
  previous_owner_ref: string;
  resolved_owner_ref: string;
  system_owner_code: string | null;
  evidence_type: string;
  evidence_reference: string;
  evidence_digest: string;
  evidence_summary: Record<string, unknown>;
  reason: string;
  executed_by: string;
  executed_at: Date;
}

/**
 * Deterministic fingerprint of the ACTUAL resolution request (action + resource + full payload).
 * Computed server-side from normalized values only; a client can never supply it.
 */
export function walletOwnershipResolutionFingerprint(
  walletId: string,
  resolutionClass: string,
  resolvedOwnerReference: string,
  systemOwnerCode: string | null,
  evidenceType: string,
  evidenceReference: string,
  reason: string,
): string {
  return governedChangeFingerprint(ACTION, RESOURCE_TYPE, walletId, {
    resolutionClass,
    resolvedOwnerReference,
    systemOwnerCode,
    evidenceType,
    evidenceReference,
    reason,
  });
}

/** Maps the DB-level guard refusals (`23514` / `55000`) onto API conflicts. */
export function walletOwnershipGuardError(error: unknown): unknown {
  if (error instanceof QueryFailedError) {
    const driver = error.driverError as { code?: string; message?: string };
    if (driver.code === '23514' || driver.code === '55000') {
      return new ConflictException(driver.message ?? 'Wallet ownership change was refused');
    }
    if (driver.code === '23505') {
      return new ConflictException(
        'Ownership target already owns a wallet in this currency; the collision must be reconciled before this wallet can be resolved',
      );
    }
  }
  return error;
}
