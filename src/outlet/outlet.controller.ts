import { Body, Controller, Get, HttpCode, Param, Post, Req, UnauthorizedException } from '@nestjs/common';

import { OutletService } from './outlet.service';
import { TerminalService } from './terminal.service';
import { CreateOutletDto } from './dto/create-outlet.dto';
import { CreateTerminalDto } from './dto/create-terminal.dto';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal')
export class OutletController {
  constructor(
    private readonly outletService: OutletService,
    private readonly terminalService: TerminalService,
  ) {}

  // ----- Outlets -----
  @Post('agents/:agentId/outlets')
  @HttpCode(201)
  async createOutlet(@Param('agentId') agentId: string, @Body() dto: CreateOutletDto, @Req() req: AuthenticatedRequest) {
    const actor = this.requirePrivileged(req);
    const principal = req.authorizationPrincipal;
    return this.outletService.create({
      agentId,
      reference: dto.reference,
      code: dto.code,
      name: dto.name,
      displayName: dto.displayName,
      addressLine: dto.addressLine,
      city: dto.city,
      state: dto.state,
      country: dto.country,
      actor,
      principal: principal as any,
    });
  }

  @Post('aggregators/:aggregatorId/agents/:agentId/outlets')
  @HttpCode(201)
  async createOutletViaAggregator(
    @Param('aggregatorId') aggregatorId: string,
    @Param('agentId') agentId: string,
    @Body() dto: CreateOutletDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = this.requirePrivileged(req);
    const principal = req.authorizationPrincipal;
    return this.outletService.create({
      agentId,
      aggregatorId,
      reference: dto.reference,
      code: dto.code,
      name: dto.name,
      displayName: dto.displayName,
      addressLine: dto.addressLine,
      city: dto.city,
      state: dto.state,
      country: dto.country,
      actor,
      principal: principal as any,
    });
  }

  @Get('agents/:agentId/outlets')
  async listOutlets(@Param('agentId') agentId: string, @Req() req: AuthenticatedRequest) {
    this.requirePrivileged(req);
    return this.outletService.listByAgent(agentId);
  }

  @Get('outlets/:outletId')
  async getOutlet(@Param('outletId') outletId: string, @Req() req: AuthenticatedRequest) {
    this.requirePrivileged(req);
    return this.outletService.getById(outletId);
  }

  @Post('outlets/:outletId/suspend')
  @HttpCode(200)
  async suspendOutlet(@Param('outletId') outletId: string, @Req() req: AuthenticatedRequest) {
    const actor = this.requirePrivileged(req);
    return this.outletService.suspend(outletId, actor);
  }

  @Post('outlets/:outletId/reactivate')
  @HttpCode(200)
  async reactivateOutlet(@Param('outletId') outletId: string, @Req() req: AuthenticatedRequest) {
    const actor = this.requirePrivileged(req);
    return this.outletService.reactivate(outletId, actor);
  }

  @Post('outlets/:outletId/terminate')
  @HttpCode(200)
  async terminateOutlet(@Param('outletId') outletId: string, @Req() req: AuthenticatedRequest) {
    const actor = this.requirePrivileged(req);
    return this.outletService.terminate(outletId, actor);
  }

  // ----- Terminals -----
  @Post('outlets/:outletId/terminals')
  @HttpCode(201)
  async createTerminalViaOutlet(
    @Param('outletId') outletId: string,
    @Body() dto: CreateTerminalDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = this.requirePrivileged(req);
    const principal = req.authorizationPrincipal;
    // outletId param must match body.outletId if provided, else use param
    const effectiveOutletId = dto.outletId ?? outletId;
    if (dto.outletId && dto.outletId !== outletId) {
      throw new UnauthorizedException('outletId mismatch');
    }
    // Need agentId via outlet lookup — service will verify, but we need agentId
    // We will fetch outlet to get agentId
    const outlet = await this.outletService.getById(outletId);
    return this.terminalService.create({
      agentId: outlet.agentId,
      outletId: effectiveOutletId,
      reference: dto.reference,
      code: dto.code,
      label: dto.label,
      serialNumber: dto.serialNumber,
      actor,
      principal: principal as any,
    });
  }

  @Post('agents/:agentId/terminals')
  @HttpCode(201)
  async createTerminal(
    @Param('agentId') agentId: string,
    @Body() dto: CreateTerminalDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = this.requirePrivileged(req);
    const principal = req.authorizationPrincipal;
    return this.terminalService.create({
      agentId,
      outletId: dto.outletId,
      reference: dto.reference,
      code: dto.code,
      label: dto.label,
      serialNumber: dto.serialNumber,
      actor,
      principal: principal as any,
    });
  }

  @Post('aggregators/:aggregatorId/agents/:agentId/terminals')
  @HttpCode(201)
  async createTerminalViaAggregator(
    @Param('aggregatorId') aggregatorId: string,
    @Param('agentId') agentId: string,
    @Body() dto: CreateTerminalDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = this.requirePrivileged(req);
    const principal = req.authorizationPrincipal;
    return this.terminalService.create({
      agentId,
      outletId: dto.outletId,
      reference: dto.reference,
      code: dto.code,
      label: dto.label,
      serialNumber: dto.serialNumber,
      actor,
      aggregatorId,
      principal: principal as any,
    });
  }

  @Get('outlets/:outletId/terminals')
  async listTerminalsByOutlet(@Param('outletId') outletId: string, @Req() req: AuthenticatedRequest) {
    this.requirePrivileged(req);
    return this.terminalService.listByOutlet(outletId);
  }

  @Get('agents/:agentId/terminals')
  async listTerminalsByAgent(@Param('agentId') agentId: string, @Req() req: AuthenticatedRequest) {
    this.requirePrivileged(req);
    return this.terminalService.listByAgent(agentId);
  }

  @Get('terminals/:terminalId')
  async getTerminal(@Param('terminalId') terminalId: string, @Req() req: AuthenticatedRequest) {
    this.requirePrivileged(req);
    return this.terminalService.getById(terminalId);
  }

  @Post('terminals/:terminalId/suspend')
  @HttpCode(200)
  async suspendTerminal(@Param('terminalId') terminalId: string, @Req() req: AuthenticatedRequest) {
    const actor = this.requirePrivileged(req);
    return this.terminalService.suspend(terminalId, actor);
  }

  @Post('terminals/:terminalId/reactivate')
  @HttpCode(200)
  async reactivateTerminal(@Param('terminalId') terminalId: string, @Req() req: AuthenticatedRequest) {
    const actor = this.requirePrivileged(req);
    return this.terminalService.reactivate(terminalId, actor);
  }

  @Post('terminals/:terminalId/terminate')
  @HttpCode(200)
  async terminateTerminal(@Param('terminalId') terminalId: string, @Req() req: AuthenticatedRequest) {
    const actor = this.requirePrivileged(req);
    return this.terminalService.terminate(terminalId, actor);
  }

  private requirePrivileged(req: AuthenticatedRequest): string {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    const type = (principal.type ?? '').toUpperCase();
    if (type === 'AGENT' || type === 'CUSTOMER' || type === 'AGGREGATOR') {
      throw new UnauthorizedException('Privileged access required');
    }
    // Allow SUPPORT, OPERATOR, SERVICE, PRIVILEGED, WORKFORCE etc.
    return principal.principalId;
  }
}
