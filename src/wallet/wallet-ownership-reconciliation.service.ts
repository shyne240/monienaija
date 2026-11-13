import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type {
  WalletOwnershipReviewItem,
  WalletOwnershipReviewReport,
} from './wallet-ownership-resolution.types';
import { WalletOwnerClass, WalletOwnershipReviewReason } from './wallet-ownership-resolution.enums';

const MAX_ITEMS = 200;

interface ReviewRow {
  id: string;
  currency: string;
  status: string;
  owner_class: string;
  customer_id: string;
  reference_is_uuid: boolean;
  review_reason: string;
  ledger_account_id: string;
  balance_minor: string;
  colliding_wallet_id: string | null;
  created_at: Date;
}

interface ResolutionRow {
  wallet_id: string;
  resolution_class: string;
  previous_owner_ref: string;
  resolved_owner_ref: string;
  system_owner_code: string | null;
  evidence_type: string;
  evidence_reference: string;
  approval_id: string;
  executed_by: string;
  executed_at: Date;
}

/**
 * Administrative reconciliation visibility for wallet ownership.
 *
 * This is a read-only projection of the real rows — it never decides ownership, never mutates a
 * wallet, and exposes references only (no customer PII). It answers the operational questions the
 * previous state could not: which wallets are still `REVIEW` and therefore financially restricted,
 * WHY each one failed classification, how much ledger value is parked behind each restriction,
 * whether a canonical-owner collision is what blocks resolution, and which governed resolutions
 * have already been applied (with their approval, evidence type and executor).
 */
@Injectable()
export class WalletOwnershipReconciliationService {
  constructor(private readonly dataSource: DataSource) {}

  async getOwnershipReview(): Promise<WalletOwnershipReviewReport> {
    const rows = await this.dataSource.query<ReviewRow[]>(
      `SELECT w.id,
              w.currency,
              w.status,
              w.owner_class,
              w.customer_id,
              wallet_owner_ref_is_uuid(w.customer_id) AS reference_is_uuid,
              CASE
                WHEN w.owner_class <> 'REVIEW' THEN 'RESOLVED'
                WHEN NOT wallet_owner_ref_is_uuid(w.customer_id) THEN '${WalletOwnershipReviewReason.NON_CANONICAL_REFERENCE}'
                WHEN EXISTS (SELECT 1 FROM customers c WHERE c.id::text = lower(w.customer_id))
                 AND EXISTS (SELECT 1 FROM agents a WHERE a.id::text = lower(w.customer_id))
                  THEN '${WalletOwnershipReviewReason.AMBIGUOUS_CUSTOMER_AND_AGENT}'
                ELSE '${WalletOwnershipReviewReason.NO_AUTHORITATIVE_OWNER}'
              END AS review_reason,
              w.ledger_account_id,
              COALESCE((
                SELECT SUM(CASE WHEN l.direction = la.normal_balance THEN l.amount_minor
                                ELSE -l.amount_minor END)
                  FROM ledger_lines l
                  JOIN ledger_accounts la ON la.id = l.ledger_account_id
                 WHERE l.ledger_account_id = w.ledger_account_id
              ), 0)::text AS balance_minor,
              (
                SELECT other.id
                  FROM wallet_accounts other
                 WHERE wallet_owner_ref_is_uuid(w.customer_id)
                   AND lower(other.customer_id) = lower(w.customer_id)
                   AND other.currency = w.currency
                   AND other.id <> w.id
                 LIMIT 1
              ) AS colliding_wallet_id,
              w.created_at
         FROM wallet_accounts w
        WHERE w.owner_class = 'REVIEW'
        ORDER BY w.created_at, w.id
        LIMIT ${MAX_ITEMS}`,
    );

    const resolutionRows = await this.dataSource.query<ResolutionRow[]>(
      `SELECT wallet_id, resolution_class, previous_owner_ref, resolved_owner_ref,
              system_owner_code, evidence_type, evidence_reference, approval_id,
              executed_by, executed_at
         FROM governed_wallet_ownership_resolutions
        ORDER BY executed_at DESC, wallet_id
        LIMIT ${MAX_ITEMS}`,
    );

    const [counts] = await this.dataSource.query<
      Array<{
        total: number;
        unresolved: number;
        resolved: number;
        system: number;
        customer: number;
        agent: number;
        applied: number;
      }>
    >(
      `SELECT
         (SELECT count(*)::int FROM wallet_accounts) AS total,
         (SELECT count(*)::int FROM wallet_accounts WHERE owner_class = 'REVIEW') AS unresolved,
         (SELECT count(*)::int FROM wallet_accounts WHERE owner_class <> 'REVIEW') AS resolved,
         (SELECT count(*)::int FROM wallet_accounts WHERE owner_class = 'SYSTEM') AS system,
         (SELECT count(*)::int FROM wallet_accounts WHERE owner_class = 'CUSTOMER') AS customer,
         (SELECT count(*)::int FROM wallet_accounts WHERE owner_class = 'AGENT') AS agent,
         (SELECT count(*)::int FROM governed_wallet_ownership_resolutions) AS applied`,
    );

    const generatedAt = (
      await this.dataSource.query<Array<{ now: Date }>>('SELECT clock_timestamp() AS now')
    )[0]!.now;

    const unresolvedWallets: WalletOwnershipReviewItem[] = rows.map((row) => ({
      walletId: row.id,
      currency: row.currency,
      status: row.status,
      ownerClass: row.owner_class as WalletOwnerClass,
      ownerReference: row.customer_id,
      reviewReason: row.review_reason,
      ledgerAccountId: row.ledger_account_id,
      balanceMinor: row.balance_minor,
      referenceIsUuid: row.reference_is_uuid,
      collidingWalletId: row.colliding_wallet_id,
      financiallyRestricted: row.owner_class === 'REVIEW',
      createdAt: row.created_at,
    }));

    return {
      generatedAt,
      summary: {
        totalWallets: counts?.total ?? 0,
        unresolved: counts?.unresolved ?? 0,
        resolved: counts?.resolved ?? 0,
        // Every unresolved wallet is financially restricted by WalletFinancialBoundaryService.
        financiallyRestricted: counts?.unresolved ?? 0,
        byOwnerClass: {
          CUSTOMER: counts?.customer ?? 0,
          AGENT: counts?.agent ?? 0,
          REVIEW: counts?.unresolved ?? 0,
          SYSTEM: counts?.system ?? 0,
        },
        appliedResolutions: counts?.applied ?? 0,
      },
      unresolvedWallets,
      appliedResolutions: resolutionRows.map((row) => ({
        walletId: row.wallet_id,
        resolutionClass:
          row.resolution_class as WalletOwnershipReviewReport['appliedResolutions'][number]['resolutionClass'],
        previousOwnerReference: row.previous_owner_ref,
        resolvedOwnerReference: row.resolved_owner_ref,
        systemOwnerCode: row.system_owner_code,
        evidenceType:
          row.evidence_type as WalletOwnershipReviewReport['appliedResolutions'][number]['evidenceType'],
        evidenceReference: row.evidence_reference,
        approvalId: row.approval_id,
        executedBy: row.executed_by,
        executedAt: row.executed_at,
      })),
    };
  }
}
