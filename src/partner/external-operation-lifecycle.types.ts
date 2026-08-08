import type { RequestContext } from '../production/request-context';
import type { ExternalOperationLifecycleState } from './external-operation-lifecycle.enums';
import type { ExternalOperationView } from './external-operation.types';

export const EXTERNAL_OPERATION_LIFECYCLE_IDEMPOTENCY_SCOPE = 'external.partner.lifecycle.v1';
export const EXTERNAL_OPERATION_MAX_ATTEMPTS = 3;

export interface TransitionExternalOperationCommand {
  externalOperationId: string;
  nextState: ExternalOperationLifecycleState;
  idempotencyKey: string;
  requestContext: RequestContext;
  expectedVersion?: number;
  providerStatus?: string | null;
  recoveryReference?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  failureStatusCode?: number | null;
  reason?: string | null;
}

export interface ExternalOperationLifecycleView extends ExternalOperationView {
  transitionReplayed: boolean;
}

export interface ExternalOperationStatusVerificationRequest {
  externalOperationId: string;
  externalOperationReference: string;
  providerIdempotencyKey: string;
  providerReferences: readonly ExternalOperationView['providerReferences'][number][];
  correlationId: string;
}

export interface ExternalOperationTransitionError {
  code:
    | 'INVALID_TRANSITION'
    | 'STALE_LIFECYCLE_VERSION'
    | 'RECOVERY_REFERENCE_REQUIRED'
    | 'RECOVERY_REFERENCE_MISMATCH'
    | 'RETRY_EXHAUSTED'
    | 'CIRCUIT_OPEN'
    | 'LIFECYCLE_TERMINAL'
    | 'LIFECYCLE_IDEMPOTENCY_CONFLICT'
    | 'STATUS_VERIFICATION_UNAVAILABLE';
  message: string;
}
