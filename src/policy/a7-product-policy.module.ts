/**
 * A7T03 — A4 product-policy NestJS module.
 *
 * The A4 product-policy module wires the A7 product-policy service to
 * the A4 `CapabilityPolicyModule` (reused) without modification. The A7
 * product-policy module:
 *
 *  - reuses the A4 `CapabilityPolicyEvaluationService` (the only
 *    policy evaluator) and the A4 `CapabilityPolicyRecoveryService`
 *    (the only re-evaluation engine);
 *  - reuses the A4 `CapabilityPolicyHistoricalReplayService` (the only
 *    replay engine) wrapped by the A7
 *    `A7ProductPolicyReplayService`;
 *  - reuses the A4 `TypeOrmPolicyProfileVersionRepository` (the only
 *    product-policy profile persistence) wrapped by the A7
 *    `A7ProductPolicyPersistenceRepository`;
 *  - reuses the A4 `TypeOrmPolicyDecisionRecordRepository` (the only
 *    product-policy decision persistence) wrapped by the A7
 *    `A7ProductPolicyPersistenceRepository`;
 *  - reuses the A4 `TypeOrmPolicyAuditAdapter` (the only product-policy
 *    audit adapter) wrapped by the A7 `A7ProductPolicyAuditAdapter`.
 *
 * No new policy evaluator, no new re-evaluation engine, no new replay
 * engine, no new persistence layer, no new audit store, and no new
 * idempotency store is introduced. The A4 authority is the only
 * authority.
 */

import { Module, Provider } from '@nestjs/common';

import { CapabilityPolicyModule } from './capability-policy.module';
import { A7ProductPolicyAuditAdapter } from './a7-product-policy.audit.adapter';
import { A7ProductPolicyPersistenceRepository } from './a7-product-policy.persistence.repository';
import { A7ProductPolicyReplayService } from './a7-product-policy.replay.service';
import { A7ProductPolicyService } from './a7-product-policy.service';

/**
 * Provider list for the A7 product-policy module. The A7 product-policy
 * module reuses the A4 `CapabilityPolicyEvaluationService`, the A4
 * `CapabilityPolicyRecoveryService`, the A4
 * `CapabilityPolicyHistoricalReplayService`, the A4
 * `TypeOrmPolicyProfileVersionRepository`, the A4
 * `TypeOrmPolicyDecisionRecordRepository`, and the A4
 * `TypeOrmPolicyAuditAdapter`. The A4 classes are registered as
 * providers by the A4 `CapabilityPolicyModule` (reused), and the
 * NestJS DI container injects them into the A7 product-policy service
 * and the A7 product-policy wrappers.
 */
export const A7_PRODUCT_POLICY_PROVIDERS: readonly Provider[] = Object.freeze([
  A7ProductPolicyAuditAdapter,
  A7ProductPolicyPersistenceRepository,
  A7ProductPolicyReplayService,
  A7ProductPolicyService,
]);

/**
 * The A7 product-policy NestJS module class. The A7 product-policy module
 * imports the A4 `CapabilityPolicyModule` (reused) and registers the
 * A7 product-policy providers. The A4 `CapabilityPolicyModule` already
 * imports `TypeOrmModule.forFeature` for the A4 `Customer`,
 * `PolicyProfileVersion`, `PolicyDecisionRecord`, and
 * `ImmutableEvidenceSnapshotAttachment` entities; the A7 product-policy
 * module does not need to re-import these entities.
 */
@Module({
  imports: [CapabilityPolicyModule],
  providers: A7_PRODUCT_POLICY_PROVIDERS as Provider[],
  exports: [
    A7ProductPolicyService,
    A7ProductPolicyAuditAdapter,
    A7ProductPolicyPersistenceRepository,
    A7ProductPolicyReplayService,
  ],
})
export class A7ProductPolicyModule {}

/**
 * The A7 product-policy service class (re-exported for the application
 * module to register the A4 product-policy dependencies as `useExisting`
 * providers). The A4 `CapabilityPolicyEvaluationService` and the A4
 * `CapabilityPolicyRecoveryService` are constructed by the A4
 * `CapabilityPolicyModule` and consumed by the A7 product-policy service
 * through NestJS DI.
 */
export const A7_PRODUCT_POLICY_SERVICE_CLASS = A7ProductPolicyService;
