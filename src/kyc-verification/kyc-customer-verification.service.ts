import { createHmac } from 'node:crypto';
import {
  KycFoundationError,
  type Attempt,
  type IdentityDetails,
  type KycPolicy,
  type KycProvider,
} from './kyc.types';
import type { DataSource } from 'typeorm';
import type { CustomerSessionValidator } from '../customer-authentication/authentication-session.types';
import { DEFAULT_SESSION_AUDIENCE } from '../customer-authentication/authentication-session.service';
import type { KycProviderGovernanceService } from './kyc-provider-governance.service';
import { KycOrchestrator, UUID } from './kyc-orchestrator';
import { assertPolicy } from './kyc-policy';
import { PostgresKycStore } from './postgres-kyc.store';
import { CUSTOMER_ONBOARDING_AUDIENCE } from './kyc-customer-session-validator';
import type { KycTierPolicyService } from './kyc-tier-policy.service';
import type { KycTierEvidenceReader } from './kyc-tier-evidence.reader';
import { decideTier, tier3HasAdditionalRequirement } from './kyc-tier-decision';

type Audience = typeof DEFAULT_SESSION_AUDIENCE | typeof CUSTOMER_ONBOARDING_AUDIENCE;
export interface CustomerKycVerificationConfiguration {
  enabled: boolean;
  policy: KycPolicy | null;
  consentNoticeVersion: string | null;
  consentNoticeText: string | null;
  consentValiditySeconds: number | null;
  ownershipKey: Buffer | null;
  ownershipKeyVersion: string | null;
}
type IdentityContext = {
  customerId: string;
  identityRevision: string;
  identity: IdentityDetails;
};

/**
 * Customer-initiated, consent-bound verification and upgrade workflow. The customer only supplies
 * an identity number and consent reference; name, date of birth, phone, audience, provider, route
 * version, and identity revision are resolved by trusted server-side services. The onboarding
 * audience is a narrowly validated 15-minute capability used only on these explicit KYC endpoints;
 * it never grants general customer or financial access.
 */
export class KycCustomerVerificationService {
  private readonly store: PostgresKycStore;

  constructor(
    private readonly db: DataSource,
    private readonly sessions: CustomerSessionValidator,
    private readonly governance: KycProviderGovernanceService,
    private readonly providers: readonly KycProvider[],
    private readonly configuration: CustomerKycVerificationConfiguration,
    private readonly tierPolicies: KycTierPolicyService,
    private readonly evidenceReader: KycTierEvidenceReader,
  ) {
    this.store = new PostgresKycStore(db, sessions);
  }

  private audience(value: string): Audience {
    if (value !== DEFAULT_SESSION_AUDIENCE && value !== CUSTOMER_ONBOARDING_AUDIENCE)
      throw new KycFoundationError('BLOCKED');
    return value;
  }

  private policy(): { policy: KycPolicy; consentSeconds: number; ownershipKey: Buffer } {
    const c = this.configuration;
    if (
      c.enabled !== true ||
      !c.policy ||
      c.policy.enabled !== true ||
      !c.consentNoticeVersion ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(c.consentNoticeVersion) ||
      typeof c.consentNoticeText !== 'string' ||
      c.consentNoticeText.trim().length < 20 ||
      c.consentNoticeText.length > 10000 ||
      typeof c.consentValiditySeconds !== 'number' ||
      !Number.isSafeInteger(c.consentValiditySeconds) ||
      c.consentValiditySeconds < c.policy.evidenceValiditySeconds ||
      c.consentValiditySeconds > 31536000 ||
      !Buffer.isBuffer(c.ownershipKey) ||
      c.ownershipKey.length < 32 ||
      !c.ownershipKeyVersion ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(c.ownershipKeyVersion)
    )
      throw new KycFoundationError('DISABLED');
    assertPolicy(c.policy);
    return {
      policy: { ...c.policy },
      consentSeconds: c.consentValiditySeconds,
      ownershipKey: Buffer.from(c.ownershipKey),
    };
  }

  private async authenticatedCustomerId(token: string, audienceValue: string): Promise<string> {
    const audience = this.audience(audienceValue);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new KycFoundationError('BLOCKED');
    return this.db.transaction(async (m) => {
      const validation = await this.sessions.validateInManager(m, {
        token,
        audience,
        mode: 'READ',
      });
      const customerId = validation.principal?.customerId;
      if (!validation.valid || !customerId || !UUID.test(customerId))
        throw new KycFoundationError('BLOCKED');
      const rows = await m.query<Array<{ status: string; is_synthetic: boolean }>>(
        'SELECT status,is_synthetic FROM customers WHERE id=$1 AND deleted_at IS NULL',
        [customerId],
      );
      if (!rows[0] || rows[0].is_synthetic || !['DRAFT', 'ACTIVE'].includes(rows[0].status))
        throw new KycFoundationError('BLOCKED');
      return customerId;
    });
  }

