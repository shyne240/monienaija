import { randomUUID } from 'node:crypto';

import type { DataSource } from 'typeorm';

import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import { ErasureService } from '../src/privacy/erasure.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  truncateAllTables,
} from './support/pg-harness';

/**
 * ARENA 3D Group 27 — privacy and retention.
 *
 * The properties under test:
 *
 * 1. **Erasure never touches the ledger.** It anonymises profile-shaped columns; financial records survive.
 * 2. **No policy means no erasure.** An unconfigured category is held and the gap is reported, not guessed at.
 * 3. **Refusing is a first-class outcome.** `HELD_UNDER_RETENTION` with a recorded basis, not a silent no-op.
 * 4. **An unverified claimant cannot erase a customer's data** — that would be a denial-of-service.
 */
describe('Group 27 — privacy and retention', () => {
  let db: DataSource;
  let service: ErasureService;

  beforeAll(async () => {
    db = await createIntegrationDataSource('g27priv');
    service = new ErasureService(db, new AuditService(db.getRepository(AuditEvent)));
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
      [`g27.${label}.${randomUUID().slice(0, 10)}`],
    );
    return firstRow(rows, 'seeded customer').id;
  }

  async function seedPersonalData(customerId: string): Promise<void> {
    await db.query(
      `INSERT INTO customer_profiles
         (customer_id, display_name, legal_name, first_name, last_name, date_of_birth)
       VALUES ($1, 'Ada Obi', 'Ada Ngozi Obi', 'Ada', 'Obi', '1990-04-02')`,
      [customerId],
    );
    await db.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value)
       VALUES ($1, 'PHONE', '+2348031234567', '+2348031234567')`,
      [customerId],
    );
    await db.query(
      `INSERT INTO customer_addresses (customer_id, type, line_one, city, state, country)
       VALUES ($1, 'RESIDENTIAL', '12 Marina Road', 'Lagos', 'Lagos', 'NG')`,
      [customerId],
    );
  }

  /** Brings a request to APPROVED. */
  async function approvedRequest(customerId: string, categories: string[]): Promise<string> {
    const raised = await service.raiseRequest({
      customerId,
      requestedCategories: categories,
      requestedByType: 'CUSTOMER',
      requestedById: 'customer-portal',
    });
    await service.recordVerification({
      requestId: raised.id,
      verifiedBy: 'support-1',
      evidence: 'Verified via registered phone OTP and account reference',
    });
    await service.approveRequest({
      requestId: raised.id,
      decidedBy: 'privacy-officer',
      basis: 'Verified request; no statutory retention applies to these categories.',
    });
    return raised.id;
  }

  describe('a request is a workflow, not a delete', () => {
    it('records a request and its categories', async () => {
      const customerId = await customer('raise');
      const raised = await service.raiseRequest({
        customerId,
        requestedCategories: ['PROFILE_IDENTITY', 'ADDRESSES'],
        requestedByType: 'CUSTOMER',
        requestedById: 'customer-portal',
      });

      const request = await service.getRequest(raised.id);
      expect(request.status).toBe('RECEIVED');
      expect(request.requestedCategories).toEqual(['PROFILE_IDENTITY', 'ADDRESSES']);
    });

    it('de-duplicates repeated categories in the request', async () => {
      const customerId = await customer('dedupe');
      const raised = await service.raiseRequest({
        customerId,
        requestedCategories: ['ADDRESSES', 'ADDRESSES', 'PROFILE_IDENTITY'],
        requestedByType: 'CUSTOMER',
        requestedById: 'customer-portal',
      });
      const request = await service.getRequest(raised.id);
      expect(request.requestedCategories).toHaveLength(2);
    });

    it('refuses a request with no categories', async () => {
      // "Erase everything" is not a request this system will guess at: it cannot know what the law permits.
      const customerId = await customer('nocat');
      await expect(
        service.raiseRequest({
          customerId,
          requestedCategories: [],
          requestedByType: 'CUSTOMER',
          requestedById: 'portal',
        }),
      ).rejects.toThrow(/name the categories/i);
    });

    it('refuses an unknown category rather than storing one that matches nothing', async () => {
      const customerId = await customer('badcat');
      await expect(
        service.raiseRequest({
          customerId,
          requestedCategories: ['EVERYTHING'],
          requestedByType: 'CUSTOMER',
          requestedById: 'portal',
        }),
      ).rejects.toThrow(/Unknown personal data category/i);
    });

    it('refuses a second live request for the same customer', async () => {
      // Two concurrent requests would each erase a subset and each report partial completion.
      const customerId = await customer('dup');
      await service.raiseRequest({
        customerId,
        requestedCategories: ['ADDRESSES'],
        requestedByType: 'CUSTOMER',
        requestedById: 'portal',
      });
      await expect(
        service.raiseRequest({
          customerId,
          requestedCategories: ['PROFILE_IDENTITY'],
          requestedByType: 'CUSTOMER',
          requestedById: 'portal',
        }),
      ).rejects.toThrow(/already has an open erasure request/i);
    });

    it('refuses approval before identity is verified', async () => {
      // An unverified request must not be able to erase a customer's data: that is a denial-of-service.
      const customerId = await customer('noverify');
      const raised = await service.raiseRequest({
        customerId,
        requestedCategories: ['ADDRESSES'],
        requestedByType: 'CUSTOMER',
        requestedById: 'portal',
      });

      await expect(
        service.approveRequest({
          requestId: raised.id,
          decidedBy: 'privacy-officer',
          basis: 'looks legitimate',
        }),
      ).rejects.toThrow(/before the claimant identity is verified/i);
    });

    it('refuses to execute a request that was never approved', async () => {
      const customerId = await customer('noexec');
      const raised = await service.raiseRequest({
        customerId,
        requestedCategories: ['ADDRESSES'],
        requestedByType: 'CUSTOMER',
        requestedById: 'portal',
      });

      await expect(
        service.executeErasure({ requestId: raised.id, executedBy: 'privacy-officer' }),
      ).rejects.toThrow(/approved request/i);
    });

    it('refuses to rewrite the requested categories after the fact', async () => {
      // Widening the list after approval would make the approval meaningless.
      const customerId = await customer('immut');
      const raised = await service.raiseRequest({
        customerId,
        requestedCategories: ['ADDRESSES'],
        requestedByType: 'CUSTOMER',
        requestedById: 'portal',
      });

      await expect(
        db.query(
          `UPDATE privacy_erasure_requests SET requested_categories = ARRAY['ADDRESSES','PROFILE_IDENTITY']
            WHERE id = $1`,
          [raised.id],
        ),
      ).rejects.toThrow(/immutable/i);
    });
  });

  describe('no policy means no erasure', () => {
    it('erases nothing when no retention policy is configured, and says so', async () => {
      /*
       * The critical safety property. The register starts empty, and with no policy row the executor must not
       * guess that a category is erasable — a seeded default would let this codebase start destroying real
       * customer data on the strength of an invented number.
       */
      const customerId = await customer('nopolicy');
      await seedPersonalData(customerId);
      const requestId = await approvedRequest(customerId, ['PROFILE_IDENTITY']);

      const result = await service.executeErasure({ requestId, executedBy: 'privacy-officer' });

      expect(result.status).toBe('HELD_UNDER_RETENTION');
      expect(result.erased).toHaveLength(0);
      expect(result.held[0]?.reason).toMatch(/No retention policy/i);

      // And the data is untouched.
      const rows: Array<{ display_name: string }> = await db.query(
        `SELECT display_name FROM customer_profiles WHERE customer_id = $1`,
        [customerId],
      );
      expect(firstRow(rows, 'profile').display_name).toBe('Ada Obi');
    });

    it('holds a category the policy marks not erasable, with the legal basis recorded', async () => {
      await service.configureRetentionPolicy({
        category: 'PROFILE_IDENTITY',
        erasable: false,
        minimumAgeDays: null,
        legalBasis:
          'AML record-keeping obligation; identity must be retained for the statutory period.',
        configuredBy: 'compliance-head',
      });

      const customerId = await customer('noterasable');
      await seedPersonalData(customerId);
      const requestId = await approvedRequest(customerId, ['PROFILE_IDENTITY']);

      const result = await service.executeErasure({ requestId, executedBy: 'privacy-officer' });

      expect(result.status).toBe('HELD_UNDER_RETENTION');
      expect(result.held[0]?.reason).toMatch(/AML record-keeping/i);

      const request = await service.getRequest(requestId);
      expect(request.status).toBe('HELD_UNDER_RETENTION');
      // The approval basis stays on the record; the *hold* reason lives with the held category, because the
      // two answer different questions.
      expect(JSON.stringify(request.heldCategories)).toMatch(/AML record-keeping/i);
    });

    it('refuses a retention policy with no legal basis', async () => {
      await expect(
        service.configureRetentionPolicy({
          category: 'ADDRESSES',
          erasable: true,
          minimumAgeDays: 0,
          legalBasis: '   ',
          configuredBy: 'someone',
        }),
      ).rejects.toThrow(/legal basis/i);
    });

    it('refuses a retention policy with no named owner', async () => {
      await expect(
        service.configureRetentionPolicy({
          category: 'ADDRESSES',
          erasable: true,
          minimumAgeDays: 0,
          legalBasis: 'x',
          configuredBy: '  ',
        }),
      ).rejects.toThrow(/named principal/i);
    });

    it('ships with no policies configured', async () => {
      const policies = await service.retentionPolicies();
      expect(policies).toEqual([]);
    });
  });

  describe('erasure anonymises, it does not delete', () => {
    it('anonymises profile identity and leaves the row in place', async () => {
      await service.configureRetentionPolicy({
        category: 'PROFILE_IDENTITY',
        erasable: true,
        minimumAgeDays: null,
        legalBasis:
          'No statutory retention applies to display identity once the customer is closed.',
        configuredBy: 'compliance-head',
      });

      const customerId = await customer('anon');
      await seedPersonalData(customerId);
      const requestId = await approvedRequest(customerId, ['PROFILE_IDENTITY']);

      const result = await service.executeErasure({ requestId, executedBy: 'privacy-officer' });

      expect(result.status).toBe('COMPLETED');
      const rows: Array<{
        display_name: string;
        first_name: string | null;
        legal_name: string | null;
      }> = await db.query(
        `SELECT display_name, first_name, legal_name FROM customer_profiles WHERE customer_id = $1`,
        [customerId],
      );
      const profile = firstRow(rows, 'profile');
      expect(profile.display_name).toBe('erased');
      expect(profile.first_name).toBeNull();
      expect(profile.legal_name).toBeNull();
      // The row survives: the customer's financial history still needs an owner.
      expect(rows).toHaveLength(1);
    });

    it('anonymises contact methods and addresses', async () => {
      for (const category of ['CONTACT_METHODS', 'ADDRESSES'] as const) {
        await service.configureRetentionPolicy({
          category,
          erasable: true,
          minimumAgeDays: null,
          legalBasis: 'No statutory retention applies.',
          configuredBy: 'compliance-head',
        });
      }

      const customerId = await customer('multi');
      await seedPersonalData(customerId);
      const requestId = await approvedRequest(customerId, ['CONTACT_METHODS', 'ADDRESSES']);

      const result = await service.executeErasure({ requestId, executedBy: 'privacy-officer' });

      expect(result.status).toBe('COMPLETED');
      const contacts: Array<{ value: string }> = await db.query(
        `SELECT value FROM customer_contact_methods WHERE customer_id = $1`,
        [customerId],
      );
      expect(firstRow(contacts, 'contact').value).toBe('erased');

      const addresses: Array<{ line_one: string; city: string }> = await db.query(
        `SELECT line_one, city FROM customer_addresses WHERE customer_id = $1`,
        [customerId],
      );
      expect(firstRow(addresses, 'address').line_one).toBe('erased');
      // city/state/country are NOT NULL, so they are replaced rather than nulled.
      expect(firstRow(addresses, 'address').city).toBe('erased');
    });

    it('never touches ledger records', async () => {
      /*
       * The safety boundary. Erasure reaches profile-shaped tables only; a routine that reached into the ledger
       * would either fail its immutability triggers or succeed because someone had relaxed them.
       */
      await service.configureRetentionPolicy({
        category: 'PROFILE_IDENTITY',
        erasable: true,
        minimumAgeDays: null,
        legalBasis: 'No statutory retention applies.',
        configuredBy: 'compliance-head',
      });

      const journalsBefore: Array<{ n: number }> = await db.query(
        `SELECT count(*)::int AS n FROM ledger_journals`,
      );

      const customerId = await customer('ledger');
      await seedPersonalData(customerId);
      const requestId = await approvedRequest(customerId, ['PROFILE_IDENTITY']);
      await service.executeErasure({ requestId, executedBy: 'privacy-officer' });

      const journalsAfter: Array<{ n: number }> = await db.query(
        `SELECT count(*)::int AS n FROM ledger_journals`,
      );
      expect(firstRow(journalsAfter, 'journals').n).toBe(firstRow(journalsBefore, 'journals').n);

      // The erasure service contains no statement that targets a ledger table. Asserted structurally against
      // the action log rather than by grep: what matters is that no action names one.
      const actions = await service.listActions(requestId);
      for (const action of actions) {
        expect(String(action.target)).not.toMatch(/ledger|journal|transfer/i);
      }
    });

    it('reports a category it cannot anonymise rather than pretending it did', async () => {
      // Beneficiary details, credentials and risk factors are deliberately unimplemented; the action log shows
      // zero rows affected, which is the honest answer.
      await service.configureRetentionPolicy({
        category: 'BENEFICIARY_DETAILS',
        erasable: true,
        minimumAgeDays: null,
        legalBasis: 'No statutory retention applies.',
        configuredBy: 'compliance-head',
      });

      const customerId = await customer('unimpl');
      const requestId = await approvedRequest(customerId, ['BENEFICIARY_DETAILS']);
      await service.executeErasure({ requestId, executedBy: 'privacy-officer' });

      const actions = await service.listActions(requestId);
      const action = firstRow(actions, 'action');
      expect(action.target).toMatch(/NOT_IMPLEMENTED/);
      expect(Number(action.rows_affected)).toBe(0);
    });

    it('reports partial completion when some categories are held', async () => {
      await service.configureRetentionPolicy({
        category: 'ADDRESSES',
        erasable: true,
        minimumAgeDays: null,
        legalBasis: 'No statutory retention applies.',
        configuredBy: 'compliance-head',
      });
      await service.configureRetentionPolicy({
        category: 'PROFILE_IDENTITY',
        erasable: false,
        minimumAgeDays: 1825,
        legalBasis: 'AML record-keeping obligation.',
        configuredBy: 'compliance-head',
      });

      const customerId = await customer('partial');
      await seedPersonalData(customerId);
      const requestId = await approvedRequest(customerId, ['ADDRESSES', 'PROFILE_IDENTITY']);

      const result = await service.executeErasure({ requestId, executedBy: 'privacy-officer' });

      expect(result.status).toBe('PARTIALLY_COMPLETED');
      expect(result.erased).toEqual(['ADDRESSES']);
      expect(result.held.map((entry) => entry.category)).toEqual(['PROFILE_IDENTITY']);

      const request = await service.getRequest(requestId);
      expect(request.erasedCategories).toEqual(['ADDRESSES']);
      // Partial completion leaves the request open for the held categories.
      expect(request.closedAt).toBeNull();
    });
  });

  describe('refusal is recorded, not silent', () => {
    it('rejects a request with a basis', async () => {
      const customerId = await customer('reject');
      const raised = await service.raiseRequest({
        customerId,
        requestedCategories: ['ADDRESSES'],
        requestedByType: 'CUSTOMER',
        requestedById: 'portal',
      });

      await service.rejectRequest({
        requestId: raised.id,
        decidedBy: 'privacy-officer',
        basis: 'Claimant identity could not be established against account records.',
      });

      const request = await service.getRequest(raised.id);
      expect(request.status).toBe('REJECTED');
      expect(request.decisionBasis).toMatch(/could not be established/i);
      expect(request.closedAt).not.toBeNull();
    });

    it('refuses a rejection with no basis', async () => {
      const customerId = await customer('rejectnobasis');
      const raised = await service.raiseRequest({
        customerId,
        requestedCategories: ['ADDRESSES'],
        requestedByType: 'CUSTOMER',
        requestedById: 'portal',
      });
      await expect(
        service.rejectRequest({ requestId: raised.id, decidedBy: 'officer', basis: '  ' }),
      ).rejects.toThrow(/basis/i);
    });
  });

  describe('the erasure record is evidence', () => {
    it('records what was done per category without recording what was erased', async () => {
      await service.configureRetentionPolicy({
        category: 'PROFILE_IDENTITY',
        erasable: true,
        minimumAgeDays: null,
        legalBasis: 'No statutory retention applies.',
        configuredBy: 'compliance-head',
      });
      const customerId = await customer('evidence');
      await seedPersonalData(customerId);
      const requestId = await approvedRequest(customerId, ['PROFILE_IDENTITY']);
      await service.executeErasure({ requestId, executedBy: 'privacy-officer' });

      const actions = await service.listActions(requestId);
      const erased = actions.find((action) => action.outcome === 'ERASED');
      expect(erased?.target).toBe('customer_profiles:ANONYMISED');
      expect(Number(erased?.rows_affected)).toBe(1);
      // An erasure log that kept a copy of what it erased would defeat the erasure.
      expect(JSON.stringify(actions)).not.toContain('Ada Obi');
      expect(JSON.stringify(actions)).not.toContain('2348031234567');
    });

    it('refuses to rewrite the action log', async () => {
      await service.configureRetentionPolicy({
        category: 'ADDRESSES',
        erasable: true,
        minimumAgeDays: null,
        legalBasis: 'No statutory retention applies.',
        configuredBy: 'compliance-head',
      });
      const customerId = await customer('immutablelog');
      await seedPersonalData(customerId);
      const requestId = await approvedRequest(customerId, ['ADDRESSES']);
      await service.executeErasure({ requestId, executedBy: 'privacy-officer' });

      await expect(
        db.query(`UPDATE privacy_erasure_actions SET rows_affected = 99 WHERE request_id = $1`, [
          requestId,
        ]),
      ).rejects.toThrow(/append-only/i);
    });

    it('refuses to delete a request', async () => {
      const customerId = await customer('nodel');
      const raised = await service.raiseRequest({
        customerId,
        requestedCategories: ['ADDRESSES'],
        requestedByType: 'CUSTOMER',
        requestedById: 'portal',
      });
      await expect(
        db.query(`DELETE FROM privacy_erasure_requests WHERE id = $1`, [raised.id]),
      ).rejects.toThrow(/cannot be deleted/i);
    });

    it('audits the request, verification, approval and execution', async () => {
      await service.configureRetentionPolicy({
        category: 'ADDRESSES',
        erasable: true,
        minimumAgeDays: null,
        legalBasis: 'No statutory retention applies.',
        configuredBy: 'compliance-head',
      });
      const customerId = await customer('audit');
      await seedPersonalData(customerId);
      const requestId = await approvedRequest(customerId, ['ADDRESSES']);
      await service.executeErasure({ requestId, executedBy: 'privacy-officer' });

      const rows: Array<{ action: string }> = await db.query(
        `SELECT action FROM audit_events WHERE entity_type = 'PRIVACY_ERASURE_REQUEST' ORDER BY occurred_at`,
      );
      const actions = rows.map((row) => row.action);
      expect(actions).toContain('ERASURE_REQUESTED');
      expect(actions).toContain('ERASURE_REQUEST_VERIFIED');
      expect(actions).toContain('ERASURE_REQUEST_APPROVED');
      expect(actions).toContain('ERASURE_EXECUTED');
    });
  });

  describe('outstanding posture', () => {
    it('counts open requests and approved-but-unexecuted separately', async () => {
      const customerA = await customer('p1');
      const customerB = await customer('p2');
      await service.raiseRequest({
        customerId: customerA,
        requestedCategories: ['ADDRESSES'],
        requestedByType: 'CUSTOMER',
        requestedById: 'portal',
      });
      await approvedRequest(customerB, ['ADDRESSES']);

      const posture = await service.outstandingPosture();

      expect(posture.open).toBe(2);
      expect(posture.approvedNotExecuted).toBe(1);
      expect(posture.oldestOpenAgeSeconds).not.toBeNull();
    });

    it('reports zero when nothing is outstanding', async () => {
      const posture = await service.outstandingPosture();
      expect(posture.open).toBe(0);
      expect(posture.oldestOpenAgeSeconds).toBeNull();
    });
  });

  describe('rollback is refused while requests exist', () => {
    it('refuses down() rather than destroying the only record of what was erased', async () => {
      const customerId = await customer('rb');
      await service.raiseRequest({
        customerId,
        requestedCategories: ['ADDRESSES'],
        requestedByType: 'CUSTOMER',
        requestedById: 'portal',
      });

      const { PrivacyAndRetention1785753600614 } = await import(
        '../src/migrations/1785753600614-PrivacyAndRetention'
      );
      const migration = new PrivacyAndRetention1785753600614();
      const runner = { query: (sql: string) => db.query(sql) };

      await expect(
        migration.down(runner as unknown as Parameters<typeof migration.down>[0]),
      ).rejects.toThrow(/Refusing to roll back/i);
    });
  });
});
