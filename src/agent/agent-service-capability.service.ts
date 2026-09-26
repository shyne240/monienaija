import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { Agent } from './agent.entity';
import { AgentClass } from './agent-class.entity';
import { AgentStatus } from './agent.enums';
import {
  type AgentService,
  normalizeAgentService,
} from './agent-service.enum';
import type {
  AgentServiceCapabilityEvaluation,
  CapabilityReason,
} from './agent-service-capability.types';

@Injectable()
export class AgentServiceCapabilityService {
  constructor(
    @InjectRepository(Agent)
    private readonly agentRepository: Repository<Agent>,
    @InjectRepository(AgentClass)
    private readonly agentClassRepository: Repository<AgentClass>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Primary reusable authorization gate — answers "Is this Agent currently permitted
   * to perform this named V1 Agent service?"
   *
   * This does NOT replace authentication, transaction PIN, route authorization, or limits.
   * It is the additional Agent-service eligibility gate for future financial commands.
   *
   * Fail-closed: NULL/empty/malformed applicableServices → DENIED.
   * No wallet/ledger/journal side-effects.
   */
  async evaluate(
    agentId: string,
    rawService: string,
  ): Promise<AgentServiceCapabilityEvaluation> {
    return this.internalEvaluate(agentId, rawService, undefined);
  }

  /**
   * Principal-aware variant for security tests: verifies that the caller's principal
   * is the correct AGENT for the requested agentId.
   *
   * - CUSTOMER → DENIED (M)
   * - Another AGENT's session → DENIED (L)
   * - Workforce/admin (SUPPORT|OPERATOR|SERVICE|PRIVILEGED) → DENIED as Agent service (N) — they do not automatically acquire Agent permissions
   */
  async evaluateWithPrincipal(
    agentId: string,
    rawService: string,
    principal: { type: string; agentId?: string; customerId?: string } | undefined,
  ): Promise<AgentServiceCapabilityEvaluation> {
    return this.internalEvaluate(agentId, rawService, principal);
  }

  private async internalEvaluate(
    agentId: string,
    rawService: string,
    principal: { type: string; agentId?: string; customerId?: string } | undefined,
  ): Promise<AgentServiceCapabilityEvaluation> {
    // 1. Validate agentId
    if (!this.isUuid(agentId)) {
      return this.denied(agentId, rawService, null, 'INVALID_AGENT_ID');
    }
    // 2. Validate service
    if (typeof rawService !== 'string' || !rawService.trim()) {
      return this.denied(agentId, rawService, null, 'INVALID_SERVICE');
    }
    const canonical = normalizeAgentService(rawService);
    if (!canonical) {
      return this.denied(agentId, rawService, null, 'UNKNOWN_SERVICE');
    }

    // 3. Principal checks (if provided) — do not bypass
    if (principal) {
      const type = principal.type?.toUpperCase?.() ?? '';
      if (type === 'CUSTOMER') {
        const evalRes = this.denied(agentId, rawService, canonical, 'PRINCIPAL_NOT_AGENT');
        await this.auditDenied(evalRes, principal.type);
        return evalRes;
      }
      if (type === 'AGENT') {
        if (!principal.agentId || principal.agentId.toLowerCase() !== agentId.toLowerCase()) {
          const evalRes = this.denied(agentId, rawService, canonical, 'PRINCIPAL_MISMATCH');
          await this.auditDenied(evalRes, principal.type);
          return evalRes;
        }
        // principal is correct AGENT — continue to eligibility checks
      } else if (['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(type)) {
        const evalRes = this.denied(agentId, rawService, canonical, 'WORKFORCE_NOT_PERMITTED');
        await this.auditDenied(evalRes, principal.type);
        return evalRes;
      } else if (type) {
        const evalRes = this.denied(agentId, rawService, canonical, 'PRINCIPAL_NOT_AGENT');
        await this.auditDenied(evalRes, principal.type);
        return evalRes;
      }
    }

    // 4. Agent exists and not deleted
    const agent = await this.agentRepository.findOne({ where: { id: agentId } });
    if (!agent) {
      const evalRes = this.denied(agentId, rawService, canonical, 'AGENT_NOT_FOUND');
      await this.auditDenied(evalRes, principal?.type);
      return evalRes;
    }
    if (agent.deletedAt !== null) {
      const evalRes = this.denied(agentId, rawService, canonical, 'AGENT_DELETED', agent.status, agent.agentClassId ?? null);
      await this.auditDenied(evalRes, principal?.type);
      return evalRes;
    }

    // 5. Lifecycle status
    const status = agent.status;
    if (status === AgentStatus.PENDING) {
      const evalRes = this.denied(agentId, rawService, canonical, 'AGENT_PENDING', status, agent.agentClassId ?? null);
      await this.auditDenied(evalRes, principal?.type);
      return evalRes;
    }
    if (status === AgentStatus.SUSPENDED) {
      // No inventoried exception — SUSPENDED cannot initiate new financial services
      const evalRes = this.denied(agentId, rawService, canonical, 'AGENT_SUSPENDED', status, agent.agentClassId ?? null);
      await this.auditDenied(evalRes, principal?.type);
      return evalRes;
    }
    if (status === AgentStatus.TERMINATED) {
      const evalRes = this.denied(agentId, rawService, canonical, 'AGENT_TERMINATED', status, agent.agentClassId ?? null);
      await this.auditDenied(evalRes, principal?.type);
      return evalRes;
    }
    if (status !== AgentStatus.ACTIVE) {
      const evalRes = this.denied(agentId, rawService, canonical, 'AGENT_NOT_ACTIVE', status, agent.agentClassId ?? null);
      await this.auditDenied(evalRes, principal?.type);
      return evalRes;
    }

    // 6. Agent class
    if (!agent.agentClassId) {
      const evalRes = this.denied(agentId, rawService, canonical, 'MISSING_AGENT_CLASS', status, null);
      await this.auditDenied(evalRes, principal?.type);
      return evalRes;
    }
    const agentClass = await this.agentClassRepository.findOne({ where: { id: agent.agentClassId } });
    if (!agentClass) {
      const evalRes = this.denied(agentId, rawService, canonical, 'AGENT_CLASS_NOT_FOUND', status, agent.agentClassId);
      await this.auditDenied(evalRes, principal?.type);
      return evalRes;
    }
    if (agentClass.deletedAt !== null) {
      const evalRes = this.denied(agentId, rawService, canonical, 'AGENT_CLASS_DELETED', status, agentClass.id);
      await this.auditDenied(evalRes, principal?.type);
      return evalRes;
    }
    if (!agentClass.isActive) {
      const evalRes = this.denied(agentId, rawService, canonical, 'AGENT_CLASS_INACTIVE', status, agentClass.id, false, agentClass.applicableServices, agentClass.applicableLimits);
      await this.auditDenied(evalRes, principal?.type);
      return evalRes;
    }

    // 7. applicableServices must be meaningful runtime policy, not decorative
    const applicable = agentClass.applicableServices;
    // Fail closed on NULL/empty/malformed
    if (applicable === null || applicable === undefined) {
      const evalRes = this.denied(agentId, rawService, canonical, 'EMPTY_APPLICABLE_SERVICES', status, agentClass.id, true, applicable, agentClass.applicableLimits);
      await this.auditDenied(evalRes, principal?.type);
      return evalRes;
    }
    if (!Array.isArray(applicable)) {
      const evalRes = this.denied(agentId, rawService, canonical, 'MALFORMED_APPLICABLE_SERVICES', status, agentClass.id, true, applicable, agentClass.applicableLimits);
      await this.auditDenied(evalRes, principal?.type);
      return evalRes;
    }
    if (applicable.length === 0) {
      const evalRes = this.denied(agentId, rawService, canonical, 'EMPTY_APPLICABLE_SERVICES', status, agentClass.id, true, applicable, agentClass.applicableLimits);
      await this.auditDenied(evalRes, principal?.type);
      return evalRes;
    }
    // Validate that applicableServices is an array of known services (after normalization)
    const normalizedApplicable: AgentService[] = [];
    for (const entry of applicable) {
      const n = normalizeAgentService(entry as unknown as string);
      if (!n) {
        // Malformed entry — fail closed per J: malformed/unknown service → DENIED
        // But we treat the class config as malformed; deny the request
        const evalRes = this.denied(agentId, rawService, canonical, 'MALFORMED_APPLICABLE_SERVICES', status, agentClass.id, true, applicable, agentClass.applicableLimits);
        await this.auditDenied(evalRes, principal?.type);
        return evalRes;
      }
      normalizedApplicable.push(n);
    }
    // Now check if requested canonical is included
    if (!normalizedApplicable.includes(canonical)) {
      const evalRes = this.denied(agentId, rawService, canonical, 'SERVICE_NOT_PERMITTED', status, agentClass.id, true, applicable, agentClass.applicableLimits);
      await this.auditDenied(evalRes, principal?.type);
      return evalRes;
    }

    // 8. ALLOWED — return evaluation with context for future limits
    return {
      allowed: true,
      decision: 'ALLOWED',
      reason: 'ALLOWED',
      agentId,
      service: rawService,
      canonicalService: canonical,
      agentStatus: status,
      agentClassId: agentClass.id,
      agentClassActive: true,
      applicableServices: applicable,
      applicableLimits: agentClass.applicableLimits,
    };
  }

  private denied(
    agentId: string,
    rawService: string,
    canonical: AgentService | null,
    reason: CapabilityReason,
    agentStatus?: string,
    agentClassId?: string | null,
    agentClassActive?: boolean,
    applicableServices?: unknown,
    applicableLimits?: unknown,
  ): AgentServiceCapabilityEvaluation {
    return {
      allowed: false,
      decision: 'DENIED',
      reason,
      agentId,
      service: rawService,
      canonicalService: canonical,
      agentStatus,
      agentClassId: agentClassId ?? undefined,
      agentClassActive,
      applicableServices,
      applicableLimits,
    };
  }

  private async auditDenied(
    evaluation: AgentServiceCapabilityEvaluation,
    principalType?: string,
  ): Promise<void> {
    // Record denied attempts via audit without secrets/PINs.
    // Do not create noisy audit for allowed reads; only denied.
    // Use a best-effort fire-and-forget transaction; failures must not block evaluation.
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.auditService.record(manager, {
          entityType: 'AGENT_SERVICE_CAPABILITY',
          entityId: evaluation.agentId,
          action: 'DENIED',
          actor: principalType ?? 'system',
          newValues: {
            service: evaluation.service,
            canonicalService: evaluation.canonicalService,
            reason: evaluation.reason,
            agentStatus: evaluation.agentStatus ?? null,
            agentClassId: evaluation.agentClassId ?? null,
            agentClassActive: evaluation.agentClassActive ?? null,
          },
        });
      });
    } catch {
      // Best-effort: audit failure must not break capability check
    }
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }
}
