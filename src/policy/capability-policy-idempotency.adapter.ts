import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { IdempotencyService } from '../operations/idempotency.service';
import type { IdempotencyReservation } from '../operations/operations.types';
import type {
  PolicyDecisionResult,
  PolicyIdempotencyCommand,
  PolicyIdempotencyPort,
  PolicyIdempotencyReservation,
} from './capability-policy.types';
import { TypeOrmPolicyDecisionRecordRepository } from './capability-policy-persistence.repositories';

const POLICY_IDEMPOTENCY_RETENTION_SECONDS = 86_400;

function safeReasonCode(value: string): string {
  const code = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_.:-]/g, '_');
  return code.slice(0, 120) || 'A4_POLICY_EVALUATION_FAILED';
}

@Injectable()
export class TypeOrmPolicyIdempotencyAdapter implements PolicyIdempotencyPort {
  constructor(
    private readonly dataSource: DataSource,
    private readonly idempotencyService: IdempotencyService,
    private readonly decisionRepository: TypeOrmPolicyDecisionRecordRepository,
  ) {}

  async reserve(command: PolicyIdempotencyCommand): Promise<PolicyIdempotencyReservation> {
    const reservation = await this.dataSource.transaction((manager) =>
      this.idempotencyService.reserve(manager, {
        scope: command.scope,
        key: command.key,
        requestHash: command.requestHash,
        retentionSeconds: POLICY_IDEMPOTENCY_RETENTION_SECONDS,
      }),
    );
    return this.toPolicyReservation(reservation);
  }

  async complete(reservationId: string, result: PolicyDecisionResult): Promise<void> {
    await this.dataSource.transaction((manager) =>
      this.idempotencyService.complete(manager, reservationId, {
        statusCode: 200,
        responseBody: result as unknown as Record<string, unknown>,
        resourceType: 'A4_POLICY_DECISION',
        resourceId: result.decisionReference,
      }),
    );
  }

  async fail(reservationId: string, reason: string): Promise<void> {
    await this.dataSource.transaction((manager) =>
      this.idempotencyService.fail(manager, reservationId, {
        statusCode: 500,
        responseBody: { code: 'A4_POLICY_EVALUATION_FAILED', reasonCode: safeReasonCode(reason) },
        resourceType: 'A4_POLICY_DECISION',
      }),
    );
  }

  private async toPolicyReservation(
    reservation: IdempotencyReservation,
  ): Promise<PolicyIdempotencyReservation> {
    if (reservation.kind === 'NEW') {
      return { kind: 'NEW', reservationId: reservation.record.id };
    }
    if (reservation.kind === 'IN_PROGRESS') {
      return { kind: 'IN_PROGRESS', reservationId: reservation.record.id };
    }
    const decisionReference = reservation.record.resourceId ?? undefined;
    const result = decisionReference
      ? await this.decisionRepository.findByDecisionReference(decisionReference)
      : null;
    return {
      kind: 'REPLAY',
      reservationId: reservation.record.id,
      ...(result ? { result } : {}),
      ...(decisionReference ? { decisionReference } : {}),
    };
  }
}
