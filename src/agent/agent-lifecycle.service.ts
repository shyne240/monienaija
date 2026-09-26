import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { Agent } from './agent.entity';
import { AgentStatus } from './agent.enums';
import { AgentApplication } from './agent-application.entity';
import { AgentApplicationStatus } from './agent-application.enums';
import { AgentReceivingNumberService } from './agent-receiving-number.service';

const ALLOWED_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  [AgentStatus.PENDING]: [AgentStatus.ACTIVE, AgentStatus.TERMINATED],
  [AgentStatus.ACTIVE]: [AgentStatus.SUSPENDED, AgentStatus.TERMINATED],
  [AgentStatus.SUSPENDED]: [AgentStatus.ACTIVE, AgentStatus.TERMINATED],
  [AgentStatus.TERMINATED]: [],
};

@Injectable()
export class AgentLifecycleService {
  constructor(
    @InjectRepository(Agent)
    private readonly agentRepository: Repository<Agent>,
    @InjectRepository(AgentApplication)
    private readonly applicationRepository: Repository<AgentApplication>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    // Optional via @Inject to avoid circular if service not yet ready; but we will provide it
    private readonly receivingNumberService: AgentReceivingNumberService,
  ) {}

  async getAgent(id: string): Promise<Agent> {
    this.assertUuid(id, 'id');
    const agent = await this.agentRepository.findOne({ where: { id } });
    if (!agent || agent.deletedAt !== null) throw new NotFoundException(`Agent ${id} not found`);
    return agent;
  }

  async activate(agentId: string, actor: string): Promise<Agent> {
    return this.transition(agentId, AgentStatus.ACTIVE, actor, 'ACTIVATED');
  }

  async suspend(agentId: string, actor: string, reason?: string): Promise<Agent> {
    return this.transition(agentId, AgentStatus.SUSPENDED, actor, 'SUSPENDED', reason);
  }

  async reactivate(agentId: string, actor: string): Promise<Agent> {
    return this.transition(agentId, AgentStatus.ACTIVE, actor, 'REACTIVATED');
  }

  async terminate(agentId: string, actor: string, reason?: string): Promise<Agent> {
    return this.transition(agentId, AgentStatus.TERMINATED, actor, 'TERMINATED', reason);
  }

  /**
   * Activates the canonical Agent for an approved application.
   * - If application has no agentId, creates a PENDING Agent (J)
   * - Then transitions PENDING → ACTIVE (K)
   * - Ensures exactly one canonical Agent (H,I) and no duplicate
   * - No financial side-effects (no wallet/ledger creation)
   */
  async activateFromApplication(applicationId: string, actor: string): Promise<Agent> {
    this.assertUuid(applicationId, 'applicationId');
    const normalizedActor = this.normalizeActor(actor);
    return this.dataSource.transaction(async (manager) => {
      const appRepo = manager.getRepository(AgentApplication);
      const agentRepo = manager.getRepository(Agent);
      const app = await appRepo.findOne({ where: { id: applicationId } });
      if (!app || app.deletedAt !== null) throw new NotFoundException(`AgentApplication ${applicationId} not found`);
      if (app.status !== AgentApplicationStatus.APPROVED) {
        throw new ConflictException('Only APPROVED applications can be activated');
      }
      let agent: Agent | null = null;
      if (app.agentId) {
        agent = await agentRepo.findOne({ where: { id: app.agentId } });
        if (!agent || agent.deletedAt !== null) throw new NotFoundException(`Agent ${app.agentId} not found`);
      } else {
        // Check for existing Agent with same reference to avoid duplicate (H)
        const existing = await agentRepo.findOne({ where: { reference: app.applicantReference } });
        if (existing && existing.deletedAt === null) {
          agent = existing;
          app.agentId = agent.id;
          await appRepo.save(app);
        } else {
          agent = await agentRepo.save(
            agentRepo.create({
              id: randomUUID(),
              reference: app.applicantReference,
              status: AgentStatus.PENDING,
              agentClassId: app.agentClassId,
              originApplicationId: app.id,
              version: 1,
            }),
          );
          app.agentId = agent.id;
          await appRepo.save(app);
          await this.audit(manager, 'AGENT', agent.id, 'CREATED_PENDING', normalizedActor, undefined, this.agentValues(agent));
        }
      }
      // Now transition to ACTIVE if PENDING
      if (agent.status === AgentStatus.PENDING) {
        const previous = this.agentValues(agent);
        agent.status = AgentStatus.ACTIVE;
        const saved = await agentRepo.save(agent);
        // A9: allocate canonical receiving number within same transaction (identity/ routing only, no wallet/ledger)
        await this.receivingNumberService.ensureForAgentInManager(manager, saved.id, normalizedActor);
        await this.audit(manager, 'AGENT', saved.id, 'ACTIVATED', normalizedActor, previous, this.agentValues(saved));
        // Also audit application activation
        await this.audit(manager, 'AGENT_APPLICATION', app.id, 'AGENT_ACTIVATED', normalizedActor, { status: app.status }, { agentId: saved.id, agentStatus: saved.status });
        return saved;
      }
      if (agent.status === AgentStatus.ACTIVE) {
        // Idempotent: ensure receiving number exists (in case earlier allocation failed)
        await this.receivingNumberService.ensureForAgentInManager(manager, agent.id, normalizedActor);
        return agent; // already active, idempotent
      }
      throw new ConflictException(`Agent cannot be activated from status ${agent.status}`);
    });
  }

