import { ForbiddenException } from '@nestjs/common';
import type {
  DataSource,
  DeepPartial,
  EntityManager,
  FindOneOptions,
  ObjectLiteral,
  Repository,
} from 'typeorm';

import type {
  AuthorizationDecision,
  AuthorizationPolicy,
} from '../src/authorization/authorization.types';
import type { AuthorizationService } from '../src/authorization/authorization.service';
import { PilotControl } from '../src/pilot/pilot-control.entity';
import { PilotControlService } from '../src/pilot/pilot-control.service';
import type {
  PilotControlEvaluationCommand,
  PilotControlMutationCommand,
} from '../src/pilot/pilot-control.types';
import type { AuditService } from '../src/operations/audit.service';
import type { IdempotencyService } from '../src/operations/idempotency.service';
import type { MetricsService } from '../src/operations/metrics.service';
import type { ConfigService } from '@nestjs/config';

const CONTROL_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000002';
const OUTSIDE_CUSTOMER_ID = '00000000-0000-4000-8000-000000000003';

class InMemoryPilotRepository {
  readonly records = new Map<string, PilotControl>();

  create(input: DeepPartial<PilotControl>): PilotControl {
    return Object.assign(new PilotControl(), input);
  }

  save(control: PilotControl): Promise<PilotControl> {
    const existing = this.records.get(control.id);
    control.version = existing ? existing.version + 1 : (control.version ?? 1);
    control.updatedAt = new Date();
    control.createdAt = control.createdAt ?? new Date();
    this.records.set(control.id, control);
    return Promise.resolve(control);
  }

  findOne(options: FindOneOptions<PilotControl>): Promise<PilotControl | null> {
    const where = options.where;
    if (!where || Array.isArray(where)) return Promise.resolve(null);
    if (typeof where.id === 'string') return Promise.resolve(this.records.get(where.id) ?? null);
    if (typeof where.controlKey === 'string') {
      return Promise.resolve(
        [...this.records.values()].find((control) => control.controlKey === where.controlKey) ??
          null,
      );
    }
    return Promise.resolve(null);
  }
}

class InMemoryManager {
  constructor(private readonly repository: InMemoryPilotRepository) {}

  getRepository<T extends ObjectLiteral>(): Repository<T> {
    return this.repository as unknown as Repository<T>;
  }
}

class FakeDataSource {
  constructor(private readonly manager: InMemoryManager) {}

  transaction<T>(
    isolationOrCallback: string | ((manager: EntityManager) => Promise<T>),
    maybeCallback?: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const callback =
      typeof isolationOrCallback === 'function' ? isolationOrCallback : maybeCallback;
    if (!callback) return Promise.reject(new Error('transaction callback missing'));
    return callback(this.manager as unknown as EntityManager);
  }
}

class FakeAuthorizationService {
  allowed = true;
  calls = 0;

  authorize(
    _principal: unknown,
    policy: AuthorizationPolicy,
    resource: { type: string; id?: string },
  ): Promise<AuthorizationDecision> {
    this.calls += 1;
    return Promise.resolve({
      allowed: this.allowed,
      reason: this.allowed ? undefined : 'SCOPE_MISSING',
      principalType: 'OPERATOR',
      principalId: 'operator-1',
      resourceType: resource.type,
      resourceId: resource.id,
      action: policy.action,
      evaluatedAt: new Date(),
      requiredScopes: policy.requiredScopes ?? [],
      requiredRoles: policy.requiredRoles ?? [],
    });
  }
}

class FakeAuditService {
  readonly events: Array<Record<string, unknown>> = [];

  record(
    _manager: EntityManager,
    command: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.events.push(command);
    return Promise.resolve(command);
  }
}

class FakeIdempotencyService {
  readonly records = new Map<
    string,
    { id: string; requestHash: string; resourceId: string | null }
  >();
  completeCalls = 0;

  reserve(
    _manager: EntityManager,
    command: { scope: string; key: string; requestHash: string },
  ): Promise<{
    kind: 'NEW' | 'REPLAY' | 'IN_PROGRESS';
    record: { id: string; requestHash: string; resourceId: string | null };
  }> {
    const key = `${command.scope}:${command.key}`;
    const existing = this.records.get(key);
    if (existing) {
      if (existing.requestHash !== command.requestHash) {
        return Promise.reject(new Error('idempotency conflict'));
      }
      return Promise.resolve({ kind: 'REPLAY', record: existing });
    }
    const record = {
      id: `reservation-${this.records.size + 1}`,
      requestHash: command.requestHash,
      resourceId: null,
    };
    this.records.set(key, record);
    return Promise.resolve({ kind: 'NEW', record });
  }

