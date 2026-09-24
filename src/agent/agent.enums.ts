/**
 * V1 Agent lifecycle status.
 *
 * The four values are established by `docs/AUTHORITATIVE-V1-PRODUCT-SCOPE.md`
 * §11.2 and are therefore recorded, not invented, by this Stage 1 work.
 * ADR-0093 §8.6 fixes only that the column exists and is Agent-authoritative.
 *
 * Stage 1 creates every Agent as PENDING and implements NO status transition.
 * Transitions are the Agent application/review/approval workflow, which is
 * explicitly out of Stage 1 scope and is owned by B5 under the approved
 * ownership split in `docs/V1-AGENT-ROADMAP-RECONCILIATION.md` §7.
 */
export enum AgentStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  TERMINATED = 'TERMINATED',
}

/** F-2 — lifecycle of the Agent's dedicated e-float wallet registry record. */
export enum AgentWalletStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  CLOSED = 'CLOSED',
}

/** F-2 — lifecycle of the Agent financial-account binding. */
export enum AgentFinancialAccountBindingState {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  CLOSED = 'CLOSED',
}
