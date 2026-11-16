/**
 * The registry's whole job is to make a provider's claims match its behaviour. These tests exist
 * because the failure mode it guards against is silent: a bank transfer dispatch that discovers
 * "capability advertised but method missing" at the moment money is supposed to move.
 */
import { BankingProviderRegistry, capabilitiesOf } from '../src/banking/banking-provider.registry';
import type {
  BankingProvider,
  BankingProviderDescriptor,
} from '../src/banking/banking-provider.types';

/**
 * A stub read-only method. `require-await` is right to flag `async () => value`; a promise-returning
 * non-async function is both lint-clean and an honest stub -- it does no asynchronous work.
 */
const stubListBanks = () =>
  Promise.resolve({
    ok: false as const,
    error: { category: 'TRANSPORT' as const, code: 'X', detail: '' },
  });

function descriptorWith(
  key: string,
  capabilities: Partial<Record<string, boolean>>,
): BankingProviderDescriptor {
  return {
    key,
    displayName: key,
    capabilities: capabilitiesOf(capabilities),
    descriptors: [],
  };
}

describe('BankingProviderRegistry', () => {
  it('refuses a provider that advertises a capability it does not implement', () => {
    // Declares outbound transfer but offers no submitOutboundTransfer.
    const liar: BankingProvider = {
      descriptor: descriptorWith('LIAR', { OUTBOUND_TRANSFER_SUBMIT: true }),
      listBanks: stubListBanks,
    };
    const registry = new BankingProviderRegistry();
    expect(() => registry.register(liar)).toThrow(/advertises capabilities it does not implement/i);
    expect(() => registry.register(liar)).toThrow(/OUTBOUND_TRANSFER_SUBMIT/);
    // Nothing half-registered.
    expect(registry.has('LIAR')).toBe(false);
  });

  it('accepts a provider whose claims match its implementation', () => {
    const honest: BankingProvider = {
      descriptor: descriptorWith('HONEST', { BANK_DIRECTORY: true, ACCOUNT_NAME_ENQUIRY: false }),
      listBanks: stubListBanks,
    };
    const registry = new BankingProviderRegistry();
    registry.register(honest);
    expect(registry.supports('HONEST', 'BANK_DIRECTORY')).toBe(true);
    expect(registry.supports('HONEST', 'ACCOUNT_NAME_ENQUIRY')).toBe(false);
    // An unadvertised capability is unsupported even though the registry has no method for it.
    expect(registry.supports('HONEST', 'OUTBOUND_TRANSFER_SUBMIT')).toBe(false);
  });

  it('reports capability drift in both directions instead of hiding it', () => {
    const provider: BankingProvider = {
      descriptor: descriptorWith('DRIFT', { BANK_DIRECTORY: false }),
      listBanks: stubListBanks,
    };
    const registry = new BankingProviderRegistry();
    registry.register(provider);
    const drift = registry.capabilityDrift(provider);
    expect(drift.advertisedButMissing).toEqual([]);
    // Implemented but not advertised is a review signal: the operator cannot enable what exists.
    expect(drift.implementedButNotAdvertised).toContain('BANK_DIRECTORY');
  });

  it('has no implicit fallback between providers', () => {
    const a: BankingProvider = {
      descriptor: descriptorWith('A', {}),
      listBanks: stubListBanks,
    };
    const registry = new BankingProviderRegistry();
    registry.register(a);
    // Asking for a provider that is not registered must throw, not return A.
    expect(() => registry.require('B')).toThrow(/not configured/i);
    expect(registry.find('B')).toBeUndefined();
    expect(registry.supports('B', 'BANK_DIRECTORY')).toBe(false);
  });

  it('refuses duplicate registration of the same provider key', () => {
    const make = (): BankingProvider => ({
      descriptor: descriptorWith('DUP', {}),
      listBanks: stubListBanks,
    });
    const registry = new BankingProviderRegistry();
    registry.register(make());
    expect(() => registry.register(make())).toThrow(/already registered/i);
  });

  it('treats an undeclared capability as unavailable, never as enabled', () => {
    const caps = capabilitiesOf({});
    expect(Object.values(caps).every((v) => v === false)).toBe(true);
    // Frozen: a caller cannot widen a provider's claims at runtime.
    expect(Object.isFrozen(caps)).toBe(true);
  });
});
