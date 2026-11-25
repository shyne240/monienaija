import { ApiClient } from './api-client';

/**
 * V1-AGENT-CLASS-LIFECYCLE-01 — Agent class lifecycle console API.
 *
 * Every shape below is the exact response of a real endpoint on the Agent Network controller:
 *
 *   GET  /internal/agents/:id/class                     effective class + computed default
 *   GET  /internal/agents/:id/class/readiness            per-service deny reasons
 *   GET  /internal/agents/:id/class/history              audit-derived switch history
 *   GET  /internal/agents/:id/class/impact-preview       read-only delta for a target class
 *   POST /internal/agents/:id/class                      governed switch
 *
 * The preview and readiness reads are advisory only: they are computed by the same capability gate
 * that authorizes live financial commands (so they cannot disagree with enforcement), they write
 * nothing, and they are never a substitute for the server-side check performed on the switch itself.
 */

/** Reasons the capability gate can report — verbatim from `agent-service-capability.types.ts`. */
export type AgentServiceCapabilityReason =
  | 'ALLOWED'
  | 'AGENT_NOT_FOUND'
  | 'AGENT_DELETED'
  | 'AGENT_PENDING'
  | 'AGENT_SUSPENDED'
  | 'AGENT_TERMINATED'
  | 'AGENT_NOT_ACTIVE'
  | 'MISSING_AGENT_CLASS'
  | 'AGENT_CLASS_NOT_FOUND'
  | 'AGENT_CLASS_DELETED'
  | 'AGENT_CLASS_INACTIVE'
  | 'EMPTY_APPLICABLE_SERVICES'
  | 'MALFORMED_APPLICABLE_SERVICES'
  | 'UNKNOWN_SERVICE'
  | 'SERVICE_NOT_PERMITTED'
  | 'PRINCIPAL_NOT_AGENT'
  | 'PRINCIPAL_MISMATCH'
  | 'WORKFORCE_NOT_PERMITTED'
  | 'INVALID_AGENT_ID'
  | 'INVALID_SERVICE';

export interface AgentClassView {
  id: string;
  reference: string;
  code: string;
  name: string;
  isActive: boolean;
  applicableServices: string[];
}

export interface AgentServiceDenial {
  service: string;
  reason: AgentServiceCapabilityReason;
}

export interface AgentClassReadiness {
  agentId: string;
  agentStatus: string;
  agentVersion: number;
  currentClass: AgentClassView | null;
  currentClassId: string | null;
  approvedDefault: AgentClassView | null;
  approvedDefaultBasis: string;
  deniedServices: AgentServiceDenial[];
  allowedServices: string[];
  blockedBy: AgentServiceCapabilityReason | null;
  canOperate: boolean;
  evaluatedAt: string;
}

export interface AgentClassImpact {
  agentId: string;
  currentClass: AgentClassView | null;
  targetClass: AgentClassView;
  gains: Array<{ service: string; currentReason: string; targetReason: string }>;
  losses: Array<{ service: string; currentReason: string; targetReason: string }>;
  unchanged: string[];
  warnings: string[];
  blockingReasons: string[];
  canSwitch: boolean;
  writesPerformed: string[];
  financialMutations: string[];
  readonly: true;
  evaluatedAt: string;
}

export interface AgentClassHistoryEntry {
  action: string;
  actor: string;
  occurredAt: string;
  previousClassId: string | null;
  newClassId: string | null;
  previousClass: AgentClassView | null;
  newClass: AgentClassView | null;
  reason: string | null;
  source: string | null;
}

export interface AgentClassSwitchResult {
  agentId: string;
  previousClassId: string | null;
  currentClassId: string;
  previousClass: AgentClassView | null;
  currentClass: AgentClassView;
  version: number;
  changed: boolean;
  impact: { gains: string[]; losses: string[] };
}

/**
 * Human-readable explanation of a denial reason.
 *
 * The mapping is exhaustive on purpose: an unknown reason renders as the raw code rather than an
 * invented reassurance, so a new backend reason is visible in the UI instead of being swallowed.
 */
export function describeCapabilityReason(reason: AgentServiceCapabilityReason | string): string {
  switch (reason) {
    case 'ALLOWED':
      return 'Permitted by the assigned class.';
    case 'SERVICE_NOT_PERMITTED':
      return 'The assigned class does not list this service.';
    case 'MISSING_AGENT_CLASS':
      return 'No Agent class is assigned, so no service is permitted.';
    case 'AGENT_CLASS_NOT_FOUND':
      return 'The assigned class no longer exists.';
    case 'AGENT_CLASS_DELETED':
      return 'The assigned class has been deleted.';
    case 'AGENT_CLASS_INACTIVE':
      return 'The assigned class is inactive.';
    case 'EMPTY_APPLICABLE_SERVICES':
      return 'The assigned class declares no services (fails closed).';
    case 'MALFORMED_APPLICABLE_SERVICES':
      return 'The assigned class declares a malformed or unknown service (fails closed).';
    case 'AGENT_PENDING':
      return 'The Agent has not been activated yet.';
    case 'AGENT_SUSPENDED':
      return 'The Agent is suspended.';
    case 'AGENT_TERMINATED':
      return 'The Agent is terminated.';
    case 'AGENT_NOT_ACTIVE':
      return 'The Agent is not ACTIVE.';
    case 'AGENT_NOT_FOUND':
      return 'The Agent could not be found.';
    case 'AGENT_DELETED':
      return 'The Agent has been deleted.';
    case 'UNKNOWN_SERVICE':
      return 'This is not a registered Agent service.';
    default:
      return `Denied (${reason}).`;
  }
}

/** Which capability problems a class switch can actually fix, versus which it cannot. */
export function isClassAddressableReason(reason: string): boolean {
  return [
    'SERVICE_NOT_PERMITTED',
    'MISSING_AGENT_CLASS',
    'AGENT_CLASS_NOT_FOUND',
    'AGENT_CLASS_DELETED',
    'AGENT_CLASS_INACTIVE',
    'EMPTY_APPLICABLE_SERVICES',
    'MALFORMED_APPLICABLE_SERVICES',
  ].includes(reason);
}

export function fetchAgentClass(agentId: string): Promise<{
  agentId: string;
  agentClassId: string | null;
  currentClass: AgentClassView | null;
  approvedDefault: AgentClassView | null;
  approvedDefaultBasis: string;
}> {
  return ApiClient.get(`/internal/agents/${encodeURIComponent(agentId)}/class`);
}

export function fetchAgentClassReadiness(agentId: string): Promise<AgentClassReadiness> {
  return ApiClient.get(`/internal/agents/${encodeURIComponent(agentId)}/class/readiness`);
}

export function fetchAgentClassHistory(
  agentId: string,
  limit = 25,
): Promise<AgentClassHistoryEntry[]> {
  return ApiClient.get(
    `/internal/agents/${encodeURIComponent(agentId)}/class/history?limit=${limit}`,
  );
}

/** Read-only impact preview. `targetClassId` must already be validated by the caller. */
export function previewAgentClassImpact(
  agentId: string,
  targetClassId: string,
): Promise<AgentClassImpact> {
  return ApiClient.get(
    `/internal/agents/${encodeURIComponent(agentId)}/class/impact-preview?targetClassId=${encodeURIComponent(targetClassId)}`,
  );
}

export function switchAgentClass(
  agentId: string,
  input: { targetClassId: string; reason: string; expectedVersion?: number },
): Promise<AgentClassSwitchResult> {
  return ApiClient.post(`/internal/agents/${encodeURIComponent(agentId)}/class`, {
    targetClassId: input.targetClassId,
    reason: input.reason,
    ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
  });
}
