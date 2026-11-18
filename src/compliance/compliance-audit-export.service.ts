import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * ARENA 3D Group 23 — audit evidence export.
 *
 * ## The question this answers
 *
 * "Show me everything that happened between these two dates" — the request an auditor, a regulator or a
 * dispute handler actually makes. `AuditService.list()` has no date bound, caps at 1,000 rows, and hides
 * several record categories by default, so it cannot answer that question at all.
 *
 * ## Why pages and a cursor rather than one big read
 *
 * The audit trail is append-only and grows without bound. A single response is impossible, and a silently
 * truncated one is worse than impossible — it would be a partial record presented as a complete one. So
 * the export is a **keyset page** ordered by `(occurred_at, id)`, resumable from a cursor, with a hard row
 * cap per page and an explicit `hasMore`. Because the trail is append-only, the same cursor over the same
 * range returns the same rows: the page is reproducible, which is what makes it usable as evidence.
 *
 * Keyset and not `OFFSET`: offset paging over a table that is being appended to will skip or repeat rows
 * as new events land between pages, and an evidence export that silently skips events is exactly the
 * failure this must not have.
 *
 * ## Every page is registered
 *
 * Taking a copy of the audit trail is itself a security-relevant act. Each page writes a row to
 * `compliance_audit_exports` recording who, over what range, with which cursor, how many rows, and for
 * what stated purpose. The register is append-only. A session that stopped after page 2 is therefore
 * visibly incomplete rather than indistinguishable from a finished export.
 *
 * ## This service does not decide who may export
 *
 * Authorization is the caller's job — the controller or job that invokes this must have established an
 * approved grant. What this service enforces is that the act is *recorded*, exactly and irreversibly. It
 * deliberately accepts `requestedBy` and `requesterType` rather than inferring them, so the register can
 * never claim an anonymous export.
 */

/** One page of audit evidence. */
export interface AuditExportPage {
  readonly rows: AuditExportRow[];
  /** Cursor to pass as `cursor` for the next page. Null when there is nothing more. */
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  /** The register row recording this page. */
  readonly exportRecordId: string;
}

export interface AuditExportRow {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly action: string;
  readonly actor: string;
  readonly correlationId: string | null;
  readonly requestId: string | null;
  readonly occurredAt: string;
}

export interface AuditExportCommand {
  /** Inclusive lower bound. Required: an open start would scan the whole table. */
  readonly from: Date;
  /** Exclusive upper bound. Required: "everything ever" is not an evidence page. */
  readonly to: Date;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly cursor?: string;
  /** Caller-established identity. Never inferred. */
  readonly requestedBy: string;
  readonly requesterType: 'OPERATOR' | 'SUPPORT' | 'SERVICE' | 'PRIVILEGED';
  /** Stated business reason. Required and recorded. */
  readonly purpose: string;
  /** Page size. Capped. */
  readonly limit?: number;
}

/** Hard cap on one page. Not a tunable: a page is meant to be resumable, not complete. */
const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 200;

/** Longest range one export request may cover. */
const MAX_RANGE_DAYS = 366;

interface ExportRowShape {
  readonly id: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly action: string;
  readonly actor: string;
  readonly correlation_id: string | null;
  readonly request_id: string | null;
  readonly occurred_at: Date | string;
}

