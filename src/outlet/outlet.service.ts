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

function containsControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

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

  async updateMetadata(id: string, input: {
    expectedVersion: number;
    name?: string;
    displayName?: string | null;
    addressLine?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    actor: string;
  }): Promise<AgentOutlet> {
    this.assertUuid(id, 'id');
    const actor = this.normalizeActor(input.actor);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new BadRequestException('expectedVersion must be a positive integer');
    }
    if ([input.name, input.displayName, input.addressLine, input.city, input.state, input.country].every((value) => value === undefined)) {
      throw new BadRequestException('At least one metadata field is required');
    }
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AgentOutlet);
      const outlet = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!outlet || outlet.deletedAt !== null) throw new NotFoundException(`Outlet ${id} not found`);
      if (outlet.version !== input.expectedVersion) throw new ConflictException('Outlet version is stale');
      const previous = this.toValues(outlet);
      if (input.name !== undefined) {
        if (typeof input.name !== 'string' || containsControlCharacters(input.name)) throw new BadRequestException('name is invalid');
        outlet.name = this.normalizeName(input.name, 'name');
      }
      if (input.displayName !== undefined) outlet.displayName = this.normalizeMetadata(input.displayName, 'displayName', 160);
      if (input.addressLine !== undefined) outlet.addressLine = this.normalizeMetadata(input.addressLine, 'addressLine', 500);
      if (input.city !== undefined) outlet.city = this.normalizeMetadata(input.city, 'city', 100);
      if (input.state !== undefined) outlet.state = this.normalizeMetadata(input.state, 'state', 100);
      if (input.country !== undefined) outlet.country = this.normalizeMetadata(input.country, 'country', 100);
      outlet.updatedBy = actor;
      // Even an identical accepted PATCH consumes the version. Otherwise TypeORM may
      // skip UPDATE for a no-op and two callers holding the same version could both win.
      outlet.version += 1;
      const saved = await repo.save(outlet);
      await this.auditService.record(manager, {
        entityType: 'AGENT_OUTLET', entityId: saved.id, action: 'AGENT_OUTLET_UPDATED', actor,
        previousValues: previous, newValues: this.toValues(saved),
      });
      return saved;
    });
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
      const outlet = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!outlet || outlet.deletedAt !== null) throw new NotFoundException(`Outlet ${id} not found`);
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

  async listPublicCashToCashOutlets(
    input: {
      state?: string;
      city?: string;
      page?: string | number;
      limit?: string | number;
    } = {},
  ): Promise<{
    data: Array<{
      name: string;
      address: string | null;
      city: string | null;
      state: string | null;
      country: string | null;
    }>;
    page: number;
    limit: number;
    total: number;
    pages: number;
    filters: { state: string | null; city: string | null };
  }> {
    const state = this.normalizeLocatorFilter(input.state, 'state');
    const city = this.normalizeLocatorFilter(input.city, 'city');
    const page = this.normalizeLocatorPage(input.page, 1, 1_000_000, 'page');
    const limit = this.normalizeLocatorPage(input.limit, 50, 100, 'limit');
    const offset = (page - 1) * limit;
    const filterValues = [state, city];
    const where = `o.status = 'ACTIVE'
      AND o.deleted_at IS NULL
      AND upper(COALESCE(NULLIF(btrim(o.country), ''), 'NG')) = 'NG'
      AND a.status = 'ACTIVE'
      AND a.deleted_at IS NULL
      AND ac.is_active = TRUE
      AND ac.deleted_at IS NULL
      AND COALESCE(
        CASE WHEN jsonb_typeof(ac.applicable_services) = 'array' THEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(ac.applicable_services) AS svc(value)
           WHERE upper(btrim(svc.value)) = 'CASH_TO_CASH'
        ) ELSE FALSE END,
        FALSE
      )
      AND ($1::varchar IS NULL OR lower(btrim(o.state)) = lower($1))
      AND ($2::varchar IS NULL OR lower(btrim(o.city)) = lower($2))`;
    const countRows: Array<{ total: string }> = await this.dataSource.query(
      `SELECT count(*)::text AS total
         FROM agent_outlets o
         JOIN agents a ON a.id = o.agent_id
         JOIN agent_classes ac ON ac.id = a.agent_class_id
        WHERE ${where}`,
      filterValues,
    );
    const rows: Array<{
      display_name: string | null;
      address_line: string | null;
      city: string | null;
      state: string | null;
      country: string | null;
    }> = await this.dataSource.query(
      `SELECT NULLIF(btrim(o.display_name), '') AS display_name,
              NULLIF(btrim(o.address_line), '') AS address_line,
              NULLIF(btrim(o.city), '') AS city,
              NULLIF(btrim(o.state), '') AS state,
              COALESCE(NULLIF(btrim(o.country), ''), 'NG') AS country
         FROM agent_outlets o
         JOIN agents a ON a.id = o.agent_id
         JOIN agent_classes ac ON ac.id = a.agent_class_id
        WHERE ${where}
        ORDER BY lower(COALESCE(o.state, '')), lower(COALESCE(o.city, '')), lower(COALESCE(o.display_name, ''))
        LIMIT $3 OFFSET $4`,
      [...filterValues, limit, offset],
    );
    const total = Number(countRows[0]?.total ?? 0);
    return {
      data: rows.map((row) => ({
        name: row.display_name ?? 'Cash-to-Cash service outlet',
        address: row.address_line,
        city: row.city,
        state: row.state,
        country: row.country,
      })),
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      filters: { state, city },
    };
  }

  private normalizeLocatorFilter(value: string | undefined, field: string): string | null {
    if (value === undefined || value.trim() === '') return null;
    const normalized = value.trim();
    if (normalized.length > 100 || containsControlCharacters(normalized)) {
      throw new BadRequestException(
        `${field} must be at most 100 characters without control characters`,
      );
    }
    return normalized;
  }

  private normalizeLocatorPage(
    value: string | number | undefined,
    fallback: number,
    max: number,
    field: string,
  ): number {
    if (value === undefined || value === '') return fallback;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
      throw new BadRequestException(
        `${field} must be a positive integer${max !== Number.MAX_SAFE_INTEGER ? ` no greater than ${max}` : ''}`,
      );
    }
    return parsed;
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

  private normalizeMetadata(value: string | null, field: string, max: number): string | null {
    if (value === null) return null;
    if (typeof value !== 'string' || value.length > max || containsControlCharacters(value)) {
      throw new BadRequestException(`${field} must be at most ${max} characters without control characters`);
    }
    return value.trim() || null;
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
