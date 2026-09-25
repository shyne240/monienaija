import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { AuditService } from '../operations/audit.service';
import { Agent } from '../agent/agent.entity';
import { Aggregator } from './aggregator.entity';
import { AggregatorAgentAssignment } from './aggregator-agent-relationship.entity';
import { AggregatorAgentRelationshipStatus, AggregatorStatus } from './aggregator.enums';
import { AggregatorService } from './aggregator.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_RELATIONSHIP_TRANSITIONS: Record<
  AggregatorAgentRelationshipStatus,
  AggregatorAgentRelationshipStatus[]
> = {
  [AggregatorAgentRelationshipStatus.ACTIVE]: [
    AggregatorAgentRelationshipStatus.SUSPENDED,
    AggregatorAgentRelationshipStatus.TERMINATED,
  ],
  [AggregatorAgentRelationshipStatus.SUSPENDED]: [
    AggregatorAgentRelationshipStatus.ACTIVE,
    AggregatorAgentRelationshipStatus.TERMINATED,
  ],
  [AggregatorAgentRelationshipStatus.TERMINATED]: [],
};

@Injectable()
export class AggregatorAgentRelationshipService {
  constructor(
    @InjectRepository(AggregatorAgentAssignment)
    private readonly assignmentRepository: Repository<AggregatorAgentAssignment>,
    @InjectRepository(Aggregator)
    private readonly aggregatorRepository: Repository<Aggregator>,
    @InjectRepository(Agent)
    private readonly agentRepository: Repository<Agent>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly aggregatorService: AggregatorService,
  ) {}

  async assign(input: { aggregatorId: string; agentId: string; actor: string }): Promise<AggregatorAgentAssignment> {
    const aggregatorId = input.aggregatorId?.trim().toLowerCase();
    const agentId = input.agentId?.trim().toLowerCase();
    this.assertUuid(aggregatorId, 'aggregatorId');
    this.assertUuid(agentId, 'agentId');
    const actor = this.normalizeActor(input.actor);

    return this.dataSource.transaction(async (manager) => {
      const aggRepo = manager.getRepository(Aggregator);
      const agentRepo = manager.getRepository(Agent);
      const assignRepo = manager.getRepository(AggregatorAgentAssignment);

      const aggregator = await aggRepo.findOne({ where: { id: aggregatorId } });
      if (!aggregator || aggregator.deletedAt !== null) throw new NotFoundException(`Aggregator ${aggregatorId} not found`);
      if (aggregator.status !== AggregatorStatus.ACTIVE) {
        throw new ConflictException(`Aggregator ${aggregatorId} is ${aggregator.status} and cannot be assigned`);
      }

      const agent = await agentRepo.findOne({ where: { id: agentId } });
      if (!agent || agent.deletedAt !== null) throw new NotFoundException(`Agent ${agentId} not found`);
      // Agent remains independent; we don't check agent status per spec (could be PENDING/ACTIVE etc.)
      // But we ensure agent not already actively assigned elsewhere
      const existingActive = await assignRepo.findOne({
        where: { agentId, status: AggregatorAgentRelationshipStatus.ACTIVE },
      });
      if (existingActive) {
        if (existingActive.aggregatorId === aggregatorId) {
          throw new ConflictException(`Agent ${agentId} already actively assigned to Aggregator ${aggregatorId}`);
        }
        throw new ConflictException(`Agent ${agentId} already actively assigned to another Aggregator ${existingActive.aggregatorId}`);
      }

      // Also prevent duplicate regardless of status? We enforce unique active only via partial index, but also check exact duplicate
      const exact = await assignRepo.findOne({ where: { aggregatorId, agentId } });
      if (exact) {
        // If existing is TERMINATED, we allow re-assign? For A18, we treat TERMINATED as history; new assignment should be new row, not reuse.
        // So we allow new row if previous is TERMINATED, but need to ensure no active duplicate.
        // If exact is SUSPENDED/ACTIVE, we already handled active; for SUSPENDED we should not allow duplicate assign without resuming
        if (exact.status !== AggregatorAgentRelationshipStatus.TERMINATED) {
          throw new ConflictException(`Relationship already exists between Aggregator ${aggregatorId} and Agent ${agentId} with status ${exact.status}`);
        }
      }

      const assignment = assignRepo.create({
        id: randomUUID(),
        aggregatorId,
        agentId,
        status: AggregatorAgentRelationshipStatus.ACTIVE,
        assignedAt: new Date(),
        unassignedAt: null,
        assignedBy: actor,
        unassignedBy: null,
        version: 1,
      });

      try {
        const saved = await assignRepo.save(assignment);
        await this.auditService.record(manager, {
          entityType: 'AGGREGATOR_AGENT_ASSIGNMENT',
          entityId: saved.id,
          action: 'AGGREGATOR_AGENT_ASSIGNED',
          actor,
          newValues: {
            id: saved.id,
            aggregatorId,
            agentId,
            status: saved.status,
            assignedAt: saved.assignedAt,
            assignedBy: actor,
          },
        });
        return saved;
      } catch (error: any) {
        // Unique constraint violation for active assignment
        if (this.isUniqueViolation(error)) {
          throw new ConflictException(`Agent ${agentId} already has an active Aggregator assignment`);
        }
        throw error;
      }
    });
  }

