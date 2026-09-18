/**
 * B2T04 — B2 merchant and agent activation-readiness NestJS module.
 *
 * The B2 merchant and agent activation-readiness module wires the
 * merchant and agent attestation service to the shared
 * IdempotencyService, AuditService, OutboxService, and MetricsService
 * through OperationsModule and to the TypeORM persistence for both
 * merchant and agent tables. It does not create a second merchant table
 * as a Customer table, does not create a second agent table as a
 * Customer table, and does not become a second binding, policy, or
 * ledger authority.
 */

import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';

import {
  B2AgentActivationReadiness,
  B2MerchantActivationReadiness,
} from './b2-merchant-agent-activation-readiness.entity';
import { B2MerchantAgentActivationReadinessRepository } from './b2-merchant-agent-activation-readiness.repository';
import { B2MerchantAgentActivationReadinessService } from './b2-merchant-agent-activation-readiness.service';

export const B2_MERCHANT_AGENT_ACTIVATION_READINESS_PROVIDERS: readonly Provider[] = Object.freeze([
  B2MerchantAgentActivationReadinessRepository,
  B2MerchantAgentActivationReadinessService,
]);

@Module({
  imports: [
    OperationsModule,
    TypeOrmModule.forFeature([B2MerchantActivationReadiness, B2AgentActivationReadiness]),
  ],
  providers: B2_MERCHANT_AGENT_ACTIVATION_READINESS_PROVIDERS as Provider[],
  exports: [
    B2MerchantAgentActivationReadinessService,
    B2MerchantAgentActivationReadinessRepository,
  ],
})
export class B2MerchantAgentActivationReadinessModule {}
