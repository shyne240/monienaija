import { ApiClient } from './api-client';

/**
 * ARENA 3D — banking operations API layer.
 *
 * Thin, typed wrappers over `/internal/banking/*`. Every one of these endpoints already exists and is
 * registered in the route policy registry; nothing here invents an endpoint or a figure.
 *
 * Two rules are reflected in the types rather than left to the screens:
 *
 * 1. **Readiness is per institution and per provider.** There is no global "banking is up" flag,
 *    because approval, credentialing and operational status are all institution-scoped facts. A
 *    screen that renders a single global badge would be making a claim about someone in particular.
 * 2. **Entitlement is never asserted.** `entitled` is always `'UNKNOWN'` from the server; the client
 *    type keeps it that way so no screen can quietly render it as a positive.
 */

/** The seven readiness states. `usable` is true only for the operational one. */
export type ProviderReadinessState =
  | 'IMPLEMENTED_NOT_APPROVED'
  | 'APPROVED_NOT_CREDENTIALED'
  | 'CREDENTIALED_NOT_OPERATIONAL'
  | 'DISABLED'
  | 'OPERATIONAL_BUT_ENTITLEMENT_UNCONFIRMED'
  | 'UNSUPPORTED'
  | 'NOT_REGISTERED';

export interface ProviderReadiness {
  providerKey: string;
  state: ProviderReadinessState;
  /** True only when `state` is the operational one. */
  usable: boolean;
  /** Always `'UNKNOWN'`. Retained so a screen cannot imply an entitlement it does not have. */
  entitled: 'UNKNOWN';
  approved: boolean;
  credentialed: boolean;
  operational: boolean;
  disabled: boolean;
  capability: string;
}

export interface ProviderReadinessResponse {
  registered: string[];
  providers: ProviderReadiness[];
}

export interface ProviderCapabilityDescriptor {
  providerKey: string;
  displayName: string;
  environment: 'sandbox' | 'production';
  capabilities: Record<string, boolean>;
}

export interface ReconciliationRun {
  id: string;
  provider_key: string;
  environment: string;
  state: 'RUNNING' | 'COMPLETED' | 'FAILED';
  observations: number;
  exceptions_raised: number;
  started_at: string;
  completed_at: string | null;
  failure_code: string | null;
}

export interface ReconciliationException {
  id: string;
  runId: string;
  kind: string;
  severity: string;
  state: string;
  operationReference: string | null;
  amountMinor: string | null;
  currency: string | null;
  note: string | null;
  assignedTo: string | null;
  createdAt: string;
  escalatedAt: string | null;
}

export type ExceptionResolution = 'MATCHED' | 'ACCEPTED_DIFFERENCE' | 'ESCALATED';

export interface ProviderProposal {
  institutionId: string;
  requestId: string;
  expectedVersion: number;
  providerKey: string;
  environment: 'sandbox' | 'production';
  definition: Record<string, unknown>;
  credentialBundleFingerprint: string | null;
  routingApproved: boolean;
  operationalReady: boolean;
  reason: string;
}

export const BankingAdminApi = {
  /** Readiness for every registered provider at one institution. */
  readiness: (institutionId: string) =>
    ApiClient.get<ProviderReadinessResponse>(
      `/internal/banking/providers?institutionId=${encodeURIComponent(institutionId)}`,
    ),

  /** What this build's adapters can do, with no institution claim attached. */
  capabilities: () =>
    ApiClient.get<ProviderCapabilityDescriptor[]>('/internal/banking/capabilities'),

  governance: (institutionId: string) =>
    ApiClient.get<{ proposals: unknown[]; versions: unknown[] }>(
      `/internal/banking/governance/${encodeURIComponent(institutionId)}`,
    ),

  /**
   * Proposes a provider configuration.
   *
   * The credential bundle is represented only by a fingerprint: this client never holds, sends or
   * receives a provider secret.
   */
  propose: (institutionId: string, proposal: ProviderProposal, idempotencyKey: string) =>
    ApiClient.post<{ proposalId: string; state: string }>(
      `/internal/banking/governance/${encodeURIComponent(institutionId)}/proposals`,
      proposal,
      { idempotencyKey },
    ),

  /** Independent approval. The server refuses a self-approval; this client does not pre-empt that. */
  decide: (
    institutionId: string,
    proposalId: string,
    approve: boolean,
    idempotencyKey: string,
  ) =>
    ApiClient.post<{ proposalId: string; state: string }>(
      `/internal/banking/governance/${encodeURIComponent(institutionId)}/proposals/${encodeURIComponent(proposalId)}/decide`,
      { approve },
      { idempotencyKey },
    ),

  reconciliationRuns: (institutionId: string) =>
    ApiClient.get<ReconciliationRun[]>(
      `/internal/banking/reconciliation/${encodeURIComponent(institutionId)}/runs`,
    ),

  startReconciliation: (institutionId: string, providerKey: string, idempotencyKey: string) =>
    ApiClient.post<{ runId: string; state: 'RUNNING' }>(
      `/internal/banking/reconciliation/${encodeURIComponent(institutionId)}/runs`,
      { providerKey },
      { idempotencyKey },
    ),

  exceptions: (institutionId: string, limit = 100) =>
    ApiClient.get<ReconciliationException[]>(
      `/internal/banking/reconciliation/${encodeURIComponent(institutionId)}/exceptions?limit=${limit}`,
    ),

  /**
   * Records a resolution decision.
   *
   * This does not move money, and the response deliberately carries no financial figures. A genuine
   * correction has to go through the separately authorized financial lifecycle.
   */
  resolveException: (exceptionId: string, resolution: ExceptionResolution, note: string) =>
    ApiClient.post<{ exceptionId: string; resolution: ExceptionResolution }>(
      `/internal/banking/reconciliation/exceptions/${encodeURIComponent(exceptionId)}/resolve`,
      { resolution, note },
    ),
};
