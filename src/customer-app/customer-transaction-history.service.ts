/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

const VALID_TYPES = new Set(['WALLET_TRANSFER', 'CASH_IN', 'CASH_OUT', 'CASH_TO_CASH', 'FUNDING']);

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
  sourceWalletId: string | null;
  destinationWalletId: string | null;
  counterparty: any | null;
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

  async listUnified(query: UnifiedHistoryQuery): Promise<{ items: UnifiedHistoryItem[]; pagination: any }> {
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
    const walletRows: Array<{ id: string; ledger_account_id: string }> = await this.dataSource.query(
      `SELECT id, ledger_account_id FROM wallet_accounts WHERE customer_id=$1`,
      [customerId],
    );
    const walletIds = walletRows.map((r) => r.id);
    const ledgerAccountIds = walletRows.map((r) => r.ledger_account_id).filter(Boolean);

    // Fetch phones and canonicalize to 10-digit for beneficiary matching
    const phoneRows: Array<{ normalized_value: string; value: string }> = await this.dataSource.query(
      `SELECT normalized_value, value FROM customer_contact_methods WHERE customer_id=$1 AND type='PHONE' AND deleted_at IS NULL`,
      [customerId],
    );
    const rawPhones = phoneRows.map((r) => r.normalized_value ?? r.value).filter((v): v is string => !!v);
    const canonicalPhones = rawPhones.map((v) => canonicalizeTo10(v)).filter((v): v is string => !!v);
    const phoneSet = new Set<string>(canonicalPhones);

    // Count total deterministically across included types
    let total = 0;
    if (shouldInclude('WALLET_TRANSFER')) {
      if (walletIds.length > 0) {
        const rows: Array<{ count: string }> = await this.dataSource.query(
          `SELECT count(*)::text as count FROM transfers WHERE source_wallet_id = ANY($1::uuid[]) OR destination_wallet_id = ANY($1::uuid[])`,
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
        pagination: { page: normalizedPage, limit: normalizedLimit, total, totalPages, hasNextPage: false },
      };
    }

    // Bounded per-customer fetch: fetch each type's rows for this customer only (not entire table), then global sort + slice.
    // This is correct global pagination (not per-table page1 concat) and is bounded because queries are filtered by customer_id / wallet_ids / phones.
    // For single customer history, row count is O(hundreds) and stays within limit.
    const allRows: Array<any> = [];

    if (shouldInclude('WALLET_TRANSFER') && walletIds.length > 0) {
      const rows: Array<any> = await this.dataSource.query(
        `SELECT id::text as id, 'WALLET_TRANSFER'::text as type, status::text as status, amount_minor::text as amount_minor, currency::text as currency, created_at, completed_at, reference::text as reference, narration::text as narration, source_wallet_id::text as source_wallet_id, destination_wallet_id::text as destination_wallet_id, failure_code::text as failure_code, failure_message::text as failure_message FROM transfers WHERE source_wallet_id = ANY($1::uuid[]) OR destination_wallet_id = ANY($1::uuid[]) ORDER BY created_at DESC, id DESC`,
        [walletIds],
      );
      for (const r of rows) {
        r.fee_minor = '0';
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
    if (shouldInclude('CASH_TO_CASH')) {
      let rows: Array<any>;
      if (canonicalPhones.length > 0) {
        rows = await this.dataSource.query(
          `SELECT id::text as id, 'CASH_TO_CASH'::text as type, status::text as status, principal_minor::text as amount_minor, currency::text as currency, created_at, claimed_at as completed_at, reference::text as reference, null::text as narration, null::text as source_wallet_id, null::text as destination_wallet_id, beneficiary_phone::text as beneficiary_phone, null::text as external_reference, null::text as channel, fee_minor::text as fee_minor, expires_at, claimed_at, expired_at, claimant_customer_id::text as claimant_customer_id, agent_id::text as agent_id, null::text as failure_code FROM cash_to_cash_transfers WHERE claimant_customer_id=$1::uuid OR beneficiary_phone = ANY($2) ORDER BY created_at DESC, id DESC`,
          [customerId, canonicalPhones],
        );
      } else {
        rows = await this.dataSource.query(
          `SELECT id::text as id, 'CASH_TO_CASH'::text as type, status::text as status, principal_minor::text as amount_minor, currency::text as currency, created_at, claimed_at as completed_at, reference::text as reference, null::text as narration, null::text as source_wallet_id, null::text as destination_wallet_id, beneficiary_phone::text as beneficiary_phone, null::text as external_reference, null::text as channel, fee_minor::text as fee_minor, expires_at, claimed_at, expired_at, claimant_customer_id::text as claimant_customer_id, agent_id::text as agent_id, null::text as failure_code FROM cash_to_cash_transfers WHERE claimant_customer_id=$1::uuid ORDER BY created_at DESC, id DESC`,
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
          `SELECT id::text as id, customer_id::text as customer_id, currency::text as currency FROM wallet_accounts WHERE id = ANY($1::uuid[])`,
          [counterpartyWalletIds],
        );
        for (const w of cpWallets) walletMap.set(w.id, w);
        const customerIds = [...new Set(cpWallets.map((w) => w.customer_id).filter(Boolean))] as string[];
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
      let counterparty: any = null;
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
        const cpWallet = counterpartyWalletId ? walletMap.get(counterpartyWalletId) ?? null : null;
        const cpCustomerId = cpWallet?.customer_id ?? null;
        const cpProfile = cpCustomerId ? profileMap.get(cpCustomerId) ?? null : null;
        const cpContact = cpCustomerId ? contactMap.get(cpCustomerId) ?? null : null;
        counterparty = counterpartyWalletId
          ? {
              walletId: counterpartyWalletId,
              customerId: cpCustomerId,
              displayName: cpProfile?.display_name ?? null,
              receivingNumber: cpContact?.normalized_value ?? cpContact?.value ?? null,
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
          counterparty = { type: 'AGENT', agentId: r.agent_id, beneficiaryPhone: r.beneficiary_phone };
        } else if (phoneSet.has(r.beneficiary_phone)) {
          if (r.status === 'UNCLAIMED') direction = 'PENDING';
          else if (r.status === 'CLAIMED') direction = r.claimant_customer_id === customerId ? 'RECEIVED' : 'UNKNOWN';
          else if (r.status === 'EXPIRED') direction = 'EXPIRED';
          else direction = 'PENDING';
          counterparty = { type: 'AGENT', agentId: r.agent_id, beneficiaryPhone: r.beneficiary_phone };
        } else {
          direction = 'UNKNOWN';
          counterparty = { beneficiaryPhone: r.beneficiary_phone, agentId: r.agent_id };
        }
        if (r.status === 'FAILED' || r.status === 'REJECTED') {
          failureCode = r.failure_code ?? failureCode;
        }
      } else if (r.type === 'CASH_IN') {
        direction = 'CREDIT';
        // hide internal workforce: only expose type AGENT, not teller identity
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
      if (r.type === 'FUNDING' && r.status === 'REJECTED' && (r as any).rejected_at) {
        completedAt = new Date((r as any).rejected_at);
      } else if (r.type === 'FUNDING' && r.status === 'APPROVED' && (r as any).approved_at) {
        completedAt = new Date((r as any).approved_at);
      }

      // Safe projection: hide PIN/OTP/hash/journalId/ledgerAccountId/internal workforce, expose feeMinor as 0 where V1 has no fee ledger
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
        sourceWalletId,
        destinationWalletId,
        counterparty,
        failureCode,
        failureMessage,
      };
    });

    return {
      items,
      pagination: { page: normalizedPage, limit: normalizedLimit, total, totalPages, hasNextPage: normalizedPage < totalPages },
    };
  }
}
