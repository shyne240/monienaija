import { A7ProductPolicyReplayService } from '../src/policy/a7-product-policy.replay.service';
import {
  A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
  A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
  A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
} from '../src/policy/a7-product-policy.constants';
import {
  PolicyEvidenceFreshnessState,
  PolicyCollectionStatus,
  PolicyDecisionState,
} from '../src/policy/capability-policy.enums';
import { PolicyReplayOutcome } from '../src/policy/capability-policy-persistence.enums';
import type { CapabilityPolicyHistoricalReplayService } from '../src/policy/capability-policy-historical-replay.service';
import type {
  PolicyDecisionResult,
  PolicyEvaluationCommand,
  PolicyEvidenceSnapshot,
} from '../src/policy/capability-policy.types';
import type { PolicyHistoricalReplayResult } from '../src/policy/capability-policy-historical-replay.service';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const DECISION_REFERENCE = 'a4-decision-replay-1';
const SNAPSHOT_REFERENCE = 'snapshot-replay-1';
const REQUESTED_AT = '2026-08-07T10:00:00.000Z';

class FakeHistoricalReplayService {
  calls: Array<{ decisionReference: string; command: PolicyEvaluationCommand }> = [];
  result: PolicyHistoricalReplayResult;

  constructor(result: PolicyHistoricalReplayResult) {
    this.result = result;
  }

  replay(
    decisionReference: string,
    command: PolicyEvaluationCommand,
  ): PolicyHistoricalReplayResult {
    this.calls.push({ decisionReference, command });
    return this.result;
  }
}

function makeSnapshot(): PolicyEvidenceSnapshot {
  return {
    contractName: 'A4-EVIDENCE-SNAPSHOT',
    contractVersion: 1,
    snapshotReference: SNAPSHOT_REFERENCE,
    subject: { type: 'CUSTOMER', customerId: CUSTOMER_ID },
    policyRequestScope: {
      capability: A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
      action: A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
      requestedAt: REQUESTED_AT,
      asOf: REQUESTED_AT,
      evidenceProfile: 'profile.product-virtual-account-assign.v1',
    },
    collection: {
      status: PolicyCollectionStatus.COMPLETE,
      startedAt: REQUESTED_AT,
      collectedAt: REQUESTED_AT,
      requiredSourceClasses: [],
      collectedSourceClasses: [],
      missingSourceClasses: [],
      unavailableSourceClasses: [],
      restrictedSourceClasses: [],
      conflictSourceClasses: [],
    },
    sourceItems: [],
    evidenceSummary: {
      freshnessStates: [PolicyEvidenceFreshnessState.CURRENT],
      sourceCount: 0,
      normalizedInputHash: 'a'.repeat(64),
    },
    integrity: {
      canonicalizationVersion: 1,
      arrayOrderingRule: 'sourceClass/sourceType/sourceId/sourceVersion',
      hashAlgorithm: 'SHA-256',
    },
  };
}

function makeCommand(snapshot: PolicyEvidenceSnapshot): PolicyEvaluationCommand {
  return {
    contractName: 'A4-CAPABILITY-POLICY',
    contractVersion: 1,
    subject: { type: 'CUSTOMER', customerId: CUSTOMER_ID },
    capability: A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
    action: A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
    requestedAt: REQUESTED_AT,
    actorContext: {
      principal: {
        type: 'SERVICE' as const,
        principalId: 'a7-product-policy',
        customerId: CUSTOMER_ID,
        audience: 'internal-policy',
        roles: ['policy'],
        scopes: ['policy:capability:evaluate'],
        customerAccess: 'ANY' as const,
        assuranceLevel: 'MFA' as const,
      },
    },
    sourceEvidenceRequest: {
      evidenceProfile: 'profile.product-virtual-account-assign.v1',
      asOf: REQUESTED_AT,
      requiredSourceClasses: [],
    },
    requestContext: {
      requestId: 'request-replay-1',
      correlationId: 'correlation-replay-1',
    },
    snapshot,
  };
}

