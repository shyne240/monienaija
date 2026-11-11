/* eslint-disable @typescript-eslint/unbound-method -- Jest assertions inspect mock functions without invoking them. */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuthorizationService } from '../src/authorization/authorization.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import type { AuditService } from '../src/operations/audit.service';
import { KycExceptionReviewService } from '../src/kyc-verification/kyc-exception-review.service';
import { KycReconciliationReview1785753600106 } from '../src/migrations/1785753600106-KycReconciliationReview';
import { KycReconciliationService } from '../src/kyc-verification/kyc-reconciliation.service';
import { KycSessionAndOwnership1785753600105 } from '../src/migrations/1785753600105-KycSessionAndOwnership';
import { CreateKycFoundation1785753600104 } from '../src/migrations/1785753600104-CreateKycFoundation';
import { KycOrchestrator } from '../src/kyc-verification/kyc-orchestrator';
import { PostgresKycStore } from '../src/kyc-verification/postgres-kyc.store';
import type {
  KycPolicy,
  KycProvider,
  ProviderResult,
  VerificationInput,
} from '../src/kyc-verification/kyc.types';

// This test refuses all TCP, normal app databases, and non-disposable socket paths.
const socket = process.env.KYC_ISOLATED_TEST_SOCKET ?? '';
if (!/^\/home\/user\/m25c-isolated-pgsocket\/kyc-batch1-[A-Za-z0-9]+$/.test(socket))
  throw new Error('Disposable KYC socket required');
const schema = `kyc_test_${randomUUID().replace(/-/g, '')}`;
const db = new DataSource({
  type: 'postgres',
  host: socket,
  port: 55461,
  username: 'kyc_synthetic',
  database: 'postgres',
  synchronize: false,
  logging: false,
  extra: { options: `-c search_path=${schema}` },
});
const testRouting = { assert: () => Promise.resolve() };
const policy: KycPolicy = {
  version: 'synthetic-v1',
  enabled: true,
  maxAttemptsPerConsent: 2,
  cooldownSeconds: 1,
  customerWindowSeconds: 60,
  customerWindowLimit: 5,
  providerWindowSeconds: 60,
  providerWindowLimit: 100,
  timeoutMs: 1000,
  evidenceValiditySeconds: 3600,
};
const input: VerificationInput = {
  kind: 'BVN',
  identifier: '00000000000',
  identity: {
    firstName: 'Synthetic',
    lastName: 'Person',
    dateOfBirth: '2000-02-29',
    phone: '00000000000',
  },
};
let store: PostgresKycStore;
let schemaCreated = false;
const customers = Array.from({ length: 14 }, () => randomUUID());
const tokenFor = (id: string) =>
  Buffer.alloc(32, customers.indexOf(id as (typeof customers)[number]) + 1).toString('base64url');
const inputFor = (id: string): VerificationInput => ({
  ...input,
  identifier: String(customers.indexOf(id as (typeof customers)[number])).padStart(11, '0'),
});
const ownerKey = Buffer.alloc(32, 9);
const key = Buffer.alloc(32, 7);
const binding = { identity: input.identity, macKey: key, macKeyVersion: 'test-key-v1' };
const makeConsent = (customerId: string, kind: 'BVN' | 'NIN' = 'BVN') =>
  store.grantConsent({
    customerId,
    sessionToken: tokenFor(customerId),
    kind,
    noticeVersion: 'synthetic-v1',
    expiresAt: new Date(Date.now() + 60000),
  });
const makeProvider = (verify: KycProvider['verify'], code = 'SYNTHETIC'): KycProvider => ({
  code,
  verify,
});

