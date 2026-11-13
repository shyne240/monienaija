import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { isDeepStrictEqual } from 'node:util';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import {
  A7_INBOUND_ADMISSION_AUTHORITY,
  type A7InboundAdmissionAuthority,
} from '../src/policy/a7-inbound-admission-authority';
import { A7_INBOUND_ADMISSION_PROFILE } from '../src/policy/a7-inbound-admission.profile';
import { TypeOrmPolicyProfileVersionRepository } from '../src/policy/capability-policy-persistence.repositories';
import { PolicyProfileLifecycleState } from '../src/policy/capability-policy-persistence.enums';
import {
  CapabilityPolicyEvaluationService,
  calculateSnapshotInputHash,
} from '../src/policy/capability-policy.service';
import {
  PolicyCollectionStatus,
  PolicyEvidenceFreshnessState,
  PolicySourceClass,
} from '../src/policy/capability-policy.enums';
import type {
  PolicyEvidenceItem,
  PolicyEvidenceSnapshot,
} from '../src/policy/capability-policy.types';
import { AuthenticationSessionService } from '../src/customer-authentication/authentication-session.service';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import { A7ProductPersistenceService } from '../src/policy/a7-product-persistence.service';
import { A7ProductCommandRepository } from '../src/policy/a7-product-command.repository';
import { A7ProductCustomerBindingRepository } from '../src/policy/a7-product-customer-binding.repository';
import { A7ProductCommandService } from '../src/policy/a7-product-command.service';
import { A7ProductLifecycleService } from '../src/policy/a7-product-lifecycle.service';
import { A7ProductNotificationDeliveryRepository } from '../src/policy/a7-product-notification-delivery.repository';
import { A7ProductReconciliationRepository } from '../src/policy/a7-product-reconciliation.repository';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  seedTransferParticipant,
} from './support/pg-harness';

