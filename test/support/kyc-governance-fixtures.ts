import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';

import type { AuthorizationService } from '../../src/authorization/authorization.service';
import type { AuthorizationPrincipal } from '../../src/authorization/authorization.types';
import { ProtectedAuthorityService } from '../../src/authorization/protected-authority.service';
import type { Environment } from '../../src/config/environment';
import { InstitutionKycLimitPolicyService } from '../../src/limit-catalog/institution-kyc-limit-policy.service';
import {
  KycProviderGovernanceService,
  type ProviderConfiguration,
} from '../../src/kyc-verification/kyc-provider-governance.service';
import { KycTierPolicyService } from '../../src/kyc-verification/kyc-tier-policy.service';
import type { IsolatedKycCluster } from './kyc-isolated-cluster';
import { createKycAuthorityConnections } from './kyc-isolated-authority';
import { createKycAuthorityConnectionsOverTcp } from './kyc-authority-tcp';

// These principals are test-only fixture actors. Authorization is mocked at this helper boundary;
// maker/checker separation, MFA-bound decision evidence and state transitions still pass through
// the production governance services and PostgreSQL protected-authority triggers.
const maker: AuthorizationPrincipal = {
  type: 'PRIVILEGED',
  principalId: 'isolated-kyc-fixture-maker',
  sessionId: randomUUID(),
  roles: ['SUPER_ADMIN'],
  scopes: ['kyc.policy.propose', 'kyc.provider.propose'],
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
};
const checker: AuthorizationPrincipal = {
  type: 'OPERATOR',
  principalId: 'isolated-kyc-fixture-checker',
  sessionId: randomUUID(),
  roles: ['COMPLIANCE'],
  scopes: ['kyc.policy.approve', 'kyc.provider.approve'],
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
};
const fixtureAuthorization = {
  authorize: () => Promise.resolve({ allowed: true }),
} as unknown as AuthorizationService;

/** Seed an approved policy via the real maker/checker path, never by inserting APPROVED rows. */
export async function approveIsolatedKycTierPolicy(
  admin: DataSource,
  cluster: IsolatedKycCluster,
  definition: unknown,
): Promise<number> {
  const connections = await createKycAuthorityConnections(admin, cluster, 'public');
  try {
    const authority = new ProtectedAuthorityService(connections.runtime, connections.authority);
    const governance = new KycTierPolicyService(
      connections.runtime,
      fixtureAuthorization,
      authority,
    );
    const proposal = await governance.propose(maker, {
      requestId: randomUUID(),
      expectedVersion: 0,
      definition,
    });
    const result = await governance.decide(checker, proposal.id, true);
    return result.version;
  } finally {
    await connections.cleanup();
  }
}

export const ISOLATED_SYNTHETIC_KYC_CONFIGURATION = {
  providers: {
    MONNIFY: { enabled: false, capabilities: [] },
    DOJAH: { enabled: false, capabilities: [] },
    PREMBLY: { enabled: false, capabilities: [] },
    SYNTHETIC: { enabled: true, capabilities: ['BVN', 'NIN'] },
  },
  routes: {
    BVN: { primary: 'SYNTHETIC', fallback: null },
    NIN: { primary: 'SYNTHETIC', fallback: null },
    ADDRESS_VERIFICATION: { primary: null, fallback: null },
    ENHANCED_DUE_DILIGENCE: { primary: null, fallback: null },
  },
} satisfies ProviderConfiguration;

/** Configure a test-only provider route through versioned, protected maker/checker governance. */
export async function approveIsolatedKycProviderConfiguration(
  admin: DataSource,
  cluster: IsolatedKycCluster,
  configuration: ProviderConfiguration,
): Promise<number> {
  const connections = await createKycAuthorityConnections(admin, cluster, 'public');
  try {
    const authority = new ProtectedAuthorityService(connections.runtime, connections.authority);
    const governance = new KycProviderGovernanceService(
      connections.runtime,
      fixtureAuthorization,
      authority,
    );
    const current = await governance.view(maker);
    const proposal = await governance.propose(maker, {
      requestId: randomUUID(),
      expectedVersion: current.version,
      configuration,
      reason: current.version === 0 ? 'INITIAL_SETUP' : 'ROUTING_CHANGE',
    });
    const result = await governance.decide(checker, proposal.id, true);
    return result.version;
  } finally {
    await connections.cleanup();
  }
}

/**
 * Synthetic-only strict admission fixture: one test profile/rule and an institution-scoped
 * tier-to-profile mapping are created through the real protected policy service. The deliberately
 * large rule value is isolated acceptance data, not an operational or production threshold.
 */
