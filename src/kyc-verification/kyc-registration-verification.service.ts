import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { KycOrchestrator, UUID } from './kyc-orchestrator';
import { selectKycProvider } from './kyc-provider-router';
import {
  KycFoundationError,
  type Attempt,
  type KycPolicy,
  type KycProvider,
  type KycStore,
  type Reservation,
  type VerificationInput,
  type ProviderResult,
} from './kyc.types';

const policy: KycPolicy = {
  version: 'synthetic-v1',
  enabled: true,
  maxAttemptsPerConsent: 1,
  cooldownSeconds: 60,
  customerWindowSeconds: 3600,
  customerWindowLimit: 2,
  providerWindowSeconds: 3600,
  providerWindowLimit: 100,
  timeoutMs: 1000,
  evidenceValiditySeconds: 60,
};
export const REGISTRATION_SYNTHETIC_PROVIDER = 'REGISTRATION_SYNTHETIC_PROVIDER';
/** Never connected to a real provider: synthetic output cannot become customer KYC evidence. */
export class RegistrationSyntheticProvider implements KycProvider {
  readonly code = 'SYNTHETIC';
  async verify(): Promise<{ outcome: 'MATCH' }> {
    return Promise.resolve({ outcome: 'MATCH' });
  }
}
type Row = {
  id: string;
  session_id: string;
  consent_id: string;
  kind: 'BVN' | 'NIN';
  provider: string;
  state: string;
  created_at: Date;
  completed_at: Date | null;
};
function project(row: Row): Attempt {
  return {
    id: row.id,
    customerId: row.session_id,
    consentId: row.consent_id,
    kind: row.kind,
    provider: row.provider,
    outcome: row.state === 'RESERVED' ? 'DISPATCHING' : (row.state as Attempt['outcome']),
    createdAt: row.created_at,
    completedAt: row.completed_at,
    expiresAt: null,
  };
}
/** Per-request adapter; only the synthetic provider is allowed. Never use this for paid or live KYC. */
class RegistrationStore implements KycStore {
  private reserved: Reservation | undefined;
  constructor(private readonly db: DataSource) {}
  private async authorized(m: EntityManager, r: Reservation): Promise<void> {
    const sessions = await m.query<Array<{ id: string }>>(
      `SELECT id FROM kyc_registration_sessions WHERE id=$1 AND authorization_hash=$2 AND status='VERIFIED' AND verified_at IS NOT NULL AND expires_at>clock_timestamp() FOR UPDATE`,
      [r.customerId, createHash('sha256').update(r.sessionToken).digest('hex')],
    );
    if (!sessions[0]) throw new KycFoundationError('BLOCKED');
    const consents = await m.query<Array<{ id: string }>>(
      `SELECT id FROM kyc_registration_consents WHERE id=$1 AND session_id=$2 AND kind=$3 AND notice_version='synthetic-test-v1' AND withdrawn_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`,
      [r.consentId, r.customerId, r.kind],
    );
    if (!consents[0]) throw new KycFoundationError('BLOCKED');
    if (r.provider !== 'SYNTHETIC' || r.policy.version !== policy.version || !r.policy.enabled)
      throw new KycFoundationError('DISABLED');
  }
  async reserve(r: Reservation): Promise<{ attempt: Attempt; isNew: boolean }> {
    this.reserved = r;
    return this.db.transaction(async (m) => {
      await this.authorized(m, r);
      const prior = await m.query<Array<Row & { request_mac: string }>>(
        'SELECT * FROM kyc_registration_attempts WHERE session_id=$1 AND request_id=$2 FOR UPDATE',
        [r.customerId, r.requestId],
      );
      if (prior[0]) {
        if (
          prior[0].request_mac !== r.requestMac ||
          prior[0].consent_id !== r.consentId ||
          prior[0].kind !== r.kind
        )
          throw new KycFoundationError('CONFLICT');
        if (prior[0].state === 'CANCELLED') throw new KycFoundationError('BLOCKED');
        return { attempt: project(prior[0]), isNew: false };
      }
      const providerLock = await m.query<Array<{ provider: string }>>(
        "SELECT provider FROM kyc_registration_synthetic_provider_lock WHERE provider='SYNTHETIC' FOR UPDATE",
      );
      if (!providerLock[0]) throw new KycFoundationError('DISABLED');
      const providerCounts = await m.query<Array<{ count: string }>>(
        "SELECT count(*) FROM kyc_registration_attempts WHERE provider='SYNTHETIC' AND created_at>clock_timestamp()-interval '1 hour'",
      );
      if (Number(providerCounts[0]?.count ?? 0) >= policy.providerWindowLimit)
        throw new KycFoundationError('BLOCKED');
      const recent = await m.query<Array<{ id: string }>>(
        "SELECT id FROM kyc_registration_attempts WHERE session_id=$1 AND created_at>clock_timestamp()-interval '60 seconds' LIMIT 1",
        [r.customerId],
      );
      if (recent[0]) throw new KycFoundationError('BLOCKED');
      const counts = await m.query<Array<{ count: string }>>(
        `SELECT count(*) FROM kyc_registration_attempts WHERE session_id=$1 AND created_at>clock_timestamp()-interval '1 hour'`,
        [r.customerId],
      );
      const consentCounts = await m.query<Array<{ count: string }>>(
        'SELECT count(*) FROM kyc_registration_attempts WHERE consent_id=$1',
        [r.consentId],
      );
      if (
        Number(counts[0]?.count ?? 0) >= policy.customerWindowLimit ||
        Number(consentCounts[0]?.count ?? 0) >= policy.maxAttemptsPerConsent
      )
        throw new KycFoundationError('BLOCKED');
      const id = randomUUID();
      const rows = await m.query<Row[]>(
        `INSERT INTO kyc_registration_attempts(id,session_id,consent_id,request_id,kind,provider,request_mac,state) VALUES($1,$2,$3,$4,$5,'SYNTHETIC',$6,'RESERVED') RETURNING *`,
        [id, r.customerId, r.consentId, r.requestId, r.kind, r.requestMac],
      );
      await m.query(
        'INSERT INTO kyc_registration_private_audit(id,session_id,resource_id,action) VALUES($1,$2,$3,$4)',
        [randomUUID(), r.customerId, id, 'VERIFY_RESERVED'],
      );
      return { attempt: project(rows[0]!), isNew: true };
    });
  }
  async consume(signal: AbortSignal): Promise<void> {
    const r = this.reserved;
    if (!r || signal.aborted) throw new KycFoundationError('BLOCKED');
    await this.db.transaction(async (m) => {
      await this.authorized(m, r);
      if (signal.aborted) throw new KycFoundationError('BLOCKED');
      const rows = await m.query<Array<{ id: string }>>(
        `WITH changed AS (UPDATE kyc_registration_attempts SET state='DISPATCHING',dispatched_at=clock_timestamp() WHERE session_id=$1 AND request_id=$2 AND request_mac=$3 AND consent_id=$4 AND kind=$5 AND provider='SYNTHETIC' AND state='RESERVED' AND EXISTS (SELECT 1 FROM kyc_registration_sessions WHERE id=$1 AND status='VERIFIED' AND expires_at>clock_timestamp()) AND EXISTS (SELECT 1 FROM kyc_registration_consents WHERE id=$4 AND session_id=$1 AND kind=$5 AND withdrawn_at IS NULL AND expires_at>clock_timestamp()) RETURNING id) SELECT id FROM changed`,
        [r.customerId, r.requestId, r.requestMac, r.consentId, r.kind],
      );
      if (!rows[0]) throw new KycFoundationError('BLOCKED');
      await m.query(
        'INSERT INTO kyc_registration_private_audit(id,session_id,resource_id,action) VALUES($1,$2,$3,$4)',
        [randomUUID(), r.customerId, rows[0].id, 'VERIFY_DISPATCH_RESERVED'],
      );
    });
    if (signal.aborted) throw new KycFoundationError('BLOCKED');
  }
  async dispatch(
    signal: AbortSignal,
    invoke: () => Promise<ProviderResult>,
  ): Promise<ProviderResult> {
    const r = this.reserved;
    if (!r) throw new KycFoundationError('BLOCKED');
    // The consumed state is committed first, so a failed transaction cannot trigger a retry.
    await this.consume(signal);
    const pending = await this.db.transaction(async (m) => {
      // Hold the same locks used by revoke/withdraw until the provider invocation begins.
      await this.authorized(m, r);
      const rows = await m.query<Array<{ id: string }>>(
        "SELECT id FROM kyc_registration_attempts WHERE session_id=$1 AND request_id=$2 AND request_mac=$3 AND consent_id=$4 AND kind=$5 AND provider='SYNTHETIC' AND state='DISPATCHING' FOR UPDATE",
        [r.customerId, r.requestId, r.requestMac, r.consentId, r.kind],
      );
      if (!rows[0] || signal.aborted) throw new KycFoundationError('BLOCKED');
      const result = invoke();
      // Handle rejection while the short lock transaction commits; then propagate it below.
      void result.catch(() => undefined);
      return { result };
    });
    return pending.result;
  }
  async finish(attempt: Attempt, outcome: 'MATCH' | 'REVIEW' | 'UNKNOWN'): Promise<Attempt> {
    const r = this.reserved;
    if (!r || attempt.customerId !== r.customerId) throw new KycFoundationError('BLOCKED');
    const result = await this.db.transaction(async (m) => {
      // Same session lock order as revocation/consent withdrawal.
      const session = await m.query<Array<{ active: boolean }>>(
        `SELECT (status='VERIFIED' AND expires_at>clock_timestamp()) AS active FROM kyc_registration_sessions WHERE id=$1 FOR UPDATE`,
        [r.customerId],
      );
      const consent = await m.query<Array<{ active: boolean }>>(
        `SELECT (withdrawn_at IS NULL AND expires_at>clock_timestamp()) AS active FROM kyc_registration_consents WHERE id=$1 AND session_id=$2 FOR UPDATE`,
        [r.consentId, r.customerId],
      );
      const rows = await m.query<Row[]>(
        `WITH changed AS (UPDATE kyc_registration_attempts SET state=CASE WHEN state='RESERVED' THEN 'CANCELLED' WHEN NOT $3::boolean THEN 'CONSENT_WITHDRAWN' ELSE $4::varchar END,completed_at=clock_timestamp() WHERE id=$1 AND session_id=$2 AND state IN ('RESERVED','DISPATCHING') RETURNING *) SELECT * FROM changed`,
        [attempt.id, r.customerId, !!session[0]?.active && !!consent[0]?.active, outcome],
      );
      if (!rows[0]) throw new KycFoundationError('CONFLICT');
      await m.query(
        'INSERT INTO kyc_registration_private_audit(id,session_id,resource_id,action) VALUES($1,$2,$3,$4)',
        [randomUUID(), r.customerId, attempt.id, 'VERIFY_FINISHED'],
      );
      return rows[0];
    });
    if (result.state === 'CANCELLED') throw new KycFoundationError('BLOCKED');
    return project(result);
  }
}
/** Synthetic-only facade using the existing orchestrator with a session-backed store and gated provider. */
export class KycRegistrationVerificationService {
  constructor(
    private readonly db: DataSource,
    private readonly synthetic: KycProvider,
  ) {}
  async verify(command: {
    sessionId: string;
    authorization: string;
    consentId: string;
    requestId: string;
    kind: 'BVN' | 'NIN';
    identifier: string;
  }): Promise<{ id: string; status: string; simulated: true }> {
    if (
      !UUID.test(command.sessionId) ||
      !UUID.test(command.consentId) ||
      !UUID.test(command.requestId) ||
      !['BVN', 'NIN'].includes(command.kind) ||
      command.identifier !== '00000000000' ||
      !/^[A-Za-z0-9_-]{43}$/.test(command.authorization)
    )
      throw new KycFoundationError('INVALID');
    const chosen = selectKycProvider(
      { version: 'synthetic-v1', enabled: true, routes: { BVN: 'SYNTHETIC', NIN: 'SYNTHETIC' } },
      command.kind,
      [
        {
          provider: this.synthetic,
          enabled: this.synthetic.code === 'SYNTHETIC',
          capabilities: ['BVN', 'NIN'],
        },
      ],
    );
    const store = new RegistrationStore(this.db);
    const input: VerificationInput = {
      kind: command.kind,
      identifier: command.identifier,
      identity: {
        firstName: 'Synthetic',
        lastName: 'Person',
        dateOfBirth: '2000-01-01',
        phone: '00000000000',
      },
    };
    const expected = JSON.stringify(input);
    const guarded: KycProvider = {
      code: 'SYNTHETIC',
      verify: async (actual, signal) => {
        if (JSON.stringify(actual) !== expected) throw new KycFoundationError('BLOCKED');
        return store.dispatch(signal, () => chosen.verify(actual, signal));
      },
    };
    // Authorization is already a 256-bit random secret; domain-separated keys never leave memory.
    const key = createHmac('sha256', command.authorization).update('synthetic-request-v1').digest();
    const ownerKey = createHmac('sha256', command.authorization)
      .update('synthetic-ownership-v1')
      .digest();
    const orchestrator = new KycOrchestrator(
      store,
      guarded,
      policy,
      key,
      'synthetic-v1',
      ownerKey,
      'synthetic-v1',
    );
    const result = await orchestrator.verify({
      customerId: command.sessionId,
      consentId: command.consentId,
      requestId: command.requestId,
      sessionToken: command.authorization,
      input,
    });
    return { id: result.id, status: result.outcome, simulated: true };
  }
}
