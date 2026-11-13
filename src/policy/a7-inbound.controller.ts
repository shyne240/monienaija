import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { A7ProductPersistenceService } from './a7-product-persistence.service';

class CreateInboundCommandDto {
  @IsUUID() bindingId!: string;
  @IsUUID() virtualAccountId!: string;
  @IsOptional() @IsUUID() inboundObservationId?: string;
  @IsString() @Matches(/^[1-9]\d{0,18}$/) intendedAmountMinor!: string;
  @IsString() @MaxLength(180) @Matches(/\S/) policyDecisionReference!: string;
}
class TransitionInboundDto {
  @IsInt() @Min(1) expectedVersion!: number;
}

/** Customer-self nonfinancial intent only; this endpoint neither receives nor credits funds. */
@Controller('customers/me/inbound-funding')
export class A7InboundController {
  constructor(private readonly persistence: A7ProductPersistenceService) {}

  private token(authorization?: string): string {
    const token =
      typeof authorization === 'string'
        ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization)?.[1]
        : undefined;
    if (!token) throw new UnauthorizedException('Customer session required');
    return token;
  }

  @Post('commands')
  @HttpCode(200)
  async create(
    @Body() dto: CreateInboundCommandDto,
    @Headers('authorization') authorization?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const result = await this.persistence.create({
      token: this.token(authorization),
      operationType: 'INBOUND_FUNDING',
      bindingId: dto.bindingId,
      virtualAccountId: dto.virtualAccountId,
      inboundObservationId: dto.inboundObservationId,
      intendedAmountMinor: dto.intendedAmountMinor,
      policyDecisionReference: dto.policyDecisionReference,
      idempotencyKey: idempotencyKey ?? '',
    });
    return {
      commandId: result.command.id,
      commandReference: result.command.command_reference,
      lifecycleId: result.lifecycle.id,
      lifecycleReference: result.lifecycle.lifecycle_reference,
      state: result.lifecycle.state,
      version: result.lifecycle.version,
      replayed: result.replayed,
    };
  }

  @Post('lifecycles/:id/admission')
  @HttpCode(200)
  async admit(
    @Param('id') lifecycleId: string,
    @Body() dto: TransitionInboundDto,
    @Headers('authorization') authorization?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.transition(lifecycleId, dto, authorization, idempotencyKey, 'LIFECYCLE_ADMITTED');
  }

  /** Processes only an already verified, command-bound observation; no receipt claims are accepted. */
  @Post('lifecycles/:id/execution')
  @HttpCode(200)
  async execute(
    @Param('id') lifecycleId: string,
    @Body() dto: TransitionInboundDto,
    @Headers('authorization') authorization?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const result = await this.persistence.executeInbound({
      token: this.token(authorization),
      lifecycleId,
      expectedVersion: dto.expectedVersion,
      idempotencyKey: idempotencyKey ?? '',
    });
    return {
      lifecycleId: result.lifecycle.id,
      lifecycleReference: result.lifecycle.lifecycle_reference,
      state: result.lifecycle.state,
      version: result.lifecycle.version,
      receiptId: result.lifecycle.execution_receipt_id,
      replayed: result.replayed,
    };
  }

  @Post('lifecycles/:id/cancellation')
  @HttpCode(200)
  async cancel(
    @Param('id') lifecycleId: string,
    @Body() dto: TransitionInboundDto,
    @Headers('authorization') authorization?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.transition(lifecycleId, dto, authorization, idempotencyKey, 'LIFECYCLE_CANCELLED');
  }

  private async transition(
    lifecycleId: string,
    dto: TransitionInboundDto,
    authorization: string | undefined,
    idempotencyKey: string | undefined,
    nextState: 'LIFECYCLE_ADMITTED' | 'LIFECYCLE_CANCELLED',
  ) {
    const result = await this.persistence.transition({
      token: this.token(authorization),
      lifecycleId,
      expectedVersion: dto.expectedVersion,
      nextState,
      idempotencyKey: idempotencyKey ?? '',
    });
    return {
      lifecycleId: result.lifecycle.id,
      lifecycleReference: result.lifecycle.lifecycle_reference,
      state: result.lifecycle.state,
      version: result.lifecycle.version,
      replayed: result.replayed,
    };
  }
}
