import type { TierEvidenceSnapshot } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { WalletService } from '../src/wallet/wallet.service';
import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';

const socket = process.env.KYC_ISOLATED_TEST_SOCKET ?? '';
if (!/^\/home\/user\/m25c-isolated-pgsocket\/kyc-batch1-[A-Za-z0-9]+$/.test(socket))
  throw new Error('Disposable KYC socket required');
const name = `kyc_reversal_${randomUUID().replace(/-/g, '')}`;
const admin = new DataSource({
  type: 'postgres',
  host: socket,
  port: 55461,
  username: 'kyc_synthetic',
  database: 'postgres',
  synchronize: false,
  migrationsRun: false,
  entities: [],
  migrations: [],
});
let created = false;
let db: DataSource;
let app: NestFastifyApplication;
const sms = new TestNotificationProvider();
// This adapter is strictly local to this test module; no real provider is called.
const snapshots = new Map<string, TierEvidenceSnapshot>();

beforeAll(async () => {
  await admin.initialize();
  const [location] = await admin.query<Array<{ data_directory: string }>>('SHOW data_directory');
  const [listen] = await admin.query<Array<{ listen_addresses: string }>>('SHOW listen_addresses');
  const [version] = await admin.query<Array<{ server_version: string }>>('SHOW server_version');
  if (
    !/^\/home\/user\/kyc-batch1-pg-[A-Za-z0-9]+$/.test(location?.data_directory ?? '') ||
    listen?.listen_addresses !== '' ||
    !version?.server_version.startsWith('16.')
  )
    throw new Error('Not an independently isolated PostgreSQL 16 cluster');
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  db = new DataSource({
    type: 'postgres',
    host: socket,
    port: 55461,
    username: 'kyc_synthetic',
    database: name,
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: 'typeorm_migrations',
    entities: [`${__dirname}/../src/**/*.entity.ts`],
    migrations: [`${__dirname}/../src/migrations/*.ts`],
  });
  await db.initialize();
  await db.runMigrations({ transaction: 'all' });
  const { AppModule } = await import('../src/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(db)
    .overrideProvider(KycTierEvidenceReader)
    .useValue({ read: (_m: unknown, id: string) => Promise.resolve(snapshots.get(id) ?? null) })
    .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
    .useValue(sms)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  await setPolicy();
}, 180_000);
afterAll(async () => {
  if (app) await app.close();
  if (db?.isInitialized) await db.destroy();
  if (admin.isInitialized) {
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.destroy();
  }
});

async function setPolicy() {
  const proposal = randomUUID();
  const req = { all: [], any: [] };
  const definition = {
    regulatoryRequirementsConfirmed: true,
    effectiveFrom: '2020-01-01T00:00:00.000Z',
    effectiveUntil: null,
    regulatory: { LEVEL_1: req, LEVEL_2: req },
    operator: { LEVEL_1: req, LEVEL_2: req },
  };
  await db.query(
    `INSERT INTO kyc_tier_policy_proposals(id,request_id,expected_version,definition,fingerprint,maker_id,maker_session_id,checker_id,checker_session_id,state) VALUES($1,$2,0,$3,$4,'maker',$5,'checker',$6,'APPROVED')`,
    [
      proposal,
      randomUUID(),
      JSON.stringify(definition),
      'a'.repeat(64),
      randomUUID(),
      randomUUID(),
    ],
  );
  await db.query(
    `INSERT INTO kyc_tier_policy_versions(version,proposal_id,definition,maker_id,checker_id) VALUES(1,$1,$2,'maker','checker')`,
    [proposal, JSON.stringify(definition)],
  );
  await db.query('UPDATE kyc_tier_policy_head SET version=1');
}
async function subject(
  level: 'LEVEL_1' | 'LEVEL_2',
  types: Array<'BVN' | 'NIN'>,
  synthetic = false,
) {
  const id = randomUUID();
  const phone = `${Math.floor(1000000000 + Math.random() * 8999999999)}`;
  await db.query(
    `INSERT INTO customers(id,reference,customer_type,status,kyc_level,kyc_status,is_synthetic) VALUES($1,$2,'INDIVIDUAL','DRAFT',CASE WHEN $4 THEN 'NONE' ELSE $3 END,CASE WHEN $4 THEN 'NOT_STARTED' ELSE 'APPROVED' END,$4)`,
    [id, id, level, synthetic],
  );
  await db.query(
    `INSERT INTO customer_contact_methods(customer_id,type,value,normalized_value,is_primary,verified_at) VALUES($1,'PHONE',$2,$2,true,clock_timestamp())`,
    [id, phone],
  );
  await db.query(
    `INSERT INTO customer_kyc_assessments(customer_id,kyc_level,kyc_status,assessed_by,expires_at) VALUES($1,$2,'APPROVED','fixture',clock_timestamp()+interval '1 hour')`,
    [id, level],
  );
  snapshots.set(id, {
    identityRevision: 'fixture',
    evidence: types.map((type) => ({
      id: randomUUID(),
      customerId: id,
      identityRevision: 'fixture',
      type,
      status: 'VERIFIED',
      provenance: 'VERIFIED_PROVIDER',
      verifiedAt: new Date(Date.now() - 10000),
      expiresAt: new Date(Date.now() + 1800000),
    })),
  });
  return id;
}

import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { LedgerReversalGovernanceService } from '../src/ledger/ledger-reversal-governance.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { LedgerAccountType, LedgerEntryDirection } from '../src/ledger/ledger.enums';

const maker: AuthorizationPrincipal = {
  type: 'OPERATOR',
  principalId: 'reversal-maker',
  sessionId: randomUUID(),
  roles: ['FINANCE_PREPARER'],
  scopes: ['ledger.reverse'],
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
};
const checker: AuthorizationPrincipal = {
  type: 'OPERATOR',
  principalId: 'reversal-checker',
  sessionId: randomUUID(),
  roles: ['FINANCE_CONTROLLER'],
  scopes: ['privileged:approve', 'privileged:execute'],
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
};

async function fixture(metadata?: Record<string, unknown>) {
  const customer = await subject('LEVEL_1', ['BVN']);
  await db.query(`UPDATE customers SET status='ACTIVE' WHERE id=$1`, [customer]);
  const wallet = await app
    .get(WalletService)
    .createWallet({ customerId: customer, currency: 'NGN', idempotencyKey: randomUUID() });
  const ledger = app.get(LedgerService);
  const counter = await ledger.createAccount({
    code: `REV-${randomUUID()}`,
    name: 'reversal counter',
    currency: 'NGN',
    accountType: LedgerAccountType.ASSET,
    allowNegativeBalance: true,
  });
  const original = await ledger.postJournal({
    idempotencyKey: randomUUID(),
    currency: 'NGN',
    reference: `test-${randomUUID()}`,
    metadata,
    lines: [
      { accountId: counter.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '500' },
      {
        accountId: wallet.ledgerAccountId,
        direction: LedgerEntryDirection.CREDIT,
        amountMinor: '500',
      },
    ],
  });
  return { customer, wallet, counter, original, ledger };
}

async function approve(journalId: string, reason: string) {
  const governance = app.get(LedgerReversalGovernanceService);
  const pending = await governance.requestReversal({ principal: maker, journalId, reason });
  const decision = await app
    .get(PrivilegedActionApprovalService)
    .approve({ approvalId: pending.approvalId, principal: checker });
  expect(decision.approved).toBe(true);
  return pending.approvalId;
}

async function state(approvalId: string, originalId: string) {
  const [approval] = await db.query<Array<{ status: string }>>(
    'SELECT status FROM privileged_action_approvals WHERE id=$1',
    [approvalId],
  );
  const [journals] = await db.query<Array<{ n: number }>>(
    'SELECT count(*)::int AS n FROM ledger_journals WHERE reversal_of_journal_id=$1',
    [originalId],
  );
  const [execution] = await db.query<Array<{ n: number }>>(
    'SELECT count(*)::int AS n FROM governed_ledger_reversal_executions WHERE approval_id=$1',
    [approvalId],
  );
  const [audit] = await db.query<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM audit_events WHERE entity_id=$1 AND action='PRIVILEGED_ACTION_CONSUMED'`,
    [approvalId],
  );
  return {
    status: approval!.status,
    reversals: journals!.n,
    executions: execution!.n,
    audits: audit!.n,
  };
}

test('authorized suspended and expired customer reversal is exactly inverted, linked, audited and replay-safe', async () => {
  const { customer, wallet, counter, original, ledger } = await fixture();
  const reason = 'Correct duplicate posting';
  const approvalId = await approve(original.id, reason);
  const command = {
    principal: checker,
    journalId: original.id,
    reason,
    approvalId,
    idempotencyKey: randomUUID(),
  };
  const governance = app.get(LedgerReversalGovernanceService);
  await expect(
    db.transaction((manager) =>
      ledger.reverseJournalInTransaction(manager, original.id, randomUUID(), reason, randomUUID()),
    ),
  ).rejects.toThrow('Reversal approval does not match journal');
  const unauthorized = {
    ...checker,
    principalId: 'unrelated-controller',
    scopes: ['privileged:approve'],
  };
  await expect(
    governance.executeReversal({ ...command, principal: unauthorized }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    governance.executeReversal({
      ...command,
      principal: { ...maker, scopes: ['privileged:execute'] },
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    governance.executeReversal({ ...command, journalId: randomUUID() }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    governance.executeReversal({ ...command, reason: 'different reason' }),
  ).rejects.toMatchObject({ status: 403 });
  expect(await state(approvalId, original.id)).toEqual({
    status: 'APPROVED',
    reversals: 0,
    executions: 0,
    audits: 0,
  });
  await db.query(`UPDATE customers SET status='SUSPENDED' WHERE id=$1`, [customer]);
  await db.query(
    `UPDATE customer_kyc_assessments SET expires_at=clock_timestamp()-interval '1 minute' WHERE customer_id=$1`,
    [customer],
  );
  const reversal = await governance.executeReversal(command);
  expect(reversal.reversalOfJournalId).toBe(original.id);
  await expect(
    db.transaction((manager) =>
      ledger.reverseJournalInTransaction(manager, original.id, randomUUID(), reason, approvalId),
    ),
  ).rejects.toThrow('Reversal approval does not match journal');
  expect(reversal.metadata.governedReversalApprovalId).toBe(approvalId);
  const invert = (direction: string) => (direction === 'DEBIT' ? 'CREDIT' : 'DEBIT');
  expect(reversal.lines.map((x) => [x.accountId, x.direction, x.amountMinor]).sort()).toEqual(
    original.lines.map((x) => [x.accountId, invert(x.direction), x.amountMinor]).sort(),
  );
  expect(await state(approvalId, original.id)).toEqual({
    status: 'CONSUMED',
    reversals: 1,
    executions: 1,
    audits: 1,
  });
  expect(await governance.executeReversal(command)).toEqual(reversal);
  await expect(
    governance.executeReversal({ ...command, idempotencyKey: randomUUID() }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    governance.executeReversal({ ...command, principal: unauthorized }),
  ).rejects.toMatchObject({ status: 403 });
  expect((await ledger.getAccountBalance(wallet.ledgerAccountId)).balanceMinor).toBe('0');
  expect((await ledger.getAccountBalance(counter.id)).balanceMinor).toBe('0');
  expect(await state(approvalId, original.id)).toEqual({
    status: 'CONSUMED',
    reversals: 1,
    executions: 1,
    audits: 1,
  });
});

test('failed posting and a compliance hold roll back consumption and allow a later successful retry', async () => {
  const { customer, wallet, original } = await fixture();
  const reason = 'Correct an entry';
  const approvalId = await approve(original.id, reason);
  const command = {
    principal: checker,
    journalId: original.id,
    reason,
    approvalId,
    idempotencyKey: randomUUID(),
  };
  const governance = app.get(LedgerReversalGovernanceService);
  await db.query('UPDATE ledger_accounts SET is_active=false WHERE id=$1', [
    wallet.ledgerAccountId,
  ]);
  await expect(governance.executeReversal(command)).rejects.toThrow('inactive');
  expect(await state(approvalId, original.id)).toEqual({
    status: 'APPROVED',
    reversals: 0,
    executions: 0,
    audits: 0,
  });
  await db.query('UPDATE ledger_accounts SET is_active=true WHERE id=$1', [wallet.ledgerAccountId]);
  // Force failure after the journal and lines are inserted; every write must roll back.
  await db.query(`CREATE FUNCTION test_reversal_link_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected execution link failure'; END $$`);
  await db.query(
    `CREATE TRIGGER test_reversal_link_failure BEFORE INSERT ON governed_ledger_reversal_executions FOR EACH ROW EXECUTE FUNCTION test_reversal_link_failure()`,
  );
  try {
    await expect(governance.executeReversal(command)).rejects.toThrow(
      'injected execution link failure',
    );
    expect(await state(approvalId, original.id)).toEqual({
      status: 'APPROVED',
      reversals: 0,
      executions: 0,
      audits: 0,
    });
    expect(
      (await app.get(LedgerService).getAccountBalance(wallet.ledgerAccountId)).balanceMinor,
    ).toBe('500');
  } finally {
    await db.query(
      'DROP TRIGGER test_reversal_link_failure ON governed_ledger_reversal_executions',
    );
    await db.query('DROP FUNCTION test_reversal_link_failure()');
  }
  await db.query(
    `INSERT INTO kyc_tier_manual_holds(customer_id,actor,reason) VALUES($1,'compliance','MANUAL_REVIEW')`,
    [customer],
  );
  await expect(governance.executeReversal(command)).rejects.toThrow('pending compliance review');
  expect(await state(approvalId, original.id)).toEqual({
    status: 'APPROVED',
    reversals: 0,
    executions: 0,
    audits: 0,
  });
  await db.query('DELETE FROM kyc_tier_manual_holds WHERE customer_id=$1', [customer]);
  const result = await governance.executeReversal(command);
  expect(result.reversalOfJournalId).toBe(original.id);
  expect(await state(approvalId, original.id)).toEqual({
    status: 'CONSUMED',
    reversals: 1,
    executions: 1,
    audits: 1,
  });
});

