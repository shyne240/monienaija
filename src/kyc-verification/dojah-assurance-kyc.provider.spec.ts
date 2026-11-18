import {
  DojahAssuranceKycProvider,
  type DojahAssuranceContract,
} from './dojah-assurance-kyc.provider';

describe('Dojah assurance adapter contract boundary', () => {
  const reference = 'c4bbdd09-6e9b-42aa-a06b-1c0284d859dd';

  /*
   * Asserts on the jest mock without tripping `@typescript-eslint/unbound-method`. The rule fires on *reading* a
   * method member (`contract.verifyAddress`) because that detaches `this` from the object. Destructuring the
   * property into a plain value first is what the rule's own documentation recommends for this exact case, and
   * it keeps the escape confined to one line instead of disabling the rule for the file.
   */
  const calls = (record: object, key: string) =>
    (record as Record<string, unknown>)[key] as jest.Mock;

  test('does not dispatch without an account-specific reviewed contract', async () => {
    const provider = new DojahAssuranceKycProvider();
    await expect(
      provider.verify('ADDRESS_VERIFICATION', reference, new AbortController().signal),
    ).rejects.toThrow('contract is not configured');
  });

  test('maps only the two explicit Dojah assurance operation families', async () => {
    const contract: DojahAssuranceContract = {
      verifyAddress: jest.fn().mockResolvedValue({ outcome: 'REVIEW' }),
      verifyEnhancedKyc: jest.fn().mockResolvedValue({ outcome: 'VERIFIED' }),
    };
    const provider = new DojahAssuranceKycProvider(contract);
    const signal = new AbortController().signal;

    await expect(provider.verify('ADDRESS_VERIFICATION', reference, signal)).resolves.toEqual({
      outcome: 'REVIEW',
    });
    await expect(provider.verify('ENHANCED_DUE_DILIGENCE', reference, signal)).resolves.toEqual({
      outcome: 'VERIFIED',
    });
    expect(calls(contract, 'verifyAddress')).toHaveBeenCalledWith(reference, signal);
    expect(calls(contract, 'verifyEnhancedKyc')).toHaveBeenCalledWith(reference, signal);
  });

  test('rejects invalid references, aborted requests, unsupported capabilities and bad results', async () => {
    const contract: DojahAssuranceContract = {
      verifyAddress: jest.fn().mockResolvedValue({ outcome: 'VERIFIED' }),
      verifyEnhancedKyc: jest.fn().mockResolvedValue({ outcome: 'UNKNOWN' }),
    };
    const provider = new DojahAssuranceKycProvider(contract);
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.verify('ADDRESS_VERIFICATION', 'not-a-uuid', new AbortController().signal),
    ).rejects.toThrow('invalid or unsupported');
    await expect(
      provider.verify('ADDRESS_VERIFICATION', reference, controller.signal),
    ).rejects.toThrow('invalid or unsupported');
    await expect(
      provider.verify('SELFIE_LIVENESS', reference, new AbortController().signal),
    ).rejects.toThrow('invalid or unsupported');
    expect(calls(contract, 'verifyAddress')).not.toHaveBeenCalled();
    expect(calls(contract, 'verifyEnhancedKyc')).not.toHaveBeenCalled();

    contract.verifyAddress = jest.fn().mockResolvedValue({ outcome: 'MATCH' } as never);
    await expect(
      provider.verify('ADDRESS_VERIFICATION', reference, new AbortController().signal),
    ).rejects.toThrow('outcome is unrecognized');
    contract.verifyAddress = jest.fn().mockResolvedValue({
      outcome: 'VERIFIED',
      rawProviderResponse: { identity: 'must not escape the adapter' },
    } as never);
    await expect(
      provider.verify('ADDRESS_VERIFICATION', reference, new AbortController().signal),
    ).rejects.toThrow('outcome is unrecognized');
  });
});
