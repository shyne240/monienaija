import { Injectable } from '@nestjs/common';

import { calculatePolicyDecisionResultHash } from './capability-policy.service';
import type { PolicyDecisionResult, PolicyEvaluationCommand } from './capability-policy.types';
import type {
  PolicyDecisionRecordRepository,
  PolicyHistoricalReplayBundle,
} from './capability-policy-persistence.types';
import { PolicyReplayOutcome } from './capability-policy-persistence.enums';

export interface PolicyHistoricalReplayEvaluator {
  evaluateReadOnly(command: PolicyEvaluationCommand): Promise<PolicyDecisionResult>;
}

export interface PolicyHistoricalReplayResult extends PolicyHistoricalReplayBundle {
  readonly reconstructedDecision: PolicyDecisionResult | null;
}

@Injectable()
export class CapabilityPolicyHistoricalReplayService {
  constructor(
    private readonly decisionRepository: PolicyDecisionRecordRepository,
    private readonly evaluator: PolicyHistoricalReplayEvaluator,
  ) {}

  async replay(
    decisionReference: string,
    historicalCommand: PolicyEvaluationCommand,
  ): Promise<PolicyHistoricalReplayResult> {
    const bundle = await this.decisionRepository.reconstructDecision(decisionReference);
    if (bundle.outcome !== PolicyReplayOutcome.REPLAY_EXACT || !bundle.decision) {
      return { ...bundle, reconstructedDecision: null };
    }
    if (
      historicalCommand.subject.customerId !== bundle.decision.subject.customerId ||
      historicalCommand.capability !== bundle.decision.capability ||
      historicalCommand.action !== bundle.decision.action ||
      historicalCommand.policyVersionHint !== bundle.decision.policyVersion ||
      historicalCommand.snapshot.snapshotReference !==
        bundle.decision.evidenceContext.snapshotReference ||
      historicalCommand.snapshot.evidenceSummary.normalizedInputHash !==
        bundle.decision.evidenceContext.normalizedInputHash
    ) {
      return {
        ...bundle,
        outcome: PolicyReplayOutcome.REPLAY_CONFLICT,
        reconstructedDecision: null,
      };
    }
    const reconstructed = await this.evaluator.evaluateReadOnly(historicalCommand);
    if (
      reconstructed.resultHash !== bundle.decision.resultHash ||
      calculatePolicyDecisionResultHash(reconstructed) !== bundle.decision.resultHash
    ) {
      return {
        ...bundle,
        outcome: PolicyReplayOutcome.REPLAY_INTEGRITY_MISMATCH,
        integrityMismatch: true,
        reconstructedDecision: reconstructed,
      };
    }
    return {
      ...bundle,
      outcome: PolicyReplayOutcome.REPLAY_EXACT,
      reconstructedDecision: reconstructed,
    };
  }
}
