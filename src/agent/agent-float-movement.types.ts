/**
 * F-5 — Agent float funding and defunding.
 *
 * INTERNAL LEDGER REPRESENTATION ONLY.
 *
 * These operations move the platform's internal accounting position between
 * the payment settlement asset and an Agent's e-float liability. They do NOT
 * assert that money moved through NIBSS, a bank or any provider, that an
 * external settlement was confirmed, or that the Agent handed over physical
 * cash. External provider integration remains frozen per `roadmap.md` rule 4,
 * and nothing here records an externally settled state.
 */

/** Direction of an Agent float movement. */
export enum AgentFloatMovementKind {
  /** Increases Agent e-float: DR settlement asset, CR Agent float. */
  FUNDING = 'FUNDING',
  /** Decreases Agent e-float: DR Agent float, CR settlement asset. */
  DEFUNDING = 'DEFUNDING',
}

export interface AgentFloatMovementCommand {
  agentId: string;
  /** Integer minor units, positive, NGN. Never a float. */
  amountMinor: string | number | bigint;
  /** Caller-supplied idempotency key; replays return the original journal. */
  idempotencyKey: string;
  /** Recorded on the immutable audit event. */
  actor: string;
  /** Operational justification, recorded for audit. */
  reason?: string;
  correlationId?: string;
  requestId?: string;
}

/**
 * Result of an Agent float movement.
 *
 * `balanceMinor` is read from the ledger after posting — it is never stored.
 * `externallySettled` is always `false`: this operation makes no claim about
 * external value movement, and the repository has no provider-confirmed
 * settlement state to record.
 */
export interface AgentFloatMovementView {
  kind: AgentFloatMovementKind;
  agentId: string;
  agentWalletId: string;
  walletAccountId: string;
  ledgerAccountId: string;
  settlementAccountId: string;
  currency: string;
  amountMinor: string;
  journalId: string;
  idempotencyKey: string;
  /** Agent e-float after the movement, read from the ledger authority. */
  balanceMinor: string;
  /** Always false. No external settlement is asserted by this operation. */
  externallySettled: false;
  postedAt: string;
}