  complete(
    _manager: EntityManager,
    recordId: string,
    command: { resourceId?: string },
  ): Promise<void> {
    const record = [...this.records.values()].find((candidate) => candidate.id === recordId);
    if (!record) return Promise.reject(new Error('reservation missing'));
    record.resourceId = command.resourceId ?? null;
    this.completeCalls += 1;
    return Promise.resolve();
  }
}

class FakeMetricsService {
  metrics: Record<string, string> = {};

  getMetrics(): Promise<{ generatedAt: string; metrics: Record<string, string> }> {
    return Promise.resolve({ generatedAt: new Date().toISOString(), metrics: this.metrics });
  }
}

class FakeConfigService {
  emergencyStop = false;

  get<T>(key: string): T | undefined {
    return key === 'A5_PILOT_EMERGENCY_STOP' ? (this.emergencyStop as T) : undefined;
  }
}

interface Fixture {
  service: PilotControlService;
  repository: InMemoryPilotRepository;
  authorization: FakeAuthorizationService;
  audit: FakeAuditService;
  idempotency: FakeIdempotencyService;
  metrics: FakeMetricsService;
  config: FakeConfigService;
}

const principal = {
  type: 'CUSTOMER' as const,
  principalId: CUSTOMER_ID,
  customerId: CUSTOMER_ID,
  roles: [],
  scopes: [],
  customerAccess: 'SELF' as const,
};

