export enum ExternalOperationLifecycleState {
  CREATED = 'CREATED',
  SUBMITTING = 'SUBMITTING',
  PENDING_PROVIDER = 'PENDING_PROVIDER',
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  UNKNOWN = 'UNKNOWN',
  MANUAL_REVIEW = 'MANUAL_REVIEW',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export const EXTERNAL_OPERATION_LIFECYCLE_TRANSITIONS: Readonly<
  Record<ExternalOperationLifecycleState, readonly ExternalOperationLifecycleState[]>
> = {
  [ExternalOperationLifecycleState.CREATED]: [
    ExternalOperationLifecycleState.SUBMITTING,
    ExternalOperationLifecycleState.FAILED,
    ExternalOperationLifecycleState.CANCELLED,
  ],
  [ExternalOperationLifecycleState.SUBMITTING]: [
    ExternalOperationLifecycleState.PENDING_PROVIDER,
    ExternalOperationLifecycleState.PENDING_VERIFICATION,
    ExternalOperationLifecycleState.UNKNOWN,
    ExternalOperationLifecycleState.FAILED,
  ],
  [ExternalOperationLifecycleState.PENDING_PROVIDER]: [
    ExternalOperationLifecycleState.PENDING_VERIFICATION,
    ExternalOperationLifecycleState.UNKNOWN,
    ExternalOperationLifecycleState.MANUAL_REVIEW,
    ExternalOperationLifecycleState.FAILED,
  ],
  [ExternalOperationLifecycleState.PENDING_VERIFICATION]: [
    ExternalOperationLifecycleState.SUBMITTING,
    ExternalOperationLifecycleState.UNKNOWN,
    ExternalOperationLifecycleState.MANUAL_REVIEW,
    ExternalOperationLifecycleState.FAILED,
  ],
  [ExternalOperationLifecycleState.UNKNOWN]: [
    ExternalOperationLifecycleState.PENDING_VERIFICATION,
    ExternalOperationLifecycleState.MANUAL_REVIEW,
    ExternalOperationLifecycleState.FAILED,
  ],
  [ExternalOperationLifecycleState.MANUAL_REVIEW]: [
    ExternalOperationLifecycleState.PENDING_VERIFICATION,
    ExternalOperationLifecycleState.FAILED,
  ],
  [ExternalOperationLifecycleState.FAILED]: [],
  [ExternalOperationLifecycleState.CANCELLED]: [],
};

export function assertExternalOperationTransition(
  current: ExternalOperationLifecycleState,
  next: ExternalOperationLifecycleState,
): void {
  if (!EXTERNAL_OPERATION_LIFECYCLE_TRANSITIONS[current].includes(next)) {
    throw new Error(`Invalid external operation transition from ${current} to ${next}`);
  }
}

export function isTerminalExternalOperationState(state: ExternalOperationLifecycleState): boolean {
  return (
    state === ExternalOperationLifecycleState.FAILED ||
    state === ExternalOperationLifecycleState.CANCELLED
  );
}
