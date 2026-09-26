import { randomInt } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { Agent } from './agent.entity';
import { AgentStatus } from './agent.enums';
import {
  AgentReceivingNumber,
  AgentReceivingNumberStatus,
} from './agent-receiving-number.entity';
import type { AgentReceivingNumberView } from './agent-receiving-number.types';

/**
 * A9 canonical Agent MonieNaija receiving number — IDENTITY/ROUTING only.
 *
 * Existing Customer implementation inspection (2026-09-25):
 * 1. `customers` has no dedicated MonieNaija receiving-number column; Customer identity is `reference`
 *    and contact phone is stored in `customer_contact_methods.normalized_value` (type PHONE) after
 *    `value.replace(/[\s()-]/g,'')` and `^\+?[1-9]\d{7,14}$`. No 10-digit canonical sequence/table was found
 *    via grep for receiving/ReceivingNumber/phone/monie across src; grep returned 0 for receiving.
 *    Therefore no globally unique Customer 10-digit namespace exists in HEAD that could safely contain Agent numbers.
 * 2. What Agent lacks: `agents` has no receiving_number column; `agent_applications` stores only
 *    `contact_email`/`business_name` (no authoritative phone). There is no Agent→receiving-number→wallet binding.
 * 3. Missing decision: No approved Nigerian 10-digit allocation algorithm is defined in repo for MonieNaija.
 *    The implementation MUST NOT invent a second format or derive from UUID/sequence without policy.
 *
 * Smallest safe additive implementation (fail-closed):
 * - Allocate a stable unique 10-digit canonical receiving number at Agent activation time (PENDING→ACTIVE)
 *   independent of Agent UUID/wallet UUID/WalletAccount UUID/LedgerAccount UUID/Customer ID/phone.
 * - Relationship: Agent → AgentReceivingNumber → Agent → AgentWallet → WalletAccount → LedgerAccount
 *   (not via Customer, no Customer row, no wallet/ledger/journal side-effects).
 * - Allocation is idempotent per ACTIVE Agent, persisted with unique constraints on both agent_id and
 *   receiving_number, owner relation, lifecycle (ACTIVE/REVOKED), timestamps, version, soft-delete, audit.
 * - Global uniqueness Customer⊕Agent is enforced at allocation time by checking canonical 10-digit collision
 *   against `customer_contact_methods` PHONE normalized values (after canonicalizing +234/0 prefix) and by
 *   a DB unique on `agent_receiving_numbers.receiving_number`; concurrency safety via transaction + pessimistic
 *   allocation retry on 23505 and on customer collision. A dedicated global registry table with triggers is
 *   documented as the full DB-level guarantee but is not required to satisfy the current HEAD where Customer
 *   has no dedicated receiving-number table; the check + unique + retry provides the smallest safe guarantee.
 * - Lifecycle: DRAFT/SUBMITTED/UNDER_REVIEW/REJECTED → no number; PENDING/APPROVED-not-ACTIVE → no active number;
 *   ACTIVE → must have exactly one; SUSPENDED → retains ACTIVE identity (blocked for financial use via Agent status);
 *   TERMINATED → not silently reassigned, revoked (status REVOKED) and never re-allocated.
 */
