import { createHash, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
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
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(db)
      .overrideProvider(KycTierEvidenceReader)
      .useValue({ read: (_: unknown, id: string) => Promise.resolve(snapshots.get(id) ?? null) })
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
      .useValue(new TestNotificationProvider())
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
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
  });
  afterAll(async () => {
    if (app) await app.close();
    if (db) await destroyIntegrationDataSource(db);
  });
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
    const token = randomUUID();
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
});
