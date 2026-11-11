import {
  createHash,
  pbkdf2Sync,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { normalizeNigerianPhone } from '../customer-registration/phone-normalization';
import {
  CUSTOMER_REGISTRATION_RATE_LIMITS,
  REGISTRATION_OTP_MAX_VERIFY_ATTEMPTS,
  REGISTRATION_OTP_PBKDF2_ITERATIONS,
  REGISTRATION_OTP_RESEND_COOLDOWN_SECONDS,
  REGISTRATION_OTP_TTL_SECONDS,
  REGISTRATION_PHONE_VERIFICATION_EVENT_TYPE,
} from '../customer-registration/customer-registration.constants';
import type { A2SecurityRateLimitService } from '../authorization/security-rate-limit.service';
import type { NotificationProvider } from '../notification/notification.types';
import { UUID } from './kyc-orchestrator';
import { KycFoundationError, type IdentityKind } from './kyc.types';

const SESSION_TTL_SECONDS = 900;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
function tokenHash(s: string): string {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(s))
    throw new KycFoundationError('BLOCKED');
  return hash(s);
}
function otpHash(code: string, salt: string): string {
  return pbkdf2Sync(
    code,
    Buffer.from(salt, 'base64url'),
    REGISTRATION_OTP_PBKDF2_ITERATIONS,
    32,
    'sha256',
  ).toString('base64url');
}
type Session = { id: string; phone: string; expires_at: Date };
/** Callers must derive sourceIp from a trusted transport and always provide the shared limiter. */
export class KycRegistrationSessionService {
  constructor(
    private readonly db: DataSource,
    private readonly sms: NotificationProvider,
    private readonly sharedRateLimit: Pick<A2SecurityRateLimitService, 'consume'>,
  ) {}
  private async shared(category: string, value: string): Promise<void> {
    const rule = CUSTOMER_REGISTRATION_RATE_LIMITS.find((item) => item.category === category);
    if (!rule || !rule.enabled || !this.sharedRateLimit) throw new KycFoundationError('DISABLED');
    await this.sharedRateLimit.consume(rule, [value], randomUUID());
  }
  private async audit(
    m: EntityManager,
    sessionId: string,
    resourceId: string,
    action: string,
  ): Promise<void> {
    await m.query(
      'INSERT INTO kyc_registration_private_audit(id,session_id,resource_id,action) VALUES($1,$2,$3,$4)',
      [randomUUID(), sessionId, resourceId, action],
    );
  }
  /** Fixed hour windows stored in PostgreSQL. Denials are committed before throwing. */
  private async limit(
    dimensions: Array<{ category: string; value: string; max: number }>,
  ): Promise<void> {
    const entries = dimensions
      .map((x) => ({ ...x, key: hash(`${x.category}\0${x.value}`) }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const allowed = await this.db.transaction(async (m) => {
      let ok = true;
      for (const e of entries) {
        const rows = await m.query<Array<{ count: number }>>(
          `INSERT INTO kyc_registration_rate_buckets(bucket_key,window_started_at,count)
          VALUES($1,clock_timestamp(),1) ON CONFLICT(bucket_key) DO UPDATE SET
          count=CASE WHEN kyc_registration_rate_buckets.window_started_at <= clock_timestamp()-interval '1 hour' THEN 1 ELSE kyc_registration_rate_buckets.count+1 END,
          window_started_at=CASE WHEN kyc_registration_rate_buckets.window_started_at <= clock_timestamp()-interval '1 hour' THEN clock_timestamp() ELSE kyc_registration_rate_buckets.window_started_at END RETURNING count`,
          [e.key],
        );
        if (!rows[0] || rows[0].count > e.max) ok = false;
      }
      return ok;
    });
    if (!allowed) throw new KycFoundationError('BLOCKED');
  }
  private ip(ip: string): string {
    if (
      typeof ip !== 'string' ||
      ip.length < 1 ||
      ip.length > 128 ||
      [...ip].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)
    )
      throw new KycFoundationError('INVALID');
    return ip;
  }
  private async locked(
    m: EntityManager,
    id: string,
    token: string,
    status: 'PENDING' | 'VERIFIED',
  ): Promise<Session> {
    if (!UUID.test(id)) throw new KycFoundationError('BLOCKED');
    const col = status === 'PENDING' ? 'pending_token_hash' : 'authorization_hash';
    const rows = await m.query<Session[]>(
      `SELECT id,phone,expires_at FROM kyc_registration_sessions WHERE id=$1 AND ${col}=$2 AND status=$3 AND expires_at>clock_timestamp() FOR UPDATE`,
      [id, tokenHash(token), status],
    );
    if (!rows[0]) throw new KycFoundationError('BLOCKED');
    return rows[0];
  }
  async create(phoneRaw: string, sourceIp: string): Promise<{ id: string; token: string }> {
    if (typeof phoneRaw !== 'string' || phoneRaw.length > 40)
      throw new KycFoundationError('INVALID');
    const phone = normalizeNigerianPhone(phoneRaw).canonical;
    await this.limit([
      { category: 'create-phone', value: phone, max: 5 },
      { category: 'create-ip', value: this.ip(sourceIp), max: 30 },
    ]);
    const id = randomUUID(),
      token = secret();
    await this.db.transaction(async (m) => {
      await m.query(
        `INSERT INTO kyc_registration_sessions(id,phone,pending_token_hash,status,expires_at) VALUES($1,$2,$3,'PENDING',clock_timestamp()+($4 * interval '1 second'))`,
        [id, phone, tokenHash(token), SESSION_TTL_SECONDS],
      );
      await this.audit(m, id, id, 'SESSION_CREATED');
    });
    return { id, token };
  }
  async issueOtp(id: string, token: string, requestId: string, sourceIp: string): Promise<void> {
    if (!UUID.test(requestId)) throw new KycFoundationError('INVALID');
    await this.shared('CUSTOMER_REGISTRATION_OTP_ISSUE_PER_IP', this.ip(sourceIp));
    // Authenticate before consuming phone quota. Check again under the write lock.
    const session = await this.db.transaction((m) => this.locked(m, id, token, 'PENDING'));
    const replay = await this.db.transaction(async (m) => {
      await this.locked(m, id, token, 'PENDING');
      const rows = await m.query<Array<{ id: string }>>(
        'SELECT id FROM kyc_registration_otps WHERE session_id=$1 AND request_id=$2',
        [id, requestId],
      );
      return !!rows[0];
    });
    if (replay) return;
    await this.shared('CUSTOMER_REGISTRATION_OTP_ISSUE_PER_PHONE', session.phone);
    await this.shared('CUSTOMER_REGISTRATION_OTP_COOLDOWN_PER_PHONE', session.phone);
    await this.limit([
      { category: 'issue-phone', value: session.phone, max: 3 },
      { category: 'issue-ip', value: this.ip(sourceIp), max: 20 },
    ]);
    const issued = await this.db.transaction(async (m) => {
      const s = await this.locked(m, id, token, 'PENDING');
      const prior = await m.query<Array<{ id: string }>>(
        'SELECT id FROM kyc_registration_otps WHERE session_id=$1 AND request_id=$2',
        [id, requestId],
      );
      if (prior[0]) return null;
      await m.query(
        'INSERT INTO kyc_registration_phone_locks(phone) VALUES($1) ON CONFLICT DO NOTHING',
        [s.phone],
      );
      const locks = await m.query<Array<{ ready: boolean }>>(
        `SELECT (last_issued_at IS NULL OR last_issued_at <= clock_timestamp()-($2 * interval '1 second')) AS ready FROM kyc_registration_phone_locks WHERE phone=$1 FOR UPDATE`,
        [s.phone, REGISTRATION_OTP_RESEND_COOLDOWN_SECONDS],
      );
      if (!locks[0]?.ready) throw new KycFoundationError('BLOCKED');
      await m.query(
        'UPDATE kyc_registration_phone_locks SET last_issued_at=clock_timestamp() WHERE phone=$1',
        [s.phone],
      );
      await m.query(
        'UPDATE kyc_registration_otps SET superseded_at=clock_timestamp() WHERE session_id=$1 AND used_at IS NULL AND superseded_at IS NULL',
        [id],
      );
      // Avoid reissuing an unexpired code for this phone, including across its sessions.
      // The phone lock serializes this check without storing a globally searchable OTP hash.
      const recent = await m.query<Array<{ salt: string; code_hash: string }>>(
        `SELECT o.salt,o.code_hash FROM kyc_registration_otps o
         JOIN kyc_registration_sessions s ON s.id=o.session_id
         WHERE s.phone=$1 AND o.expires_at>clock_timestamp() LIMIT 21`,
        [s.phone],
      );
      if (recent.length > 20) throw new KycFoundationError('BLOCKED');
      let code = '';
      for (let i = 0; i < 8; i++) {
        const candidate = randomInt(0, 1000000).toString().padStart(6, '0');
        if (!recent.some((r) => otpHash(candidate, r.salt) === r.code_hash)) {
          code = candidate;
          break;
        }
      }
      if (!code) throw new KycFoundationError('BLOCKED');
      // Hashing may take time; do not issue for a session that expired while it ran.
      await this.locked(m, id, token, 'PENDING');
      const salt = randomBytes(16).toString('base64url'),
        challengeId = randomUUID();
      await m.query(
        `INSERT INTO kyc_registration_otps(id,session_id,request_id,salt,code_hash,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+($6 * interval '1 second'))`,
        [challengeId, id, requestId, salt, otpHash(code, salt), REGISTRATION_OTP_TTL_SECONDS],
      );
      await this.audit(m, id, challengeId, 'OTP_ISSUED');
      return { code, phone: s.phone, challengeId };
    });
    if (issued) {
      // Never log provider errors: provider exceptions can include message body and destination.
      try {
        await this.sms.send({
          channel: 'SMS',
          destination: `+234${issued.phone}`,
          message: `MoneyNaija: your registration verification code is ${issued.code}. It expires in 5 minutes. If you did not request this, ignore this message.`,
          payload: {},
          eventType: REGISTRATION_PHONE_VERIFICATION_EVENT_TYPE,
          eventKey: `kyc-registration:${issued.challengeId}`,
          recipientType: 'PHONE',
          recipientId: `+234${issued.phone}`,
          correlationId: randomUUID(),
        });
      } catch {
        /* Delivery may be uncertain. Recover by a later, rate-limited resend. */
      }
    }
  }
  async verifyOtp(
    id: string,
    token: string,
    code: string,
    sourceIp: string,
  ): Promise<{ authorization: string }> {
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new KycFoundationError('BLOCKED');
    const session = await this.db.transaction((m) => this.locked(m, id, token, 'PENDING'));
    await this.shared('CUSTOMER_REGISTRATION_OTP_VERIFY_PER_PHONE', session.phone);
    await this.limit([
      { category: 'verify-phone', value: session.phone, max: 10 },
      { category: 'verify-ip', value: this.ip(sourceIp), max: 50 },
    ]);
    const result = await this.db.transaction(async (m) => {
      await this.locked(m, id, token, 'PENDING');
      const rows = await m.query<
        Array<{ id: string; salt: string; code_hash: string; attempts: number }>
      >(
        `SELECT id,salt,code_hash,attempts FROM kyc_registration_otps WHERE session_id=$1 AND used_at IS NULL AND superseded_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`,
        [id],
      );
      const otp = rows[0];
      if (!otp || otp.attempts >= REGISTRATION_OTP_MAX_VERIFY_ATTEMPTS) return null;
      const actual = Buffer.from(otpHash(code, otp.salt)),
        expected = Buffer.from(otp.code_hash);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        await m.query('UPDATE kyc_registration_otps SET attempts=attempts+1 WHERE id=$1', [otp.id]);
        await this.audit(m, id, otp.id, 'OTP_REJECTED');
        return null;
      }
      const authorization = secret();
      const consumed = await m.query<Array<{ id: string }>>(
        `WITH changed AS (UPDATE kyc_registration_otps SET used_at=clock_timestamp()
         WHERE id=$1 AND expires_at>clock_timestamp() AND EXISTS
         (SELECT 1 FROM kyc_registration_sessions WHERE id=$2 AND expires_at>clock_timestamp())
         RETURNING id) SELECT id FROM changed`,
        [otp.id, id],
      );
      if (!consumed[0]) return null;
      const authorized = await m.query<Array<{ id: string }>>(
        "WITH changed AS (UPDATE kyc_registration_sessions SET status='VERIFIED',verified_at=clock_timestamp(),pending_token_hash=NULL,authorization_hash=$1 WHERE id=$2 AND expires_at>clock_timestamp() RETURNING id) SELECT id FROM changed",
        [tokenHash(authorization), id],
      );
      if (!authorized[0]) throw new KycFoundationError('BLOCKED');
      await this.audit(m, id, otp.id, 'PHONE_VERIFIED');
      return { authorization };
    });
    if (!result) throw new KycFoundationError('BLOCKED');
    return result;
  }
  async grantConsent(
    id: string,
    authorization: string,
    requestId: string,
    kind: IdentityKind,
    noticeVersion: string,
    expiresAt: Date,
  ): Promise<string> {
    if (
      !UUID.test(requestId) ||
      !['BVN', 'NIN'].includes(kind) ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(noticeVersion) ||
      !(expiresAt instanceof Date) ||
      !Number.isFinite(expiresAt.getTime())
    )
      throw new KycFoundationError('INVALID');
    return this.db.transaction(async (m) => {
      const s = await this.locked(m, id, authorization, 'VERIFIED');
      const existing = await m.query<
        Array<{ id: string; kind: string; notice_version: string; expires_at: Date }>
      >(
        'SELECT id,kind,notice_version,expires_at FROM kyc_registration_consents WHERE session_id=$1 AND request_id=$2',
        [id, requestId],
      );
      if (existing[0]) {
        const e = existing[0];
        if (
          e.kind !== kind ||
          e.notice_version !== noticeVersion ||
          e.expires_at.getTime() !== expiresAt.getTime()
        )
          throw new KycFoundationError('CONFLICT');
        return e.id;
      }
      if (expiresAt <= new Date() || expiresAt > s.expires_at)
        throw new KycFoundationError('BLOCKED');
      const consentId = randomUUID();
      await m.query(
        'INSERT INTO kyc_registration_consents(id,session_id,request_id,kind,notice_version,expires_at) VALUES($1,$2,$3,$4,$5,$6)',
        [consentId, id, requestId, kind, noticeVersion, expiresAt],
      );
      await this.audit(m, id, consentId, 'CONSENT_GRANTED');
      return consentId;
    });
  }
  async withdrawConsent(id: string, authorization: string, consentId: string): Promise<void> {
    if (!UUID.test(consentId)) throw new KycFoundationError('INVALID');
    await this.db.transaction(async (m) => {
      await this.locked(m, id, authorization, 'VERIFIED');
      const changed = await m.query<Array<{ id: string }>>(
        'WITH changed AS (UPDATE kyc_registration_consents SET withdrawn_at=clock_timestamp() WHERE id=$1 AND session_id=$2 AND withdrawn_at IS NULL RETURNING id) SELECT id FROM changed',
        [consentId, id],
      );
      if (!changed[0]) throw new KycFoundationError('BLOCKED');
      await this.audit(m, id, consentId, 'CONSENT_WITHDRAWN');
    });
  }
  async status(
    id: string,
    credential: string,
  ): Promise<{ status: 'PENDING' | 'VERIFIED'; expiresAt: Date }> {
    if (!UUID.test(id)) throw new KycFoundationError('BLOCKED');
    const digest = tokenHash(credential);
    const rows = await this.db.query<Array<{ status: 'PENDING' | 'VERIFIED'; expires_at: Date }>>(
      `SELECT status,expires_at FROM kyc_registration_sessions WHERE id=$1 AND status IN ('PENDING','VERIFIED') AND expires_at>clock_timestamp() AND (pending_token_hash=$2 OR authorization_hash=$2)`,
      [id, digest],
    );
    if (!rows[0]) throw new KycFoundationError('BLOCKED');
    return { status: rows[0].status, expiresAt: rows[0].expires_at };
  }
  async revoke(id: string, credential: string): Promise<void> {
    if (!UUID.test(id)) throw new KycFoundationError('BLOCKED');
    const credentialHash = tokenHash(credential);
    await this.db.transaction(async (m) => {
      const rows = await m.query<Array<{ id: string }>>(
        `WITH changed AS (UPDATE kyc_registration_sessions SET status='REVOKED',pending_token_hash=NULL,authorization_hash=NULL,revoked_at=clock_timestamp() WHERE id=$1 AND status IN ('PENDING','VERIFIED') AND expires_at>clock_timestamp() AND (pending_token_hash=$2 OR authorization_hash=$2) RETURNING id) SELECT id FROM changed`,
        [id, credentialHash],
      );
      if (!rows[0]) throw new KycFoundationError('BLOCKED');
      await this.audit(m, id, id, 'SESSION_REVOKED');
    });
  }
}
