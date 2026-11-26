import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { Agent } from './agent.entity';
import { AgentClass } from './agent-class.entity';
import { AgentStatus } from './agent.enums';
import { AgentServiceCapabilityService } from './agent-service-capability.service';
import type { AgentServiceCapabilityEvaluation } from './agent-service-capability.types';
import {
  AgentService,
  PRODUCT_CODES_BY_SERVICE,
  normalizeAgentService,
} from './agent-service.enum';

/** Audit vocabulary this service owns. Rows are the ONLY history store (no new table). */
export const AGENT_CLASS_AUDIT_ENTITY = 'AGENT';
export const AGENT_CLASS_SWITCHED = 'CLASS_SWITCHED';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ordered deny ordering shared with `AgentServiceCapabilityService` — the highest-priority denial. */
const PRIMARY_DENIAL: ReadonlyArray<AgentServiceCapabilityEvaluation['reason']> = [
  'AGENT_NOT_FOUND',
  'AGENT_DELETED',
  'AGENT_PENDING',
  'AGENT_SUSPENDED',
  'AGENT_TERMINATED',
  'AGENT_NOT_ACTIVE',
  'MISSING_AGENT_CLASS',
  'AGENT_CLASS_NOT_FOUND',
  'AGENT_CLASS_DELETED',
  'AGENT_CLASS_INACTIVE',
];

export interface AgentClassSwitchCommand {
  agentId: string;
  targetClassId: string;
  reason: string;
  actor: string;
  expectedVersion?: number;
}

export interface AgentClassReadiness {
  agentId: string;
  agentStatus: string;
  agentVersion: number;
  /** Class currently persisted on `agents.agent_class_id`, resolved (or explicitly unresolved). */
  currentClass: AgentClassView | null;
  currentClassId: string | null;
  /**
   * The class an operator may be offered as a DEFAULT, or `null`.
   *
   * `null` is the honest answer in the current schema: no `agent_classes.is_default` column, no
   * agent-class default policy table and no configuration record exists that appoints one class as
   * the default. A class is therefore reported here ONLY if such a record is ever introduced and
   * resolves; the oldest-active row is an ordering accident, not an approval.
   */
  approvedDefault: AgentClassView | null;
  /** Why `approvedDefault` is null (or, if ever populated, which record appoints it). */
  approvedDefaultBasis: string;
  /** Always true today. The UI must require an explicit operator selection. */
  explicitSelectionRequired: boolean;
  /** Every service denied for the Agent's CURRENT class, in the shared evaluation order. */
  deniedServices: AgentServiceDenial[];
  allowedServices: AgentService[];
  blockedBy: string | null;
  canOperate: boolean;
  /**
   * Configuration a caller still has to supply before this Agent can actually transact, one entry
   * per gap. Empty means nothing is known to be missing.
   *
   * This is what staff see when required configuration is absent: an explicit, itemised list that
   * names the gap and the surface that owns it. It is deliberately NOT folded into `canOperate`
   * (which answers only "is every service permitted for this class?") and never silently treated as
   * "unlimited" or "no fee".
   */
  missingConfiguration: AgentClassMissingConfiguration[];
  evaluatedAt: string;
}

export interface AgentClassMissingConfiguration {
  /** Stable code so the UI can group and test without parsing prose. */
  code:
    | 'NO_APPLICABLE_SERVICES'
    | 'CLASS_INACTIVE'
    | 'NO_EFFECTIVE_LIMITS'
    | 'NO_EFFECTIVE_FEE'
    | 'NO_EFFECTIVE_COMMISSION';
  /** Which console owns the gap, so an operator is not sent to the wrong screen. */
  surface: 'AGENT_CLASSES' | 'LIMITS' | 'FEES' | 'COMMISSIONS';
  detail: string;
}

export interface AgentClassImpactPreview {
  agentId: string;
  currentClass: AgentClassView | null;
  targetClass: AgentClassView;
  /** Services the target class would GRANT that the current class denies. */
  gains: AgentServiceImpact[];
  /** Services the target class would REMOVE that the current class allows. */
  losses: AgentServiceImpact[];
  unchanged: AgentService[];
  /** Non-blocking warnings an operator must acknowledge before switching. */
  warnings: string[];
  blockingReasons: string[];
  canSwitch: boolean;
  writesPerformed: string[];
  financialMutations: string[];
  readonly: true;
  evaluatedAt: string;
}

