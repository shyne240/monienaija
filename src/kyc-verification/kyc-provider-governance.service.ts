import { createHash, randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { canonical } from '../authorization/workforce-crypto';
import { KycFoundationError, type IdentityKind } from './kyc.types';
import { UUID } from './kyc-orchestrator';

export type ProviderCode = 'MONNIFY' | 'SYNTHETIC';
type ProviderSetting = { enabled: boolean; capabilities: IdentityKind[] };
type Route = { primary: ProviderCode | null; fallback: ProviderCode | null };
export type ProviderConfiguration = {
  providers: Record<ProviderCode, ProviderSetting>;
  routes: Record<IdentityKind, Route>;
};
type Snapshot = { version: number; configuration: ProviderConfiguration };
type Reason = 'INITIAL_SETUP' | 'ROUTING_CHANGE' | 'PROVIDER_DISABLE';
const fingerprint = (
  requestId: string,
  version: number,
  configuration: ProviderConfiguration,
  reason: string,
  maker: string,
) =>
  createHash('sha256')
    .update(canonical({ requestId, version, configuration, reason, maker }))
    .digest('hex');
const keys = (o: unknown, names: string[]): o is Record<string, unknown> =>
  !!o &&
  typeof o === 'object' &&
  !Array.isArray(o) &&
  Object.keys(o).sort().join(',') === [...names].sort().join(',');
/** Validate both proposed and persisted data: DB contents are never trusted as runtime policy. */
export function validateProviderConfiguration(value: unknown): ProviderConfiguration {
  if (
    !keys(value, ['providers', 'routes']) ||
    !keys(value.providers, ['MONNIFY', 'SYNTHETIC']) ||
    !keys(value.routes, ['BVN', 'NIN'])
  )
    throw new KycFoundationError('INVALID');
  const providers = {} as Record<ProviderCode, ProviderSetting>;
  for (const code of ['MONNIFY', 'SYNTHETIC'] as const) {
    const p = value.providers[code];
    if (
      !keys(p, ['enabled', 'capabilities']) ||
      typeof p.enabled !== 'boolean' ||
      !Array.isArray(p.capabilities) ||
      p.capabilities.some((x) => x !== 'BVN' && x !== 'NIN') ||
      new Set(p.capabilities).size !== p.capabilities.length
    )
      throw new KycFoundationError('INVALID');
    providers[code] = {
      enabled: p.enabled,
      capabilities: (p.capabilities as IdentityKind[]).slice(),
    };
  }
  const routes = {} as Record<IdentityKind, Route>;
  for (const kind of ['BVN', 'NIN'] as const) {
    const r = value.routes[kind];
    if (
      !keys(r, ['primary', 'fallback']) ||
      ![null, 'MONNIFY', 'SYNTHETIC'].includes(r.primary as ProviderCode | null) ||
      ![null, 'MONNIFY', 'SYNTHETIC'].includes(r.fallback as ProviderCode | null) ||
      (r.primary !== null && r.primary === r.fallback) ||
      (r.primary === null && r.fallback !== null)
    )
      throw new KycFoundationError('INVALID');
    for (const code of [r.primary, r.fallback])
      if (code !== null && !providers[code as ProviderCode].capabilities.includes(kind))
        throw new KycFoundationError('INVALID');
    routes[kind] = {
      primary: r.primary as ProviderCode | null,
      fallback: r.fallback as ProviderCode | null,
    };
  }
  if (
    process.env.NODE_ENV !== 'test' &&
    (providers.SYNTHETIC.enabled ||
      providers.SYNTHETIC.capabilities.length > 0 ||
      Object.values(routes).some((r) => r.primary === 'SYNTHETIC' || r.fallback === 'SYNTHETIC'))
  )
    throw new KycFoundationError('INVALID');
  return { providers, routes };
}
/** Monnify's documented operations are candidates only; account entitlement/contracts/credentials are not established. */
export const KYC_PROVIDER_CATALOGUE = [
  {
    code: 'MONNIFY',
    candidateCapabilities: ['BVN', 'NIN'],
    confirmedCapabilities: [],
    testOnly: false,
    ready: false,
  },
  {
    code: 'SYNTHETIC',
    candidateCapabilities: ['BVN', 'NIN'],
    confirmedCapabilities: ['BVN', 'NIN'],
    testOnly: true,
    ready: true,
  },
] as const;
export class KycProviderGovernanceService {
  constructor(
    private readonly db: DataSource,
    private readonly auth: AuthorizationService,
  ) {}
  private async authorize(
    principal: AuthorizationPrincipal | undefined,
    mode: 'view' | 'propose' | 'approve',
  ): Promise<AuthorizationPrincipal> {
    const func = `kyc.provider.${mode}`;
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
        action: func,
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredFunctions: [func],
        ...(role ? { requiredRoles: [role] } : {}),
        minimumAssurance: 'MFA',
        customerAccess: 'NONE',
      },
      { type: 'KYC_PROVIDER_CONFIGURATION' },
    );
    if (!decision.allowed) throw new KycFoundationError('BLOCKED');
    return principal;
  }
  private async snapshot(m: EntityManager, lock: 'SHARE' | 'UPDATE'): Promise<Snapshot> {
    const rows = await m.query<Array<{ version: number; configuration: unknown }>>(
      `SELECT version,configuration FROM kyc_provider_configuration WHERE singleton=true FOR ${lock}`,
    );
    if (!rows[0] || !Number.isSafeInteger(rows[0].version) || rows[0].version < 0)
      throw new KycFoundationError('DISABLED');
    return {
      version: rows[0].version,
      configuration: validateProviderConfiguration(rows[0].configuration),
    };
  }
  async view(principal: AuthorizationPrincipal | undefined) {
    await this.authorize(principal, 'view');
    return this.db.transaction(async (m) => ({
      ...(await this.snapshot(m, 'SHARE')),
      catalogue: KYC_PROVIDER_CATALOGUE.map((item) => ({
        ...item,
        ready: item.code === 'SYNTHETIC' && process.env.NODE_ENV === 'test',
      })),
    }));
  }
  async history(principal: AuthorizationPrincipal | undefined) {
    await this.authorize(principal, 'view');
    const rows = await this.db.query<
      Array<{
        version: number;
        proposal_id: string;
        configuration: unknown;
        maker_id: string;
        checker_id: string;
        reason_code: string;
        applied_at: Date;
      }>
    >(
      'SELECT version,proposal_id,configuration,maker_id,checker_id,reason_code,applied_at FROM kyc_provider_configuration_history ORDER BY version DESC LIMIT 100',
    );
    return rows.map((row) => ({
      ...row,
      configuration: validateProviderConfiguration(row.configuration),
    }));
  }
  async proposals(principal: AuthorizationPrincipal | undefined) {
    await this.authorize(principal, 'view');
    const rows = await this.db.query<
      Array<{
        id: string;
        request_id: string;
        expected_version: number;
        configuration: unknown;
        reason_code: string;
        maker_id: string;
        state: string;
        created_at: Date;
        expires_at: Date;
      }>
    >(
      'SELECT id,request_id,expected_version,configuration,reason_code,maker_id,state,created_at,expires_at FROM kyc_provider_change_proposals ORDER BY created_at DESC LIMIT 100',
    );
    return rows.map((row) => ({
      ...row,
      configuration: validateProviderConfiguration(row.configuration),
    }));
  }
  async propose(
    principal: AuthorizationPrincipal | undefined,
    command: { requestId: string; expectedVersion: number; configuration: unknown; reason: Reason },
  ): Promise<{ id: string; replay: boolean }> {
    const actor = await this.authorize(principal, 'propose');
    if (
      !UUID.test(command.requestId) ||
      !Number.isSafeInteger(command.expectedVersion) ||
      command.expectedVersion < 0 ||
      !['INITIAL_SETUP', 'ROUTING_CHANGE', 'PROVIDER_DISABLE'].includes(command.reason)
    )
      throw new KycFoundationError('INVALID');
    const configuration = validateProviderConfiguration(command.configuration);
    return this.db.transaction(async (m) => {
      const current = await this.snapshot(m, 'UPDATE');
      const prior = await m.query<
        Array<{
          id: string;
          maker_id: string;
          expected_version: number;
          configuration: unknown;
          reason_code: string;
        }>
      >(
        'SELECT id,maker_id,expected_version,configuration,reason_code FROM kyc_provider_change_proposals WHERE request_id=$1 FOR UPDATE',
        [command.requestId],
      );
      if (prior[0]) {
        const p = prior[0];
        if (
          p.maker_id !== actor.principalId ||
          p.expected_version !== command.expectedVersion ||
          p.reason_code !== command.reason ||
          canonical(p.configuration) !== canonical(configuration)
        )
          throw new KycFoundationError('CONFLICT');
        return { id: p.id, replay: true };
      }
      if (current.version !== command.expectedVersion) throw new KycFoundationError('CONFLICT');
      const id = randomUUID();
      await m.query(
        `INSERT INTO kyc_provider_change_proposals(id,request_id,expected_version,configuration,reason_code,maker_id,maker_session_id,fingerprint,state) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,'REQUESTED')`,
        [
          id,
          command.requestId,
          command.expectedVersion,
          JSON.stringify(configuration),
          command.reason,
          actor.principalId,
          actor.sessionId,
          fingerprint(
            command.requestId,
            command.expectedVersion,
            configuration,
            command.reason,
            actor.principalId,
          ),
        ],
      );
      return { id, replay: false };
    });
  }
  async decide(
    principal: AuthorizationPrincipal | undefined,
    id: string,
    approve: boolean,
  ): Promise<{ version: number; state: 'APPROVED' | 'REJECTED' }> {
    const actor = await this.authorize(principal, 'approve');
    if (!UUID.test(id) || typeof approve !== 'boolean') throw new KycFoundationError('INVALID');
    return this.db.transaction(async (m) => {
      const current = await this.snapshot(m, 'UPDATE');
      const rows = await m.query<
        Array<{
          id: string;
          expected_version: number;
          configuration: unknown;
          request_id: string;
          fingerprint: string;
          maker_id: string;
          state: string;
          reason_code: Reason;
          live: boolean;
        }>
      >(
        `SELECT id,request_id,expected_version,configuration,fingerprint,maker_id,state,reason_code,(expires_at>clock_timestamp()) AS live FROM kyc_provider_change_proposals WHERE id=$1 FOR UPDATE`,
        [id],
      );
      const proposal = rows[0];
      if (!proposal) throw new KycFoundationError('NOT_FOUND');
      if (
        proposal.state !== 'REQUESTED' ||
        !proposal.live ||
        current.version !== proposal.expected_version
      )
        throw new KycFoundationError('CONFLICT');
      if (proposal.maker_id === actor.principalId) throw new KycFoundationError('BLOCKED');
      const config = validateProviderConfiguration(proposal.configuration);
      if (
        proposal.fingerprint !==
        fingerprint(
          proposal.request_id,
          proposal.expected_version,
          config,
          proposal.reason_code,
          proposal.maker_id,
        )
      )
        throw new KycFoundationError('CONFLICT');
      const state = approve ? 'APPROVED' : 'REJECTED';
      await m.query(
        'UPDATE kyc_provider_change_proposals SET state=$1,checker_id=$2,checker_session_id=$3,decided_at=clock_timestamp() WHERE id=$4',
        [state, actor.principalId, actor.sessionId, id],
      );
      if (!approve) return { version: current.version, state };
      const version = current.version + 1;
      await m.query(
        'UPDATE kyc_provider_configuration SET version=$1,configuration=$2::jsonb,updated_at=clock_timestamp() WHERE singleton=true',
        [version, JSON.stringify(config)],
      );
      await m.query(
        'INSERT INTO kyc_provider_configuration_history(version,proposal_id,configuration,maker_id,checker_id,reason_code) VALUES($1,$2,$3::jsonb,$4,$5,$6)',
        [
          version,
          id,
          JSON.stringify(config),
          proposal.maker_id,
          actor.principalId,
          proposal.reason_code,
        ],
      );
      return { version, state };
    });
  }
  /** Select only a pre-dispatch eligible provider. Never fallback after an invoked request. */
  async resolve(kind: IdentityKind): Promise<{ provider: ProviderCode; version: number }> {
    return this.db.transaction((m) => this.resolveIn(m, kind));
  }
  async resolveIn(
    m: EntityManager,
    kind: IdentityKind,
    expectedVersion?: number,
    expectedProvider?: ProviderCode,
  ): Promise<{ provider: ProviderCode; version: number }> {
    if (!['BVN', 'NIN'].includes(kind)) throw new KycFoundationError('INVALID');
    const snap = await this.snapshot(m, 'SHARE');
    if (expectedVersion !== undefined && expectedVersion !== snap.version)
      throw new KycFoundationError('BLOCKED');
    const route = snap.configuration.routes[kind];
    for (const code of [route.primary, route.fallback]) {
      if (!code) continue;
      const item = snap.configuration.providers[code];
      if (!item.enabled || !item.capabilities.includes(kind)) continue;
      // Monnify account access, endpoint contract and credentials are unconfirmed. Do not dispatch.
      if (code === 'MONNIFY') continue;
      if (code === 'SYNTHETIC' && process.env.NODE_ENV !== 'test') continue;
      if (expectedProvider && code !== expectedProvider) throw new KycFoundationError('BLOCKED');
      return { provider: code, version: snap.version };
    }
    throw new KycFoundationError('DISABLED');
  }
}
