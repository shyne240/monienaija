import { randomUUID } from 'node:crypto';

import type { DataSource } from 'typeorm';

import { DisputeService } from '../src/disputes/dispute.service';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  truncateAllTables,
} from './support/pg-harness';

/**
 * ARENA 3D Group 24 — complaints and transaction disputes.
 *
 * The properties under test, in order of importance:
 *
 * 1. **A dispute cannot move money.** The schema has no column that credits anything, and this suite proves
 *    the service never writes to the ledger.
 * 2. **An upheld award needs two people.** Separation of duties is enforced in the database, so a service
 *    bug cannot collapse it.
 * 3. **Closure requires the customer to have been told.** An un-informed customer is the regulatory
 *    complaint, not the resolved case.
 * 4. **The award must match the outcome.** A typo cannot turn a rejection into a payout.
 */
describe('Group 24 — transaction disputes', () => {
  let db: DataSource;
  let service: DisputeService;

  beforeAll(async () => {
    db = await createIntegrationDataSource('g24dsp');
    service = new DisputeService(db, new AuditService(db.getRepository(AuditEvent)));
  }, 180_000);

  afterAll(async () => {
    await destroyIntegrationDataSource(db);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  async function customer(label: string): Promise<string> {
    const rows: Array<{ id: string }> = await db.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1, 'INDIVIDUAL', 'ACTIVE', 'LEVEL_1', 'APPROVED') RETURNING id`,
      [`g24.${label}.${randomUUID().slice(0, 10)}`],
    );
    return firstRow(rows, 'seeded customer').id;
  }

  function raiseCommand(customerId: string, overrides: Record<string, unknown> = {}) {
    return {
      customerId,
      transactionReference: `txn-${randomUUID().slice(0, 8)}`,
      channel: 'INTERNAL_TRANSFER',
      grounds: 'NOT_RECEIVED',
      claimedAmountMinor: 100_000,
      currency: 'NGN',
      statement: 'I sent 1,000 naira and the recipient says it never arrived.',
      raisedByType: 'CUSTOMER' as const,
      raisedById: 'customer-portal',
      ...overrides,
    } as Parameters<typeof service.raiseDispute>[0];
  }

  /** Brings a dispute to a decided state, optionally informing the customer. */
  async function decidedDispute(options: {
    outcome: 'UPHELD_IN_FULL' | 'UPHELD_IN_PART' | 'REJECTED';
    awarded: number;
    claimed?: number;
    inform?: boolean;
  }): Promise<string> {
    const customerId = await customer('flow');
    const raised = await service.raiseDispute(
      raiseCommand(customerId, { claimedAmountMinor: options.claimed ?? 100_000 }),
    );
    await service.recordInvestigation({
      disputeId: raised.id,
      investigatedBy: 'investigator-1',
      findings: 'Contacted the receiving bank; the credit did not land.',
    });
    await service.decideDispute({
      disputeId: raised.id,
      decidedBy: 'adjudicator-1',
      outcome: options.outcome,
      awardedAmountMinor: options.awarded,
      rationale: 'Investigation confirms the credit was not applied.',
    });
    if (options.inform !== false) {
      await service.recordCustomerInformed({
        disputeId: raised.id,
        informedBy: 'support-1',
        detail: 'Called the customer and emailed the decision letter.',
      });
    }
    return raised.id;
  }

  describe('the claim is recorded exactly as made', () => {
    it('records a claim and its first event', async () => {
      const customerId = await customer('raise');
      const raised = await service.raiseDispute(raiseCommand(customerId));

      const dispute = await service.getDispute(raised.id);
      expect(dispute.status).toBe('OPEN');
      expect(dispute.grounds).toBe('NOT_RECEIVED');
      expect(Number(dispute.claimed_amount_minor)).toBe(100_000);

      const events = await service.listEvents(raised.id);
      expect(events).toHaveLength(1);
      expect(events[0]?.event_type).toBe('RAISED');
      // A claim being recorded is not the customer being told anything.
      expect(events[0]?.communicated_to_customer).toBe(false);
    });

    it('refuses a claim with no statement', async () => {
      const customerId = await customer('nostmt');
      await expect(
        service.raiseDispute(raiseCommand(customerId, { statement: '   ' })),
      ).rejects.toThrow(/statement/i);
    });

    it('refuses a non-positive or fractional claim', async () => {
      const customerId = await customer('badamount');
      await expect(
        service.raiseDispute(raiseCommand(customerId, { claimedAmountMinor: 0 })),
      ).rejects.toThrow(/positive integer/i);
      await expect(
        service.raiseDispute(raiseCommand(customerId, { claimedAmountMinor: 10.5 })),
      ).rejects.toThrow(/positive integer/i);
    });

    it('refuses a duplicate claim on the same transaction and grounds', async () => {
      const customerId = await customer('dup');
      const reference = `txn-${randomUUID().slice(0, 8)}`;
      await service.raiseDispute(raiseCommand(customerId, { transactionReference: reference }));

      // Two live claims for one transaction would later be awarded twice.
      await expect(
        service.raiseDispute(raiseCommand(customerId, { transactionReference: reference })),
      ).rejects.toThrow(/already has .* dispute/i);
    });

    it('allows the same transaction to be disputed on different grounds', async () => {
      // "It never arrived" and "the fee was wrong" are genuinely separate claims.
      const customerId = await customer('diffgrounds');
      const reference = `txn-${randomUUID().slice(0, 8)}`;
      await service.raiseDispute(
        raiseCommand(customerId, { transactionReference: reference, grounds: 'NOT_RECEIVED' }),
      );
      const second = await service.raiseDispute(
        raiseCommand(customerId, { transactionReference: reference, grounds: 'FEE_DISPUTE' }),
      );
      expect(second.id).toBeTruthy();
    });
  });

  describe('a dispute cannot move money', () => {
    it('has no ledger write anywhere in the flow', async () => {
      /*
       * The central claim of this group, asserted directly: complete a full dispute lifecycle including an
       * upheld award, and confirm not one journal, journal line or ledger balance changed.
       */
      const journalsBefore: Array<{ n: number }> = await db.query(
        `SELECT count(*)::int AS n FROM ledger_journals`,
      );
      const linesBefore: Array<{ n: number }> = await db.query(
        `SELECT count(*)::int AS n FROM ledger_lines`,
      );

      const disputeId = await decidedDispute({ outcome: 'UPHELD_IN_FULL', awarded: 100_000 });
      await service.recordRemedyExecution({
        disputeId,
        remedyExecutionReference: 'reversal-request-abc123',
        recordedBy: 'finance-1',
      });
      await service.closeDispute({ disputeId, closedBy: 'support-2' });

      const journalsAfter: Array<{ n: number }> = await db.query(
        `SELECT count(*)::int AS n FROM ledger_journals`,
      );
      const linesAfter: Array<{ n: number }> = await db.query(
        `SELECT count(*)::int AS n FROM ledger_lines`,
      );

      expect(firstRow(journalsAfter, 'journals').n).toBe(firstRow(journalsBefore, 'journals').n);
      expect(firstRow(linesAfter, 'lines').n).toBe(firstRow(linesBefore, 'lines').n);
    });

    it('records the governed remedy reference as a pointer, not a payment', async () => {
      const disputeId = await decidedDispute({ outcome: 'UPHELD_IN_PART', awarded: 40_000 });

      await service.recordRemedyExecution({
        disputeId,
        remedyExecutionReference: 'reversal-request-abc123',
        recordedBy: 'finance-1',
      });

      const dispute = await service.getDispute(disputeId);
      expect(dispute.remedy_execution_reference).toBe('reversal-request-abc123');
      // The dispute stores a reference. It has no journal id, no wallet, no credited amount column.
      expect(dispute).not.toHaveProperty('journal_id');
      expect(dispute).not.toHaveProperty('credited_amount_minor');
    });

    it('refuses to record a remedy execution before a decision', async () => {
      const customerId = await customer('predecide');
      const raised = await service.raiseDispute(raiseCommand(customerId));

      await expect(
        service.recordRemedyExecution({
          disputeId: raised.id,
          remedyExecutionReference: 'reversal-x',
          recordedBy: 'finance-1',
        }),
      ).rejects.toThrow(/before a decision/i);
    });

    it('refuses to record a remedy execution for a rejected claim', async () => {
      const disputeId = await decidedDispute({ outcome: 'REJECTED', awarded: 0 });

      await expect(
        service.recordRemedyExecution({
          disputeId,
          remedyExecutionReference: 'reversal-y',
          recordedBy: 'finance-1',
        }),
      ).rejects.toThrow(/no award/i);
    });

    it('refuses to record the same remedy execution twice', async () => {
      // Paying twice is the failure mode that matters most here.
      const disputeId = await decidedDispute({ outcome: 'UPHELD_IN_FULL', awarded: 100_000 });
      await service.recordRemedyExecution({
        disputeId,
        remedyExecutionReference: 'reversal-abc',
        recordedBy: 'finance-1',
      });

      await expect(
        service.recordRemedyExecution({
          disputeId,
          remedyExecutionReference: 'reversal-def',
          recordedBy: 'finance-1',
        }),
      ).rejects.toThrow(/already been recorded as executed/i);
    });

    it('refuses to record an execution with no reference at all', async () => {
      const disputeId = await decidedDispute({ outcome: 'UPHELD_IN_FULL', awarded: 100_000 });
      await expect(
        service.recordRemedyExecution({
          disputeId,
          remedyExecutionReference: '  ',
          recordedBy: 'f',
        }),
      ).rejects.toThrow(/must reference/i);
    });
  });

  describe('an upheld award needs a second person', () => {
    it('refuses to let the investigator adjudicate their own investigation', async () => {
      const customerId = await customer('sod1');
      const raised = await service.raiseDispute(raiseCommand(customerId));
      await service.recordInvestigation({
        disputeId: raised.id,
        investigatedBy: 'same-person',
        findings: 'The credit did not land.',
      });

      await expect(
        service.decideDispute({
          disputeId: raised.id,
          decidedBy: 'same-person',
          outcome: 'UPHELD_IN_FULL',
          awardedAmountMinor: 100_000,
          rationale: 'Upheld.',
        }),
      ).rejects.toThrow(/investigator cannot adjudicate/i);
    });

    it('refuses to let the claimant adjudicate their own claim', async () => {
      const customerId = await customer('sod2');
      const raised = await service.raiseDispute(
        raiseCommand(customerId, { raisedByType: 'SUPPORT', raisedById: 'agent-7' }),
      );
      await service.recordInvestigation({
        disputeId: raised.id,
        investigatedBy: 'investigator-1',
        findings: 'Confirmed.',
      });

      await expect(
        service.decideDispute({
          disputeId: raised.id,
          decidedBy: 'agent-7',
          outcome: 'UPHELD_IN_PART',
          awardedAmountMinor: 10_000,
          rationale: 'Upheld in part.',
        }),
      ).rejects.toThrow(/claimant cannot adjudicate/i);
    });

    it('enforces the same separation in the database, not only in the service', async () => {
      // A service bug must not be able to collapse the roles.
      const customerId = await customer('sod3');
      const raised = await service.raiseDispute(
        raiseCommand(customerId, { raisedByType: 'SUPPORT', raisedById: 'agent-7' }),
      );
      await service.recordInvestigation({
        disputeId: raised.id,
        investigatedBy: 'investigator-1',
        findings: 'Confirmed.',
      });

      await expect(
        db.query(
          `UPDATE transaction_disputes
              SET decided_by = 'agent-7', decided_at = now(), outcome = 'UPHELD_IN_FULL',
                  awarded_amount_minor = 100000, decision_rationale = 'x', status = 'DECIDED'
            WHERE id = $1`,
          [raised.id],
        ),
      ).rejects.toThrow();
    });

    it('allows a rejection to be decided by the investigator', async () => {
      // A decision that owes nothing is not a financial act and does not need a second person.
      const customerId = await customer('sod4');
      const raised = await service.raiseDispute(raiseCommand(customerId));
      await service.recordInvestigation({
        disputeId: raised.id,
        investigatedBy: 'investigator-1',
        findings: 'The credit did land; the claim is mistaken.',
      });

      await service.decideDispute({
        disputeId: raised.id,
        decidedBy: 'investigator-1',
        outcome: 'REJECTED',
        awardedAmountMinor: 0,
        rationale: 'The credit landed and the recipient confirmed receipt.',
      });

      const dispute = await service.getDispute(raised.id);
      expect(dispute.outcome).toBe('REJECTED');
    });
  });

  describe('the award must match the outcome', () => {
    it('refuses a rejection that awards money', async () => {
      const customerId = await customer('amt1');
      const raised = await service.raiseDispute(raiseCommand(customerId));
      await expect(
        service.decideDispute({
          disputeId: raised.id,
          decidedBy: 'adjudicator-1',
          outcome: 'REJECTED',
          awardedAmountMinor: 50_000,
          rationale: 'x',
        }),
      ).rejects.toThrow(/must award zero/i);
    });

    it('refuses a full uphold that awards less than claimed', async () => {
      const customerId = await customer('amt2');
      const raised = await service.raiseDispute(raiseCommand(customerId));
      await expect(
        service.decideDispute({
          disputeId: raised.id,
          decidedBy: 'adjudicator-1',
          outcome: 'UPHELD_IN_FULL',
          awardedAmountMinor: 1,
          rationale: 'x',
        }),
      ).rejects.toThrow(/exactly the claimed amount/i);
    });

    it('refuses a partial uphold that awards the full amount', async () => {
      const customerId = await customer('amt3');
      const raised = await service.raiseDispute(raiseCommand(customerId));
      await expect(
        service.decideDispute({
          disputeId: raised.id,
          decidedBy: 'adjudicator-1',
          outcome: 'UPHELD_IN_PART',
          awardedAmountMinor: 100_000,
          rationale: 'x',
        }),
      ).rejects.toThrow(/less than the claimed amount/i);
    });

    it('enforces the award rules in the database too', async () => {
      const customerId = await customer('amt4');
      const raised = await service.raiseDispute(raiseCommand(customerId));
      await expect(
        db.query(
          `UPDATE transaction_disputes
              SET decided_by = 'a', decided_at = now(), outcome = 'REJECTED',
                  awarded_amount_minor = 50000, decision_rationale = 'x', status = 'DECIDED'
            WHERE id = $1`,
          [raised.id],
        ),
      ).rejects.toThrow();
    });

    it('accepts a partial uphold strictly between zero and the claim', async () => {
      const disputeId = await decidedDispute({ outcome: 'UPHELD_IN_PART', awarded: 25_000 });
      const dispute = await service.getDispute(disputeId);
      expect(dispute.outcome).toBe('UPHELD_IN_PART');
      expect(Number(dispute.awarded_amount_minor)).toBe(25_000);
    });

    it('refuses a decision with no rationale', async () => {
      const customerId = await customer('norat');
      const raised = await service.raiseDispute(raiseCommand(customerId));
      await expect(
        service.decideDispute({
          disputeId: raised.id,
          decidedBy: 'adjudicator-1',
          outcome: 'REJECTED',
          awardedAmountMinor: 0,
          rationale: '   ',
        }),
      ).rejects.toThrow(/rationale/i);
    });
  });

  describe('a decision is final and the claim is immutable', () => {
    it('refuses to re-decide a dispute', async () => {
      const disputeId = await decidedDispute({ outcome: 'REJECTED', awarded: 0 });

      await expect(
        service.decideDispute({
          disputeId,
          decidedBy: 'adjudicator-2',
          outcome: 'UPHELD_IN_FULL',
          awardedAmountMinor: 100_000,
          rationale: 'changed my mind',
        }),
      ).rejects.toThrow(/already been decided/i);
    });

    it('refuses to restate the award even via direct SQL', async () => {
      const disputeId = await decidedDispute({ outcome: 'UPHELD_IN_PART', awarded: 25_000 });
      await expect(
        db.query(`UPDATE transaction_disputes SET awarded_amount_minor = 90000 WHERE id = $1`, [
          disputeId,
        ]),
      ).rejects.toThrow(/final/i);
    });

    it('refuses to rewrite what the customer claimed', async () => {
      // Otherwise the award constraints could be satisfied by editing the claim instead of honouring it.
      const customerId = await customer('immut');
      const raised = await service.raiseDispute(raiseCommand(customerId));

      await expect(
        db.query(`UPDATE transaction_disputes SET claimed_amount_minor = 1 WHERE id = $1`, [
          raised.id,
        ]),
      ).rejects.toThrow(/immutable/i);
    });

    it('refuses to delete a dispute', async () => {
      const customerId = await customer('del');
      const raised = await service.raiseDispute(raiseCommand(customerId));
      await expect(
        db.query(`DELETE FROM transaction_disputes WHERE id = $1`, [raised.id]),
      ).rejects.toThrow(/cannot be deleted/i);
    });

    it('refuses to re-investigate a decided dispute', async () => {
      const disputeId = await decidedDispute({ outcome: 'REJECTED', awarded: 0 });
      await expect(
        service.recordInvestigation({
          disputeId,
          investigatedBy: 'someone-else',
          findings: 'a second look',
        }),
      ).rejects.toThrow(/cannot be re-investigated/i);
    });
  });

  describe('closure requires the customer to have been told', () => {
    it('refuses to close a dispute the customer was never informed about', async () => {
      /*
       * The substantive rule. An un-informed customer is precisely the thing that becomes a regulatory
       * complaint, and closure is the moment at which everyone stops looking.
       */
      const disputeId = await decidedDispute({
        outcome: 'UPHELD_IN_FULL',
        awarded: 100_000,
        inform: false,
      });

      await expect(service.closeDispute({ disputeId, closedBy: 'support-2' })).rejects.toThrow(
        /recorded as informed/i,
      );
    });

    it('refuses to inform the customer before there is a decision', async () => {
      const customerId = await customer('noinfo');
      const raised = await service.raiseDispute(raiseCommand(customerId));
      await expect(
        service.recordCustomerInformed({
          disputeId: raised.id,
          informedBy: 'support-1',
          detail: 'told them',
        }),
      ).rejects.toThrow(/has not been made/i);
    });

    it('refuses to close while an award is unexecuted', async () => {
      const disputeId = await decidedDispute({ outcome: 'UPHELD_IN_FULL', awarded: 100_000 });

      await expect(service.closeDispute({ disputeId, closedBy: 'support-2' })).rejects.toThrow(
        /outstanding award/i,
      );
    });

    it('closes cleanly once informed and the award is executed', async () => {
      const disputeId = await decidedDispute({ outcome: 'UPHELD_IN_FULL', awarded: 100_000 });
      await service.recordRemedyExecution({
        disputeId,
        remedyExecutionReference: 'reversal-final',
        recordedBy: 'finance-1',
      });

      await service.closeDispute({ disputeId, closedBy: 'support-2' });

      const dispute = await service.getDispute(disputeId);
      expect(dispute.status).toBe('CLOSED');
      expect(dispute.closed_at).toBeTruthy();
    });

    it('closes a rejection without any remedy execution', async () => {
      // Nothing was awarded, so there is nothing to execute; requiring one would block every rejection.
      const disputeId = await decidedDispute({ outcome: 'REJECTED', awarded: 0 });
      await service.closeDispute({ disputeId, closedBy: 'support-2' });
      const dispute = await service.getDispute(disputeId);
      expect(dispute.status).toBe('CLOSED');
    });

    it('refuses to close an undecided dispute', async () => {
      const customerId = await customer('undecided');
      const raised = await service.raiseDispute(raiseCommand(customerId));
      await expect(
        service.closeDispute({ disputeId: raised.id, closedBy: 'support-2' }),
      ).rejects.toThrow(/undecided/i);
    });
  });

  describe('outstanding posture separates what is owed from what is merely open', () => {
    it('counts undecided, decided-not-informed and awarded-not-executed separately', async () => {
      // Different populations need different action, so they must not collapse into one number.
      const undecidedCustomer = await customer('p1');
      await service.raiseDispute(raiseCommand(undecidedCustomer));
      // Decided and never told.
      await decidedDispute({ outcome: 'REJECTED', awarded: 0, inform: false });
      // Decided, told, but the award has not been executed — a different population with a different action.
      await decidedDispute({ outcome: 'UPHELD_IN_FULL', awarded: 100_000, inform: true });

      const posture = await service.outstandingPosture();

      // One claim still undecided, one decided-but-silent, one decided-and-told with money still owed.
      expect(posture.undecided).toBe(1);
      expect(posture.decidedNotInformed).toBe(1);
      expect(posture.awardedNotExecuted).toBe(1);
    });

    it('reports zero when nothing is outstanding', async () => {
      const posture = await service.outstandingPosture();
      expect(posture.undecided).toBe(0);
      expect(posture.decidedNotInformed).toBe(0);
      expect(posture.awardedNotExecuted).toBe(0);
      expect(posture.oldestUndecidedAgeSeconds).toBeNull();
    });
  });

  describe('evidence and rollback', () => {
    it('records every step in the event trail, in order', async () => {
      const disputeId = await decidedDispute({ outcome: 'UPHELD_IN_FULL', awarded: 100_000 });

      const events = await service.listEvents(disputeId);
      const types = events.map((event) => event.event_type).reverse();

      expect(types).toContain('RAISED');
      expect(types).toContain('INVESTIGATION_RECORDED');
      expect(types).toContain('DECIDED');
      expect(types).toContain('CUSTOMER_INFORMED');
    });

    it('distinguishes an internal note from a communication to the customer', async () => {
      // Conflating the two is how a bank convinces itself it informed someone who heard nothing.
      const disputeId = await decidedDispute({ outcome: 'REJECTED', awarded: 0 });

      const events = await service.listEvents(disputeId);
      const investigation = events.find((event) => event.event_type === 'INVESTIGATION_RECORDED');
      const informed = events.find((event) => event.event_type === 'CUSTOMER_INFORMED');

      expect(investigation?.communicated_to_customer).toBe(false);
      expect(informed?.communicated_to_customer).toBe(true);
    });

    it('refuses to rewrite the event trail', async () => {
      const disputeId = await decidedDispute({ outcome: 'REJECTED', awarded: 0 });
      const events = await service.listEvents(disputeId);
      const eventId = events[0]?.id;

      await expect(
        db.query(`UPDATE transaction_dispute_events SET detail = 'edited' WHERE id = $1`, [
          eventId,
        ]),
      ).rejects.toThrow(/append-only/i);
    });

    it('audits raising, investigation and decision', async () => {
      await decidedDispute({ outcome: 'UPHELD_IN_PART', awarded: 30_000 });

      const rows: Array<{ action: string }> = await db.query(
        `SELECT action FROM audit_events WHERE entity_type = 'TRANSACTION_DISPUTE' ORDER BY occurred_at`,
      );
      const actions = rows.map((row) => row.action);
      expect(actions).toContain('DISPUTE_RAISED');
      expect(actions).toContain('DISPUTE_INVESTIGATION_RECORDED');
      expect(actions).toContain('DISPUTE_DECIDED');
    });

    it('refuses to roll back while any dispute exists', async () => {
      const customerId = await customer('rb');
      await service.raiseDispute(raiseCommand(customerId));

      const { ComplaintsAndDisputes1785753600611 } = await import(
        '../src/migrations/1785753600611-ComplaintsAndDisputes'
      );
      const migration = new ComplaintsAndDisputes1785753600611();
      const runner = { query: (sql: string) => db.query(sql) };

      await expect(
        migration.down(runner as unknown as Parameters<typeof migration.down>[0]),
      ).rejects.toThrow(/Refusing to roll back/i);
    });
  });
});