  private async transition(
    agentId: string,
    target: AgentStatus,
    actor: string,
    action: string,
    reason?: string,
  ): Promise<Agent> {
    this.assertUuid(agentId, 'agentId');
    const normalizedActor = this.normalizeActor(actor);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Agent);
      const agent = await repo.findOne({ where: { id: agentId } });
      if (!agent || agent.deletedAt !== null) throw new NotFoundException(`Agent ${agentId} not found`);
      const allowed = ALLOWED_TRANSITIONS[agent.status as AgentStatus] ?? [];
      if (!allowed.includes(target)) {
        throw new ConflictException(`Transition ${agent.status} → ${target} is not allowed`);
      }
      // Fail-closed: TERMINATED → ACTIVE is never allowed (O)
      if (agent.status === AgentStatus.TERMINATED && target === AgentStatus.ACTIVE) {
        throw new ConflictException('TERMINATED Agents cannot be reactivated');
      }
      // No financial disposition on SUSPENDED/TERMINATED — leave balance untouched (F-5)
      // Documented: residual float treatment is unresolved and must not be moved.
      const previous = this.agentValues(agent);
      agent.status = target;
      // Reason is audit-only, not stored on Agent (no column) but captured in audit
      const saved = await repo.save(agent);
      // A9 lifecycle hooks: ACTIVE allocation, SUSPENDED retains, TERMINATED revokes
      if (target === AgentStatus.ACTIVE) {
        await this.receivingNumberService.ensureForAgentInManager(manager, saved.id, normalizedActor);
      } else if (target === AgentStatus.TERMINATED) {
        await this.receivingNumberService.revokeForTerminated(manager, saved.id, normalizedActor);
      } // SUSPENDED retains identity — no change
      await this.audit(manager, 'AGENT', saved.id, action, normalizedActor, previous, {
        ...this.agentValues(saved),
        ...(reason ? { reason } : {}),
      });
      return saved;
    });
  }

  private agentValues(agent: Agent): Record<string, unknown> {
    return {
      reference: agent.reference,
      status: agent.status,
      agentClassId: agent.agentClassId,
      originApplicationId: agent.originApplicationId,
      version: agent.version,
    };
  }

  private async audit(
    manager: import('typeorm').EntityManager,
    entityType: string,
    entityId: string,
    action: string,
    actor: string,
    previous: Record<string, unknown> | undefined,
    next: Record<string, unknown> | undefined,
  ): Promise<void> {
    await this.auditService.record(manager, {
      entityType,
      entityId,
      action,
      actor,
      previousValues: previous,
      newValues: next,
    });
  }

  private normalizeActor(actor: string): string {
    const v = actor?.trim();
    if (!v || v.length < 1 || v.length > 160) throw new BadRequestException('actor must be 1-160 chars');
    return v;
  }

  private assertUuid(value: string, field: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
  }
}

function randomUUID(): string {
  // local helper to avoid import collision
  return require('node:crypto').randomUUID();
}
