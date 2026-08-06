import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { Customer } from '../customer/customer.entity';
import { AuditService } from '../operations/audit.service';
import { CustomerAuthenticationCredential } from './customer-authentication-credential.entity';
import { AuthenticationCredentialStatus } from './customer-authentication.enums';
import { CustomerAuthenticationService } from './customer-authentication.service';
import { PasswordHashVerificationService } from './password-hash-verification.service';

export interface AuthenticationExecutionCommand {
  customerId: string;
  password: string;
  actor: string;
}

export type AuthenticationFailureReason = 'INVALID_CREDENTIALS' | 'CREDENTIAL_UNAVAILABLE';

export interface AuthenticationExecutionResult {
  authenticated: boolean;
  customerId: string;
  credentialId?: string;
  passwordVersion?: number;
  failureReason?: AuthenticationFailureReason;
  accountLocked?: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PASSWORD_LENGTH = 1024;

@Injectable()
export class AuthenticationExecutionService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(CustomerAuthenticationCredential)
    private readonly credentialRepository: Repository<CustomerAuthenticationCredential>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly customerAuthenticationService: CustomerAuthenticationService,
    private readonly passwordHashVerificationService: PasswordHashVerificationService,
  ) {}

  async authenticate(
    command: AuthenticationExecutionCommand,
  ): Promise<AuthenticationExecutionResult> {
    const customerId = command.customerId.trim().toLowerCase();
    const actor = this.normalizeActor(command.actor);
    if (!UUID_PATTERN.test(customerId)) {
      return this.invalidCredentials(customerId);
    }
    if (typeof command.password !== 'string' || command.password.length === 0) {
      return this.invalidCredentials(customerId);
    }
    if (command.password.length > MAX_PASSWORD_LENGTH) {
      return this.invalidCredentials(customerId);
    }

    const customer = await this.customerRepository.findOne({ where: { id: customerId } });
    if (!customer || customer.deletedAt !== null) {
      return this.invalidCredentials(customerId);
    }

    const credential = await this.credentialRepository.findOne({ where: { customerId } });
    if (!credential || credential.deletedAt !== null) {
      return this.invalidCredentials(customerId);
    }

    const availability = this.credentialAvailability(credential);
    if (availability !== null) {
      return {
        authenticated: false,
        customerId,
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
      await this.customerAuthenticationService.recordFailedAuthentication(
        customerId,
        credential.id,
        {
          actor,
          reason: `Authentication verification failed: ${verification.failure ?? 'UNKNOWN'}`,
        },
      );
      return this.invalidCredentials(customerId);
    }

    await this.recordSuccessfulAuthentication(credential, actor);
    return {
      authenticated: true,
      customerId,
      credentialId: credential.id,
      passwordVersion: credential.passwordVersion,
      accountLocked: false,
    };
  }

  private credentialAvailability(
    credential: CustomerAuthenticationCredential,
  ): AuthenticationFailureReason | null {
    if (
      credential.status !== AuthenticationCredentialStatus.ACTIVE ||
      credential.accountLocked ||
      (credential.passwordExpiresAt !== null &&
        credential.passwordExpiresAt.getTime() <= Date.now())
    ) {
      return 'CREDENTIAL_UNAVAILABLE';
    }
    return null;
  }

  private async recordSuccessfulAuthentication(
    credential: CustomerAuthenticationCredential,
    actor: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      await this.auditService.record(manager, {
        entityType: 'CUSTOMER_AUTHENTICATION_CREDENTIAL',
        entityId: credential.id,
        action: 'AUTHENTICATED',
        actor,
        newValues: {
          customerId: credential.customerId,
          credentialId: credential.id,
          hashAlgorithm: credential.hashAlgorithm,
          passwordVersion: credential.passwordVersion,
          outcome: 'AUTHENTICATED',
        },
      });
    });
  }

  private invalidCredentials(customerId: string): AuthenticationExecutionResult {
    return {
      authenticated: false,
      customerId,
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
