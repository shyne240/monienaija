import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AuditService } from '../operations/audit.service';
import { exportFileName, neutralizeFormula, renderCsv } from './transaction-history-csv';

/**
 * CSV export of the unified Transaction History.
 *
 * ## It reads through the same query the list reads through
 *
 * The export does not have its own SELECT. It calls the exact `list()` the page calls, with the
 * exact filters the page applies (same `HISTORY_SQL`, same Lagos day boundaries, same keyset
 * contract, same institution predicate). An export that could see a row the screen cannot — or
 * miss a row the screen shows — would make the two disagree about money, so the shared path is the
 * point, not an optimisation.
 *
 * ## Every page is walked, and a short file is impossible
 *
 * The list is cursor-paginated. The export follows the cursor to exhaustion rather than taking the
 * first N rows, because a truncated export presented as a complete one is worse than no export.
 * Two independent guards make silent truncation impossible:
 *
 * 1. a hard row ceiling (`MAX_EXPORT_ROWS`) — exceeded means the request FAILS with an explicit
 *    "narrow your filters" answer and no file, it never returns a partial file;
 * 2. a page ceiling, so a misbehaving cursor cannot spin forever.
 *
 * A row is only emitted once per `type/id` key: if the data changes between pages such that the
 * cursor re-yields a row, the duplicate is dropped rather than written twice, and the drop is
 * recorded in the audit evidence.
 *
 * ## It cannot read more than the operator can read
 *
 * `list()` re-checks `transaction.view`, the principal type and the ACTIVE institution assignment
 * on every page, so an export is authorized exactly as strictly as the first list request. The
 * controller holds no second copy of that logic to drift out of sync.
 */
export interface TransactionHistoryExportQuery {
  readonly type?: string;
  readonly status?: string;
  readonly reference?: string;
  readonly from?: string;
  readonly to?: string;
}

/** The paging surface of the history controller, injected so this service cannot bypass it. */
export interface HistoryListPage {
  readonly items: Array<{
    readonly id: string;
    readonly type: string;
    readonly status: string;
    readonly reference: string;
    readonly createdAt: string | Date;
    readonly amountMinor: string;
    readonly feeMinor: string | null;
    readonly currency: string;
  }>;
  readonly nextCursor: string | null;
}

export interface HistoryListReader {
  list(
    request: { authorizationPrincipal?: AuthorizationPrincipal },
    query: Record<string, string>,
  ): Promise<HistoryListPage>;
}

/**
 * Largest supported export. Above this the operator is told to narrow the filters — the ceiling is
 * a deliberate product limit that is explained, not a silent cap.
 *
 * It is a constructor option as well as a default so a deployment can tune it from measured
 * capacity instead of editing the code; nothing may set it to "unlimited", because the guarantee
 * this module makes is that an over-size result is refused rather than truncated.
 */
export const MAX_EXPORT_ROWS = 50_000;

/**
 * Injection token for the export limits, so a deployment can tune the ceiling from measured
 * capacity without the service injecting a bare object into the Nest container.
 */
export const TRANSACTION_HISTORY_EXPORT_LIMITS = 'TRANSACTION_HISTORY_EXPORT_LIMITS';

/** Page size used while draining the cursor. Matches the list's maximum, so it is a supported call. */
export const EXPORT_PAGE_SIZE = 100;

export interface TransactionHistoryExport {
  readonly body: string;
  readonly fileName: string;
  readonly rowCount: number;
  readonly exportId: string;
  readonly duplicateSuppressed: number;
}

@Injectable()
export class TransactionHistoryExportService {
  private readonly logger = new Logger(TransactionHistoryExportService.name);

  private readonly maxRows: number;

  constructor(
    private readonly db: DataSource,
    private readonly audit: AuditService,
    @Optional()
    @Inject(TRANSACTION_HISTORY_EXPORT_LIMITS)
    limits?: { maxRows?: number },
  ) {
    const configured = limits?.maxRows ?? MAX_EXPORT_ROWS;
    if (!Number.isInteger(configured) || configured < 1) {
      throw new Error('Transaction history export maxRows must be a positive integer');
    }
    this.maxRows = configured;
  }

  /**
   * Normalises the four supported filters. Exported so the controller and the audit record can
   * never disagree about what was actually applied.
   */
  static appliedFilters(filters: TransactionHistoryExportQuery): Record<string, string> {
    const applied: Record<string, string> = {};
    for (const key of ['type', 'status', 'reference', 'from', 'to'] as const) {
      const value = filters[key];
      if (typeof value === 'string' && value.length > 0) applied[key] = value;
    }
    return applied;
  }

  /**
   * Runs the export and records the attempt.
   *
   * Every exit path — success, size refusal and unexpected failure — writes exactly one audit row.
   * A failed or refused attempt to take a copy of transaction data is still an attempt, so it is
   * recorded with its outcome rather than vanishing.
   */
  async export(
    reader: HistoryListReader,
    request: { authorizationPrincipal?: AuthorizationPrincipal },
    filters: TransactionHistoryExportQuery,
  ): Promise<TransactionHistoryExport> {
    const actor = request.authorizationPrincipal?.principalId;
    if (!actor)
      throw new BadRequestException('An export must name the principal that requested it');
    const applied = TransactionHistoryExportService.appliedFilters(filters);
    try {
      return await this.run(reader, request, applied, actor);
    } catch (error) {
      const sizeRefusal = error instanceof PayloadTooLargeException;
      await this.record(randomUUID(), actor, applied, {
        outcome: sizeRefusal ? 'REFUSED_SIZE_LIMIT' : 'FAILED',
        reason: sizeRefusal
          ? `Exceeded the ${this.maxRows} row supported export size`
          : error instanceof Error
            ? error.message.slice(0, 300)
            : 'Unknown export failure',
      });
      throw error;
    }
  }

