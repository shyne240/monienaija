import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { WalletOwnerType } from '../wallet/wallet.enums';
import { WalletService } from '../wallet/wallet.service';
import { Agent } from './agent.entity';
import { AgentFinancialAccountBindingState, AgentStatus, AgentWalletStatus } from './agent.enums';
import { AgentFinancialAccountBinding } from './agent-financial-account-binding.entity';
import { AgentWallet } from './agent-wallet.entity';
import {
  AGENT_FLOAT_ACCOUNTING,
  type AgentFloatAccountingConfiguration,
  type EnabledAgentFloatAccounting,
} from './agent-float-accounting';
import type { AgentFloatAccountView, ProvisionAgentFloatAccountCommand } from './agent.types';

const V1_AGENT_CURRENCY = 'NGN';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * F-1 / F-2 — Agent financial identity and dedicated e-float wallet.
 *
 * Establishes, for an Agent, the chain
 *   Agent -> AgentWallet -> WalletAccount -> LedgerAccount
 * plus the persisted binding that makes it deterministic.
 *
 * Supports the CBN Agent Banking requirement for a dedicated agent
 * account/wallet with the Principal. No compliance certification is claimed;
 * final regulatory/accounting validation remains subject to MonieNaija's
 * licensed Principal arrangement and Finance/Compliance approval.
 *
 * WHAT THIS SERVICE DELIBERATELY DOES NOT DO
 *   - Posts no journal and creates no money: provisioning yields a
 *     zero-balance account.
 *   - Implements no Cash->Wallet, Wallet->Cash or Cash->Cash movement, and no
 *     claim, redemption or expiry.
 *   - Implements no funding, commission, fee, limit, PIN or authentication.
 *   - Decides no general-ledger classification: that is Finance
 *     configuration, enforced independently by the database.
 *   - Performs no Agent lifecycle transition.
 */
@Injectable()
export class AgentFinancialAccountService {
  constructor(
    @InjectRepository(Agent)
    private readonly agentRepository: Repository<Agent>,
    @InjectRepository(AgentWallet)
    private readonly agentWalletRepository: Repository<AgentWallet>,
    @InjectRepository(AgentFinancialAccountBinding)
    private readonly bindingRepository: Repository<AgentFinancialAccountBinding>,
    private readonly dataSource: DataSource,
    private readonly walletService: WalletService,
    private readonly auditService: AuditService,
    @Inject(AGENT_FLOAT_ACCOUNTING)
    private readonly floatAccounting: AgentFloatAccountingConfiguration,
  ) {}

