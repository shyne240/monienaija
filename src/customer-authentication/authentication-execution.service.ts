import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';

import { Customer } from '../customer/customer.entity';
import { CustomerContactMethod } from '../customer/customer-contact-method.entity';
import { ContactMethodType, CustomerStatus } from '../customer/customer.enums';
import { AuditService } from '../operations/audit.service';
import { CustomerAuthenticationCredential } from './customer-authentication-credential.entity';
import { AuthenticationCredentialStatus } from './customer-authentication.enums';
import { CustomerAuthenticationService } from './customer-authentication.service';
import { PasswordHashVerificationService } from './password-hash-verification.service';

export interface AuthenticationExecutionCommand {
  /**
   * Accepts customer UUID, customer reference (e.g. mn-8012345678), or
   * Nigerian phone number (e.g. 08012345678, +2348012345678, 8012345678).
   */
  customerId: string;
  password: string;
  actor: string;
}

export type AuthenticationFailureReason =
  | 'INVALID_CREDENTIALS'
  | 'CREDENTIAL_UNAVAILABLE'
  | 'CUSTOMER_STATUS_INELIGIBLE';

export interface AuthenticationExecutionResult {
  authenticated: boolean;
  customerId: string;
  credentialId?: string;
  passwordVersion?: number;
  failureReason?: AuthenticationFailureReason;
  accountLocked?: boolean;
  /** Set only on successful verification of a credential that still carries the
   *  first-login rotation flag (workforce-issued temporary credential). */
  rotationRequired?: boolean;
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
    @Optional()
    @InjectRepository(CustomerContactMethod)
    private readonly contactRepository?: Repository<CustomerContactMethod>,
  ) {}

  async authenticate(
    command: AuthenticationExecutionCommand,
  ): Promise<AuthenticationExecutionResult> {
    const rawIdentifier = (command.customerId ?? '').trim();
    const actor = this.normalizeActor(command.actor || rawIdentifier || 'customer');

    if (!rawIdentifier || rawIdentifier.length > 160) {
      return this.invalidCredentials(rawIdentifier);
    }
    if (typeof command.password !== 'string' || command.password.length === 0) {
      return this.invalidCredentials(rawIdentifier);
    }
    if (command.password.length > MAX_PASSWORD_LENGTH) {
      return this.invalidCredentials(rawIdentifier);
    }

    // Resolve Customer by UUID, customer reference, or Nigerian phone number
    const customer = await this.resolveCustomer(rawIdentifier);
    if (!customer || customer.deletedAt !== null) {
      return this.invalidCredentials(rawIdentifier);
    }

    const customerId = customer.id;
    const credential = await this.credentialRepository.findOne({
      where: { customerId, deletedAt: IsNull() },
    });
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

    // Invariant: a verified credential must not produce a session while the customer's
    // status is not ACTIVE (e.g. DRAFT pre-activation, SUSPENDED, CLOSED).
    if (customer.status !== CustomerStatus.ACTIVE) {
      await this.recordStatusIneligibleAuthentication(credential, actor, customer.status);
      return {
        authenticated: false,
        customerId,
        credentialId: credential.id,
        passwordVersion: credential.passwordVersion,
        failureReason: 'CUSTOMER_STATUS_INELIGIBLE',
        accountLocked: credential.accountLocked,
      };
    }

    await this.recordSuccessfulAuthentication(credential, actor);
    return {
      authenticated: true,
      customerId,
      credentialId: credential.id,
      passwordVersion: credential.passwordVersion,
      accountLocked: false,
      ...(credential.rotationRequired ? { rotationRequired: true } : {}),
    };
  }

  private async resolveCustomer(identifier: string): Promise<Customer | null> {
    // 1. Direct UUID match
    if (UUID_PATTERN.test(identifier)) {
      const match = await this.customerRepository.findOne({
        where: { id: identifier.toLowerCase(), deletedAt: IsNull() },
      });
      if (match) return match;
    }

    // 2. Customer reference match (e.g. mn-8012345678)
    if (identifier.toLowerCase().startsWith('mn-')) {
      const match = await this.customerRepository.findOne({
        where: { reference: identifier.toLowerCase(), deletedAt: IsNull() },
      });
      if (match) return match;
    }

    // 3. Nigerian phone number match
    const canonicalPhone = this.tryNormalizeNigerianPhone(identifier);
    if (canonicalPhone && this.contactRepository) {
      const contact = await this.contactRepository.findOne({
        where: {
          type: ContactMethodType.PHONE,
          normalizedValue: canonicalPhone,
          deletedAt: IsNull(),
        },
      });
      if (contact) {
        const match = await this.customerRepository.findOne({
          where: { id: contact.customerId, deletedAt: IsNull() },
        });
        if (match) return match;
      }
    }

    // 4. General reference lookup fallback
    return this.customerRepository.findOne({
      where: { reference: identifier.toLowerCase(), deletedAt: IsNull() },
    });
  }

  private tryNormalizeNigerianPhone(raw: string): string | null {
    const compact = raw.replace(/[\s()-]/g, '');
    let local: string;
    if (/^\+234\d{10}$/.test(compact)) local = compact.slice(4);
    else if (/^234\d{10}$/.test(compact)) local = compact.slice(3);
    else if (/^0\d{10}$/.test(compact)) local = compact.slice(1);
    else if (/^\d{10}$/.test(compact)) local = compact;
    else return null;
    if (!/^[789]\d{9}$/.test(local)) return null;
    return local;
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

  private async recordStatusIneligibleAuthentication(
    credential: CustomerAuthenticationCredential,
    actor: string,
    status: CustomerStatus,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      await this.auditService.record(manager, {
        entityType: 'CUSTOMER_AUTHENTICATION_CREDENTIAL',
        entityId: credential.id,
        action: 'AUTHENTICATION_STATUS_INELIGIBLE',
        actor,
        newValues: {
          customerId: credential.customerId,
          credentialId: credential.id,
          outcome: 'AUTHENTICATION_STATUS_INELIGIBLE',
          customerStatus: status,
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
