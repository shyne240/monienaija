/**
 * A7T03 — A4 product-policy historical replay service.
 *
 * The A7 product-policy service reuses the A4
 * `CapabilityPolicyHistoricalReplayService` (which consumes the A4
 * `PolicyHistoricalReplayEvaluator` that delegates to the A4
 * `CapabilityPolicyEvaluationService.evaluateReadOnly()`, the A4
 * `PolicyDecisionRecordRepository` to reconstruct the durable
 * decision, the A4 snapshot repository, the A4 profile version
 * repository, and the A4 historical-replay-bundle shape). The A7
 * product-policy historical replay service is a thin A7-side wrapper
 * that:
 *
 *  - delegates the A4 historical-replay call to the A4
 *    `CapabilityPolicyHistoricalReplayService.replay()`;
 *  - binds the A4 historical-replay call to the A7 product key; and
 *  - returns the A4 historical-replay result together with the A7
 *    product key.
 *
 * No new historical-replay engine, no new historical-replay evaluator,
 * no new historical-replay bundle, and no new historical-replay
 * repository is introduced. The A4 historical-replay boundary is the
 * only historical-replay boundary.
 */

import { Injectable } from '@nestjs/common';

import { A7_PRODUCT_KEY_VIRTUAL_ACCOUNT } from './a7-product-policy.constants';
import type {
  A7ProductPolicyReplayCommand,
  A7ProductPolicyReplayResult,
} from './a7-product-policy.types';
import { CapabilityPolicyHistoricalReplayService } from './capability-policy-historical-replay.service';

/**
 * The A7 product-policy historical replay service. The A7 product-policy
 * service uses this service to delegate the A4 historical-replay call
 * for the A7 first product.
 */
@Injectable()
export class A7ProductPolicyReplayService {
  constructor(private readonly historicalReplayService: CapabilityPolicyHistoricalReplayService) {}

  /**
   * Replays an A4 product-policy decision for the A7 first product.
   * The A4 historical-replay service reconstructs the durable decision,
   * the A4 snapshot, the A4 profile version, and the A4 historical-replay
   * bundle. The A7 product-policy replay service returns the A4
   * historical-replay result together with the A7 product key.
   */
  async replay(command: A7ProductPolicyReplayCommand): Promise<A7ProductPolicyReplayResult> {
    if (command.productKey !== A7_PRODUCT_KEY_VIRTUAL_ACCOUNT) {
      throw new Error(
        `A7 product-policy replay is registered for productKey: ${String(A7_PRODUCT_KEY_VIRTUAL_ACCOUNT)}`,
      );
    }
    const result = await this.historicalReplayService.replay(
      command.decisionReference,
      command.command,
    );
    return {
      productKey: command.productKey,
      result,
    };
  }
}