  private async identityContext(token: string, audienceValue: string): Promise<IdentityContext> {
    const audience = this.audience(audienceValue);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new KycFoundationError('BLOCKED');
    return this.db.transaction(async (m) => {
      const validation = await this.sessions.validateInManager(m, {
        token,
        audience,
        mode: 'READ',
      });
      const customerId = validation.principal?.customerId;
      if (!validation.valid || !customerId || !UUID.test(customerId))
        throw new KycFoundationError('BLOCKED');
      const revisions = await m.query<Array<{ revision: string }>>(
        'SELECT revision::text AS revision FROM kyc_customer_identity_revisions WHERE customer_id=$1 FOR SHARE',
        [customerId],
      );
      const customers = await m.query<
        Array<{ id: string; status: string; is_synthetic: boolean; customer_type: string }>
      >(
        'SELECT id,status,is_synthetic,customer_type FROM customers WHERE id=$1 AND deleted_at IS NULL',
        [customerId],
      );
      const profiles = await m.query<
        Array<{ first_name: string | null; last_name: string | null; date_of_birth: string | null }>
      >(
        `SELECT first_name,last_name,date_of_birth::text AS date_of_birth FROM customer_profiles
         WHERE customer_id=$1 AND is_active=true AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 2`,
        [customerId],
      );
      const phones = await m.query<Array<{ phone: string; verified_at: Date | null }>>(
        `SELECT normalized_value AS phone,verified_at FROM customer_contact_methods
         WHERE customer_id=$1 AND type='PHONE' AND is_primary=true AND deleted_at IS NULL
         ORDER BY updated_at DESC LIMIT 2`,
        [customerId],
      );
      const customer = customers[0];
      const profile = profiles[0];
      const phone = phones[0]?.phone;
      const identityRevision = revisions[0]?.revision;
      if (
        !customer ||
        customer.customer_type !== 'INDIVIDUAL' ||
        customer.is_synthetic ||
        !['DRAFT', 'ACTIVE'].includes(customer.status) ||
        profiles.length !== 1 ||
        !profile?.first_name ||
        !profile.last_name ||
        !profile.date_of_birth ||
        phones.length !== 1 ||
        !phones[0]?.verified_at ||
        !phone ||
        !/^\+?\d{7,15}$/.test(phone) ||
        !identityRevision ||
        !/^[1-9][0-9]{0,18}$/.test(identityRevision)
      )
        throw new KycFoundationError('BLOCKED');
      return {
        customerId,
        identityRevision,
        identity: {
          firstName: profile.first_name,
          lastName: profile.last_name,
          dateOfBirth: profile.date_of_birth,
          phone,
        },
      };
    });
  }

  private async providerRoute(kind: 'BVN' | 'NIN') {
    const route = await this.governance.resolve(kind);
    if (
      !['MONNIFY', 'DOJAH'].includes(route.provider) ||
      !this.providers.some((candidate) => candidate.code === route.provider)
    )
      throw new KycFoundationError('DISABLED');
    return route;
  }

