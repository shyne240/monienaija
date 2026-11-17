import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BankingProviderRegistry } from './banking-provider.registry';
import type { BankingCapabilityKey } from './banking-provider.types';

/**
 * Readiness, stated honestly.
 *
 * A registered adapter is code. It is not an approved provider, not an institution arrangement, not
 * a credential, and emphatically not commercial entitlement. Those are five different facts and this
 * service keeps them apart, because the failure mode of collapsing them is a system that quietly
 * starts moving real money the moment someone deploys a file.
 *
 * The seven states, in the order they are established:
 *
 * | state        | established by                                     | inferable from code? |
 * | ------------ | -------------------------------------------------- | -------------------- |
 * | IMPLEMENTED  | the adapter implements the capability method        | yes                  |
 * | APPROVED     | an approved governance version names the provider   | no — requires a decision |
 * | CREDENTIALED | the configured secret references resolve            | no                   |
 * | OPERATIONAL  | an operator asserted operational readiness           | no                   |
 * | ENTITLED     | the provider's commercial contract covers it        | **never**            |
 * | DISABLED     | an open disengagement record exists                 | no                   |
 * | UNSUPPORTED  | no adapter method, or deliberately refused          | yes                  |
 *
 * `ENTITLED` is always reported as `UNKNOWN` from this codebase. There is no field anywhere that
 * records a commercial agreement, and inventing one would be worse than leaving it unknown because it
 * would read as evidence.
 */

export type ReadinessState =
  | 'IMPLEMENTED_NOT_APPROVED'
  | 'APPROVED_NOT_CREDENTIALED'
  | 'CREDENTIALED_NOT_OPERATIONAL'
  | 'DISABLED'
  | 'OPERATIONAL_BUT_ENTITLEMENT_UNCONFIRMED'
  | 'UNSUPPORTED'
  | 'NOT_REGISTERED';

export interface CapabilityReadiness {
  readonly capability: BankingCapabilityKey;
  readonly implemented: boolean;
  readonly approved: boolean;
  readonly credentialed: boolean;
  readonly operational: boolean;
  readonly disabled: boolean;
  readonly entitled: 'UNKNOWN';
  readonly state: ReadinessState;
  /** True only when every locally-knowable condition holds. Still not entitlement. */
  readonly usable: boolean;
}

export interface ProviderReadiness {
  readonly providerKey: string;
  readonly environment: string;
  readonly registered: boolean;
  readonly approved: boolean;
  readonly credentialed: boolean;
  readonly operational: boolean;
  readonly disabled: boolean;
  readonly disabledReason: string | null;
  readonly currentVersion: number | null;
  readonly entitled: 'UNKNOWN';
  readonly capabilities: readonly CapabilityReadiness[];
  /** Human-readable statement of what is missing. Never "ready" unless genuinely usable. */
  readonly summary: string;
}

export interface ProviderConfigurationSnapshot {
  provider_key: string;
  environment: string;
  capabilities: unknown;
  routing_approved: boolean;
  operational_ready: boolean;
  credential_bundle_fingerprint: string | null;
}

@Injectable()
export class BankingReadinessService {
  constructor(
    private readonly db: DataSource,
    private readonly registry: BankingProviderRegistry,
  ) {}

  /**
   * Resolves readiness for every registered provider for one institution.
   *
   * Reads only. Never triggers a provider call and never writes.
   */
  async forInstitution(institutionId: string): Promise<ProviderReadiness[]> {
    const versions = await this.db.query<
      Array<ProviderConfigurationSnapshot & { version: number }>
    >(
      `SELECT DISTINCT ON (provider_key,environment)
              provider_key,environment,capabilities,routing_approved,operational_ready,
              credential_bundle_fingerprint,version
         FROM banking_provider_configuration_versions
        WHERE institution_id=$1
        ORDER BY provider_key,environment,version DESC`,
      [institutionId],
    );
    const disengagements = await this.db.query<
      Array<{ provider_key: string; environment: string; reason: string }>
    >(
      `SELECT provider_key,environment,reason FROM banking_provider_disengagements
        WHERE institution_id=$1 AND reengaged_at IS NULL`,
      [institutionId],
    );

    const out: ProviderReadiness[] = [];
    const seen = new Set<string>();

    for (const provider of this.registry.list()) {
      const key = provider.descriptor.key;
      const environment = provider.descriptor.environment;
      seen.add(`${key}|${environment}`);
      const approvedConfig = versions.find(
        (v) => v.provider_key === key && v.environment === environment,
      );
      const disengagement = disengagements.find(
        (d) => d.provider_key === key && d.environment === environment,
      );
      out.push(
        this.describe(
          key,
          environment,
          provider.descriptor.capabilities,
          approvedConfig,
          disengagement,
        ),
      );
    }

    // An approved configuration for a provider this build does not register is reported, not hidden:
    // it usually means a deployment is older than the decision that approved it.
    for (const config of versions) {
      if (seen.has(`${config.provider_key}|${config.environment}`)) continue;
      out.push({
        providerKey: config.provider_key,
        environment: config.environment,
        registered: false,
        approved: true,
        credentialed: config.credential_bundle_fingerprint !== null,
        operational: config.operational_ready,
        disabled: false,
        disabledReason: null,
        currentVersion: config.version,
        entitled: 'UNKNOWN',
        capabilities: [],
        summary: `Approved for this institution but not registered in this deployment — the adapter is missing, so nothing can run.`,
      });
    }
    return out;
  }