function makeDecision(): PolicyDecisionResult {
  return {
    contractName: 'A4-CAPABILITY-POLICY',
    contractVersion: 1,
    decisionReference: DECISION_REFERENCE,
    subject: { type: 'CUSTOMER', customerId: CUSTOMER_ID },
    capability: A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
    action: A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
    profileReference: 'profile.product-virtual-account-assign.v1',
    profileKey: 'profile.product-virtual-account-assign',
    profileVersion: 1,
    policyVersion: 'a4.profile.product-virtual-account-assign.v1',
    definitionHash: 'a'.repeat(64),
    decision: PolicyDecisionState.ALLOW_WITH_LIMITS,
    requestedAt: REQUESTED_AT,
    evaluatedAt: REQUESTED_AT,
    expiresAt: '2026-08-07T10:15:00.000Z',
    reviewAt: null,
    reasonCodes: ['LIMITED_ALLOW'],
    explanation: { key: 'POLICY_ALLOW_WITH_LIMITS', audience: 'INTERNAL' },
    obligations: [],
    limits: [],
    sourceReferences: [],
    evidenceContext: {
      snapshotReference: SNAPSHOT_REFERENCE,
      snapshotContractVersion: 1,
      normalizedInputHash: 'a'.repeat(64),
      freshnessSummary: [PolicyEvidenceFreshnessState.CURRENT],
      collectionStatus: PolicyCollectionStatus.COMPLETE,
    },
    authorizationContextReference: 'a2-auth-replay-1',
    requestHash: 'b'.repeat(64),
    resultHash: 'c'.repeat(64),
    idempotencyReplay: false,
    requestContext: { requestId: 'request-replay-1', correlationId: 'correlation-replay-1' },
  };
}

describe('A7T03 A4 product-policy historical replay service', () => {
  it('replays an A4 product-policy decision by delegating to the A4 historical replay service', async () => {
    const decision = makeDecision();
    const snapshot = makeSnapshot();
    const command = makeCommand(snapshot);
    const replayBundle: PolicyHistoricalReplayResult = {
      outcome: PolicyReplayOutcome.REPLAY_EXACT,
      decision,
      profile: null,
      snapshot,
      integrityMismatch: false,
      reconstructedDecision: decision,
    };
    const a4Service = new FakeHistoricalReplayService(replayBundle);
    const service = new A7ProductPolicyReplayService(
      a4Service as unknown as CapabilityPolicyHistoricalReplayService,
    );

    const result = await service.replay({
      productKey: A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
      decisionReference: DECISION_REFERENCE,
      command,
    });

    expect(a4Service.calls).toEqual([{ decisionReference: DECISION_REFERENCE, command }]);
    expect(result).toEqual({
      productKey: A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
      result: replayBundle,
    });
  });

  it('rejects replay commands that target a non-A7-first-product key', async () => {
    const snapshot = makeSnapshot();
    const command = makeCommand(snapshot);
    const a4Service = new FakeHistoricalReplayService({
      outcome: PolicyReplayOutcome.REPLAY_UNAVAILABLE,
      decision: null,
      profile: null,
      snapshot: null,
      integrityMismatch: false,
      reconstructedDecision: null,
    });
    const service = new A7ProductPolicyReplayService(
      a4Service as unknown as CapabilityPolicyHistoricalReplayService,
    );

    await expect(
      service.replay({
        productKey: 'ANOTHER_PRODUCT' as never,
        decisionReference: DECISION_REFERENCE,
        command,
      }),
    ).rejects.toThrow('A7 product-policy replay is registered for productKey');
    expect(a4Service.calls).toHaveLength(0);
  });

  it('passes the A4 historical replay outcome through to the A7 product-policy replay result', async () => {
    const snapshot = makeSnapshot();
    const command = makeCommand(snapshot);
    const replayBundle: PolicyHistoricalReplayResult = {
      outcome: PolicyReplayOutcome.REPLAY_INTEGRITY_MISMATCH,
      decision: null,
      profile: null,
      snapshot,
      integrityMismatch: true,
      reconstructedDecision: null,
    };
    const a4Service = new FakeHistoricalReplayService(replayBundle);
    const service = new A7ProductPolicyReplayService(
      a4Service as unknown as CapabilityPolicyHistoricalReplayService,
    );

    const result = await service.replay({
      productKey: A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
      decisionReference: DECISION_REFERENCE,
      command,
    });

    expect(result.result.outcome).toBe(PolicyReplayOutcome.REPLAY_INTEGRITY_MISMATCH);
    expect(result.result.integrityMismatch).toBe(true);
    expect(result.productKey).toBe(A7_PRODUCT_KEY_VIRTUAL_ACCOUNT);
  });
});