test('concurrent same-key retries replay one result and competing approvals cannot duplicate effects', async () => {
  const { original } = await fixture();
  const reason = 'Reverse concurrent duplicate';
  const first = await approve(original.id, reason);
  const second = await approve(original.id, reason);
  const governance = app.get(LedgerReversalGovernanceService);
  const command = {
    principal: checker,
    journalId: original.id,
    reason,
    approvalId: first,
    idempotencyKey: randomUUID(),
  };
  const results = await Promise.all([
    governance.executeReversal(command),
    governance.executeReversal(command),
  ]);
  expect(results[0].id).toBe(results[1].id);
  await expect(
    governance.executeReversal({ ...command, approvalId: second, idempotencyKey: randomUUID() }),
  ).rejects.toThrow('already been reversed');
  expect(await state(first, original.id)).toEqual({
    status: 'CONSUMED',
    reversals: 1,
    executions: 1,
    audits: 1,
  });
  expect(await state(second, original.id)).toEqual({
    status: 'APPROVED',
    reversals: 1,
    executions: 0,
    audits: 0,
  });
  const [lines] = await db.query<Array<{ n: number }>>(
    'SELECT count(*)::int AS n FROM ledger_lines WHERE journal_id=$1',
    [results[0].id],
  );
  expect(lines!.n).toBe(original.lines.length);
});

