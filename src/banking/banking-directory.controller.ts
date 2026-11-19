import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { BankingDirectoryService } from './banking-directory.service';
import { BankingAccountEnquiryService } from './banking-account-enquiry.service';

interface AuthenticatedRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
  headers: Record<string, string | string[] | undefined>;
}

function requireCustomer(req: AuthenticatedRequest): string {
  const p = req.authorizationPrincipal;
  if (!p || p.type !== 'CUSTOMER' || !p.customerId)
    throw new UnauthorizedException('Customer authentication required');
  return p.customerId;
}
function requireAgent(req: AuthenticatedRequest): string {
  const p = req.authorizationPrincipal;
  if (!p || p.type !== 'AGENT' || !p.agentId)
    throw new UnauthorizedException('Agent authentication required');
  return p.agentId;
}

/**
 * G10 — customer and agent facing bank directory + account-name enquiry.
 *
 * Four routes, two principals, one directory authority and one provider contract:
 * - directory is always the stored `banks` table, filtered to ACTIVE+NIP_SUPPORTED;
 * - name enquiry is always the provider's `enquireAccountName` capability when a usable provider exists,
 *   otherwise UNAVAILABLE — never a local guess.
 * - every enquiry is scoped to the caller's own institution (derived from their wallet), so a
 *   customer cannot drive a provider lookup for an institution they do not belong to.
 */
@Controller('customers/me/banking')
export class CustomerBankingDirectoryController {
  constructor(
    private readonly directory: BankingDirectoryService,
    private readonly enquiry: BankingAccountEnquiryService,
  ) {}

  @Get('banks')
  async banks(@Req() req: AuthenticatedRequest, @Query('search') search?: string) {
    requireCustomer(req);
    if (search !== undefined && typeof search !== 'string')
      throw new BadRequestException('search must be a string');
    const items = await this.directory.listForSelfService(search);
    return { items };
  }

  @Post('account-enquiry')
  async enquire(
    @Req() req: AuthenticatedRequest,
    @Body() body: { bankCode?: string; accountNumber?: string; walletId?: string },
  ) {
    const customerId = requireCustomer(req);
    if (!body || typeof body !== 'object') throw new BadRequestException('Invalid request body');
    const { bankCode, accountNumber, walletId } = body as Record<string, unknown>;
    if (typeof bankCode !== 'string' || typeof accountNumber !== 'string')
      throw new BadRequestException('bankCode and accountNumber are required');
    if (walletId !== undefined && typeof walletId !== 'string')
      throw new BadRequestException('walletId must be a string');
    const result = await this.enquiry.enquireForCustomer(
      customerId,
      walletId as string | undefined,
      bankCode,
      accountNumber,
    );
    return {
      bankCode: result.providerBankCode,
      accountNumber: result.accountNumber,
      outcome: result.outcome,
      ...(result.accountName ? { accountName: result.accountName } : {}),
      establishesAccountOwnership: result.establishesAccountOwnership,
      correlationId: result.correlationId,
    };
  }
}

@Controller('agents/me/banking')
export class AgentBankingDirectoryController {
  constructor(
    private readonly directory: BankingDirectoryService,
    private readonly enquiry: BankingAccountEnquiryService,
  ) {}

  @Get('banks')
  async banks(@Req() req: AuthenticatedRequest, @Query('search') search?: string) {
    requireAgent(req);
    if (search !== undefined && typeof search !== 'string')
      throw new BadRequestException('search must be a string');
    const items = await this.directory.listForSelfService(search);
    return { items };
  }

  @Post('account-enquiry')
  async enquire(
    @Req() req: AuthenticatedRequest,
    @Body() body: { bankCode?: string; accountNumber?: string; walletId?: string },
  ) {
    const agentId = requireAgent(req);
    if (!body || typeof body !== 'object') throw new BadRequestException('Invalid request body');
    const { bankCode, accountNumber, walletId } = body as Record<string, unknown>;
    if (typeof bankCode !== 'string' || typeof accountNumber !== 'string')
      throw new BadRequestException('bankCode and accountNumber are required');
    if (walletId !== undefined && typeof walletId !== 'string')
      throw new BadRequestException('walletId must be a string');
    const result = await this.enquiry.enquireForAgent(
      agentId,
      walletId as string | undefined,
      bankCode,
      accountNumber,
    );
    return {
      bankCode: result.providerBankCode,
      accountNumber: result.accountNumber,
      outcome: result.outcome,
      ...(result.accountName ? { accountName: result.accountName } : {}),
      establishesAccountOwnership: result.establishesAccountOwnership,
      correlationId: result.correlationId,
    };
  }
}
