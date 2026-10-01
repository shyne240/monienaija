import { ApiClient } from './api-client';

/**
 * Agent Mobile — typed bindings for the exact backend contracts
 * (src/agent-authentication, verified by V1-AGENT-MFA-API-01/a21 suites).
 * Only authentication + identity contracts are bound in the foundation task;
 * financial surfaces arrive in later phases per the approved specification.
 */

export interface AgentSession {
  accessToken: string;
  tokenType: string;
  expiresAt: string;
  agentId: string;
  sessionId: string;
}

export interface AgentLoginRotationRequired {
  rotationRequired: true;
  agentId: string;
}

export type AgentLoginResult = AgentSession | AgentLoginRotationRequired;

export function isRotationRequired(result: AgentLoginResult): result is AgentLoginRotationRequired {
  return (result as AgentLoginRotationRequired).rotationRequired === true;
}

export interface AgentIdentity {
  id: string;
  reference: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** POST /api/v1/agents/sessions (backend alias /agents/login unused by design). */
export async function agentLogin(agentId: string, password: string): Promise<AgentLoginResult> {
  return ApiClient.post<AgentLoginResult>('api/v1/agents/sessions', { agentId, password });
}

/** POST /api/v1/agents/credentials/rotate — mandatory temporary-credential rotation. */
export async function agentRotateCredentials(
  agentId: string,
  currentPassword: string,
  newPassword: string,
): Promise<AgentSession> {
  return ApiClient.post<AgentSession>('api/v1/agents/credentials/rotate', {
    agentId,
    currentPassword,
    newPassword,
  });
}

/** POST /api/v1/agents/sessions/logout — revokes the presented Bearer session. */
export async function agentLogout(): Promise<{ revoked: boolean }> {
  return ApiClient.post<{ revoked: boolean }>('api/v1/agents/sessions/logout', {});
}

/** GET /api/v1/agents/me — agent identity (never hashes/PIN/secrets). */
export async function getAgentMe(): Promise<AgentIdentity> {
  return ApiClient.get<AgentIdentity>('api/v1/agents/me');
}
