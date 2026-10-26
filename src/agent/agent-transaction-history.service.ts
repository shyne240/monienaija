/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * V1-AGENT-HISTORY-01 — unified agent transaction history (read-side projection only).
 *
 * Purpose-built mirror of CustomerTransactionHistoryService (the established V1 pattern):
 * the SAME output contract, pagination shape, global merge-order (created_at DESC, id DESC) and
 * safe-projection discipline, projected from the authoritative records the agent participates in:
 *
 *   CASH_IN        (Cash→Wallet)   — agent float debited; ledger journal `canonicalService='CASH_IN'`
 *   CASH_OUT       (Wallet→Cash)   — agent float credited; ledger journal `canonicalService='CASH_OUT'`
 *   CASH_TO_CASH                    — one row per cash_to_cash_transfers record the agent INITIATED;
 *                                     the row's authoritative status carries the lifecycle
 *                                     (UNCLAIMED → CLAIMED / EXPIRED), initiation/claim/expiry
 *                                     journals are ledger facts behind it, never re-interpreted here
 *   AGENT_FUNDING  / AGENT_DEFUNDING — funding journals (`metadata.direction` FUND/DEFUND)
 *
 * Isolation is enforced AT THE QUERY BOUNDARY: every query is filtered by the caller's own
 * wallet ledger accounts / agent_id — nothing is fetched for other agents and filtered afterwards.
 *
 * Commercial information: when a commercial decision snapshot exists for a history item's journal
 * (principal = this agent), the agent's OWN commission allocation (sum of allocations whose
 * beneficiaryId is this agent) is exposed read-only. No commission calculation, no second system.
 *
 * This service never mutates anything: pure SELECTs, read-only projection, safe fields only
 * (no journal internals, no request hashes, no PIN/OTP/hash material).
 */

const VALID_TYPES = new Set(['CASH_IN', 'CASH_OUT', 'CASH_TO_CASH', 'AGENT_FUNDING', 'AGENT_DEFUNDING']);

export interface AgentUnifiedHistoryQuery {
  agentId: string;
  page?: string | number;
  limit?: string | number;
  type?: string;
}

export interface AgentHistoryCommission {
  commissionMinor: string;
  payable: boolean;
  treatment: string | null;
}

export interface AgentUnifiedHistoryItem {
  id: string;
  type: string;
  status: string;
  amountMinor: string;
  currency: string;
  direction: string;
  createdAt: Date;
  completedAt: Date | null;
  reference: string | null;
  narration: string | null;
  feeMinor: string;
  counterparty: any | null;
  commission: AgentHistoryCommission | null;
  failureCode: string | null;
  failureMessage: string | null;
}

@Injectable()
export class AgentTransactionHistoryService {
  constructor(private readonly dataSource: DataSource) {}

