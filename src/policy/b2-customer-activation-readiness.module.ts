/**
 * B2T03 — B2 customer activation-readiness NestJS module.
 *
 * The B2 customer activation-readiness module wires the B2 customer
 * activation-readiness service to the canonical upstream authorities
 * (reused) without modification. It reuses the shared
 * `IdempotencyService`, `AuditService`, `OutboxService`,
 * `MetricsService` and the read-only A1/A3/A4/A7/B1 consumer
 * boundaries through the repository's consumer ports. It does not
 * create a second activation-readiness engine, a second customer
 * identity vault, a second binding system, a second policy engine, a
 * second ledger posting path, or a second consent vault.
 */

import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';

import { B2CustomerActivationReadiness } from './b2-customer-activation-readiness.entity';
import { B2CustomerActivationReadinessRepository } from './b2-customer-activation-readiness.repository';
import { B2CustomerActivationReadinessService } from './b2-customer-activation-readiness.service';

export const B2_CUSTOMER_ACTIVATION_READINESS_PROVIDERS: readonly Provider[] = Object.freeze([
  B2CustomerActivationReadinessRepository,
  B2CustomerActivationReadinessService,
]);

@Module({
  imports: [OperationsModule, TypeOrmModule.forFeature([B2CustomerActivationReadiness])],
  providers: B2_CUSTOMER_ACTIVATION_READINESS_PROVIDERS as Provider[],
  exports: [B2CustomerActivationReadinessService, B2CustomerActivationReadinessRepository],
})
export class B2CustomerActivationReadinessModule {}