  /** Single-capability predicate used by admission checks. Never permissive by default. */
  async capabilityUsable(
    institutionId: string,
    providerKey: string,
    environment: string,
    capability: BankingCapabilityKey,
  ): Promise<{ usable: boolean; state: ReadinessState; reason: string }> {
    const readiness = await this.forInstitution(institutionId);
    const provider = readiness.find(
      (p) => p.providerKey === providerKey && p.environment === environment,
    );
    if (!provider) {
      return {
        usable: false,
        state: 'NOT_REGISTERED',
        reason: `No provider ${providerKey} in ${environment} is registered for this institution`,
      };
    }
    const cap = provider.capabilities.find((c) => c.capability === capability);
    if (!cap) {
      return {
        usable: false,
        state: 'UNSUPPORTED',
        reason: `Provider ${providerKey} does not expose capability ${capability}`,
      };
    }
    return {
      usable: cap.usable,
      state: cap.state,
      reason: provider.summary,
    };
  }

  private describe(
    key: string,
    environment: string,
    implementedCapabilities: Readonly<Record<string, boolean>>,
    config: (ProviderConfigurationSnapshot & { version: number }) | undefined,
    disengagement: { reason: string } | undefined,
  ): ProviderReadiness {
    const approved = config !== undefined;
    const credentialed = config?.credential_bundle_fingerprint !== null && approved;
    const operational = approved && config.operational_ready && config.routing_approved;
    const disabled = disengagement !== undefined;

    const declared = new Set<string>();
    if (config && Array.isArray(config.capabilities)) {
      for (const entry of config.capabilities as Array<Record<string, unknown>>) {
        if (typeof entry.capability === 'string' && entry.supported === true) {
          declared.add(entry.capability);
        }
      }
    }

    const capabilities: CapabilityReadiness[] = Object.keys(implementedCapabilities).map(
      (capability) => {
        const implemented = implementedCapabilities[capability] === true;
        const approvedCap = approved && declared.has(capability);
        const state = this.stateOf({
          implemented,
          approvedCap,
          credentialed,
          operational,
          disabled,
        });
        return {
          capability: capability as BankingCapabilityKey,
          implemented,
          approved: approvedCap,
          credentialed: approvedCap && credentialed,
          operational: approvedCap && operational,
          disabled,
          entitled: 'UNKNOWN',
          state,
          usable: state === 'OPERATIONAL_BUT_ENTITLEMENT_UNCONFIRMED',
        };
      },
    );

    return {
      providerKey: key,
      environment,
      registered: true,
      approved,
      credentialed,
      operational,
      disabled,
      disabledReason: disengagement?.reason ?? null,
      currentVersion: config?.version ?? null,
      entitled: 'UNKNOWN',
      capabilities,
      summary: this.summarise({
        key,
        approved,
        credentialed,
        operational,
        disabled,
        disengagement,
      }),
    };
  }

  private stateOf(input: {
    implemented: boolean;
    approvedCap: boolean;
    credentialed: boolean;
    operational: boolean;
    disabled: boolean;
  }): ReadinessState {
    if (!input.implemented) return 'UNSUPPORTED';
    if (input.disabled) return 'DISABLED';
    if (!input.approvedCap) return 'IMPLEMENTED_NOT_APPROVED';
    if (!input.credentialed) return 'APPROVED_NOT_CREDENTIALED';
    if (!input.operational) return 'CREDENTIALED_NOT_OPERATIONAL';
    // Every locally-knowable condition holds. Entitlement remains unconfirmed by construction.
    return 'OPERATIONAL_BUT_ENTITLEMENT_UNCONFIRMED';
  }

  private summarise(input: {
    key: string;
    approved: boolean;
    credentialed: boolean;
    operational: boolean;
    disabled: boolean;
    disengagement: { reason: string } | undefined;
  }): string {
    if (input.disabled) {
      return `Operationally disabled: ${input.disengagement?.reason ?? 'no reason recorded'}`;
    }
    if (!input.approved) {
      return `${input.key} is implemented but not approved for this institution — no governed configuration exists`;
    }
    if (!input.credentialed) {
      return `${input.key} is approved but no credential bundle fingerprint is recorded`;
    }
    if (!input.operational) {
      return `${input.key} is approved but is not marked operationally ready and routing-approved`;
    }
    return `${input.key} is operationally usable; provider-side commercial entitlement is unconfirmed and cannot be inferred from this system`;
  }
}
