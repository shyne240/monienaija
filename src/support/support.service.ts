import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { OutboxService } from '../operations/outbox.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import {
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
} from './support.enums';
import { SupportTicket } from './support-ticket.entity';
import { SupportTicketMessage } from './support-ticket-message.entity';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateSupportTicketInput {
  subject: string;
  category: SupportTicketCategory;
  description: string;
  priority?: SupportTicketPriority;
  fundingRequestId?: string | null;
  relatedTransferId?: string | null;
  idempotencyKey?: string | null;
  principal: AuthorizationPrincipal;
  // For workforce creating on behalf of another? Not used V1, but we keep customerId/agentId derived from principal
  targetCustomerId?: string | null;
  targetAgentId?: string | null;
}

export interface AssignSupportTicketInput {
  ticketId: string;
  assignedTo: string;
  principal: AuthorizationPrincipal;
  version?: number;
}

export interface UpdateSupportTicketStatusInput {
  ticketId: string;
  status: SupportTicketStatus;
  principal: AuthorizationPrincipal;
  version?: number;
}

export interface CreateSupportTicketMessageInput {
  ticketId: string;
  body: string;
  isInternal?: boolean;
  principal: AuthorizationPrincipal;
}

export interface SupportTicketView {
  id: string;
  reference: string;
  customerId: string | null;
  agentId: string | null;
  createdByType: string;
  createdById: string;
  subject: string;
  category: SupportTicketCategory;
  description: string;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  assignedTo: string | null;
  fundingRequestId: string | null;
  relatedTransferId: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
  version: number;
}

export interface SupportTicketSafeView {
  id: string;
  reference: string;
  subject: string;
  category: SupportTicketCategory;
  description: string;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  fundingRequestId: string | null;
  relatedTransferId: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
  version: number;
  // assignedTo intentionally omitted for customer/agent safe view
}

export interface SupportTicketMessageView {
  id: string;
  ticketId: string;
  authorType: string;
  authorId: string;
  body: string;
  isInternal: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
}

