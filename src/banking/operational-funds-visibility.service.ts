import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Operational visibility for money that has arrived but has not been credited.
 *
 * Every query here is read-only and every one is a *question operations actually asks*, phrased so
 * that the answer cannot be mistaken for a balance:
 *
 *   - verified inbound funds that no authorized route credited;
 *   - agent float awaiting credit under a funding policy;
 *   - outbound commitments whose provider outcome is not yet resolved;
 *   - provider success without settlement evidence;
 *   - unmatched provider references;
 *   - open reconciliation exceptions;
 *   - unsupported return and refund requests.
 *
 * Two rules the shape of this service enforces:
 *
 * 1. **Nothing here can move money.** There is no update, no delete, no resolve. Closing an
 *    obligation is a governed action in the owning domain; an operator console that could also
 *    credit would be a way to move funds without authorization.
 * 2. **Absence of evidence is reported as absence, not as zero.** Where a capability is deliberately
 *    unsupported (settlement verification, provider balance, refunds), the response says
 *    `UNSUPPORTED` with the reason rather than returning an empty list that reads as "all clear".
 *    An empty list and an unavailable source mean completely different things to someone deciding
 *    whether to escalate.
 */
export interface UnresolvedFundsSummary {
  readonly institutionId: string;
  readonly generatedAt: string;
  readonly sources: readonly OperationalSource[];
  readonly totals: {
    /** Count of verified inbound payments that exist and have no credit behind them. */
    readonly verifiedUncreditedInbound: number;
    readonly agentFloatAwaitingCredit: number;
    readonly unresolvedOutboundCommitments: number;
    readonly openReconciliationExceptions: number;
    readonly unsupportedRequests: number;
  };
}

export interface OperationalSource {
  readonly key: string;
  readonly state: 'AVAILABLE' | 'UNSUPPORTED';
  readonly reason?: string;
  readonly count?: number;
  readonly items?: readonly Record<string, unknown>[];
}

@Injectable()
export class OperationalFundsVisibilityService {
  constructor(private readonly db: DataSource) {}

