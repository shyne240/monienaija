import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { AuthorizationService } from '../authorization/authorization.service';
import type { ProtectedAuthorityService } from '../authorization/protected-authority.service';
import { canonical } from '../authorization/workforce-crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT = /^[A-Z0-9_][A-Z0-9_.-]{1,79}$/;
const PROFILE = /^[A-Z0-9_]{3,80}$/;
const CLASS_CODE = /^[A-Z0-9_]{1,64}$/;
const TIERS = ['LEVEL_1', 'LEVEL_2', 'LEVEL_3'] as const;

type Tier = (typeof TIERS)[number];
type Disposition = 'PROFILE' | 'NOT_APPLICABLE';

export interface TierLimitPolicyMapping {
  product: string;
  currency: string;
  /** Null is an explicit unclassified-service key, not a wildcard. */
  serviceClass: string | null;
  tier: Tier;
  disposition: Disposition;
  profileCode: string | null;
  profileDigest: string | null;
}

export interface InstitutionTierLimitPolicyDefinition {
  schemaVersion: 1;
  enabled: boolean;
  effectiveFrom: string;
  effectiveUntil: string | null;
  mappings: TierLimitPolicyMapping[];
}

export interface EffectiveTierLimitMapping {
  institutionId: string;
  policyVersion: number;
  mapping: TierLimitPolicyMapping;
}

export interface InstitutionKycLimitPolicyProposalView {
  id: string;
  request_id: string;
  expected_version: number;
  definition: unknown;
  state: 'REQUESTED' | 'APPROVED' | 'REJECTED';
  maker_id: string;
  checker_id: string | null;
  reason: string;
  created_at: Date;
  expires_at: Date;
  decided_at?: Date | null;
}

const exactKeys = (value: unknown, expected: readonly string[]): value is Record<string, unknown> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...expected].sort().join(',');

function stableInstant(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new BadRequestException(`${name} must be an ISO timestamp`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value)
    throw new BadRequestException(`${name} must be a canonical ISO timestamp`);
  return value;
}

function keyOf(
  mapping: Pick<TierLimitPolicyMapping, 'product' | 'currency' | 'serviceClass' | 'tier'>,
) {
  return `${mapping.product}|${mapping.currency}|${mapping.serviceClass ?? '<NULL>'}|${mapping.tier}`;
}

/**
 * Institution-scoped maker/checker policy for mapping a regulatory KYC tier and exact service key
 * to a governed limit profile, or to an explicit approved non-applicability decision. The
 * selected profile digest binds the approval to the actual profile and product/currency rules;
 * changes through the legacy generic limit editor invalidate the binding and stop admission until
 * a fresh policy is checked.
 */
@Injectable()
export class InstitutionKycLimitPolicyService {
  private readonly enforcementActivationEnabled: boolean;

  constructor(
    private readonly db: DataSource,
    private readonly auth: AuthorizationService,
    private readonly protectedAuthority: ProtectedAuthorityService,
    config: ConfigService<Environment, true>,
  ) {
    this.enforcementActivationEnabled = config.get('KYC_TIER_LIMIT_ENFORCEMENT_ENABLED', {
      infer: true,
    });
  }

  /** An off rollout flag leaves the pre-existing assignment rules in force, never an implicit tier. */
  get enforcementEnabled(): boolean {
    return this.enforcementActivationEnabled;
  }

  private get authoritySource(): DataSource {
    return this.protectedAuthority.dataSource;
  }

  private async authorize(
    principal: AuthorizationPrincipal | undefined,
    institutionId: string,
    mode: 'view' | 'propose' | 'approve',
  ): Promise<AuthorizationPrincipal> {
    if (
      !principal ||
      !UUID.test(principal.sessionId ?? '') ||
      (principal.readOnlyPrincipal && mode !== 'view')
    )
      throw new ForbiddenException('Institutional KYC limit policy access denied');
    const functionCode = mode === 'view' ? 'limit.view' : 'limit.modify';
    const role =
      mode === 'propose' ? 'FINANCE_PREPARER' : mode === 'approve' ? 'FINANCE_CONTROLLER' : null;
    const decision = await this.auth.authorize(
      principal,
      {
        resourceType: 'INSTITUTION_KYC_LIMIT_POLICY',
        action: `institution.kyc-limit-policy.${mode}`,
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredFunctions: [functionCode],
        ...(role ? { requiredRoles: [role] } : {}),
        ...(mode === 'view' ? {} : { minimumAssurance: 'MFA' as const }),
        customerAccess: 'NONE',
      },
      { type: 'INSTITUTION_KYC_LIMIT_POLICY', id: institutionId },
    );
    if (!decision.allowed)
      throw new ForbiddenException('Institutional KYC limit policy access denied');
    return principal;
  }

