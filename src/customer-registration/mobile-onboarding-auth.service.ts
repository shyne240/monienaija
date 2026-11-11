import { ConflictException } from '@nestjs/common';
import type { CustomerFinancialEligibilityService } from '../kyc-verification/customer-financial-eligibility.service';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import type { AuditService } from '../operations/audit.service';
import { PasswordHashVerificationService } from '../customer-authentication/password-hash-verification.service';
import type { PasswordHashAlgorithm } from '../customer-authentication/customer-authentication.enums';
import { KycFoundationError } from '../kyc-verification/kyc.types';
import { UUID } from '../kyc-verification/kyc-orchestrator';
import type { KycRegistrationCompletionService } from '../kyc-verification/kyc-registration-completion.service';

const AUDIENCE = 'customer-onboarding';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
/** Phone-verified passcode exchange; financial scope requires current eligibility. */
export class MobileOnboardingAuthService {
  private readonly verifier = new PasswordHashVerificationService();
  constructor(
    private readonly db: DataSource,
    private readonly audit: AuditService,
    private readonly completion: KycRegistrationCompletionService,
    private readonly financialEligibility: CustomerFinancialEligibilityService,
  ) {}
  async route(
    sessionId: string,
    authorization: string,
  ): Promise<{ next: 'NEW' | 'LOGIN' | 'CLAIM' | 'RESUME' | 'RESUME_CLAIM' | 'PENDING' }> {
    if (!UUID.test(sessionId) || !TOKEN.test(authorization))
      throw new KycFoundationError('BLOCKED');
    return this.db.transaction(async (m) => {
      const sessions = await m.query<Array<{ phone: string }>>(
        `SELECT phone FROM kyc_registration_sessions WHERE id=$1 AND authorization_hash=$2 AND status='VERIFIED' AND verified_at IS NOT NULL AND expires_at>clock_timestamp() FOR UPDATE`,
        [sessionId, digest(authorization)],
      );
      if (!sessions[0]) throw new KycFoundationError('BLOCKED');
      const rows = await m.query<
        Array<{
          id: string;
          status: string;
          is_synthetic: boolean;
          credential: boolean;
          pin: boolean;
        }>
      >(
        `SELECT cu.id,cu.status,cu.is_synthetic,EXISTS(SELECT 1 FROM customer_authentication_credentials a WHERE a.customer_id=cu.id AND a.deleted_at IS NULL) AS credential,EXISTS(SELECT 1 FROM customer_transaction_pins p WHERE p.customer_id=cu.id AND p.deleted_at IS NULL) AS pin FROM customer_contact_methods c JOIN customers cu ON cu.id=c.customer_id WHERE c.type='PHONE' AND c.normalized_value=$1 AND c.deleted_at IS NULL AND cu.deleted_at IS NULL`,
        [sessions[0].phone],
      );
      if (!rows.length) return { next: 'NEW' };
      if (rows.length !== 1) return { next: 'PENDING' };
      const r = rows[0]!;
      if (r.status !== 'DRAFT' && r.status !== 'ACTIVE') return { next: 'PENDING' };
      if (r.is_synthetic) {
        await this.completion.assertDisposable(m);
        if (r.status !== 'DRAFT') return { next: 'PENDING' };
        if (r.credential) return { next: 'LOGIN' };
        const link = await m.query<Array<{ present: boolean }>>(
          'SELECT EXISTS(SELECT 1 FROM kyc_registration_synthetic_customer_links WHERE session_id=$1 AND customer_id=$2) AS present',
          [sessionId, r.id],
        );
        return { next: link[0]?.present ? 'RESUME' : 'PENDING' };
      }
      if (r.credential) return { next: 'LOGIN' };
      if (r.pin) return { next: 'PENDING' };
      const match = await m.query<Array<{ present: boolean }>>(
        `SELECT EXISTS(SELECT 1 FROM mobile_account_claims WHERE session_id=$1 AND customer_id=$2 AND consumed_at IS NULL) AS present`,
        [sessionId, r.id],
      );
      return { next: match[0]?.present ? 'RESUME_CLAIM' : 'CLAIM' };
    });
  }
  async login(
    sessionId: string,
    authorization: string,
    passcode: string,
  ): Promise<{
    accessToken: string;
    sessionId: string;
    customerId: string;
    audience: string;
    expiresAt: Date;
  }> {
    if (!UUID.test(sessionId) || !TOKEN.test(authorization) || !/^\d{6}$/.test(passcode))
      throw new KycFoundationError('BLOCKED');
    const result = await this.db.transaction(async (m) => {
      const sessions = await m.query<Array<{ phone: string }>>(
        `SELECT phone FROM kyc_registration_sessions WHERE id=$1 AND authorization_hash=$2 AND status='VERIFIED' AND verified_at IS NOT NULL AND expires_at>clock_timestamp() FOR UPDATE`,
        [sessionId, digest(authorization)],
      );
      if (!sessions[0]) return null;
      const rows = await m.query<
        Array<{
          customer_id: string;
          is_synthetic: boolean;
          credential_id: string;
          password_hash: string;
          password_version: number;
          hash_algorithm: PasswordHashAlgorithm;
          failed_authentication_count: number;
          account_locked: boolean;
          locked_at: Date | null;
          lock_reason: string | null;
          status: string;
          rotation_required: boolean;
          password_expires_at: Date | null;
        }>
      >(
        `SELECT cu.id customer_id,cu.is_synthetic,ac.id credential_id,ac.password_hash,ac.password_version,ac.hash_algorithm,ac.failed_authentication_count,ac.account_locked,ac.locked_at,ac.lock_reason,ac.status,ac.rotation_required,ac.password_expires_at FROM customer_contact_methods c JOIN customers cu ON cu.id=c.customer_id JOIN customer_authentication_credentials ac ON ac.customer_id=cu.id AND ac.deleted_at IS NULL WHERE c.type='PHONE' AND c.normalized_value=$1 AND c.deleted_at IS NULL AND cu.deleted_at IS NULL AND cu.status IN ('DRAFT','ACTIVE') FOR UPDATE OF cu,ac,c`,
        [sessions[0].phone],
      );
      const r = rows[0];
      if (
        !r ||
        rows.length !== 1 ||
        r.status !== 'ACTIVE' ||
        r.rotation_required ||
        (r.password_expires_at && r.password_expires_at.getTime() <= Date.now())
      )
        return null;
      if (r.is_synthetic) await this.completion.assertDisposable(m);
      if (r.account_locked) {
        if (
          r.lock_reason !== 'MOBILE_PASSCODE_COOLDOWN' ||
          !r.locked_at ||
          r.locked_at.getTime() + 15 * 60_000 > Date.now()
        )
          return null;
        await m.query(
          `UPDATE customer_authentication_credentials SET account_locked=false,locked_at=NULL,lock_reason=NULL,failed_authentication_count=0 WHERE id=$1`,
          [r.credential_id],
        );
        r.failed_authentication_count = 0;
      }
      if (!this.verifier.verify(passcode, r.hash_algorithm, r.password_hash).verified) {
        await m.query(
          `UPDATE customer_authentication_credentials SET failed_authentication_count=failed_authentication_count+1,account_locked=(failed_authentication_count+1>=5),locked_at=CASE WHEN failed_authentication_count+1>=5 THEN clock_timestamp() ELSE locked_at END,lock_reason=CASE WHEN failed_authentication_count+1>=5 THEN 'MOBILE_PASSCODE_COOLDOWN' ELSE lock_reason END,version=version+1,updated_at=clock_timestamp() WHERE id=$1`,
          [r.credential_id],
        );
        await this.audit.record(m, {
          entityType: 'CUSTOMER_AUTHENTICATION_CREDENTIAL',
          entityId: r.credential_id,
          action: 'MOBILE_AUTHENTICATION_FAILED',
          actor: 'MOBILE_ONBOARDING',
          newValues: { customerId: r.customer_id },
        });
        return null;
      }
      const active = await m.query<Array<{ id: string }>>(
        `WITH consumed AS (UPDATE kyc_registration_sessions SET status='REVOKED',authorization_hash=NULL,revoked_at=clock_timestamp() WHERE id=$1 AND status='VERIFIED' AND expires_at>clock_timestamp() RETURNING id) SELECT id FROM consumed`,
        [sessionId],
      );
      if (!active[0]) return null;
      await m.query(
        'UPDATE customer_authentication_credentials SET failed_authentication_count=0,version=version+1,updated_at=clock_timestamp() WHERE id=$1',
        [r.credential_id],
      );
      let audience = AUDIENCE;
      try {
        await this.financialEligibility.require(m, r.customer_id);
        audience = 'customer-api';
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
      }
      const token = randomBytes(32).toString('base64url'),
        id = randomUUID();
      const issued = await m.query<Array<{ expires_at: Date }>>(
        `INSERT INTO authentication_sessions(id,customer_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at,onboarding_password_version) VALUES($1,$2,$3,$4,$5,'ACTIVE',clock_timestamp(),clock_timestamp()+interval '15 minutes',clock_timestamp(),$6) RETURNING expires_at`,
        [id, r.customer_id, r.credential_id, digest(token), audience, r.password_version],
      );
      await this.audit.record(m, {
        entityType: 'AUTHENTICATION_SESSION',
        entityId: id,
        action: 'SESSION_ISSUED',
        actor: 'MOBILE_ONBOARDING',
        newValues: { customerId: r.customer_id, audience },
      });
      return {
        accessToken: token,
        sessionId: id,
        customerId: r.customer_id,
        audience,
        expiresAt: issued[0]!.expires_at,
      };
    });
    if (!result) throw new KycFoundationError('BLOCKED');
    return result;
  }
  async session(
    token: string,
    revoke = false,
  ): Promise<{
    customerId: string;
    sessionId: string;
    audience: string;
    expiresAt: Date;
    status: string;
  }> {
    if (!TOKEN.test(token)) throw new KycFoundationError('BLOCKED');
    return this.db.transaction(async (m) => {
      const rows = await m.query<
        Array<{ id: string; customer_id: string; expires_at: Date; is_synthetic: boolean }>
      >(
        `SELECT s.id,s.customer_id,s.expires_at,c.is_synthetic FROM authentication_sessions s JOIN customers c ON c.id=s.customer_id JOIN customer_authentication_credentials a ON a.id=s.credential_id AND a.customer_id=c.id WHERE s.token_hash=$1 AND s.audience=$2 AND s.status='ACTIVE' AND s.expires_at>clock_timestamp() AND c.deleted_at IS NULL AND c.status IN ('DRAFT','ACTIVE') AND a.deleted_at IS NULL AND a.status='ACTIVE' AND NOT a.account_locked AND NOT a.rotation_required AND a.password_version=s.onboarding_password_version AND (a.password_expires_at IS NULL OR a.password_expires_at>clock_timestamp()) FOR UPDATE OF s`,
        [digest(token), AUDIENCE],
      );
      const r = rows[0];
      if (!r) throw new KycFoundationError('BLOCKED');
      if (r.is_synthetic) await this.completion.assertDisposable(m);
      if (revoke) {
        await m.query(
          `UPDATE authentication_sessions SET status='REVOKED',revoked_at=clock_timestamp(),revoke_reason='Customer logout',version=version+1,updated_at=clock_timestamp() WHERE id=$1`,
          [r.id],
        );
        await this.audit.record(m, {
          entityType: 'AUTHENTICATION_SESSION',
          entityId: r.id,
          action: 'SESSION_REVOKED',
          actor: 'MOBILE_ONBOARDING',
          newValues: { customerId: r.customer_id, audience: AUDIENCE },
        });
      }
      return {
        customerId: r.customer_id,
        sessionId: r.id,
        audience: AUDIENCE,
        expiresAt: r.expires_at,
        status: revoke ? 'REVOKED' : 'ACTIVE',
      };
    });
  }
}
