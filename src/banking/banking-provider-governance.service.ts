import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AuthorizationService } from '../authorization/authorization.service';
import { ProtectedAuthorityService } from '../authorization/protected-authority.service';
import { canonical } from '../authorization/workforce-crypto';

/**
 * Governance for banking provider configuration.
 *
 * The database is the authority here, not this service. `1785753600600` already enforces that a
 * decision row must match its proposal, that proposals are decided once, that decided proposals and
 * approved versions are immutable, and that the decision table is owned by
 * `monienaija_authority_core` which the runtime role cannot write. This service's job is to drive
 * that machinery honestly: hold the lock, check the version, refuse self-approval *before* asking the
 * database so the operator gets a real error rather than a trigger violation, and never let a caller
 * believe a provider is live when it is not.
 *
 * Two deliberate refusals are encoded below:
 *
 * - A proposal cannot claim a capability the provider's own descriptor does not advertise. A
 *   configuration that says "we can send outbound transfers" about an adapter that cannot is the
 *   exact class of error that only surfaces during a live transfer.
 * - Approval never implies credentials were validated. Nothing in this repository holds bank
 *   credentials, so `operationalReady` is an operator's assertion with its own audit trail, and the
 *   service refuses to publish `routingApproved` unless that assertion was made.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROVIDER_KEY = /^[A-Z][A-Z0-9_]{2,31}$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const ENVIRONMENTS = ['sandbox', 'production'] as const;

export type BankingEnvironmentName = (typeof ENVIRONMENTS)[number];

/** Capability keys are the registry's own names; nothing is invented here. */
export interface BankingCapabilityDeclaration {
  capability: string;
  /** `true` only when the provider documents and the adapter implements it. */
  supported: boolean;
  /** Where the claim came from, so a later reviewer can re-check it. */
  evidence: string;
}

export interface BankingProviderDefinition {
  schemaVersion: 1;
  capabilities: BankingCapabilityDeclaration[];
  /** Free-form operational notes. Never credentials, never account numbers. */
  notes: string | null;
}

export interface BankingProviderProposalCommand {
  institutionId: string;
  requestId: string;
  expectedVersion: number;
  providerKey: string;
  environment: BankingEnvironmentName;
  definition: unknown;
  credentialBundleFingerprint: string | null;
  routingApproved: boolean;
  operationalReady: boolean;
  reason: string;
}

export interface BankingProviderProposalView {
  id: string;
  institution_id: string;
  request_id: string;
  expected_version: number;
  provider_key: string;
  environment: string;
  capabilities: unknown;
  routing_approved: boolean;
  operational_ready: boolean;
  credential_bundle_fingerprint: string | null;
  definition: unknown;
  reason: string;
  state: 'REQUESTED' | 'APPROVED' | 'REJECTED';
  maker_id: string;
  checker_id: string | null;
  created_at: Date;
  expires_at: Date;
  decided_at: Date | null;
}

export interface BankingProviderVersionView {
  version: number;
  proposal_id: string;
  provider_key: string;
  environment: string;
  capabilities: unknown;
  routing_approved: boolean;
  operational_ready: boolean;
  definition: unknown;
  maker_id: string;
  checker_id: string;
  approved_at: Date;
}

/** The registry contract this service is allowed to believe. */
/** Injection token for the capability source. The registry is the only implementation, but binding it
 * by token (rather than by class) keeps the governance service from depending on a concrete registry
 * and lets a test substitute a fixed descriptor set. */
export const BANKING_PROVIDER_CAPABILITY_SOURCE = Symbol('BANKING_PROVIDER_CAPABILITY_SOURCE');

export interface BankingProviderCapabilitySource {
  descriptorFor(providerKey: string): {
    key: string;
    environments: readonly string[];
    capabilities: Readonly<Record<string, boolean>>;
  } | null;
}

const exactKeys = (value: unknown, expected: readonly string[]): value is Record<string, unknown> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...expected].sort().join(',');

