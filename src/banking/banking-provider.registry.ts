import { Injectable, Logger } from '@nestjs/common';

import type {
  BankingCapabilityKey,
  BankingEnvironment,
  BankingProvider,
  BankingProviderCapabilities,
} from './banking-provider.types';

/**
 * Method each capability maps to on the provider interface.
 *
 * The registry uses this to answer one question honestly: *is this capability actually wired?* A
 * provider that lists `OUTBOUND_TRANSFER_SUBMIT: true` while not implementing
 * `submitOutboundTransfer` is misconfigured, and we would rather refuse at registration time than
 * throw an obscure TypeError at 3am when money is being moved.
 */
const CAPABILITY_METHOD: Readonly<Record<BankingCapabilityKey, keyof BankingProvider>> = {
  BANK_DIRECTORY: 'listBanks',
  ACCOUNT_NAME_ENQUIRY: 'enquireAccountName',
  VIRTUAL_ACCOUNT_PROVISION: 'provisionVirtualAccount',
  VIRTUAL_ACCOUNT_STATUS: 'getVirtualAccountStatus',
  OUTBOUND_TRANSFER_SUBMIT: 'submitOutboundTransfer',
  TRANSFER_STATUS_ENQUIRY: 'getTransferStatus',
  INBOUND_PAYMENT_VERIFICATION: 'verifyInboundPayment',
  SETTLEMENT_VERIFICATION: 'verifySettlement',
  PROVIDER_BALANCE_ENQUIRY: 'getProviderBalance',
  RECONCILIATION_OBSERVATIONS: 'listReconciliationObservations',
  // Webhook ingestion is a route + signature concern, not an adapter method.
  WEBHOOK_INGESTION: 'descriptor',
  REFUND_INITIATION: 'descriptor',
};

export interface RegisteredBankingProvider {
  readonly provider: BankingProvider;
  readonly environment: BankingEnvironment;
}

/**
 * Resolves banking providers by key and environment.
 *
 * Deliberately not a service locator: an unknown or unconfigured provider is an error, never a
 * silent fallback to "some other provider". Rerouting an uncertain financial operation to a
 * different provider is the one thing this architecture must never do implicitly, so there is no
 * `getAny()` here to make it easy to write.
 */
@Injectable()
export class BankingProviderRegistry {
  private readonly logger = new Logger(BankingProviderRegistry.name);
  private readonly providers = new Map<string, BankingProvider>();

  register(provider: BankingProvider): void {
    const key = provider.descriptor.key;
    if (this.providers.has(key)) {
      throw new Error(`Banking provider ${key} is already registered`);
    }
    this.assertCapabilitiesAreWired(provider);
    this.providers.set(key, provider);
    this.logger.log(
      `Registered banking provider ${key} with ${this.advertisedKeys(provider).length} advertised capabilities`,
    );
  }

  has(key: string): boolean {
    return this.providers.has(key);
  }

  /**
   * Returns the provider or throws. Callers that are deciding *whether* to act must use `find`.
   */
  require(key: string): BankingProvider {
    const provider = this.providers.get(key);
    if (!provider) {
      throw new Error(`Banking provider ${key} is not configured`);
    }
    return provider;
  }

  find(key: string): BankingProvider | undefined {
    return this.providers.get(key);
  }

  list(): readonly BankingProvider[] {
    return [...this.providers.values()];
  }

  /**
   * Read-only projection of a registered provider's advertised capabilities.
   *
   * Governance validates a proposed configuration against this, so a configuration can never claim a
   * capability the adapter does not implement. Returns null for an unregistered key — callers must
   * treat that as a refusal, never as "assume it is fine".
   */
  descriptorFor(key: string): {
    key: string;
    environments: readonly string[];
    capabilities: Record<string, boolean>;
  } | null {
    const provider = this.providers.get(key);
    if (!provider) return null;
    return {
      key: provider.descriptor.key,
      environments: [provider.descriptor.environment],
      capabilities: { ...provider.descriptor.capabilities } as unknown as Record<string, boolean>,
    };
  }

  /**
   * True only when the capability is both advertised by configuration *and* actually implemented.
   * This is the single predicate every caller should use before attempting a capability.
   */
  supports(key: string, capability: BankingCapabilityKey): boolean {
    const provider = this.providers.get(key);
    if (!provider) return false;
    if (provider.descriptor.capabilities[capability] !== true) return false;
    return typeof provider[CAPABILITY_METHOD[capability]] === 'function';
  }

  /**
   * Capabilities that are advertised but not wired, or wired but not advertised.
   *
   * Returned rather than logged so an operator-facing readiness view can show it; a silent log line
   * about a provider that cannot do what it claims is not something a human will notice in time.
   */
  capabilityDrift(provider: BankingProvider): {
    advertisedButMissing: BankingCapabilityKey[];
    implementedButNotAdvertised: BankingCapabilityKey[];
  } {
    const advertisedButMissing: BankingCapabilityKey[] = [];
    const implementedButNotAdvertised: BankingCapabilityKey[] = [];
    for (const key of Object.keys(CAPABILITY_METHOD) as BankingCapabilityKey[]) {
      const method = CAPABILITY_METHOD[key];
      const implemented = typeof provider[method] === 'function';
      // `descriptor` is always a property, so the two non-adapter capabilities need no check.
      if (method === 'descriptor') continue;
      const advertised = provider.descriptor.capabilities[key] === true;
      if (advertised && !implemented) advertisedButMissing.push(key);
      if (!advertised && implemented) implementedButNotAdvertised.push(key);
    }
    return { advertisedButMissing, implementedButNotAdvertised };
  }

  private assertCapabilitiesAreWired(provider: BankingProvider): void {
    const { advertisedButMissing } = this.capabilityDrift(provider);
    if (advertisedButMissing.length > 0) {
      throw new Error(
        `Banking provider ${provider.descriptor.key} advertises capabilities it does not implement: ` +
          advertisedButMissing.join(', '),
      );
    }
  }

  private advertisedKeys(provider: BankingProvider): BankingCapabilityKey[] {
    return (Object.keys(provider.descriptor.capabilities) as BankingCapabilityKey[]).filter(
      (key) => provider.descriptor.capabilities[key] === true,
    );
  }
}

/**
 * Helper for adapters: build a fully-specified capability map without repeating every key.
 *
 * `false` is the default for anything not named, which is the safe direction — a capability nobody
 * remembered to declare is unavailable rather than silently assumed.
 */
export function capabilitiesOf(
  overrides: Partial<Record<BankingCapabilityKey, boolean>>,
): BankingProviderCapabilities {
  const keys: BankingCapabilityKey[] = [
    'BANK_DIRECTORY',
    'ACCOUNT_NAME_ENQUIRY',
    'VIRTUAL_ACCOUNT_PROVISION',
    'VIRTUAL_ACCOUNT_STATUS',
    'OUTBOUND_TRANSFER_SUBMIT',
    'TRANSFER_STATUS_ENQUIRY',
    'INBOUND_PAYMENT_VERIFICATION',
    'SETTLEMENT_VERIFICATION',
    'PROVIDER_BALANCE_ENQUIRY',
    'RECONCILIATION_OBSERVATIONS',
    'WEBHOOK_INGESTION',
    'REFUND_INITIATION',
  ];
  const result = {} as Record<BankingCapabilityKey, boolean>;
  for (const key of keys) result[key] = overrides[key] === true;
  return Object.freeze(result);
}
