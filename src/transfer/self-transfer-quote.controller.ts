import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { TransferQuoteService } from './transfer-quote.service';
import { TransferService } from './transfer.service';

interface SelfRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

function requirePrincipal(req: SelfRequest, type: 'CUSTOMER' | 'AGENT'): AuthorizationPrincipal {
  const principal = req.authorizationPrincipal;
  if (
    !principal ||
    principal.type !== type ||
    !principal.sessionId ||
    !(type === 'CUSTOMER' ? principal.customerId : principal.agentId)
  )
    throw new UnauthorizedException('Self session required');
  return principal;
}

function key(req: SelfRequest): string {
  const value = req.headers['idempotency-key'];
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 255)
    throw new BadRequestException('Idempotency-Key header is required');
  return value.trim();
}

function object(body: unknown, allowed: string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Invalid request body');
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((name) => !allowed.includes(name)))
    throw new BadRequestException('Unexpected request field');
  return value;
}

function stringField(body: Record<string, unknown>, name: string): string {
  if (typeof body[name] !== 'string' || !body[name].trim())
    throw new BadRequestException(`${name} is required`);
  return body[name];
}

async function quoteStatus(
  quotes: TransferQuoteService,
  transfers: TransferService,
  principal: AuthorizationPrincipal,
  quoteId: string,
) {
  const quote = await quotes.readStatusForOwner(principal, quoteId);
  const transfer = quote.transferId ? await transfers.getTransfer(quote.transferId) : null;
  return {
    quoteId: quote.quoteId,
    status: quote.status,
    sessionMatches: quote.sessionId.toLowerCase() === principal.sessionId?.toLowerCase(),
    sourceWalletId: quote.sourceWalletId,
    destinationWalletId: quote.destinationWalletId,
    recipientType: quote.recipientType,
    recipientId: quote.recipientId,
    amountMinor: quote.amountMinor,
    currency: quote.currency,
    feeMinor: quote.feeMinor,
    vatMinor: quote.vatMinor,
    totalDebitMinor: quote.totalDebitMinor,
    expiresAt: quote.expiresAt,
    receipt: transfer
      ? {
          id: transfer.id,
          status: transfer.status,
          paymentReference: transfer.paymentReference,
          completedAt: transfer.completedAt,
        }
      : null,
  };
}

/** Route identity is supplied solely by the authenticated self session, never the body. */
@Controller('customers/me/transfer-quotes')
export class CustomerSelfTransferQuoteController {
  constructor(
    private readonly quotes: TransferQuoteService,
    private readonly transfers: TransferService,
  ) {}

  @Post()
  @HttpCode(201)
  quote(@Req() req: SelfRequest, @Body() raw: unknown) {
    const principal = requirePrincipal(req, 'CUSTOMER');
    const body = object(raw, [
      'sourceWalletId',
      'destinationWalletId',
      'beneficiaryId',
      'amountMinor',
      'currency',
    ]);
    return this.quotes.create(principal, {
      sourceWalletId: stringField(body, 'sourceWalletId'),
      destinationWalletId: stringField(body, 'destinationWalletId'),
      ...(body.beneficiaryId === undefined
        ? {}
        : { beneficiaryId: stringField(body, 'beneficiaryId') }),
      amountMinor: stringField(body, 'amountMinor'),
      currency: stringField(body, 'currency'),
      idempotencyKey: key(req),
    });
  }

  @Get(':quoteId')
  status(@Req() req: SelfRequest, @Param('quoteId') quoteId: string) {
    return quoteStatus(this.quotes, this.transfers, requirePrincipal(req, 'CUSTOMER'), quoteId);
  }

  @Post(':quoteId/confirm')
  @HttpCode(201)
  confirm(@Req() req: SelfRequest, @Param('quoteId') quoteId: string, @Body() raw: unknown) {
    const principal = requirePrincipal(req, 'CUSTOMER');
    const body = object(raw, ['pin']);
    return this.transfers.createConfirmedTransfer(
      principal,
      quoteId,
      key(req),
      stringField(body, 'pin'),
    );
  }
}

@Controller('agents/me/transfer-quotes')
export class AgentSelfTransferQuoteController {
  constructor(
    private readonly quotes: TransferQuoteService,
    private readonly transfers: TransferService,
  ) {}

  @Post()
  @HttpCode(201)
  quote(@Req() req: SelfRequest, @Body() raw: unknown) {
    const principal = requirePrincipal(req, 'AGENT');
    const body = object(raw, ['destinationWalletId', 'beneficiaryId', 'amountMinor', 'currency']);
    return this.quotes.create(principal, {
      destinationWalletId: stringField(body, 'destinationWalletId'),
      ...(body.beneficiaryId === undefined
        ? {}
        : { beneficiaryId: stringField(body, 'beneficiaryId') }),
      amountMinor: stringField(body, 'amountMinor'),
      currency: stringField(body, 'currency'),
      idempotencyKey: key(req),
    });
  }

  @Get(':quoteId')
  status(@Req() req: SelfRequest, @Param('quoteId') quoteId: string) {
    return quoteStatus(this.quotes, this.transfers, requirePrincipal(req, 'AGENT'), quoteId);
  }

  @Post(':quoteId/confirm')
  @HttpCode(201)
  confirm(@Req() req: SelfRequest, @Param('quoteId') quoteId: string, @Body() raw: unknown) {
    const principal = requirePrincipal(req, 'AGENT');
    const body = object(raw, ['pin']);
    return this.transfers.createConfirmedTransfer(
      principal,
      quoteId,
      key(req),
      stringField(body, 'pin'),
    );
  }
}