export async function approveIsolatedInstitutionKycTierLimitPolicy(
  admin: DataSource,
  cluster: IsolatedKycCluster,
  institutionId: string,
  product = 'WALLET_TO_CASH',
): Promise<number> {
  const effectiveFrom = '2000-01-01T00:00:00.000Z';
  const profileCode = 'KYC_TEST_GLOBAL';
  await admin.query(
    `INSERT INTO limit_profiles(code,name,description,kind,status,enabled,configuration_status,created_by)
     VALUES($1,'Isolated KYC acceptance profile','Synthetic acceptance-only profile','UNIVERSAL','ACTIVE',true,'CONFIGURED','isolated-kyc-test')
     ON CONFLICT(code) DO NOTHING`,
    [profileCode],
  );
  await admin.query(
    `INSERT INTO limit_rules(id,limit_profile_code,product,direction,channel,currency,dimension,limit_value_minor,limit_value_count,effective_from,effective_to,is_active,priority,created_by)
     VALUES($1,$2,$3,'BOTH',NULL,'NGN','MAX_AMOUNT_PER_TX',9000000000000000,NULL,$4,NULL,true,0,'isolated-kyc-test')
     ON CONFLICT DO NOTHING`,
    [randomUUID(), profileCode, product, effectiveFrom],
  );
  await admin.query(
    `INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,segment_code,precedence,effective_from,effective_to,is_active,created_by)
     VALUES($1,$2,'GLOBAL',NULL,NULL,0,$3,NULL,true,'isolated-kyc-test')
     ON CONFLICT DO NOTHING`,
    [randomUUID(), profileCode, effectiveFrom],
  );

  const connections = await createKycAuthorityConnections(admin, cluster, 'public');
  try {
    const authority = new ProtectedAuthorityService(connections.runtime, connections.authority);
    const testConfig = { get: () => true } as unknown as ConfigService<Environment, true>;
    const governance = new InstitutionKycLimitPolicyService(
      connections.runtime,
      fixtureAuthorization,
      authority,
      testConfig,
    );
    const current = await governance.view(maker, institutionId);
    const definition = {
      schemaVersion: 1,
      enabled: true,
      effectiveFrom,
      effectiveUntil: null,
      mappings: (['LEVEL_1', 'LEVEL_2', 'LEVEL_3'] as const).map((tier) => ({
        product,
        currency: 'NGN',
        serviceClass: null,
        tier,
        disposition: 'PROFILE' as const,
        profileCode,
      })),
    };
    const proposal = await governance.propose(maker, {
      institutionId,
      requestId: randomUUID(),
      expectedVersion: current.currentVersion,
      definition,
      reason: 'Synthetic isolated acceptance policy for tier-bound transaction admission',
    });
    const result = await governance.decide(checker, institutionId, proposal.id, true);
    return result.version;
  } finally {
    await connections.cleanup();
  }
}

/**
 * TCP variant for the shared `test:pg` cluster.
 *
 * `approveIsolatedInstitutionKycTierLimitPolicy` is bound to the socket-only isolated cluster. The
 * main integration matrix runs on loopback TCP, so suites that need a real institution-scoped
 * tier-to-limit mapping (for example the Wallet->Wallet PIN suite, whose admission is tier-bound)
 * use this instead. The policy still goes through the same protected maker/checker services.
 *
 * `profileCode` / rule value are caller-supplied acceptance data. They are NOT operational
 * thresholds: the deliberately large default exists only so an unrelated financial test is not
 * constrained by an invented monetary policy.
 */
export async function approveTcpInstitutionKycTierLimitPolicy(
  admin: DataSource,
  institutionId: string,
  options: {
    product: string;
    profileCode: string;
    currency?: string;
    perTransactionMinor?: string;
    tiers?: ReadonlyArray<'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3'>;
  },
): Promise<number> {
  const effectiveFrom = '2000-01-01T00:00:00.000Z';
  const currency = options.currency ?? 'NGN';
  const tiers = options.tiers ?? (['LEVEL_1', 'LEVEL_2', 'LEVEL_3'] as const);
  await admin.query(
    `INSERT INTO limit_profiles(code,name,description,kind,status,enabled,configuration_status,created_by)
     VALUES($1,$2,'Synthetic acceptance-only profile','UNIVERSAL','ACTIVE',true,'CONFIGURED','integration-harness')
     ON CONFLICT(code) DO NOTHING`,
    [options.profileCode, `Synthetic acceptance profile ${options.profileCode}`],
  );
  const existingRules = await admin.query<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM limit_rules WHERE limit_profile_code=$1`,
    [options.profileCode],
  );
  if ((existingRules[0]?.n ?? 0) === 0) {
    await admin.query(
      `INSERT INTO limit_rules(id,limit_profile_code,product,direction,channel,currency,dimension,limit_value_minor,limit_value_count,effective_from,effective_to,is_active,priority,created_by)
       VALUES($1,$2,$3,'BOTH',NULL,$4,'MAX_AMOUNT_PER_TX',$5,NULL,$6,NULL,true,0,'integration-harness')`,
      [
        randomUUID(),
        options.profileCode,
        options.product,
        currency,
        options.perTransactionMinor ?? '9000000000000000',
        effectiveFrom,
      ],
    );
  }
  const existingAssignments = await admin.query<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM limit_assignments WHERE limit_profile_code=$1`,
    [options.profileCode],
  );
  if ((existingAssignments[0]?.n ?? 0) === 0) {
    await admin.query(
      `INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,segment_code,precedence,effective_from,effective_to,is_active,created_by)
       VALUES($1,$2,'GLOBAL',NULL,NULL,0,$3,NULL,true,'integration-harness')`,
      [randomUUID(), options.profileCode, effectiveFrom],
    );
  }

  const connections = await createKycAuthorityConnectionsOverTcp(admin);
  try {
    const authority = new ProtectedAuthorityService(connections.runtime, connections.authority);
    const testConfig = { get: () => true } as unknown as ConfigService<Environment, true>;
    const governance = new InstitutionKycLimitPolicyService(
      connections.runtime,
      fixtureAuthorization,
      authority,
      testConfig,
    );
    const current = await governance.view(maker, institutionId);
    const definition = {
      schemaVersion: 1,
      enabled: true,
      effectiveFrom,
      effectiveUntil: null,
      mappings: tiers.map((tier) => ({
        product: options.product,
        currency,
        serviceClass: null,
        tier,
        disposition: 'PROFILE' as const,
        profileCode: options.profileCode,
      })),
    };
    const proposal = await governance.propose(maker, {
      institutionId,
      requestId: randomUUID(),
      expectedVersion: current.currentVersion,
      definition,
      reason: 'Synthetic integration policy for tier-bound transaction admission',
    });
    const decided = await governance.decide(checker, institutionId, proposal.id, true);
    return decided.version;
  } finally {
    await connections.cleanup();
  }
}