beforeAll(async () => {
  await db.initialize();
  const location = await db.query<Array<{ data_directory: string }>>('SHOW data_directory');
  const listen = await db.query<Array<{ listen_addresses: string }>>('SHOW listen_addresses');
  if (
    !/^\/home\/user\/kyc-batch1-pg-[A-Za-z0-9]+$/.test(location[0]?.data_directory ?? '') ||
    listen[0]?.listen_addresses !== ''
  )
    throw new Error('Not a disposable socket-only test cluster');
  await db.query(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;
  await db.query(
    "CREATE TABLE customers (id uuid PRIMARY KEY, deleted_at timestamptz, status text NOT NULL DEFAULT 'ACTIVE')",
  );
  await db.query(
    'CREATE TABLE authentication_sessions (id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id), token_hash char(64) NOT NULL, audience text NOT NULL, status text NOT NULL, expires_at timestamptz NOT NULL)',
  );
  for (const id of customers) {
    await db.query('INSERT INTO customers(id) VALUES($1)', [id]);
    await db.query(
      "INSERT INTO authentication_sessions(id,customer_id,token_hash,audience,status,expires_at) VALUES($1,$2,$3,'customer-api','ACTIVE',clock_timestamp()+interval '1 hour')",
      [randomUUID(), id, createHash('sha256').update(tokenFor(id)).digest('hex')],
    );
  }
  const runner = db.createQueryRunner();
  await new CreateKycFoundation1785753600104().up(runner);
  await new KycSessionAndOwnership1785753600105().up(runner);
  await new KycReconciliationReview1785753600106().up(runner);
  await runner.release();
  store = new PostgresKycStore(db);
});
afterAll(async () => {
  if (db.isInitialized) {
    if (schemaCreated) await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.destroy();
  }
});

describe('KYC foundation on an isolated synthetic PostgreSQL instance', () => {
  it('serializes concurrent reservations, replays without a second provider call, and stores no raw identity', async () => {
    const customerId = customers[0]!;
    const input = inputFor(customerId);
    const consentId = await makeConsent(customerId);
    const requestId = randomUUID();
    let release!: (result: ProviderResult) => void;
    let called!: () => void;
    const began = new Promise<void>((resolve) => {
      called = resolve;
    });
    const verify = jest
      .fn<ReturnType<KycProvider['verify']>, Parameters<KycProvider['verify']>>()
      .mockImplementation(() => {
        called();
        return new Promise((resolve) => {
          release = resolve;
        });
      });
    const orchestrator = new KycOrchestrator(
      store,
      makeProvider(verify),
      policy,
      key,
      'test-key-v1',
      ownerKey,
      'owner-v1',
      testRouting,
    );
    const command = { customerId, consentId, requestId, sessionToken: tokenFor(customerId), input };
    const first = orchestrator.verify(command);
    await began;
    const replay = await orchestrator.verify(command);
    expect(replay.outcome).toBe('DISPATCHING');
    await expect(
      orchestrator.verify({ ...command, requestId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    await expect(
      orchestrator.verify({ ...command, input: { ...input, identifier: '11111111111' } }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    release({ outcome: 'MATCH', reference: 'synthetic-provider-reference' });
    expect((await first).outcome).toBe('MATCH');
    expect((await orchestrator.verify(command)).outcome).toBe('MATCH');
    expect(verify).toHaveBeenCalledTimes(1);
    const history = await store.listHistory(customerId);
    expect(history).toHaveLength(1);
    const evidence = await store.evaluate(
      customerId,
      { version: 'p1', all: ['BVN'], any: [] },
      [],
      binding,
    );
    expect(evidence).toBe('SATISFIED');
    expect(
      await store.evaluate(customerId, { version: 'p1', all: ['BVN'], any: [] }, [], {
        ...binding,
        identity: { ...input.identity, lastName: 'Changed' },
      }),
    ).toBe('PENDING');
    expect(
      await store.evaluate(customerId, { version: 'p1', all: ['BVN'], any: [] }, [], {
        ...binding,
        macKeyVersion: 'rotated',
      }),
    ).toBe('PENDING');
    const dbRows = await db.query<unknown[]>('SELECT * FROM kyc_verification_attempts');
    const serialized = JSON.stringify(dbRows);
    expect(serialized).not.toContain(input.identifier);
    expect(serialized).not.toContain('Synthetic');
    expect(serialized).not.toContain('synthetic-provider-reference');
    await store.withdrawConsent(customerId, consentId, tokenFor(customerId));
    expect(
      await db.query<Array<{ revision: string }>>(
        'SELECT revision FROM kyc_evaluation_refresh WHERE customer_id=$1',
        [customerId],
      ),
    ).toEqual([{ revision: '2' }]);
    expect(
      await store.evaluate(customerId, { version: 'p1', all: ['BVN'], any: [] }, [], binding),
    ).toBe('PENDING');
    expect((await orchestrator.verify(command)).outcome).toBe('CONSENT_WITHDRAWN');
  });
  it('treats provider failure as unknown and blocks new attempts even with a new consent', async () => {
    const customerId = customers[1]!;
    const input = inputFor(customerId);
    const consentId = await makeConsent(customerId);
    const provider = makeProvider(
      jest
        .fn<ReturnType<KycProvider['verify']>, Parameters<KycProvider['verify']>>()
        .mockRejectedValue(new Error('synthetic sensitive response')),
    );
    const orchestrator = new KycOrchestrator(
      store,
      provider,
      policy,
      key,
      'test-key-v1',
      ownerKey,
      'owner-v1',
      testRouting,
    );
    expect(
      (
        await orchestrator.verify({
          customerId,
          consentId,
          requestId: randomUUID(),
          sessionToken: tokenFor(customerId),
          input,
        })
      ).outcome,
    ).toBe('UNKNOWN');
    const cases = await db.query<Array<{ reason: string; status: string }>>(
      'SELECT reason,status FROM kyc_reconciliation_cases WHERE customer_id=$1',
      [customerId],
    );
    expect(cases).toEqual([{ reason: 'UNKNOWN', status: 'OPEN' }]);
    const refresh = await db.query<Array<{ revision: string }>>(
      'SELECT revision FROM kyc_evaluation_refresh WHERE customer_id=$1',
      [customerId],
    );
    expect(refresh).toHaveLength(1);
    const anotherConsent = await makeConsent(customerId);
    await expect(
      orchestrator.verify({
        customerId,
        consentId: anotherConsent,
        requestId: randomUUID(),
        sessionToken: tokenFor(customerId),
        input,
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
  });
  it('processes unresolved cases with separate authorized reviewers without releasing the claim or retrying', async () => {
    const customerId = customers[1]!;
    const cases = await db.query<Array<{ id: string }>>(
      'SELECT id FROM kyc_reconciliation_cases WHERE customer_id=$1',
      [customerId],
    );
    const audit = { record: jest.fn().mockResolvedValue({}) } as unknown as AuditService;
    const review = new KycReconciliationService(db, new AuthorizationService(db, audit));
    const maker: AuthorizationPrincipal = {
      type: 'OPERATOR',
      principalId: randomUUID(),
      sessionId: randomUUID(),
      roles: ['COMPLIANCE'],
      scopes: ['kyc.review', 'kyc.approve'],
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    };
    const checker = { ...maker, principalId: randomUUID(), sessionId: randomUUID() };
    const cmd = {
      caseId: cases[0]!.id,
      requestId: randomUUID(),
      action: 'REVIEW' as const,
      reason: 'OUTCOME_UNPROVEN' as const,
    };
    await expect(review.decide(undefined, cmd)).rejects.toMatchObject({ code: 'BLOCKED' });
    await expect(
      review.decide({ ...maker, assuranceLevel: 'PASSWORD' }, cmd),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    expect(await review.decide(maker, cmd)).toEqual({ status: 'REVIEW', replay: false });
    expect(await review.decide(maker, cmd)).toEqual({ status: 'REVIEW', replay: true });
    await expect(
      review.decide(maker, { ...cmd, reason: 'MANUAL_INVESTIGATION' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const close = { ...cmd, requestId: randomUUID(), action: 'TERMINAL' as const };
    await expect(review.decide(maker, close)).rejects.toMatchObject({ code: 'BLOCKED' });
    const approvals = await Promise.all([
      review.decide(checker, close),
      review.decide(checker, close),
    ]);
    expect(approvals.map((a) => a.replay).sort()).toEqual([false, true]);
    const verify = jest.fn<ReturnType<KycProvider['verify']>, Parameters<KycProvider['verify']>>();
    const anotherConsent = await makeConsent(customerId);
    const orchestrator = new KycOrchestrator(
      store,
      makeProvider(verify),
      policy,
      key,
      'test-key-v1',
      ownerKey,
      'owner-v1',
      testRouting,
    );
    await expect(
      orchestrator.verify({
        customerId,
        consentId: anotherConsent,
        requestId: randomUUID(),
        sessionToken: tokenFor(customerId),
        input: inputFor(customerId),
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    expect(verify).not.toHaveBeenCalled();
    expect(
      await db.query<Array<{ outcome: string }>>(
        'SELECT outcome FROM kyc_verification_attempts WHERE customer_id=$1',
        [customerId],
      ),
    ).toEqual([{ outcome: 'UNKNOWN' }]);
    expect(
      await db.query<Array<{ status: string }>>(
        'SELECT status FROM kyc_identity_claims WHERE customer_id=$1',
        [customerId],
      ),
    ).toEqual([{ status: 'UNKNOWN' }]);
  });
  it('withdrawal during dispatch prevents a match from becoming eligible', async () => {
    const customerId = customers[2]!;
    const input = inputFor(customerId);
    const consentId = await makeConsent(customerId);
    let release!: (result: ProviderResult) => void;
    let called!: () => void;
    const began = new Promise<void>((resolve) => {
      called = resolve;
    });
    const provider = makeProvider(() => {
      called();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const orchestrator = new KycOrchestrator(
      store,
      provider,
      policy,
      key,
      'test-key-v1',
      ownerKey,
      'owner-v1',
      testRouting,
    );
    const pending = orchestrator.verify({
      customerId,
      consentId,
      requestId: randomUUID(),
      sessionToken: tokenFor(customerId),
      input,
    });
    await began;
    await store.withdrawConsent(customerId, consentId, tokenFor(customerId));
    release({ outcome: 'MATCH' });
    expect((await pending).outcome).toBe('CONSENT_WITHDRAWN');
    expect(
      await store.evaluate(customerId, { version: 'p1', all: ['BVN'], any: [] }, [], binding),
    ).toBe('PENDING');
  });
  it('enforces cooldown after a discrepancy and rejects a missing or wrong consent', async () => {
    const customerId = customers[3]!;
    const input = inputFor(customerId);
    const consentId = await makeConsent(customerId);
    const provider = makeProvider(
      jest
        .fn<ReturnType<KycProvider['verify']>, Parameters<KycProvider['verify']>>()
        .mockResolvedValue({ outcome: 'REVIEW' }),
    );
    const orchestrator = new KycOrchestrator(
      store,
      provider,
      policy,
      key,
      'test-key-v1',
      ownerKey,
      'owner-v1',
      testRouting,
    );
    await expect(
      orchestrator.verify({
        customerId,
        consentId: randomUUID(),
        requestId: randomUUID(),
        sessionToken: tokenFor(customerId),
        input,
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    expect(
      (
        await orchestrator.verify({
          customerId,
          consentId,
          requestId: randomUUID(),
          sessionToken: tokenFor(customerId),
          input,
        })
      ).outcome,
    ).toBe('REVIEW');
    await expect(
      orchestrator.verify({
        customerId,
        consentId,
        requestId: randomUUID(),
        sessionToken: tokenFor(customerId),
        input,
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
  });
  it('atomically limits provider requests across customers', async () => {
    const firstCustomer = customers[4]!;
    const secondCustomer = customers[5]!;
    const [c1, c2] = await Promise.all([makeConsent(firstCustomer), makeConsent(secondCustomer)]);
    const provider = makeProvider(
      jest
        .fn<ReturnType<KycProvider['verify']>, Parameters<KycProvider['verify']>>()
        .mockResolvedValue({ outcome: 'REVIEW' }),
      'LIMITED',
    );
    const orchestrator = new KycOrchestrator(
      store,
      provider,
      { ...policy, providerWindowLimit: 1 },
      key,
      'test-key-v1',
      ownerKey,
      'owner-v1',
      testRouting,
    );
    const results = await Promise.allSettled([
      orchestrator.verify({
        customerId: firstCustomer,
        consentId: c1,
        requestId: randomUUID(),
        sessionToken: tokenFor(firstCustomer),
        input: inputFor(firstCustomer),
      }),
      orchestrator.verify({
        customerId: secondCustomer,
        consentId: c2,
        requestId: randomUUID(),
        sessionToken: tokenFor(secondCustomer),
        input: inputFor(secondCustomer),
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(provider.verify).toHaveBeenCalledTimes(1);
  });
  it('enforces retry caps after cooldown even when policy values change', async () => {
    const customerId = customers[6]!;
    const input = inputFor(customerId);
    const consentId = await makeConsent(customerId);
    const verify = jest
      .fn<ReturnType<KycProvider['verify']>, Parameters<KycProvider['verify']>>()
      .mockResolvedValue({ outcome: 'REVIEW' });
    const rules = { ...policy, maxAttemptsPerConsent: 1 };
    const orchestrator = new KycOrchestrator(
      store,
      makeProvider(verify),
      rules,
      key,
      'test-key-v1',
      ownerKey,
      'owner-v1',
      testRouting,
    );
    await orchestrator.verify({
      customerId,
      consentId,
      requestId: randomUUID(),
      sessionToken: tokenFor(customerId),
      input,
    });
    await db.query(
      "UPDATE kyc_verification_attempts SET created_at=clock_timestamp()-interval '2 seconds' WHERE customer_id=$1",
      [customerId],
    );
    await expect(
      orchestrator.verify({
        customerId,
        consentId,
        requestId: randomUUID(),
        sessionToken: tokenFor(customerId),
        input,
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    const revised = new KycOrchestrator(
      store,
      makeProvider(verify),
      { ...rules, version: 'synthetic-v2', maxAttemptsPerConsent: 2 },
      key,
      'test-key-v1',
      ownerKey,
      'owner-v1',
      testRouting,
    );
    expect(
      (
        await revised.verify({
          customerId,
          consentId,
          requestId: randomUUID(),
          sessionToken: tokenFor(customerId),
          input,
        })
      ).outcome,
    ).toBe('REVIEW');
    expect(verify).toHaveBeenCalledTimes(2);
  });
  it('retains an unfinished reservation after a simulated crash and blocks another dispatch', async () => {
    const customerId = customers[7]!;
    const input = inputFor(customerId);
    const consentId = await makeConsent(customerId);
    const reserved = await store.reserve({
      customerId,
      consentId,
      requestId: randomUUID(),
      kind: 'BVN',
      provider: 'SYNTHETIC',
      sessionToken: tokenFor(customerId),
      identifierMac: createHmac('sha256', ownerKey)
        .update('kyc-identifier-v1\0')
        .update('BVN')
        .update('\0')
        .update(input.identifier)
        .digest('hex'),
      ownershipKeyProof: createHmac('sha256', ownerKey)
        .update('kyc-ownership-key-proof-v1')
        .digest('hex'),
      ownershipKeyVersion: 'owner-v1',
      requestMac: 'a'.repeat(64),
      identityMac: 'b'.repeat(64),
      macKeyVersion: 'test-key-v1',
      policy,
    });
    await db.query(
      "UPDATE kyc_verification_attempts SET created_at=clock_timestamp()-interval '120 seconds' WHERE customer_id=$1",
      [customerId],
    );
    expect(await store.queueInterrupted(60)).toBe(1);
    expect(await store.queueInterrupted(60)).toBe(0);
    expect(
      await db.query<Array<{ reason: string; status: string }>>(
        'SELECT reason,status FROM kyc_reconciliation_cases WHERE customer_id=$1',
        [customerId],
      ),
    ).toEqual([{ reason: 'INTERRUPTED', status: 'OPEN' }]);
    const verify = jest.fn<ReturnType<KycProvider['verify']>, Parameters<KycProvider['verify']>>();
    const orchestrator = new KycOrchestrator(
      store,
      makeProvider(verify),
      policy,
      key,
      'test-key-v1',
      ownerKey,
      'owner-v1',
      testRouting,
    );
    await expect(
      orchestrator.verify({
        customerId,
        consentId,
        requestId: randomUUID(),
        sessionToken: tokenFor(customerId),
        input,
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    expect(verify).not.toHaveBeenCalled();
    await store.finish(reserved.attempt, 'REVIEW', 3600, null);
    expect(
      await db.query<Array<{ reason: string; status: string }>>(
        'SELECT reason,status FROM kyc_reconciliation_cases WHERE customer_id=$1',
        [customerId],
      ),
    ).toEqual([{ reason: 'INTERRUPTED', status: 'NO_ACTION' }]);
  });
  it('quarantines interrupted attempts without replaying or accepting late matches', async () => {
    const customerId = customers[13]!;
    const input = inputFor(customerId);
    const consentId = await makeConsent(customerId);
    const reserved = await store.reserve({
      customerId,
      consentId,
      requestId: randomUUID(),
      kind: 'BVN',
      provider: 'SYNTHETIC',
      sessionToken: tokenFor(customerId),
      identifierMac: createHmac('sha256', ownerKey)
        .update('kyc-identifier-v1\0')
        .update('BVN')
        .update('\0')
        .update(input.identifier)
        .digest('hex'),
      ownershipKeyProof: createHmac('sha256', ownerKey)
        .update('kyc-ownership-key-proof-v1')
        .digest('hex'),
      ownershipKeyVersion: 'owner-v1',
      requestMac: 'a'.repeat(64),
      identityMac: 'b'.repeat(64),
      macKeyVersion: 'test-key-v1',
      policy,
    });
    await expect(store.quarantineInterrupted(reserved.attempt.id, 60)).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    await db.query(
      "UPDATE kyc_verification_attempts SET created_at=clock_timestamp()-interval '120 seconds' WHERE id=$1",
      [reserved.attempt.id],
    );
    expect(await store.queueInterrupted(60)).toBe(1);
    await Promise.all([
      store.quarantineInterrupted(reserved.attempt.id, 60),
      store.quarantineInterrupted(reserved.attempt.id, 60),
    ]);
    await expect(store.finish(reserved.attempt, 'MATCH', 3600, null)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(
      await db.query<Array<{ outcome: string }>>(
        'SELECT outcome FROM kyc_verification_attempts WHERE id=$1',
        [reserved.attempt.id],
      ),
    ).toEqual([{ outcome: 'UNKNOWN' }]);
    expect(
      await db.query<Array<{ status: string }>>(
        'SELECT status FROM kyc_identity_claims WHERE attempt_id=$1',
        [reserved.attempt.id],
      ),
    ).toEqual([{ status: 'UNKNOWN' }]);
    const verify = jest.fn<ReturnType<KycProvider['verify']>, Parameters<KycProvider['verify']>>();
    const orchestrator = new KycOrchestrator(
      store,
      makeProvider(verify),
      policy,
      key,
      'test-key-v1',
      ownerKey,
      'owner-v1',
      testRouting,
    );
    await expect(
      orchestrator.verify({
        customerId,
        consentId,
        requestId: randomUUID(),
        sessionToken: tokenFor(customerId),
        input,
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    expect(verify).not.toHaveBeenCalled();
  });
  it('rolls back attempt reservation if its private audit write fails', async () => {
    const customerId = customers[8]!;
    const input = inputFor(customerId);
    const consentId = await makeConsent(customerId);
    await db.query(
      "ALTER TABLE kyc_private_audit ADD CONSTRAINT synthetic_reject_reservation CHECK (action <> 'ATTEMPT_RESERVED') NOT VALID",
    );
    const verify = jest.fn<ReturnType<KycProvider['verify']>, Parameters<KycProvider['verify']>>();
    try {
      const orchestrator = new KycOrchestrator(
        store,
        makeProvider(verify),
        policy,
        key,
        'test-key-v1',
        ownerKey,
        'owner-v1',
        testRouting,
      );
      await expect(
        orchestrator.verify({
          customerId,
          consentId,
          requestId: randomUUID(),
          sessionToken: tokenFor(customerId),
          input,
        }),
      ).rejects.toThrow();
      expect(verify).not.toHaveBeenCalled();
      expect(await store.listHistory(customerId)).toHaveLength(0);
    } finally {
      await db.query('ALTER TABLE kyc_private_audit DROP CONSTRAINT synthetic_reject_reservation');
    }
  });
  it('requires a live customer session for consent and dispatch, not another customer session', async () => {
    const customerId = customers[9]!;
    await expect(
      store.grantConsent({
        customerId,
        sessionToken: tokenFor(customers[10]!),
        kind: 'BVN',
        noticeVersion: 'v1',
        expiresAt: new Date(Date.now() + 60000),
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    const consentId = await makeConsent(customerId);
    const verify = jest.fn<ReturnType<KycProvider['verify']>, Parameters<KycProvider['verify']>>();
    const orchestrator = new KycOrchestrator(
      store,
      makeProvider(verify),
      policy,
      key,
      'test-key-v1',
      ownerKey,
      'owner-v1',
      testRouting,
    );
    await expect(
      orchestrator.verify({
        customerId,
        consentId,
        requestId: randomUUID(),
        sessionToken: tokenFor(customers[10]!),
        input: inputFor(customerId),
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    await db.query("UPDATE authentication_sessions SET status='REVOKED' WHERE customer_id=$1", [
      customerId,
    ]);
    await expect(
      orchestrator.verify({
        customerId,
        consentId,
        requestId: randomUUID(),
        sessionToken: tokenFor(customerId),
        input: inputFor(customerId),
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    expect(verify).not.toHaveBeenCalled();
  });
  it('prevents concurrent cross-customer ownership claims and never dispatches twice', async () => {
    const customerA = customers[10]!;
    const customerB = customers[11]!;
    const [consentA, consentB] = await Promise.all([
      makeConsent(customerA),
      makeConsent(customerB),
    ]);
    const verify = jest
      .fn<ReturnType<KycProvider['verify']>, Parameters<KycProvider['verify']>>()
      .mockResolvedValue({ outcome: 'MATCH' });
    const orchestrator = new KycOrchestrator(
      store,
      makeProvider(verify, 'OWNERSHIP'),
      policy,
      key,
      'test-key-v1',
      ownerKey,
      'owner-v1',
      testRouting,
    );
    const shared = { ...input, identifier: '99999999999' };
    const results = await Promise.allSettled([
      orchestrator.verify({
        customerId: customerA,
        consentId: consentA,
        requestId: randomUUID(),
        sessionToken: tokenFor(customerA),
        input: shared,
      }),
      orchestrator.verify({
        customerId: customerB,
        consentId: consentB,
        requestId: randomUUID(),
        sessionToken: tokenFor(customerB),
        input: shared,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(verify).toHaveBeenCalledTimes(1);
    const conflicts = await db.query<Array<{ status: string }>>(
      'SELECT status FROM kyc_identity_conflicts WHERE requester_customer_id=ANY($1::uuid[])',
      [[customerA, customerB]],
    );
    expect(conflicts).toEqual([{ status: 'OPEN' }]);
    const claims = JSON.stringify(await db.query<unknown[]>('SELECT * FROM kyc_identity_claims'));
    expect(claims).not.toContain(shared.identifier);
    expect(claims).not.toContain(tokenFor(customerA));
  });
  it('requires authenticated MFA KYC review authority to record a hold; no claim is transferred', async () => {
    const rows = await db.query<Array<{ id: string; claim_id: string }>>(
      'SELECT id,claim_id FROM kyc_identity_conflicts LIMIT 1',
    );
    const conflict = rows[0]!;
    const audit = { record: jest.fn().mockResolvedValue({}) } as unknown as AuditService;
    const auth = new AuthorizationService(db, audit);
    const service = new KycExceptionReviewService(db, auth);
    const principal: AuthorizationPrincipal = {
      type: 'OPERATOR',
      principalId: randomUUID(),
      sessionId: randomUUID(),
      roles: ['COMPLIANCE'],
      scopes: ['kyc.review'],
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    };
    await expect(service.hold(undefined, conflict.id, 'OWNERSHIP_DISPUTED')).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    await expect(
      service.hold({ ...principal, scopes: [] }, conflict.id, 'OWNERSHIP_DISPUTED'),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    await expect(
      service.hold({ ...principal, assuranceLevel: 'PASSWORD' }, conflict.id, 'OWNERSHIP_DISPUTED'),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    await expect(
      service.hold({ ...principal, readOnlyPrincipal: true }, conflict.id, 'OWNERSHIP_DISPUTED'),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    const before = await db.query<unknown[]>('SELECT * FROM kyc_identity_claims WHERE id=$1', [
      conflict.claim_id,
    ]);
    await service.hold(principal, conflict.id, 'OWNERSHIP_DISPUTED');
    const after = await db.query<unknown[]>('SELECT * FROM kyc_identity_claims WHERE id=$1', [
      conflict.claim_id,
    ]);
    expect(after).toEqual(before);
    expect(
      await db.query<Array<{ status: string }>>(
        'SELECT status FROM kyc_identity_conflicts WHERE id=$1',
        [conflict.id],
      ),
    ).toEqual([{ status: 'REVIEWED_HOLD' }]);
    expect(
      await db.query<Array<{ action: string }>>(
        "SELECT action FROM kyc_private_audit WHERE action='OWNERSHIP_REVIEWED'",
      ),
    ).toHaveLength(1);
    await expect(service.hold(principal, conflict.id, 'OWNERSHIP_DISPUTED')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
  it('fails closed if the ownership key changes without migration', async () => {
    const customerId = customers[12]!;
    const consentId = await makeConsent(customerId);
    const verify = jest.fn<ReturnType<KycProvider['verify']>, Parameters<KycProvider['verify']>>();
    const o = new KycOrchestrator(
      store,
      makeProvider(verify),
      policy,
      key,
      'test-key-v1',
      Buffer.alloc(32, 8),
      'rotated',
      testRouting,
    );
    await expect(
      o.verify({
        customerId,
        consentId,
        requestId: randomUUID(),
        sessionToken: tokenFor(customerId),
        input: inputFor(customerId),
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    expect(verify).not.toHaveBeenCalled();
  });
  it('keeps audit records transactional and does not permit destructive rollback of history', async () => {
    const rows = await db.query<Array<{ action: string }>>('SELECT action FROM kyc_private_audit');
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        'CONSENT_GRANTED',
        'CONSENT_WITHDRAWN',
        'ATTEMPT_RESERVED',
        'ATTEMPT_FINISHED',
      ]),
    );
    const runner = db.createQueryRunner();
    await expect(new CreateKycFoundation1785753600104().down(runner)).rejects.toThrow(
      'Refusing to remove KYC history',
    );
    await expect(new KycReconciliationReview1785753600106().down(runner)).rejects.toThrow(
      'Refusing to remove reconciliation history',
    );
    await runner.release();
  });
});
