import { ConflictException } from '@nestjs/common';

import { redactRecord } from '../src/common/sensitive-data-redaction';
import type {
  AuthorizationDecision,
  AuthorizationPolicy,
} from '../src/authorization/authorization.types';
import type { AuthorizationService } from '../src/authorization/authorization.service';
import {
  PolicyCollectionStatus,
  PolicyDecisionState,
  PolicyEvidenceFreshnessState,
  PolicySourceClass,
} from '../src/policy/capability-policy.enums';
import type {
  PolicyDecisionResult,
  PolicyEvaluationCommand,
  PolicyEvidenceSnapshot,
} from '../src/policy/capability-policy.types';
import type { PolicyEvidenceCollectionCommand } from '../src/policy/capability-policy-evidence.types';
import type { CustomerFinancialAccountBindingValidation } from '../src/wallet/customer-financial-account-binding.types';
import {
  INTERNAL_TRANSFER_POLICY_EVIDENCE_PROFILE,
  type InternalTransferBindingPort,
  type InternalTransferEvidenceCoordinatorPort,
  type InternalTransferGateAuditFact,
  type InternalTransferGateAuditPort,
  type InternalTransferGateCommand,
  type InternalTransferGateFailure,
  type InternalTransferGateIdempotencyCommand,
  type InternalTransferGateIdempotencyPort,
  type InternalTransferGateIdempotencyReservation,
  type InternalTransferGateResult,
  type InternalTransferPolicyEvaluationPort,
} from '../src/transfer/internal-transfer-gate.types';
import {
  InternalTransferGateException,
  InternalTransferGateService,
} from '../src/transfer/internal-transfer-gate.service';

const SOURCE_CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const DESTINATION_CUSTOMER_ID = '00000000-0000-4000-8000-000000000002';
const SOURCE_CUSTOMER_WALLET_ID = '00000000-0000-4000-8000-000000000003';
const DESTINATION_CUSTOMER_WALLET_ID = '00000000-0000-4000-8000-000000000004';
const SOURCE_BINDING_ID = '00000000-0000-4000-8000-000000000005';
const DESTINATION_BINDING_ID = '00000000-0000-4000-8000-000000000006';
const SOURCE_WALLET_ACCOUNT_ID = '00000000-0000-4000-8000-000000000007';
const DESTINATION_WALLET_ACCOUNT_ID = '00000000-0000-4000-8000-000000000008';
const SOURCE_LEDGER_ACCOUNT_ID = '00000000-0000-4000-8000-000000000009';
const DESTINATION_LEDGER_ACCOUNT_ID = '00000000-0000-4000-8000-000000000010';
const COMMAND_ID = '00000000-0000-4000-8000-000000000011';
const REQUESTED_AT = '2026-08-07T10:00:00.000Z';
const SNAPSHOT_REFERENCE = 'a4-snapshot-transfer-1';
const NORMALIZED_INPUT_HASH = 'a'.repeat(64);

const principal = {
  type: 'CUSTOMER' as const,
  principalId: SOURCE_CUSTOMER_ID,
  customerId: SOURCE_CUSTOMER_ID,
  roles: [],
  scopes: [],
  customerAccess: 'SELF' as const,
  assuranceLevel: 'PASSWORD' as const,
};

class FakeAuthorizationService {
  allowed = true;
  calls = 0;
  readonly policies: AuthorizationPolicy[] = [];

  authorize(
    _principal: typeof principal | undefined,
    policy: AuthorizationPolicy | undefined,
    resource: { type: string; id?: string; customerId?: string },
  ): Promise<AuthorizationDecision> {
    this.calls += 1;
    if (policy) this.policies.push(policy);
    return Promise.resolve({
      allowed: this.allowed,
      reason: this.allowed ? undefined : 'CUSTOMER_SCOPE_MISMATCH',
      principalType: 'CUSTOMER',
      principalId: SOURCE_CUSTOMER_ID,
      resourceType: resource.type,
      resourceId: resource.id,
      customerId: resource.customerId,
      action: policy?.action ?? 'UNKNOWN',
      evaluatedAt: new Date(),
      requiredScopes: policy?.requiredScopes ?? [],
      requiredRoles: policy?.requiredRoles ?? [],
    });
  }
}

class FakeEvidenceCoordinator implements InternalTransferEvidenceCoordinatorPort {
  calls = 0;
  lastCommand: PolicyEvidenceCollectionCommand | null = null;
  constructor(private readonly snapshot: PolicyEvidenceSnapshot) {}