@Injectable()
export class BankingProviderGovernanceService {
  constructor(
    private readonly db: DataSource,
    private readonly auth: AuthorizationService,
    private readonly protectedAuthority: ProtectedAuthorityService,
    @Inject(BANKING_PROVIDER_CAPABILITY_SOURCE)
    private readonly registry: BankingProviderCapabilitySource,
  ) {}

  /**
   * Governance writes happen on the protected data source, so the decision row is written by a
   * connection that holds `monienaija_authority_core`. The ordinary pool cannot insert it, which is
   * the point: reaching that table requires deliberate authority, not a stray INSERT.
   */
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
    ) {
      throw new ForbiddenException('Banking provider governance access denied');
    }
    const decision = await this.auth.authorize(
      principal,
      {
        resourceType: 'BANKING_PROVIDER_CONFIGURATION',
        action: `banking.provider.${mode}`,
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredFunctions: [`banking.provider.${mode}`],
        // Proposer and approver are different roles by construction, not by convention.
        ...(mode === 'propose'
          ? { requiredRoles: ['FINANCE_PREPARER', 'SUPER_ADMIN'] }
          : mode === 'approve'
            ? { requiredRoles: ['FINANCE_CONTROLLER'] }
            : {}),
        ...(mode === 'view' ? {} : { minimumAssurance: 'MFA' as const }),
        // Agency-banking configuration is never implied by ordinary merchant access.
        customerAccess: 'NONE',
      },
      { type: 'BANKING_PROVIDER_CONFIGURATION', id: institutionId },
    );
    if (!decision.allowed)
      throw new ForbiddenException('Banking provider governance access denied');
    return principal;
  }

  private async lock(manager: EntityManager, institutionId: string): Promise<void> {
    await manager.query(
      `SELECT pg_advisory_xact_lock(hashtext('monienaija:banking-provider-configuration'),hashtext($1))`,
      [institutionId],
    );
  }

  private async ensureHead(manager: EntityManager, institutionId: string): Promise<number> {
    await manager.query(
      `INSERT INTO banking_provider_configuration_heads(institution_id,version) VALUES($1,0)
       ON CONFLICT(institution_id) DO NOTHING`,
      [institutionId],
    );
    const rows = await manager.query<Array<{ version: number }>>(
      'SELECT version FROM banking_provider_configuration_heads WHERE institution_id=$1 FOR UPDATE',
      [institutionId],
    );
    const version = rows[0]?.version;
    if (version === undefined || !Number.isSafeInteger(version)) {
      throw new ServiceUnavailableException('Banking provider configuration head is unavailable');
    }
    return version;
  }

  private uuid(value: string, field = 'UUID'): string {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!normalized || !UUID.test(normalized)) throw new BadRequestException(`${field} is invalid`);
    return normalized;
  }

  private text(value: string, field: string, max: number): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized.length < 3 || normalized.length > max) {
      throw new BadRequestException(`${field} must be 3–${max} characters`);
    }
    return normalized;
  }

  /**
   * Validates a definition against the provider's own descriptor.
   *
   * The important direction is the second one: a definition may not claim support for a capability
   * the adapter does not advertise. Claiming *less* than the adapter can do is allowed and stored
   * verbatim — an institution may legitimately engage a subset.
   */
  private normalizeDefinition(
    providerKey: string,
    environment: BankingEnvironmentName,
    raw: unknown,
  ): BankingProviderDefinition {
    if (!exactKeys(raw, ['schemaVersion', 'capabilities', 'notes'])) {
      throw new BadRequestException(
        'Definition must contain exactly schemaVersion, capabilities, notes',
      );
    }
    if (raw.schemaVersion !== 1)
      throw new BadRequestException('Unsupported definition schemaVersion');
    if (raw.notes !== null && (typeof raw.notes !== 'string' || raw.notes.length > 1000)) {
      throw new BadRequestException('notes must be null or a string of at most 1000 characters');
    }
    if (!Array.isArray(raw.capabilities) || raw.capabilities.length === 0) {
      throw new BadRequestException('capabilities must be a non-empty array');
    }
    const descriptor = this.registry.descriptorFor(providerKey);
    if (!descriptor) {
      throw new BadRequestException(`Provider '${providerKey}' is not registered`);
    }
    if (!descriptor.environments.includes(environment)) {
      throw new BadRequestException(
        `Provider '${providerKey}' is not registered for ${environment}`,
      );
    }
    const seen = new Set<string>();
    const capabilities: BankingCapabilityDeclaration[] = [];
    for (const entry of raw.capabilities) {
      if (!exactKeys(entry, ['capability', 'supported', 'evidence'])) {
        throw new BadRequestException(
          'Each capability must contain exactly capability, supported, evidence',
        );
      }
      const capability = typeof entry.capability === 'string' ? entry.capability : '';
      if (!(capability in descriptor.capabilities)) {
        throw new BadRequestException(`Unknown capability '${capability}'`);
      }
      if (seen.has(capability))
        throw new BadRequestException(`Duplicate capability '${capability}'`);
      seen.add(capability);
      if (typeof entry.supported !== 'boolean') {
        throw new BadRequestException('supported must be a boolean');
      }
      const adapterSupports = descriptor.capabilities[capability] === true;
      if (entry.supported && !adapterSupports) {
        // Refusing this is the whole point of the check: a configuration asserting a capability the
        // adapter cannot perform would be trusted by every later check that reads it.
        throw new BadRequestException(
          `Provider '${providerKey}' does not advertise capability '${capability}'`,
        );
      }
      capabilities.push({
        capability,
        supported: entry.supported,
        evidence: this.text(
          typeof entry.evidence === 'string' ? entry.evidence : '',
          'evidence',
          500,
        ),
      });
    }
    return {
      schemaVersion: 1,
      capabilities,
      notes: typeof raw.notes === 'string' ? raw.notes : null,
    };
  }

  async view(principal: AuthorizationPrincipal | undefined, institutionIdRaw: string) {
    const institutionId = this.uuid(institutionIdRaw, 'institutionId');
    await this.authorize(principal, institutionId, 'view');
    const [headRows, versionRows, proposalRows] = await Promise.all([
      this.db.query<Array<{ version: number }>>(
        'SELECT version FROM banking_provider_configuration_heads WHERE institution_id=$1',
        [institutionId],
      ),
      this.db.query<BankingProviderVersionView[]>(
        `SELECT version,proposal_id,provider_key,environment,capabilities,routing_approved,
                operational_ready,definition,maker_id,checker_id,approved_at
           FROM banking_provider_configuration_versions WHERE institution_id=$1
          ORDER BY version DESC LIMIT 100`,
        [institutionId],
      ),
      this.db.query<BankingProviderProposalView[]>(
        `SELECT id,institution_id,request_id,expected_version,provider_key,environment,capabilities,
                routing_approved,operational_ready,credential_bundle_fingerprint,definition,reason,
                state,maker_id,checker_id,created_at,expires_at,decided_at
           FROM banking_provider_configuration_proposals WHERE institution_id=$1
          ORDER BY created_at DESC LIMIT 100`,
        [institutionId],
      ),
    ]);
    return {
      institutionId,
      currentVersion: headRows[0]?.version ?? 0,
      versions: versionRows,
      proposals: proposalRows,
    };
  }

  async propose(
    principal: AuthorizationPrincipal | undefined,
    command: BankingProviderProposalCommand,
  ): Promise<{ id: string; state: 'REQUESTED'; expectedVersion: number; replay: boolean }> {
    const institutionId = this.uuid(command.institutionId, 'institutionId');
    const actor = await this.authorize(principal, institutionId, 'propose');
    const requestId = this.uuid(command.requestId, 'requestId');
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0) {
      throw new BadRequestException('expectedVersion must be a non-negative integer');
    }
    const providerKey = typeof command.providerKey === 'string' ? command.providerKey.trim() : '';
    if (!PROVIDER_KEY.test(providerKey)) throw new BadRequestException('providerKey is invalid');
    if (!ENVIRONMENTS.includes(command.environment)) {
      throw new BadRequestException('environment must be sandbox or production');
    }
    if (
      typeof command.routingApproved !== 'boolean' ||
      typeof command.operationalReady !== 'boolean'
    ) {
      throw new BadRequestException('routingApproved and operationalReady must be booleans');
    }
    if (command.routingApproved && !command.operationalReady) {
      // Routing to a provider that is not operationally ready would send real money through a
      // connection nobody has confirmed. Refusing here keeps that from being stored at all.
      throw new BadRequestException(
        'A provider cannot be routing-approved while it is not operationally ready',
      );
    }
    const fingerprint = command.credentialBundleFingerprint;
    if (fingerprint !== null && !FINGERPRINT.test(fingerprint ?? '')) {
      throw new BadRequestException(
        'credentialBundleFingerprint must be a sha256 hex digest or null',
      );
    }
    const reason = this.text(command.reason, 'reason', 500);
    const definition = this.normalizeDefinition(
      providerKey,
      command.environment,
      command.definition,
    );
    const capabilities = definition.capabilities;

    return this.authoritySource.transaction(async (manager) => {
      await this.lock(manager, institutionId);
      const institution = await manager.query<Array<{ status: string }>>(
        'SELECT status FROM financial_institutions WHERE id=$1 AND deleted_at IS NULL FOR SHARE',
        [institutionId],
      );
      if (!institution[0] || institution[0].status === 'CLOSED') {
        throw new NotFoundException('Institution not found or closed');
      }
      const headVersion = await this.ensureHead(manager, institutionId);
      if (headVersion !== command.expectedVersion) {
        throw new ConflictException('Banking provider configuration version is stale');
      }
      const expiryRows = await manager.query<Array<{ expires_at: Date }>>(
        "SELECT clock_timestamp() + interval '24 hours' AS expires_at",
      );
      const expiresAt = expiryRows[0]?.expires_at;
      if (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime())) {
        throw new ServiceUnavailableException(
          'Banking provider configuration clock is unavailable',
        );
      }
      // Replay of an identical request is idempotent; a different payload under the same request id
      // is a client error, not a second proposal.
      const prior = await manager.query<
        Array<{
          id: string;
          expected_version: number;
          provider_key: string;
          environment: string;
          reason: string;
          definition: unknown;
          routing_approved: boolean;
          operational_ready: boolean;
          credential_bundle_fingerprint: string | null;
          maker_id: string;
        }>
      >(
        `SELECT id,expected_version,provider_key,environment,reason,definition,routing_approved,
                operational_ready,credential_bundle_fingerprint,maker_id
           FROM banking_provider_configuration_proposals
          WHERE institution_id=$1 AND request_id=$2 FOR UPDATE`,
        [institutionId, requestId],
      );
      if (prior[0]) {
        const same =
          prior[0].maker_id === actor.principalId &&
          prior[0].expected_version === command.expectedVersion &&
          prior[0].provider_key === providerKey &&
          prior[0].environment === command.environment &&
          prior[0].routing_approved === command.routingApproved &&
          prior[0].operational_ready === command.operationalReady &&
          prior[0].credential_bundle_fingerprint === fingerprint &&
          prior[0].reason === reason &&
          canonical(prior[0].definition) === canonical(definition);
        if (!same) throw new ConflictException('Request id is already bound to another proposal');
        return {
          id: prior[0].id,
          state: 'REQUESTED' as const,
          expectedVersion: command.expectedVersion,
          replay: true,
        };
      }
      const id = randomUUID();
      const digest = createHash('sha256')
        .update(
          canonical({
            id,
            institutionId,
            requestId,
            expectedVersion: command.expectedVersion,
            providerKey,
            environment: command.environment,
            capabilities,
            routingApproved: command.routingApproved,
            operationalReady: command.operationalReady,
            credentialBundleFingerprint: fingerprint,
            definition,
            reason,
            maker: actor.principalId,
          }),
        )
        .digest('hex');
      await manager.query(
        `INSERT INTO banking_provider_configuration_proposals
          (id,institution_id,request_id,expected_version,provider_key,environment,capabilities,
           routing_approved,operational_ready,credential_bundle_fingerprint,definition,fingerprint,
           reason,maker_id,maker_session_id,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16)`,
        [
          id,
          institutionId,
          requestId,
          command.expectedVersion,
          providerKey,
          command.environment,
          JSON.stringify(capabilities),
          command.routingApproved,
          command.operationalReady,
          fingerprint,
          JSON.stringify(definition),
          digest,
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
    const institutionId = this.uuid(institutionIdRaw, 'institutionId');
    const proposalId = this.uuid(proposalIdRaw, 'proposalId');
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
          provider_key: string;
          environment: string;
          routing_approved: boolean;
          operational_ready: boolean;
          state: string;
          maker_id: string;
          maker_session_id: string;
          expires_at: Date;
        }>
      >(
        `SELECT id,institution_id,expected_version,definition,provider_key,environment,
                routing_approved,operational_ready,state,maker_id,maker_session_id,expires_at
           FROM banking_provider_configuration_proposals
          WHERE id=$1 AND institution_id=$2 FOR UPDATE`,
        [proposalId, institutionId],
      );
      const proposal = rows[0];
      if (!proposal) throw new NotFoundException('Banking provider proposal not found');
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
      ) {
        throw new ServiceUnavailableException(
          'Banking provider configuration clock is unavailable',
        );
      }
      if (proposal.state !== 'REQUESTED' || proposal.expires_at <= databaseNow) {
        throw new ConflictException('Banking provider proposal is no longer live');
      }
      if (proposal.maker_id === checker.principalId) {
        throw new ForbiddenException('Self-approval is prohibited');
      }
      const headVersion = await this.ensureHead(manager, institutionId);
      if (headVersion !== proposal.expected_version) {
        throw new ConflictException('Banking provider proposal is stale');
      }
      // Re-validate on approval: the registry is code, and a deployment could have removed a
      // capability between proposal and decision. Approving a claim the code no longer supports
      // would publish a configuration that lies.
      const definition = this.normalizeDefinition(
        proposal.provider_key,
        proposal.environment as BankingEnvironmentName,
        proposal.definition,
      );
      if (canonical(definition) !== canonical(proposal.definition)) {
        throw new ConflictException(
          'The provider capability set changed after the proposal was made',
        );
      }
      const digestRows = await manager.query<Array<{ payload_digest: string }>>(
        'SELECT protected_authority.banking_provider_payload_digest($1) AS payload_digest',
        [proposalId],
      );
      const payloadDigest = digestRows[0]?.payload_digest;
      if (!payloadDigest) {
        throw new ServiceUnavailableException(
          'Protected banking provider authority is unavailable',
        );
      }
      await manager.query(
        `INSERT INTO protected_authority.banking_provider_decisions
          (proposal_id,institution_id,expected_version,payload_digest,decision,maker_principal_id,
           maker_session_id,checker_principal_id,checker_session_id,assurance_level,decided_at,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'MFA',$10,$11)`,
        [
          proposalId,
          institutionId,
          proposal.expected_version,
          payloadDigest,
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
        `UPDATE banking_provider_configuration_proposals
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
        `INSERT INTO banking_provider_configuration_versions
          (institution_id,version,proposal_id,provider_key,environment,capabilities,
           routing_approved,operational_ready,definition,maker_id,checker_id,approved_at)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10,$11,$12)`,
        [
          institutionId,
          nextVersion,
          proposalId,
          proposal.provider_key,
          proposal.environment,
          JSON.stringify(definition.capabilities),
          proposal.routing_approved,
          proposal.operational_ready,
          JSON.stringify(definition),
          proposal.maker_id,
          checker.principalId,
          decidedAt,
        ],
      );
      const changed = await manager.query<Array<{ version: number }>>(
        `WITH changed AS (
           UPDATE banking_provider_configuration_heads
              SET version=$1,last_proposal_id=$2,updated_at=$3
            WHERE institution_id=$4 AND version=$5
            RETURNING version
         ) SELECT version FROM changed`,
        [nextVersion, proposalId, decidedAt, institutionId, headVersion],
      );
      if (changed.length !== 1) {
        throw new ConflictException('Banking provider configuration version changed concurrently');
      }
      return { state: 'APPROVED' as const, version: nextVersion };
    });
  }
}
