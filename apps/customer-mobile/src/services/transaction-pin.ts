import { ApiClient, ApiError } from './api-client';

/**
 * Customer transaction PIN API surface.
 *
 * The PIN travels only inside authenticated request bodies; it is hashed
 * server-side and NEVER returned. Plaintext PINs are never written to
 * SecureStorage, the global store, logs, or analytics by this module.
 */

export interface TransactionPinStatus {
  configured: boolean;
  accountLocked: boolean;
  failedPinAttemptCount: number;
  pinVersion: number | null;
  lockedAt: string | null;
  changedAt: string | null;
}

export type PinErrorKind =
  | 'NOT_CONFIGURED'
  | 'INCORRECT'
  | 'LOCKED'
  | 'MALFORMED'
  | 'RECOVERY_FAILED'
  | 'DUPLICATE'
  | 'UNKNOWN';

export interface ClassifiedPinError {
  kind: PinErrorKind;
  message: string;
}

const ACTOR = 'customer-mobile';

/**
 * Maps API rejections to PIN semantics. Classification is message-scoped:
 * transfer/withdrawal endpoints also return 4xx for NON-PIN reasons (missing
 * destination, insufficient balance, idempotency conflict), and those must
 * stay UNKNOWN so their original server message reaches the screen banner.
 */
export function classifyPinError(error: unknown): ClassifiedPinError {
  if (error instanceof ApiError) {
    const text = `${error.message}`.toLowerCase();
    const pinFlavored = text.includes('pin');
    if (error.status === 404 && pinFlavored) {
      return {
        kind: 'NOT_CONFIGURED',
        message: 'No transaction PIN is set up yet. Create one from Profile → Security.',
      };
    }
    if (error.status === 409 && pinFlavored) {
      return {
        kind: 'DUPLICATE',
        message: 'A transaction PIN already exists. Use Change PIN instead.',
      };
    }
    if (error.status === 401) {
      if (text.includes('recovery')) {
        return {
          kind: 'RECOVERY_FAILED',
          message: 'Recovery failed: the password you entered is incorrect.',
        };
      }
      if (pinFlavored) {
        return { kind: 'INCORRECT', message: 'Incorrect transaction PIN. Please try again.' };
      }
    }
    if (error.status === 400 && pinFlavored) {
      return { kind: 'MALFORMED', message: 'Transaction PINs are 4 to 6 digits, numbers only.' };
    }
    if (error.status === 403) {
      if (text.includes('locked')) {
        return {
          kind: 'LOCKED',
          message:
            'Your transaction PIN is locked after too many attempts. Reset it from Profile → Security.',
        };
      }
      if (pinFlavored) {
        return { kind: 'LOCKED', message: 'Your transaction PIN is not active. Reset it to continue.' };
      }
    }
  }
  return {
    kind: 'UNKNOWN',
    message: error instanceof Error ? error.message : 'Something went wrong. Please try again.',
  };
}

export async function getPinStatus(customerId: string): Promise<TransactionPinStatus> {
  return ApiClient.get<TransactionPinStatus>(`/customers/${customerId}/transaction-pin/status`);
}

export async function createPin(customerId: string, pin: string): Promise<TransactionPinStatus> {
  return ApiClient.post<TransactionPinStatus>(`/customers/${customerId}/transaction-pin`, {
    pin,
    actor: ACTOR,
  });
}

export async function changePin(
  customerId: string,
  currentPin: string,
  newPin: string,
): Promise<TransactionPinStatus> {
  return ApiClient.post<TransactionPinStatus>(`/customers/${customerId}/transaction-pin/change`, {
    currentPin,
    newPin,
    actor: ACTOR,
  });
}

export async function resetPin(
  customerId: string,
  password: string,
  newPin: string,
): Promise<TransactionPinStatus> {
  return ApiClient.post<TransactionPinStatus>(`/customers/${customerId}/transaction-pin/reset`, {
    password,
    newPin,
    actor: ACTOR,
  });
}
