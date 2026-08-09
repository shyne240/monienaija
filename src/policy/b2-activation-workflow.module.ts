/**
 * B2T05 — B2 activation workflow NestJS module.
 *
 * The B2 activation workflow module wires the activation workflow service
 * to the shared IdempotencyService, AuditService, OutboxService, and
 * MetricsService through OperationsModule and to the TypeORM persistence
 * for the activation table. It consumes B2T03 customer readiness and
 * B2T04 merchant/agent readiness only through their consumer ports (read-
 * only) and never recalculates readiness. It does not create a second
 * activation engine, a second customer/merchant/agent identity, a second
 * binding, policy, ledger, or consent vault, and never posts a ledger
 * entry.
 */

import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';

import { B2Activation } from './b2-activation-workflow.entity';
import { B2ActivationWorkflowRepository } from './b2-activation-workflow.repository';
import { B2ActivationWorkflowService } from './b2-activation-workflow.service';

export const B2_ACTIVATION_WORKFLOW_PROVIDERS: readonly Provider[] = Object.freeze([
  B2ActivationWorkflowRepository,
  B2ActivationWorkflowService,
]);

@Module({
  imports: [OperationsModule, TypeOrmModule.forFeature([B2Activation])],
  providers: B2_ACTIVATION_WORKFLOW_PROVIDERS as Provider[],
  exports: [B2ActivationWorkflowService, B2ActivationWorkflowRepository],
})
export class B2ActivationWorkflowModule {}
