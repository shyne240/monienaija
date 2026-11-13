import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { DEFAULT_SESSION_AUDIENCE } from '../customer-authentication/authentication-session.service';
import type { CustomerSessionValidator } from '../customer-authentication/authentication-session.types';
import { constantTimeMacEqual, identityBindingMac, UUID } from './kyc-orchestrator';
import {
  KycFoundationError,
  type Attempt,
  type AttemptOutcome,
  type IdentityKind,
  type IdentityDetails,
  type KycStore,
  type Reservation,
} from './kyc.types';
import {
  assertPolicy,
  evaluateEligibility,
  type EligibilityPolicy,
  type EvidenceState,
} from './kyc-policy';

interface AttemptRow {
  id: string;
  customer_id: string;
  consent_id: string;
  request_id: string;
  kind: IdentityKind;
  provider: string;
  outcome: AttemptOutcome;
  created_at: Date;
  completed_at: Date | null;
  expires_at: Date | null;
  request_mac: string;
  mac_key_version: string;
}
const project = (r: AttemptRow): Attempt => ({
  id: r.id,
  customerId: r.customer_id,
  consentId: r.consent_id,
  kind: r.kind,
  provider: r.provider,
  outcome: r.outcome,
  createdAt: r.created_at,
  completedAt: r.completed_at,
  expiresAt: r.expires_at,
});