  private async run(
    reader: HistoryListReader,
    request: { authorizationPrincipal?: AuthorizationPrincipal },
    applied: Record<string, string>,
    actor: string,
  ): Promise<TransactionHistoryExport> {
    const rows: HistoryListPage['items'] = [];
    const seen = new Set<string>();
    let duplicateSuppressed = 0;
    let cursor = '';
    let pages = 0;
    let rowCount = 0;

    for (;;) {
      const page = await reader.list(request, {
        ...applied,
        limit: String(EXPORT_PAGE_SIZE),
        cursor,
      });
      pages += 1;
      for (const row of page.items) {
        const key = `${row.type}/${row.id}`;
        if (seen.has(key)) {
          duplicateSuppressed += 1;
          continue;
        }
        seen.add(key);
        rows.push(row);
        rowCount += 1;
        if (rowCount > this.maxRows) {
          throw new PayloadTooLargeException(
            `This export matches more than ${this.maxRows.toLocaleString('en-NG')} transactions, ` +
              'which is above the supported export size. Narrow the date range or add a product, ' +
              'status or reference filter and export again. No file was produced.',
          );
        }
      }
      if (!page.nextCursor) break;
      if (page.nextCursor === cursor) {
        // A cursor that does not advance would duplicate rows forever. Fail loudly.
        throw new Error('Transaction history cursor did not advance during export');
      }
      cursor = page.nextCursor;
      /*
       * Defensive bound on cursor round-trips. With a well-behaved cursor the row ceiling above
       * trips first, so reaching this is itself a bug and must fail loudly rather than loop.
       */
      if (pages >= Math.ceil(this.maxRows / EXPORT_PAGE_SIZE) + 2) {
        throw new Error('Transaction history export exceeded its page bound');
      }
    }

    const fileName = exportFileName({
      from: applied.from,
      to: applied.to,
      type: applied.type,
    });
    const body = renderCsv(
      rows.map((row) => ({
        id: row.id,
        type: row.type,
        status: row.status,
        reference: row.reference,
        createdAt: typeof row.createdAt === 'string' ? row.createdAt : row.createdAt.toISOString(),
        amountMinor: row.amountMinor,
        feeMinor: row.feeMinor,
        currency: row.currency,
      })),
    );

    const exportId = randomUUID();
    await this.record(exportId, actor, applied, {
      outcome: 'SUCCEEDED',
      rowCount,
      duplicateSuppressed,
      pages,
      fileName,
    });

    return { body, fileName, rowCount: rows.length, exportId, duplicateSuppressed };
  }

  /**
   * Records one export attempt against the existing audit trail.
   *
   * The record is written after the read, so a row count is always the count that was actually
   * produced — never an intention.
   */
  async record(
    exportId: string,
    actor: string,
    applied: Record<string, string>,
    outcome: {
      outcome: 'SUCCEEDED' | 'REFUSED_SIZE_LIMIT' | 'FAILED';
      rowCount?: number;
      duplicateSuppressed?: number;
      pages?: number;
      fileName?: string;
      reason?: string;
    },
  ): Promise<void> {
    try {
      await this.db.transaction(async (manager) => {
        await this.audit.record(manager, {
          /*
           * `entity_id` is a uuid column. The export has no business entity, so the export's own
           * id is used: it is stable, unique and lets an overseer correlate the audit row with the
           * file an operator downloaded.
           */
          entityType: 'TRANSACTION_HISTORY_EXPORT',
          entityId: exportId,
          action: 'TRANSACTION_HISTORY_CSV_EXPORTED',
          actor: actor.slice(0, 160),
          newValues: {
            outcome: outcome.outcome,
            // The filters are echoed exactly as applied — an auditor can reproduce the export.
            filters: {
              type: applied.type ?? null,
              status: applied.status ?? null,
              /*
               * A reference is operator-supplied free text. It is neutralised here for the same
               * reason it is neutralised in the file: an audit viewer may itself export this row
               * to a spreadsheet.
               */
              reference: applied.reference ? neutralizeFormula(applied.reference) : null,
              from: applied.from ?? null,
              to: applied.to ?? null,
            },
            rowCount: outcome.rowCount ?? 0,
            duplicateSuppressed: outcome.duplicateSuppressed ?? 0,
            pages: outcome.pages ?? 0,
            fileName: outcome.fileName ?? null,
            reason: outcome.reason ?? null,
            format: 'CSV',
          },
        });
      });
    } catch (error) {
      /*
       * The audit trail is the reason this action is accountable. If it cannot be written, the
       * export must not be handed over silently as if it had been recorded.
       */
      this.logger.error('Transaction history export could not be recorded in the audit trail');
      throw error;
    }
  }
}
