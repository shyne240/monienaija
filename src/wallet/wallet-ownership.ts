import { ForbiddenException, NotFoundException } from '@nestjs/common';

import type {
  AuthorizationPrincipal,
  AuthorizationPrincipalType,
} from '../authorization/authorization.types';

/**
 * Principal types that are not authenticated customers. Internal principals act under the
 * workforce/internal authority granted to them by the route policy (`internal:access` or the
 * A2 workforce roles), never under a customer identity.
 */
export type InternalPrincipalType = Exclude<AuthorizationPrincipalType, 'CUSTOMER'>;

/**
 * Explains who a wallet-backed operation is being performed for.
 *
 * This binding is always derived from the authenticated principal by the HTTP layer - it is never
 * taken from request input. The movement services require it so that a wallet id supplied by a
 * caller can never, on its own, authorise an operation on a wallet that belongs to somebody else.
 */
export type WalletOwnershipBinding =
  | { readonly kind: 'CUSTOMER_SELF'; readonly customerId: string }
  | {
      readonly kind: 'INTERNAL';
      readonly principalId: string;
      readonly principalType: InternalPrincipalType;
    };

/**
 * Derives the ownership binding from the principal established by `RuntimeAccessGuard`.
 */
export function walletOwnershipBinding(principal: AuthorizationPrincipal): WalletOwnershipBinding {
  if (principal.type === 'CUSTOMER') {
    if (!principal.customerId) {
      throw new ForbiddenException('Customer principal is missing a customer id');
    }
    return { kind: 'CUSTOMER_SELF', customerId: principal.customerId };
  }
  return { kind: 'INTERNAL', principalId: principal.principalId, principalType: principal.type };
}

/**
 * Returns the authenticated customer id for customer principals, or `null` for internal principals.
 * Callers use the result to choose the customer-scoped read path; it is never taken from input.
 */
export function customerSelfId(principal: AuthorizationPrincipal): string | null {
  if (principal.type !== 'CUSTOMER') {
    return null;
  }
  if (!principal.customerId) {
    throw new ForbiddenException('Customer principal is missing a customer id');
  }
  return principal.customerId;
}

/**
 * Enforces the binding against the owning customer recorded on the wallet row.
 *
 * Cross-customer access is reported as "wallet not found" so that a caller cannot use the response
 * to enumerate wallets that belong to other customers.
 */
export function assertWalletOwnership(
  binding: WalletOwnershipBinding,
  walletCustomerId: string | null | undefined,
): void {
  if (binding.kind === 'CUSTOMER_SELF' && walletCustomerId !== binding.customerId) {
    throw new NotFoundException('Wallet was not found');
  }
}
