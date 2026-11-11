/* eslint-disable @typescript-eslint/unbound-method -- Jest assertions inspect mock functions without invoking them. */
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
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
const customers = Array.from({ length: 10 }, () => randomUUID());
const actor = randomUUID();
const key = Buffer.alloc(32, 7);
const binding = { identity: input.identity, macKey: key, macKeyVersion: 'test-key-v1' };
const makeConsent = (customerId: string, kind: 'BVN' | 'NIN' = 'BVN') =>
  store.grantConsent({
    customerId,
    actorId: actor,
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
  await db.query('CREATE TABLE customers (id uuid PRIMARY KEY, deleted_at timestamptz)');
  for (const id of customers) await db.query('INSERT INTO customers(id) VALUES($1)', [id]);
  const runner = db.createQueryRunner();
  await new CreateKycFoundation1785753600104().up(runner);
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
    );
    const command = { customerId, consentId, requestId, input };
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
    await store.withdrawConsent(customerId, consentId, actor);
    expect(
      await store.evaluate(customerId, { version: 'p1', all: ['BVN'], any: [] }, [], binding),
    ).toBe('PENDING');
    expect((await orchestrator.verify(command)).outcome).toBe('CONSENT_WITHDRAWN');
  });
  it('treats provider failure as unknown and blocks new attempts even with a new consent', async () => {
    const customerId = customers[1]!;
    const consentId = await makeConsent(customerId);
    const provider = makeProvider(
      jest
        .fn<ReturnType<KycProvider['verify']>, Parameters<KycProvider['verify']>>()
        .mockRejectedValue(new Error('synthetic sensitive response')),
    );
    const orchestrator = new KycOrchestrator(store, provider, policy, key, 'test-key-v1');
    expect(
      (await orchestrator.verify({ customerId, consentId, requestId: randomUUID(), input }))
        .outcome,
    ).toBe('UNKNOWN');
    const anotherConsent = await makeConsent(customerId);
    await expect(
      orchestrator.verify({
        customerId,
        consentId: anotherConsent,
        requestId: randomUUID(),
        input,
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
  });
  it('withdrawal during dispatch prevents a match from becoming eligible', async () => {
    const customerId = customers[2]!;
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
    const orchestrator = new KycOrchestrator(store, provider, policy, key, 'test-key-v1');
    const pending = orchestrator.verify({ customerId, consentId, requestId: randomUUID(), input });
    await began;
    await store.withdrawConsent(customerId, consentId, actor);
    release({ outcome: 'MATCH' });
    expect((await pending).outcome).toBe('CONSENT_WITHDRAWN');
    expect(
      await store.evaluate(customerId, { version: 'p1', all: ['BVN'], any: [] }, [], binding),
    ).toBe('PENDING');
  });
  it('enforces cooldown after a discrepancy and rejects a missing or wrong consent', async () => {
    const customerId = customers[3]!;
    const consentId = await makeConsent(customerId);
    const provider = makeProvider(
      jest
        .fn<ReturnType<KycProvider['verify']>, Parameters<KycProvider['verify']>>()
        .mockResolvedValue({ outcome: 'REVIEW' }),
    );
    const orchestrator = new KycOrchestrator(store, provider, policy, key, 'test-key-v1');
    await expect(
      orchestrator.verify({ customerId, consentId: randomUUID(), requestId: randomUUID(), input }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    expect(
      (await orchestrator.verify({ customerId, consentId, requestId: randomUUID(), input }))
        .outcome,
    ).toBe('REVIEW');
    await expect(
      orchestrator.verify({ customerId, consentId, requestId: randomUUID(), input }),
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
    );
    const results = await Promise.allSettled([
      orchestrator.verify({
        customerId: firstCustomer,
        consentId: c1,
        requestId: randomUUID(),
        input,
      }),
      orchestrator.verify({
        customerId: secondCustomer,
        consentId: c2,
        requestId: randomUUID(),
        input,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(provider.verify).toHaveBeenCalledTimes(1);
  });
  it('enforces retry caps after cooldown even when policy values change', async () => {
    const customerId = customers[6]!;
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
    );
    await orchestrator.verify({ customerId, consentId, requestId: randomUUID(), input });
    await db.query(
      "UPDATE kyc_verification_attempts SET created_at=clock_timestamp()-interval '2 seconds' WHERE customer_id=$1",
      [customerId],
    );
    await expect(
      orchestrator.verify({ customerId, consentId, requestId: randomUUID(), input }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    const revised = new KycOrchestrator(
      store,
      makeProvider(verify),
      { ...rules, version: 'synthetic-v2', maxAttemptsPerConsent: 2 },
      key,
      'test-key-v1',
    );
    expect(
      (await revised.verify({ customerId, consentId, requestId: randomUUID(), input })).outcome,
    ).toBe('REVIEW');
    expect(verify).toHaveBeenCalledTimes(2);
  });
  it('retains an unfinished reservation after a simulated crash and blocks another dispatch', async () => {
    const customerId = customers[7]!;
    const consentId = await makeConsent(customerId);
    await store.reserve({
      customerId,
      consentId,
      requestId: randomUUID(),
      kind: 'BVN',
      provider: 'SYNTHETIC',
      requestMac: 'a'.repeat(64),
      identityMac: 'b'.repeat(64),
      macKeyVersion: 'test-key-v1',
      policy,
    });
    const verify = jest.fn<ReturnType<KycProvider['verify']>, Parameters<KycProvider['verify']>>();
    const orchestrator = new KycOrchestrator(
      store,
      makeProvider(verify),
      policy,
      key,
      'test-key-v1',
    );
    await expect(
      orchestrator.verify({ customerId, consentId, requestId: randomUUID(), input }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    expect(verify).not.toHaveBeenCalled();
  });
  it('rolls back attempt reservation if its private audit write fails', async () => {
    const customerId = customers[8]!;
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
      );
      await expect(
        orchestrator.verify({ customerId, consentId, requestId: randomUUID(), input }),
      ).rejects.toThrow();
      expect(verify).not.toHaveBeenCalled();
      expect(await store.listHistory(customerId)).toHaveLength(0);
    } finally {
      await db.query('ALTER TABLE kyc_private_audit DROP CONSTRAINT synthetic_reject_reservation');
    }
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
    await runner.release();
  });
});