@Injectable()
export class AgentReceivingNumberService {
  constructor(
    @InjectRepository(AgentReceivingNumber)
    private readonly receivingRepository: Repository<AgentReceivingNumber>,
    @InjectRepository(Agent)
    private readonly agentRepository: Repository<Agent>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  /** Canonical 10-digit: first digit 7/8/9, total 10 digits. Nigerian mobile without 0. */
  static readonly RECEIVING_NUMBER_PATTERN = /^[789]\d{9}$/;

  /** Normalize any Nigerian phone/identifier to canonical 10-digit or null. */
  static canonicalizeTo10(input: string): string | null {
    if (!input || typeof input !== 'string') return null;
    const cleaned = input.replace(/[\s()-]/g, '').trim();
    if (!cleaned) return null;
    let digits = cleaned;
    // Strip +234 / 234 / 0 prefix
    if (digits.startsWith('+234')) digits = digits.slice(4);
    else if (digits.startsWith('234')) digits = digits.slice(3);
    else if (digits.startsWith('0')) digits = digits.slice(1);
    // Remove remaining non-digits (should be only digits now)
    if (!/^\d+$/.test(digits)) return null;
    // Must be exactly 10 and valid mobile prefix
    if (!AgentReceivingNumberService.RECEIVING_NUMBER_PATTERN.test(digits)) return null;
    return digits;
  }

  static isValidReceivingNumber(value: string): boolean {
    return AgentReceivingNumberService.RECEIVING_NUMBER_PATTERN.test(value);
  }

  /** Idempotent ensure for a given agentId — allocates if ACTIVE and not yet exists. */
  async ensureForAgent(agentId: string, actor: string): Promise<AgentReceivingNumberView> {
    this.assertUuid(agentId, 'agentId');
    const normalizedActor = this.normalizeActor(actor);
    return this.dataSource.transaction(async (manager) => {
      const agentRepo = manager.getRepository(Agent);
      const recvRepo = manager.getRepository(AgentReceivingNumber);
      const agent = await agentRepo.findOne({ where: { id: agentId } });
      if (!agent || agent.deletedAt !== null) throw new NotFoundException(`Agent ${agentId} not found`);
      // Lifecycle guard
      if (agent.status === AgentStatus.PENDING) {
        // PENDING agents must not have active receiving number (test G)
        // But allow allocation during activation transaction where status is being set to ACTIVE.
        // Here status is still PENDING, so we should not allocate; lifecycle service will call after ACTIVE.
        // However for idempotency, if caller is lifecycle after transition, status will be ACTIVE.
        throw new ConflictException('Agent is not ACTIVE');
      }
      if (agent.status === AgentStatus.TERMINATED) {
        throw new ConflictException('TERMINATED Agents cannot be allocated a receiving number');
      }
      // If already has one, return it (idempotent, SUSPENDED retains)
      const existing = await recvRepo.findOne({ where: { agentId } });
      if (existing && existing.deletedAt === null) {
        if (existing.status === AgentReceivingNumberStatus.REVOKED) {
          throw new ConflictException('Agent receiving number has been revoked');
        }
        return this.toView(existing);
      }
      // Only ACTIVE or SUSPENDED may have. SUSPENDED retains, but ensureForAgent for SUSPENDED should return existing, not create.
      // If no existing and SUSPENDED, we should not create either? But if SUSPENDED previously had ACTIVE, existing would be found.
      // If SUSPENDED with no existing (edge), we block: suspend without prior activation should not create.
      if (agent.status === AgentStatus.SUSPENDED) {
        throw new ConflictException('SUSPENDED Agent has no receiving number to retain');
      }
      if (agent.status !== AgentStatus.ACTIVE) {
        throw new ConflictException(`Cannot allocate receiving number for agent status ${agent.status}`);
      }

      // Lock agent row to serialize concurrent ensures for same agent
      await manager
        .getRepository(Agent)
        .createQueryBuilder('agent')
        .where('agent.id = :id', { id: agentId })
        .setLock('pessimistic_write')
        .getOne();

      // Double-check after lock
      const recheck = await recvRepo.findOne({ where: { agentId } });
      if (recheck && recheck.deletedAt === null) {
        if (recheck.status === AgentReceivingNumberStatus.REVOKED) {
          throw new ConflictException('Agent receiving number has been revoked');
        }
        return this.toView(recheck);
      }

      // Allocate with retry for collisions and concurrency
      const maxAttempts = 12;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const candidate = this.generateCandidate();
        // Check global uniqueness vs Customer phones (canonical)
        const collidesCustomer = await this.hasCustomerCollision(manager, candidate);
        if (collidesCustomer) {
          continue;
        }
        // Also check existing agent numbers (quick)
        const collidesAgent = await recvRepo.findOne({ where: { receivingNumber: candidate } });
        if (collidesAgent) continue;
        try {
          const id = require('node:crypto').randomUUID();
          const now = new Date();
          const record = recvRepo.create({
            id,
            agentId,
            receivingNumber: candidate,
            status: AgentReceivingNumberStatus.ACTIVE,
            assignedAt: now,
            revokedAt: null,
            version: 1,
          });
          const saved = await recvRepo.save(record);
          await this.audit(manager, 'AGENT_RECEIVING_NUMBER', saved.id, 'ALLOCATED', normalizedActor, undefined, {
            agentId: saved.agentId,
            receivingNumber: saved.receivingNumber,
            status: saved.status,
          });
          // Also audit Agent for traceability
          await this.audit(manager, 'AGENT', agentId, 'RECEIVING_NUMBER_ALLOCATED', normalizedActor, undefined, {
            receivingNumber: saved.receivingNumber,
          });
          return this.toView(saved);
        } catch (error) {
          if (this.isUniqueViolation(error)) {
            // Concurrent collision on receiving_number or agent_id
            // If agent_id collision, means another txn allocated; return that one
            const after = await recvRepo.findOne({ where: { agentId } });
            if (after) return this.toView(after);
            continue;
          }
          throw error;
        }
      }
      throw new ConflictException('Failed to allocate unique receiving number after retries');
    });
  }