  collect(command: PolicyEvidenceCollectionCommand): Promise<PolicyEvidenceSnapshot> {
    this.calls += 1;
    this.lastCommand = command;
    return Promise.resolve(this.snapshot);
  }
}

class FakePolicyService implements InternalTransferPolicyEvaluationPort {
  calls = 0;
  lastCommand: PolicyEvaluationCommand | null = null;
  constructor(private result: PolicyDecisionResult) {}

  evaluate(command: PolicyEvaluationCommand): Promise<PolicyDecisionResult> {
    this.calls += 1;
    this.lastCommand = command;
    return Promise.resolve(this.result);
  }

  setResult(result: PolicyDecisionResult): void {
    this.result = result;
  }
}

class FakeBindingPort implements InternalTransferBindingPort {
  calls: string[] = [];
  readonly failures = new Map<string, CustomerFinancialAccountBindingValidation>();

  validateActiveBinding(
    assertion: Parameters<InternalTransferBindingPort['validateActiveBinding']>[0],
  ): Promise<CustomerFinancialAccountBindingValidation> {
    this.calls.push(assertion.bindingId);
    const failure = this.failures.get(assertion.bindingId);
    if (failure) return Promise.resolve(failure);
    return Promise.resolve({
      valid: true,
      bindingId: assertion.bindingId,
      customerId: assertion.customerId,
      customerWalletId: assertion.customerWalletId,
      walletAccountId: assertion.walletAccountId,
      ledgerAccountId: assertion.ledgerAccountId,
      bindingVersion: assertion.expectedBindingVersion ?? 1,
      currency: assertion.expectedCurrency,
      accountingUnit: assertion.expectedAccountingUnit,
    });
  }
}

class FakeIdempotencyPort implements InternalTransferGateIdempotencyPort {
  readonly records = new Map<
    string,
    {
      reservationId: string;
      requestHash: string;
      result?: InternalTransferGateResult;
      failure?: InternalTransferGateFailure;
    }
  >();
  reserveCalls = 0;
  completeCalls = 0;
  failCalls = 0;
  private sequence = 0;

  reserve(
    command: InternalTransferGateIdempotencyCommand,
  ): Promise<InternalTransferGateIdempotencyReservation> {
    this.reserveCalls += 1;
    const key = `${command.scope}:${command.key}`;
    const existing = this.records.get(key);
    if (existing) {
      if (existing.requestHash !== command.requestHash) {
        return Promise.reject(
          new ConflictException('The idempotency key was already used for another request'),
        );
      }
      if (!existing.result && !existing.failure) {
        return Promise.resolve({ kind: 'IN_PROGRESS', reservationId: existing.reservationId });
      }
      return Promise.resolve({
        kind: 'REPLAY',
        reservationId: existing.reservationId,
        ...(existing.result ? { result: existing.result } : {}),
        ...(existing.failure ? { failure: existing.failure } : {}),
      });
    }
    this.sequence += 1;
    const reservationId = `reservation-${this.sequence}`;
    this.records.set(key, { reservationId, requestHash: command.requestHash });
    return Promise.resolve({ kind: 'NEW', reservationId });
  }

  complete(reservationId: string, result: InternalTransferGateResult): Promise<void> {
    this.completeCalls += 1;
    const record = [...this.records.values()].find((item) => item.reservationId === reservationId);
    if (!record) return Promise.reject(new Error('Reservation not found'));
    record.result = result;
    return Promise.resolve();
  }

  fail(reservationId: string, failure: InternalTransferGateFailure): Promise<void> {
    this.failCalls += 1;
    const record = [...this.records.values()].find((item) => item.reservationId === reservationId);
    if (!record) return Promise.reject(new Error('Reservation not found'));
    record.failure = failure;
    return Promise.resolve();
  }
}

class FakeAuditPort implements InternalTransferGateAuditPort {
  readonly facts: InternalTransferGateAuditFact[] = [];

  record(fact: InternalTransferGateAuditFact): Promise<void> {
    this.facts.push(fact);
    return Promise.resolve();
  }
}

interface Fixture {
  service: InternalTransferGateService;
  authorization: FakeAuthorizationService;
  evidence: FakeEvidenceCoordinator;
  policy: FakePolicyService;
  bindings: FakeBindingPort;
  idempotency: FakeIdempotencyPort;
  audit: FakeAuditPort;
}

