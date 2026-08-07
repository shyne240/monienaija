import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { IdempotencyRecordStatus } from '../operations/operations.enums';
import type { IdempotencyReservation } from '../operations/operations.types';
import { CustomerFinancialAccountBindingService } from '../wallet/customer-financial-account-binding.service';
import type {
  InternalTransferBindingPort,
  InternalTransferGateAuditFact,
  InternalTransferGateAuditPort,
  InternalTransferGateFailure,
  InternalTransferGateIdempotencyCommand,
  InternalTransferGateIdempotencyPort,
  InternalTransferGateIdempotencyReservation,
  InternalTransferGateResult,
} from './internal-transfer-gate.types';

const INTERNAL_TRANSFER_GATE_IDEMPOTENCY_RETENTION_SECONDS = 86_400;

@Injectable()
export class A3InternalTransferBindingAdapter implements InternalTransferBindingPort {
  constructor(private readonly bindingService: CustomerFinancialAccountBindingService) {}

  validateActiveBinding(
    assertion: Parameters<InternalTransferBindingPort['validateActiveBinding']>[0],
  ): ReturnType<InternalTransferBindingPort['validateActiveBinding']> {
    return this.bindingService.validateActiveBinding(assertion);
  }
}

@Injectable()
export class TypeOrmInternalTransferGateIdempotencyAdapter
  implements InternalTransferGateIdempotencyPort
{
  constructor(
    private readonly dataSource: DataSource,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async reserve(
    command: InternalTransferGateIdempotencyCommand,
  ): Promise<InternalTransferGateIdempotencyReservation> {
    const reservation = await this.dataSource.transaction((manager) =>
      this.idempotencyService.reserve(manager, {
        scope: command.scope,
        key: command.key,
        requestHash: command.requestHash,
        retentionSeconds: INTERNAL_TRANSFER_GATE_IDEMPOTENCY_RETENTION_SECONDS,
      }),
    );
    return this.toReservation(reservation);
  }

  async complete(reservationId: string, result: InternalTransferGateResult): Promise<void> {
    await this.dataSource.transaction((manager) =>
      this.idempotencyService.complete(manager, reservationId, {
        statusCode: 200,
        responseBody: result as unknown as Record<string, unknown>,
        resourceType: 'INTERNAL_TRANSFER_GATE',
        resourceId: result.commandId,
      }),
    );
  }

  async fail(reservationId: string, failure: InternalTransferGateFailure): Promise<void> {
    await this.dataSource.transaction((manager) =>
      this.idempotencyService.fail(manager, reservationId, {
        statusCode: failure.statusCode,
        responseBody: {
          gateFailure: {
            failureCode: failure.code,
            failureMessage: failure.message,
            statusCode: failure.statusCode,
          },
        },
        resourceType: 'INTERNAL_TRANSFER_GATE',
      }),
    );
  }

  private toReservation(
    reservation: IdempotencyReservation,
  ): InternalTransferGateIdempotencyReservation {
    if (reservation.kind === 'NEW') {
      return { kind: 'NEW', reservationId: reservation.record.id };
    }
    if (reservation.kind === 'IN_PROGRESS') {
      return { kind: 'IN_PROGRESS', reservationId: reservation.record.id };
    }

    const body = reservation.record.responseBody;
    if (reservation.record.status === IdempotencyRecordStatus.COMPLETED && isGateResult(body)) {
      return {
        kind: 'REPLAY',
        reservationId: reservation.record.id,
        result: body,
      };
    }
    if (reservation.record.status === IdempotencyRecordStatus.FAILED && isGateFailure(body)) {
      return {
        kind: 'REPLAY',
        reservationId: reservation.record.id,
        failure: body.gateFailure,
      };
    }
    return { kind: 'REPLAY', reservationId: reservation.record.id };
  }
}

@Injectable()
export class TypeOrmInternalTransferGateAuditAdapter implements InternalTransferGateAuditPort {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async record(fact: InternalTransferGateAuditFact): Promise<void> {
    await this.dataSource.transaction((manager) =>
      this.auditService.record(manager, {
        entityType: 'INTERNAL_TRANSFER_GATE',
        entityId: fact.commandId,
        action: fact.action,
        actor: fact.actor,
        correlationId: fact.correlationId,
        requestId: fact.requestId,
        newValues: {
          sourceCustomerId: fact.sourceCustomerId,
          destinationCustomerId: fact.destinationCustomerId,
          sourceBindingId: fact.sourceBindingId,
          destinationBindingId: fact.destinationBindingId,
          requestHash: fact.requestHash,
          policyDecisionReference: fact.policyDecisionReference ?? null,
          policyVersion: fact.policyVersion ?? null,
          failureCode: fact.failureCode ?? null,
        },
      }),
    );
  }
}

function isGateResult(value: unknown): value is InternalTransferGateResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).gateVersion === 1 &&
    (value as Record<string, unknown>).status === 'PASSED'
  );
}

function isGateFailure(
  value: Record<string, unknown> | null,
): value is { gateFailure: InternalTransferGateFailure } {
  const failure = value?.gateFailure;
  return (
    typeof failure === 'object' &&
    failure !== null &&
    typeof (failure as Record<string, unknown>).failureCode === 'string' &&
    typeof (failure as Record<string, unknown>).failureMessage === 'string' &&
    typeof (failure as Record<string, unknown>).statusCode === 'number'
  );
}
