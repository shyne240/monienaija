import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ReconciliationService } from '../reconciliation/reconciliation.service';

export interface OperationalReportRow {
  [key: string]: unknown;
}

@Injectable()
export class OperationalReportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly reconciliationService: ReconciliationService,
  ) {}

  async dailySummary() {
    const [journals, transfers, deposits, withdrawals, audit, outbox] = await Promise.all([
      this.countSince('ledger_journals', 'created_at'),
      this.countSince('transfers', 'created_at'),
      this.countSince('deposits', 'created_at'),
      this.countSince('withdrawals', 'created_at'),
      this.countSince('audit_events', 'created_at'),
      this.countSince('outbox_events', 'created_at'),
    ]);
    return {
      date: new Date().toISOString().slice(0, 10),
      journals,
      transfers,
      deposits,
      withdrawals,
      auditEvents: audit,
      outboxEvents: outbox,
      generatedAt: new Date().toISOString(),
    };
  }

  ledgerSummary() {
    return this.rows(`
      SELECT currency, accounting_unit,
             COUNT(DISTINCT j.id)::text AS journal_count,
             COUNT(l.id)::text AS line_count,
             COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount_minor ELSE 0 END), 0)::text AS debits_minor,
             COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount_minor ELSE 0 END), 0)::text AS credits_minor
        FROM ledger_journals j
        LEFT JOIN ledger_lines l ON l.journal_id = j.id
       GROUP BY currency, accounting_unit
       ORDER BY currency, accounting_unit
    `);
  }

  walletSummary() {
    return this.rows(`
      SELECT currency, status, COUNT(*)::text AS wallet_count
        FROM wallet_accounts
       GROUP BY currency, status
       ORDER BY currency, status
    `);
  }

  transferSummary() {
    return this.statusSummary('transfers');
  }

  depositSummary() {
    return this.statusSummary('deposits');
  }

  withdrawalSummary() {
    return this.statusSummary('withdrawals');
  }

  reconciliationSummary() {
    return this.reconciliationService.runReconciliation();
  }

  outboxSummary() {
    return this.statusSummary('outbox_events');
  }

  auditSummary() {
    return this.rows(`
      SELECT action, entity_type, COUNT(*)::text AS event_count
        FROM audit_events
       GROUP BY action, entity_type
       ORDER BY entity_type, action
    `);
  }

  private async statusSummary(table: string): Promise<OperationalReportRow[]> {
    return this.rows(
      `SELECT status, COUNT(*)::text AS count FROM ${table} GROUP BY status ORDER BY status`,
    );
  }

  private async countSince(table: string, column: string): Promise<number> {
    const rows = await this.rows(
      `SELECT COUNT(*)::text AS count FROM ${table} WHERE ${column} >= CURRENT_DATE`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  private async rows(sql: string, parameters: unknown[] = []): Promise<OperationalReportRow[]> {
    const result: unknown = await this.dataSource.query(sql, parameters);
    return Array.isArray(result) ? result.filter((value) => this.isRow(value)) : [];
  }

  private isRow(value: unknown): value is OperationalReportRow {
    return typeof value === 'object' && value !== null;
  }
}
