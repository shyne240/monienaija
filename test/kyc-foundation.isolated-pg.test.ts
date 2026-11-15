/* eslint-disable @typescript-eslint/unbound-method -- Jest assertions inspect mock functions without invoking them. */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { DataSource, type EntityManager, type Repository } from 'typeorm';
import { assertIsolatedKycCluster, isolatedKycCluster } from './support/kyc-isolated-cluster';
import { AuthorizationService } from '../src/authorization/authorization.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import type { AuthenticationSession } from '../src/customer-authentication/authentication-session.entity';
import { AuthenticationSessionService } from '../src/customer-authentication/authentication-session.service';
import type { Customer } from '../src/customer/customer.entity';
import type { CustomerFinancialEligibilityService } from '../src/kyc-verification/customer-financial-eligibility.service';
import type { AuditService } from '../src/operations/audit.service';
import { KycExceptionReviewService } from '../src/kyc-verification/kyc-exception-review.service';
import { KycReconciliationReview1785753600106 } from '../src/migrations/1785753600106-KycReconciliationReview';
import { KycIdentityRevisionAndEvidenceRead1785753600505 } from '../src/migrations/1785753600505-KycIdentityRevisionAndEvidenceRead';
import { KycReconciliationService } from '../src/kyc-verification/kyc-reconciliation.service';
import { KycSessionAndOwnership1785753600105 } from '../src/migrations/1785753600105-KycSessionAndOwnership';
import { CreateKycFoundation1785753600104 } from '../src/migrations/1785753600104-CreateKycFoundation';
import { KycOrchestrator } from '../src/kyc-verification/kyc-orchestrator';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { KycCustomerSessionValidator } from '../src/kyc-verification/kyc-customer-session-validator';
import { KycCustomerVerificationService } from '../src/kyc-verification/kyc-customer-verification.service';
import type { KycTierPolicyService } from '../src/kyc-verification/kyc-tier-policy.service';
import type { KycProviderGovernanceService } from '../src/kyc-verification/kyc-provider-governance.service';
import { PostgresKycStore } from '../src/kyc-verification/postgres-kyc.store';
import type {
  KycPolicy,
  KycProvider,
  ProviderResult,
  VerificationInput,
} from '../src/kyc-verification/kyc.types';

