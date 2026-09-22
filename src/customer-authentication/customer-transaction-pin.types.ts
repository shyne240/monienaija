export interface CreateTransactionPinCommand {
  pin: string;
  actor: string;
}

export interface ChangeTransactionPinCommand {
  currentPin: string;
  newPin: string;
  actor: string;
}

export interface ResetTransactionPinCommand {
  /** Recovery authorization: the customer's current secret used as the recovery factor. */
  password: string;
  newPin: string;
  actor: string;
}

export interface UnlockTransactionPinCommand {
  actor: string;
  reason?: string;
}

export interface VerifyTransactionPinCommand {
  pin: string;
  actor: string;
}

/**
 * Safe external view of a customer's transaction PIN state. NEVER contains
 * the PIN, the PIN hash, or any hash material.
 */
export interface TransactionPinStatusView {
  configured: boolean;
  accountLocked: boolean;
  failedPinAttemptCount: number;
  pinVersion: number | null;
  lockedAt: Date | null;
  changedAt: Date | null;
}
