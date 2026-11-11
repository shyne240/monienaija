import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import type { AuditService } from '../operations/audit.service';
import { UUID, constantTimeMacEqual } from '../kyc-verification/kyc-orchestrator';
import { KycFoundationError } from '../kyc-verification/kyc.types';
import { hashMobileSecret } from '../kyc-verification/kyc-synthetic-credentials.service';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
type Kind = 'BVN' | 'NIN';

/** No provider is injected: this path can only read already-verified evidence. */
export class MobileAccountClaimService {
  constructor(
    private readonly db: DataSource,
    private readonly audit: AuditService,
  ) {}
  private key(): { key: Buffer; version: string } | null {
    const value = process.env.KYC_OWNERSHIP_KEY_BASE64,
      version = process.env.KYC_OWNERSHIP_KEY_VERSION;
    if (
      !value ||
      !version ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(version) ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
    )
      return null;
    const key = Buffer.from(value, 'base64');
    if (key.length < 32 || key.length > 128 || key.toString('base64') !== value) return null;
    return { key, version };
  }
  private async trustedKey(m: EntityManager): Promise<Buffer | null> {
    const configured = this.key();
    if (!configured) return null;
    const keys = await m.query<Array<{ key_version: string; key_proof: string }>>(
      'SELECT key_version,key_proof FROM kyc_ownership_key_state WHERE singleton=true FOR SHARE',
    );
    const proof = createHmac('sha256', configured.key)
      .update('kyc-ownership-key-proof-v1')
      .digest('hex');
    return keys[0] &&
      keys[0].key_version === configured.version &&
      constantTimeMacEqual(keys[0].key_proof, proof)
      ? configured.key
      : null;
  }
  private async authorizedCustomer(
    m: EntityManager,
    sessionId: string,
    authorization: string,
  ): Promise<{ customerId: string; ownershipKey: Buffer | null }> {
    if (!UUID.test(sessionId) || !TOKEN.test(authorization))
      throw new KycFoundationError('BLOCKED');
    const sessions = await m.query<Array<{ phone: string }>>(
      `SELECT phone FROM kyc_registration_sessions WHERE id=$1 AND authorization_hash=$2 AND status='VERIFIED' AND verified_at IS NOT NULL AND expires_at>clock_timestamp() FOR UPDATE`,
      [sessionId, digest(authorization)],
    );
    if (!sessions[0]) throw new KycFoundationError('BLOCKED');
    // KYC writers lock the key-state row before the customer; keep that order here.
    const ownershipKey = await this.trustedKey(m);
    const customers = await m.query<Array<{ id: string }>>(
      `SELECT c.id FROM customers c JOIN customer_contact_methods p ON p.customer_id=c.id AND p.type='PHONE' AND p.deleted_at IS NULL WHERE p.normalized_value=$1 AND c.deleted_at IS NULL AND NOT c.is_synthetic AND c.status IN ('DRAFT','ACTIVE') FOR UPDATE OF c,p`,
      [sessions[0].phone],
    );
    if (customers.length !== 1) throw new KycFoundationError('BLOCKED');
    return { customerId: customers[0]!.id, ownershipKey };
  }
  /** Strict provenance: a successful non-synthetic provider attempt, matching owner, live consent,
   * live evidence and no ownership conflict. Legacy identity documents are deliberately ignored. */
  private async evidence(
    m: EntityManager,
    customerId: string,
    kind: Kind,
    mac?: string,
  ): Promise<Array<{ id: string; identifier_mac: string }>> {
    return m.query<Array<{ id: string; identifier_mac: string }>>(
      `SELECT i.id,i.identifier_mac FROM kyc_identity_claims i
      JOIN kyc_verification_attempts a ON a.id=i.attempt_id AND a.customer_id=i.customer_id AND a.kind=i.kind
      JOIN kyc_consents c ON c.id=a.consent_id AND c.customer_id=i.customer_id AND c.kind=i.kind AND c.actor_id=i.customer_id
      JOIN authentication_sessions owner_session ON owner_session.id=c.session_id AND owner_session.customer_id=i.customer_id AND owner_session.audience='customer-api'
      WHERE i.customer_id=$1 AND i.kind=$2 AND i.status='VERIFIED' AND a.outcome='MATCH' AND a.provider='MONNIFY'
      AND a.created_at>=c.granted_at AND a.completed_at>=a.created_at AND a.completed_at<=clock_timestamp() AND a.expires_at>clock_timestamp() AND c.session_id IS NOT NULL
      AND c.withdrawn_at IS NULL AND c.expires_at>clock_timestamp()
      AND NOT EXISTS(SELECT 1 FROM kyc_identity_conflicts x WHERE x.claim_id=i.id)
      AND ($3::text IS NULL OR i.identifier_mac=$3)
      FOR SHARE OF i,a,c`,
      [customerId, kind, mac ?? null],
    );
  }
  async match(
    sessionId: string,
    authorization: string,
    kind: Kind,
    identifier: string,
  ): Promise<{ status: 'MATCH' | 'MISMATCH' | 'PENDING' | 'LOCKED' }> {
    if (
      !['BVN', 'NIN'].includes(kind) ||
      typeof identifier !== 'string' ||
      !/^\d{11}$/.test(identifier)
    )
      throw new KycFoundationError('INVALID');
    return this.db.transaction(async (m) => {
      const { customerId, ownershipKey } = await this.authorizedCustomer(
        m,
        sessionId,
        authorization,
      );
      const existing = await m.query<Array<{ present: boolean }>>(
        `SELECT EXISTS(SELECT 1 FROM customer_authentication_credentials WHERE customer_id=$1 AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM customer_transaction_pins WHERE customer_id=$1 AND deleted_at IS NULL) AS present`,
        [customerId],
      );
      if (existing[0]?.present) throw new KycFoundationError('CONFLICT');
      const result = async (status: 'MATCH' | 'MISMATCH' | 'PENDING' | 'LOCKED') => {
        await this.audit.record(m, {
          entityType: 'CUSTOMER',
          entityId: customerId,
          action: 'MOBILE_CLAIM_MATCH',
          actor: 'MOBILE_CLAIM',
          newValues: { kind, outcome: status },
        });
        return { status };
      };
      if (!ownershipKey) return result('PENDING');
      const window = await m.query<Array<{ attempts: number }>>(
        `INSERT INTO mobile_claim_attempt_windows(customer_id,attempts) VALUES($1,1)
        ON CONFLICT(customer_id) DO UPDATE SET attempts=CASE WHEN mobile_claim_attempt_windows.started_at<=clock_timestamp()-interval '1 hour' THEN 1 ELSE LEAST(mobile_claim_attempt_windows.attempts+1,6) END,
        started_at=CASE WHEN mobile_claim_attempt_windows.started_at<=clock_timestamp()-interval '1 hour' THEN clock_timestamp() ELSE mobile_claim_attempt_windows.started_at END RETURNING attempts`,
        [customerId],
      );
      if (window[0]!.attempts > 5) return result('LOCKED');
      const available = await this.evidence(m, customerId, kind);
      if (available.length !== 1) return result('PENDING');
      const candidate = createHmac('sha256', ownershipKey)
        .update('kyc-identifier-v1\0')
        .update(kind)
        .update('\0')
        .update(identifier)
        .digest('hex');
      const matched = constantTimeMacEqual(candidate, available[0]!.identifier_mac);
      if (!matched) return result('MISMATCH');
      await m.query(
        `INSERT INTO mobile_account_claims(session_id,customer_id,ownership_claim_id) VALUES($1,$2,$3) ON CONFLICT(session_id) DO UPDATE SET ownership_claim_id=excluded.ownership_claim_id WHERE mobile_account_claims.customer_id=excluded.customer_id AND mobile_account_claims.consumed_at IS NULL`,
        [sessionId, customerId, available[0]!.id],
      );
      return result('MATCH');
    });
  }
  async setup(command: {
    sessionId: string;
    authorization: string;
    passcode: string;
    passcodeConfirmation: string;
    pin: string;
    pinConfirmation: string;
  }): Promise<{ status: 'SET_UP' }> {
    if (
      !/^\d{6}$/.test(command.passcode) ||
      command.passcode !== command.passcodeConfirmation ||
      !/^\d{6}$/.test(command.pin) ||
      command.pin !== command.pinConfirmation ||
      command.pin === command.passcode
    )
      throw new KycFoundationError('INVALID');
    try {
      return await this.db.transaction(async (m) => {
        const { customerId, ownershipKey } = await this.authorizedCustomer(
          m,
          command.sessionId,
          command.authorization,
        );
        if (!ownershipKey) throw new KycFoundationError('BLOCKED');
        const matches = await m.query<Array<{ ownership_claim_id: string; kind: Kind }>>(
          `SELECT l.ownership_claim_id,i.kind FROM mobile_account_claims l JOIN kyc_identity_claims i ON i.id=l.ownership_claim_id AND i.customer_id=l.customer_id WHERE l.session_id=$1 AND l.customer_id=$2 AND l.consumed_at IS NULL FOR UPDATE OF l`,
          [command.sessionId, customerId],
        );
        const match = matches[0];
        if (
          !match ||
          !(await this.evidence(m, customerId, match.kind)).some(
            (e) => e.id === match.ownership_claim_id,
          )
        )
          throw new KycFoundationError('BLOCKED');
        const existing = await m.query<Array<{ present: boolean }>>(
          `SELECT EXISTS(SELECT 1 FROM customer_authentication_credentials WHERE customer_id=$1 AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM customer_transaction_pins WHERE customer_id=$1 AND deleted_at IS NULL) AS present`,
          [customerId],
        );
        if (existing[0]?.present) throw new KycFoundationError('CONFLICT');
        const [passcodeHash, pinHash] = await Promise.all([
          hashMobileSecret(command.passcode),
          hashMobileSecret(command.pin),
        ]);
        // Recheck time-sensitive proof after expensive hashing while holding its row locks.
        if (
          !(await this.evidence(m, customerId, match.kind)).some(
            (e) => e.id === match.ownership_claim_id,
          )
        )
          throw new KycFoundationError('BLOCKED');
        const active = await m.query<Array<{ id: string }>>(
          `SELECT id FROM kyc_registration_sessions WHERE id=$1 AND status='VERIFIED' AND expires_at>clock_timestamp() AND authorization_hash=$2`,
          [command.sessionId, digest(command.authorization)],
        );
        if (!active[0]) throw new KycFoundationError('BLOCKED');
        const credentialId = randomUUID(),
          pinId = randomUUID();
        await m.query(
          `INSERT INTO customer_authentication_credentials(id,customer_id,password_hash,hash_algorithm,password_version,password_changed_at,status,mobile_otp_required) VALUES($1,$2,$3,'PBKDF2',1,clock_timestamp(),'ACTIVE',true)`,
          [credentialId, customerId, passcodeHash],
        );
        await m.query(
          `INSERT INTO password_histories(id,credential_id,password_hash,hash_algorithm,password_version,action,changed_at) VALUES($1,$2,$3,'PBKDF2',1,'CREATED',clock_timestamp())`,
          [randomUUID(), credentialId, passcodeHash],
        );
        await m.query(
          `INSERT INTO customer_transaction_pins(id,customer_id,pin_hash,hash_algorithm,pin_version,last_changed_at) VALUES($1,$2,$3,'PBKDF2',1,clock_timestamp())`,
          [pinId, customerId, pinHash],
        );
        await m.query(
          `UPDATE mobile_account_claims SET consumed_at=clock_timestamp() WHERE session_id=$1`,
          [command.sessionId],
        );
        await this.audit.record(m, {
          entityType: 'CUSTOMER_AUTHENTICATION_CREDENTIAL',
          entityId: credentialId,
          action: 'CREATED',
          actor: 'MOBILE_CLAIM',
          newValues: { customerId },
        });
        await this.audit.record(m, {
          entityType: 'CUSTOMER_TRANSACTION_PIN',
          entityId: pinId,
          action: 'PIN_CREATED',
          actor: 'MOBILE_CLAIM',
          newValues: { customerId },
        });
        return { status: 'SET_UP' };
      });
    } catch (e) {
      if (e instanceof QueryFailedError && (e.driverError as { code?: string }).code === '23505')
        throw new KycFoundationError('CONFLICT');
      throw e;
    }
  }
}
