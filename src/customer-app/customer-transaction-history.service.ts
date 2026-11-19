/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

const VALID_TYPES = new Set([
  'WALLET_TRANSFER',
  'CASH_IN',
  'CASH_OUT',
  'CASH_TO_CASH',
  'FUNDING',
  'EXTERNAL_BANK_TRANSFER',
]);

export interface UnifiedHistoryQuery {
  customerId: string;
  page?: string | number;
  limit?: string | number;
  type?: string;
}

export interface UnifiedHistoryItem {
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
  totalDebitMinor?: string | null;
  sourceWalletId: string | null;
  destinationWalletId: string | null;
  counterparty: Record<string, unknown> | null;
  failureCode: string | null;
  failureMessage: string | null;
}

function canonicalizeTo10(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  const cleaned = input.replace(/[\s()-]/g, '').trim();
  if (!cleaned) return null;
  let digits = cleaned;
  if (digits.startsWith('+234')) digits = digits.slice(4);
  else if (digits.startsWith('234')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;
  if (!/^[789]\d{9}$/.test(digits)) return null;
  return digits;
}

@Injectable()
export class CustomerTransactionHistoryService {
  constructor(private readonly dataSource: DataSource) {}

  async listUnified(
    query: UnifiedHistoryQuery,
  ): Promise<{ items: UnifiedHistoryItem[]; pagination: any }> {
    const customerId = String(query.customerId).trim();
    if (!customerId) throw new BadRequestException('customerId is required');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId)) {
      throw new BadRequestException('customerId must be a UUID');
    }
    const pageRaw = query.page ?? '1';
    const limitRaw = query.limit ?? '20';
    const p = typeof pageRaw === 'string' ? parseInt(String(pageRaw), 10) : Number(pageRaw);
    const l = typeof limitRaw === 'string' ? parseInt(String(limitRaw), 10) : Number(limitRaw);
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

    // Fetch wallets + ledger account ids for this customer (bounded, indexed)
    const walletRows: Array<{ id: string; ledger_account_id: string }> =
      await this.dataSource.query(
        `SELECT id, ledger_account_id FROM wallet_accounts WHERE customer_id=$1 AND owner_class='CUSTOMER' AND wallet_owner_class(customer_id)='CUSTOMER'`,
        [customerId],
      );
    const walletIds = walletRows.map((r) => r.id);
    const ledgerAccountIds = walletRows.map((r) => r.ledger_account_id).filter(Boolean);

    // Fetch phones and canonicalize to 10-digit for beneficiary matching
    const phoneRows: Array<{ normalized_value: string; value: string }> =
      await this.dataSource.query(
        `SELECT normalized_value, value FROM customer_contact_methods WHERE customer_id=$1 AND type='PHONE' AND deleted_at IS NULL`,
        [customerId],
      );
    const rawPhones = phoneRows
      .map((r) => r.normalized_value ?? r.value)
      .filter((v): v is string => !!v);
    const canonicalPhones = rawPhones
      .map((v) => canonicalizeTo10(v))
      .filter((v): v is string => !!v);
    const phoneSet = new Set<string>(canonicalPhones);

    // Count total deterministically across included types
    let total = 0;
    if (shouldInclude('WALLET_TRANSFER')) {
      if (walletIds.length > 0) {
        const rows: Array<{ count: string }> = await this.dataSource.query(
          `SELECT count(*)::text as count FROM transfers WHERE source_wallet_id = ANY($1::uuid[]) OR (destination_wallet_id = ANY($1::uuid[]) AND status='COMPLETED')`,
          [walletIds],
        );
        total += Number(rows[0]?.count ?? '0');
      }
    }
    if (shouldInclude('FUNDING')) {
      const rows: Array<{ count: string }> = await this.dataSource.query(
        `SELECT count(*)::text as count FROM customer_funding_requests WHERE customer_id=$1`,
        [customerId],
      );
      total += Number(rows[0]?.count ?? '0');
    }
    if (shouldInclude('CASH_TO_CASH')) {
      if (canonicalPhones.length > 0) {
        const rows: Array<{ count: string }> = await this.dataSource.query(
          `SELECT count(*)::text as count FROM cash_to_cash_transfers WHERE claimant_customer_id=$1 OR beneficiary_phone = ANY($2)`,
          [customerId, canonicalPhones],
        );
        total += Number(rows[0]?.count ?? '0');
      } else {
        const rows: Array<{ count: string }> = await this.dataSource.query(
          `SELECT count(*)::text as count FROM cash_to_cash_transfers WHERE claimant_customer_id=$1`,
          [customerId],
        );
        total += Number(rows[0]?.count ?? '0');
      }
    }
    if (shouldInclude('EXTERNAL_BANK_TRANSFER')) {
      // Consolidated application: financial_commitments is required. Missing table is a hard failure — never silently omit banking transactions.
      const rows: Array<{ count: string }> = await this.dataSource.query(
        `SELECT count(*)::text as count FROM financial_commitments fc
           JOIN financial_authorizations fa ON fa.id = fc.authorization_id
           WHERE fa.customer_id = $1::uuid AND fa.principal_type = 'CUSTOMER'`,
        [customerId],
      );
      total += Number(rows[0]?.count ?? '0');
    }
    if (shouldInclude('CASH_IN') || shouldInclude('CASH_OUT')) {
      if (ledgerAccountIds.length > 0) {
        const services: string[] = [];
        if (shouldInclude('CASH_IN')) services.push('CASH_IN');
        if (shouldInclude('CASH_OUT')) services.push('CASH_OUT');
        const rows: Array<{ count: string }> = await this.dataSource.query(
          `SELECT count(DISTINCT lj.id)::text as count
           FROM ledger_journals lj
           JOIN ledger_lines ll ON ll.journal_id = lj.id
           WHERE ll.ledger_account_id = ANY($1::uuid[])
             AND lj.metadata->>'canonicalService' = ANY($2)`,
          [ledgerAccountIds, services],
        );
        total += Number(rows[0]?.count ?? '0');
      }
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

    // Bounded per-customer fetch: fetch each type's rows for this customer only (not entire table), then global sort + slice.
    // This is correct global pagination (not per-table page1 concat) and is bounded because queries are filtered by customer_id / wallet_ids / phones.
    // For single customer history, row count is O(hundreds) and stays within limit.
    const allRows: Array<any> = [];

    if (shouldInclude('WALLET_TRANSFER') && walletIds.length > 0) {
      const rows: Array<any> = await this.dataSource.query(
        `SELECT t.id::text as id, 'WALLET_TRANSFER'::text as type, t.status::text as status, t.amount_minor::text as amount_minor, t.currency::text as currency, t.fee_minor::text as fee_minor, t.vat_minor::text as vat_minor, q.total_minor::text as total_debit_minor, t.created_at, t.completed_at, COALESCE(t.payment_reference,t.reference)::text as reference, t.narration::text as narration, t.source_wallet_id::text as source_wallet_id, t.destination_wallet_id::text as destination_wallet_id, t.failure_code::text as failure_code, t.failure_message::text as failure_message FROM transfers t LEFT JOIN wallet_transfer_quote_bindings b ON b.transfer_id=t.id LEFT JOIN payment_quotes q ON q.id=b.quote_id WHERE t.source_wallet_id = ANY($1::uuid[]) OR (t.destination_wallet_id = ANY($1::uuid[]) AND t.status='COMPLETED') ORDER BY t.created_at DESC, t.id DESC`,
        [walletIds],
      );
      for (const r of rows) {
        // V1-COMMERCIAL-IMPLEMENTATION-01 — real applied-fee column (stays '0' while journals
        // remain principal-only at the accounting boundary; snapshot carries the computed fee).
        allRows.push(r);
      }
    }
    if (shouldInclude('FUNDING')) {
      const rows: Array<any> = await this.dataSource.query(
        `SELECT id::text as id, 'FUNDING'::text as type, status::text as status, amount_minor::text as amount_minor, currency::text as currency, created_at, approved_at as completed_at, reference::text as reference, description::text as narration, null::text as source_wallet_id, null::text as destination_wallet_id, null::text as failure_code, rejection_reason::text as failure_message, external_reference::text as external_reference, channel::text as channel, '0'::text as fee_minor, rejected_at, approved_at FROM customer_funding_requests WHERE customer_id=$1 ORDER BY created_at DESC, id DESC`,
        [customerId],
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
                  fc.resolution_journal_id::text as resolution_journal_id,
                  fc.reservation_journal_id::text as reservation_journal_id,
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
           WHERE fa.customer_id = $1::uuid AND fa.principal_type = 'CUSTOMER'
           ORDER BY fc.created_at DESC, fc.id DESC`,
        [customerId],
      );
      for (const r of rows) {
        const rawStatus = String(r.status ?? 'PENDING');
        const mapped =
          rawStatus === 'RESERVED'
            ? 'PENDING'
            : rawStatus === 'SETTLED'
              ? 'COMPLETED'
              : rawStatus === 'RELEASED'
                ? 'REVERSED'
                : rawStatus;
        allRows.push({
          ...r,
          status: mapped,
          _rawStatus: rawStatus,
          reference: r.reference ?? null,
        });
      }
    }
    if (shouldInclude('CASH_TO_CASH')) {
      let rows: Array<any>;
      if (canonicalPhones.length > 0) {
        rows = await this.dataSource.query(
          `SELECT t.id::text as id, 'CASH_TO_CASH'::text as type, t.status::text as status,
                  t.principal_minor::text as amount_minor, t.currency::text as currency,
                  t.created_at, t.claimed_at as completed_at, t.reference::text as reference,
                  CASE claim_audit.new_values->>'redemptionMethod'
                    WHEN 'AGENT_CASH' THEN 'Cash-to-Cash cash payout'
                    WHEN 'CUSTOMER_WALLET' THEN 'Cash-to-Cash Customer wallet credit'
                    ELSE null
                  END::text as narration,
                  null::text as source_wallet_id, null::text as destination_wallet_id,
                  t.beneficiary_phone::text as beneficiary_phone, null::text as external_reference,
                  null::text as channel, t.fee_minor::text as fee_minor, t.expires_at, t.claimed_at,
                  t.expired_at, t.claimant_customer_id::text as claimant_customer_id,
                  t.agent_id::text as agent_id,
                  COALESCE(claim_audit.new_values->>'redemptionMethod', 'CUSTOMER_WALLET') as redemption_method,
                  claim_audit.new_values->>'claimantAgentId' as claimant_agent_id,
                  null::text as failure_code
           FROM cash_to_cash_transfers t
           LEFT JOIN LATERAL (
             SELECT e.new_values FROM audit_events e
             WHERE e.entity_type='AGENT_CASH_TO_CASH_CLAIM'
               AND e.action='CASH_TO_CASH_CLAIMED'
               AND e.entity_id=t.claim_journal_id
             ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1
           ) claim_audit ON TRUE
           WHERE t.claimant_customer_id=$1::uuid OR t.beneficiary_phone = ANY($2)
           ORDER BY t.created_at DESC, t.id DESC`,
          [customerId, canonicalPhones],
        );
      } else {
        rows = await this.dataSource.query(
          `SELECT t.id::text as id, 'CASH_TO_CASH'::text as type, t.status::text as status,
                  t.principal_minor::text as amount_minor, t.currency::text as currency,
                  t.created_at, t.claimed_at as completed_at, t.reference::text as reference,
                  CASE claim_audit.new_values->>'redemptionMethod'
                    WHEN 'AGENT_CASH' THEN 'Cash-to-Cash cash payout'
                    WHEN 'CUSTOMER_WALLET' THEN 'Cash-to-Cash Customer wallet credit'
                    ELSE null
                  END::text as narration,
                  null::text as source_wallet_id, null::text as destination_wallet_id,
                  t.beneficiary_phone::text as beneficiary_phone, null::text as external_reference,
                  null::text as channel, t.fee_minor::text as fee_minor, t.expires_at, t.claimed_at,
                  t.expired_at, t.claimant_customer_id::text as claimant_customer_id,
                  t.agent_id::text as agent_id,
                  COALESCE(claim_audit.new_values->>'redemptionMethod', 'CUSTOMER_WALLET') as redemption_method,
                  claim_audit.new_values->>'claimantAgentId' as claimant_agent_id,
                  null::text as failure_code
           FROM cash_to_cash_transfers t
           LEFT JOIN LATERAL (
             SELECT e.new_values FROM audit_events e
             WHERE e.entity_type='AGENT_CASH_TO_CASH_CLAIM'
               AND e.action='CASH_TO_CASH_CLAIMED'
               AND e.entity_id=t.claim_journal_id
             ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1
           ) claim_audit ON TRUE
           WHERE t.claimant_customer_id=$1::uuid
           ORDER BY t.created_at DESC, t.id DESC`,
          [customerId],
        );
      }
      allRows.push(...rows);
    }
    if ((shouldInclude('CASH_IN') || shouldInclude('CASH_OUT')) && ledgerAccountIds.length > 0) {
      const services: string[] = [];
      if (shouldInclude('CASH_IN')) services.push('CASH_IN');
      if (shouldInclude('CASH_OUT')) services.push('CASH_OUT');
      const rows: Array<any> = await this.dataSource.query(
        `SELECT DISTINCT ON (lj.id) lj.id::text as id,
                (lj.metadata->>'canonicalService')::text as type,
                'COMPLETED'::text as status,
                ll.amount_minor::text as amount_minor,
                lj.currency::text as currency,
                lj.created_at as created_at,
                lj.created_at as completed_at,
                lj.reference::text as reference,
                lj.description::text as narration,
                null::text as source_wallet_id,
                null::text as destination_wallet_id,
                null::text as beneficiary_phone,
                null::text as external_reference,
                null::text as channel,
                '0'::text as fee_minor,
                ll.direction::text as ledger_direction,
                lj.metadata as metadata
         FROM ledger_journals lj
         JOIN ledger_lines ll ON ll.journal_id = lj.id
         WHERE ll.ledger_account_id = ANY($1::uuid[])
           AND lj.metadata->>'canonicalService' = ANY($2)
         ORDER BY lj.id, lj.created_at DESC`,
        [ledgerAccountIds, services],
      );
      for (const r of rows) allRows.push(r);
    }

    // Global deterministic ordering: created_at DESC, id DESC
    allRows.sort((a, b) => {
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      if (aTime !== bTime) return bTime - aTime;
      if (a.id < b.id) return 1;
      if (a.id > b.id) return -1;
      return 0;
    });

    const paginated = allRows.slice(offset, offset + normalizedLimit);

    // Counterparty batch for WALLET_TRANSFER (avoid N+1) — reuse A25 pattern
    const walletTransferRows = paginated.filter((r) => r.type === 'WALLET_TRANSFER');
    const walletMap = new Map<string, any>();
    const profileMap = new Map<string, any>();
    const contactMap = new Map<string, any>();
    const agentMap = new Map<string, any>();
    if (walletTransferRows.length > 0 && walletIds.length > 0) {
      const counterpartyWalletIds = [
        ...new Set(
          walletTransferRows
            .map((t) => {
              const isSource = walletIds.includes(t.source_wallet_id);
              const isDest = walletIds.includes(t.destination_wallet_id);
              if (isSource && !isDest) return t.destination_wallet_id;
              if (!isSource && isDest) return t.source_wallet_id;
              if (isSource && isDest) return t.destination_wallet_id;
              return null;
            })
            .filter((v): v is string => !!v),
        ),
      ];
      if (counterpartyWalletIds.length > 0) {
        const cpWallets: Array<any> = await this.dataSource.query(
          `SELECT id::text as id, customer_id::text as customer_id, currency::text as currency, owner_class, wallet_owner_class(customer_id) AS current_class FROM wallet_accounts WHERE id = ANY($1::uuid[])`,
          [counterpartyWalletIds],
        );
        for (const w of cpWallets) walletMap.set(w.id, w);
        const customerIds = [
          ...new Set(
            cpWallets
              .filter((w) => w.owner_class === 'CUSTOMER' && w.current_class === 'CUSTOMER')
              .map((w) => w.customer_id)
              .filter(Boolean),
          ),
        ] as string[];
        const agentIds = cpWallets
          .filter((w) => w.owner_class === 'AGENT' && w.current_class === 'AGENT')
          .map((w) => w.customer_id);
        if (agentIds.length > 0) {
          const agents: Array<any> = await this.dataSource.query(
            `SELECT a.id::text AS id, a.reference, r.receiving_number FROM agents a LEFT JOIN agent_receiving_numbers r ON r.agent_id=a.id AND r.deleted_at IS NULL AND r.status='ACTIVE' WHERE a.id=ANY($1::uuid[]) AND a.deleted_at IS NULL`,
            [agentIds],
          );
          for (const agent of agents) agentMap.set(agent.id, agent);
        }
        if (customerIds.length > 0) {
          const profiles: Array<any> = await this.dataSource.query(
            `SELECT customer_id::text as customer_id, display_name::text as display_name, is_active, deleted_at FROM customer_profiles WHERE customer_id = ANY($1::uuid[])`,
            [customerIds],
          );
          for (const p of profiles) {
            if (p.is_active && p.deleted_at === null) profileMap.set(p.customer_id, p);
          }
          const contacts: Array<any> = await this.dataSource.query(
            `SELECT customer_id::text as customer_id, type::text as type, value::text as value, normalized_value::text as normalized_value, is_primary FROM customer_contact_methods WHERE customer_id = ANY($1::uuid[]) AND type='PHONE' AND deleted_at IS NULL`,
            [customerIds],
          );
          // Prefer primary phone
          for (const c of contacts) {
            if (c.type !== 'PHONE') continue;
            const existing = contactMap.get(c.customer_id);
            if (!existing) contactMap.set(c.customer_id, c);
            else if (!existing.is_primary && c.is_primary) contactMap.set(c.customer_id, c);
          }
        }
      }
    }

    const items: UnifiedHistoryItem[] = paginated.map((r) => {
      let direction: string = 'UNKNOWN';
      let counterparty: Record<string, unknown> | null = null;
      const sourceWalletId: string | null = r.source_wallet_id ?? null;
      const destinationWalletId: string | null = r.destination_wallet_id ?? null;
      let failureCode: string | null = r.failure_code ?? null;
      let failureMessage: string | null = r.failure_message ?? null;

      if (r.type === 'WALLET_TRANSFER') {
        const isSource = walletIds.includes(r.source_wallet_id);
        const isDest = walletIds.includes(r.destination_wallet_id);
        if (isSource && !isDest) direction = 'SENT';
        else if (!isSource && isDest) direction = 'RECEIVED';
        else if (isSource && isDest) direction = 'INTERNAL';
        else direction = 'UNKNOWN';
        const counterpartyWalletId = (() => {
          if (isSource && !isDest) return r.destination_wallet_id;
          if (!isSource && isDest) return r.source_wallet_id;
          if (isSource && isDest) return r.destination_wallet_id;
          return null;
        })();
        const cpWallet = counterpartyWalletId
          ? (walletMap.get(counterpartyWalletId) ?? null)
          : null;
        const cpType =
          cpWallet?.owner_class === cpWallet?.current_class ? cpWallet?.owner_class : null;
        const cpCustomerId = cpType === 'CUSTOMER' ? cpWallet?.customer_id : null;
        const cpAgent = cpType === 'AGENT' ? agentMap.get(cpWallet?.customer_id) : null;
        const cpProfile = cpCustomerId ? (profileMap.get(cpCustomerId) ?? null) : null;
        const cpContact = cpCustomerId ? (contactMap.get(cpCustomerId) ?? null) : null;
        counterparty = counterpartyWalletId
          ? {
              walletId: counterpartyWalletId,
              ownerType: cpType === 'CUSTOMER' || cpType === 'AGENT' ? cpType : null,
              customerId: cpCustomerId,
              agentId: cpType === 'AGENT' ? (cpAgent?.id ?? null) : null,
              displayName: cpProfile?.display_name ?? cpAgent?.reference ?? null,
              receivingNumber:
                cpContact?.normalized_value ??
                cpContact?.value ??
                cpAgent?.receiving_number ??
                null,
            }
          : null;
        // failureCode already from transfer.failure_code
      } else if (r.type === 'FUNDING') {
        direction = 'CREDIT';
        counterparty = r.external_reference
          ? { type: 'FUNDING_SOURCE', reference: r.external_reference, channel: r.channel ?? null }
          : { type: 'FUNDING_SOURCE', channel: r.channel ?? null };
        if (r.status === 'REJECTED') {
          failureCode = r.failure_code ?? 'FUNDING_REJECTED';
          failureMessage = r.failure_message ?? null;
        } else {
          failureCode = null;
          failureMessage = null;
        }
      } else if (r.type === 'CASH_TO_CASH') {
        if (r.claimant_customer_id === customerId) {
          direction = 'RECEIVED';
          counterparty = {
            type: 'AGENT',
            agentId: r.redemption_method === 'AGENT_CASH' ? r.claimant_agent_id : r.agent_id,
            beneficiaryPhone: r.beneficiary_phone,
            redemptionMethod: r.redemption_method ?? 'CUSTOMER_WALLET',
          };
        } else if (phoneSet.has(r.beneficiary_phone)) {
          if (r.status === 'UNCLAIMED') direction = 'PENDING';
          else if (r.status === 'CLAIMED')
            direction = r.claimant_customer_id === customerId ? 'RECEIVED' : 'UNKNOWN';
          else if (r.status === 'EXPIRED') direction = 'EXPIRED';
          else direction = 'PENDING';
          counterparty = {
            type: 'AGENT',
            agentId: r.agent_id,
            beneficiaryPhone: r.beneficiary_phone,
          };
        } else {
          direction = 'UNKNOWN';
          counterparty = { beneficiaryPhone: r.beneficiary_phone, agentId: r.agent_id };
        }
        if (r.status === 'FAILED' || r.status === 'REJECTED') {
          failureCode = r.failure_code ?? failureCode;
        }
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
        if (r._rawStatus === 'RELEASED' || r.status === 'RELEASED' || r.status === 'REVERSED') {
          failureCode = 'REJECTION_COMPENSATED';
          failureMessage = 'Bank transfer rejected — funds returned';
        } else if (r._rawStatus === 'PENDING' || r.status === 'PENDING') {
          failureCode = null;
          failureMessage = null;
        }
      } else if (r.type === 'CASH_IN') {
        direction = 'CREDIT';
        counterparty = { type: 'AGENT' };
        failureCode = null;
        failureMessage = null;
      } else if (r.type === 'CASH_OUT') {
        direction = 'DEBIT';
        counterparty = { type: 'AGENT' };
        failureCode = null;
        failureMessage = null;
      }

      let completedAt: Date | null = r.completed_at ? new Date(r.completed_at) : null;
      if (r.type === 'CASH_TO_CASH') {
        if (r.status === 'EXPIRED' && r.expired_at) completedAt = new Date(r.expired_at);
        else if (r.status === 'CLAIMED' && r.claimed_at) completedAt = new Date(r.claimed_at);
      }
      if (r.type === 'FUNDING' && r.status === 'REJECTED' && r.rejected_at) {
        completedAt = new Date(r.rejected_at);
      } else if (r.type === 'FUNDING' && r.status === 'APPROVED' && r.approved_at) {
        completedAt = new Date(r.approved_at);
      }

      // Safe projection: hide PIN/OTP/hash/journalId/ledgerAccountId/internal workforce, expose feeMinor as 0 where V1 has no fee ledger
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
            : r.type === 'WALLET_TRANSFER' && (direction === 'RECEIVED' || r.status !== 'COMPLETED')
              ? '0'
              : ((r.fee_minor as string | number | bigint | null | undefined)?.toString() ?? '0'),
        ...(r.type === 'WALLET_TRANSFER' || r.type === 'EXTERNAL_BANK_TRANSFER'
          ? {
              vatMinor:
                r.type === 'EXTERNAL_BANK_TRANSFER'
                  ? String(r.vat_minor ?? '0')
                  : direction === 'RECEIVED' || r.status !== 'COMPLETED'
                    ? '0'
                    : String(r.vat_minor ?? '0'),
              totalDebitMinor:
                r.type === 'EXTERNAL_BANK_TRANSFER'
                  ? (r.total_debit_minor ?? null)
                  : direction === 'RECEIVED'
                    ? null
                    : (r.total_debit_minor ?? null),
            }
          : {}),
        sourceWalletId,
        destinationWalletId,
        counterparty,
        failureCode,
        failureMessage,
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