  /**
   * Everything outstanding for one institution.
   *
   * Scoped by institution deliberately: a platform-wide view is a different authority, and the
   * console that consumes this passes an explicit platform scope when it has one.
   */
  async unresolved(institutionId: string, limit = 50): Promise<UnresolvedFundsSummary> {
    const bounded = Math.min(Math.max(limit, 1), 200);
    const sources: OperationalSource[] = [];

    // --- verified inbound payments that never reached a credit --------------------------------
    // Two different sources on purpose. `banking_inbound_payments` is the banking provider's record
    // of a payment it verified; `inbound_funding_receipts` is the financial engine's record of a
    // credit it posted. A payment in the first with no receipt in the second is exactly the
    // "verified but not credited" state, and it is the one that costs a customer money if nobody
    // looks.
    const verifiedInbound = await this.query(
      `SELECT p.id::text AS id,
              p.provider_transaction_reference AS reference,
              p.currency,
              p.credited_amount_minor::text AS amount_minor,
              p.recorded_at,
              p.paid_at,
              CASE WHEN p.ledger_transaction_id IS NULL THEN 'UNCREDITED' ELSE 'CREDITED' END AS state
         FROM banking_inbound_payments p
        WHERE p.institution_id = $1
          AND p.verification_state = 'VERIFIED'
          AND p.ledger_transaction_id IS NULL
        ORDER BY p.recorded_at
        LIMIT $2`,
      [institutionId, bounded],
    );
    sources.push({
      key: 'VERIFIED_INBOUND_NOT_CREDITED',
      state: 'AVAILABLE',
      count: verifiedInbound.length,
      items: verifiedInbound,
    });

    // --- agent float that the provider confirmed but no policy credited ------------------------
    const floatAwaiting = await this.query(
      `SELECT o.id::text AS id,
              o.provider_transaction_reference AS reference,
              o.currency,
              o.amount_minor::text AS amount_minor,
              o.reason,
              o.status,
              o.first_observed_at
         FROM agent_float_funding_obligations o
        WHERE o.institution_id = $1 AND o.status IN ('OPEN','UNDER_REVIEW')
        ORDER BY o.first_observed_at
        LIMIT $2`,
      [institutionId, bounded],
    );
    sources.push({
      key: 'AGENT_FLOAT_AWAITING_CREDIT',
      state: 'AVAILABLE',
      count: floatAwaiting.length,
      items: floatAwaiting,
    });

    // --- outbound work whose outcome is not resolved ------------------------------------------
    const outbound = await this.query(
      `SELECT o.id::text AS id,
              o.operation_reference AS reference,
              o.provider_key,
              o.currency,
              o.amount_minor::text AS amount_minor,
              o.state,
              o.provider_status,
              o.attempts,
              o.created_at
         FROM banking_outbound_operations o
        WHERE o.institution_id = $1
          AND o.state NOT IN ('SUCCESSFUL','FAILED','CANCELLED','REVERSED')
        ORDER BY o.created_at
        LIMIT $2`,
      [institutionId, bounded],
    );
    sources.push({
      key: 'UNRESOLVED_OUTBOUND',
      state: 'AVAILABLE',
      count: outbound.length,
      items: outbound,
    });

    // --- reconciliation exceptions, which are NOT settlement -----------------------------------
    const exceptions = await this.query(
      `SELECT e.id::text AS id, e.kind, e.state, e.severity, e.subject_reference,
              e.detail, e.created_at
         FROM banking_reconciliation_exceptions e
        WHERE e.institution_id = $1 AND e.state IN ('OPEN','INVESTIGATING')
        ORDER BY e.created_at
        LIMIT $2`,
      [institutionId, bounded],
    );
    sources.push({
      key: 'OPEN_RECONCILIATION_EXCEPTIONS',
      state: 'AVAILABLE',
      count: exceptions.length,
      items: exceptions,
    });

    // --- deliberately unsupported, reported as such -------------------------------------------
    // These are not empty lists. An empty list would read as "no discrepancies found", which is a
    // claim this deployment cannot make because it has no provider contract to make it on.
    sources.push({
      key: 'PROVIDER_SETTLEMENT_EVIDENCE',
      state: 'UNSUPPORTED',
      reason:
        'No provider settlement or balance contract is implemented. Monnify does not publish an ' +
        'authoritative settlement-lines or provider-balance endpoint this platform can verify, and ' +
        'inventing one would produce numbers that look authoritative and are not. Provider ' +
        'success, provider-held funds and institutional settlement remain distinct states.',
    });
    sources.push({
      key: 'PROVIDER_BALANCE',
      state: 'UNSUPPORTED',
      reason:
        'Provider balance enquiry is deliberately not implemented. The deprecated endpoint is ' +
        'refused rather than guessed, so no balance is reported here at all.',
    });
    sources.push({
      key: 'REFUND_AND_RETURN',
      state: 'UNSUPPORTED',
      reason:
        'No provider refund or return contract is implemented. Return and refund requests are ' +
        'preserved as unsupported obligations for manual handling; there is no route that could ' +
        'silently originate one.',
    });

    return {
      institutionId,
      generatedAt: new Date().toISOString(),
      sources,
      totals: {
        verifiedUncreditedInbound: verifiedInbound.length,
        agentFloatAwaitingCredit: floatAwaiting.length,
        unresolvedOutboundCommitments: outbound.length,
        openReconciliationExceptions: exceptions.length,
        unsupportedRequests: sources.filter((s) => s.state === 'UNSUPPORTED').length,
      },
    };
  }

  /**
   * Integrity-relevant counts across the whole platform, for the readiness and monitoring surfaces.
   *
   * Deliberately aggregate-only: no amounts, no references, no customer identifiers. It answers
   * "is anything stuck" without becoming a second copy of the financial database.
   */
  async platformPressure(): Promise<Record<string, number>> {
    const rows = await this.query(
      `SELECT
         (SELECT count(*) FROM banking_inbound_payments
           WHERE verification_state='VERIFIED' AND ledger_transaction_id IS NULL)::int
           AS verified_uncredited_inbound,
         (SELECT count(*) FROM agent_float_funding_obligations
           WHERE status IN ('OPEN','UNDER_REVIEW'))::int AS agent_float_obligations,
         (SELECT count(*) FROM banking_outbound_operations
           WHERE state NOT IN ('SUCCESSFUL','FAILED','CANCELLED','REVERSED'))::int
           AS unresolved_outbound,
         (SELECT count(*) FROM banking_reconciliation_exceptions
           WHERE state IN ('OPEN','INVESTIGATING'))::int AS open_exceptions`,
      [],
    );
    const row = rows[0] ?? {};
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value ?? 0)]));
  }

  private async query(sql: string, parameters: unknown[]): Promise<Record<string, unknown>[]> {
    const result: unknown = await this.db.query(sql, parameters);
    return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
  }
}
