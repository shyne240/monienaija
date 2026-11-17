import { DataSource } from 'typeorm';

import { OperationalFundsVisibilityService } from '../src/banking/operational-funds-visibility.service';
import { createIntegrationDataSource } from './support/pg-harness';

/**
 * Operational visibility for unresolved funds.
 *
 * The property under test is not "the endpoint returns data". It is that an operator can tell the
 * difference between *nothing is wrong* and *this deployment cannot see*. Those look identical on a
 * dashboard that renders an empty list for both, and the difference is the difference between
 * "we checked and it is clean" and "we have no way to check".
 *
 * The second property is that nothing here can move money. It is asserted structurally — the service
 * exposes only reads — rather than by trusting the absence of a route.
 */
describe('Operational funds visibility (real PostgreSQL)', () => {
  let db: DataSource;
  let service: OperationalFundsVisibilityService;
  let institutionId: string;

  beforeAll(async () => {
    db = await createIntegrationDataSource('a3dvis');
    service = new OperationalFundsVisibilityService(db);

    const suffix = Date.now().toString().slice(-8);
    const rows: Array<{ id: string }> = await db.query(
      `INSERT INTO financial_institutions (reference,code,legal_name,institution_type,created_by)
       VALUES ($1,$2,'Visibility fixture institution','PARTNER','fixture') RETURNING id`,
      [`A3DV-${suffix}`, `A3DV_${suffix}`],
    );
    institutionId = rows[0]!.id;
  }, 180_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('reports unsupported sources as UNSUPPORTED rather than as empty', async () => {
    const summary = await service.unresolved(institutionId);

    const byKey = new Map(summary.sources.map((source) => [source.key, source]));

    // A deliberate absence, with a reason. If this ever reports AVAILABLE with count 0, the
    // difference between "no discrepancies" and "no way to look" has been lost.
    for (const key of ['PROVIDER_SETTLEMENT_EVIDENCE', 'PROVIDER_BALANCE', 'REFUND_AND_RETURN']) {
      const source = byKey.get(key);
      expect(source?.state).toBe('UNSUPPORTED');
      expect(source?.reason).toBeTruthy();
      expect(source?.count).toBeUndefined();
    }

    // The sources this deployment *can* answer say so explicitly.
    for (const key of [
      'VERIFIED_INBOUND_NOT_CREDITED',
      'AGENT_FLOAT_AWAITING_CREDIT',
      'UNRESOLVED_OUTBOUND',
      'OPEN_RECONCILIATION_EXCEPTIONS',
    ]) {
      expect(byKey.get(key)?.state).toBe('AVAILABLE');
      expect(byKey.get(key)?.count).toBe(0);
    }
  });

  it('counts a verified, uncredited inbound payment', async () => {
    const reference = `VIS-${Date.now()}`;
    await db.query(
      `INSERT INTO banking_inbound_payments
         (institution_id,provider_key,environment,provider_transaction_reference,
          currency,gross_amount_minor,provider_fee_minor,credited_amount_minor,verification_state)
       VALUES ($1,'MONNIFY','sandbox',$2,'NGN',500000,0,500000,'VERIFIED')`,
      [institutionId, reference],
    );

    const summary = await service.unresolved(institutionId);
    const source = summary.sources.find((s) => s.key === 'VERIFIED_INBOUND_NOT_CREDITED')!;

    expect(source.count).toBe(1);
    // The operator sees the reference and the amount — enough to reconcile, and nothing that
    // identifies the customer or exposes a provider payload.
    expect(source.items?.[0]).toMatchObject({
      reference,
      amount_minor: '500000',
      state: 'UNCREDITED',
    });
    expect(summary.totals.verifiedUncreditedInbound).toBe(1);

    // Marking it credited removes it from the outstanding set. This proves the query reads the real
    // credit link rather than merely counting rows.
    await db.query(
      `UPDATE banking_inbound_payments SET ledger_transaction_id = gen_random_uuid()
        WHERE institution_id = $1 AND provider_transaction_reference = $2`,
      [institutionId, reference],
    );
    expect((await service.unresolved(institutionId)).totals.verifiedUncreditedInbound).toBe(0);
  });

  it('counts reconciliation exceptions as exceptions, and says nothing about settlement', async () => {
    const observation: Array<{ id: string }> = await db.query(
      `INSERT INTO banking_provider_observations
         (institution_id,provider_key,environment,subject_type,subject_reference,provider_status,observed_at)
       VALUES ($1,'MONNIFY','sandbox','OUTBOUND_OPERATION',$2,'SUCCESSFUL',now()) RETURNING id`,
      [institutionId, `VIS-OBS-${Date.now()}`],
    );
    await db.query(
      `INSERT INTO banking_reconciliation_exceptions
         (institution_id,observation_id,subject_type,subject_reference,kind,detail,severity,state)
       VALUES ($1,$2,'OUTBOUND_OPERATION',$3,'MISSING_INTERNALLY','Provider reports a transfer we do not hold','REVIEW','OPEN')`,
      [institutionId, observation[0]!.id, `VIS-EXC-${Date.now()}`],
    );

    const summary = await service.unresolved(institutionId);
    expect(summary.totals.openReconciliationExceptions).toBe(1);

    // An exception is a discrepancy, never a settlement. No *field* in this response can be read as
    // "settled": the only settlement-related content is the explicit UNSUPPORTED reason text, which
    // says the opposite. Checked against the structured payload rather than the serialized string, so
    // the assertion is about data and not about whether a word appears in a sentence.
    const fields = summary.sources.flatMap((source) =>
      (source.items ?? []).flatMap((item) => Object.keys(item)),
    );
    expect(fields).not.toContain('settled');
    expect(fields).not.toContain('settlement_amount_minor');
    expect(fields).not.toContain('provider_balance_minor');
    expect(summary.sources.find((s) => s.key === 'PROVIDER_SETTLEMENT_EVIDENCE')?.state).toBe(
      'UNSUPPORTED',
    );
  });

  it('reports platform pressure as aggregate counts only', async () => {
    const pressure = await service.platformPressure();

    // Counts, never amounts or identifiers.
    expect(Object.keys(pressure).sort()).toEqual(
      [
        'verified_uncredited_inbound',
        'agent_float_obligations',
        'unresolved_outbound',
        'open_exceptions',
      ].sort(),
    );
    for (const value of Object.values(pressure)) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('exposes no method that writes', () => {
    // Structural, not rhetorical: the service's whole public surface must be reads. A future
    // "resolve" or "credit" helper added here would be a way to move money from an operations
    // screen, so the absence is asserted rather than assumed.
    const prototype = OperationalFundsVisibilityService.prototype;
    const methods = Object.getOwnPropertyNames(prototype).filter(
      (name) => name !== 'constructor' && typeof (prototype as never)[name] === 'function',
    );
    // Renaming a method to `credit`, `resolve`, `adjust` or `repair` fails here. The only permitted
    // write-shaped name would have to be added deliberately, and would fail this assertion.
    expect(methods.sort()).toEqual(['platformPressure', 'query', 'unresolved']);
  });
});
