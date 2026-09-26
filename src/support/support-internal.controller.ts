import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { SupportService } from './support.service';
import { AssignSupportTicketDto } from './dto/assign-support-ticket.dto';
import { UpdateSupportTicketStatusDto } from './dto/update-support-ticket-status.dto';
import { CreateSupportTicketMessageDto } from './dto/create-support-ticket-message.dto';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal/support')
export class SupportInternalController {
  constructor(private readonly supportService: SupportService) {}

  @Get('tickets')
  async list(
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('agentId') agentId?: string,
    @Query('assignedTo') assignedTo?: string,
    @Req() req?: AuthenticatedRequest,
  ) {
    this.requireWorkforce(req!);
    const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
    const rawLimit = Number.parseInt(limitRaw ?? '20', 10) || 20;
    const limit = Math.min(100, Math.max(1, rawLimit));
    return this.supportService.listForInternal(page, limit, {
      status: status || undefined,
      customerId: customerId || undefined,
      agentId: agentId || undefined,
      assignedTo: assignedTo || undefined,
    });
  }

  @Get('tickets/:id')
  async getOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireWorkforce(req);
    return this.supportService.getForInternal(id);
  }

  @Post('tickets/:id/assign')
  async assign(
    @Param('id') id: string,
    @Body() dto: AssignSupportTicketDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requireWorkforce(req);
    return this.supportService.assignTicket({
      ticketId: id,
      assignedTo: dto.assignedTo,
      principal,
      version: dto.version,
    });
  }

  @Post('tickets/:id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateSupportTicketStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requireWorkforce(req);
    return this.supportService.updateStatus({
      ticketId: id,
      status: dto.status as any,
      principal,
      version: dto.version,
    });
  }

  @Post('tickets/:id/resolve')
  async resolve(
    @Param('id') id: string,
    @Body() dto: { version?: number },
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requireWorkforce(req);
    return this.supportService.updateStatus({
      ticketId: id,
      status: 'RESOLVED' as any,
      principal,
      version: dto?.version,
    });
  }

  @Post('tickets/:id/close')
  async close(
    @Param('id') id: string,
    @Body() dto: { version?: number },
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requireWorkforce(req);
    return this.supportService.updateStatus({
      ticketId: id,
      status: 'CLOSED' as any,
      principal,
      version: dto?.version,
    });
  }

  @Post('tickets/:id/messages')
  async addMessage(
    @Param('id') id: string,
    @Body() dto: CreateSupportTicketMessageDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requireWorkforce(req);
    return this.supportService.addMessage({
      ticketId: id,
      body: dto.body,
      isInternal: dto.isInternal ?? false,
      principal,
    });
  }

  @Get('tickets/:id/messages')
  async listMessages(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const principal = this.requireWorkforce(req);
    return this.supportService.listMessages(id, principal);
  }

  private requireWorkforce(req: AuthenticatedRequest): AuthorizationPrincipal {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (principal.type === 'CUSTOMER' || principal.type === 'AGENT' || (principal.type as string) === 'AGGREGATOR') {
      throw new ForbiddenException('Customer/Agent not allowed on workforce route');
    }
    if (!['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type)) {
      throw new ForbiddenException(`Principal type ${principal.type} not allowed`);
    }
    return principal;
  }
}
