import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { Agent } from './agent.entity';
import { AgentStatus } from './agent.enums';
import type { AgentView, CreateAgentCommand, ListAgentsQuery } from './agent.types';

const REFERENCE_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,159}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Canonical V1 Agent identity service (ADR-0093 §8, Stage 1 of V1A01).
 *
 * STAGE 1 BOUNDARY — this service establishes Agent identity and nothing else.
 * It deliberately does NOT provision a wallet, create a `wallet_accounts` or
 * `ledger_accounts` row, create a financial binding, allocate a MonieNaija
 * number, create a credential or PIN, authenticate an Agent, or authorize an
 * Agent transaction. Those are Stages 2-4 and remain blocked on Finance
 * decisions F-1 to F-4 and the number-allocation strategy.
 *
 * It also implements no status transition: transitions are the Agent
 * application/review/approval workflow, owned by B5 under the approved
 * ownership split, and are out of scope here. Every Agent is created PENDING.
 */
@Injectable()
export class AgentService {
  constructor(
    @InjectRepository(Agent)
    private readonly agentRepository: Repository<Agent>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Creates a canonical Agent identity.
   *
   * The identity is a domain-generated UUID. It is never derived from, equal
   * to, or defaulted from a `Customer.id` (ADR-0093 §8.3).
   */
  async create(command: CreateAgentCommand): Promise<Agent> {
    const reference = this.normalizeReference(command.reference);
    const actor = this.normalizeActor(command.actor);
    const operatorCustomerId = this.normalizeOperatorCustomerId(command.operatorCustomerId);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(Agent);
        const draft = repository.create();
        Object.assign(draft, {
          // Domain-generated canonical identity, independent of any Customer.
          id: randomUUID(),
          reference,
          status: AgentStatus.PENDING,
          operatorCustomerId,
          version: 1,
          deletedAt: null,
        });
        const saved = await repository.save(draft);
        await this.auditService.record(manager, {
          entityType: 'AGENT',
          entityId: saved.id,
          action: 'CREATED',
          actor,
          correlationId: command.correlationId,
          requestId: command.requestId,
          newValues: this.auditValues(saved),
        });
        return saved;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(`Agent reference ${reference} already exists`);
      }
      if (this.isForeignKeyViolation(error)) {
        throw new BadRequestException(
          `operatorCustomerId ${String(operatorCustomerId)} does not reference an existing customer`,
        );
      }
      throw error;
    }
  }

  async get(id: string): Promise<Agent> {
    if (!UUID_PATTERN.test(id)) {
      throw new BadRequestException('id must be a UUID');
    }
    const agent = await this.agentRepository.findOne({ where: { id } });
    if (!agent) {
      throw new NotFoundException(`Agent ${id} was not found`);
    }
    return agent;
  }

  async findByReference(reference: string): Promise<Agent> {
    const normalized = this.normalizeReference(reference);
    const agent = await this.agentRepository.findOne({ where: { reference: normalized } });
    if (!agent) {
      throw new NotFoundException(`Agent reference ${normalized} was not found`);
    }
    return agent;
  }

  async list(query: ListAgentsQuery = {}): Promise<Agent[]> {
    const page = Math.max(1, Math.trunc(query.page ?? 1));
    const limit = Math.min(200, Math.max(1, Math.trunc(query.limit ?? 50)));
    return this.agentRepository.find({
      where: query.status ? { status: query.status } : {},
      order: { createdAt: 'ASC', id: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  toView(agent: Agent): AgentView {
    return {
      id: agent.id,
      reference: agent.reference,
      status: agent.status,
      operatorCustomerId: agent.operatorCustomerId,
      version: agent.version,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    };
  }

  private auditValues(agent: Agent): Record<string, unknown> {
    return {
      id: agent.id,
      reference: agent.reference,
      status: agent.status,
      operatorCustomerId: agent.operatorCustomerId,
      version: agent.version,
    };
  }

  private normalizeReference(reference: unknown): string {
    if (typeof reference !== 'string') {
      throw new BadRequestException('reference must contain 1 to 160 lowercase safe characters');
    }
    const normalized = reference.trim().toLowerCase();
    if (!normalized || normalized.length > 160 || !REFERENCE_PATTERN.test(normalized)) {
      throw new BadRequestException('reference must contain 1 to 160 lowercase safe characters');
    }
    return normalized;
  }

  private normalizeActor(actor: unknown): string {
    if (typeof actor !== 'string') {
      throw new BadRequestException('actor must contain 1 to 160 characters');
    }
    const normalized = actor.trim();
    if (!normalized || normalized.length > 160) {
      throw new BadRequestException('actor must contain 1 to 160 characters');
    }
    return normalized;
  }

  private normalizeOperatorCustomerId(value: string | null | undefined): string | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }
    if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
      throw new BadRequestException('operatorCustomerId must be a UUID when supplied');
    }
    return value.trim();
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    return (error.driverError as { code?: string }).code === '23505';
  }

  private isForeignKeyViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    return (error.driverError as { code?: string }).code === '23503';
  }
}
