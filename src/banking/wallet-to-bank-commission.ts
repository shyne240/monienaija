import type { EntityManager } from 'typeorm';

import type { AccountingOutcome } from '../commercial-accounting/commercial-accounting.service';
import { annotateCommissionDecisionWithPosting } from '../commercial-accounting/commercial-decision-accounting.annotators';
import type { CommissionEngine } from '../commission/commission.engine';
import {
  commissionAllocatedAtAccountingBoundary,
  commissionFeeBasisMinor,
  commissionFeeCollectionStateOf,
  commissionNone,
} from '../commercial-decision/commercial-decision.defaults';
import type { CommissionDecisionSnapshot } from '../commercial-decision/commercial-decision-snapshot.entity';
import type { CommercialDecisionSnapshotService } from '../commercial-decision/commercial-decision-snapshot.service';
import { bankingIdentityFor } from '../product-catalog/banking-product-identities';

/**
 * PR #27 — wallet→bank commission, decided at SETTLEMENT.
 *
 * ## Why settlement, and only settlement
 *
 * A wallet→bank commitment is authorized (`RESERVED`) long before anybody knows whether the money
 * actually left. Between authorization and settlement it can still be released, rejected or left
 * unresolved. Accruing an agent commission at authorization would:
 *
 *  - create a payable for a transfer that may never complete (premature), and
 *  - require reversal accounting when it is released or rejected (a second decision about money that
 *    never moved).
 *
 * So the decision is bound to the one event that proves the transfer completed: the transition
 * `financial_commitments.state: RESERVED → SETTLED`, which happens inside the settlement transaction
 * immediately after the provider outcome is independently verified. Three guarantees follow from that
 * placement, none of which need new machinery:
 *
 *  - **pending never accrues** — a `RESERVED` commitment has no snapshot and no payable;
 *  - **failed / released never accrues** — the release path never calls this, and it cannot be reached
 *    from it;
 *  - **replay never duplicates** — a second settlement is refused as `DUPLICATE_SETTLEMENT` before
 *    this point is reached, and the snapshot is additionally idempotent by key
 *    (`wallet-to-bank:<commitmentId>`), so even a racing caller cannot insert a second row.
 *
 * ## Recipient attribution
 *
 * The acting agent is the commitment's principal (`financial_authorizations.agent_id`, read in the
 * same locked transaction) along with that agent's class. A customer-initiated commitment supplies
 * neither, so agent-class-targeted rules correctly do not match — that is *attribution*, not a gap.
 *
 * ## What is decided, and what is only recorded
 *
 * `CommissionEngine` decides; this module never computes an amount. If the decision is `NONE`, an
 * explicit no-commission snapshot is recorded so "we evaluated and found nothing" is distinguishable
 * from "nobody evaluated it". If it is `ALLOCATED`, the snapshot carries the allocations with
 * `payable: false` and explicit blockers — V1 has no commission settlement rail, and saying so is
 * more honest than implying a liability exists. The accounting treatment (real accrual legs) is
 * posted by `CommercialAccountingService` only when that subsystem is enabled; it is invoked by the
 * caller, not here, so this module stays a pure decision recorder.
 */
export interface WalletToBankCommissionInput {
  readonly commitmentId: string;
  readonly currency: string;
  /** Total authorized debit in minor units — the commission base when a rule uses PRINCIPAL. */
  readonly principalAmountMinor: string;
  readonly journalId: string | null;
  readonly correlationId: string | null;
  /** Evaluation instant; passed in so a decision is reproducible from its inputs. */
  readonly decidedAt: Date;
}

export interface WalletToBankCommissionOutcome {
  readonly commissionDecision: CommissionDecisionSnapshot;
  /** `true` when a snapshot row already existed for this commitment (a replay, not a new decision). */
  readonly replayed: boolean;
  /** The recipient the decision was evaluated for, or null when no agent was acting. */
  readonly agentId: string | null;
}

interface CommitmentPrincipalRow {
  principal_type: 'CUSTOMER' | 'AGENT';
  principal_id: string;
  agent_class_id: string | null;
}

export class WalletToBankCommissionUnavailableError extends Error {
  constructor(message: string) {
    super(`WALLET_TO_BANK_COMMISSION_UNAVAILABLE: ${message}`);
    this.name = 'WalletToBankCommissionUnavailableError';
  }
}

/**
 * Resolve the acting agent for a settled commitment, inside the caller's locked transaction.
 *
 * Returns null for a customer-initiated commitment. A commitment whose authorization row is missing is
 * a data-integrity failure, not "no agent": throwing keeps a corrupted row from silently skipping
 * commission.
 */
