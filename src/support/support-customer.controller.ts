import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { SupportService } from './support.service';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { CreateSupportTicketMessageDto } from './dto/create-support-ticket-message.dto';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('customers/me/support')
export class SupportCustomerController {
  constructor(private readonly supportService: SupportService) {}

  @Post('tickets')
  async create(
    @Body() dto: CreateSupportTicketDto,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Headers('Idempotency-Key') idempotencyKeyHeader2: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requireCustomer(req);
    const idempotencyKey =
      idempotencyKeyHeader?.trim() || idempotencyKeyHeader2?.trim() || null;
    const result = await this.supportService.createTicket({
      subject: dto.subject,
      category: dto.category as any,
      description: dto.description,
      priority: dto.priority as any,
      fundingRequestId: dto.fundingRequestId ?? null,
      relatedTransferId: dto.relatedTransferId ?? null,
      idempotencyKey,
      principal,
    });
    // Return safe view for customer
    return {
      id: result.id,
      reference: result.reference,
      subject: result.subject,
      category: result.category,
      description: result.description,
      status: result.status,
      priority: result.priority,
      fundingRequestId: result.fundingRequestId,
      relatedTransferId: result.relatedTransferId,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      resolvedAt: result.resolvedAt,
      closedAt: result.closedAt,
      version: result.version,
    };
  }

  @Get('tickets')
  async list(
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
    @Req() req?: AuthenticatedRequest,
  ) {
    const principal = this.requireCustomer(req!);
    const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
    const rawLimit = Number.parseInt(limitRaw ?? '20', 10) || 20;
    const limit = Math.min(100, Math.max(1, rawLimit));
    return this.supportService.listForCustomer(principal.customerId!, page, limit);
  }

  @Get('tickets/:id')
  async getOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const principal = this.requireCustomer(req);
    return this.supportService.getForCustomer(id, principal.customerId!);
  }

  @Post('tickets/:id/messages')
  async addMessage(
    @Param('id') id: string,
    @Body() dto: CreateSupportTicketMessageDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requireCustomer(req);
    if (dto.isInternal) throw new ForbiddenException('Customer cannot create internal messages');
    return this.supportService.addMessage({
      ticketId: id,
      body: dto.body,
      isInternal: false,
      principal,
    });
  }

  @Get('tickets/:id/messages')
  async listMessages(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const principal = this.requireCustomer(req);
    return this.supportService.listMessages(id, principal);
  }

  private requireCustomer(req: AuthenticatedRequest): AuthorizationPrincipal {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (principal.type !== 'CUSTOMER') throw new ForbiddenException('Customer access required');
    if (!principal.customerId) throw new ForbiddenException('Customer principal missing customerId');
    return principal;
  }
}