  async unassign(input: { aggregatorId: string; agentId: string; actor: string }): Promise<AggregatorAgentAssignment> {
    return this.transition(input.aggregatorId, input.agentId, AggregatorAgentRelationshipStatus.TERMINATED, input.actor, 'AGGREGATOR_AGENT_UNASSIGNED');
  }

  async suspend(input: { aggregatorId: string; agentId: string; actor: string }): Promise<AggregatorAgentAssignment> {
    return this.transition(input.aggregatorId, input.agentId, AggregatorAgentRelationshipStatus.SUSPENDED, input.actor, 'AGGREGATOR_AGENT_SUSPENDED');
  }

  async reactivate(input: { aggregatorId: string; agentId: string; actor: string }): Promise<AggregatorAgentAssignment> {
    return this.transition(input.aggregatorId, input.agentId, AggregatorAgentRelationshipStatus.ACTIVE, input.actor, 'AGGREGATOR_AGENT_REACTIVATED');
  }

  async getForAgent(agentId: string): Promise<AggregatorAgentAssignment | null> {
    this.assertUuid(agentId, 'agentId');
    return this.assignmentRepository.findOne({
      where: { agentId, status: AggregatorAgentRelationshipStatus.ACTIVE },
      order: { assignedAt: 'DESC' },
    });
  }

  async listForAggregator(aggregatorId: string): Promise<AggregatorAgentAssignment[]> {
    this.assertUuid(aggregatorId, 'aggregatorId');
    return this.assignmentRepository.find({ where: { aggregatorId }, order: { assignedAt: 'ASC' } });
  }

  async assertAggregatorCanOperateViaAssignment(aggregatorId: string): Promise<void> {
    // Inactive aggregator cannot perform restricted operation — check status
    await this.aggregatorService.assertCanOperate(aggregatorId);
  }

  private async transition(
    aggregatorId: string,
    agentId: string,
    target: AggregatorAgentRelationshipStatus,
    actorRaw: string,
    action: string,
  ): Promise<AggregatorAgentAssignment> {
    const aggregatorIdNorm = aggregatorId.trim().toLowerCase();
    const agentIdNorm = agentId.trim().toLowerCase();
    this.assertUuid(aggregatorIdNorm, 'aggregatorId');
    this.assertUuid(agentIdNorm, 'agentId');
    const actor = this.normalizeActor(actorRaw);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AggregatorAgentAssignment);
      const assignment = await repo.findOne({ where: { aggregatorId: aggregatorIdNorm, agentId: agentIdNorm } });
      if (!assignment) throw new NotFoundException(`Assignment between Aggregator ${aggregatorIdNorm} and Agent ${agentIdNorm} not found`);
      const allowed = ALLOWED_RELATIONSHIP_TRANSITIONS[assignment.status as AggregatorAgentRelationshipStatus] ?? [];
      if (!allowed.includes(target)) {
        throw new ConflictException(`Transition ${assignment.status} → ${target} is not allowed`);
      }
      const previous = { status: assignment.status, unassignedAt: assignment.unassignedAt };
      assignment.status = target;
      if (target === AggregatorAgentRelationshipStatus.TERMINATED) {
        assignment.unassignedAt = new Date();
        assignment.unassignedBy = actor;
      } else if (target === AggregatorAgentRelationshipStatus.SUSPENDED) {
        assignment.unassignedAt = null;
        assignment.unassignedBy = null;
      } else if (target === AggregatorAgentRelationshipStatus.ACTIVE) {
        // Reactivate: ensure no other active assignment for this agent
        const otherActive = await repo.findOne({
          where: { agentId: agentIdNorm, status: AggregatorAgentRelationshipStatus.ACTIVE },
        });
        if (otherActive && otherActive.id !== assignment.id) {
          throw new ConflictException(`Agent ${agentIdNorm} already actively assigned elsewhere`);
        }
        assignment.unassignedAt = null;
        assignment.unassignedBy = null;
      }
      const saved = await repo.save(assignment);
      await this.auditService.record(manager, {
        entityType: 'AGGREGATOR_AGENT_ASSIGNMENT',
        entityId: saved.id,
        action,
        actor,
        previousValues: previous,
        newValues: { status: saved.status, aggregatorId: saved.aggregatorId, agentId: saved.agentId, unassignedAt: saved.unassignedAt },
      });
      return saved;
    });
  }

  private assertUuid(value: string, field: string): void {
    if (!value || !UUID_PATTERN.test(value)) throw new BadRequestException(`${field} must be a UUID`);
  }

  private normalizeActor(actor: string): string {
    const trimmed = actor?.trim();
    if (!trimmed) throw new BadRequestException('actor is required');
    if (trimmed.length > 160) throw new BadRequestException('actor too long');
    return trimmed;
  }

  private isUniqueViolation(error: any): boolean {
    const msg = String(error?.message ?? '').toLowerCase();
    const detail = String(error?.detail ?? '').toLowerCase();
    const code = String(error?.code ?? '');
    return code === '23505' || msg.includes('duplicate') || msg.includes('unique') || detail.includes('duplicate') || detail.includes('already exists');
  }
}
