import type { AgentService } from './agent-service.enum';

export type CapabilityDecision = 'ALLOWED' | 'DENIED';

export type CapabilityReason =
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

export interface AgentServiceCapabilityEvaluation {
  allowed: boolean;
  decision: CapabilityDecision;
  reason: CapabilityReason;
  agentId: string;
  service: string | null; // canonical or raw if unknown
  canonicalService: AgentService | null;
  agentStatus?: string;
  agentClassId?: string | null;
  agentClassActive?: boolean;
  applicableServices?: unknown;
  applicableLimits?: unknown;
}

export interface EvaluateCapabilityInput {
  agentId: string;
  service: string;
  principal?: { type: string; agentId?: string; customerId?: string };
  actor?: string;
}
