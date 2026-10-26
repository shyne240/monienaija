import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { LimitEnforcementService } from '../limit-catalog/limit-enforcement.service';
import type { EnforceResult } from '../limit-catalog/limit-enforcement.service';
import { FeeRuleCalculatorService } from '../fee-rules/fee-rule-calculator.service';
import { FeeRuleResolverService } from '../fee-rules/fee-rule-resolver.service';
import { CommissionEngine } from '../commission/commission.engine';
import { CommercialDecisionSnapshotService } from '../commercial-decision/commercial-decision-snapshot.service';
import {
  commissionAllocatedAtAccountingBoundary,
  commissionFeeBasisMinor,
  commissionFeeCollectionStateOf,
  commissionNone,
  feeNotConfigured,
  limitApproved,
  limitNotEvaluated,
  rewardNone,
} from '../commercial-decision/commercial-decision.defaults';

import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';
import { WalletAccount } from '../wallet/wallet-account.entity';
import { WalletService } from '../wallet/wallet.service';
import { LedgerEntryDirection } from '../ledger/ledger.enums';
import { normalizeCurrency, parsePositiveMinorUnits } from '../common/money';
import { isRetryableTransactionError, MAX_SERIALIZABLE_ATTEMPTS } from '../common/serializable-transaction';
import { AgentServiceCapabilityService } from './agent-service-capability.service';
import { AgentStatus } from './agent.enums';
import { AgentService } from './agent-service.enum';
import { AggregatorStatus } from '../aggregator/aggregator.enums';
import { AGENT_FUNDING_ACTIONS, governedChangeFingerprint } from '../authorization/governed-action.registry';
import { PrivilegedActionApproval } from '../authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalService } from '../authorization/privileged-action-approval.service';
import { PrivilegedActionApprovalStatus } from '../authorization/privileged-action-approval.enums';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FUNDING_POOL_CODE = 'AGENT_FUNDING_POOL-NGN';
const RETENTION_SECONDS = 86_400;

export interface FundingInput {
  agentId: string;
  aggregatorId?: string | null; // if present, funding via Aggregator relationship
  amountMinor: string;
  currency?: string;
  idempotencyKey: string;
  reference?: string;
  correlationId?: string | null;
  description?: string;
  metadata?: Record<string, unknown>;
  principal: AuthorizationPrincipal;
  actor: string;
  /** Maker's business reason; used only when creating the approval request. */
  reason?: string;
  /**
   * V1-COMMERCIAL-DECISION-03E — TEST-ONLY hook. When true, the SERIALIZABLE transaction
   * throws AFTER the commercial snapshot is recorded but BEFORE commit, proving that the
   * snapshot rolls back atomically with the journal + limits + idempotency state. Never
   * used in production code paths.
   */
  _simulateFailureAfterJournal?: boolean;
}

export interface FundingResult {
  status: 'COMPLETED' | 'REPLAYED';
  journalId: string;
  agentId: string;
  aggregatorId?: string | null;
  amountMinor: string;
  currency: string;
  idempotencyKey: string;
  requestHash: string;
  replayed: boolean;
  createdAt: Date;
  reference?: string;
  correlationId?: string | null;
}

export interface AgentFundingRequestView {
  id: string;
  direction: 'FUND' | 'DEFUND';
  agentId: string;
  aggregatorId: string | null;
  isAggregatorFunding: boolean;
  metadata: Record<string, unknown>;
  amountMinor: string;
  currency: string;
  idempotencyKey: string;
  reference: string;
  correlationId: string | null;
  description: string;
  requestHash: string;
  approvalFingerprint: string;
  approvalId: string;
  status: 'PENDING' | 'REJECTED' | 'EXECUTED';
  approvalStatus: string;
  approvalExpiresAt: Date;
  approvalApprovedBy: string | null;
  reason: string;
  actionType: string;
  resourceType: string;
  resourceId: string;
  requesterPrincipalId: string;
  policy: Readonly<Record<string, unknown>>;
  makerPrincipalId: string;
  makerRole: string;
  makerType: string;
  checkerPrincipalId: string | null;
  checkerRole: string | null;
  checkerType: string | null;
  journalId: string | null;
  rejectionReason: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  executedAt: Date | null;
}

interface NormalizedFundingPayload {
  agentId: string;
  aggregatorId: string | null;
  amountMinor: string;
  currency: string;
  idempotencyKey: string;
  reference: string;
  correlationId: string | null;
  description: string;
  metadata: Record<string, unknown>;
  isAggregatorFunding: boolean;
}

interface AgentFundingRequestDbRow {
  id: string;
  direction: 'FUND' | 'DEFUND';
  agent_id: string;
  aggregator_id: string | null;
  amount_minor: string;
  currency: string;
  idempotency_key: string;
  reference: string;
  correlation_id: string | null;
  description: string;
  metadata: Record<string, unknown>;
  is_aggregator_funding: boolean;
  request_hash: string;
  approval_fingerprint: string;
  approval_id: string;
  status: 'PENDING' | 'REJECTED' | 'EXECUTED';
  maker_principal_id: string;
  maker_role: string;
  maker_type: string;
  checker_principal_id: string | null;
  checker_role: string | null;
  checker_type: string | null;
  journal_id: string | null;
  rejection_reason: string | null;
  created_at: Date;
  approved_at: Date | null;
  rejected_at: Date | null;
  executed_at: Date | null;
  approval_status?: string;
  approval_expires_at?: Date;
  approval_approved_by?: string | null;
  approval_reason?: string;
  approval_action_type?: string;
  approval_resource_type?: string;
  approval_resource_id?: string;
  approval_requester_principal_id?: string;
  approval_policy?: Record<string, unknown>;
}

interface FundingExecutionApproval {
  requestId: string;
  approvalId: string;
  approvalFingerprint: string;
  expectedRequestHash: string;
  makerPrincipalId: string;
}

function databaseRows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) throw new Error('Expected a row array from the database');
  return result as unknown as T[];
}