  async listUnified(
    query: AgentUnifiedHistoryQuery,
  ): Promise<{ items: AgentUnifiedHistoryItem[]; pagination: any }> {
    const agentId = String(query.agentId).trim();
    if (!agentId) throw new BadRequestException('agentId is required');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentId)) {
      throw new BadRequestException('agentId must be a UUID');
    }
    const p = typeof (query.page ?? '1') === 'string' ? parseInt(String(query.page ?? '1'), 10) : Number(query.page);
    const l = typeof (query.limit ?? '20') === 'string' ? parseInt(String(query.limit ?? '20'), 10) : Number(query.limit);
    const normalizedPage = Number.isSafeInteger(p) && p >= 1 ? p : 1;
    const normalizedLimit = Number.isSafeInteger(l) && l >= 1 && l <= 100 ? l : 20;
    if (query.type !== undefined && query.type !== null && String(query.type).trim() !== '') {
      const t = String(query.type).trim();
      if (!VALID_TYPES.has(t)) {
        throw new BadRequestException(`type must be one of ${Array.from(VALID_TYPES).join(',')}`);
      }
    }
    const typeFilter: string | null = query.type ? String(query.type).trim() : null;
    const shouldInclude = (t: string) => !typeFilter || typeFilter === t;

    // Agent wallet ledger accounts (wallet.customerId === agent.id — the established binding).
    const walletRows: Array<{ id: string; ledger_account_id: string }> = await this.dataSource.query(
      `SELECT id, ledger_account_id FROM wallet_accounts WHERE customer_id=$1`,
      [agentId],
    );
    const ledgerAccountIds = walletRows.map((r) => r.ledger_account_id).filter(Boolean);

    const includeCashLedger = shouldInclude('CASH_IN') || shouldInclude('CASH_OUT');
    const includeFunding = shouldInclude('AGENT_FUNDING') || shouldInclude('AGENT_DEFUNDING');
    const ledgerWanted = (includeCashLedger || includeFunding) && ledgerAccountIds.length > 0;

    const cashServices: string[] = [];
    if (shouldInclude('CASH_IN')) cashServices.push('CASH_IN');
    if (shouldInclude('CASH_OUT')) cashServices.push('CASH_OUT');
    const fundingDirections: string[] = [];
    if (shouldInclude('AGENT_FUNDING')) fundingDirections.push('FUND');
    if (shouldInclude('AGENT_DEFUNDING')) fundingDirections.push('DEFUND');

    // ————— counts (same shape as the customer service: deterministic total across types) —————
    let total = 0;
    if (ledgerWanted) {
      if (cashServices.length > 0) {
        const rows: Array<{ count: string }> = await this.dataSource.query(
          `SELECT count(DISTINCT lj.id)::text AS count
           FROM ledger_journals lj
           JOIN ledger_lines ll ON ll.journal_id = lj.id
           WHERE ll.ledger_account_id = ANY($1::uuid[])
             AND lj.metadata->>'canonicalService' = ANY($2)`,
          [ledgerAccountIds, cashServices],
        );
        total += Number(rows[0]?.count ?? '0');
      }
      if (fundingDirections.length > 0) {
        const rows: Array<{ count: string }> = await this.dataSource.query(
          `SELECT count(DISTINCT lj.id)::text AS count
           FROM ledger_journals lj
           JOIN ledger_lines ll ON ll.journal_id = lj.id
           WHERE ll.ledger_account_id = ANY($1::uuid[])
             AND lj.metadata->>'direction' = ANY($2)
             AND lj.metadata->>'agentId' = $3`,
          [ledgerAccountIds, fundingDirections, agentId],
        );
        total += Number(rows[0]?.count ?? '0');
      }
    }
    if (shouldInclude('CASH_TO_CASH')) {
      const rows: Array<{ count: string }> = await this.dataSource.query(
        `SELECT count(*)::text AS count FROM cash_to_cash_transfers WHERE agent_id=$1`,
        [agentId],
      );
      total += Number(rows[0]?.count ?? '0');
    }

    const totalPages = total === 0 ? 0 : Math.ceil(total / normalizedLimit);
    const offset = (normalizedPage - 1) * normalizedLimit;
    if (total === 0 || offset >= total) {
      return {
        items: [],
        pagination: { page: normalizedPage, limit: normalizedLimit, total, totalPages, hasNextPage: false },
      };
    }

    // ————— bounded per-agent fetch, then global sort + slice (established customer-history shape) —————
    const allRows: Array<any> = [];

    if (ledgerWanted && cashServices.length > 0) {
      const rows: Array<any> = await this.dataSource.query(
        `SELECT DISTINCT ON (lj.id) lj.id::text AS id,
                (lj.metadata->>'canonicalService')::text AS type,
                'COMPLETED'::text AS status,
                ll.amount_minor::text AS amount_minor,
                lj.currency::text AS currency,
                lj.created_at AS created_at,
                lj.created_at AS completed_at,
                lj.reference::text AS reference,
                lj.description::text AS narration,
                '0'::text AS fee_minor
         FROM ledger_journals lj
         JOIN ledger_lines ll ON ll.journal_id = lj.id
         WHERE ll.ledger_account_id = ANY($1::uuid[])
           AND lj.metadata->>'canonicalService' = ANY($2)
         ORDER BY lj.id, lj.created_at DESC`,
        [ledgerAccountIds, cashServices],
      );
      allRows.push(...rows);
    }
    if (ledgerWanted && fundingDirections.length > 0) {
      const rows: Array<any> = await this.dataSource.query(
        `SELECT DISTINCT ON (lj.id) lj.id::text AS id,
                CASE lj.metadata->>'direction' WHEN 'FUND' THEN 'AGENT_FUNDING' ELSE 'AGENT_DEFUNDING' END AS type,
                'COMPLETED'::text AS status,
                ll.amount_minor::text AS amount_minor,
                lj.currency::text AS currency,
                lj.created_at AS created_at,
                lj.created_at AS completed_at,
                lj.reference::text AS reference,
                lj.description::text AS narration,
                '0'::text AS fee_minor,
                (lj.metadata->>'isAggregatorFunding')::text AS is_aggregator_funding,
                (lj.metadata->>'aggregatorId')::text AS aggregator_id
         FROM ledger_journals lj
         JOIN ledger_lines ll ON ll.journal_id = lj.id
         WHERE ll.ledger_account_id = ANY($1::uuid[])
           AND lj.metadata->>'direction' = ANY($2)
           AND lj.metadata->>'agentId' = $3
         ORDER BY lj.id, lj.created_at DESC`,
        [ledgerAccountIds, fundingDirections, agentId],
      );
      allRows.push(...rows);
    }
    if (shouldInclude('CASH_TO_CASH')) {
      const rows: Array<any> = await this.dataSource.query(
        `SELECT id::text AS id, 'CASH_TO_CASH'::text AS type, status::text AS status,
                principal_minor::text AS amount_minor, currency::text AS currency,
                created_at, claimed_at, expired_at, expires_at,
                reference::text AS reference, null::text AS narration,
                fee_minor::text AS fee_minor,
                beneficiary_phone::text AS beneficiary_phone,
                journal_id::text AS journal_id
         FROM cash_to_cash_transfers
         WHERE agent_id=$1
         ORDER BY created_at DESC, id DESC`,
        [agentId],
      );
      allRows.push(...rows);
    }

    // Global deterministic ordering: created_at DESC, id DESC (stable on timestamp ties).
    allRows.sort((a, b) => {
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      if (aTime !== bTime) return bTime - aTime;
      if (a.id < b.id) return 1;
      if (a.id > b.id) return -1;
      return 0;
    });

    const paginated = allRows.slice(offset, offset + normalizedLimit);

    // ————— batch commission evidence for the page (no N+1; query-boundary filtered by agent) —————
    const journalIds = paginated.map((r) => r.id).filter(Boolean);
    const snapshotByJournal = new Map<string, any>();
    if (journalIds.length > 0) {
      // Linkage is by journal_id ALONE: every page item's journal was selected from THIS agent's
      // own wallet/agent_id rows above, so the journal set is already agent-isolated. The snapshot
      // principal is the transaction's subject (CUSTOMER for W2C/CTW, AGENT for C2C/funding) and
      // must not be used as a filter.
      const snaps: Array<any> = await this.dataSource.query(
        `SELECT journal_id::text AS journal_id, commission_decision
         FROM commercial_decision_snapshots
         WHERE journal_id IS NOT NULL AND journal_id = ANY($1::uuid[])`,
        [journalIds],
      );
      for (const s of snaps) {
        if (s.journal_id && !snapshotByJournal.has(s.journal_id)) snapshotByJournal.set(s.journal_id, s);
      }
    }

    const items: AgentUnifiedHistoryItem[] = paginated.map((r) => {
      let direction = 'UNKNOWN';
      let counterparty: any = null;
      let completedAt: Date | null = r.completed_at ? new Date(r.completed_at) : null;

      if (r.type === 'CASH_IN') {
        // Cash→Wallet: agent float debited in exchange for cash received from the customer.
        direction = 'DEBIT';
        counterparty = { type: 'CUSTOMER' };
      } else if (r.type === 'CASH_OUT') {
        // Wallet→Cash: agent float credited; cash handed to the customer.
        direction = 'CREDIT';
        counterparty = { type: 'CUSTOMER' };
      } else if (r.type === 'AGENT_FUNDING') {
        direction = 'CREDIT';
        counterparty = r.is_aggregator_funding === 'true'
          ? { type: 'AGGREGATOR', aggregatorId: r.aggregator_id ?? null }
          : { type: 'WORKFORCE' };
      } else if (r.type === 'AGENT_DEFUNDING') {
        direction = 'DEBIT';
        counterparty = r.is_aggregator_funding === 'true'
          ? { type: 'AGGREGATOR', aggregatorId: r.aggregator_id ?? null }
          : { type: 'WORKFORCE' };
      } else if (r.type === 'CASH_TO_CASH') {
        // One row per initiated transfer; the authoritative status carries the lifecycle.
        direction = 'DEBIT';
        counterparty = { type: 'CUSTOMER', beneficiaryPhone: r.beneficiary_phone ?? null };
        if (r.status === 'CLAIMED' && r.claimed_at) completedAt = new Date(r.claimed_at);
        else if (r.status === 'EXPIRED' && r.expired_at) completedAt = new Date(r.expired_at);
        else completedAt = null;
      }

      // Commercial evidence: this agent's OWN allocation only, read from the decision snapshot.
      let commission: AgentHistoryCommission | null = null;
      const snap = snapshotByJournal.get(r.id);
      if (snap && snap.commission_decision && snap.commission_decision.status === 'ALLOCATED') {
        const allocations = Array.isArray(snap.commission_decision.allocations)
          ? snap.commission_decision.allocations
          : [];
        const own = allocations
          .filter((a: any) => a && a.beneficiaryId === agentId)
          .reduce((sum: bigint, a: any) => {
            try {
              return sum + BigInt(String(a.amountMinor ?? '0'));
            } catch {
              return sum;
            }
          }, 0n);
        commission = {
          commissionMinor: own.toString(),
          payable: snap.commission_decision.payable === true,
          treatment:
            snap.commission_decision.posting && typeof snap.commission_decision.posting.treatment === 'string'
              ? snap.commission_decision.posting.treatment
              : null,
        };
      }

      // Safe projection: no journal internals, no ledger account ids, no request hashes,
      // no PIN/OTP/hash material, no workforce identity.
      return {
        id: String(r.id),
        type: String(r.type),
        status: String(r.status),
        amountMinor: r.amount_minor?.toString() ?? '0',
        currency: String(r.currency ?? 'NGN'),
        direction,
        createdAt: new Date(r.created_at),
        completedAt,
        reference: r.reference ?? null,
        narration: r.narration ?? null,
        feeMinor: r.fee_minor?.toString() ?? '0',
        counterparty,
        commission,
        failureCode: null,
        failureMessage: null,
      };
    });

    return {
      items,
      pagination: { page: normalizedPage, limit: normalizedLimit, total, totalPages, hasNextPage: normalizedPage < totalPages },
    };
  }
}