  async status(token: string, audienceValue: string) {
    const customerId = await this.authenticatedCustomerId(token, audienceValue);
    const snapshot = await this.db.transaction(async (m) => {
      const rows = await m.query<Array<{ status: string; kyc_level: string; kyc_status: string }>>(
        'SELECT status,kyc_level,kyc_status FROM customers WHERE id=$1 AND deleted_at IS NULL',
        [customerId],
      );
      if (!rows[0]) throw new KycFoundationError('NOT_FOUND');
      const now = (await m.query<Array<{ now: Date }>>('SELECT clock_timestamp() AS now'))[0]!.now;
      const policy = await this.tierPolicies.effective(m, now);
      const evidence = await this.evidenceReader.read(m, customerId);
      const decision =
        policy && evidence
          ? decideTier({
              customerId,
              identityRevision: evidence.identityRevision,
              now,
              policy,
              evidence: evidence.evidence,
            })
          : null;
      const tier =
        rows[0].kyc_level === 'NONE'
          ? 'LEVEL_1'
          : rows[0].kyc_level === 'LEVEL_1'
            ? 'LEVEL_2'
            : rows[0].kyc_level === 'LEVEL_2'
              ? 'LEVEL_3'
              : null;
      const requirements =
        policy && tier && (tier !== 'LEVEL_3' || tier3HasAdditionalRequirement(policy))
          ? {
              level: tier,
              regulatory: policy.regulatory[tier],
              operator: policy.operator[tier],
            }
          : null;
      return {
        customer: {
          status: rows[0].status,
          kycLevel: rows[0].kyc_level,
          kycStatus: rows[0].kyc_status,
        },
        policy: { configured: policy !== null, version: policy?.version ?? null },
        requirements,
        candidateAssessment: {
          status: decision?.status ?? (evidence ? 'NOT_CONFIGURED' : 'UNAVAILABLE'),
          level: decision?.highestTier ?? null,
          reason:
            decision?.reason ??
            (evidence ? 'POLICY_NOT_EFFECTIVE_OR_APPROVED' : 'TRUSTED_EVIDENCE_UNAVAILABLE'),
        },
      };
    });
    const history = await this.store.listHistory(customerId, 20);
    const consents = await this.db.query<
      Array<{
        id: string;
        kind: 'BVN' | 'NIN';
        notice_version: string;
        provider: 'MONNIFY' | 'DOJAH';
        route_version: number;
        expires_at: Date;
      }>
    >(
      `SELECT id,kind,notice_version,provider,route_version,expires_at
       FROM kyc_consents WHERE customer_id=$1 AND provider IN ('MONNIFY','DOJAH')
         AND route_version IS NOT NULL AND withdrawn_at IS NULL AND expires_at>clock_timestamp()
       ORDER BY granted_at DESC LIMIT 20`,
      [customerId],
    );
    const notice =
      this.configuration.consentNoticeVersion && this.configuration.consentNoticeText
        ? {
            version: this.configuration.consentNoticeVersion,
            text: this.configuration.consentNoticeText,
          }
        : null;
    return {
      ...snapshot,
      consentNotice: notice,
      verificationEnabled: this.configuration.enabled === true,
      consents: consents.map((consent) => ({
        id: consent.id,
        kind: consent.kind,
        noticeVersion: consent.notice_version,
        provider: consent.provider,
        routeVersion: consent.route_version,
        expiresAt: consent.expires_at.toISOString(),
      })),
      history: history.map((attempt) => this.projectHistory(attempt)),
    };
  }

  async availability(token: string, audienceValue: string, kind: 'BVN' | 'NIN') {
    if (!['BVN', 'NIN'].includes(kind)) throw new KycFoundationError('INVALID');
    await this.identityContext(token, audienceValue);
    const notice =
      this.configuration.consentNoticeVersion && this.configuration.consentNoticeText
        ? {
            version: this.configuration.consentNoticeVersion,
            text: this.configuration.consentNoticeText,
          }
        : null;
    try {
      this.policy();
      const route = await this.providerRoute(kind);
      return {
        status: 'AVAILABLE' as const,
        provider: route.provider,
        routeVersion: route.version,
        consentNotice: notice,
      };
    } catch {
      return {
        status: 'CONFIGURATION_INCOMPLETE' as const,
        provider: null,
        routeVersion: null,
        consentNotice: notice,
      };
    }
  }

  async grantConsent(command: {
    token: string;
    audience: string;
    requestId: string;
    kind: 'BVN' | 'NIN';
    noticeVersion: string;
    accepted: boolean;
    expectedProvider: 'MONNIFY' | 'DOJAH';
    expectedRouteVersion: number;
  }): Promise<{
    id: string;
    expiresAt: string;
    provider: string;
    routeVersion: number;
  }> {
    const { consentSeconds } = this.policy();
    if (
      !UUID.test(command.requestId) ||
      !['BVN', 'NIN'].includes(command.kind) ||
      command.accepted !== true ||
      command.noticeVersion !== this.configuration.consentNoticeVersion ||
      !['MONNIFY', 'DOJAH'].includes(command.expectedProvider) ||
      !Number.isSafeInteger(command.expectedRouteVersion) ||
      command.expectedRouteVersion < 1
    )
      throw new KycFoundationError('INVALID');
    const context = await this.identityContext(command.token, command.audience);
    const route = await this.providerRoute(command.kind);
    if (
      route.provider !== command.expectedProvider ||
      route.version !== command.expectedRouteVersion
    )
      throw new KycFoundationError('CONFLICT');
    const requestedExpiry = new Date(Date.now() + consentSeconds * 1000);
    const id = await this.store.grantConsent({
      customerId: context.customerId,
      sessionToken: command.token,
      kind: command.kind,
      noticeVersion: command.noticeVersion,
      expiresAt: requestedExpiry,
      requestId: command.requestId,
      provider: route.provider,
      routeVersion: route.version,
      identityRevision: context.identityRevision,
      audience: command.audience,
    });
    const consents = await this.db.query<Array<{ expires_at: Date }>>(
      'SELECT expires_at FROM kyc_consents WHERE id=$1 AND customer_id=$2',
      [id, context.customerId],
    );
    if (!consents[0]) throw new KycFoundationError('BLOCKED');
    return {
      id,
      expiresAt: consents[0].expires_at.toISOString(),
      provider: route.provider,
      routeVersion: route.version,
    };
  }

