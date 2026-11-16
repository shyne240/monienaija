import {
  createDojahAddressHttpsTransport,
  type DojahAddressSubmission,
  type DojahAddressTransport,
} from '../src/identity-verification/dojah-transport';
import { DojahVerificationProvider } from '../src/identity-verification/dojah-verification.provider';
import {
  DojahAssuranceKycProvider,
  DojahDocumentedAddressContract,
  type DojahAddressAssuranceSource,
} from '../src/kyc-verification/dojah-assurance-kyc.provider';

/**
 * Dojah address verification (`POST`/`GET /api/v1/kyc/address`) is asynchronous by contract: a
 * successful submit returns an opaque `reference_id` and the result only exists on a later poll.
 * These tests pin the two properties that matter for financial admission:
 *
 *   1. a submission can never be read as a verification, and
 *   2. an ambiguous provider answer can never be read as verified evidence.
 */

const config = {
  enabled: true,
  environment: 'sandbox' as const,
  secretKey: 'synthetic-secret',
  appId: 'synthetic-app',
  timeoutMs: 500,
};

const input = {
  firstName: 'Synthetic',
  lastName: 'Person',
  mobile: '+2348012345678',
  street: '1 Example Close',
  lga: 'Jos North',
  state: 'Plateau',
};

const submission = (): DojahAddressSubmission => ({
  firstName: input.firstName,
  lastName: input.lastName,
  mobile: input.mobile,
  street: input.street,
  lga: input.lga,
  state: input.state,
});

type NamedTransport = DojahAddressTransport & {
  submit: jest.Mock;
  poll: jest.Mock;
};

/**
 * Builds the transport double. Overrides replace the default behaviour while remaining the same
 * spy the assertions attach to, so "was this called" and "what did it return" stay one object.
 */
function transportDouble(
  overrides: {
    submit?: () => Promise<{ status: number; body: unknown }>;
    poll?: () => Promise<{ status: number; body: unknown }>;
  } = {},
): NamedTransport {
  const submit = jest.fn(
    overrides.submit ??
      (() => Promise.resolve({ status: 200, body: { entity: { status: 'pending' } } })),
  );
  const poll = jest.fn(
    overrides.poll ??
      (() =>
        Promise.resolve({
          status: 200,
          body: { entity: { status: 'pending', reference_id: 'ref_1234567890' } },
        })),
  );
  return { submit, poll };
}

const accepted = () =>
  Promise.resolve({
    status: 200,
    body: { entity: { status: 'pending', reference_id: 'ref_1234567890' } },
  });