@Injectable()
export class SupportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly outboxService: OutboxService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  // ──────────────────────────────────────────────
  // Create
  // ──────────────────────────────────────────────

  async createTicket(input: CreateSupportTicketInput): Promise<SupportTicketView> {
    const subject = this.assertSubject(input.subject);
    const category = this.assertCategory(input.category);
    const description = this.assertDescription(input.description);
    const priority = this.assertPriority(input.priority);
    const fundingRequestId = this.optionalUuid(
      input.fundingRequestId,
      'fundingRequestId',
    );
    const relatedTransferId = this.optionalUuid(
      input.relatedTransferId,
      'relatedTransferId',
    );
    const idempotencyKey = this.optionalIdempotencyKey(input.idempotencyKey);
    const principal = this.assertPrincipal(input.principal);

    // Derive ownership from principal. For CUSTOMER/AGENT self creation, bind directly.
    // For workforce, allow explicit target if provided, else no owner.
    let customerId: string | null = null;
    let agentId: string | null = null;
    let createdByType = principal.type;
    let createdById = principal.principalId;

    if (principal.type === 'CUSTOMER') {
      if (!principal.customerId) throw new ForbiddenException('Customer principal missing customerId');
      customerId = principal.customerId;
      // workforce target overrides not allowed for customer
      if (input.targetCustomerId || input.targetAgentId) {
        throw new ForbiddenException('Customer cannot create ticket for another principal');
      }
    } else if (principal.type === 'AGENT') {
      if (!principal.agentId) throw new ForbiddenException('Agent principal missing agentId');
      agentId = principal.agentId;
      if (input.targetCustomerId || input.targetAgentId) {
        throw new ForbiddenException('Agent cannot create ticket for another principal');
      }
    } else if (['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type)) {
      // Workforce: if target supplied, bind it; else leave null (operational ticket)
      if (input.targetCustomerId) customerId = this.assertUuid(input.targetCustomerId, 'targetCustomerId');
      if (input.targetAgentId) agentId = this.assertUuid(input.targetAgentId, 'targetAgentId');
    } else {
      throw new ForbiddenException(`Principal type ${principal.type} cannot create support tickets`);
    }

    // Validate linked entities existence if provided (stable FKs)
    if (fundingRequestId) {
      const rows: Array<{ id: string }> = await this.dataSource.query(
        `SELECT id FROM customer_funding_requests WHERE id=$1 LIMIT 1`,
        [fundingRequestId],
      );
      if (rows.length === 0) throw new NotFoundException(`Funding request ${fundingRequestId} was not found`);
    }
    if (relatedTransferId) {
      const rows: Array<{ id: string }> = await this.dataSource.query(
        `SELECT id FROM transfers WHERE id=$1 LIMIT 1`,
        [relatedTransferId],
      );
      if (rows.length === 0) throw new NotFoundException(`Transfer ${relatedTransferId} was not found`);
    }

    // Validate customer/agent existence where bound
    if (customerId) {
      const rows: Array<{ id: string }> = await this.dataSource.query(
        `SELECT id FROM customers WHERE id=$1 AND deleted_at IS NULL LIMIT 1`,
        [customerId],
      );
      if (rows.length === 0) throw new NotFoundException(`Customer ${customerId} was not found`);
    }
    if (agentId) {
      const rows: Array<{ id: string }> = await this.dataSource.query(
        `SELECT id FROM agents WHERE id=$1 AND deleted_at IS NULL LIMIT 1`,
        [agentId],
      );
      if (rows.length === 0) throw new NotFoundException(`Agent ${agentId} was not found`);
    }

    const requestHash = this.computeRequestHash({
      subject,
      category,
      description,
      priority,
      fundingRequestId: fundingRequestId ?? null,
      relatedTransferId: relatedTransferId ?? null,
      customerId: customerId ?? null,
      agentId: agentId ?? null,
      createdByType,
      createdById,
    });

    const scope = `support.ticket.create:${principal.type}:${principal.principalId}`;

    // If idempotencyKey provided, use IdempotencyService
    if (idempotencyKey) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const result = await this.dataSource.transaction(async (manager) => {
            const reservation = await this.idempotencyService.reserve(manager, {
              scope,
              key: idempotencyKey,
              requestHash,
              retentionSeconds: 86400,
            });
            if (reservation.kind === 'REPLAY') {
              const body = reservation.record.responseBody as Record<string, unknown> | null;
              const resourceId = reservation.record.resourceId;
              if (resourceId && body && (body as any).id) {
                const rows: Array<any> = await manager.query(
                  `SELECT * FROM support_tickets WHERE id=$1 LIMIT 1`,
                  [resourceId],
                );
                if (rows[0]) return this.toView(rows[0]);
                // Fallback to body
                return body as unknown as SupportTicketView;
              }
              if (resourceId) {
                const rows: Array<any> = await manager.query(
                  `SELECT * FROM support_tickets WHERE id=$1 LIMIT 1`,
                  [resourceId],
                );
                if (rows[0]) return this.toView(rows[0]);
              }
              // No resource yet but replay requested — return stored body if exists
              if (body && (body as any).id) return body as unknown as SupportTicketView;
              throw new ConflictException('The idempotent request is already in progress');
            }

            const id = randomUUID();
            const reference = `SUP-${id}`;
            const now = new Date();
            await manager.query(
              `INSERT INTO support_tickets
                (id, reference, customer_id, agent_id, created_by_type, created_by_id, subject, category, description, status, priority, assigned_to, funding_request_id, related_transfer_id, created_at, updated_at, resolved_at, closed_at, version)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'OPEN',$10,$11,$12,$13,$14,$14,NULL,NULL,1)`,
              [
                id,
                reference,
                customerId,
                agentId,
                createdByType,
                createdById,
                subject,
                category,
                description,
                priority,
                null,
                fundingRequestId,
                relatedTransferId,
                now,
              ],
            );

            await this.auditService.record(manager, {
              entityType: 'SUPPORT_TICKET',
              entityId: id,
              action: 'SUPPORT_TICKET_CREATED',
              actor: createdById,
              newValues: {
                reference,
                customerId,
                agentId,
                subject,
                category,
                priority,
                fundingRequestId,
                relatedTransferId,
              },
            });

            await this.outboxService.enqueue(manager, {
              eventType: 'support.ticket.created',
              aggregateType: 'SUPPORT_TICKET',
              aggregateId: id,
              correlationId: `support-ticket:${id}`,
              payload: {
                ticketId: id,
                reference,
                customerId,
                agentId,
                category,
                priority,
                fundingRequestId,
              },
            });

            const rows: Array<any> = await manager.query(
              `SELECT * FROM support_tickets WHERE id=$1 LIMIT 1`,
              [id],
            );
            const view = this.toView(rows[0]);
            await this.idempotencyService.complete(manager, reservation.record.id, {
              statusCode: 201,
              responseBody: view as unknown as Record<string, unknown>,
              resourceType: 'SUPPORT_TICKET',
              resourceId: id,
            });
            return view;
          });
          return result;
        } catch (error) {
          if (this.isRetryableTransactionError(error) && attempt < 2) continue;
          throw error;
        }
      }
      throw new ConflictException('The support ticket could not be created after concurrent retries');
    }

    // No idempotency — direct create
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const view = await this.dataSource.transaction(async (manager) => {
          const id = randomUUID();
          const reference = `SUP-${id}`;
          const now = new Date();
          await manager.query(
            `INSERT INTO support_tickets
              (id, reference, customer_id, agent_id, created_by_type, created_by_id, subject, category, description, status, priority, assigned_to, funding_request_id, related_transfer_id, created_at, updated_at, resolved_at, closed_at, version)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'OPEN',$10,$11,$12,$13,$14,$14,NULL,NULL,1)`,
            [
              id,
              reference,
              customerId,
              agentId,
              createdByType,
              createdById,
              subject,
              category,
              description,
              priority,
              null,
              fundingRequestId,
              relatedTransferId,
              now,
            ],
          );

          await this.auditService.record(manager, {
            entityType: 'SUPPORT_TICKET',
            entityId: id,
            action: 'SUPPORT_TICKET_CREATED',
            actor: createdById,
            newValues: {
              reference,
              customerId,
              agentId,
              subject,
              category,
              priority,
              fundingRequestId,
            },
          });

          await this.outboxService.enqueue(manager, {
            eventType: 'support.ticket.created',
            aggregateType: 'SUPPORT_TICKET',
            aggregateId: id,
            correlationId: `support-ticket:${id}`,
            payload: {
              ticketId: id,
              reference,
              customerId,
              agentId,
              category,
              priority,
              fundingRequestId,
            },
          });

          const rows: Array<any> = await manager.query(
            `SELECT * FROM support_tickets WHERE id=$1 LIMIT 1`,
            [id],
          );
          return this.toView(rows[0]);
        });
        return view;
      } catch (error) {
        if (this.isRetryableTransactionError(error) && attempt < 2) continue;
        throw error;
      }
    }
    throw new ConflictException('The support ticket could not be created after concurrent retries');
  }

  // ──────────────────────────────────────────────
  // List
  // ──────────────────────────────────────────────

  async listForCustomer(
    customerId: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: SupportTicketSafeView[]; pagination: Pagination }> {
    const cid = this.assertUuid(customerId, 'customerId');
    const normalizedPage = this.normalizePage(page);
    const normalizedLimit = this.normalizeLimit(limit);
    const offset = (normalizedPage - 1) * normalizedLimit;
    const rows: Array<any> = await this.dataSource.query(
      `SELECT * FROM support_tickets WHERE customer_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [cid, normalizedLimit, offset],
    );
    const countRows: Array<{ count: string }> = await this.dataSource.query(
      `SELECT count(*)::text AS count FROM support_tickets WHERE customer_id=$1`,
      [cid],
    );
    const total = Number(countRows[0]?.count ?? '0');
    const totalPages = total === 0 ? 0 : Math.ceil(total / normalizedLimit);
    return {
      items: rows.map((r) => this.toSafeView(r)),
      pagination: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
        totalPages,
        hasNextPage: normalizedPage < totalPages,
      },
    };
  }

  async listForAgent(
    agentId: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: SupportTicketSafeView[]; pagination: Pagination }> {
    const aid = this.assertUuid(agentId, 'agentId');
    const normalizedPage = this.normalizePage(page);
    const normalizedLimit = this.normalizeLimit(limit);
    const offset = (normalizedPage - 1) * normalizedLimit;
    const rows: Array<any> = await this.dataSource.query(
      `SELECT * FROM support_tickets WHERE agent_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [aid, normalizedLimit, offset],
    );
    const countRows: Array<{ count: string }> = await this.dataSource.query(
      `SELECT count(*)::text AS count FROM support_tickets WHERE agent_id=$1`,
      [aid],
    );
    const total = Number(countRows[0]?.count ?? '0');
    const totalPages = total === 0 ? 0 : Math.ceil(total / normalizedLimit);
    return {
      items: rows.map((r) => this.toSafeView(r)),
      pagination: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
        totalPages,
        hasNextPage: normalizedPage < totalPages,
      },
    };
  }

  async listForInternal(
    page = 1,
    limit = 20,
    filters?: { status?: string; customerId?: string; agentId?: string; assignedTo?: string },
  ): Promise<{ items: SupportTicketView[]; pagination: Pagination }> {
    const normalizedPage = this.normalizePage(page);
    const normalizedLimit = this.normalizeLimit(limit);
    const offset = (normalizedPage - 1) * normalizedLimit;
    const where: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    if (filters?.status) {
      this.assertStatus(filters.status as SupportTicketStatus);
      where.push(`status=$${idx++}`);
      params.push(filters.status);
    }
    if (filters?.customerId) {
      const cid = this.assertUuid(filters.customerId, 'customerId');
      where.push(`customer_id=$${idx++}`);
      params.push(cid);
    }
    if (filters?.agentId) {
      const aid = this.assertUuid(filters.agentId, 'agentId');
      where.push(`agent_id=$${idx++}`);
      params.push(aid);
    }
    if (filters?.assignedTo) {
      where.push(`assigned_to=$${idx++}`);
      params.push(filters.assignedTo);
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows: Array<any> = await this.dataSource.query(
      `SELECT * FROM support_tickets ${whereClause} ORDER BY created_at DESC, id DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, normalizedLimit, offset],
    );
    const countRows: Array<{ count: string }> = await this.dataSource.query(
      `SELECT count(*)::text AS count FROM support_tickets ${whereClause}`,
      params,
    );
    const total = Number(countRows[0]?.count ?? '0');
    const totalPages = total === 0 ? 0 : Math.ceil(total / normalizedLimit);
    return {
      items: rows.map((r) => this.toView(r)),
      pagination: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
        totalPages,
        hasNextPage: normalizedPage < totalPages,
      },
    };
  }

  // ──────────────────────────────────────────────
  // Get
  // ──────────────────────────────────────────────

  async getForCustomer(ticketId: string, customerId: string): Promise<SupportTicketSafeView> {
    const tid = this.assertUuid(ticketId, 'ticketId');
    const cid = this.assertUuid(customerId, 'customerId');
    const rows: Array<any> = await this.dataSource.query(
      `SELECT * FROM support_tickets WHERE id=$1 LIMIT 1`,
      [tid],
    );
    if (rows.length === 0) throw new NotFoundException('Support ticket not found');
    const ticket = rows[0];
    if (ticket.customer_id !== cid) throw new NotFoundException('Support ticket not found');
    return this.toSafeView(ticket);
  }

  async getForAgent(ticketId: string, agentId: string): Promise<SupportTicketSafeView> {
    const tid = this.assertUuid(ticketId, 'ticketId');
    const aid = this.assertUuid(agentId, 'agentId');
    const rows: Array<any> = await this.dataSource.query(
      `SELECT * FROM support_tickets WHERE id=$1 LIMIT 1`,
      [tid],
    );
    if (rows.length === 0) throw new NotFoundException('Support ticket not found');
    const ticket = rows[0];
    if (ticket.agent_id !== aid) throw new NotFoundException('Support ticket not found');
    return this.toSafeView(ticket);
  }

  async getForInternal(ticketId: string): Promise<SupportTicketView> {
    const tid = this.assertUuid(ticketId, 'ticketId');
    const rows: Array<any> = await this.dataSource.query(
      `SELECT * FROM support_tickets WHERE id=$1 LIMIT 1`,
      [tid],
    );
    if (rows.length === 0) throw new NotFoundException('Support ticket not found');
    return this.toView(rows[0]);
  }

  // ──────────────────────────────────────────────
  // Assign
  // ──────────────────────────────────────────────

  async assignTicket(input: AssignSupportTicketInput): Promise<SupportTicketView> {
    const ticketId = this.assertUuid(input.ticketId, 'ticketId');
    const assignedTo = this.assertText(input.assignedTo, 'assignedTo', 1, 160);
    const principal = this.assertWorkforcePrincipal(input.principal);
    const actor = principal.principalId;
    const expectedVersion = input.version;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const view = await this.dataSource.transaction(async (manager) => {
          const rows: Array<any> = await manager.query(
            `SELECT * FROM support_tickets WHERE id=$1 FOR UPDATE`,
            [ticketId],
          );
          if (rows.length === 0) throw new NotFoundException('Support ticket not found');
          const ticket = rows[0];
          const currentStatus: string = ticket.status;
          if (currentStatus === SupportTicketStatus.CLOSED || currentStatus === SupportTicketStatus.RESOLVED) {
            throw new ConflictException(`Cannot assign ticket in ${currentStatus} status`);
          }
          if (expectedVersion !== undefined && ticket.version !== expectedVersion) {
            throw new ConflictException('Support ticket version is stale');
          }
          const previousAssignee: string | null = ticket.assigned_to;
          const now = new Date();
          // If already assigned to same, idempotent success
          if (previousAssignee === assignedTo) {
            return this.toView(ticket);
          }
          await manager.query(
            `UPDATE support_tickets SET assigned_to=$1, updated_at=$2, version=version+1 WHERE id=$3`,
            [assignedTo, now, ticketId],
          );

          await this.auditService.record(manager, {
            entityType: 'SUPPORT_TICKET',
            entityId: ticketId,
            action: 'SUPPORT_TICKET_ASSIGNED',
            actor,
            previousValues: { assignedTo: previousAssignee },
            newValues: { assignedTo },
          });

          await this.outboxService.enqueue(manager, {
            eventType: 'support.ticket.assigned',
            aggregateType: 'SUPPORT_TICKET',
            aggregateId: ticketId,
            correlationId: `support-ticket:${ticketId}`,
            payload: { ticketId, assignedTo, previousAssignee, actor },
          });

          // Optionally transition OPEN -> IN_PROGRESS on first assign if still OPEN
          if (currentStatus === SupportTicketStatus.OPEN) {
            await manager.query(
              `UPDATE support_tickets SET status='IN_PROGRESS', updated_at=$1, version=version+1 WHERE id=$2`,
              [now, ticketId],
            );
            await this.auditService.record(manager, {
              entityType: 'SUPPORT_TICKET',
              entityId: ticketId,
              action: 'SUPPORT_TICKET_STATUS_CHANGED',
              actor,
              previousValues: { status: currentStatus },
              newValues: { status: SupportTicketStatus.IN_PROGRESS },
            });
            await this.outboxService.enqueue(manager, {
              eventType: 'support.ticket.status_changed',
              aggregateType: 'SUPPORT_TICKET',
              aggregateId: ticketId,
              correlationId: `support-ticket:${ticketId}`,
              payload: { ticketId, from: currentStatus, to: SupportTicketStatus.IN_PROGRESS, actor },
            });
          }

          const updated: Array<any> = await manager.query(
            `SELECT * FROM support_tickets WHERE id=$1 LIMIT 1`,
            [ticketId],
          );
          return this.toView(updated[0]);
        });
        return view;
      } catch (error) {
        if (this.isRetryableTransactionError(error) && attempt < 2) continue;
        throw error;
      }
    }
    throw new ConflictException('Ticket could not be assigned after concurrent retries');
  }

  // ──────────────────────────────────────────────
  // Status
  // ──────────────────────────────────────────────

  async updateStatus(input: UpdateSupportTicketStatusInput): Promise<SupportTicketView> {
    const ticketId = this.assertUuid(input.ticketId, 'ticketId');
    const newStatus = this.assertStatus(input.status);
    const principal = this.assertWorkforcePrincipal(input.principal);
    const actor = principal.principalId;
    const expectedVersion = input.version;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const view = await this.dataSource.transaction(async (manager) => {
          const rows: Array<any> = await manager.query(
            `SELECT * FROM support_tickets WHERE id=$1 FOR UPDATE`,
            [ticketId],
          );
          if (rows.length === 0) throw new NotFoundException('Support ticket not found');
          const ticket = rows[0];
          const currentStatus: SupportTicketStatus = ticket.status;
          if (expectedVersion !== undefined && ticket.version !== expectedVersion) {
            throw new ConflictException('Support ticket version is stale');
          }
          if (currentStatus === newStatus) {
            return this.toView(ticket);
          }
          this.assertStatusTransition(currentStatus, newStatus);

          const now = new Date();
          let resolvedAt: Date | null = ticket.resolved_at;
          let closedAt: Date | null = ticket.closed_at;
          if (newStatus === SupportTicketStatus.RESOLVED) resolvedAt = now;
          if (newStatus === SupportTicketStatus.CLOSED) closedAt = now;

          await manager.query(
            `UPDATE support_tickets SET status=$1, resolved_at=$2, closed_at=$3, updated_at=$4, version=version+1 WHERE id=$5`,
            [newStatus, resolvedAt, closedAt, now, ticketId],
          );

          const action =
            newStatus === SupportTicketStatus.RESOLVED
              ? 'SUPPORT_TICKET_RESOLVED'
              : newStatus === SupportTicketStatus.CLOSED
                ? 'SUPPORT_TICKET_CLOSED'
                : 'SUPPORT_TICKET_STATUS_CHANGED';

          await this.auditService.record(manager, {
            entityType: 'SUPPORT_TICKET',
            entityId: ticketId,
            action,
            actor,
            previousValues: { status: currentStatus },
            newValues: { status: newStatus },
          });

          const eventType =
            newStatus === SupportTicketStatus.RESOLVED
              ? 'support.ticket.resolved'
              : newStatus === SupportTicketStatus.CLOSED
                ? 'support.ticket.closed'
                : 'support.ticket.status_changed';

          await this.outboxService.enqueue(manager, {
            eventType,
            aggregateType: 'SUPPORT_TICKET',
            aggregateId: ticketId,
            correlationId: `support-ticket:${ticketId}`,
            payload: { ticketId, from: currentStatus, to: newStatus, actor },
          });

          const updated: Array<any> = await manager.query(
            `SELECT * FROM support_tickets WHERE id=$1 LIMIT 1`,
            [ticketId],
          );
          return this.toView(updated[0]);
        });
        return view;
      } catch (error) {
        if (this.isRetryableTransactionError(error) && attempt < 2) continue;
        throw error;
      }
    }
    throw new ConflictException('Ticket status could not be updated after concurrent retries');
  }

  // ──────────────────────────────────────────────
  // Messages
  // ──────────────────────────────────────────────

  async addMessage(input: CreateSupportTicketMessageInput): Promise<SupportTicketMessageView> {
    const ticketId = this.assertUuid(input.ticketId, 'ticketId');
    const body = this.assertText(input.body, 'body', 1, 4000);
    const isInternal = input.isInternal ?? false;
    const principal = this.assertPrincipal(input.principal);

    // Determine authorType/authorId
    let authorType = principal.type;
    let authorId = principal.principalId;
    if (principal.type === 'CUSTOMER' && !principal.customerId) throw new ForbiddenException('Customer principal missing');
    if (principal.type === 'AGENT' && !principal.agentId) throw new ForbiddenException('Agent principal missing');

    // Validate isInternal permission: only workforce can create internal notes
    if (isInternal && !['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type)) {
      throw new ForbiddenException('Only workforce can create internal messages');
    }

    // Ensure ticket exists and caller has access, and ticket is not closed for customer/agent
    const result = await this.dataSource.transaction(async (manager) => {
      const ticketRows: Array<any> = await manager.query(
        `SELECT * FROM support_tickets WHERE id=$1 FOR UPDATE`,
        [ticketId],
      );
      if (ticketRows.length === 0) throw new NotFoundException('Support ticket not found');
      const ticket = ticketRows[0];
      const status: string = ticket.status;

      // Ownership check
      if (principal.type === 'CUSTOMER') {
        if (ticket.customer_id !== principal.customerId) throw new NotFoundException('Support ticket not found');
        if (status === SupportTicketStatus.CLOSED || status === SupportTicketStatus.RESOLVED) {
          throw new ConflictException('Cannot add message to resolved/closed ticket');
        }
        if (isInternal) throw new ForbiddenException('Customer cannot create internal messages');
      } else if (principal.type === 'AGENT') {
        if (ticket.agent_id !== principal.agentId) throw new NotFoundException('Support ticket not found');
        if (status === SupportTicketStatus.CLOSED || status === SupportTicketStatus.RESOLVED) {
          throw new ConflictException('Cannot add message to resolved/closed ticket');
        }
        if (isInternal) throw new ForbiddenException('Agent cannot create internal messages');
      } else if (['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type)) {
        // workforce can add to any ticket, even resolved? But block if CLOSED
        if (status === SupportTicketStatus.CLOSED) {
          throw new ConflictException('Cannot add message to closed ticket');
        }
      } else {
        throw new ForbiddenException('Principal not allowed to add message');
      }

      // Insert message
      const id = randomUUID();
      const now = new Date();
      await manager.query(
        `INSERT INTO support_ticket_messages (id, ticket_id, author_type, author_id, body, is_internal, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
        [id, ticketId, authorType, authorId, body, isInternal, now],
      );

      await this.auditService.record(manager, {
        entityType: 'SUPPORT_TICKET_MESSAGE',
        entityId: id,
        action: 'SUPPORT_TICKET_MESSAGE_CREATED',
        actor: authorId,
        newValues: { ticketId, authorType, isInternal },
      });

      // Outbox for message? optional, but emit for visibility (only if not internal to avoid leaking)
      if (!isInternal) {
        await this.outboxService.enqueue(manager, {
          eventType: 'support.ticket.message_added',
          aggregateType: 'SUPPORT_TICKET',
          aggregateId: ticketId,
          correlationId: `support-ticket:${ticketId}`,
          payload: { ticketId, messageId: id, authorType, authorId },
        });
      }

      const rows: Array<any> = await manager.query(
        `SELECT * FROM support_ticket_messages WHERE id=$1 LIMIT 1`,
        [id],
      );
      return this.toMessageView(rows[0]);
    });
    return result;
  }

  async listMessages(
    ticketId: string,
    principal: AuthorizationPrincipal,
  ): Promise<SupportTicketMessageView[]> {
    const tid = this.assertUuid(ticketId, 'ticketId');
    this.assertPrincipal(principal);

    const ticketRows: Array<any> = await this.dataSource.query(
      `SELECT * FROM support_tickets WHERE id=$1 LIMIT 1`,
      [tid],
    );
    if (ticketRows.length === 0) throw new NotFoundException('Support ticket not found');
    const ticket = ticketRows[0];

    // Ownership check for customer/agent
    if (principal.type === 'CUSTOMER') {
      if (ticket.customer_id !== principal.customerId) throw new NotFoundException('Support ticket not found');
    } else if (principal.type === 'AGENT') {
      if (ticket.agent_id !== principal.agentId) throw new NotFoundException('Support ticket not found');
    } else if (!['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type)) {
      throw new ForbiddenException('Principal not allowed to list messages');
    }

    const isWorkforce = ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type);
    const rows: Array<any> = isWorkforce
      ? await this.dataSource.query(
          `SELECT * FROM support_ticket_messages WHERE ticket_id=$1 ORDER BY created_at ASC, id ASC`,
          [tid],
        )
      : await this.dataSource.query(
          `SELECT * FROM support_ticket_messages WHERE ticket_id=$1 AND is_internal=false ORDER BY created_at ASC, id ASC`,
          [tid],
        );
    return rows.map((r) => this.toMessageView(r));
  }

  // ──────────────────────────────────────────────
  // Helpers: mapping
  // ──────────────────────────────────────────────

  private toView(row: any): SupportTicketView {
    return {
      id: row.id,
      reference: row.reference,
      customerId: row.customer_id ?? null,
      agentId: row.agent_id ?? null,
      createdByType: row.created_by_type,
      createdById: row.created_by_id,
      subject: row.subject,
      category: row.category as SupportTicketCategory,
      description: row.description,
      status: row.status as SupportTicketStatus,
      priority: row.priority as SupportTicketPriority,
      assignedTo: row.assigned_to ?? null,
      fundingRequestId: row.funding_request_id ?? null,
      relatedTransferId: row.related_transfer_id ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at ?? null,
      closedAt: row.closed_at ?? null,
      version: row.version,
    };
  }

  private toSafeView(row: any): SupportTicketSafeView {
    // SAFE projection — no assignedTo, no createdBy internal details beyond reference/status
    return {
      id: row.id,
      reference: row.reference,
      subject: row.subject,
      category: row.category as SupportTicketCategory,
      description: row.description,
      status: row.status as SupportTicketStatus,
      priority: row.priority as SupportTicketPriority,
      fundingRequestId: row.funding_request_id ?? null,
      relatedTransferId: row.related_transfer_id ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at ?? null,
      closedAt: row.closed_at ?? null,
      version: row.version,
    };
  }

  private toMessageView(row: any): SupportTicketMessageView {
    return {
      id: row.id,
      ticketId: row.ticket_id,
      authorType: row.author_type,
      authorId: row.author_id,
      body: row.body,
      isInternal: row.is_internal,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ──────────────────────────────────────────────
  // Validation
  // ──────────────────────────────────────────────

  private assertSubject(value: string): string {
    const v = value?.trim();
    if (!v || v.length < 3 || v.length > 200) throw new BadRequestException('subject must be 3 to 200 characters');
    if (/[\u0000-\u001F]/.test(v)) throw new BadRequestException('subject contains invalid characters');
    return v;
  }

  private assertDescription(value: string): string {
    const v = value?.trim();
    if (!v || v.length < 3 || v.length > 4000) throw new BadRequestException('description must be 3 to 4000 characters');
    return v;
  }

  private assertCategory(value: string): SupportTicketCategory {
    if (!Object.values(SupportTicketCategory).includes(value as SupportTicketCategory)) {
      throw new BadRequestException(`category must be one of ${Object.values(SupportTicketCategory).join(', ')}`);
    }
    return value as SupportTicketCategory;
  }

  private assertPriority(value?: string): SupportTicketPriority {
    if (value === undefined || value === null) return SupportTicketPriority.MEDIUM;
    if (!Object.values(SupportTicketPriority).includes(value as SupportTicketPriority)) {
      throw new BadRequestException(`priority must be one of ${Object.values(SupportTicketPriority).join(', ')}`);
    }
    return value as SupportTicketPriority;
  }

  private assertStatus(value: string): SupportTicketStatus {
    if (!Object.values(SupportTicketStatus).includes(value as SupportTicketStatus)) {
      throw new BadRequestException(`status must be one of ${Object.values(SupportTicketStatus).join(', ')}`);
    }
    return value as SupportTicketStatus;
  }

  private assertStatusTransition(current: SupportTicketStatus, next: SupportTicketStatus): void {
    const allowed: Record<SupportTicketStatus, SupportTicketStatus[]> = {
      [SupportTicketStatus.OPEN]: [
        SupportTicketStatus.IN_PROGRESS,
        SupportTicketStatus.RESOLVED,
        SupportTicketStatus.CLOSED,
      ],
      [SupportTicketStatus.IN_PROGRESS]: [SupportTicketStatus.RESOLVED, SupportTicketStatus.CLOSED],
      [SupportTicketStatus.RESOLVED]: [SupportTicketStatus.CLOSED],
      [SupportTicketStatus.CLOSED]: [],
    };
    if (!allowed[current].includes(next)) {
      throw new ConflictException(`Invalid support ticket transition from ${current} to ${next}`);
    }
  }

  private assertUuid(value: string, fieldName: string): string {
    const v = value?.trim();
    if (!v || !UUID_PATTERN.test(v)) throw new BadRequestException(`${fieldName} must be a UUID`);
    return v;
  }

  private optionalUuid(value: string | null | undefined, fieldName: string): string | null {
    if (value === undefined || value === null) return null;
    const v = value.trim();
    if (v.length === 0) return null;
    if (!UUID_PATTERN.test(v)) throw new BadRequestException(`${fieldName} must be a UUID`);
    return v;
  }

  private assertText(value: string, fieldName: string, min: number, max: number): string {
    const v = value?.trim();
    if (!v || v.length < min || v.length > max) throw new BadRequestException(`${fieldName} must be ${min} to ${max} characters`);
    return v;
  }

  private optionalIdempotencyKey(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    const v = value.trim();
    if (v.length === 0) return null;
    if (v.length > 255) throw new BadRequestException('Idempotency-Key must be at most 255 characters');
    return v;
  }

  private normalizePage(page: number): number {
    if (!Number.isSafeInteger(page) || page < 1) throw new BadRequestException('page must be a positive integer');
    return page;
  }

  private normalizeLimit(limit: number): number {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException('limit must be between 1 and 100');
    return limit;
  }

  private assertPrincipal(principal: AuthorizationPrincipal | undefined): AuthorizationPrincipal {
    if (!principal || !principal.type) throw new UnauthorizedException('Authentication required');
    if (!principal.principalId) throw new UnauthorizedException('Principal is invalid');
    return principal;
  }

  private assertWorkforcePrincipal(principal: AuthorizationPrincipal | undefined): AuthorizationPrincipal {
    const p = this.assertPrincipal(principal);
    if (!['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(p.type)) {
      throw new ForbiddenException(`Principal type ${p.type} not allowed for workforce operation`);
    }
    return p;
  }

  private computeRequestHash(params: Record<string, unknown>): string {
    return createHash('sha256').update(this.canonicalJson(params)).digest('hex');
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

  private isRetryableTransactionError(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as { code?: string };
    return driverError.code === '40001' || driverError.code === '40P01';
  }
}
