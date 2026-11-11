import { createHash, pbkdf2, randomBytes, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { DataSource } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import type { AuditService } from '../operations/audit.service';
import type { KycRegistrationCompletionService } from './kyc-registration-completion.service';
import { KycFoundationError } from './kyc.types';
import { UUID } from './kyc-orchestrator';

const derive = promisify(pbkdf2);
const ITERATIONS = 310_000;
async function hash(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const result = await derive(secret, salt, ITERATIONS, 32, 'sha256');
  return `PBKDF2$sha256$${ITERATIONS}$${salt.toString('base64url')}$${result.toString('base64url')}`;
}
/** Synthetic-only setup. Does not issue a customer session or activate the customer. */
export class KycSyntheticCredentialsService {
  constructor(
    private readonly db: DataSource,
    private readonly audit: AuditService,
    private readonly completion: KycRegistrationCompletionService,
  ) {}
  async status(
    sessionId: string,
    authorization: string,
  ): Promise<{ status: 'SET_UP' | 'NOT_SET'; simulated: true }> {
    if (!UUID.test(sessionId) || !/^[A-Za-z0-9_-]{43}$/.test(authorization))
      throw new KycFoundationError('BLOCKED');
    return this.db.transaction(async (m) => {
      await this.completion.assertDisposable(m);
      const rows = await m.query<Array<{ has_credential: boolean; has_pin: boolean }>>(
        `SELECT
        EXISTS(SELECT 1 FROM customer_authentication_credentials x WHERE x.customer_id=l.customer_id AND x.deleted_at IS NULL) AS has_credential,
        EXISTS(SELECT 1 FROM customer_transaction_pins x WHERE x.customer_id=l.customer_id AND x.deleted_at IS NULL) AS has_pin
        FROM kyc_registration_sessions s JOIN kyc_registration_synthetic_customer_links l ON l.session_id=s.id
        JOIN customers cu ON cu.id=l.customer_id AND cu.is_synthetic AND cu.status='DRAFT' AND cu.deleted_at IS NULL
        WHERE s.id=$1 AND s.authorization_hash=$2 AND s.status='VERIFIED' AND s.expires_at>clock_timestamp() FOR UPDATE OF s`,
        [sessionId, createHash('sha256').update(authorization).digest('hex')],
      );
      const row = rows[0];
      if (!row) throw new KycFoundationError('BLOCKED');
      if (row.has_credential !== row.has_pin) throw new KycFoundationError('CONFLICT');
      return {
        status: row.has_credential ? ('SET_UP' as const) : ('NOT_SET' as const),
        simulated: true as const,
      };
    });
  }
  async setup(command: {
    sessionId: string;
    authorization: string;
    passcode: string;
    passcodeConfirmation: string;
    pin: string;
    pinConfirmation: string;
  }): Promise<{ status: 'SET_UP'; simulated: true }> {
    if (
      !UUID.test(command.sessionId) ||
      !/^[A-Za-z0-9_-]{43}$/.test(command.authorization) ||
      !/^\d{6}$/.test(command.passcode) ||
      command.passcode !== command.passcodeConfirmation ||
      !/^\d{6}$/.test(command.pin) ||
      command.pin !== command.pinConfirmation ||
      command.pin === command.passcode
    )
      throw new KycFoundationError('INVALID');
    try {
      return await this.db.transaction(async (m) => {
        await this.completion.assertDisposable(m);
        const sessions = await m.query<Array<{ id: string }>>(
          `SELECT id FROM kyc_registration_sessions WHERE id=$1 AND authorization_hash=$2 AND status='VERIFIED' AND verified_at IS NOT NULL AND expires_at>clock_timestamp() FOR UPDATE`,
          [command.sessionId, createHash('sha256').update(command.authorization).digest('hex')],
        );
        if (!sessions[0]) throw new KycFoundationError('BLOCKED');
        const links = await m.query<Array<{ customer_id: string }>>(
          `SELECT l.customer_id FROM kyc_registration_synthetic_customer_links l
          JOIN kyc_registration_attempts a ON a.id=l.attempt_id AND a.session_id=l.session_id AND a.kind=l.kind AND a.provider='SYNTHETIC' AND a.state='MATCH'
          JOIN kyc_registration_consents c ON c.id=a.consent_id AND c.session_id=l.session_id AND c.kind=l.kind AND c.withdrawn_at IS NULL AND c.expires_at>clock_timestamp()
          JOIN customers cu ON cu.id=l.customer_id AND cu.is_synthetic AND cu.status='DRAFT' AND cu.deleted_at IS NULL
          WHERE l.session_id=$1 FOR UPDATE OF cu,a,c`,
          [command.sessionId],
        );
        const customerId = links[0]?.customer_id;
        if (!customerId) throw new KycFoundationError('BLOCKED');
        const existing = await m.query<Array<{ present: boolean }>>(
          `SELECT EXISTS(SELECT 1 FROM customer_authentication_credentials WHERE customer_id=$1 AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM customer_transaction_pins WHERE customer_id=$1 AND deleted_at IS NULL) AS present`,
          [customerId],
        );
        if (existing[0]?.present) throw new KycFoundationError('CONFLICT');
        const [passcodeHash, pinHash] = await Promise.all([
          hash(command.passcode),
          hash(command.pin),
        ]);
        // Recheck expiry after expensive hashing; no expired authorization may commit.
        const active = await m.query<Array<{ active: boolean }>>(
          `SELECT (s.status='VERIFIED' AND s.expires_at>clock_timestamp() AND c.withdrawn_at IS NULL AND c.expires_at>clock_timestamp()) AS active FROM kyc_registration_sessions s JOIN kyc_registration_attempts a ON a.session_id=s.id JOIN kyc_registration_synthetic_customer_links l ON l.attempt_id=a.id JOIN kyc_registration_consents c ON c.id=a.consent_id WHERE s.id=$1`,
          [command.sessionId],
        );
        if (!active[0]?.active) throw new KycFoundationError('BLOCKED');
        const credentialId = randomUUID(),
          pinId = randomUUID();
        await m.query(
          `INSERT INTO customer_authentication_credentials(id,customer_id,password_hash,hash_algorithm,password_version,password_changed_at,status) VALUES($1,$2,$3,'PBKDF2',1,clock_timestamp(),'ACTIVE')`,
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
        await this.audit.record(m, {
          entityType: 'CUSTOMER_AUTHENTICATION_CREDENTIAL',
          entityId: credentialId,
          action: 'CREATED',
          actor: 'SYNTHETIC_REGISTRATION',
          newValues: { customerId, synthetic: true },
        });
        await this.audit.record(m, {
          entityType: 'CUSTOMER_TRANSACTION_PIN',
          entityId: pinId,
          action: 'PIN_CREATED',
          actor: 'SYNTHETIC_REGISTRATION',
          newValues: { customerId, synthetic: true },
        });
        await m.query(
          `INSERT INTO kyc_registration_private_audit(id,session_id,resource_id,action) VALUES($1,$2,$3,'SYNTHETIC_CREDENTIALS_CREATED')`,
          [randomUUID(), command.sessionId, customerId],
        );
        return { status: 'SET_UP' as const, simulated: true as const };
      });
    } catch (e) {
      if (e instanceof QueryFailedError && (e.driverError as { code?: string }).code === '23505')
        throw new KycFoundationError('CONFLICT');
      throw e;
    }
  }
}
