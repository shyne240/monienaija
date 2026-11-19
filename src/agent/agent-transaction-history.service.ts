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
 *   CASH_TO_CASH_CLAIM              — wallet claims are Customer-only; AGENT_CASH claims credit
 *                                     the claimant Agent's NGN float and appear as CREDIT
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

const VALID_TYPES = new Set([
  'WALLET_TRANSFER',
  'CASH_IN',
  'CASH_OUT',
  'CASH_TO_CASH',
  'CASH_TO_CASH_CLAIM',
  'AGENT_FUNDING',
  'AGENT_DEFUNDING',
  'EXTERNAL_BANK_TRANSFER',
]);

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
  vatMinor?: string;
  counterparty: Record<string, unknown> | null;
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
    const p =
      typeof (query.page ?? '1') === 'string'
        ? parseInt(String(query.page ?? '1'), 10)
        : Number(query.page);
    const l =
      typeof (query.limit ?? '20') === 'string'
        ? parseInt(String(query.limit ?? '20'), 10)
        : Number(query.limit);
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
    const walletRows: Array<{ id: string; ledger_account_id: string }> =
      await this.dataSource.query(
        `SELECT id, ledger_account_id FROM wallet_accounts
         WHERE customer_id=$1 AND owner_class='AGENT' AND wallet_owner_class(customer_id)='AGENT'`,
        [agentId],
      );
    const walletIds = walletRows.map((r) => r.id).filter(Boolean);
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
    if (shouldInclude('WALLET_TRANSFER') && walletIds.length > 0) {
      const rows: Array<{ count: string }> = await this.dataSource.query(
        `SELECT count(*)::text AS count FROM transfers
         WHERE source_wallet_id = ANY($1::uuid[])
            OR (destination_wallet_id = ANY($1::uuid[]) AND status = 'COMPLETED')`,
        [walletIds],
      );
      total += Number(rows[0]?.count ?? '0');
    }
    if (shouldInclude('CASH_TO_CASH')) {
      const rows: Array<{ count: string }> = await this.dataSource.query(
        `SELECT count(*)::text AS count FROM cash_to_cash_transfers WHERE agent_id=$1`,
        [agentId],
      );
      total += Number(rows[0]?.count ?? '0');
    }
    if (shouldInclude('CASH_TO_CASH_CLAIM')) {
      const rows: Array<{ count: string }> = await this.dataSource.query(
        `SELECT count(DISTINCT entity_id)::text AS count
         FROM audit_events
         WHERE entity_type='AGENT_CASH_TO_CASH_CLAIM'
           AND action='CASH_TO_CASH_CLAIMED'
           AND actor=$1`,
        [agentId],
      );
      total += Number(rows[0]?.count ?? '0');
    }
    if (shouldInclude('EXTERNAL_BANK_TRANSFER')) {
      const rows: Array<{ count: string }> = await this.dataSource.query(
        `SELECT count(*)::text as count FROM financial_commitments fc
           JOIN financial_authorizations fa ON fa.id = fc.authorization_id
           WHERE fa.agent_id = $1::uuid AND fa.principal_type = 'AGENT'`,
        [agentId],
      );
      total += Number(rows[0]?.count ?? '0');
    }

    const totalPages = total === 0 ? 0 : Math.ceil(total / normalizedLimit);
    const offset = (normalizedPage - 1) * normalizedLimit;
    if (total === 0 || offset >= total) {
      return {
        items: [],
        pagination: {
          page: normalizedPage,
          limit: normalizedLimit,
          total,
          totalPages,
          hasNextPage: false,
        },
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
    if (shouldInclude('WALLET_TRANSFER') && walletIds.length > 0) {
      const rows: Array<any> = await this.dataSource.query(
        `SELECT t.id::text AS id, 'WALLET_TRANSFER'::text AS type,
                t.status::text AS status, t.amount_minor::text AS amount_minor,
                t.currency::text AS currency, t.created_at, t.completed_at,
                COALESCE(t.payment_reference, t.reference)::text AS reference,
                t.narration::text AS narration, t.fee_minor::text AS fee_minor,
                t.vat_minor::text AS vat_minor, t.journal_id::text AS journal_id,
                t.failure_code::text AS failure_code, t.failure_message::text AS failure_message,
                t.source_wallet_id::text AS source_wallet_id,
                t.destination_wallet_id::text AS destination_wallet_id,
                CASE WHEN t.source_wallet_id = ANY($1::uuid[])
                     THEN CASE WHEN dst.owner_class = wallet_owner_class(dst.customer_id) THEN dst.owner_class END
                     ELSE CASE WHEN src.owner_class = wallet_owner_class(src.customer_id) THEN src.owner_class END END AS counterparty_class
         FROM transfers t
         JOIN wallet_accounts src ON src.id = t.source_wallet_id
         JOIN wallet_accounts dst ON dst.id = t.destination_wallet_id
         WHERE t.source_wallet_id = ANY($1::uuid[])
            OR (t.destination_wallet_id = ANY($1::uuid[]) AND t.status = 'COMPLETED')
         ORDER BY t.created_at DESC, t.id DESC`,
        [walletIds],
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
    if (shouldInclude('CASH_TO_CASH_CLAIM')) {
      const rows: Array<any> = await this.dataSource.query(
        `SELECT e.entity_id::text AS id,
                'CASH_TO_CASH_CLAIM'::text AS type,
                'COMPLETED'::text AS status,
                e.new_values->>'principalMinor' AS amount_minor,
                e.new_values->>'currency' AS currency,
                e.occurred_at AS created_at,
                e.occurred_at AS completed_at,
                lj.reference::text AS reference,
                CASE e.new_values->>'redemptionMethod'
                  WHEN 'AGENT_CASH' THEN 'Cash→Cash cash payout'
                  ELSE 'Cash→Cash wallet redemption'
                END::text AS narration,
                '0'::text AS fee_minor,
                e.new_values->>'beneficiaryPhone' AS beneficiary_phone,
                COALESCE(e.new_values->>'redemptionMethod', 'CUSTOMER_WALLET') AS redemption_method
         FROM audit_events e
         LEFT JOIN ledger_journals lj ON lj.id=e.entity_id
         WHERE e.entity_type='AGENT_CASH_TO_CASH_CLAIM'
           AND e.action='CASH_TO_CASH_CLAIMED'
           AND e.actor=$1
         ORDER BY e.occurred_at DESC, e.entity_id DESC`,
        [agentId],
      );
      allRows.push(...rows);
    }
    if (shouldInclude('EXTERNAL_BANK_TRANSFER')) {
      const rows: Array<any> = await this.dataSource.query(
        `SELECT fc.id::text as id, 'EXTERNAL_BANK_TRANSFER'::text as type,
                  fc.state::text as status,
                  fc.amount_minor::text as amount_minor, fc.currency::text as currency,
                  fc.created_at, fc.updated_at as completed_at,
                  bo.operation_reference::text as reference,
                  bo.provider_transaction_reference::text as provider_reference,
                  eo.target_mapping_reference::text as internal_target_reference,
                  COALESCE(cb.display_name, cb.nickname, bo.operation_reference, eo.target_mapping_reference)::text as narration,
                  fc.wallet_account_id::text as source_wallet_id,
                  null::text as destination_wallet_id,
                  fa.institution::text as destination_institution,
                  eo.id::text as external_operation_id,
                  bo.operation_reference::text as banking_operation_reference,
                  bo.provider_transaction_reference::text as banking_provider_reference,
                  substring(cb.destination_identifier from '.{0,6}(.{4})$')::text as destination_last4,
                  cb.bank_code::text as bank_code,
                  COALESCE(fb.service_fee_minor::text,'0') as fee_minor,
                  COALESCE(fb.tax_minor::text,'0') as vat_minor,
                  COALESCE(fb.customer_debit_minor::text, fc.amount_minor::text) as total_debit_minor,
                  COALESCE(fb.beneficiary_amount_minor::text, fc.amount_minor::text) as principal_minor
           FROM financial_commitments fc
           JOIN financial_authorizations fa ON fa.id = fc.authorization_id
           LEFT JOIN external_operations eo ON eo.id = fc.external_operation_id
           LEFT JOIN banking_outbound_operations bo ON bo.external_operation_id = eo.id
           LEFT JOIN customer_beneficiaries cb ON cb.id = fc.beneficiary_id
           LEFT JOIN banking_operation_fee_bindings fb ON fb.external_operation_id = eo.id
           WHERE fa.agent_id = $1::uuid AND fa.principal_type = 'AGENT'
           ORDER BY fc.created_at DESC, fc.id DESC`,
        [agentId],
      );
      for (const r of rows) {
        const rawStatus = String(r.status ?? 'PENDING');
        const mapped = rawStatus === 'RESERVED' ? 'PENDING' : rawStatus === 'SETTLED' ? 'COMPLETED' : rawStatus === 'RELEASED' ? 'REVERSED' : rawStatus;
        allRows.push({ ...r, status: mapped, _rawStatus: rawStatus, reference: r.reference ?? null });
      }
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
    const journalIds = paginated
      .map((r) => (r.type === 'WALLET_TRANSFER' ? r.journal_id : r.id))
      .filter(Boolean);
    const snapshotByJournal = new Map<
      string,
      {
        journal_id: string;
        commission_decision: {
          status: string;
          allocations?: Array<{
            beneficiaryId?: string;
            amountMinor?: string | number | bigint | null;
          } | null>;
          payable?: boolean;
          posting?: { treatment?: string } | null;
        } | null;
      }
    >();
    if (journalIds.length > 0) {
      // Linkage is by journal_id ALONE: every page item's journal was selected from THIS agent's
      // own wallet/agent_id rows above, so the journal set is already agent-isolated. The snapshot
      // principal is the transaction's subject (CUSTOMER for W2C/CTW, AGENT for C2C/funding) and
      // must not be used as a filter.
      const snaps: Array<NonNullable<ReturnType<typeof snapshotByJournal.get>>> =
        await this.dataSource.query(
          `SELECT journal_id::text AS journal_id, commission_decision
         FROM commercial_decision_snapshots
         WHERE journal_id IS NOT NULL AND journal_id = ANY($1::uuid[])`,
          [journalIds],
        );
      for (const s of snaps) {
        if (s.journal_id && !snapshotByJournal.has(s.journal_id))
          snapshotByJournal.set(s.journal_id, s);
      }
    }

    const items: AgentUnifiedHistoryItem[] = paginated.map((r) => {
      let direction = 'UNKNOWN';
      let counterparty: Record<string, unknown> | null = null;
      let completedAt: Date | null = r.completed_at ? new Date(r.completed_at) : null;

      if (r.type === 'WALLET_TRANSFER') {
        const sourceIsOwn = walletIds.includes(r.source_wallet_id);
        const destinationIsOwn = walletIds.includes(r.destination_wallet_id);
        direction =
          sourceIsOwn && !destinationIsOwn
            ? 'DEBIT'
            : !sourceIsOwn && destinationIsOwn
              ? 'CREDIT'
              : 'UNKNOWN';
        if (r.counterparty_class === 'CUSTOMER' || r.counterparty_class === 'AGENT') {
          counterparty = { type: r.counterparty_class };
        }
      } else if (r.type === 'CASH_IN') {
        // Cash→Wallet: agent float debited in exchange for cash received from the customer.
        direction = 'DEBIT';
        counterparty = { type: 'CUSTOMER' };
      } else if (r.type === 'CASH_OUT') {
        // Wallet→Cash: agent float credited; cash handed to the customer.
        direction = 'CREDIT';
        counterparty = { type: 'CUSTOMER' };
      } else if (r.type === 'AGENT_FUNDING') {
        direction = 'CREDIT';
        counterparty =
          r.is_aggregator_funding === 'true'
            ? { type: 'AGGREGATOR', aggregatorId: r.aggregator_id ?? null }
            : { type: 'WORKFORCE' };
      } else if (r.type === 'AGENT_DEFUNDING') {
        direction = 'DEBIT';
        counterparty =
          r.is_aggregator_funding === 'true'
            ? { type: 'AGGREGATOR', aggregatorId: r.aggregator_id ?? null }
            : { type: 'WORKFORCE' };
      } else if (r.type === 'CASH_TO_CASH') {
        // One row per initiated transfer; the authoritative status carries the lifecycle.
        direction = 'DEBIT';
        counterparty = { type: 'CUSTOMER', beneficiaryPhone: r.beneficiary_phone ?? null };
        if (r.status === 'CLAIMED' && r.claimed_at) completedAt = new Date(r.claimed_at);
        else if (r.status === 'EXPIRED' && r.expired_at) completedAt = new Date(r.expired_at);
        else completedAt = null;
      } else if (r.type === 'EXTERNAL_BANK_TRANSFER') {
        direction = 'DEBIT';
        const last4 = r.destination_last4 ? String(r.destination_last4).slice(-4) : null;
        counterparty = {
          type: 'BANK_ACCOUNT',
          bankCode: r.bank_code ?? null,
          maskedAccountNumber: last4 ? `****${last4}` : null,
          displayName: r.narration ?? null,
          destinationInstitution: r.destination_institution ?? null,
          // Platform banking operation tracking reference (deterministic OP..., immutable) — the receipt/history trackable id
          operationReference: r.reference ?? null,
          platformReference: r.reference ?? null,
          // Provider-issued reference (e.g. Monnify transaction ref), only after provider confirms — never fabricated
          providerReference: r.provider_reference ?? r.banking_provider_reference ?? null,
          // Internal routing reference (a6-target:...) — never presented as provider-issued
          internalReference: r.internal_target_reference ?? null,
          externalOperationId: r.external_operation_id ?? null,
          bankingOperationReference: r.banking_operation_reference ?? null,
          bankingProviderReference: r.banking_provider_reference ?? r.provider_reference ?? null,
          principalMinor: r.principal_minor ?? r.amount_minor ?? '0',
          rawStatus: r._rawStatus ?? r.status,
        };
      } else if (r.type === 'CASH_TO_CASH_CLAIM') {
        // Agent-cash redemption credits Agent B's float; wallet redemption is Customer-only.
        direction = r.redemption_method === 'AGENT_CASH' ? 'CREDIT' : 'UNKNOWN';
        counterparty = { type: 'CUSTOMER', beneficiaryPhone: r.beneficiary_phone ?? null };
      }

      // Commercial evidence: this agent's OWN allocation only, read from the decision snapshot.
      let commission: AgentHistoryCommission | null = null;
      const snap = snapshotByJournal.get(r.type === 'WALLET_TRANSFER' ? r.journal_id : r.id);
      if (snap && snap.commission_decision && snap.commission_decision.status === 'ALLOCATED') {
        const allocations: Array<{
          beneficiaryId?: string;
          amountMinor?: string | number | bigint | null;
        } | null> = Array.isArray(snap.commission_decision.allocations)
          ? snap.commission_decision.allocations
          : [];
        const own = allocations
          .filter((a): a is NonNullable<typeof a> => !!a && a.beneficiaryId === agentId)
          .reduce((sum: bigint, a) => {
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
            snap.commission_decision.posting &&
            typeof snap.commission_decision.posting.treatment === 'string'
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
        amountMinor:
          r.type === 'EXTERNAL_BANK_TRANSFER' && r.principal_minor !== undefined
            ? String(r.principal_minor ?? r.amount_minor ?? '0')
            : ((r.amount_minor as string | number | bigint | null | undefined)?.toString() ?? '0'),
        currency: String(r.currency ?? 'NGN'),
        direction,
        createdAt: new Date(r.created_at),
        completedAt,
        reference: r.reference ?? null,
        narration: r.narration ?? null,
        feeMinor:
          r.type === 'EXTERNAL_BANK_TRANSFER'
            ? ((r.fee_minor as string | number | bigint | null | undefined)?.toString() ?? '0')
            : r.type === 'WALLET_TRANSFER' && (direction !== 'DEBIT' || r.status !== 'COMPLETED')
              ? '0'
              : ((r.fee_minor as string | number | bigint | null | undefined)?.toString() ?? '0'),
        ...(r.type === 'WALLET_TRANSFER' || r.type === 'EXTERNAL_BANK_TRANSFER'
          ? {
              vatMinor: r.type === 'EXTERNAL_BANK_TRANSFER'
                ? String(r.vat_minor ?? '0')
                : direction === 'DEBIT' && r.status === 'COMPLETED'
                  ? String(r.vat_minor ?? '0')
                  : '0',
              totalDebitMinor: r.type === 'EXTERNAL_BANK_TRANSFER'
                ? (r.total_debit_minor ?? null)
                : undefined,
            }
          : {}),
        counterparty,
        commission,
        failureCode: r.type === 'WALLET_TRANSFER' ? (r.failure_code ?? null) : null,
        failureMessage: r.type === 'WALLET_TRANSFER' ? (r.failure_message ?? null) : null,
      };
    });

    return {
      items,
      pagination: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
        totalPages,
        hasNextPage: normalizedPage < totalPages,
      },
    };
  }
}