async function resolveActingAgent(
  manager: EntityManager,
  commitmentId: string,
): Promise<{
  agentId: string | null;
  agentClassId: string | null;
  principalType: string;
  principalId: string;
  payerLedgerAccountId: string;
}> {
  const rows = await manager.query<
    Array<CommitmentPrincipalRow & { payer_ledger_account_id: string }>
  >(
    `SELECT fa.principal_type,
            fa.principal_id::text AS principal_id,
            a.agent_class_id::text AS agent_class_id,
            w.ledger_account_id::text AS payer_ledger_account_id
       FROM financial_commitments fc
       JOIN financial_authorizations fa ON fa.id = fc.authorization_id
       LEFT JOIN agents a ON a.id = fa.agent_id
       JOIN withdrawals wd ON wd.id = fc.withdrawal_id
       JOIN wallet_accounts w ON w.id = wd.wallet_id
      WHERE fc.id = $1
      LIMIT 1`,
    [commitmentId],
  );
  const row = rows[0];
  if (!row) {
    throw new WalletToBankCommissionUnavailableError(
      'the settled commitment has no financial authorization to attribute',
    );
  }
  const base = {
    principalType: row.principal_type,
    principalId: row.principal_id,
    payerLedgerAccountId: row.payer_ledger_account_id,
  };
  if (row.principal_type !== 'AGENT') {
    return { ...base, agentId: null, agentClassId: null };
  }
  return { ...base, agentId: row.principal_id, agentClassId: row.agent_class_id };
}

/**
 * Evaluate and record the commission decision for a settled wallet→bank transfer.
 *
 * Must be called inside the settlement transaction, after the commitment has moved to `SETTLED` and
 * its journal exists, so the snapshot's `journalId` and `transactionReference` are final. Every
 * dependency is passed in rather than injected, which keeps this free of module-level coupling and
 * makes it directly testable.
 */
