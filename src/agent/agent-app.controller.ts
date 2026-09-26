import { Controller, Get, NotFoundException, Param, Req, UnauthorizedException } from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Agent } from './agent.entity';
import { AgentClass } from './agent-class.entity';
import { AgentReceivingNumberService } from './agent-receiving-number.service';
import { AgentServiceCapabilityService } from './agent-service-capability.service';
import { OutletService } from '../outlet/outlet.service';
import { TerminalService } from '../outlet/terminal.service';
import { WalletService } from '../wallet/wallet.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AgentStatus } from './agent.enums';
import { AgentService } from './agent-service.enum';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('agents/me')
export class AgentAppController {
  constructor(
    @InjectRepository(Agent)
    private readonly agentRepository: Repository<Agent>,
    @InjectRepository(AgentClass)
    private readonly agentClassRepository: Repository<AgentClass>,
    private readonly receivingNumberService: AgentReceivingNumberService,
    private readonly capabilityService: AgentServiceCapabilityService,
    private readonly outletService: OutletService,
    private readonly terminalService: TerminalService,
    private readonly walletService: WalletService,
  ) {}

  @Get('profile')
  async getProfile(@Req() req: AuthenticatedRequest) {
    const principal = this.requireAgentPrincipal(req);
    const agent = await this.agentRepository.findOne({ where: { id: principal.agentId } });
    if (!agent || agent.deletedAt !== null) throw new NotFoundException('Agent not found');
    const agentClass = agent.agentClassId ? await this.agentClassRepository.findOne({ where: { id: agent.agentClassId } }) : null;
    return {
      id: agent.id,
      reference: agent.reference,
      status: agent.status,
      agentClassId: agent.agentClassId,
      agentClass: agentClass
        ? {
            id: agentClass.id,
            reference: agentClass.reference,
            code: agentClass.code,
            name: agentClass.name,
            isActive: agentClass.isActive,
          }
        : null,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    };
  }

  @Get('capabilities')
  async getCapabilities(@Req() req: AuthenticatedRequest) {
    const principal = this.requireAgentPrincipal(req);
    const services = [AgentService.CASH_IN, AgentService.CASH_OUT, AgentService.CASH_TO_CASH, AgentService.AGENT_FUNDING, AgentService.AGENT_DEFUNDING];
    const results = await Promise.all(
      services.map((svc) => this.capabilityService.evaluateWithPrincipal(principal.agentId!, svc, principal)),
    );
    const permitted = results.filter((r) => r.allowed).map((r) => r.canonicalService);
    return {
      agentId: principal.agentId,
      permittedServices: permitted,
      evaluations: results.map((r) => ({
        service: r.service,
        canonicalService: r.canonicalService,
        allowed: r.allowed,
        reason: r.reason,
      })),
    };
  }

  @Get('financial-position')
  async getFinancialPosition(@Req() req: AuthenticatedRequest) {
    const principal = this.requireAgentPrincipal(req);
    // Ledger-derived balance via WalletService (source of truth)
    const wallets = await this.walletService.listWallets(principal.agentId!);
    const ngnWallet = wallets.find((w) => w.currency === 'NGN');
    if (!ngnWallet) {
      return {
        agentId: principal.agentId,
        currency: 'NGN',
        balanceMinor: '0',
        availableBalanceMinor: '0',
        walletExists: false,
      };
    }
    // Balance already ledger-derived via WalletService.toView -> ledgerService.getAccountBalance
    return {
      agentId: principal.agentId,
      currency: ngnWallet.currency,
      balanceMinor: ngnWallet.balanceMinor,
      availableBalanceMinor: ngnWallet.balanceMinor,
      walletExists: true,
      walletId: ngnWallet.id,
      ledgerAccountId: ngnWallet.ledgerAccountId,
      status: ngnWallet.status,
    };
  }

  @Get('receiving-number')
  async getReceivingNumber(@Req() req: AuthenticatedRequest) {
    const principal = this.requireAgentPrincipal(req);
    const view = await this.receivingNumberService.getByAgentId(principal.agentId!);
    if (!view) {
      return { agentId: principal.agentId, receivingNumber: null, status: 'NONE' };
    }
    return view;
  }

  @Get('outlets')
  async listOutlets(@Req() req: AuthenticatedRequest) {
    const principal = this.requireAgentPrincipal(req);
    // Reuse OutletService.listByAgent but filter via service's check; it will throw if agent not found
    const outlets = await this.outletService.listByAgent(principal.agentId!);
    // Return safe projection (no audit internals)
    return outlets.map((o) => ({
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
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    }));
  }

  @Get('outlets/:outletId')
  async getOutlet(@Param('outletId') outletId: string, @Req() req: AuthenticatedRequest) {
    const principal = this.requireAgentPrincipal(req);
    const outlet = await this.outletService.getById(outletId);
    if (outlet.agentId !== principal.agentId) throw new NotFoundException('Outlet not found');
    return {
      id: outlet.id,
      agentId: outlet.agentId,
      reference: outlet.reference,
      code: outlet.code,
      name: outlet.name,
      displayName: outlet.displayName,
      status: outlet.status,
      addressLine: outlet.addressLine,
      city: outlet.city,
      state: outlet.state,
      country: outlet.country,
      createdAt: outlet.createdAt,
      updatedAt: outlet.updatedAt,
    };
  }

  @Get('terminals')
  async listTerminals(@Req() req: AuthenticatedRequest) {
    const principal = this.requireAgentPrincipal(req);
    const terminals = await this.terminalService.listByAgent(principal.agentId!);
    return terminals.map((t) => ({
      id: t.id,
      agentId: t.agentId,
      outletId: t.outletId,
      reference: t.reference,
      code: t.code,
      label: t.label,
      status: t.status,
      serialNumber: t.serialNumber,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  }

  @Get('terminals/:terminalId')
  async getTerminal(@Param('terminalId') terminalId: string, @Req() req: AuthenticatedRequest) {
    const principal = this.requireAgentPrincipal(req);
    const terminal = await this.terminalService.getById(terminalId);
    if (terminal.agentId !== principal.agentId) throw new NotFoundException('Terminal not found');
    return {
      id: terminal.id,
      agentId: terminal.agentId,
      outletId: terminal.outletId,
      reference: terminal.reference,
      code: terminal.code,
      label: terminal.label,
      status: terminal.status,
      serialNumber: terminal.serialNumber,
      createdAt: terminal.createdAt,
      updatedAt: terminal.updatedAt,
    };
  }

  private requireAgentPrincipal(req: AuthenticatedRequest): AuthorizationPrincipal {
    const principal = req.authorizationPrincipal;
    if (!principal || principal.type !== 'AGENT' || !principal.agentId) {
      throw new UnauthorizedException('Agent authentication required');
    }
    return principal;
  }
}