  async view(principal: AuthorizationPrincipal | undefined, institutionIdRaw: string) {
    const institutionId = this.uuid(institutionIdRaw);
    await this.authorize(principal, institutionId, 'view');
    const [headRows, versionRows, proposalRows] = await Promise.all([
      this.db.query<Array<{ version: number }>>(
        'SELECT version FROM institution_kyc_limit_policy_heads WHERE institution_id=$1',
        [institutionId],
      ),
      this.db.query<
        Array<{
          version: number;
          definition: unknown;
          approved_at: Date;
          maker_id: string;
          checker_id: string;
        }>
      >(
        `SELECT version,definition,approved_at,maker_id,checker_id
           FROM institution_kyc_limit_policy_versions WHERE institution_id=$1
          ORDER BY version DESC LIMIT 100`,
        [institutionId],
      ),
      this.db.query<InstitutionKycLimitPolicyProposalView[]>(
        `SELECT id,request_id,expected_version,definition,state,maker_id,checker_id,reason,created_at,expires_at
           FROM institution_kyc_limit_policy_proposals WHERE institution_id=$1
          ORDER BY created_at DESC LIMIT 100`,
        [institutionId],
      ),
    ]);
    return {
      institutionId,
      currentVersion: headRows[0]?.version ?? 0,
      enforcementActivationEnabled: this.enforcementActivationEnabled,
      versions: versionRows,
      proposals: proposalRows,
    };
  }

  async proposals(
    principal: AuthorizationPrincipal | undefined,
    institutionIdRaw: string,
  ): Promise<InstitutionKycLimitPolicyProposalView[]> {
    const institutionId = this.uuid(institutionIdRaw);
    await this.authorize(principal, institutionId, 'view');
    return this.db.query<InstitutionKycLimitPolicyProposalView[]>(
      `SELECT id,request_id,expected_version,definition,state,maker_id,checker_id,reason,created_at,expires_at,decided_at
         FROM institution_kyc_limit_policy_proposals WHERE institution_id=$1
        ORDER BY created_at DESC LIMIT 100`,
      [institutionId],
    );
  }

