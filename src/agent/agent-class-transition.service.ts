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
import { AgentService, normalizeAgentService } from './agent-service.enum';

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
  /** Deterministic, backend-computed default. No `agent_classes.is_default` column exists. */
  approvedDefault: AgentClassView | null;
  approvedDefaultBasis: string;
  /** Every service denied for the Agent's CURRENT class, in the shared evaluation order. */
  deniedServices: AgentServiceDenial[];
  allowedServices: AgentService[];
  blockedBy: string | null;
  canOperate: boolean;
  evaluatedAt: string;
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
    const defaultClass = await this.computeApprovedDefault();
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
      approvedDefaultBasis: defaultClass
        ? APPROVED_DEFAULT_BASIS
        : 'No active Agent class exists to act as a default. Create or reactivate a class before assigning one.',
      deniedServices,
      allowedServices,
      blockedBy,
      canOperate: deniedServices.length === 0,
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
   * Deterministic "approved default" class.
   *
   * There is no `is_default` column, so inventing one here (or a settings row) would be a second
   * source of truth. Instead the default is the SAME row the admin catalogue lists first among
   * active classes (`createdAt ASC`, i.e. the original onboarding class), and the basis string says
   * so. Callers may always override it with an explicit choice.
   */
  private async computeApprovedDefault(): Promise<AgentClass | null> {
    const rows = await this.classRepository.find({
      where: { isActive: true },
      order: { createdAt: 'ASC' },
    });
    return rows.find((row) => row.deletedAt === null) ?? null;
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

export const APPROVED_DEFAULT_BASIS =
  'Computed default: the earliest-created ACTIVE Agent class (there is no stored default flag). Override it with an explicit selection before assigning an Agent.';
