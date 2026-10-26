/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AgentAuthenticationService } from '../agent-authentication/agent-authentication.service';
import { AgentPasswordHashVerificationService } from '../agent-authentication/agent-password-hash-verification.service';
import { AgentServiceCapabilityService } from './agent-service-capability.service';
import { type AgentService, normalizeAgentService } from './agent-service.enum';
import type { AgentServiceCapabilityEvaluation, CapabilityReason } from './agent-service-capability.types';
import type {
  AgentTransactionAuthorizationReason,
  AgentTransactionAuthorizationResult,
  AuthorizeAgentTransactionInput,
} from './agent-transaction-authorization.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AgentTransactionAuthorizationService {
  constructor(
    private readonly capabilityService: AgentServiceCapabilityService,
    private readonly agentAuthService: AgentAuthenticationService,
    private readonly verificationService: AgentPasswordHashVerificationService,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Reusable authorization gate for future Agent financial commands.
   *
   * Sequence (fail-closed):
   *  1. authenticated AGENT principal (UNAUTHENTICATED → DENIED)
   *  2. correct principal type & identity (CUSTOMER/WORKFORCE → DENIED, mismatch → DENIED)
   *  3. Agent eligibility & service capability via AgentServiceCapabilityService (reuse, not duplication)
   *  4. transaction PIN verification via AgentAuthenticationService (reuse hashing/lockout/policy)
   *  5. produce authorized context (no wallet/balance/secrets)
   *
   * No money movement, no ledger/journal, no wallet mutation.
   */
  async authorize(
    input: AuthorizeAgentTransactionInput,
  ): Promise<AgentTransactionAuthorizationResult> {
    const agentId = input.agentId?.trim() ?? '';
    const rawService = input.service ?? '';
    const principalInput = input.principal as AuthorizationPrincipal | undefined;

    // 1. Validate agentId
    if (!UUID_PATTERN.test(agentId)) {
      return this.denied(agentId, rawService, null, 'INVALID_AGENT_ID', principalInput);
    }

    // 2. Validate service present (detailed UNKNOWN/INVALID delegated to capability)
    if (typeof rawService !== 'string' || !rawService.trim()) {
      // Let capability handle INVALID_SERVICE but we can short-circuit
      const cap = await this.capabilityService.evaluateWithPrincipal(
        agentId,
        rawService,
        principalInput as unknown as { type: string; agentId?: string; customerId?: string },
      );
      // Map capability reason to authorization reason
      const reason = this.mapCapabilityReason(cap.reason);
      return this.denied(agentId, rawService, cap.canonicalService, reason, principalInput, cap);
    }

    const canonicalPreview = normalizeAgentService(rawService);

    // 3. Principal checks — must be authenticated AGENT
    if (!principalInput) {
      const r = this.denied(agentId, rawService, canonicalPreview, 'UNAUTHENTICATED', undefined);
      await this.auditDenied(r);
      return r;
    }

    const type = (principalInput.type ?? '').toUpperCase();
    // Normalize principal for capability check
    const principalForCap = {
      type: principalInput.type,
      agentId: (principalInput as unknown as { agentId?: string }).agentId,
      customerId: (principalInput as unknown as { customerId?: string }).customerId,
    } as { type: string; agentId?: string; customerId?: string };

    if (type === 'CUSTOMER') {
      const r = this.denied(agentId, rawService, canonicalPreview, 'PRINCIPAL_NOT_AGENT', principalInput);
      await this.auditDenied(r);
      return r;
    }
    if (type === 'AGENT') {
      const pid = (principalInput as unknown as { agentId?: string }).agentId;
      if (!pid || pid.toLowerCase() !== agentId.toLowerCase()) {
        const r = this.denied(agentId, rawService, canonicalPreview, 'PRINCIPAL_MISMATCH', principalInput);
        await this.auditDenied(r);
        return r;
      }
      // principal is correct AGENT — continue
    } else if (['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(type)) {
      const r = this.denied(agentId, rawService, canonicalPreview, 'WORKFORCE_NOT_PERMITTED', principalInput);
      await this.auditDenied(r);
      return r;
    } else if (type) {
      const r = this.denied(agentId, rawService, canonicalPreview, 'PRINCIPAL_NOT_AGENT', principalInput);
      await this.auditDenied(r);
      return r;
    } else {
      const r = this.denied(agentId, rawService, canonicalPreview, 'INVALID_PRINCIPAL', principalInput);
      await this.auditDenied(r);
      return r;
    }

    // Ensure AuthorizationPrincipal shape for downstream context (fill minimal)
    const principal: AuthorizationPrincipal =
      this.toAuthorizationPrincipal(principalInput, agentId);

    // 4. Service capability via A10 (reuse, not duplication)
    const cap = await this.capabilityService.evaluateWithPrincipal(
      agentId,
      rawService,
      principalForCap,
    );
    if (!cap.allowed) {
      const reason = this.mapCapabilityReason(cap.reason);
      const r = this.denied(agentId, rawService, cap.canonicalService, reason, principal, cap);
      // capability already audited, but we also audit at A11 level for traceability (best-effort)
      await this.auditDenied(r);
      return r;
    }

    // 5. Transaction PIN — missing → fail-closed
    const pin = input.pin;
    if (typeof pin !== 'string' || pin.length === 0) {
      const r = this.denied(agentId, rawService, cap.canonicalService, 'PIN_REQUIRED', principal, cap);
      await this.auditDenied(r);
      return r;
    }
    // Do not trim PIN — spaces are meaningful, but empty after trim we already handled

    const actor = input.actor?.trim() ? input.actor.trim() : principal.principalId ?? agentId;

    // Delegate to existing PIN verification (reuses hashing, lockout, attempt counting, policy)
    let verifyResult: { verified: boolean; locked?: boolean; failureReason?: string };
    try {
      verifyResult = await this.agentAuthService.verifyTransactionPin(
        agentId,
        { pin, actor },
        this.verificationService,
      );
    } catch {
      // Any unexpected error → fail-closed as PIN_INVALID (do not leak)
      const r = this.denied(agentId, rawService, cap.canonicalService, 'PIN_INVALID', principal, cap);
      await this.auditDenied(r);
      return r;
    }

    if (verifyResult.verified) {
      // AUTHORIZED — produce reusable context
      const ctx = {
        agentId,
        principal,
        service: rawService,
        canonicalService: cap.canonicalService!,
        agentStatus: cap.agentStatus ?? 'ACTIVE',
        agentClassId: cap.agentClassId ?? '',
        agentClassActive: true,
        applicableServices: cap.applicableServices,
        applicableLimits: cap.applicableLimits,
        authorizedAt: new Date(),
      };
      // Optional success audit (best-effort, no PIN)
      try {
        await this.dataSource.transaction(async (manager) => {
          await this.auditService.record(manager, {
            entityType: 'AGENT_TRANSACTION_AUTHORIZATION',
            entityId: agentId,
            action: 'AUTHORIZED',
            actor: principal.principalId,
            newValues: {
              service: rawService,
              canonicalService: cap.canonicalService,
              agentClassId: cap.agentClassId,
            },
          });
        });
      } catch {
        // best-effort
      }
      return {
        allowed: true,
        decision: 'AUTHORIZED',
        reason: 'ALLOWED',
        agentId,
        service: rawService,
        canonicalService: cap.canonicalService,
        principal,
        context: ctx,
        agentStatus: cap.agentStatus,
        agentClassId: cap.agentClassId!,
        agentClassActive: true,
        applicableServices: cap.applicableServices,
        applicableLimits: cap.applicableLimits,
      };
    }

    // PIN verification failed — map to taxonomy
    let reason: AgentTransactionAuthorizationReason = 'PIN_INVALID';
    const fr = verifyResult.failureReason;
    if (verifyResult.locked || fr === 'PIN_LOCKED') {
      reason = 'PIN_LOCKED';
    } else if (fr === 'PIN_NOT_FOUND') {
      reason = 'PIN_NOT_FOUND';
    } else if (fr === 'INVALID_PIN') {
      // Could be policy violation (length, etc.) — keep distinct
      reason = 'PIN_INVALID';
    } else if (fr === 'MISMATCH' || fr === 'PIN_INVALID') {
      reason = 'PIN_INVALID';
    }

    const r = this.denied(agentId, rawService, cap.canonicalService, reason, principal, cap);
    await this.auditDenied(r);
    return r;
  }

  /**
   * Alias for backwards compatibility / security tests that use evaluateWithPrincipal style.
   */
  async authorizeWithPrincipal(
    agentId: string,
    service: string,
    pin: string | undefined,
    principal: AuthorizationPrincipal | { type: string; agentId?: string; customerId?: string } | undefined,
  ): Promise<AgentTransactionAuthorizationResult> {
    return this.authorize({ agentId, service, pin, principal: principal as AuthorizationPrincipal });
  }

  private denied(
    agentId: string,
    service: string,
    canonical: AgentService | null,
    reason: AgentTransactionAuthorizationReason,
    principal?: AuthorizationPrincipal | { type: string; agentId?: string; customerId?: string },
    cap?: AgentServiceCapabilityEvaluation,
  ): AgentTransactionAuthorizationResult {
    const princ =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      principal && 'principalId' in principal
        ? (principal as AuthorizationPrincipal)
        : principal
          ? this.tryToPrincipal(principal as { type: string; agentId?: string; customerId?: string }, agentId)
          : undefined;
    return {
      allowed: false,
      decision: 'DENIED',
      reason,
      agentId,
      service,
      canonicalService: canonical,
      principal: princ,
      agentStatus: cap?.agentStatus,
      agentClassId: (cap?.agentClassId as string | undefined) ?? undefined,
      agentClassActive: cap?.agentClassActive,
      applicableServices: cap?.applicableServices,
      applicableLimits: cap?.applicableLimits,
    };
  }

  private mapCapabilityReason(r: CapabilityReason): AgentTransactionAuthorizationReason {
    // CapabilityReason is subset of AuthorizationReason (all DENIED reasons are compatible)
    return r as unknown as AgentTransactionAuthorizationReason;
  }

  private toAuthorizationPrincipal(
    input: AuthorizationPrincipal | { type: string; agentId?: string; customerId?: string; principalId?: string },
    agentId: string,
  ): AuthorizationPrincipal {
    // If already a full AuthorizationPrincipal, return as-is
    if ((input as AuthorizationPrincipal).principalId && (input as AuthorizationPrincipal).roles !== undefined) {
      return input as AuthorizationPrincipal;
    }
    const type = (input.type ?? 'AGENT').toUpperCase() as AuthorizationPrincipal['type'];
    const pId = (input as { principalId?: string }).principalId ?? (input as { agentId?: string }).agentId ?? agentId;
    return {
      type,
      principalId: pId,
      agentId: (input as { agentId?: string }).agentId ?? (type === 'AGENT' ? agentId : undefined),
      customerId: (input as { customerId?: string }).customerId,
      roles: [],
      scopes: [],
      customerAccess: type === 'AGENT' ? 'NONE' : 'SELF',
      agentAccess: type === 'AGENT' ? 'SELF' : 'NONE',
    } as AuthorizationPrincipal;
  }

  private tryToPrincipal(
    input: { type: string; agentId?: string; customerId?: string },
    fallbackAgentId: string,
  ): AuthorizationPrincipal | undefined {
    if (!input?.type) return undefined;
    const type = input.type.toUpperCase() as AuthorizationPrincipal['type'];
    return {
      type,
      principalId: input.agentId ?? input.customerId ?? fallbackAgentId,
      agentId: input.agentId,
      customerId: input.customerId,
      roles: [],
      scopes: [],
      customerAccess: 'NONE',
      agentAccess: 'NONE',
    } as AuthorizationPrincipal;
  }

  private async auditDenied(result: AgentTransactionAuthorizationResult): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.auditService.record(manager, {
          entityType: 'AGENT_TRANSACTION_AUTHORIZATION',
          entityId: result.agentId,
          action: 'DENIED',
          actor: result.principal?.principalId ?? 'system',
          newValues: {
            service: result.service,
            canonicalService: result.canonicalService,
            reason: result.reason,
            agentStatus: result.agentStatus ?? null,
            agentClassId: result.agentClassId ?? null,
          },
        });
      });
    } catch {
      // best-effort
    }
  }
}