test('competing approved requests for one original serialize and the losing approval stays unconsumed', async () => {
  const { original } = await fixture();
  const reason = 'Resolve competing reversals';
  const approvals = [await approve(original.id, reason), await approve(original.id, reason)];
  const governance = app.get(LedgerReversalGovernanceService);
  const results = await Promise.allSettled(
    approvals.map((approvalId) =>
      governance.executeReversal({
        principal: checker,
        journalId: original.id,
        reason,
        approvalId,
        idempotencyKey: randomUUID(),
      }),
    ),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  const states = await Promise.all(approvals.map((id) => state(id, original.id)));
  expect(states.map((s) => s.status).sort()).toEqual(['APPROVED', 'CONSUMED']);
  expect(states.reduce((sum, s) => sum + s.executions, 0)).toBe(1);
  expect(states.reduce((sum, s) => sum + s.audits, 0)).toBe(1);
  expect(states.every((s) => s.reversals === 1)).toBe(true);
  const consumed = approvals[states.findIndex((s) => s.status === 'CONSUMED')]!;
  await expect(
    db.query('DELETE FROM governed_ledger_reversal_executions WHERE approval_id=$1', [consumed]),
  ).rejects.toThrow('immutable');
  await expect(
    db.query(
      'UPDATE governed_ledger_reversal_executions SET original_journal_id=$1 WHERE approval_id=$2',
      [randomUUID(), consumed],
    ),
  ).rejects.toThrow('immutable');
});

test('long approved reasons and large original metadata do not strand an authorized reversal', async () => {
  const { original } = await fixture({ value: 'x'.repeat(32_700) });
  const reason = 'review ' + 'a'.repeat(450);
  const approvalId = await approve(original.id, reason);
  const result = await app.get(LedgerReversalGovernanceService).executeReversal({
    principal: checker,
    journalId: original.id,
    reason,
    approvalId,
    idempotencyKey: randomUUID(),
  });
  expect(result.metadata.reversalReason).toBe(reason);
  expect(result.metadata.governedReversalApprovalId).toBe(approvalId);
  expect(result.reversalOfJournalId).toBe(original.id);
  expect((await app.get(LedgerService).getJournal(original.id)).metadata.value).toBe(
    'x'.repeat(32_700),
  );
});