// This test refuses all TCP, normal app databases, and non-disposable socket paths.
// Portable provenance: see test/support/kyc-isolated-cluster.ts. No absolute path from any one
// developer's machine is embedded here; the runner (scripts/run-isolated-kyc-tests.js) creates
// the disposable cluster and exports KYC_ISOLATED_TEST_SOCKET.
const cluster = isolatedKycCluster();
const socket = cluster.socketDirectory;
const schema = `kyc_test_${randomUUID().replace(/-/g, '')}`;
const db = new DataSource({
  type: 'postgres',
  host: socket,
  port: cluster.port,
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
let sessions: AuthenticationSessionService;
let schemaCreated = false;
const customers = Array.from({ length: 22 }, () => randomUUID());
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
const customerWorkflowPolicy: KycPolicy = { ...policy, version: 'customer-ops-v1' };
const customerWorkflowConfiguration = {
  enabled: true,
  policy: customerWorkflowPolicy,
  consentNoticeVersion: 'customer-notice-v1',
  consentNoticeText: 'I authorize this identity check for the stated verification purpose.',
  consentValiditySeconds: 7200,
  ownershipKey: ownerKey,
  ownershipKeyVersion: 'owner-v1',
};
async function seedActualCustomerIdentity(customerId: string) {
  await db.query(
    'INSERT INTO customer_profiles(customer_id,first_name,last_name,date_of_birth) VALUES($1,$2,$3,$4)',
    [customerId, 'Amina', 'Danladi', '1990-01-01'],
  );
  await db.query(
    "INSERT INTO customer_contact_methods(customer_id,type,normalized_value,is_primary,verified_at) VALUES($1,'PHONE','+2348012345678',true,clock_timestamp())",
    [customerId],
  );
}

beforeAll(async () => {
  await db.initialize();
  // Cluster provenance is asserted by the shared helper (marker + manifest + socket-only +
  // minimum server version). It used to be re-implemented here against a hardcoded path.
  await assertIsolatedKycCluster(db, cluster);
  await db.query(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;
  await db.query(
    "CREATE TABLE customers (id uuid PRIMARY KEY, deleted_at timestamptz, status text NOT NULL DEFAULT 'ACTIVE', customer_type text NOT NULL DEFAULT 'INDIVIDUAL', is_synthetic boolean NOT NULL DEFAULT false, kyc_level text NOT NULL DEFAULT 'NONE', kyc_status text NOT NULL DEFAULT 'NOT_STARTED')",
  );
  await db.query(`CREATE TABLE customer_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES customers(id),
    display_name text NOT NULL DEFAULT 'Fixture Customer',legal_name text,first_name text,middle_name text,
    last_name text,date_of_birth date,nationality text,is_active boolean NOT NULL DEFAULT true,
    deleted_at timestamptz,updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`);
  await db.query(`CREATE TABLE customer_contact_methods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES customers(id),
    type text NOT NULL,normalized_value text NOT NULL,is_primary boolean NOT NULL DEFAULT false,
    verified_at timestamptz,deleted_at timestamptz,updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`);
  await db.query(`CREATE TABLE customer_addresses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES customers(id),
    type text NOT NULL,line_one text NOT NULL DEFAULT 'Fixture Road',line_two text,city text NOT NULL DEFAULT 'Jos',
    state text NOT NULL DEFAULT 'Plateau',country text NOT NULL DEFAULT 'NG',postal_code text,
    is_primary boolean NOT NULL DEFAULT false,deleted_at timestamptz
  )`);
  await db.query(`CREATE TABLE customer_identity_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES customers(id),
    type text NOT NULL,document_number text NOT NULL DEFAULT 'fixture',issuing_country text NOT NULL DEFAULT 'NG',
    issued_at date,expires_at date,deleted_at timestamptz
  )`);
  await db.query(
    "CREATE TABLE customer_authentication_credentials (id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id), deleted_at timestamptz, status text NOT NULL DEFAULT 'ACTIVE', account_locked boolean NOT NULL DEFAULT false, rotation_required boolean NOT NULL DEFAULT false, password_version integer NOT NULL DEFAULT 1, password_expires_at timestamptz)",
  );
  await db.query(
    'CREATE TABLE authentication_sessions (id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id), credential_id uuid NOT NULL REFERENCES customer_authentication_credentials(id), token_hash char(64) NOT NULL, audience text NOT NULL, onboarding_password_version integer, status text NOT NULL, issued_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(), revoked_at timestamptz, revoke_reason text, version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT clock_timestamp())',
  );
  for (const id of customers) {
    const credentialId = randomUUID();
    await db.query('INSERT INTO customers(id) VALUES($1)', [id]);
    await db.query(
      'INSERT INTO customer_authentication_credentials(id, customer_id, password_version) VALUES($1, $2, 1)',
      [credentialId, id],
    );
    await db.query(
      "INSERT INTO authentication_sessions(id,customer_id,credential_id,token_hash,audience,onboarding_password_version,status,expires_at) VALUES($1,$2,$3,$4,'customer-api',1,'ACTIVE',clock_timestamp()+interval '1 hour')",
      [randomUUID(), id, credentialId, createHash('sha256').update(tokenFor(id)).digest('hex')],
    );
  }
  const runner = db.createQueryRunner();
  await new CreateKycFoundation1785753600104().up(runner);
  await new KycSessionAndOwnership1785753600105().up(runner);
  await new KycReconciliationReview1785753600106().up(runner);
  await new KycIdentityRevisionAndEvidenceRead1785753600505().up(runner);
  await runner.release();
  const foundationEligibility: Pick<CustomerFinancialEligibilityService, 'require'> = {
    async require(m: EntityManager, customerId: string) {
      const rows = await m.query<Array<{ id: string }>>(
        "SELECT id FROM customers WHERE id=$1 AND status='ACTIVE' AND deleted_at IS NULL FOR SHARE",
        [customerId],
      );
      if (!rows[0]) {
        throw new ConflictException('Customer is not eligible for financial access');
      }
      return 'LEVEL_1';
    },
  };
  sessions = new AuthenticationSessionService(
    {} as Repository<AuthenticationSession>,
    db,
    { record: () => Promise.resolve() } as unknown as AuditService,
    {} as Repository<Customer>,
    foundationEligibility as CustomerFinancialEligibilityService,
  );
  store = new PostgresKycStore(db, sessions);
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
  it('advances the database-managed identity revision for profile, contact, address, document, and customer-type changes', async () => {
    const customerId = customers[17]!;
    const revision = async () =>
      (
        await db.query<Array<{ revision: string }>>(
          'SELECT revision::text AS revision FROM kyc_customer_identity_revisions WHERE customer_id=$1',
          [customerId],
        )
      )[0]!.revision;
    expect(await revision()).toBe('1');
    await db.query(
      'INSERT INTO customer_profiles(customer_id,first_name,last_name,date_of_birth) VALUES($1,$2,$3,$4)',
      [customerId, 'Amina', 'Danladi', '1990-01-01'],
    );
    expect(await revision()).toBe('2');
    await db.query('UPDATE customer_profiles SET first_name=$2 WHERE customer_id=$1', [
      customerId,
      'Amina-Bello',
    ]);
    expect(await revision()).toBe('3');
    await db.query(
      "INSERT INTO customer_contact_methods(customer_id,type,normalized_value,is_primary,verified_at) VALUES($1,'PHONE','+2348000000000',true,clock_timestamp())",
      [customerId],
    );
    expect(await revision()).toBe('4');
    await db.query("INSERT INTO customer_addresses(customer_id,type) VALUES($1,'RESIDENTIAL')", [
      customerId,
    ]);
    expect(await revision()).toBe('5');
    await db.query("INSERT INTO customer_identity_documents(customer_id,type) VALUES($1,'NIN')", [
      customerId,
    ]);
    expect(await revision()).toBe('6');
    await db.query("UPDATE customers SET customer_type='BUSINESS' WHERE id=$1", [customerId]);
    expect(await revision()).toBe('7');
  });
  it('records the consented provider route and downgrades a result completed after identity change', async () => {
    const customerId = customers[14]!;
    const revisions = await db.query<Array<{ revision: string }>>(
      'SELECT revision::text AS revision FROM kyc_customer_identity_revisions WHERE customer_id=$1',
      [customerId],
    );
    const identityRevision = revisions[0]!.revision;
    const consentId = await store.grantConsent({
      customerId,
      sessionToken: tokenFor(customerId),
      kind: 'BVN',
      noticeVersion: 'provider-route-v1',
      expiresAt: new Date(Date.now() + 60_000),
      requestId: randomUUID(),
      provider: 'MONNIFY',
      routeVersion: 3,
      identityRevision,
    });
    const verify = jest.fn(async () => {
      await db.query(
        'UPDATE kyc_customer_identity_revisions SET revision=revision+1 WHERE customer_id=$1',
        [customerId],
      );
      return { outcome: 'MATCH' as const };
    });
    const orchestrator = new KycOrchestrator(
      store,
      makeProvider(verify, 'MONNIFY'),
      policy,
      key,
      'test-key-v1',
      ownerKey,
      'owner-v1',
      testRouting,
    );
    const attempt = await orchestrator.verify({
      customerId,
      consentId,
      requestId: randomUUID(),
      sessionToken: tokenFor(customerId),
      audience: 'customer-api',
      identityRevision,
      providerRouteVersion: 3,
      input: inputFor(customerId),
    });
    expect(attempt.outcome).toBe('REVIEW');
    expect(verify).toHaveBeenCalledTimes(1);
    const claim = await db.query<Array<{ status: string }>>(
      'SELECT status FROM kyc_identity_claims WHERE attempt_id=$1',
      [attempt.id],
    );
    expect(claim[0]?.status).toBe('REVIEW');
    const evidence = await new KycTierEvidenceReader().read(db.manager, customerId);
    expect(evidence).toMatchObject({
      identityRevision: String(Number(identityRevision) + 1),
      evidence: [],
    });
  });
  it('admits only a completed provider match bound to the current identity revision and route', async () => {
    const customerId = customers[16]!;
    const revisions = await db.query<Array<{ revision: string }>>(
      'SELECT revision::text AS revision FROM kyc_customer_identity_revisions WHERE customer_id=$1',
      [customerId],
    );
    const consentId = await store.grantConsent({
      customerId,
      sessionToken: tokenFor(customerId),
      kind: 'BVN',
      noticeVersion: 'provider-route-v1',
      expiresAt: new Date(Date.now() + 60_000),
      requestId: randomUUID(),
      provider: 'MONNIFY',
      routeVersion: 3,
      identityRevision: revisions[0]!.revision,
    });
    const verify = jest
      .fn<ReturnType<KycProvider['verify']>, Parameters<KycProvider['verify']>>()
      .mockResolvedValue({ outcome: 'MATCH' });
    const orchestrator = new KycOrchestrator(
      store,
      makeProvider(verify, 'MONNIFY'),
      policy,
      key,
      'test-key-v1',
      ownerKey,
      'owner-v1',
      testRouting,
    );
    const attempt = await orchestrator.verify({
      customerId,
      consentId,
      requestId: randomUUID(),
      sessionToken: tokenFor(customerId),
      identityRevision: revisions[0]!.revision,
      providerRouteVersion: 3,
      input: inputFor(customerId),
    });
    expect(attempt.outcome).toBe('MATCH');
    const snapshot = await new KycTierEvidenceReader().read(db.manager, customerId);
    expect(snapshot?.identityRevision).toBe(revisions[0]!.revision);
    expect(snapshot?.evidence).toMatchObject([
      {
        id: attempt.id,
        customerId,
        identityRevision: revisions[0]!.revision,
        type: 'BVN',
        status: 'VERIFIED',
        provenance: 'VERIFIED_PROVIDER',
      },
    ]);
  });
  it('rejects a dispatch whose provider route differs from the route recorded in consent', async () => {
    const customerId = customers[15]!;
    const revisions = await db.query<Array<{ revision: string }>>(
      'SELECT revision::text AS revision FROM kyc_customer_identity_revisions WHERE customer_id=$1',
      [customerId],
    );
    const consentId = await store.grantConsent({
      customerId,
      sessionToken: tokenFor(customerId),
      kind: 'BVN',
      noticeVersion: 'provider-route-v1',
      expiresAt: new Date(Date.now() + 60_000),
      provider: 'MONNIFY',
      routeVersion: 3,
      identityRevision: revisions[0]!.revision,
    });
    const verify = jest.fn<ReturnType<KycProvider['verify']>, Parameters<KycProvider['verify']>>();
    const orchestrator = new KycOrchestrator(
      store,
      makeProvider(verify, 'MONNIFY'),
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
        identityRevision: revisions[0]!.revision,
        providerRouteVersion: 4,
        input: inputFor(customerId),
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    expect(verify).not.toHaveBeenCalled();
    expect(await store.listHistory(customerId)).toHaveLength(0);
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
  it.each(['BVN', 'NIN'] as const)(
    'runs the actual customer %s verification workflow with idempotent consent, durable attempts, and safe history',
    async (kind) => {
      const customerId = customers[kind === 'BVN' ? 18 : 20]!;
      const identifier = kind === 'BVN' ? '91234567890' : '81234567890';
      await seedActualCustomerIdentity(customerId);
      const verify = jest
        .fn<ReturnType<KycProvider['verify']>, Parameters<KycProvider['verify']>>()
        .mockResolvedValue({ outcome: 'MATCH' });
      const provider = makeProvider(verify, 'MONNIFY');
      const governance = {
        resolve: jest.fn().mockResolvedValue({ provider: 'MONNIFY', version: 7 }),
      } as unknown as KycProviderGovernanceService;
      const tierPolicies = {
        effective: jest.fn().mockResolvedValue(null),
      } as unknown as KycTierPolicyService;
      const service = new KycCustomerVerificationService(
        db,
        sessions,
        governance,
        [provider],
        customerWorkflowConfiguration,
        tierPolicies,
        new KycTierEvidenceReader(),
      );

      const availability = await service.availability(tokenFor(customerId), 'customer-api', kind);
      expect(availability.status).toBe('AVAILABLE');
      expect(availability.provider).toBe('MONNIFY');
      expect(availability.routeVersion).toBe(7);
      expect(availability.consentNotice?.version).toBe('customer-notice-v1');
      const consentCommand = {
        token: tokenFor(customerId),
        audience: 'customer-api',
        requestId: randomUUID(),
        kind,
        noticeVersion: 'customer-notice-v1',
        accepted: true,
        expectedProvider: 'MONNIFY' as const,
        expectedRouteVersion: 7,
      };
      const firstConsent = await service.grantConsent(consentCommand);
      const replayedConsent = await service.grantConsent(consentCommand);
      expect(replayedConsent.id).toBe(firstConsent.id);
      expect(replayedConsent.routeVersion).toBe(7);

      const verificationCommand = {
        token: tokenFor(customerId),
        audience: 'customer-api',
        requestId: randomUUID(),
        consentId: firstConsent.id,
        kind,
        identifier,
      };
      const result = await service.verify(verificationCommand);
      expect(result).toMatchObject({ status: 'MATCH', provider: 'MONNIFY' });
      expect(await service.verify(verificationCommand)).toMatchObject({
        id: result.id,
        status: 'MATCH',
      });
      expect(verify).toHaveBeenCalledTimes(1);

      const status = await service.status(tokenFor(customerId), 'customer-api');
      expect(status).toMatchObject({
        customer: { status: 'ACTIVE' },
        verificationEnabled: true,
        consentNotice: { version: 'customer-notice-v1' },
        candidateAssessment: { status: 'NOT_CONFIGURED' },
      });
      expect(status.history).toMatchObject([
        { id: result.id, kind, provider: 'MONNIFY', status: 'MATCH' },
      ]);
      const stored = await db.query<unknown[]>(
        'SELECT request_mac,identity_mac,provider_reference_mac FROM kyc_verification_attempts WHERE id=$1',
        [result.id],
      );
      expect(JSON.stringify({ status, stored })).not.toContain(identifier);
      expect(await new KycTierEvidenceReader().read(db.manager, customerId)).toMatchObject({
        evidence: [
          { id: result.id, type: kind, status: 'VERIFIED', provenance: 'VERIFIED_PROVIDER' },
        ],
      });
    },
  );

  it('withdraws a customer consent idempotently and blocks verification after withdrawal', async () => {
    const customerId = customers[21]!;
    await seedActualCustomerIdentity(customerId);
    const verify = jest
      .fn<ReturnType<KycProvider['verify']>, Parameters<KycProvider['verify']>>()
      .mockResolvedValue({ outcome: 'MATCH' });
    const governance = {
      resolve: jest.fn().mockResolvedValue({ provider: 'MONNIFY', version: 8 }),
    } as unknown as KycProviderGovernanceService;
    const service = new KycCustomerVerificationService(
      db,
      sessions,
      governance,
      [makeProvider(verify, 'MONNIFY')],
      customerWorkflowConfiguration,
      { effective: jest.fn().mockResolvedValue(null) } as unknown as KycTierPolicyService,
      new KycTierEvidenceReader(),
    );
    const consent = await service.grantConsent({
      token: tokenFor(customerId),
      audience: 'customer-api',
      requestId: randomUUID(),
      kind: 'BVN',
      noticeVersion: 'customer-notice-v1',
      accepted: true,
      expectedProvider: 'MONNIFY',
      expectedRouteVersion: 8,
    });

    await service.withdrawConsent({
      token: tokenFor(customerId),
      audience: 'customer-api',
      consentId: consent.id,
    });
    await service.withdrawConsent({
      token: tokenFor(customerId),
      audience: 'customer-api',
      consentId: consent.id,
    });
    const audit = await db.query<Array<{ count: string }>>(
      "SELECT count(*)::text AS count FROM kyc_private_audit WHERE resource_id=$1 AND action='CONSENT_WITHDRAWN'",
      [consent.id],
    );
    expect(audit[0]?.count).toBe('1');
    await expect(
      service.verify({
        token: tokenFor(customerId),
        audience: 'customer-api',
        requestId: randomUUID(),
        consentId: consent.id,
        kind: 'BVN',
        identifier: '91234567890',
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    expect(verify).not.toHaveBeenCalled();
  });

  it('keeps onboarding KYC capability separate from the ordinary customer audience', async () => {
    const customerId = customers[19]!;
    await seedActualCustomerIdentity(customerId);
    const credentials = await db.query<Array<{ id: string }>>(
      'SELECT id FROM customer_authentication_credentials WHERE customer_id=$1',
      [customerId],
    );
    const onboardingToken = Buffer.alloc(32, 201).toString('base64url');
    await db.query(
      `INSERT INTO authentication_sessions(id,customer_id,credential_id,token_hash,audience,onboarding_password_version,status,expires_at)
       VALUES($1,$2,$3,$4,'customer-onboarding',1,'ACTIVE',clock_timestamp()+interval '1 hour')`,
      [
        randomUUID(),
        customerId,
        credentials[0]!.id,
        createHash('sha256').update(onboardingToken).digest('hex'),
      ],
    );
    const governance = {
      resolve: jest.fn().mockResolvedValue({ provider: 'DOJAH', version: 4 }),
    } as unknown as KycProviderGovernanceService;
    const tierPolicies = {
      effective: jest.fn().mockResolvedValue(null),
    } as unknown as KycTierPolicyService;
    const verify = jest
      .fn<ReturnType<KycProvider['verify']>, Parameters<KycProvider['verify']>>()
      .mockResolvedValue({ outcome: 'REVIEW' });
    const service = new KycCustomerVerificationService(
      db,
      new KycCustomerSessionValidator(sessions),
      governance,
      [makeProvider(verify, 'DOJAH')],
      customerWorkflowConfiguration,
      tierPolicies,
      new KycTierEvidenceReader(),
    );

    await expect(service.status(onboardingToken, 'customer-onboarding')).resolves.toMatchObject({
      customer: { status: 'ACTIVE' },
      verificationEnabled: true,
    });
    await expect(service.status(onboardingToken, 'customer-api')).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    const availability = await service.availability(onboardingToken, 'customer-onboarding', 'NIN');
    expect(availability).toMatchObject({
      status: 'AVAILABLE',
      provider: 'DOJAH',
      routeVersion: 4,
    });
    const consent = await service.grantConsent({
      token: onboardingToken,
      audience: 'customer-onboarding',
      requestId: randomUUID(),
      kind: 'NIN',
      noticeVersion: 'customer-notice-v1',
      accepted: true,
      expectedProvider: 'DOJAH',
      expectedRouteVersion: 4,
    });
    const verificationCommand = {
      token: onboardingToken,
      audience: 'customer-onboarding',
      requestId: randomUUID(),
      consentId: consent.id,
      kind: 'NIN' as const,
      identifier: '71234567890',
    };
    const first = await service.verify(verificationCommand);
    const replay = await service.verify(verificationCommand);
    expect(first.status).toBe('REVIEW');
    expect(replay.id).toBe(first.id);
    expect(verify).toHaveBeenCalledTimes(1);
    await expect(service.status(onboardingToken, 'customer-onboarding')).resolves.toMatchObject({
      history: [{ id: first.id, kind: 'NIN', provider: 'DOJAH', status: 'REVIEW' }],
    });
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
