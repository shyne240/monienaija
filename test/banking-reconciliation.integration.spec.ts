import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

import { BankingReconciliationService } from '../src/banking/banking-reconciliation.service';
import { createIntegrationDataSource } from './support/pg-harness';

/**
 * Acceptance for reconciliation.
 *
 * The central claim of this suite is a negative one: reconciliation cannot move money. Everything
 * below either verifies an observation was recorded faithfully or verifies that a potentially
 * money-affecting action is impossible.
 */
describe('banking reconciliation (real PostgreSQL)', () => {
  let db: DataSource;
  let service: BankingReconciliationService;
  let institutionId: string;
  let runId: string;

  beforeAll(async () => {
    db = await createIntegrationDataSource('bkrcon01');
    institutionId = randomUUID();
    const suffix = institutionId.replace(/-/g, '').slice(0, 8).toUpperCase();
    await db.query(
      `INSERT INTO financial_institutions (id,reference,code,legal_name,institution_type,created_by)
       VALUES ($1,$2,$3,'Reconciliation fixture','PARTNER','fixture')`,
      [institutionId, `BKREC-${suffix}`, `BKREC_${suffix}`],
    );
    service = new BankingReconciliationService(db);
  }, 120000);

  beforeEach(async () => {
    runId = await service.startRun({
      institutionId,
      providerKey: 'MONNIFY',
      environment: 'sandbox',
    });
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  const subject = (over: Record<string, unknown> = {}) => ({
    subjectType: 'INBOUND_PAYMENT' as const,
    subjectReference: `MNFY|${randomUUID().slice(0, 12)}`,
    internal: { amountMinor: '7800000', state: 'VERIFIED' },
    provider: { amountMinor: '7800000', status: 'VERIFIED', reference: 'MNFY|X' },
    ...over,
  });

  it('records agreement as an observation with no exception', async () => {
    const result = await service.observe(runId, institutionId, subject());
    expect(result.exceptionId).toBeNull();
    expect(result.kind).toBeNull();
    const [row] = await db.query<Array<{ c: string }>>(
      'SELECT count(*)::text AS c FROM banking_provider_observations WHERE run_id=$1',
      [runId],
    );
    expect(row!.c).toBe('1');
  });

  it('raises AMOUNT_MISMATCH as CRITICAL and records both figures', async () => {
    const check = subject({
      internal: { amountMinor: '7800000', state: 'VERIFIED' },
      provider: { amountMinor: '7700000', status: 'VERIFIED', reference: 'MNFY|X' },
    });
    const result = await service.observe(runId, institutionId, check);
    expect(result.kind).toBe('AMOUNT_MISMATCH');
    const [row] = await db.query<Array<{ severity: string; internal_amount_minor: string }>>(
      'SELECT severity,internal_amount_minor::text AS internal_amount_minor FROM banking_reconciliation_exceptions WHERE id=$1',
      [result.exceptionId],
    );
    expect(row!.severity).toBe('CRITICAL');
    expect(row!.internal_amount_minor).toBe('7800000');
  });

  it('raises exactly ONE open exception when the same difference is observed repeatedly', async () => {
    const reference = `MNFY|${randomUUID().slice(0, 12)}`;
    const check = subject({
      subjectReference: reference,
      provider: { amountMinor: '7700000', status: 'VERIFIED', reference: 'MNFY|X' },
    });
    const first = await service.observe(runId, institutionId, check);
    const second = await service.observe(runId, institutionId, check);
    expect(first.exceptionId).not.toBeNull();
    // The second observation is still recorded as evidence, but the question is not asked twice.
    expect(second.exceptionId).toBeNull();
    const [row] = await db.query<Array<{ c: string }>>(
      `SELECT count(*)::text AS c FROM banking_reconciliation_exceptions
        WHERE institution_id=$1 AND subject_reference=$2 AND state <> 'RESOLVED'`,
      [institutionId, reference],
    );
    expect(row!.c).toBe('1');
  });

  it('reports a missing provider record as an exception rather than a failure verdict', async () => {
    const result = await service.observe(runId, institutionId, subject({ provider: null }));
    expect(result.kind).toBe('MISSING_AT_PROVIDER');
  });

  it('reports an unverifiable check as an exception, never as agreement', async () => {
    // This is the settlement case: no documented schema exists, so the honest answer is "we could not
    // check", which must be loud rather than silently skipped.
    const result = await service.observe(
      runId,
      institutionId,
      subject({ unverifiableReason: 'MONNIFY_CAPABILITY_UNSUPPORTED: settlement verification' }),
    );
    expect(result.kind).toBe('UNVERIFIABLE');
    expect(result.exceptionId).not.toBeNull();
  });

  it('does not manufacture a mismatch when the provider has no amount to compare', async () => {
    const result = await service.observe(
      runId,
      institutionId,
      subject({ provider: { amountMinor: null, status: 'VERIFIED', reference: 'MNFY|X' } }),
    );
    // No amount on one side means no amount comparison is possible; status still agrees, so this is
    // not a difference. Inventing one would fill the worklist with noise.
    expect(result.kind).toBeNull();
  });

  it('REFUSES to edit an observation — evidence is append-only', async () => {
    const result = await service.observe(runId, institutionId, subject());
    await expect(
      db.query(`UPDATE banking_provider_observations SET provider_status='VERIFIED' WHERE id=$1`, [
        result.observationId,
      ]),
    ).rejects.toThrow(/append-only/i);
  });

  it('REFUSES to edit the amounts that raised an exception', async () => {
    const result = await service.observe(
      runId,
      institutionId,
      subject({ provider: { amountMinor: '7700000', status: 'VERIFIED', reference: 'MNFY|X' } }),
    );
    await expect(
      db.query(
        `UPDATE banking_reconciliation_exceptions SET provider_amount_minor=7800000 WHERE id=$1`,
        [result.exceptionId],
      ),
    ).rejects.toThrow(/immutable/i);
  });

  it('has no resolution vocabulary that implies adjusting money', async () => {
    const [row] = await db.query<Array<{ definition: string }>>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conrelid='banking_reconciliation_exceptions'::regclass AND contype='c'
          AND pg_get_constraintdef(oid) LIKE '%ACCEPTED_DIFFERENCE%'`,
    );
    expect(row!.definition).not.toMatch(/ADJUST/);
    expect(row!.definition).toContain('MATCHED');
    expect(row!.definition).toContain('ACCEPTED_DIFFERENCE');
  });

  it('carries no money-movement column on a reconciliation run', async () => {
    const columns = await db.query<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='banking_reconciliation_runs'`,
    );
    const names = columns.map((c) => c.column_name);
    expect(names.some((n) => n.includes('adjust'))).toBe(false);
    expect(names.some((n) => n.includes('journal'))).toBe(false);
    expect(names.some((n) => n.includes('ledger'))).toBe(false);
  });

  it('resolves an exception with a recorded reason and refuses to reopen it', async () => {
    const result = await service.observe(
      runId,
      institutionId,
      subject({ provider: { amountMinor: '7700000', status: 'VERIFIED', reference: 'MNFY|X' } }),
    );
    await service.resolve(
      result.exceptionId!,
      'ACCEPTED_DIFFERENCE',
      'ops-1',
      'Provider fee explained',
    );
    await expect(
      db.query(`UPDATE banking_reconciliation_exceptions SET state='OPEN' WHERE id=$1`, [
        result.exceptionId,
      ]),
    ).rejects.toThrow(/cannot be reopened/i);
  });

  it('escalates rather than resolving, keeping the item on the worklist', async () => {
    const result = await service.observe(
      runId,
      institutionId,
      subject({ provider: { amountMinor: '7700000', status: 'FAILED', reference: 'MNFY|X' } }),
    );
    await service.resolve(result.exceptionId!, 'ESCALATED', 'ops-2', 'Needs provider statement');
    const open = await service.openExceptions(institutionId);
    expect(open.map((e) => e.id)).toContain(result.exceptionId);
  });

  it('orders the worklist by severity so critical differences surface first', async () => {
    const critical = await service.observe(
      runId,
      institutionId,
      subject({ provider: { amountMinor: '1', status: 'VERIFIED', reference: 'MNFY|X' } }),
    );
    const open = await service.openExceptions(institutionId, 500);
    const index = open.findIndex((e) => e.id === critical.exceptionId);
    expect(index).toBeGreaterThanOrEqual(0);
    // No INFO/REVIEW item may precede it once a CRITICAL exists.
    const before = open.slice(0, index);
    expect(before.every((e) => e.severity === 'CRITICAL')).toBe(true);
  });

  it('REFUSES to delete an exception or an observation', async () => {
    const result = await service.observe(runId, institutionId, subject({ provider: null }));
    await expect(
      db.query('DELETE FROM banking_reconciliation_exceptions WHERE id=$1', [result.exceptionId]),
    ).rejects.toThrow(/never deleted/i);
    await expect(
      db.query('DELETE FROM banking_provider_observations WHERE id=$1', [result.observationId]),
    ).rejects.toThrow(/never deleted/i);
  });

  it('records a run as completed with its counts', async () => {
    await service.observe(runId, institutionId, subject());
    await service.completeRun(runId, 'COMPLETED');
    const [row] = await db.query<
      Array<{ state: string; completed_at: Date; observations: number }>
    >('SELECT state,completed_at,observations FROM banking_reconciliation_runs WHERE id=$1', [
      runId,
    ]);
    expect(row!.state).toBe('COMPLETED');
    expect(row!.completed_at).toBeInstanceOf(Date);
    expect(row!.observations).toBe(1);
  });
});