  async withdrawConsent(command: {
    token: string;
    audience: string;
    consentId: string;
  }): Promise<void> {
    this.audience(command.audience);
    if (!UUID.test(command.consentId)) throw new KycFoundationError('INVALID');
    const customerId = await this.authenticatedCustomerId(command.token, command.audience);
    await this.store.withdrawConsent(
      customerId,
      command.consentId,
      command.token,
      command.audience,
    );
  }

  async verify(command: {
    token: string;
    audience: string;
    requestId: string;
    consentId: string;
    kind: 'BVN' | 'NIN';
    identifier: string;
  }): Promise<{ id: string; status: string; provider: string; expiresAt: string | null }> {
    const { policy, ownershipKey } = this.policy();
    if (
      !UUID.test(command.requestId) ||
      !UUID.test(command.consentId) ||
      !['BVN', 'NIN'].includes(command.kind) ||
      !/^\d{11}$/.test(command.identifier)
    )
      throw new KycFoundationError('INVALID');
    const audience = this.audience(command.audience);
    const context = await this.identityContext(command.token, audience);
    const consents = await this.db.query<
      Array<{
        kind: string;
        provider: string | null;
        route_version: number | null;
        identity_revision: string | null;
        usable: boolean;
      }>
    >(
      `SELECT kind,provider,route_version,identity_revision::text AS identity_revision,
        (session_id IS NOT NULL AND withdrawn_at IS NULL AND expires_at>clock_timestamp()) AS usable
       FROM kyc_consents WHERE id=$1 AND customer_id=$2`,
      [command.consentId, context.customerId],
    );
    const consent = consents[0];
    if (
      !consent ||
      !consent.usable ||
      consent.kind !== command.kind ||
      !consent.provider ||
      !consent.route_version
    )
      throw new KycFoundationError('BLOCKED');
    if (consent.identity_revision !== context.identityRevision)
      throw new KycFoundationError('CONFLICT');
    const route = await this.providerRoute(command.kind);
    if (consent.provider !== route.provider || consent.route_version !== route.version)
      throw new KycFoundationError('CONFLICT');
    const provider = this.providers.find((candidate) => candidate.code === route.provider);
    if (!provider) throw new KycFoundationError('DISABLED');
    const sessionMacKey = createHmac('sha256', command.token)
      .update('kyc-customer-request-v1')
      .digest();
    const orchestrator = new KycOrchestrator(
      this.store,
      provider,
      policy,
      sessionMacKey,
      'customer-session-v1',
      ownershipKey,
      this.configuration.ownershipKeyVersion!,
      {
        assert: async (providerCode, kind) => {
          const current = await this.governance.resolve(kind);
          if (current.version !== route.version || current.provider !== providerCode)
            throw new KycFoundationError('BLOCKED');
        },
      },
    );
    const attempt = await orchestrator.verify({
      customerId: context.customerId,
      consentId: command.consentId,
      requestId: command.requestId,
      sessionToken: command.token,
      audience,
      identityRevision: context.identityRevision,
      providerRouteVersion: route.version,
      input: {
        kind: command.kind,
        identifier: command.identifier,
        identity: context.identity,
      },
    });
    return {
      id: attempt.id,
      status: attempt.outcome,
      provider: attempt.provider,
      expiresAt: attempt.expiresAt?.toISOString() ?? null,
    };
  }

  private projectHistory(attempt: Attempt) {
    return {
      id: attempt.id,
      kind: attempt.kind,
      provider: attempt.provider,
      status: attempt.outcome,
      createdAt: attempt.createdAt.toISOString(),
      completedAt: attempt.completedAt?.toISOString() ?? null,
      expiresAt: attempt.expiresAt?.toISOString() ?? null,
    };
  }
}
