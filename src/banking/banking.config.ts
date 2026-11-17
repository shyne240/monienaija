import type { Logger } from '@nestjs/common';

import { BankingProviderRegistry } from './banking-provider.registry';
import { MonnifyProvider } from './monnify/monnify.provider';
import { createMonnifyHttpClient } from './monnify/monnify.http';

/**
 * Banking provider registration, and the deliberate absence of one.
 *
 * A provider is registered only when every fact needed to construct it is present. There is no
 * placeholder adapter, no "succeed everything in test" provider and no default that looks functional.
 * If the configuration is incomplete the registry stays empty, `find()` returns undefined, and every
 * admission check refuses — which is the correct behaviour, and observable rather than silent.
 *
 * Commercial entitlement is deliberately not a registration condition: it cannot be verified from
 * inside this process, so it is reported as UNKNOWN by the readiness service rather than being
 * asserted here.
 */
export interface BankingRuntimeConfiguration {
  readonly enabled: boolean;
  readonly environment: 'sandbox' | 'production';
  readonly contractCode?: string | undefined;
  readonly apiKey?: string | undefined;
  readonly secretKey?: string | undefined;
}

export interface BankingRegistrationResult {
  readonly registry: BankingProviderRegistry;
  readonly registered: readonly string[];
  readonly skipped: readonly { provider: string; reason: string }[];
}

export function buildBankingRegistry(
  config: BankingRuntimeConfiguration,
  logger: Logger,
): BankingRegistrationResult {
  const registry = new BankingProviderRegistry();
  const registered: string[] = [];
  const skipped: { provider: string; reason: string }[] = [];

  if (!config.enabled) {
    // Consistent with MONNIFY_VERIFICATION_ENABLED's existing default of false: enabling a payment
    // provider is an operational decision, never an accident of deployment.
    skipped.push({ provider: 'MONNIFY', reason: 'banking integration disabled by configuration' });
    return { registry, registered, skipped };
  }

  const missing: string[] = [];
  if (!config.contractCode) missing.push('contractCode');
  if (!config.apiKey) missing.push('apiKey');
  if (!config.secretKey) missing.push('secretKey');
  if (!config.contractCode || !config.apiKey || !config.secretKey) {
    // Names only, never values: a log line that lists which secrets are absent is useful; one that
    // echoes a partially-correct value is a leak.
    skipped.push({ provider: 'MONNIFY', reason: `missing configuration: ${missing.join(', ')}` });
    return { registry, registered, skipped };
  }

  registry.register(
    new MonnifyProvider({
      environment: config.environment,
      contractCode: config.contractCode,
      apiKey: config.apiKey,
      secretKey: config.secretKey,
      http: createMonnifyHttpClient(),
    }),
  );
  registered.push('MONNIFY');
  logger.log(`Banking provider MONNIFY registered in ${config.environment}`);
  for (const entry of skipped) {
    logger.warn(`Banking provider ${entry.provider} not registered: ${entry.reason}`);
  }
  return { registry, registered, skipped };
}
