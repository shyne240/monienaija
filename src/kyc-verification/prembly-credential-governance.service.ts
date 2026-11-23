import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { ProtectedAuthorityService } from '../authorization/protected-authority.service';
import { canonical } from '../authorization/workforce-crypto';
import type { Environment } from '../config/environment';
import type { AuditService } from '../operations/audit.service';
import { PremblyVerificationProvider } from '../identity-verification/prembly-verification.provider';
import type { PremblyTransport } from '../identity-verification/prembly-transport';
import { KycFoundationError } from './kyc.types';
import { UUID } from './kyc-orchestrator';
import { appendKycGovernanceDecision } from './kyc-governance-authority';
import {
  KycProviderSecretEncryptionService,
  type KycCredentialEnvironment,
} from './kyc-provider-secret-encryption.service';

export type PremblyCredentialOperation = 'SET' | 'CLEAR';
export interface PremblyCredentialProposalCommand {
  requestId: string;
  environment: KycCredentialEnvironment;
  operation: PremblyCredentialOperation;
  apiKey?: string;
}

interface CredentialChange {
  provider: 'PREMBLY';
  environment: KycCredentialEnvironment;
  operation: PremblyCredentialOperation;
  envelope: string | null;
  keyVersion: string | null;
  fingerprint: string | null;
}

export interface CredentialStatus {
  configured: boolean;
  version: number;
  fingerprint: string | null;
  keyVersion: string | null;
  updatedAt: string | null;
}

const SAFE_CREDENTIAL_VERSION = /^[A-Za-z0-9._-]{1,64}$/;
const ENVIRONMENTS: readonly KycCredentialEnvironment[] = ['sandbox', 'production'];
const OPERATIONS: readonly PremblyCredentialOperation[] = ['SET', 'CLEAR'];
// eslint-disable-next-line no-control-regex -- Control bytes are invalid in provider API keys.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseCredentialChange(value: unknown): CredentialChange {
  const change = record(value);
  if (
    !change ||
    Object.keys(change).sort().join(',') !==
      'envelope,environment,fingerprint,keyVersion,operation,provider' ||
    change.provider !== 'PREMBLY' ||
    !ENVIRONMENTS.includes(change.environment as KycCredentialEnvironment) ||
    !OPERATIONS.includes(change.operation as PremblyCredentialOperation)
  )
    throw new KycFoundationError('CONFLICT');
  const operation = change.operation as PremblyCredentialOperation;
  if (
    operation === 'SET' &&
    (typeof change.envelope !== 'string' ||
      !change.envelope.startsWith('MNKPS1:') ||
      typeof change.keyVersion !== 'string' ||
      !SAFE_CREDENTIAL_VERSION.test(change.keyVersion) ||
      typeof change.fingerprint !== 'string' ||
      !/^\*{4}[A-Za-z0-9_-]{4}$/.test(change.fingerprint))
  )
    throw new KycFoundationError('CONFLICT');
  if (
    operation === 'CLEAR' &&
    (change.envelope !== null || change.keyVersion !== null || change.fingerprint !== null)
  )
    throw new KycFoundationError('CONFLICT');
  return {
    provider: 'PREMBLY',
    environment: change.environment as KycCredentialEnvironment,
    operation,
    envelope: change.envelope as string | null,
    keyVersion: change.keyVersion as string | null,
    fingerprint: change.fingerprint as string | null,
  };
}

