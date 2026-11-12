import { createHash, randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { AuthorizationService } from '../authorization/authorization.service';
import { canonical } from '../authorization/workforce-crypto';
import { UUID } from './kyc-orchestrator';
import { KycFoundationError } from './kyc.types';
import { decideTier, type TierDecisionPolicy, type TierRequirements } from './kyc-tier-decision';

type Pair = { LEVEL_1: TierRequirements; LEVEL_2: TierRequirements };
export interface TierPolicyDefinition {
  regulatoryRequirementsConfirmed: true;
  effectiveFrom: string;
  effectiveUntil: string | null;
  regulatory: Pair;
  operator: Pair;
}
const exact = (x: unknown, keys: string[]): x is Record<string, unknown> =>
  !!x &&
  typeof x === 'object' &&
  !Array.isArray(x) &&
  Object.keys(x).sort().join(',') === [...keys].sort().join(',');
/** A policy is validated independently of its future effective time, and revalidated when read. */
export function validateTierPolicyDefinition(input: unknown): TierPolicyDefinition {
  if (
    !exact(input, [
      'regulatoryRequirementsConfirmed',
      'effectiveFrom',
      'effectiveUntil',
      'regulatory',
      'operator',
    ]) ||
    input.regulatoryRequirementsConfirmed !== true ||
    typeof input.effectiveFrom !== 'string' ||
    (input.effectiveUntil !== null && typeof input.effectiveUntil !== 'string') ||
    !exact(input.regulatory, ['LEVEL_1', 'LEVEL_2']) ||
    !exact(input.operator, ['LEVEL_1', 'LEVEL_2'])
  )
    throw new KycFoundationError('INVALID');
  const date = (x: string) => {
    const d = new Date(x);
    if (!Number.isFinite(d.getTime()) || d.toISOString() !== x)
      throw new KycFoundationError('INVALID');
    return d;
  };
  const from = date(input.effectiveFrom);
  const until = input.effectiveUntil === null ? null : date(input.effectiveUntil);
  const regulatory = input.regulatory as unknown as Pair,
    operator = input.operator as unknown as Pair;
  const policy: TierDecisionPolicy = {
    version: 'check',
    approved: true,
    regulatoryRequirementsConfirmed: true,
    effectiveFrom: from,
    effectiveUntil: until,
    regulatory,
    operator,
  };
  const decision = decideTier({
    customerId: '00000000-0000-4000-8000-000000000000',
    identityRevision: 'check',
    now: from,
    policy,
    evidence: [],
  });
  if (decision.status === 'NOT_CONFIGURED') throw new KycFoundationError('INVALID');
  return {
    regulatoryRequirementsConfirmed: true,
    effectiveFrom: from.toISOString(),
    effectiveUntil: until?.toISOString() ?? null,
    regulatory,
    operator,
  };
}
const hash = (
  requestId: string,
  version: number,
  maker: string,
  definition: TierPolicyDefinition,
) =>
  createHash('sha256').update(canonical({ requestId, version, maker, definition })).digest('hex');
export class KycTierPolicyService {
  constructor(
    private readonly db: DataSource,
    private readonly auth: AuthorizationService,
  ) {}
  private async authorize(
    principal: AuthorizationPrincipal | undefined,
    mode: 'view' | 'propose' | 'approve',
  ) {
    if (
      !principal ||
      !principal.sessionId ||
      !UUID.test(principal.sessionId) ||
      (principal.readOnlyPrincipal && mode !== 'view')
    )
      throw new KycFoundationError('BLOCKED');
    const func = `kyc.policy.${mode}`;
    const role = mode === 'propose' ? 'SUPER_ADMIN' : mode === 'approve' ? 'COMPLIANCE' : undefined;
    const d = await this.auth.authorize(
      principal,
      {
        resourceType: 'KYC_TIER_POLICY',
        action: func,
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredFunctions: [func],
        ...(role ? { requiredRoles: [role] } : {}),
        minimumAssurance: 'MFA',
        customerAccess: 'NONE',
      },
      { type: 'KYC_TIER_POLICY' },
    );
    if (!d.allowed) throw new KycFoundationError('BLOCKED');
    return principal;
  }
  private async head(m: EntityManager): Promise<number> {
    const rows = await m.query<Array<{ version: number }>>(
      'SELECT version FROM kyc_tier_policy_head WHERE singleton=true FOR UPDATE',
    );
    if (!rows[0] || !Number.isSafeInteger(rows[0].version))
      throw new KycFoundationError('DISABLED');
    return rows[0].version;
  }
  async view(principal: AuthorizationPrincipal | undefined) {
    await this.authorize(principal, 'view');
    return this.db
      .query<
        Array<{
          version: number;
          definition: unknown;
          maker_id: string;
          checker_id: string;
          approved_at: Date;
        }>
      >(
        'SELECT version,definition,maker_id,checker_id,approved_at FROM kyc_tier_policy_versions ORDER BY version DESC LIMIT 100',
      )
      .then((rows) =>
        rows.map((r) => ({ ...r, definition: validateTierPolicyDefinition(r.definition) })),
      );
  }
  async proposals(principal: AuthorizationPrincipal | undefined) {
    await this.authorize(principal, 'view');
    return this.db
      .query<
        Array<{
          id: string;
          definition: unknown;
          state: string;
          maker_id: string;
          expected_version: number;
          expires_at: Date;
        }>
      >(
        'SELECT id,definition,state,maker_id,expected_version,expires_at FROM kyc_tier_policy_proposals ORDER BY created_at DESC LIMIT 100',
      )
      .then((rows) =>
        rows.map((r) => ({ ...r, definition: validateTierPolicyDefinition(r.definition) })),
      );
  }
  async propose(
    principal: AuthorizationPrincipal | undefined,
    cmd: { requestId: string; expectedVersion: number; definition: unknown },
  ) {
    const actor = await this.authorize(principal, 'propose');
    if (
      !UUID.test(cmd.requestId) ||
      !Number.isSafeInteger(cmd.expectedVersion) ||
      cmd.expectedVersion < 0
    )
      throw new KycFoundationError('INVALID');
    const definition = validateTierPolicyDefinition(cmd.definition);
    return this.db.transaction(async (m) => {
      const head = await this.head(m);
      const rows = await m.query<
        Array<{ id: string; maker_id: string; expected_version: number; definition: unknown }>
      >(
        'SELECT id,maker_id,expected_version,definition FROM kyc_tier_policy_proposals WHERE request_id=$1 FOR UPDATE',
        [cmd.requestId],
      );
      if (rows[0]) {
        const p = rows[0];
        if (
          p.maker_id !== actor.principalId ||
          p.expected_version !== cmd.expectedVersion ||
          canonical(p.definition) !== canonical(definition)
        )
          throw new KycFoundationError('CONFLICT');
        return { id: p.id, replay: true };
      }
      if (head !== cmd.expectedVersion) throw new KycFoundationError('CONFLICT');
      const id = randomUUID();
      await m.query(
        `INSERT INTO kyc_tier_policy_proposals(id,request_id,expected_version,definition,fingerprint,maker_id,maker_session_id,state) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,'REQUESTED')`,
        [
          id,
          cmd.requestId,
          head,
          JSON.stringify(definition),
          hash(cmd.requestId, head, actor.principalId, definition),
          actor.principalId,
          actor.sessionId,
        ],
      );
      return { id, replay: false };
    });
  }
  async decide(principal: AuthorizationPrincipal | undefined, id: string, approve: boolean) {
    const actor = await this.authorize(principal, 'approve');
    if (!UUID.test(id) || typeof approve !== 'boolean') throw new KycFoundationError('INVALID');
    return this.db.transaction(async (m) => {
      const head = await this.head(m);
      const rows = await m.query<
        Array<{
          request_id: string;
          expected_version: number;
          definition: unknown;
          fingerprint: string;
          maker_id: string;
          state: string;
          live: boolean;
        }>
      >(
        `SELECT request_id,expected_version,definition,fingerprint,maker_id,state,(expires_at>clock_timestamp()) AS live FROM kyc_tier_policy_proposals WHERE id=$1 FOR UPDATE`,
        [id],
      );
      const p = rows[0];
      if (!p) throw new KycFoundationError('NOT_FOUND');
      if (p.state !== 'REQUESTED' || !p.live || p.expected_version !== head)
        throw new KycFoundationError('CONFLICT');
      if (p.maker_id === actor.principalId) throw new KycFoundationError('BLOCKED');
      const definition = validateTierPolicyDefinition(p.definition);
      if (p.fingerprint !== hash(p.request_id, p.expected_version, p.maker_id, definition))
        throw new KycFoundationError('CONFLICT');
      const state = approve ? 'APPROVED' : 'REJECTED';
      await m.query(
        'UPDATE kyc_tier_policy_proposals SET state=$1,checker_id=$2,checker_session_id=$3,decided_at=clock_timestamp() WHERE id=$4',
        [state, actor.principalId, actor.sessionId, id],
      );
      if (!approve) return { version: head, state };
      const version = head + 1;
      await m.query('UPDATE kyc_tier_policy_head SET version=$1 WHERE singleton=true', [version]);
      await m.query(
        'INSERT INTO kyc_tier_policy_versions(version,proposal_id,definition,maker_id,checker_id) VALUES($1,$2,$3::jsonb,$4,$5)',
        [version, id, JSON.stringify(definition), p.maker_id, actor.principalId],
      );
      await m.query(`INSERT INTO kyc_evaluation_refresh(customer_id) SELECT DISTINCT customer_id FROM kyc_tier_evaluations
        ON CONFLICT(customer_id) DO UPDATE SET revision=kyc_evaluation_refresh.revision+1,requested_at=clock_timestamp(),retry_after=clock_timestamp()`);
      return { version, state };
    });
  }
  /** No fallback to older versions once a later policy becomes effective. */
  async effective(m: EntityManager, now: Date): Promise<TierDecisionPolicy | null> {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
      throw new KycFoundationError('INVALID');
    const head = await m.query<Array<{ version: number }>>(
      'SELECT version FROM kyc_tier_policy_head WHERE singleton=true FOR SHARE',
    );
    if (!head[0] || !Number.isSafeInteger(head[0].version))
      throw new KycFoundationError('DISABLED');
    const rows = await m.query<Array<{ version: number; definition: unknown }>>(
      `SELECT version,definition FROM kyc_tier_policy_versions WHERE (definition->>'effectiveFrom')::timestamptz <= $1 ORDER BY version DESC LIMIT 1`,
      [now],
    );
    if (!rows[0]) return null;
    const d = validateTierPolicyDefinition(rows[0].definition);
    const from = new Date(d.effectiveFrom),
      until = d.effectiveUntil ? new Date(d.effectiveUntil) : null;
    if (until && until <= now) return null;
    return {
      version: String(rows[0].version),
      approved: true,
      regulatoryRequirementsConfirmed: true,
      effectiveFrom: from,
      effectiveUntil: until,
      regulatory: d.regulatory,
      operator: d.operator,
    };
  }
}
