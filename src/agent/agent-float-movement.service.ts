import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { parsePositiveMinorUnits } from '../common/money';
import { LedgerEntryDirection } from '../ledger/ledger.enums';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../operations/audit.service';
import { SettlementAccountRole } from '../payment/payment.enums';
import { SettlementAccountService } from '../payment/settlement-account.service';
import { AgentFinancialAccountBinding } from './agent-financial-account-binding.entity';
import { Agent } from './agent.entity';
import { AgentFinancialAccountBindingState, AgentStatus } from './agent.enums';
import {
  AgentFloatMovementKind,
  type AgentFloatMovementCommand,
  type AgentFloatMovementView,
} from './agent-float-movement.types';

const V1_AGENT_CURRENCY = 'NGN';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * F-5 — Agent float funding and defunding.
 *
 * WHAT THIS IS
 *   A controlled, balanced, idempotent INTERNAL ledger operation that moves
 *   the platform's accounting position between the payment settlement asset
 *   and an Agent's e-float liability:
 *
 *     FUNDING   DR PAYMENT-SETTLEMENT_ASSET-NGN   CR Agent float
 *     DEFUNDING DR Agent float                    CR PAYMENT-SETTLEMENT_ASSET-NGN
 *
 * WHAT THIS IS NOT
 *   It does not move money through NIBSS, a bank or any provider; it does not
 *   confirm an external settlement; and it does not record that an Agent
 *   handed over physical cash. Provider integration is frozen (`roadmap.md`
 *   rule 4) and the resulting view always reports `externallySettled: false`.
 *
 * REUSE, NOT REINVENTION
 *   - Posting: the existing `LedgerService` journal engine. No second engine.
 *   - Settlement account: resolved through the existing
 *     `SettlementAccountService`, the repository's configured mechanism. No
 *     new Finance account is created here.
 *   - Idempotency: the ledger's own journal idempotency. A replay returns the
 *     original journal; the same key with a materially different request is
 *     rejected by the stored request hash.
 *   - Locking and no-overdraft: the ledger locks participating accounts
 *     `FOR UPDATE` ordered by id and projects balances INSIDE that boundary,
 *     so a defunding that would drive Agent float negative is rejected even
 *     under concurrency. No separate balance pre-check is performed, because
 *     a pre-check outside the lock would be racy.
 *   - Balance: always read from `LedgerService`. No balance column, no cache,
 *     no shadow ledger.
 */
@Injectable()
export class AgentFloatMovementService {
  constructor(
    @InjectRepository(Agent)
    private readonly agentRepository: Repository<Agent>,
    @InjectRepository(AgentFinancialAccountBinding)
    private readonly bindingRepository: Repository<AgentFinancialAccountBinding>,
    private readonly dataSource: DataSource,
    private readonly ledgerService: LedgerService,
    private readonly settlementAccountService: SettlementAccountService,
    private readonly auditService: AuditService,
  ) {}

  /** Increases an ACTIVE Agent's e-float. Internal posting only. */
  async fundFloat(command: AgentFloatMovementCommand): Promise<AgentFloatMovementView> {
    return this.move(AgentFloatMovementKind.FUNDING, command);
  }

  /**
   * Decreases an ACTIVE Agent's e-float. Internal posting only.
   *
   * Cannot overdraw: the Agent float ledger account is provisioned with
   * `allowNegativeBalance = false`, and the ledger enforces that inside the
   * locked transaction.
   */
  async defundFloat(command: AgentFloatMovementCommand): Promise<AgentFloatMovementView> {
    return this.move(AgentFloatMovementKind.DEFUNDING, command);
  }

