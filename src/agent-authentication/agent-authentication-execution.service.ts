import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { Agent } from '../agent/agent.entity';
import { AgentStatus } from '../agent/agent.enums';
import { AuditService } from '../operations/audit.service';
import { AgentAuthenticationCredential } from './agent-authentication-credential.entity';
import { AgentAuthenticationCredentialStatus } from './agent-authentication.enums';
import { AgentAuthenticationService } from './agent-authentication.service';
import { AgentPasswordHashVerificationService } from './agent-password-hash-verification.service';

export interface AgentAuthenticationExecutionCommand {
  agentId: string;
  password: string;
  actor: string;
}

export type AgentAuthenticationFailureReason = 'INVALID_CREDENTIALS' | 'CREDENTIAL_UNAVAILABLE';

export interface AgentAuthenticationExecutionResult {
  authenticated: boolean;
  agentId: string;
  credentialId?: string;
  passwordVersion?: number;
  failureReason?: AgentAuthenticationFailureReason;
  accountLocked?: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PASSWORD_LENGTH = 1024;

@Injectable()
export class AgentAuthenticationExecutionService {
  constructor(
    @InjectRepository(Agent)
    private readonly agentRepository: Repository<Agent>,
    @InjectRepository(AgentAuthenticationCredential)
    private readonly credentialRepository: Repository<AgentAuthenticationCredential>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly agentAuthenticationService: AgentAuthenticationService,
    private readonly passwordHashVerificationService: AgentPasswordHashVerificationService,
  ) {}

  async authenticate(command: AgentAuthenticationExecutionCommand): Promise<AgentAuthenticationExecutionResult> {
    const agentId = command.agentId.trim().toLowerCase();
    const actor = this.normalizeActor(command.actor);
    if (!UUID_PATTERN.test(agentId)) {
      return this.invalidCredentials(agentId);
    }
    if (typeof command.password !== 'string' || command.password.length === 0) {
      return this.invalidCredentials(agentId);
    }
    if (command.password.length > MAX_PASSWORD_LENGTH) {
      return this.invalidCredentials(agentId);
    }

    const agent = await this.agentRepository.findOne({ where: { id: agentId } });
    if (!agent || agent.deletedAt !== null) {
      return this.invalidCredentials(agentId);
    }

    if (agent.status !== AgentStatus.ACTIVE) {
      return {
        authenticated: false,
        agentId,
        failureReason: 'CREDENTIAL_UNAVAILABLE',
        accountLocked: false,
      };
    }

    const credential = await this.credentialRepository.findOne({ where: { agentId } });
    if (!credential || credential.deletedAt !== null) {
      return this.invalidCredentials(agentId);
    }

    const availability = this.credentialAvailability(credential);
    if (availability !== null) {
      return {
        authenticated: false,
        agentId,
        failureReason: 'CREDENTIAL_UNAVAILABLE',
        accountLocked: credential.accountLocked,
      };
    }

    const verification = this.passwordHashVerificationService.verify(
      command.password,
      credential.hashAlgorithm,
      credential.passwordHash,
    );
    if (!verification.verified) {
      await this.agentAuthenticationService.recordFailedAuthentication(agentId, credential.id, {
        actor,
        reason: `Agent authentication verification failed: ${verification.failure ?? 'UNKNOWN'}`,
      });
      return this.invalidCredentials(agentId);
    }

    await this.recordSuccessfulAuthentication(credential, actor);
    return {
      authenticated: true,
      agentId,
      credentialId: credential.id,
      passwordVersion: credential.passwordVersion,
      accountLocked: false,
    };
  }

  private credentialAvailability(credential: AgentAuthenticationCredential): AgentAuthenticationFailureReason | null {
    if (
      credential.status !== AgentAuthenticationCredentialStatus.ACTIVE ||
      credential.accountLocked ||
      (credential.passwordExpiresAt !== null && credential.passwordExpiresAt.getTime() <= Date.now())
    ) {
      return 'CREDENTIAL_UNAVAILABLE';
    }
    return null;
  }

  private async recordSuccessfulAuthentication(credential: AgentAuthenticationCredential, actor: string): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      await this.auditService.record(manager, {
        entityType: 'AGENT_AUTHENTICATION_CREDENTIAL',
        entityId: credential.id,
        action: 'AUTHENTICATED',
        actor,
        newValues: {
          agentId: credential.agentId,
          credentialId: credential.id,
          hashAlgorithm: credential.hashAlgorithm,
          passwordVersion: credential.passwordVersion,
          outcome: 'AUTHENTICATED',
        },
      });
    });
  }

  private invalidCredentials(agentId: string): AgentAuthenticationExecutionResult {
    return {
      authenticated: false,
      agentId,
      failureReason: 'INVALID_CREDENTIALS',
    };
  }

  private normalizeActor(value: string): string {
    const actor = value.trim();
    if (!actor || actor.length > 160) {
      throw new BadRequestException('actor must contain 1 to 160 characters');
    }
    return actor;
  }
}