describe('A7 authoritative persistence (PostgreSQL)', () => {
  let db: DataSource;
  let service: A7ProductPersistenceService;
  let app: NestFastifyApplication;
  const snapshots = new Map();
  beforeAll(async () => {
    db = await createIntegrationDataSource('a7persist');
    // Controlled, database-backed authority fixture. Production remains unavailable.
    await db.query(
      `CREATE TABLE test_a7_inbound_authority (id uuid PRIMARY KEY, customer_id uuid NOT NULL, binding_id uuid NOT NULL, route_id uuid NOT NULL, approved boolean NOT NULL, held boolean NOT NULL, max_minor bigint NOT NULL, used_minor bigint NOT NULL, checks integer NOT NULL DEFAULT 0)`,
    );
    await db.query(
      `CREATE TABLE test_a7_source_evidence(id uuid PRIMARY KEY, customer_id uuid NOT NULL, source_class text NOT NULL, source_version integer NOT NULL, value jsonb NOT NULL)`,
    );
    const authority: A7InboundAdmissionAuthority = {
      recheck: async (manager: EntityManager, input) => {
        const rows = await manager.query<
          Array<{
            id: string;
            approved: boolean;
            held: boolean;
            max_minor: string;
            used_minor: string;
          }>
        >(
          `SELECT id,approved,held,max_minor,used_minor FROM test_a7_inbound_authority WHERE customer_id=$1 AND binding_id=$2 AND route_id=$3 FOR UPDATE`,
          [input.customerId, input.bindingId, input.virtualAccountId],
        );
        const row = rows[0];
        if (row)
          await manager.query('UPDATE test_a7_inbound_authority SET checks=checks+1 WHERE id=$1', [
            row.id,
          ]);
        if (
          !row ||
          !row.approved ||
          row.held ||
          BigInt(row.used_minor) + BigInt(input.intendedAmountMinor) > BigInt(row.max_minor)
        )
          return { status: 'DENIED' };
        const attachments = await manager.query<
          Array<{ snapshot_payload: PolicyEvidenceSnapshot }>
        >(
          `SELECT a.snapshot_payload FROM policy_decision_records d JOIN immutable_evidence_snapshot_attachments a ON a.snapshot_reference=d.snapshot_reference WHERE d.decision_reference=$1`,
          [input.policyDecisionReference],
        );
        const snapshot = attachments[0]?.snapshot_payload;
        if (!snapshot || snapshot.sourceItems.length !== 10) return { status: 'DENIED' };
        for (const item of snapshot.sourceItems) {
          const sources = await manager.query<
            Array<{
              customer_id: string;
              source_class: PolicySourceClass;
              source_version: number;
              value: Record<string, unknown>;
            }>
          >(
            'SELECT customer_id,source_class,source_version,value FROM test_a7_source_evidence WHERE id=$1 FOR SHARE',
            [item.sourceId],
          );
          const source = sources[0];
          if (
            !source ||
            source.customer_id !== input.customerId ||
            source.source_class !== item.sourceClass ||
            source.source_version !== item.sourceVersion ||
            !isDeepStrictEqual(source.value, item.normalizedValue)
          )
            return { status: 'DENIED' };
        }
        return {
          status: 'AUTHORIZED',
          evidenceReferences: {
            route: input.virtualAccountId,
            limits: row.id,
            compliance: row.id,
            institution: row.id,
            consent: null,
          },
        };
      },
    };
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(db)
      .overrideProvider(A7_INBOUND_ADMISSION_AUTHORITY)
      .useValue(authority)
      .overrideProvider(KycTierEvidenceReader)
      .useValue({ read: (_: unknown, id: string) => Promise.resolve(snapshots.get(id) ?? null) })
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
      .useValue(new TestNotificationProvider())
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.listen(0, '127.0.0.1');
    service = app.get(A7ProductPersistenceService);
    const proposal = randomUUID();
    const r = { all: [], any: [] };
    const d = {
      regulatoryRequirementsConfirmed: true,
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveUntil: null,
      regulatory: { LEVEL_1: r, LEVEL_2: r },
      operator: { LEVEL_1: r, LEVEL_2: r },
    };
    await db.query(
      `INSERT INTO kyc_tier_policy_proposals(id,request_id,expected_version,definition,fingerprint,maker_id,maker_session_id,checker_id,checker_session_id,state) VALUES($1,$2,0,$3,$4,'maker',$5,'checker',$6,'APPROVED')`,
      [proposal, randomUUID(), JSON.stringify(d), 'a'.repeat(64), randomUUID(), randomUUID()],
    );
    await db.query(
      `INSERT INTO kyc_tier_policy_versions(version,proposal_id,definition,maker_id,checker_id) VALUES(1,$1,$2,'maker','checker')`,
      [proposal, JSON.stringify(d)],
    );
    await db.query('UPDATE kyc_tier_policy_head SET version=1');
    const profile = A7_INBOUND_ADMISSION_PROFILE;
    await app.get(TypeOrmPolicyProfileVersionRepository).insertImmutable({
      ...profile,
      effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      effectiveTo: null,
      lifecycleState: PolicyProfileLifecycleState.ACTIVE,
      definitionPayload: profile as unknown as Readonly<Record<string, unknown>>,
      createdAt: new Date(),
      createdBy: 'controlled-test-governance',
      retentionClass: 'A4_POLICY_HISTORY',
      legalHold: false,
      retentionExpiresAt: null,
    });
  });
  afterAll(async () => {
    if (app) await app.close();
    if (db) await destroyIntegrationDataSource(db);
  });
  const http = {
    async inject(input: {
      method: 'POST';
      url: string;
      headers: Record<string, string>;
      payload: object;
    }) {
      const response = await request(app.getHttpServer())
        .post(input.url)
        .set(input.headers)
        .send(input.payload);
      return { statusCode: response.status, json: <T>() => response.body as T };
    },
  };
  async function subject() {
    const ledgerId = randomUUID();
    await db.query(
      `INSERT INTO ledger_accounts(id,code,name,account_type,normal_balance,currency,accounting_unit,allow_negative_balance,is_active)
      VALUES($1,$2,'test','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',false,true)`,
      [ledgerId, `A7-${ledgerId}`],
    );
    const p = await seedTransferParticipant(db, 'a7persist', ledgerId);
    await db.query('INSERT INTO wallet_ownerships(wallet_id,customer_id) VALUES($1,$2)', [
      p.customerWalletId,
      p.customerId,
    ]);
    await db.query(
      `INSERT INTO customer_contact_methods(customer_id,type,value,normalized_value,is_primary,verified_at) VALUES($1,'PHONE',$2,$2,true,clock_timestamp())`,
      [p.customerId, `phone-${randomUUID()}`],
    );
    await db.query(
      `INSERT INTO customer_kyc_assessments(customer_id,kyc_level,kyc_status,assessed_by,expires_at) VALUES($1,'LEVEL_1','APPROVED','fixture',clock_timestamp()+interval '1 hour')`,
      [p.customerId],
    );
    snapshots.set(p.customerId, {
      identityRevision: 'fixture',
      evidence: [
        {
          id: randomUUID(),
          customerId: p.customerId,
          identityRevision: 'fixture',
          type: 'BVN',
          status: 'VERIFIED',
          provenance: 'VERIFIED_PROVIDER',
          verifiedAt: new Date(Date.now() - 10000),
          expiresAt: new Date(Date.now() + 1800000),
        },
      ],
    });
    const credentialId = randomUUID();
    const sessionId = randomUUID();
    const token = randomBytes(32).toString('base64url');
    await db.query(
      `INSERT INTO customer_authentication_credentials(id,customer_id,password_hash,hash_algorithm,password_version,status,mobile_otp_required) VALUES($1,$2,'fixture','PBKDF2',1,'ACTIVE',false)`,
      [credentialId, p.customerId],
    );
    await db.query(
      `INSERT INTO authentication_sessions(id,customer_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at,version) VALUES($1,$2,$3,$4,'customer-api','ACTIVE',clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp(),1)`,
      [sessionId, p.customerId, credentialId, createHash('sha256').update(token).digest('hex')],
    );
    return { ...p, token, sessionId };
  }
  async function inboundFixture() {
    const p = await subject();
    const routeId = randomUUID();
    const evidenceId = randomUUID();
    const number = String(Math.floor(1000000000 + Math.random() * 8000000000));
    await db.query(
      `INSERT INTO virtual_accounts(id,wallet_id,bank_code,account_number,account_name,provider,status,reference) VALUES($1,$2,'BANK',$3,'Test','test-provider','ACTIVE',$4)`,
      [routeId, p.walletAccountId, number, `MN${Math.floor(Math.random() * 1000000000000)}`],
    );
    await db.query(
      'INSERT INTO test_a7_inbound_authority(id,customer_id,binding_id,route_id,approved,held,max_minor,used_minor) VALUES($1,$2,$3,$4,true,false,10000,0)',
      [evidenceId, p.customerId, p.bindingId, routeId],
    );
    const now = new Date().toISOString();
    const profile = A7_INBOUND_ADMISSION_PROFILE;
    const validation = await app
      .get(AuthenticationSessionService)
      .validate({ token: p.token, audience: 'customer-api' });
    if (!validation.valid || !validation.principal) throw new Error('fixture session invalid');
    const principal = {
      type: 'CUSTOMER' as const,
      principalId: p.customerId,
      customerId: p.customerId,
      sessionId: p.sessionId,
      audience: 'customer-api',
      roles: [],
      scopes: [],
      customerAccess: 'SELF' as const,
    };
    const item = (
      sourceClass: PolicySourceClass,
      normalizedValue: Record<string, unknown>,
    ): PolicyEvidenceItem => ({
      sourceClass,
      sourceType: sourceClass,
      sourceId: randomUUID(),
      customerId: p.customerId,
      sourceVersion: 1,
      sourceUpdatedAt: now,
      observedAt: now,
      deleted: false,
      freshnessState: PolicyEvidenceFreshnessState.CURRENT,
      classification: 'Restricted',
      normalizedValue,
    });
    const items = [
      item(PolicySourceClass.CUSTOMER, { status: 'ACTIVE' }),
      item(PolicySourceClass.ONBOARDING, { status: 'COMPLETED' }),
      item(PolicySourceClass.ELIGIBILITY, { status: 'ELIGIBLE' }),
      item(PolicySourceClass.RESTRICTIONS, { active: false, type: 'NONE' }),
      item(PolicySourceClass.LIMITS, {
        currency: 'NGN',
        dailyTransactionCount: 10,
        dailyTransactionAmountMinor: '10000',
        singleTransactionAmountMinor: '10000',
        monthlyTransactionAmountMinor: '10000',
        walletBalanceMinor: '10000',
      }),
      item(PolicySourceClass.ENROLLMENT, { product: 'virtual-account', status: 'ACTIVE' }),
      item(PolicySourceClass.RISK, {
        sourceKind: 'P1_10_MANUAL',
        riskLevel: 'LOW',
        status: 'ACTIVE',
      }),
      item(PolicySourceClass.COMPLIANCE, { casePresent: false }),
      item(PolicySourceClass.ACCOUNT_BINDING, {
        bindingId: p.bindingId,
        state: 'ACTIVE',
        dimensionsCompatible: true,
        ledgerIsActive: true,
        reconciliationStatus: 'PASS',
      }),
      item(PolicySourceClass.AUTHORIZATION, {
        allowed: true,
        customerId: p.customerId,
        principalType: 'CUSTOMER',
      }),
    ];
    for (const entry of items)
      await db.query('INSERT INTO test_a7_source_evidence VALUES($1,$2,$3,$4,$5)', [
        entry.sourceId,
        p.customerId,
        entry.sourceClass,
        entry.sourceVersion,
        JSON.stringify(entry.normalizedValue),
      ]);
    const classes = items.map((x) => x.sourceClass);
    const context = {
      currency: 'NGN',
      targetBindingId: p.bindingId,
      limitUsage: {
        amountMinor: '100',
        currency: 'NGN',
        dailyUsedCount: 0,
        dailyUsedAmountMinor: '0',
        monthlyUsedAmountMinor: '0',
        projectedWalletBalanceMinor: '100',
        usageAsOf: now,
        usageSourceReference: evidenceId,
      },
    };
    const base: PolicyEvidenceSnapshot = {
      contractName: 'A4-EVIDENCE-SNAPSHOT',
      contractVersion: 1,
      snapshotReference: `test-a7-${randomUUID()}`,
      subject: { type: 'CUSTOMER', customerId: p.customerId },
      policyRequestScope: {
        capability: profile.capability,
        action: 'admit',
        requestedAt: now,
        asOf: now,
        evidenceProfile: profile.profileReference,
        targetBindingId: p.bindingId,
        evaluationContext: context,
      },
      collection: {
        status: PolicyCollectionStatus.COMPLETE,
        collectedAt: now,
        requiredSourceClasses: classes,
        collectedSourceClasses: classes,
        missingSourceClasses: [],
        unavailableSourceClasses: [],
        restrictedSourceClasses: [],
        conflictSourceClasses: [],
      },
      sourceItems: items,
      evidenceSummary: {
        freshnessStates: [PolicyEvidenceFreshnessState.CURRENT],
        sourceCount: items.length,
        normalizedInputHash: '',
      },
      integrity: {
        canonicalizationVersion: 1,
        arrayOrderingRule: 'sourceClass/sourceType/sourceId/sourceVersion',
        hashAlgorithm: 'SHA-256',
      },
    };
    const snapshot = {
      ...base,
      evidenceSummary: {
        ...base.evidenceSummary,
        normalizedInputHash: calculateSnapshotInputHash(base),
      },
    };
    const decision = await app.get(CapabilityPolicyEvaluationService).evaluate({
      contractName: 'A4-CAPABILITY-POLICY',
      contractVersion: 1,
      subject: base.subject,
      capability: profile.capability,
      action: 'admit',
      requestedAt: now,
      evaluationContext: context,
      actorContext: { principal },
      sourceEvidenceRequest: {
        evidenceProfile: profile.profileReference,
        asOf: now,
        requiredSourceClasses: classes,
      },
      requestContext: { requestId: randomUUID(), correlationId: randomUUID() },
      snapshot,
    });
    expect(decision.decision).toBe('ALLOW_WITH_LIMITS');
    const created = await service.create({
      token: p.token,
      operationType: 'INBOUND_FUNDING',
      bindingId: p.bindingId,
      virtualAccountId: routeId,
      intendedAmountMinor: '100',
      policyDecisionReference: decision.decisionReference,
      idempotencyKey: 'inbound',
    });
    return { ...p, routeId, evidenceId, decision, created };
  }
  it('persists actual inbound identity and authorization without requiring A6; replays and rejects conflicts', async () => {
    const p = await subject();
    const input = {
      token: p.token,
      operationType: 'INBOUND_FUNDING' as const,
      bindingId: p.bindingId,
      idempotencyKey: 'one',
    };
    const first = await service.create(input);
    const again = await service.create(input);
    expect(again.replayed).toBe(true);
    expect(again.command.id).toBe(first.command.id);
    // Legacy null-amount commands must retain their pre-migration replay hash.
    expect(first.command.request_hash).toBe(
      createHash('sha256')
        .update(
          JSON.stringify({
            operationType: input.operationType,
            bindingId: p.bindingId,
            virtualAccountId: null,
            observationId: null,
            policy: null,
          }),
        )
        .digest('hex'),
    );
    expect(first.command.customer_id).toBe(p.customerId);
    expect(first.command.session_id).toBe(p.sessionId);
    expect(first.command.policy_decision_reference).toBeNull();
    expect(first.command.inbound_observation_id).toBeNull();
    expect(first.lifecycle.state).toBe('LIFECYCLE_PENDING');
    expect(await service.findCommand(first.command.command_reference)).toMatchObject({
      id: first.command.id,
    });
    expect(
      await app.get(A7ProductCommandService).readPersistedCommand(first.command.command_reference),
    ).toMatchObject({ id: first.command.id, customer_id: p.customerId });
    expect(
      await app
        .get(A7ProductLifecycleService)
        .readPersistedLifecycle(first.lifecycle.lifecycle_reference),
    ).toMatchObject({ id: first.lifecycle.id, state: 'LIFECYCLE_PENDING' });
    expect(await app.get(A7ProductCommandService).readPersistedCommand('nonexistent')).toBeNull();
    const reconciliation = app.get(A7ProductReconciliationRepository);
    expect(
      await reconciliation.readPersistedCommand(first.command.command_reference),
    ).toMatchObject({ id: first.command.id });
    expect(
      await reconciliation.readPersistedLifecycle(first.lifecycle.lifecycle_reference),
    ).toMatchObject({ id: first.lifecycle.id, state: 'LIFECYCLE_PENDING' });
    const auth = await db.query<Array<{ entity_id: string; actor: string; action: string }>>(
      'SELECT * FROM audit_events WHERE id=$1',
      [first.command.authorization_event_id],
    );
    expect(auth[0]).toMatchObject({
      entity_id: first.command.id,
      actor: p.customerId,
      action: 'ALLOWED',
    });
    await expect(
      service.create({ ...input, operationType: 'VIRTUAL_ACCOUNT_ASSIGN' }),
    ).rejects.toThrow();
    await expect(
      service.transition({
        token: p.token,
        lifecycleId: first.lifecycle.id,
        expectedVersion: 1,
        nextState: 'LIFECYCLE_ADMITTED',
        idempotencyKey: 'admit',
      }),
    ).rejects.toThrow();
  });
  it('serializes competing transitions, preserves history and rejects stale/conflicting replays', async () => {
    const p = await subject();
    const { lifecycle } = await service.create({
      token: p.token,
      operationType: 'INBOUND_FUNDING',
      bindingId: p.bindingId,
      idempotencyKey: 'two',
    });
    const cmd = {
      token: p.token,
      lifecycleId: lifecycle.id,
      expectedVersion: 1,
      nextState: 'LIFECYCLE_CANCELLED' as const,
      idempotencyKey: 'cancel',
    };
    const results = await Promise.all([service.transition(cmd), service.transition(cmd)]);
    expect(results.map((x) => x.replayed).sort()).toEqual([false, true]);
    expect((await service.findLifecycle(lifecycle.lifecycle_reference))?.version).toBe(2);
    await expect(service.transition({ ...cmd, idempotencyKey: 'different' })).rejects.toThrow();
    await expect(service.transition({ ...cmd, expectedVersion: 2 })).rejects.toThrow();
    const history = await db.query<Array<{ id: string }>>(
      'SELECT * FROM a7_product_lifecycle_transitions WHERE lifecycle_id=$1',
      [lifecycle.id],
    );
    expect(history).toHaveLength(1);
    await expect(
      db.query(`UPDATE a7_product_lifecycles SET state='LIFECYCLE_PENDING',version=3 WHERE id=$1`, [
        lifecycle.id,
      ]),
    ).rejects.toThrow();
    await expect(
      db.query('UPDATE a7_product_commands SET binding_version=2 WHERE id=$1', [
        lifecycle.command_id,
      ]),
    ).rejects.toThrow();
  });
  it('binds an observation to the real destination and prevents a second command for it', async () => {
    const p = await subject();
    const other = await subject();
    const virtualId = randomUUID();
    const observationId = randomUUID();
    const number = String(Math.floor(1000000000 + Math.random() * 8000000000));
    await db.query(
      `INSERT INTO virtual_accounts(id,wallet_id,bank_code,account_number,account_name,provider,status,reference) VALUES($1,$2,'BANK',$3,'Test','test-provider','ACTIVE',$4)`,
      [virtualId, p.walletAccountId, number, `MN${Math.floor(Math.random() * 1000000000000)}`],
    );
    await db.query(
      `INSERT INTO inbound_funding_observations(id,provider_key,provider_reference,provider_reference_hash,evidence_hash,bank_code,account_number,amount_minor,currency,provider_observed_at) VALUES($1,'test-provider','test-ref',$2,$3,'BANK',$4,100,'NGN',clock_timestamp())`,
      [
        observationId,
        createHash('sha256').update(observationId).digest('hex'),
        'a'.repeat(64),
        number,
      ],
    );
    const input = {
      token: p.token,
      operationType: 'INBOUND_FUNDING' as const,
      bindingId: p.bindingId,
      virtualAccountId: virtualId,
      inboundObservationId: observationId,
      idempotencyKey: 'obs',
    };
    const contenders = await Promise.allSettled([
      service.create(input),
      service.create({ ...input, idempotencyKey: 'another' }),
    ]);
    expect(contenders.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(contenders.filter((entry) => entry.status === 'rejected')).toHaveLength(1);
    const first = contenders.find((entry) => entry.status === 'fulfilled');
    expect(first?.status === 'fulfilled' && first.value.command.inbound_observation_id).toBe(
      observationId,
    );
    await expect(
      service.create({
        ...input,
        token: other.token,
        bindingId: other.bindingId,
        idempotencyKey: 'other',
      }),
    ).rejects.toThrow();
    await expect(
      service.create({ ...input, token: 'not-a-real-token', idempotencyKey: 'bad' }),
    ).rejects.toThrow();
    const count = await db.query<Array<{ n: string }>>(
      'SELECT count(*) AS n FROM a7_product_commands WHERE inbound_observation_id=$1',
      [observationId],
    );
    expect(count[0]?.n).toBe('1');
  });
  it('serializes concurrent creation under one idempotency key', async () => {
    const p = await subject();
    const input = {
      token: p.token,
      operationType: 'VIRTUAL_ACCOUNT_ASSIGN' as const,
      bindingId: p.bindingId,
      idempotencyKey: 'parallel',
    };
    const results = await Promise.all([service.create(input), service.create(input)]);
    expect(results.map((x) => x.replayed).sort()).toEqual([false, true]);
    expect(results[0]?.command.id).toBe(results[1]?.command.id);
    await expect(
      service.create({
        ...input,
        idempotencyKey: 'missing-policy',
        policyDecisionReference: 'made-up',
      }),
    ).rejects.toThrow();
  });
  it('legacy authority ports do not manufacture authorization or consent', async () => {
    const command = app.get(A7ProductCommandRepository).getConsumerPorts();
    const binding = app.get(A7ProductCustomerBindingRepository).getConsumerPorts();
    expect(await command.a2AuthorizationContextLookup('asserted-reference')).toBeNull();
    expect(await command.a4ProductPolicyDecisionLookup('asserted-reference')).toBeNull();
    expect(await binding.a6T04FundingTargetLookup(randomUUID(), 'MN1234')).toBeNull();
  });
  it('rechecks original authorization and current binding under the admission transaction', async () => {
    const p = await subject();
    const created = await service.create({
      token: p.token,
      operationType: 'INBOUND_FUNDING',
      bindingId: p.bindingId,
      idempotencyKey: 'binding-stale',
    });
    await db.query(`UPDATE wallet_accounts SET status='SUSPENDED' WHERE id=$1`, [
      p.walletAccountId,
    ]);
    await expect(
      service.transition({
        token: p.token,
        lifecycleId: created.lifecycle.id,
        expectedVersion: 1,
        nextState: 'LIFECYCLE_ADMITTED',
        idempotencyKey: 'admit',
      }),
    ).rejects.toThrow('binding evidence is stale');
    const current = await service.findLifecycle(created.lifecycle.lifecycle_reference);
    expect(current?.state).toBe('LIFECYCLE_PENDING');
    expect(current?.version).toBe(1);
    const rows = await db.query<Array<{ n: string }>>(
      'SELECT count(*) n FROM a7_product_lifecycle_transitions WHERE lifecycle_id=$1',
      [created.lifecycle.id],
    );
    expect(rows[0]?.n).toBe('0');
  });
  it('fails closed for legacy notification and reconciliation authority lookups', async () => {
    const notification = app.get(A7ProductNotificationDeliveryRepository).getConsumerPorts();
    const reconciliation = app.get(A7ProductReconciliationRepository).getConsumerPorts();
    expect(await notification.a2AuthorizationContextLookup('asserted')).toBeNull();
    expect(await notification.a4ProductPolicyDecisionLookup('asserted')).toBeNull();
    expect(await reconciliation.a2AuthorizationContextLookup('asserted')).toBeNull();
    expect(await reconciliation.a4ProductPolicyDecisionLookup('asserted')).toBeNull();
  });
  it('rolls back blocked admission and permits concurrent cancellation without posting', async () => {
    const p = await subject();
    const { lifecycle } = await service.create({
      token: p.token,
      operationType: 'INBOUND_FUNDING',
      bindingId: p.bindingId,
      idempotencyKey: 'race',
    });
    const count = async () =>
      (await db.query<Array<{ n: string }>>('SELECT count(*) n FROM ledger_journals'))[0]!.n;
    const before = await count();
    const base = { token: p.token, lifecycleId: lifecycle.id, expectedVersion: 1 };
    const [admit, cancel] = await Promise.allSettled([
      service.transition({
        ...base,
        nextState: 'LIFECYCLE_ADMITTED',
        idempotencyKey: 'admit-race',
      }),
      service.transition({
        ...base,
        nextState: 'LIFECYCLE_CANCELLED',
        idempotencyKey: 'cancel-race',
      }),
    ]);
    expect(admit.status).toBe('rejected');
    expect(cancel.status).toBe('fulfilled');
    expect((await service.findLifecycle(lifecycle.lifecycle_reference))?.state).toBe(
      'LIFECYCLE_CANCELLED',
    );
    expect(await count()).toBe(before);
    const transitions = await db.query<Array<{ to_state: string }>>(
      'SELECT to_state FROM a7_product_lifecycle_transitions WHERE lifecycle_id=$1',
      [lifecycle.id],
    );
    expect(transitions).toEqual([{ to_state: 'LIFECYCLE_CANCELLED' }]);
  });
  it('admits a governed inbound intent exactly once without recording a payment', async () => {
    const f = await inboundFixture();
    const count = async () =>
      (await db.query<Array<{ n: string }>>('SELECT count(*) n FROM ledger_journals'))[0]!.n;
    const before = await count();
    const request = {
      token: f.token,
      lifecycleId: f.created.lifecycle.id,
      expectedVersion: 1,
      nextState: 'LIFECYCLE_ADMITTED' as const,
      idempotencyKey: 'admit',
    };
    const results = await Promise.all([service.transition(request), service.transition(request)]);
    expect(results.map((x) => x.replayed).sort()).toEqual([false, true]);
    expect(results[0]?.lifecycle.state).toBe('LIFECYCLE_ADMITTED');
    expect(await count()).toBe(before);
    expect(f.created.command.inbound_observation_id).toBeNull();
    const audit = await db.query<Array<{ new_values: { admissionEvidence: { limits: string } } }>>(
      `SELECT new_values FROM audit_events WHERE entity_type='A7_PRODUCT_LIFECYCLE' AND entity_id=$1 AND action='TRANSITIONED'`,
      [f.created.lifecycle.id],
    );
    expect(audit[0]?.new_values.admissionEvidence.limits).toBe(f.evidenceId);
    const operations = await db.query<Array<{ n: string }>>(
      'SELECT count(*) n FROM external_operations WHERE customer_id=$1',
      [f.customerId],
    );
    expect(operations[0]?.n).toBe('0');
  });
  it('rejects controlled authority holds and limit exhaustion and rolls back', async () => {
    const f = await inboundFixture();
    const req = {
      token: f.token,
      lifecycleId: f.created.lifecycle.id,
      expectedVersion: 1,
      nextState: 'LIFECYCLE_ADMITTED' as const,
      idempotencyKey: 'admit',
    };
    await db.query('UPDATE test_a7_inbound_authority SET held=true WHERE id=$1', [f.evidenceId]);
    await expect(service.transition(req)).rejects.toThrow('authority denied');
    await db.query(
      'UPDATE test_a7_inbound_authority SET held=false,used_minor=max_minor WHERE id=$1',
      [f.evidenceId],
    );
    await expect(service.transition(req)).rejects.toThrow('authority denied');
    expect((await service.findLifecycle(f.created.lifecycle.lifecycle_reference))?.version).toBe(1);
    const rows = await db.query<Array<{ checks: number }>>(
      'SELECT checks FROM test_a7_inbound_authority WHERE id=$1',
      [f.evidenceId],
    );
    expect(rows[0]?.checks).toBe(0);
  });
  it('rejects missing authority evidence and a stale inbound route', async () => {
    const f = await inboundFixture();
    const req = {
      token: f.token,
      lifecycleId: f.created.lifecycle.id,
      expectedVersion: 1,
      nextState: 'LIFECYCLE_ADMITTED' as const,
      idempotencyKey: 'admit',
    };
    await db.query('DELETE FROM test_a7_inbound_authority WHERE id=$1', [f.evidenceId]);
    await expect(service.transition(req)).rejects.toThrow('authority denied');
    await db.query(
      "UPDATE virtual_accounts SET status='DEACTIVATED',deactivated_at=clock_timestamp() WHERE id=$1",
      [f.routeId],
    );
    await expect(service.transition(req)).rejects.toThrow('route is stale');
  });
  it('rejects policy amount substitution', async () => {
    const f = await inboundFixture();
    const other = await service.create({
      token: f.token,
      operationType: 'INBOUND_FUNDING',
      bindingId: f.bindingId,
      virtualAccountId: f.routeId,
      intendedAmountMinor: '101',
      policyDecisionReference: f.decision.decisionReference,
      idempotencyKey: 'different-amount',
    });
    await expect(
      service.transition({
        token: f.token,
        lifecycleId: other.lifecycle.id,
        expectedVersion: 1,
        nextState: 'LIFECYCLE_ADMITTED',
        idempotencyKey: 'admit',
      }),
    ).rejects.toThrow('policy amount does not match');
  });
  it('serializes valid admission against cancellation and never posts', async () => {
    const f = await inboundFixture();
    const base = { token: f.token, lifecycleId: f.created.lifecycle.id, expectedVersion: 1 };
    const results = await Promise.allSettled([
      service.transition({ ...base, nextState: 'LIFECYCLE_ADMITTED', idempotencyKey: 'admit' }),
      service.transition({ ...base, nextState: 'LIFECYCLE_CANCELLED', idempotencyKey: 'cancel' }),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((x) => x.status === 'rejected')).toHaveLength(1);
    const transitions = await db.query<Array<{ to_state: string }>>(
      'SELECT to_state FROM a7_product_lifecycle_transitions WHERE lifecycle_id=$1',
      [base.lifecycleId],
    );
    expect(transitions).toHaveLength(1);
    expect(['LIFECYCLE_ADMITTED', 'LIFECYCLE_CANCELLED']).toContain(transitions[0]?.to_state);
  });

  it('rejects revoked original authorization even with a new valid customer session', async () => {
    const f = await inboundFixture();
    const newToken = randomUUID();
    await db.query(
      `INSERT INTO authentication_sessions(id,customer_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at,version) SELECT $1,customer_id,credential_id,$2,'customer-api','ACTIVE',clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp(),1 FROM authentication_sessions WHERE id=$3`,
      [randomUUID(), createHash('sha256').update(newToken).digest('hex'), f.sessionId],
    );
    await db.query(
      `UPDATE authentication_sessions SET status='REVOKED',revoked_at=clock_timestamp(),revoke_reason='test' WHERE id=$1`,
      [f.sessionId],
    );
    await expect(
      service.transition({
        token: newToken,
        lifecycleId: f.created.lifecycle.id,
        expectedVersion: 1,
        nextState: 'LIFECYCLE_ADMITTED',
        idempotencyKey: 'admit',
      }),
    ).rejects.toThrow('session no longer active');
  });
  it('rejects tampered obligation records instead of trusting an allow label', async () => {
    const f = await inboundFixture();
    // Explicitly corrupt this isolated disposable database to exercise defense in depth.
    await db.query(
      'ALTER TABLE policy_decision_records DISABLE TRIGGER policy_decision_records_are_immutable',
    );
    try {
      await db.query(
        "UPDATE policy_decision_records SET obligations='[]'::jsonb WHERE decision_reference=$1",
        [f.decision.decisionReference],
      );
    } finally {
      await db.query(
        'ALTER TABLE policy_decision_records ENABLE TRIGGER policy_decision_records_are_immutable',
      );
    }
    await expect(
      service.transition({
        token: f.token,
        lifecycleId: f.created.lifecycle.id,
        expectedVersion: 1,
        nextState: 'LIFECYCLE_ADMITTED',
        idempotencyKey: 'admit',
      }),
    ).rejects.toThrow('obligations missing');
  });

  it('rejects a stale authoritative source even if the persisted A4 snapshot allowed it', async () => {
    const f = await inboundFixture();
    await db.query(
      `UPDATE test_a7_source_evidence SET source_version=source_version+1,value='{"status":"SUSPENDED"}'::jsonb WHERE customer_id=$1 AND source_class='ELIGIBILITY'`,
      [f.customerId],
    );
    await expect(
      service.transition({
        token: f.token,
        lifecycleId: f.created.lifecycle.id,
        expectedVersion: 1,
        nextState: 'LIFECYCLE_ADMITTED',
        idempotencyKey: 'admit',
      }),
    ).rejects.toThrow('authority denied');
  });

  it('admits via authenticated HTTP, enforces ownership, and replays without posting', async () => {
    const f = await inboundFixture();
    const url = '/api/v1/customers/me/inbound-funding/commands';
    const headers = { authorization: `Bearer ${f.token}`, 'idempotency-key': 'http-create' };
    const payload = {
      bindingId: f.bindingId,
      virtualAccountId: f.routeId,
      intendedAmountMinor: '100',
      policyDecisionReference: f.decision.decisionReference,
    };
    const before = (
      await db.query<Array<{ n: string }>>('SELECT count(*) n FROM ledger_journals')
    )[0]!.n;
    const unauth = await http.inject({
      method: 'POST',
      url,
      headers: { 'idempotency-key': 'http-create' },
      payload,
    });
    expect(unauth.statusCode).toBe(401);
    const other = await subject();
    const forbidden = await http.inject({
      method: 'POST',
      url,
      headers: { ...headers, authorization: `Bearer ${other.token}` },
      payload,
    });
    expect(forbidden.statusCode).toBe(409);
    const created = await http.inject({ method: 'POST', url, headers, payload });
    expect(created.statusCode).toBe(200);
    const command = created.json<{ lifecycleId: string; state: string; replayed: boolean }>();
    expect(command.state).toBe('LIFECYCLE_PENDING');
    const replay = await http.inject({ method: 'POST', url, headers, payload });
    expect(replay.statusCode).toBe(200);
    expect(replay.json<{ replayed: boolean }>().replayed).toBe(true);
    const conflict = await http.inject({
      method: 'POST',
      url,
      headers,
      payload: { ...payload, intendedAmountMinor: '101' },
    });
    expect(conflict.statusCode).toBe(409);
    const admit = {
      method: 'POST' as const,
      url: `/api/v1/customers/me/inbound-funding/lifecycles/${command.lifecycleId}/admission`,
      headers: { authorization: `Bearer ${f.token}`, 'idempotency-key': 'http-admit' },
      payload: { expectedVersion: 1 },
    };
    const results = await Promise.all([http.inject(admit), http.inject(admit)]);
    expect(results.map((x) => x.statusCode)).toEqual([200, 200]);
    expect(results.map((x) => x.json<{ replayed: boolean }>().replayed).sort()).toEqual([
      false,
      true,
    ]);
    expect(results[0]?.json<{ state: string }>().state).toBe('LIFECYCLE_ADMITTED');
    expect(
      (await db.query<Array<{ n: string }>>('SELECT count(*) n FROM ledger_journals'))[0]!.n,
    ).toBe(before);
  });
  it('enforces HTTP authority, limits and compliance with transactional rollback', async () => {
    const f = await inboundFixture();
    const req = {
      method: 'POST' as const,
      url: `/api/v1/customers/me/inbound-funding/lifecycles/${f.created.lifecycle.id}/admission`,
      headers: { authorization: `Bearer ${f.token}`, 'idempotency-key': 'http-admit' },
      payload: { expectedVersion: 1 },
    };
    await db.query('UPDATE test_a7_inbound_authority SET held=true WHERE id=$1', [f.evidenceId]);
    expect((await http.inject(req)).statusCode).toBe(409);
    await db.query(
      'UPDATE test_a7_inbound_authority SET held=false,used_minor=max_minor WHERE id=$1',
      [f.evidenceId],
    );
    expect((await http.inject(req)).statusCode).toBe(409);
    await db.query('DELETE FROM test_a7_inbound_authority WHERE id=$1', [f.evidenceId]);
    expect((await http.inject(req)).statusCode).toBe(409);
    expect((await service.findLifecycle(f.created.lifecycle.lifecycle_reference))?.version).toBe(1);
    const transitions = await db.query<Array<{ n: string }>>(
      'SELECT count(*) n FROM a7_product_lifecycle_transitions WHERE lifecycle_id=$1',
      [f.created.lifecycle.id],
    );
    expect(transitions[0]?.n).toBe('0');
  });

  it('rejects missing or mismatched HTTP policy and stale sources', async () => {
    const f = await inboundFixture();
    const url = '/api/v1/customers/me/inbound-funding/commands';
    const headers = { authorization: `Bearer ${f.token}`, 'idempotency-key': 'bad-policy-http' };
    const payload = {
      bindingId: f.bindingId,
      virtualAccountId: f.routeId,
      intendedAmountMinor: '100',
      policyDecisionReference: f.decision.decisionReference,
    };
    expect(
      (
        await http.inject({
          method: 'POST',
          url,
          headers,
          payload: { ...payload, policyDecisionReference: 'missing' },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await http.inject({
          method: 'POST',
          url,
          headers,
          payload: { ...payload, policyDecisionReference: '' },
        })
      ).statusCode,
    ).toBe(400);
    const made = await http.inject({
      method: 'POST',
      url,
      headers: { ...headers, 'idempotency-key': 'bad-amount-http' },
      payload: { ...payload, intendedAmountMinor: '101' },
    });
    expect(made.statusCode).toBe(200);
    const id = made.json<{ lifecycleId: string }>().lifecycleId;
    const req = {
      method: 'POST' as const,
      url: `/api/v1/customers/me/inbound-funding/lifecycles/${id}/admission`,
      headers: { authorization: `Bearer ${f.token}`, 'idempotency-key': 'admit' },
      payload: { expectedVersion: 1 },
    };
    expect((await http.inject(req)).statusCode).toBe(409);
    await db.query(
      `UPDATE test_a7_source_evidence SET source_version=source_version+1 WHERE customer_id=$1 AND source_class='ELIGIBILITY'`,
      [f.customerId],
    );
    const stale = {
      ...req,
      url: `/api/v1/customers/me/inbound-funding/lifecycles/${f.created.lifecycle.id}/admission`,
    };
    expect((await http.inject(stale)).statusCode).toBe(409);
  });
  it('admits at most once under different concurrent HTTP idempotency keys', async () => {
    const f = await inboundFixture();
    const url = `/api/v1/customers/me/inbound-funding/lifecycles/${f.created.lifecycle.id}/admission`;
    const req = {
      method: 'POST' as const,
      url,
      headers: { authorization: `Bearer ${f.token}`, 'idempotency-key': 'one' },
      payload: { expectedVersion: 1 },
    };
    const results = await Promise.all([
      http.inject(req),
      http.inject({ ...req, headers: { ...req.headers, 'idempotency-key': 'two' } }),
    ]);
    expect(results.map((x) => x.statusCode).sort()).toEqual([200, 409]);
  });
  it('serializes authenticated HTTP admission and cancellation', async () => {
    const f = await inboundFixture();
    const url = `/api/v1/customers/me/inbound-funding/lifecycles/${f.created.lifecycle.id}`;
    const base = {
      method: 'POST' as const,
      headers: { authorization: `Bearer ${f.token}`, 'idempotency-key': 'http-race' },
      payload: { expectedVersion: 1 },
    };
    const result = await Promise.all([
      http.inject({ ...base, url: `${url}/admission` }),
      http.inject({ ...base, url: `${url}/cancellation` }),
    ]);
    expect(result.map((x) => x.statusCode).sort()).toEqual([200, 409]);
    const transitions = await db.query<Array<{ n: string }>>(
      'SELECT count(*) n FROM a7_product_lifecycle_transitions WHERE lifecycle_id=$1',
      [f.created.lifecycle.id],
    );
    expect(transitions[0]?.n).toBe('1');
  });
  it('rejects a retired inbound policy profile', async () => {
    const f = await inboundFixture();
    await db.query(
      `UPDATE policy_profile_versions SET lifecycle_state='RETIRED',retired_at=clock_timestamp(),retired_by='controlled-test' WHERE profile_reference=$1`,
      [A7_INBOUND_ADMISSION_PROFILE.profileReference],
    );
    await expect(
      service.transition({
        token: f.token,
        lifecycleId: f.created.lifecycle.id,
        expectedVersion: 1,
        nextState: 'LIFECYCLE_ADMITTED',
        idempotencyKey: 'admit',
      }),
    ).rejects.toThrow('policy evidence missing or mismatched');
  });
});