/** Private internal storage. No routes/module registration; caller must enforce authorization. */
export class PostgresKycStore implements KycStore {
  constructor(
    private readonly db: DataSource,
    private readonly sessions: CustomerSessionValidator,
  ) {}
  private async lockCustomer(m: EntityManager, customerId: string): Promise<void> {
    const rows = await m.query<Array<{ id: string }>>(
      'SELECT id FROM customers WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',
      [customerId],
    );
    if (!rows.length) throw new KycFoundationError('NOT_FOUND');
  }
  private async authenticatedSession(
    m: EntityManager,
    customerId: string,
    token: string,
  ): Promise<string> {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new KycFoundationError('BLOCKED');
    const validation = await this.sessions.validateInManager(m, {
      token,
      audience: DEFAULT_SESSION_AUDIENCE,
      mode: 'READ',
    });
    if (
      !validation.valid ||
      !validation.principal ||
      validation.principal.customerId !== customerId
    ) {
      throw new KycFoundationError('BLOCKED');
    }
    return validation.principal.sessionId;
  }
  private async audit(
    m: EntityManager,
    customerId: string,
    resourceId: string,
    action: string,
    actorId: string | null,
    outcome: string | null,
  ): Promise<void> {
    await m.query(
      'INSERT INTO kyc_private_audit (id,customer_id,resource_id,action,actor_id,outcome) VALUES ($1,$2,$3,$4,$5,$6)',
      [randomUUID(), customerId, resourceId, action, actorId, outcome],
    );
  }
  private async requestRefresh(m: EntityManager, customerId: string): Promise<void> {
    await m.query(
      `INSERT INTO kyc_evaluation_refresh(customer_id) VALUES ($1)
      ON CONFLICT (customer_id) DO UPDATE SET revision=kyc_evaluation_refresh.revision+1,requested_at=clock_timestamp()`,
      [customerId],
    );
  }
  private async openReconciliation(
    m: EntityManager,
    attemptId: string,
    customerId: string,
    reason: 'UNKNOWN' | 'INTERRUPTED',
  ): Promise<boolean> {
    const id = randomUUID();
    const rows = await m.query<Array<{ id: string }>>(
      `INSERT INTO kyc_reconciliation_cases(id,attempt_id,customer_id,reason,status)
      VALUES($1,$2,$3,$4,'OPEN') ON CONFLICT(attempt_id) DO NOTHING RETURNING id`,
      [id, attemptId, customerId, reason],
    );
    if (rows.length) await this.audit(m, customerId, id, 'RECONCILIATION_OPENED', null, null);
    return rows.length > 0;
  }
  /** Queue only; never re-dispatch, change evidence, or declare an uncertain billable request safe to repeat. */
  async queueInterrupted(minimumAgeSeconds: number, limit = 100): Promise<number> {
    if (
      !Number.isInteger(minimumAgeSeconds) ||
      minimumAgeSeconds < 60 ||
      minimumAgeSeconds > 2592000 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new KycFoundationError('INVALID');
    const candidates = await this.db.query<Array<{ id: string; customer_id: string }>>(
      `SELECT a.id,a.customer_id FROM kyc_verification_attempts a
      JOIN customers c ON c.id=a.customer_id AND c.deleted_at IS NULL
      WHERE a.outcome='DISPATCHING' AND a.created_at < clock_timestamp()-($1 * interval '1 second')
      AND NOT EXISTS (SELECT 1 FROM kyc_reconciliation_cases x WHERE x.attempt_id=a.id)
      ORDER BY a.created_at LIMIT $2`,
      [minimumAgeSeconds, limit],
    );
    let count = 0;
    for (const candidate of candidates) {
      const opened = await this.db.transaction(async (m) => {
        // Same customer -> attempt lock order as finish, preventing a lock cycle.
        await this.lockCustomer(m, candidate.customer_id);
        const rows = await m.query<Array<{ id: string }>>(
          `SELECT id FROM kyc_verification_attempts WHERE id=$1 AND customer_id=$2 AND outcome='DISPATCHING'
          AND created_at < clock_timestamp()-($3 * interval '1 second') FOR UPDATE`,
          [candidate.id, candidate.customer_id, minimumAgeSeconds],
        );
        return rows.length
          ? this.openReconciliation(m, candidate.id, candidate.customer_id, 'INTERRUPTED')
          : false;
      });
      if (opened) count++;
    }
    return count;
  }

  /** Quarantine a sufficiently old interrupted attempt; late results can never overwrite UNKNOWN. */
  async quarantineInterrupted(attemptId: string, minimumAgeSeconds: number): Promise<void> {
    if (
      !UUID.test(attemptId) ||
      !Number.isInteger(minimumAgeSeconds) ||
      minimumAgeSeconds < 60 ||
      minimumAgeSeconds > 2592000
    )
      throw new KycFoundationError('INVALID');
    const lookup = await this.db.query<Array<{ customer_id: string }>>(
      'SELECT customer_id FROM kyc_verification_attempts WHERE id=$1',
      [attemptId],
    );
    if (!lookup[0]) throw new KycFoundationError('NOT_FOUND');
    const customerId = lookup[0].customer_id;
    await this.db.transaction(async (m) => {
      await this.lockCustomer(m, customerId);
      const rows = await m.query<Array<{ outcome: string }>>(
        `SELECT outcome FROM kyc_verification_attempts WHERE id=$1 AND customer_id=$2 FOR UPDATE`,
        [attemptId, customerId],
      );
      if (rows[0]?.outcome === 'UNKNOWN') return;
      if (rows[0]?.outcome !== 'DISPATCHING') throw new KycFoundationError('CONFLICT');
      const updated = await m.query<Array<{ id: string }>>(
        `WITH updated AS (UPDATE kyc_verification_attempts a SET outcome='UNKNOWN',completed_at=clock_timestamp()
        WHERE a.id=$1 AND a.created_at < clock_timestamp()-($2 * interval '1 second') AND EXISTS (SELECT 1 FROM kyc_reconciliation_cases c WHERE c.attempt_id=a.id AND c.status IN ('OPEN','REVIEW')) RETURNING a.id) SELECT id FROM updated`,
        [attemptId, minimumAgeSeconds],
      );
      if (!updated.length) throw new KycFoundationError('BLOCKED');
      await m.query("UPDATE kyc_identity_claims SET status='UNKNOWN' WHERE attempt_id=$1", [
        attemptId,
      ]);
      await this.requestRefresh(m, customerId);
      await this.audit(m, customerId, attemptId, 'ATTEMPT_FINISHED', null, 'UNKNOWN');
    });
  }
  async grantConsent(command: {
    customerId: string;
    sessionToken: string;
    kind: IdentityKind;
    noticeVersion: string;
    expiresAt: Date;
  }): Promise<string> {
    if (
      !UUID.test(command.customerId) ||
      !['BVN', 'NIN'].includes(command.kind) ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(command.noticeVersion) ||
      !(command.expiresAt instanceof Date) ||
      !Number.isFinite(command.expiresAt.getTime()) ||
      command.expiresAt <= new Date()
    )
      throw new KycFoundationError('INVALID');
    const id = randomUUID();
    await this.db.transaction(async (m) => {
      await this.lockCustomer(m, command.customerId);
      const sessionId = await this.authenticatedSession(
        m,
        command.customerId,
        command.sessionToken,
      );
      await m.query(
        'INSERT INTO kyc_consents (id,customer_id,kind,notice_version,actor_id,expires_at,session_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          id,
          command.customerId,
          command.kind,
          command.noticeVersion,
          command.customerId,
          command.expiresAt,
          sessionId,
        ],
      );
      await this.audit(m, command.customerId, id, 'CONSENT_GRANTED', command.customerId, null);
    });
    return id;
  }
  async withdrawConsent(
    customerId: string,
    consentId: string,
    sessionToken: string,
  ): Promise<void> {
    if (![customerId, consentId].every((s) => UUID.test(s)))
      throw new KycFoundationError('INVALID');
    await this.db.transaction(async (m) => {
      await this.lockCustomer(m, customerId);
      await this.authenticatedSession(m, customerId, sessionToken);
      const rows = await m.query<Array<{ id: string }>>(
        'WITH updated AS (UPDATE kyc_consents SET withdrawn_at=clock_timestamp() WHERE id=$1 AND customer_id=$2 AND withdrawn_at IS NULL RETURNING id) SELECT id FROM updated',
        [consentId, customerId],
      );
      if (rows.length) {
        await this.audit(m, customerId, consentId, 'CONSENT_WITHDRAWN', customerId, null);
        await this.requestRefresh(m, customerId);
      } else {
        const existing = await m.query<Array<{ id: string }>>(
          'SELECT id FROM kyc_consents WHERE id=$1 AND customer_id=$2',
          [consentId, customerId],
        );
        if (!existing.length) throw new KycFoundationError('NOT_FOUND');
      }
    });
  }
  async reserve(r: Reservation): Promise<{ attempt: Attempt; isNew: boolean }> {
    assertPolicy(r.policy);
    if (!r.policy.enabled) throw new KycFoundationError('DISABLED');
    if (
      ![r.customerId, r.consentId, r.requestId].every((s) => UUID.test(s)) ||
      !['BVN', 'NIN'].includes(r.kind) ||
      !/^[A-Z][A-Z0-9_]{0,31}$/.test(r.provider) ||
      !/^[0-9a-f]{64}$/.test(r.requestMac) ||
      !/^[0-9a-f]{64}$/.test(r.identityMac) ||
      !/^[0-9a-f]{64}$/.test(r.identifierMac) ||
      !/^[0-9a-f]{64}$/.test(r.ownershipKeyProof) ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(r.ownershipKeyVersion) ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(r.macKeyVersion)
    )
      throw new KycFoundationError('INVALID');
    const result = await this.db.transaction(async (m) => {
      // Fixed lock order makes the per-provider and per-customer rate limits atomic across processes.
      await m.query('INSERT INTO kyc_provider_locks(provider) VALUES ($1) ON CONFLICT DO NOTHING', [
        r.provider,
      ]);
      await m.query('SELECT provider FROM kyc_provider_locks WHERE provider=$1 FOR UPDATE', [
        r.provider,
      ]);
      await m.query(
        `INSERT INTO kyc_ownership_key_state(singleton,key_version,key_proof) VALUES(true,$1,$2) ON CONFLICT DO NOTHING`,
        [r.ownershipKeyVersion, r.ownershipKeyProof],
      );
      const keys = await m.query<Array<{ key_version: string; key_proof: string }>>(
        'SELECT key_version,key_proof FROM kyc_ownership_key_state WHERE singleton=true FOR UPDATE',
      );
      if (
        !keys[0] ||
        keys[0].key_version !== r.ownershipKeyVersion ||
        !constantTimeMacEqual(keys[0].key_proof, r.ownershipKeyProof)
      )
        throw new KycFoundationError('BLOCKED');
      await this.lockCustomer(m, r.customerId);
      await this.authenticatedSession(m, r.customerId, r.sessionToken);
      const prior = await m.query<
        Array<AttemptRow & { consent_usable: boolean; evidence_usable: boolean }>
      >(
        `SELECT a.*, (c.session_id IS NOT NULL AND c.withdrawn_at IS NULL AND c.expires_at > clock_timestamp()) AS consent_usable, (a.expires_at > clock_timestamp()) AS evidence_usable FROM kyc_verification_attempts a JOIN kyc_consents c ON c.id=a.consent_id WHERE a.customer_id=$1 AND a.request_id=$2`,
        [r.customerId, r.requestId],
      );
      if (prior[0]) {
        if (
          prior[0].mac_key_version !== r.macKeyVersion ||
          !constantTimeMacEqual(prior[0].request_mac, r.requestMac)
        )
          throw new KycFoundationError('CONFLICT');
        const attempt = project(prior[0]);
        if (
          attempt.outcome === 'MATCH' &&
          (!prior[0].consent_usable || !prior[0].evidence_usable)
        ) {
          attempt.outcome = prior[0].consent_usable ? 'EXPIRED' : 'CONSENT_WITHDRAWN';
          attempt.expiresAt = null;
        }
        return { attempt, isNew: false };
      }
      const consent = await m.query<Array<{ id: string }>>(
        'SELECT id FROM kyc_consents WHERE id=$1 AND customer_id=$2 AND kind=$3 AND session_id IS NOT NULL AND withdrawn_at IS NULL AND expires_at > clock_timestamp()',
        [r.consentId, r.customerId, r.kind],
      );
      if (!consent.length) throw new KycFoundationError('BLOCKED');
      // Never automatically re-dispatch an ambiguous or in-flight request, even under a new request ID.
      const blocked = await m.query<Array<{ id: string }>>(
        `SELECT id FROM kyc_verification_attempts WHERE customer_id=$1 AND kind=$2 AND
        (outcome IN ('DISPATCHING','UNKNOWN','CONSENT_WITHDRAWN') OR (outcome='MATCH' AND expires_at > clock_timestamp())) LIMIT 1`,
        [r.customerId, r.kind],
      );
      if (blocked.length) throw new KycFoundationError('BLOCKED');
      const counts = await m.query<
        Array<{ consent_count: number; customer_count: number; cooldown_count: number }>
      >(
        `SELECT
        count(*) FILTER (WHERE consent_id=$2 AND kind=$3)::int AS consent_count,
        count(*) FILTER (WHERE created_at > clock_timestamp() - ($4 * interval '1 second'))::int AS customer_count,
        count(*) FILTER (WHERE created_at > clock_timestamp() - ($5 * interval '1 second'))::int AS cooldown_count
        FROM kyc_verification_attempts WHERE customer_id=$1`,
        [
          r.customerId,
          r.consentId,
          r.kind,
          r.policy.customerWindowSeconds,
          r.policy.cooldownSeconds,
        ],
      );
      const providerCount = await m.query<Array<{ count: number }>>(
        `SELECT count(*)::int AS count FROM kyc_verification_attempts WHERE provider=$1 AND created_at > clock_timestamp() - ($2 * interval '1 second')`,
        [r.provider, r.policy.providerWindowSeconds],
      );
      const c = counts[0];
      if (
        !c ||
        !providerCount[0] ||
        c.consent_count >= r.policy.maxAttemptsPerConsent ||
        c.customer_count >= r.policy.customerWindowLimit ||
        c.cooldown_count > 0 ||
        providerCount[0].count >= r.policy.providerWindowLimit
      )
        throw new KycFoundationError('BLOCKED');
      const claims = await m.query<Array<{ id: string; customer_id: string }>>(
        'SELECT id,customer_id FROM kyc_identity_claims WHERE kind=$1 AND identifier_mac=$2 FOR UPDATE',
        [r.kind, r.identifierMac],
      );
      if (claims[0] && claims[0].customer_id !== r.customerId) {
        const conflictId = randomUUID();
        const inserted = await m.query<Array<{ id: string }>>(
          `INSERT INTO kyc_identity_conflicts(id,requester_customer_id,claim_id,claimed_customer_id,kind) VALUES($1,$2,$3,$4,$5) ON CONFLICT (requester_customer_id,claim_id) DO NOTHING RETURNING id`,
          [conflictId, r.customerId, claims[0].id, claims[0].customer_id, r.kind],
        );
        if (inserted.length)
          await this.audit(m, r.customerId, conflictId, 'OWNERSHIP_CONFLICT', null, null);
        return { conflict: true as const };
      }
      const id = randomUUID();
      const rows = await m.query<AttemptRow[]>(
        `INSERT INTO kyc_verification_attempts (id,customer_id,consent_id,request_id,kind,provider,policy_version,request_mac,mac_key_version,identity_mac,outcome,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'DISPATCHING',clock_timestamp()) RETURNING *`,
        [
          id,
          r.customerId,
          r.consentId,
          r.requestId,
          r.kind,
          r.provider,
          r.policy.version,
          r.requestMac,
          r.macKeyVersion,
          r.identityMac,
        ],
      );
      if (claims[0])
        await m.query("UPDATE kyc_identity_claims SET attempt_id=$1,status='PENDING' WHERE id=$2", [
          id,
          claims[0].id,
        ]);
      else
        await m.query(
          "INSERT INTO kyc_identity_claims(id,kind,identifier_mac,customer_id,attempt_id,status) VALUES($1,$2,$3,$4,$5,'PENDING')",
          [randomUUID(), r.kind, r.identifierMac, r.customerId, id],
        );
      await this.audit(m, r.customerId, id, 'ATTEMPT_RESERVED', null, 'DISPATCHING');
      if (!rows[0]) throw new KycFoundationError('BLOCKED');
      return { attempt: project(rows[0]), isNew: true };
    });
    if ('conflict' in result) throw new KycFoundationError('BLOCKED');
    return result;
  }
  /** Restricted internal history; authorization and scoped presentation belong to a later batch. */
  async listHistory(customerId: string, limit = 50): Promise<Attempt[]> {
    if (!UUID.test(customerId) || !Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new KycFoundationError('INVALID');
    const rows = await this.db.query<AttemptRow[]>(
      `SELECT a.id,a.customer_id,a.consent_id,a.kind,a.provider,a.outcome,a.created_at,a.completed_at,a.expires_at
      FROM kyc_verification_attempts a WHERE a.customer_id=$1 ORDER BY a.created_at DESC LIMIT $2`,
      [customerId, limit],
    );
    return rows.map(project);
  }
  /** Advisory evaluation only, using current, consent-bound match records and trusted external evidence. */
  async evaluate(
    customerId: string,
    policy: EligibilityPolicy | null,
    externalEvidence: EvidenceState[],
    binding: { identity: IdentityDetails; macKey: Buffer; macKeyVersion: string },
  ): Promise<'NOT_CONFIGURED' | 'PENDING' | 'SATISFIED'> {
    if (!UUID.test(customerId)) throw new KycFoundationError('INVALID');
    const expectedMac = identityBindingMac(customerId, binding.identity, binding.macKey);
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(binding.macKeyVersion))
      throw new KycFoundationError('INVALID');
    const rows = await this.db.query<
      Array<{ kind: IdentityKind; expires_at: Date; identity_mac: string; mac_key_version: string }>
    >(
      `SELECT a.kind,a.expires_at,a.identity_mac,a.mac_key_version
      FROM kyc_verification_attempts a JOIN kyc_consents c ON c.id=a.consent_id
      WHERE a.customer_id=$1 AND a.outcome='MATCH' AND a.expires_at > clock_timestamp() AND c.session_id IS NOT NULL AND c.withdrawn_at IS NULL AND c.expires_at > clock_timestamp()`,
      [customerId],
    );
    const verified: EvidenceState[] = rows
      .filter(
        (r) =>
          r.mac_key_version === binding.macKeyVersion &&
          constantTimeMacEqual(r.identity_mac, expectedMac),
      )
      .map((r) => ({
        type: r.kind,
        verified: true,
        revoked: false,
        expiresAt: r.expires_at,
      }));
    // Identity evidence can only come from our consent-bound history, never external caller input.
    return evaluateEligibility(
      policy,
      [...verified, ...externalEvidence.filter((e) => e.type !== 'BVN' && e.type !== 'NIN')],
      new Date(),
    );
  }
  async finish(
    attempt: Attempt,
    outcome: 'MATCH' | 'REVIEW' | 'UNKNOWN',
    validitySeconds: number,
    referenceMac: string | null,
  ): Promise<Attempt> {
    if (
      !UUID.test(attempt.id) ||
      !UUID.test(attempt.customerId) ||
      !['MATCH', 'REVIEW', 'UNKNOWN'].includes(outcome) ||
      !Number.isSafeInteger(validitySeconds) ||
      validitySeconds < 1 ||
      validitySeconds > 31536000 ||
      (referenceMac !== null && !/^[0-9a-f]{64}$/.test(referenceMac))
    )
      throw new KycFoundationError('INVALID');
    return this.db.transaction(async (m) => {
      await this.lockCustomer(m, attempt.customerId);
      const rows = await m.query<AttemptRow[]>(
        `WITH updated AS (UPDATE kyc_verification_attempts a SET
        outcome = CASE WHEN c.withdrawn_at IS NOT NULL OR c.expires_at <= statement_timestamp() THEN 'CONSENT_WITHDRAWN' ELSE $3 END,
        completed_at = statement_timestamp(), expires_at = CASE WHEN $3='MATCH' AND c.withdrawn_at IS NULL AND c.expires_at > statement_timestamp() THEN statement_timestamp() + ($4 * interval '1 second') ELSE NULL END,
        provider_reference_mac=$5 FROM kyc_consents c
        WHERE a.id=$1 AND a.customer_id=$2 AND a.outcome='DISPATCHING' AND c.id=a.consent_id
        RETURNING a.*) SELECT * FROM updated`,
        [attempt.id, attempt.customerId, outcome, validitySeconds, referenceMac],
      );
      if (!rows[0]) throw new KycFoundationError('CONFLICT');
      await m.query(
        `UPDATE kyc_identity_claims SET status=$1 WHERE attempt_id=$2 AND customer_id=$3`,
        [
          rows[0].outcome === 'MATCH'
            ? 'VERIFIED'
            : rows[0].outcome === 'REVIEW'
              ? 'REVIEW'
              : 'UNKNOWN',
          attempt.id,
          attempt.customerId,
        ],
      );
      if (rows[0].outcome === 'UNKNOWN' || rows[0].outcome === 'CONSENT_WITHDRAWN')
        await this.openReconciliation(m, attempt.id, attempt.customerId, 'UNKNOWN');
      else {
        const closed = await m.query<Array<{ id: string }>>(
          `WITH closed AS (UPDATE kyc_reconciliation_cases SET status='NO_ACTION', closed_at=clock_timestamp()
          WHERE attempt_id=$1 AND status IN ('OPEN','REVIEW') AND reason='INTERRUPTED' RETURNING id) SELECT id FROM closed`,
          [attempt.id],
        );
        if (closed[0])
          await this.audit(
            m,
            attempt.customerId,
            closed[0].id,
            'RECONCILIATION_CLOSED',
            null,
            null,
          );
      }
      await this.requestRefresh(m, attempt.customerId);
      await this.audit(
        m,
        attempt.customerId,
        attempt.id,
        'ATTEMPT_FINISHED',
        null,
        rows[0].outcome,
      );
      return project(rows[0]);
    });
  }
}