describe('Dojah address verification adapter', () => {
  it('is disabled by default and issues no billable submission', async () => {
    const transport = transportDouble();
    const provider = new DojahVerificationProvider({ addressTransport: transport });
    await expect(provider.submitAddressVerification(input)).rejects.toMatchObject({
      code: 'DISABLED',
    });
    expect(transport.submit).not.toHaveBeenCalled();
  });

  it('returns the provider reference on submit and never reports a verification', async () => {
    const transport = transportDouble({ submit: accepted });
    const provider = new DojahVerificationProvider({ ...config, addressTransport: transport });

    const result = await provider.submitAddressVerification(input);
    expect(result).toEqual({ referenceId: 'ref_1234567890' });
    // Submitting is not verifying: the result carries no `verified` flag at all.
    expect(Object.keys(result)).toEqual(['referenceId']);
    expect(transport.submit).toHaveBeenCalledWith(
      submission(),
      expect.objectContaining({ environment: 'sandbox', authorization: 'synthetic-secret' }),
    );
  });

  it('rejects a submission the provider accepted without a pollable reference', async () => {
    const provider = new DojahVerificationProvider({
      ...config,
      addressTransport: transportDouble({
        submit: () => Promise.resolve({ status: 200, body: { entity: { status: 'pending' } } }),
      }),
    });
    await expect(provider.submitAddressVerification(input)).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
  });

  it('reports pending as unverified', async () => {
    const provider = new DojahVerificationProvider({
      ...config,
      addressTransport: transportDouble(),
    });
    await expect(provider.getAddressVerificationStatus('ref_1234567890')).resolves.toEqual({
      referenceId: 'ref_1234567890',
      status: 'PENDING',
      verified: false,
      collected: null,
    });
  });

  it('treats completed-without-positive-indication as unverified evidence', async () => {
    // `completed` on its own is a visit outcome, not an identity assertion.
    for (const entity of [
      { status: 'completed', reference_id: 'ref_1234567890' },
      { status: 'completed', address: { address: '1 Example Close' } },
      { status: 'completed', verified: false, address: { address: '1 Example Close' } },
    ]) {
      const provider = new DojahVerificationProvider({
        ...config,
        addressTransport: transportDouble({
          poll: () => Promise.resolve({ status: 200, body: { entity } }),
        }),
      });
      const result = await provider.getAddressVerificationStatus('ref_1234567890');
      expect(result.verified).toBe(false);
      expect(result.collected).toBeNull();
    }
  });

  it('reports a positively verified visit with only the non-imagery collected fields', async () => {
    const provider = new DojahVerificationProvider({
      ...config,
      addressTransport: transportDouble({
        poll: () =>
          Promise.resolve({
            status: 200,
            body: {
              entity: {
                status: 'completed',
                verified: true,
                reference_id: 'ref_1234567890',
                address: { address: '1 Example Close', lga: 'Jos North', state: 'Plateau' },
                // Present in a real provider response and deliberately not surfaced.
                photos: ['https://example.invalid/a.jpg'],
                coordinates: { lat: 9.9, lng: 8.8 },
                neighbour_reference: 'Neighbour Name',
              },
            },
          }),
      }),
    });
    const result = await provider.getAddressVerificationStatus('ref_1234567890');
    expect(result).toEqual({
      referenceId: 'ref_1234567890',
      status: 'COMPLETED',
      verified: true,
      collected: { address: '1 Example Close', lga: 'Jos North', state: 'Plateau' },
    });
    // No imagery or geolocation escapes the adapter.
    expect(JSON.stringify(result)).not.toMatch(/photos|coordinates|neighbour/);
  });

  it('fails closed on an unrecognised provider status', async () => {
    const provider = new DojahVerificationProvider({
      ...config,
      addressTransport: transportDouble({
        poll: () =>
          Promise.resolve({
            status: 200,
            body: { entity: { status: 'in_review', reference_id: 'ref_1234567890' } },
          }),
      }),
    });
    await expect(provider.getAddressVerificationStatus('ref_1234567890')).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
  });

  it('maps auth and transport failures without leaking provider detail', async () => {
    const unauthorized = new DojahVerificationProvider({
      ...config,
      addressTransport: transportDouble({
        poll: () => Promise.resolve({ status: 401, body: { error: 'nope' } }),
      }),
    });
    await expect(unauthorized.getAddressVerificationStatus('ref_1234567890')).rejects.toMatchObject(
      { code: 'AUTH_FAILED' },
    );

    const exploded = new DojahVerificationProvider({
      ...config,
      addressTransport: transportDouble({
        poll: () => Promise.reject(new Error('socket hang up at 10.0.0.1')),
      }),
    });
    await expect(exploded.getAddressVerificationStatus('ref_1234567890')).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
  });

  it('rejects malformed submission fields before any network call', async () => {
    const transport = transportDouble();
    const provider = new DojahVerificationProvider({ ...config, addressTransport: transport });
    for (const bad of [
      { ...input, firstName: '' },
      { ...input, mobile: 'not-a-phone' },
      { ...input, dateOfBirth: '2000-13-45' },
      { ...input, street: 'x'.repeat(300) },
    ]) {
      await expect(provider.submitAddressVerification(bad)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    }
    expect(transport.submit).not.toHaveBeenCalled();
  });
});

describe('Dojah address transport hardening', () => {
  const addresses = [{ address: '203.0.113.10', family: 4 }];
  const context = () => ({
    environment: 'sandbox' as const,
    authorization: 'synthetic-secret',
    appId: 'synthetic-app',
    signal: new AbortController().signal,
  });

  it('refuses a reference id that could escape the query parameter', async () => {
    const transport = createDojahAddressHttpsTransport({
      lookup: () => Promise.resolve(addresses),
    });
    for (const reference of ['ref/../admin', 'ref 1', '', 'x'.repeat(200), 'a&b=c']) {
      await expect(transport.poll(reference, context())).rejects.toThrow('Blocked');
    }
  });

  it('refuses a submission carrying an undocumented field', async () => {
    const transport = createDojahAddressHttpsTransport({
      lookup: () => Promise.resolve(addresses),
    });
    await expect(
      transport.submit(
        { ...submission(), bvn: '22222222222' } as unknown as DojahAddressSubmission,
        context(),
      ),
    ).rejects.toThrow('Blocked');
  });

  it('refuses to dial a host that resolves into a forbidden network', async () => {
    const transport = createDojahAddressHttpsTransport({
      lookup: () => Promise.resolve([{ address: '169.254.169.254', family: 4 }]),
    });
    await expect(transport.poll('ref_1234567890', context())).rejects.toThrow('Blocked');
  });

  it('refuses an already-aborted signal without dialing', async () => {
    let lookedUp = false;
    const transport = createDojahAddressHttpsTransport({
      lookup: () => {
        lookedUp = true;
        return Promise.resolve(addresses);
      },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      transport.poll('ref_1234567890', { ...context(), signal: controller.signal }),
    ).rejects.toThrow('Blocked');
    expect(lookedUp).toBe(false);
  });
});

describe('Reviewed Dojah address assurance contract', () => {
  const source = (status: {
    referenceId: string;
    status: 'PENDING' | 'COMPLETED' | 'FAILED';
    verified: boolean;
    collected: { address?: string } | null;
  }): DojahAddressAssuranceSource => ({
    submitAddressVerification: () => Promise.resolve({ referenceId: status.referenceId }),
    getAddressVerificationStatus: () => Promise.resolve(status),
  });

  it('maps an outstanding visit to REVIEW, never to evidence', async () => {
    for (const pending of [
      source({
        referenceId: 'ref_1234567890',
        status: 'PENDING',
        verified: false,
        collected: null,
      }),
      source({ referenceId: 'ref_1234567890', status: 'FAILED', verified: false, collected: null }),
    ]) {
      const provider = new DojahAssuranceKycProvider(new DojahDocumentedAddressContract(pending));
      await expect(
        provider.verify(
          'ADDRESS_VERIFICATION',
          '0f8fad5b-d9cb-469f-a165-70867728950e',
          new AbortController().signal,
        ),
      ).resolves.toEqual({ outcome: 'REVIEW' });
    }
  });

  it('maps completed-without-a-collected-address to UNKNOWN', async () => {
    const provider = new DojahAssuranceKycProvider(
      new DojahDocumentedAddressContract(
        source({
          referenceId: 'ref_1234567890',
          status: 'COMPLETED',
          verified: true,
          collected: null,
        }),
      ),
    );
    await expect(
      provider.verify(
        'ADDRESS_VERIFICATION',
        '0f8fad5b-d9cb-469f-a165-70867728950e',
        new AbortController().signal,
      ),
    ).resolves.toEqual({ outcome: 'UNKNOWN' });
  });

  it('maps a positively verified visit to VERIFIED', async () => {
    const provider = new DojahAssuranceKycProvider(
      new DojahDocumentedAddressContract(
        source({
          referenceId: 'ref_1234567890',
          status: 'COMPLETED',
          verified: true,
          collected: { address: '1 Example Close' },
        }),
      ),
    );
    await expect(
      provider.verify(
        'ADDRESS_VERIFICATION',
        '0f8fad5b-d9cb-469f-a165-70867728950e',
        new AbortController().signal,
      ),
    ).resolves.toEqual({ outcome: 'VERIFIED' });
  });

  it('maps an adapter failure to UNKNOWN rather than a negative finding', async () => {
    const provider = new DojahAssuranceKycProvider(
      new DojahDocumentedAddressContract({
        submitAddressVerification: () => Promise.reject(new Error('unused')),
        getAddressVerificationStatus: () => Promise.reject(new Error('provider down')),
      }),
    );
    await expect(
      provider.verify(
        'ADDRESS_VERIFICATION',
        '0f8fad5b-d9cb-469f-a165-70867728950e',
        new AbortController().signal,
      ),
    ).resolves.toEqual({ outcome: 'UNKNOWN' });
  });

  it('refuses enhanced due diligence instead of approximating it', async () => {
    const provider = new DojahAssuranceKycProvider(
      new DojahDocumentedAddressContract(
        source({
          referenceId: 'ref_1234567890',
          status: 'PENDING',
          verified: false,
          collected: null,
        }),
      ),
    );
    await expect(
      provider.verify(
        'ENHANCED_DUE_DILIGENCE',
        '0f8fad5b-d9cb-469f-a165-70867728950e',
        new AbortController().signal,
      ),
    ).rejects.toThrow('Dojah enhanced KYC is not a documented operation');
  });
});
