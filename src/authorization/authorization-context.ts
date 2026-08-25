import { AsyncLocalStorage } from 'node:async_hooks';

import type { AuthorizationPrincipal } from './authorization.types';

export interface AuthorizationContext {
  principal: AuthorizationPrincipal;
  source: 'http-request' | 'system' | 'internal-service';
  reason?: string;
}

export interface SystemAuthorizationContext {
  principal: AuthorizationPrincipal;
  source: 'system';
  reason: string;
}

/**
 * AsyncLocalStorage for propagating authorization context through the call stack.
 * This ensures that every financial operation has access to the authenticated principal
 * without requiring it to be passed explicitly through every method signature.
 */
const authorizationContextStorage = new AsyncLocalStorage<AuthorizationContext | undefined>();

/**
 * Get the current authorization context.
 * Returns undefined if no context is set (e.g., outside of a request).
 */
export function getAuthorizationContext(): AuthorizationContext | undefined {
  return authorizationContextStorage.getStore();
}

/**
 * Get the current authorization context, throwing if not set.
 * Use this in financial services to enforce that authorization context exists.
 */
export function requireAuthorizationContext(): AuthorizationContext {
  const context = getAuthorizationContext();
  if (!context) {
    throw new Error(
      'Authorization context is required for this operation. ' +
        'Ensure the request is authenticated or use runWithSystemContext() for internal calls.',
    );
  }
  return context;
}

/**
 * Get the current principal, throwing if not set.
 * Convenience wrapper around requireAuthorizationContext().
 */
export function requirePrincipal(): AuthorizationPrincipal {
  return requireAuthorizationContext().principal;
}

/**
 * Run a function with a specific authorization context.
 * Use this in controllers/interceptors to establish context from HTTP requests.
 */
export function runWithAuthorizationContext<T>(
  context: AuthorizationContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return authorizationContextStorage.run(context, fn);
}

/**
 * Run a function with a system authorization context.
 * Use this for internal service-to-service calls that are already authorized.
 *
 * @param reason - Human-readable reason for the system call (for audit)
 * @param principal - Optional system principal (defaults to a generic system principal)
 */
export function runWithSystemContext<T>(
  reason: string,
  fn: () => T | Promise<T>,
  principal?: AuthorizationPrincipal,
): T | Promise<T> {
  const systemPrincipal: AuthorizationPrincipal = principal ?? {
    type: 'SERVICE',
    principalId: 'system:internal-service',
    roles: [],
    scopes: ['internal:service-call'],
    customerAccess: 'NONE',
    assuranceLevel: 'PASSWORD',
  };

  const context: SystemAuthorizationContext = {
    principal: systemPrincipal,
    source: 'system',
    reason,
  };

  return authorizationContextStorage.run(context, fn);
}

/**
 * Check if the current context is a system context.
 * Use this to distinguish between user-initiated and system-initiated operations.
 */
export function isSystemContext(): boolean {
  const context = getAuthorizationContext();
  return context?.source === 'system';
}

/**
 * Clear the authorization context.
 * Use this in tests or when explicitly ending a request context.
 */
export function clearAuthorizationContext(): void {
  authorizationContextStorage.enterWith(undefined);
}
