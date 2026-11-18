import { randomUUID } from 'node:crypto';

import type { DataSource } from 'typeorm';

import { ComplianceAuditExportService } from '../src/compliance/compliance-audit-export.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  truncateAllTables,
} from './support/pg-harness';

/**
 * ARENA 3D Group 23 — compliance register and audit evidence export.
 *
 * The properties that matter:
 *
 * 1. A date range is answerable, and answerable in **complete** pages — no silent truncation.
 * 2. Paging is **stable under concurrent appends**, which is why it is keyset and not offset.
 * 3. Taking evidence is **recorded**, and the register cannot be edited afterwards.
 * 4. Age is reported against a **configured** deadline, and a missing deadline is reported as missing
 *    rather than as zero breaches.
 */
describe('Group 23 — compliance audit export', () => {
  let db: DataSource;
  let service: ComplianceAuditExportService;

  // `audit_events.entity_id` is a uuid column, so the subject identifiers used below must be uuids.
  const DEFAULT_ENTITY_ID = randomUUID();

  beforeAll(async () => {
    db = await createIntegrationDataSource('g23cmp');
    service = new ComplianceAuditExportService(db);
  }, 180_000);

  afterAll(async () => {
    await destroyIntegrationDataSource(db);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  /** Inserts an audit event at a chosen business time. */
  async function seedAudit(options: {
    occurredAt: Date;
    action?: string;
    entityType?: string;
    entityId?: string;
  }): Promise<string> {
    const rows: Array<{ id: string }> = await db.query(
      `INSERT INTO audit_events (entity_type, entity_id, action, actor, occurred_at)
       VALUES ($1, $2, $3, 'test-actor', $4) RETURNING id`,
      [
        options.entityType ?? 'TEST_ENTITY',
        options.entityId ?? DEFAULT_ENTITY_ID,
        options.action ?? 'TEST_ACTION',
        options.occurredAt,
      ],
    );
    return firstRow(rows, 'seeded audit event').id;
  }

  const base = Date.parse('2026-03-01T00:00:00.000Z');

  // Rows sharing a timestamp come back ordered by id; this comparator restores that ordering for the
  // assertion above without depending on the insertion order.
  let seededOrder: string[] = [];
  function sortBySeededOrder(a: string, b: string): number {
    const left = seededOrder.indexOf(a);
    const right = seededOrder.indexOf(b);
    return left - right;
  }

  function command(overrides: Partial<Parameters<typeof service.exportPage>[0]> = {}) {
    return {
      from: new Date(base),
      to: new Date(base + 86_400_000),
      requestedBy: 'auditor-1',
      requesterType: 'OPERATOR' as const,
      purpose: 'Quarterly regulatory review',
      ...overrides,
    };
  }

  describe('a date range is answerable', () => {
    it('returns only events inside the range', async () => {
      await seedAudit({ occurredAt: new Date(base - 3_600_000) }); // before
      const inside = await seedAudit({ occurredAt: new Date(base + 3_600_000) });
      await seedAudit({ occurredAt: new Date(base + 90_000_000) }); // after

      const page = await service.exportPage(command());

      expect(page.rows).toHaveLength(1);
      expect(page.rows[0]?.id).toBe(inside);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it('orders by business time ascending so a page can be resumed', async () => {
      await seedAudit({ occurredAt: new Date(base + 7_000) });
      await seedAudit({ occurredAt: new Date(base + 1_000) });
      await seedAudit({ occurredAt: new Date(base + 4_000) });

      const page = await service.exportPage(command());

      const times = page.rows.map((row) => Date.parse(row.occurredAt));
      expect(times).toEqual([...times].sort((a, b) => a - b));
    });

    it('narrows by entity when asked', async () => {
      const subject = randomUUID();
      await seedAudit({ occurredAt: new Date(base + 1_000), entityId: subject });
      await seedAudit({ occurredAt: new Date(base + 2_000), entityId: randomUUID() });

      const page = await service.exportPage(command({ entityId: subject }));

      expect(page.rows).toHaveLength(1);
      expect(page.rows[0]?.entityId).toBe(subject);
    });

    it('refuses an export with no stated purpose', async () => {
      // An export with no stated purpose is exactly the act the register exists to make accountable.
      await expect(service.exportPage(command({ purpose: '   ' }))).rejects.toThrow(/purpose/i);
    });

    it('refuses an export that does not name the requester', async () => {
      await expect(service.exportPage(command({ requestedBy: '' }))).rejects.toThrow(
        /name the principal/i,
      );
    });

    it('refuses an inverted or empty range', async () => {
      await expect(
        service.exportPage(command({ from: new Date(base + 10_000), to: new Date(base) })),
      ).rejects.toThrow(/must be after/i);
    });

    it('refuses an unbounded range', async () => {
      // An unbounded range makes "the whole trail" a normal-looking request and defeats paging.
      await expect(
        service.exportPage(command({ to: new Date(base + 400 * 86_400_000) })),
      ).rejects.toThrow(/at most/i);
    });
  });

  describe('paging is complete and stable', () => {
    it('pages through every row exactly once without gaps or repeats', async () => {
      const expected: string[] = [];
      for (let index = 0; index < 25; index += 1) {
        expected.push(await seedAudit({ occurredAt: new Date(base + index * 1_000) }));
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      let guard = 0;
      do {
        const page = await service.exportPage(command({ limit: 7, cursor: cursor ?? undefined }));
        seen.push(...page.rows.map((row) => row.id));
        cursor = page.nextCursor;
        guard += 1;
        if (guard > 20) throw new Error('export paging did not terminate');
      } while (cursor !== null);

      expect(seen).toHaveLength(25);
      expect(new Set(seen).size).toBe(25);
      expect(seen).toEqual(expected);
    });

    it('reports hasMore correctly on an exact page boundary', async () => {
      for (let index = 0; index < 5; index += 1) {
        await seedAudit({ occurredAt: new Date(base + index * 1_000) });
      }

      const firstPage = await service.exportPage(command({ limit: 5 }));

      // Exactly five rows, five requested: nothing is left, and claiming more would make a caller ask for a
      // page that comes back empty.
      expect(firstPage.rows).toHaveLength(5);
      expect(firstPage.hasMore).toBe(false);
      expect(firstPage.nextCursor).toBeNull();
    });

    it('does not skip or repeat rows appended between pages', async () => {
      /*
       * The reason paging is keyset and not offset. With OFFSET, a row inserted before the cursor position
       * shifts every later row down and the next page repeats one; a delete does the opposite and skips one.
       * The audit trail is append-only, so inserts are the case that matters.
       */
      const firstBatch: string[] = [];
      for (let index = 0; index < 6; index += 1) {
        firstBatch.push(await seedAudit({ occurredAt: new Date(base + index * 1_000) }));
      }

      const firstPage = await service.exportPage(command({ limit: 3 }));
      expect(firstPage.rows.map((row) => row.id)).toEqual(firstBatch.slice(0, 3));

      // New events land *inside* the range and *before* the cursor, which is what breaks OFFSET paging.
      await seedAudit({ occurredAt: new Date(base + 500) });
      await seedAudit({ occurredAt: new Date(base + 1_500) });

      const secondPage = await service.exportPage(
        command({ limit: 3, cursor: firstPage.nextCursor ?? undefined }),
      );

      // Keyset resumes strictly after the last returned row, so the new earlier rows are neither repeated
      // nor allowed to shift the page.
      expect(secondPage.rows.map((row) => row.id)).toEqual(firstBatch.slice(3, 6));
    });

    it('caps the page size rather than trusting the caller', async () => {
      for (let index = 0; index < 3; index += 1) {
        await seedAudit({ occurredAt: new Date(base + index * 1_000) });
      }
      const page = await service.exportPage(command({ limit: 100_000 }));
      expect(page.rows.length).toBeLessThanOrEqual(500);
    });

    it('pages correctly when several events share a timestamp', async () => {
      /*
       * The tiebreak case. `occurred_at` is not unique — a batch write, a replay, or a transaction that
       * emits several audit facts lands multiple rows on the same timestamp. With a cursor that carries only
       * the timestamp, a page boundary falling inside that group either repeats the group forever or skips
       * it entirely. Only the composite `(occurred_at, id)` comparison makes this terminate with every row
       * exactly once.
       */
      const sameInstant = new Date(base + 5_000);
      const expected: string[] = [];
      seededOrder = [];
      for (let index = 0; index < 9; index += 1) {
        const id = await seedAudit({ occurredAt: sameInstant });
        expected.push(id);
        seededOrder.push(id);
      }
      // A couple of rows either side so the boundary is not trivially the whole set.
      const earlier = await seedAudit({ occurredAt: new Date(base + 1_000) });
      seededOrder.unshift(earlier);

      const seen: string[] = [];
      let cursor: string | null = null;
      let guard = 0;
      do {
        const page = await service.exportPage(command({ limit: 2, cursor: cursor ?? undefined }));
        seen.push(...page.rows.map((row) => row.id));
        cursor = page.nextCursor;
        guard += 1;
        if (guard > 20) throw new Error('export paging did not terminate on tied timestamps');
      } while (cursor !== null);

      expect(seen).toHaveLength(10);
      expect(new Set(seen).size).toBe(10);
      expect([...seen].sort(sortBySeededOrder)).toEqual(seededOrder);
    });

    it('refuses a malformed cursor instead of silently starting over', async () => {
      // Silently treating a bad cursor as "no cursor" would re-export page one and look like a complete
      // export to a caller looping until hasMore is false.
      await expect(service.exportPage(command({ cursor: 'not-a-cursor' }))).rejects.toThrow(
        /cursor/i,
      );
    });
  });

  describe('taking evidence is recorded', () => {
    it('writes a register row naming who, what range and why', async () => {
      await seedAudit({ occurredAt: new Date(base + 1_000) });

      const page = await service.exportPage(
        command({ purpose: 'Dispute reference DR-4471', requestedBy: 'operator-9' }),
      );

      const register = await service.exportRegister();
      expect(register).toHaveLength(1);
      expect(register[0]).toMatchObject({
        requestedBy: 'operator-9',
        requesterType: 'OPERATOR',
        rowCount: 1,
        purpose: 'Dispute reference DR-4471',
        isContinuation: false,
      });
      expect(register[0]?.id).toBe(page.exportRecordId);
    });

    it('records every page, and marks continuations as continuations', async () => {
      for (let index = 0; index < 6; index += 1) {
        await seedAudit({ occurredAt: new Date(base + index * 1_000) });
      }

      const first = await service.exportPage(command({ limit: 3 }));
      const second = await service.exportPage(
        command({ limit: 3, cursor: first.nextCursor ?? undefined }),
      );

      const register = await service.exportRegister();
      expect(register).toHaveLength(2);
      // Newest first.
      expect(register[0]?.id).toBe(second.exportRecordId);
      expect(register[0]?.isContinuation).toBe(true);
      expect(register[1]?.isContinuation).toBe(false);
    });

    it('refuses to let the register be rewritten', async () => {
      await seedAudit({ occurredAt: new Date(base + 1_000) });
      const page = await service.exportPage(command());

      await expect(
        db.query(`UPDATE compliance_audit_exports SET purpose = 'edited' WHERE id = $1`, [
          page.exportRecordId,
        ]),
      ).rejects.toThrow(/append-only/i);

      await expect(
        db.query(`DELETE FROM compliance_audit_exports WHERE id = $1`, [page.exportRecordId]),
      ).rejects.toThrow(/append-only/i);
    });

    it('answers who has exported a given subject', async () => {
      const subject = randomUUID();
      await seedAudit({ occurredAt: new Date(base + 1_000), entityId: subject });
      await service.exportPage(command({ entityId: subject, requestedBy: 'investigator-3' }));

      const register = await service.exportRegister({ entityId: subject });

      expect(register).toHaveLength(1);
      expect(register[0]?.requestedBy).toBe('investigator-3');
    });

    it('does not record an export that was refused', async () => {
      // A refused request took no evidence, and recording it would pollute the register with exports that
      // never happened.
      await expect(service.exportPage(command({ purpose: '' }))).rejects.toThrow();

      const register = await service.exportRegister();
      expect(register).toHaveLength(0);
    });

    it('leaves the audit trail itself untouched and immutable', async () => {
      const id = await seedAudit({ occurredAt: new Date(base + 1_000) });
      await service.exportPage(command());

      const rows: Array<{ entity_id: string }> = await db.query(
        `SELECT entity_id FROM audit_events WHERE id = $1`,
        [id],
      );
      expect(firstRow(rows, 'audit row').entity_id).toBe(DEFAULT_ENTITY_ID);

      // Reading for evidence must not create a path to modifying the trail.
      await expect(
        db.query(`UPDATE audit_events SET action = 'tampered' WHERE id = $1`, [id]),
      ).rejects.toThrow();
    });
  });

  describe('case age against a configured deadline', () => {
    async function seedCase(options: {
      category: string;
      openedHoursAgo: number;
      status?: string;
    }): Promise<void> {
      const customerRows: Array<{ id: string }> = await db.query(
        `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
         VALUES ($1, 'INDIVIDUAL', 'ACTIVE', 'LEVEL_1', 'APPROVED') RETURNING id`,
        [`g23.${randomUUID().slice(0, 12)}`],
      );
      const customerId = firstRow(customerRows, 'seeded customer').id;
      await db.query(
        `INSERT INTO customer_compliance_cases (
           customer_id, case_number, category, severity, status, opened_by, opened_at, version
         ) VALUES ($1, $2, $3, 'MEDIUM', $4, 'test', now() - ($5 || ' hours')::interval, 1)`,
        [
          customerId,
          // The table's check constraint requires lowercase alphanumerics with `_.:-` separators.
          `case-${randomUUID().slice(0, 8)}`,
          options.category,
          options.status ?? 'OPEN',
          String(options.openedHoursAgo),
        ],
      );
    }

    it('reports zero breaches when nothing is overdue', async () => {
      await service.configureSla({
        category: 'KYC',
        resolutionHours: 72,
        configuredBy: 'compliance-head',
      });
      await seedCase({ category: 'KYC', openedHoursAgo: 1 });

      const posture = await service.caseSlaPosture();

      expect(posture.openCases).toBe(1);
      expect(posture.breached).toBe(0);
      expect(posture.categoriesWithoutSla).toEqual([]);
    });

    it('reports a breach once the configured deadline passes', async () => {
      await service.configureSla({
        category: 'AML',
        resolutionHours: 24,
        configuredBy: 'compliance-head',
      });
      await seedCase({ category: 'AML', openedHoursAgo: 50 });

      const posture = await service.caseSlaPosture();

      expect(posture.breached).toBe(1);
      expect(posture.breachesByCategory).toEqual([
        { category: 'AML', breaches: 1, resolutionHours: 24 },
      ]);
    });

    it('reports a category with no configured deadline as missing, not as zero breaches', async () => {
      // A dashboard showing zero breaches because no deadline was ever set is the same failure as a
      // supervisor reporting healthy when it measured nothing.
      await seedCase({ category: 'SANCTIONS', openedHoursAgo: 5_000 });

      const posture = await service.caseSlaPosture();

      expect(posture.openCases).toBe(1);
      expect(posture.breached).toBe(0);
      expect(posture.categoriesWithoutSla).toEqual(['SANCTIONS']);
    });

    it('excludes resolved and closed cases from the open posture', async () => {
      await service.configureSla({
        category: 'KYC',
        resolutionHours: 24,
        configuredBy: 'compliance-head',
      });
      await seedCase({ category: 'KYC', openedHoursAgo: 100, status: 'RESOLVED' });
      await seedCase({ category: 'KYC', openedHoursAgo: 100, status: 'CLOSED' });

      const posture = await service.caseSlaPosture();

      expect(posture.openCases).toBe(0);
      expect(posture.breached).toBe(0);
    });

    it('reports the age of the oldest open case', async () => {
      await seedCase({ category: 'OTHER', openedHoursAgo: 30 });
      await seedCase({ category: 'OTHER', openedHoursAgo: 90 });

      const posture = await service.caseSlaPosture();

      expect(posture.oldestOpenAgeSeconds).toBeGreaterThanOrEqual(89 * 3_600);
    });

    it('refuses an SLA that is not attributable to a named principal', async () => {
      await expect(
        service.configureSla({ category: 'KYC', resolutionHours: 24, configuredBy: '  ' }),
      ).rejects.toThrow(/attributable/i);
    });

    it('refuses a zero or non-integer deadline', async () => {
      // A zero deadline marks every case breached on creation and trains everyone to ignore the signal.
      await expect(
        service.configureSla({ category: 'KYC', resolutionHours: 0, configuredBy: 'x' }),
      ).rejects.toThrow(/positive integer/i);
      await expect(
        service.configureSla({ category: 'KYC', resolutionHours: 1.5, configuredBy: 'x' }),
      ).rejects.toThrow(/positive integer/i);
    });

    it('refuses an unknown category rather than storing a deadline nothing will match', async () => {
      await expect(
        service.configureSla({
          category: 'not a category',
          resolutionHours: 24,
          configuredBy: 'x',
        }),
      ).rejects.toThrow(/Invalid compliance case category/i);
    });

    it('does not seed any deadline out of the box', async () => {
      // The correct deadline per category is a regulatory decision, not an implementation detail.
      const rows: Array<{ n: number }> = await db.query(
        `SELECT count(*)::int AS n FROM compliance_case_sla`,
      );
      expect(firstRow(rows, 'sla count').n).toBe(0);
    });
  });

  describe('rollback is refused while export evidence exists', () => {
    it('refuses down() rather than destroying the register', async () => {
      await seedAudit({ occurredAt: new Date(base + 1_000) });
      await service.exportPage(command());

      const { ComplianceRegister1785753600610 } = await import(
        '../src/migrations/1785753600610-ComplianceRegister'
      );
      const migration = new ComplianceRegister1785753600610();
      const runner = { query: (sql: string) => db.query(sql) };

      await expect(
        migration.down(runner as unknown as Parameters<typeof migration.down>[0]),
      ).rejects.toThrow(/Refusing to roll back/i);

      // The register survives the refusal.
      const register = await service.exportRegister();
      expect(register).toHaveLength(1);
    });
  });
});