function addControl(fixture: Fixture, overrides: Partial<PilotControl> = {}): PilotControl {
  const control = Object.assign(new PilotControl(), {
    id: CONTROL_ID,
    controlKey: 'wallet.transfer.create.internal.v1',
    capability: 'wallet.transfer',
    action: 'create',
    scope: 'INTERNAL_CUSTOMER_TO_CUSTOMER',
    enabled: true,
    cohortCustomerIds: [CUSTOMER_ID],
    currency: 'NGN',
    minTransactionAmountMinor: '100',
    maxTransactionAmountMinor: '50000',
    dailyTransactionCountLimit: 5,
    dailyTransactionAmountMinor: '100000',
    safetyThresholds: {},
    updatedBy: 'operator-1',
    lastCorrelationId: 'correlation-1',
    lastRequestId: 'request-1',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
  fixture.repository.records.set(control.id, control);
  return control;
}

function makeFixture(): Fixture {
  const repository = new InMemoryPilotRepository();
  const authorization = new FakeAuthorizationService();
  const audit = new FakeAuditService();
  const idempotency = new FakeIdempotencyService();
  const metrics = new FakeMetricsService();
  const config = new FakeConfigService();
  const service = new PilotControlService(
    repository as unknown as Repository<PilotControl>,
    new FakeDataSource(new InMemoryManager(repository)) as unknown as DataSource,
    authorization as unknown as AuthorizationService,
    audit as unknown as AuditService,
    idempotency as unknown as IdempotencyService,
    metrics as unknown as MetricsService,
    config as unknown as ConfigService,
  );
  const fixture = { service, repository, authorization, audit, idempotency, metrics, config };
  addControl(fixture);
  return fixture;
}

function makeEvaluation(
  overrides: Partial<PilotControlEvaluationCommand> = {},
): PilotControlEvaluationCommand {
  return {
    customerId: CUSTOMER_ID,
    capability: 'wallet.transfer',
    action: 'create',
    scope: 'INTERNAL_CUSTOMER_TO_CUSTOMER',
    amountMinor: '10000',
    currency: 'NGN',
    principal,
    authorizationDecision: {
      allowed: true,
      principalType: 'CUSTOMER',
      principalId: CUSTOMER_ID,
      resourceType: 'wallet-transfer-command',
      resourceId: '00000000-0000-4000-8000-000000000004',
      customerId: CUSTOMER_ID,
      action: 'wallet:transfer:create',
      evaluatedAt: new Date(),
      requiredScopes: [],
      requiredRoles: [],
    },
    requestContext: {
      requestId: 'request-pilot-1',
      correlationId: 'correlation-pilot-1',
      traceId: 'trace-pilot-1',
    },
    dailyTransactionCount: 1,
    dailyTransactionAmountMinor: '10000',
    ...overrides,
  };
}

function makeMutation(
  overrides: Partial<PilotControlMutationCommand> = {},
): PilotControlMutationCommand {
  return {
    controlKey: 'wallet.transfer.create.internal.v1',
    capability: 'wallet.transfer',
    action: 'create',
    scope: 'INTERNAL_CUSTOMER_TO_CUSTOMER',
    enabled: true,
    cohortCustomerIds: [CUSTOMER_ID],
    currency: 'NGN',
    minTransactionAmountMinor: '100',
    maxTransactionAmountMinor: '50000',
    dailyTransactionCountLimit: 5,
    dailyTransactionAmountMinor: '100000',
    safetyThresholds: {},
    reason: 'pilot control test',
    principal: {
      type: 'OPERATOR',
      principalId: 'operator-1',
      roles: ['pilot'],
      scopes: ['pilot:control:write'],
      customerAccess: 'ANY',
    },
    idempotencyKey: 'pilot-config-1',
    requestContext: {
      requestId: 'request-config-1',
      correlationId: 'correlation-config-1',
      traceId: 'trace-config-1',
    },
    ...overrides,
  };
}

describe('PilotControlService', () => {
  it('allows an enabled cohort customer within configured limits', async () => {
    const fixture = makeFixture();

    const decision = await fixture.service.evaluate(makeEvaluation());

    expect(decision).toMatchObject({
      allowed: true,
      decisionCode: 'PILOT_ALLOWED',
      cohortMember: true,
      controlId: CONTROL_ID,
    });
    expect(fixture.audit.events[0]).toMatchObject({ action: 'PILOT_ALLOWED' });
  });

  it('fails closed when the durable pilot is disabled', async () => {
    const fixture = makeFixture();
    fixture.repository.records.get(CONTROL_ID)!.enabled = false;

    const decision = await fixture.service.evaluate(makeEvaluation());

    expect(decision).toMatchObject({ allowed: false, decisionCode: 'PILOT_DISABLED' });
  });

  it('fails closed when the emergency stop is active', async () => {
    const fixture = makeFixture();
    fixture.config.emergencyStop = true;

    const decision = await fixture.service.evaluate(makeEvaluation());

    expect(decision).toMatchObject({
      allowed: false,
      decisionCode: 'PILOT_EMERGENCY_STOP',
      emergencyStopped: true,
    });
  });

  it('denies a customer outside the pilot cohort', async () => {
    const fixture = makeFixture();

    const decision = await fixture.service.evaluate(
      makeEvaluation({ customerId: OUTSIDE_CUSTOMER_ID }),
    );

    expect(decision).toMatchObject({ allowed: false, decisionCode: 'PILOT_COHORT_DENIED' });
  });

  it('denies a transaction above the pilot limit', async () => {
    const fixture = makeFixture();

    const decision = await fixture.service.evaluate(makeEvaluation({ amountMinor: '50001' }));

    expect(decision).toMatchObject({
      allowed: false,
      decisionCode: 'PILOT_TRANSACTION_LIMIT_EXCEEDED',
    });
  });

  it('denies daily customer usage above the configured limit', async () => {
    const fixture = makeFixture();

    const decision = await fixture.service.evaluate(makeEvaluation({ dailyTransactionCount: 5 }));

    expect(decision).toMatchObject({
      allowed: false,
      decisionCode: 'PILOT_DAILY_COUNT_LIMIT_EXCEEDED',
    });
  });

  it('denies unauthorized pilot control mutation and preserves the control', async () => {
    const fixture = makeFixture();
    fixture.authorization.allowed = false;

    await expect(
      fixture.service.configure(makeMutation({ enabled: false })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.repository.records.get(CONTROL_ID)?.enabled).toBe(true);
  });

  it('disables the pilot rollback-safely and records an auditable control decision', async () => {
    const fixture = makeFixture();

    const disabled = await fixture.service.setEnabled({
      controlKey: 'wallet.transfer.create.internal.v1',
      enabled: false,
      reason: 'emergency rollback test',
      principal: makeMutation().principal,
      idempotencyKey: 'pilot-disable-1',
      requestContext: makeMutation().requestContext,
    });
    const decision = await fixture.service.evaluate(makeEvaluation());

    expect(disabled.enabled).toBe(false);
    expect(decision.decisionCode).toBe('PILOT_DISABLED');
    expect(fixture.audit.events.map((event) => event.action)).toEqual([
      'PILOT_DISABLED',
      'PILOT_DENIED',
    ]);
    expect(fixture.repository.records.size).toBe(1);
  });

  it('stops the pilot when an operational safety threshold is breached', async () => {
    const fixture = makeFixture();
    fixture.repository.records.get(CONTROL_ID)!.safetyThresholds = { unknownOutcomeCount: 1 };
    fixture.metrics.metrics = { 'transfers.unknown': '1' };

    const decision = await fixture.service.evaluate(makeEvaluation());

    expect(decision).toMatchObject({ allowed: false, decisionCode: 'PILOT_SAFETY_STOP' });
  });
});
