import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';

import { Agent } from '../agent/agent.entity';
import { AgentStatus } from '../agent/agent.enums';
import { AggregatorAgentAssignment } from '../aggregator/aggregator-agent-relationship.entity';
import { AggregatorAgentRelationshipStatus } from '../aggregator/aggregator.enums';
import { AgentTransactionHistoryService } from '../agent/agent-transaction-history.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AuthorizationService } from '../authorization/authorization.service';
import { WalletService } from '../wallet/wallet.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal/agents')
export class AdminAgentController {
  constructor(
    @InjectRepository(Agent) private readonly repo: Repository<Agent>,
    private readonly walletService: WalletService,
    private readonly auth: AuthorizationService,
    private readonly historyService: AgentTransactionHistoryService,
  ) {}

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('agentClassId') agentClassId?: string,
    @Query('aggregatorId') aggregatorId?: string,
    @Query('sort') sort?: string,
  ) {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'agent.view');
    const page = this.directoryInteger(pageRaw, 1, 'page');
    const limit = Math.min(100, this.directoryInteger(limitRaw, 20, 'limit'));
    if (page > Math.floor(Number.MAX_SAFE_INTEGER / 100))
      throw new BadRequestException('page is out of range');
    if (status !== undefined && !Object.values(AgentStatus).includes(status as AgentStatus))
      throw new BadRequestException('Invalid agent status');
    if (agentClassId !== undefined) this.assertUuid(agentClassId, 'agentClassId');
    if (aggregatorId !== undefined) this.assertUuid(aggregatorId, 'aggregatorId');
    if (sort !== undefined && sort !== 'newest' && sort !== 'oldest')
      throw new BadRequestException('Invalid agent sort');
    if (search !== undefined && (typeof search !== 'string' || search.length > 160))
      throw new BadRequestException('search must be at most 160 characters');

    const direction = sort === 'oldest' ? 'ASC' : 'DESC';
    const query = this.repo.createQueryBuilder('agent');
    if (status) query.andWhere('agent.status = :status', { status });
    if (agentClassId) query.andWhere('agent.agentClassId = :agentClassId', { agentClassId });
    if (aggregatorId) {
      // Directory membership uses the active aggregator assignment, never an outlet or
      // an institutional affiliation. EXISTS keeps the Agent count independent of history rows.
      const assignment = query
        .subQuery()
        .select('1')
        .from(AggregatorAgentAssignment, 'assignment')
        .where('assignment.agentId = agent.id')
        .andWhere('assignment.aggregatorId = :aggregatorId')
        .andWhere('assignment.status = :assignmentStatus');
      query.andWhere(`EXISTS ${assignment.getQuery()}`, {
        aggregatorId,
        assignmentStatus: AggregatorAgentRelationshipStatus.ACTIVE,
      });
    }
    const term = search?.trim();
    if (term) {
      query.andWhere(
        new Brackets((match) => {
          match.where("agent.reference ILIKE :reference ESCAPE '!'", {
            reference: `%${term.replace(/[!%_]/g, '!$&')}%`,
          });
          if (this.isUuid(term)) match.orWhere('agent.id = :id', { id: term });
        }),
      );
    }
    const [rows, total] = await query
      .orderBy('agent.createdAt', direction)
      .addOrderBy('agent.id', direction)
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return { data: rows.map((agent) => this.toSafeAgent(agent)), total, page, limit };
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'agent.view');
    this.assertUuid(id, 'id');
    const agent = await this.repo.findOne({ where: { id } as never });
    if (!agent) throw new NotFoundException('Agent not found');
    return this.toSafeAgent(agent);
  }

  /** Workforce can identify legacy agents needing self-service phone proof, without exposing the number. */
  @Get(':id/phone-verification')
  async phoneVerification(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'agent.view');
    this.assertUuid(id, 'id');
    const agent = await this.repo.findOne({ where: { id } as never });
    if (!agent) throw new NotFoundException('Agent not found');
    const rows: Array<{ canonical_phone: string; verified_at: Date; sms_enabled: boolean | null }> =
      await this.repo.manager.query(
        `SELECT p.canonical_phone,p.verified_at,n.sms_enabled
        FROM agent_verified_phone_contacts p LEFT JOIN agent_notification_preferences n ON n.agent_id=p.agent_id
        WHERE p.agent_id=$1 AND p.revoked_at IS NULL`,
        [id],
      );
    const contact = rows[0];
    return {
      agentId: id,
      verified: !!contact,
      phoneSuffix: contact ? contact.canonical_phone.slice(-4) : null,
      verifiedAt: contact?.verified_at ?? null,
      smsEnabled: contact?.sms_enabled === true,
    };
  }

  // ──────────────────────────────────────────────
  // Admin Agent Investigation — financial position (ledger-derived, reuse WalletService)
  // No getSettlementPosition service found; reuse WalletService.listWallets (authoritative ledger)
  // ──────────────────────────────────────────────
  @Get(':id/financial-position')
  async getFinancialPosition(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'agent.view');
    this.assertUuid(id, 'id');
    const agent = await this.repo.findOne({ where: { id } as never });
    if (!agent) throw new NotFoundException('Agent not found');
    // Reuse authoritative ledger-derived wallet position — no balance column, no second ledger
    const wallets = await this.walletService.listWallets(id);
    const ngnWallet = wallets.find((w) => w.currency === 'NGN');
    if (!ngnWallet) {
      return {
        agentId: id,
        currency: 'NGN',
        balanceMinor: '0',
        availableBalanceMinor: '0',
        walletExists: false,
        walletId: null,
        status: null,
      };
    }
    // Safe projection — hide ledgerAccountId/creationIdempotencyKey, expose currency/balance explicitly
    return {
      agentId: id,
      currency: ngnWallet.currency,
      balanceMinor: ngnWallet.balanceMinor,
      availableBalanceMinor: ngnWallet.balanceMinor,
      walletExists: true,
      walletId: ngnWallet.id,
      status: ngnWallet.status,
    };
  }

  /**
   * V1-SPRINT3-AGENT-HISTORY-API-01 (ARENA 3): workforce read of an Agent's unified
   * transaction history. This is the SAME read-only projection the Agent-facing
   * GET /agents/me/transactions serves (AgentTransactionHistoryService.listUnified,
   * V1-AGENT-HISTORY-01) — identical item schema, merge ordering (created_at DESC, id DESC),
   * pagination shape and type filter. Nothing is synthesized and no accounting event is
   * double-counted: the service projects authoritative records (ledger journals for
   * CASH_IN/CASH_OUT/funding, cash_to_cash_transfers rows for initiated C2C lifecycle,
   * claim audit events for CASH_TO_CASH_CLAIM) and every query is filtered at the boundary
   * by the requested Agent's own wallet ledger accounts / agent_id.
   *
   * Authorization mirrors the sibling investigation reads on this controller
   * (requireWorkforce + requireFunction 'agent.view'), and the RoutePolicyRegistry declares
   * the same gate for defense in depth. Ownership/scope: the :id path parameter is the
   * Agent resource; workforce callers entitled to agent.view may inspect any Agent (this
   * is the workforce investigation surface), while Agents themselves continue to use the
   * SELF-bound /agents/me/transactions route.
   *
   * Query params (all optional; validated by the history service):
   *   page  — integer >= 1 (default 1)
   *   limit — integer 1..100 (default 20)
   *   type  — CASH_IN | CASH_OUT | CASH_TO_CASH | CASH_TO_CASH_CLAIM | AGENT_FUNDING | AGENT_DEFUNDING |
   *           WALLET_TRANSFER | EXTERNAL_BANK_TRANSFER
   * Response: { items: AgentUnifiedHistoryItem[], pagination: { page, limit, total, totalPages, hasNextPage } }
   */
  @Get(':id/transactions')
  async getTransactions(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
  ) {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'agent.view');
    this.assertUuid(id, 'id');
    const agent = await this.repo.findOne({ where: { id } as never });
    if (!agent) throw new NotFoundException('Agent not found');
    return this.historyService.listUnified({ agentId: id, page, limit, type });
  }

  private requireWorkforce(req: AuthenticatedRequest): string {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (
      principal.type === 'AGENT' ||
      principal.type === 'CUSTOMER' ||
      (principal.type as string) === 'AGGREGATOR'
    ) {
      throw new UnauthorizedException('Privileged access required');
    }
    return principal.principalId;
  }

  private requireFunction(req: AuthenticatedRequest, functionCode: string): Promise<string> {
    return this.auth.requireFunction(req.authorizationPrincipal, functionCode, 'internal-agents', [
      // SUPPORT is an intended read-side principal of the agent investigation surface
      // (V1-HARDENING-07 test 1 asserts SUPPORT/OPERATOR/SERVICE/PRIVILEGED allowed on
      // financial-position; A22 tests 4-6 assert the same on agent list/get reads). This
      // controller is exclusively read/inspection; agent lifecycle writes (suspend/terminate/
      // fund/...) live on their own controllers with their own principal-type restrictions.
      'SUPPORT',
      'OPERATOR',
      'SERVICE',
      'PRIVILEGED',
    ]);
  }

  private toSafeAgent(agent: Agent) {
    // Safe projection — hide internal fields, expose identity only (no credential hashes)
    // Agent entity: id, reference, status, agentClassId, originApplicationId, version, createdAt, updatedAt, deletedAt
    const {
      id,
      reference,
      status,
      agentClassId,
      originApplicationId,
      version,
      createdAt,
      updatedAt,
      deletedAt,
    } = agent;
    return {
      id,
      reference,
      status,
      agentClassId,
      originApplicationId,
      version,
      createdAt,
      updatedAt,
      deletedAt,
    };
  }

  private directoryInteger(value: string | undefined, fallback: number, field: string): number {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (
      typeof value !== 'string' ||
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(parsed) ||
      parsed < 1
    )
      throw new BadRequestException(`${field} must be a positive integer`);
    return parsed;
  }

  private isUuid(value: unknown): value is string {
    return (
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    );
  }

  private assertUuid(value: string, field: string): void {
    if (!this.isUuid(value)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
  }
}