@Injectable()
export class AgentFundingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledgerService: LedgerService,
    private readonly idempotencyService: IdempotencyService,
    private readonly auditService: AuditService,
    private readonly walletService: WalletService,
    private readonly capabilityService: AgentServiceCapabilityService,
    private readonly approvalService: PrivilegedActionApprovalService,
    @Optional()
    private readonly limitEnforcementService?: LimitEnforcementService,
    // V1-COMMERCIAL-DECISION-03E — AGENT_FUNDING / AGENT_DEFUNDING commercial snapshot wiring.
    // Both optional: absent → no snapshot (unit tests constructing directly keep working).
    @Optional()
    private readonly feeRuleResolverService?: FeeRuleResolverService,
    @Optional()
    private readonly commercialDecisionSnapshotService?: CommercialDecisionSnapshotService,
    // V1-COMMERCIAL-IMPLEMENTATION-01 — single fee computation authority (optional; absent →
    // legacy evidence shape for manual-construction unit tests).
    @Optional()
    private readonly feeRuleCalculatorService?: FeeRuleCalculatorService,
    // V1-COMMERCIAL-IMPLEMENTATION-02 — single commission decision authority (optional; absent →
    // legacy commissionNone() shape for manual-construction unit tests).
    @Optional()
    private readonly commissionEngine?: CommissionEngine,
  ) {}

  /** Create a pending, fingerprint-bound maker request. This method never posts a journal. */
  async fund(input: FundingInput): Promise<AgentFundingRequestView> {
    return this.requestFunding(input, 'FUND');
  }

  /** Create a pending, fingerprint-bound maker request. This method never posts a journal. */
  async defund(input: FundingInput): Promise<AgentFundingRequestView> {
    return this.requestFunding(input, 'DEFUND');
  }

  async requestFunding(
    input: FundingInput,
    direction: 'FUND' | 'DEFUND',
    requestReason?: string,
  ): Promise<AgentFundingRequestView> {
    const payload = this.normalizeFundingPayload(input, direction);
    const principal = input.principal;
    this.assertMakerPrincipal(principal, direction);
    await this.validateFundingTarget(payload, direction);

    const requestHash = this.computeRequestHash({ direction, ...payload });
    const action = AGENT_FUNDING_ACTIONS[direction];
    const reason = requestReason?.trim() || input.reason?.trim() || payload.description;
    if (!reason || reason.length > 500) {
      throw new BadRequestException('A funding request reason of 1–500 characters is required');
    }

    // Approval creation, request persistence, and request audit are one transaction. The
    // advisory lock makes retries with the same scoped idempotency key converge on one record
    // before either approval or request rows are created.
    const requestId = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `agent-funding-request:${direction}:${payload.agentId}:${payload.idempotencyKey}`,
      ]);
      const existingRows = databaseRows<AgentFundingRequestDbRow>(await manager.query(
        `SELECT * FROM agent_funding_requests
         WHERE direction=$1 AND agent_id=$2 AND idempotency_key=$3 LIMIT 1`,
        [direction, payload.agentId, payload.idempotencyKey],
      ));
      const existing = existingRows[0];
      if (existing) {
        if (
          existing.request_hash !== requestHash ||
          existing.maker_principal_id !== principal.principalId
        ) {
          throw new ConflictException(
            'Agent funding idempotency key is already bound to a different request',
          );
        }
        return existing.id;
      }

      const id = randomUUID();
      const approvalFingerprint = governedChangeFingerprint(
        action.action,
        action.resourceType,
        id,
        { direction, ...payload },
      );
      const approvalDecision = await this.approvalService.requestInTransaction(manager, {
        id,
        principal,
        policy: {
          resourceType: action.resourceType,
          action: action.action,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          requiredRoles: action.initiatingRoles,
          requiredFunctions: action.initiatingFunctionCodes,
          minimumAssurance: action.minimumAssurance,
          customerAccess: 'NONE',
        },
        resource: { type: action.resourceType, id },
        actionFingerprint: approvalFingerprint,
        approvalScope: action.approvalScope,
        reason,
        requestDetails: {
          direction,
          agentId: payload.agentId,
          aggregatorId: payload.aggregatorId,
          amountMinor: payload.amountMinor,
          currency: payload.currency,
          idempotencyKey: payload.idempotencyKey,
          reference: payload.reference,
          correlationId: payload.correlationId,
          description: payload.description,
          metadata: payload.metadata,
        },
      });
      const approval = approvalDecision.approval;
      if (!approval || approvalDecision.reason !== 'REQUESTED') {
        throw new ForbiddenException(
          `Agent funding maker request was not authorized: ${approvalDecision.authorization?.reason ?? approvalDecision.reason ?? 'DENIED'}`,
        );
      }

      const rows = databaseRows<{ id: string }>(await manager.query(
        `INSERT INTO agent_funding_requests (
           id, direction, agent_id, aggregator_id, amount_minor, currency, idempotency_key,
           reference, correlation_id, description, metadata, is_aggregator_funding,
           request_hash, approval_fingerprint, approval_id, maker_principal_id, maker_role,
           maker_type
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16,
           'AGENT_NETWORK_MANAGER', $17
         ) RETURNING id`,
        [
          id,
          direction,
          payload.agentId,
          payload.aggregatorId,
          payload.amountMinor,
          payload.currency,
          payload.idempotencyKey,
          payload.reference,
          payload.correlationId,
          payload.description,
          JSON.stringify(payload.metadata),
          payload.isAggregatorFunding,
          requestHash,
          approvalFingerprint,
          approval.id,
          principal.principalId,
          principal.type,
        ],
      ));
      if (!rows[0]) throw new ConflictException('Agent funding request was not persisted');
      await this.auditService.record(manager, {
        entityType: 'AGENT_FUNDING_REQUEST',
        entityId: id,
        action: 'AGENT_FUNDING_REQUESTED',
        actor: principal.principalId,
        correlationId: payload.correlationId ?? undefined,
        newValues: {
          direction,
          agentId: payload.agentId,
          aggregatorId: payload.aggregatorId,
          amountMinor: payload.amountMinor,
          currency: payload.currency,
          idempotencyKey: payload.idempotencyKey,
          requestHash,
          approvalFingerprint,
          approvalId: approval.id,
          makerPrincipalId: principal.principalId,
          makerRole: 'AGENT_NETWORK_MANAGER',
        },
      });
      return id;
    });

    return this.getFundingRequest(requestId);
  }

  async getFundingRequest(requestId: string): Promise<AgentFundingRequestView> {
    if (!UUID_PATTERN.test(requestId)) throw new BadRequestException('requestId must be a UUID');
    const rows = databaseRows<AgentFundingRequestDbRow>(await this.dataSource.query(
      `SELECT r.*, a.status AS approval_status, a.approved_by AS approval_approved_by,
              a.expires_at AS approval_expires_at, a.reason AS approval_reason,
              a.action_type AS approval_action_type,
              a.resource_type AS approval_resource_type, a.resource_id AS approval_resource_id,
              a.requester_principal_id AS approval_requester_principal_id,
              a.policy AS approval_policy
         FROM agent_funding_requests r
         JOIN privileged_action_approvals a ON a.id=r.approval_id
        WHERE r.id=$1 LIMIT 1`,
      [requestId],
    ));
    if (!rows[0]) throw new NotFoundException('Agent funding request not found');
    return this.toFundingRequestView(rows[0]);
  }

  async listFundingRequests(
    agentId: string,
    principal: AuthorizationPrincipal,
    idempotencyKey?: string,
  ): Promise<AgentFundingRequestView[]> {
    if (!UUID_PATTERN.test(agentId)) throw new BadRequestException('agentId must be a UUID');
    if (idempotencyKey !== undefined && (!idempotencyKey.trim() || idempotencyKey.length > 255)) {
      throw new BadRequestException('idempotencyKey must contain 1–255 characters');
    }
    if (
      !principal?.principalId ||
      principal.assuranceLevel !== 'MFA' ||
      principal.roles.includes('SUPER_ADMIN') ||
      !principal.roles.some((role) =>
        ['AGENT_NETWORK_MANAGER', 'FINANCE_CONTROLLER'].includes(role),
      )
    ) {
      throw new ForbiddenException('Funding instruction access requires an entitled MFA workforce session');
    }
    const checker = principal.roles.includes('FINANCE_CONTROLLER');
    const canFund = principal.scopes.includes('agent.fund');
    const canDefund = principal.scopes.includes('agent.defund');
    if (!canFund && !canDefund) throw new ForbiddenException('Funding function required');

    const rows = databaseRows<AgentFundingRequestDbRow>(await this.dataSource.query(
      `SELECT r.*, a.status AS approval_status, a.approved_by AS approval_approved_by,
              a.expires_at AS approval_expires_at, a.reason AS approval_reason,
              a.action_type AS approval_action_type,
              a.resource_type AS approval_resource_type, a.resource_id AS approval_resource_id,
              a.requester_principal_id AS approval_requester_principal_id,
              a.policy AS approval_policy
         FROM agent_funding_requests r
         JOIN privileged_action_approvals a ON a.id=r.approval_id
        WHERE r.agent_id=$1
          AND ($2::text IS NULL OR r.idempotency_key=$2)
          AND ((r.direction='FUND' AND $3::boolean) OR (r.direction='DEFUND' AND $4::boolean))
          AND (r.maker_principal_id=$5 OR r.checker_principal_id=$5 OR ($6::boolean AND r.status='PENDING'))
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 50`,
      [agentId, idempotencyKey?.trim() ?? null, canFund, canDefund, principal.principalId, checker],
    ));

    return rows.map((row) => {
      const view = this.toFundingRequestView(row);
      // Makers can follow their own request state, but the completed journal response is
      // recoverable only by the checker whose identity is recorded on the posting.
      if (row.status === 'EXECUTED' && row.checker_principal_id !== principal.principalId) {
        view.journalId = null;
      }
      return view;
    });
  }

  /**
   * V1-SPRINT2-FUNDING-INBOX-01 (ARENA 3): global, READ-ONLY discovery of Agent
   * funding/defunding work for the independent checker side of Decision 7.
   *
   * Why this exists: the only list read before this method was per-Agent
   * (GET /internal/agents/:agentId/funding-requests), so a FINANCE_CONTROLLER could not
   * discover which requests across the network were awaiting independent approval without
   * enumerating Agent ids — and FINANCE_CONTROLLER deliberately holds no agent.view or any
   * other Agent Network function (see authorization-catalogue.seed.ts). This inbox gives
   * the checker exactly the discovery it needs and nothing more.
   *
   * Authorization (double-gated, mirroring the execute/reject routes):
   *  - Route policy (route-policy-registry.ts): WORKFORCE_SESSION,
   *    OPERATOR/SERVICE/PRIVILEGED principal types, requiredRoles ['FINANCE_CONTROLLER'],
   *    requiredFunctions ['agent.fund','agent.defund'] (APPROVE-level catalogue grants).
   *  - Service: assertCheckerPrincipal() — the identical Decision 7 checker policy
   *    (non-SUPER_ADMIN FINANCE_CONTROLLER, MFA assurance, both approving functions).
   *
   * Maker-checker separation is preserved and strengthened server-side: rows whose maker
   * is the calling principal are always excluded (a maker can never approve their own
   * request, so their own requests are not approvable work for them, and this inbox must
   * not become a maker-side tracker). The method mutates nothing, grants no function, and
   * confers no approval or execution capability; approve/execute/reject remain separate,
   * independently authorized POST routes.
   */
  async listGlobalFundingRequests(
    principal: AuthorizationPrincipal,
    options: {
      status?: 'PENDING' | 'REJECTED' | 'EXECUTED';
      direction?: 'FUND' | 'DEFUND';
      page?: number;
      limit?: number;
    } = {},
  ): Promise<{ items: AgentFundingRequestView[]; page: number; limit: number; total: number }> {
    this.assertCheckerPrincipal(principal);

    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException('page must be an integer >= 1');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new BadRequestException('limit must be an integer between 1 and 50');
    }
    const status = options.status ?? null;
    const direction = options.direction ?? null;

    const whereClause = `WHERE r.maker_principal_id <> $1
          AND ($2::text IS NULL OR r.status=$2)
          AND ($3::text IS NULL OR r.direction=$3)`;
    const countRows = databaseRows<{ cnt: string }>(await this.dataSource.query(
      `SELECT count(*)::text AS cnt
         FROM agent_funding_requests r
         JOIN privileged_action_approvals a ON a.id=r.approval_id
        ${whereClause}`,
      [principal.principalId, status, direction],
    ));
    const rows = databaseRows<AgentFundingRequestDbRow>(await this.dataSource.query(
      `SELECT r.*, a.status AS approval_status, a.approved_by AS approval_approved_by,
              a.expires_at AS approval_expires_at, a.reason AS approval_reason,
              a.action_type AS approval_action_type,
              a.resource_type AS approval_resource_type, a.resource_id AS approval_resource_id,
              a.requester_principal_id AS approval_requester_principal_id,
              a.policy AS approval_policy
         FROM agent_funding_requests r
         JOIN privileged_action_approvals a ON a.id=r.approval_id
        ${whereClause}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT $4 OFFSET $5`,
      [principal.principalId, status, direction, limit, (page - 1) * limit],
    ));

    const items = rows.map((row) => {
      const view = this.toFundingRequestView(row);
      // Same recovery rule as the per-Agent list: the completed journal reference is only
      // exposed to the checker whose identity is recorded on the posting.
      if (row.status === 'EXECUTED' && row.checker_principal_id !== principal.principalId) {
        view.journalId = null;
      }
      return view;
    });
    return { items, page, limit, total: Number(countRows[0]?.cnt ?? '0') };
  }

  async rejectFundingRequest(
    requestId: string,
    principal: AuthorizationPrincipal,
    reason: string,
  ): Promise<AgentFundingRequestView> {
    // Direction is stored on the row. Require checker authority for both governed
    // directions before loading it, so unauthorized callers cannot enumerate IDs.
    this.assertCheckerPrincipal(principal);
    const request = await this.getFundingRequest(requestId);
    const direction = request.direction;
    this.assertCheckerPrincipal(principal, direction);
    if (request.makerPrincipalId === principal.principalId) {
      throw new ForbiddenException('Funding maker cannot reject their own request');
    }
    if (request.status !== 'PENDING') throw new ConflictException('Agent funding request is no longer pending');
    const comment = reason?.trim();
    if (!comment || comment.length > 500) throw new BadRequestException('A rejection reason of 1–500 characters is required');

    const outcome = await this.dataSource.transaction(async (manager) => {
      // Lock in the same order as execution (request, then approval) so approve/reject/execute
      // races serialize without splitting approval and request state across transactions.
      const locked = databaseRows<AgentFundingRequestDbRow>(await manager.query(
        `SELECT * FROM agent_funding_requests WHERE id=$1 FOR UPDATE`,
        [requestId],
      ));
      const row = locked[0];
      if (!row || row.status !== 'PENDING') {
        throw new ConflictException('Agent funding request is no longer pending');
      }
      if (row.maker_principal_id === principal.principalId) {
        throw new ForbiddenException('Funding maker cannot reject their own request');
      }
      if (row.maker_role !== 'AGENT_NETWORK_MANAGER') {
        throw new ConflictException('Agent funding request has an invalid Decision 7 maker role');
      }

      const payload = this.payloadFromFundingRequest(row);
      const action = AGENT_FUNDING_ACTIONS[row.direction];
      const requestHash = this.computeRequestHash({ direction: row.direction, ...payload });
      const fingerprint = governedChangeFingerprint(
        action.action,
        action.resourceType,
        row.id,
        { direction: row.direction, ...payload },
      );
      if (
        requestHash !== row.request_hash ||
        fingerprint !== row.approval_fingerprint ||
        row.approval_id !== request.approvalId
      ) {
        throw new ConflictException('Agent funding request payload or approval binding has changed');
      }

      const decision = await this.approvalService.rejectInTransaction(manager, {
        approvalId: row.approval_id,
        principal,
        comment,
      });
      if (decision.reason !== 'REJECTED') {
        // Let expiry/audit transitions commit, but never consume the request when the approval
        // could not be rejected. The conflict is raised after the transaction returns.
        return { kind: 'denied' as const, reason: decision.reason ?? 'UNKNOWN' };
      }
      const approval = decision.approval;
      if (
        !approval ||
        approval.requesterPrincipalId !== row.maker_principal_id ||
        approval.actionType !== action.action ||
        approval.resourceType !== action.resourceType ||
        approval.resourceId !== row.id ||
        approval.actionFingerprint !== row.approval_fingerprint ||
        approval.status !== PrivilegedActionApprovalStatus.REJECTED
      ) {
        throw new ConflictException('The rejection approval does not match the stored funding request');
      }

      const now = new Date();
      const updated = databaseRows<AgentFundingRequestDbRow>(await manager.query(
        `UPDATE agent_funding_requests
         SET status='REJECTED', checker_principal_id=$2, checker_role='FINANCE_CONTROLLER',
             checker_type=$3, rejection_reason=$4, rejected_at=$5, updated_at=$5, version=version+1
         WHERE id=$1 AND status='PENDING' RETURNING *`,
        [requestId, principal.principalId, principal.type, comment, now],
      ));
      if (!updated[0]) throw new ConflictException('Agent funding request was already resolved');
      await this.auditService.record(manager, {
        entityType: 'AGENT_FUNDING_REQUEST',
        entityId: requestId,
        action: 'AGENT_FUNDING_REJECTED',
        actor: principal.principalId,
        correlationId: row.correlation_id ?? undefined,
        newValues: {
          approvalId: row.approval_id,
          approvalFingerprint: row.approval_fingerprint,
          makerPrincipalId: row.maker_principal_id,
          makerRole: 'AGENT_NETWORK_MANAGER',
          checkerPrincipalId: principal.principalId,
          checkerRole: 'FINANCE_CONTROLLER',
          reason: comment,
        },
      });
      return { kind: 'rejected' as const, row: updated[0] };
    });

    if (outcome.kind === 'denied') {
      throw new ConflictException(`Agent funding rejection was not recorded: ${outcome.reason}`);
    }
    // Reload through the joined approval query: the UPDATE ... RETURNING row above does not carry
    // the approval metadata consumed by toFundingRequestView (action/resource/policy fields).
    return this.getFundingRequest(requestId);
  }

  async executeApprovedRequest(
    requestId: string,
    checker: AuthorizationPrincipal,
    expectedInstruction?: FundingInput,
  ): Promise<FundingResult> {
    // Check role, assurance, and both possible function grants before looking up the
    // request because the requested direction is not known until after that lookup.
    this.assertCheckerPrincipal(checker);
    const request = await this.getFundingRequest(requestId);
    this.assertCheckerPrincipal(checker, request.direction);
    if (expectedInstruction) {
      const expectedPayload = this.normalizeFundingPayload(expectedInstruction, request.direction);
      const expectedHash = this.computeRequestHash({ direction: request.direction, ...expectedPayload });
      if (
        expectedPayload.agentId !== request.agentId ||
        expectedHash !== request.requestHash
      ) {
        throw new ForbiddenException('Executed instruction does not match the approved funding request');
      }
    }
    if (request.status === 'EXECUTED') {
      return this.replayCompletedRequest(request, checker);
    }
    if (request.status !== 'PENDING') {
      throw new ConflictException(`Agent funding request is ${request.status.toLowerCase()}`);
    }

    const rows = databaseRows<AgentFundingRequestDbRow>(await this.dataSource.query(
      `SELECT * FROM agent_funding_requests WHERE id=$1 LIMIT 1`,
      [requestId],
    ));
    const row = rows[0];
    if (!row) throw new NotFoundException('Agent funding request not found');
    const payload = this.payloadFromFundingRequest(row);
    const expectedRequestHash = this.computeRequestHash({ direction: row.direction, ...payload });
    const action = AGENT_FUNDING_ACTIONS[row.direction];
    const expectedFingerprint = governedChangeFingerprint(
      action.action,
      action.resourceType,
      row.id,
      { direction: row.direction, ...payload },
    );
    if (expectedRequestHash !== row.request_hash || expectedFingerprint !== row.approval_fingerprint) {
      throw new ConflictException('Agent funding request payload or fingerprint has changed');
    }

    const approval = await this.approvalService.getApproval(row.approval_id);
    if (
      checker.principalId === row.maker_principal_id ||
      !approval ||
      approval.status !== PrivilegedActionApprovalStatus.APPROVED ||
      approval.approvedBy !== checker.principalId ||
      approval.requesterPrincipalId !== row.maker_principal_id ||
      approval.actionType !== action.action ||
      approval.resourceType !== action.resourceType ||
      approval.resourceId !== row.id ||
      approval.actionFingerprint !== row.approval_fingerprint
    ) {
      throw new ForbiddenException('A matching independent FINANCE_CONTROLLER approval is required');
    }

    const input: FundingInput = {
      ...payload,
      principal: checker,
      actor: checker.principalId,
      // Only trusted in-process tests can supply this property; the public funding DTO does not
      // expose the rollback hook, so normal HTTP execution cannot request a simulated failure.
      ...(expectedInstruction?._simulateFailureAfterJournal === true
        ? { _simulateFailureAfterJournal: true }
        : {}),
    };
    return this.executeFunding(input, row.direction, {
      requestId: row.id,
      approvalId: row.approval_id,
      approvalFingerprint: row.approval_fingerprint,
      expectedRequestHash: row.request_hash,
      makerPrincipalId: row.maker_principal_id,
    });
  }

  private async replayCompletedRequest(
    request: AgentFundingRequestView,
    checker: AuthorizationPrincipal,
  ): Promise<FundingResult> {
    if (request.checkerPrincipalId !== checker.principalId) {
      throw new ForbiddenException('Funding result recovery requires the original checker');
    }
    if (!request.journalId) {
      throw new ConflictException('Executed funding request is missing its journal linkage');
    }

    const payload: NormalizedFundingPayload = {
      agentId: request.agentId,
      aggregatorId: request.aggregatorId,
      amountMinor: request.amountMinor,
      currency: request.currency,
      idempotencyKey: request.idempotencyKey,
      reference: request.reference,
      correlationId: request.correlationId,
      description: request.description,
      metadata: request.metadata,
      isAggregatorFunding: request.isAggregatorFunding,
    };
    const action = AGENT_FUNDING_ACTIONS[request.direction];
    const expectedRequestHash = this.computeRequestHash({ direction: request.direction, ...payload });
    const expectedFingerprint = governedChangeFingerprint(
      action.action,
      action.resourceType,
      request.id,
      { direction: request.direction, ...payload },
    );
    if (
      expectedRequestHash !== request.requestHash ||
      expectedFingerprint !== request.approvalFingerprint ||
      request.approvalId !== request.id
    ) {
      throw new ConflictException('Completed funding request binding has changed');
    }

    const approval = await this.approvalService.getApproval(request.approvalId);
    if (
      !approval ||
      approval.status !== PrivilegedActionApprovalStatus.CONSUMED ||
      approval.approvedBy !== checker.principalId ||
      approval.requesterPrincipalId !== request.makerPrincipalId ||
      approval.actionType !== action.action ||
      approval.resourceType !== action.resourceType ||
      approval.resourceId !== request.id ||
      approval.actionFingerprint !== request.approvalFingerprint
    ) {
      throw new ConflictException('Completed funding request approval linkage is invalid');
    }

    return this.toFundingReplayResult(request);
  }

  private toFundingReplayResult(request: AgentFundingRequestView): FundingResult {
    if (!request.journalId) {
      throw new ConflictException('Executed funding request is missing its journal linkage');
    }
    return {
      status: 'REPLAYED',
      journalId: request.journalId,
      agentId: request.agentId,
      aggregatorId: request.aggregatorId,
      amountMinor: request.amountMinor,
      currency: request.currency,
      idempotencyKey: request.idempotencyKey,
      requestHash: request.requestHash,
      replayed: true,
      createdAt: request.executedAt ?? request.createdAt,
      reference: request.reference,
      correlationId: request.correlationId,
    };
  }

  private toFundingReplayResultFromRow(row: AgentFundingRequestDbRow): FundingResult {
    if (!row.journal_id) {
      throw new ConflictException('Executed funding request is missing its journal linkage');
    }
    const payload = this.payloadFromFundingRequest(row);
    return {
      status: 'REPLAYED',
      journalId: row.journal_id,
      agentId: payload.agentId,
      aggregatorId: payload.aggregatorId,
      amountMinor: payload.amountMinor,
      currency: payload.currency,
      idempotencyKey: payload.idempotencyKey,
      requestHash: row.request_hash,
      replayed: true,
      createdAt: row.executed_at ?? row.created_at,
      reference: payload.reference,
      correlationId: payload.correlationId,
    };
  }

  private async executeFunding(
    input: FundingInput,
    direction: 'FUND' | 'DEFUND',
    approvalContext: FundingExecutionApproval,
  ): Promise<FundingResult> {
    const payload = this.normalizeFundingPayload(input, direction);
    const {
      agentId,
      aggregatorId,
      amountMinor: amountString,
      currency,
      idempotencyKey,
      reference,
      correlationId,
      description,
      isAggregatorFunding,
    } = payload;
    const principal = input.principal;
    this.assertCheckerPrincipal(principal, direction);
    const actor = principal.principalId;

    // Validate lifecycle, capability, funding pool, and any aggregator relationship before
    // attempting the approved SERIALIZABLE execution.
    const { poolId } = await this.validateFundingTarget(payload, direction);

    const requestHash = this.computeRequestHash({ direction, ...payload });

    const scope = direction === 'FUND' ? `agent-funding.v1:${agentId}` : `agent-defunding.v1:${agentId}`;

    for (let attempt = 0; attempt < MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
          const lockedRequests = databaseRows<AgentFundingRequestDbRow>(await manager.query(
            `SELECT * FROM agent_funding_requests WHERE id=$1 FOR UPDATE`,
            [approvalContext.requestId],
          ));
          const lockedRequest = lockedRequests[0];
          if (!lockedRequest) throw new NotFoundException('Agent funding request not found');
          const lockedPayload = this.payloadFromFundingRequest(lockedRequest);
          const lockedRequestHash = this.computeRequestHash({
            direction: lockedRequest.direction,
            ...lockedPayload,
          });
          const action = AGENT_FUNDING_ACTIONS[lockedRequest.direction];
          const lockedFingerprint = governedChangeFingerprint(
            action.action,
            action.resourceType,
            lockedRequest.id,
            { direction: lockedRequest.direction, ...lockedPayload },
          );
          if (
            lockedRequest.direction !== direction ||
            lockedRequest.maker_principal_id !== approvalContext.makerPrincipalId ||
            lockedRequest.approval_id !== approvalContext.approvalId ||
            lockedRequest.request_hash !== approvalContext.expectedRequestHash ||
            lockedRequestHash !== approvalContext.expectedRequestHash ||
            lockedRequest.approval_fingerprint !== approvalContext.approvalFingerprint ||
            lockedFingerprint !== approvalContext.approvalFingerprint
          ) {
            throw new ConflictException('Agent funding approval no longer matches the stored request payload');
          }
          if (lockedRequest.status === 'EXECUTED') {
            if (lockedRequest.checker_principal_id !== principal.principalId) {
              throw new ForbiddenException('Funding result recovery requires the original checker');
            }
            const priorApproval = await manager
              .getRepository(PrivilegedActionApproval)
              .findOne({
                where: { id: lockedRequest.approval_id },
                lock: { mode: 'pessimistic_read' },
              });
            if (
              !priorApproval ||
              priorApproval.status !== PrivilegedActionApprovalStatus.CONSUMED ||
              priorApproval.approvedBy !== principal.principalId ||
              priorApproval.requesterPrincipalId !== lockedRequest.maker_principal_id ||
              priorApproval.actionType !== action.action ||
              priorApproval.resourceType !== action.resourceType ||
              priorApproval.resourceId !== lockedRequest.id ||
              priorApproval.actionFingerprint !== lockedRequest.approval_fingerprint
            ) {
              throw new ConflictException('Completed funding request approval linkage is invalid');
            }
            return this.toFundingReplayResultFromRow(lockedRequest);
          }
          if (lockedRequest.status !== 'PENDING') {
            throw new ConflictException('Agent funding request has already been rejected');
          }
          const consumed = await this.approvalService.consumeInTransaction(manager, {
            principal,
            approvalId: approvalContext.approvalId,
            actionType: action.action,
            resource: { type: action.resourceType, id: lockedRequest.id },
            actionFingerprint: approvalContext.approvalFingerprint,
          });
          if (
            !consumed.approved ||
            !consumed.approval ||
            consumed.approval.requesterPrincipalId !== approvalContext.makerPrincipalId ||
            consumed.approval.approvedBy !== principal.principalId ||
            principal.principalId === approvalContext.makerPrincipalId
          ) {
            throw new ForbiddenException(
              `Agent funding approval cannot be consumed: ${consumed.reason ?? 'DENIED'}`,
            );
          }

          const reservation = await this.idempotencyService.reserve(manager, {
            scope,
            key: idempotencyKey,
            requestHash,
            retentionSeconds: RETENTION_SECONDS,
          });

          if (reservation.kind === 'REPLAY') {
            // A funding request is executable once, under the approval bound to its request
            // fingerprint. A prior idempotency record must never consume this request's checker
            // approval or return a success before marking the request executed.
            throw new ConflictException('Agent funding idempotency key has already been consumed');
          }

          // Wallet/account provisioning belongs to the same SERIALIZABLE transaction as
          // approval consumption, journal posting and request execution. A failed or
          // concurrently replayed execution must not leave a new account behind.
          const walletRepository = manager.getRepository(WalletAccount);
          let walletInTx = await walletRepository.findOne({
            where: { customerId: agentId, currency: 'NGN' },
            lock: { mode: 'pessimistic_write' },
          });
          if (!walletInTx) {
            walletInTx = await this.walletService.createWalletInTransaction(manager, {
              customerId: agentId,
              currency: 'NGN',
              idempotencyKey: `agent-funding-wallet-${agentId}-NGN`,
            });
          }
          const lines =
            direction === 'FUND'
              ? [
                  { accountId: poolId, direction: LedgerEntryDirection.DEBIT as const, amountMinor: amountString },
                  { accountId: walletInTx.ledgerAccountId, direction: LedgerEntryDirection.CREDIT as const, amountMinor: amountString },
                ]
              : [
                  { accountId: walletInTx.ledgerAccountId, direction: LedgerEntryDirection.DEBIT as const, amountMinor: amountString },
                  { accountId: poolId, direction: LedgerEntryDirection.CREDIT as const, amountMinor: amountString },
                ];

          // V1-LIMIT-04: enforce limits for AGENT_FUNDING/AGENT_DEFUNDING
          let limitIdempotencyKey: string | null = null;
          // V1-COMMERCIAL-DECISION-03E: capture the AUTHORITATIVE enforcement result so the
          // commercial snapshot records what actually governed this execution — never re-evaluated.
          let limitOutcome: EnforceResult | null = null;
          if (this.limitEnforcementService) {
            const agentRows = databaseRows<{ agent_class_id: string | null }>(await manager.query(
              `SELECT agent_class_id FROM agents WHERE id = $1 LIMIT 1`,
              [agentId],
            ));
            const agentClassId = agentRows[0]?.agent_class_id ?? null;
            limitIdempotencyKey = idempotencyKey;
            const product = direction === 'FUND' ? 'AGENT_FUNDING' : 'AGENT_DEFUNDING';
            const dir = direction === 'FUND' ? 'INCOMING' : 'OUTGOING';
            try {
              limitOutcome = await this.limitEnforcementService.enforceWithManager(manager, {
                principalType: 'AGENT',
                principalId: agentId,
                agentClassId,
                product,
                currency: 'NGN',
                direction: dir,
                channel: null,
                amountMinor: amountString,
                idempotencyKey: limitIdempotencyKey,
                requestHash,
                correlationId: correlationId ?? null,
                now: new Date(),
                walletLedgerAccountId: walletInTx.ledgerAccountId,
                principalWalletCustomerId: agentId,
              });
            } catch (error) {
              if (error instanceof HttpException) {
                const response = error.getResponse();
                const code =
                  typeof response === 'object' && response !== null
                    ? ('error' in response ? response.error : 'code' in response ? response.code : undefined)
                    : undefined;
                if (typeof code === 'string' && code.startsWith('LIMIT_')) throw error;
              }
              throw error;
            }
          }

          // For defunding, ledger trigger will enforce no overdraft, but we can pre-check balance for clearer error
          // Let ledger handle insufficient funds as 422 via trigger.

          const ledgerIdempotencyKey = `${direction.toLowerCase()}:${agentId}:${idempotencyKey}`;
          let journalId: string;
          try {
            journalId = await this.ledgerService.postJournalInTransaction(manager, {
              idempotencyKey: ledgerIdempotencyKey,
              currency,
              accountingUnit: 'CUSTOMER_FUNDS',
              reference,
              description,
              correlationId: correlationId ?? undefined,
              metadata: {
                agentId,
                aggregatorId: aggregatorId ?? null,
                direction,
                isAggregatorFunding,
                amountMinor: amountString,
                currency,
                idempotencyKey,
                requestHash,
                actor,
                fundingRequestId: approvalContext.requestId,
                approvalId: approvalContext.approvalId,
                approvalFingerprint: approvalContext.approvalFingerprint,
                makerPrincipalId: approvalContext.makerPrincipalId,
                makerRole: 'AGENT_NETWORK_MANAGER',
                checkerPrincipalId: principal.principalId,
                checkerRole: 'FINANCE_CONTROLLER',
              },
              lines: lines.map((l) => ({
                accountId: l.accountId,
                direction: l.direction,
                amountMinor: l.amountMinor,
              })),
            });
          } catch (e) {
            if (limitIdempotencyKey && this.limitEnforcementService) {
              try {
                await this.limitEnforcementService.releaseReservationsWithManager(manager, limitIdempotencyKey);
              } catch (releaseError) {
                throw new AggregateError(
                  [e, releaseError],
                  'Funding posting failed and its limit reservation could not be released',
                );
              }
            }
            throw e;
          }

          if (limitIdempotencyKey && this.limitEnforcementService) {
            // Reservation commit is part of the financial transaction. Any failure must roll back
            // the journal and approval consumption rather than leave an unaccounted posting.
            await this.limitEnforcementService.commitReservationsWithManager(manager, limitIdempotencyKey);
          }

          // — V1-COMMERCIAL-DECISION-03E: record the immutable commercial decision snapshot inside
          // this same SERIALIZABLE transaction, after the journal posted and limits committed,
          // before idempotency completion + audit. Commits/rolls back atomically with the funding
          // movement. NO fee is charged: NOT_CONFIGURED. The existing pool/wallet accounting is
          // untouched — this adds no journal, no account, no second balance.
          await this.recordCommercialDecisionSnapshot(manager, {
            direction,
            agentId,
            aggregatorId: aggregatorId ?? null,
            amountMinor: amountString,
            currency,
            journalId,
            idempotencyKey,
            correlationId: correlationId ?? null,
            limitOutcome,
          });

          // Simulate failure after journal for rollback test (inside same transaction, so journal,
          // limits, snapshot, and idempotency state all roll back)
          if (input._simulateFailureAfterJournal) {
            throw new BadRequestException('Simulated failure after journal');
          }

          const result: FundingResult = {
            status: 'COMPLETED',
            journalId,
            agentId,
            aggregatorId: aggregatorId ?? null,
            amountMinor: amountString,
            currency,
            idempotencyKey,
            requestHash,
            replayed: false,
            createdAt: new Date(),
            reference,
            correlationId: correlationId ?? null,
          };

          await this.idempotencyService.complete(manager, reservation.record.id, {
            statusCode: 201,
            responseBody: result as unknown as Record<string, unknown>,
            resourceType: 'LEDGER_JOURNAL',
            resourceId: journalId,
          });

          await this.auditService.record(manager, {
            entityType: direction === 'FUND' ? 'AGENT_FUNDING' : 'AGENT_DEFUNDING',
            entityId: journalId,
            action: direction === 'FUND' ? (isAggregatorFunding ? 'AGGREGATOR_AGENT_FUNDED' : 'AGENT_FUNDED') : (isAggregatorFunding ? 'AGGREGATOR_AGENT_DEFUNDED' : 'AGENT_DEFUNDED'),
            actor,
            correlationId: correlationId ?? undefined,
            newValues: {
              agentId,
              aggregatorId: aggregatorId ?? null,
              isAggregatorFunding,
              direction,
              amountMinor: amountString,
              currency,
              accountingUnit: 'CUSTOMER_FUNDS',
              journalId,
              idempotencyKey,
              requestHash,
              reference,
              correlationId: correlationId ?? null,
              sourceAccountId: direction === 'FUND' ? poolId : walletInTx.ledgerAccountId,
              destinationAccountId: direction === 'FUND' ? walletInTx.ledgerAccountId : poolId,
              poolAccountId: poolId,
              agentLedgerAccountId: walletInTx.ledgerAccountId,
              fundingRequestId: approvalContext.requestId,
              approvalId: approvalContext.approvalId,
              approvalFingerprint: approvalContext.approvalFingerprint,
              makerPrincipalId: approvalContext.makerPrincipalId,
              makerRole: 'AGENT_NETWORK_MANAGER',
              checkerPrincipalId: principal.principalId,
              checkerRole: 'FINANCE_CONTROLLER',
            },
          });

          const executedAt = new Date();
          const updatedRequests = databaseRows<{ id: string }>(await manager.query(
            `UPDATE agent_funding_requests
             SET status='EXECUTED', checker_principal_id=$2, checker_role='FINANCE_CONTROLLER',
                 checker_type=$3, journal_id=$4, approved_at=$5, executed_at=$6,
                 updated_at=$6, version=version+1
             WHERE id=$1 AND status='PENDING' RETURNING id`,
            [
              approvalContext.requestId,
              principal.principalId,
              principal.type,
              journalId,
              consumed.approval?.approvedAt ?? executedAt,
              executedAt,
            ],
          ));
          if (!updatedRequests[0]) {
            throw new ConflictException('Agent funding request was already consumed');
          }
          await this.auditService.record(manager, {
            entityType: 'AGENT_FUNDING_REQUEST',
            entityId: approvalContext.requestId,
            action: 'AGENT_FUNDING_EXECUTED',
            actor: principal.principalId,
            correlationId: correlationId ?? undefined,
            newValues: {
              approvalId: approvalContext.approvalId,
              approvalFingerprint: approvalContext.approvalFingerprint,
              makerPrincipalId: approvalContext.makerPrincipalId,
              makerRole: 'AGENT_NETWORK_MANAGER',
              checkerPrincipalId: principal.principalId,
              checkerRole: 'FINANCE_CONTROLLER',
              journalId,
              executedAt,
            },
          });

          return result;
        });
      } catch (error) {
        if (isRetryableTransactionError(error) || this.isWalletCreationRace(error)) {
          if (attempt < MAX_SERIALIZABLE_ATTEMPTS - 1) continue;
          if (isRetryableTransactionError(error)) {
            throw this.transactionContentionExhaustedException();
          }
        }
        throw error;
      }
    }
    throw this.transactionContentionExhaustedException();
  }

  private isWalletCreationRace(error: unknown): boolean {
    const candidate = error as {
      code?: string;
      constraint?: string;
      driverError?: { code?: string; constraint?: string };
    };
    const code = candidate?.driverError?.code ?? candidate?.code;
    const constraint = candidate?.driverError?.constraint ?? candidate?.constraint;
    return (
      code === '23505' &&
      (constraint === 'uq_wallet_accounts_customer_currency' ||
        constraint === 'uq_wallet_accounts_creation_idempotency_key')
    );
  }

  // V1-INFRA-03: mirrors the established house convention in
  // AgentCashToCashService.transactionContentionExhaustedException() — a stable, documented
  // machine code (`TRANSACTION_CONTENTION_RETRY_EXHAUSTED`) set as both `error` and `code` in
  // the response body, plus `.code` directly on the exception instance.
  private transactionContentionExhaustedException(): ConflictException {
    const code = 'TRANSACTION_CONTENTION_RETRY_EXHAUSTED';
    const message = 'Funding execution could not complete after concurrent retries';
    const exception = new ConflictException({ message, error: code, code });
    (exception as unknown as { code?: string }).code = code;
    return exception;
  }

  /**
   * V1-COMMERCIAL-DECISION-03E — AGENT_FUNDING / AGENT_DEFUNDING commercial snapshot capture.
   *
   * Runs inside the existing SERIALIZABLE funding transaction via
   * `recordDecisionWithManager` (never `recordDecision`, which opens its own transaction).
   * Read-only fee resolution via `FeeRuleResolverService.resolveWithManager` participates in the
   * same transaction; its result is EVIDENCE ONLY — no fee is calculated or charged and the
   * ledger is untouched by this method. Mirrors the proven pilot semantics:
   *  - fee decision stays NOT_CONFIGURED while V1 is fee-free (never ZERO); resolved rule
   *    evidence (ruleId/ruleVersion/effective parameters) is captured in fee_decision.ruleRefs
   *  - commission: engine-evaluated via the CommissionEngine (V1-COMMERCIAL-IMPLEMENTATION-02);
   *    recorded ALLOCATED with evidence-only accounting-boundary annotations when a configured
   *    rule applies, otherwise the identical byte-shape NONE as the pre-wiring snapshot; reward
   *    NONE, revenue null, configurationVersion null — nothing invented
   *  - limit evidence comes from the authoritative EnforceResult of THIS execution
   *    (AGENT_FUNDING = AGENT INCOMING; AGENT_DEFUNDING = AGENT OUTGOING — never re-evaluated)
   *  - the Agent is the financial principal for both directions; the pool/wallet accounting
   *    and single-journal structure are preserved exactly
   */
  private async recordCommercialDecisionSnapshot(
    manager: EntityManager,
    ctx: {
      direction: 'FUND' | 'DEFUND';
      agentId: string;
      aggregatorId: string | null;
      amountMinor: string;
      currency: string;
      journalId: string;
      idempotencyKey: string;
      correlationId: string | null;
      limitOutcome: EnforceResult | null;
    },
  ): Promise<void> {
    if (!this.feeRuleResolverService || !this.commercialDecisionSnapshotService) return;
    if (!UUID_PATTERN.test(ctx.agentId)) return;

    const isFund = ctx.direction === 'FUND';
    const productCode = isFund ? 'AGENT_FUNDING' : 'AGENT_DEFUNDING';
    const decisionAt = new Date();

    const resolution = await this.feeRuleResolverService.resolveWithManager(manager, {
      productCode,
      currency: ctx.currency,
      at: decisionAt,
    });

    // V1-COMMERCIAL-IMPLEMENTATION-01 — authoritative fee computation (single calculator authority);
    // legacy inline evidence retained only for calculator-absent (manual-construction) wiring.
    let feeDecision: Record<string, unknown>;
    if (this.feeRuleCalculatorService) {
      feeDecision = {
        ...this.feeRuleCalculatorService.compute({
          resolution,
          principalAmountMinor: ctx.amountMinor,
          currency: ctx.currency,
        }),
      // flow evidence (allowed by the snapshot's jsonb contract): acting Agent + funding source
      agentId: ctx.agentId,
      aggregatorId: ctx.aggregatorId,
      };
    } else {
      feeDecision = {
        ...feeNotConfigured(ctx.currency, ctx.amountMinor),
        // flow evidence (allowed by the snapshot's jsonb contract): acting Agent + funding source
        agentId: ctx.agentId,
        aggregatorId: ctx.aggregatorId,
      };
      if (resolution.status === 'RESOLVED' && resolution.rule) {
        feeDecision.ruleRefs = [
          {
            ruleId: resolution.rule.ruleId,
            ruleVersion: resolution.rule.ruleVersion,
            flatFeeMinor: resolution.rule.flatFeeMinor,
            percentageBps: resolution.rule.percentageBps,
            minimumFeeMinor: resolution.rule.minimumFeeMinor,
            maximumFeeMinor: resolution.rule.maximumFeeMinor,
            vatBps: resolution.rule.vatBps,
            effectiveFrom: resolution.rule.effectiveFrom.toISOString(),
            effectiveTo: resolution.rule.effectiveTo === null ? null : resolution.rule.effectiveTo.toISOString(),
            priority: resolution.rule.priority,
          },
        ];
      } else if (resolution.status === 'AMBIGUOUS') {
        feeDecision.resolutionStatus = 'AMBIGUOUS';
        feeDecision.ambiguousRuleIds = resolution.ambiguousRuleIds ?? [];
      }
    }

    // V1-COMMERCIAL-IMPLEMENTATION-02 — authoritative commission decision from the single engine
    // authority, evaluated IN this same SERIALIZABLE transaction. The funded/defunded Agent is the
    // SUBJECT of this float movement (their own wallet is being credited/debited) — they are NOT a
    // commission beneficiary of it: no commission-earning participant exists, so no agentId/
    // agentClassId context is supplied to the engine even though this service knows the agent, and
    // aggregatorId is never supplied (aggregator commission disabled; individual agent overrides
    // disabled). An engine-evaluated NONE is recorded. Empty registry → identical byte-shape NONE.
    // Fail-closed: ambiguity/base-unavailable aborts BEFORE money commits.
    let commissionDecision: Record<string, unknown> = commissionNone();
    if (this.commissionEngine) {
      const engineDecision = await this.commissionEngine.decideWithManager(
        manager,
        {
          productCode,
          currency: ctx.currency,
          agentId: null,
          agentClassId: null,
          aggregatorId: null,
          at: decisionAt,
        },
        {
          principalMinor: ctx.amountMinor,
          feeMinor: commissionFeeBasisMinor(feeDecision),
        },
      );
      if (engineDecision.status === 'ALLOCATED') {
        commissionDecision = {
          ...commissionAllocatedAtAccountingBoundary(engineDecision, {
            feeCollectionState: commissionFeeCollectionStateOf(feeDecision),
            commissionEvent: 'TRANSACTION_COMPLETION',
          }),
        };
      }
    }

    const limitDecision = ctx.limitOutcome
      ? limitApproved({
          profileCode: ctx.limitOutcome.limitProfileCode ?? null,
          assignmentId: ctx.limitOutcome.assignmentId ?? null,
          ruleRefs: (ctx.limitOutcome.ruleRefs ?? []).map((r) => ({
            ruleId: r.ruleId,
            dimension: r.dimension,
            limitValueMinor: r.limitValueMinor,
            limitValueCount: r.limitValueCount,
          })),
          reservationIds: ctx.limitOutcome.reservationIds ?? [],
          usageIds: ctx.limitOutcome.usageIds ?? [],
        })
      : limitNotEvaluated();

    await this.commercialDecisionSnapshotService.recordDecisionWithManager(manager, {
      idempotencyKey: `${isFund ? 'agent-funding' : 'agent-defunding'}:${ctx.agentId}:${ctx.idempotencyKey}`,
      product: productCode,
      direction: isFund ? 'INCOMING' : 'OUTGOING',
      channel: null,
      principalType: 'AGENT',
      principalId: ctx.agentId,
      currency: ctx.currency,
      principalAmountMinor: ctx.amountMinor,
      transactionReference: ctx.journalId,
      correlationId: ctx.correlationId,
      journalId: ctx.journalId,
      decisionStatus: 'FINAL',
      decidedAt: decisionAt,
      finalizedAt: decisionAt,
      feeDecision: feeDecision as never,
      commissionDecision: commissionDecision as never,
      rewardDecision: rewardNone(),
      limitDecision,
      revenueDecision: null,
      configurationVersion: null,
      createdBy: isFund ? 'agent-funding' : 'agent-defunding',
    });
  }

  private normalizeFundingPayload(
    input: FundingInput,
    direction: 'FUND' | 'DEFUND',
  ): NormalizedFundingPayload {
    const principal = input.principal;
    if (!principal || !principal.type) throw new UnauthorizedException('principal is required');
    if (principal.type === 'CUSTOMER') throw new ForbiddenException('Customer principal cannot fund Agents');
    if (principal.type === 'AGENT') throw new ForbiddenException('Agent principal cannot fund Agents');
    if (principal.type === 'AGGREGATOR') {
      throw new ForbiddenException('Decision 7 requires AGENT_NETWORK_MANAGER maker authorization');
    }

    const agentId = input.agentId?.trim();
    if (!agentId || !UUID_PATTERN.test(agentId)) throw new BadRequestException('agentId must be a UUID');
    const aggregatorId = input.aggregatorId?.trim() || null;
    if (aggregatorId && !UUID_PATTERN.test(aggregatorId)) {
      throw new BadRequestException('aggregatorId must be a UUID');
    }
    const currency = normalizeCurrency(input.currency ?? 'NGN');
    if (currency !== 'NGN') throw new BadRequestException('currency must be NGN');
    const amountMinor = parsePositiveMinorUnits(input.amountMinor, 'amountMinor').toString();
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new BadRequestException('idempotencyKey is required and must be at most 255 characters');
    }
    const reference = input.reference?.trim() || `${direction}-${idempotencyKey}`;
    if (reference.length > 255) throw new BadRequestException('reference too long');
    const correlationId = input.correlationId?.trim() || null;
    const description = input.description?.trim() ||
      `${direction} ${amountMinor} NGN for Agent ${agentId}${aggregatorId ? ` via Aggregator ${aggregatorId}` : ' via platform'}`;
    if (description.length > 255) throw new BadRequestException('description too long');

    let metadata: Record<string, unknown> = {};
    if (input.metadata !== undefined) {
      if (!input.metadata || typeof input.metadata !== 'object' || Array.isArray(input.metadata)) {
        throw new BadRequestException('metadata must be a JSON object');
      }
      try {
        metadata = JSON.parse(JSON.stringify(input.metadata)) as Record<string, unknown>;
      } catch {
        throw new BadRequestException('metadata must be JSON serializable');
      }
    }

    return {
      agentId,
      aggregatorId,
      amountMinor,
      currency,
      idempotencyKey,
      reference,
      correlationId,
      description,
      metadata,
      isAggregatorFunding: aggregatorId !== null,
    };
  }

  private assertMakerPrincipal(principal: AuthorizationPrincipal, direction: 'FUND' | 'DEFUND'): void {
    if (!principal?.principalId) throw new UnauthorizedException('Workforce principal is required');
    const functionCode = AGENT_FUNDING_ACTIONS[direction].initiatingFunctionCodes[0]!;
    if (
      !['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type) ||
      principal.roles.includes('SUPER_ADMIN') ||
      !principal.roles.includes('AGENT_NETWORK_MANAGER') ||
      !principal.scopes.includes(functionCode) ||
      principal.assuranceLevel !== 'MFA'
    ) {
      throw new ForbiddenException(
        `Decision 7 requires AGENT_NETWORK_MANAGER with ${functionCode} to initiate agent funding`,
      );
    }
  }

  private assertCheckerPrincipal(
    principal: AuthorizationPrincipal,
    direction?: 'FUND' | 'DEFUND',
  ): void {
    if (!principal?.principalId) throw new UnauthorizedException('Workforce principal is required');
    const functionCodes = direction
      ? [AGENT_FUNDING_ACTIONS[direction].approvingFunctionCodes[0]!]
      : ['agent.fund', 'agent.defund'];
    if (
      !['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type) ||
      principal.roles.includes('SUPER_ADMIN') ||
      !principal.roles.includes('FINANCE_CONTROLLER') ||
      functionCodes.some((functionCode) => !principal.scopes.includes(functionCode)) ||
      principal.assuranceLevel !== 'MFA'
    ) {
      throw new ForbiddenException(
        `Decision 7 requires a non-SUPER_ADMIN FINANCE_CONTROLLER with ${functionCodes.join(' and ')} to approve or execute agent funding`,
      );
    }
  }

  private async validateFundingTarget(
    payload: NormalizedFundingPayload,
    direction: 'FUND' | 'DEFUND',
  ): Promise<{ poolId: string }> {
    if (payload.aggregatorId) {
      const aggregators = databaseRows<{ id: string; status: AggregatorStatus; deleted_at: string | null }>(
        await this.dataSource.query(
          `SELECT id, status, deleted_at FROM aggregators WHERE id=$1 LIMIT 1`,
          [payload.aggregatorId],
        ));
      const aggregator = aggregators[0];
      if (!aggregator || aggregator.deleted_at !== null) {
        throw new NotFoundException(`Aggregator ${payload.aggregatorId} not found`);
      }
      if (aggregator.status !== AggregatorStatus.ACTIVE) {
        throw new ForbiddenException(`Aggregator ${payload.aggregatorId} is ${aggregator.status}`);
      }
      const relationship = databaseRows<{ id: string }>(await this.dataSource.query(
        `SELECT id FROM aggregator_agent_assignments
         WHERE aggregator_id=$1 AND agent_id=$2 AND status='ACTIVE' LIMIT 1`,
        [payload.aggregatorId, payload.agentId],
      ));
      if (!relationship.length) {
        throw new ForbiddenException(
          `No ACTIVE Aggregator-Agent relationship for ${payload.aggregatorId} → ${payload.agentId}`,
        );
      }
    }

    const agents = databaseRows<{ id: string; status: AgentStatus; deleted_at: string | null }>(
      await this.dataSource.query(
        `SELECT id, status, deleted_at FROM agents WHERE id=$1 LIMIT 1`,
        [payload.agentId],
      ));
    const agent = agents[0];
    if (!agent || agent.deleted_at !== null) throw new NotFoundException(`Agent ${payload.agentId} not found`);
    if (agent.status !== AgentStatus.ACTIVE) {
      throw new ForbiddenException(`Agent ${payload.agentId} is ${agent.status} and cannot be funded`);
    }
    const expectedService = direction === 'FUND' ? AgentService.AGENT_FUNDING : AgentService.AGENT_DEFUNDING;
    const capability = await this.capabilityService.evaluate(payload.agentId, expectedService);
    if (!capability.allowed) {
      throw new ForbiddenException(`Agent does not have ${expectedService} capability: ${capability.reason}`);
    }
    const pools = databaseRows<{ id: string }>(await this.dataSource.query(
      `SELECT id FROM ledger_accounts WHERE code=$1 LIMIT 1`,
      [FUNDING_POOL_CODE],
    ));
    if (!pools[0]) throw new NotFoundException('Funding pool ledger account not found — migration missing');
    return { poolId: pools[0].id };
  }

  private payloadFromFundingRequest(row: AgentFundingRequestDbRow): NormalizedFundingPayload {
    const metadata = typeof row.metadata === 'string'
      ? JSON.parse(row.metadata) as Record<string, unknown>
      : row.metadata;
    return {
      agentId: row.agent_id,
      aggregatorId: row.aggregator_id,
      amountMinor: String(row.amount_minor),
      currency: row.currency,
      idempotencyKey: row.idempotency_key,
      reference: row.reference,
      correlationId: row.correlation_id,
      description: row.description,
      metadata: metadata ?? {},
      isAggregatorFunding: row.is_aggregator_funding,
    };
  }

  private toFundingRequestView(row: AgentFundingRequestDbRow): AgentFundingRequestView {
    const payload = this.payloadFromFundingRequest(row);
    const expiresAt = row.approval_expires_at ?? row.created_at;
    const approvalStatus =
      ['REQUESTED', 'APPROVED'].includes(row.approval_status ?? '') && expiresAt <= new Date()
        ? 'EXPIRED'
        : (row.approval_status ?? 'REQUESTED');
    return {
      id: row.id,
      direction: row.direction,
      ...payload,
      requestHash: row.request_hash,
      approvalFingerprint: row.approval_fingerprint,
      approvalId: row.approval_id,
      status: row.status,
      approvalStatus,
      approvalExpiresAt: expiresAt,
      approvalApprovedBy: row.approval_approved_by ?? null,
      reason: row.approval_reason ?? '',
      actionType: row.approval_action_type ?? AGENT_FUNDING_ACTIONS[row.direction].action,
      resourceType: row.approval_resource_type ?? AGENT_FUNDING_ACTIONS[row.direction].resourceType,
      resourceId: row.approval_resource_id ?? row.id,
      requesterPrincipalId: row.approval_requester_principal_id ?? row.maker_principal_id,
      policy: row.approval_policy ?? {},
      makerPrincipalId: row.maker_principal_id,
      makerRole: row.maker_role,
      makerType: row.maker_type,
      checkerPrincipalId: row.checker_principal_id,
      checkerRole: row.checker_role,
      checkerType: row.checker_type,
      journalId: row.journal_id,
      rejectionReason: row.rejection_reason,
      createdAt: row.created_at,
      approvedAt: row.approved_at,
      rejectedAt: row.rejected_at,
      executedAt: row.executed_at,
    };
  }

  private computeRequestHash(value: unknown): string {
    return createHash('sha256').update(this.canonicalJson(value)).digest('hex');
  }

  private canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((v) => this.canonicalJson(v)).join(',')}]`;
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${this.canonicalJson(obj[k])}`)
      .join(',')}}`;
  }
}