@Injectable()
export class ComplianceAuditExportService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Returns one page of audit evidence and records the export.
   *
   * The page read and the register write happen in one transaction: an export that happened but was not
   * recorded is precisely the gap this exists to close.
   */
  async exportPage(command: AuditExportCommand): Promise<AuditExportPage> {
    const from = command.from;
    const to = command.to;
    this.assertRange(from, to);
    const purpose = (command.purpose ?? '').trim();
    if (purpose.length === 0) {
      throw new BadRequestException('An audit export must state its purpose');
    }
    const requestedBy = (command.requestedBy ?? '').trim();
    if (requestedBy.length === 0) {
      throw new BadRequestException('An audit export must name the principal that requested it');
    }

    const cursor = command.cursor ? this.parseCursor(command.cursor) : null;
    const limit = Math.min(Math.max(command.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

    return this.dataSource.transaction(async (manager) => {
      /*
       * Fetch one row beyond the page so `hasMore` is known without a second count query. A count over a
       * range would itself be a scan of the trail, which the caller may not be entitled to.
       */
      const params: unknown[] = [from, to];
      const conditions = ['occurred_at >= $1', 'occurred_at < $2'];
      if (cursor) {
        /*
         * Keyset comparison on the composite order. Written as a row comparison rather than
         * `(occurred_at > $x OR (occurred_at = $x AND id > $y))` because the row form is what PostgreSQL
         * can use as an index range condition on `(occurred_at, id)`; the OR form typically is not.
         */
        params.push(cursor.occurredAt, cursor.id);
        conditions.push(`(occurred_at, id) > ($${params.length - 1}, $${params.length})`);
      }
      if (command.entityType) {
        params.push(command.entityType.trim().toUpperCase());
        conditions.push(`entity_type = $${params.length}`);
      }
      if (command.entityId) {
        params.push(command.entityId.trim());
        conditions.push(`entity_id = $${params.length}`);
      }
      params.push(limit + 1);

      const result: unknown = await manager.query(
        `SELECT id, entity_type, entity_id, action, actor, correlation_id, request_id, occurred_at
           FROM audit_events
          WHERE ${conditions.join(' AND ')}
          ORDER BY occurred_at ASC, id ASC
          LIMIT $${params.length}`,
        params,
      );

      const fetched = this.rowsOf<ExportRowShape>(result);
      const hasMore = fetched.length > limit;
      const pageRows = hasMore ? fetched.slice(0, limit) : fetched;

      if (pageRows.length > 0 && pageRows.length < limit && hasMore) {
        // Defensive: sliced below the page size while more rows exist cannot happen with the +1 fetch, and
        // if it ever does the export would be silently short.
        throw new Error('audit export page computed an inconsistent length');
      }

      const first = pageRows[0];
      const last = pageRows[pageRows.length - 1];

      const registerResult: unknown = await manager.query(
        `INSERT INTO compliance_audit_exports (
           requested_by, requester_type, range_start, range_end, entity_type, entity_id,
           cursor_occurred_at, cursor_id, row_count, first_occurred_at, last_occurred_at, purpose
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [
          requestedBy.slice(0, 160),
          command.requesterType,
          from,
          to,
          command.entityType ? command.entityType.trim().toUpperCase() : null,
          command.entityId ? command.entityId.trim() : null,
          cursor ? cursor.occurredAt : null,
          cursor ? cursor.id : null,
          pageRows.length,
          first ? new Date(first.occurred_at) : null,
          last ? new Date(last.occurred_at) : null,
          purpose.slice(0, 500),
        ],
      );
      const exportRecordId = this.rowsOf<{ id: string }>(registerResult)[0]?.id;
      if (!exportRecordId) throw new Error('compliance_audit_exports insert returned no id');

      /*
       * The next cursor is the last returned row. Null when the page came back short or exactly full with
       * nothing beyond it — in both cases there is nothing to resume.
       */
      const nextCursor =
        hasMore && last ? this.formatCursor(new Date(last.occurred_at), last.id) : null;

      return {
        rows: pageRows.map((row) => ({
          id: row.id,
          entityType: row.entity_type,
          entityId: row.entity_id,
          action: row.action,
          actor: row.actor,
          correlationId: row.correlation_id,
          requestId: row.request_id,
          occurredAt: new Date(row.occurred_at).toISOString(),
        })),
        nextCursor,
        hasMore,
        exportRecordId: String(exportRecordId),
      };
    });
  }

  /**
   * What has been exported, and how complete each attempt was.
   *
   * Deliberately reports pages rather than sessions: the system cannot know whether a caller intended to
   * continue, and claiming a session was complete when it may not have been would be worse than reporting
   * the individual pages.
   */
  async exportRegister(
    options: {
      entityType?: string;
      entityId?: string;
      limit?: number;
    } = {},
  ): Promise<
    Array<{
      id: string;
      requestedBy: string;
      requesterType: string;
      rangeStart: string;
      rangeEnd: string;
      rowCount: number;
      purpose: string;
      requestedAt: string;
      isContinuation: boolean;
    }>
  > {
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (options.entityType) {
      params.push(options.entityType.trim().toUpperCase());
      conditions.push(`entity_type = $${params.length}`);
    }
    if (options.entityId) {
      params.push(options.entityId.trim());
      conditions.push(`entity_id = $${params.length}`);
    }
    params.push(Math.min(Math.max(options.limit ?? 100, 1), 500));

    const result: unknown = await this.dataSource.query(
      `SELECT id, requested_by, requester_type, range_start, range_end, row_count, purpose,
              requested_at, cursor_id
         FROM compliance_audit_exports
        ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY requested_at DESC
        LIMIT $${params.length}`,
      params,
    );

    return this.rowsOf<{
      id: string;
      requested_by: string;
      requester_type: string;
      range_start: Date | string;
      range_end: Date | string;
      row_count: number;
      purpose: string;
      requested_at: Date | string;
      cursor_id: string | null;
    }>(result).map((row) => ({
      id: row.id,
      requestedBy: row.requested_by,
      requesterType: row.requester_type,
      rangeStart: new Date(row.range_start).toISOString(),
      rangeEnd: new Date(row.range_end).toISOString(),
      rowCount: Number(row.row_count),
      purpose: row.purpose,
      requestedAt: new Date(row.requested_at).toISOString(),
      isContinuation: row.cursor_id !== null,
    }));
  }

  /**
   * Case ages against the configured SLA, and which categories have no configured deadline.
   *
   * `categoriesWithoutSla` is reported rather than omitted. A compliance dashboard that quietly shows zero
   * breaches because no deadline was ever configured is the same failure as a supervisor reporting healthy
   * when it measured nothing.
   */
  async caseSlaPosture(now = new Date()): Promise<{
    openCases: number;
    breached: number;
    oldestOpenAgeSeconds: number | null;
    categoriesWithoutSla: string[];
    breachesByCategory: Array<{ category: string; breaches: number; resolutionHours: number }>;
  }> {
    const rows: unknown = await this.dataSource.query(
      `SELECT c.category,
              s.resolution_hours,
              count(*)::int AS open_cases,
              count(*) FILTER (
                WHERE now() - c.opened_at > (s.resolution_hours || ' hours')::interval
              )::int AS breaches,
              min(c.opened_at) AS oldest
         FROM customer_compliance_cases c
         LEFT JOIN compliance_case_sla s ON s.category = c.category
        WHERE c.status NOT IN ('RESOLVED', 'CLOSED')
        GROUP BY c.category, s.resolution_hours
        ORDER BY c.category`,
    );

    const openCases = this.rowsOf<{
      category: string;
      resolution_hours: number | null;
      open_cases: number;
      breaches: number;
      oldest: Date | string | null;
    }>(rows);

    let totalOpen = 0;
    let totalBreached = 0;
    let oldestOpen: Date | null = null;
    const categoriesWithoutSla: string[] = [];
    const breachesByCategory: Array<{
      category: string;
      breaches: number;
      resolutionHours: number;
    }> = [];

    for (const row of openCases) {
      totalOpen += Number(row.open_cases);
      if (row.resolution_hours === null) {
        categoriesWithoutSla.push(row.category);
      } else {
        totalBreached += Number(row.breaches);
        breachesByCategory.push({
          category: row.category,
          breaches: Number(row.breaches),
          resolutionHours: Number(row.resolution_hours),
        });
      }
      if (row.oldest) {
        const opened = new Date(row.oldest);
        if (!oldestOpen || opened < oldestOpen) oldestOpen = opened;
      }
    }

    return {
      openCases: totalOpen,
      breached: totalBreached,
      oldestOpenAgeSeconds: oldestOpen
        ? Math.max(0, Math.floor((now.getTime() - oldestOpen.getTime()) / 1000))
        : null,
      categoriesWithoutSla,
      breachesByCategory,
    };
  }

  /** Configures or replaces the deadline for a case category. */
  async configureSla(command: {
    category: string;
    resolutionHours: number;
    configuredBy: string;
    notes?: string;
  }): Promise<void> {
    const category = (command.category ?? '').trim().toUpperCase();
    if (!/^[A-Z_]{2,30}$/.test(category)) {
      throw new BadRequestException('Invalid compliance case category');
    }
    if (!Number.isInteger(command.resolutionHours) || command.resolutionHours <= 0) {
      throw new BadRequestException('Resolution hours must be a positive integer');
    }
    const configuredBy = (command.configuredBy ?? '').trim();
    if (configuredBy.length === 0) {
      throw new BadRequestException('An SLA must be attributable to a named principal');
    }

    await this.dataSource.query(
      `INSERT INTO compliance_case_sla (category, resolution_hours, configured_by, notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (category) DO UPDATE
         SET resolution_hours = EXCLUDED.resolution_hours,
             configured_by = EXCLUDED.configured_by,
             configured_at = now(),
             notes = EXCLUDED.notes`,
      [
        category,
        command.resolutionHours,
        configuredBy.slice(0, 160),
        command.notes?.slice(0, 500) ?? null,
      ],
    );
  }

  // ---------------------------------------------------------------------------------------------

  private assertRange(from: Date, to: Date): void {
    if (!(from instanceof Date) || Number.isNaN(from.getTime())) {
      throw new BadRequestException('An audit export requires a valid start time');
    }
    if (!(to instanceof Date) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('An audit export requires a valid end time');
    }
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException('An audit export end must be after its start');
    }
    /*
     * Bounded because an unbounded range defeats the purpose of paging: it turns every page into a scan of
     * a rapidly growing slice and makes "the whole trail" a normal-looking request.
     */
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (days > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `An audit export may cover at most ${MAX_RANGE_DAYS} days; split the range`,
      );
    }
  }

  private formatCursor(occurredAt: Date, id: string): string {
    return Buffer.from(`${occurredAt.toISOString()}|${id}`, 'utf8').toString('base64url');
  }

  private parseCursor(cursor: string): { occurredAt: Date; id: string } {
    let decoded: string;
    try {
      decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    } catch {
      throw new BadRequestException('Invalid audit export cursor');
    }
    const separator = decoded.lastIndexOf('|');
    if (separator <= 0) throw new BadRequestException('Invalid audit export cursor');
    const occurredAt = new Date(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    if (Number.isNaN(occurredAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) {
      throw new BadRequestException('Invalid audit export cursor');
    }
    return { occurredAt, id };
  }

  private rowsOf<T>(result: unknown): T[] {
    if (!Array.isArray(result)) return [];
    const first: unknown = result[0];
    const second: unknown = result[1];
    if (result.length === 2 && Array.isArray(first) && !Array.isArray(second)) return first as T[];
    return result as T[];
  }
}
