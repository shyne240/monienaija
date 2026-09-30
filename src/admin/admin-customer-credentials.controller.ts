import {
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { DataSource, EntityManager, IsNull, Not, Repository } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { ContactMethodType } from '../customer/customer.enums';
import { CustomerContactMethod } from '../customer/customer-contact-method.entity';
import { CustomerAuthenticationService } from '../customer-authentication/customer-authentication.service';
import { AuthenticationSessionService } from '../customer-authentication/authentication-session.service';
import { PasswordHashAlgorithm } from '../customer-authentication/customer-authentication.enums';
import { NOTIFICATION_PROVIDER_TOKEN } from '../notification/notification.constants';
import { CUSTOMER_TEMPORARY_CREDENTIAL_EVENT_TYPE } from '../notification/notification-security.constants';
import type { NotificationProvider } from '../notification/notification.types';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * V1-CUSTOMER-CREDENTIALS-01 — workforce issuance of Customer login credentials.
 *
 * Closes the verified V1 gap: customer registration → verified phone → DRAFT → KYC →
 * workforce activation existed, but nothing created `customer_authentication_credentials`,
 * so an ACTIVATED customer could never log in without manual SQL.
 *
 * Flow (mirrors the Agent precedent, with the customer-side delivery substrate):
 * workforce (OPERATOR/SERVICE/PRIVILEGED — same actor vocabulary as
 * AdminAgentCredentialsController, SUPPORT denied) issues a TEMPORARY credential for an
 * ACTIVE customer. The plaintext temporary password is generated HERE (CSPRNG), hashed
 * with the house PBKDF2 convention, and persisted ONLY as the hash. Unlike Agents (no
 * V1 SMS substrate, operator-mediated delivery), customers have an active phone
 * channel: the temporary credential is delivered out-of-band via SMS to the customer's
 * VERIFIED PRIMARY PHONE through the provider-neutral SMS abstraction
 * (NOTIFICATION_PROVIDER_TOKEN → robase in configured environments, console/test
 * otherwise) — the same substrate as the registration OTP, deliberately NOT routed
 * through the notification outbox (an outbox record would persist the secret).
 * The plaintext is NEVER returned in this response, persisted, audited, or logged —
 * beyond the transient delivery message it exists nowhere.
 *
 * The credential carries rotationRequired=true and a bounded expiry; the customer's
 * first login cannot produce a session until it rotates via
 * POST /api/v1/customers/credentials/rotate.
 *
 * No financial side effects: credential issuance touches only credential/session/audit
 * state plus the out-of-band delivery attempt.
 */
const TEMPORARY_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours
const TEMPORARY_PASSWORD_BYTES = 12; // 16 base64url chars, ~96 bits
const PBKDF2_ITERATIONS = 10_000;

@Controller('internal/admin/customers')
export class AdminCustomerCredentialsController {
  private readonly logger = new Logger(AdminCustomerCredentialsController.name);

  constructor(
    @InjectRepository(CustomerContactMethod)
    private readonly contactRepository: Repository<CustomerContactMethod>,
    private readonly customerAuthenticationService: CustomerAuthenticationService,
    private readonly sessionService: AuthenticationSessionService,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    @Inject(NOTIFICATION_PROVIDER_TOKEN)
    private readonly provider: NotificationProvider,
  ) {}

  @Post(':id/credentials')
  @HttpCode(200)
  async issueInitialCredential(@Param('id') customerId: string, @Req() req: AuthenticatedRequest) {
    const actor = this.requireOperational(req);
    const { plaintext, hash } = this.generateTemporaryCredential();
    const credential = await this.customerAuthenticationService.issueInitialCredential(customerId, {
      passwordHash: hash,
      hashAlgorithm: PasswordHashAlgorithm.PBKDF2,
      passwordExpiresAt: new Date(Date.now() + TEMPORARY_PASSWORD_TTL_MS).toISOString(),
      actor,
    });
    // Persistence + issuance audit committed; delivery is to the CUSTOMER channel and is
    // failure-isolated: the result is surfaced truthfully so the workforce can reissue.
    const delivery = await this.deliverTemporaryCredential({
      customerId: credential.customerId,
      credentialId: credential.id,
      temporaryPassword: plaintext,
      actor,
    });
    return this.issuanceView(
      credential.customerId,
      credential.id,
      credential.passwordExpiresAt,
      delivery,
      false,
    );
  }

  @Post(':id/credentials/reissue')
  @HttpCode(200)
  async reissueInitialCredential(
    @Param('id') customerId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = this.requireOperational(req);
    const { plaintext, hash } = this.generateTemporaryCredential();
    const { credential, previousCredentialId } =
      await this.customerAuthenticationService.reissueInitialCredential(customerId, {
        passwordHash: hash,
        hashAlgorithm: PasswordHashAlgorithm.PBKDF2,
        passwordExpiresAt: new Date(Date.now() + TEMPORARY_PASSWORD_TTL_MS).toISOString(),
        actor,
      });
    // Established invalidation convention: sessions of the replaced credential are revoked.
    await this.sessionService.revokeAllForCredential(
      previousCredentialId,
      actor,
      'Credential reissued by workforce',
    );
    const delivery = await this.deliverTemporaryCredential({
      customerId: credential.customerId,
      credentialId: credential.id,
      temporaryPassword: plaintext,
      actor,
    });
    return this.issuanceView(
      credential.customerId,
      credential.id,
      credential.passwordExpiresAt,
      delivery,
      true,
    );
  }

  private generateTemporaryCredential(): { plaintext: string; hash: string } {
    const plaintext = randomBytes(TEMPORARY_PASSWORD_BYTES).toString('base64url');
    const salt = randomBytes(16);
    const derived = pbkdf2Sync(plaintext, salt, PBKDF2_ITERATIONS, 32, 'sha256');
    const hash = `PBKDF2$sha256$${PBKDF2_ITERATIONS}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
    return { plaintext, hash };
  }

  /**
   * Out-of-band delivery through the EXISTING provider-neutral SMS substrate (same as the
   * registration OTP): direct provider send, never through the outbox/dispatcher (which
   * would persist the secret). The plaintext appears only inside the SMS message; the
   * audit trail records metadata only (provider + MASKED destination + outcome).
   * Delivery attempts/results never throw into the request and never include the secret.
   */
  private async deliverTemporaryCredential(params: {
    customerId: string;
    credentialId: string;
    temporaryPassword: string;
    actor: string;
  }): Promise<{
    channel: 'SMS';
    delivered: boolean;
    destination: string | null;
    provider: string;
  }> {
    const contact = await this.contactRepository.findOne({
      where: {
        customerId: params.customerId,
        type: ContactMethodType.PHONE,
        isPrimary: true,
        verifiedAt: Not(IsNull()),
        deletedAt: IsNull(),
      },
    });
    if (!contact) {
      await this.recordDeliveryAudit(params, 'TEMPORARY_CREDENTIAL_DELIVERY_FAILED', {
        provider: this.provider.name,
        reason: 'no_verified_primary_phone',
      });
      return { channel: 'SMS', delivered: false, destination: null, provider: this.provider.name };
    }
    const hours = Math.round(TEMPORARY_PASSWORD_TTL_MS / (60 * 60 * 1000));
    const message =
      `MoneyNaija: your login password is ${params.temporaryPassword}. ` +
      `It expires in ${hours} hours and must be changed at your first login. ` +
      `If you did not expect this message, contact support.`;
    let success = false;
    try {
      const result = await this.provider.send({
        channel: 'SMS',
        destination: contact.value,
        message,
        payload: {},
        eventType: CUSTOMER_TEMPORARY_CREDENTIAL_EVENT_TYPE,
        eventKey: `customer-temporary-credential:${params.credentialId}`,
        recipientType: 'CUSTOMER',
        recipientId: params.customerId,
      });
      success = result.success === true;
      if (!result.success) {
        this.logger.warn(
          `Customer temporary credential delivery failed via ${this.provider.name}: ${result.error ?? 'provider rejected send'}`,
        );
      }
    } catch (error) {
      // Never surface delivery internals to the caller; never log the secret.
      this.logger.warn(
        `Customer temporary credential delivery failed via ${this.provider.name}: ${(error as Error).message}`,
      );
    }
    const masked = this.maskPhone(contact.value);
    await this.recordDeliveryAudit(
      params,
      success ? 'TEMPORARY_CREDENTIAL_DELIVERED' : 'TEMPORARY_CREDENTIAL_DELIVERY_FAILED',
      { provider: this.provider.name, destination: masked },
    );
    return {
      channel: 'SMS',
      delivered: success,
      destination: masked,
      provider: this.provider.name,
    };
  }

  private async recordDeliveryAudit(
    params: { customerId: string; credentialId: string; actor: string },
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      await this.auditService.record(manager, {
        entityType: 'CUSTOMER_AUTHENTICATION_CREDENTIAL',
        entityId: params.credentialId,
        action,
        actor: params.actor,
        newValues: {
          customerId: params.customerId,
          credentialId: params.credentialId,
          ...metadata,
        },
      });
    });
  }

  /** +2348012345678 → +234••••••678 (metadata-safe rendering; never the full number). */
  private maskPhone(value: string): string {
    const tail = value.slice(-3);
    return `${value.slice(0, 4)}••••••${tail}`;
  }

  private issuanceView(
    customerId: string,
    credentialId: string,
    passwordExpiresAt: Date | null,
    delivery: { channel: 'SMS'; delivered: boolean; destination: string | null; provider: string },
    reissued: boolean,
  ) {
    return {
      customerId,
      credentialId,
      rotationRequired: true,
      passwordExpiresAt: passwordExpiresAt?.toISOString() ?? null,
      reissued,
      delivery,
      deliveryNotice:
        'Temporary credential delivered to the customer verified phone via SMS; it expires and must be rotated at first login. The plaintext credential is never returned in this response, persisted, or audited.',
    };
  }

  private requireOperational(req: AuthenticatedRequest): string {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    // Same actor vocabulary as AdminAgentCredentialsController (V1-AGENT-CREDENTIALS-01):
    // OPERATOR/SERVICE/PRIVILEGED only; SUPPORT, CUSTOMER, AGENT, AGGREGATOR denied.
    if (
      principal.type === 'CUSTOMER' ||
      principal.type === 'AGENT' ||
      (principal.type as string) === 'AGGREGATOR' ||
      principal.type === 'SUPPORT'
    ) {
      throw new ForbiddenException('Operational access required');
    }
    if (!['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type as string)) {
      throw new ForbiddenException('Operational access required');
    }
    return principal.principalId;
  }
}