  async propose(
    principal: AuthorizationPrincipal | undefined,
    command: {
      institutionId: string;
      requestId: string;
      expectedVersion: number;
      definition: unknown;
      reason: string;
    },
  ): Promise<{ id: string; state: 'REQUESTED'; expectedVersion: number; replay: boolean }> {
    const institutionId = this.uuid(command.institutionId);
    const actor = await this.authorize(principal, institutionId, 'propose');
    const requestId = this.uuid(command.requestId);
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0)
      throw new BadRequestException('expectedVersion must be a non-negative integer');
    const reason = this.text(command.reason, 'reason', 500);
    return this.authoritySource.transaction(async (manager) => {
      await this.lock(manager, institutionId);
      const institutionRows = await manager.query<Array<{ status: string }>>(
        'SELECT status FROM financial_institutions WHERE id=$1 AND deleted_at IS NULL FOR SHARE',
        [institutionId],
      );
      if (!institutionRows[0] || institutionRows[0].status === 'CLOSED')
        throw new NotFoundException('Institution not found or closed');
      const headVersion = await this.ensureHead(manager, institutionId);
      if (headVersion !== command.expectedVersion)
        throw new ConflictException('Institutional KYC limit policy version is stale');
      const definition = await this.normalizeDefinition(manager, command.definition, false);
      const expiryRows = await manager.query<Array<{ expires_at: Date }>>(
        "SELECT clock_timestamp() + interval '24 hours' AS expires_at",
      );
      const expiresAt = expiryRows[0]?.expires_at;
      if (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime())) {
        throw new ServiceUnavailableException('Institutional policy clock is unavailable');
      }
      const prior = await manager.query<
        Array<{ id: string; expected_version: number; definition: unknown; maker_id: string }>
      >(
        `SELECT id,expected_version,definition,maker_id FROM institution_kyc_limit_policy_proposals
          WHERE institution_id=$1 AND request_id=$2 FOR UPDATE`,
        [institutionId, requestId],
      );
      if (prior[0]) {
        if (
          prior[0].maker_id !== actor.principalId ||
          prior[0].expected_version !== command.expectedVersion ||
          canonical(prior[0].definition) !== canonical(definition)
        )
          throw new ConflictException('Request id is already bound to another policy proposal');
        return {
          id: prior[0].id,
          state: 'REQUESTED' as const,
          expectedVersion: command.expectedVersion,
          replay: true,
        };
      }
      const id = randomUUID();
      const fingerprint = createHash('sha256')
        .update(
          canonical({
            id,
            institutionId,
            requestId,
            expectedVersion: command.expectedVersion,
            definition,
            reason,
            maker: actor.principalId,
          }),
        )
        .digest('hex');
      await manager.query(
        `INSERT INTO institution_kyc_limit_policy_proposals
          (id,institution_id,request_id,expected_version,definition,fingerprint,reason,maker_id,maker_session_id,expires_at)
         VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)`,
        [
          id,
          institutionId,
          requestId,
          command.expectedVersion,
          JSON.stringify(definition),
          fingerprint,
          reason,
          actor.principalId,
          actor.sessionId,
          expiresAt,
        ],
      );
      return {
        id,
        state: 'REQUESTED' as const,
        expectedVersion: command.expectedVersion,
        replay: false,
      };
    });
  }

  async decide(
    principal: AuthorizationPrincipal | undefined,
    institutionIdRaw: string,
    proposalIdRaw: string,
    approve: boolean,
  ): Promise<{ state: 'APPROVED' | 'REJECTED'; version: number }> {
    const institutionId = this.uuid(institutionIdRaw);
    const proposalId = this.uuid(proposalIdRaw);
    if (typeof approve !== 'boolean') throw new BadRequestException('Decision is invalid');
    const checker = await this.authorize(principal, institutionId, 'approve');
    return this.authoritySource.transaction(async (manager) => {
      await this.lock(manager, institutionId);
      const rows = await manager.query<
        Array<{
          id: string;
          institution_id: string;
          expected_version: number;
          definition: unknown;
          state: string;
          maker_id: string;
          maker_session_id: string;
          expires_at: Date;
        }>
      >(
        `SELECT id,institution_id,expected_version,definition,state,maker_id,maker_session_id,expires_at
           FROM institution_kyc_limit_policy_proposals WHERE id=$1 AND institution_id=$2 FOR UPDATE`,
        [proposalId, institutionId],
      );
      const proposal = rows[0];
      if (!proposal)
        throw new NotFoundException('Institutional KYC limit policy proposal not found');
      const clockRows = await manager.query<Array<{ now: Date; decided_at: Date }>>(
        'SELECT clock_timestamp() AS now,clock_timestamp() AS decided_at',
      );
      const databaseNow = clockRows[0]?.now;
      const decidedAt = clockRows[0]?.decided_at;
      if (
        !(databaseNow instanceof Date) ||
        !(decidedAt instanceof Date) ||
        !Number.isFinite(databaseNow.getTime()) ||
        !Number.isFinite(decidedAt.getTime())
      )
        throw new ServiceUnavailableException('Institutional policy clock is unavailable');
      if (proposal.state !== 'REQUESTED' || proposal.expires_at <= databaseNow)
        throw new ConflictException('Institutional KYC limit policy proposal is no longer live');
      if (proposal.maker_id === checker.principalId)
        throw new ForbiddenException('Self-approval is prohibited');
      const headVersion = await this.ensureHead(manager, institutionId);
      if (headVersion !== proposal.expected_version)
        throw new ConflictException('Institutional KYC limit policy proposal is stale');
      const definition = await this.normalizeDefinition(manager, proposal.definition, true);
      if (canonical(definition) !== canonical(proposal.definition))
        throw new ConflictException('A bound limit profile changed after the proposal was made');
      const digestRows = await manager.query<Array<{ payload_digest: string }>>(
        'SELECT protected_authority.institution_kyc_limit_payload_digest($1) AS payload_digest',
        [proposalId],
      );
      if (!digestRows[0]?.payload_digest)
        throw new ServiceUnavailableException(
          'Protected institutional policy authority is unavailable',
        );
      await manager.query(
        `INSERT INTO protected_authority.institution_kyc_limit_decisions
          (proposal_id,institution_id,expected_version,payload_digest,decision,maker_principal_id,maker_session_id,
           checker_principal_id,checker_session_id,assurance_level,decided_at,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'MFA',$10,$11)`,
        [
          proposalId,
          institutionId,
          proposal.expected_version,
          digestRows[0].payload_digest,
          approve ? 'APPROVED' : 'REJECTED',
          proposal.maker_id,
          proposal.maker_session_id,
          checker.principalId,
          checker.sessionId,
          decidedAt,
          proposal.expires_at,
        ],
      );
      await manager.query(
        `UPDATE institution_kyc_limit_policy_proposals
            SET state=$1,checker_id=$2,checker_session_id=$3,decided_at=$4
          WHERE id=$5 AND state='REQUESTED'`,
        [
          approve ? 'APPROVED' : 'REJECTED',
          checker.principalId,
          checker.sessionId,
          decidedAt,
          proposalId,
        ],
      );
      if (!approve) return { state: 'REJECTED' as const, version: headVersion };
      const nextVersion = headVersion + 1;
      await manager.query(
        `INSERT INTO institution_kyc_limit_policy_versions
          (institution_id,version,proposal_id,definition,maker_id,checker_id,approved_at)
         VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)`,
        [
          institutionId,
          nextVersion,
          proposalId,
          JSON.stringify(definition),
          proposal.maker_id,
          checker.principalId,
          decidedAt,
        ],
      );
      const changed = await manager.query<Array<{ version: number }>>(
        `UPDATE institution_kyc_limit_policy_heads SET version=$1,last_proposal_id=$2,updated_at=$3
          WHERE institution_id=$4 AND version=$5 RETURNING version`,
        [nextVersion, proposalId, decidedAt, institutionId, headVersion],
      );
      if (changed.length !== 1)
        throw new ConflictException('Institutional KYC limit policy version changed concurrently');
      return { state: 'APPROVED' as const, version: nextVersion };
    });
  }

  /** Called only inside a financial transaction. No cache and no institution/default fallback. */
  async resolveWithManager(
    manager: EntityManager,
    input: {
      institutionId: string;
      product: string;
      currency: string;
      serviceClass: string | null;
      tier: Tier;
    },
  ): Promise<EffectiveTierLimitMapping> {
    if (!this.enforcementActivationEnabled) {
      throw this.missing('Institutional KYC tier-limit enforcement is operationally disabled');
    }
    const institutionId =
      typeof input.institutionId === 'string' && UUID.test(input.institutionId)
        ? input.institutionId.toLowerCase()
        : null;
    if (!institutionId) throw this.missing('Institutional KYC tier-limit scope is invalid');
    const clockRows = await manager.query<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
    const now = clockRows[0]?.now;
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
      throw this.missing('Institutional policy clock is unavailable');
    const institution = await manager.query<Array<{ status: string }>>(
      'SELECT status FROM financial_institutions WHERE id=$1 AND deleted_at IS NULL FOR SHARE',
      [institutionId],
    );
    if (!institution[0] || institution[0].status !== 'APPROVED')
      throw this.missing('Approved institutional limit policy is unavailable');
    let rows: Array<{ version: number; definition: unknown }>;
    try {
      rows = await manager.query(
        `SELECT version,definition FROM institution_kyc_limit_policy_versions
          WHERE institution_id=$1
            AND (definition->>'effectiveFrom')::timestamptz <= $2
            AND (definition->>'effectiveUntil' IS NULL OR (definition->>'effectiveUntil')::timestamptz > $2)
          ORDER BY version DESC LIMIT 1`,
        [institutionId, now],
      );
    } catch {
      throw this.missing('Institutional KYC tier-limit policy state is invalid or unavailable');
    }
    const row = rows[0];
    if (!row)
      throw this.missing('Institutional KYC tier-limit policy is not configured or effective');
    let definition: InstitutionTierLimitPolicyDefinition;
    try {
      definition = await this.normalizeDefinition(manager, row.definition, true);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() >= 500) throw error;
      throw this.missing('Institutional KYC tier-limit policy definition is invalid');
    }
    if (!definition.enabled) throw this.missing('Institutional KYC tier-limit policy is disabled');
    const product = input.product.trim().toUpperCase();
    const currency = input.currency.trim().toUpperCase();
    const serviceClass =
      input.serviceClass === null ? null : input.serviceClass.trim().toUpperCase();
    const mapping = definition.mappings.find(
      (candidate) =>
        candidate.product === product &&
        candidate.currency === currency &&
        candidate.serviceClass === serviceClass &&
        candidate.tier === input.tier,
    );
    if (!mapping) throw this.missing('Required institutional KYC tier-limit mapping is missing');
    if (mapping.disposition === 'PROFILE') {
      const digest = await this.profileDigest(
        manager,
        mapping.profileCode!,
        product,
        currency,
        new Date(definition.effectiveFrom),
      );
      if (digest !== mapping.profileDigest)
        throw this.missing(
          'The approved limit profile changed; a fresh checker approval is required',
        );
    }
    return { institutionId, policyVersion: row.version, mapping };
  }

  private async normalizeDefinition(
    manager: EntityManager,
    raw: unknown,
    requireDigest: boolean,
  ): Promise<InstitutionTierLimitPolicyDefinition> {
    const keys = requireDigest
      ? ['schemaVersion', 'enabled', 'effectiveFrom', 'effectiveUntil', 'mappings']
      : ['schemaVersion', 'enabled', 'effectiveFrom', 'effectiveUntil', 'mappings'];
    if (
      !exactKeys(raw, keys) ||
      raw.schemaVersion !== 1 ||
      typeof raw.enabled !== 'boolean' ||
      !Array.isArray(raw.mappings) ||
      raw.mappings.length < 1 ||
      raw.mappings.length > 1000
    )
      throw new BadRequestException('Invalid institutional KYC tier-limit policy definition');
    const effectiveFrom = stableInstant(raw.effectiveFrom, 'effectiveFrom');
    const effectiveUntil =
      raw.effectiveUntil === null ? null : stableInstant(raw.effectiveUntil, 'effectiveUntil');
    if (effectiveUntil && new Date(effectiveUntil) <= new Date(effectiveFrom))
      throw new BadRequestException('effectiveUntil must be after effectiveFrom');
    const seen = new Set<string>();
    const mappings: TierLimitPolicyMapping[] = [];
    for (const value of raw.mappings) {
      const baseKeys = requireDigest
        ? [
            'product',
            'currency',
            'serviceClass',
            'tier',
            'disposition',
            'profileCode',
            'profileDigest',
          ]
        : ['product', 'currency', 'serviceClass', 'tier', 'disposition', 'profileCode'];
      if (!exactKeys(value, baseKeys))
        throw new BadRequestException('Invalid institutional tier-limit mapping');
      const product = typeof value.product === 'string' ? value.product.trim().toUpperCase() : '';
      const currency =
        typeof value.currency === 'string' ? value.currency.trim().toUpperCase() : '';
      const serviceClass =
        value.serviceClass === null
          ? null
          : typeof value.serviceClass === 'string'
            ? value.serviceClass.trim().toUpperCase()
            : undefined;
      const tier = value.tier;
      const disposition = value.disposition;
      if (
        !PRODUCT.test(product) ||
        !/^[A-Z]{3}$/.test(currency) ||
        serviceClass === undefined ||
        (serviceClass !== null && !CLASS_CODE.test(serviceClass)) ||
        !TIERS.includes(tier as Tier) ||
        (disposition !== 'PROFILE' && disposition !== 'NOT_APPLICABLE')
      )
        throw new BadRequestException('Invalid institutional tier-limit mapping key');
      const profileCode =
        value.profileCode === null
          ? null
          : typeof value.profileCode === 'string'
            ? value.profileCode.trim().toUpperCase()
            : undefined;
      if (profileCode === undefined || (profileCode !== null && !PROFILE.test(profileCode)))
        throw new BadRequestException('Invalid limit profile code');
      if (
        (disposition === 'PROFILE' && profileCode === null) ||
        (disposition === 'NOT_APPLICABLE' && profileCode !== null)
      )
        throw new BadRequestException('Limit profile must match the mapping disposition');
      const mappingKey = keyOf({ product, currency, serviceClass, tier: tier as Tier });
      if (seen.has(mappingKey))
        throw new BadRequestException('Duplicate institutional KYC tier-limit mapping');
      seen.add(mappingKey);
      let profileDigest: string | null = null;
      if (disposition === 'PROFILE') {
        profileDigest = await this.profileDigest(
          manager,
          profileCode!,
          product,
          currency,
          new Date(effectiveFrom),
        );
        if (requireDigest && value.profileDigest !== profileDigest)
          throw this.missing('Bound limit profile no longer matches the approved policy');
      } else if (requireDigest && value.profileDigest !== null) {
        throw new BadRequestException('Non-applicable mappings cannot bind a limit profile');
      }
      mappings.push({
        product,
        currency,
        serviceClass,
        tier: tier as Tier,
        disposition,
        profileCode,
        profileDigest,
      });
    }
    return { schemaVersion: 1, enabled: raw.enabled, effectiveFrom, effectiveUntil, mappings };
  }

  private async profileDigest(
    manager: EntityManager,
    profileCode: string,
    product: string,
    currency: string,
    effectiveAt: Date,
  ): Promise<string> {
    const profiles = await manager.query<
      Array<{
        code: string;
        name: string;
        kind: string;
        status: string;
        enabled: boolean;
        configuration_status: string;
        deleted_at: Date | null;
      }>
    >(
      `SELECT code,name,kind,status,enabled,configuration_status,deleted_at FROM limit_profiles WHERE code=$1`,
      [profileCode],
    );
    const profile = profiles[0];
    if (
      !profile ||
      profile.deleted_at ||
      !profile.enabled ||
      profile.status !== 'ACTIVE' ||
      profile.configuration_status !== 'CONFIGURED'
    )
      throw this.missing(`Limit profile ${profileCode} is not active and configured`);
    const rules = await manager.query<
      Array<{
        id: string;
        product: string;
        direction: string | null;
        channel: string | null;
        currency: string;
        dimension: string;
        limit_value_minor: string | null;
        limit_value_count: number | null;
        effective_from: string;
        effective_to: string | null;
        is_active: boolean;
        priority: number;
        deleted_at: Date | null;
      }>
    >(
      `SELECT id,product,direction,channel,currency,dimension,limit_value_minor::text AS limit_value_minor,
              limit_value_count,effective_from::text AS effective_from,effective_to::text AS effective_to,
              is_active,priority,deleted_at
         FROM limit_rules WHERE limit_profile_code=$1 AND upper(product)=upper($2) AND upper(currency)=upper($3)
         ORDER BY id`,
      [profileCode, product, currency],
    );
    const usable = rules.filter(
      (rule) =>
        rule.deleted_at === null &&
        rule.is_active &&
        new Date(rule.effective_from) <= effectiveAt &&
        (rule.effective_to === null || effectiveAt < new Date(rule.effective_to)),
    );
    if (usable.length === 0)
      throw this.missing(
        `Limit profile ${profileCode} has no effective rules for ${product}/${currency}`,
      );
    const material = {
      profile: {
        code: profile.code,
        name: profile.name,
        kind: profile.kind,
        status: profile.status,
        enabled: profile.enabled,
        configurationStatus: profile.configuration_status,
      },
      rules: rules.map((rule) => ({
        id: rule.id,
        product: rule.product,
        direction: rule.direction,
        channel: rule.channel,
        currency: rule.currency,
        dimension: rule.dimension,
        limitValueMinor: rule.limit_value_minor,
        limitValueCount: rule.limit_value_count,
        effectiveFrom: rule.effective_from,
        effectiveTo: rule.effective_to,
        isActive: rule.is_active,
        priority: rule.priority,
        deleted: rule.deleted_at !== null,
      })),
    };
    return createHash('sha256').update(canonical(material)).digest('hex');
  }

  private async lock(manager: EntityManager, institutionId: string): Promise<void> {
    await manager.query(
      `SELECT pg_advisory_xact_lock(hashtext('monienaija:institution-tier-limit-policy'),hashtext($1))`,
      [institutionId],
    );
  }

  private async ensureHead(manager: EntityManager, institutionId: string): Promise<number> {
    await manager.query(
      `INSERT INTO institution_kyc_limit_policy_heads(institution_id,version) VALUES($1,0)
       ON CONFLICT(institution_id) DO NOTHING`,
      [institutionId],
    );
    const rows = await manager.query<Array<{ version: number }>>(
      'SELECT version FROM institution_kyc_limit_policy_heads WHERE institution_id=$1 FOR UPDATE',
      [institutionId],
    );
    const version = rows[0]?.version;
    if (version === undefined || !Number.isSafeInteger(version)) {
      throw new ServiceUnavailableException('Institutional policy head unavailable');
    }
    return version;
  }

  private uuid(value: string): string {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || !UUID.test(normalized)) throw new BadRequestException('UUID is invalid');
    return normalized;
  }

  private text(value: string, field: string, max: number): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized.length < 3 || normalized.length > max)
      throw new BadRequestException(`${field} must be 3–${max} characters`);
    return normalized;
  }

  private missing(message: string): HttpException {
    const code = 'LIMIT_PROFILE_MISSING';
    return new HttpException({ message, error: code, code }, 503);
  }
}
