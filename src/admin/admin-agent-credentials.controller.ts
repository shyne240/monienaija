import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

import { AgentAuthenticationService } from '../agent-authentication/agent-authentication.service';
import { AgentAuthenticationSessionService } from '../agent-authentication/agent-authentication-session.service';
import { AgentPasswordHashAlgorithm } from '../agent-authentication/agent-authentication.enums';
import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * V1-AGENT-CREDENTIALS-01 — workforce issuance of Agent login credentials.
 *
 * Closes the verified V1 gap: Agent application → approval → activation existed, but nothing
 * created `agent_authentication_credentials`, so an activated Agent could never log in without
 * manual SQL.
 *
 * Flow: workforce (OPERATOR/SERVICE/PRIVILEGED — same actor vocabulary as
 * AdminAgentLifecycleController, SUPPORT denied) issues a TEMPORARY credential for an ACTIVE
 * Agent. The plaintext temporary password is generated here (CSPRNG), is returned ONCE in
 * this authorized response (the documented delivery boundary — the operator delivers it to
 * the Agent out-of-band; there is intentionally no SMS/e-mail/push channel for secrets), and
 * is NEVER persisted or logged anywhere (only the PBKDF2 hash is stored). The credential
 * carries rotationRequired=true and a bounded expiry; the Agent's first login cannot produce
 * a session until it rotates via POST /api/v1/agents/credentials/rotate.
 *
 * No financial side effects: credential issuance touches only credential/session/audit state.
 */
const TEMPORARY_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours
const TEMPORARY_PASSWORD_BYTES = 12; // 16 base64url chars, ~96 bits
const PBKDF2_ITERATIONS = 10_000;

@Controller('internal/admin/agents')
export class AdminAgentCredentialsController {
  constructor(
    private readonly agentAuthenticationService: AgentAuthenticationService,
    private readonly sessionService: AgentAuthenticationSessionService,
    private readonly auth: AuthorizationService,
  ) {}

  @Post(':id/credentials')
  @HttpCode(200)
  async issueInitialCredential(@Param('id') agentId: string, @Req() req: AuthenticatedRequest) {
    const actor = await this.requireOperational(req);
    const { plaintext, hash } = this.generateTemporaryCredential();
    const credential = await this.agentAuthenticationService.issueInitialCredential(agentId, {
      passwordHash: hash,
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      passwordExpiresAt: new Date(Date.now() + TEMPORARY_PASSWORD_TTL_MS).toISOString(),
      actor,
    });
    return this.issuanceView(credential.id, credential.agentId, plaintext, credential.passwordExpiresAt);
  }

  @Post(':id/credentials/reissue')
  @HttpCode(200)
  async reissueInitialCredential(@Param('id') agentId: string, @Req() req: AuthenticatedRequest) {
    const actor = await this.requireOperational(req);
    const { plaintext, hash } = this.generateTemporaryCredential();
    const { credential, previousCredentialId } =
      await this.agentAuthenticationService.reissueInitialCredential(agentId, {
        passwordHash: hash,
        hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
        passwordExpiresAt: new Date(Date.now() + TEMPORARY_PASSWORD_TTL_MS).toISOString(),
        actor,
      });
    // Established invalidation convention: sessions of the replaced credential are revoked.
    await this.sessionService.revokeAllForCredential(
      previousCredentialId,
      actor,
      'Credential reissued by workforce',
    );
    return this.issuanceView(credential.id, credential.agentId, plaintext, credential.passwordExpiresAt);
  }

  private generateTemporaryCredential(): { plaintext: string; hash: string } {
    const plaintext = randomBytes(TEMPORARY_PASSWORD_BYTES).toString('base64url');
    const salt = randomBytes(16);
    const derived = pbkdf2Sync(plaintext, salt, PBKDF2_ITERATIONS, 32, 'sha256');
    const hash = `PBKDF2$sha256$${PBKDF2_ITERATIONS}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
    return { plaintext, hash };
  }

  private issuanceView(
    credentialId: string,
    agentId: string,
    temporaryPassword: string,
    passwordExpiresAt: Date | null,
  ) {
    return {
      agentId,
      credentialId,
      // ONE-TIME delivery value — present only in this response; never stored or logged.
      temporaryPassword,
      rotationRequired: true,
      passwordExpiresAt: passwordExpiresAt?.toISOString() ?? null,
      deliveryNotice:
        'Temporary credential — deliver to the Agent out-of-band. It expires and must be rotated at first login.',
    };
  }

  /**
   * V1-ADMIN-AUTHORIZATION-HARDENING-01: function-based via the `agent.manage_credentials`
   * catalogue function, AND-combined with the pre-existing OPERATOR/SERVICE/PRIVILEGED
   * principal-type restriction (same actor vocabulary as AdminAgentLifecycleController;
   * SUPPORT, CUSTOMER, AGENT, AGGREGATOR remain denied). Only AGENT_NETWORK_MANAGER and
   * SUPER_ADMIN hold `agent.manage_credentials` in the catalogue, so FINANCE_* / COMPLIANCE /
   * RISK_FRAUD / CUSTOMER_SERVICE / TREASURY principals (all principal.type OPERATOR) that
   * previously passed the bare type check are now correctly denied.
   */
  private requireOperational(req: AuthenticatedRequest): Promise<string> {
    return this.auth.requireFunction(
      req.authorizationPrincipal,
      'agent.manage_credentials',
      'agent-credential-issuance',
      ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );
  }
}