  /**
   * Provisions the Agent's dedicated e-float account.
   *
   * Lifecycle: only an ACTIVE Agent may hold financial capability. V1 scope
   * §11.3 ends Agent onboarding at activation, so a bare `agents` row is not
   * sufficient. This service never performs the activation transition itself —
   * that remains the B5-owned lifecycle — it only refuses to provision before
   * it, and refuses for SUSPENDED and TERMINATED agents.
   *
   * Idempotent: an Agent that already holds an open float account gets the
   * existing one back and nothing is created.
   */
  async provisionFloatAccount(
    command: ProvisionAgentFloatAccountCommand,
  ): Promise<AgentFloatAccountView> {
    const agentId = this.requireUuid(command.agentId, 'agentId');
    const actor = this.requireText(command.actor, 'actor');
    const accounting = this.requireFloatAccounting();

    const existing = await this.findOpenBinding(agentId);
    if (existing) return this.toView(existing);

    const agent = await this.agentRepository.findOne({ where: { id: agentId } });
    if (!agent) throw new NotFoundException(`Agent ${agentId} was not found`);
    if (agent.status !== AgentStatus.ACTIVE) {
      throw new UnprocessableEntityException(
        `Agent ${agentId} is ${agent.status}; a dedicated float account is provisioned only for an ACTIVE agent`,
      );
    }

    try {
      const binding = await this.dataSource.transaction(async (manager) =>
        this.provisionInTransaction(manager, agent, accounting, actor, command),
      );
      return this.toView(binding);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const settled = await this.findOpenBinding(agentId);
        if (settled) return this.toView(settled);
        throw new ConflictException(
          `Agent ${agentId} already holds a dedicated float account for ${V1_AGENT_CURRENCY}`,
        );
      }
      throw error;
    }
  }

  /** Deterministic lookup of the Agent's e-float account. Never inferred. */
  async getFloatAccount(agentId: string): Promise<AgentFloatAccountView> {
    const id = this.requireUuid(agentId, 'agentId');
    const binding = await this.findOpenBinding(id);
    if (!binding) throw new NotFoundException(`Agent ${id} has no dedicated float account`);
    return this.toView(binding);
  }

  private async provisionInTransaction(
    manager: EntityManager,
    agent: Agent,
    accounting: EnabledAgentFloatAccounting,
    actor: string,
    command: ProvisionAgentFloatAccountCommand,
  ): Promise<AgentFinancialAccountBinding> {
    const agentWalletRepository = manager.getRepository(AgentWallet);
    const agentWallet = await agentWalletRepository.save(
      agentWalletRepository.create({
        id: randomUUID(),
        agentId: agent.id,
        currency: V1_AGENT_CURRENCY,
        status: AgentWalletStatus.ACTIVE,
        closedAt: null,
      }),
    );

    // Reuses the shared WalletAccount -> LedgerAccount substrate instead of
    // building a parallel financial system. The classification comes from
    // Finance configuration; `allowNegativeBalance` is pinned false so the
    // ledger rejects any posting that would drive Agent e-float negative.
    const walletAccount = await this.walletService.createWalletInTransaction(manager, {
      customerId: agent.id,
      ownerType: WalletOwnerType.AGENT,
      currency: V1_AGENT_CURRENCY,
      idempotencyKey: command.idempotencyKey?.trim() ?? `agent-float-${agent.id}`,
      ledgerAccountSpec: {
        code: `${accounting.accountCodePrefix}-${agentWallet.id}`,
        name: `Agent float ${agent.reference}`,
        accountType: accounting.accountType,
        normalBalance: accounting.normalBalance,
        accountingUnit: accounting.accountingUnit,
        allowNegativeBalance: false,
      },
    });

    const bindingRepository = manager.getRepository(AgentFinancialAccountBinding);
    const binding = await bindingRepository.save(
      bindingRepository.create({
        id: randomUUID(),
        agentId: agent.id,
        agentWalletId: agentWallet.id,
        walletAccountId: walletAccount.id,
        ledgerAccountId: walletAccount.ledgerAccountId,
        currency: V1_AGENT_CURRENCY,
        accountingUnit: accounting.accountingUnit,
        state: AgentFinancialAccountBindingState.ACTIVE,
        createdBy: actor,
        updatedBy: actor,
        lastCorrelationId: command.correlationId ?? null,
        lastRequestId: command.requestId ?? null,
        closedAt: null,
      }),
    );

    await this.auditService.record(manager, {
      entityType: 'AGENT_FINANCIAL_ACCOUNT_BINDING',
      entityId: binding.id,
      action: 'CREATED',
      actor,
      correlationId: command.correlationId,
      requestId: command.requestId,
      newValues: {
        agentId: agent.id,
        agentWalletId: agentWallet.id,
        walletAccountId: walletAccount.id,
        ledgerAccountId: walletAccount.ledgerAccountId,
        currency: V1_AGENT_CURRENCY,
        accountingUnit: accounting.accountingUnit,
        state: AgentFinancialAccountBindingState.ACTIVE,
      },
    });

    return binding;
  }

  private findOpenBinding(agentId: string): Promise<AgentFinancialAccountBinding | null> {
    return this.bindingRepository.findOne({
      where: {
        agentId,
        currency: V1_AGENT_CURRENCY,
        state: AgentFinancialAccountBindingState.ACTIVE,
      },
    });
  }

  /**
   * Fails closed when Finance has not supplied the Agent float classification.
   * No accounting unit, account type or normal balance is ever defaulted, and
   * CUSTOMER_FUNDS is never assumed.
   */
  private requireFloatAccounting(): EnabledAgentFloatAccounting {
    if (!this.floatAccounting.enabled) {
      throw new UnprocessableEntityException(
        'Agent float accounting classification is not configured. The accounting unit and ' +
          'liability classification for Agent e-float are Finance-owned (ADR-0093 F-1/F-2) and ' +
          'must be supplied and approved before a dedicated Agent float account can be provisioned.',
      );
    }
    return this.floatAccounting;
  }

  private toView(binding: AgentFinancialAccountBinding): AgentFloatAccountView {
    return {
      agentId: binding.agentId,
      agentWalletId: binding.agentWalletId,
      walletAccountId: binding.walletAccountId,
      ledgerAccountId: binding.ledgerAccountId,
      currency: binding.currency,
      accountingUnit: binding.accountingUnit,
      state: binding.state,
      bindingId: binding.id,
    };
  }

  private requireUuid(value: unknown, field: string): string {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
    return value.trim();
  }

  private requireText(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) {
      throw new BadRequestException(`${field} must contain 1 to 160 characters`);
    }
    return value.trim();
  }

  private isUniqueViolation(error: unknown): boolean {
    const code = (error as { driverError?: { code?: string } })?.driverError?.code;
    return code === '23505';
  }
}