  private async move(
    kind: AgentFloatMovementKind,
    command: AgentFloatMovementCommand,
  ): Promise<AgentFloatMovementView> {
    const agentId = this.requireUuid(command.agentId, 'agentId');
    const actor = this.requireText(command.actor, 'actor', 160);
    const idempotencyKey = this.requireText(command.idempotencyKey, 'idempotencyKey', 255);
    const amountMinor = parsePositiveMinorUnits(command.amountMinor).toString();

    const agent = await this.agentRepository.findOne({ where: { id: agentId } });
    if (!agent) throw new NotFoundException(`Agent ${agentId} was not found`);
    // Only an ACTIVE agent may move float. PENDING agents are not yet
    // operational; SUSPENDED and TERMINATED agents must not transact.
    // Residual-float settlement for SUSPENDED/TERMINATED agents is a separate
    // governance decision and is deliberately NOT implemented here.
    if (agent.status !== AgentStatus.ACTIVE) {
      throw new UnprocessableEntityException(
        `Agent ${agentId} is ${agent.status}; float movement requires an ACTIVE agent`,
      );
    }

    const binding = await this.bindingRepository.findOne({
      where: {
        agentId,
        currency: V1_AGENT_CURRENCY,
        state: AgentFinancialAccountBindingState.ACTIVE,
      },
    });
    if (!binding) {
      throw new NotFoundException(`Agent ${agentId} has no dedicated float account`);
    }

    const posted = await this.dataSource.transaction(async (manager: EntityManager) => {
      const settlementAccountId = await this.settlementAccountService.getAccountId(
        manager,
        V1_AGENT_CURRENCY,
        SettlementAccountRole.SETTLEMENT_ASSET,
      );

      const funding = kind === AgentFloatMovementKind.FUNDING;
      const postedJournalId = await this.ledgerService.postJournalInTransaction(manager, {
        idempotencyKey,
        currency: V1_AGENT_CURRENCY,
        accountingUnit: binding.accountingUnit,
        reference: `agent-float:${kind.toLowerCase()}:${agent.id}`,
        description:
          command.reason?.trim() ||
          `Internal agent float ${kind.toLowerCase()} for agent ${agent.reference}`,
        correlationId: command.correlationId ?? `agent-float:${agent.id}`,
        metadata: {
          agentFloatMovement: kind,
          agentId: agent.id,
          agentWalletId: binding.agentWalletId,
          walletAccountId: binding.walletAccountId,
          // Explicit: this posting asserts no external settlement.
          externallySettled: false,
        },
        lines: [
          {
            accountId: funding ? settlementAccountId : binding.ledgerAccountId,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor,
          },
          {
            accountId: funding ? binding.ledgerAccountId : settlementAccountId,
            direction: LedgerEntryDirection.CREDIT,
            amountMinor,
          },
        ],
      });

      await this.auditService.record(manager, {
        entityType: 'AGENT_FLOAT_MOVEMENT',
        entityId: postedJournalId,
        action: kind,
        actor,
        correlationId: command.correlationId,
        requestId: command.requestId,
        newValues: {
          agentId: agent.id,
          agentWalletId: binding.agentWalletId,
          walletAccountId: binding.walletAccountId,
          ledgerAccountId: binding.ledgerAccountId,
          settlementAccountId,
          currency: V1_AGENT_CURRENCY,
          amountMinor,
          journalId: postedJournalId,
          idempotencyKey,
          reason: command.reason?.trim() ?? null,
          externallySettled: false,
        },
      });

      return { journalId: postedJournalId, settlementAccountId };
    });

    // Balance is read AFTER the posting transaction commits, always from the
    // ledger authority. Nothing is stored or cached.
    const balance = await this.ledgerService.getAccountBalance(binding.ledgerAccountId);

    return {
      kind,
      agentId: agent.id,
      agentWalletId: binding.agentWalletId,
      walletAccountId: binding.walletAccountId,
      ledgerAccountId: binding.ledgerAccountId,
      settlementAccountId: posted.settlementAccountId,
      currency: V1_AGENT_CURRENCY,
      amountMinor,
      journalId: posted.journalId,
      idempotencyKey,
      balanceMinor: balance.balanceMinor,
      externallySettled: false,
      postedAt: new Date().toISOString(),
    };
  }

  private requireUuid(value: unknown, field: string): string {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
    return value.trim();
  }

  private requireText(value: unknown, field: string, max: number): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
      throw new BadRequestException(`${field} must contain 1 to ${max} characters`);
    }
    return value.trim();
  }
}
