import { createHash, randomBytes } from 'node:crypto';

import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, MoreThan, Repository } from 'typeorm';

import type { AuthenticationExecutionResult } from './authentication-execution.service';
import { CustomerFinancialEligibilityService } from '../kyc-verification/customer-financial-eligibility.service';
import { AuditService } from '../operations/audit.service';
import { Customer } from '../customer/customer.entity';
import { CustomerStatus } from '../customer/customer.enums';
import { AuthenticationSession } from './authentication-session.entity';
import { AuthenticationSessionStatus } from './authentication-session.enums';
import type {
  AuthenticatedPrincipal,
  AuthenticationSessionToken,
  AuthenticationSessionValidation,
  AuthenticationSessionView,
  CustomerSessionValidator,
  IssueAuthenticationSessionCommand,
  RevokeAuthenticationSessionCommand,
  RevokeCredentialSessionsOptions,
  RevokeCustomerSessionsOptions,
  RotateAuthenticationSessionCommand,
  SessionValidationMode,
  ValidateAuthenticationSessionCommand,
} from './authentication-session.types';

export const DEFAULT_SESSION_AUDIENCE = 'customer-api';
export const DEFAULT_SESSION_TTL_SECONDS = 3600;
export const MIN_SESSION_TTL_SECONDS = 60;
export const MAX_SESSION_TTL_SECONDS = 86_400;
export const FINANCIAL_ELIGIBILITY_WITHDRAWN_REASON = 'FINANCIAL_ELIGIBILITY_WITHDRAWN';
export const READ_LAST_SEEN_REFRESH_INTERVAL_MS = 60_000;

const TOKEN_BYTES = 32;
const MAX_TOKEN_LENGTH = 256;
const MAX_AUDIENCE_LENGTH = 80;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRUSTED_KYC_UNAVAILABLE_MESSAGE = 'Trusted KYC evidence is unavailable';

function hasQuery(manager: EntityManager): boolean {
  return typeof (manager as { query?: unknown }).query === 'function';
}

@Injectable()
export class AuthenticationSessionService implements CustomerSessionValidator {
  constructor(
    @InjectRepository(AuthenticationSession)
    private readonly sessionRepository: Repository<AuthenticationSession>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    private readonly financialEligibility: CustomerFinancialEligibilityService,
  ) {}

  async issue(command: IssueAuthenticationSessionCommand): Promise<AuthenticationSessionToken> {
    return this.dataSource.transaction((manager) => this.issueInManager(manager, command));
  }

  async issueInManager(
    manager: EntityManager,
    command: IssueAuthenticationSessionCommand,
  ): Promise<AuthenticationSessionToken> {
    this.assertSuccessfulAuthentication(command.authentication);
    const actor = this.normalizeActor(command.actor);
    const audience = this.normalizeAudience(command.audience ?? DEFAULT_SESSION_AUDIENCE);
    const now = command.now ?? new Date();
    const ttlSeconds = this.normalizeTtl(command.ttlSeconds);
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const accessToken = randomBytes(TOKEN_BYTES).toString('base64url');
    const tokenHash = this.hashToken(accessToken);
    const credentialId = this.requiredCredentialId(command.authentication);

    await this.financialEligibility.require(manager, command.authentication.customerId);
    const boundPasswordVersion = await this.resolveBoundPasswordVersionForIssue(
      manager,
      command.authentication.customerId,
      credentialId,
      command.authentication.passwordVersion,
    );

    const repository = manager.getRepository(AuthenticationSession);
    const saved = await repository.save(
      repository.create({
        id: randomUuid(),
        customerId: command.authentication.customerId,
        credentialId,
        tokenHash,
        audience,
        onboardingPasswordVersion: boundPasswordVersion,
        status: AuthenticationSessionStatus.ACTIVE,
        issuedAt: now,
        expiresAt,
        lastSeenAt: now,
        revokedAt: null,
        revokeReason: null,
        version: 1,
      }),
    );
    await this.audit(manager, saved, 'SESSION_ISSUED', actor, {
      customerId: saved.customerId,
      credentialId: saved.credentialId,
      audience: saved.audience,
      passwordVersion: saved.onboardingPasswordVersion,
      issuedAt: saved.issuedAt,
      expiresAt: saved.expiresAt,
    });
    return this.toToken(accessToken, saved);
  }