function makeSnapshot(): PolicyEvidenceSnapshot {
  return {
    contractName: 'A4-EVIDENCE-SNAPSHOT',
    contractVersion: 1,
    snapshotReference: SNAPSHOT_REFERENCE,
    subject: { type: 'CUSTOMER', customerId: SOURCE_CUSTOMER_ID },
    policyRequestScope: {
      capability: 'wallet.transfer',
      action: 'create',
      requestedAt: REQUESTED_AT,
      asOf: REQUESTED_AT,
      evidenceProfile: INTERNAL_TRANSFER_POLICY_EVIDENCE_PROFILE,
      targetBindingId: SOURCE_BINDING_ID,
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
    sourceItems: [
      {
        sourceClass: PolicySourceClass.ACCOUNT_BINDING,
        sourceType: 'CustomerFinancialAccountBinding',
        sourceId: SOURCE_BINDING_ID,
        customerId: SOURCE_CUSTOMER_ID,
        sourceVersion: 1,
        sourceUpdatedAt: REQUESTED_AT,
        observedAt: REQUESTED_AT,
        deleted: false,
        freshnessState: PolicyEvidenceFreshnessState.CURRENT,
        classification: 'Highly Restricted financial/control data',
        normalizedValue: {
          bindingId: SOURCE_BINDING_ID,
          customerWalletId: SOURCE_CUSTOMER_WALLET_ID,
          walletAccountId: SOURCE_WALLET_ACCOUNT_ID,
          ledgerAccountId: SOURCE_LEDGER_ACCOUNT_ID,
          state: 'ACTIVE',
          currency: 'NGN',
          accountingUnit: 'CUSTOMER_FUNDS',
          dimensionsCompatible: true,
          ledgerIsActive: true,
          reconciliationStatus: 'PASS',
        },
        sourceReference: SOURCE_BINDING_ID,
      },
    ],
    evidenceSummary: {
      freshnessStates: [PolicyEvidenceFreshnessState.CURRENT],
      sourceCount: 1,
      normalizedInputHash: NORMALIZED_INPUT_HASH,
    },
    integrity: {
      canonicalizationVersion: 1,
      arrayOrderingRule: 'sourceClass/sourceType/sourceId/sourceVersion',
      hashAlgorithm: 'SHA-256',
    },
  };
}

function makePolicyResult(snapshot: PolicyEvidenceSnapshot): PolicyDecisionResult {
  return {
    contractName: 'A4-CAPABILITY-POLICY',
    contractVersion: 1,
    decisionReference: 'a4-decision-transfer-1',
    subject: { type: 'CUSTOMER', customerId: SOURCE_CUSTOMER_ID },
    capability: 'wallet.transfer',
    action: 'create',
    profileReference: INTERNAL_TRANSFER_POLICY_EVIDENCE_PROFILE,
    profileKey: 'profile.wallet-transfer-create',
    profileVersion: 1,
    policyVersion: 'a4.profile.wallet-transfer-create.v1',
    definitionHash: 'b'.repeat(64),
    decision: PolicyDecisionState.ALLOW_WITH_LIMITS,
    requestedAt: REQUESTED_AT,
    evaluatedAt: REQUESTED_AT,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    reviewAt: null,
    reasonCodes: ['LIMITED_ALLOW'],
    explanation: { key: 'POLICY_ALLOW_WITH_LIMITS', audience: 'INTERNAL' },
    obligations: [
      { code: 'RECHECK_A2_AUTHORIZATION', required: true },
      { code: 'RECHECK_A3_BINDING', required: true },
      { code: 'RECHECK_EXECUTION_LIMIT', required: true },
    ],
    limits: [
      {
        type: 'SINGLE_TRANSACTION_AMOUNT',
        currency: 'NGN',
        amountMinor: '50000',
      },
    ],
    sourceReferences: [],
    evidenceContext: {
      snapshotReference: snapshot.snapshotReference,
      snapshotContractVersion: 1,
      normalizedInputHash: snapshot.evidenceSummary.normalizedInputHash,
      freshnessSummary: [PolicyEvidenceFreshnessState.CURRENT],
      collectionStatus: PolicyCollectionStatus.COMPLETE,
    },
    authorizationContextReference: 'a2-auth-context-1',
    requestHash: 'c'.repeat(64),
    resultHash: 'd'.repeat(64),
    idempotencyReplay: false,
    requestContext: {
      requestId: 'request-transfer-1',
      correlationId: 'correlation-transfer-1',
      traceId: 'trace-transfer-1',
    },
  };
}

function makeCommand(
  overrides: Partial<InternalTransferGateCommand> = {},
): InternalTransferGateCommand {
  return {
    contractVersion: 1,
    commandType: 'INTERNAL_TRANSFER',
    commandId: COMMAND_ID,
    capability: 'wallet.transfer',
    action: 'create',
    scope: 'INTERNAL_CUSTOMER_TO_CUSTOMER',
    sourceCustomerId: SOURCE_CUSTOMER_ID,
    destinationCustomerId: DESTINATION_CUSTOMER_ID,
    sourceCustomerWalletId: SOURCE_CUSTOMER_WALLET_ID,
    destinationCustomerWalletId: DESTINATION_CUSTOMER_WALLET_ID,
    sourceBindingId: SOURCE_BINDING_ID,
    destinationBindingId: DESTINATION_BINDING_ID,
    sourceWalletAccountId: SOURCE_WALLET_ACCOUNT_ID,
    destinationWalletAccountId: DESTINATION_WALLET_ACCOUNT_ID,
    sourceLedgerAccountId: SOURCE_LEDGER_ACCOUNT_ID,
    destinationLedgerAccountId: DESTINATION_LEDGER_ACCOUNT_ID,
    sourceBindingVersion: 1,
    destinationBindingVersion: 1,
    amountMinor: '10000',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    reference: 'internal-transfer-test',
    narration: 'test transfer',
    authorizationContextReference: 'a2-auth-context-1',
    principal,
    policy: {
      evidenceProfile: INTERNAL_TRANSFER_POLICY_EVIDENCE_PROFILE,
      expectedDecisionReference: 'a4-decision-transfer-1',
      expectedProfileReference: INTERNAL_TRANSFER_POLICY_EVIDENCE_PROFILE,
      expectedProfileVersion: 1,
      expectedEvidenceSnapshotReference: SNAPSHOT_REFERENCE,
      expectedNormalizedInputHash: NORMALIZED_INPUT_HASH,
      limitUsage: {
        amountMinor: '10000',
        currency: 'NGN',
        dailyUsedCount: 1,
        dailyUsedAmountMinor: '10000',
        monthlyUsedAmountMinor: '10000',
        projectedWalletBalanceMinor: '50000',
        usageAsOf: REQUESTED_AT,
        usageSourceReference: 'usage-transfer-1',
      },
    },
    requestContext: {
      requestId: 'request-transfer-1',
      correlationId: 'correlation-transfer-1',
      traceId: 'trace-transfer-1',
    },
    requestedAt: REQUESTED_AT,
    idempotencyKey: 'transfer-key-1',
    ...overrides,
  };
}

function makeFixture(): Fixture {
  const snapshot = makeSnapshot();
  const authorization = new FakeAuthorizationService();
  const evidence = new FakeEvidenceCoordinator(snapshot);
  const policy = new FakePolicyService(makePolicyResult(snapshot));
  const bindings = new FakeBindingPort();
  const idempotency = new FakeIdempotencyPort();
  const audit = new FakeAuditPort();
  const service = new InternalTransferGateService(
    authorization as unknown as AuthorizationService,
    policy,
    evidence,
    bindings,
    idempotency,
    audit,
  );
  return { service, authorization, evidence, policy, bindings, idempotency, audit };
}

async function expectGateFailure(
  promise: Promise<unknown>,
  code: InternalTransferGateFailure['code'],
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected gate failure ${code}`);
  } catch (error) {
    if (!(error instanceof InternalTransferGateException)) {
      throw error;
    }
    expect(error.failure.code).toBe(code);
  }
}

describe('InternalTransferGateService', () => {
  it('fails closed when A2 authorization is denied', async () => {
    const fixture = makeFixture();
    fixture.authorization.allowed = false;

    await expectGateFailure(fixture.service.validate(makeCommand()), 'AUTHORIZATION_REQUIRED');

    expect(fixture.authorization.calls).toBe(1);
    expect(fixture.evidence.calls).toBe(0);
    expect(fixture.bindings.calls).toHaveLength(0);
    expect(fixture.idempotency.reserveCalls).toBe(0);
    expect(fixture.audit.facts[0]).toMatchObject({
      action: 'REJECTED',
      failureCode: 'AUTHORIZATION_REQUIRED',
    });
  });

  it('fails closed when A4 denies transfer eligibility', async () => {
    const fixture = makeFixture();
    const snapshot = makeSnapshot();
    fixture.policy.setResult({
      ...makePolicyResult(snapshot),
      decision: PolicyDecisionState.DENY,
      reasonCodes: ['PERMISSION_DISABLED'],
    });

    await expectGateFailure(fixture.service.validate(makeCommand()), 'POLICY_NOT_EXECUTABLE');

    expect(fixture.authorization.calls).toBe(1);
    expect(fixture.evidence.calls).toBe(1);
    expect(fixture.policy.calls).toBe(1);
    expect(fixture.bindings.calls).toHaveLength(0);
    expect(fixture.idempotency.failCalls).toBe(1);
  });

  it('fails closed when the source account binding is missing', async () => {
    const fixture = makeFixture();
    fixture.bindings.failures.set(SOURCE_BINDING_ID, {
      valid: false,
      code: 'MISSING_BINDING',
      message: 'The source binding is missing',
    });

    await expectGateFailure(fixture.service.validate(makeCommand()), 'BINDING_NOT_ACTIVE');

    expect(fixture.bindings.calls).toEqual([SOURCE_BINDING_ID]);
    expect(fixture.idempotency.failCalls).toBe(1);
  });

  it('fails closed when the destination binding is inactive', async () => {
    const fixture = makeFixture();
    fixture.bindings.failures.set(DESTINATION_BINDING_ID, {
      valid: false,
      code: 'BINDING_NOT_ACTIVE',
      message: 'The destination binding is SUSPENDED',
    });

    await expectGateFailure(fixture.service.validate(makeCommand()), 'BINDING_NOT_ACTIVE');

    expect(fixture.bindings.calls).toEqual([SOURCE_BINDING_ID, DESTINATION_BINDING_ID]);
    expect(fixture.idempotency.failCalls).toBe(1);
  });

  it('rejects a customer ownership mismatch in the explicit binding tuple', async () => {
    const fixture = makeFixture();
    fixture.bindings.failures.set(SOURCE_BINDING_ID, {
      valid: false,
      code: 'IDENTITY_MISMATCH',
      message: 'The source binding customer does not own the asserted customer wallet',
    });

    await expectGateFailure(fixture.service.validate(makeCommand()), 'IDENTITY_MISMATCH');
    expect(fixture.bindings.calls).toEqual([SOURCE_BINDING_ID]);
    expect(fixture.idempotency.failCalls).toBe(1);
  });

  it('validates both owned binding tuples and returns a non-financial gate result', async () => {
    const fixture = makeFixture();

    const result = await fixture.service.validate(makeCommand());

    expect(result).toMatchObject({
      status: 'PASSED',
      replayed: false,
      commandId: COMMAND_ID,
      sourceCustomerId: SOURCE_CUSTOMER_ID,
      destinationCustomerId: DESTINATION_CUSTOMER_ID,
      sourceWalletAccountId: SOURCE_WALLET_ACCOUNT_ID,
      destinationWalletAccountId: DESTINATION_WALLET_ACCOUNT_ID,
      sourceLedgerAccountId: SOURCE_LEDGER_ACCOUNT_ID,
      destinationLedgerAccountId: DESTINATION_LEDGER_ACCOUNT_ID,
      amountMinor: '10000',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      policy: {
        decision: PolicyDecisionState.ALLOW_WITH_LIMITS,
        decisionReference: 'a4-decision-transfer-1',
      },
    });
    expect(fixture.bindings.calls).toEqual([SOURCE_BINDING_ID, DESTINATION_BINDING_ID]);
    expect(fixture.idempotency.completeCalls).toBe(1);
    expect(fixture.audit.facts.map((fact) => fact.action)).toEqual(['PASSED']);
  });

  it('replays an identical gate deterministically after rechecking A2', async () => {
    const fixture = makeFixture();
    const command = makeCommand();

    const first = await fixture.service.validate(command);
    const second = await fixture.service.validate(command);

    expect(redactRecord(first as unknown as Record<string, unknown>)).toEqual(first);
    expect(second).toMatchObject({
      ...first,
      replayed: true,
    });
    expect(fixture.authorization.calls).toBe(2);
    expect(fixture.evidence.calls).toBe(1);
    expect(fixture.policy.calls).toBe(1);
    expect(fixture.bindings.calls).toHaveLength(2);
    expect(fixture.idempotency.completeCalls).toBe(1);
    expect(fixture.audit.facts.map((fact) => fact.action)).toEqual(['PASSED', 'REPLAYED']);
  });

  it('rejects a changed payload under the same idempotency key without re-evaluating policy', async () => {
    const fixture = makeFixture();
    const command = makeCommand();
    await fixture.service.validate(command);

    await expectGateFailure(
      fixture.service.validate({ ...command, amountMinor: '10001' }),
      'IDEMPOTENCY_KEY_CONFLICT',
    );
    expect(fixture.policy.calls).toBe(1);
    expect(fixture.bindings.calls).toHaveLength(2);
  });
});
