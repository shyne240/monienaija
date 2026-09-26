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
import { Repository } from 'typeorm';

import { Agent } from '../agent/agent.entity';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
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
  ) {}

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('status') status?: string,
  ) {
    this.requireWorkforce(req);
    const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
    const rawLimit = Number.parseInt(limitRaw ?? '20', 10) || 20;
    const limit = Math.min(100, Math.max(1, rawLimit));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (status) where['status'] = status;

    const [data, total] = await this.repo.findAndCount({
      where: Object.keys(where).length ? (where as never) : {},
      order: { createdAt: 'DESC' } as never,
      skip,
      take: limit,
    });

    return { data, total, page, limit };
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireWorkforce(req);
    this.assertUuid(id, 'id');
    const agent = await this.repo.findOne({ where: { id } as never });
    if (!agent) throw new NotFoundException('Agent not found');
    return this.toSafeAgent(agent);
  }

  // ──────────────────────────────────────────────
  // Admin Agent Investigation — financial position (ledger-derived, reuse WalletService)
  // No getSettlementPosition service found; reuse WalletService.listWallets (authoritative ledger)
  // ──────────────────────────────────────────────
  @Get(':id/financial-position')
  async getFinancialPosition(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireWorkforce(req);
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

  private toSafeAgent(agent: any): any {
    // Safe projection — hide internal fields, expose identity only (no credential hashes)
    // Agent entity: id, reference, status, agentClassId, originApplicationId, version, createdAt, updatedAt, deletedAt
    const { id, reference, status, agentClassId, originApplicationId, version, createdAt, updatedAt, deletedAt } =
      agent as any;
    return { id, reference, status, agentClassId, originApplicationId, version, createdAt, updatedAt, deletedAt };
  }

  private assertUuid(value: string, field: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
  }
}