export interface AgentClassHistoryEntry {
  action: string;
  actor: string;
  occurredAt: string;
  previousClassId: string | null;
  newClassId: string | null;
  previousClass: AgentClassView | null;
  newClass: AgentClassView | null;
  reason: string | null;
  source: string | null;
}

export interface AgentClassView {
  id: string;
  reference: string;
  code: string;
  name: string;
  isActive: boolean;
  applicableServices: string[];
}

interface AgentServiceDenial {
  service: string;
  reason: string;
}

interface AgentServiceImpact {
  service: string;
  currentReason: string;
  targetReason: string;
}

/**
 * V1-AGENT-CLASS-LIFECYCLE-01 — governed Agent class lifecycle.
 *
 * WHY THIS EXISTS
 *   `POST /internal/agents/:id/class` was presented to operators as "Policy blocked" while the class
 *   catalogue itself was fully writable. That left an Agent stranded on its onboarding class: the
 *   only way to move a live Agent was to edit `agent_classes.applicable_services` in place, which
 *   silently re-scopes EVERY Agent in that class and leaves no per-Agent audit trail.
 *
 * DESIGN CONSTRAINTS (deliberate)
 *  - No new tables and no new migration. The switch persists to `agents.agent_class_id` (with the
 *    existing optimistic `version`) and appends to `audit_events`; `history()` is a projection of
 *    those audit rows, so the persisted trail cannot drift from the persisted assignment.
 *  - Readiness/impact answers are computed by `AgentServiceCapabilityService` — the SAME gate that
 *    authorizes live financial commands. There is no second, preview-only rule engine, so a
 *    preview cannot promise a capability that enforcement would deny.
 *  - Projections never write audit rows (a what-if is not an authorization attempt) and never
 *    mutate a wallet, ledger, journal or limit reservation.
 *  - "Approved default class" is COMPUTED, never stored: there is no `agent_classes.is_default`
 *    column. The basis is reported verbatim so the UI can label it honestly, and an operator may
 *    always override it explicitly.
 */