function proposalFingerprint(input: {
  requestId: string;
  expectedVersion: number;
  expectedCredentialVersion: number;
  configuration: unknown;
  change: CredentialChange;
  maker: string;
}): string {
  return createHash('sha256').update(canonical(input)).digest('hex');
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class PremblyCredentialGovernanceService {
  constructor(
    private readonly db: DataSource,
    private readonly auth: AuthorizationService,
    private readonly protectedAuthority: ProtectedAuthorityService,
    private readonly encryption: KycProviderSecretEncryptionService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Environment, true>,
    private readonly transport: PremblyTransport,
  ) {}

  private get authoritySource(): DataSource {
    return this.protectedAuthority.dataSource ?? this.db;
  }

  private async authorize(
    principal: AuthorizationPrincipal | undefined,
    mode: 'view' | 'propose' | 'approve',
  ): Promise<AuthorizationPrincipal> {
    const functionCode = `kyc.provider.${mode}`;
    if (
      !principal ||
      (principal.readOnlyPrincipal && mode !== 'view') ||
      !principal.sessionId ||
      !UUID.test(principal.sessionId)
    )
      throw new KycFoundationError('BLOCKED');
    const role = mode === 'propose' ? 'SUPER_ADMIN' : mode === 'approve' ? 'COMPLIANCE' : undefined;
    const decision = await this.auth.authorize(
      principal,
      {
        resourceType: 'KYC_PROVIDER_CONFIGURATION',
        action: functionCode,
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredFunctions: [functionCode],
        ...(role ? { requiredRoles: [role] } : {}),
        minimumAssurance: 'MFA',
        customerAccess: 'NONE',
      },
      { type: 'KYC_PROVIDER_CONFIGURATION' },
    );
    if (!decision.allowed) throw new KycFoundationError('BLOCKED');
    return principal;
  }

  private async lockProviderConfiguration(manager: EntityManager): Promise<void> {
    await manager.query(
      `SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('monienaija:kyc-provider-route-v1'))`,
    );
  }

  private configurationFlags() {
    const nodeEnv = this.config.get('NODE_ENV', { infer: true });
    const contractsReviewed = this.config.get('KYC_PROVIDER_CONTRACTS_REVIEWED', { infer: true });
    const liveCallsEnabled = this.config.get('KYC_PROVIDER_LIVE_CALLS_ENABLED', { infer: true });
    const customerKycEnabled = this.config.get('KYC_CUSTOMER_VERIFICATION_ENABLED', {
      infer: true,
    });
    const sandboxCallsEnabled = this.config.get('PREMBLY_SANDBOX_CALLS_ENABLED', { infer: true });
    const productionReleased =
      nodeEnv === 'production' &&
      this.config.get('PREMBLY_PRODUCTION_RELEASE_ENABLED', { infer: true }) &&
      contractsReviewed &&
      liveCallsEnabled &&
      customerKycEnabled;
    return {
      nodeEnv,
      contractsReviewed,
      liveCallsEnabled,
      customerKycEnabled,
      sandboxCallsEnabled,
      productionReleased,
    };
  }

  async status(principal: AuthorizationPrincipal | undefined) {
    await this.authorize(principal, 'view');
    const rows = await this.db.query<
      Array<{
        environment: KycCredentialEnvironment;
        version: number;
        encrypted_api_key: string | null;
        key_version: string | null;
        fingerprint: string | null;
        updated_at: Date;
      }>
    >(
      `SELECT environment,version,encrypted_api_key,key_version,fingerprint,updated_at
       FROM kyc_provider_credentials WHERE provider='PREMBLY' ORDER BY environment`,
    );
    const byEnvironment = new Map(rows.map((row) => [row.environment, row]));
    const project = (environment: KycCredentialEnvironment): CredentialStatus => {
      const row = byEnvironment.get(environment);
      const configured = Boolean(row?.encrypted_api_key && row.key_version && row.fingerprint);
      return {
        configured,
        version: Number.isSafeInteger(row?.version) ? row!.version : 0,
        fingerprint: configured ? row!.fingerprint : null,
        keyVersion: configured ? row!.key_version : null,
        updatedAt: row?.updated_at ? row.updated_at.toISOString() : null,
      };
    };
    const flags = this.configurationFlags();
    return {
      provider: 'PREMBLY' as const,
      encryptionAvailable: this.encryption.status().available,
      sandboxTestEnabled: flags.sandboxCallsEnabled && flags.nodeEnv !== 'test',
      productionReleased: flags.productionReleased,
      sandbox: project('sandbox'),
      production: project('production'),
    };
  }

  async proposals(principal: AuthorizationPrincipal | undefined) {
    await this.authorize(principal, 'view');
    const rows = await this.db.query<
      Array<{
        id: string;
        expected_version: number;
        expected_credential_version: number;
        environment: KycCredentialEnvironment;
        operation: PremblyCredentialOperation;
        fingerprint: string | null;
        maker_id: string;
        state: 'REQUESTED' | 'APPROVED' | 'REJECTED';
        created_at: Date;
        expires_at: Date;
      }>
    >(`SELECT id,expected_version,expected_credential_version,
        credential_change->>'environment' AS environment,
        credential_change->>'operation' AS operation,
        credential_change->>'fingerprint' AS fingerprint,
        maker_id,state,created_at,expires_at
      FROM kyc_provider_change_proposals
      WHERE change_type='PREMBLY_CREDENTIAL'
      ORDER BY created_at DESC LIMIT 100`);
    return rows.map((row) => ({
      id: row.id,
      expectedRouteVersion: row.expected_version,
      expectedCredentialVersion: row.expected_credential_version,
      environment: row.environment,
      operation: row.operation,
      fingerprint: row.fingerprint,
      makerId: row.maker_id,
      state: row.state,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    }));
  }

  async propose(
    principal: AuthorizationPrincipal | undefined,
    command: PremblyCredentialProposalCommand,
  ) {
    const maker = await this.authorize(principal, 'propose');
    if (
      !UUID.test(command.requestId) ||
      !ENVIRONMENTS.includes(command.environment) ||
      !OPERATIONS.includes(command.operation) ||
      (command.operation === 'SET' &&
        (typeof command.apiKey !== 'string' ||
          command.apiKey.trim().length < 16 ||
          command.apiKey.length > 512 ||
          CONTROL_CHARACTERS.test(command.apiKey))) ||
      (command.operation === 'CLEAR' && command.apiKey !== undefined)
    )
      throw new KycFoundationError('INVALID');

    const actor = maker.principalId;
    return this.authoritySource.transaction(async (manager) => {
      await this.lockProviderConfiguration(manager);
      const configRows = await manager.query<Array<{ version: number; configuration: unknown }>>(
        `SELECT version,configuration FROM kyc_provider_configuration WHERE singleton=true FOR UPDATE`,
      );
      const current = configRows[0];
      if (!current || !Number.isSafeInteger(current.version) || current.version < 0)
        throw new KycFoundationError('DISABLED');
      const credentialRows = await manager.query<Array<{ version: number }>>(
        `SELECT version FROM kyc_provider_credentials
         WHERE provider='PREMBLY' AND environment=$1 FOR UPDATE`,
        [command.environment],
      );
      const credentialVersion = credentialRows[0]?.version;
      if (
        typeof credentialVersion !== 'number' ||
        !Number.isSafeInteger(credentialVersion) ||
        credentialVersion < 0
      )
        throw new KycFoundationError('DISABLED');

      const priorRows = await manager.query<
        Array<{
          id: string;
          expected_version: number;
          expected_credential_version: number;
          configuration: unknown;
          fingerprint: string;
          maker_id: string;
          credential_change: unknown;
        }>
      >(
        `SELECT id,expected_version,expected_credential_version,configuration,fingerprint,
            maker_id,credential_change
         FROM kyc_provider_change_proposals WHERE request_id=$1 FOR UPDATE`,
        [command.requestId],
      );
      if (priorRows[0]) {
        const prior = priorRows[0];
        const change = parseCredentialChange(prior.credential_change);
        if (
          prior.maker_id !== actor ||
          change.environment !== command.environment ||
          change.operation !== command.operation ||
          prior.fingerprint.trim() !==
            proposalFingerprint({
              requestId: command.requestId,
              expectedVersion: prior.expected_version,
              expectedCredentialVersion: prior.expected_credential_version,
              configuration: prior.configuration,
              change,
              maker: prior.maker_id,
            })
        )
          throw new KycFoundationError('CONFLICT');
        if (command.operation === 'SET') {
          const stored = this.encryption.decrypt(
            change.envelope!,
            command.environment,
            change.keyVersion,
          );
          if (!sameSecret(stored, command.apiKey!.trim())) throw new KycFoundationError('CONFLICT');
        }
        return { id: prior.id, replay: true };
      }

      let change: CredentialChange;
      if (command.operation === 'SET') {
        const encrypted = this.encryption.encrypt(command.apiKey!, command.environment);
        change = {
          provider: 'PREMBLY',
          environment: command.environment,
          operation: 'SET',
          envelope: encrypted.envelope,
          keyVersion: encrypted.keyVersion,
          fingerprint: encrypted.fingerprint,
        };
      } else {
        change = {
          provider: 'PREMBLY',
          environment: command.environment,
          operation: 'CLEAR',
          envelope: null,
          keyVersion: null,
          fingerprint: null,
        };
      }
      const id = randomUUID();
      const fingerprint = proposalFingerprint({
        requestId: command.requestId,
        expectedVersion: current.version,
        expectedCredentialVersion: credentialVersion,
        configuration: current.configuration,
        change,
        maker: actor,
      });
      await manager.query(
        `INSERT INTO kyc_provider_change_proposals(
          id,request_id,expected_version,expected_credential_version,configuration,fingerprint,
          reason_code,change_type,credential_change,maker_id,maker_session_id,state
        ) VALUES($1,$2,$3,$4,$5::jsonb,$6,'CREDENTIAL_CHANGE','PREMBLY_CREDENTIAL',$7::jsonb,$8,$9,'REQUESTED')`,
        [
          id,
          command.requestId,
          current.version,
          credentialVersion,
          JSON.stringify(current.configuration),
          fingerprint,
          JSON.stringify(change),
          actor,
          maker.sessionId,
        ],
      );
      await this.audit.record(manager, {
        entityType: 'KYC_PROVIDER_CREDENTIAL',
        entityId: randomUUID(),
        action: 'PREMBLY_CREDENTIAL_PROPOSED',
        actor,
        correlationId: command.requestId,
        newValues: {
          environment: command.environment,
          operation: command.operation,
          fingerprint: change.fingerprint,
          proposalId: id,
          expectedRouteVersion: current.version,
          expectedCredentialVersion: credentialVersion,
        },
      });
      return { id, replay: false };
    });
  }

  async decide(
    principal: AuthorizationPrincipal | undefined,
    proposalId: string,
    approve: boolean,
  ): Promise<{ credentialVersion: number; state: 'APPROVED' | 'REJECTED' }> {
    const checker = await this.authorize(principal, 'approve');
    if (!UUID.test(proposalId) || typeof approve !== 'boolean')
      throw new KycFoundationError('INVALID');
    return this.authoritySource.transaction(async (manager) => {
      await this.lockProviderConfiguration(manager);
      const routeRows = await manager.query<Array<{ version: number; configuration: unknown }>>(
        `SELECT version,configuration FROM kyc_provider_configuration WHERE singleton=true FOR UPDATE`,
      );
      const routeVersion = routeRows[0]?.version;
      if (
        typeof routeVersion !== 'number' ||
        !Number.isSafeInteger(routeVersion) ||
        routeVersion < 0
      )
        throw new KycFoundationError('DISABLED');
      const rows = await manager.query<
        Array<{
          id: string;
          request_id: string;
          expected_version: number;
          expected_credential_version: number;
          configuration: unknown;
          fingerprint: string;
          maker_id: string;
          state: string;
          live: boolean;
          credential_change: unknown;
        }>
      >(
        `SELECT id,request_id,expected_version,expected_credential_version,configuration,
            fingerprint,maker_id,state,(expires_at>clock_timestamp()) AS live,credential_change
         FROM kyc_provider_change_proposals WHERE id=$1 FOR UPDATE`,
        [proposalId],
      );
      const proposal = rows[0];
      if (!proposal) throw new KycFoundationError('NOT_FOUND');
      const change = parseCredentialChange(proposal.credential_change);
      const credentialRows = await manager.query<Array<{ version: number }>>(
        `SELECT version FROM kyc_provider_credentials
         WHERE provider='PREMBLY' AND environment=$1 FOR UPDATE`,
        [change.environment],
      );
      const currentCredential = credentialRows[0];
      if (
        proposal.state !== 'REQUESTED' ||
        !proposal.live ||
        proposal.expected_version !== routeVersion ||
        !currentCredential ||
        proposal.expected_credential_version !== currentCredential.version ||
        proposal.maker_id === checker.principalId ||
        canonical(proposal.configuration) !== canonical(routeRows[0]?.configuration) ||
        proposal.fingerprint.trim() !==
          proposalFingerprint({
            requestId: proposal.request_id,
            expectedVersion: proposal.expected_version,
            expectedCredentialVersion: proposal.expected_credential_version,
            configuration: proposal.configuration,
            change,
            maker: proposal.maker_id,
          })
      )
        throw new KycFoundationError('CONFLICT');

      const state = approve ? 'APPROVED' : 'REJECTED';
      const decidedAt = await appendKycGovernanceDecision(
        manager,
        'PROVIDER',
        proposalId,
        state,
        checker,
      );
      await manager.query(
        `UPDATE kyc_provider_change_proposals
         SET state=$1,checker_id=$2,checker_session_id=$3,decided_at=$4 WHERE id=$5`,
        [state, checker.principalId, checker.sessionId, decidedAt, proposalId],
      );

      const nextCredentialVersion = currentCredential.version + (approve ? 1 : 0);
      if (approve) {
        const encryptedApiKey = change.operation === 'SET' ? change.envelope : null;
        const keyVersion = change.operation === 'SET' ? change.keyVersion : null;
        const masked = change.operation === 'SET' ? change.fingerprint : null;
        const updated = await manager.query<Array<{ version: number }>>(
          `WITH updated AS (
            UPDATE kyc_provider_credentials
             SET version=version+1,encrypted_api_key=$1,key_version=$2,fingerprint=$3,
                 last_proposal_id=$4,updated_at=clock_timestamp()
             WHERE provider='PREMBLY' AND environment=$5 AND version=$6
             RETURNING version
          ) SELECT version FROM updated`,
          [
            encryptedApiKey,
            keyVersion,
            masked,
            proposalId,
            change.environment,
            currentCredential.version,
          ],
        );
        if (updated.length !== 1) throw new KycFoundationError('CONFLICT');
      }
      await this.audit.record(manager, {
        entityType: 'KYC_PROVIDER_CREDENTIAL',
        entityId: randomUUID(),
        action: approve ? 'PREMBLY_CREDENTIAL_APPROVED' : 'PREMBLY_CREDENTIAL_REJECTED',
        actor: checker.principalId,
        correlationId: proposal.request_id,
        newValues: {
          environment: change.environment,
          operation: change.operation,
          fingerprint: change.fingerprint,
          proposalId,
          state,
          credentialVersion: nextCredentialVersion,
        },
      });
      return { credentialVersion: nextCredentialVersion, state };
    });
  }

  /** Returns a server-side secret only after explicit environment-specific release gates pass. */
  async getRuntimeApiKey(): Promise<string | null> {
    const flags = this.configurationFlags();
    let environment: KycCredentialEnvironment;
    if (flags.nodeEnv === 'test') return null;
    if (flags.nodeEnv === 'production') {
      if (!flags.productionReleased) return null;
      environment = 'production';
    } else {
      if (
        !flags.sandboxCallsEnabled ||
        !flags.contractsReviewed ||
        !flags.liveCallsEnabled ||
        !flags.customerKycEnabled
      )
        return null;
      environment = 'sandbox';
    }
    return this.decryptActiveCredential(environment);
  }

  async isRuntimeReady(): Promise<boolean> {
    return Boolean(await this.getRuntimeApiKey());
  }

  private async decryptActiveCredential(
    environment: KycCredentialEnvironment,
  ): Promise<string | null> {
    const rows = await this.db.query<
      Array<{ encrypted_api_key: string | null; key_version: string | null }>
    >(
      `SELECT encrypted_api_key,key_version FROM kyc_provider_credentials
       WHERE provider='PREMBLY' AND environment=$1`,
      [environment],
    );
    const row = rows[0];
    if (!row?.encrypted_api_key || !row.key_version) return null;
    try {
      return this.encryption.decrypt(row.encrypted_api_key, environment, row.key_version);
    } catch {
      return null;
    }
  }

  async testSandboxConnection(principal: AuthorizationPrincipal | undefined) {
    const maker = await this.authorize(principal, 'propose');
    const flags = this.configurationFlags();
    if (!flags.sandboxCallsEnabled || flags.nodeEnv === 'test')
      throw new KycFoundationError('DISABLED');
    const apiKey = await this.decryptActiveCredential('sandbox');
    if (!apiKey) throw new KycFoundationError('DISABLED');

    const requestId = randomUUID();
    await this.authoritySource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('monienaija:prembly-test:' || $1))`,
        [maker.principalId],
      );
      const recent = await manager.query<Array<{ count: string }>>(
        `SELECT count(*)::text AS count FROM audit_events
         WHERE entity_type='KYC_PROVIDER_CREDENTIAL'
           AND action='PREMBLY_SANDBOX_CONNECTION_TEST_REQUESTED'
           AND actor=$1 AND occurred_at>clock_timestamp()-interval '1 hour'`,
        [maker.principalId],
      );
      if (Number(recent[0]?.count ?? 0) >= 3) throw new KycFoundationError('BLOCKED');
      await this.audit.record(manager, {
        entityType: 'KYC_PROVIDER_CREDENTIAL',
        entityId: randomUUID(),
        action: 'PREMBLY_SANDBOX_CONNECTION_TEST_REQUESTED',
        actor: maker.principalId,
        correlationId: requestId,
        newValues: { environment: 'sandbox', operation: 'BVN_BASIC_TEST_DATA' },
      });
    });

    let outcome: 'CONNECTED' | 'AUTH_FAILED' | 'INDETERMINATE' = 'INDETERMINATE';
    let httpStatus: number | null = null;
    let responseCode: string | null = null;
    try {
      const probe = new PremblyVerificationProvider({
        credentialResolver: { getApiKey: () => Promise.resolve(null) },
        transport: this.transport,
      });
      const response = await probe.testSandboxConnection(apiKey, new AbortController().signal);
      httpStatus = response.httpStatus;
      responseCode = response.responseCode;
      if (httpStatus === 401 || httpStatus === 403) outcome = 'AUTH_FAILED';
      else if (
        httpStatus >= 200 &&
        httpStatus < 300 &&
        response.providerStatus === true &&
        responseCode === '00'
      )
        outcome = 'CONNECTED';
    } catch {
      outcome = 'INDETERMINATE';
    }

    await this.authoritySource.transaction((manager) =>
      this.audit.record(manager, {
        entityType: 'KYC_PROVIDER_CREDENTIAL',
        entityId: randomUUID(),
        action: 'PREMBLY_SANDBOX_CONNECTION_TEST_COMPLETED',
        actor: maker.principalId,
        correlationId: requestId,
        newValues: {
          environment: 'sandbox',
          operation: 'BVN_BASIC_TEST_DATA',
          outcome,
          httpStatus,
          responseCode,
          resultSource: 'ACTUAL_PREMBLY_SANDBOX',
        },
      }),
    );
    return {
      source: 'ACTUAL_PREMBLY_SANDBOX' as const,
      environment: 'sandbox' as const,
      operation: 'BVN_BASIC_TEST_DATA' as const,
      outcome,
      httpStatus,
      responseCode,
      testedAt: new Date().toISOString(),
    };
  }
}