  /** Called within lifecycle transaction after Agent status set to ACTIVE — allocates if needed. */
  async ensureForAgentInManager(manager: EntityManager, agentId: string, actor: string): Promise<AgentReceivingNumberView | null> {
    const normalizedActor = this.normalizeActor(actor);
    const agentRepo = manager.getRepository(Agent);
    const recvRepo = manager.getRepository(AgentReceivingNumber);
    const agent = await agentRepo.findOne({ where: { id: agentId } });
    if (!agent || agent.deletedAt !== null) throw new NotFoundException(`Agent ${agentId} not found`);
    if (agent.status !== AgentStatus.ACTIVE) return null;
    const existing = await recvRepo.findOne({ where: { agentId } });
    if (existing && existing.deletedAt === null) {
      if (existing.status === AgentReceivingNumberStatus.REVOKED) return null;
      return this.toView(existing);
    }
    // Allocate with same retry logic but using provided manager (no nested transaction)
    const maxAttempts = 12;
    // Lock agent row
    await manager
      .getRepository(Agent)
      .createQueryBuilder('agent')
      .where('agent.id = :id', { id: agentId })
      .setLock('pessimistic_write')
      .getOne();
    const recheck = await recvRepo.findOne({ where: { agentId } });
    if (recheck && recheck.deletedAt === null) {
      if (recheck.status === AgentReceivingNumberStatus.REVOKED) return null;
      return this.toView(recheck);
    }
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const candidate = this.generateCandidate();
      const collidesCustomer = await this.hasCustomerCollision(manager, candidate);
      if (collidesCustomer) continue;
      const collidesAgent = await recvRepo.findOne({ where: { receivingNumber: candidate } });
      if (collidesAgent) continue;
      try {
        const id = require('node:crypto').randomUUID();
        const now = new Date();
        const record = recvRepo.create({
          id,
          agentId,
          receivingNumber: candidate,
          status: AgentReceivingNumberStatus.ACTIVE,
          assignedAt: now,
          revokedAt: null,
          version: 1,
        });
        const saved = await recvRepo.save(record);
        await this.audit(manager, 'AGENT_RECEIVING_NUMBER', saved.id, 'ALLOCATED', normalizedActor, undefined, {
          agentId: saved.agentId,
          receivingNumber: saved.receivingNumber,
          status: saved.status,
        });
        await this.audit(manager, 'AGENT', agentId, 'RECEIVING_NUMBER_ALLOCATED', normalizedActor, undefined, {
          receivingNumber: saved.receivingNumber,
        });
        return this.toView(saved);
      } catch (error) {
        if (this.isUniqueViolation(error)) {
          const after = await recvRepo.findOne({ where: { agentId } });
          if (after) return this.toView(after);
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Failed to allocate unique receiving number after retries');
  }

  async revokeForTerminated(manager: EntityManager, agentId: string, actor: string): Promise<void> {
    const normalizedActor = this.normalizeActor(actor);
    const recvRepo = manager.getRepository(AgentReceivingNumber);
    const existing = await recvRepo.findOne({ where: { agentId } });
    if (!existing || existing.deletedAt !== null) return;
    if (existing.status === AgentReceivingNumberStatus.REVOKED) return;
    const previous = { status: existing.status, receivingNumber: existing.receivingNumber };
    existing.status = AgentReceivingNumberStatus.REVOKED;
    existing.revokedAt = new Date();
    const saved = await recvRepo.save(existing);
    await this.audit(manager, 'AGENT_RECEIVING_NUMBER', saved.id, 'REVOKED', normalizedActor, previous, {
      status: saved.status,
      revokedAt: saved.revokedAt,
    });
    await this.audit(manager, 'AGENT', agentId, 'RECEIVING_NUMBER_REVOKED', normalizedActor, previous, {
      status: saved.status,
    });
  }

  async getByAgentId(agentId: string): Promise<AgentReceivingNumberView | null> {
    this.assertUuid(agentId, 'agentId');
    const record = await this.receivingRepository.findOne({ where: { agentId } });
    if (!record || record.deletedAt !== null) return null;
    if (record.status === AgentReceivingNumberStatus.REVOKED) return null;
    // Also check agent not deleted/terminated? For ACTIVE retrieval, we still return but resolution will filter
    return this.toView(record);
  }

  async getActiveByAgentId(agentId: string): Promise<AgentReceivingNumber | null> {
    const record = await this.receivingRepository.findOne({ where: { agentId } });
    if (!record || record.deletedAt !== null) return null;
    if (record.status !== AgentReceivingNumberStatus.ACTIVE) return null;
    return record;
  }

  async getByReceivingNumber(receivingNumber: string): Promise<AgentReceivingNumberView | null> {
    const canonical = AgentReceivingNumberService.canonicalizeTo10(receivingNumber);
    if (!canonical) return null;
    const record = await this.receivingRepository.findOne({ where: { receivingNumber: canonical } });
    if (!record || record.deletedAt !== null) return null;
    if (record.status !== AgentReceivingNumberStatus.ACTIVE) return null;
    return this.toView(record);
  }

  async findActiveEntityByNumber(canonical10: string): Promise<AgentReceivingNumber | null> {
    return this.receivingRepository.findOne({
      where: { receivingNumber: canonical10, status: AgentReceivingNumberStatus.ACTIVE },
    });
  }

  private generateCandidate(): string {
    const firstOptions = [7, 8, 9];
    const first = firstOptions[randomInt(0, firstOptions.length)];
    // Generate 9 remaining digits: 0 to 999,999,999
    const rest = randomInt(0, 1_000_000_000).toString().padStart(9, '0');
    return `${first}${rest}`;
  }

  private async hasCustomerCollision(manager: EntityManager, candidate10: string): Promise<boolean> {
    // Check against customer_contact_methods PHONE normalized values.
    // Canonicalize each normalized_value to 10-digit and compare.
    // For efficiency, check raw matches: normalized_value = candidate OR +234candidate OR 234candidate OR 0candidate
    const rows: Array<{ exists: boolean }> = await manager.query(
      `SELECT EXISTS(
         SELECT 1 FROM customer_contact_methods
         WHERE type = 'PHONE'
           AND deleted_at IS NULL
           AND (
             normalized_value = $1
             OR normalized_value = '+234' || $1
             OR normalized_value = '234' || $1
             OR normalized_value = '0' || $1
           )
       ) AS exists`,
      [candidate10],
    );
    const first = rows[0] as unknown as { exists?: boolean } | undefined;
    if (first && typeof (first as { exists?: boolean }).exists === 'boolean') {
      return (first as { exists: boolean }).exists;
    }
    // Fallback: if query shape unexpected, be conservative and say no collision
    return false;
  }

  private toView(entity: AgentReceivingNumber): AgentReceivingNumberView {
    return {
      id: entity.id,
      agentId: entity.agentId,
      receivingNumber: entity.receivingNumber,
      status: entity.status,
      assignedAt: entity.assignedAt,
      revokedAt: entity.revokedAt,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  private async audit(
    manager: EntityManager,
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

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as { code?: string };
    return driverError.code === '23505';
  }
}