@Injectable()
export class AgentClassTransitionService {
  constructor(
    @InjectRepository(Agent)
    private readonly agentRepository: Repository<Agent>,
    @InjectRepository(AgentClass)
    private readonly classRepository: Repository<AgentClass>,
    private readonly dataSource: DataSource,
    private readonly capabilityService: AgentServiceCapabilityService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Read-only readiness projection for one Agent.
   *
   * The whole point is to answer "can this Agent operate at all right now, and if not, exactly which
   * service is blocked and why" without the operator firing a financial command to find out.
   */
  async readiness(agentId: string): Promise<AgentClassReadiness> {
    this.assertUuid(agentId, 'agentId');
    const agent = await this.loadAgent(agentId);
    const currentClass = agent.agentClassId
      ? await this.classRepository.findOne({ where: { id: agent.agentClassId } })
      : null;
    const deniedServices: AgentServiceDenial[] = [];
    const allowedServices: AgentService[] = [];
    for (const service of Object.values(AgentService)) {
      // Silent: a readiness probe must never manufacture an authorization attempt in the audit
      // trail (the real enforcement gate audits its own denials).
      const evaluation = await this.capabilityService.evaluatePreview(agentId, service);
      if (evaluation.allowed) allowedServices.push(service);
      else deniedServices.push({ service, reason: evaluation.reason });
    }
    const defaultClass = this.computeApprovedDefault();
    const blockedBy =
      PRIMARY_DENIAL.find((reason) => deniedServices.some((d) => d.reason === reason)) ??
      (deniedServices.length > 0 ? deniedServices[0]!.reason : null);
    return {
      agentId,
      agentStatus: agent.status,
      agentVersion: agent.version,
      currentClass: currentClass ? this.toClassView(currentClass) : null,
      currentClassId: agent.agentClassId ?? null,
      approvedDefault: defaultClass ? this.toClassView(defaultClass) : null,
      approvedDefaultBasis: defaultClass ? APPROVED_DEFAULT_BASIS : NO_APPROVED_DEFAULT_BASIS,
      explicitSelectionRequired: defaultClass === null,
      deniedServices,
      allowedServices,
      blockedBy,
      canOperate: deniedServices.length === 0,
      missingConfiguration: await this.detectMissingConfiguration(
        agent,
        currentClass,
        allowedServices,
      ),
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * READ-ONLY impact preview of moving this Agent to `targetClassId`.
   *
   * Returns the exact service deltas the switch would cause, computed against the Agent's real
   * status and both class rows. Service-catalogue vocabulary is the shared normalizer, so the delta
   * can never include a service that enforcement does not know.
   */
  async impactPreview(agentId: string, targetClassId: string): Promise<AgentClassImpactPreview> {
    this.assertUuid(agentId, 'agentId');
    this.assertUuid(targetClassId, 'targetClassId');
    const agent = await this.loadAgent(agentId);
    const targetClass = await this.classRepository.findOne({ where: { id: targetClassId } });
    if (!targetClass || targetClass.deletedAt !== null) {
      throw new NotFoundException('Target Agent class not found');
    }
    const currentClass = agent.agentClassId
      ? await this.classRepository.findOne({ where: { id: agent.agentClassId } })
      : null;

    const gains: AgentServiceImpact[] = [];
    const losses: AgentServiceImpact[] = [];
    const unchanged: AgentService[] = [];
    for (const service of Object.values(AgentService)) {
      const current = await this.capabilityService.evaluatePreview(agentId, service);
      const target = await this.capabilityService.evaluatePreview(agentId, service, targetClass);
      if (current.allowed && target.allowed) unchanged.push(service);
      else if (!current.allowed && target.allowed) {
        gains.push({ service, currentReason: current.reason, targetReason: target.reason });
      } else if (current.allowed && !target.allowed) {
        losses.push({ service, currentReason: current.reason, targetReason: target.reason });
      }
    }

    const blockingReasons: string[] = [];
    if (agent.deletedAt !== null) blockingReasons.push('AGENT_DELETED');
    if (agent.status === AgentStatus.TERMINATED) blockingReasons.push('AGENT_TERMINATED');
    if (targetClass.id === agent.agentClassId) blockingReasons.push('SAME_CLASS');
    if (!targetClass.isActive) blockingReasons.push('TARGET_CLASS_INACTIVE');
    if (targetClass.applicableServices === null || targetClass.applicableServices === undefined) {
      blockingReasons.push('TARGET_CLASS_HAS_NO_SERVICES');
    } else if (!Array.isArray(targetClass.applicableServices)) {
      blockingReasons.push('TARGET_CLASS_SERVICES_MALFORMED');
    } else if (targetClass.applicableServices.length === 0) {
      blockingReasons.push('TARGET_CLASS_HAS_NO_SERVICES');
    } else if (
      (targetClass.applicableServices as unknown[]).some(
        (entry) => normalizeAgentService(entry) === null,
      )
    ) {
      blockingReasons.push('TARGET_CLASS_SERVICES_MALFORMED');
    }

    const warnings: string[] = [];
    if (losses.length > 0) {
      warnings.push(
        `${losses.length} service${losses.length === 1 ? '' : 's'} would be withdrawn from this Agent immediately (${losses
          .map((loss) => loss.service)
          .join(
            ', ',
          )}). In-flight operations that have already passed authorization are not cancelled.`,
      );
    }
    if (gains.length > 0) {
      warnings.push(
        `${gains.length} service${gains.length === 1 ? '' : 's'} would become permitted (${gains
          .map((gain) => gain.service)
          .join(', ')}). Limits still apply and are unchanged by a class switch.`,
      );
    }
    if (agent.status !== AgentStatus.ACTIVE) {
      warnings.push(
        `The Agent is currently ${agent.status}; the switch records the assignment but does not change lifecycle status.`,
      );
    }

    return {
      agentId,
      currentClass: currentClass ? this.toClassView(currentClass) : null,
      targetClass: this.toClassView(targetClass),
      gains,
      losses,
      unchanged,
      warnings,
      blockingReasons,
      canSwitch: blockingReasons.length === 0,
      writesPerformed: [],
      financialMutations: [],
      readonly: true,
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Governed switch. Caller has already passed route policy (`agent.manage_classes`) and the
   * controller-level read-only-principal check.
   *
   * Concurrency: the Agent row is locked `FOR UPDATE` so two operators cannot interleave, and
   * `expectedVersion` (when supplied) is compared INSIDE the lock — an inspector acting on a stale
   * drawer gets a 409 instead of silently overwriting the other operator's change.
   */
  async switchClass(command: AgentClassSwitchCommand): Promise<{
    agentId: string;
    previousClassId: string | null;
    currentClassId: string;
    previousClass: AgentClassView | null;
    currentClass: AgentClassView;
    version: number;
    changed: boolean;
    impact: { gains: string[]; losses: string[] };
  }> {
    this.assertUuid(command.agentId, 'agentId');
    this.assertUuid(command.targetClassId, 'targetClassId');
    const reason = this.normalizeReason(command.reason);
    const actor = this.normalizeActor(command.actor);
    if (
      command.expectedVersion !== undefined &&
      (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1)
    ) {
      throw new BadRequestException('expectedVersion must be a positive integer');
    }

    const targetClass = await this.classRepository.findOne({
      where: { id: command.targetClassId },
    });
    if (!targetClass || targetClass.deletedAt !== null) {
      throw new NotFoundException('Target Agent class not found');
    }
    if (!targetClass.isActive) {
      throw new ConflictException('Agent class is inactive; activate it before assigning Agents');
    }
    const applicable = targetClass.applicableServices;
    if (!Array.isArray(applicable) || applicable.length === 0) {
      throw new ConflictException(
        'Agent class declares no applicable services; assign a class that grants at least one service',
      );
    }
    if ((applicable as unknown[]).some((entry) => normalizeAgentService(entry) === null)) {
      throw new ConflictException(
        'Agent class declares an unknown service; correct the class configuration before assigning Agents',
      );
    }

    // Preview BEFORE the write so the returned delta describes what the switch actually changed.
    const preview = await this.impactPreview(command.agentId, command.targetClassId);
    if (preview.blockingReasons.includes('AGENT_TERMINATED')) {
      throw new ConflictException('A terminated Agent cannot be reclassified');
    }
    if (preview.blockingReasons.includes('SAME_CLASS')) {
      // Idempotent replay: report the state without appending a misleading audit row.
      const agent = await this.loadAgent(command.agentId);
      return {
        agentId: agent.id,
        previousClassId: agent.agentClassId,
        currentClassId: targetClass.id,
        previousClass: preview.currentClass,
        currentClass: preview.targetClass,
        version: agent.version,
        changed: false,
        impact: { gains: [], losses: [] },
      };
    }

    return this.dataSource.transaction(async (manager) => {
      // Repository + pessimistic_write keeps the entity/version semantics of every other Agent
      // mutation in this codebase (`AgentLifecycleService` locks the same row the same way).
      const repo = manager.getRepository(Agent);
      const agent = await repo.findOne({
        where: { id: command.agentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!agent) throw new NotFoundException('Agent not found');
      if (agent.deletedAt !== null) throw new ConflictException('Agent has been deleted');
      if (agent.status === AgentStatus.TERMINATED) {
        throw new ConflictException('A terminated Agent cannot be reclassified');
      }
      if (command.expectedVersion !== undefined && command.expectedVersion !== agent.version) {
        throw new ConflictException(
          `Agent was modified by another operator (expected version ${command.expectedVersion}, current ${agent.version}); reload before retrying`,
        );
      }
      const previousClassId = agent.agentClassId;
      const previousClass = previousClassId
        ? await this.classRepository.findOne({ where: { id: previousClassId } })
        : null;
      const previousVersion = agent.version;
      agent.agentClassId = targetClass.id;
      const saved = await repo.save(agent);

      await this.auditService.record(manager, {
        entityType: AGENT_CLASS_AUDIT_ENTITY,
        entityId: command.agentId,
        action: AGENT_CLASS_SWITCHED,
        actor,
        previousValues: {
          agentClassId: previousClassId,
          agentClassCode: previousClass?.code ?? null,
          version: previousVersion,
        },
        newValues: {
          agentClassId: targetClass.id,
          agentClassCode: targetClass.code,
          reason,
          source: 'WORKFORCE_MANUAL',
          grantedServices: preview.gains.map((gain) => gain.service),
          withdrawnServices: preview.losses.map((loss) => loss.service),
        },
      });

      return {
        agentId: command.agentId,
        previousClassId,
        currentClassId: targetClass.id,
        previousClass: previousClass ? this.toClassView(previousClass) : null,
        currentClass: this.toClassView(targetClass),
        version: saved.version,
        changed: true,
        impact: {
          gains: preview.gains.map((gain) => gain.service),
          losses: preview.losses.map((loss) => loss.service),
        },
      };
    });
  }

  /**
   * History projected from `audit_events`.
   *
   * Deliberately reads the audit trail rather than a bespoke history table: the audit row and the
   * assignment are written in the same transaction, so this can never show a switch that did not
   * happen (or miss one that did).
   */
  async history(agentId: string, limit = 25): Promise<AgentClassHistoryEntry[]> {
    this.assertUuid(agentId, 'agentId');
    const take = Math.min(Math.max(Math.trunc(limit) || 25, 1), 100);
    const rows: Array<{
      action: string;
      actor: string;
      occurred_at: Date;
      previous_values: Record<string, unknown> | null;
      new_values: Record<string, unknown> | null;
    }> = await this.dataSource.query(
      `SELECT action, actor, occurred_at, previous_values, new_values
         FROM audit_events
        WHERE entity_type=$1 AND entity_id=$2 AND action=$3
        ORDER BY occurred_at DESC, created_at DESC
        LIMIT $4`,
      [AGENT_CLASS_AUDIT_ENTITY, agentId, AGENT_CLASS_SWITCHED, take],
    );
    const classIds = new Set<string>();
    for (const row of rows) {
      const previous = this.readString(row.previous_values, 'agentClassId');
      const next = this.readString(row.new_values, 'agentClassId');
      if (previous) classIds.add(previous);
      if (next) classIds.add(next);
    }
    const classes = classIds.size
      ? await this.classRepository.find({ where: [...classIds].map((id) => ({ id })) })
      : [];
    const byId = new Map(classes.map((entry) => [entry.id, this.toClassView(entry)]));
    return rows.map((row) => {
      const previousClassId = this.readString(row.previous_values, 'agentClassId');
      const newClassId = this.readString(row.new_values, 'agentClassId');
      return {
        action: row.action,
        actor: row.actor,
        occurredAt: new Date(row.occurred_at).toISOString(),
        previousClassId,
        newClassId,
        previousClass: previousClassId ? (byId.get(previousClassId) ?? null) : null,
        newClass: newClassId ? (byId.get(newClassId) ?? null) : null,
        reason: this.readString(row.new_values, 'reason'),
        source: this.readString(row.new_values, 'source'),
      };
    });
  }

  /**
   * The class a governance record appoints as the default, if any.
   *
   * Deliberately NOT "the oldest active class". `createdAt ASC` is an ordering accident of whoever
   * happened to create a row first, not an approval: treating it as a default pre-selects a class —
   * and therefore that class's services, fees, commissions and limits — for an operator who never
   * chose it. A default may only come from a durable record that says so.
   *
   * This schema has no such record (`agent_classes` has no `is_default`; there is no agent-class
   * default policy/configuration table). The lookup below is therefore unconditional `null`, and it
   * lives here — not in the callers — so introducing a record later is a change to THIS method plus
   * the basis string, with no caller edits and no risk of one surface quietly reinstating a guess.
   */
  private computeApprovedDefault(): AgentClass | null {
    return null;
  }

  /**
   * Configuration this Agent still needs before it can transact under `currentClass`.
   *
   * Read-only and advisory: it never blocks a switch, because a class with no limits assigned may be
   * exactly what an operator is mid-way through configuring. What it refuses to do is let silence
   * read as "fine" — an absent limit assignment is reported as absent, never as unlimited, and an
   * absent fee/commission rule is reported against the product+currency pair it applies to.
   *
   * Every query is scoped to the class (or to the class's own product codes), so the report cannot
   * accidentally describe a different class's configuration.
   */
  private async detectMissingConfiguration(
    agent: Agent,
    currentClass: AgentClass | null,
    allowedServices: AgentService[],
  ): Promise<AgentClassMissingConfiguration[]> {
    const missing: AgentClassMissingConfiguration[] = [];
    if (!currentClass) {
      missing.push({
        code: 'NO_APPLICABLE_SERVICES',
        surface: 'AGENT_CLASSES',
        detail:
          'This Agent has no Agent class, so no services are permitted and no configuration can be resolved. Assign a class.',
      });
      return missing;
    }
    if (!currentClass.isActive) {
      missing.push({
        code: 'CLASS_INACTIVE',
        surface: 'AGENT_CLASSES',
        detail: `The assigned class ${currentClass.code} is inactive. Its services remain on the record, but reactivate the class or move the Agent before relying on it.`,
      });
    }
    if (allowedServices.length === 0) {
      missing.push({
        code: 'NO_APPLICABLE_SERVICES',
        surface: 'AGENT_CLASSES',
        detail: `The assigned class ${currentClass.code} permits no services, so this Agent cannot transact at all.`,
      });
      // Nothing downstream can be meaningful without a service to resolve configuration for.
      return missing;
    }

    const activeAssignment = await this.dataSource.query<Array<{ code: string }>>(
      `SELECT a.limit_profile_code AS code
         FROM limit_assignments a
         JOIN limit_profiles p ON p.code = a.limit_profile_code
        WHERE a.subject_type='AGENT_CLASS' AND a.subject_id=$1
          AND a.is_active = TRUE AND a.deleted_at IS NULL
          AND (a.effective_from IS NULL OR a.effective_from <= now())
          AND (a.effective_to IS NULL OR a.effective_to > now())
          -- limit_profiles has no is_active column. The canonical predicate is the one
          -- LimitProfileResolverService applies: deleted_at IS NULL AND enabled AND status=ACTIVE.
          -- The previous predicate made this readiness projection throw a 500.
          AND p.enabled = TRUE AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
        ORDER BY a.precedence ASC`,
      [currentClass.id],
    );
    if (activeAssignment.length === 0) {
      missing.push({
        code: 'NO_EFFECTIVE_LIMITS',
        surface: 'LIMITS',
        detail: `No active limit profile is assigned to class ${currentClass.code}. Transactions that consult limits cannot resolve one; this is NOT the same as unlimited.`,
      });
    }

    /*
     * Fee and commission rules are keyed on the PRODUCT catatalogue, not on `AgentService` names
     * (the two vocabularies differ: `CASH_TO_WALLET` vs `CASH_IN`). Map each permitted service to
     * the product codes the engine actually uses, then report the products that resolve nothing.
     */
    const productCodes = Array.from(
      new Set(allowedServices.flatMap((service) => PRODUCT_CODES_BY_SERVICE[service] ?? [])),
    );
    if (productCodes.length > 0) {
      const feeRules = await this.dataSource.query<Array<{ product_code: string }>>(
        `SELECT DISTINCT product_code FROM fee_rules
          WHERE product_code = ANY($1)
            AND (agent_class_id IS NULL OR agent_class_id = $2)
            AND is_active = TRUE AND deleted_at IS NULL
            AND (effective_to IS NULL OR effective_to > now())`,
        [productCodes, currentClass.id],
      );
      const commissionRules = await this.dataSource.query<Array<{ product_code: string }>>(
        `SELECT DISTINCT product_code FROM commission_rules
          WHERE product_code = ANY($1)
            AND (agent_class_id IS NULL OR agent_class_id = $2)
            AND is_active = TRUE AND deleted_at IS NULL
            AND (effective_to IS NULL OR effective_to > now())`,
        [productCodes, currentClass.id],
      );
      const feeCovered = new Set(feeRules.map((row) => row.product_code));
      const commissionCovered = new Set(commissionRules.map((row) => row.product_code));
      const noFee = productCodes.filter((code) => !feeCovered.has(code));
      const noCommission = productCodes.filter((code) => !commissionCovered.has(code));
      if (noFee.length > 0) {
        missing.push({
          code: 'NO_EFFECTIVE_FEE',
          surface: 'FEES',
          detail: `No active fee rule resolves for ${noFee.join(', ')} under class ${currentClass.code}. A missing rule is not a zero fee — the charge is simply undefined.`,
        });
      }
      if (noCommission.length > 0) {
        missing.push({
          code: 'NO_EFFECTIVE_COMMISSION',
          surface: 'COMMISSIONS',
          detail: `No active commission rule resolves for ${noCommission.join(', ')} under class ${currentClass.code}. No commission would accrue for those operations.`,
        });
      }
    }

    return missing;
  }

  /**
   * The onboarding default, as a standalone answer.
   *
   * Thin wrapper over `computeApprovedDefault()` so the console asks the backend instead of keeping
   * its own copy of the rule. Two callers (readiness and the class catalogue) share one lookup, so
   * they cannot disagree about whether a default exists.
   */
  getOnboardingDefault(): {
    approvedDefault: AgentClassView | null;
    approvedDefaultBasis: string;
    explicitSelectionRequired: boolean;
  } {
    const defaultClass = this.computeApprovedDefault();
    return {
      approvedDefault: defaultClass ? this.toClassView(defaultClass) : null,
      approvedDefaultBasis: defaultClass ? APPROVED_DEFAULT_BASIS : NO_APPROVED_DEFAULT_BASIS,
      explicitSelectionRequired: defaultClass === null,
    };
  }

  private async loadAgent(agentId: string): Promise<Agent> {
    const agent = await this.agentRepository.findOne({ where: { id: agentId } });
    if (!agent) throw new NotFoundException('Agent not found');
    return agent;
  }

  private toClassView(entity: AgentClass): AgentClassView {
    const services = Array.isArray(entity.applicableServices)
      ? (entity.applicableServices as unknown[])
          .map((entry) => normalizeAgentService(entry))
          .filter((entry): entry is AgentService => entry !== null)
      : [];
    return {
      id: entity.id,
      reference: entity.reference,
      code: entity.code,
      name: entity.name,
      isActive: entity.isActive,
      applicableServices: services,
    };
  }

  private readString(payload: Record<string, unknown> | null, key: string): string | null {
    const value = payload ? payload[key] : null;
    return typeof value === 'string' && value.trim() ? value : null;
  }

  /** Same contract as `customer-class-assignment.service.ts`: trimmed, at least 3 characters. */
  private normalizeReason(reason: string | null | undefined): string {
    const value = reason?.trim() ?? '';
    if (value.length < 3) {
      throw new BadRequestException('A reason of at least 3 characters is required');
    }
    if (value.length > 500) throw new BadRequestException('reason must be at most 500 characters');
    return value;
  }

  private normalizeActor(actor: string | undefined): string {
    const value = actor?.trim() ?? '';
    if (!value) throw new ForbiddenException('Authenticated workforce actor is required');
    return value.slice(0, 160);
  }

  private assertUuid(value: string, field: string): void {
    if (typeof value !== 'string' || !UUID.test(value)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
  }
}

/** Only ever reported alongside a class that a real policy/configuration record appoints. */
export const APPROVED_DEFAULT_BASIS =
  'Appointed by the approved Agent class default configuration record.';

/**
 * The basis string for "there is no approved default". It exists so the UI can explain WHY an
 * operator has to choose instead of leaving them guessing whether something is missing.
 */
export const NO_APPROVED_DEFAULT_BASIS =
  'No approved Agent class default exists: no policy or configuration record appoints one. An operator must select the class explicitly.';
