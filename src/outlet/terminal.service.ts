import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { AuditService } from '../operations/audit.service';
import { AgentTerminal } from './agent-terminal.entity';
import { TerminalStatus } from './outlet.enums';
import { AgentStatus } from '../agent/agent.enums';
import { AggregatorStatus } from '../aggregator/aggregator.enums';
import { OutletStatus } from './outlet.enums';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_TERMINAL_TRANSITIONS: Record<TerminalStatus, TerminalStatus[]> = {
  [TerminalStatus.ACTIVE]: [TerminalStatus.SUSPENDED, TerminalStatus.TERMINATED],
  [TerminalStatus.SUSPENDED]: [TerminalStatus.ACTIVE, TerminalStatus.TERMINATED],
  [TerminalStatus.TERMINATED]: [],
};

@Injectable()
export class TerminalService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async create(input: {
    agentId: string;
    outletId: string;
    reference: string;
    code?: string;
    label?: string;
    serialNumber?: string;
    actor: string;
    aggregatorId?: string;
    principal?: AuthorizationPrincipal;
  }): Promise<AgentTerminal> {
    const agentId = this.assertUuid(input.agentId, 'agentId');
    const outletId = this.assertUuid(input.outletId, 'outletId');
    const reference = this.normalizeReference(input.reference, 'reference');
    const code = input.code ? this.normalizeReference(input.code, 'code').toUpperCase() : null;
    const label = input.label?.trim() ? input.label.trim() : null;
    if (label && label.length > 160) throw new BadRequestException('label too long');
    const serialNumber = input.serialNumber?.trim() ? input.serialNumber.trim() : null;
    if (serialNumber && serialNumber.length > 100) throw new BadRequestException('serialNumber too long');
    const actor = this.normalizeActor(input.actor);
    const aggregatorId = input.aggregatorId ? this.assertUuid(input.aggregatorId, 'aggregatorId') : undefined;
    const principal = input.principal;
    if (principal) {
      const type = String(principal.type ?? '').toUpperCase();
      if (type === 'CUSTOMER') throw new ForbiddenException('Customer principal cannot manage terminals');
      if (type === 'AGENT') throw new ForbiddenException('Agent principal cannot manage terminals');
      if (type === 'AGGREGATOR') {
        if (!aggregatorId) throw new BadRequestException('aggregatorId is required for Aggregator principal');
        if ((principal as any).aggregatorId !== aggregatorId) throw new ForbiddenException('Aggregator principal mismatch');
      }
    }

    // Verify Agent ACTIVE for creation
    await this.assertAgentOperable(agentId, 'create');

    // Verify Outlet exists, belongs to agent, and is ACTIVE
    const outletRows: Array<{ id: string; agent_id: string; status: string; deleted_at: string | null }> = await this.dataSource.query(
      `SELECT id, agent_id, status, deleted_at FROM agent_outlets WHERE id=$1 LIMIT 1`,
      [outletId],
    );
    const outlet = outletRows[0];
    if (!outlet || outlet.deleted_at !== null) throw new NotFoundException(`Outlet ${outletId} not found`);
    if (outlet.agent_id !== agentId) throw new BadRequestException(`Outlet ${outletId} does not belong to Agent ${agentId}`);
    if (outlet.status !== OutletStatus.ACTIVE) throw new ConflictException(`Outlet ${outletId} is ${outlet.status} and cannot host terminal`);

    if (aggregatorId) {
      await this.assertAggregatorRelationship(aggregatorId, agentId);
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AgentTerminal);

      const refRows: Array<{ id: string }> = await manager.query(`SELECT id FROM agent_terminals WHERE reference=$1 AND deleted_at IS NULL LIMIT 1`, [reference]);
      if (refRows.length > 0) throw new ConflictException(`Terminal reference ${reference} already exists`);
      if (code) {
        const codeRows: Array<{ id: string }> = await manager.query(`SELECT id FROM agent_terminals WHERE code=$1 AND deleted_at IS NULL LIMIT 1`, [code]);
        if (codeRows.length > 0) throw new ConflictException(`Terminal code ${code} already exists`);
      }

      const terminal = repo.create({
        id: randomUUID(),
        agentId,
        outletId,
        reference,
        code,
        label,
        status: TerminalStatus.ACTIVE,
        serialNumber,
        createdBy: actor,
        updatedBy: actor,
        version: 1,
      });

      try {
        const saved = await repo.save(terminal);
        await this.auditService.record(manager, {
          entityType: 'AGENT_TERMINAL',
          entityId: saved.id,
          action: 'AGENT_TERMINAL_CREATED',
          actor,
          newValues: this.toValues(saved),
        });
        return saved;
      } catch (e: any) {
        if (this.isUniqueViolation(e)) throw new ConflictException('Terminal reference or code already exists');
        throw e;
      }
    });
  }

  async getById(id: string): Promise<AgentTerminal> {
    this.assertUuid(id, 'id');
    const terminal = await this.dataSource.getRepository(AgentTerminal).findOne({ where: { id } as any });
    if (!terminal || (terminal as any).deletedAt !== null) throw new NotFoundException(`Terminal ${id} not found`);
    return terminal;
  }

  async listByAgent(agentId: string): Promise<AgentTerminal[]> {
    this.assertUuid(agentId, 'agentId');
    const agentRows: Array<{ id: string }> = await this.dataSource.query(`SELECT id FROM agents WHERE id=$1 AND deleted_at IS NULL LIMIT 1`, [agentId]);
    if (agentRows.length === 0) throw new NotFoundException(`Agent ${agentId} not found`);
    return this.dataSource.getRepository(AgentTerminal).find({ where: { agentId } as any, order: { createdAt: 'ASC' } as any });
  }

  async listByOutlet(outletId: string): Promise<AgentTerminal[]> {
    this.assertUuid(outletId, 'outletId');
    const outletRows: Array<{ id: string }> = await this.dataSource.query(`SELECT id FROM agent_outlets WHERE id=$1 AND deleted_at IS NULL LIMIT 1`, [outletId]);
    if (outletRows.length === 0) throw new NotFoundException(`Outlet ${outletId} not found`);
    return this.dataSource.getRepository(AgentTerminal).find({ where: { outletId } as any, order: { createdAt: 'ASC' } as any });
  }

  async suspend(id: string, actor: string): Promise<AgentTerminal> {
    return this.transition(id, TerminalStatus.SUSPENDED, actor, 'AGENT_TERMINAL_SUSPENDED');
  }

  async reactivate(id: string, actor: string): Promise<AgentTerminal> {
    const terminal = await this.getById(id);
    await this.assertAgentOperable(terminal.agentId, 'activate');
    // Also ensure outlet still ACTIVE for reactivation
    const outletRows: Array<{ id: string; status: string }> = await this.dataSource.query(`SELECT id, status FROM agent_outlets WHERE id=$1 AND deleted_at IS NULL LIMIT 1`, [terminal.outletId]);
    const outlet = outletRows[0];
    if (!outlet || outlet.status !== OutletStatus.ACTIVE) throw new ConflictException(`Outlet ${terminal.outletId} is ${outlet?.status ?? 'not found'} and cannot host active terminal`);
    return this.transition(id, TerminalStatus.ACTIVE, actor, 'AGENT_TERMINAL_REACTIVATED');
  }

  async terminate(id: string, actor: string): Promise<AgentTerminal> {
    return this.transition(id, TerminalStatus.TERMINATED, actor, 'AGENT_TERMINAL_TERMINATED');
  }

  private async transition(id: string, target: TerminalStatus, actor: string, action: string): Promise<AgentTerminal> {
    this.assertUuid(id, 'id');
    const normalizedActor = this.normalizeActor(actor);
    if (!Object.values(TerminalStatus).includes(target)) throw new BadRequestException(`Invalid status ${target}`);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AgentTerminal);
      const terminal = await repo.findOne({ where: { id } as any });
      if (!terminal || (terminal as any).deletedAt !== null) throw new NotFoundException(`Terminal ${id} not found`);
      const allowed = ALLOWED_TERMINAL_TRANSITIONS[terminal.status as TerminalStatus] ?? [];
      if (!allowed.includes(target)) throw new ConflictException(`Transition ${terminal.status} → ${target} is not allowed`);
      if (terminal.status === TerminalStatus.TERMINATED) throw new ConflictException('TERMINATED terminals cannot be transitioned');
      const previous = this.toValues(terminal);
      terminal.status = target;
      terminal.updatedBy = normalizedActor;
      const saved = await repo.save(terminal);
      await this.auditService.record(manager, {
        entityType: 'AGENT_TERMINAL',
        entityId: saved.id,
        action,
        actor: normalizedActor,
        previousValues: previous,
        newValues: this.toValues(saved),
      });
      return saved;
    });
  }

  private async assertAgentOperable(agentId: string, operation: string): Promise<void> {
    const rows: Array<{ id: string; status: string; deleted_at: string | null }> = await this.dataSource.query(
      `SELECT id, status, deleted_at FROM agents WHERE id=$1 LIMIT 1`,
      [agentId],
    );
    const agent = rows[0];
    if (!agent || agent.deleted_at !== null) throw new NotFoundException(`Agent ${agentId} not found`);
    if (agent.status !== AgentStatus.ACTIVE) throw new ConflictException(`Agent ${agentId} is ${agent.status} and cannot ${operation} terminal`);
  }

  private async assertAggregatorRelationship(aggregatorId: string, agentId: string): Promise<void> {
    const aggRows: Array<{ id: string; status: string; deleted_at: string | null }> = await this.dataSource.query(
      `SELECT id, status, deleted_at FROM aggregators WHERE id=$1 LIMIT 1`,
      [aggregatorId],
    );
    const agg = aggRows[0];
    if (!agg || agg.deleted_at !== null) throw new NotFoundException(`Aggregator ${aggregatorId} not found`);
    if (agg.status !== AggregatorStatus.ACTIVE) throw new ConflictException(`Aggregator ${aggregatorId} is ${agg.status}`);
    const relRows: Array<{ id: string; status: string }> = await this.dataSource.query(
      `SELECT id, status FROM aggregator_agent_assignments WHERE aggregator_id=$1 AND agent_id=$2 AND status='ACTIVE' LIMIT 1`,
      [aggregatorId, agentId],
    );
    if (relRows.length === 0) throw new ConflictException(`No ACTIVE Aggregator-Agent relationship for ${aggregatorId} → ${agentId}`);
  }

  private toValues(t: AgentTerminal): Record<string, unknown> {
    return {
      id: t.id,
      agentId: t.agentId,
      outletId: t.outletId,
      reference: t.reference,
      code: t.code,
      label: t.label,
      status: t.status,
      serialNumber: t.serialNumber,
      version: t.version,
      createdBy: t.createdBy,
      updatedBy: t.updatedBy,
    };
  }

  private normalizeReference(v: string, field: string): string {
    const trimmed = v?.trim();
    if (!trimmed || trimmed.length < 3 || trimmed.length > 80) throw new BadRequestException(`${field} must be 3-80 chars`);
    return trimmed;
  }

  private normalizeActor(actor: string): string {
    const trimmed = actor?.trim();
    if (!trimmed) throw new BadRequestException('actor is required');
    if (trimmed.length > 160) throw new BadRequestException('actor too long');
    return trimmed;
  }

  private assertUuid(value: string, field: string): string {
    if (!value || !UUID_PATTERN.test(value)) throw new BadRequestException(`${field} must be a UUID`);
    return value;
  }

  private isUniqueViolation(e: any): boolean {
    const msg = String(e?.message ?? '').toLowerCase();
    const code = String(e?.code ?? '');
    return code === '23505' || msg.includes('duplicate') || msg.includes('uq_agent_terminals');
  }
}
