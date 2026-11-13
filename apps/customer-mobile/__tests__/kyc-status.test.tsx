import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

import { KycStatusScreen } from '../src/screens/authenticated/KycStatusScreen';
import { ApiClient } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: { get: jest.fn(), post: jest.fn() },
}));

const kycProjection = (overrides: Record<string, unknown> = {}) => ({
  customerId: 'customer-1',
  kycLevel: 'LEVEL_1',
  kycStatus: 'APPROVED',
  assessment: {
    level: 'LEVEL_1',
    status: 'APPROVED',
    reason: null,
    expiresAt: '2027-01-01T00:00:00.000Z',
  },
  policy: { configured: true, version: 3 },
  requirements: {
    level: 'LEVEL_2',
    regulatory: { all: ['PHONE'], any: [['BVN', 'NIN']] },
    operator: { all: ['ADDRESS'], any: [] },
  },
  evidenceAssessment: {
    status: 'UNAVAILABLE',
    reason: 'TRUSTED_EVIDENCE_UNAVAILABLE',
    note: 'MonieNaije cannot yet assess verified identity evidence.',
  },
  lastEvaluation: null,
  manualHold: null,
  upgradePathway: { status: 'EVIDENCE_UNAVAILABLE', nextLevel: 'LEVEL_2' },
  asOf: '2026-11-13T10:00:00.000Z',
  ...overrides,
});

const limitsFixture = {
  customerId: 'customer-1',
  currency: 'NGN',
  asOf: '2026-11-13T10:00:00.000Z',
  products: [
    {
      product: 'WALLET_TRANSFER',
      direction: 'OUTGOING',
      currency: 'NGN',
      configured: true,
      perTransactionMinMinor: '10000',
      perTransactionMaxMinor: '5000000',
      walletBalanceMaxMinor: '50000000',
      windows: [
        {
          dimension: 'product',
          period: 'DAILY',
          kind: 'AMOUNT',
          limitMinor: '2000000',
          limitCount: null,
          remainingMinor: '1500000',
          remainingCount: null,
        },
      ],
    },
    {
      product: 'CASH_TO_CASH',
      direction: 'INCOMING',
      currency: 'NGN',
      configured: false,
      perTransactionMinMinor: null,
      perTransactionMaxMinor: null,
      walletBalanceMaxMinor: null,
      windows: [],
    },
  ],
};

const route = (kyc: unknown, limits: unknown) =>
  (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
    if (url === '/customers/me/kyc') {
      return kyc instanceof Error ? Promise.reject(kyc) : Promise.resolve(kyc);
    }
    if (url === '/customers/me/limits') {
      return limits instanceof Error ? Promise.reject(limits) : Promise.resolve(limits);
    }
    return Promise.reject(new Error(`unexpected ${url}`));
  });

describe('KycStatusScreen (real backend policy projection)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('shows the current tier, status, assessment and policy version', async () => {
    route(kycProjection(), limitsFixture);
    const { getByText } = render(<KycStatusScreen />);

    await waitFor(() => expect(getByText('Tier 1 · Verified')).toBeTruthy());
    expect(getByText('Approved')).toBeTruthy();
    expect(getByText('Requirement policy version 3 is in effect.')).toBeTruthy();
    expect(getByText(/Latest assessment · Tier 1 · Verified/)).toBeTruthy();
  });

  test('publishes the policy requirement shape without claiming any of it is missing', async () => {
    route(kycProjection(), limitsFixture);
    const { getByText, queryByText, getAllByText } = render(<KycStatusScreen />);

    await waitFor(() => expect(getByText(/What Tier 2 · Enhanced publishes/)).toBeTruthy());

    expect(
      getAllByText(/Bank Verification Number \(BVN\) or National Identification Number/).length,
    ).toBeGreaterThan(0);
    expect(getByText(/^• Residential address$/)).toBeTruthy();
    expect(getByText(/not a statement about your verification/)).toBeTruthy();

    // The screen must never assert a failed requirement or a rejection.
    expect(queryByText(/requirement failed|did not meet|rejected/i)).toBeNull();
  });

  test('states that evidence assessment is unavailable instead of implying a pass or fail', async () => {
    route(kycProjection(), limitsFixture);
    const { getByText, getAllByText } = render(<KycStatusScreen />);

    await waitFor(() => expect(getByText('TRUSTED_EVIDENCE_UNAVAILABLE')).toBeTruthy());
    expect(getByText('Evidence assessment')).toBeTruthy();
    expect(getAllByText(/cannot yet assess verified identity evidence/).length).toBeGreaterThan(0);
  });

  test('surfaces a manual hold as review in progress with no resubmission request', async () => {
    route(
      kycProjection({
        manualHold: { reason: 'IDENTITY_CONFLICT', since: '2026-11-10T09:00:00.000Z' },
        upgradePathway: { status: 'MANUAL_REVIEW', nextLevel: 'LEVEL_2' },
      }),
      limitsFixture,
    );
    const { getByText, queryByText } = render(<KycStatusScreen />);

    await waitFor(() => expect(getByText('Manual review in progress')).toBeTruthy());
    expect(getByText(/compliance reviewer must clear this/)).toBeTruthy();
    expect(queryByText(/please resubmit|upload again/i)).toBeNull();
  });

  test('renders configured limits and explains an unconfigured product honestly', async () => {
    route(kycProjection(), limitsFixture);
    const { getByText } = render(<KycStatusScreen />);

    await waitFor(() => expect(getByText('Send to a MonieNaija wallet')).toBeTruthy());
    expect(getByText(/₦20,000\.00 limit · ₦15,000\.00 remaining/)).toBeTruthy();
    expect(getByText('No limits are configured for this product.')).toBeTruthy();
  });

  test('reports an unconfigured policy instead of inventing requirements', async () => {
    route(
      kycProjection({
        policy: { configured: false, version: null },
        requirements: null,
        kycLevel: 'NONE',
        kycStatus: 'NOT_STARTED',
        assessment: null,
        upgradePathway: { status: 'POLICY_NOT_CONFIGURED', nextLevel: null },
      }),
      { customerId: 'customer-1', currency: 'NGN', asOf: '2026-11-13T10:00:00.000Z', products: [] },
    );
    const { getByText, queryByText } = render(<KycStatusScreen />);

    await waitFor(() => expect(getByText('Tier 0 · Unverified')).toBeTruthy());
    expect(getByText(/No requirement policy is in effect/)).toBeTruthy();
    expect(getByText(/No limit products are configured/)).toBeTruthy();
    expect(queryByText(/What Tier/)).toBeNull();
  });

  test('degrades to an explicit error when the KYC read fails', async () => {
    route(new Error('Verification status is temporarily unavailable.'), new Error('down'));
    const { getByText } = render(<KycStatusScreen />);

    await waitFor(() =>
      expect(getByText('Verification status is temporarily unavailable.')).toBeTruthy(),
    );
    expect(getByText(/Transaction limits could not be loaded/)).toBeTruthy();
  });
});