export async function recordWalletToBankCommissionInTransaction(
  deps: {
    commissionEngine: CommissionEngine;
    snapshots: CommercialDecisionSnapshotService;
    /**
     * `service_fee_minor + tax_minor` from the settled binding, or **null** when no approved rule
     * priced the route. Null is `NOT_CONFIGURED`, and must never be coerced to "0".
     */
    settledFeeMinor: string | null;
    /**
     * Approved-decision accounting. Absent or disabled ⇒ no journal legs are posted and the decision
     * snapshot says so; it is never silently implied that a payable was raised.
     */
    accounting?: {
      isEnabled(): boolean;
      postForCompletion(
        manager: EntityManager,
        input: {
          productCode: string;
          currency: string;
          baseIdempotencyKey: string;
          correlationId: string | null;
          reference: string | null;
          snapshotIdempotencyKey: string;
          metadata: Record<string, unknown>;
          feePayerLedgerAccountId?: string | null;
          feePayerCustomerId: string;
          feeDecision: Record<string, unknown>;
          commissionDecision: Record<string, unknown>;
        },
      ): Promise<AccountingOutcome>;
    };
  },
  manager: EntityManager,
  input: WalletToBankCommissionInput,
): Promise<WalletToBankCommissionOutcome> {
  // This helper prices exactly one route. Reading the canonical identity rather than hard-coding the
  // string keeps it impossible for this and the catalogue to drift apart.
  const identity = bankingIdentityFor('WALLET_TO_BANK');
  if (!identity || identity.direction !== 'OUTGOING') {
    throw new WalletToBankCommissionUnavailableError(
      'the canonical wallet→bank identity is missing or misconfigured',
    );
  }
  const product = identity.productCode;

  const { agentId, agentClassId, principalId, payerLedgerAccountId } = await resolveActingAgent(
    manager,
    input.commitmentId,
  );

  // Three distinct fee realities, kept distinct: unpriced (no binding), explicitly free (bound zero),
  // and charged (bound non-zero). Collapsing unpriced into zero would state a tariff that no rule made.
  const feeMinor = deps.settledFeeMinor;
  const feeDecisionEvidence =
    feeMinor === null
      ? { status: 'NOT_CONFIGURED', feeMinor: null }
      : { status: BigInt(feeMinor) > 0n ? 'APPLIED' : 'ZERO', feeMinor };

  let commissionDecision: CommissionDecisionSnapshot = commissionNone();
  const engineDecision = await deps.commissionEngine.decideWithManager(
    manager,
    {
      productCode: product,
      currency: input.currency,
      // An agent-initiated transfer has an acting agent; a customer's does not, and passing null keeps
      // agent-targeted rules from matching a transfer no agent performed.
      agentId,
      agentClassId,
      aggregatorId: null,
      at: input.decidedAt,
    },
    {
      principalMinor: input.principalAmountMinor,
      feeMinor: commissionFeeBasisMinor(feeDecisionEvidence as never),
    },
  );

  if (engineDecision.status === 'ALLOCATED') {
    // The engine leaves `beneficiaryId` null when the rule targets a CLASS rather than an identity.
    // For a settled transfer the acting agent is the only possible recipient of their own transfer's
    // commission, so attribution fills it in — the same rule `transfer.service.ts` applies.
    const attributed = (engineDecision.allocations ?? []).map((allocation) =>
      allocation.beneficiaryType === 'AGENT' && !allocation.beneficiaryId && agentId
        ? { ...allocation, beneficiaryId: agentId }
        : allocation,
    );
    commissionDecision = commissionAllocatedAtAccountingBoundary(
      {
        ...engineDecision,
        allocations: attributed,
        // A zero-amount allocation is an authored rule that computes to nothing. Recording it keeps
        // "explicit zero" distinct from "no rule"; the accounting layer additionally refuses to post
        // zero-amount legs.
      } as CommissionDecisionSnapshot,
      {
        feeCollectionState: commissionFeeCollectionStateOf(feeDecisionEvidence as never),
        commissionEvent: 'TRANSACTION_COMPLETION',
      },
    );
  }

  // Approved-decision accounting (real DR commission expense / CR payable, or wallet netting). Only
  // when the operator enabled it: the service posts nothing and raises no payable otherwise, and the
  // snapshot below then keeps `payable: false` with its blockers rather than implying a liability.
  let accountingOutcome: AccountingOutcome | null = null;
  if (deps.accounting?.isEnabled()) {
    accountingOutcome = await deps.accounting.postForCompletion(manager, {
      productCode: product,
      currency: input.currency,
      baseIdempotencyKey: `wallet-to-bank:${input.commitmentId}`,
      correlationId: input.correlationId,
      reference: input.commitmentId,
      snapshotIdempotencyKey: `wallet-to-bank:${input.commitmentId}`,
      metadata: {
        flow: 'WALLET_TO_BANK',
        commitmentId: input.commitmentId,
        journalId: input.journalId,
        agentId,
      },
      // The exact wallet debited by the settlement journal. Resolving by owner id instead would be
      // ambiguous for an agent, whose wallet is not selected by customer_id alone.
      feePayerLedgerAccountId: payerLedgerAccountId,
      feePayerCustomerId: principalId,
      feeDecision: feeDecisionEvidence as unknown as Record<string, unknown>,
      commissionDecision: commissionDecision as unknown as Record<string, unknown>,
    });
    commissionDecision = annotateCommissionDecisionWithPosting(
      commissionDecision as unknown as Record<string, unknown>,
      accountingOutcome,
      { commissionEvent: 'TRANSACTION_COMPLETION' },
    ) as unknown as CommissionDecisionSnapshot;
  }

  const recorded = await deps.snapshots.recordDecisionWithManager(manager, {
    // Idempotent by commitment: the settlement path is already single-shot, and this makes a racing
    // second caller replay rather than double-record.
    idempotencyKey: `wallet-to-bank:${input.commitmentId}`,
    product,
    direction: 'OUTGOING',
    channel: null,
    principalType: agentId ? 'AGENT' : 'CUSTOMER',
    principalId: principalId,
    currency: input.currency,
    principalAmountMinor: input.principalAmountMinor,
    // The canonical transaction reference for this direction is the commitment (PR #23).
    transactionReference: input.commitmentId,
    correlationId: input.correlationId,
    journalId: input.journalId,
    decisionStatus: 'FINAL',
    decidedAt: input.decidedAt,
    finalizedAt: input.decidedAt,
    feeDecision: {
      status: feeDecisionEvidence.status,
      feeMinor,
      currency: input.currency,
      // No fee RULE evidence is re-read here: the settled binding is authoritative for the amount and
      // this snapshot records what was actually settled, not a re-resolution of it.
      note: 'Fee taken from the settled banking operation binding; never re-resolved at settlement.',
    } as never,
    commissionDecision: commissionDecision as never,
    rewardDecision: { status: 'NONE', grants: [], ruleRefs: [] } as never,
    limitDecision: {
      status: 'APPROVED',
      // The limit decision was taken at authorization; it is recorded here as evidence of admission,
      // not re-evaluated. Re-running it at settlement would double-count the daily window.
      note: 'Limit admission occurred at authorization; not re-evaluated at settlement.',
    } as never,
    revenueDecision: null,
    configurationVersion: null,
    createdBy: 'wallet-to-bank-settlement',
  });

  return {
    commissionDecision,
    replayed: recorded.replayed,
    agentId,
  };
}