  async isFinanciallyEligible(customerId: string): Promise<boolean> {
    if (!UUID_PATTERN.test(customerId)) {
      return false;
    }
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.financialEligibility.require(manager, customerId, { lockMode: 'SHARE' });
      });
      return true;
    } catch (error) {
      if (error instanceof ConflictException) {
        return false;
      }
      throw error;
    }
  }

  async validate(
    command: ValidateAuthenticationSessionCommand,
  ): Promise<AuthenticationSessionValidation> {
    return this.validateToken(command, true, false);
  }

  async validateForLogout(
    command: ValidateAuthenticationSessionCommand,
  ): Promise<AuthenticationSessionValidation> {
    return this.validateToken(
      {
        ...command,
        audience: command.audience ?? DEFAULT_SESSION_AUDIENCE,
        mode: 'READ',
      },
      false,
      true,
    );
  }

  async validateInManager(
    manager: EntityManager,
    command: ValidateAuthenticationSessionCommand,
  ): Promise<AuthenticationSessionValidation> {
    const token = this.normalizeToken(command.token);
    if (!token) {
      return { valid: false, reason: 'MISSING_TOKEN' };
    }
    if (token.length > MAX_TOKEN_LENGTH || /\s/.test(token)) {
      return { valid: false, reason: 'MALFORMED_TOKEN' };
    }

    const audience = this.normalizeAudience(command.audience ?? DEFAULT_SESSION_AUDIENCE);
    const mode: SessionValidationMode = command.mode ?? 'READ';
    const lockMode = mode === 'READ' ? 'SHARE' : 'UPDATE';
    const tokenHash = this.hashToken(token);
    const now = command.now ?? new Date();

    if (hasQuery(manager)) {
      const rowLock = lockMode === 'SHARE' ? 'FOR SHARE' : 'FOR UPDATE';
      const rows = await manager.query<
        Array<{
          id: string;
          customer_id: string;
          credential_id: string;
          audience: string;
          onboarding_password_version: number | null;
          status: AuthenticationSessionStatus;
          issued_at: Date;
          expires_at: Date;
          last_seen_at: Date;
          revoked_at: Date | null;
          revoke_reason: string | null;
          version: number;
        }>
      >(
        `SELECT id, customer_id, credential_id, audience, onboarding_password_version,
                status, issued_at, expires_at, last_seen_at, revoked_at, revoke_reason, version
           FROM authentication_sessions
          WHERE token_hash = $1 ${rowLock}`,
        [tokenHash],
      );
      const row = rows[0];
      if (!row) {
        return { valid: false, reason: 'NOT_FOUND' };
      }
      if (row.audience !== audience) {
        return { valid: false, reason: 'WRONG_AUDIENCE' };
      }
      if (row.status === AuthenticationSessionStatus.REVOKED) {
        return { valid: false, reason: 'REVOKED' };
      }
      if (
        row.status === AuthenticationSessionStatus.EXPIRED ||
        row.expires_at.getTime() <= now.getTime()
      ) {
        return { valid: false, reason: 'EXPIRED' };
      }

      const session = {
        id: row.id,
        customerId: row.customer_id,
        credentialId: row.credential_id,
        tokenHash,
        audience: row.audience,
        onboardingPasswordVersion: row.onboarding_password_version,
        status: row.status,
        issuedAt: row.issued_at,
        expiresAt: row.expires_at,
        lastSeenAt: row.last_seen_at,
        revokedAt: row.revoked_at,
        revokeReason: row.revoke_reason,
        version: row.version,
      } as AuthenticationSession;

      try {
        await this.financialEligibility.require(manager, session.customerId, { lockMode });
        await this.requireBoundCredential(manager, session);
      } catch (error) {
        if (error instanceof ConflictException) {
          return { valid: false, reason: 'CUSTOMER_STATUS_INELIGIBLE' };
        }
        throw error;
      }

      return { valid: true, principal: this.toPrincipal(session) };
    }

    const session = await manager.getRepository(AuthenticationSession).findOne({
      where: { tokenHash },
    });
    if (!session) {
      return { valid: false, reason: 'NOT_FOUND' };
    }
    if (session.audience !== audience) {
      return { valid: false, reason: 'WRONG_AUDIENCE' };
    }
    if (session.status === AuthenticationSessionStatus.REVOKED) {
      return { valid: false, reason: 'REVOKED' };
    }
    if (
      session.status === AuthenticationSessionStatus.EXPIRED ||
      session.expiresAt.getTime() <= now.getTime()
    ) {
      return { valid: false, reason: 'EXPIRED' };
    }

    try {
      await this.financialEligibility.require(manager, session.customerId, { lockMode });
      await this.requireBoundCredential(manager, session);
    } catch (error) {
      if (error instanceof ConflictException) {
        return { valid: false, reason: 'CUSTOMER_STATUS_INELIGIBLE' };
      }
      throw error;
    }

    return { valid: true, principal: this.toPrincipal(session) };
  }

  private async validateToken(
    command: ValidateAuthenticationSessionCommand,
    requireEligibility: boolean,
    allowWithdrawnLogout: boolean,
  ): Promise<AuthenticationSessionValidation> {
    const token = this.normalizeToken(command.token);
    if (!token) {
      return { valid: false, reason: 'MISSING_TOKEN' };
    }
    if (token.length > MAX_TOKEN_LENGTH || /\s/.test(token)) {
      return { valid: false, reason: 'MALFORMED_TOKEN' };
    }

    const audience = this.normalizeAudience(command.audience ?? DEFAULT_SESSION_AUDIENCE);
    const mode: SessionValidationMode = command.mode ?? 'MUTATION';
    const session = await this.sessionRepository.findOne({
      where: { tokenHash: this.hashToken(token) },
    });
    if (!session) {
      return { valid: false, reason: 'NOT_FOUND' };
    }
    if (session.audience !== audience) {
      return { valid: false, reason: 'WRONG_AUDIENCE' };
    }

    const now = command.now ?? new Date();
    if (
      session.status === AuthenticationSessionStatus.EXPIRED ||
      session.expiresAt.getTime() <= now.getTime()
    ) {
      if (session.status === AuthenticationSessionStatus.ACTIVE) {
        await this.expire(session, now);
      }
      return { valid: false, reason: 'EXPIRED' };
    }

    if (session.status === AuthenticationSessionStatus.REVOKED) {
      if (
        allowWithdrawnLogout &&
        session.revokeReason === FINANCIAL_ELIGIBILITY_WITHDRAWN_REASON
      ) {
        return { valid: true, principal: this.toPrincipal(session) };
      }
      return { valid: false, reason: 'REVOKED' };
    }

    if (!requireEligibility) {
      return { valid: true, principal: this.toPrincipal(session) };
    }

    // Session/status binding (S-FIX-01, audit contradiction C-4): the customer's CURRENT
    // lifecycle status is authoritative at request time. When financial or credential
    // authority is substantively withdrawn, permanently revoke the financial session so
    // lifting a hold or suspension later can never silently restore an old token.
    const customer = await this.customerRepository.findOne({
      where: { id: session.customerId },
    });
    if (!customer || customer.status !== CustomerStatus.ACTIVE) {
      await this.revokeWithdrawnAuthoritySession(session, now);
      return { valid: false, reason: 'CUSTOMER_STATUS_INELIGIBLE' };
    }

    const lockMode = mode === 'READ' ? 'SHARE' : 'UPDATE';
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.financialEligibility.require(manager, session.customerId, { lockMode });
        await this.requireBoundCredential(manager, session);
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        if (error.message !== TRUSTED_KYC_UNAVAILABLE_MESSAGE) {
          await this.revokeWithdrawnAuthoritySession(session, now);
        }
        return { valid: false, reason: 'CUSTOMER_STATUS_INELIGIBLE' };
      }
      throw error;
    }

    if (mode === 'READ') {
      const stillActive = await this.refreshReadSessionActivity(session, now);
      if (!stillActive) {
        return { valid: false, reason: 'REVOKED' };
      }
      return { valid: true, principal: this.toPrincipal(session) };
    }

    const updated = await this.sessionRepository.update(
      { id: session.id, status: AuthenticationSessionStatus.ACTIVE, expiresAt: MoreThan(now) },
      { lastSeenAt: now },
    );
    if (updated.affected !== 1) return { valid: false, reason: 'REVOKED' };
    return { valid: true, principal: this.toPrincipal(session) };
  }

  private async refreshReadSessionActivity(
    session: AuthenticationSession,
    now: Date,
  ): Promise<boolean> {
    let querySucceeded = false;
    await this.dataSource.transaction(async (manager) => {
      if (!hasQuery(manager)) {
        return;
      }
      const rows = await manager.query<Array<{ status: AuthenticationSessionStatus; expires_at: Date; last_seen_at: Date }>>(
        `SELECT status, expires_at, last_seen_at
           FROM authentication_sessions
          WHERE id = $1
          FOR SHARE`,
        [session.id],
      );
      const current = rows[0];
      if (
        !current ||
        current.status !== AuthenticationSessionStatus.ACTIVE ||
        current.expires_at.getTime() <= now.getTime()
      ) {
        querySucceeded = false;
        return;
      }
      querySucceeded = true;
      if (now.getTime() - current.last_seen_at.getTime() >= READ_LAST_SEEN_REFRESH_INTERVAL_MS) {
        await manager.query(
          `UPDATE authentication_sessions
              SET last_seen_at = $2
            WHERE id = (
              SELECT id
                FROM authentication_sessions
               WHERE id = $1
                 AND status = 'ACTIVE'
                 AND expires_at > $2
                 AND last_seen_at <= $3
               FOR NO KEY UPDATE SKIP LOCKED
            )`,
          [
            session.id,
            now,
            new Date(now.getTime() - READ_LAST_SEEN_REFRESH_INTERVAL_MS),
          ],
        );
      }
    });

    if (querySucceeded) {
      return true;
    }
    const fresh = await this.sessionRepository.findOne({ where: { id: session.id } });
    return (
      !!fresh &&
      fresh.status === AuthenticationSessionStatus.ACTIVE &&
      fresh.expiresAt.getTime() > now.getTime()
    );
  }

  private async revokeWithdrawnAuthoritySession(
    session: AuthenticationSession,
    now: Date,
  ): Promise<void> {
    if (session.audience !== DEFAULT_SESSION_AUDIENCE) {
      return;
    }
    await this.dataSource.transaction(async (manager) => {
      if (hasQuery(manager)) {
        const revoked = await manager.query<Array<{ id: string }>>(
          `WITH updated AS (
             UPDATE authentication_sessions
                SET status = 'REVOKED',
                    revoked_at = $2,
                    revoke_reason = $3,
                    version = version + 1,
                    updated_at = clock_timestamp()
              WHERE id = $1
                AND status = 'ACTIVE'
             RETURNING id
           )
           SELECT id FROM updated`,
          [session.id, now, FINANCIAL_ELIGIBILITY_WITHDRAWN_REASON],
        );
        if (revoked[0]) {
          await this.auditService.record(manager, {
            entityType: 'AUTHENTICATION_SESSION',
            entityId: session.id,
            action: 'SESSION_REVOKED',
            actor: 'session-eligibility-guard',
            newValues: {
              customerId: session.customerId,
              credentialId: session.credentialId,
              audience: session.audience,
              revokeReason: FINANCIAL_ELIGIBILITY_WITHDRAWN_REASON,
            },
          });
        }
        return;
      }

      const repository = manager.getRepository(AuthenticationSession);
      const current = await repository.findOne({ where: { id: session.id } });
      if (!current || current.status !== AuthenticationSessionStatus.ACTIVE) {
        return;
      }
      current.status = AuthenticationSessionStatus.REVOKED;
      current.revokedAt = now;
      current.revokeReason = FINANCIAL_ELIGIBILITY_WITHDRAWN_REASON;
      const saved = await repository.save(current);
      await this.audit(manager, saved, 'SESSION_REVOKED', 'session-eligibility-guard', {
        customerId: saved.customerId,
        credentialId: saved.credentialId,
        audience: saved.audience,
        revokeReason: saved.revokeReason,
      });
    });
  }

  async revoke(
    command: RevokeAuthenticationSessionCommand,
  ): Promise<AuthenticationSessionValidation> {
    const now = command.now ?? new Date();
    const validation = await this.validateForLogout({
      token: command.token,
      audience: DEFAULT_SESSION_AUDIENCE,
      now,
    });
    if (!validation.valid || !validation.principal) {
      return validation;
    }

    const actor = this.normalizeActor(command.actor);
    const reason = this.normalizeReason(command.reason) ?? 'Customer logout';
    const session = await this.sessionRepository.findOne({
      where: { id: validation.principal.sessionId },
    });
    if (!session) {
      return { valid: false, reason: 'NOT_FOUND' };
    }
    const canAcknowledgeWithdrawn =
      session.status === AuthenticationSessionStatus.REVOKED &&
      session.revokeReason === FINANCIAL_ELIGIBILITY_WITHDRAWN_REASON;
    if (session.status !== AuthenticationSessionStatus.ACTIVE && !canAcknowledgeWithdrawn) {
      return { valid: false, reason: 'REVOKED', principal: validation.principal };
    }

    await this.dataSource.transaction(async (manager) => {
      session.status = AuthenticationSessionStatus.REVOKED;
      session.revokedAt = session.revokedAt ?? now;
      session.revokeReason = reason;
      const saved = await manager.getRepository(AuthenticationSession).save(session);
      await this.audit(manager, saved, 'SESSION_REVOKED', actor, {
        customerId: saved.customerId,
        audience: saved.audience,
        revokeReason: saved.revokeReason,
      });
    });
    return { valid: false, reason: 'REVOKED', principal: validation.principal };
  }

  async rotate(
    command: RotateAuthenticationSessionCommand,
  ): Promise<AuthenticationSessionToken | null> {
    const token = this.normalizeToken(command.token);
    if (!token || token.length > MAX_TOKEN_LENGTH || /\s/.test(token)) {
      return null;
    }

    const audience = DEFAULT_SESSION_AUDIENCE;
    const actor = this.normalizeActor(command.actor);
    const reason = this.normalizeReason(command.reason) ?? 'Session rotated';
    const now = command.now ?? new Date();
    const ttlSeconds = this.normalizeTtl(command.ttlSeconds);
    const existing = await this.sessionRepository.findOne({
      where: { tokenHash: this.hashToken(token) },
    });
    if (
      !existing ||
      existing.audience !== audience ||
      existing.status !== AuthenticationSessionStatus.ACTIVE
    ) {
      return null;
    }
    if (existing.expiresAt.getTime() <= now.getTime()) {
      await this.expire(existing, now);
      return null;
    }

    const accessToken = randomBytes(TOKEN_BYTES).toString('base64url');
    const replacementHash = this.hashToken(accessToken);
    try {
      const replacement = await this.dataSource.transaction(async (manager) => {
        await this.financialEligibility.require(manager, existing.customerId);
        await this.requireBoundCredential(manager, existing);
        const boundVersion = await this.resolveBoundPasswordVersionForIssue(
          manager,
          existing.customerId,
          existing.credentialId,
          existing.onboardingPasswordVersion ?? undefined,
        );
        const repository = manager.getRepository(AuthenticationSession);
        const changed = await repository.update(
          { id: existing.id, status: AuthenticationSessionStatus.ACTIVE, expiresAt: MoreThan(now) },
          { status: AuthenticationSessionStatus.REVOKED, revokedAt: now, revokeReason: reason },
        );
        if (changed.affected !== 1) return null;
        const revoked = {
          ...existing,
          status: AuthenticationSessionStatus.REVOKED,
          revokedAt: now,
          revokeReason: reason,
        };
        await this.audit(manager, revoked, 'SESSION_ROTATED', actor, {
          customerId: revoked.customerId,
          audience: revoked.audience,
          replacementIssued: true,
        });

        const saved = await repository.save(
          repository.create({
            id: randomUuid(),
            customerId: revoked.customerId,
            credentialId: revoked.credentialId,
            tokenHash: replacementHash,
            audience,
            onboardingPasswordVersion: boundVersion,
            status: AuthenticationSessionStatus.ACTIVE,
            issuedAt: now,
            expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
            lastSeenAt: now,
            revokedAt: null,
            revokeReason: null,
            version: 1,
          }),
        );
        await this.audit(manager, saved, 'SESSION_ISSUED', actor, {
          customerId: saved.customerId,
          credentialId: saved.credentialId,
          audience: saved.audience,
          passwordVersion: saved.onboardingPasswordVersion,
          issuedAt: saved.issuedAt,
          expiresAt: saved.expiresAt,
          rotatedFromSessionId: revoked.id,
        });
        return saved;
      });

      return replacement ? this.toToken(accessToken, replacement) : null;
    } catch (error) {
      if (error instanceof ConflictException) {
        if (error.message !== TRUSTED_KYC_UNAVAILABLE_MESSAGE) {
          await this.revokeWithdrawnAuthoritySession(existing, now);
        }
        return null;
      }
      throw error;
    }
  }

  private async resolveBoundPasswordVersionForIssue(
    manager: EntityManager,
    customerId: string,
    credentialId: string,
    expectedVersion?: number,
  ): Promise<number> {
    if (!hasQuery(manager)) {
      const fallback = expectedVersion ?? 1;
      if (!Number.isSafeInteger(fallback) || fallback < 1) {
        throw new ConflictException('Credential is no longer eligible');
      }
      return fallback;
    }

    const rows = await manager.query<Array<{ password_version: number }>>(
      `SELECT password_version
         FROM customer_authentication_credentials
        WHERE id = $1
          AND customer_id = $2
          AND deleted_at IS NULL
          AND status = 'ACTIVE'
          AND NOT account_locked
          AND NOT rotation_required
          AND (password_expires_at IS NULL OR password_expires_at > clock_timestamp())
        FOR SHARE`,
      [credentialId, customerId],
    );
    const currentVersion = rows[0]?.password_version;
    if (currentVersion === undefined || currentVersion < 1) {
      throw new ConflictException('Credential is no longer eligible');
    }
    if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
      throw new ConflictException('Credential is no longer eligible');
    }
    return currentVersion;
  }

  private async requireBoundCredential(
    manager: EntityManager,
    session: AuthenticationSession,
  ): Promise<void> {
    if (session.onboardingPasswordVersion == null || session.onboardingPasswordVersion < 1) {
      throw new ConflictException('Credential is no longer eligible');
    }
    if (!hasQuery(manager)) {
      return;
    }
    const rows = await manager.query<Array<{ id: string }>>(
      `SELECT id
         FROM customer_authentication_credentials
        WHERE id = $1
          AND customer_id = $2
          AND deleted_at IS NULL
          AND status = 'ACTIVE'
          AND NOT account_locked
          AND NOT rotation_required
          AND password_version = $3
          AND (password_expires_at IS NULL OR password_expires_at > clock_timestamp())
        FOR SHARE`,
      [session.credentialId, session.customerId, session.onboardingPasswordVersion],
    );
    if (!rows.length) throw new ConflictException('Credential is no longer eligible');
  }

  async rebindSessionPasswordVersionInManager(
    manager: EntityManager,
    sessionId: string,
    customerId: string,
    credentialId: string,
    passwordVersion: number,
    actor: string,
  ): Promise<void> {
    if (!UUID_PATTERN.test(sessionId) || !UUID_PATTERN.test(credentialId)) {
      throw new BadRequestException('sessionId and credentialId must be UUIDs');
    }
    if (!Number.isSafeInteger(passwordVersion) || passwordVersion < 1) {
      throw new BadRequestException('passwordVersion must be a positive integer');
    }
    const normalizedActor = this.normalizeActor(actor);

    if (hasQuery(manager)) {
      const updated = await manager.query<Array<{ id: string; audience: string }>>(
        `WITH rebound AS (
           UPDATE authentication_sessions
              SET onboarding_password_version = $4,
                  version = version + 1,
                  updated_at = clock_timestamp()
            WHERE id = $1
              AND customer_id = $2
              AND credential_id = $3
              AND status = 'ACTIVE'
              AND expires_at > clock_timestamp()
           RETURNING id, audience
         )
         SELECT id, audience FROM rebound`,
        [sessionId, customerId, credentialId, passwordVersion],
      );
      if (!updated[0]) {
        throw new ConflictException('Current session is no longer active');
      }
      await this.auditService.record(manager, {
        entityType: 'AUTHENTICATION_SESSION',
        entityId: sessionId,
        action: 'SESSION_CREDENTIAL_VERSION_REBOUND',
        actor: normalizedActor,
        newValues: {
          customerId,
          credentialId,
          audience: updated[0].audience,
          passwordVersion,
        },
      });
      return;
    }

    const repository = manager.getRepository(AuthenticationSession);
    const session = await repository.findOne({ where: { id: sessionId } });
    if (
      !session ||
      session.customerId !== customerId ||
      session.credentialId !== credentialId ||
      session.status !== AuthenticationSessionStatus.ACTIVE
    ) {
      throw new ConflictException('Current session is no longer active');
    }
    session.onboardingPasswordVersion = passwordVersion;
    const saved = await repository.save(session);
    await this.audit(manager, saved, 'SESSION_CREDENTIAL_VERSION_REBOUND', normalizedActor, {
      customerId,
      credentialId,
      audience: saved.audience,
      passwordVersion,
    });
  }

  async revokeAllForCredential(
    credentialId: string,
    actor: string,
    reason = 'Credential invalidated',
    now = new Date(),
    options?: RevokeCredentialSessionsOptions,
  ): Promise<number> {
    if (!UUID_PATTERN.test(credentialId)) {
      throw new BadRequestException('credentialId must be a UUID');
    }
    return this.dataSource.transaction((manager) =>
      this.revokeAllForCredentialInManager(manager, credentialId, actor, reason, now, options),
    );
  }

  async revokeAllForCredentialInManager(
    manager: EntityManager,
    credentialId: string,
    actor: string,
    reason = 'Credential invalidated',
    now = new Date(),
    options?: RevokeCredentialSessionsOptions,
  ): Promise<number> {
    if (!UUID_PATTERN.test(credentialId)) {
      throw new BadRequestException('credentialId must be a UUID');
    }
    if (options?.exceptSessionId && !UUID_PATTERN.test(options.exceptSessionId)) {
      throw new BadRequestException('exceptSessionId must be a UUID');
    }
    const normalizedActor = this.normalizeActor(actor);
    const normalizedReason = this.normalizeReason(reason) ?? 'Credential invalidated';

    if (hasQuery(manager)) {
      const params: unknown[] = [
        credentialId,
        now,
        normalizedReason,
        FINANCIAL_ELIGIBILITY_WITHDRAWN_REASON,
      ];
      const excludeClause = options?.exceptSessionId
        ? `AND id <> $${params.push(options.exceptSessionId)}`
        : '';
      const rows = await manager.query<
        Array<{ id: string; customer_id: string; audience: string; was_active: boolean }>
      >(
        `WITH target AS (
           SELECT id, (status = 'ACTIVE') AS was_active
             FROM authentication_sessions
            WHERE credential_id = $1
              AND (status = 'ACTIVE' OR (status = 'REVOKED' AND revoke_reason = $4))
              ${excludeClause}
            FOR UPDATE
         ),
         updated AS (
           UPDATE authentication_sessions s
              SET status = 'REVOKED',
                  revoked_at = COALESCE(s.revoked_at, $2),
                  revoke_reason = $3,
                  version = s.version + 1,
                  updated_at = clock_timestamp()
             FROM target t
            WHERE s.id = t.id
           RETURNING s.id, s.customer_id, s.audience, t.was_active
         )
         SELECT id, customer_id, audience, was_active FROM updated`,
        params,
      );
      let activeCount = 0;
      for (const row of rows) {
        if (row.was_active) {
          activeCount += 1;
        }
        await this.auditService.record(manager, {
          entityType: 'AUTHENTICATION_SESSION',
          entityId: row.id,
          action: 'SESSION_REVOKED',
          actor: normalizedActor,
          newValues: {
            customerId: row.customer_id,
            credentialId,
            audience: row.audience,
            revokeReason: normalizedReason,
            invalidatedByCredential: true,
          },
        });
      }
      return activeCount;
    }

    const sessions = await this.sessionRepository.find({
      where: { credentialId, status: AuthenticationSessionStatus.ACTIVE },
    });
    const filtered = options?.exceptSessionId
      ? sessions.filter((candidate) => candidate.id !== options.exceptSessionId)
      : sessions;
    if (filtered.length === 0) {
      return 0;
    }
    const repository = manager.getRepository(AuthenticationSession);
    for (const session of filtered) {
      session.status = AuthenticationSessionStatus.REVOKED;
      session.revokedAt = now;
      session.revokeReason = normalizedReason;
      const saved = await repository.save(session);
      await this.audit(manager, saved, 'SESSION_REVOKED', normalizedActor, {
        customerId: saved.customerId,
        credentialId: saved.credentialId,
        audience: saved.audience,
        revokeReason: saved.revokeReason,
        invalidatedByCredential: true,
      });
    }
    return filtered.length;
  }

  async revokeAllForCustomerInManager(
    manager: EntityManager,
    customerId: string,
    actor: string,
    reason = FINANCIAL_ELIGIBILITY_WITHDRAWN_REASON,
    options?: RevokeCustomerSessionsOptions,
  ): Promise<number> {
    if (!UUID_PATTERN.test(customerId)) {
      throw new BadRequestException('customerId must be a UUID');
    }
    const normalizedActor = this.normalizeActor(actor);
    const revokeReason = options?.preserveSelfLogout
      ? FINANCIAL_ELIGIBILITY_WITHDRAWN_REASON
      : (this.normalizeReason(reason) ?? FINANCIAL_ELIGIBILITY_WITHDRAWN_REASON);
    const audiences = options?.audiences;

    if (hasQuery(manager)) {
      const params: unknown[] = [customerId, revokeReason];
      const audienceClause =
        audiences && audiences.length > 0
          ? `AND audience = ANY($${params.push([...audiences])}::text[])`
          : '';
      const rows = await manager.query<
        Array<{ id: string; credential_id: string; audience: string }>
      >(
        `WITH updated AS (
           UPDATE authentication_sessions
              SET status = 'REVOKED',
                  revoked_at = clock_timestamp(),
                  revoke_reason = $2,
                  version = version + 1,
                  updated_at = clock_timestamp()
            WHERE customer_id = $1
              AND status = 'ACTIVE'
              ${audienceClause}
           RETURNING id, credential_id, audience
         )
         SELECT id, credential_id, audience FROM updated`,
        params,
      );
      for (const row of rows) {
        await this.auditService.record(manager, {
          entityType: 'AUTHENTICATION_SESSION',
          entityId: row.id,
          action: 'SESSION_REVOKED',
          actor: normalizedActor,
          newValues: {
            customerId,
            credentialId: row.credential_id,
            audience: row.audience,
            revokeReason,
            authorityReason: this.normalizeReason(reason),
          },
        });
      }
      return rows.length;
    }

    return 0;
  }

  async getSession(sessionId: string): Promise<AuthenticationSessionView | null> {
    if (!UUID_PATTERN.test(sessionId)) {
      throw new BadRequestException('sessionId must be a UUID');
    }
    const session = await this.sessionRepository.findOne({ where: { id: sessionId } });
    return session ? this.toView(session) : null;
  }

  private async expire(session: AuthenticationSession, now: Date): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      session.status = AuthenticationSessionStatus.EXPIRED;
      const saved = await manager.getRepository(AuthenticationSession).save(session);
      await this.audit(manager, saved, 'SESSION_EXPIRED', 'session-lifecycle', {
        customerId: saved.customerId,
        audience: saved.audience,
        expiredAt: now,
      });
    });
  }

  private async audit(
    manager: EntityManager,
    session: AuthenticationSession,
    action: string,
    actor: string,
    newValues: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.record(manager, {
      entityType: 'AUTHENTICATION_SESSION',
      entityId: session.id,
      action,
      actor,
      newValues,
    });
  }

  private toToken(accessToken: string, session: AuthenticationSession): AuthenticationSessionToken {
    return {
      accessToken,
      tokenType: 'Bearer',
      sessionId: session.id,
      audience: session.audience,
      expiresAt: session.expiresAt,
      principal: this.toPrincipal(session),
    };
  }

  private toPrincipal(session: AuthenticationSession): AuthenticatedPrincipal {
    return {
      principalType: 'CUSTOMER',
      customerId: session.customerId,
      credentialId: session.credentialId,
      sessionId: session.id,
      audience: session.audience,
      authenticatedAt: session.issuedAt,
      expiresAt: session.expiresAt,
    };
  }

  private toView(session: AuthenticationSession): AuthenticationSessionView {
    return {
      id: session.id,
      customerId: session.customerId,
      credentialId: session.credentialId,
      audience: session.audience,
      status: session.status,
      issuedAt: session.issuedAt,
      expiresAt: session.expiresAt,
      lastSeenAt: session.lastSeenAt,
      revokedAt: session.revokedAt,
      version: session.version,
    };
  }

  private assertSuccessfulAuthentication(authentication: AuthenticationExecutionResult): void {
    if (
      !authentication.authenticated ||
      !authentication.customerId ||
      !authentication.credentialId
    ) {
      throw new ConflictException('A successful authentication result is required');
    }
  }

  private requiredCredentialId(authentication: AuthenticationExecutionResult): string {
    if (!authentication.credentialId || !UUID_PATTERN.test(authentication.credentialId)) {
      throw new ConflictException('Authentication result credential is invalid');
    }
    return authentication.credentialId;
  }

  private normalizeAudience(value: string): string {
    const audience = value.trim();
    if (
      !audience ||
      audience.length > MAX_AUDIENCE_LENGTH ||
      !/^[a-z0-9][a-z0-9_.:-]*$/.test(audience)
    ) {
      throw new BadRequestException('audience is invalid');
    }
    return audience;
  }

  private normalizeActor(value: string): string {
    const actor = value.trim();
    if (!actor || actor.length > 160) {
      throw new BadRequestException('actor must contain 1 to 160 characters');
    }
    return actor;
  }

  private normalizeReason(value: string | undefined): string | null {
    if (value === undefined) {
      return null;
    }
    const reason = value.trim();
    if (reason.length > 500) {
      throw new BadRequestException('reason must contain at most 500 characters');
    }
    return reason || null;
  }

  private normalizeToken(value: string): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const token = value.trim();
    return token || null;
  }

  private normalizeTtl(value: number | undefined): number {
    const ttl = value ?? DEFAULT_SESSION_TTL_SECONDS;
    if (
      !Number.isSafeInteger(ttl) ||
      ttl < MIN_SESSION_TTL_SECONDS ||
      ttl > MAX_SESSION_TTL_SECONDS
    ) {
      throw new BadRequestException(
        `ttlSeconds must be between ${MIN_SESSION_TTL_SECONDS} and ${MAX_SESSION_TTL_SECONDS}`,
      );
    }
    return ttl;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}

function randomUuid(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] ?? 0) & 0x0f;
  bytes[6] = (bytes[6] ?? 0) | 0x40;
  bytes[8] = (bytes[8] ?? 0) & 0x3f;
  bytes[8] = (bytes[8] ?? 0) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
