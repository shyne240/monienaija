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
import { AgentOutlet } from './agent-outlet.entity';
import { OutletStatus } from './outlet.enums';
import { AgentStatus } from '../agent/agent.enums';
import { AggregatorStatus } from '../aggregator/aggregator.enums';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_OUTLET_TRANSITIONS: Record<OutletStatus, OutletStatus[]> = {
  [OutletStatus.ACTIVE]: [OutletStatus.SUSPENDED, OutletStatus.TERMINATED],
  [OutletStatus.SUSPENDED]: [OutletStatus.ACTIVE, OutletStatus.TERMINATED],
  [OutletStatus.TERMINATED]: [],
};

@Injectable()
export class OutletService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async create(input: {
    agentId: string;
    reference: string;
    code?: string;
    name: string;
    displayName?: string;
    addressLine?: string;
    city?: string;
    state?: string;
    country?: string;
    actor: string;
    aggregatorId?: string;
    principal?: AuthorizationPrincipal;
  }): Promise<AgentOutlet> {
    const agentId = this.assertUuid(input.agentId, 'agentId');
    const reference = this.normalizeReference(input.reference, 'reference');
    const code = input.code ? this.normalizeReference(input.code, 'code').toUpperCase() : null;
    const name = this.normalizeName(input.name, 'name');
    const displayName = input.displayName?.trim() ? input.displayName.trim() : null;
    if (displayName && displayName.length > 160) throw new BadRequestException('displayName too long');
    const addressLine = input.addressLine?.trim() ? input.addressLine.trim() : null;
    if (addressLine && addressLine.length > 500) throw new BadRequestException('addressLine too long');
    const city = input.city?.trim() ? input.city.trim() : null;
    if (city && city.length > 100) throw new BadRequestException('city too long');
    const state = input.state?.trim() ? input.state.trim() : null;
    if (state && state.length > 100) throw new BadRequestException('state too long');
    const country = input.country?.trim() ? input.country.trim() : 'NG';
    if (country && country.length > 100) throw new BadRequestException('country too long');
    const actor = this.normalizeActor(input.actor);
    const aggregatorId = input.aggregatorId ? this.assertUuid(input.aggregatorId, 'aggregatorId') : undefined;
    const principal = input.principal;

    if (principal) {
      const type = String(principal.type ?? '').toUpperCase();
      if (type === 'CUSTOMER') throw new ForbiddenException('Customer principal cannot manage outlets');
      if (type === 'AGENT') throw new ForbiddenException('Agent principal cannot manage outlets');
      if (type === 'AGGREGATOR') {
        if (!aggregatorId) throw new BadRequestException('aggregatorId is required for Aggregator principal');
        if ((principal as any).aggregatorId !== aggregatorId) throw new ForbiddenException('Aggregator principal mismatch');
      }
    }

    // Verify Agent exists and is ACTIVE (creation requires operational agent)
    await this.assertAgentOperable(agentId, 'create');

    // If aggregator context supplied, verify aggregator ACTIVE and relationship ACTIVE
    if (aggregatorId) {
      await this.assertAggregatorRelationship(aggregatorId, agentId);
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AgentOutlet);

      // Pre-check uniqueness for clearer error (DB constraint is source of truth for race)
      const existingRef = await repo.findOne({ where: { reference } as any });
      // Need to check soft delete: findOne without deleted_at may include deleted; we query raw for non-deleted
      const refRows: Array<{ id: string }> = await manager.query(`SELECT id FROM agent_outlets WHERE reference=$1 AND deleted_at IS NULL LIMIT 1`, [reference]);
      if (refRows.length > 0) throw new ConflictException(`Outlet reference ${reference} already exists`);
      if (code) {
        const codeRows: Array<{ id: string }> = await manager.query(`SELECT id FROM agent_outlets WHERE code=$1 AND deleted_at IS NULL LIMIT 1`, [code]);
        if (codeRows.length > 0) throw new ConflictException(`Outlet code ${code} already exists`);
      }

      const outlet = repo.create({
        id: randomUUID(),
        agentId,
        reference,
        code,
        name,
        displayName,
        status: OutletStatus.ACTIVE,
        addressLine,
        city,
        state,
        country,
        createdBy: actor,
        updatedBy: actor,
        version: 1,
      });

      try {
        const saved = await repo.save(outlet);
        await this.auditService.record(manager, {
          entityType: 'AGENT_OUTLET',
          entityId: saved.id,
          action: 'AGENT_OUTLET_CREATED',
          actor,
          newValues: this.toValues(saved),
        });
        return saved;
      } catch (e: any) {
        if (this.isUniqueViolation(e)) {
          throw new ConflictException('Outlet reference or code already exists');
        }
        throw e;
      }
    });
  }

  async getById(id: string): Promise<AgentOutlet> {
    this.assertUuid(id, 'id');
    const outlet = await this.dataSource.getRepository(AgentOutlet).findOne({ where: { id } as any });
    if (!outlet || (outlet as any).deletedAt !== null) throw new NotFoundException(`Outlet ${id} not found`);
    return outlet;
  }

  async listByAgent(agentId: string): Promise<AgentOutlet[]> {
    this.assertUuid(agentId, 'agentId');
    // Ensure agent exists
    const agentRows: Array<{ id: string }> = await this.dataSource.query(`SELECT id FROM agents WHERE id=$1 AND deleted_at IS NULL LIMIT 1`, [agentId]);
    if (agentRows.length === 0) throw new NotFoundException(`Agent ${agentId} not found`);
    return this.dataSource.getRepository(AgentOutlet).find({ where: { agentId } as any, order: { createdAt: 'ASC' } as any });
  }

  async suspend(id: string, actor: string): Promise<AgentOutlet> {
    return this.transition(id, OutletStatus.SUSPENDED, actor, 'AGENT_OUTLET_SUSPENDED');
  }

  async reactivate(id: string, actor: string): Promise<AgentOutlet> {
    // Reactivation requires Agent still operable
    const outlet = await this.getById(id);
    await this.assertAgentOperable(outlet.agentId, 'activate');
    return this.transition(id, OutletStatus.ACTIVE, actor, 'AGENT_OUTLET_REACTIVATED');
  }

  async terminate(id: string, actor: string): Promise<AgentOutlet> {
    return this.transition(id, OutletStatus.TERMINATED, actor, 'AGENT_OUTLET_TERMINATED');
  }

  private async transition(id: string, target: OutletStatus, actor: string, action: string): Promise<AgentOutlet> {
    this.assertUuid(id, 'id');
    const normalizedActor = this.normalizeActor(actor);
    if (!Object.values(OutletStatus).includes(target)) throw new BadRequestException(`Invalid status ${target}`);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AgentOutlet);
      const outlet = await repo.findOne({ where: { id } as any });
      if (!outlet || (outlet as any).deletedAt !== null) throw new NotFoundException(`Outlet ${id} not found`);
      const allowed = ALLOWED_OUTLET_TRANSITIONS[outlet.status as OutletStatus] ?? [];
      if (!allowed.includes(target)) {
        throw new ConflictException(`Transition ${outlet.status} → ${target} is not allowed`);
      }
      if (outlet.status === OutletStatus.TERMINATED) {
        throw new ConflictException('TERMINATED outlets cannot be transitioned');
      }
      const previous = this.toValues(outlet);
      outlet.status = target;
      outlet.updatedBy = normalizedActor;
      const saved = await repo.save(outlet);
      await this.auditService.record(manager, {
        entityType: 'AGENT_OUTLET',
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
    if (agent.status !== AgentStatus.ACTIVE) {
      throw new ConflictException(`Agent ${agentId} is ${agent.status} and cannot ${operation} outlet`);
    }
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

  private toValues(o: AgentOutlet): Record<string, unknown> {
    return {
      id: o.id,
      agentId: o.agentId,
      reference: o.reference,
      code: o.code,
      name: o.name,
      displayName: o.displayName,
      status: o.status,
      addressLine: o.addressLine,
      city: o.city,
      state: o.state,
      country: o.country,
      version: o.version,
      createdBy: o.createdBy,
      updatedBy: o.updatedBy,
    };
  }

  private normalizeReference(v: string, field: string): string {
    const trimmed = v?.trim();
    if (!trimmed || trimmed.length < 3 || trimmed.length > 80) throw new BadRequestException(`${field} must be 3-80 chars`);
    return trimmed;
  }

  private normalizeName(v: string, field: string): string {
    const trimmed = v?.trim();
    if (!trimmed || trimmed.length < 2 || trimmed.length > 320) throw new BadRequestException(`${field} must be 2-320 chars`);
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
    return code === '23505' || msg.includes('duplicate') || msg.includes('uq_agent_outlets');
  }
}
